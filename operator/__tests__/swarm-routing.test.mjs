// Phase 26 — Swarm Task Routing & Smart Assignment Tests
// Tests for affinity-based task selection, capability filtering,
// and integration with auto-dispatch and claim-task.
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
      projectDir: '/tmp/routing-test',
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
const {
  createClaudePool,
  MAX_TASK_HISTORY,
  AFFINITY_CATEGORY_BONUS,
  AFFINITY_RECENT_BONUS,
  AUTO_DISPATCH_DELAY_MS,
} = await import('../claude-pool.mjs');

// Fake task queue for coordinator mock
function createFakeTaskQueue(tasks = []) {
  const _tasks = [...tasks];
  return {
    getAll: () => [..._tasks],
    add: (task) => {
      const id = task.id || String(_tasks.length + 1);
      const t = { id, status: 'pending', priority: 5, deps: [], category: null, ...task };
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

let pidCounter = 400;

function setupPool(opts = {}) {
  const events = new EventBus();
  const coordinator = opts.coordinator || null;
  pidCounter = 400;

  createClaudeTerminal.mockImplementation(async (termOpts) => {
    return createFakeTerminal(termOpts.id, ++pidCounter);
  });

  const pool = createClaudePool({
    events,
    projectDir: '/tmp/routing-test',
    log: () => {},
    maxTerminals: opts.maxTerminals || 8,
    coordinator,
  });

  return { events, pool, coordinator };
}

// ============================================================
// Affinity Scoring Tests
// ============================================================

describe('Swarm Routing — Affinity Scoring', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    coordinator = createFakeCoordinator([
      { id: 'code-1', task: 'Write feature', status: 'pending', priority: 5, category: 'code', deps: [] },
      { id: 'test-1', task: 'Write tests', status: 'pending', priority: 5, category: 'test', deps: [] },
      { id: 'docs-1', task: 'Write docs', status: 'pending', priority: 5, category: 'docs', deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('terminal with code history prefers code task over test task', async () => {
    await pool.spawn('t1', {});

    // Simulate history: terminal completed a code task before
    events.emit('claude-terminal:task-completed', {
      terminalId: 't1', taskId: 'prev-1', status: 'complete', category: 'code',
    });

    const task = pool.findNextClaimableTask('t1');
    expect(task).toBeDefined();
    expect(task.category).toBe('code');
  });

  it('terminal with test history prefers test task', async () => {
    await pool.spawn('t2', {});

    events.emit('claude-terminal:task-completed', {
      terminalId: 't2', taskId: 'prev-2', status: 'complete', category: 'test',
    });

    const task = pool.findNextClaimableTask('t2');
    expect(task.category).toBe('test');
  });

  it('priority still wins when affinity is equal', async () => {
    // Override tasks: high-priority test, low-priority code
    coordinator = createFakeCoordinator([
      { id: 'code-hp', task: 'Write code', status: 'pending', priority: 3, category: 'code', deps: [] },
      { id: 'test-hp', task: 'Write test', status: 'pending', priority: 10, category: 'test', deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
    await pool.spawn('t3', {});

    // No history — should pick highest priority
    const task = pool.findNextClaimableTask('t3');
    expect(task.id).toBe('test-hp');
  });

  it('affinity bonus can override lower priority', async () => {
    // code: priority 5, test: priority 6 (only 1 higher)
    // With affinity bonus of +2 for code, code should win: 5+2=7 > 6
    coordinator = createFakeCoordinator([
      { id: 'code-a', task: 'Write code', status: 'pending', priority: 5, category: 'code', deps: [] },
      { id: 'test-a', task: 'Write test', status: 'pending', priority: 6, category: 'test', deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
    await pool.spawn('t4', {});

    events.emit('claude-terminal:task-completed', {
      terminalId: 't4', taskId: 'prev', status: 'complete', category: 'code',
    });

    const task = pool.findNextClaimableTask('t4');
    expect(task.category).toBe('code');
  });

  it('no history falls back to priority-only', async () => {
    await pool.spawn('t5', {});

    // No history — should pick first by priority (all same priority = first pending)
    const task = pool.findNextClaimableTask('t5');
    expect(task).toBeDefined();
    // All priority 5 — should return one of them
    expect(['code-1', 'test-1', 'docs-1']).toContain(task.id);
  });

  it('history capped at MAX_TASK_HISTORY entries', async () => {
    await pool.spawn('t6', {});

    // Emit MAX_TASK_HISTORY + 2 completions
    for (let i = 0; i < MAX_TASK_HISTORY + 2; i++) {
      events.emit('claude-terminal:task-completed', {
        terminalId: 't6', taskId: `past-${i}`, status: 'complete', category: 'old',
      });
    }

    const terminal = pool.getTerminal('t6');
    expect(terminal.taskHistory.length).toBe(MAX_TASK_HISTORY);
  });

  it('most recent category gets extra bonus', async () => {
    // Two tasks: code priority 5, docs priority 5
    // History: [docs, code] — most recent is code → code gets +2 +1 = +3, docs gets +2
    coordinator = createFakeCoordinator([
      { id: 'code-r', task: 'Write code', status: 'pending', priority: 5, category: 'code', deps: [] },
      { id: 'docs-r', task: 'Write docs', status: 'pending', priority: 5, category: 'docs', deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
    await pool.spawn('t7', {});

    events.emit('claude-terminal:task-completed', {
      terminalId: 't7', taskId: 'p1', status: 'complete', category: 'docs',
    });
    events.emit('claude-terminal:task-completed', {
      terminalId: 't7', taskId: 'p2', status: 'complete', category: 'code',
    });

    const task = pool.findNextClaimableTask('t7');
    expect(task.category).toBe('code');
  });

  it('without terminalId returns priority-only (backward compat)', () => {
    const task = pool.findNextClaimableTask();
    expect(task).toBeDefined();
  });

  it('non-existent terminalId falls back to priority-only', () => {
    const task = pool.findNextClaimableTask('nonexistent');
    expect(task).toBeDefined();
  });

  it('failed tasks do not add to history', async () => {
    await pool.spawn('t8', {});

    events.emit('claude-terminal:task-completed', {
      terminalId: 't8', taskId: 'f1', status: 'failed', category: 'code',
    });

    const terminal = pool.getTerminal('t8');
    expect(terminal.taskHistory.length).toBe(0);
  });
});

// ============================================================
// Capabilities Filtering Tests
// ============================================================

describe('Swarm Routing — Capabilities Filtering', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    coordinator = createFakeCoordinator([
      { id: 'code-1', task: 'Write feature', status: 'pending', priority: 5, category: 'code', deps: [] },
      { id: 'test-1', task: 'Write tests', status: 'pending', priority: 5, category: 'test', deps: [] },
      { id: 'docs-1', task: 'Write docs', status: 'pending', priority: 5, category: 'docs', deps: [] },
      { id: 'null-1', task: 'Generic task', status: 'pending', priority: 5, category: null, deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('terminal with capabilities=["code"] skips test tasks', async () => {
    await pool.spawn('cap1', { capabilities: ['code'] });

    const task = pool.findNextClaimableTask('cap1');
    expect(task).toBeDefined();
    // Should pick code or null (both pass filter), not test or docs
    expect(['code-1', 'null-1']).toContain(task.id);
  });

  it('terminal with no capabilities accepts all tasks', async () => {
    await pool.spawn('cap2', {});

    const task = pool.findNextClaimableTask('cap2');
    expect(task).toBeDefined();
    // All tasks are eligible
  });

  it('tasks with null category always pass capabilities check', async () => {
    // Terminal can only do "review" (not in any task category)
    await pool.spawn('cap3', { capabilities: ['review'] });

    const task = pool.findNextClaimableTask('cap3');
    // Only null-category task should pass
    expect(task).toBeDefined();
    expect(task.id).toBe('null-1');
  });

  it('capabilities set via setCapabilities API', async () => {
    await pool.spawn('cap4', {});

    // Initially no capabilities, all tasks eligible
    const task1 = pool.findNextClaimableTask('cap4');
    expect(task1).toBeDefined();

    // Set capabilities to test-only
    pool.setCapabilities('cap4', ['test']);

    const task2 = pool.findNextClaimableTask('cap4');
    expect(task2).toBeDefined();
    // Should be test or null
    expect(['test-1', 'null-1']).toContain(task2.id);
  });

  it('setCapabilities with null clears filter', async () => {
    await pool.spawn('cap5', { capabilities: ['code'] });

    pool.setCapabilities('cap5', null);

    const terminal = pool.getTerminal('cap5');
    expect(terminal.capabilities).toBeNull();
  });

  it('capabilities returned in formatEntry', async () => {
    await pool.spawn('cap6', { capabilities: ['code', 'test'] });

    const terminal = pool.getTerminal('cap6');
    expect(terminal.capabilities).toEqual(['code', 'test']);
  });

  it('no claimable tasks returns null when all filtered', async () => {
    // Only has tasks for code, test, docs, null
    // Set capabilities to something that doesn't match any categorized task
    // but null-category task still passes
    coordinator = createFakeCoordinator([
      { id: 'code-x', task: 'Code', status: 'pending', priority: 5, category: 'code', deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
    await pool.spawn('cap7', { capabilities: ['review'] });

    const task = pool.findNextClaimableTask('cap7');
    // code-x doesn't match 'review' capability, no null tasks → null
    expect(task).toBeNull();
  });

  it('setCapabilities returns false for missing terminal', () => {
    const result = pool.setCapabilities('nonexistent', ['code']);
    expect(result).toBe(false);
  });
});

// ============================================================
// Integration Tests
// ============================================================

describe('Swarm Routing — Integration', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    coordinator = createFakeCoordinator([
      { id: 'code-i', task: 'Write feature', status: 'pending', priority: 5, category: 'code', deps: [] },
      { id: 'test-i', task: 'Run tests', status: 'pending', priority: 5, category: 'test', deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
  });

  afterEach(() => {
    pool.setSwarmMode({ enabled: false });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('auto-dispatch uses affinity scoring', async () => {
    await pool.spawn('ad1', { autoDispatch: true });

    // Give terminal code history
    events.emit('claude-terminal:task-completed', {
      terminalId: 'ad1', taskId: 'prev', status: 'complete', category: 'code',
    });

    // Trigger auto-dispatch
    const handler = vi.fn();
    events.on('claude-terminal:auto-dispatch', handler);

    // Emit completion to trigger auto-dispatch (which uses findNextClaimableTask(terminalId))
    events.emit('claude-terminal:task-completed', {
      terminalId: 'ad1', taskId: 'prev2', status: 'complete', category: 'code',
    });

    // Advance past AUTO_DISPATCH_DELAY_MS
    await vi.advanceTimersByTimeAsync(AUTO_DISPATCH_DELAY_MS + 100);

    expect(handler).toHaveBeenCalled();
    const dispatched = handler.mock.calls[0][0];
    // Should prefer code task due to affinity
    expect(dispatched.taskId).toBe('code-i');
  });

  it('swarm terminals inherit affinity from completed tasks', async () => {
    await pool.spawn('sw1', { _swarmManaged: true, autoDispatch: true });

    // Complete a code task
    pool.assignTask('sw1', { id: 'code-i', task: 'Write feature', category: 'code', priority: 5 });
    coordinator.taskQueue.assign('code-i', 'sw1');
    coordinator.taskQueue.start('code-i');
    coordinator.taskQueue.complete('code-i', 'done');
    pool.releaseTask('sw1');

    events.emit('claude-terminal:task-completed', {
      terminalId: 'sw1', taskId: 'code-i', status: 'complete', category: 'code',
    });

    // Terminal now has code in history
    const terminal = pool.getTerminal('sw1');
    expect(terminal.taskHistory).toContain('code');
  });

  it('taskHistory exposed in getStatus', async () => {
    await pool.spawn('th1', {});

    events.emit('claude-terminal:task-completed', {
      terminalId: 'th1', taskId: 'x', status: 'complete', category: 'code',
    });
    events.emit('claude-terminal:task-completed', {
      terminalId: 'th1', taskId: 'y', status: 'complete', category: 'test',
    });

    const all = pool.getStatus();
    const t = all.find(x => x.id === 'th1');
    expect(t.taskHistory).toEqual(['code', 'test']);
  });

  it('capabilities exposed in getTerminal', async () => {
    await pool.spawn('gc1', { capabilities: ['code', 'test'] });

    const t = pool.getTerminal('gc1');
    expect(t.capabilities).toEqual(['code', 'test']);
  });

  it('constants are exported with correct values', () => {
    expect(MAX_TASK_HISTORY).toBe(5);
    expect(AFFINITY_CATEGORY_BONUS).toBe(2);
    expect(AFFINITY_RECENT_BONUS).toBe(1);
  });

  it('findNextClaimableTask with deps uses affinity', async () => {
    // dep-1 complete, dep-task pending with dep on dep-1
    coordinator = createFakeCoordinator([
      { id: 'dep-1', task: 'Dep', status: 'complete', priority: 5, category: 'code', deps: [] },
      { id: 'code-dep', task: 'Code with dep', status: 'pending', priority: 5, category: 'code', deps: ['dep-1'] },
      { id: 'test-free', task: 'Free test', status: 'pending', priority: 5, category: 'test', deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
    await pool.spawn('dep-t', {});

    // Give code history
    events.emit('claude-terminal:task-completed', {
      terminalId: 'dep-t', taskId: 'prev', status: 'complete', category: 'code',
    });

    const task = pool.findNextClaimableTask('dep-t');
    // code-dep has deps met and code affinity → should be preferred
    expect(task.category).toBe('code');
  });

  it('capabilities + affinity work together', async () => {
    coordinator = createFakeCoordinator([
      { id: 'c1', task: 'Code A', status: 'pending', priority: 5, category: 'code', deps: [] },
      { id: 't1', task: 'Test A', status: 'pending', priority: 5, category: 'test', deps: [] },
      { id: 'd1', task: 'Docs A', status: 'pending', priority: 5, category: 'docs', deps: [] },
    ]);
    ({ events, pool } = setupPool({ coordinator }));
    await pool.spawn('combo', { capabilities: ['code', 'test'] });

    // Give code history
    events.emit('claude-terminal:task-completed', {
      terminalId: 'combo', taskId: 'prev', status: 'complete', category: 'code',
    });

    const task = pool.findNextClaimableTask('combo');
    // docs filtered out by capabilities, code preferred by affinity
    expect(task.category).toBe('code');
  });
});
