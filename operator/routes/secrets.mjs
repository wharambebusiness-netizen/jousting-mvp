// ============================================================
// Secrets Routes (Phase 45)
// ============================================================
// REST API for the encrypted secrets vault.
//
// Endpoints:
//   GET    /api/secrets                — List secret names (no values)
//   GET    /api/secrets/export         — Export all secret names for backup
//   GET    /api/secrets/:name          — Get secret value (requires ?reveal=true)
//   GET    /api/secrets/:name/exists   — Check if secret exists
//   PUT    /api/secrets/:name          — Set/update secret { value, label? }
//   DELETE /api/secrets/:name          — Remove secret
// ============================================================

import { Router } from 'express';

/**
 * Create secrets API routes.
 * @param {object} ctx
 * @param {object} ctx.secretVault - Vault instance from createSecretVault()
 * @returns {Router}
 */
export function createSecretRoutes(ctx) {
  const { secretVault } = ctx;
  const router = Router();

  // Guard: vault not available
  function requireVault(_req, res, next) {
    if (!secretVault) {
      return res.status(503).json({ error: 'Secrets vault not available' });
    }
    next();
  }

  router.use('/secrets', requireVault);

  // List all secrets (metadata only, no values)
  router.get('/secrets', (_req, res) => {
    try {
      const secrets = secretVault.list();
      res.json(secrets);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export all secret names for backup reference (POST per spec, but same as list)
  router.post('/secrets/export', (_req, res) => {
    try {
      const secrets = secretVault.list();
      res.json({
        exportedAt: new Date().toISOString(),
        count: secrets.length,
        secrets,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Check if secret exists (must be before :name to avoid conflict)
  router.get('/secrets/:name/exists', (req, res) => {
    try {
      const exists = secretVault.has(req.params.name);
      res.json({ exists });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get single secret value (requires ?reveal=true as safety gate)
  router.get('/secrets/:name', (req, res) => {
    try {
      if (req.query.reveal !== 'true') {
        return res.status(403).json({
          error: 'Secret value not revealed. Add ?reveal=true to confirm.',
        });
      }

      const value = secretVault.get(req.params.name);
      if (value === null) {
        return res.status(404).json({ error: `Secret not found: ${req.params.name}` });
      }

      res.json({ name: req.params.name, value });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Set/update secret
  router.put('/secrets/:name', (req, res) => {
    try {
      const { value, label } = req.body || {};

      if (value === undefined || value === null) {
        return res.status(400).json({ error: 'Request body must include "value"' });
      }
      if (typeof value !== 'string') {
        return res.status(400).json({ error: 'value must be a string' });
      }

      secretVault.set(req.params.name, value, label);

      // Return metadata only (no value in response)
      const secrets = secretVault.list();
      const entry = secrets.find(s => s.name === req.params.name);
      res.json(entry);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Remove secret
  router.delete('/secrets/:name', (req, res) => {
    try {
      const removed = secretVault.remove(req.params.name);
      if (!removed) {
        return res.status(404).json({ error: `Secret not found: ${req.params.name}` });
      }
      res.sendStatus(204);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
