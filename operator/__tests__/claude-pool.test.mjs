// Phase 15F — Claude Pool + Route Tests
// Tests for claude-pool.mjs and routes/claude-terminals.mjs
// Mocks claude-terminal.mjs entirely for pool isolation.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Fake terminal factory ──────────────────────────────────

function createFakeTerminal(id, pid = 100) {
  const listeners = { data: [], exit: [], error: [] };
  let status = 'running';
  let exitCode = null;
  let exitSignal = null;
  return {
    id,
    pid,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      // Auto-fire exit shortly after kill
      setTimeout(() => {
        status = 'stopped';
        exitCode = 0;
        for (const fn of listeners.exit) fn(0, null);
      }, 10);
    }),
    getStatus: () => ({
      id, pid, status,
      projectDir: '/tmp/pool-test',
      model: null,
      dangerouslySkipPermissions: false,
      resumeSessionId: null,
      continueSession: false,
      systemPrompt: null,
      cols: 120, rows: 30,
      spawnedAt: new Date().toISOString(),
      exitCode, exitSignal,
    }),
    on(event, handler) {
      if (listeners[event]) listeners[event].push(handler);
    },
    off(event, handler) {
      const list = listeners[event];
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    },
    _triggerExit(code = 0, signal = null) {
      status = 'stopped';
      exitCode = code;
      exitSignal = signal;
      for (const fn of listeners.exit) fn(code, signal);
    },
    _triggerData(data) {
      for (const fn of listeners.data) fn(data);
    },
    _triggerError(err) {
      for (const fn of listeners.error) fn(err);
    },
  };
}

// ── Mock claude-terminal.mjs ───────────────────────────────

vi.mock('../claude-terminal.mjs', () => ({
  createClaudeTerminal: vi.fn(),
  isNodePtyAvailable: vi.fn().mockResolvedValue(true),
}));

const { createClaudePool, MAX_TERMINALS } = await import('../claude-pool.mjs');
const claudeTermMock = await import('../claude-terminal.mjs');

// ============================================================
// claude-pool.mjs — Pool Management
// ============================================================

describe('createClaudePool', () => {
  let events;
  let pool;
  let pidCounter;

  beforeEach(() => {
    events = new EventBus();
    pidCounter = 100;
    claudeTermMock.createClaudeTerminal.mockImplementation(async (opts) => {
      return createFakeTerminal(opts.id, pidCounter++);
    });
    claudeTermMock.isNodePtyAvailable.mockResolvedValue(true);
    pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
  });

  afterEach(async () => {
    if (pool) await pool.shutdownAll();
    vi.clearAllMocks();
  });

  // ── spawn ──────────────────────────────────────────

  describe('spawn', () => {
    it('spawns a terminal and returns info', async () => {
      const result = await pool.spawn('t1');
      expect(result.id).toBe('t1');
      expect(result.pid).toBe(100);
      expect(result.status).toBe('running');
    });

    it('emits claude-terminal:spawned event', async () => {
      const spawned = [];
      events.on('claude-terminal:spawned', (d) => spawned.push(d));
      await pool.spawn('t1');
      expect(spawned.length).toBe(1);
      expect(spawned[0].terminalId).toBe('t1');
      expect(spawned[0].pid).toBe(100);
    });

    it('throws on duplicate running terminal', async () => {
      await pool.spawn('t1');
      await expect(pool.spawn('t1')).rejects.toThrow('already running');
    });

    it('cleans up dead entry and allows re-spawn', async () => {
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerExit(0);
      const result = await pool.spawn('t1');
      expect(result.id).toBe('t1');
      expect(result.pid).toBe(101);
    });

    it('throws when max terminals reached', async () => {
      const smallPool = createClaudePool({
        events,
        projectDir: '/tmp/pool-test',
        log: () => {},
        maxTerminals: 2,
      });
      await smallPool.spawn('t1');
      await smallPool.spawn('t2');
      await expect(smallPool.spawn('t3')).rejects.toThrow('Maximum terminals');
      await smallPool.shutdownAll();
    });

    it('throws when node-pty is not available', async () => {
      claudeTermMock.isNodePtyAvailable.mockResolvedValue(false);
      await expect(pool.spawn('t1')).rejects.toThrow('node-pty is not available');
    });

    it('passes options to createClaudeTerminal', async () => {
      await pool.spawn('t1', { model: 'opus', dangerouslySkipPermissions: true });
      expect(claudeTermMock.createClaudeTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 't1',
          model: 'opus',
          dangerouslySkipPermissions: true,
          projectDir: '/tmp/pool-test',
        })
      );
    });

    it('overrides projectDir from opts', async () => {
      await pool.spawn('t1', { projectDir: '/custom/dir' });
      expect(claudeTermMock.createClaudeTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ projectDir: '/custom/dir' })
      );
    });
  });

  // ── write ──────────────────────────────────────────

  describe('write', () => {
    it('writes to a running terminal', async () => {
      await pool.spawn('t1');
      const ok = pool.write('t1', 'hello');
      expect(ok).toBe(true);
      expect(pool.getTerminalHandle('t1').write).toHaveBeenCalledWith('hello');
    });

    it('returns false for nonexistent terminal', () => {
      expect(pool.write('nope', 'hi')).toBe(false);
    });

    it('returns false for stopped terminal', async () => {
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerExit(0);
      expect(pool.write('t1', 'hi')).toBe(false);
    });
  });

  // ── resize ─────────────────────────────────────────

  describe('resize', () => {
    it('resizes a running terminal', async () => {
      await pool.spawn('t1');
      expect(pool.resize('t1', 80, 24)).toBe(true);
      expect(pool.getTerminalHandle('t1').resize).toHaveBeenCalledWith(80, 24);
    });

    it('returns false for nonexistent terminal', () => {
      expect(pool.resize('nope', 80, 24)).toBe(false);
    });
  });

  // ── kill ───────────────────────────────────────────

  describe('kill', () => {
    it('kills a running terminal', async () => {
      await pool.spawn('t1');
      expect(pool.kill('t1')).toBe(true);
      expect(pool.getTerminalHandle('t1').kill).toHaveBeenCalled();
    });

    it('returns false for nonexistent terminal', () => {
      expect(pool.kill('nope')).toBe(false);
    });

    it('returns false for stopped terminal', async () => {
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerExit(0);
      expect(pool.kill('t1')).toBe(false);
    });
  });

  // ── remove ─────────────────────────────────────────

  describe('remove', () => {
    it('removes a stopped terminal', async () => {
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerExit(0);
      expect(pool.remove('t1')).toBe(true);
      expect(pool.getTerminal('t1')).toBeNull();
    });

    it('emits claude-terminal:removed event', async () => {
      const removed = [];
      events.on('claude-terminal:removed', (d) => removed.push(d));
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerExit(0);
      pool.remove('t1');
      expect(removed.length).toBe(1);
      expect(removed[0].terminalId).toBe('t1');
    });

    it('returns false for nonexistent terminal', () => {
      expect(pool.remove('nope')).toBe(false);
    });

    it('throws when removing a running terminal', async () => {
      await pool.spawn('t1');
      expect(() => pool.remove('t1')).toThrow('while running');
    });
  });

  // ── respawn ────────────────────────────────────────

  describe('respawn', () => {
    it('respawns a terminal with merged options', async () => {
      await pool.spawn('t1', { model: 'sonnet' });
      const result = await pool.respawn('t1', { model: 'opus' });
      expect(result.id).toBe('t1');
      expect(result.status).toBe('running');
      const lastCall = claudeTermMock.createClaudeTerminal.mock.calls.at(-1)[0];
      expect(lastCall.model).toBe('opus');
    });

    it('throws for nonexistent terminal', async () => {
      await expect(pool.respawn('nope')).rejects.toThrow('not found');
    });
  });

  // ── status methods ─────────────────────────────────

  describe('status methods', () => {
    it('getStatus returns all terminals', async () => {
      await pool.spawn('t1');
      await pool.spawn('t2');
      const status = pool.getStatus();
      expect(status).toHaveLength(2);
      expect(status.map(s => s.id).sort()).toEqual(['t1', 't2']);
    });

    it('getTerminal returns formatted entry', async () => {
      await pool.spawn('t1');
      const t = pool.getTerminal('t1');
      expect(t.id).toBe('t1');
      expect(t.status).toBe('running');
      expect(t.pid).toBe(100);
    });

    it('getTerminal returns null for nonexistent', () => {
      expect(pool.getTerminal('nope')).toBeNull();
    });

    it('getTerminalHandle returns raw terminal object', async () => {
      await pool.spawn('t1');
      const handle = pool.getTerminalHandle('t1');
      expect(handle).toBeTruthy();
      expect(typeof handle.write).toBe('function');
      expect(typeof handle.kill).toBe('function');
    });

    it('getTerminalHandle returns null for nonexistent', () => {
      expect(pool.getTerminalHandle('nope')).toBeNull();
    });
  });

  // ── activeCount ────────────────────────────────────

  describe('activeCount', () => {
    it('counts running terminals', async () => {
      expect(pool.activeCount()).toBe(0);
      await pool.spawn('t1');
      expect(pool.activeCount()).toBe(1);
      await pool.spawn('t2');
      expect(pool.activeCount()).toBe(2);
    });

    it('decrements on exit', async () => {
      await pool.spawn('t1');
      await pool.spawn('t2');
      pool.getTerminalHandle('t1')._triggerExit(0);
      expect(pool.activeCount()).toBe(1);
    });
  });

  // ── event forwarding ──────────────────────────────

  describe('event forwarding', () => {
    it('forwards data events to EventBus', async () => {
      const data = [];
      events.on('claude-terminal:data', (d) => data.push(d));
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerData('hello');
      expect(data.length).toBe(1);
      expect(data[0].terminalId).toBe('t1');
      expect(data[0].data).toBe('hello');
    });

    it('forwards exit events to EventBus', async () => {
      const exits = [];
      events.on('claude-terminal:exit', (d) => exits.push(d));
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerExit(1, 'SIGTERM');
      expect(exits.length).toBe(1);
      expect(exits[0].terminalId).toBe('t1');
      expect(exits[0].exitCode).toBe(1);
      expect(exits[0].signal).toBe('SIGTERM');
    });

    it('forwards error events to EventBus', async () => {
      const errors = [];
      events.on('claude-terminal:error', (d) => errors.push(d));
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerError(new Error('boom'));
      expect(errors.length).toBe(1);
      expect(errors[0].terminalId).toBe('t1');
      expect(errors[0].error).toBe('boom');
    });
  });

  // ── shutdownAll ────────────────────────────────────

  describe('shutdownAll', () => {
    it('kills all running terminals', async () => {
      await pool.spawn('t1');
      await pool.spawn('t2');
      const h1 = pool.getTerminalHandle('t1');
      const h2 = pool.getTerminalHandle('t2');
      await pool.shutdownAll();
      expect(h1.kill).toHaveBeenCalled();
      expect(h2.kill).toHaveBeenCalled();
    });

    it('is safe to call with no terminals', async () => {
      await pool.shutdownAll(); // should not throw
    });

    it('skips already stopped terminals', async () => {
      await pool.spawn('t1');
      const h1 = pool.getTerminalHandle('t1');
      h1._triggerExit(0);
      h1.kill.mockClear();
      await pool.shutdownAll();
      expect(h1.kill).not.toHaveBeenCalled();
    });
  });

  // ── MAX_TERMINALS export ──────────────────────────

  it('exports MAX_TERMINALS constant', () => {
    expect(MAX_TERMINALS).toBe(8);
  });
});

// ============================================================
// routes/claude-terminals.mjs — REST API
// ============================================================

import { createApp } from '../server.mjs';
import { createRegistry } from '../registry.mjs';

const ROUTE_TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_claude_routes');

function setupRouteDir() {
  if (existsSync(ROUTE_TEST_DIR)) rmSync(ROUTE_TEST_DIR, { recursive: true });
  mkdirSync(ROUTE_TEST_DIR, { recursive: true });
  const regStore = createRegistry({ operatorDir: ROUTE_TEST_DIR });
  regStore.save(regStore.load());
}

function teardownRouteDir() {
  if (existsSync(ROUTE_TEST_DIR)) rmSync(ROUTE_TEST_DIR, { recursive: true });
}

function createMockClaudePool() {
  const terminals = new Map();
  let spawnCount = 0;

  return {
    getStatus: () => [...terminals.values()],
    getTerminal: (id) => terminals.get(id) || null,
    getTerminalHandle: (id) => terminals.has(id) ? { write: vi.fn() } : null,
    spawn: vi.fn(async (id, opts = {}) => {
      spawnCount++;
      const entry = {
        id,
        pid: 10000 + spawnCount,
        status: 'running',
        config: opts,
        projectDir: opts.projectDir || '/tmp/test',
        model: opts.model || null,
        dangerouslySkipPermissions: !!opts.dangerouslySkipPermissions,
        cols: opts.cols || 120,
        rows: opts.rows || 30,
        spawnedAt: new Date().toISOString(),
        stoppedAt: null,
        exitCode: null,
        exitSignal: null,
      };
      terminals.set(id, entry);
      return { id, pid: entry.pid, status: 'running' };
    }),
    write: vi.fn((id) => terminals.has(id)),
    resize: vi.fn((id) => terminals.has(id)),
    kill: vi.fn((id) => {
      const t = terminals.get(id);
      if (t) { t.status = 'stopped'; return true; }
      return false;
    }),
    remove: vi.fn((id) => {
      if (!terminals.has(id)) return false;
      terminals.delete(id);
      return true;
    }),
    respawn: vi.fn(async (id, opts = {}) => {
      const old = terminals.get(id);
      if (!old) throw new Error(`Terminal ${id} not found`);
      const merged = { ...old.config, ...opts };
      spawnCount++;
      const entry = {
        ...old,
        pid: 10000 + spawnCount,
        status: 'running',
        config: merged,
        dangerouslySkipPermissions: merged.dangerouslySkipPermissions ?? old.dangerouslySkipPermissions,
      };
      terminals.set(id, entry);
      return { id, pid: entry.pid, status: 'running' };
    }),
    activeCount: () => [...terminals.values()].filter(t => t.status === 'running').length,
    shutdownAll: vi.fn(async () => {}),
    _terminals: terminals,
  };
}

describe('Claude Terminal Routes (Phase 15C)', () => {
  let appInstance, baseUrl, routeEvents;

  beforeAll(() => {
    setupRouteDir();
  });

  afterAll(async () => {
    if (appInstance) await appInstance.close();
    teardownRouteDir();
  });

  async function startWithPool(mockPool) {
    if (appInstance) await appInstance.close();
    routeEvents = new EventBus();
    appInstance = createApp({
      operatorDir: ROUTE_TEST_DIR,
      events: routeEvents,
      claudePool: mockPool || undefined,
      coordination: false,
    });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  }

  async function api(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  // ── No pool ──────────────────────────────────────

  describe('without claudePool', () => {
    beforeAll(async () => {
      await startWithPool(null);
    });

    it('GET /api/claude-terminals returns empty list', async () => {
      const { status, body } = await api('/api/claude-terminals');
      expect(status).toBe(200);
      expect(body.terminals).toEqual([]);
      expect(body.available).toBe(false);
    });

    it('GET /api/claude-terminals/:id returns 503', async () => {
      const { status } = await api('/api/claude-terminals/test-1');
      expect(status).toBe(503);
    });

    it('POST /api/claude-terminals returns 503', async () => {
      const { status } = await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'test-1' },
      });
      expect(status).toBe(503);
    });

    it('POST resize returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/resize', {
        method: 'POST',
        body: { cols: 80, rows: 24 },
      });
      expect(status).toBe(503);
    });

    it('POST toggle-permissions returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/toggle-permissions', {
        method: 'POST',
      });
      expect(status).toBe(503);
    });

    it('POST respawn returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/respawn', {
        method: 'POST',
        body: {},
      });
      expect(status).toBe(503);
    });

    it('DELETE returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x', {
        method: 'DELETE',
      });
      expect(status).toBe(503);
    });
  });

  // ── With pool ────────────────────────────────────

  describe('with claudePool', () => {
    let mockPool;

    beforeAll(async () => {
      mockPool = createMockClaudePool();
      await startWithPool(mockPool);
    });

    // ── GET list ─────────────────────────────────

    it('GET /api/claude-terminals returns terminal list', async () => {
      const { status, body } = await api('/api/claude-terminals');
      expect(status).toBe(200);
      expect(body.available).toBe(true);
      expect(Array.isArray(body.terminals)).toBe(true);
    });

    // ── GET available ────────────────────────────

    it('GET /api/claude-terminals/available shows availability', async () => {
      const { status, body } = await api('/api/claude-terminals/available');
      expect(status).toBe(200);
      expect(body.hasPool).toBe(true);
      expect(typeof body.available).toBe('boolean');
    });

    // ── POST create ──────────────────────────────

    it('POST /api/claude-terminals creates a terminal', async () => {
      const { status, body } = await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'rt1', model: 'opus' },
      });
      expect(status).toBe(201);
      expect(body.id).toBe('rt1');
      expect(body.status).toBe('running');
      expect(mockPool.spawn).toHaveBeenCalled();
    });

    it('POST rejects missing id', async () => {
      const { status, body } = await api('/api/claude-terminals', {
        method: 'POST',
        body: {},
      });
      expect(status).toBe(400);
      expect(body.error).toContain('id is required');
    });

    it('POST rejects invalid id chars', async () => {
      const { status, body } = await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'bad id!' },
      });
      expect(status).toBe(400);
      expect(body.error).toContain('must match');
    });

    it('POST accepts valid id with dashes and underscores', async () => {
      const { status } = await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'my-term_01' },
      });
      expect(status).toBe(201);
    });

    // ── GET single ───────────────────────────────

    it('GET /api/claude-terminals/:id returns terminal', async () => {
      const { status, body } = await api('/api/claude-terminals/rt1');
      expect(status).toBe(200);
      expect(body.id).toBe('rt1');
    });

    it('GET /api/claude-terminals/:id returns 404 for unknown', async () => {
      const { status } = await api('/api/claude-terminals/nonexistent');
      expect(status).toBe(404);
    });

    // ── POST resize ──────────────────────────────

    it('POST resize resizes terminal', async () => {
      const { status, body } = await api('/api/claude-terminals/rt1/resize', {
        method: 'POST',
        body: { cols: 80, rows: 24 },
      });
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(mockPool.resize).toHaveBeenCalledWith('rt1', 80, 24);
    });

    it('POST resize rejects invalid dimensions', async () => {
      const { status, body } = await api('/api/claude-terminals/rt1/resize', {
        method: 'POST',
        body: { cols: 0, rows: 24 },
      });
      expect(status).toBe(400);
      expect(body.error).toContain('positive integers');
    });

    it('POST resize rejects missing dimensions', async () => {
      const { status } = await api('/api/claude-terminals/rt1/resize', {
        method: 'POST',
        body: {},
      });
      expect(status).toBe(400);
    });

    // ── POST toggle-permissions ──────────────────

    it('POST toggle-permissions toggles and respawns', async () => {
      const permEvents = [];
      routeEvents.on('claude-terminal:permission-changed', (d) => permEvents.push(d));

      const { status, body } = await api('/api/claude-terminals/rt1/toggle-permissions', {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(typeof body.dangerouslySkipPermissions).toBe('boolean');
      expect(mockPool.respawn).toHaveBeenCalled();
      expect(permEvents.length).toBe(1);
      expect(permEvents[0].terminalId).toBe('rt1');
    });

    it('POST toggle-permissions returns 404 for unknown', async () => {
      const { status } = await api('/api/claude-terminals/nonexistent/toggle-permissions', {
        method: 'POST',
      });
      expect(status).toBe(404);
    });

    // ── POST respawn ─────────────────────────────

    it('POST respawn respawns terminal', async () => {
      const respawnEvents = [];
      routeEvents.on('claude-terminal:respawned', (d) => respawnEvents.push(d));

      const { status, body } = await api('/api/claude-terminals/rt1/respawn', {
        method: 'POST',
        body: { model: 'haiku' },
      });
      expect(status).toBe(200);
      expect(body.id).toBe('rt1');
      expect(respawnEvents.length).toBe(1);
    });

    it('POST respawn returns 400 for unknown terminal', async () => {
      const { status } = await api('/api/claude-terminals/nonexistent/respawn', {
        method: 'POST',
        body: {},
      });
      expect(status).toBe(400);
    });

    // ── DELETE ────────────────────────────────────

    it('DELETE kills and schedules remove', async () => {
      await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'to-delete' },
      });

      const { status, body } = await api('/api/claude-terminals/to-delete', {
        method: 'DELETE',
      });
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.terminalId).toBe('to-delete');
    });

    it('DELETE returns 404 for unknown', async () => {
      const { status } = await api('/api/claude-terminals/ghost', {
        method: 'DELETE',
      });
      expect(status).toBe(404);
    });
  });
});
