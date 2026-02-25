// ============================================================
// Backup Routes (Phase 51)
// ============================================================
// REST API for full-state backup and restore.
//
// Endpoints:
//   POST /api/backup                — Create backup bundle (download)
//   POST /api/backup/restore        — Restore from backup bundle
//   POST /api/backup/restore/preview — Dry-run restore preview
//   GET  /api/backup/list           — List auto-backup files
//   POST /api/backup/auto           — Trigger auto-backup
// ============================================================

import { Router } from 'express';

/**
 * Create backup API routes.
 * @param {object} ctx
 * @param {object} ctx.backupManager - BackupManager instance from createBackupManager()
 * @param {object} [ctx.coordinator] - Coordinator (optional, to check running state)
 * @returns {Router}
 */
export function createBackupRoutes(ctx) {
  const { backupManager, coordinator } = ctx;
  const router = Router();

  // Guard: backup manager not available
  function requireBackup(_req, res, next) {
    if (!backupManager) {
      return res.status(503).json({ error: 'Backup manager not available' });
    }
    next();
  }

  router.use('/backup', requireBackup);

  // Create backup bundle (download)
  router.post('/backup', (req, res) => {
    try {
      const { excludeSecrets, excludeAudit } = req.body || {};
      const bundle = backupManager.createBackup({ excludeSecrets, excludeAudit });
      const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      res.set('Content-Disposition', `attachment; filename="operator-backup-${date}.json"`);
      res.json(bundle);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Restore from backup bundle
  router.post('/backup/restore', (req, res) => {
    try {
      // Reject if coordinator is running
      if (coordinator && coordinator.getState() === 'running') {
        return res.status(409).json({
          error: 'Cannot restore while coordinator is running. Stop the coordinator first.',
        });
      }

      const bundle = req.body;
      const result = backupManager.restoreBackup(bundle);

      if (result.errors.length > 0 && result.restored.length === 0) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Dry-run restore preview
  router.post('/backup/restore/preview', (req, res) => {
    try {
      const bundle = req.body;
      const result = backupManager.restoreBackup(bundle, { dryRun: true });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // List auto-backup files
  router.get('/backup/list', (_req, res) => {
    try {
      const backups = backupManager.listBackups();
      res.json(backups);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trigger auto-backup
  router.post('/backup/auto', (_req, res) => {
    try {
      const result = backupManager.autoBackup();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
