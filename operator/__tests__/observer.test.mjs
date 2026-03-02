// ============================================================
// Observer Agent Tests (Phase 68)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createObserver, CHECK_INTERVAL_MS, STUCK_WORKER_THRESHOLD_MS, CRASH_WINDOW_MS, CRASH_COUNT_THRESHOLD, BUDGET_HALT_PCT, ACTION_COOLDOWN_MS } from '../observer.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

function createTestCtx(overrides = {}) {
  const events = new EventBus();
  return {
    events,
    claudePool: {
      getStatus: vi.fn(() => []),
      respawnTerminal: vi.fn(),
      killTerminal: vi.fn(),
      stopSwarm: vi.fn(),
      ...overrides.claudePool,
    },
    coordinator: {
      taskQueue: {
        list: vi.fn(() => []),
        fail: vi.fn(),
        retry: vi.fn(),
        ...overrides.taskQueue,
      },
      ...overrides.coordinator,
    },
    costAggregator: {
      getSummary: vi.fn(() => ({ globalTotalUsd: 0, budgetUsd: 10 })),
      ...overrides.costAggregator,
    },
    log: vi.fn(),
    ...overrides,
  };
}

describe('Observer Agent', () => {
  let observer, ctx;

  afterEach(() => {
    if (observer) observer.destroy();
  });

  describe('lifecycle', () => {
    it('starts and stops cleanly', () => {
      ctx = createTestCtx();
      observer = createObserver(ctx);

      expect(observer.getStatus().running).toBe(false);

      observer.start();
      expect(observer.getStatus().running).toBe(true);

      observer.stop();
      expect(observer.getStatus().running).toBe(false);
    });

    it('emits started/stopped events', () => {
      ctx = createTestCtx();
      observer = createObserver(ctx);

      const startHandler = vi.fn();
      const stopHandler = vi.fn();
      ctx.events.on('observer:started', startHandler);
      ctx.events.on('observer:stopped', stopHandler);

      observer.start();
      expect(startHandler).toHaveBeenCalledTimes(1);

      observer.stop();
      expect(stopHandler).toHaveBeenCalledTimes(1);
    });

    it('double start is a no-op', () => {
      ctx = createTestCtx();
      observer = createObserver(ctx);

      const handler = vi.fn();
      ctx.events.on('observer:started', handler);

      observer.start();
      observer.start();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('getStatus returns expected shape', () => {
      ctx = createTestCtx();
      observer = createObserver(ctx);
      observer.start();

      const status = observer.getStatus();
      expect(status).toEqual(expect.objectContaining({
        running: true,
        circuitOpen: false,
        recentCrashes: 0,
        actionLog: [],
      }));
    });

    it('destroy clears state', () => {
      ctx = createTestCtx();
      observer = createObserver(ctx);
      observer.start();
      observer.destroy();

      const status = observer.getStatus();
      expect(status.running).toBe(false);
    });
  });

  describe('stuck worker detection', () => {
    it('detects stuck workers and respawns them', async () => {
      const stuckWorker = {
        id: 'worker-1',
        role: null,
        status: 'running',
        activityState: 'waiting',
        assignedTask: { id: 'task-1', task: 'fix bug' },
        lastActivityAt: new Date(Date.now() - STUCK_WORKER_THRESHOLD_MS - 10000).toISOString(),
      };

      ctx = createTestCtx({
        claudePool: {
          getStatus: vi.fn(() => [stuckWorker]),
          respawnTerminal: vi.fn(),
          killTerminal: vi.fn(),
          stopSwarm: vi.fn(),
        },
      });

      observer = createObserver(ctx);
      const actionHandler = vi.fn();
      ctx.events.on('observer:action', actionHandler);

      observer.start();

      // Manually trigger check (don't wait for interval)
      // Access internal by calling the status path to trigger checks
      // We'll use vi.advanceTimersByTime instead
      vi.useFakeTimers();
      observer.destroy(); // stop real timers
      observer = createObserver(ctx);
      observer.start();

      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(ctx.claudePool.respawnTerminal).toHaveBeenCalledWith('worker-1');
      expect(actionHandler).toHaveBeenCalledWith(expect.objectContaining({
        rule: 'stuck-worker',
        action: 'respawn',
      }));

      vi.useRealTimers();
    });

    it('skips master terminals', async () => {
      const masterTerminal = {
        id: 'master-1',
        role: 'master',
        status: 'running',
        activityState: 'waiting',
        assignedTask: { id: 'task-1' },
        lastActivityAt: new Date(Date.now() - 300000).toISOString(),
      };

      ctx = createTestCtx({
        claudePool: {
          getStatus: vi.fn(() => [masterTerminal]),
          respawnTerminal: vi.fn(),
          killTerminal: vi.fn(),
          stopSwarm: vi.fn(),
        },
      });

      vi.useFakeTimers();
      observer = createObserver(ctx);
      observer.start();
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(ctx.claudePool.respawnTerminal).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('respects action cooldown', async () => {
      const stuckWorker = {
        id: 'worker-1',
        role: null,
        status: 'running',
        activityState: 'waiting',
        assignedTask: { id: 'task-1' },
        lastActivityAt: new Date(Date.now() - 300000).toISOString(),
      };

      ctx = createTestCtx({
        claudePool: {
          getStatus: vi.fn(() => [stuckWorker]),
          respawnTerminal: vi.fn(),
          killTerminal: vi.fn(),
          stopSwarm: vi.fn(),
        },
      });

      vi.useFakeTimers();
      observer = createObserver(ctx);
      observer.start();

      // First check triggers respawn
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      expect(ctx.claudePool.respawnTerminal).toHaveBeenCalledTimes(1);

      // Second check within cooldown — no repeat
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      expect(ctx.claudePool.respawnTerminal).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('circuit breaker (systemic failure)', () => {
    it('opens circuit after N crashes in window', () => {
      ctx = createTestCtx();

      vi.useFakeTimers();
      observer = createObserver(ctx);

      const circuitHandler = vi.fn();
      ctx.events.on('observer:circuit-open', circuitHandler);

      observer.start();

      // Emit crash events (non-master, non-zero exit)
      for (let i = 0; i < CRASH_COUNT_THRESHOLD; i++) {
        ctx.events.emit('claude-terminal:exit', { id: `worker-${i}`, exitCode: 1 });
      }

      // Trigger check
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(circuitHandler).toHaveBeenCalledTimes(1);
      expect(observer.getStatus().circuitOpen).toBe(true);
      expect(ctx.claudePool.stopSwarm).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('ignores master terminal exits for circuit', () => {
      ctx = createTestCtx();

      vi.useFakeTimers();
      observer = createObserver(ctx);
      observer.start();

      // Emit master crashes — should NOT count
      for (let i = 0; i < 5; i++) {
        ctx.events.emit('claude-terminal:exit', { id: `master-${i}`, exitCode: 1 });
      }

      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(observer.getStatus().circuitOpen).toBe(false);

      vi.useRealTimers();
    });

    it('closes circuit when crash rate normalizes', () => {
      ctx = createTestCtx();

      vi.useFakeTimers();
      observer = createObserver(ctx);

      const closeHandler = vi.fn();
      ctx.events.on('observer:circuit-closed', closeHandler);

      observer.start();

      // Open circuit
      for (let i = 0; i < CRASH_COUNT_THRESHOLD; i++) {
        ctx.events.emit('claude-terminal:exit', { id: `worker-${i}`, exitCode: 1 });
      }
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
      expect(observer.getStatus().circuitOpen).toBe(true);

      // Advance past crash window
      vi.advanceTimersByTime(CRASH_WINDOW_MS + 1000);

      expect(observer.getStatus().circuitOpen).toBe(false);
      expect(closeHandler).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('budget halt', () => {
    it('halts swarm when budget >= 95%', () => {
      ctx = createTestCtx({
        costAggregator: {
          getSummary: vi.fn(() => ({ globalTotalUsd: 9.6, budgetUsd: 10 })),
        },
      });

      vi.useFakeTimers();
      observer = createObserver(ctx);

      const budgetHandler = vi.fn();
      ctx.events.on('observer:budget-halt', budgetHandler);

      observer.start();
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(budgetHandler).toHaveBeenCalledWith(expect.objectContaining({
        totalUsd: 9.6,
        budgetUsd: 10,
      }));
      expect(ctx.claudePool.stopSwarm).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('does not halt when under budget', () => {
      ctx = createTestCtx({
        costAggregator: {
          getSummary: vi.fn(() => ({ globalTotalUsd: 5, budgetUsd: 10 })),
        },
      });

      vi.useFakeTimers();
      observer = createObserver(ctx);

      const budgetHandler = vi.fn();
      ctx.events.on('observer:budget-halt', budgetHandler);

      observer.start();
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(budgetHandler).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('does not halt when no budget set', () => {
      ctx = createTestCtx({
        costAggregator: {
          getSummary: vi.fn(() => ({ globalTotalUsd: 100, budgetUsd: 0 })),
        },
      });

      vi.useFakeTimers();
      observer = createObserver(ctx);

      const budgetHandler = vi.fn();
      ctx.events.on('observer:budget-halt', budgetHandler);

      observer.start();
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(budgetHandler).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('orphaned task recovery', () => {
    it('retries tasks assigned to missing workers', () => {
      const orphanedTask = {
        id: 'task-orphan',
        status: 'assigned',
        assignedTo: 'worker-gone',
        assignedAt: new Date(Date.now() - 200000).toISOString(),
      };

      ctx = createTestCtx({
        claudePool: {
          getStatus: vi.fn(() => []), // no live workers
          respawnTerminal: vi.fn(),
          killTerminal: vi.fn(),
          stopSwarm: vi.fn(),
        },
      });
      ctx.coordinator.taskQueue.list = vi.fn(() => [orphanedTask]);

      vi.useFakeTimers();
      observer = createObserver(ctx);

      const actionHandler = vi.fn();
      ctx.events.on('observer:action', actionHandler);

      observer.start();
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(ctx.coordinator.taskQueue.fail).toHaveBeenCalledWith('task-orphan', expect.stringContaining('worker-gone'));
      expect(ctx.coordinator.taskQueue.retry).toHaveBeenCalledWith('task-orphan');
      expect(actionHandler).toHaveBeenCalledWith(expect.objectContaining({
        rule: 'orphaned-task',
        action: 'retry',
      }));

      vi.useRealTimers();
    });

    it('does not retry tasks when worker is still alive', () => {
      const assignedTask = {
        id: 'task-ok',
        status: 'assigned',
        assignedTo: 'worker-alive',
        assignedAt: new Date(Date.now() - 200000).toISOString(),
      };

      ctx = createTestCtx({
        claudePool: {
          getStatus: vi.fn(() => [{ id: 'worker-alive', status: 'running' }]),
          respawnTerminal: vi.fn(),
          killTerminal: vi.fn(),
          stopSwarm: vi.fn(),
        },
      });
      ctx.coordinator.taskQueue.list = vi.fn(() => [assignedTask]);

      vi.useFakeTimers();
      observer = createObserver(ctx);
      observer.start();
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      expect(ctx.coordinator.taskQueue.fail).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('action log', () => {
    it('records actions in getStatus', () => {
      const stuckWorker = {
        id: 'worker-x',
        role: null,
        status: 'running',
        activityState: 'waiting',
        assignedTask: { id: 'task-1' },
        lastActivityAt: new Date(Date.now() - 300000).toISOString(),
      };

      ctx = createTestCtx({
        claudePool: {
          getStatus: vi.fn(() => [stuckWorker]),
          respawnTerminal: vi.fn(),
          killTerminal: vi.fn(),
          stopSwarm: vi.fn(),
        },
      });

      vi.useFakeTimers();
      observer = createObserver(ctx);
      observer.start();
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);

      const status = observer.getStatus();
      expect(status.actionLog.length).toBeGreaterThan(0);
      expect(status.actionLog[0]).toEqual(expect.objectContaining({
        rule: 'stuck-worker',
        action: 'respawn',
      }));

      vi.useRealTimers();
    });
  });
});
