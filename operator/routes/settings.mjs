// ============================================================
// Settings Routes (P3)
// ============================================================
// GET/PUT /api/settings — operator default configuration.
// ============================================================

import { Router } from 'express';
import { loadSettings, saveSettings } from '../settings.mjs';

export function createSettingsRoutes() {
  const router = Router();

  router.get('/settings', (_req, res) => {
    try {
      res.json(loadSettings());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/settings', (req, res) => {
    try {
      const body = req.body || {};
      const saved = saveSettings(body);
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
