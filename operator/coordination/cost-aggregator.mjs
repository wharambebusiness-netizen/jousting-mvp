// ============================================================
// Cost Aggregator — Cross-Worker Cost Tracking
// ============================================================
// Real-time cost aggregation across all workers.
// Enforces per-worker and global budget caps.
// Emits coord:budget-warning and coord:budget-exceeded events.
//
// Factory: createCostAggregator(options) returns aggregator.
// ============================================================

// ── Constants ───────────────────────────────────────────────

const WARNING_THRESHOLD = 0.8; // Emit warning at 80% of budget

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a cost aggregator for cross-worker cost tracking.
 * @param {object} [options]
 * @param {number} [options.globalBudgetUsd=100] - Global budget cap in USD
 * @param {number} [options.perWorkerBudgetUsd=25] - Per-worker budget cap in USD
 * @param {object} [options.events] - EventBus for budget events
 * @param {Function} [options.log] - Logger
 * @returns {object} Aggregator methods
 */
export function createCostAggregator(options = {}) {
  let globalBudgetUsd = options.globalBudgetUsd ?? 100;
  let perWorkerBudgetUsd = options.perWorkerBudgetUsd ?? 25;
  const events = options.events || null;
  const log = options.log || (() => {});

  // Per-worker cost records
  const workers = new Map(); // workerId -> { totalUsd, sessions, lastUpdate, warned, exceeded }

  // Global tracking
  let globalTotalUsd = 0;
  let globalWarned = false;
  let globalExceeded = false;

  // ── Worker Cost Records ─────────────────────────────────

  function getWorkerRecord(workerId) {
    if (!workers.has(workerId)) {
      workers.set(workerId, {
        totalUsd: 0,
        sessions: 0,
        inputTokens: 0,
        outputTokens: 0,
        lastUpdate: null,
        warned: false,
        exceeded: false,
      });
    }
    return workers.get(workerId);
  }

  // ── Cost Recording ──────────────────────────────────────

  /**
   * Record a cost event from a worker.
   * @param {string} workerId
   * @param {object} cost
   * @param {number} cost.totalUsd - Cost in USD for this session/request
   * @param {number} [cost.inputTokens] - Input tokens used
   * @param {number} [cost.outputTokens] - Output tokens used
   * @returns {{ allowed: boolean, workerTotal: number, globalTotal: number, workerExceeded: boolean, globalExceeded: boolean }}
   */
  function record(workerId, cost) {
    const usd = cost.totalUsd || 0;
    const record = getWorkerRecord(workerId);

    record.totalUsd += usd;
    record.sessions++;
    record.inputTokens += cost.inputTokens || 0;
    record.outputTokens += cost.outputTokens || 0;
    record.lastUpdate = new Date().toISOString();

    globalTotalUsd += usd;

    log(`[cost] Worker ${workerId}: +$${usd.toFixed(4)} (worker total: $${record.totalUsd.toFixed(4)}, global: $${globalTotalUsd.toFixed(4)})`);

    // Check per-worker warning/exceeded
    if (perWorkerBudgetUsd > 0) {
      const workerRatio = record.totalUsd / perWorkerBudgetUsd;
      if (workerRatio >= WARNING_THRESHOLD && !record.warned) {
        record.warned = true;
        log(`[cost] Worker ${workerId} at ${(workerRatio * 100).toFixed(0)}% of per-worker budget`);
        if (events) {
          events.emit('coord:budget-warning', {
            workerId,
            scope: 'worker',
            totalUsd: record.totalUsd,
            budgetUsd: perWorkerBudgetUsd,
            ratio: workerRatio,
          });
        }
      }
      if (record.totalUsd >= perWorkerBudgetUsd && !record.exceeded) {
        record.exceeded = true;
        log(`[cost] Worker ${workerId} EXCEEDED per-worker budget ($${record.totalUsd.toFixed(4)} >= $${perWorkerBudgetUsd})`);
        if (events) {
          events.emit('coord:budget-exceeded', {
            workerId,
            scope: 'worker',
            totalUsd: record.totalUsd,
            budgetUsd: perWorkerBudgetUsd,
          });
        }
      }
    }

    // Check global warning/exceeded
    if (globalBudgetUsd > 0) {
      const globalRatio = globalTotalUsd / globalBudgetUsd;
      if (globalRatio >= WARNING_THRESHOLD && !globalWarned) {
        globalWarned = true;
        log(`[cost] Global cost at ${(globalRatio * 100).toFixed(0)}% of budget`);
        if (events) {
          events.emit('coord:budget-warning', {
            scope: 'global',
            totalUsd: globalTotalUsd,
            budgetUsd: globalBudgetUsd,
            ratio: globalRatio,
          });
        }
      }
      if (globalTotalUsd >= globalBudgetUsd && !globalExceeded) {
        globalExceeded = true;
        log(`[cost] Global cost EXCEEDED budget ($${globalTotalUsd.toFixed(4)} >= $${globalBudgetUsd})`);
        if (events) {
          events.emit('coord:budget-exceeded', {
            scope: 'global',
            totalUsd: globalTotalUsd,
            budgetUsd: globalBudgetUsd,
          });
        }
      }
    }

    return {
      allowed: !record.exceeded && !globalExceeded,
      workerTotal: record.totalUsd,
      globalTotal: globalTotalUsd,
      workerExceeded: record.exceeded,
      globalExceeded,
    };
  }

  /**
   * Check if a worker is within budget.
   * @param {string} workerId
   * @returns {{ allowed: boolean, workerRemaining: number, globalRemaining: number }}
   */
  function checkBudget(workerId) {
    const record = getWorkerRecord(workerId);
    const workerRemaining = perWorkerBudgetUsd > 0
      ? Math.max(0, perWorkerBudgetUsd - record.totalUsd)
      : Infinity;
    const globalRemaining = globalBudgetUsd > 0
      ? Math.max(0, globalBudgetUsd - globalTotalUsd)
      : Infinity;

    return {
      allowed: workerRemaining > 0 && globalRemaining > 0,
      workerRemaining,
      globalRemaining,
    };
  }

  // ── Status ────────────────────────────────────────────

  /**
   * Get cost status for all workers.
   * @returns {object}
   */
  function getStatus() {
    const workerStats = {};
    for (const [id, record] of workers) {
      workerStats[id] = { ...record };
    }
    return {
      globalTotalUsd,
      globalBudgetUsd,
      globalRemaining: globalBudgetUsd > 0 ? Math.max(0, globalBudgetUsd - globalTotalUsd) : Infinity,
      globalWarned,
      globalExceeded,
      perWorkerBudgetUsd,
      workers: workerStats,
    };
  }

  /**
   * Get cost for a specific worker.
   * @param {string} workerId
   * @returns {object}
   */
  function getWorkerCost(workerId) {
    const record = workers.get(workerId);
    if (!record) return { totalUsd: 0, sessions: 0, inputTokens: 0, outputTokens: 0 };
    return { ...record };
  }

  /**
   * Reset all tracking (for testing).
   */
  function reset() {
    workers.clear();
    globalTotalUsd = 0;
    globalWarned = false;
    globalExceeded = false;
  }

  /**
   * Update budget caps at runtime.
   * Resets warning/exceeded flags if new budget is higher than current totals.
   * @param {object} updates
   * @param {number} [updates.globalBudgetUsd]
   * @param {number} [updates.perWorkerBudgetUsd]
   */
  function updateBudgets(updates) {
    if (updates.globalBudgetUsd != null && updates.globalBudgetUsd > 0) {
      globalBudgetUsd = updates.globalBudgetUsd;
      // Reset flags if budget raised above current totals
      if (globalTotalUsd < globalBudgetUsd) {
        globalExceeded = false;
        globalWarned = globalTotalUsd >= globalBudgetUsd * WARNING_THRESHOLD;
      }
    }
    if (updates.perWorkerBudgetUsd != null && updates.perWorkerBudgetUsd > 0) {
      perWorkerBudgetUsd = updates.perWorkerBudgetUsd;
      // Reset worker flags where applicable
      for (const record of workers.values()) {
        if (record.totalUsd < perWorkerBudgetUsd) {
          record.exceeded = false;
          record.warned = record.totalUsd >= perWorkerBudgetUsd * WARNING_THRESHOLD;
        }
      }
    }
    log(`[cost] Budgets updated: global=$${globalBudgetUsd}, per-worker=$${perWorkerBudgetUsd}`);
  }

  return {
    record,
    checkBudget,
    getStatus,
    getWorkerCost,
    updateBudgets,
    reset,
  };
}

export { WARNING_THRESHOLD };
