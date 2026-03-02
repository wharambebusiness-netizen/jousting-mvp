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
//   GET  /api/coordination/graph         - Dependency graph (nodes, edges, levels)
//   GET  /api/coordination/templates     - Built-in task templates
//   POST /api/coordination/start         - Start coordinator
//   POST /api/coordination/drain         - Begin draining
//   POST /api/coordination/stop          - Stop coordinator
//   GET  /api/coordination/rate-limit    - Rate limiter status
//   GET  /api/coordination/costs         - Cost aggregation status
//   GET  /api/coordination/metrics       - Task throughput & metrics
//   GET  /api/coordination/adaptive-rate - Adaptive rate limiter status
//   POST /api/coordination/config        - Hot-reconfigure coordinator
//   GET  /api/coordination/categories    - List known categories
//   POST /api/coordination/categories/detect - Preview auto-detect category for text
// ============================================================

import { Router } from 'express';
import { validateBody, paginationParams, paginatedResponse } from '../validation.mjs';

// ── Built-in Task Templates ─────────────────────────────────

const TASK_TEMPLATES = [
  {
    id: 'sequential-pipeline',
    name: 'Sequential Pipeline',
    description: 'Three-stage linear pipeline: analyze, implement, verify.',
    tasks: [
      { id: 'analyze', task: 'Analyze requirements and plan approach', priority: 5, category: 'planning' },
      { id: 'implement', task: 'Implement the planned changes', priority: 5, deps: ['analyze'], category: 'development' },
      { id: 'verify', task: 'Verify implementation and run tests', priority: 5, deps: ['implement'], category: 'testing' },
    ],
  },
  {
    id: 'parallel-workers',
    name: 'Parallel Workers',
    description: 'Three independent tasks that merge into a final review.',
    tasks: [
      { id: 'worker-a', task: 'Worker A: process first batch', priority: 1, category: 'development' },
      { id: 'worker-b', task: 'Worker B: process second batch', priority: 1, category: 'development' },
      { id: 'worker-c', task: 'Worker C: process third batch', priority: 1, category: 'development' },
      { id: 'merge', task: 'Merge and review all worker outputs', priority: 5, deps: ['worker-a', 'worker-b', 'worker-c'], category: 'review' },
    ],
  },
  {
    id: 'feature-dev',
    name: 'Feature Development',
    description: 'Plan, then parallel code + tests, then review and deploy.',
    tasks: [
      { id: 'plan', task: 'Plan feature design and architecture', priority: 10, category: 'planning' },
      { id: 'code', task: 'Implement feature code', priority: 5, deps: ['plan'], category: 'development' },
      { id: 'tests', task: 'Write tests for the feature', priority: 5, deps: ['plan'], category: 'testing' },
      { id: 'review', task: 'Code review and integration', priority: 5, deps: ['code', 'tests'], category: 'review' },
      { id: 'deploy', task: 'Deploy to production', priority: 1, deps: ['review'], category: 'deployment' },
    ],
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    description: 'Investigate, fix, test, and verify a bug.',
    tasks: [
      { id: 'investigate', task: 'Investigate root cause of the bug', priority: 10, category: 'debugging' },
      { id: 'fix', task: 'Implement the bug fix', priority: 5, deps: ['investigate'], category: 'development' },
      { id: 'test', task: 'Write regression tests', priority: 5, deps: ['fix'], category: 'testing' },
      { id: 'verify', task: 'Verify fix in staging environment', priority: 1, deps: ['test'], category: 'testing' },
    ],
  },
  {
    id: 'full-cycle',
    name: 'Full Development Cycle',
    description: 'Complete cycle: plan, parallel frontend + backend, integrate, test, deploy.',
    tasks: [
      { id: 'plan', task: 'Requirements analysis and architecture', priority: 10, category: 'planning' },
      { id: 'frontend', task: 'Frontend implementation', priority: 5, deps: ['plan'], category: 'development' },
      { id: 'backend', task: 'Backend implementation', priority: 5, deps: ['plan'], category: 'development' },
      { id: 'integrate', task: 'Integration and API wiring', priority: 5, deps: ['frontend', 'backend'], category: 'development' },
      { id: 'test', task: 'End-to-end testing', priority: 5, deps: ['integrate'], category: 'testing' },
      { id: 'deploy', task: 'Deploy and monitor', priority: 1, deps: ['test'], category: 'deployment' },
    ],
  },
];

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

  router.get('/coordination/tasks', (req, res) => {
    const { limit, offset } = paginationParams(req);
    const status = req.query.status || undefined;
    const category = req.query.category || undefined;

    let all = coordinator.taskQueue.getAll();

    // Filter by status/category if specified
    if (status) all = all.filter(t => t.status === status);
    if (category) all = all.filter(t => t.category === category);

    const total = all.length;
    const items = all.slice(offset, offset + limit);

    res.json(paginatedResponse({ items, total, limit, offset }));
  });

  router.post('/coordination/tasks', validateBody({
    task: { type: 'string', required: true },
    priority: { type: 'number', min: 1, max: 10 },
    category: { type: 'string' },
  }), (req, res) => {
    try {
      // Propagate createdBy into task metadata for master-affinity routing (Phase 69)
      if (req.body.createdBy) {
        req.body.metadata = { ...(req.body.metadata || {}), createdBy: req.body.createdBy };
      }
      const task = coordinator.addTask(req.body);
      res.status(201).json(task);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/coordination/tasks/batch', validateBody({
    tasks: { type: 'array', required: true },
  }), (req, res) => {
    try {
      // Propagate createdBy into task metadata for master-affinity routing (Phase 69)
      const taskDefs = (req.body.tasks || []).map(t => {
        if (t.createdBy) {
          return { ...t, metadata: { ...(t.metadata || {}), createdBy: t.createdBy } };
        }
        return t;
      });
      const tasks = coordinator.addTasks(taskDefs);
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

  // ── Dependency Graph ───────────────────────────────────

  router.get('/coordination/graph', (_req, res) => {
    res.json(coordinator.taskQueue.getDependencyGraph());
  });

  // ── Templates (legacy endpoint — delegates to /api/templates) ──

  router.get('/coordination/templates', (_req, res) => {
    res.json(TASK_TEMPLATES);
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

  // ── Category Detection (Phase 33) ─────────────────────────

  router.get('/coordination/categories', (_req, res) => {
    if (coordinator.categoryDetector) {
      res.json(coordinator.categoryDetector.getCategories());
    } else {
      res.json([]);
    }
  });

  router.post('/coordination/categories/detect', validateBody({
    text: { type: 'string', required: true },
  }), (req, res) => {
    if (coordinator.categoryDetector) {
      const category = coordinator.categoryDetector.detect(req.body.text);
      res.json({ category });
    } else {
      res.json({ category: null });
    }
  });

  // ── Dependency Management (Phase 53) ─────────────────────

  // POST /api/coordination/tasks/:id/deps — add dependency
  router.post('/coordination/tasks/:id/deps', (req, res) => {
    const { depId } = req.body || {};
    if (!depId || typeof depId !== 'string') return res.status(400).json({ error: 'depId is required' });
    try {
      const task = coordinator.addDep(req.params.id, depId);
      res.json(task);
    } catch (err) {
      if (err.message.includes('cycle')) return res.status(400).json({ error: err.message });
      if (err.message.includes('not found') || err.message.includes('Not found')) return res.status(404).json({ error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/coordination/tasks/:id/deps/:depId — remove dependency
  router.delete('/coordination/tasks/:id/deps/:depId', (req, res) => {
    try {
      const task = coordinator.removeDep(req.params.id, req.params.depId);
      res.json(task);
    } catch (err) {
      if (err.message.includes('not found') || err.message.includes('Not found')) return res.status(404).json({ error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
