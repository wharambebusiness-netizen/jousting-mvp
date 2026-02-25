// ============================================================
// Terminal Message Routes (Phase 18)
// ============================================================
// REST API for the inter-terminal message bus.
//
// Endpoints:
//   GET    /api/terminal-messages                  — List messages (query filters)
//   GET    /api/terminal-messages/unread/:id       — Unread count for terminal
//   POST   /api/terminal-messages/mark-read/:id    — Mark messages read
//   GET    /api/terminal-messages/:id              — Get single message
//   GET    /api/terminal-messages/:id/thread       — Get thread for message
//   POST   /api/terminal-messages                  — Send a message
//   DELETE /api/terminal-messages/:id              — Soft-delete message
//   DELETE /api/terminal-messages                  — Clear all messages
// ============================================================

import { Router } from 'express';

export function createTerminalMessageRoutes(ctx) {
  const { messageBus } = ctx;
  const router = Router();

  // Guard: message bus not available
  function requireBus(_req, res, next) {
    if (!messageBus) {
      return res.status(503).json({ error: 'Terminal message bus not available' });
    }
    next();
  }

  router.use('/terminal-messages', requireBus);

  // ── List messages ─────────────────────────────────────────

  router.get('/terminal-messages', (req, res) => {
    try {
      const terminalId = req.query.terminalId || undefined;
      const category = req.query.category || undefined;
      const offset = parseInt(req.query.offset) || 0;
      let limit = parseInt(req.query.limit) || 50;
      if (limit > 200) limit = 200;

      const msgs = messageBus.getAll({ terminalId, limit, offset, category });
      res.json({ count: msgs.length, messages: msgs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Unread count (MUST be before /:id) ────────────────────

  router.get('/terminal-messages/unread/:terminalId', (req, res) => {
    try {
      const unread = messageBus.getUnreadCount(req.params.terminalId);
      res.json({ terminalId: req.params.terminalId, unread });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Mark read (MUST be before /:id) ───────────────────────

  router.post('/terminal-messages/mark-read/:terminalId', (req, res) => {
    try {
      const messageId = req.body && req.body.messageId ? req.body.messageId : undefined;
      const unread = messageBus.markRead(req.params.terminalId, messageId);
      res.json({ terminalId: req.params.terminalId, unread });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Get single message ────────────────────────────────────

  router.get('/terminal-messages/:id', (req, res) => {
    try {
      const msg = messageBus.get(req.params.id);
      if (!msg) {
        return res.status(404).json({ error: `Message not found: ${req.params.id}` });
      }
      res.json(msg);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Get thread ────────────────────────────────────────────

  router.get('/terminal-messages/:id/thread', (req, res) => {
    try {
      const thread = messageBus.getThread(req.params.id);
      if (!thread) {
        return res.status(404).json({ error: `Message not found: ${req.params.id}` });
      }
      res.json({ count: thread.length, messages: thread });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Send message ──────────────────────────────────────────

  router.post('/terminal-messages', (req, res) => {
    try {
      const { from, to, content, category, replyTo } = req.body || {};
      const msg = messageBus.send({ from, to, content, category, replyTo });
      res.status(201).json(msg);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Delete message ────────────────────────────────────────

  router.delete('/terminal-messages/:id', (req, res) => {
    try {
      const deleted = messageBus.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: `Message not found: ${req.params.id}` });
      }
      res.json({ deleted: true, messageId: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Clear all ─────────────────────────────────────────────

  router.delete('/terminal-messages', (req, res) => {
    try {
      const result = messageBus.clear();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
