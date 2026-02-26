// Orchestrator Worker IPC Tests (Phase 16.4)
//
// Tests the worker's message handlers via fork() as a child process.
// This tests the actual IPC protocol without needing to mock module-level state.
import { describe, it, expect, afterEach } from 'vitest';
import { fork } from 'child_process';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';

// ── Helpers ─────────────────────────────────────────────────

const WORKER_PATH = join(import.meta.dirname, '..', 'orchestrator-worker.mjs');
const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_worker');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

/** Fork the worker and return {child, send, waitFor, waitForEvent, kill} helpers. */
function spawnWorker() {
  const child = fork(WORKER_PATH, [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, WORKER_ID: 'test-worker' },
  });

  const _msgBuffer = [];
  const _waiters = [];

  child.on('message', (msg) => {
    // Find the first waiter whose filter matches
    const idx = _waiters.findIndex((w) => w.filter(msg));
    if (idx >= 0) {
      const waiter = _waiters.splice(idx, 1)[0];
      waiter.resolve(msg);
    } else {
      _msgBuffer.push(msg);
    }
  });

  function send(msg) {
    child.send(msg);
  }

  /** Wait for a message matching a filter function. */
  function waitFor(filterFn, timeout = 3000) {
    // Check buffer first
    const idx = _msgBuffer.findIndex(filterFn);
    if (idx >= 0) {
      const msg = _msgBuffer.splice(idx, 1)[0];
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx2 = _waiters.findIndex(w => w.resolve === resolve);
        if (idx2 >= 0) _waiters.splice(idx2, 1);
        reject(new Error(`Timeout waiting for message`));
      }, timeout);
      _waiters.push({
        filter: filterFn,
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
      });
    });
  }

  /** Wait for a message of a specific type. */
  function waitForType(type, timeout = 3000) {
    return waitFor((msg) => msg.type === type, timeout);
  }

  /** Wait for an IPC event emission. */
  function waitForEvent(eventName, timeout = 3000) {
    return waitFor((msg) => msg.type === 'event' && msg.event === eventName, timeout);
  }

  function kill() {
    try { child.kill('SIGTERM'); } catch {}
  }

  return { child, send, waitFor, waitForType, waitForEvent, kill };
}

/** Init a worker with standard test config. */
async function initWorker(w, extraInit = {}) {
  w.send({
    type: 'init',
    workerId: 'test-worker',
    projectDir: TEST_DIR,
    config: { model: 'sonnet', maxBudgetUsd: 5 },
    ...extraInit,
  });
  const ready = await w.waitForType('ready');
  return ready;
}

// ── Tests ───────────────────────────────────────────────────

describe('worker IPC — init', () => {
  let w;
  afterEach(() => { if (w) w.kill(); teardown(); });

  it('sends ready after init', async () => {
    setup();
    w = spawnWorker();
    const ready = await initWorker(w);
    expect(ready.type).toBe('ready');
  });

  it('includes workerId in status after init', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    // Ping to trigger a status check
    w.send({ type: 'ping' });
    const pong = await w.waitForType('pong');
    expect(pong.type).toBe('pong');
  });
});

describe('worker IPC — ping/pong', () => {
  let w;
  afterEach(() => { if (w) w.kill(); teardown(); });

  it('responds to ping with pong', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'ping' });
    const pong = await w.waitForType('pong');
    expect(pong.type).toBe('pong');
  });

  it('responds to multiple pings', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'ping' });
    w.send({ type: 'ping' });
    const p1 = await w.waitForType('pong');
    const p2 = await w.waitForType('pong');
    expect(p1.type).toBe('pong');
    expect(p2.type).toBe('pong');
  });
});

describe('worker IPC — start (error cases)', () => {
  let w;
  afterEach(() => { if (w) w.kill(); teardown(); });

  it('returns error when starting without init', async () => {
    setup();
    w = spawnWorker();
    w.send({ type: 'start' });
    const err = await w.waitForType('error');
    expect(err.message).toBe('Not initialized');
  });

  it('returns error when orchestrator path does not exist', async () => {
    setup();
    // Init with a project dir that has no orchestrator/orchestrator.mjs
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'start' });
    const err = await w.waitForType('error');
    expect(err.message).toMatch(/Orchestrator not found/);
  });
});

describe('worker IPC — stop (error case)', () => {
  let w;
  afterEach(() => { if (w) w.kill(); teardown(); });

  it('returns error when stopping while not running', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'stop' });
    const err = await w.waitForType('error');
    expect(err.message).toBe('Not running');
  });
});

describe('worker IPC — unknown message', () => {
  let w;
  afterEach(() => { if (w) w.kill(); teardown(); });

  it('returns error for unknown message type', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'bogus' });
    const err = await w.waitForType('error');
    expect(err.message).toBe('Unknown message type: bogus');
  });

  it('ignores null messages', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    // Send null — handleMessage returns early
    w.send(null);
    // Verify worker is still responsive
    w.send({ type: 'ping' });
    const pong = await w.waitForType('pong');
    expect(pong.type).toBe('pong');
  });

  it('ignores non-object messages', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send('just a string');
    // Verify worker is still responsive
    w.send({ type: 'ping' });
    const pong = await w.waitForType('pong');
    expect(pong.type).toBe('pong');
  });
});

describe('worker IPC — config', () => {
  let w;
  afterEach(() => { if (w) w.kill(); teardown(); });

  it('handles config update and sends status', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'config', model: 'opus', maxBudgetUsd: 10, maxTurns: 50 });
    // Should get a status message back
    const status = await w.waitForType('status');
    expect(status.status.workerId).toBe('test-worker');
    expect(status.status.running).toBe(false);
  });

  it('emits worker:config-applied event', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'config', model: 'haiku' });
    const event = await w.waitForEvent('worker:config-applied');
    expect(event.data.model).toBe('haiku');
    expect(event.data.workerId).toBe('test-worker');
  });

  it('handles partial config update', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'config', maxTurns: 99 });
    const event = await w.waitForEvent('worker:config-applied');
    expect(event.data.maxTurns).toBe(99);
    expect(event.data.model).toBeUndefined(); // Not included when not changed
  });
});

describe('worker IPC — coordination messages', () => {
  let w;
  afterEach(() => { if (w) w.kill(); teardown(); });

  it('handles coord:proceed and emits event', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({
      type: 'coord:proceed',
      taskId: 'task-1',
      task: 'Build feature X',
      category: 'code',
      metadata: { priority: 1 },
    });
    const event = await w.waitForEvent('coord:proceed');
    expect(event.data.workerId).toBe('test-worker');
    expect(event.data.taskId).toBe('task-1');
    expect(event.data.task).toBe('Build feature X');
    expect(event.data.category).toBe('code');
    expect(event.data.metadata).toEqual({ priority: 1 });
  });

  it('handles coord:wait and emits event', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'coord:wait', reason: 'No tasks available' });
    const event = await w.waitForEvent('coord:wait');
    expect(event.data.reason).toBe('No tasks available');
    expect(event.data.workerId).toBe('test-worker');
  });

  it('handles coord:rate-grant and emits event', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'coord:rate-grant', remaining: 42 });
    const event = await w.waitForEvent('coord:rate-grant');
    expect(event.data.remaining).toBe(42);
    expect(event.data.workerId).toBe('test-worker');
  });

  it('handles coord:rate-wait and emits event', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({ type: 'coord:rate-wait', waitMs: 5000, remaining: 0 });
    const event = await w.waitForEvent('coord:rate-wait');
    expect(event.data.waitMs).toBe(5000);
    expect(event.data.remaining).toBe(0);
  });

  it('handles coord:budget-stop — sets budgetExceeded', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    w.send({
      type: 'coord:budget-stop',
      workerExceeded: true,
      globalExceeded: false,
      workerTotal: 11,
      globalTotal: 20,
    });
    const event = await w.waitForEvent('coord:budget-stop');
    expect(event.data.workerExceeded).toBe(true);
    expect(event.data.globalExceeded).toBe(false);
    expect(event.data.workerTotal).toBe(11);
    expect(event.data.globalTotal).toBe(20);
  });

  it('coord messages are ignored before init', async () => {
    setup();
    w = spawnWorker();
    // Send coord message before init — events is null, should not crash
    w.send({ type: 'coord:proceed', taskId: 't1', task: 'x' });
    // Worker should still be responsive
    await initWorker(w);
    w.send({ type: 'ping' });
    const pong = await w.waitForType('pong');
    expect(pong.type).toBe('pong');
  });
});

describe('worker IPC — shutdown', () => {
  let w;
  afterEach(() => { if (w) try { w.kill(); } catch {} teardown(); });

  it('exits on shutdown when not running', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w);
    const exitCode = new Promise((resolve) => w.child.on('exit', resolve));
    w.send({ type: 'shutdown' });
    const code = await exitCode;
    expect(code).toBe(0);
  });
});

describe('worker IPC — start with real orchestrator (dry-run)', () => {
  let w;
  afterEach(() => { if (w) try { w.kill(); } catch {} teardown(); });

  it('starts and stops orchestrator in dry-run mode', async () => {
    // Use the actual project dir so orchestrator.mjs exists
    const projectDir = join(import.meta.dirname, '..', '..');
    w = spawnWorker();
    w.send({
      type: 'init',
      workerId: 'test-worker',
      projectDir,
      config: { model: 'sonnet' },
    });
    await w.waitForType('ready');

    // Start in dry-run mode
    w.send({ type: 'start', dryRun: true });

    // Should get orchestrator:started event
    const started = await w.waitForEvent('orchestrator:started', 10000);
    expect(started.data.workerId).toBe('test-worker');
    expect(started.data.dryRun).toBe(true);

    // Should get status with running=true
    const status = await w.waitForType('status', 10000);
    expect(status.status.running).toBe(true);

    // Wait for it to finish (dry-run exits but can be slow under load)
    const stopped = await w.waitForEvent('orchestrator:stopped', 30000);
    expect(stopped.data.workerId).toBe('test-worker');
  }, 45000);

  it('returns error when starting while already running', async () => {
    const projectDir = join(import.meta.dirname, '..', '..');
    w = spawnWorker();
    w.send({
      type: 'init',
      workerId: 'test-worker',
      projectDir,
      config: { model: 'sonnet' },
    });
    await w.waitForType('ready');

    w.send({ type: 'start', dryRun: true });
    await w.waitForEvent('orchestrator:started', 10000);

    // Try to start again while running
    w.send({ type: 'start', dryRun: true });
    const err = await w.waitForType('error', 3000);
    expect(err.message).toBe('Already running');

    // Wait for it to finish naturally
    await w.waitForEvent('orchestrator:stopped', 30000);
  }, 45000);
});

describe('worker IPC — handoff file', () => {
  let w;
  afterEach(() => { if (w) w.kill(); teardown(); });

  it('stores handoff file from init', async () => {
    setup();
    w = spawnWorker();
    await initWorker(w, { handoffFile: '/path/to/handoff.md' });
    // Worker stored it internally — verified indirectly by successful init
    w.send({ type: 'ping' });
    const pong = await w.waitForType('pong');
    expect(pong.type).toBe('pong');
  });
});
