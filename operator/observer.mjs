// ============================================================
// Observer Agent — Rule-Based Backend Watchdog
// ============================================================
// Deterministic, zero LLM cost monitoring module.
// Detects stuck workers, systemic failures, budget overspend,
// and orphaned tasks on a periodic check interval.
//
// Factory: createObserver(ctx) returns { start, stop, getStatus, destroy }
// ============================================================

const CHECK_INTERVAL_MS = 15_000;     // 15s check cycle
const STUCK_WORKER_THRESHOLD_MS = 120_000;  // 2min waiting = stuck
const CRASH_WINDOW_MS = 300_000;      // 5min crash window
const CRASH_COUNT_THRESHOLD = 3;      // 3 crashes in window = systemic
const BUDGET_HALT_PCT = 0.95;         // 95% budget = halt
const ORPHAN_THRESHOLD_MS = 180_000;  // 3min assigned + no worker = orphan
const ACTION_COOLDOWN_MS = 60_000;    // 60s dedup per action key
const MAX_ACTION_LOG = 100;

/**
 * Create an observer watchdog.
 * @param {object} ctx
 * @param {object} ctx.events - EventBus
 * @param {object} [ctx.claudePool] - Claude terminal pool
 * @param {object} [ctx.coordinator] - Task coordinator
 * @param {object} [ctx.costAggregator] - Cost aggregator (coordinator.costAggregator)
 * @param {object} [ctx.masterCoordinator] - Master coordinator
 * @param {object} [ctx.sharedMemory] - Shared memory
 * @param {Function} [ctx.log] - Logger
 * @returns {object} { start, stop, getStatus, destroy }
 */
export function createObserver(ctx) {
  const { events } = ctx;
  const claudePool = ctx.claudePool || null;
  const coordinator = ctx.coordinator || null;
  const costAggregator = ctx.costAggregator || null;
  const log = ctx.log || (() => {});

  let _running = false;
  let _timer = null;
  let _circuitOpen = false;

  /** @type {number[]} crash timestamps (sliding window) */
  const _crashTimestamps = [];

  /** @type {Map<string, number>} action key → last action time (cooldown) */
  const _cooldowns = new Map();

  /** @type {Array<{ts: string, rule: string, action: string, detail: string}>} */
  const _actionLog = [];

  // ── Crash tracking ────────────────────────────────────

  function _onTerminalExit(data) {
    // Only track worker crashes (non-zero exit or signal)
    if (!data) return;
    const id = data.id || data.terminalId;
    // Skip master terminals
    if (id && id.startsWith('master-')) return;
    const exitCode = data.exitCode ?? data.code;
    const signal = data.signal || data.exitSignal;
    if (exitCode !== 0 || signal) {
      _crashTimestamps.push(Date.now());
    }
  }

  let _exitHandler = null;

  // ── Action helpers ────────────────────────────────────

  function _canAct(key) {
    const last = _cooldowns.get(key);
    if (last && (Date.now() - last) < ACTION_COOLDOWN_MS) return false;
    return true;
  }

  function _recordAction(key, rule, action, detail) {
    _cooldowns.set(key, Date.now());
    const entry = {
      ts: new Date().toISOString(),
      rule,
      action,
      detail,
    };
    _actionLog.push(entry);
    if (_actionLog.length > MAX_ACTION_LOG) _actionLog.shift();
    log(`[observer] ${rule}: ${action} — ${detail}`);
    events.emit('observer:action', { rule, action, detail, ts: entry.ts });
  }

  // ── Rules ─────────────────────────────────────────────

  function _checkStuckWorkers() {
    if (!claudePool) return;
    const terminals = claudePool.getStatus ? claudePool.getStatus() : [];
    const now = Date.now();

    for (const t of terminals) {
      if (t.role === 'master') continue;
      if (t.status !== 'running') continue;
      if (t.activityState !== 'waiting') continue;
      if (!t.assignedTask) continue;

      const lastActivity = t.lastActivityAt ? new Date(t.lastActivityAt).getTime() : (t.spawnedAt ? new Date(t.spawnedAt).getTime() : 0);
      const idleMs = now - lastActivity;

      if (idleMs > STUCK_WORKER_THRESHOLD_MS) {
        const key = `stuck:${t.id}`;
        if (!_canAct(key)) continue;

        // Try to respawn
        try {
          if (claudePool.respawnTerminal) {
            claudePool.respawnTerminal(t.id);
            _recordAction(key, 'stuck-worker', 'respawn', `Worker ${t.id} stuck for ${Math.round(idleMs / 1000)}s, respawning`);
          } else if (claudePool.killTerminal) {
            claudePool.killTerminal(t.id);
            _recordAction(key, 'stuck-worker', 'kill', `Worker ${t.id} stuck for ${Math.round(idleMs / 1000)}s, killed`);
            // Release task back to pending
            _releaseTask(t);
          }
        } catch (err) {
          // Respawn failed — release task
          _releaseTask(t);
          _recordAction(key, 'stuck-worker', 'release-task', `Worker ${t.id} respawn failed, task released`);
        }
      }
    }
  }

  function _releaseTask(terminal) {
    if (!coordinator || !coordinator.taskQueue) return;
    const taskId = terminal.assignedTask?.id || terminal.assignedTask?.taskId;
    if (!taskId) return;
    try {
      coordinator.taskQueue.fail(taskId, `Worker ${terminal.id} stuck/crashed`);
      coordinator.taskQueue.retry(taskId);
    } catch { /* task may be terminal */ }
  }

  function _checkSystemicFailure() {
    const now = Date.now();
    // Prune old timestamps
    while (_crashTimestamps.length > 0 && (now - _crashTimestamps[0]) > CRASH_WINDOW_MS) {
      _crashTimestamps.shift();
    }

    if (_crashTimestamps.length >= CRASH_COUNT_THRESHOLD && !_circuitOpen) {
      _circuitOpen = true;
      _recordAction('circuit', 'systemic-failure', 'circuit-open', `${_crashTimestamps.length} crashes in ${CRASH_WINDOW_MS / 1000}s window`);
      events.emit('observer:circuit-open', { crashes: _crashTimestamps.length, windowMs: CRASH_WINDOW_MS });

      // Stop swarm if running
      if (claudePool && claudePool.stopSwarm) {
        try { claudePool.stopSwarm(); } catch { /* ignore */ }
      }
    } else if (_circuitOpen && _crashTimestamps.length < CRASH_COUNT_THRESHOLD) {
      _circuitOpen = false;
      _recordAction('circuit', 'systemic-failure', 'circuit-closed', 'Crash rate normalized');
      events.emit('observer:circuit-closed', {});
    }
  }

  function _checkBudget() {
    if (!costAggregator) return;

    let totalUsd = 0;
    let budgetUsd = 0;

    try {
      const costs = costAggregator.getSummary ? costAggregator.getSummary() : null;
      if (costs) {
        totalUsd = costs.globalTotalUsd || costs.totalUsd || 0;
        budgetUsd = costs.budgetUsd || costs.budgetCapUsd || 0;
      }
    } catch { return; }

    if (budgetUsd <= 0) return; // No budget set

    const pct = totalUsd / budgetUsd;
    if (pct >= BUDGET_HALT_PCT) {
      const key = 'budget-halt';
      if (!_canAct(key)) return;

      _recordAction(key, 'budget-overspend', 'halt', `Cost $${totalUsd.toFixed(2)} is ${Math.round(pct * 100)}% of $${budgetUsd.toFixed(2)} budget`);
      events.emit('observer:budget-halt', { totalUsd, budgetUsd, pct });

      // Stop swarm
      if (claudePool && claudePool.stopSwarm) {
        try { claudePool.stopSwarm(); } catch { /* ignore */ }
      }
    }
  }

  function _checkOrphanedTasks() {
    if (!coordinator || !coordinator.taskQueue) return;
    if (!claudePool) return;

    const now = Date.now();
    let tasks;
    try {
      tasks = coordinator.taskQueue.list ? coordinator.taskQueue.list() : [];
    } catch { return; }

    const terminals = claudePool.getStatus ? claudePool.getStatus() : [];
    const liveWorkerIds = new Set(terminals.filter(t => t.status === 'running').map(t => t.id));

    for (const task of tasks) {
      if (task.status !== 'assigned') continue;
      const workerId = task.assignedTo || task.workerId;
      if (!workerId) continue;
      if (liveWorkerIds.has(workerId)) continue;

      // Worker is gone — check how long
      const assignedAt = task.assignedAt ? new Date(task.assignedAt).getTime() : now;
      if ((now - assignedAt) < ORPHAN_THRESHOLD_MS) continue;

      const key = `orphan:${task.id}`;
      if (!_canAct(key)) continue;

      try {
        coordinator.taskQueue.fail(task.id, `Worker ${workerId} gone (orphaned task)`);
        coordinator.taskQueue.retry(task.id);
        _recordAction(key, 'orphaned-task', 'retry', `Task ${task.id} orphaned (worker ${workerId} gone), retried`);
      } catch { /* task may be terminal */ }
    }
  }

  // ── Main check loop ───────────────────────────────────

  function _runChecks() {
    try { _checkStuckWorkers(); } catch (e) { log(`[observer] stuck-worker check error: ${e.message}`); }
    try { _checkSystemicFailure(); } catch (e) { log(`[observer] systemic-failure check error: ${e.message}`); }
    try { _checkBudget(); } catch (e) { log(`[observer] budget check error: ${e.message}`); }
    try { _checkOrphanedTasks(); } catch (e) { log(`[observer] orphaned-task check error: ${e.message}`); }
  }

  // ── Public API ────────────────────────────────────────

  function start() {
    if (_running) return;
    _running = true;

    // Subscribe to terminal exit events
    _exitHandler = _onTerminalExit.bind(null);
    events.on('claude-terminal:exit', _exitHandler);

    _timer = setInterval(_runChecks, CHECK_INTERVAL_MS);
    _timer.unref();

    log('[observer] Started');
    events.emit('observer:started', {});
  }

  function stop() {
    if (!_running) return;
    _running = false;

    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }

    if (_exitHandler) {
      events.off('claude-terminal:exit', _exitHandler);
      _exitHandler = null;
    }

    log('[observer] Stopped');
    events.emit('observer:stopped', {});
  }

  function getStatus() {
    return {
      running: _running,
      circuitOpen: _circuitOpen,
      recentCrashes: _crashTimestamps.length,
      actionLog: _actionLog.slice(-20),
      cooldowns: Object.fromEntries(_cooldowns),
    };
  }

  function destroy() {
    stop();
    _crashTimestamps.length = 0;
    _cooldowns.clear();
    _actionLog.length = 0;
  }

  return { start, stop, getStatus, destroy };
}

export { CHECK_INTERVAL_MS, STUCK_WORKER_THRESHOLD_MS, CRASH_WINDOW_MS, CRASH_COUNT_THRESHOLD, BUDGET_HALT_PCT, ORPHAN_THRESHOLD_MS, ACTION_COOLDOWN_MS };
