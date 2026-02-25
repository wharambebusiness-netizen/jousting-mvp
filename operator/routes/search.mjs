// ============================================================
// Search Routes (Phase 46)
// ============================================================
// REST API for global unified search across all subsystems.
//
// Endpoints:
//   GET /api/search          — Unified search (q, sources, limit, since, until)
//   GET /api/search/sources  — List available search sources
// ============================================================

import { Router } from 'express';

/**
 * Create search API routes.
 * @param {object} ctx
 * @param {object} ctx.searchEngine - Search engine from createSearchEngine()
 * @returns {Router}
 */
export function createSearchRoutes(ctx) {
  const { searchEngine } = ctx;
  const router = Router();

  // Guard: search engine not available
  function requireSearch(_req, res, next) {
    if (!searchEngine) {
      return res.status(503).json({ error: 'Search engine not available' });
    }
    next();
  }

  router.use('/search', requireSearch);

  // GET /api/search — unified search
  router.get('/search', (req, res) => {
    try {
      const q = req.query.q;
      if (!q || String(q).trim().length === 0) {
        return res.status(400).json({ error: 'Query parameter q is required' });
      }

      const options = {};
      if (req.query.sources) {
        options.sources = String(req.query.sources).split(',').map(s => s.trim()).filter(Boolean);
      }
      if (req.query.limit) {
        options.limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
      }
      if (req.query.since) options.since = String(req.query.since);
      if (req.query.until) options.until = String(req.query.until);

      const result = searchEngine.search(q, options);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/search/sources — available sources
  router.get('/search/sources', (_req, res) => {
    try {
      res.json({ sources: searchEngine.getSources() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
