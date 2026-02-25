// ============================================================
// Auth Routes (Phase 27)
// ============================================================
// REST API for token management (generate, list, revoke).
//
// Endpoints:
//   POST   /api/auth/tokens       — Generate new token
//   GET    /api/auth/tokens       — List tokens (no secrets)
//   DELETE /api/auth/tokens/:id   — Revoke token
// ============================================================

import { Router } from 'express';

/**
 * Create auth API routes.
 * @param {object} ctx
 * @param {object} ctx.auth - Auth instance from createAuth()
 * @returns {Router}
 */
export function createAuthRoutes(ctx) {
  const { auth } = ctx;
  const router = Router();

  // Generate new token
  router.post('/auth/tokens', (req, res) => {
    try {
      const label = req.body?.label || '';
      const result = auth.generateToken(label);
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // List all tokens (no secrets)
  router.get('/auth/tokens', (_req, res) => {
    try {
      const tokens = auth.listTokens();
      res.json({ tokens });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Revoke token by ID
  router.delete('/auth/tokens/:id', (req, res) => {
    try {
      const revoked = auth.revokeToken(req.params.id);
      if (!revoked) {
        return res.status(404).json({ error: `Token not found: ${req.params.id}` });
      }
      res.json({ revoked: true, id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
