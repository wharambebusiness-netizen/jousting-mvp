// Process Pool + Multi-Instance Orchestrator Tests (Phase 1)
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createProcessPool } from '../process-pool.mjs';
import { createApp } from '../server.mjs';
import {
  createRegistry,
  createChain,
} from '../registry.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_pool');
const TEST_DIR_POOL = join(import.meta.dirname, '..', '__test_tmp_pool_unit');
const TEST_DIR_INTEG = join(import.meta.dirname, '..', '__test_tmp_pool_integ');

function setupDir(dir) {
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {}
  mkdirSync(dir, { recursive: true });
}

function teardownDir(dir) {
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {}
}

function setupTestDir() { setupDir(TEST_DIR); }
function teardownTestDir() { teardownDir(TEST_DIR); }

function seedRegistry() {
  seedRegistryAt(TEST_DIR);
}

function seedRegistryAt(dir) {
  const regStore = createRegistry({ operatorDir: dir });
  const reg = regStore.load();
  createChain(reg, {
    task: 'pool test chain',
    config: { model: 'sonnet' },
    projectDir: '/projects/test',
  });
  regStore.save(reg);
}

// ── Server Test Helpers ─────────────────────────────────────

let appInstance, baseUrl, events;

function startServer(extraOpts = {}) {
  events = extraOpts.events || new EventBus();
  appInstance = createApp({
    operatorDir: extraOpts.operatorDir || TEST_DIR,
    events,
    enableFileWatcher: false,
    ...extraOpts,
  });
  return new Promise((resolve) => {
    appInstance.server.listen(0, '127.0.0.1', () => {
      const port = appInstance.server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve({ port });
    });
  });
}

async function stopServer() {
  if (appInstance) {
    await appInstance.close();
    appInstance = null;
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ══════════════════════════════════════════════════════════════
// Process Pool Unit Tests
// ══════════════════════════════════════════════════════════════

describe('ProcessPool — Unit', () => {
  let pool, poolEvents;

  // Use a dummy worker script that just stays alive and responds to IPC
  const dummyWorkerPath = join(TEST_DIR_POOL, 'dummy-worker.mjs');

  beforeAll(() => {
    setupDir(TEST_DIR_POOL);
    // Create a minimal worker script for testing
    writeFileSync(dummyWorkerPath, `
      process.on('message', (msg) => {
        if (msg.type === 'init') {
          process.send({ type: 'ready' });
        } else if (msg.type === 'ping') {
          process.send({ type: 'pong' });
        } else if (msg.type === 'shutdown') {
          process.exit(0);
        } else if (msg.type === 'start') {
          process.send({ type: 'event', event: 'orchestrator:started', data: { workerId: msg.workerId || process.env.WORKER_ID } });
        }
      });
    `);
  });

  afterAll(() => {
    teardownDir(TEST_DIR_POOL);
  });

  beforeEach(() => {
    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_POOL,
      workerScript: dummyWorkerPath,
      log: () => {},
    });
  });

  afterEach(async () => {
    await pool.shutdownAll();
  });

  it('spawns a worker process', () => {
    const result = pool.spawn('w1', { model: 'sonnet' });
    expect(result.id).toBe('w1');
    expect(result.pid).toBeGreaterThan(0);
    expect(result.status).toBe('starting');
  });

  it('getStatus returns all workers', () => {
    pool.spawn('w1', { model: 'sonnet' });
    pool.spawn('w2', { model: 'opus' });

    const status = pool.getStatus();
    expect(status).toHaveLength(2);
    expect(status[0].id).toBe('w1');
    expect(status[1].id).toBe('w2');
    expect(status[0].config.model).toBe('sonnet');
    expect(status[1].config.model).toBe('opus');
  });

  it('getWorker returns single worker status', () => {
    pool.spawn('w1', { model: 'haiku' });
    const w = pool.getWorker('w1');
    expect(w).not.toBeNull();
    expect(w.id).toBe('w1');
    expect(w.config.model).toBe('haiku');
  });

  it('getWorker returns null for unknown worker', () => {
    expect(pool.getWorker('nonexistent')).toBeNull();
  });

  it('throws when spawning duplicate running worker', () => {
    pool.spawn('w1', {});
    expect(() => pool.spawn('w1', {})).toThrow('already running');
  });

  it('allows re-spawn after worker exits', async () => {
    pool.spawn('w1', {});
    pool.kill('w1');

    // Wait for exit
    await new Promise(r => setTimeout(r, 500));

    // Should allow re-spawn now
    const result = pool.spawn('w1', { model: 'opus' });
    expect(result.id).toBe('w1');
  });

  it('kill returns false for unknown worker', () => {
    expect(pool.kill('nonexistent')).toBe(false);
  });

  it('kill returns true for running worker', () => {
    pool.spawn('w1', {});
    expect(pool.kill('w1')).toBe(true);
  });

  it('sendTo returns false for unknown worker', () => {
    expect(pool.sendTo('nonexistent', { type: 'ping' })).toBe(false);
  });

  it('sendTo delivers message to worker', () => {
    pool.spawn('w1', {});
    expect(pool.sendTo('w1', { type: 'ping' })).toBe(true);
  });

  it('receives ready message from worker', async () => {
    const readyPromise = new Promise(resolve => {
      poolEvents.on('worker:ready', resolve);
    });
    pool.spawn('w1', {});
    const data = await readyPromise;
    expect(data.workerId).toBe('w1');
  });

  it('receives IPC events from worker', async () => {
    const eventPromise = new Promise(resolve => {
      poolEvents.on('orchestrator:started', resolve);
    });
    pool.spawn('w1', {});

    // Wait for ready, then send start
    await new Promise(resolve => {
      poolEvents.on('worker:ready', resolve);
    });

    pool.sendTo('w1', { type: 'start', workerId: 'w1' });
    const data = await eventPromise;
    expect(data.workerId).toBe('w1');
  });

  it('emits worker:exit on worker exit', async () => {
    const exitPromise = new Promise(resolve => {
      poolEvents.on('worker:exit', resolve);
    });
    pool.spawn('w1', {});
    pool.kill('w1');
    const data = await exitPromise;
    expect(data.workerId).toBe('w1');
  });

  it('activeCount tracks running workers', async () => {
    expect(pool.activeCount()).toBe(0);

    pool.spawn('w1', {});
    pool.spawn('w2', {});
    expect(pool.activeCount()).toBe(2);

    pool.kill('w1');
    await new Promise(r => setTimeout(r, 500));
    expect(pool.activeCount()).toBe(1);
  });

  it('remove throws for running worker', () => {
    pool.spawn('w1', {});
    expect(() => pool.remove('w1')).toThrow('Cannot remove');
  });

  it('remove succeeds for stopped worker', async () => {
    pool.spawn('w1', {});
    pool.kill('w1');
    await new Promise(r => setTimeout(r, 500));
    expect(pool.remove('w1')).toBe(true);
    expect(pool.getWorker('w1')).toBeNull();
  });

  it('shutdownAll stops all workers', async () => {
    pool.spawn('w1', {});
    pool.spawn('w2', {});

    await pool.shutdownAll();
    expect(pool.activeCount()).toBe(0);
  });

  it('worker status updates to running after ready', async () => {
    pool.spawn('w1', {});
    await new Promise(resolve => {
      poolEvents.on('worker:ready', resolve);
    });
    const w = pool.getWorker('w1');
    expect(w.status).toBe('running');
  });
});

// ══════════════════════════════════════════════════════════════
// Multi-Instance Orchestrator Route Tests
// ══════════════════════════════════════════════════════════════

describe('Server — Multi-Instance Orchestrator Endpoints', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  // ── Instances List ──────────────────────────────────────

  it('GET /api/orchestrator/instances returns empty array initially', async () => {
    const { status, body } = await api('/api/orchestrator/instances');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  // ── Legacy Endpoints (backward compat) ──────────────────

  it('GET /api/orchestrator/status returns initial state', async () => {
    const { status, body } = await api('/api/orchestrator/status');
    expect(status).toBe(200);
    expect(body.running).toBe(false);
  });

  it('POST /api/orchestrator/start starts default instance', async () => {
    const { status, body } = await api('/api/orchestrator/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'test-legacy', dryRun: true }),
    });
    expect(status).toBe(202);
    expect(body.status.running).toBe(true);
    expect(body.status.mission).toBe('test-legacy');
  });

  it('POST /api/orchestrator/start rejects when default running', async () => {
    const { status } = await api('/api/orchestrator/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(status).toBe(409);
  });

  it('orchestrator status updates via events with workerId', async () => {
    events.emit('round:start', { workerId: 'default', round: 5 });
    events.emit('agent:start', { workerId: 'default', agentId: 'dev-1', model: 'opus' });

    const { body } = await api('/api/orchestrator/status');
    expect(body.round).toBe(5);
    expect(body.agents).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'dev-1', status: 'running', model: 'opus' })])
    );
  });

  it('agent:complete updates agent in correct instance', async () => {
    events.emit('agent:complete', { workerId: 'default', agentId: 'dev-1', elapsedMs: 3000 });

    const { body } = await api('/api/orchestrator/status');
    const agent = body.agents.find(a => a.id === 'dev-1');
    expect(agent.status).toBe('complete');
    expect(agent.elapsedMs).toBe(3000);
  });

  it('POST /api/orchestrator/stop stops default instance', async () => {
    const { status, body } = await api('/api/orchestrator/stop', {
      method: 'POST',
    });
    expect(status).toBe(200);
    expect(body.status.running).toBe(false);
  });

  it('POST /api/orchestrator/stop rejects when not running', async () => {
    const { status } = await api('/api/orchestrator/stop', {
      method: 'POST',
    });
    expect(status).toBe(409);
  });

  // ── Named Instance Endpoints ────────────────────────────

  it('POST /api/orchestrator/:id/start creates new instance', async () => {
    const { status, body } = await api('/api/orchestrator/alpha/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'test-alpha', dryRun: true }),
    });
    expect(status).toBe(202);
    expect(body.status.id).toBe('alpha');
  });

  it('instances list shows alpha after start', async () => {
    const { body } = await api('/api/orchestrator/instances');
    const alpha = body.find(i => i.id === 'alpha');
    expect(alpha).toBeDefined();
    expect(alpha.running).toBe(true);
    expect(alpha.mission).toBe('test-alpha');
  });

  it('POST /api/orchestrator/:id/start rejects duplicate running instance', async () => {
    const { status } = await api('/api/orchestrator/alpha/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(status).toBe(409);
  });

  it('events with workerId route to correct instance', async () => {
    events.emit('round:start', { workerId: 'alpha', round: 2 });
    events.emit('agent:start', { workerId: 'alpha', agentId: 'alpha-agent', model: 'haiku' });

    const { body } = await api('/api/orchestrator/instances');
    const alpha = body.find(i => i.id === 'alpha');
    expect(alpha.round).toBe(2);
    expect(alpha.agents).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'alpha-agent' })])
    );
  });

  it('POST /api/orchestrator/:id/stop stops named instance', async () => {
    const { status, body } = await api('/api/orchestrator/alpha/stop', {
      method: 'POST',
    });
    expect(status).toBe(200);
    expect(body.status.running).toBe(false);
  });

  it('POST /api/orchestrator/:id/stop rejects when not running', async () => {
    const { status } = await api('/api/orchestrator/alpha/stop', {
      method: 'POST',
    });
    expect(status).toBe(409);
  });

  it('DELETE /api/orchestrator/:id removes stopped instance', async () => {
    const { status, body } = await api('/api/orchestrator/alpha', {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    expect(body.message).toContain('removed');
  });

  it('DELETE /api/orchestrator/:id returns 404 for unknown', async () => {
    const { status } = await api('/api/orchestrator/nonexistent', {
      method: 'DELETE',
    });
    expect(status).toBe(404);
  });

  it('DELETE /api/orchestrator/:id rejects running instance', async () => {
    // Start a new instance
    await api('/api/orchestrator/beta/start', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true }),
    });

    const { status } = await api('/api/orchestrator/beta', {
      method: 'DELETE',
    });
    expect(status).toBe(409);

    // Clean up
    await api('/api/orchestrator/beta/stop', { method: 'POST' });
  });

  // ── Concurrent Instances ────────────────────────────────

  it('supports multiple concurrent instances', async () => {
    // Start two named instances
    await api('/api/orchestrator/inst1/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'mission-1', dryRun: true }),
    });
    await api('/api/orchestrator/inst2/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'mission-2', dryRun: true, model: 'opus' }),
    });

    // Both should be running
    const { body } = await api('/api/orchestrator/instances');
    const inst1 = body.find(i => i.id === 'inst1');
    const inst2 = body.find(i => i.id === 'inst2');
    expect(inst1.running).toBe(true);
    expect(inst2.running).toBe(true);
    expect(inst1.mission).toBe('mission-1');
    expect(inst2.mission).toBe('mission-2');

    // Events route to correct instances
    events.emit('round:start', { workerId: 'inst1', round: 10 });
    events.emit('round:start', { workerId: 'inst2', round: 3 });

    const { body: body2 } = await api('/api/orchestrator/instances');
    expect(body2.find(i => i.id === 'inst1').round).toBe(10);
    expect(body2.find(i => i.id === 'inst2').round).toBe(3);

    // Clean up
    await api('/api/orchestrator/inst1/stop', { method: 'POST' });
    await api('/api/orchestrator/inst2/stop', { method: 'POST' });
  });

  // ── Run History with Instance ID ────────────────────────

  it('run history includes instanceId', async () => {
    // Start and stop a named instance
    await api('/api/orchestrator/hist-inst/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'history-test', dryRun: true }),
    });
    await api('/api/orchestrator/hist-inst/stop', { method: 'POST' });

    const { body } = await api('/api/orchestrator/history');
    const histRun = body.find(r => r.mission === 'history-test');
    expect(histRun).toBeDefined();
    expect(histRun.instanceId).toBe('hist-inst');
    expect(histRun.outcome).toBe('stopped');
  });
});

// ══════════════════════════════════════════════════════════════
// WS Bridge — Worker Events
// ══════════════════════════════════════════════════════════════

describe('Server — Worker Event Bridging', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('bridges worker events to WebSocket clients', async () => {
    const { default: WebSocket } = await import('ws');
    const port = appInstance.server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise((resolve) => ws.on('open', resolve));

    // Subscribe to worker events
    ws.send(JSON.stringify({ subscribe: ['worker:*'] }));
    await new Promise(r => setTimeout(r, 100));

    // Emit a worker event
    const msgPromise = new Promise((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.event === 'worker:spawned') resolve(msg);
      });
    });

    events.emit('worker:spawned', { workerId: 'test-worker', pid: 12345 });

    const msg = await msgPromise;
    expect(msg.event).toBe('worker:spawned');
    expect(msg.data.workerId).toBe('test-worker');

    ws.close();
  });
});

// ══════════════════════════════════════════════════════════════
// IPCEventBus Tests
// ══════════════════════════════════════════════════════════════

describe('IPCEventBus', () => {
  it('emits events locally', async () => {
    const { IPCEventBus } = await import('../../shared/event-bus.mjs');
    const bus = new IPCEventBus({ workerId: 'test' });
    let received = null;
    bus.on('test:event', (data) => { received = data; });
    bus.emit('test:event', { foo: 'bar' });
    expect(received).toBeDefined();
    expect(received.foo).toBe('bar');
    expect(received.timestamp).toBeTruthy();
  });

  it('includes workerId in constructor', async () => {
    const { IPCEventBus } = await import('../../shared/event-bus.mjs');
    const bus = new IPCEventBus({ workerId: 'w42' });
    expect(bus._workerId).toBe('w42');
  });
});

// ══════════════════════════════════════════════════════════════
// Server Pool Integration
// ══════════════════════════════════════════════════════════════

describe('Server — Pool Option', () => {
  afterEach(async () => {
    await stopServer();
    teardownDir(TEST_DIR_INTEG);
  });

  it('creates pool when options.pool is true', async () => {
    setupDir(TEST_DIR_INTEG);
    seedRegistryAt(TEST_DIR_INTEG);
    await startServer({ pool: true, operatorDir: TEST_DIR_INTEG });
    expect(appInstance.pool).not.toBeNull();
  });

  it('accepts injected pool object', async () => {
    setupDir(TEST_DIR_INTEG);
    seedRegistryAt(TEST_DIR_INTEG);
    const customPool = {
      spawn: () => {},
      kill: () => {},
      sendTo: () => {},
      getStatus: () => [],
      getWorker: () => null,
      remove: () => false,
      shutdownAll: async () => {},
      activeCount: () => 0,
    };
    await startServer({ pool: customPool, operatorDir: TEST_DIR_INTEG });
    expect(appInstance.pool).toBe(customPool);
  });

  it('pool is null by default', async () => {
    setupDir(TEST_DIR_INTEG);
    seedRegistryAt(TEST_DIR_INTEG);
    await startServer({ operatorDir: TEST_DIR_INTEG });
    expect(appInstance.pool).toBeNull();
  });
});
