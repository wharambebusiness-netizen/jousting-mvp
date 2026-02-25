// ============================================================
// Cost Forecaster — Burn Rate & Budget Exhaustion Forecasting
// ============================================================
// Tracks spending over a sliding window, projects budget
// exhaustion time, and fires threshold alerts when budget
// usage crosses configured percentages.
//
// Factory: createCostForecaster(ctx) returns forecaster.
// ============================================================

// ── Constants ───────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 300_000; // 5 minutes
const DEFAULT_THRESHOLDS = [0.5, 0.75, 0.9, 0.95];

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a cost forecaster for burn rate tracking and budget alerts.
 * @param {object} [ctx]
 * @param {object}   [ctx.events]         - EventBus for event subscriptions + alert emission
 * @param {object}   [ctx.costAggregator] - Existing cost aggregator (optional)
 * @param {Function} [ctx.log]            - Logger
 * @param {number}   [ctx.windowMs]       - Sliding window in ms (default 5 min)
 * @param {number[]} [ctx.thresholds]     - Budget usage % thresholds for alerts
 * @param {Function} [ctx.now]            - Clock function for testing (default Date.now)
 * @returns {object} Forecaster methods
 */
export function createCostForecaster(ctx = {}) {
  const events = ctx.events || null;
  const costAggregator = ctx.costAggregator || null;
  const log = ctx.log || (() => {});
  const windowMs = ctx.windowMs ?? DEFAULT_WINDOW_MS;
  const thresholds = ctx.thresholds ?? [...DEFAULT_THRESHOLDS];
  const now = ctx.now || Date.now;

  // ── Internal State ──────────────────────────────────────

  const _costEvents = [];        // { ts, amount }
  const _alertsFired = new Set(); // thresholds already fired
  let _totalCost = 0;
  let _sessionCount = 0;

  // ── Core Methods ────────────────────────────────────────

  /**
   * Record a cost event.
   * @param {number} amount - Cost in USD
   */
  function recordCost(amount) {
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return;

    _costEvents.push({ ts: now(), amount });
    _totalCost += amount;
    _sessionCount++;

    log(`[forecast] +$${amount.toFixed(4)} (total: $${_totalCost.toFixed(4)})`);

    // Check threshold alerts
    _checkThresholds();
  }

  /**
   * Get burn rate from the sliding window.
   * @returns {{ usdPerHour: number, usdPerMinute: number, windowMs: number }}
   */
  function getBurnRate() {
    _pruneWindow();

    if (_costEvents.length === 0) {
      return { usdPerHour: 0, usdPerMinute: 0, windowMs };
    }

    let windowTotal = 0;
    for (const e of _costEvents) {
      windowTotal += e.amount;
    }

    const windowMinutes = windowMs / 60_000;
    const usdPerMinute = windowTotal / windowMinutes;
    const usdPerHour = usdPerMinute * 60;

    return {
      usdPerHour: Math.round(usdPerHour * 10000) / 10000,
      usdPerMinute: Math.round(usdPerMinute * 10000) / 10000,
      windowMs,
    };
  }

  /**
   * Get full forecast including budget exhaustion estimate.
   * @returns {object}
   */
  function getForecast() {
    const burnRate = getBurnRate();

    // Budget info from cost aggregator
    let budget = null;
    if (costAggregator) {
      const status = costAggregator.getStatus();
      const total = status.globalBudgetUsd || 0;
      const remaining = total > 0 ? Math.max(0, total - _totalCost) : 0;
      const usagePercent = total > 0 ? Math.round((_totalCost / total) * 10000) / 10000 : 0;
      budget = { total, remaining, usagePercent };
    }

    // Exhaustion estimate
    let exhaustionEstimate = null;
    if (budget && budget.total > 0 && burnRate.usdPerMinute > 0) {
      const minutesRemaining = budget.remaining / burnRate.usdPerMinute;
      const estimatedExhaustionTime = new Date(now() + minutesRemaining * 60_000).toISOString();
      exhaustionEstimate = {
        minutesRemaining: Math.round(minutesRemaining * 100) / 100,
        estimatedExhaustionTime,
      };
    }

    // Per-session average
    const perSession = {
      averageCost: _sessionCount > 0 ? Math.round((_totalCost / _sessionCount) * 10000) / 10000 : 0,
      sessionCount: _sessionCount,
    };

    // Projected daily cost
    const daily = {
      projectedDailyCost: Math.round(burnRate.usdPerHour * 24 * 10000) / 10000,
    };

    return {
      totalCost: Math.round(_totalCost * 10000) / 10000,
      burnRate,
      budget,
      exhaustionEstimate,
      perSession,
      daily,
    };
  }

  /**
   * Get configured alert thresholds.
   * @returns {number[]}
   */
  function getAlertThresholds() {
    return [...thresholds];
  }

  /**
   * Reset fired alerts (allows re-firing).
   */
  function resetAlerts() {
    _alertsFired.clear();
  }

  /**
   * Destroy — unwire EventBus listeners.
   */
  function destroy() {
    if (events) {
      for (const [event, handler] of _eventHandlers) {
        events.off(event, handler);
      }
    }
    _eventHandlers.length = 0;
  }

  // ── Internal Helpers ────────────────────────────────────

  /**
   * Prune cost events outside the sliding window.
   */
  function _pruneWindow() {
    const cutoff = now() - windowMs;
    while (_costEvents.length > 0 && _costEvents[0].ts < cutoff) {
      _costEvents.shift();
    }
  }

  /**
   * Check if any budget thresholds have been crossed.
   */
  function _checkThresholds() {
    if (!costAggregator || !events) return;

    const status = costAggregator.getStatus();
    const budgetTotal = status.globalBudgetUsd || 0;
    if (budgetTotal <= 0) return;

    const usagePercent = _totalCost / budgetTotal;
    const remaining = Math.max(0, budgetTotal - _totalCost);
    const burnRate = getBurnRate();

    for (const threshold of thresholds) {
      if (usagePercent >= threshold && !_alertsFired.has(threshold)) {
        _alertsFired.add(threshold);
        log(`[forecast] Budget alert: ${(threshold * 100).toFixed(0)}% threshold crossed (usage: ${(usagePercent * 100).toFixed(1)}%)`);
        events.emit('cost:alert', {
          threshold,
          usagePercent: Math.round(usagePercent * 10000) / 10000,
          remaining: Math.round(remaining * 10000) / 10000,
          burnRate,
        });
      }
    }
  }

  // ── EventBus Wiring ─────────────────────────────────────

  const _eventHandlers = [];

  if (events) {
    // Listen for coord:cost events (worker cost reports)
    const coordCostHandler = (data) => {
      const amount = data?.totalUsd || 0;
      if (amount > 0) recordCost(amount);
    };
    events.on('coord:cost', coordCostHandler);
    _eventHandlers.push(['coord:cost', coordCostHandler]);

    // Listen for session:complete events (auto-bridged session costs)
    const sessionHandler = (data) => {
      const amount = data?.costUsd || 0;
      if (amount > 0) recordCost(amount);
    };
    events.on('session:complete', sessionHandler);
    _eventHandlers.push(['session:complete', sessionHandler]);
  }

  return {
    recordCost,
    getBurnRate,
    getForecast,
    getAlertThresholds,
    resetAlerts,
    destroy,
  };
}

export { DEFAULT_WINDOW_MS, DEFAULT_THRESHOLDS };
