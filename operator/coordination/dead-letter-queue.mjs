// ============================================================
// Dead Letter Queue — Permanently-Failed Task Storage (Phase 32)
// ============================================================
// Stores tasks that have exhausted all retries. Supports manual
// retry, dismissal, and permanent removal. Integrates with
// coordinator for re-queuing retried tasks.
//
// Persistence uses the same atomic-write pattern as persistent-queue.mjs.
//
// Factory: createDeadLetterQueue(ctx) returns DLQ methods.
// ============================================================

import {
  writeFileSync, readFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a dead letter queue for permanently-failed tasks.
 * @param {object} ctx
 * @param {object} [ctx.events] - EventBus for emitting DLQ events
 * @param {string} [ctx.persistPath] - Path to persist DLQ on disk
 * @param {Function} [ctx.log] - Logger
 * @param {number} [ctx.maxEntries=500] - Maximum stored entries
 * @returns {object} DLQ methods
 */
export function createDeadLetterQueue(ctx = {}) {
  const events = ctx.events || null;
  const persistPath = ctx.persistPath || null;
  const log = ctx.log || (() => {});
  const maxEntries = ctx.maxEntries || 500;

  /** @type {Map<string, object>} id -> entry */
  const entries = new Map();

  // ── ID generation ─────────────────────────────────────────

  function generateId() {
    return randomBytes(4).toString('hex');
  }

  // ── Atomic Write ──────────────────────────────────────────

  function _save() {
    if (!persistPath) return;
    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const data = {
      entries: [...entries.values()],
      savedAt: new Date().toISOString(),
      version: 1,
    };

    const tmpFile = persistPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      renameSync(tmpFile, persistPath);
    } catch (_err) {
      // Fallback: direct write if rename fails
      writeFileSync(persistPath, JSON.stringify(data, null, 2));
      try { unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }
  }

  // ── Load ──────────────────────────────────────────────────

  function load() {
    if (!persistPath) return { loaded: false, count: 0 };

    let data = null;

    // Try primary file
    if (existsSync(persistPath)) {
      try {
        const raw = readFileSync(persistPath, 'utf-8');
        data = JSON.parse(raw);
        try { unlinkSync(persistPath + '.tmp'); } catch (_) { /* ignore */ }
      } catch (_err) {
        log(`[dlq] Failed to read primary file: ${_err.message}`);
        data = null;
      }
    }

    // Fallback: .tmp recovery
    if (!data) {
      const tmpFile = persistPath + '.tmp';
      if (existsSync(tmpFile)) {
        try {
          const raw = readFileSync(tmpFile, 'utf-8');
          data = JSON.parse(raw);
          try { renameSync(tmpFile, persistPath); } catch (_) { /* ignore */ }
          log('[dlq] Recovered from .tmp file');
        } catch (_err) {
          log(`[dlq] Failed to recover from .tmp: ${_err.message}`);
          data = null;
        }
      }
    }

    if (!data || !Array.isArray(data.entries)) {
      return { loaded: false, count: 0 };
    }

    entries.clear();
    for (const entry of data.entries) {
      entries.set(entry.id, entry);
    }

    log(`[dlq] Loaded ${entries.size} entries`);
    return { loaded: true, count: entries.size };
  }

  // ── Eviction ──────────────────────────────────────────────

  function _evictIfNeeded() {
    if (entries.size <= maxEntries) return;

    // Evict oldest dismissed entries first
    const dismissed = [...entries.values()]
      .filter(e => e.status === 'dismissed')
      .sort((a, b) => new Date(a.failedAt) - new Date(b.failedAt));

    for (const entry of dismissed) {
      if (entries.size <= maxEntries) break;
      entries.delete(entry.id);
    }

    // If still over limit, evict oldest pending
    if (entries.size > maxEntries) {
      const pending = [...entries.values()]
        .filter(e => e.status === 'pending')
        .sort((a, b) => new Date(a.failedAt) - new Date(b.failedAt));

      for (const entry of pending) {
        if (entries.size <= maxEntries) break;
        entries.delete(entry.id);
      }
    }
  }

  // ── Core Methods ──────────────────────────────────────────

  /**
   * Add a permanently-failed task to the DLQ.
   * @param {object} params
   * @param {string} params.taskId - Original task ID
   * @param {object} params.task - Task definition (description, deps, etc.)
   * @param {string} [params.category] - Task category
   * @param {string} [params.error] - Error message
   * @param {string} [params.workerId] - Last worker that failed it
   * @param {string} [params.failedAt] - ISO timestamp of failure
   * @param {number} [params.retryCount] - Number of retries attempted
   * @param {object} [params.metadata] - Arbitrary metadata
   * @returns {object} Created entry
   */
  function add({ taskId, task, category, error, workerId, failedAt, retryCount, metadata }) {
    const id = generateId();
    const entry = {
      id,
      taskId: taskId ?? null,
      task: task ?? null,
      category: category ?? null,
      error: error ?? null,
      workerId: workerId ?? null,
      failedAt: failedAt || new Date().toISOString(),
      retryCount: retryCount ?? 0,
      metadata: metadata || {},
      status: 'pending',
      dismissReason: null,
      addedAt: new Date().toISOString(),
    };

    entries.set(id, entry);
    _evictIfNeeded();
    _save();

    if (events) events.emit('dlq:added', { ...entry });
    log(`[dlq] Added entry ${id} for task ${taskId}`);

    return { ...entry };
  }

  /**
   * Get a single entry by DLQ id.
   * @param {string} id
   * @returns {object|null}
   */
  function get(id) {
    const entry = entries.get(id);
    return entry ? { ...entry } : null;
  }

  /**
   * List entries with optional filtering and pagination.
   * @param {object} [opts]
   * @param {string} [opts.status] - Filter by status
   * @param {string} [opts.category] - Filter by category
   * @param {number} [opts.limit=50] - Max entries to return
   * @param {number} [opts.offset=0] - Skip first N entries
   * @returns {{ entries: object[], total: number }}
   */
  function getAll(opts = {}) {
    let list = [...entries.values()];

    if (opts.status) {
      list = list.filter(e => e.status === opts.status);
    }
    if (opts.category) {
      list = list.filter(e => e.category === opts.category);
    }

    const total = list.length;
    const offset = opts.offset || 0;
    const limit = opts.limit || 50;

    // Sort newest first
    list.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    list = list.slice(offset, offset + limit);

    return { entries: list.map(e => ({ ...e })), total };
  }

  /**
   * Mark an entry for retry. Returns the task definition for re-queuing.
   * @param {string} id - DLQ entry id
   * @param {object} [opts]
   * @param {string} [opts.reassignTo] - Terminal ID to assign to
   * @param {number} [opts.priority] - Override priority
   * @returns {object|null} Task definition or null if not found
   */
  function retry(id, opts = {}) {
    const entry = entries.get(id);
    if (!entry) return null;

    entry.status = 'retrying';
    _save();

    if (events) events.emit('dlq:retried', { id, taskId: entry.taskId, ...opts });
    log(`[dlq] Retrying entry ${id} (task ${entry.taskId})`);

    return {
      taskId: entry.taskId,
      task: entry.task,
      category: entry.category,
      metadata: entry.metadata,
      reassignTo: opts.reassignTo || null,
      priority: opts.priority != null ? opts.priority : null,
    };
  }

  /**
   * Dismiss an entry (acknowledged, no further action).
   * @param {string} id - DLQ entry id
   * @param {string} [reason] - Dismissal reason
   * @returns {boolean}
   */
  function dismiss(id, reason) {
    const entry = entries.get(id);
    if (!entry) return false;

    entry.status = 'dismissed';
    entry.dismissReason = reason || null;
    _save();

    if (events) events.emit('dlq:dismissed', { id, taskId: entry.taskId, reason: entry.dismissReason });
    log(`[dlq] Dismissed entry ${id}${reason ? ': ' + reason : ''}`);

    return true;
  }

  /**
   * Permanently remove an entry.
   * @param {string} id
   * @returns {boolean}
   */
  function remove(id) {
    const existed = entries.delete(id);
    if (existed) _save();
    return existed;
  }

  /**
   * Get statistics about the DLQ.
   * @returns {object}
   */
  function getStats() {
    const byStatus = { pending: 0, retrying: 0, dismissed: 0 };
    const byCategory = {};

    for (const entry of entries.values()) {
      byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
      const cat = entry.category || 'uncategorized';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    return {
      total: entries.size,
      byStatus,
      byCategory,
    };
  }

  // Load from disk on creation if persistPath is set
  if (persistPath) {
    load();
  }

  return {
    add,
    get,
    getAll,
    retry,
    dismiss,
    remove,
    getStats,
    load,
  };
}
