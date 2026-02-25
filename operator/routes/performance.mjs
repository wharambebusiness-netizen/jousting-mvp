// ============================================================
// Performance Routes (Phase 50)
// ============================================================
// REST API exposing per-endpoint latency stats from the
// request timer middleware.
//
// Endpoints:
//   GET  /api/performance          — All route timing stats
//   GET  /api/performance/slow     — Recent slow requests
//   GET  /api/performance/summary  — Compact summary
//   GET  /api/performance/:route   — Stats for a specific route
//   POST /api/performance/reset    — Clear all timing data
// ============================================================

import { Router } from 'express';

/**
 * Create performance API routes.
 * @param {object} ctx
 * @param {object} ctx.requestTimer - Request timer instance from createRequestTimer()
 * @returns {Router}
 */
export function createPerformanceRoutes(ctx) {
  const { requestTimer } = ctx;
  const router = Router();

  // Guard: timer not available
  function requireTimer(_req, res, next) {
    if (!requestTimer) {
      return res.status(503).json({ error: 'Request timer not available' });
    }
    next();
  }

  router.use('/performance', requireTimer);

  // GET /api/performance — All route timing stats (sorted by avgMs desc)
  router.get('/performance', (_req, res) => {
    try {
      res.json({ stats: requestTimer.getStats() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/performance/summary — Compact summary
  router.get('/performance/summary', (_req, res) => {
    try {
      const stats = requestTimer.getStats();
      const totalRequests = stats.reduce((sum, s) => sum + s.count, 0);
      const totalErrors = stats.reduce((sum, s) => sum + s.errorCount, 0);
      const totalMs = stats.reduce((sum, s) => sum + s.totalMs, 0);
      const avgLatencyMs = totalRequests > 0
        ? Math.round((totalMs / totalRequests) * 100) / 100
        : 0;
      const errorRate = totalRequests > 0
        ? Math.round((totalErrors / totalRequests) * 10000) / 10000
        : 0;
      const top5 = stats.slice(0, 5);

      res.json({
        totalRequests,
        totalErrors,
        avgLatencyMs,
        errorRate,
        top5Slowest: top5,
        routeCount: stats.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/performance/slow — Recent slow requests
  router.get('/performance/slow', (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
      res.json({ slow: requestTimer.getSlowRequests(limit) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/performance/reset — Clear all timing data
  router.post('/performance/reset', (_req, res) => {
    try {
      requestTimer.reset();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/performance/route/:routeKey — Stats for a specific route (URL-encoded in query)
  // Use ?route= query param to avoid path-to-regexp issues with slashes in route keys
  router.get('/performance/route', (req, res) => {
    try {
      const route = req.query.route ? decodeURIComponent(req.query.route) : null;
      if (!route) {
        return res.status(400).json({ error: 'route query parameter required' });
      }
      const routeStats = requestTimer.getRouteStats(route);
      if (!routeStats) {
        return res.status(404).json({ error: 'Route not found' });
      }
      res.json(routeStats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
