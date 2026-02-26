// Phase 15F — Claude Pool + Route Tests
// Tests for claude-pool.mjs and routes/claude-terminals.mjs
// Mocks claude-terminal.mjs entirely for pool isolation.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
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
    _triggerContextWarning(info) {
      for (const fn of listeners['context-warning']) fn(info);
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

const { createClaudePool, MAX_TERMINALS, AUTO_DISPATCH_DELAY_MS, IDLE_THRESHOLD_MS, COMPLETION_IDLE_THRESHOLD_MS, MIN_ACTIVITY_BYTES, CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS, CONTEXT_REFRESH_SPAWN_DELAY_MS, MAX_CONTEXT_REFRESHES, STALE_TERMINAL_TTL_MS, ACTIVITY_CHECK_INTERVAL_MS } = await import('../claude-pool.mjs');
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

  // ── stale cleanup ──────────────────────────────────

  describe('stale stopped-terminal cleanup', () => {
    // Each test creates its own pool AFTER fake timers so the interval fires
    // under the fake clock. The outer pool (created in beforeEach with real
    // timers) is not used here.
    let stalePool;
    let staleEvents;

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      staleEvents = new EventBus();
      stalePool = createClaudePool({ events: staleEvents, projectDir: '/tmp/pool-test', log: () => {} });
    });

    afterEach(async () => {
      if (stalePool) await stalePool.shutdownAll();
      stalePool = null;
      vi.useRealTimers();
    });

    it('removes a non-persistent stopped terminal older than TTL', async () => {
      await stalePool.spawn('t1');
      stalePool.getTerminalHandle('t1')._triggerExit(0);

      // Advance past TTL + one activity-check interval
      vi.advanceTimersByTime(STALE_TERMINAL_TTL_MS + ACTIVITY_CHECK_INTERVAL_MS + 100);

      expect(stalePool.getTerminal('t1')).toBeNull();
    });

    it('emits claude-terminal:stale-removed event with correct fields', async () => {
      const removed = [];
      staleEvents.on('claude-terminal:stale-removed', (d) => removed.push(d));

      await stalePool.spawn('t1');
      stalePool.getTerminalHandle('t1')._triggerExit(0);

      vi.advanceTimersByTime(STALE_TERMINAL_TTL_MS + ACTIVITY_CHECK_INTERVAL_MS + 100);

      expect(removed.length).toBe(1);
      expect(removed[0].terminalId).toBe('t1');
      expect(typeof removed[0].stoppedAt).toBe('string');
      expect(removed[0].age).toBeGreaterThanOrEqual(STALE_TERMINAL_TTL_MS);
    });

    it('does NOT remove a terminal that stopped less than TTL ago', async () => {
      await stalePool.spawn('t1');
      stalePool.getTerminalHandle('t1')._triggerExit(0);

      // Advance to just under TTL
      vi.advanceTimersByTime(STALE_TERMINAL_TTL_MS - 1000);

      expect(stalePool.getTerminal('t1')).not.toBeNull();
    });

    it('does NOT remove a persistent stopped terminal', async () => {
      await stalePool.spawn('t1', { persistent: true });
      stalePool.getTerminalHandle('t1')._triggerExit(0);

      vi.advanceTimersByTime(STALE_TERMINAL_TTL_MS + ACTIVITY_CHECK_INTERVAL_MS + 100);

      expect(stalePool.getTerminal('t1')).not.toBeNull();
    });

    it('does NOT remove a swarm-managed stopped terminal', async () => {
      await stalePool.spawn('t1', { _swarmManaged: true });
      stalePool.getTerminalHandle('t1')._triggerExit(0);

      vi.advanceTimersByTime(STALE_TERMINAL_TTL_MS + ACTIVITY_CHECK_INTERVAL_MS + 100);

      expect(stalePool.getTerminal('t1')).not.toBeNull();
    });

    it('cleans up context-refresh shared-memory key when removing stale terminal', async () => {
      const mockSharedMemory = { del: vi.fn(), set: vi.fn(), writeSnapshot: vi.fn() };
      const localEvents = new EventBus();
      const localPool = createClaudePool({
        events: localEvents,
        projectDir: '/tmp/pool-test',
        log: () => {},
        sharedMemory: mockSharedMemory,
      });

      await localPool.spawn('t1');
      localPool.getTerminalHandle('t1')._triggerExit(0);

      vi.advanceTimersByTime(STALE_TERMINAL_TTL_MS + ACTIVITY_CHECK_INTERVAL_MS + 100);

      expect(mockSharedMemory.del).toHaveBeenCalledWith('context-refresh:t1:handoff');

      await localPool.shutdownAll();
    });

    it('does NOT remove a running terminal', async () => {
      await stalePool.spawn('t1');

      vi.advanceTimersByTime(STALE_TERMINAL_TTL_MS + ACTIVITY_CHECK_INTERVAL_MS + 100);

      expect(stalePool.getTerminal('t1')).not.toBeNull();
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

  // ── auto-handoff (Phase 15E) ─────────────────────

  describe('auto-handoff', () => {
    it('setAutoHandoff enables/disables on a terminal', async () => {
      await pool.spawn('t1');
      expect(pool.getTerminal('t1').autoHandoff).toBe(false);
      pool.setAutoHandoff('t1', true);
      expect(pool.getTerminal('t1').autoHandoff).toBe(true);
      pool.setAutoHandoff('t1', false);
      expect(pool.getTerminal('t1').autoHandoff).toBe(false);
    });

    it('setAutoHandoff returns false for nonexistent', () => {
      expect(pool.setAutoHandoff('nope', true)).toBe(false);
    });

    it('spawn tracks autoHandoff from opts', async () => {
      await pool.spawn('t1', { autoHandoff: true });
      expect(pool.getTerminal('t1').autoHandoff).toBe(true);
    });

    it('spawn defaults autoHandoff to false', async () => {
      await pool.spawn('t1');
      expect(pool.getTerminal('t1').autoHandoff).toBe(false);
    });

    it('handoffCount starts at 0', async () => {
      await pool.spawn('t1');
      expect(pool.getTerminal('t1').handoffCount).toBe(0);
    });

    it('handoffCount carries forward from _handoffCount opt', async () => {
      await pool.spawn('t1', { _handoffCount: 3 });
      expect(pool.getTerminal('t1').handoffCount).toBe(3);
    });

    it('does not auto-handoff when disabled', async () => {
      const handoffs = [];
      events.on('claude-terminal:handoff', (d) => handoffs.push(d));
      await pool.spawn('t1', { autoHandoff: false });
      pool.getTerminalHandle('t1')._triggerExit(0);
      await new Promise(r => setTimeout(r, 50));
      expect(handoffs.length).toBe(0);
    });

    it('does not auto-handoff on non-zero exit', async () => {
      const handoffs = [];
      events.on('claude-terminal:handoff', (d) => handoffs.push(d));
      await pool.spawn('t1', { autoHandoff: true });
      pool.getTerminalHandle('t1')._triggerExit(1);
      await new Promise(r => setTimeout(r, 50));
      expect(handoffs.length).toBe(0);
    });

    it('forwards context-warning events from terminal', async () => {
      const warnings = [];
      events.on('claude-terminal:context-warning', (d) => warnings.push(d));
      await pool.spawn('t1', { autoHandoff: true });
      pool.getTerminalHandle('t1')._triggerContextWarning({ pattern: 'auto[- ]?compact' });
      expect(warnings.length).toBe(1);
      expect(warnings[0].terminalId).toBe('t1');
      expect(warnings[0].autoHandoff).toBe(true);
    });

    it('formatEntry includes autoHandoff and handoffCount', async () => {
      await pool.spawn('t1', { autoHandoff: true });
      const t = pool.getTerminal('t1');
      expect(t).toHaveProperty('autoHandoff', true);
      expect(t).toHaveProperty('handoffCount', 0);
    });
  });

  // ── MAX_TERMINALS export ──────────────────────────

  it('exports MAX_TERMINALS constant', () => {
    expect(MAX_TERMINALS).toBe(8);
  });

  // ── Task Assignment (Phase 19) ────────────────────

  describe('task assignment', () => {
    it('assignTask stores task on terminal', async () => {
      await pool.spawn('t1');
      const ok = pool.assignTask('t1', { id: 'task-1', task: 'Do stuff', category: 'dev', priority: 3 });
      expect(ok).toBe(true);
      const task = pool.getAssignedTask('t1');
      expect(task).toBeTruthy();
      expect(task.taskId).toBe('task-1');
      expect(task.task).toBe('Do stuff');
      expect(task.category).toBe('dev');
      expect(task.priority).toBe(3);
      expect(task.assignedAt).toBeTruthy();
    });

    it('assignTask emits claude-terminal:task-assigned', async () => {
      const assigned = [];
      events.on('claude-terminal:task-assigned', (d) => assigned.push(d));
      await pool.spawn('t1');
      pool.assignTask('t1', { id: 'task-2', task: 'Build feature' });
      expect(assigned.length).toBe(1);
      expect(assigned[0].terminalId).toBe('t1');
      expect(assigned[0].taskId).toBe('task-2');
    });

    it('assignTask returns false for unknown terminal', () => {
      expect(pool.assignTask('nope', { id: 'task-1', task: 'x' })).toBe(false);
    });

    it('getAssignedTask returns null when no task', async () => {
      await pool.spawn('t1');
      expect(pool.getAssignedTask('t1')).toBeNull();
    });

    it('getAssignedTask returns null for unknown terminal', () => {
      expect(pool.getAssignedTask('nope')).toBeNull();
    });

    it('releaseTask clears and returns task', async () => {
      await pool.spawn('t1');
      pool.assignTask('t1', { id: 'task-3', task: 'Fix bug' });
      const released = pool.releaseTask('t1');
      expect(released).toBeTruthy();
      expect(released.taskId).toBe('task-3');
      expect(pool.getAssignedTask('t1')).toBeNull();
    });

    it('releaseTask emits claude-terminal:task-released', async () => {
      const released = [];
      events.on('claude-terminal:task-released', (d) => released.push(d));
      await pool.spawn('t1');
      pool.assignTask('t1', { id: 'task-4', task: 'Refactor' });
      pool.releaseTask('t1');
      expect(released.length).toBe(1);
      expect(released[0].terminalId).toBe('t1');
      expect(released[0].taskId).toBe('task-4');
    });

    it('releaseTask returns null when no task assigned', async () => {
      await pool.spawn('t1');
      expect(pool.releaseTask('t1')).toBeNull();
    });

    it('releaseTask returns null for unknown terminal', () => {
      expect(pool.releaseTask('nope')).toBeNull();
    });

    it('formatEntry includes assignedTask', async () => {
      await pool.spawn('t1');
      pool.assignTask('t1', { id: 'task-5', task: 'Test' });
      const t = pool.getTerminal('t1');
      expect(t.assignedTask).toBeTruthy();
      expect(t.assignedTask.taskId).toBe('task-5');
    });

    it('formatEntry shows null assignedTask when none', async () => {
      await pool.spawn('t1');
      const t = pool.getTerminal('t1');
      expect(t.assignedTask).toBeNull();
    });

    it('assignTask defaults category and priority', async () => {
      await pool.spawn('t1');
      pool.assignTask('t1', { id: 'task-6', task: 'Minimal' });
      const task = pool.getAssignedTask('t1');
      expect(task.category).toBeNull();
      expect(task.priority).toBe(5);
    });
  });

  // ── Auto-Dispatch (Phase 20) ─────────────────────

  describe('auto-dispatch', () => {
    it('setAutoDispatch enables/disables on a terminal', async () => {
      await pool.spawn('t1');
      expect(pool.getTerminal('t1').autoDispatch).toBe(false);
      pool.setAutoDispatch('t1', true);
      expect(pool.getTerminal('t1').autoDispatch).toBe(true);
      pool.setAutoDispatch('t1', false);
      expect(pool.getTerminal('t1').autoDispatch).toBe(false);
    });

    it('setAutoDispatch returns false for nonexistent', () => {
      expect(pool.setAutoDispatch('nope', true)).toBe(false);
    });

    it('spawn tracks autoDispatch from opts', async () => {
      await pool.spawn('t1', { autoDispatch: true });
      expect(pool.getTerminal('t1').autoDispatch).toBe(true);
    });

    it('spawn defaults autoDispatch to false', async () => {
      await pool.spawn('t1');
      expect(pool.getTerminal('t1').autoDispatch).toBe(false);
    });

    it('formatEntry includes autoDispatch', async () => {
      await pool.spawn('t1', { autoDispatch: true });
      const t = pool.getTerminal('t1');
      expect(t).toHaveProperty('autoDispatch', true);
    });

    it('auto-dispatch claims task after task-completed event', async () => {
      // Create pool with coordinator
      const mockTaskQueue = {
        getAll: vi.fn(() => [
          { id: 'q1', task: 'Build feature', status: 'pending', deps: [], priority: 1 },
        ]),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: true });

      const dispatched = [];
      events.on('claude-terminal:auto-dispatch', (d) => dispatched.push(d));

      // Simulate task completion
      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'old-task', status: 'complete',
      });

      // Wait for delay
      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));

      expect(dispatched.length).toBe(1);
      expect(dispatched[0].terminalId).toBe('d1');
      expect(dispatched[0].taskId).toBe('q1');
      expect(mockTaskQueue.assign).toHaveBeenCalledWith('q1', 'd1');
      expect(mockTaskQueue.start).toHaveBeenCalledWith('q1');

      await dispatchPool.shutdownAll();
    });

    it('auto-dispatch skipped when disabled', async () => {
      const mockTaskQueue = {
        getAll: vi.fn(() => [
          { id: 'q1', task: 'Build feature', status: 'pending', deps: [] },
        ]),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: false });

      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'old-task', status: 'complete',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(mockTaskQueue.assign).not.toHaveBeenCalled();

      await dispatchPool.shutdownAll();
    });

    it('auto-dispatch skipped when no coordinator', async () => {
      // Pool without coordinator (default)
      await pool.spawn('t1', { autoDispatch: true });

      const dispatched = [];
      events.on('claude-terminal:auto-dispatch', (d) => dispatched.push(d));

      events.emit('claude-terminal:task-completed', {
        terminalId: 't1', taskId: 'old-task', status: 'complete',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(dispatched.length).toBe(0);
    });

    it('auto-dispatch skipped when no ready tasks', async () => {
      const mockTaskQueue = {
        getAll: vi.fn(() => []),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: true });

      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'old-task', status: 'complete',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(mockTaskQueue.assign).not.toHaveBeenCalled();

      await dispatchPool.shutdownAll();
    });

    it('auto-dispatch skipped when terminal already has task', async () => {
      const mockTaskQueue = {
        getAll: vi.fn(() => [
          { id: 'q1', task: 'Build', status: 'pending', deps: [] },
        ]),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: true });
      dispatchPool.assignTask('d1', { id: 'existing', task: 'Already running' });

      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'some-other', status: 'complete',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(mockTaskQueue.assign).not.toHaveBeenCalled();

      await dispatchPool.shutdownAll();
    });

    it('auto-dispatch writes task prompt to PTY', async () => {
      const mockTaskQueue = {
        getAll: vi.fn(() => [
          { id: 'q1', task: 'Implement login page', status: 'pending', deps: [] },
        ]),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: true });
      const handle = dispatchPool.getTerminalHandle('d1');

      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'old-task', status: 'complete',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(handle.write).toHaveBeenCalledWith('[AUTO-DISPATCH] Task q1: Implement login page\r');

      await dispatchPool.shutdownAll();
    });

    it('auto-dispatch emits claude-terminal:auto-dispatch event', async () => {
      const mockTaskQueue = {
        getAll: vi.fn(() => [
          { id: 'q1', task: 'Fix bug', status: 'pending', deps: [] },
        ]),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: true });

      const dispatched = [];
      events.on('claude-terminal:auto-dispatch', (d) => dispatched.push(d));

      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'old-task', status: 'complete',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(dispatched.length).toBe(1);
      expect(dispatched[0]).toEqual(expect.objectContaining({
        terminalId: 'd1',
        taskId: 'q1',
        task: 'Fix bug',
      }));

      await dispatchPool.shutdownAll();
    });

    it('auto-dispatch skips tasks with incomplete deps', async () => {
      const mockTaskQueue = {
        getAll: vi.fn(() => [
          { id: 'dep1', task: 'Dep task', status: 'running', deps: [] },
          { id: 'q1', task: 'Blocked', status: 'pending', deps: ['dep1'] },
        ]),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: true });

      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'old', status: 'complete',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(mockTaskQueue.assign).not.toHaveBeenCalled();

      await dispatchPool.shutdownAll();
    });

    it('auto-dispatch claims task with completed deps', async () => {
      const mockTaskQueue = {
        getAll: vi.fn(() => [
          { id: 'dep1', task: 'Dep task', status: 'complete', deps: [] },
          { id: 'q1', task: 'Ready now', status: 'pending', deps: ['dep1'] },
        ]),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: true });

      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'old', status: 'complete',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(mockTaskQueue.assign).toHaveBeenCalledWith('q1', 'd1');

      await dispatchPool.shutdownAll();
    });

    it('auto-dispatch not triggered on failed task completion', async () => {
      const mockTaskQueue = {
        getAll: vi.fn(() => [
          { id: 'q1', task: 'Next', status: 'pending', deps: [] },
        ]),
        assign: vi.fn(),
        start: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const dispatchPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });

      await dispatchPool.spawn('d1', { autoDispatch: true });

      events.emit('claude-terminal:task-completed', {
        terminalId: 'd1', taskId: 'old-task', status: 'failed',
      });

      await new Promise(r => setTimeout(r, AUTO_DISPATCH_DELAY_MS + 100));
      expect(mockTaskQueue.assign).not.toHaveBeenCalled();

      await dispatchPool.shutdownAll();
    });
  });

  // ── Auto-Complete Detection (Phase 22) ──────────

  describe('auto-complete', () => {
    it('setAutoComplete enables/disables on a terminal', async () => {
      await pool.spawn('t1');
      expect(pool.getTerminal('t1').autoComplete).toBe(false);
      pool.setAutoComplete('t1', true);
      expect(pool.getTerminal('t1').autoComplete).toBe(true);
      pool.setAutoComplete('t1', false);
      expect(pool.getTerminal('t1').autoComplete).toBe(false);
    });

    it('setAutoComplete returns false for nonexistent', () => {
      expect(pool.setAutoComplete('nope', true)).toBe(false);
    });

    it('spawn defaults autoComplete to match autoDispatch', async () => {
      await pool.spawn('t1', { autoDispatch: true });
      expect(pool.getTerminal('t1').autoComplete).toBe(true);
      await pool.spawn('t2', { autoDispatch: false });
      expect(pool.getTerminal('t2').autoComplete).toBe(false);
    });

    it('spawn allows explicit autoComplete override', async () => {
      await pool.spawn('t1', { autoDispatch: true, autoComplete: false });
      expect(pool.getTerminal('t1').autoComplete).toBe(false);
      expect(pool.getTerminal('t1').autoDispatch).toBe(true);
    });

    it('formatEntry includes autoComplete', async () => {
      await pool.spawn('t1', { autoComplete: true });
      const t = pool.getTerminal('t1');
      expect(t).toHaveProperty('autoComplete', true);
    });

    it('exports COMPLETION_IDLE_THRESHOLD_MS constant', () => {
      expect(COMPLETION_IDLE_THRESHOLD_MS).toBe(30000);
    });

    it('exports MIN_ACTIVITY_BYTES constant', () => {
      expect(MIN_ACTIVITY_BYTES).toBe(100);
    });

    // Helper to create pool with coordinator for auto-complete timer tests
    function createAutoCompletePool() {
      const mockTaskQueue = {
        getAll: vi.fn(() => []),
        assign: vi.fn(),
        start: vi.fn(),
        complete: vi.fn(),
      };
      const mockCoordinator = { taskQueue: mockTaskQueue };
      const acPool = createClaudePool({
        events, projectDir: '/tmp/pool-test', coordinator: mockCoordinator, log: () => {},
      });
      return { acPool, mockTaskQueue };
    }

    // Use fake timers to avoid 30s real waits
    describe('timer-based detection', () => {
      beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('auto-completes after idle threshold following sufficient activity', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: true });
        acPool.assignTask('ac1', { id: 'task-1', task: 'Fix bug' });

        const completed = [];
        events.on('claude-terminal:auto-complete', (d) => completed.push(d));
        const taskCompleted = [];
        events.on('claude-terminal:task-completed', (d) => taskCompleted.push(d));

        // Simulate enough activity
        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(MIN_ACTIVITY_BYTES + 50) });

        // Advance past completion threshold
        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS + 100);

        expect(completed.length).toBe(1);
        expect(completed[0].terminalId).toBe('ac1');
        expect(completed[0].taskId).toBe('task-1');
        expect(mockTaskQueue.complete).toHaveBeenCalledWith('task-1', expect.any(String));
        expect(taskCompleted.find(t => t.autoCompleted)).toBeTruthy();

        await acPool.shutdownAll();
      });

      it('auto-complete skipped when disabled', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: false });
        acPool.assignTask('ac1', { id: 'task-1', task: 'Fix bug' });

        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(200) });

        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS + 100);

        expect(mockTaskQueue.complete).not.toHaveBeenCalled();

        await acPool.shutdownAll();
      });

      it('auto-complete skipped with insufficient activity', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: true });
        acPool.assignTask('ac1', { id: 'task-1', task: 'Fix bug' });

        // Send less than MIN_ACTIVITY_BYTES
        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(10) });

        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS + 100);

        expect(mockTaskQueue.complete).not.toHaveBeenCalled();

        await acPool.shutdownAll();
      });

      it('auto-complete timer resets on new data', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: true });
        acPool.assignTask('ac1', { id: 'task-1', task: 'Fix bug' });

        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(200) });

        // Advance to just under threshold
        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS - 1000);

        // Send more data — resets the timer
        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'more output' });

        // Advance past original threshold but not past reset
        vi.advanceTimersByTime(5000);

        expect(mockTaskQueue.complete).not.toHaveBeenCalled();

        await acPool.shutdownAll();
      });

      it('auto-complete skipped when no task assigned', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: true });
        // No task assigned

        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(200) });

        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS + 100);

        expect(mockTaskQueue.complete).not.toHaveBeenCalled();

        await acPool.shutdownAll();
      });

      it('completion watch stops on task release', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: true });
        acPool.assignTask('ac1', { id: 'task-1', task: 'Fix bug' });

        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(200) });

        // Release task before threshold
        acPool.releaseTask('ac1');

        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS + 100);

        expect(mockTaskQueue.complete).not.toHaveBeenCalled();

        await acPool.shutdownAll();
      });

      it('completion watch stops on terminal exit', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: true });
        acPool.assignTask('ac1', { id: 'task-1', task: 'Fix bug' });

        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(200) });

        // Trigger terminal exit
        acPool.getTerminalHandle('ac1')._triggerExit(0);

        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS + 100);

        expect(mockTaskQueue.complete).not.toHaveBeenCalled();

        await acPool.shutdownAll();
      });

      it('setAutoComplete clears timer when disabling', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: true });
        acPool.assignTask('ac1', { id: 'task-1', task: 'Fix bug' });

        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(200) });

        // Disable auto-complete before threshold
        acPool.setAutoComplete('ac1', false);

        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS + 100);

        expect(mockTaskQueue.complete).not.toHaveBeenCalled();

        await acPool.shutdownAll();
      });

      it('auto-complete emits both auto-complete and task-completed events', async () => {
        const { acPool, mockTaskQueue } = createAutoCompletePool();

        await acPool.spawn('ac1', { autoComplete: true });
        acPool.assignTask('ac1', { id: 'task-1', task: 'Fix bug' });

        const autoCompleteEvents = [];
        const taskCompletedEvents = [];
        events.on('claude-terminal:auto-complete', (d) => autoCompleteEvents.push(d));
        events.on('claude-terminal:task-completed', (d) => taskCompletedEvents.push(d));

        events.emit('claude-terminal:data', { terminalId: 'ac1', data: 'x'.repeat(200) });

        vi.advanceTimersByTime(COMPLETION_IDLE_THRESHOLD_MS + 100);

        expect(autoCompleteEvents.length).toBe(1);
        expect(autoCompleteEvents[0]).toMatchObject({ terminalId: 'ac1', taskId: 'task-1', task: 'Fix bug' });

        const tcEvent = taskCompletedEvents.find(e => e.autoCompleted);
        expect(tcEvent).toBeTruthy();
        expect(tcEvent.status).toBe('complete');
        expect(tcEvent.terminalId).toBe('ac1');

        await acPool.shutdownAll();
      });
    });

    it('getPoolStatus counts withAutoComplete correctly', async () => {
      await pool.spawn('t1', { autoComplete: true });
      await pool.spawn('t2', { autoComplete: false });
      const status = pool.getPoolStatus();
      expect(status.withAutoComplete).toBe(1);
    });
  });

  // ── Activity Tracking (Phase 21) ─────────────────

  describe('activity tracking', () => {
    it('formatEntry includes lastActivityAt', async () => {
      await pool.spawn('t1');
      const t = pool.getTerminal('t1');
      expect(t).toHaveProperty('lastActivityAt');
      expect(typeof t.lastActivityAt).toBe('string');
    });

    it('formatEntry includes activityState', async () => {
      await pool.spawn('t1');
      const t = pool.getTerminal('t1');
      expect(t).toHaveProperty('activityState');
      expect(['active', 'idle', 'waiting', 'stopped']).toContain(t.activityState);
    });

    it('newly spawned terminal is active', async () => {
      await pool.spawn('t1');
      expect(pool.getTerminal('t1').activityState).toBe('active');
    });

    it('terminal data updates lastActivityAt', async () => {
      await pool.spawn('t1');
      const before = pool.getTerminal('t1').lastActivityAt;
      await new Promise(r => setTimeout(r, 20));
      pool.getTerminalHandle('t1')._triggerData('hello');
      const after = pool.getTerminal('t1').lastActivityAt;
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });

    it('stopped terminal has stopped activityState', async () => {
      await pool.spawn('t1');
      pool.getTerminalHandle('t1')._triggerExit(0);
      await new Promise(r => setTimeout(r, 20));
      expect(pool.getTerminal('t1').activityState).toBe('stopped');
    });

    it('exports IDLE_THRESHOLD_MS constant', () => {
      expect(IDLE_THRESHOLD_MS).toBe(10000);
    });

    it('getPoolStatus returns aggregate stats', async () => {
      await pool.spawn('t1');
      await pool.spawn('t2');
      const status = pool.getPoolStatus();
      expect(status.total).toBe(2);
      expect(status.running).toBe(2);
      expect(status.stopped).toBe(0);
      expect(status.active).toBe(2);
      expect(status.maxTerminals).toBe(8);
      expect(typeof status.idle).toBe('number');
      expect(typeof status.waiting).toBe('number');
      expect(typeof status.withTask).toBe('number');
      expect(typeof status.withAutoDispatch).toBe('number');
    });

    it('getPoolStatus counts withTask correctly', async () => {
      await pool.spawn('t1');
      await pool.spawn('t2');
      pool.assignTask('t1', { id: 'x', task: 'Test' });
      const status = pool.getPoolStatus();
      expect(status.withTask).toBe(1);
    });

    it('getPoolStatus counts withAutoDispatch correctly', async () => {
      await pool.spawn('t1', { autoDispatch: true });
      await pool.spawn('t2', { autoDispatch: false });
      const status = pool.getPoolStatus();
      expect(status.withAutoDispatch).toBe(1);
    });

    it('getPoolStatus returns zeroes for empty pool', () => {
      const status = pool.getPoolStatus();
      expect(status.total).toBe(0);
      expect(status.running).toBe(0);
    });
  });

  // ── Context Refresh ──────────────────────────────────────

  describe('context refresh', () => {
    it('exports context refresh constants', () => {
      expect(CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS).toBe(60000);
      expect(CONTEXT_REFRESH_SPAWN_DELAY_MS).toBe(3000);
      expect(MAX_CONTEXT_REFRESHES).toBe(10);
    });

    it('triggers on context-warning when autoHandoff=true', async () => {
      const started = [];
      events.on('claude-terminal:context-refresh-started', (d) => started.push(d));

      await pool.spawn('cr1', { autoHandoff: true });
      const handle = pool.getTerminalHandle('cr1');

      // Simulate context warning
      handle._triggerContextWarning({ pattern: 'auto-compact' });

      expect(started.length).toBe(1);
      expect(started[0].terminalId).toBe('cr1');
      expect(started[0].refreshCount).toBe(1);
    });

    it('does NOT trigger when autoHandoff=false', async () => {
      const started = [];
      events.on('claude-terminal:context-refresh-started', (d) => started.push(d));

      await pool.spawn('cr2', { autoHandoff: false });
      const handle = pool.getTerminalHandle('cr2');

      handle._triggerContextWarning({ pattern: 'auto-compact' });

      expect(started.length).toBe(0);
    });

    it('guard prevents re-entry', async () => {
      const started = [];
      events.on('claude-terminal:context-refresh-started', (d) => started.push(d));

      await pool.spawn('cr3', { autoHandoff: true });
      const handle = pool.getTerminalHandle('cr3');

      // First trigger
      handle._triggerContextWarning({ pattern: 'auto-compact' });
      // Second trigger (should be blocked)
      handle._triggerContextWarning({ pattern: 'auto-compact' });

      expect(started.length).toBe(1);
    });

    it('respects MAX_CONTEXT_REFRESHES limit', async () => {
      const started = [];
      events.on('claude-terminal:context-refresh-started', (d) => started.push(d));

      await pool.spawn('cr4', { autoHandoff: true, _contextRefreshCount: MAX_CONTEXT_REFRESHES });
      const handle = pool.getTerminalHandle('cr4');

      handle._triggerContextWarning({ pattern: 'auto-compact' });

      expect(started.length).toBe(0);
    });

    it('parses handoff from output and completes refresh', async () => {
      const completed = [];
      events.on('claude-terminal:context-refresh-completed', (d) => completed.push(d));

      await pool.spawn('cr5', { autoHandoff: true });
      const handle = pool.getTerminalHandle('cr5');

      // Start context refresh
      handle._triggerContextWarning({ pattern: 'auto-compact' });

      // Wait past capture grace period (system prompt echo suppression)
      await new Promise(r => setTimeout(r, 600));

      // Simulate Claude producing a handoff
      const handoffText = '## HANDOFF\n\nThis is a detailed handoff with enough content to pass the 50 char minimum threshold for parsing.';
      events.emit('claude-terminal:data', {
        terminalId: 'cr5',
        data: handoffText,
      });

      // Wait for terminal kill auto-exit (10ms) + spawn delay
      await new Promise(r => setTimeout(r, CONTEXT_REFRESH_SPAWN_DELAY_MS + 500));

      // Terminal should have been killed
      expect(handle.kill).toHaveBeenCalled();

      expect(completed.length).toBe(1);
      expect(completed[0].terminalId).toBe('cr5');
      expect(completed[0].refreshCount).toBe(1);
      expect(completed[0].handoffLength).toBeGreaterThan(50);
    });

    it('timeout uses synthetic handoff', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const localEvents = new EventBus();
      const localPool = createClaudePool({ events: localEvents, projectDir: '/tmp/pool-test', log: () => {} });

      await localPool.spawn('cr6', { autoHandoff: true });
      const handle = localPool.getTerminalHandle('cr6');

      // Start context refresh
      handle._triggerContextWarning({ pattern: 'auto-compact' });

      // No handoff produced — advance past timeout
      vi.advanceTimersByTime(CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS + 100);

      // Terminal should be killed after timeout triggers synthetic handoff
      await vi.advanceTimersByTimeAsync(100);
      expect(handle.kill).toHaveBeenCalled();

      // Cleanup
      vi.useRealTimers();
      await localPool.shutdownAll();
    });

    it('carries task forward on context refresh', async () => {
      const mockCoordinator = {
        taskQueue: {
          getAll: vi.fn().mockReturnValue([]),
          assign: vi.fn(),
          start: vi.fn(),
          complete: vi.fn(),
          fail: vi.fn(),
          retry: vi.fn(),
        },
      };
      const localEvents = new EventBus();
      const localPool = createClaudePool({
        events: localEvents,
        projectDir: '/tmp/pool-test',
        coordinator: mockCoordinator,
        log: () => {},
      });

      const completed = [];
      localEvents.on('claude-terminal:context-refresh-completed', (d) => completed.push(d));

      await localPool.spawn('cr7', { autoHandoff: true });
      localPool.assignTask('cr7', { id: 'task-99', task: 'Important work', category: 'code' });

      const handle = localPool.getTerminalHandle('cr7');

      // Start context refresh
      handle._triggerContextWarning({ pattern: 'auto-compact' });

      // Wait past capture grace period (system prompt echo suppression)
      await new Promise(r => setTimeout(r, 600));

      // Emit handoff
      localEvents.emit('claude-terminal:data', {
        terminalId: 'cr7',
        data: '## HANDOFF\n\nDetailed handoff with enough chars to pass the minimum content validation threshold here.',
      });

      // Wait for kill auto-exit + spawn delay
      await new Promise(r => setTimeout(r, CONTEXT_REFRESH_SPAWN_DELAY_MS + 500));

      expect(completed.length).toBe(1);
      expect(completed[0].hadTask).toBe(true);

      // The new terminal should have the task assigned
      const newTerm = localPool.getTerminal('cr7');
      if (newTerm) {
        expect(newTerm.assignedTask).toBeTruthy();
        expect(newTerm.assignedTask.taskId).toBe('task-99');
      }

      await localPool.shutdownAll();
    });

    it('emits context-refresh-started event', async () => {
      const started = [];
      events.on('claude-terminal:context-refresh-started', (d) => started.push(d));

      await pool.spawn('cr8', { autoHandoff: true });
      const handle = pool.getTerminalHandle('cr8');

      handle._triggerContextWarning({ pattern: 'auto-compact' });

      expect(started.length).toBe(1);
      expect(started[0]).toMatchObject({
        terminalId: 'cr8',
        refreshCount: 1,
      });
    });

    it('handles terminal exit during handoff request', async () => {
      await pool.spawn('cr9', { autoHandoff: true });
      const handle = pool.getTerminalHandle('cr9');

      // Start context refresh
      handle._triggerContextWarning({ pattern: 'auto-compact' });

      // Terminal dies before producing handoff (non-zero = crash)
      // This fires the exit handler in maybeContextRefresh, which calls _finishContextRefresh with synthetic handoff
      handle._triggerExit(1, null);

      // Wait for spawn delay
      await new Promise(r => setTimeout(r, CONTEXT_REFRESH_SPAWN_DELAY_MS + 500));

      // The key assertion is no uncaught errors — terminal was cleaned up
    });

    it('ignores system prompt echo during grace period (prevents handoff loop)', async () => {
      const completed = [];
      events.on('claude-terminal:context-refresh-completed', (d) => completed.push(d));

      await pool.spawn('cr-loop', { autoHandoff: true });
      const handle = pool.getTerminalHandle('cr-loop');

      // Start context refresh
      handle._triggerContextWarning({ pattern: 'auto-compact' });

      // Immediately emit data that looks like a handoff (system prompt echo)
      // This should be IGNORED because it arrives within the grace period
      events.emit('claude-terminal:data', {
        terminalId: 'cr-loop',
        data: '## HANDOFF\n\nEchoed handoff from system prompt that should NOT trigger a false positive detection loop.',
      });

      // Should NOT have completed yet — grace period suppresses early output
      expect(completed.length).toBe(0);
    });

    it('buildContextRefreshPrompt sanitizes HANDOFF headings', async () => {
      await pool.spawn('cr-san', { autoHandoff: true });
      const handle = pool.getTerminalHandle('cr-san');

      // Start context refresh to set up state
      handle._triggerContextWarning({ pattern: 'auto-compact' });

      // Wait past grace + emit real handoff containing ## HANDOFF heading
      await new Promise(r => setTimeout(r, 600));
      events.emit('claude-terminal:data', {
        terminalId: 'cr-san',
        data: '## HANDOFF\n\nReal handoff content that is long enough to pass the minimum fifty character threshold.',
      });

      // Wait for spawn
      await new Promise(r => setTimeout(r, CONTEXT_REFRESH_SPAWN_DELAY_MS + 500));

      // The new terminal's config should have sanitized system prompt.
      // parseHandoffFromOutput strips the heading, so the body is passed directly.
      // buildContextRefreshPrompt sanitizes any residual ## HANDOFF headings as a safety net.
      const newTerm = pool.getTerminal('cr-san');
      if (newTerm && newTerm.config && newTerm.config.systemPrompt) {
        // Should NOT contain raw "## HANDOFF" — either stripped by parser or sanitized
        expect(newTerm.config.systemPrompt).not.toMatch(/^## HANDOFF\b/m);
        // Should contain the handoff body text
        expect(newTerm.config.systemPrompt).toContain('Real handoff content');
      }
    });

    it('formatEntry includes contextRefreshCount and contextRefreshState', async () => {
      await pool.spawn('cr10', { autoHandoff: true, _contextRefreshCount: 3 });
      const info = pool.getTerminal('cr10');
      expect(info.contextRefreshCount).toBe(3);
      expect(info.contextRefreshState).toBe(null);
    });

    it('normal auto-handoff uses fresh restart (no -c flag)', async () => {
      const realDateNow = Date.now;
      const startTime = Date.now();
      await pool.spawn('cr11', { autoHandoff: true });

      // Mock Date.now to bypass MIN_UPTIME_FOR_HANDOFF_MS check
      Date.now = () => startTime + 15000;

      const handle = pool.getTerminalHandle('cr11');
      // Trigger clean exit (auto-handoff should fire)
      handle._triggerExit(0);

      // Wait for respawn
      await new Promise(r => { Date.now = realDateNow; setTimeout(r, 100); });

      // Check that the respawned terminal was created with continueSession=false
      const lastCall = claudeTermMock.createClaudeTerminal.mock.calls.at(-1);
      expect(lastCall).toBeTruthy();
      expect(lastCall[0].continueSession).toBe(false);
    });

    it('auto-handoff emits freshRestart flag', async () => {
      const realDateNow = Date.now;
      const startTime = Date.now();
      const handoffs = [];
      events.on('claude-terminal:handoff', (d) => handoffs.push(d));

      await pool.spawn('cr12', { autoHandoff: true });

      // Mock Date.now to bypass MIN_UPTIME_FOR_HANDOFF_MS check
      Date.now = () => startTime + 15000;

      const handle = pool.getTerminalHandle('cr12');
      // Trigger clean exit
      handle._triggerExit(0);

      // Wait for respawn
      await new Promise(r => { Date.now = realDateNow; setTimeout(r, 100); });

      expect(handoffs.length).toBe(1);
      expect(handoffs[0].freshRestart).toBe(true);
    });
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
        autoHandoff: !!opts.autoHandoff,
        autoDispatch: !!opts.autoDispatch,
        autoComplete: opts.autoComplete !== undefined ? !!opts.autoComplete : !!opts.autoDispatch,
        handoffCount: opts._handoffCount || 0,
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
    setAutoHandoff: vi.fn((id, enabled) => {
      const t = terminals.get(id);
      if (!t) return false;
      t.autoHandoff = !!enabled;
      return true;
    }),
    setAutoDispatch: vi.fn((id, enabled) => {
      const t = terminals.get(id);
      if (!t) return false;
      t.autoDispatch = !!enabled;
      return true;
    }),
    setAutoComplete: vi.fn((id, enabled) => {
      const t = terminals.get(id);
      if (!t) return false;
      t.autoComplete = !!enabled;
      return true;
    }),
    assignTask: vi.fn((id, task) => {
      const t = terminals.get(id);
      if (!t) return false;
      t.assignedTask = {
        taskId: task.id,
        task: task.task,
        category: task.category || null,
        priority: task.priority || 5,
        metadata: task.metadata || null,
        assignedAt: new Date().toISOString(),
      };
      return true;
    }),
    releaseTask: vi.fn((id) => {
      const t = terminals.get(id);
      if (!t || !t.assignedTask) return null;
      const released = t.assignedTask;
      t.assignedTask = null;
      return released;
    }),
    getAssignedTask: vi.fn((id) => {
      const t = terminals.get(id);
      if (!t) return null;
      return t.assignedTask || null;
    }),
    activeCount: () => [...terminals.values()].filter(t => t.status === 'running').length,
    getPoolStatus: vi.fn(() => ({
      total: terminals.size,
      running: [...terminals.values()].filter(t => t.status === 'running').length,
      stopped: [...terminals.values()].filter(t => t.status !== 'running').length,
      active: [...terminals.values()].filter(t => t.status === 'running').length,
      idle: 0, waiting: 0, withTask: 0, withAutoDispatch: 0, withAutoComplete: 0,
      maxTerminals: 8,
    })),
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
      auth: false,
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

    it('GET task returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/task');
      expect(status).toBe(503);
    });

    it('POST claim-task returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/claim-task', {
        method: 'POST',
      });
      expect(status).toBe(503);
    });

    it('POST release-task returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/release-task', {
        method: 'POST',
      });
      expect(status).toBe(503);
    });

    it('POST complete-task returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/complete-task', {
        method: 'POST',
        body: { status: 'complete' },
      });
      expect(status).toBe(503);
    });

    it('POST toggle-auto-dispatch returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/toggle-auto-dispatch', {
        method: 'POST',
      });
      expect(status).toBe(503);
    });

    it('POST toggle-auto-complete returns 503', async () => {
      const { status } = await api('/api/claude-terminals/x/toggle-auto-complete', {
        method: 'POST',
      });
      expect(status).toBe(503);
    });

    it('GET pool-status returns available:false without pool', async () => {
      const { status, body } = await api('/api/claude-terminals/pool-status');
      expect(status).toBe(200);
      expect(body.available).toBe(false);
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

    // ── GET pool-status ────────────────────────

    it('GET /api/claude-terminals/pool-status returns aggregate stats', async () => {
      const { status, body } = await api('/api/claude-terminals/pool-status');
      expect(status).toBe(200);
      expect(body.available).toBe(true);
      expect(typeof body.total).toBe('number');
      expect(typeof body.running).toBe('number');
      expect(typeof body.active).toBe('number');
      expect(typeof body.idle).toBe('number');
      expect(typeof body.maxTerminals).toBe('number');
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
      expect(body.error).toBe('Validation failed');
      expect(body.field).toBe('id');
      expect(body.details).toContain('required');
    });

    it('POST rejects invalid id chars', async () => {
      const { status, body } = await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'bad id!' },
      });
      expect(status).toBe(400);
      expect(body.error).toBe('Validation failed');
      expect(body.field).toBe('id');
      expect(body.details).toContain('pattern');
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

    // ── POST toggle-auto-handoff (Phase 15E) ─────

    it('POST toggle-auto-handoff toggles state', async () => {
      const ahEvents = [];
      routeEvents.on('claude-terminal:auto-handoff-changed', (d) => ahEvents.push(d));

      const { status, body } = await api('/api/claude-terminals/rt1/toggle-auto-handoff', {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.autoHandoff).toBe('boolean');
      expect(mockPool.setAutoHandoff).toHaveBeenCalled();
      expect(ahEvents.length).toBe(1);
      expect(ahEvents[0].terminalId).toBe('rt1');
    });

    it('POST toggle-auto-handoff returns 404 for unknown', async () => {
      const { status } = await api('/api/claude-terminals/nonexistent/toggle-auto-handoff', {
        method: 'POST',
      });
      expect(status).toBe(404);
    });

    it('POST create accepts autoHandoff option', async () => {
      const { status } = await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'ah-test', autoHandoff: true },
      });
      expect(status).toBe(201);
      expect(mockPool.spawn).toHaveBeenCalledWith('ah-test', expect.objectContaining({
        autoHandoff: true,
      }));
    });

    // ── POST toggle-auto-dispatch (Phase 20) ─────

    it('POST toggle-auto-dispatch toggles state', async () => {
      const adEvents = [];
      routeEvents.on('claude-terminal:auto-dispatch-changed', (d) => adEvents.push(d));

      const { status, body } = await api('/api/claude-terminals/rt1/toggle-auto-dispatch', {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.autoDispatch).toBe('boolean');
      expect(mockPool.setAutoDispatch).toHaveBeenCalled();
      expect(adEvents.length).toBe(1);
      expect(adEvents[0].terminalId).toBe('rt1');
    });

    it('POST toggle-auto-dispatch returns 404 for unknown', async () => {
      const { status } = await api('/api/claude-terminals/nonexistent/toggle-auto-dispatch', {
        method: 'POST',
      });
      expect(status).toBe(404);
    });

    it('POST create accepts autoDispatch option', async () => {
      const { status } = await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'ad-test', autoDispatch: true },
      });
      expect(status).toBe(201);
      expect(mockPool.spawn).toHaveBeenCalledWith('ad-test', expect.objectContaining({
        autoDispatch: true,
      }));
    });

    // ── POST toggle-auto-complete (Phase 22) ─────

    it('POST toggle-auto-complete toggles state', async () => {
      const acEvents = [];
      routeEvents.on('claude-terminal:auto-complete-changed', (d) => acEvents.push(d));

      const { status, body } = await api('/api/claude-terminals/rt1/toggle-auto-complete', {
        method: 'POST',
      });
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.autoComplete).toBe('boolean');
      expect(mockPool.setAutoComplete).toHaveBeenCalled();
      expect(acEvents.length).toBe(1);
      expect(acEvents[0].terminalId).toBe('rt1');
    });

    it('POST toggle-auto-complete returns 404 for unknown', async () => {
      const { status } = await api('/api/claude-terminals/nonexistent/toggle-auto-complete', {
        method: 'POST',
      });
      expect(status).toBe(404);
    });

    it('POST create accepts autoComplete option', async () => {
      const { status } = await api('/api/claude-terminals', {
        method: 'POST',
        body: { id: 'ac-test', autoComplete: true },
      });
      expect(status).toBe(201);
      expect(mockPool.spawn).toHaveBeenCalledWith('ac-test', expect.objectContaining({
        autoComplete: true,
      }));
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

    // ── Task Bridge (Phase 19) ─────────────────────

    it('GET /api/claude-terminals/:id/task returns null when no task', async () => {
      // Ensure rt1 exists
      await api('/api/claude-terminals', { method: 'POST', body: { id: 'task-t1' } });
      const { status, body } = await api('/api/claude-terminals/task-t1/task');
      expect(status).toBe(200);
      expect(body.terminalId).toBe('task-t1');
      expect(body.task).toBeNull();
    });

    it('GET /api/claude-terminals/:id/task returns 404 for unknown', async () => {
      const { status } = await api('/api/claude-terminals/nonexistent/task');
      expect(status).toBe(404);
    });

    it('POST claim-task returns 503 when no coordinator', async () => {
      const { status, body } = await api('/api/claude-terminals/task-t1/claim-task', {
        method: 'POST',
      });
      expect(status).toBe(503);
      expect(body.error).toContain('Coordinator not available');
    });

    it('POST release-task returns 404 when no assigned task', async () => {
      const { status, body } = await api('/api/claude-terminals/task-t1/release-task', {
        method: 'POST',
      });
      expect(status).toBe(404);
      expect(body.error).toContain('no assigned task');
    });

    it('POST complete-task returns 404 when no assigned task', async () => {
      const { status, body } = await api('/api/claude-terminals/task-t1/complete-task', {
        method: 'POST',
        body: { status: 'complete' },
      });
      expect(status).toBe(404);
      expect(body.error).toContain('no assigned task');
    });

    it('POST complete-task rejects invalid status', async () => {
      // First assign a task manually on the mock
      mockPool.assignTask('task-t1', { id: 'tq-1', task: 'Test task' });
      const { status, body } = await api('/api/claude-terminals/task-t1/complete-task', {
        method: 'POST',
        body: { status: 'invalid' },
      });
      expect(status).toBe(400);
      expect(body.error).toContain('must be');
      // Clean up
      mockPool.releaseTask('task-t1');
    });

    it('POST claim-task returns 409 when already has task', async () => {
      mockPool.assignTask('task-t1', { id: 'tq-2', task: 'Existing task' });
      const { status, body } = await api('/api/claude-terminals/task-t1/claim-task', {
        method: 'POST',
      });
      expect(status).toBe(409);
      expect(body.error).toContain('already has an assigned task');
      // Clean up
      mockPool.releaseTask('task-t1');
    });

    it('POST claim-task returns 404 for unknown terminal', async () => {
      const { status } = await api('/api/claude-terminals/nonexistent/claim-task', {
        method: 'POST',
      });
      expect(status).toBe(404);
    });

    it('POST release-task returns 503 for unknown terminal (no pool check)', async () => {
      // release-task doesn't check getTerminal, it checks getAssignedTask
      const { status } = await api('/api/claude-terminals/nonexistent/release-task', {
        method: 'POST',
      });
      expect(status).toBe(404);
    });
  });
});
