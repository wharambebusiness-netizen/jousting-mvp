// Phase 43 — Cost Forecaster Tests
// Tests for burn rate calculation, budget exhaustion forecasting,
// threshold alerts, EventBus integration, and REST routes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../shared/event-bus.mjs';
import { createCostForecaster } from '../coordination/cost-forecaster.mjs';
import { createCostAggregator } from '../coordination/cost-aggregator.mjs';
import { createCostForecastRoutes } from '../routes/cost-forecast.mjs';

// ── Helpers ──────────────────────────────────────────────────

function makeForecaster(overrides = {}) {
  const events = overrides.events || new EventBus();
  const costAggregator = 'costAggregator' in overrides
    ? overrides.costAggregator
    : createCostAggregator({
        globalBudgetUsd: overrides.budgetUsd ?? 100,
        events,
      });
  let clock = overrides.startTime || 1_000_000;
  const nowFn = overrides.now || (() => clock);
  const advance = (ms) => { clock += ms; };

  const forecaster = createCostForecaster({
    events,
    costAggregator,
    windowMs: overrides.windowMs ?? 300_000,
    thresholds: overrides.thresholds,
    now: nowFn,
  });

  return { forecaster, events, costAggregator, advance, getClock: () => clock };
}

/** Call an express route handler directly with mock req/res. */
function callRoute(router, method, path) {
  return new Promise((resolve) => {
    // Walk the router stack to find matching handler
    const res = {
      _status: 200,
      _body: null,
      status(code) { res._status = code; return res; },
      json(data) { res._body = data; resolve(res); },
    };
    const req = { method: method.toUpperCase(), body: {} };

    // Use the router handle directly
    router.handle({ ...req, url: path, method: method.toUpperCase() }, res, () => {
      resolve(res);
    });
  });
}

// ── recordCost ──────────────────────────────────────────────

describe('Cost Forecaster — recordCost', () => {
  it('adds to total cost', () => {
    const { forecaster } = makeForecaster();
    forecaster.recordCost(5.0);
    const forecast = forecaster.getForecast();
    expect(forecast.totalCost).toBe(5.0);
  });

  it('tracks multiple cost entries', () => {
    const { forecaster } = makeForecaster();
    forecaster.recordCost(2.0);
    forecaster.recordCost(3.5);
    forecaster.recordCost(1.25);
    const forecast = forecaster.getForecast();
    expect(forecast.totalCost).toBe(6.75);
  });

  it('ignores non-positive amounts', () => {
    const { forecaster } = makeForecaster();
    forecaster.recordCost(0);
    forecaster.recordCost(-1);
    forecaster.recordCost(NaN);
    expect(forecaster.getForecast().totalCost).toBe(0);
  });

  it('increments session count', () => {
    const { forecaster } = makeForecaster();
    forecaster.recordCost(1);
    forecaster.recordCost(2);
    expect(forecaster.getForecast().perSession.sessionCount).toBe(2);
  });
});

// ── getBurnRate ─────────────────────────────────────────────

describe('Cost Forecaster — getBurnRate', () => {
  it('returns 0 when no cost events', () => {
    const { forecaster } = makeForecaster();
    const rate = forecaster.getBurnRate();
    expect(rate.usdPerHour).toBe(0);
    expect(rate.usdPerMinute).toBe(0);
    expect(rate.windowMs).toBe(300_000);
  });

  it('calculates burn rate from sliding window', () => {
    const { forecaster } = makeForecaster();
    // Record $10 in a 5-minute window
    forecaster.recordCost(10.0);
    const rate = forecaster.getBurnRate();
    // $10 / 5 min = $2/min = $120/hr
    expect(rate.usdPerMinute).toBe(2);
    expect(rate.usdPerHour).toBe(120);
  });

  it('only considers events within window', () => {
    const { forecaster, advance } = makeForecaster({ windowMs: 60_000 }); // 1 minute window
    forecaster.recordCost(10.0);
    // Advance past the window
    advance(120_000); // 2 minutes
    forecaster.recordCost(5.0);
    const rate = forecaster.getBurnRate();
    // Only the $5 event is in the 1-minute window
    // $5 / 1 min = $5/min
    expect(rate.usdPerMinute).toBe(5);
  });

  it('prunes old events from window', () => {
    const { forecaster, advance } = makeForecaster({ windowMs: 60_000 });
    forecaster.recordCost(100.0);
    advance(120_000);
    // Old event should be pruned
    const rate = forecaster.getBurnRate();
    expect(rate.usdPerHour).toBe(0);
    expect(rate.usdPerMinute).toBe(0);
  });

  it('respects configurable window size', () => {
    const { forecaster } = makeForecaster({ windowMs: 120_000 }); // 2 minutes
    forecaster.recordCost(6.0);
    const rate = forecaster.getBurnRate();
    // $6 / 2 min = $3/min
    expect(rate.usdPerMinute).toBe(3);
    expect(rate.windowMs).toBe(120_000);
  });
});

// ── getForecast ─────────────────────────────────────────────

describe('Cost Forecaster — getForecast', () => {
  it('returns complete structure', () => {
    const { forecaster } = makeForecaster();
    const f = forecaster.getForecast();
    expect(f).toHaveProperty('totalCost');
    expect(f).toHaveProperty('burnRate');
    expect(f).toHaveProperty('budget');
    expect(f).toHaveProperty('exhaustionEstimate');
    expect(f).toHaveProperty('perSession');
    expect(f).toHaveProperty('daily');
    expect(f.burnRate).toHaveProperty('usdPerHour');
    expect(f.burnRate).toHaveProperty('usdPerMinute');
    expect(f.perSession).toHaveProperty('averageCost');
    expect(f.perSession).toHaveProperty('sessionCount');
    expect(f.daily).toHaveProperty('projectedDailyCost');
  });

  it('calculates budget remaining from aggregator', () => {
    const { forecaster } = makeForecaster({ budgetUsd: 50 });
    forecaster.recordCost(20);
    const f = forecaster.getForecast();
    expect(f.budget.total).toBe(50);
    expect(f.budget.remaining).toBe(30);
    expect(f.budget.usagePercent).toBe(0.4);
  });

  it('calculates exhaustion estimate', () => {
    const { forecaster } = makeForecaster({ budgetUsd: 100 });
    // Record $10 — burn rate is $2/min over 5 min window
    forecaster.recordCost(10);
    const f = forecaster.getForecast();
    expect(f.exhaustionEstimate).not.toBeNull();
    // $90 remaining / $2/min = 45 min
    expect(f.exhaustionEstimate.minutesRemaining).toBe(45);
    expect(f.exhaustionEstimate.estimatedExhaustionTime).toBeTruthy();
  });

  it('handles no budget (null exhaustion)', () => {
    const { forecaster } = makeForecaster({ costAggregator: null });
    forecaster.recordCost(10);
    const f = forecaster.getForecast();
    expect(f.budget).toBeNull();
    expect(f.exhaustionEstimate).toBeNull();
  });

  it('handles zero burn rate (null exhaustion)', () => {
    const { forecaster, advance } = makeForecaster({ budgetUsd: 100, windowMs: 60_000 });
    forecaster.recordCost(10);
    advance(120_000); // move past window so burn rate is 0
    const f = forecaster.getForecast();
    expect(f.exhaustionEstimate).toBeNull();
  });

  it('calculates projected daily cost', () => {
    const { forecaster } = makeForecaster();
    // $10 / 5 min = $120/hr → $2880/day
    forecaster.recordCost(10);
    const f = forecaster.getForecast();
    expect(f.daily.projectedDailyCost).toBe(2880);
  });

  it('calculates per-session average', () => {
    const { forecaster } = makeForecaster();
    forecaster.recordCost(4);
    forecaster.recordCost(6);
    forecaster.recordCost(2);
    const f = forecaster.getForecast();
    expect(f.perSession.averageCost).toBe(4); // 12 / 3
    expect(f.perSession.sessionCount).toBe(3);
  });

  it('returns zero values when empty', () => {
    const { forecaster } = makeForecaster();
    const f = forecaster.getForecast();
    expect(f.totalCost).toBe(0);
    expect(f.burnRate.usdPerHour).toBe(0);
    expect(f.perSession.averageCost).toBe(0);
    expect(f.perSession.sessionCount).toBe(0);
    expect(f.daily.projectedDailyCost).toBe(0);
  });
});

// ── Threshold Alerts ────────────────────────────────────────

describe('Cost Forecaster — Threshold Alerts', () => {
  it('fires at 50% budget usage', () => {
    const { forecaster, events } = makeForecaster({ budgetUsd: 100 });
    const alerts = [];
    events.on('cost:alert', (data) => alerts.push(data));
    forecaster.recordCost(50);
    expect(alerts.length).toBe(1);
    expect(alerts[0].threshold).toBe(0.5);
    expect(alerts[0].usagePercent).toBe(0.5);
    expect(alerts[0].remaining).toBe(50);
  });

  it('fires at 75%, 90%, 95% thresholds', () => {
    const { forecaster, events } = makeForecaster({ budgetUsd: 100 });
    const alerts = [];
    events.on('cost:alert', (data) => alerts.push(data));
    forecaster.recordCost(76); // crosses 50% and 75%
    expect(alerts.length).toBe(2);
    expect(alerts.map(a => a.threshold)).toEqual([0.5, 0.75]);

    forecaster.recordCost(15); // total=91, crosses 90%
    expect(alerts.length).toBe(3);
    expect(alerts[2].threshold).toBe(0.9);

    forecaster.recordCost(5); // total=96, crosses 95%
    expect(alerts.length).toBe(4);
    expect(alerts[3].threshold).toBe(0.95);
  });

  it('each threshold fires only once', () => {
    const { forecaster, events } = makeForecaster({ budgetUsd: 100 });
    const alerts = [];
    events.on('cost:alert', (data) => alerts.push(data));
    forecaster.recordCost(50);
    expect(alerts.length).toBe(1);
    forecaster.recordCost(1); // still above 50%, should not re-fire
    expect(alerts.length).toBe(1);
  });

  it('resetAlerts allows re-firing', () => {
    const { forecaster, events } = makeForecaster({ budgetUsd: 100 });
    const alerts = [];
    events.on('cost:alert', (data) => alerts.push(data));
    forecaster.recordCost(50);
    expect(alerts.length).toBe(1);

    forecaster.resetAlerts();
    forecaster.recordCost(1); // total=51, still above 50%
    expect(alerts.length).toBe(2);
    expect(alerts[1].threshold).toBe(0.5);
  });

  it('does not fire alerts without costAggregator', () => {
    const events = new EventBus();
    const forecaster = createCostForecaster({ events, costAggregator: null });
    const alerts = [];
    events.on('cost:alert', (data) => alerts.push(data));
    forecaster.recordCost(999);
    expect(alerts.length).toBe(0);
  });
});

// ── EventBus Integration ────────────────────────────────────

describe('Cost Forecaster — EventBus', () => {
  it('auto-records cost from coord:cost events', () => {
    const { forecaster, events } = makeForecaster();
    events.emit('coord:cost', { workerId: 'w1', totalUsd: 3.5 });
    expect(forecaster.getForecast().totalCost).toBe(3.5);
  });

  it('auto-records cost from session:complete events', () => {
    const { forecaster, events } = makeForecaster();
    events.emit('session:complete', { workerId: 'w2', costUsd: 2.0 });
    expect(forecaster.getForecast().totalCost).toBe(2.0);
  });

  it('ignores events with zero or missing cost', () => {
    const { forecaster, events } = makeForecaster();
    events.emit('coord:cost', { workerId: 'w1', totalUsd: 0 });
    events.emit('session:complete', { workerId: 'w1' });
    expect(forecaster.getForecast().totalCost).toBe(0);
  });

  it('destroy unwires listeners', () => {
    const { forecaster, events } = makeForecaster();
    forecaster.destroy();
    events.emit('coord:cost', { workerId: 'w1', totalUsd: 10 });
    expect(forecaster.getForecast().totalCost).toBe(0);
  });
});

// ── REST Routes ─────────────────────────────────────────────

describe('Cost Forecaster — Routes', () => {
  it('GET forecast returns forecast data', async () => {
    const { forecaster } = makeForecaster();
    forecaster.recordCost(5);
    const router = createCostForecastRoutes({ costForecaster: forecaster });
    const res = await callRoute(router, 'GET', '/coordination/forecast');
    expect(res._status).toBe(200);
    expect(res._body.totalCost).toBe(5);
    expect(res._body).toHaveProperty('burnRate');
    expect(res._body).toHaveProperty('budget');
  });

  it('GET burn-rate returns burn rate', async () => {
    const { forecaster } = makeForecaster();
    forecaster.recordCost(10);
    const router = createCostForecastRoutes({ costForecaster: forecaster });
    const res = await callRoute(router, 'GET', '/coordination/burn-rate');
    expect(res._status).toBe(200);
    expect(res._body.usdPerMinute).toBe(2);
    expect(res._body.usdPerHour).toBe(120);
  });

  it('POST reset-alerts works', async () => {
    const { forecaster } = makeForecaster();
    const router = createCostForecastRoutes({ costForecaster: forecaster });
    const res = await callRoute(router, 'POST', '/coordination/forecast/reset-alerts');
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
  });

  it('returns 503 when forecaster is null', async () => {
    const router = createCostForecastRoutes({ costForecaster: null });
    const r1 = await callRoute(router, 'GET', '/coordination/forecast');
    expect(r1._status).toBe(503);
    const r2 = await callRoute(router, 'GET', '/coordination/burn-rate');
    expect(r2._status).toBe(503);
    const r3 = await callRoute(router, 'POST', '/coordination/forecast/reset-alerts');
    expect(r3._status).toBe(503);
  });
});

// ── getAlertThresholds ──────────────────────────────────────

describe('Cost Forecaster — getAlertThresholds', () => {
  it('returns default thresholds', () => {
    const { forecaster } = makeForecaster();
    expect(forecaster.getAlertThresholds()).toEqual([0.5, 0.75, 0.9, 0.95]);
  });

  it('returns custom thresholds', () => {
    const { forecaster } = makeForecaster({ thresholds: [0.25, 0.8] });
    expect(forecaster.getAlertThresholds()).toEqual([0.25, 0.8]);
  });
});
