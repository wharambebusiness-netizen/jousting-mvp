// ============================================================
// Cost Forecast Routes (Phase 43)
// ============================================================
// REST API for cost forecasting and burn rate.
//
// Endpoints:
//   GET  /api/coordination/forecast             - Full forecast
//   GET  /api/coordination/burn-rate            - Burn rate only
//   POST /api/coordination/forecast/reset-alerts - Reset fired alerts
// ============================================================

import { Router } from 'express';

/**
 * Create cost forecast routes.
 * @param {object} ctx
 * @param {object} ctx.costForecaster - Cost forecaster instance (may be null)
 * @returns {Router}
 */
export function createCostForecastRoutes(ctx) {
  const router = Router();
  const { costForecaster } = ctx;

  // 503 guard when forecaster is null
  function requireForecaster(_req, res, next) {
    if (!costForecaster) {
      return res.status(503).json({ error: 'Cost forecaster not available' });
    }
    next();
  }

  router.get('/coordination/forecast', requireForecaster, (_req, res) => {
    res.json(costForecaster.getForecast());
  });

  router.get('/coordination/burn-rate', requireForecaster, (_req, res) => {
    res.json(costForecaster.getBurnRate());
  });

  router.post('/coordination/forecast/reset-alerts', requireForecaster, (_req, res) => {
    costForecaster.resetAlerts();
    res.json({ ok: true });
  });

  return router;
}
