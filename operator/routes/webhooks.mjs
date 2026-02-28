// ============================================================
// Webhook Routes (Phase 38)
// ============================================================
// REST API for managing webhook subscriptions.
//
// Endpoints:
//   POST   /api/webhooks          - Register webhook
//   GET    /api/webhooks          - List all webhooks
//   GET    /api/webhooks/:id      - Single webhook detail
//   DELETE /api/webhooks/:id      - Unregister webhook
//   PATCH  /api/webhooks/:id      - Update webhook (partial)
//   GET    /api/webhooks/:id/deliveries - Recent delivery log
//   POST   /api/webhooks/:id/test - Send test event
// ============================================================

import { Router } from 'express';

/**
 * Create webhook management routes.
 * @param {object} ctx
 * @param {object} ctx.webhookManager - Webhook manager instance (may be null)
 * @returns {Router}
 */
export function createWebhookRoutes(ctx) {
  const router = Router();
  const { webhookManager } = ctx;

  // Guard: all routes require webhook manager
  router.use('/webhooks', (req, res, next) => {
    if (!webhookManager) {
      return res.status(503).json({ error: 'Webhook manager not available' });
    }
    next();
  });

  // ── Register ──────────────────────────────────────────────

  router.post('/webhooks', (req, res) => {
    try {
      const { url, events, label, secret, format } = req.body || {};
      if (!url || !events) {
        return res.status(400).json({ error: 'url and events are required' });
      }
      const wh = webhookManager.register({ url, events, label, secret, format });
      res.status(201).json(wh);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── List ──────────────────────────────────────────────────

  router.get('/webhooks', (_req, res) => {
    res.json(webhookManager.list());
  });

  // ── Single detail ─────────────────────────────────────────

  router.get('/webhooks/:id', (req, res) => {
    const wh = webhookManager.get(req.params.id);
    if (!wh) return res.status(404).json({ error: 'Webhook not found' });
    res.json(wh);
  });

  // ── Delete ────────────────────────────────────────────────

  router.delete('/webhooks/:id', (req, res) => {
    const removed = webhookManager.unregister(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ ok: true });
  });

  // ── Update (partial) ─────────────────────────────────────

  router.patch('/webhooks/:id', (req, res) => {
    try {
      const updated = webhookManager.update(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: 'Webhook not found' });
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Delivery log ──────────────────────────────────────────

  router.get('/webhooks/:id/deliveries', (req, res) => {
    const wh = webhookManager.get(req.params.id);
    if (!wh) return res.status(404).json({ error: 'Webhook not found' });

    const limit = parseInt(req.query.limit, 10) || 50;
    const deliveries = webhookManager.getDeliveryLog(req.params.id, limit);
    res.json(deliveries);
  });

  // ── Test ──────────────────────────────────────────────────

  router.post('/webhooks/:id/test', async (req, res) => {
    const result = await webhookManager.sendTest(req.params.id);
    if (!result) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ ok: true, delivery: result });
  });

  return router;
}
