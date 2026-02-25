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
import { createPersistentQueue } from './persistent-queue.mjs';
import { createWorkAssigner } from './work-assigner.mjs';
import { createRateLimiter } from './rate-limiter.mjs';
import { createCostAggregator } from './cost-aggregator.mjs';
import { createWorktreeManager } from './worktree-manager.mjs';
import { createAdaptiveLimiter } from './adaptive-limiter.mjs';
import { createCategoryDetector } from './category-detector.mjs';
import { createCostForecaster } from './cost-forecaster.mjs';

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
 * @param {string} [ctx.options.persistPath] - Path to persist task queue on disk (survives restarts)
 * @param {boolean} [ctx.options.enableAdaptiveRate=true] - Enable adaptive rate limiting (auto-reduce on 429s)
 * @param {number} [ctx.options.adaptiveErrorThreshold=3] - 429 errors in window before backoff
 * @param {number} [ctx.options.adaptiveWindowMs=60000] - Sliding window for 429 error counting
 * @param {number} [ctx.options.adaptiveBackoffFactor=0.5] - Multiply limits by this on each backoff level
 * @param {number} [ctx.options.adaptiveMaxBackoffLevel=4] - Maximum backoff depth
 * @param {number} [ctx.options.adaptiveRecoveryIntervalMs=30000] - Interval between recovery steps
 * @param {object} [ctx.deadLetterQueue] - Dead letter queue for permanently-failed tasks
 * @param {number} [ctx.options.maxTaskRetries=3] - Max retries before routing to DLQ
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

  // ── Dead Letter Queue (Phase 32) ─────────────────────────
  const deadLetterQueue = ctx.deadLetterQueue || null;
  const maxTaskRetries = opts.maxTaskRetries ?? 3;
  const taskRetryCounts = new Map(); // taskId -> number of failures

  // ── Sub-systems ─────────────────────────────────────────

  const persistPath = opts.persistPath || null;
  const taskQueue = ctx.taskQueue || (
    persistPath
      ? createPersistentQueue({ filePath: persistPath, log })
      : createTaskQueue({ log })
  );

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

  const enableAdaptiveRate = opts.enableAdaptiveRate !== false;
  const adaptiveLimiter = ctx.adaptiveLimiter || (
    enableAdaptiveRate
      ? createAdaptiveLimiter({
          rateLimiter,
          events,
          errorThreshold: opts.adaptiveErrorThreshold,
          windowMs: opts.adaptiveWindowMs,
          backoffFactor: opts.adaptiveBackoffFactor,
          maxBackoffLevel: opts.adaptiveMaxBackoffLevel,
          recoveryIntervalMs: opts.adaptiveRecoveryIntervalMs,
          log,
        })
      : null
  );

  // ── Category Detector (Phase 33) ──────────────────────────

  const categoryDetector = ctx.categoryDetector || createCategoryDetector({
    customRules: opts.categoryRules || [],
  });

  // ── Cost Forecaster (Phase 43) ───────────────────────────

  const costForecaster = ctx.costForecaster || createCostForecaster({
    events,
    costAggregator,
    log,
  });

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
   * Tracks retry counts and routes to DLQ after maxTaskRetries.
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

      // Track retry count and route to DLQ if exceeded
      const retries = (taskRetryCounts.get(taskId) || 0) + 1;
      taskRetryCounts.set(taskId, retries);

      if (deadLetterQueue && retries >= maxTaskRetries) {
        // Route to dead letter queue
        deadLetterQueue.add({
          taskId,
          task: task,
          category: task?.category || null,
          error,
          workerId,
          failedAt: new Date().toISOString(),
          retryCount: retries,
          metadata: task?.metadata || {},
        });
        log(`[coord] Task ${taskId} routed to DLQ after ${retries} failures`);
      }

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
   * Handle coord:rate-error — worker reports a 429 rate limit error.
   * Feeds into adaptive limiter for automatic backoff.
   */
  handlers['coord:rate-error'] = (data) => {
    const { workerId, detail } = data;
    if (!workerId) return;

    if (adaptiveLimiter) {
      adaptiveLimiter.recordError(workerId, detail);
    } else {
      log(`[coord] 429 from ${workerId} (adaptive rate limiting disabled)`);
    }
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
    events.off('settings:changed', handleSettingsChanged);
  }

  // ── Lifecycle ─────────────────────────────────────────

  /**
   * Start the coordinator.
   */
  function start() {
    if (state === 'running') return;
    if (state === 'stopped') throw new Error('Cannot restart a stopped coordinator');

    // Load persisted queue if available
    if (taskQueue.isPersistent && taskQueue.load) {
      const loadResult = taskQueue.load();
      if (loadResult.loaded) {
        log(`[coord] Loaded ${loadResult.tasks} persisted tasks (${loadResult.reset} reset)`);
        events.emit('coord:queue-loaded', loadResult);
      }
    }

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
    if (adaptiveLimiter) adaptiveLimiter.destroy();

    // Final save to disk
    if (taskQueue.isPersistent && taskQueue.save) {
      try { taskQueue.save(); } catch (_) { /* ignore */ }
    }

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
    taskDef = { ...taskDef };
    // Auto-detect category if not specified
    if (!taskDef.category && taskDef.task) {
      const detected = categoryDetector.detect(taskDef.task);
      if (detected) taskDef.category = detected;
    }

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
    // Auto-detect categories for tasks without explicit category
    const cloned = taskDefs.map(def => ({ ...def }));
    for (const def of cloned) {
      if (!def.category && def.task) {
        const detected = categoryDetector.detect(def.task);
        if (detected) def.category = detected;
      }
    }

    const created = cloned.map(def => taskQueue.add(def));

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

  // ── Metrics ────────────────────────────────────────────

  const metricsState = {
    completions: [],     // { taskId, workerId, completedAt, durationMs }
    failures: [],        // { taskId, workerId, failedAt, error }
    windowMs: 5 * 60_000, // 5-minute sliding window
  };

  // Patch event handlers to track metrics
  const origComplete = handlers['coord:complete'];
  handlers['coord:complete'] = (data) => {
    const startTime = Date.now();
    origComplete(data);
    if (data.taskId) {
      const task = taskQueue.get(data.taskId);
      const completedAt = Date.now();
      metricsState.completions.push({
        taskId: data.taskId,
        workerId: data.workerId,
        completedAt,
        durationMs: task?.startedAt ? completedAt - new Date(task.startedAt).getTime() : null,
      });
    }
  };

  const origFailed = handlers['coord:failed'];
  handlers['coord:failed'] = (data) => {
    origFailed(data);
    if (data.taskId) {
      metricsState.failures.push({
        taskId: data.taskId,
        workerId: data.workerId,
        failedAt: Date.now(),
        error: data.error,
      });
    }
  };

  /**
   * Get task metrics (throughput, avg completion time, worker utilization).
   * @returns {object}
   */
  function getMetrics() {
    const now = Date.now();
    const cutoff = now - metricsState.windowMs;

    // Prune old data
    metricsState.completions = metricsState.completions.filter(c => c.completedAt > cutoff);
    metricsState.failures = metricsState.failures.filter(f => f.failedAt > cutoff);

    const recentCompletions = metricsState.completions;
    const recentFailures = metricsState.failures;

    // Throughput: tasks per minute in the window
    const windowMinutes = metricsState.windowMs / 60_000;
    const throughput = recentCompletions.length / windowMinutes;

    // Avg completion time
    const durations = recentCompletions.filter(c => c.durationMs != null).map(c => c.durationMs);
    const avgCompletionMs = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;

    // Worker utilization: fraction of workers currently assigned tasks
    const progress = taskQueue.getProgress();
    const activeWorkers = pool.activeCount();
    const busyWorkers = progress.assigned + progress.running;
    const utilization = activeWorkers > 0 ? Math.min(1, busyWorkers / activeWorkers) : 0;

    // Outcome counts (all-time from progress)
    const outcomes = {
      complete: progress.complete,
      failed: progress.failed,
      cancelled: progress.cancelled,
      pending: progress.pending,
      running: progress.running + progress.assigned,
    };

    return {
      throughputPerMinute: Math.round(throughput * 100) / 100,
      avgCompletionMs: avgCompletionMs != null ? Math.round(avgCompletionMs) : null,
      workerUtilization: Math.round(utilization * 100) / 100,
      recentCompletions: recentCompletions.length,
      recentFailures: recentFailures.length,
      windowMs: metricsState.windowMs,
      outcomes,
    };
  }

  // ── Hot-Reconfiguration ──────────────────────────────────

  /**
   * Update coordinator options at runtime.
   * @param {object} updates
   * @param {number} [updates.maxRequestsPerMinute] - Rate limit
   * @param {number} [updates.maxTokensPerMinute] - Token rate limit
   * @param {number} [updates.globalBudgetUsd] - Global budget cap
   * @param {number} [updates.perWorkerBudgetUsd] - Per-worker budget cap
   */
  function updateOptions(updates) {
    if (!updates || typeof updates !== 'object') return;

    // Rate limiter updates
    if (updates.maxRequestsPerMinute != null || updates.maxTokensPerMinute != null) {
      rateLimiter.updateLimits({
        maxRequestsPerMinute: updates.maxRequestsPerMinute,
        maxTokensPerMinute: updates.maxTokensPerMinute,
      });
      // Also update adaptive limiter baseline so recovery targets the new limits
      if (adaptiveLimiter) {
        adaptiveLimiter.updateBaseline({
          maxRequestsPerMinute: updates.maxRequestsPerMinute,
          maxTokensPerMinute: updates.maxTokensPerMinute,
        });
      }
    }

    // Budget updates
    if (updates.globalBudgetUsd != null || updates.perWorkerBudgetUsd != null) {
      costAggregator.updateBudgets({
        globalBudgetUsd: updates.globalBudgetUsd,
        perWorkerBudgetUsd: updates.perWorkerBudgetUsd,
      });
    }

    log('[coord] Options updated');
    events.emit('coord:config-updated', updates);
  }

  // ── Settings Hot-Reload (Phase 52) ──────────────────────

  // Mapping from settings keys to coordinator-relevant fields
  const COORD_SETTINGS_MAP = {
    coordMaxRequestsPerMinute: 'maxRequestsPerMinute',
    coordMaxTokensPerMinute: 'maxTokensPerMinute',
    coordGlobalBudgetUsd: 'globalBudgetUsd',
    coordPerWorkerBudgetUsd: 'perWorkerBudgetUsd',
  };

  /**
   * Handle settings:changed events — reconfigure subsystems when
   * coordinator-related settings change.
   */
  function handleSettingsChanged(data) {
    const changes = data?.changes;
    if (!changes) return;

    const rateUpdates = {};
    const costUpdates = {};
    const reconfigured = {};

    for (const [settingKey, coordKey] of Object.entries(COORD_SETTINGS_MAP)) {
      if (changes[settingKey]) {
        const newValue = changes[settingKey].to;
        reconfigured[settingKey] = newValue;

        if (coordKey === 'maxRequestsPerMinute' || coordKey === 'maxTokensPerMinute') {
          rateUpdates[coordKey] = newValue;
        } else {
          costUpdates[coordKey] = newValue;
        }
      }
    }

    // Nothing coordinator-related changed
    if (Object.keys(reconfigured).length === 0) return;

    // Reconfigure rate limiter
    if (Object.keys(rateUpdates).length > 0) {
      rateLimiter.reconfigure(rateUpdates);
      if (adaptiveLimiter) {
        adaptiveLimiter.updateBaseline(rateUpdates);
      }
    }

    // Reconfigure cost aggregator
    if (Object.keys(costUpdates).length > 0) {
      costAggregator.reconfigure(costUpdates);
    }

    log('[coord] Reconfigured from settings change');
    events.emit('coordinator:reconfigured', { changes: reconfigured });
  }

  // Subscribe to settings:changed if events available
  events.on('settings:changed', handleSettingsChanged);

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

  // ── Dependency Management (Phase 53) ─────────────────────

  /**
   * Add a dependency to a task.
   * @param {string} taskId
   * @param {string} depId
   * @returns {object} Updated task
   */
  function addDep(taskId, depId) {
    const result = taskQueue.addDep(taskId, depId);
    events.emit('coord:dep-added', { taskId, depId });
    return result;
  }

  /**
   * Remove a dependency from a task.
   * @param {string} taskId
   * @param {string} depId
   * @returns {object} Updated task
   */
  function removeDep(taskId, depId) {
    const result = taskQueue.removeDep(taskId, depId);
    events.emit('coord:dep-removed', { taskId, depId });
    return result;
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
    addDep,
    removeDep,

    // Subsystem access
    taskQueue,
    workAssigner,
    rateLimiter,
    costAggregator,
    worktreeManager,
    adaptiveLimiter,
    deadLetterQueue,
    categoryDetector,
    costForecaster,

    // Status + Metrics
    getStatus,
    getMetrics,

    // Hot-reconfiguration
    updateOptions,
  };
}

export { STATES };
