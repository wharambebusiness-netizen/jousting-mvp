// ============================================================
// Coordinator — Inter-Orchestrator Coordination Broker
// ============================================================
// Central broker that ties task queue + work assigner + rate
// limiter + cost aggregator together. Manages coordination
// lifecycle and routes coord:* events between workers.
//
// Lifecycle: init -> running -> draining -> stopped
//
// Workers send coord:* IPC events to parent EventBus.
// Coordinator listens and dispatches responses via pool.sendTo().
//
// Factory: createCoordinator(ctx) returns coordinator methods.
// ============================================================

import { createTaskQueue } from './task-queue.mjs';
import { createWorkAssigner } from './work-assigner.mjs';
import { createRateLimiter } from './rate-limiter.mjs';
import { createCostAggregator } from './cost-aggregator.mjs';
import { createWorktreeManager } from './worktree-manager.mjs';

// ── Lifecycle States ────────────────────────────────────────

const STATES = new Set(['init', 'running', 'draining', 'stopped']);

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a coordinator for inter-orchestrator coordination.
 * @param {object} ctx
 * @param {object} ctx.events - EventBus
 * @param {object} ctx.pool - Process pool
 * @param {object} [ctx.taskQueue] - Injected task queue (or created internally)
 * @param {object} [ctx.workAssigner] - Injected work assigner (or created internally)
 * @param {object} [ctx.rateLimiter] - Injected rate limiter (or created internally)
 * @param {object} [ctx.costAggregator] - Injected cost aggregator (or created internally)
 * @param {object} [ctx.worktreeManager] - Injected worktree manager (or created internally if projectDir given)
 * @param {object} [ctx.options] - Configuration options
 * @param {string} [ctx.options.strategy='round-robin'] - Work assignment strategy
 * @param {number} [ctx.options.globalBudgetUsd=100] - Global budget cap
 * @param {number} [ctx.options.perWorkerBudgetUsd=25] - Per-worker budget cap
 * @param {number} [ctx.options.maxRequestsPerMinute=60] - API rate limit
 * @param {number} [ctx.options.maxTokensPerMinute=1000000] - Token rate limit
 * @param {number} [ctx.options.rateLimiterTickMs=5000] - Rate limiter waiter processing interval
 * @param {boolean} [ctx.options.autoRecordSessionCosts=true] - Auto-record costs from session:complete events
 * @param {boolean} [ctx.options.enableWorktrees=false] - Enable per-worker git worktree isolation
 * @param {number} [ctx.options.minWorkers=0] - Minimum workers (auto-scale won't go below this)
 * @param {number} [ctx.options.maxWorkers=8] - Maximum workers (auto-scale cap)
 * @param {number} [ctx.options.scaleUpThreshold=3] - Pending tasks per worker before scaling up
 * @param {number} [ctx.options.autoScaleCheckMs=10000] - Auto-scale check interval (0 = disabled)
 * @param {number} [ctx.options.drainTimeoutMs=0] - Force-stop after drain timeout (0 = wait forever)
 * @param {boolean} [ctx.options.budgetAutoDrain=true] - Auto-drain on global budget exceeded
 * @param {Function} [ctx.options.workerConfigFactory] - Factory fn(workerId) returning config for auto-spawned workers
 * @param {Function} [ctx.log] - Logger
 * @returns {object} Coordinator methods
 */
export function createCoordinator(ctx) {
  const { events, pool } = ctx;
  const log = ctx.log || (() => {});
  const opts = ctx.options || {};

  if (!events) throw new Error('Coordinator requires an EventBus');
  if (!pool) throw new Error('Coordinator requires a process pool');

  let state = 'init';

  // ── Sub-systems ─────────────────────────────────────────

  const taskQueue = ctx.taskQueue || createTaskQueue({ log });

  const workAssigner = ctx.workAssigner || createWorkAssigner({
    strategy: opts.strategy || 'round-robin',
    pool,
    taskQueue,
    events,
    log,
  });

  const rateLimiter = ctx.rateLimiter || createRateLimiter({
    maxRequestsPerMinute: opts.maxRequestsPerMinute || 60,
    maxTokensPerMinute: opts.maxTokensPerMinute || 1_000_000,
    log,
  });

  const costAggregator = ctx.costAggregator || createCostAggregator({
    globalBudgetUsd: opts.globalBudgetUsd ?? 100,
    perWorkerBudgetUsd: opts.perWorkerBudgetUsd ?? 25,
    events,
    log,
  });

  const worktreeManager = ctx.worktreeManager || (
    opts.enableWorktrees && ctx.projectDir
      ? createWorktreeManager({ projectDir: ctx.projectDir, events, log })
      : null
  );

  // ── Rate Limiter Tick ─────────────────────────────────────

  const rateLimiterTickMs = opts.rateLimiterTickMs ?? 5000;
  let rateLimiterTimer = null;

  function startRateLimiterTick() {
    if (rateLimiterTimer || rateLimiterTickMs <= 0) return;
    rateLimiterTimer = setInterval(() => {
      const granted = rateLimiter.processWaiters();
      if (granted > 0) {
        log(`[coord] Rate limiter tick: ${granted} waiters granted`);
      }
    }, rateLimiterTickMs);
    if (rateLimiterTimer.unref) rateLimiterTimer.unref();
  }

  function stopRateLimiterTick() {
    if (rateLimiterTimer) {
      clearInterval(rateLimiterTimer);
      rateLimiterTimer = null;
    }
  }

  // ── Auto-Scale ─────────────────────────────────────────────

  const minWorkers = opts.minWorkers ?? 0;
  const maxWorkers = opts.maxWorkers ?? 8;
  const scaleUpThreshold = opts.scaleUpThreshold ?? 3;
  const autoScaleCheckMs = opts.autoScaleCheckMs ?? 0;  // 0 = disabled by default
  const workerConfigFactory = opts.workerConfigFactory || ((id) => ({}));
  let autoScaleTimer = null;
  let autoScaleCounter = 0;  // For generating unique worker IDs

  function startAutoScaleChecker() {
    if (autoScaleTimer || autoScaleCheckMs <= 0) return;
    autoScaleTimer = setInterval(() => {
      if (state !== 'running') return;
      checkAutoScale();
    }, autoScaleCheckMs);
    if (autoScaleTimer.unref) autoScaleTimer.unref();
  }

  function stopAutoScaleChecker() {
    if (autoScaleTimer) {
      clearInterval(autoScaleTimer);
      autoScaleTimer = null;
    }
  }

  /**
   * Check if we need to scale up workers based on queue depth.
   * Scale up when: pendingTasks / activeWorkers > scaleUpThreshold
   * Only runs when auto-scale is enabled (autoScaleCheckMs > 0).
   */
  function checkAutoScale() {
    if (autoScaleCheckMs <= 0) return; // Auto-scale disabled
    const active = pool.activeCount();
    if (active >= maxWorkers) return;

    const progress = taskQueue.getProgress();
    const pending = progress.pending + progress.assigned;
    if (pending === 0) return;

    // Scale up if pending tasks exceed threshold per worker
    const ratio = active === 0 ? pending : pending / active;
    if (ratio >= scaleUpThreshold) {
      const newId = `auto-${++autoScaleCounter}`;
      const config = workerConfigFactory(newId);
      try {
        pool.spawn(newId, config);
        log(`[coord] Auto-scaled up: spawned worker ${newId} (${active + 1}/${maxWorkers}, ratio=${ratio.toFixed(1)})`);
        events.emit('coord:scale-up', { workerId: newId, activeCount: active + 1, ratio });
      } catch (err) {
        log(`[coord] Auto-scale spawn failed: ${err.message}`);
      }
    }
  }

  // ── Drain Timeout ─────────────────────────────────────────

  const drainTimeoutMs = opts.drainTimeoutMs ?? 0;
  const budgetAutoDrain = opts.budgetAutoDrain !== false;
  let drainTimer = null;

  function startDrainTimeout() {
    if (drainTimer || drainTimeoutMs <= 0) return;
    drainTimer = setTimeout(() => {
      if (state === 'draining') {
        log(`[coord] Drain timeout (${drainTimeoutMs}ms) — force stopping`);
        events.emit('coord:drain-timeout', { drainTimeoutMs });
        stop();
      }
    }, drainTimeoutMs);
    if (drainTimer.unref) drainTimer.unref();
  }

  function clearDrainTimeout() {
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
  }

  // ── Session Cost Auto-Bridging ─────────────────────────────

  const autoRecordSessionCosts = opts.autoRecordSessionCosts !== false;

  // ── Event Handlers ──────────────────────────────────────

  const handlers = {};

  /**
   * Handle coord:request — worker requests a task assignment.
   */
  handlers['coord:request'] = (data) => {
    if (state !== 'running') {
      log(`[coord] Ignoring coord:request in state ${state}`);
      return;
    }
    const { workerId } = data;
    if (!workerId) return;

    const assignment = workAssigner.assignNext();
    if (assignment) {
      pool.sendTo(workerId, {
        type: 'coord:proceed',
        taskId: assignment.task.id,
        task: assignment.task.task,
        category: assignment.task.category,
        metadata: assignment.task.metadata,
      });
    } else {
      pool.sendTo(workerId, { type: 'coord:wait', reason: 'no-ready-tasks' });
    }
  };

  /**
   * Handle coord:complete — worker finished a task.
   */
  handlers['coord:complete'] = (data) => {
    const { workerId, taskId, result } = data;
    if (!taskId) return;

    try {
      const task = taskQueue.get(taskId);
      if (task && task.status === 'assigned') {
        taskQueue.start(taskId);
      }
      taskQueue.complete(taskId, result);
      log(`[coord] Task ${taskId} completed by ${workerId}`);

      events.emit('coord:task-complete', { taskId, workerId, result });

      // Try to assign newly-ready tasks
      if (state === 'running') {
        const newAssignments = workAssigner.assignAll();
        for (const a of newAssignments) {
          pool.sendTo(a.workerId, {
            type: 'coord:proceed',
            taskId: a.task.id,
            task: a.task.task,
            category: a.task.category,
            metadata: a.task.metadata,
          });
        }

        // Check if all tasks are done (draining)
        checkCompletion();
      }
    } catch (err) {
      log(`[coord] Error completing task ${taskId}: ${err.message}`);
    }
  };

  /**
   * Handle coord:failed — worker's task failed.
   */
  handlers['coord:failed'] = (data) => {
    const { workerId, taskId, error } = data;
    if (!taskId) return;

    try {
      const task = taskQueue.get(taskId);
      if (task && task.status === 'assigned') {
        taskQueue.start(taskId);
      }
      taskQueue.fail(taskId, error);
      log(`[coord] Task ${taskId} failed on ${workerId}: ${error}`);

      events.emit('coord:task-failed', { taskId, workerId, error });

      // Cancel dependent tasks
      const cancelled = taskQueue.cancel(taskId);
      if (cancelled.length > 0) {
        log(`[coord] Cancelled ${cancelled.length} dependent tasks`);
      }

      checkCompletion();
    } catch (err) {
      log(`[coord] Error failing task ${taskId}: ${err.message}`);
    }
  };

  /**
   * Handle coord:rate-request — worker requests API rate budget.
   */
  handlers['coord:rate-request'] = (data) => {
    const { workerId, tokens = 0 } = data;
    if (!workerId) return;

    const result = rateLimiter.tryAcquire(workerId, tokens);
    if (result.granted) {
      pool.sendTo(workerId, {
        type: 'coord:rate-grant',
        remaining: result.remaining,
      });
    } else {
      pool.sendTo(workerId, {
        type: 'coord:rate-wait',
        waitMs: result.waitMs,
        remaining: result.remaining,
      });
    }
  };

  /**
   * Handle coord:cost — worker reports a cost event.
   */
  handlers['coord:cost'] = (data) => {
    const { workerId, totalUsd, inputTokens, outputTokens } = data;
    if (!workerId) return;

    recordCostAndCheck(workerId, totalUsd || 0, inputTokens || 0, outputTokens || 0);
  };

  /**
   * Handle session:complete — auto-bridge session cost data to cost aggregator.
   * Workers emit session:complete via IPCEventBus when a session finishes.
   */
  if (autoRecordSessionCosts) {
    handlers['session:complete'] = (data) => {
      const { workerId, costUsd, inputTokens, outputTokens } = data;
      if (!workerId || !costUsd) return;

      recordCostAndCheck(workerId, costUsd, inputTokens || 0, outputTokens || 0);
    };
  }

  /**
   * Shared cost recording helper — records cost and sends budget-stop if exceeded.
   */
  function recordCostAndCheck(workerId, totalUsd, inputTokens, outputTokens) {
    const result = costAggregator.record(workerId, { totalUsd, inputTokens, outputTokens });

    if (!result.allowed) {
      pool.sendTo(workerId, {
        type: 'coord:budget-stop',
        workerExceeded: result.workerExceeded,
        globalExceeded: result.globalExceeded,
        workerTotal: result.workerTotal,
        globalTotal: result.globalTotal,
      });

      // Auto-drain on global budget exceeded
      if (result.globalExceeded && budgetAutoDrain && state === 'running') {
        log('[coord] Global budget exceeded — auto-draining');
        drain();
      }
    }
  }

  function checkCompletion() {
    const progress = taskQueue.getProgress();
    if (progress.pending === 0 && progress.assigned === 0 && progress.running === 0) {
      events.emit('coord:all-complete', {
        total: progress.total,
        complete: progress.complete,
        failed: progress.failed,
        cancelled: progress.cancelled,
      });
    }
  }

  // ── Event Wiring ────────────────────────────────────────

  function wireEvents() {
    for (const [event, handler] of Object.entries(handlers)) {
      events.on(event, handler);
    }
  }

  function unwireEvents() {
    for (const [event, handler] of Object.entries(handlers)) {
      events.off(event, handler);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────

  /**
   * Start the coordinator.
   */
  function start() {
    if (state === 'running') return;
    if (state === 'stopped') throw new Error('Cannot restart a stopped coordinator');
    wireEvents();
    startRateLimiterTick();
    startAutoScaleChecker();
    state = 'running';
    log('[coord] Started');
    events.emit('coord:started', { state });

    // Assign any ready tasks immediately
    const assignments = workAssigner.assignAll();
    for (const a of assignments) {
      pool.sendTo(a.workerId, {
        type: 'coord:proceed',
        taskId: a.task.id,
        task: a.task.task,
        category: a.task.category,
        metadata: a.task.metadata,
      });
    }
  }

  /**
   * Begin draining — stop accepting new tasks, wait for running to finish.
   */
  function drain() {
    if (state !== 'running') return;
    state = 'draining';
    stopAutoScaleChecker();
    startDrainTimeout();
    log('[coord] Draining...');
    events.emit('coord:draining', { state });
    checkCompletion();
  }

  /**
   * Stop the coordinator immediately.
   */
  function stop() {
    unwireEvents();
    stopRateLimiterTick();
    stopAutoScaleChecker();
    clearDrainTimeout();
    state = 'stopped';
    log('[coord] Stopped');
    events.emit('coord:stopped', { state });
  }

  /**
   * Get current state.
   * @returns {string}
   */
  function getState() { return state; }

  // ── Task Management (delegated to queue) ────────────────

  /**
   * Add a task to the coordination queue.
   * @param {object} taskDef - Task definition (id, task, deps, priority, category, metadata)
   * @returns {object} Created task
   */
  function addTask(taskDef) {
    const task = taskQueue.add(taskDef);
    log(`[coord] Added task ${task.id}`);

    // Auto-assign if running
    if (state === 'running') {
      const assignments = workAssigner.assignAll();
      for (const a of assignments) {
        pool.sendTo(a.workerId, {
          type: 'coord:proceed',
          taskId: a.task.id,
          task: a.task.task,
          category: a.task.category,
          metadata: a.task.metadata,
        });
      }
      // Check if we need more workers
      checkAutoScale();
    }

    return task;
  }

  /**
   * Add multiple tasks at once.
   * @param {object[]} taskDefs
   * @returns {object[]} Created tasks
   */
  function addTasks(taskDefs) {
    const created = taskDefs.map(def => taskQueue.add(def));

    if (state === 'running') {
      const assignments = workAssigner.assignAll();
      for (const a of assignments) {
        pool.sendTo(a.workerId, {
          type: 'coord:proceed',
          taskId: a.task.id,
          task: a.task.task,
          category: a.task.category,
          metadata: a.task.metadata,
        });
      }
      // Check if we need more workers
      checkAutoScale();
    }

    return created;
  }

  // ── Status ────────────────────────────────────────────

  /**
   * Get full coordination status.
   * @returns {object}
   */
  function getStatus() {
    return {
      state,
      queue: taskQueue.getProgress(),
      tasks: taskQueue.getAll(),
      graph: taskQueue.getDependencyGraph(),
      rateLimiter: rateLimiter.getStatus(),
      costs: costAggregator.getStatus(),
      strategy: workAssigner.getStrategy(),
      worktrees: worktreeManager ? worktreeManager.getStatus() : null,
    };
  }

  return {
    // Lifecycle
    start,
    drain,
    stop,
    getState,

    // Task management
    addTask,
    addTasks,

    // Subsystem access
    taskQueue,
    workAssigner,
    rateLimiter,
    costAggregator,
    worktreeManager,

    // Status
    getStatus,
  };
}

export { STATES };
