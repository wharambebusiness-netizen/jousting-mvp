// ============================================================
// Notifications — In-App Notification System (Phase 41)
// ============================================================
// Subscribes to EventBus events and provides a notification feed
// with read/unread tracking, ring buffer eviction, and persistence.
//
// Factory: createNotifications(ctx) returns notifications API.
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// ── Constants ───────────────────────────────────────────────

export const DEFAULT_MAX_ENTRIES = 200;

// ── Factory ─────────────────────────────────────────────────

/**
 * Create an in-app notification system backed by a JSON file.
 *
 * @param {object} ctx
 * @param {object}   [ctx.events]     - EventBus to auto-subscribe
 * @param {string}   [ctx.persistPath] - Path to notifications.json
 * @param {object}   [ctx.log]        - Logger (optional, noop fallback)
 * @param {number}   [ctx.maxEntries] - Ring buffer size (default 200)
 * @returns {object} Notifications API
 */
export function createNotifications(ctx = {}) {
  const events = ctx.events || null;
  const persistPath = ctx.persistPath || null;
  const log = ctx.log || (() => {});
  const maxEntries = ctx.maxEntries || DEFAULT_MAX_ENTRIES;

  // Ensure directory exists
  if (persistPath) {
    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // In-memory store
  let notifications = [];

  // Listener tracking for cleanup
  const listeners = [];

  // ── Persistence ─────────────────────────────────────────

  function save() {
    if (!persistPath) return;
    try {
      const tmp = persistPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(notifications, null, 2), 'utf8');
      renameSync(tmp, persistPath);
    } catch (err) {
      if (typeof log === 'function') log('notifications save error', err);
      else if (log && log.error) log.error('notifications save error', { error: err.message });
    }
  }

  function load() {
    if (!persistPath || !existsSync(persistPath)) return;
    try {
      const raw = readFileSync(persistPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        notifications = data;
      }
    } catch (err) {
      if (typeof log === 'function') log('notifications load error', err);
      else if (log && log.error) log.error('notifications load error', { error: err.message });
    }
  }

  // Auto-load on creation
  load();

  // ── Core helpers ────────────────────────────────────────

  function generateId() {
    return randomBytes(4).toString('hex');
  }

  function addNotification({ type, severity, title, message, metadata }) {
    const entry = {
      id: generateId(),
      type: type || 'system',
      severity: severity || 'info',
      title: title || '',
      message: message || '',
      read: false,
      ts: new Date().toISOString(),
      metadata: metadata || {},
    };

    notifications.push(entry);

    // Ring buffer eviction
    while (notifications.length > maxEntries) {
      notifications.shift();
    }

    // Emit event
    if (events) {
      events.emit('notification:new', entry);
    }

    // Persist
    save();

    return entry;
  }

  // ── Public API ──────────────────────────────────────────

  function getAll({ unreadOnly, type, limit, offset } = {}) {
    let items = [...notifications];

    // Filter
    if (unreadOnly) {
      items = items.filter(n => !n.read);
    }
    if (type) {
      items = items.filter(n => n.type === type);
    }

    // Reverse chronological
    items.reverse();

    const total = items.length;
    const unreadCount = notifications.filter(n => !n.read).length;

    // Paginate
    const off = offset || 0;
    const lim = limit || 50;
    items = items.slice(off, off + lim);

    return { items, total, unreadCount };
  }

  function markRead(id) {
    const notif = notifications.find(n => n.id === id);
    if (!notif) return false;
    notif.read = true;
    save();
    return true;
  }

  function markAllRead() {
    let changed = 0;
    for (const n of notifications) {
      if (!n.read) {
        n.read = true;
        changed++;
      }
    }
    if (changed > 0) save();
    return changed;
  }

  function dismiss(id) {
    const idx = notifications.findIndex(n => n.id === id);
    if (idx === -1) return false;
    notifications.splice(idx, 1);
    save();
    return true;
  }

  function clear() {
    notifications.length = 0;
    save();
  }

  function getUnreadCount() {
    return notifications.filter(n => !n.read).length;
  }

  function destroy() {
    for (const { event, handler } of listeners) {
      if (events) events.off(event, handler);
    }
    listeners.length = 0;
  }

  // ── Auto-subscriptions ────────────────────────────────

  const subscriptions = [
    {
      event: 'claude-terminal:task-completed',
      handler: (data) => addNotification({
        type: 'task_complete',
        severity: 'success',
        title: 'Task completed',
        message: `Task ${data?.taskId || 'unknown'} completed by terminal ${data?.terminalId || 'unknown'}`,
        metadata: { taskId: data?.taskId, terminalId: data?.terminalId },
      }),
    },
    {
      event: 'coord:task-failed',
      handler: (data) => addNotification({
        type: 'task_failed',
        severity: 'error',
        title: 'Task failed',
        message: `Task ${data?.taskId || data?.id || 'unknown'} failed`,
        metadata: { taskId: data?.taskId || data?.id },
      }),
    },
    {
      event: 'coord:budget-warning',
      handler: (data) => addNotification({
        type: 'budget_warning',
        severity: 'warning',
        title: 'Budget warning',
        message: `Budget usage at ${data?.percent ? Math.round(data.percent * 100) + '%' : 'high level'}`,
        metadata: { ...data },
      }),
    },
    {
      event: 'dlq:added',
      handler: (data) => addNotification({
        type: 'dlq_added',
        severity: 'error',
        title: 'Dead letter added',
        message: `Task ${data?.taskId || data?.id || 'unknown'} moved to dead letter queue`,
        metadata: { taskId: data?.taskId || data?.id },
      }),
    },
    {
      event: 'claude-terminal:swarm-started',
      handler: (data) => addNotification({
        type: 'swarm_event',
        severity: 'info',
        title: 'Swarm started',
        message: 'Swarm mode has been activated',
        metadata: { ...data },
      }),
    },
    {
      event: 'claude-terminal:swarm-stopped',
      handler: (data) => addNotification({
        type: 'swarm_event',
        severity: 'info',
        title: 'Swarm stopped',
        message: 'Swarm mode has been deactivated',
        metadata: { ...data },
      }),
    },
    {
      event: 'claude-terminal:exit',
      handler: (data) => {
        // Only notify for non-zero exit codes
        if (data && typeof data.exitCode === 'number' && data.exitCode !== 0) {
          addNotification({
            type: 'terminal_exit',
            severity: 'warning',
            title: 'Terminal exited',
            message: `Terminal ${data.terminalId || data.id || 'unknown'} exited with code ${data.exitCode}`,
            metadata: { terminalId: data.terminalId || data.id, exitCode: data.exitCode },
          });
        }
      },
    },
  ];

  if (events) {
    for (const sub of subscriptions) {
      events.on(sub.event, sub.handler);
      listeners.push({ event: sub.event, handler: sub.handler });
    }
  }

  return {
    getAll,
    markRead,
    markAllRead,
    dismiss,
    clear,
    getUnreadCount,
    destroy,
    add: addNotification,
    load,
  };
}
