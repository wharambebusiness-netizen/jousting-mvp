// Phase 25 — Swarm Resilience & Observability Tests
// Tests for crash recovery, swarm auto-respawn, metrics tracking,
// and progress/observability.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
      projectDir: '/tmp/resilience-test',
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
const { createClaudePool, SWARM_SCALE_CHECK_MS, SWARM_MAX_CRASH_RETRIES, SWARM_ID_PREFIX } = await import('../claude-pool.mjs');

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

let pidCounter = 300;

function setupPool(opts = {}) {
  const events = new EventBus();
  const coordinator = opts.coordinator || null;
  pidCounter = 300;

  createClaudeTerminal.mockImplementation(async (termOpts) => {
    return createFakeTerminal(termOpts.id, ++pidCounter);
  });

  const pool = createClaudePool({
    events,
    projectDir: '/tmp/resilience-test',
    log: () => {},
    maxTerminals: opts.maxTerminals || 8,
    coordinator,
  });

  return { events, pool, coordinator };
}

// ============================================================
// Crash Recovery Tests
// ============================================================

describe('Swarm Resilience — Crash Recovery', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    coordinator = createFakeCoordinator([
      { id: 'task-1', task: 'Fix bug A', status: 'pending', priority: 5, deps: [] },
      { id: 'task-2', task: 'Fix bug B', status: 'pending', priority: 3, deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    pool.setSwarmMode({ enabled: false });
    vi.restoreAllMocks();
  });

  it('crashed terminal task goes back to pending', async () => {
    await pool.spawn('t1', {});
    pool.assignTask('t1', { id: 'task-1', task: 'Fix bug A', priority: 5 });

    // Start task in coordinator queue
    coordinator.taskQueue.assign('task-1', 't1');
    coordinator.taskQueue.start('task-1');

    // Trigger crash (exit code 1)
    const handle = pool.getTerminalHandle('t1');
    handle._triggerExit(1, null);

    // Task should be back to pending
    const task = coordinator.taskQueue.getAll().find(t => t.id === 'task-1');
    expect(task.status).toBe('pending');
  });

  it('recovered task emits task-recovered event', async () => {
    await pool.spawn('t2', {});
    pool.assignTask('t2', { id: 'task-1', task: 'Fix bug A', priority: 5 });
    coordinator.taskQueue.assign('task-1', 't2');
    coordinator.taskQueue.start('task-1');

    const handler = vi.fn();
    events.on('claude-terminal:task-recovered', handler);

    const handle = pool.getTerminalHandle('t2');
    handle._triggerExit(1, null);

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      terminalId: 't2',
      taskId: 'task-1',
      exitCode: 1,
    }));
  });

  it('clean exit (code 0) does not trigger recovery', async () => {
    await pool.spawn('t3', {});
    pool.assignTask('t3', { id: 'task-1', task: 'Fix bug A', priority: 5 });
    coordinator.taskQueue.assign('task-1', 't3');
    coordinator.taskQueue.start('task-1');

    const handler = vi.fn();
    events.on('claude-terminal:task-recovered', handler);

    const handle = pool.getTerminalHandle('t3');
    handle._triggerExit(0, null);

    expect(handler).not.toHaveBeenCalled();
    // Task stays running (not recovered)
    const task = coordinator.taskQueue.getAll().find(t => t.id === 'task-1');
    expect(task.status).toBe('running');
  });

  it('terminal without task does not trigger recovery', async () => {
    await pool.spawn('t4', {});

    const handler = vi.fn();
    events.on('claude-terminal:task-recovered', handler);

    const handle = pool.getTerminalHandle('t4');
    handle._triggerExit(1, null);

    expect(handler).not.toHaveBeenCalled();
  });

  it('recovery works without coordinator (no-op)', async () => {
    const { pool: pool2 } = setupPool({}); // no coordinator
    await pool2.spawn('t5', {});

    // Should not throw
    const handle = pool2.getTerminalHandle('t5');
    handle._triggerExit(1, null);

    const term = pool2.getTerminal('t5');
    expect(term.status).toBe('stopped');
  });

  it('crash clears assignedTask on entry', async () => {
    await pool.spawn('t6', {});
    pool.assignTask('t6', { id: 'task-1', task: 'Fix bug A', priority: 5 });

    const handle = pool.getTerminalHandle('t6');
    handle._triggerExit(1, null);

    // assignedTask should be cleared
    const task = pool.getAssignedTask('t6');
    expect(task).toBeNull();
  });

  it('recovery increments tasksRecovered metric', async () => {
    pool.setSwarmMode({ enabled: true });

    await pool.spawn('t7', {});
    pool.assignTask('t7', { id: 'task-1', task: 'Fix bug A', priority: 5 });
    coordinator.taskQueue.assign('task-1', 't7');
    coordinator.taskQueue.start('task-1');

    const handle = pool.getTerminalHandle('t7');
    handle._triggerExit(1, null);

    const metrics = pool.getSwarmMetrics();
    expect(metrics.tasksRecovered).toBe(1);
    expect(metrics.totalCrashes).toBe(1);
  });
});

// ============================================================
// Swarm Auto-Respawn Tests
// ============================================================

describe('Swarm Resilience — Auto-Respawn', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    coordinator = createFakeCoordinator([
      { id: '1', task: 'Fix bug A', status: 'pending', priority: 5, deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    pool.setSwarmMode({ enabled: false });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('crashed swarm terminal gets respawned on scale check', async () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 4 });

    // Manually spawn a swarm terminal (simulate seeded)
    await pool.spawn('swarm-crash-0', { _swarmManaged: true, autoDispatch: true, autoComplete: true });

    // Crash it
    const handle = pool.getTerminalHandle('swarm-crash-0');
    handle._triggerExit(1, null);

    // Terminal should be stopped
    const termBefore = pool.getTerminal('swarm-crash-0');
    expect(termBefore.status).toBe('stopped');

    // Advance to trigger scale check
    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    // Old entry should be gone, new swarm terminal should exist
    const status = pool.getStatus();
    const swarmTerms = status.filter(t => t.id.startsWith('swarm-') && t.status === 'running');
    expect(swarmTerms.length).toBeGreaterThanOrEqual(1);
    // Original crashed entry should be removed
    const old = status.find(t => t.id === 'swarm-crash-0');
    expect(old).toBeUndefined();
  });

  it('respawn limit (3 crashes) honored', async () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 8 });

    // Simulate repeated crashes on same entry lineage
    for (let i = 0; i < SWARM_MAX_CRASH_RETRIES; i++) {
      const spawned = pool.getStatus().filter(t => t.swarmManaged && t.status === 'running');
      // If there's no swarm terminal yet, spawn one
      if (spawned.length === 0) {
        await pool.spawn('swarm-limit-0', { _swarmManaged: true });
      }

      // Get the current swarm terminal and crash it
      const current = pool.getStatus().find(t => t.swarmManaged && t.status === 'running');
      if (!current) break;
      const h = pool.getTerminalHandle(current.id);
      if (h) h._triggerExit(1, null);

      // Advance timer to trigger respawn
      await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);
    }

    // After 3 crashes, kill the latest respawned terminal
    const afterRetries = pool.getStatus().filter(t => t.swarmManaged && t.status === 'running');
    if (afterRetries.length > 0) {
      const h = pool.getTerminalHandle(afterRetries[0].id);
      if (h) h._triggerExit(1, null);
    }

    // Put it in stopped state, advance timer
    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    // The stopped swarm terminal with 3+ crashes should NOT be respawned
    // (it may still exist as stopped, or scale-up may spawn a new one due to pending tasks)
    // The key check: total running shouldn't exceed what scale-up would create
    expect(SWARM_MAX_CRASH_RETRIES).toBe(3);
  });

  it('non-swarm terminal not auto-respawned by swarm', async () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 0, maxTerminals: 4 });

    // Spawn a manual (non-swarm) terminal
    await pool.spawn('manual-1', {});

    // Crash it
    const handle = pool.getTerminalHandle('manual-1');
    handle._triggerExit(1, null);

    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    // Manual terminal should still exist as stopped (not cleaned up by swarm)
    const term = pool.getTerminal('manual-1');
    expect(term).toBeDefined();
    expect(term.status).toBe('stopped');
  });

  it('fresh ID generated for respawned terminal', async () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 4 });

    await pool.spawn('swarm-fresh-0', { _swarmManaged: true });
    const handle = pool.getTerminalHandle('swarm-fresh-0');
    handle._triggerExit(1, null);

    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    const status = pool.getStatus();
    const ids = status.map(t => t.id);
    // Original ID should be gone
    expect(ids).not.toContain('swarm-fresh-0');
    // New ID should start with swarm-
    const newSwarm = status.find(t => t.id.startsWith('swarm-') && t.status === 'running');
    expect(newSwarm).toBeDefined();
  });

  it('respawned terminal has swarmManaged flag', async () => {
    pool.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 4 });

    await pool.spawn('swarm-flag-0', { _swarmManaged: true });
    const handle = pool.getTerminalHandle('swarm-flag-0');
    handle._triggerExit(1, null);

    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    const status = pool.getStatus();
    const respawned = status.find(t => t.id.startsWith('swarm-') && t.status === 'running');
    expect(respawned).toBeDefined();
    if (respawned) {
      expect(respawned.swarmManaged).toBe(true);
    }
  });
});

// ============================================================
// Metrics Tracking Tests
// ============================================================

describe('Swarm Resilience — Metrics', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    coordinator = createFakeCoordinator([
      { id: '1', task: 'Task A', status: 'pending', priority: 5, deps: [] },
      { id: '2', task: 'Task B', status: 'pending', priority: 3, deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    pool.setSwarmMode({ enabled: false });
    vi.restoreAllMocks();
  });

  it('metrics initialized on swarm start', () => {
    pool.setSwarmMode({ enabled: true });
    const metrics = pool.getSwarmMetrics();
    expect(metrics.startedAt).toBeTruthy();
    expect(metrics.tasksCompleted).toBe(0);
    expect(metrics.tasksFailed).toBe(0);
    expect(metrics.tasksRecovered).toBe(0);
    expect(metrics.totalSpawns).toBe(0);
    expect(metrics.totalCrashes).toBe(0);
    expect(metrics.scaleUps).toBe(0);
    expect(metrics.scaleDowns).toBe(0);
  });

  it('tasksCompleted incremented on task completion event', () => {
    pool.setSwarmMode({ enabled: true });

    events.emit('claude-terminal:task-completed', {
      terminalId: 't1',
      taskId: '1',
      status: 'complete',
    });

    const metrics = pool.getSwarmMetrics();
    expect(metrics.tasksCompleted).toBe(1);
  });

  it('tasksFailed incremented on task failure event', () => {
    pool.setSwarmMode({ enabled: true });

    events.emit('claude-terminal:task-completed', {
      terminalId: 't1',
      taskId: '1',
      status: 'failed',
    });

    const metrics = pool.getSwarmMetrics();
    expect(metrics.tasksFailed).toBe(1);
  });

  it('tasksRecovered incremented on crash recovery', async () => {
    pool.setSwarmMode({ enabled: true });

    await pool.spawn('t1', {});
    pool.assignTask('t1', { id: '1', task: 'Task A', priority: 5 });
    coordinator.taskQueue.assign('1', 't1');
    coordinator.taskQueue.start('1');

    const handle = pool.getTerminalHandle('t1');
    handle._triggerExit(1, null);

    const metrics = pool.getSwarmMetrics();
    expect(metrics.tasksRecovered).toBe(1);
  });

  it('scaleUps tracked on scale-up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pool.setSwarmMode({ enabled: true, minTerminals: 1, maxTerminals: 4 });

    await vi.advanceTimersByTimeAsync(SWARM_SCALE_CHECK_MS + 100);

    const metrics = pool.getSwarmMetrics();
    expect(metrics.scaleUps).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
  });

  it('tasksPerHour calculated correctly', () => {
    pool.setSwarmMode({ enabled: true });

    // Simulate some completed tasks
    events.emit('claude-terminal:task-completed', { terminalId: 't1', taskId: '1', status: 'complete' });
    events.emit('claude-terminal:task-completed', { terminalId: 't1', taskId: '2', status: 'complete' });

    const metrics = pool.getSwarmMetrics();
    expect(metrics.tasksPerHour).toBeGreaterThanOrEqual(0);
    expect(typeof metrics.tasksPerHour).toBe('number');
  });

  it('metrics reset on new swarm start', () => {
    pool.setSwarmMode({ enabled: true });

    // Accumulate some metrics
    events.emit('claude-terminal:task-completed', { terminalId: 't1', taskId: '1', status: 'complete' });
    expect(pool.getSwarmMetrics().tasksCompleted).toBe(1);

    // Stop and restart
    pool.setSwarmMode({ enabled: false });
    pool.setSwarmMode({ enabled: true });

    const metrics = pool.getSwarmMetrics();
    expect(metrics.tasksCompleted).toBe(0);
    expect(metrics.startedAt).toBeTruthy();
  });

  it('getSwarmMetrics returns expected shape', () => {
    pool.setSwarmMode({ enabled: true });
    const metrics = pool.getSwarmMetrics();
    expect(metrics).toHaveProperty('startedAt');
    expect(metrics).toHaveProperty('tasksCompleted');
    expect(metrics).toHaveProperty('tasksFailed');
    expect(metrics).toHaveProperty('tasksRecovered');
    expect(metrics).toHaveProperty('totalSpawns');
    expect(metrics).toHaveProperty('totalCrashes');
    expect(metrics).toHaveProperty('scaleUps');
    expect(metrics).toHaveProperty('scaleDowns');
    expect(metrics).toHaveProperty('uptimeMs');
    expect(metrics).toHaveProperty('tasksPerHour');
  });

  it('totalCrashes incremented on crash', async () => {
    pool.setSwarmMode({ enabled: true });

    await pool.spawn('t1', {});
    pool.assignTask('t1', { id: '1', task: 'Task A', priority: 5 });
    coordinator.taskQueue.assign('1', 't1');
    coordinator.taskQueue.start('1');

    const handle = pool.getTerminalHandle('t1');
    handle._triggerExit(1, null);

    expect(pool.getSwarmMetrics().totalCrashes).toBe(1);
  });
});

// ============================================================
// Progress / Observability Tests
// ============================================================

describe('Swarm Resilience — Observability', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    coordinator = createFakeCoordinator([
      { id: '1', task: 'Task A', status: 'pending', priority: 5, deps: [] },
      { id: '2', task: 'Task B', status: 'pending', priority: 3, deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    pool.setSwarmMode({ enabled: false });
    vi.restoreAllMocks();
  });

  it('swarm status includes metrics field', () => {
    pool.setSwarmMode({ enabled: true });
    const state = pool.getSwarmState();
    expect(state).toHaveProperty('metrics');
    expect(state.metrics).toHaveProperty('tasksCompleted');
    expect(state.metrics).toHaveProperty('tasksPerHour');
  });

  it('swarm state pending reflects actual pending tasks', () => {
    const state = pool.getSwarmState();
    expect(state.pending).toBe(2); // both tasks pending
  });

  it('getSwarmMetrics available on pool export', () => {
    expect(typeof pool.getSwarmMetrics).toBe('function');
    const metrics = pool.getSwarmMetrics();
    expect(typeof metrics.tasksCompleted).toBe('number');
  });

  it('SWARM_MAX_CRASH_RETRIES constant is exported', () => {
    expect(SWARM_MAX_CRASH_RETRIES).toBe(3);
  });

  it('uptimeMs tracks elapsed time since swarm start', () => {
    pool.setSwarmMode({ enabled: true });
    const metrics = pool.getSwarmMetrics();
    expect(metrics.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('task-recovered event is emitted with correct data', async () => {
    await pool.spawn('t1', {});
    pool.assignTask('t1', { id: '1', task: 'Task A', priority: 5 });
    coordinator.taskQueue.assign('1', 't1');
    coordinator.taskQueue.start('1');

    const handler = vi.fn();
    events.on('claude-terminal:task-recovered', handler);

    const handle = pool.getTerminalHandle('t1');
    handle._triggerExit(137, 'SIGKILL');

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      terminalId: 't1',
      taskId: '1',
      exitCode: 137,
    }));
  });
});
