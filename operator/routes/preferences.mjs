// ============================================================
// Preferences Routes (Phase 39)
// ============================================================
// GET/PUT/PATCH/DELETE /api/preferences — per-user preference
// persistence. User ID derived from req.auth?.id or 'default'.
// ============================================================

import { Router } from 'express';

/**
 * Create preferences routes.
 * @param {{ preferences: object }} ctx
 * @returns {Router}
 */
export function createPreferencesRoutes(ctx) {
  const preferences = ctx.preferences;
  const router = Router();

  function getUserId(req) {
    return req.auth?.id || 'default';
  }

  // GET /api/preferences — returns preferences for current user
  router.get('/preferences', (req, res) => {
    if (!preferences) return res.status(503).json({ error: 'Preferences not available' });
    try {
      res.json(preferences.get(getUserId(req)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/preferences — full replace (validates all fields)
  router.put('/preferences', (req, res) => {
    if (!preferences) return res.status(503).json({ error: 'Preferences not available' });
    try {
      const userId = getUserId(req);
      // Reset first, then set all provided fields
      preferences.reset(userId);
      const result = preferences.set(userId, req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/preferences — partial update (merge fields)
  router.patch('/preferences', (req, res) => {
    if (!preferences) return res.status(503).json({ error: 'Preferences not available' });
    try {
      const result = preferences.set(getUserId(req), req.body || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/preferences — reset to defaults
  router.delete('/preferences', (req, res) => {
    if (!preferences) return res.status(503).json({ error: 'Preferences not available' });
    try {
      const result = preferences.reset(getUserId(req));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
