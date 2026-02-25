// ============================================================
// Notification Routes (Phase 41)
// ============================================================
// REST API for the in-app notification system.
//
// Endpoints:
//   GET    /api/notifications              — List notifications
//   GET    /api/notifications/unread-count  — Unread count
//   POST   /api/notifications/:id/read     — Mark as read
//   POST   /api/notifications/read-all     — Mark all as read
//   DELETE /api/notifications/:id          — Dismiss notification
//   DELETE /api/notifications              — Clear all
// ============================================================

import { Router } from 'express';

/**
 * Create notification API routes.
 * @param {object} ctx
 * @param {object} ctx.notifications - Notifications instance from createNotifications()
 * @returns {Router}
 */
export function createNotificationRoutes(ctx) {
  const { notifications } = ctx;
  const router = Router();

  // Guard: notifications not available
  function requireNotifications(_req, res, next) {
    if (!notifications) {
      return res.status(503).json({ error: 'Notifications not available' });
    }
    next();
  }

  router.use('/notifications', requireNotifications);

  // List notifications
  router.get('/notifications', (req, res) => {
    try {
      const unreadOnly = req.query.unreadOnly === 'true';
      const type = req.query.type || undefined;
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : undefined;

      const result = notifications.getAll({ unreadOnly, type, limit, offset });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Unread count
  router.get('/notifications/unread-count', (_req, res) => {
    try {
      res.json({ count: notifications.getUnreadCount() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mark as read
  router.post('/notifications/:id/read', (req, res) => {
    try {
      const found = notifications.markRead(req.params.id);
      if (!found) return res.status(404).json({ error: 'Notification not found' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mark all as read
  router.post('/notifications/read-all', (_req, res) => {
    try {
      const count = notifications.markAllRead();
      res.json({ ok: true, count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dismiss notification
  router.delete('/notifications/:id', (req, res) => {
    try {
      const found = notifications.dismiss(req.params.id);
      if (!found) return res.status(404).json({ error: 'Notification not found' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Clear all
  router.delete('/notifications', (_req, res) => {
    try {
      notifications.clear();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
