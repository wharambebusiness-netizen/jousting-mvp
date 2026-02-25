// ============================================================
// Export Routes (Phase 36)
// ============================================================
// REST API for exporting data in CSV, JSON, and JSONL formats.
//
// Endpoints:
//   GET /api/export/tasks       — Export coordination tasks
//   GET /api/export/audit       — Export audit log entries
//   GET /api/export/messages    — Export terminal messages
//   GET /api/export/dead-letters — Export dead letter queue
// ============================================================

import { Router } from 'express';
import { toCSV, toJSON, toJSONLines, setExportHeaders, fileTimestamp } from '../export.mjs';

const VALID_FORMATS = ['csv', 'json', 'jsonl'];

/**
 * Create data export routes.
 * @param {object} ctx
 * @param {object} [ctx.coordinator]     - Coordinator instance (for tasks)
 * @param {object} [ctx.auditLog]        - Audit log instance
 * @param {object} [ctx.messageBus]      - Terminal message bus instance
 * @param {object} [ctx.deadLetterQueue] - Dead letter queue instance
 * @returns {Router}
 */
export function createExportRoutes(ctx) {
  const { coordinator, auditLog, messageBus, deadLetterQueue } = ctx;
  const router = Router();

  /**
   * Convert rows to the requested format string.
   */
  function formatData(rows, format) {
    if (format === 'csv') return toCSV(rows);
    if (format === 'jsonl') return toJSONLines(rows);
    return toJSON(rows);
  }

  /**
   * Parse and validate format query param.
   */
  function getFormat(req) {
    const f = (req.query.format || 'json').toLowerCase();
    return VALID_FORMATS.includes(f) ? f : 'json';
  }

  // ── Tasks Export ────────────────────────────────────────────

  router.get('/export/tasks', (req, res) => {
    if (!coordinator || !coordinator.taskQueue) {
      return res.status(503).json({ error: 'Coordinator not available' });
    }

    try {
      const format = getFormat(req);
      const { status, category } = req.query;

      let rows = coordinator.taskQueue.getAll();

      if (status) rows = rows.filter(t => t.status === status);
      if (category) rows = rows.filter(t => t.category === category);

      const body = formatData(rows, format);
      setExportHeaders(res, `tasks-${fileTimestamp()}`, format);
      res.send(body);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Audit Export ────────────────────────────────────────────

  router.get('/export/audit', (req, res) => {
    if (!auditLog) {
      return res.status(503).json({ error: 'Audit log not available' });
    }

    try {
      const format = getFormat(req);
      const { action, since, until } = req.query;

      // Use a large limit to get all entries for export
      const result = auditLog.query({
        action: action || undefined,
        since: since || undefined,
        until: until || undefined,
        limit: 100_000,
        offset: 0,
      });

      const body = formatData(result.entries, format);
      setExportHeaders(res, `audit-${fileTimestamp()}`, format);
      res.send(body);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Messages Export ─────────────────────────────────────────

  router.get('/export/messages', (req, res) => {
    if (!messageBus) {
      return res.status(503).json({ error: 'Message bus not available' });
    }

    try {
      const format = getFormat(req);
      const { terminalId } = req.query;

      const rows = messageBus.getAll({
        terminalId: terminalId || undefined,
      });

      const body = formatData(rows, format);
      setExportHeaders(res, `messages-${fileTimestamp()}`, format);
      res.send(body);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Dead Letters Export ─────────────────────────────────────

  router.get('/export/dead-letters', (req, res) => {
    if (!deadLetterQueue) {
      return res.status(503).json({ error: 'Dead letter queue not available' });
    }

    try {
      const format = getFormat(req);
      const { status } = req.query;

      const result = deadLetterQueue.getAll({
        status: status || undefined,
        limit: 100_000,
        offset: 0,
      });

      const body = formatData(result.entries, format);
      setExportHeaders(res, `dead-letters-${fileTimestamp()}`, format);
      res.send(body);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
