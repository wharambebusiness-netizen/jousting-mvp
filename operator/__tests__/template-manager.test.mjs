// Template Manager + Routes Tests (Phase 61)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import express from 'express';
import { createTemplateManager, BUILTIN_TEMPLATES, validateTemplate } from '../template-manager.mjs';
import { createTemplateRoutes } from '../routes/templates.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_templates');
const PERSIST_PATH = join(TEST_DIR, '.data', 'templates.json');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── Helper: create test server ──────────────────────────────

function createTestServer(templateManager, coordinator) {
  const app = express();
  app.use(express.json());
  app.use('/api', createTemplateRoutes({ templateManager, coordinator }));
  return app;
}

function startTestServer(templateManager, coordinator) {
  const app = createTestServer(templateManager, coordinator);
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ── BUILTIN_TEMPLATES ───────────────────────────────────────

describe('BUILTIN_TEMPLATES', () => {
  it('has 8 built-in templates', () => {
    expect(BUILTIN_TEMPLATES.length).toBe(8);
  });

  it('all have unique ids', () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all have required fields', () => {
    for (const tmpl of BUILTIN_TEMPLATES) {
      expect(tmpl.id).toBeTruthy();
      expect(tmpl.name).toBeTruthy();
      expect(tmpl.builtin).toBe(true);
      expect(tmpl.tasks.length).toBeGreaterThan(0);
    }
  });

  it('includes original 5 plus 3 new templates', () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id);
    expect(ids).toContain('sequential-pipeline');
    expect(ids).toContain('parallel-workers');
    expect(ids).toContain('feature-dev');
    expect(ids).toContain('bug-fix');
    expect(ids).toContain('full-cycle');
    expect(ids).toContain('code-review');
    expect(ids).toContain('refactor');
    expect(ids).toContain('spike-research');
  });
});

// ── validateTemplate ────────────────────────────────────────

describe('validateTemplate()', () => {
  it('accepts valid template', () => {
    const result = validateTemplate({
      id: 'my-tmpl',
      name: 'My Template',
      tasks: [{ id: 'a', task: 'Do something' }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-kebab-case id', () => {
    const result = validateTemplate({
      id: 'MyTemplate',
      name: 'Test',
      tasks: [{ id: 'a', task: 'Do it' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('kebab-case');
  });

  it('rejects missing name', () => {
    const result = validateTemplate({ id: 'test', tasks: [{ id: 'a', task: 'x' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects empty tasks', () => {
    const result = validateTemplate({ id: 'test', name: 'Test', tasks: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate task ids', () => {
    const result = validateTemplate({
      id: 'test',
      name: 'Test',
      tasks: [{ id: 'a', task: 'x' }, { id: 'a', task: 'y' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('duplicate');
  });

  it('rejects invalid dep reference', () => {
    const result = validateTemplate({
      id: 'test',
      name: 'Test',
      tasks: [{ id: 'a', task: 'x', deps: ['nonexistent'] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unknown task id');
  });
});

// ── Template Manager ────────────────────────────────────────

describe('createTemplateManager()', () => {
  it('list() returns all built-in templates', () => {
    const mgr = createTemplateManager({});
    const all = mgr.list();
    expect(all.length).toBe(8);
    expect(all.every(t => t.builtin === true)).toBe(true);
  });

  it('get() returns built-in by id', () => {
    const mgr = createTemplateManager({});
    const tmpl = mgr.get('bug-fix');
    expect(tmpl).not.toBeNull();
    expect(tmpl.name).toBe('Bug Fix');
  });

  it('get() returns null for unknown id', () => {
    const mgr = createTemplateManager({});
    expect(mgr.get('nonexistent')).toBeNull();
  });

  it('save() creates custom template', () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = mgr.save({
      id: 'my-custom',
      name: 'My Custom',
      description: 'A custom workflow',
      tasks: [{ id: 'step-1', task: 'Do the thing' }],
    });
    expect(result.ok).toBe(true);
    expect(result.template.builtin).toBe(false);
    expect(result.template.createdAt).toBeTruthy();
  });

  it('save() persists to disk', () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    mgr.save({
      id: 'disk-test',
      name: 'Disk Test',
      tasks: [{ id: 'a', task: 'Test' }],
    });
    expect(existsSync(PERSIST_PATH)).toBe(true);
    const data = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(data['disk-test']).toBeTruthy();
  });

  it('save() rejects builtin: true', () => {
    const mgr = createTemplateManager({});
    const result = mgr.save({
      id: 'test',
      name: 'Test',
      builtin: true,
      tasks: [{ id: 'a', task: 'x' }],
    });
    expect(result.ok).toBe(false);
  });

  it('save() rejects invalid template', () => {
    const mgr = createTemplateManager({});
    const result = mgr.save({ id: 'BadId', name: '', tasks: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('custom template overrides built-in with same id', () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    mgr.save({
      id: 'bug-fix',
      name: 'My Bug Fix',
      tasks: [{ id: 'quick-fix', task: 'Fix it fast' }],
    });
    const tmpl = mgr.get('bug-fix');
    expect(tmpl.name).toBe('My Bug Fix');
    expect(tmpl.builtin).toBe(false);
  });

  it('remove() deletes custom template', () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    mgr.save({ id: 'to-delete', name: 'Delete Me', tasks: [{ id: 'a', task: 'x' }] });
    const result = mgr.remove('to-delete');
    expect(result.ok).toBe(true);
    expect(mgr.get('to-delete')).toBeNull();
  });

  it('remove() cannot delete built-in', () => {
    const mgr = createTemplateManager({});
    const result = mgr.remove('bug-fix');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('built-in');
  });

  it('remove() returns error for unknown template', () => {
    const mgr = createTemplateManager({});
    const result = mgr.remove('nonexistent');
    expect(result.ok).toBe(false);
  });

  it('load() restores persisted templates', () => {
    const mgr1 = createTemplateManager({ persistPath: PERSIST_PATH });
    mgr1.save({ id: 'persisted', name: 'Persisted', tasks: [{ id: 'a', task: 'x' }] });

    const mgr2 = createTemplateManager({ persistPath: PERSIST_PATH });
    const tmpl = mgr2.get('persisted');
    expect(tmpl).not.toBeNull();
    expect(tmpl.name).toBe('Persisted');
  });

  it('emits template:saved event', () => {
    const emitted = [];
    const events = { emit: (name, data) => emitted.push({ name, data }) };
    const mgr = createTemplateManager({ events });
    mgr.save({ id: 'evt-test', name: 'Event Test', tasks: [{ id: 'a', task: 'x' }] });
    expect(emitted.length).toBe(1);
    expect(emitted[0].name).toBe('template:saved');
  });

  it('emits template:deleted event', () => {
    const emitted = [];
    const events = { emit: (name, data) => emitted.push({ name, data }) };
    const mgr = createTemplateManager({ events, persistPath: PERSIST_PATH });
    mgr.save({ id: 'del-evt', name: 'Del', tasks: [{ id: 'a', task: 'x' }] });
    mgr.remove('del-evt');
    expect(emitted.some(e => e.name === 'template:deleted')).toBe(true);
  });
});

// ── Template API Routes ─────────────────────────────────────

describe('GET /api/templates', () => {
  let server;
  afterEach(() => { if (server) { server.close(); server = null; } });

  it('returns all templates', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.length).toBe(8); // 8 built-in
  });

  it('returns 503 when template manager is null', async () => {
    const result = await startTestServer(null);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates`);
    expect(res.status).toBe(503);
  });
});

describe('GET /api/templates/:id', () => {
  let server;
  afterEach(() => { if (server) { server.close(); server = null; } });

  it('returns single template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/bug-fix`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Bug Fix');
  });

  it('returns 404 for unknown template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/templates', () => {
  let server;
  afterEach(() => { if (server) { server.close(); server = null; } });

  it('creates custom template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'api-test',
        name: 'API Test',
        description: 'Test template',
        tasks: [{ id: 'step-1', task: 'Do it' }],
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe('api-test');
    expect(body.builtin).toBe(false);
  });

  it('rejects invalid template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'BadId' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/templates/:id', () => {
  let server;
  afterEach(() => { if (server) { server.close(); server = null; } });

  it('updates custom template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    mgr.save({ id: 'update-me', name: 'Original', tasks: [{ id: 'a', task: 'x' }] });

    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/update-me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Updated',
        tasks: [{ id: 'a', task: 'y' }, { id: 'b', task: 'z' }],
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Updated');
    expect(body.tasks.length).toBe(2);
  });
});

describe('DELETE /api/templates/:id', () => {
  let server;
  afterEach(() => { if (server) { server.close(); server = null; } });

  it('deletes custom template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    mgr.save({ id: 'del-test', name: 'Delete Me', tasks: [{ id: 'a', task: 'x' }] });

    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/del-test`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const check = await fetch(`${result.baseUrl}/api/templates/del-test`);
    expect(check.status).toBe(404);
  });

  it('returns 403 for built-in template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/bug-fix`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/nonexistent`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/templates/:id/instantiate', () => {
  let server;
  afterEach(() => { if (server) { server.close(); server = null; } });

  it('returns 503 without coordinator', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr, null);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/bug-fix/instantiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
  });

  it('returns 404 for unknown template', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const result = await startTestServer(mgr, {});
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/nonexistent/instantiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('creates tasks from template with prefix', async () => {
    const mgr = createTemplateManager({ persistPath: PERSIST_PATH });
    const addedTasks = [];
    const mockCoordinator = {
      taskQueue: {
        addTask: (task) => { addedTasks.push(task); },
      },
    };
    const result = await startTestServer(mgr, mockCoordinator);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/templates/bug-fix/instantiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: 'sprint-1-' }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.template).toBe('bug-fix');
    expect(body.prefix).toBe('sprint-1-');
    expect(body.created).toBe(4); // bug-fix has 4 tasks
    expect(addedTasks[0].id).toBe('sprint-1-investigate');
    expect(addedTasks[1].deps).toContain('sprint-1-investigate');
  });
});
