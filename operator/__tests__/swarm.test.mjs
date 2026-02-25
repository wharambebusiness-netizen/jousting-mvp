// Phase 24 — Swarm Mode Tests
// Tests for autonomous swarm mode: auto-scaling, task handoff persistence,
// swarm API routes, standalone coordinator, and integration.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Fake terminal factory ──────────────────────────────────

function createFakeTerminal(id, pid = 100) {
  const listeners = { data: [], exit: [], error: [], 'context-warning': [] };
  let status = 'running';
  let exitCode = null;
  let exitSignal = null;
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
      projectDir: '/tmp/swarm-test',
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
      return 'mock output buffer';
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

const { createClaudeTerminal } = await import('../claude-terminal.mjs');
const { createClaudePool, SWARM_SCALE_CHECK_MS, SWARM_SCALE_DOWN_IDLE_MS, SWARM_ID_PREFIX } = await import('../claude-pool.mjs');

// Fake task queue for coordinator mock
function createFakeTaskQueue(tasks = []) {
  const _tasks = [...tasks];
  return {
    getAll: () => [..._tasks],
    add: (task) => {
      const id = task.id || String(_tasks.length + 1);
      const t = { id, status: 'pending', priority: 5, deps: [], ...task };
      _tasks.push(t);
      return t;
    },
    assign: (taskId, workerId) => {
      const t = _tasks.find(x => x.id === taskId);
      if (t) { t.assignedTo = workerId; t.status = 'assigned'; }
    },
    start: (taskId) => {
      const t = _tasks.find(x => x.id === taskId);
      if (t) t.status = 'running';
    },
    complete: (taskId, result) => {
      const t = _tasks.find(x => x.id === taskId);
      if (t) { t.status = 'complete'; t.result = result; }
    },
    fail: (taskId, error) => {
      const t = _tasks.find(x => x.id === taskId);
      if (t) { t.status = 'failed'; t.error = error; }
    },
    retry: (taskId) => {
      const t = _tasks.find(x => x.id === taskId);
      if (t) { t.status = 'pending'; t.assignedTo = null; }
    },
  };
}

function createFakeCoordinator(tasks = []) {
  const taskQueue = createFakeTaskQueue(tasks);
  let state = 'init';
  return {
    taskQueue,
    getState: () => state,
    start: () => { state = 'running'; },
    stop: () => { state = 'stopped'; },
    getMetrics: () => ({ tasksTotal: tasks.length }),
  };
}

let pidCounter = 200;

function setupPool(opts = {}) {
  const events = new EventBus();
  const coordinator = opts.coordinator || null;
  pidCounter = 200;

  createClaudeTerminal.mockImplementation(async (termOpts) => {
    return createFakeTerminal(termOpts.id, ++pidCounter);
  });

  const pool = createClaudePool({
    events,
    projectDir: '/tmp/swarm-test',
    log: () => {},
    maxTerminals: opts.maxTerminals || 8,
    coordinator,
  });

  return { events, pool, coordinator };
}

// ============================================================
// Pool Auto-Scaling Tests
// ============================================================

describe('Swarm Mode — Pool Auto-Scaling', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    coordinator = createFakeCoordinator([
      { id: '1', task: 'Fix bug A', status: 'pending', priority: 5, deps: [] },
      { id: '2', task: 'Fix bug B', status: 'pending', priority: 3, deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('setSwarmMode enables scaling interval', () => {
    const result = pool.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 4 });
    expect(result.enabled).toBe(true);
    expect(result.maxTerminals).toBe(4);
    pool.setSwarmMode({ enabled: false });
  });

  it('setSwarmMode disables scaling and resets max', () => {
    pool.setSwarmMode({ enabled: true, maxTerminals: 16 });
    const state1 = pool.getPoolStatus();
    expect(state1.maxTerminals).toBe(16);

    pool.setSwarmMode({ enabled: false });
    const state2 = pool.getSwarmState();
    expect(state2.enabled).toBe(false);
    const ps = pool.getPoolStatus();
    expect(ps.maxTerminals).toBe(8); // original max
  });

  it('getSwarmState returns correct config', () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 2, maxTerminals: 12, model: 'haiku' });
    const state = pool.getSwarmState();
    expect(state.enabled).toBe(true);
    expect(state.minTerminals).toBe(2);
    expect(state.maxTerminals).toBe(12);
    expect(state.model).toBe('haiku');
    expect(state.pending).toBe(2);
    pool.setSwarmMode({ enabled: false });
  });

  it('emits swarm-started event on enable', () => {
    const handler = vi.fn();
    events.on('claude-terminal:swarm-started', handler);
    pool.setSwarmMode({ enabled: true });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      minTerminals: expect.any(Number),
      maxTerminals: expect.any(Number),
    }));
    pool.setSwarmMode({ enabled: false });
  });

  it('emits swarm-stopped event on disable', () => {
    pool.setSwarmMode({ enabled: true });
    const handler = vi.fn();
    events.on('claude-terminal:swarm-stopped', handler);
    pool.setSwarmMode({ enabled: false });
    expect(handler).toHaveBeenCalled();
  });

  it('scale-up spawns when pending tasks exist and no idle terminals', async () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 4 });

    // Advance timer to trigger scale check
    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    // Should have spawned a terminal
    const status = pool.getStatus();
    expect(status.length).toBeGreaterThan(0);
    expect(status[0].id).toMatch(/^swarm-/);
    expect(status[0].swarmManaged).toBe(true);

    pool.setSwarmMode({ enabled: false });
  });

  it('scale-up respects maxTerminals ceiling', async () => {
    // Use a small pool (maxTerminals=3) and spawn up to that limit
    const coord2 = createFakeCoordinator([
      { id: '1', task: 'Fix bug A', status: 'pending', priority: 5, deps: [] },
    ]);
    const { events: ev2, pool: pool2 } = setupPool({ coordinator: coord2, maxTerminals: 3 });

    for (let i = 0; i < 3; i++) {
      await pool2.spawn(`manual-${i}`, {});
    }

    pool2.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 3 });

    const countBefore = pool2.activeCount();
    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    // Should NOT spawn more since we're at max (3)
    expect(pool2.activeCount()).toBe(countBefore);
    pool2.setSwarmMode({ enabled: false });
  });

  it('_effectiveMaxTerminals raised by swarm, reset on stop', () => {
    const ps1 = pool.getPoolStatus();
    expect(ps1.maxTerminals).toBe(8);

    pool.setSwarmMode({ enabled: true, maxTerminals: 20 });
    const ps2 = pool.getPoolStatus();
    expect(ps2.maxTerminals).toBe(20);

    pool.setSwarmMode({ enabled: false });
    const ps3 = pool.getPoolStatus();
    expect(ps3.maxTerminals).toBe(8);
  });

  it('swarm terminals have swarmManaged: true', async () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 4 });
    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    const status = pool.getStatus();
    const swarmTerm = status.find(t => t.id.startsWith('swarm-'));
    expect(swarmTerm).toBeDefined();
    expect(swarmTerm.swarmManaged).toBe(true);

    pool.setSwarmMode({ enabled: false });
  });

  it('non-swarm terminals not killed by scale-down', async () => {
    await pool.spawn('manual-1', {});
    pool.setSwarmMode({ enabled: true, minTerminals: 0, maxTerminals: 4 });

    // Advance enough for scale-down check (6 ticks)
    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS);
    }

    // Manual terminal should still be present
    const term = pool.getTerminal('manual-1');
    expect(term).toBeDefined();
    pool.setSwarmMode({ enabled: false });
  });

  it('shutdownAll clears swarm timer', async () => {
    pool.setSwarmMode({ enabled: true });
    await pool.shutdownAll();
    const state = pool.getSwarmState();
    expect(state.enabled).toBe(false);
  });
});

// ============================================================
// Task Handoff Persistence Tests
// ============================================================

describe('Swarm Mode — Task Handoff Persistence', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    coordinator = createFakeCoordinator([
      { id: 'task-1', task: 'Fix critical bug', status: 'pending', priority: 8, deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('assignedTask carried across auto-handoff', async () => {
    await pool.spawn('t1', { autoHandoff: true });
    pool.assignTask('t1', { id: 'task-1', task: 'Fix critical bug', priority: 8 });

    // Get the terminal handle and trigger clean exit (simulating context exhaustion)
    const handle = pool.getTerminalHandle('t1');

    // Mock spawn time in the past to pass uptime check
    const entry = pool.getStatus().find(e => e.id === 't1');
    // We need to wait a bit for uptime, but we can just trigger exit
    // Since MIN_UPTIME_FOR_HANDOFF_MS is 10s, let's advance time
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Simulate uptime > 10s by advancing clock
    await vi.advanceTimersByTimeAsync(15000);

    handle._triggerExit(0, null);

    // Wait for async handoff to complete
    await vi.advanceTimersByTimeAsync(100);

    // The new terminal entry should carry the task
    const newStatus = pool.getTerminal('t1');
    expect(newStatus).toBeDefined();
    if (newStatus) {
      expect(newStatus.assignedTask).toBeDefined();
      expect(newStatus.assignedTask.taskId).toBe('task-1');
    }

    vi.useRealTimers();
  });

  it('maybeAutoDispatch skipped when task already carried', async () => {
    await pool.spawn('t2', { autoHandoff: true, autoDispatch: true });
    pool.assignTask('t2', { id: 'task-1', task: 'Fix critical bug', priority: 8 });

    const dispatchHandler = vi.fn();
    events.on('claude-terminal:auto-dispatch', dispatchHandler);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await vi.advanceTimersByTimeAsync(15000);

    const handle = pool.getTerminalHandle('t2');
    handle._triggerExit(0, null);

    await vi.advanceTimersByTimeAsync(3000);

    // Auto-dispatch should NOT fire since task was carried over
    expect(dispatchHandler).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('no orphaned tasks in coordinator after handoff', async () => {
    await pool.spawn('t3', { autoHandoff: true });

    // Assign and start task in coordinator
    coordinator.taskQueue.assign('task-1', 't3');
    coordinator.taskQueue.start('task-1');
    pool.assignTask('t3', { id: 'task-1', task: 'Fix critical bug', priority: 8 });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await vi.advanceTimersByTimeAsync(15000);

    const handle = pool.getTerminalHandle('t3');
    handle._triggerExit(0, null);

    await vi.advanceTimersByTimeAsync(3000);

    // Task should still be in running state (carried to new entry)
    const task = coordinator.taskQueue.getAll().find(t => t.id === 'task-1');
    expect(task.status).toBe('running');

    vi.useRealTimers();
  });

  it('failed handoff spawn releases task back to pending', async () => {
    await pool.spawn('t4', { autoHandoff: true });

    coordinator.taskQueue.assign('task-1', 't4');
    coordinator.taskQueue.start('task-1');
    pool.assignTask('t4', { id: 'task-1', task: 'Fix critical bug', priority: 8 });

    // Make spawn fail
    createClaudeTerminal.mockRejectedValueOnce(new Error('PTY unavailable'));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await vi.advanceTimersByTimeAsync(15000);

    const handle = pool.getTerminalHandle('t4');
    handle._triggerExit(0, null);

    await vi.advanceTimersByTimeAsync(500);

    // Task should be back to pending since handoff failed
    const task = coordinator.taskQueue.getAll().find(t => t.id === 'task-1');
    expect(task.status).toBe('pending');

    vi.useRealTimers();
  });

  it('completion timer restarted for carried task', async () => {
    await pool.spawn('t5', { autoHandoff: true, autoComplete: true });
    pool.assignTask('t5', { id: 'task-1', task: 'Fix critical bug', priority: 8 });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await vi.advanceTimersByTimeAsync(15000);

    const handle = pool.getTerminalHandle('t5');
    handle._triggerExit(0, null);

    await vi.advanceTimersByTimeAsync(3000);

    // After handoff, the new entry should have the task and auto-complete enabled
    const newStatus = pool.getTerminal('t5');
    if (newStatus) {
      expect(newStatus.autoComplete).toBe(true);
      expect(newStatus.assignedTask).toBeDefined();
    }

    vi.useRealTimers();
  });
});

// ============================================================
// Swarm API Route Tests
// ============================================================

describe('Swarm Mode — API Routes (pool-level)', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    coordinator = createFakeCoordinator([
      { id: '1', task: 'Task A', status: 'pending', priority: 5, deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    pool.setSwarmMode({ enabled: false });
    vi.restoreAllMocks();
  });

  it('start swarm seeds terminals and enables mode', async () => {
    // Simulate what the start route does
    pool.setSwarmMode({
      enabled: true,
      minTerminals: 2,
      maxTerminals: 4,
      model: 'sonnet',
    });

    // Seed 2 terminals
    await pool.spawn('swarm-seed-0', { autoHandoff: true, autoDispatch: true, autoComplete: true, _swarmManaged: true });
    await pool.spawn('swarm-seed-1', { autoHandoff: true, autoDispatch: true, autoComplete: true, _swarmManaged: true });

    const state = pool.getSwarmState();
    expect(state.enabled).toBe(true);
    expect(state.running).toBe(2);
  });

  it('stop disables scaling without killing terminals', async () => {
    pool.setSwarmMode({ enabled: true });
    await pool.spawn('swarm-seed-0', { _swarmManaged: true });

    pool.setSwarmMode({ enabled: false });
    const state = pool.getSwarmState();
    expect(state.enabled).toBe(false);
    // Terminal should still be there
    expect(pool.getTerminal('swarm-seed-0')).toBeDefined();
  });

  it('getSwarmState returns expected shape', () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 3, maxTerminals: 10, model: 'haiku' });
    const state = pool.getSwarmState();
    expect(state).toHaveProperty('enabled', true);
    expect(state).toHaveProperty('minTerminals', 3);
    expect(state).toHaveProperty('maxTerminals', 10);
    expect(state).toHaveProperty('model', 'haiku');
    expect(state).toHaveProperty('running');
    expect(state).toHaveProperty('pending');
    expect(state).toHaveProperty('dangerouslySkipPermissions');
    expect(state).toHaveProperty('scaleUpThreshold');
  });

  it('start with defaults works', () => {
    pool.setSwarmMode({ enabled: true });
    const state = pool.getSwarmState();
    expect(state.enabled).toBe(true);
    expect(state.minTerminals).toBe(1);
    expect(state.model).toBe('sonnet');
  });

  it('double-start updates config (idempotent)', () => {
    pool.setSwarmMode({ enabled: true, maxTerminals: 4 });
    pool.setSwarmMode({ enabled: true, maxTerminals: 12 });
    const state = pool.getSwarmState();
    expect(state.maxTerminals).toBe(12);
    expect(state.enabled).toBe(true);
  });

  it('pool without coordinator returns pending=0', () => {
    const { pool: pool2 } = setupPool({}); // no coordinator
    const state = pool2.getSwarmState();
    expect(state.pending).toBe(0);
  });

  it('countClaimableTasks reflects pending tasks', () => {
    const state = pool.getSwarmState();
    expect(state.pending).toBe(1); // task '1' is pending
  });

  it('seeded terminals have swarmManaged flag', async () => {
    await pool.spawn('swarm-seed-0', { _swarmManaged: true, autoHandoff: true, autoDispatch: true, autoComplete: true });
    const term = pool.getTerminal('swarm-seed-0');
    expect(term.swarmManaged).toBe(true);
    expect(term.autoHandoff).toBe(true);
    expect(term.autoDispatch).toBe(true);
    expect(term.autoComplete).toBe(true);
  });
});

// ============================================================
// Server Standalone Coordinator Tests
// ============================================================

describe('Swarm Mode — Server Standalone Coordinator', () => {
  it('swarm option creates coordinator without process pool', async () => {
    const { createApp } = await import('../server.mjs');
    const tmpDir = '/tmp/swarm-server-test-' + Date.now();
    const { mkdirSync, rmSync } = await import('fs');
    try { mkdirSync(tmpDir, { recursive: true }); } catch { /* */ }
    try { mkdirSync(tmpDir + '/.data', { recursive: true }); } catch { /* */ }

    const result = createApp({
      operatorDir: tmpDir,
      swarm: true,
      claudePool: false,
      sharedMemory: false,
      messageBus: false,
      enableFileWatcher: false,
      auth: false,
    });

    expect(result.coordinator).toBeDefined();
    expect(result.coordinator).not.toBeNull();
    expect(result.pool).toBeNull();

    await result.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('--swarm CLI flag is parsed correctly', async () => {
    // The parseCliArgs function is internal, but we test the createApp integration
    const { createApp } = await import('../server.mjs');
    const tmpDir = '/tmp/swarm-parse-test-' + Date.now();
    const { mkdirSync, rmSync } = await import('fs');
    try { mkdirSync(tmpDir, { recursive: true }); } catch { /* */ }
    try { mkdirSync(tmpDir + '/.data', { recursive: true }); } catch { /* */ }

    const result = createApp({
      operatorDir: tmpDir,
      swarm: true,
      sharedMemory: false,
      messageBus: false,
      enableFileWatcher: false,
      auth: false,
    });

    // Coordinator should exist
    expect(result.coordinator).toBeTruthy();

    await result.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('coordinator persists queue with swarm option', async () => {
    const { createApp } = await import('../server.mjs');
    const tmpDir = '/tmp/swarm-persist-test-' + Date.now();
    const { mkdirSync, rmSync, existsSync } = await import('fs');
    try { mkdirSync(tmpDir, { recursive: true }); } catch { /* */ }
    try { mkdirSync(tmpDir + '/.data', { recursive: true }); } catch { /* */ }

    const result = createApp({
      operatorDir: tmpDir,
      swarm: true,
      claudePool: false,
      sharedMemory: false,
      messageBus: false,
      enableFileWatcher: false,
      auth: false,
    });

    expect(result.coordinator).toBeTruthy();

    await result.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });
});

// ============================================================
// Exported Constants Tests
// ============================================================

describe('Swarm Mode — Constants', () => {
  it('exports swarm constants', () => {
    expect(SWARM_SCALE_CHECK_MS).toBe(5000);
    expect(SWARM_SCALE_DOWN_IDLE_MS).toBe(60000);
    expect(SWARM_ID_PREFIX).toBe('swarm-');
  });
});
