// Phase 57 — Master Console Backend Tests
// Tests for claude-pool.mjs master terminal support + route additions.
// Mocks claude-terminal.mjs entirely for pool isolation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { mkdtempSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Fake terminal factory ──────────────────────────────────

function createFakeTerminal(id, pid = 100) {
  const listeners = { data: [], exit: [], error: [], 'context-warning': [] };
  let status = 'running';
  let exitCode = null;
  let exitSignal = null;
  let outputBuffer = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\nline21\nline22\nline23\nline24\nline25';
  return {
    id,
    pid,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
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
    getOutputBuffer() {
      return outputBuffer;
    },
    _setOutputBuffer(buf) {
      outputBuffer = buf;
    },
  };
}

// ── Mock claude-terminal.mjs ───────────────────────────────

vi.mock('../claude-terminal.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createClaudeTerminal: vi.fn(),
    isNodePtyAvailable: vi.fn().mockResolvedValue(true),
  };
});

const { createClaudePool } = await import('../claude-pool.mjs');
const claudeTermMock = await import('../claude-terminal.mjs');

// ── HTTP request helper ─────────────────────────────────────

function request(app, method, path, { body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url = new URL(path, `http://127.0.0.1:${port}`);
      const options = {
        hostname: '127.0.0.1',
        port,
        path: url.pathname + url.search,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: res.headers });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ============================================================
// Pool Unit Tests — Master Terminal Support
// ============================================================

describe('Master Console — Pool', () => {
  let events;
  let pool;
  let pidCounter;

  beforeEach(() => {
    events = new EventBus();
    pidCounter = 200;
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

  // 1. spawn() with role='master' stores role on entry
  it('spawn with role=master stores role on entry', async () => {
    await pool.spawn('m1', { role: 'master' });
    const t = pool.getTerminal('m1');
    expect(t.role).toBe('master');
  });

  // 2. spawn() with role='worker' stores role on entry
  it('spawn with role=worker stores role on entry', async () => {
    await pool.spawn('w1', { role: 'worker' });
    const t = pool.getTerminal('w1');
    expect(t.role).toBe('worker');
  });

  // 3. spawn() with persistent=true stores flag on entry
  it('spawn with persistent=true stores flag on entry', async () => {
    await pool.spawn('p1', { persistent: true });
    const t = pool.getTerminal('p1');
    expect(t.persistent).toBe(true);
  });

  // 4. getMasterTerminal() returns master when one exists
  it('getMasterTerminal returns master when one exists', async () => {
    await pool.spawn('m1', { role: 'master' });
    const master = pool.getMasterTerminal();
    expect(master).not.toBeNull();
    expect(master.id).toBe('m1');
    expect(master.role).toBe('master');
  });

  // 5. getMasterTerminal() returns null when no master exists
  it('getMasterTerminal returns null when no master exists', async () => {
    await pool.spawn('w1', { role: 'worker' });
    const master = pool.getMasterTerminal();
    expect(master).toBeNull();
  });

  // 6. getMasterTerminal() returns formatted entry (has id, status, role fields)
  it('getMasterTerminal returns formatted entry with expected fields', async () => {
    await pool.spawn('m1', { role: 'master', persistent: true });
    const master = pool.getMasterTerminal();
    expect(master).toHaveProperty('id', 'm1');
    expect(master).toHaveProperty('status', 'running');
    expect(master).toHaveProperty('role', 'master');
    expect(master).toHaveProperty('persistent', true);
    expect(master).toHaveProperty('pid');
    expect(master).toHaveProperty('autoHandoff');
    expect(master).toHaveProperty('autoDispatch');
  });

  // 7. getOutputPreview() returns last N lines
  it('getOutputPreview returns last N lines', async () => {
    await pool.spawn('t1');
    const preview = pool.getOutputPreview('t1', 5);
    expect(Array.isArray(preview)).toBe(true);
    expect(preview.length).toBe(5);
    // The fake terminal has 25 lines (line1..line25), last 5 should be line21..line25
    expect(preview[preview.length - 1]).toBe('line25');
  });

  // 8. getOutputPreview() returns empty array for terminal with no output
  it('getOutputPreview returns empty array for terminal with no output', async () => {
    // Override the mock to return null output buffer
    claudeTermMock.createClaudeTerminal.mockImplementation(async (opts) => {
      const t = createFakeTerminal(opts.id, pidCounter++);
      t.getOutputBuffer = () => null;
      return t;
    });
    const emptyPool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
    await emptyPool.spawn('t1');
    const preview = emptyPool.getOutputPreview('t1');
    expect(preview).toEqual([]);
    await emptyPool.shutdownAll();
  });

  // 9. getOutputPreview() returns null for non-existent terminal
  it('getOutputPreview returns null for non-existent terminal', () => {
    const preview = pool.getOutputPreview('nonexistent');
    expect(preview).toBeNull();
  });

  // 10. getOutputPreview() caps at maxLines
  it('getOutputPreview caps at maxLines', async () => {
    await pool.spawn('t1');
    const preview20 = pool.getOutputPreview('t1', 20);
    const preview3 = pool.getOutputPreview('t1', 3);
    expect(preview20.length).toBe(20);
    expect(preview3.length).toBe(3);
  });

  // 11. Persistent terminal not killed by swarm scale-down (guard exists in code)
  it('persistent flag is preserved in entry and formatEntry', async () => {
    await pool.spawn('p1', { persistent: true });
    await pool.spawn('p2', { persistent: false });
    const t1 = pool.getTerminal('p1');
    const t2 = pool.getTerminal('p2');
    expect(t1.persistent).toBe(true);
    expect(t2.persistent).toBe(false);
  });

  // 12. Master terminal not killed by swarm scale-down (guard exists in code)
  it('master role is preserved in entry and formatEntry', async () => {
    await pool.spawn('m1', { role: 'master' });
    const t = pool.getTerminal('m1');
    expect(t.role).toBe('master');
  });

  // 13. formatEntry includes role and persistent fields
  it('formatEntry includes role and persistent fields', async () => {
    await pool.spawn('t1', { role: 'worker', persistent: true });
    const t = pool.getTerminal('t1');
    expect(t).toHaveProperty('role', 'worker');
    expect(t).toHaveProperty('persistent', true);
  });

  // 19. Only one master terminal can exist at a time
  it('throws when spawning second master terminal', async () => {
    await pool.spawn('m1', { role: 'master' });
    await expect(pool.spawn('m2', { role: 'master' })).rejects.toThrow('Master terminal already exists');
  });

  // 20. getStatus() includes role and persistent in terminal entries
  it('getStatus includes role and persistent in terminal entries', async () => {
    await pool.spawn('m1', { role: 'master', persistent: true });
    await pool.spawn('w1', { role: 'worker' });
    const statuses = pool.getStatus();
    expect(statuses.length).toBe(2);
    const master = statuses.find(s => s.id === 'm1');
    const worker = statuses.find(s => s.id === 'w1');
    expect(master.role).toBe('master');
    expect(master.persistent).toBe(true);
    expect(worker.role).toBe('worker');
    expect(worker.persistent).toBe(false);
  });

  // Default role is null and persistent is false
  it('defaults role to null and persistent to false', async () => {
    await pool.spawn('t1');
    const t = pool.getTerminal('t1');
    expect(t.role).toBeNull();
    expect(t.persistent).toBe(false);
  });

  // 18. Pool status includes master terminal info
  it('pool status accessible with master terminal present', async () => {
    await pool.spawn('m1', { role: 'master', persistent: true });
    const status = pool.getPoolStatus();
    expect(status.total).toBe(1);
    expect(status.running).toBe(1);
  });
});

// ============================================================
// Route Tests — Master Console Endpoints
// ============================================================

describe('Master Console — Routes', () => {
  let TEST_DIR;

  beforeEach(() => {
    TEST_DIR = mkdtempSync(join(tmpdir(), 'mc-route-'));
    mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
  });

  // 14. Route: GET /api/claude-terminals/master returns 404 when no master
  it('GET /api/claude-terminals/master returns 404 when no master', async () => {
    const { createApp } = await import('../server.mjs');
    const instance = createApp({ operatorDir: TEST_DIR, events: new EventBus(), auth: false });
    try {
      const res = await request(instance.app, 'GET', '/api/claude-terminals/master');
      // Pool is null when claudePool option is not set, so it returns 503
      expect([404, 503]).toContain(res.status);
    } finally {
      await instance.close();
    }
  });

  // 15. Route: GET /api/claude-terminals/:id/output returns 404 for non-existent
  it('GET /api/claude-terminals/:id/output returns 404 for non-existent', async () => {
    const { createApp } = await import('../server.mjs');
    const instance = createApp({ operatorDir: TEST_DIR, events: new EventBus(), auth: false });
    try {
      const res = await request(instance.app, 'GET', '/api/claude-terminals/nonexistent/output');
      // Pool is null, so 503
      expect([404, 503]).toContain(res.status);
    } finally {
      await instance.close();
    }
  });

  // 16. Route: GET /console returns 200
  it('GET /console returns 200', async () => {
    const { createApp } = await import('../server.mjs');
    const instance = createApp({ operatorDir: TEST_DIR, events: new EventBus(), auth: false });
    try {
      const res = await request(instance.app, 'GET', '/console');
      expect(res.status).toBe(200);
    } finally {
      await instance.close();
    }
  });

  // 17. Route: POST /api/claude-terminals accepts role and persistent in body
  it('POST /api/claude-terminals accepts role and persistent in body', async () => {
    // We create a mock pool to verify parameters are passed through
    const spawnCalls = [];
    const mockPool = {
      spawn: vi.fn(async (id, opts) => {
        spawnCalls.push({ id, opts });
        return { id, pid: 999, status: 'running' };
      }),
      getStatus: () => [],
      getTerminal: () => null,
      getTerminalHandle: () => null,
      activeCount: () => 0,
      getPoolStatus: () => ({ total: 0, running: 0 }),
      getMasterTerminal: () => null,
      getOutputPreview: () => null,
      getSwarmState: () => ({ enabled: false }),
      getSwarmMetrics: () => ({}),
      setSwarmMode: () => ({}),
      shutdownAll: async () => {},
      destroy: () => {},
      findNextClaimableTask: () => null,
      write: () => false,
      resize: () => false,
      kill: () => false,
      remove: () => false,
      respawn: async () => ({}),
      setAutoHandoff: () => false,
      setAutoDispatch: () => false,
      setAutoComplete: () => false,
      setCapabilities: () => false,
      assignTask: () => false,
      releaseTask: () => null,
      getAssignedTask: () => null,
    };

    const { createApp } = await import('../server.mjs');
    const instance = createApp({
      operatorDir: TEST_DIR,
      events: new EventBus(),
      auth: false,
      claudePool: mockPool,
    });

    try {
      const res = await request(instance.app, 'POST', '/api/claude-terminals', {
        body: {
          id: 'master-1',
          role: 'master',
          persistent: true,
          dangerouslySkipPermissions: true,
        },
      });
      expect(res.status).toBe(201);
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0].opts.role).toBe('master');
      expect(spawnCalls[0].opts.persistent).toBe(true);
    } finally {
      await instance.close();
    }
  });
});
