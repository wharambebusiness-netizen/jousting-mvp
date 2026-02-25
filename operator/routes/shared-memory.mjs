// ============================================================
// Shared Memory Routes (Phase 17)
// ============================================================
// REST API for the cross-terminal shared memory store.
//
// Endpoints:
//   GET    /api/shared-memory              — List all keys (optional ?prefix=)
//   GET    /api/shared-memory/:key         — Get value by key
//   PUT    /api/shared-memory/:key         — Set value { value, source? }
//   DELETE /api/shared-memory/:key         — Delete key
//   GET    /api/shared-memory-snapshots    — List all terminal snapshots
//   GET    /api/shared-memory-snapshots/:id — Get snapshot for terminal
//   PUT    /api/shared-memory-snapshots/:id — Write snapshot for terminal
//   DELETE /api/shared-memory-snapshots/:id — Delete snapshot for terminal
// ============================================================

import { Router } from 'express';

export function createSharedMemoryRoutes(ctx) {
  const { sharedMemory } = ctx;
  const router = Router();

  // Guard: shared memory not available
  function requireMemory(_req, res, next) {
    if (!sharedMemory) {
      return res.status(503).json({ error: 'Shared memory not available' });
    }
    next();
  }

  router.use('/shared-memory', requireMemory);
  router.use('/shared-memory-snapshots', requireMemory);

  // ── Key-Value CRUD ──────────────────────────────────────

  // List all keys (with optional prefix filter)
  router.get('/shared-memory', (req, res) => {
    try {
      const prefix = req.query.prefix || undefined;
      const allEntries = sharedMemory.entries(prefix);
      res.json({
        count: Object.keys(allEntries).length,
        entries: allEntries,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single key (key passed as query param ?key= to support colons/slashes)
  router.get('/shared-memory/key', (req, res) => {
    try {
      const key = req.query.key;
      if (!key) {
        return res.status(400).json({ error: 'Query param "key" is required' });
      }
      const entry = sharedMemory.getEntry(key);
      if (!entry) {
        return res.status(404).json({ error: `Key not found: ${key}` });
      }
      res.json(entry);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Set value (key in body or query param)
  router.put('/shared-memory/key', (req, res) => {
    try {
      const key = req.query.key || req.body.key;
      const { value, source } = req.body;

      if (!key) {
        return res.status(400).json({ error: 'Key is required (query param or body)' });
      }
      if (value === undefined) {
        return res.status(400).json({ error: 'Request body must include "value"' });
      }

      sharedMemory.set(key, value, source || 'api');
      const entry = sharedMemory.getEntry(key);
      res.json(entry);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete key
  router.delete('/shared-memory/key', (req, res) => {
    try {
      const key = req.query.key;
      if (!key) {
        return res.status(400).json({ error: 'Query param "key" is required' });
      }
      const deleted = sharedMemory.delete(key);
      if (!deleted) {
        return res.status(404).json({ error: `Key not found: ${key}` });
      }
      res.json({ deleted: true, key });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Terminal Snapshots ────────────────────────────────────

  // List all snapshots
  router.get('/shared-memory-snapshots', (_req, res) => {
    try {
      const snapshots = sharedMemory.getSnapshots();
      res.json({
        count: Object.keys(snapshots).length,
        snapshots,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get snapshot for terminal
  router.get('/shared-memory-snapshots/:id', (req, res) => {
    try {
      const snapshot = sharedMemory.readSnapshot(req.params.id);
      if (!snapshot) {
        return res.status(404).json({ error: `No snapshot for terminal: ${req.params.id}` });
      }
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Write snapshot for terminal
  router.put('/shared-memory-snapshots/:id', (req, res) => {
    try {
      sharedMemory.writeSnapshot(req.params.id, req.body || {});
      const snapshot = sharedMemory.readSnapshot(req.params.id);
      res.json(snapshot);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete snapshot for terminal
  router.delete('/shared-memory-snapshots/:id', (req, res) => {
    try {
      const deleted = sharedMemory.deleteSnapshot(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: `No snapshot for terminal: ${req.params.id}` });
      }
      res.json({ deleted: true, terminalId: req.params.id });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
