// ============================================================
// Terminal Session Routes (Phase 48)
// ============================================================
// REST API for session history, resume, clone, and templates.
//
// Endpoints:
//   GET  /claude-terminals/sessions                  List sessions
//   GET  /claude-terminals/sessions/:id              Get session detail
//   POST /claude-terminals/sessions/:id/resume       Resume session (spawn new)
//   POST /claude-terminals/sessions/:id/clone        Clone session config (spawn new)
//   GET  /claude-terminals/templates                 List templates
//   POST /claude-terminals/templates                 Save a template
//   DELETE /claude-terminals/templates/:name         Delete a template
//   POST /claude-terminals/spawn-template/:name      Spawn from template
//
// ============================================================

import { Router } from 'express';

/**
 * Create terminal session routes.
 *
 * @param {object} ctx
 * @param {object} ctx.sessionStore  - Terminal session store instance
 * @param {object} ctx.claudePool    - Claude pool for spawning
 * @returns {Router}
 */
export function createTerminalSessionRoutes(ctx) {
  const { sessionStore, claudePool } = ctx;
  const router = Router();

  // ── GET /claude-terminals/sessions ─────────────────────

  router.get('/claude-terminals/sessions', (req, res) => {
    if (!sessionStore) {
      return res.json({ sessions: [], available: false });
    }

    const { status, limit, offset, sort } = req.query;
    const opts = {};
    if (status) opts.status = status;
    if (limit !== undefined) opts.limit = parseInt(limit, 10);
    if (offset !== undefined) opts.offset = parseInt(offset, 10);
    if (sort) opts.sort = sort;

    const result = sessionStore.listSessions(opts);
    res.json({ sessions: result.items, total: result.total, available: true });
  });

  // ── GET /claude-terminals/sessions/:id ─────────────────

  router.get('/claude-terminals/sessions/:id', (req, res) => {
    if (!sessionStore) {
      return res.status(503).json({ error: 'Session store not available' });
    }

    const session = sessionStore.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  });

  // ── POST /claude-terminals/sessions/:id/resume ─────────

  router.post('/claude-terminals/sessions/:id/resume', async (req, res) => {
    if (!sessionStore) {
      return res.status(503).json({ error: 'Session store not available' });
    }
    if (!claudePool) {
      return res.status(503).json({ error: 'Claude pool not available' });
    }

    const session = sessionStore.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const resumeConfig = sessionStore.getResumeConfig(req.params.id);
    if (!resumeConfig) {
      return res.status(404).json({ error: 'Could not build resume config' });
    }

    // Generate a new terminal ID for the resumed session
    const newId = req.body?.id || `resume-${req.params.id}-${Date.now()}`;

    try {
      const result = await claudePool.spawn(newId, resumeConfig);
      res.status(201).json({ ok: true, terminalId: newId, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── POST /claude-terminals/sessions/:id/clone ──────────

  router.post('/claude-terminals/sessions/:id/clone', async (req, res) => {
    if (!sessionStore) {
      return res.status(503).json({ error: 'Session store not available' });
    }
    if (!claudePool) {
      return res.status(503).json({ error: 'Claude pool not available' });
    }

    const session = sessionStore.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Clone uses same config without context injection
    const cloneConfig = { ...session.config };
    const newId = req.body?.id || `clone-${req.params.id}-${Date.now()}`;

    try {
      const result = await claudePool.spawn(newId, cloneConfig);
      res.status(201).json({ ok: true, terminalId: newId, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── DELETE /claude-terminals/sessions/:id ──────────────

  router.delete('/claude-terminals/sessions/:id', (req, res) => {
    if (!sessionStore) {
      return res.status(503).json({ error: 'Session store not available' });
    }

    const deleted = sessionStore.deleteSession(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ ok: true, deleted: true });
  });

  // ── GET /claude-terminals/templates ────────────────────

  router.get('/claude-terminals/templates', (_req, res) => {
    if (!sessionStore) {
      return res.json({ templates: [], available: false });
    }

    res.json({ templates: sessionStore.getTemplates(), available: true });
  });

  // ── POST /claude-terminals/templates ───────────────────

  router.post('/claude-terminals/templates', (req, res) => {
    if (!sessionStore) {
      return res.status(503).json({ error: 'Session store not available' });
    }

    const { name, ...config } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Template name is required' });
    }

    try {
      const template = sessionStore.saveTemplate(name, config);
      res.status(201).json({ ok: true, template });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── DELETE /claude-terminals/templates/:name ───────────

  router.delete('/claude-terminals/templates/:name', (req, res) => {
    if (!sessionStore) {
      return res.status(503).json({ error: 'Session store not available' });
    }

    try {
      const deleted = sessionStore.deleteTemplate(req.params.name);
      if (!deleted) {
        return res.status(404).json({ error: 'Template not found' });
      }
      res.json({ ok: true, deleted: true });
    } catch (err) {
      // Built-in template deletion attempt
      res.status(400).json({ error: err.message });
    }
  });

  // ── POST /claude-terminals/spawn-template/:name ────────

  router.post('/claude-terminals/spawn-template/:name', async (req, res) => {
    if (!sessionStore) {
      return res.status(503).json({ error: 'Session store not available' });
    }
    if (!claudePool) {
      return res.status(503).json({ error: 'Claude pool not available' });
    }

    const template = sessionStore.getTemplate(req.params.name);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Build spawn config from template (allow request body overrides)
    const spawnConfig = {
      model: template.model || undefined,
      projectDir: req.body?.projectDir || template.projectDir || undefined,
      dangerouslySkipPermissions: template.dangerouslySkipPermissions,
      systemPrompt: template.systemPrompt || undefined,
      capabilities: template.capabilities || undefined,
      // Allow additional options from request body
      autoHandoff: !!req.body?.autoHandoff,
      autoDispatch: !!req.body?.autoDispatch,
      autoComplete: !!req.body?.autoComplete,
    };

    const terminalId = req.body?.id || `tmpl-${req.params.name}-${Date.now()}`;

    try {
      const result = await claudePool.spawn(terminalId, spawnConfig);
      res.status(201).json({ ok: true, terminalId, template: req.params.name, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
