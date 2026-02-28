// ============================================================
// Template Routes (Phase 61)
// ============================================================
// REST API for workflow template CRUD.
//
// Endpoints:
//   GET    /api/templates          — List all templates
//   GET    /api/templates/:id      — Get single template
//   POST   /api/templates          — Create custom template
//   PUT    /api/templates/:id      — Update custom template
//   DELETE /api/templates/:id      — Delete custom template
//   POST   /api/templates/:id/instantiate — Create tasks from template
// ============================================================

import { Router } from 'express';

/**
 * Create template REST API routes.
 * @param {object} ctx
 * @param {object} ctx.templateManager - Template manager instance
 * @param {object} [ctx.coordinator]   - Coordinator for task instantiation
 * @returns {Router}
 */
export function createTemplateRoutes(ctx) {
  const { templateManager, coordinator } = ctx;
  const router = Router();

  // Guard: template manager not available
  function requireTemplateManager(_req, res, next) {
    if (!templateManager) {
      return res.status(503).json({ error: 'Template system not available' });
    }
    next();
  }

  router.use('/templates', requireTemplateManager);

  // GET /api/templates — list all (built-in + custom)
  router.get('/templates', (_req, res) => {
    res.json(templateManager.list());
  });

  // GET /api/templates/:id — get single template
  router.get('/templates/:id', (req, res) => {
    const tmpl = templateManager.get(req.params.id);
    if (!tmpl) {
      return res.status(404).json({ error: `Template "${req.params.id}" not found` });
    }
    res.json(tmpl);
  });

  // POST /api/templates — create custom template
  router.post('/templates', (req, res) => {
    if (!req.body || !req.body.id || !req.body.name || !req.body.tasks) {
      return res.status(400).json({ error: 'id, name, and tasks are required' });
    }

    const result = templateManager.save(req.body);
    if (!result.ok) {
      return res.status(400).json({ error: result.errors.join('; ') });
    }

    res.status(201).json(result.template);
  });

  // PUT /api/templates/:id — update custom template
  router.put('/templates/:id', (req, res) => {
    const template = { ...req.body, id: req.params.id };

    const existing = templateManager.get(req.params.id);
    if (existing && existing.builtin && !templateManager.get(req.params.id)?.updatedAt) {
      // Creating a custom override of a built-in is fine
    }

    const result = templateManager.save(template);
    if (!result.ok) {
      return res.status(400).json({ error: result.errors.join('; ') });
    }

    res.json(result.template);
  });

  // DELETE /api/templates/:id — delete custom template
  router.delete('/templates/:id', (req, res) => {
    const result = templateManager.remove(req.params.id);
    if (!result.ok) {
      return res.status(result.error.includes('built-in') ? 403 : 404).json({ error: result.error });
    }

    res.json({ ok: true });
  });

  // POST /api/templates/:id/instantiate — create tasks from template
  router.post('/templates/:id/instantiate', (req, res) => {
    const tmpl = templateManager.get(req.params.id);
    if (!tmpl) {
      return res.status(404).json({ error: `Template "${req.params.id}" not found` });
    }

    if (!coordinator) {
      return res.status(503).json({ error: 'Coordinator not available for task instantiation' });
    }

    const prefix = req.body?.prefix || '';
    const results = [];

    for (const t of tmpl.tasks) {
      const taskId = prefix ? `${prefix}${t.id}` : t.id;
      const deps = (t.deps || []).map(d => prefix ? `${prefix}${d}` : d);

      try {
        coordinator.taskQueue.addTask({
          id: taskId,
          task: t.task,
          priority: t.priority || 5,
          deps,
          category: t.category || undefined,
        });
        results.push({ id: taskId, status: 'created' });
      } catch (e) {
        results.push({ id: taskId, status: 'error', error: e.message });
      }
    }

    res.status(201).json({
      template: tmpl.id,
      prefix: prefix || null,
      tasks: results,
      created: results.filter(r => r.status === 'created').length,
      errors: results.filter(r => r.status === 'error').length,
    });
  });

  return router;
}
