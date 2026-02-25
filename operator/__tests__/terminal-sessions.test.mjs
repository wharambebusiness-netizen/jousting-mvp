// Phase 48 — Terminal Session Management Tests
// Tests for session recording, resume/clone config, templates,
// persistence, FIFO eviction, and REST routes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { EventBus } from '../../shared/event-bus.mjs';
import {
  createTerminalSessionStore,
  MAX_SESSIONS_DEFAULT,
  OUTPUT_SUMMARY_CHARS,
  BUILTIN_TEMPLATES,
} from '../terminal-sessions.mjs';
import { createApp } from '../server.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_terminal_sessions');
const PERSIST_PATH = join(TEST_DIR, '.data', 'terminal-sessions.json');
const TEMPLATE_PATH = join(TEST_DIR, '.data', 'terminal-templates.json');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── Exports ──────────────────────────────────────────────────

describe('exports', () => {
  it('exports constants and factory', () => {
    expect(MAX_SESSIONS_DEFAULT).toBe(100);
    expect(OUTPUT_SUMMARY_CHARS).toBe(500);
    expect(Array.isArray(BUILTIN_TEMPLATES)).toBe(true);
    expect(BUILTIN_TEMPLATES.length).toBe(3);
    expect(typeof createTerminalSessionStore).toBe('function');
  });

  it('built-in template names are default, code-review, bug-fix', () => {
    const names = BUILTIN_TEMPLATES.map(t => t.name);
    expect(names).toContain('default');
    expect(names).toContain('code-review');
    expect(names).toContain('bug-fix');
  });
});

// ── Factory ──────────────────────────────────────────────────

describe('createTerminalSessionStore', () => {
  it('returns object with all API methods', () => {
    const store = createTerminalSessionStore();
    expect(typeof store.getSession).toBe('function');
    expect(typeof store.listSessions).toBe('function');
    expect(typeof store.getResumeConfig).toBe('function');
    expect(typeof store.deleteSession).toBe('function');
    expect(typeof store.clear).toBe('function');
    expect(typeof store.getTemplates).toBe('function');
    expect(typeof store.getTemplate).toBe('function');
    expect(typeof store.saveTemplate).toBe('function');
    expect(typeof store.deleteTemplate).toBe('function');
    expect(typeof store.load).toBe('function');
    expect(typeof store.destroy).toBe('function');
  });

  it('starts with zero sessions', () => {
    const store = createTerminalSessionStore();
    expect(store.count).toBe(0);
    expect(store.listSessions()).toEqual([]);
  });
});

// ── Event-Driven Session Recording ───────────────────────────

describe('session recording via events', () => {
  it('spawned terminal creates session record', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', {
      terminalId: 'term-1',
      config: { model: 'sonnet', projectDir: '/test', dangerouslySkipPermissions: true },
    });

    const session = store.getSession('term-1');
    expect(session).not.toBeNull();
    expect(session.id).toBe('term-1');
    expect(session.startedAt).toBeDefined();
    expect(session.endedAt).toBeNull();
    expect(session.exitCode).toBeNull();
    expect(session.config.model).toBe('sonnet');
    expect(session.config.projectDir).toBe('/test');
    expect(session.config.dangerouslySkipPermissions).toBe(true);
    expect(session.handoffCount).toBe(0);
    expect(session.taskHistory).toEqual([]);
    expect(session.duration).toBe(0);
  });

  it('exited terminal updates session with endedAt, exitCode, duration', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', {
      terminalId: 'term-exit',
      config: { model: 'haiku' },
    });

    events.emit('claude-terminal:exit', {
      terminalId: 'term-exit',
      exitCode: 0,
    });

    const session = store.getSession('term-exit');
    expect(session.endedAt).not.toBeNull();
    expect(session.exitCode).toBe(0);
    expect(session.duration).toBeGreaterThanOrEqual(0);
  });

  it('handoff event increments handoffCount', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', {
      terminalId: 'term-handoff',
      config: {},
    });

    events.emit('claude-terminal:handoff', {
      terminalId: 'term-handoff',
      handoffCount: 1,
    });

    const session = store.getSession('term-handoff');
    expect(session.handoffCount).toBe(1);
  });

  it('task-completed event with status=complete appends to taskHistory', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', {
      terminalId: 'term-task',
      config: {},
    });

    events.emit('claude-terminal:task-completed', {
      terminalId: 'term-task',
      taskId: 'task-1',
      status: 'complete',
      category: 'code',
    });

    const session = store.getSession('term-task');
    expect(session.taskHistory).toContain('code');
    expect(session.lastTaskId).toBe('task-1');
  });

  it('task-completed with status=failed does not update taskHistory', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', {
      terminalId: 'term-fail',
      config: {},
    });

    events.emit('claude-terminal:task-completed', {
      terminalId: 'term-fail',
      taskId: 'task-2',
      status: 'failed',
      category: 'testing',
    });

    const session = store.getSession('term-fail');
    expect(session.taskHistory).toEqual([]);
  });

  it('exit without prior spawn does not crash', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });
    // Should not throw
    expect(() => {
      events.emit('claude-terminal:exit', { terminalId: 'never-spawned', exitCode: 0 });
    }).not.toThrow();
  });
});

// ── Session API ──────────────────────────────────────────────

describe('getSession', () => {
  it('returns null for unknown ID', () => {
    const store = createTerminalSessionStore();
    expect(store.getSession('no-such-id')).toBeNull();
  });
});

describe('listSessions', () => {
  it('returns all sessions when status=all (default)', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', { terminalId: 'a', config: {} });
    events.emit('claude-terminal:spawned', { terminalId: 'b', config: {} });
    events.emit('claude-terminal:exit', { terminalId: 'b', exitCode: 0 });

    const all = store.listSessions();
    expect(all.length).toBe(2);
  });

  it('filters to completed sessions when status=completed', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', { terminalId: 'r1', config: {} });
    events.emit('claude-terminal:spawned', { terminalId: 'r2', config: {} });
    events.emit('claude-terminal:exit', { terminalId: 'r2', exitCode: 0 });

    const completed = store.listSessions({ status: 'completed' });
    expect(completed.length).toBe(1);
    expect(completed[0].id).toBe('r2');
  });

  it('filters to running sessions when status=running', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', { terminalId: 'rr1', config: {} });
    events.emit('claude-terminal:spawned', { terminalId: 'rr2', config: {} });
    events.emit('claude-terminal:exit', { terminalId: 'rr2', exitCode: 0 });

    const running = store.listSessions({ status: 'running' });
    expect(running.length).toBe(1);
    expect(running[0].id).toBe('rr1');
  });

  it('paginates with limit/offset', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    for (let i = 0; i < 5; i++) {
      events.emit('claude-terminal:spawned', { terminalId: `p-${i}`, config: {} });
    }

    const page1 = store.listSessions({ limit: 2, offset: 0 });
    const page2 = store.listSessions({ limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(2);
    // Ensure no overlap
    const ids1 = page1.map(s => s.id);
    const ids2 = page2.map(s => s.id);
    expect(ids1.every(id => !ids2.includes(id))).toBe(true);
  });
});

// ── Resume Config ────────────────────────────────────────────

describe('getResumeConfig', () => {
  it('returns null for unknown session', () => {
    const store = createTerminalSessionStore();
    expect(store.getResumeConfig('no-such')).toBeNull();
  });

  it('returns config with augmented system prompt', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', {
      terminalId: 'resume-me',
      config: { model: 'sonnet', projectDir: '/proj', dangerouslySkipPermissions: true },
    });

    const config = store.getResumeConfig('resume-me');
    expect(config).not.toBeNull();
    expect(config.model).toBe('sonnet');
    expect(config.projectDir).toBe('/proj');
    expect(config.dangerouslySkipPermissions).toBe(true);
    expect(config.systemPrompt).toContain('Continue from previous session');
  });

  it('includes outputSummary in system prompt when available', () => {
    const events = new EventBus();
    // Mock pool with getOutputBuffer
    const mockPool = {
      getTerminalHandle: () => ({
        getOutputBuffer: () => 'Last output content here',
      }),
    };
    const store = createTerminalSessionStore({ events, claudePool: mockPool });

    events.emit('claude-terminal:spawned', { terminalId: 'with-output', config: {} });
    events.emit('claude-terminal:exit', { terminalId: 'with-output', exitCode: 0 });

    const config = store.getResumeConfig('with-output');
    expect(config.systemPrompt).toContain('Last output content here');
  });

  it('truncates outputSummary to OUTPUT_SUMMARY_CHARS', () => {
    const events = new EventBus();
    const longOutput = 'x'.repeat(1000);
    const mockPool = {
      getTerminalHandle: () => ({
        getOutputBuffer: () => longOutput,
      }),
    };
    const store = createTerminalSessionStore({ events, claudePool: mockPool });

    events.emit('claude-terminal:spawned', { terminalId: 'long-out', config: {} });
    events.emit('claude-terminal:exit', { terminalId: 'long-out', exitCode: 0 });

    const session = store.getSession('long-out');
    expect(session.outputSummary.length).toBeLessThanOrEqual(OUTPUT_SUMMARY_CHARS);
  });

  it('appends to existing systemPrompt', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', {
      terminalId: 'with-prompt',
      config: { systemPrompt: 'My custom prompt' },
    });

    const config = store.getResumeConfig('with-prompt');
    expect(config.systemPrompt).toContain('My custom prompt');
    expect(config.systemPrompt).toContain('Continue from previous session');
  });
});

// ── Delete / Clear ───────────────────────────────────────────

describe('deleteSession', () => {
  it('deletes a session and returns true', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });
    events.emit('claude-terminal:spawned', { terminalId: 'del-me', config: {} });

    expect(store.deleteSession('del-me')).toBe(true);
    expect(store.getSession('del-me')).toBeNull();
  });

  it('returns false for non-existent session', () => {
    const store = createTerminalSessionStore();
    expect(store.deleteSession('no-such')).toBe(false);
  });
});

describe('clear', () => {
  it('removes all sessions', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    events.emit('claude-terminal:spawned', { terminalId: 'c1', config: {} });
    events.emit('claude-terminal:spawned', { terminalId: 'c2', config: {} });

    store.clear();
    expect(store.count).toBe(0);
    expect(store.listSessions()).toEqual([]);
  });
});

// ── FIFO Eviction ────────────────────────────────────────────

describe('FIFO eviction', () => {
  it('evicts oldest session when maxSessions is exceeded', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events, maxSessions: 3 });

    // Spawn 4 terminals — oldest should be evicted
    events.emit('claude-terminal:spawned', { terminalId: 'oldest', config: {} });
    events.emit('claude-terminal:spawned', { terminalId: 'second', config: {} });
    events.emit('claude-terminal:spawned', { terminalId: 'third', config: {} });
    events.emit('claude-terminal:spawned', { terminalId: 'newest', config: {} });

    expect(store.count).toBe(3);
    expect(store.getSession('oldest')).toBeNull();
    expect(store.getSession('newest')).not.toBeNull();
  });
});

// ── Persistence ──────────────────────────────────────────────

describe('persistence', () => {
  it('saves sessions and loads them back', () => {
    const events = new EventBus();
    const store1 = createTerminalSessionStore({
      events,
      persistPath: PERSIST_PATH,
    });

    events.emit('claude-terminal:spawned', {
      terminalId: 'persist-1',
      config: { model: 'sonnet' },
    });

    // Load into new store
    const store2 = createTerminalSessionStore({ persistPath: PERSIST_PATH });
    store2.load();

    const session = store2.getSession('persist-1');
    expect(session).not.toBeNull();
    expect(session.config.model).toBe('sonnet');
  });
});

// ── Built-in Templates ───────────────────────────────────────

describe('built-in templates', () => {
  it('getTemplates() returns 3 built-in templates', () => {
    const store = createTerminalSessionStore();
    const templates = store.getTemplates();
    const names = templates.map(t => t.name);
    expect(names).toContain('default');
    expect(names).toContain('code-review');
    expect(names).toContain('bug-fix');
  });

  it('getTemplate("default") returns default template', () => {
    const store = createTerminalSessionStore();
    const tpl = store.getTemplate('default');
    expect(tpl).not.toBeNull();
    expect(tpl.name).toBe('default');
    expect(tpl.builtin).toBe(true);
  });

  it('getTemplate("code-review") has systemPrompt', () => {
    const store = createTerminalSessionStore();
    const tpl = store.getTemplate('code-review');
    expect(tpl.systemPrompt).toBeTruthy();
  });

  it('getTemplate("bug-fix") has systemPrompt', () => {
    const store = createTerminalSessionStore();
    const tpl = store.getTemplate('bug-fix');
    expect(tpl.systemPrompt).toBeTruthy();
  });

  it('getTemplate() returns null for unknown name', () => {
    const store = createTerminalSessionStore();
    expect(store.getTemplate('no-such-template')).toBeNull();
  });
});

// ── Custom Templates ─────────────────────────────────────────

describe('custom templates', () => {
  it('saveTemplate() persists a custom template', () => {
    const store = createTerminalSessionStore({ templatePath: TEMPLATE_PATH });

    const tpl = store.saveTemplate('my-tpl', {
      model: 'opus',
      systemPrompt: 'Do great work',
      dangerouslySkipPermissions: false,
    });

    expect(tpl.name).toBe('my-tpl');
    expect(tpl.model).toBe('opus');
    expect(tpl.systemPrompt).toBe('Do great work');
    expect(tpl.builtin).toBe(false);
    expect(tpl.createdAt).toBeTruthy();

    // Confirm it's retrievable
    expect(store.getTemplate('my-tpl')).not.toBeNull();
  });

  it('deleteTemplate() removes a custom template', () => {
    const store = createTerminalSessionStore({ templatePath: TEMPLATE_PATH });

    store.saveTemplate('deletable', { model: 'sonnet' });
    expect(store.getTemplate('deletable')).not.toBeNull();

    const deleted = store.deleteTemplate('deletable');
    expect(deleted).toBe(true);
    expect(store.getTemplate('deletable')).toBeNull();
  });

  it('deleteTemplate() returns false for non-existent template', () => {
    const store = createTerminalSessionStore();
    expect(store.deleteTemplate('custom-no-such')).toBe(false);
  });

  it('deleteTemplate() throws for built-in templates', () => {
    const store = createTerminalSessionStore();
    expect(() => store.deleteTemplate('default')).toThrow();
  });

  it('saveTemplate() validates name format', () => {
    const store = createTerminalSessionStore();
    expect(() => store.saveTemplate('invalid name!', {})).toThrow();
    expect(() => store.saveTemplate('', {})).toThrow();
  });

  it('template persistence: save+load cycle preserves custom templates', () => {
    const store1 = createTerminalSessionStore({ templatePath: TEMPLATE_PATH });
    store1.saveTemplate('saved-tpl', { model: 'haiku', systemPrompt: 'test' });

    const store2 = createTerminalSessionStore({ templatePath: TEMPLATE_PATH });
    store2.load();

    const tpl = store2.getTemplate('saved-tpl');
    expect(tpl).not.toBeNull();
    expect(tpl.model).toBe('haiku');
  });

  it('custom template overrides built-in with same name in getTemplates()', () => {
    const store = createTerminalSessionStore({ templatePath: TEMPLATE_PATH });
    // Override 'default' built-in
    store.saveTemplate('default', { model: 'opus', systemPrompt: 'custom default' });

    const templates = store.getTemplates();
    const defaultTpl = templates.find(t => t.name === 'default');
    expect(defaultTpl).not.toBeNull();
    // Should have custom model
    expect(defaultTpl.model).toBe('opus');
    // Should appear only once
    const defaultCount = templates.filter(t => t.name === 'default').length;
    expect(defaultCount).toBe(1);
  });
});

// ── destroy() ────────────────────────────────────────────────

describe('destroy', () => {
  it('unwires event listeners so events no longer update store', () => {
    const events = new EventBus();
    const store = createTerminalSessionStore({ events });

    store.destroy();

    // After destroy, spawned events should not create sessions
    events.emit('claude-terminal:spawned', { terminalId: 'post-destroy', config: {} });
    expect(store.getSession('post-destroy')).toBeNull();
  });
});

// ── REST Routes ──────────────────────────────────────────────

describe('REST routes', () => {
  let appInstance, baseUrl;

  function startServer(options = {}) {
    const events = new EventBus();
    appInstance = createApp({
      operatorDir: TEST_DIR,
      events,
      auth: false,
      claudePool: false,
      sharedMemory: false,
      messageBus: false,
      webhooks: false,
      ...options,
    });
    return new Promise(resolve => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  }

  afterEach(async () => {
    if (appInstance) {
      await appInstance.close();
      appInstance = null;
    }
  });

  it('GET /api/claude-terminals/sessions returns list', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/sessions`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(data.available).toBe(true);
  });

  it('GET /api/claude-terminals/sessions/:id returns 404 for unknown session', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/sessions/no-such`);
    expect(res.status).toBe(404);
  });

  it('POST /api/claude-terminals/sessions/:id/resume returns 503 when claudePool not available', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/sessions/no-such/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // claudePool is false in this server instance — 503 expected
    expect(res.status).toBe(503);
  });

  it('POST /api/claude-terminals/sessions/:id/clone returns 503 when claudePool not available', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/sessions/no-such/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // claudePool is false in this server instance — 503 expected
    expect(res.status).toBe(503);
  });

  it('GET /api/claude-terminals/templates returns template list', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/templates`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.templates)).toBe(true);
    expect(data.available).toBe(true);
    // Should include built-ins
    const names = data.templates.map(t => t.name);
    expect(names).toContain('default');
    expect(names).toContain('code-review');
    expect(names).toContain('bug-fix');
  });

  it('POST /api/claude-terminals/templates saves a template', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'route-tpl', model: 'haiku' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.template.name).toBe('route-tpl');
  });

  it('POST /api/claude-terminals/templates returns 400 when name missing', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'haiku' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/claude-terminals/templates/:name removes a template', async () => {
    await startServer();
    // First create
    await fetch(`${baseUrl}/api/claude-terminals/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'del-route-tpl', model: 'sonnet' }),
    });

    const res = await fetch(`${baseUrl}/api/claude-terminals/templates/del-route-tpl`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('DELETE /api/claude-terminals/templates/:name returns 404 for unknown template', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/templates/no-such-tpl`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/claude-terminals/templates/:name returns 400 for built-in', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/templates/default`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/claude-terminals/spawn-template/:name returns 503 when claudePool not available', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/spawn-template/no-tpl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // claudePool is false — 503 before template lookup
    expect(res.status).toBe(503);
  });

  it('GET /api/claude-terminals/sessions supports status filter query param', async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/api/claude-terminals/sessions?status=completed`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.sessions)).toBe(true);
  });
});
