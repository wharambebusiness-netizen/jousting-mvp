// ============================================================
// Timeline Routes (Phase 37)
// ============================================================
// REST API for aggregated activity feed built on the audit log.
//
// Endpoints:
//   GET /api/timeline         — Enriched activity feed
//   GET /api/timeline/summary — Activity counts per category
// ============================================================

import { Router } from 'express';
import { paginationParams, paginatedResponse } from '../validation.mjs';

// ── Action-to-Category Mapping ──────────────────────────────

export const ACTION_CATEGORY_MAP = {
  'terminal.spawn': 'terminal',
  'terminal.exit':  'terminal',
  'task.complete':  'task',
  'task.fail':      'task',
  'swarm.start':    'swarm',
  'swarm.stop':     'swarm',
  'coordinator.start': 'system',
  'coordinator.stop':  'system',
  'memory.write':   'memory',
};

export const CATEGORY_ACTIONS = {
  terminal: ['terminal.spawn', 'terminal.exit'],
  task:     ['task.complete', 'task.fail'],
  swarm:    ['swarm.start', 'swarm.stop'],
  system:   ['coordinator.start', 'coordinator.stop'],
  memory:   ['memory.write'],
};

const ALL_CATEGORIES = Object.keys(CATEGORY_ACTIONS);

// ── Summary Generation ──────────────────────────────────────

const SUMMARY_TEMPLATES = {
  'terminal.spawn':    (e) => `Terminal ${e.target || 'unknown'} spawned`,
  'terminal.exit':     (e) => `Terminal ${e.target || 'unknown'} exited`,
  'task.complete':     (e) => `Task ${e.target || 'unknown'} completed`,
  'task.fail':         (e) => `Task ${e.target || 'unknown'} failed`,
  'swarm.start':       () => 'Swarm mode started',
  'swarm.stop':        () => 'Swarm mode stopped',
  'coordinator.start': () => 'Coordinator started',
  'coordinator.stop':  () => 'Coordinator stopped',
  'memory.write':      (e) => `Shared memory key '${e.target || 'unknown'}' updated`,
};

export function generateSummary(entry) {
  const fn = SUMMARY_TEMPLATES[entry.action];
  return fn ? fn(entry) : `${entry.action || 'unknown'} occurred`;
}

export function categorizeAction(action) {
  return ACTION_CATEGORY_MAP[action] || 'system';
}

function enrichEntry(entry) {
  return {
    ...entry,
    category: categorizeAction(entry.action),
    summary: generateSummary(entry),
  };
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create timeline API routes.
 * @param {object} ctx
 * @param {object} ctx.auditLog - Audit log instance
 * @returns {Router}
 */
export function createTimelineRoutes(ctx) {
  const { auditLog } = ctx;
  const router = Router();

  // Guard: audit log not available
  function requireAuditLog(_req, res, next) {
    if (!auditLog) {
      return res.status(503).json({ error: 'Timeline not available (audit log disabled)' });
    }
    next();
  }

  router.use('/timeline', requireAuditLog);

  // GET /api/timeline — aggregated activity feed
  router.get('/timeline', (req, res) => {
    try {
      const { limit, offset } = paginationParams(req);
      const { category } = req.query;

      // Default since = last 24 hours
      const since = req.query.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const until = req.query.until || undefined;

      // Always query without limit/offset so we can compute correct totals
      // after category post-filtering, then paginate ourselves
      let result = auditLog.query({ since, until });
      let entries = result.entries;

      // Post-filter by category if specified
      if (category && CATEGORY_ACTIONS[category]) {
        const allowedActions = new Set(CATEGORY_ACTIONS[category]);
        entries = entries.filter(e => allowedActions.has(e.action));
      }

      const total = entries.length;
      const paginated = entries.slice(offset, offset + limit);
      const enriched = paginated.map(enrichEntry);

      res.json(paginatedResponse({
        items: enriched,
        total,
        limit,
        offset,
      }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/timeline/summary — activity counts per category
  router.get('/timeline/summary', (req, res) => {
    try {
      const since = req.query.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const until = req.query.until || undefined;

      const result = auditLog.query({ since, until, limit: 10000 });
      const counts = {};
      for (const cat of ALL_CATEGORIES) counts[cat] = 0;

      let grandTotal = 0;
      for (const entry of result.entries) {
        const cat = categorizeAction(entry.action);
        counts[cat] = (counts[cat] || 0) + 1;
        grandTotal++;
      }

      res.json({ ...counts, total: grandTotal });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
