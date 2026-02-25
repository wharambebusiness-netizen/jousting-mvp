// ============================================================
// Bulk Operations Routes (Phase 40)
// ============================================================
// Batch endpoints for bulk task/chain/DLQ operations.
// Each endpoint accepts { ids: string[] } (max 100) and returns
// per-item results with total/succeeded/failed counts.
//
// Endpoints:
//   POST /api/bulk/tasks/cancel        - Bulk cancel tasks
//   POST /api/bulk/tasks/retry         - Bulk retry failed tasks
//   POST /api/bulk/tasks/update        - Bulk update task fields
//   POST /api/bulk/chains/archive      - Bulk archive chains
//   POST /api/bulk/dead-letters/retry  - Bulk retry DLQ entries
//   POST /api/bulk/dead-letters/dismiss - Bulk dismiss DLQ entries
// ============================================================

import { Router } from 'express';
import { randomBytes } from 'node:crypto';

const MAX_BULK_IDS = 100;

/**
 * Validate the ids array in the request body.
 * Returns null if valid, or an error response object if invalid.
 */
function validateIds(body) {
  if (!body || !Array.isArray(body.ids)) {
    return { error: 'ids must be an array' };
  }
  if (body.ids.length === 0) {
    return { error: 'ids array must not be empty' };
  }
  if (body.ids.length > MAX_BULK_IDS) {
    return { error: `ids array exceeds maximum of ${MAX_BULK_IDS} items` };
  }
  return null;
}

/**
 * Build the standard bulk response envelope.
 */
function bulkResponse(results) {
  const succeeded = results.filter(r => r.success).length;
  return {
    results,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
  };
}

/**
 * Create bulk operation routes.
 * @param {object} ctx
 * @param {object} [ctx.coordinator] - Coordinator instance (for task queue access)
 * @param {object} [ctx.deadLetterQueue] - DLQ instance
 * @param {object} [ctx.registry] - Chain registry (for chain archival)
 * @param {object} [ctx.auditLog] - For recording bulk actions
 * @returns {Router}
 */
export function createBulkRoutes(ctx) {
  const router = Router();
  const { coordinator, deadLetterQueue, registry, auditLog } = ctx;

  // ── Bulk Cancel Tasks ───────────────────────────────────

  router.post('/bulk/tasks/cancel', (req, res) => {
    if (!coordinator) {
      return res.status(503).json({ error: 'Coordination not available' });
    }

    const err = validateIds(req.body);
    if (err) return res.status(400).json(err);

    const results = req.body.ids.map(id => {
      try {
        const cancelled = coordinator.taskQueue.cancel(id);
        return { id, success: true, cancelled };
      } catch (e) {
        return { id, success: false, error: e.message };
      }
    });

    const resp = bulkResponse(results);

    if (auditLog) {
      auditLog.record({
        action: 'bulk.tasks.cancel',
        detail: { count: resp.total, succeeded: resp.succeeded, failed: resp.failed },
      });
    }

    res.json(resp);
  });

  // ── Bulk Retry Tasks ────────────────────────────────────

  router.post('/bulk/tasks/retry', (req, res) => {
    if (!coordinator) {
      return res.status(503).json({ error: 'Coordination not available' });
    }

    const err = validateIds(req.body);
    if (err) return res.status(400).json(err);

    const results = req.body.ids.map(id => {
      try {
        const task = coordinator.taskQueue.retry(id);
        return { id, success: true, task };
      } catch (e) {
        return { id, success: false, error: e.message };
      }
    });

    const resp = bulkResponse(results);

    if (auditLog) {
      auditLog.record({
        action: 'bulk.tasks.retry',
        detail: { count: resp.total, succeeded: resp.succeeded, failed: resp.failed },
      });
    }

    res.json(resp);
  });

  // ── Bulk Update Tasks ───────────────────────────────────

  router.post('/bulk/tasks/update', (req, res) => {
    if (!coordinator) {
      return res.status(503).json({ error: 'Coordination not available' });
    }

    const err = validateIds(req.body);
    if (err) return res.status(400).json(err);

    const updates = req.body.updates || {};

    const results = req.body.ids.map(id => {
      try {
        const task = coordinator.taskQueue.update(id, updates);
        return { id, success: true, task };
      } catch (e) {
        return { id, success: false, error: e.message };
      }
    });

    const resp = bulkResponse(results);

    if (auditLog) {
      auditLog.record({
        action: 'bulk.tasks.update',
        detail: { count: resp.total, succeeded: resp.succeeded, failed: resp.failed, updates },
      });
    }

    res.json(resp);
  });

  // ── Bulk Archive Chains ─────────────────────────────────

  router.post('/bulk/chains/archive', (req, res) => {
    if (!registry) {
      return res.status(503).json({ error: 'Registry not available' });
    }

    const err = validateIds(req.body);
    if (err) return res.status(400).json(err);

    const regData = registry.load();
    const results = req.body.ids.map(id => {
      try {
        const chain = regData.chains.find(c => c.id === id);
        if (!chain) {
          return { id, success: false, error: 'Chain not found' };
        }
        chain.status = 'archived';
        chain.updatedAt = new Date().toISOString();
        return { id, success: true };
      } catch (e) {
        return { id, success: false, error: e.message };
      }
    });
    registry.save(regData);

    const resp = bulkResponse(results);

    if (auditLog) {
      auditLog.record({
        action: 'bulk.chains.archive',
        detail: { count: resp.total, succeeded: resp.succeeded, failed: resp.failed },
      });
    }

    res.json(resp);
  });

  // ── Bulk DLQ Retry ──────────────────────────────────────

  router.post('/bulk/dead-letters/retry', (req, res) => {
    if (!deadLetterQueue) {
      return res.status(503).json({ error: 'Dead letter queue not available' });
    }

    const err = validateIds(req.body);
    if (err) return res.status(400).json(err);

    const results = req.body.ids.map(id => {
      try {
        const taskDef = deadLetterQueue.retry(id);
        if (!taskDef) {
          return { id, success: false, error: 'Not found' };
        }

        // Re-queue via coordinator if available
        let requeued = null;
        if (coordinator && coordinator.taskQueue) {
          const newTask = {
            id: (taskDef.taskId || id) + '-retry-' + randomBytes(4).toString('hex'),
            task: typeof taskDef.task === 'string'
              ? taskDef.task
              : (taskDef.task?.task || taskDef.task?.description || ''),
            category: taskDef.category,
            metadata: { ...taskDef.metadata, retriedFrom: id },
          };
          if (taskDef.priority != null) newTask.priority = taskDef.priority;
          requeued = coordinator.addTask(newTask);
        }

        return { id, success: true, requeued };
      } catch (e) {
        return { id, success: false, error: e.message };
      }
    });

    const resp = bulkResponse(results);

    if (auditLog) {
      auditLog.record({
        action: 'bulk.dead-letters.retry',
        detail: { count: resp.total, succeeded: resp.succeeded, failed: resp.failed },
      });
    }

    res.json(resp);
  });

  // ── Bulk DLQ Dismiss ────────────────────────────────────

  router.post('/bulk/dead-letters/dismiss', (req, res) => {
    if (!deadLetterQueue) {
      return res.status(503).json({ error: 'Dead letter queue not available' });
    }

    const err = validateIds(req.body);
    if (err) return res.status(400).json(err);

    const reason = req.body.reason || null;

    const results = req.body.ids.map(id => {
      try {
        const ok = deadLetterQueue.dismiss(id, reason);
        if (!ok) {
          return { id, success: false, error: 'Not found' };
        }
        return { id, success: true };
      } catch (e) {
        return { id, success: false, error: e.message };
      }
    });

    const resp = bulkResponse(results);

    if (auditLog) {
      auditLog.record({
        action: 'bulk.dead-letters.dismiss',
        detail: { count: resp.total, succeeded: resp.succeeded, failed: resp.failed, reason },
      });
    }

    res.json(resp);
  });

  return router;
}
