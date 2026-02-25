// ============================================================
// Dead Letter Routes (Phase 32)
// ============================================================
// REST API for dead letter queue management.
//
// Endpoints:
//   GET  /api/coordination/dead-letters          - List entries
//   GET  /api/coordination/dead-letters/stats     - DLQ stats
//   GET  /api/coordination/dead-letters/:id       - Single entry detail
//   POST /api/coordination/dead-letters/:id/retry - Retry task
//   POST /api/coordination/dead-letters/:id/dismiss - Dismiss entry
//   DELETE /api/coordination/dead-letters/:id     - Remove entry
// ============================================================

import { Router } from 'express';
import { paginationParams, paginatedResponse } from '../validation.mjs';

/**
 * Create dead letter queue routes.
 * @param {object} ctx
 * @param {object} ctx.deadLetterQueue - DLQ instance (may be null)
 * @param {object} [ctx.coordinator] - Coordinator for re-queuing retried tasks
 * @returns {Router}
 */
export function createDeadLetterRoutes(ctx) {
  const router = Router();
  const { deadLetterQueue, coordinator } = ctx;

  // Guard: all routes require DLQ
  router.use('/coordination/dead-letters', (req, res, next) => {
    if (!deadLetterQueue) {
      return res.status(503).json({ error: 'Dead letter queue not available' });
    }
    next();
  });

  // ── List entries ─────────────────────────────────────────

  router.get('/coordination/dead-letters', (req, res) => {
    const { status, category } = req.query;
    const { limit, offset } = paginationParams(req);
    const result = deadLetterQueue.getAll({
      status: status || undefined,
      category: category || undefined,
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
  });

  // ── Stats ────────────────────────────────────────────────

  router.get('/coordination/dead-letters/stats', (_req, res) => {
    res.json(deadLetterQueue.getStats());
  });

  // ── Single entry detail ──────────────────────────────────

  router.get('/coordination/dead-letters/:id', (req, res) => {
    const entry = deadLetterQueue.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Dead letter entry not found' });
    res.json(entry);
  });

  // ── Retry ────────────────────────────────────────────────

  router.post('/coordination/dead-letters/:id/retry', (req, res) => {
    const { reassignTo, priority } = req.body || {};
    const taskDef = deadLetterQueue.retry(req.params.id, { reassignTo, priority });

    if (!taskDef) {
      return res.status(404).json({ error: 'Dead letter entry not found' });
    }

    // Re-queue via coordinator if available
    let requeued = null;
    if (coordinator && coordinator.taskQueue) {
      try {
        const newTask = {
          id: taskDef.taskId + '-retry-' + Date.now(),
          task: typeof taskDef.task === 'string' ? taskDef.task : (taskDef.task?.task || taskDef.task?.description || ''),
          category: taskDef.category,
          metadata: { ...taskDef.metadata, retriedFrom: req.params.id },
        };
        if (taskDef.priority != null) newTask.priority = taskDef.priority;
        requeued = coordinator.addTask(newTask);
      } catch (err) {
        return res.status(400).json({ error: `Failed to re-queue: ${err.message}` });
      }
    }

    res.json({ ok: true, taskDef, requeued });
  });

  // ── Dismiss ──────────────────────────────────────────────

  router.post('/coordination/dead-letters/:id/dismiss', (req, res) => {
    const { reason } = req.body || {};
    const result = deadLetterQueue.dismiss(req.params.id, reason);

    if (!result) {
      return res.status(404).json({ error: 'Dead letter entry not found' });
    }

    res.json({ ok: true });
  });

  // ── Remove ───────────────────────────────────────────────

  router.delete('/coordination/dead-letters/:id', (req, res) => {
    const result = deadLetterQueue.remove(req.params.id);

    if (!result) {
      return res.status(404).json({ error: 'Dead letter entry not found' });
    }

    res.json({ ok: true });
  });

  return router;
}
