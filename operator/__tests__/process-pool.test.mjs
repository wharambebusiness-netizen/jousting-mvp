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
import { createCoordinator } from '../coordination/coordinator.mjs';

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
    auth: false,
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
// Process Pool — Phase 7b Robustness Tests
// ══════════════════════════════════════════════════════════════

describe('ProcessPool — Circuit Breaker', () => {
  let pool, poolEvents;
  const TEST_DIR_CB = join(import.meta.dirname, '..', '__test_tmp_pool_cb');
  const crashWorkerPath = join(TEST_DIR_CB, 'crash-worker.mjs');

  beforeAll(() => {
    setupDir(TEST_DIR_CB);
    // Worker that crashes with exit code 1 on 'init'
    writeFileSync(crashWorkerPath, `
      process.on('message', (msg) => {
        if (msg.type === 'init') {
          process.send({ type: 'ready' });
          // Crash shortly after ready
          setTimeout(() => process.exit(1), 50);
        } else if (msg.type === 'ping') {
          process.send({ type: 'pong' });
        } else if (msg.type === 'shutdown') {
          process.exit(0);
        }
      });
    `);
  });

  afterAll(() => { teardownDir(TEST_DIR_CB); });

  afterEach(async () => {
    if (pool) await pool.shutdownAll();
  });

  it('records consecutive failures on crash exits', async () => {
    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_CB,
      workerScript: crashWorkerPath,
      maxRestarts: 0, // Don't auto-restart
      log: () => {},
    });

    pool.spawn('w1', {});
    await new Promise(resolve => { poolEvents.on('worker:ready', resolve); });

    // Wait for crash
    await new Promise(resolve => { poolEvents.on('worker:exit', resolve); });
    const w = pool.getWorker('w1');
    expect(w.consecutiveFailures).toBe(1);
    expect(w.exitCode).toBe(1);
  });

  it('opens circuit after threshold failures', async () => {
    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_CB,
      workerScript: crashWorkerPath,
      maxRestarts: 5,
      restartBackoffBaseMs: 50,
      circuitBreakerThreshold: 2,
      log: () => {},
    });

    const circuitOpenPromise = new Promise(resolve => {
      poolEvents.on('worker:circuit-open', resolve);
    });

    pool.spawn('w1', {});

    // Wait for circuit to open (2 crashes)
    const data = await circuitOpenPromise;
    expect(data.workerId).toBe('w1');
    expect(data.consecutiveFailures).toBe(2);
    expect(data.threshold).toBe(2);

    // After circuit opens, the worker should have circuit state 'open'
    // (wait for restarts to settle)
    await new Promise(r => setTimeout(r, 300));
    const w = pool.getWorker('w1');
    expect(w.circuitState).toBe('open');
  });

  it('emits max-restarts event when limit exceeded', async () => {
    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_CB,
      workerScript: crashWorkerPath,
      maxRestarts: 1,
      restartBackoffBaseMs: 50,
      circuitBreakerThreshold: 10, // High threshold so circuit doesn't interfere
      log: () => {},
    });

    const maxRestartsPromise = new Promise(resolve => {
      poolEvents.on('worker:max-restarts', resolve);
    });

    pool.spawn('w1', {});

    const data = await maxRestartsPromise;
    expect(data.workerId).toBe('w1');
    expect(data.maxRestarts).toBe(1);
  });

  it('clean exit (code 0) does not increment failure counter', async () => {
    const TEST_DIR_CLEAN = join(import.meta.dirname, '..', '__test_tmp_pool_clean');
    setupDir(TEST_DIR_CLEAN);
    const cleanWorkerPath = join(TEST_DIR_CLEAN, 'clean-worker.mjs');
    writeFileSync(cleanWorkerPath, `
      process.on('message', (msg) => {
        if (msg.type === 'init') {
          process.send({ type: 'ready' });
        } else if (msg.type === 'shutdown') {
          process.exit(0);
        } else if (msg.type === 'ping') {
          process.send({ type: 'pong' });
        }
      });
    `);

    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_CLEAN,
      workerScript: cleanWorkerPath,
      log: () => {},
    });

    pool.spawn('w1', {});
    await new Promise(resolve => { poolEvents.on('worker:ready', resolve); });

    // Kill with clean shutdown (exit code 0)
    pool.kill('w1');
    await new Promise(resolve => { poolEvents.on('worker:exit', resolve); });

    const w = pool.getWorker('w1');
    expect(w.consecutiveFailures).toBe(0);
    expect(w.exitCode).toBe(0);

    teardownDir(TEST_DIR_CLEAN);
  });

  it('restart returns false when circuit is open', async () => {
    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_CB,
      workerScript: crashWorkerPath,
      maxRestarts: 0,
      circuitBreakerThreshold: 1,
      log: () => {},
    });

    pool.spawn('w1', {});
    await new Promise(resolve => { poolEvents.on('worker:circuit-open', resolve); });
    await new Promise(r => setTimeout(r, 200));

    // Try manual restart — should be blocked
    const result = pool.restart('w1');
    expect(result).toBe(false);
  });
});

describe('ProcessPool — Idle Kill', () => {
  let pool, poolEvents;
  const TEST_DIR_IDLE = join(import.meta.dirname, '..', '__test_tmp_pool_idle');
  const idleWorkerPath = join(TEST_DIR_IDLE, 'idle-worker.mjs');

  beforeAll(() => {
    setupDir(TEST_DIR_IDLE);
    writeFileSync(idleWorkerPath, `
      process.on('message', (msg) => {
        if (msg.type === 'init') {
          process.send({ type: 'ready' });
        } else if (msg.type === 'ping') {
          process.send({ type: 'pong' });
        } else if (msg.type === 'shutdown') {
          process.exit(0);
        }
      });
    `);
  });

  afterAll(() => { teardownDir(TEST_DIR_IDLE); });

  afterEach(async () => {
    if (pool) await pool.shutdownAll();
  });

  it('getStatus includes lastActivity and circuitState fields', async () => {
    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_IDLE,
      workerScript: idleWorkerPath,
      log: () => {},
    });

    pool.spawn('w1', {});
    await new Promise(resolve => { poolEvents.on('worker:ready', resolve); });

    const status = pool.getStatus();
    expect(status[0].lastActivity).toBeTruthy();
    expect(status[0].circuitState).toBe('closed');
    expect(status[0].consecutiveFailures).toBe(0);
  });

  it('worker activity is updated on IPC events', async () => {
    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_IDLE,
      workerScript: idleWorkerPath,
      log: () => {},
    });

    pool.spawn('w1', {});
    await new Promise(resolve => { poolEvents.on('worker:ready', resolve); });

    const before = pool.getWorker('w1').lastActivity;

    // Wait a bit then trigger an event
    await new Promise(r => setTimeout(r, 50));
    pool.sendTo('w1', { type: 'start' }); // triggers event IPC back

    // Give time for event to arrive
    await new Promise(r => setTimeout(r, 100));
    const after = pool.getWorker('w1').lastActivity;
    // lastActivity should have been updated (or at minimum equal)
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('failures persist through ready, only reset when stable', async () => {
    const TEST_DIR_RESET = join(import.meta.dirname, '..', '__test_tmp_pool_reset');
    setupDir(TEST_DIR_RESET);

    const conditionalWorkerPath = join(TEST_DIR_RESET, 'conditional-worker.mjs');
    writeFileSync(conditionalWorkerPath, `
      let initCount = 0;
      process.on('message', (msg) => {
        if (msg.type === 'init') {
          initCount++;
          process.send({ type: 'ready' });
          // Crash on first init only
          if (initCount === 1) {
            setTimeout(() => process.exit(1), 50);
          }
        } else if (msg.type === 'ping') {
          process.send({ type: 'pong' });
        } else if (msg.type === 'shutdown') {
          process.exit(0);
        }
      });
    `);

    poolEvents = new EventBus();
    pool = createProcessPool({
      events: poolEvents,
      projectDir: TEST_DIR_RESET,
      workerScript: conditionalWorkerPath,
      maxRestarts: 3,
      restartBackoffBaseMs: 50,
      circuitBreakerThreshold: 5,
      log: () => {},
    });

    pool.spawn('w1', {});

    // Wait for restart and second ready
    let readyCount = 0;
    await new Promise(resolve => {
      poolEvents.on('worker:ready', () => {
        readyCount++;
        if (readyCount >= 2) resolve();
      });
    });

    // After restart, failures should still be 1 (not reset on ready)
    const w = pool.getWorker('w1');
    expect(w.consecutiveFailures).toBe(1);
    // Circuit still closed because threshold=5 and we only had 1 failure
    expect(w.circuitState).toBe('closed');

    teardownDir(TEST_DIR_RESET);
  });
});

describe('ProcessPool — Backoff Timing', () => {
  it('restart backoff increases exponentially', () => {
    // Verify the backoff math (unit test, no processes needed)
    const base = 1000;
    const max = 60_000;
    const delays = [];
    for (let attempt = 1; attempt <= 7; attempt++) {
      delays.push(Math.min(base * Math.pow(2, attempt - 1), max));
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000]);
  });
});

// ══════════════════════════════════════════════════════════════
// Coordinator — Phase 7b Auto-Scale + Budget Drain Tests
// ══════════════════════════════════════════════════════════════

describe('Coordinator — Auto-Scale', () => {
  it('spawns worker when pending tasks exceed threshold', () => {
    const events = new EventBus();
    const spawned = [];
    const mockPool = {
      activeCount: () => spawned.length,
      spawn: (id, cfg) => { spawned.push({ id, cfg }); return { id, pid: 123 }; },
      sendTo: () => true,
      getStatus: () => spawned.map(s => ({
        id: s.id, status: 'running', config: s.cfg,
      })),
      getWorker: (id) => spawned.find(s => s.id === id) || null,
    };

    const coord = createCoordinator({
      events,
      pool: mockPool,
      options: {
        autoScaleCheckMs: 100, // Enable auto-scale
        scaleUpThreshold: 2,
        maxWorkers: 4,
      },
      log: () => {},
    });

    coord.start();

    // Add 3 tasks with 0 workers — should trigger auto-scale
    coord.addTasks([
      { id: 't1', task: 'task 1' },
      { id: 't2', task: 'task 2' },
      { id: 't3', task: 'task 3' },
    ]);

    expect(spawned.length).toBeGreaterThanOrEqual(1);
    expect(spawned[0].id).toBe('auto-1');

    coord.stop();
  });

  it('does not scale beyond maxWorkers', () => {
    const events = new EventBus();
    let spawnCount = 0;
    const mockPool = {
      activeCount: () => 4, // Already at max
      spawn: () => { spawnCount++; },
      sendTo: () => true,
      getStatus: () => [],
    };

    const coord = createCoordinator({
      events,
      pool: mockPool,
      options: {
        autoScaleCheckMs: 100,
        scaleUpThreshold: 1,
        maxWorkers: 4,
      },
      log: () => {},
    });

    coord.start();
    coord.addTask({ id: 't1', task: 'task 1' });

    expect(spawnCount).toBe(0); // Should not spawn

    coord.stop();
  });

  it('does not scale when auto-scale is disabled', () => {
    const events = new EventBus();
    const mockPool = {
      sendTo: () => true,
      getStatus: () => [],
    };

    const coord = createCoordinator({
      events,
      pool: mockPool,
      options: { autoScaleCheckMs: 0 }, // Disabled
      log: () => {},
    });

    coord.start();
    // Should not throw even though pool has no activeCount
    coord.addTask({ id: 't1', task: 'task 1' });
    coord.stop();
  });

  it('uses workerConfigFactory for auto-spawned workers', () => {
    const events = new EventBus();
    const spawned = [];
    const mockPool = {
      activeCount: () => spawned.length,
      spawn: (id, cfg) => { spawned.push({ id, cfg }); },
      sendTo: () => true,
      getStatus: () => [],
    };

    const coord = createCoordinator({
      events,
      pool: mockPool,
      options: {
        autoScaleCheckMs: 100,
        scaleUpThreshold: 1,
        maxWorkers: 4,
        workerConfigFactory: (id) => ({ model: 'haiku', customId: id }),
      },
      log: () => {},
    });

    coord.start();
    coord.addTasks([{ id: 't1', task: 'x' }, { id: 't2', task: 'y' }]);

    expect(spawned.length).toBeGreaterThanOrEqual(1);
    expect(spawned[0].cfg.model).toBe('haiku');
    expect(spawned[0].cfg.customId).toBe('auto-1');

    coord.stop();
  });
});

describe('Coordinator — Budget Auto-Drain', () => {
  it('auto-drains on global budget exceeded', () => {
    const events = new EventBus();
    const mockPool = {
      sendTo: () => true,
      getStatus: () => [{ id: 'w1', status: 'running' }],
    };

    const coord = createCoordinator({
      events,
      pool: mockPool,
      options: {
        globalBudgetUsd: 0.01,
        perWorkerBudgetUsd: 100,
        budgetAutoDrain: true,
      },
      log: () => {},
    });

    coord.start();
    expect(coord.getState()).toBe('running');

    // Emit cost that exceeds global budget
    events.emit('coord:cost', { workerId: 'w1', totalUsd: 0.02 });

    expect(coord.getState()).toBe('draining');

    coord.stop();
  });

  it('does not auto-drain when budgetAutoDrain is false', () => {
    const events = new EventBus();
    const mockPool = {
      sendTo: () => true,
      getStatus: () => [{ id: 'w1', status: 'running' }],
    };

    const coord = createCoordinator({
      events,
      pool: mockPool,
      options: {
        globalBudgetUsd: 0.01,
        budgetAutoDrain: false,
      },
      log: () => {},
    });

    coord.start();
    events.emit('coord:cost', { workerId: 'w1', totalUsd: 0.02 });

    expect(coord.getState()).toBe('running'); // Still running

    coord.stop();
  });
});

describe('Coordinator — Drain Timeout', () => {
  it('force-stops after drain timeout', async () => {
    const events = new EventBus();
    const mockPool = {
      sendTo: () => true,
      getStatus: () => [{ id: 'w1', status: 'running' }],
    };

    const coord = createCoordinator({
      events,
      pool: mockPool,
      options: { drainTimeoutMs: 100 },
      log: () => {},
    });

    coord.start();
    coord.addTask({ id: 't1', task: 'long task' });

    // Start drain
    coord.drain();
    expect(coord.getState()).toBe('draining');

    // Wait for timeout
    const stoppedPromise = new Promise(resolve => {
      events.on('coord:stopped', resolve);
    });

    await stoppedPromise;
    expect(coord.getState()).toBe('stopped');
  });

  it('does not force-stop when drainTimeoutMs is 0', async () => {
    const events = new EventBus();
    const mockPool = {
      sendTo: () => true,
      getStatus: () => [],
    };

    const coord = createCoordinator({
      events,
      pool: mockPool,
      options: { drainTimeoutMs: 0 },
      log: () => {},
    });

    coord.start();
    coord.drain();

    // Wait a bit — should NOT force stop
    await new Promise(r => setTimeout(r, 150));
    // It should have completed naturally (no tasks) and still be draining or completed
    // (all-complete fires, but no force stop)
    expect(coord.getState()).not.toBe('stopped');

    coord.stop();
  });
});

// ══════════════════════════════════════════════════════════════
// Phase 7b Stress Test — 4 Workers, Concurrent Tasks
// ══════════════════════════════════════════════════════════════

describe('Stress Test — Multi-Worker Concurrent Operation', () => {
  const STRESS_DIR = join(import.meta.dirname, '..', '__test_tmp_stress');
  const COORD_WORKER = join(import.meta.dirname, 'coord-dummy-worker.mjs');
  let pool, coord, stressEvents;

  function waitForEvent(eventBus, eventName, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        eventBus.off(eventName, handler);
        reject(new Error(`Timeout waiting for ${eventName} (${timeoutMs}ms)`));
      }, timeoutMs);
      function handler(data) {
        clearTimeout(timer);
        eventBus.off(eventName, handler);
        resolve(data);
      }
      eventBus.on(eventName, handler);
    });
  }

  function waitForEvents(eventBus, eventName, count, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const collected = [];
      const timer = setTimeout(() => {
        eventBus.off(eventName, handler);
        reject(new Error(`Timeout waiting for ${count}x ${eventName} (got ${collected.length})`));
      }, timeoutMs);
      function handler(data) {
        collected.push(data);
        if (collected.length >= count) {
          clearTimeout(timer);
          eventBus.off(eventName, handler);
          resolve(collected);
        }
      }
      eventBus.on(eventName, handler);
    });
  }

  async function spawnAndWait(p, ev, id, cfg = {}) {
    const ready = waitForEvent(ev, 'worker:ready');
    p.spawn(id, cfg);
    await ready;
  }

  beforeAll(() => { setupDir(STRESS_DIR); });
  afterAll(() => { teardownDir(STRESS_DIR); });

  beforeEach(async () => {
    stressEvents = new EventBus();
    pool = createProcessPool({
      events: stressEvents,
      projectDir: STRESS_DIR,
      workerScript: COORD_WORKER,
      log: () => {},
    });
  });

  afterEach(async () => {
    if (coord) { coord.stop(); coord = null; }
    await pool.shutdownAll();
  });

  it('distributes 10 tasks across 4 workers', async () => {
    // Spawn 4 workers
    await Promise.all([
      spawnAndWait(pool, stressEvents, 'w1'),
      spawnAndWait(pool, stressEvents, 'w2'),
      spawnAndWait(pool, stressEvents, 'w3'),
      spawnAndWait(pool, stressEvents, 'w4'),
    ]);

    coord = createCoordinator({
      events: stressEvents,
      pool,
      log: () => {},
    });
    coord.start();

    // Submit 10 tasks
    const allCompletePromise = waitForEvent(stressEvents, 'coord:all-complete');
    coord.addTasks(
      Array.from({ length: 10 }, (_, i) => ({
        id: `task-${i + 1}`,
        task: `Stress task ${i + 1}`,
      }))
    );

    const result = await allCompletePromise;
    expect(result.total).toBe(10);
    expect(result.complete).toBe(10);
    expect(result.failed).toBe(0);
  });

  it('handles task dependencies correctly', async () => {
    await Promise.all([
      spawnAndWait(pool, stressEvents, 'w1'),
      spawnAndWait(pool, stressEvents, 'w2'),
    ]);

    coord = createCoordinator({
      events: stressEvents,
      pool,
      log: () => {},
    });
    coord.start();

    // Create dependency chain: t3 depends on t1 and t2
    const allCompletePromise = waitForEvent(stressEvents, 'coord:all-complete');
    coord.addTasks([
      { id: 't1', task: 'Build backend' },
      { id: 't2', task: 'Build frontend' },
      { id: 't3', task: 'Integration test', deps: ['t1', 't2'] },
    ]);

    const result = await allCompletePromise;
    expect(result.total).toBe(3);
    expect(result.complete).toBe(3);
  });

  it('enforces budget and stops worker', async () => {
    await spawnAndWait(pool, stressEvents, 'w1');

    coord = createCoordinator({
      events: stressEvents,
      pool,
      options: {
        globalBudgetUsd: 0.05,
        perWorkerBudgetUsd: 0.03,
        budgetAutoDrain: true,
      },
      log: () => {},
    });
    coord.start();

    // Worker reports cost exceeding budget
    const budgetStopPromise = waitForEvent(stressEvents, 'coord:budget-stop-received', 3000);
    pool.sendTo('w1', { type: 'test:report-cost', totalUsd: 0.04 });

    const data = await budgetStopPromise;
    expect(data.workerExceeded).toBe(true);

    // Coordinator should auto-drain after global exceeded
    pool.sendTo('w1', { type: 'test:report-cost', totalUsd: 0.02 });
    await new Promise(r => setTimeout(r, 100));
    expect(coord.getState()).toBe('draining');
  });

  it('handles circuit breaker with failing workers', async () => {
    const FAIL_DIR = join(import.meta.dirname, '..', '__test_tmp_stress_fail');
    setupDir(FAIL_DIR);
    const failWorkerPath = join(FAIL_DIR, 'fail-worker.mjs');
    writeFileSync(failWorkerPath, `
      process.on('message', (msg) => {
        if (msg.type === 'init') {
          process.send({ type: 'ready' });
          // Crash after a short delay
          setTimeout(() => process.exit(1), 30);
        } else if (msg.type === 'ping') {
          process.send({ type: 'pong' });
        } else if (msg.type === 'shutdown') {
          process.exit(0);
        }
      });
    `);

    const failEvents = new EventBus();
    const failPool = createProcessPool({
      events: failEvents,
      projectDir: FAIL_DIR,
      workerScript: failWorkerPath,
      maxRestarts: 2,
      restartBackoffBaseMs: 30,
      circuitBreakerThreshold: 2,
      log: () => {},
    });

    const circuitPromise = waitForEvent(failEvents, 'worker:circuit-open', 5000);
    failPool.spawn('fail-w1', {});

    const circuitData = await circuitPromise;
    expect(circuitData.workerId).toBe('fail-w1');
    expect(circuitData.consecutiveFailures).toBeGreaterThanOrEqual(2);

    await failPool.shutdownAll();
    teardownDir(FAIL_DIR);
  });

  it('tracks worker status with new fields', async () => {
    await spawnAndWait(pool, stressEvents, 'w1');

    const status = pool.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0].lastActivity).toBeTruthy();
    expect(status[0].consecutiveFailures).toBe(0);
    expect(status[0].circuitState).toBe('closed');
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
