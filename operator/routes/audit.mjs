// ============================================================
// Audit Routes (Phase 31)
// ============================================================
// REST API for querying the append-only audit log.
//
// Endpoints:
//   GET /api/audit       — Query audit log (filter, paginate)
//   GET /api/audit/stats — Summary statistics
// ============================================================

import { Router } from 'express';
import { paginationParams, paginatedResponse } from '../validation.mjs';

/**
 * Create audit log API routes.
 * @param {object} ctx
 * @param {object} ctx.auditLog - Audit log instance from createAuditLog()
 * @returns {Router}
 */
export function createAuditRoutes(ctx) {
  const { auditLog } = ctx;
  const router = Router();

  // Guard: audit log not available
  function requireAuditLog(_req, res, next) {
    if (!auditLog) {
      return res.status(503).json({ error: 'Audit log not available' });
    }
    next();
  }

  router.use('/audit', requireAuditLog);

  // Query audit log
  router.get('/audit', (req, res) => {
    try {
      const { action, actor, target, since, until } = req.query;
      const { limit, offset } = paginationParams(req);
      const result = auditLog.query({
        action: action || undefined,
        actor: actor || undefined,
        target: target || undefined,
        since: since || undefined,
        until: until || undefined,
        limit,
        offset,
      });

      const envelope = paginatedResponse({
        items: result.entries,
        total: result.total,
        limit,
        offset,
      });
      res.json({
        ...envelope,
        // Backward compat alias
        entries: result.entries,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Audit stats
  router.get('/audit/stats', (_req, res) => {
    try {
      const result = auditLog.stats();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
