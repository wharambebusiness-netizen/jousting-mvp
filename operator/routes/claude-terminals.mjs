// ============================================================
// Claude Terminal Routes (Phase 15C)
// ============================================================
// REST API for managing interactive Claude Code terminal sessions.
// CRUD operations + resize + permission toggle.
//
// Endpoints:
//   GET    /claude-terminals              List all terminals
//   GET    /claude-terminals/:id          Get terminal status
//   POST   /claude-terminals              Spawn a new terminal
//   POST   /claude-terminals/:id/resize   Resize terminal
//   POST   /claude-terminals/:id/toggle-permissions  Toggle --dangerously-skip-permissions
//   POST   /claude-terminals/:id/toggle-auto-handoff Toggle auto-handoff (Phase 15E)
//   DELETE /claude-terminals/:id          Kill + remove terminal
//   POST   /claude-terminals/:id/respawn  Kill + respawn with new config
//
// ============================================================

import { Router } from 'express';
import { isNodePtyAvailable } from '../claude-terminal.mjs';

/**
 * Create Claude terminal API routes.
 * @param {object} ctx
 * @param {object} ctx.claudePool - Claude terminal pool instance
 * @param {EventBus} ctx.events - EventBus for real-time events
 * @returns {Router}
 */
export function createClaudeTerminalRoutes(ctx) {
  const { claudePool, events } = ctx;
  const router = Router();

  // ── GET /claude-terminals ─────────────────────────────

  router.get('/claude-terminals', (_req, res) => {
    if (!claudePool) {
      return res.json({ terminals: [], available: false });
    }
    res.json({
      terminals: claudePool.getStatus(),
      available: true,
    });
  });

  // ── GET /claude-terminals/available ───────────────────

  router.get('/claude-terminals/available', async (_req, res) => {
    const available = await isNodePtyAvailable();
    res.json({ available, hasPool: !!claudePool });
  });

  // ── GET /claude-terminals/:id ─────────────────────────

  router.get('/claude-terminals/:id', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    res.json(terminal);
  });

  // ── POST /claude-terminals ────────────────────────────

  router.post('/claude-terminals', async (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const {
      id,
      projectDir,
      model,
      dangerouslySkipPermissions,
      autoHandoff,
      systemPrompt,
      resumeSessionId,
      continueSession,
      cols,
      rows,
    } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'id is required' });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res.status(400).json({ error: 'id must match [a-zA-Z0-9_-]+' });
    }

    try {
      const result = await claudePool.spawn(id, {
        projectDir,
        model,
        dangerouslySkipPermissions: !!dangerouslySkipPermissions,
        autoHandoff: !!autoHandoff,
        systemPrompt,
        resumeSessionId,
        continueSession: !!continueSession,
        cols: cols ? parseInt(cols, 10) : undefined,
        rows: rows ? parseInt(rows, 10) : undefined,
      });

      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── POST /claude-terminals/:id/resize ─────────────────

  router.post('/claude-terminals/:id/resize', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const { cols, rows } = req.body;
    if (!cols || !rows || cols < 1 || rows < 1) {
      return res.status(400).json({ error: 'cols and rows must be positive integers' });
    }

    const ok = claudePool.resize(req.params.id, parseInt(cols, 10), parseInt(rows, 10));
    if (!ok) return res.status(404).json({ error: 'Terminal not found or not running' });

    res.json({ ok: true });
  });

  // ── POST /claude-terminals/:id/toggle-permissions ─────

  router.post('/claude-terminals/:id/toggle-permissions', async (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const newSkip = !terminal.dangerouslySkipPermissions;

    try {
      const result = await claudePool.respawn(req.params.id, {
        dangerouslySkipPermissions: newSkip,
      });

      events.emit('claude-terminal:permission-changed', {
        terminalId: req.params.id,
        dangerouslySkipPermissions: newSkip,
      });

      res.json({ ...result, dangerouslySkipPermissions: newSkip });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /claude-terminals/:id/toggle-auto-handoff ───

  router.post('/claude-terminals/:id/toggle-auto-handoff', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const newState = !terminal.autoHandoff;
    const ok = claudePool.setAutoHandoff(req.params.id, newState);
    if (!ok) return res.status(404).json({ error: 'Terminal not found' });

    events.emit('claude-terminal:auto-handoff-changed', {
      terminalId: req.params.id,
      autoHandoff: newState,
    });

    res.json({ ok: true, terminalId: req.params.id, autoHandoff: newState });
  });

  // ── POST /claude-terminals/:id/respawn ────────────────

  router.post('/claude-terminals/:id/respawn', async (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    try {
      const result = await claudePool.respawn(req.params.id, req.body);

      events.emit('claude-terminal:respawned', {
        terminalId: req.params.id,
        config: req.body,
      });

      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── DELETE /claude-terminals/:id ──────────────────────

  router.delete('/claude-terminals/:id', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    // Kill if running
    if (terminal.status === 'running') {
      claudePool.kill(req.params.id);
    }

    // Remove after a brief delay to allow exit event to fire
    setTimeout(() => {
      try {
        claudePool.remove(req.params.id);
      } catch { /* may have already been removed */ }
    }, 500);

    res.json({ ok: true, terminalId: req.params.id });
  });

  return router;
}
