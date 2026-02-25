// ============================================================
// Audit Log — Append-Only Event Journal (Phase 31)
// ============================================================
// Auto-subscribes to EventBus events and records them as JSONL
// (one JSON object per line). Provides queryable REST-friendly
// API with filtering, pagination, stats, and log rotation.
//
// Factory: createAuditLog(ctx) returns audit log API.
// ============================================================

import {
  appendFileSync, readFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

// ── Constants ───────────────────────────────────────────────

export const DEFAULT_MAX_ENTRIES = 10_000;

// ── Factory ─────────────────────────────────────────────────

/**
 * Create an append-only audit log backed by a JSONL file.
 *
 * @param {object} ctx
 * @param {string}   ctx.persistPath  - Path to JSONL file
 * @param {object}   [ctx.events]     - EventBus to auto-subscribe
 * @param {object}   [ctx.log]        - Logger (optional, noop fallback)
 * @param {number}   [ctx.maxEntries] - Trigger rotation when exceeded (default 10000)
 * @returns {object} Audit log API
 */
export function createAuditLog(ctx = {}) {
  const persistPath = ctx.persistPath;
  const events = ctx.events || null;
  const log = ctx.log || (() => {});
  const maxEntries = ctx.maxEntries || DEFAULT_MAX_ENTRIES;

  // Ensure directory exists
  if (persistPath) {
    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // ── Listeners for cleanup ──────────────────────────────

  const listeners = [];

  // ── Core API ───────────────────────────────────────────

  /**
   * Append one audit entry to the JSONL file.
   */
  function record({ action, actor, target, detail, reqId } = {}) {
    const entry = {
      ts: new Date().toISOString(),
      action: action || null,
      actor: actor || null,
      target: target || null,
      detail: detail || null,
      reqId: reqId || null,
    };

    if (persistPath) {
      appendFileSync(persistPath, JSON.stringify(entry) + '\n', 'utf8');
    }

    if (events) {
      events.emit('audit:recorded', entry);
    }

    // Auto-rotate if over limit
    if (persistPath && count() > maxEntries) {
      rotate();
    }
  }

  /**
   * Read all entries from the JSONL file, skipping corrupt lines.
   * @returns {object[]} Parsed entries
   */
  function readAll() {
    if (!persistPath || !existsSync(persistPath)) return [];
    const raw = readFileSync(persistPath, 'utf8');
    return raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }

  /**
   * Query audit entries with filtering and pagination.
   */
  function query({ action, actor, target, since, until, limit, offset } = {}) {
    let entries = readAll();

    // Filter
    if (action) entries = entries.filter(e => e.action === action);
    if (actor) entries = entries.filter(e => e.actor === actor);
    if (target) entries = entries.filter(e => e.target === target);
    if (since) entries = entries.filter(e => e.ts >= since);
    if (until) entries = entries.filter(e => e.ts <= until);

    // Reverse chronological
    entries.reverse();

    const total = entries.length;

    // Paginate
    const off = offset || 0;
    const lim = limit || 50;
    entries = entries.slice(off, off + lim);

    return { entries, total };
  }

  /**
   * Return summary statistics.
   */
  function stats() {
    const entries = readAll();
    const byAction = {};
    for (const e of entries) {
      const a = e.action || 'unknown';
      byAction[a] = (byAction[a] || 0) + 1;
    }
    const dateRange = entries.length > 0
      ? { oldest: entries[0].ts, newest: entries[entries.length - 1].ts }
      : { oldest: null, newest: null };
    return { total: entries.length, byAction, dateRange };
  }

  /**
   * Rotate log: rename current to .1, start fresh.
   */
  function rotate() {
    if (!persistPath) return;
    const rotated = persistPath.replace(/\.jsonl$/, '.1.jsonl');
    // Delete existing rotation if present
    if (existsSync(rotated)) {
      unlinkSync(rotated);
    }
    if (existsSync(persistPath)) {
      renameSync(persistPath, rotated);
    }
  }

  /**
   * Count entries (line count in file).
   */
  function count() {
    if (!persistPath || !existsSync(persistPath)) return 0;
    const raw = readFileSync(persistPath, 'utf8');
    return raw.split('\n').filter(Boolean).length;
  }

  /**
   * Unwire all EventBus listeners.
   */
  function destroy() {
    for (const { event, handler } of listeners) {
      if (events) events.off(event, handler);
    }
    listeners.length = 0;
  }

  // ── Auto-subscriptions ────────────────────────────────

  const subscriptions = [
    { event: 'claude-terminal:spawned', action: 'terminal.spawn', targetFn: d => d?.terminalId || d?.id },
    { event: 'claude-terminal:exit', action: 'terminal.exit', targetFn: d => d?.terminalId || d?.id },
    { event: 'claude-terminal:task-completed', action: 'task.complete', targetFn: d => d?.taskId },
    { event: 'claude-terminal:swarm-started', action: 'swarm.start', targetFn: () => null },
    { event: 'claude-terminal:swarm-stopped', action: 'swarm.stop', targetFn: () => null },
    { event: 'coord:started', action: 'coordinator.start', targetFn: () => null },
    { event: 'coord:stopped', action: 'coordinator.stop', targetFn: () => null },
    { event: 'coord:task-failed', action: 'task.fail', targetFn: d => d?.taskId || d?.id },
    { event: 'shared-memory:updated', action: 'memory.write', targetFn: d => d?.key },
  ];

  if (events) {
    for (const sub of subscriptions) {
      const handler = (data) => {
        record({
          action: sub.action,
          target: sub.targetFn(data) || null,
          detail: data || null,
        });
      };
      events.on(sub.event, handler);
      listeners.push({ event: sub.event, handler });
    }
  }

  return { record, query, stats, rotate, destroy, count };
}
