// ============================================================
// Coordination Routes (Phase 6)
// ============================================================
// REST API for inter-orchestrator coordination.
// Task management, status, and control.
//
// Endpoints:
//   GET  /api/coordination/status        - Full coordination status
//   GET  /api/coordination/tasks         - List all tasks
//   POST /api/coordination/tasks         - Add a task
//   POST /api/coordination/tasks/batch   - Add multiple tasks
//   GET   /api/coordination/tasks/:id     - Get task detail
//   PATCH /api/coordination/tasks/:id     - Update task fields
//   POST  /api/coordination/tasks/:id/cancel - Cancel a task
//   POST  /api/coordination/tasks/:id/retry  - Retry a failed task
//   GET  /api/coordination/progress      - Task progress summary
//   POST /api/coordination/start         - Start coordinator
//   POST /api/coordination/drain         - Begin draining
//   POST /api/coordination/stop          - Stop coordinator
//   GET  /api/coordination/rate-limit    - Rate limiter status
//   GET  /api/coordination/costs         - Cost aggregation status
//   GET  /api/coordination/metrics       - Task throughput & metrics
//   GET  /api/coordination/adaptive-rate - Adaptive rate limiter status
//   POST /api/coordination/config        - Hot-reconfigure coordinator
// ============================================================

import { Router } from 'express';

/**
 * Create coordination routes.
 * @param {object} ctx
 * @param {object} ctx.coordinator - Coordinator instance (may be null)
 * @returns {Router}
 */
export function createCoordinationRoutes(ctx) {
  const router = Router();
  const { coordinator } = ctx;

  // Guard: all routes require coordinator
  router.use('/coordination', (req, res, next) => {
    if (!coordinator) {
      return res.status(503).json({ error: 'Coordination not available (pool mode required)' });
    }
    next();
  });

  // ── Status ──────────────────────────────────────────────

  router.get('/coordination/status', (_req, res) => {
    res.json(coordinator.getStatus());
  });

  // ── Lifecycle ───────────────────────────────────────────

  router.post('/coordination/start', (_req, res) => {
    try {
      coordinator.start();
      res.json({ ok: true, state: coordinator.getState() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/coordination/drain', (_req, res) => {
    coordinator.drain();
    res.json({ ok: true, state: coordinator.getState() });
  });

  router.post('/coordination/stop', (_req, res) => {
    coordinator.stop();
    res.json({ ok: true, state: coordinator.getState() });
  });

  // ── Task Management ─────────────────────────────────────

  router.get('/coordination/tasks', (_req, res) => {
    res.json(coordinator.taskQueue.getAll());
  });

  router.post('/coordination/tasks', (req, res) => {
    try {
      const task = coordinator.addTask(req.body);
      res.status(201).json(task);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/coordination/tasks/batch', (req, res) => {
    try {
      const tasks = coordinator.addTasks(req.body.tasks || []);
      res.status(201).json(tasks);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/coordination/tasks/:id', (req, res) => {
    const task = coordinator.taskQueue.get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  router.patch('/coordination/tasks/:id', (req, res) => {
    try {
      const task = coordinator.taskQueue.update(req.params.id, req.body);
      res.json(task);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/coordination/tasks/:id/cancel', (req, res) => {
    try {
      const cancelled = coordinator.taskQueue.cancel(req.params.id, req.body.reason);
      res.json({ cancelled });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/coordination/tasks/:id/retry', (req, res) => {
    try {
      const task = coordinator.taskQueue.retry(req.params.id);
      res.json(task);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Progress ────────────────────────────────────────────

  router.get('/coordination/progress', (_req, res) => {
    res.json(coordinator.taskQueue.getProgress());
  });

  // ── Rate Limiter ────────────────────────────────────────

  router.get('/coordination/rate-limit', (_req, res) => {
    res.json(coordinator.rateLimiter.getStatus());
  });

  // ── Cost Aggregation ────────────────────────────────────

  router.get('/coordination/costs', (_req, res) => {
    res.json(coordinator.costAggregator.getStatus());
  });

  // ── Metrics ──────────────────────────────────────────────

  router.get('/coordination/metrics', (_req, res) => {
    res.json(coordinator.getMetrics());
  });

  // ── Adaptive Rate Limiter ──────────────────────────────────

  router.get('/coordination/adaptive-rate', (_req, res) => {
    if (!coordinator.adaptiveLimiter) {
      return res.json({ enabled: false });
    }
    res.json({ enabled: true, ...coordinator.adaptiveLimiter.getStatus() });
  });

  // ── Hot-Reconfiguration ──────────────────────────────────

  router.post('/coordination/config', (req, res) => {
    const updates = req.body || {};
    coordinator.updateOptions(updates);
    res.json({ ok: true, rateLimiter: coordinator.rateLimiter.getStatus(), costs: coordinator.costAggregator.getStatus() });
  });

  return router;
}
