// ============================================================
// Terminal Message Bus — Inter-Terminal Communication (Phase 18)
// ============================================================
// Ordered message bus for cross-terminal communication.
// Supports broadcast, targeted, and threaded messages with
// unread tracking, ring buffer eviction, and disk persistence.
//
// Separate from shared-memory because messages have different
// semantics: ordered, threaded, inbox/outbox, unread tracking,
// ring buffer eviction — vs key-value CRUD.
//
// Factory: createTerminalMessageBus(ctx) returns message bus API.
// ============================================================

import {
  writeFileSync, readFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── Constants ───────────────────────────────────────────────

export const MAX_MESSAGE_CONTENT_SIZE = 65_536; // 64KB
export const MAX_MESSAGES = 5_000;              // global ring buffer
export const MAX_THREAD_DEPTH = 50;

// ── Validation ──────────────────────────────────────────────

const TERMINAL_ID_RE = /^[\w-]{1,64}$/;

function validateTerminalId(id, field = 'from') {
  if (typeof id !== 'string' || !TERMINAL_ID_RE.test(id)) {
    throw new Error(`${field} must be alphanumeric/underscore/hyphen, 1-64 chars`);
  }
}

function validateContent(content) {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('content must be a non-empty string');
  }
  if (content.length > MAX_MESSAGE_CONTENT_SIZE) {
    throw new Error(`content exceeds max size (${MAX_MESSAGE_CONTENT_SIZE})`);
  }
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a terminal message bus for inter-terminal communication.
 *
 * @param {object} ctx
 * @param {object}   [ctx.events]       - EventBus for change notifications
 * @param {string}   [ctx.persistPath]  - Path to persistence file (null = in-memory only)
 * @param {number}   [ctx.maxMessages]  - Max messages before eviction (default MAX_MESSAGES)
 * @param {Function} [ctx.log]          - Logger function
 * @returns {object} Message bus API
 */
export function createTerminalMessageBus(ctx = {}) {
  const events = ctx.events || null;
  const persistPath = ctx.persistPath || null;
  const maxMessages = ctx.maxMessages || MAX_MESSAGES;
  const log = ctx.log || (() => {});

  // ── Internal State ──────────────────────────────────────

  /** @type {Map<string, object>} messageId → message */
  const messages = new Map();

  /** @type {Map<string, number>} terminalId → unread count */
  const unreadCounts = new Map();

  // ── Core API ────────────────────────────────────────────

  /**
   * Send a message.
   * @param {object} opts
   * @param {string}  opts.from     - Sender terminal ID
   * @param {string}  [opts.to]     - Recipient terminal ID (null = broadcast)
   * @param {string}  opts.content  - Message content
   * @param {string}  [opts.category='general'] - Message category
   * @param {string}  [opts.replyTo] - ID of message being replied to
   * @returns {object} The created message
   */
  function send({ from, to, content, category, replyTo } = {}) {
    // Validate
    validateTerminalId(from, 'from');
    if (to !== undefined && to !== null) {
      validateTerminalId(to, 'to');
    }
    validateContent(content);

    // Validate replyTo
    if (replyTo) {
      const parent = messages.get(replyTo);
      if (!parent) {
        throw new Error(`replyTo message not found: ${replyTo}`);
      }
      if (parent.deleted) {
        throw new Error(`Cannot reply to deleted message: ${replyTo}`);
      }
      // Check thread depth
      let depth = 0;
      let cur = parent;
      while (cur.replyTo) {
        depth++;
        if (depth >= MAX_THREAD_DEPTH) {
          throw new Error(`Thread depth exceeds maximum (${MAX_THREAD_DEPTH})`);
        }
        cur = messages.get(cur.replyTo);
        if (!cur) break;
      }
    }

    // Create message
    const msg = {
      id: randomUUID(),
      from,
      to: to || null,
      content,
      category: category || 'general',
      replyTo: replyTo || null,
      timestamp: new Date().toISOString(),
      deleted: false,
    };

    // Ring buffer eviction
    while (messages.size >= maxMessages) {
      const oldestId = messages.keys().next().value;
      const evicted = messages.get(oldestId);
      messages.delete(oldestId);
      // Decrement unread count when evicting an unread targeted message so slow
      // readers don't accumulate a permanently inflated unread count.
      if (evicted && evicted.to !== null && !evicted.deleted) {
        const cur = unreadCounts.get(evicted.to) || 0;
        if (cur > 0) {
          unreadCounts.set(evicted.to, cur - 1);
        }
      }
    }

    messages.set(msg.id, msg);

    // Unread tracking
    if (msg.to) {
      // Targeted: increment recipient
      unreadCounts.set(msg.to, (unreadCounts.get(msg.to) || 0) + 1);
    } else {
      // Broadcast: increment all known terminals except sender
      for (const tid of unreadCounts.keys()) {
        if (tid !== msg.from) {
          unreadCounts.set(tid, (unreadCounts.get(tid) || 0) + 1);
        }
      }
    }
    // Ensure sender is tracked
    if (!unreadCounts.has(msg.from)) {
      unreadCounts.set(msg.from, 0);
    }

    // Emit events
    if (events) {
      const payload = {
        messageId: msg.id,
        from: msg.from,
        to: msg.to,
        content: msg.content,
        category: msg.category,
        replyTo: msg.replyTo,
        timestamp: msg.timestamp,
      };
      events.emit('terminal-message:sent', payload);
      if (!msg.to) {
        events.emit('terminal-message:broadcast', {
          messageId: msg.id,
          from: msg.from,
          content: msg.content,
          category: msg.category,
          timestamp: msg.timestamp,
        });
      }
    }

    // Auto-persist
    if (persistPath) save();

    return { ...msg };
  }

  /**
   * Get a single message by ID.
   * @param {string} messageId
   * @returns {object|null}
   */
  function get(messageId) {
    const msg = messages.get(messageId);
    if (!msg || msg.deleted) return null;
    return { ...msg };
  }

  /**
   * Get all messages, newest first.
   * @param {object} [opts]
   * @param {string} [opts.terminalId] - Filter to/from/broadcast
   * @param {number} [opts.limit]      - Max results
   * @param {number} [opts.offset]     - Skip N results
   * @param {string} [opts.category]   - Filter by category
   * @returns {object[]}
   */
  function getAll({ terminalId, limit, offset, category } = {}) {
    let result = [];

    for (const msg of messages.values()) {
      if (msg.deleted) continue;
      if (category && msg.category !== category) continue;
      if (terminalId) {
        // Include if message is to/from terminal, or broadcast
        if (msg.from !== terminalId && msg.to !== terminalId && msg.to !== null) {
          continue;
        }
      }
      result.push({ ...msg });
    }

    // Newest first
    result.reverse();

    // Offset
    if (offset && offset > 0) {
      result = result.slice(offset);
    }

    // Limit
    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }

    return result;
  }

  /**
   * Get a thread starting from a message.
   * Walks replyTo chain to root, then collects all replies chronologically.
   * @param {string} messageId
   * @returns {object[]|null} Thread messages in chronological order, or null if not found
   */
  function getThread(messageId) {
    const startMsg = messages.get(messageId);
    if (!startMsg) return null;

    // Walk to root
    let rootId = messageId;
    let cur = startMsg;
    while (cur.replyTo) {
      const parent = messages.get(cur.replyTo);
      if (!parent) break;
      rootId = cur.replyTo;
      cur = parent;
    }

    // Collect all messages in this thread
    const threadMessages = [];
    for (const msg of messages.values()) {
      if (msg.deleted) continue;
      if (msg.id === rootId || isInThread(msg.id, rootId)) {
        threadMessages.push({ ...msg });
      }
    }

    // Chronological order
    threadMessages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return threadMessages;
  }

  /**
   * Check if a message is a descendant of a root message.
   */
  function isInThread(msgId, rootId) {
    let cur = messages.get(msgId);
    const visited = new Set();
    while (cur && cur.replyTo) {
      if (visited.has(cur.id)) break;
      visited.add(cur.id);
      if (cur.replyTo === rootId) return true;
      cur = messages.get(cur.replyTo);
    }
    return false;
  }

  /**
   * Get inbox for a terminal (messages TO terminal + broadcasts).
   * @param {string} terminalId
   * @param {object} [opts]
   * @param {number} [opts.limit]
   * @param {string} [opts.category]
   * @returns {object[]}
   */
  function getInbox(terminalId, { limit, category } = {}) {
    const result = [];
    for (const msg of messages.values()) {
      if (msg.deleted) continue;
      if (category && msg.category !== category) continue;
      // Inbox: messages TO this terminal, or broadcasts (not from self)
      if (msg.to === terminalId || (msg.to === null && msg.from !== terminalId)) {
        result.push({ ...msg });
      }
    }
    result.reverse(); // newest first
    if (limit && limit > 0) return result.slice(0, limit);
    return result;
  }

  /**
   * Get outbox for a terminal (messages FROM terminal).
   * @param {string} terminalId
   * @param {object} [opts]
   * @param {number} [opts.limit]
   * @param {string} [opts.category]
   * @returns {object[]}
   */
  function getOutbox(terminalId, { limit, category } = {}) {
    const result = [];
    for (const msg of messages.values()) {
      if (msg.deleted) continue;
      if (category && msg.category !== category) continue;
      if (msg.from === terminalId) {
        result.push({ ...msg });
      }
    }
    result.reverse(); // newest first
    if (limit && limit > 0) return result.slice(0, limit);
    return result;
  }

  /**
   * Soft-delete a message.
   * @param {string} messageId
   * @returns {boolean}
   */
  function del(messageId) {
    const msg = messages.get(messageId);
    if (!msg || msg.deleted) return false;
    msg.deleted = true;

    if (events) {
      events.emit('terminal-message:deleted', { messageId });
    }

    if (persistPath) save();
    return true;
  }

  /**
   * Clear all messages and reset unread counts.
   * @returns {{ count: number }}
   */
  function clear() {
    let count = 0;
    for (const msg of messages.values()) {
      if (!msg.deleted) count++;
    }
    messages.clear();
    unreadCounts.clear();

    if (events) {
      events.emit('terminal-message:cleared', { count });
    }

    if (persistPath) save();
    return { count };
  }

  /**
   * Mark messages as read for a terminal.
   * @param {string} terminalId
   * @param {string} [messageId] - Specific message to mark (decrements by 1). Omit to reset to 0.
   * @returns {number} New unread count
   */
  function markRead(terminalId, messageId) {
    if (!messageId) {
      unreadCounts.set(terminalId, 0);
      return 0;
    }
    const current = unreadCounts.get(terminalId) || 0;
    const newCount = Math.max(0, current - 1);
    unreadCounts.set(terminalId, newCount);
    return newCount;
  }

  /**
   * Get unread count for a terminal.
   * @param {string} terminalId
   * @returns {number}
   */
  function getUnreadCount(terminalId) {
    return unreadCounts.get(terminalId) || 0;
  }

  /**
   * Count non-deleted messages.
   * @returns {number}
   */
  function count() {
    let n = 0;
    for (const msg of messages.values()) {
      if (!msg.deleted) n++;
    }
    return n;
  }

  // ── Persistence ───────────────────────────────────────────

  function save() {
    if (!persistPath) return;

    const data = toJSON();
    data.savedAt = new Date().toISOString();
    data.version = 1;

    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = persistPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      renameSync(tmpFile, persistPath);
    } catch (_err) {
      writeFileSync(persistPath, JSON.stringify(data, null, 2));
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  function load() {
    if (!persistPath) return { loaded: false, messages: 0 };

    let data = null;
    let recovered = false;

    if (existsSync(persistPath)) {
      try {
        const raw = readFileSync(persistPath, 'utf-8');
        data = JSON.parse(raw);
        try { unlinkSync(persistPath + '.tmp'); } catch { /* ignore */ }
      } catch (_err) {
        log(`[terminal-messages] Failed to read primary file: ${_err.message}`);
        data = null;
      }
    }

    if (!data) {
      const tmpFile = persistPath + '.tmp';
      if (existsSync(tmpFile)) {
        try {
          const raw = readFileSync(tmpFile, 'utf-8');
          data = JSON.parse(raw);
          try { renameSync(tmpFile, persistPath); } catch { /* ignore */ }
          recovered = true;
          log('[terminal-messages] Recovered from .tmp file');
        } catch (_err) {
          log(`[terminal-messages] Failed to recover from .tmp: ${_err.message}`);
          data = null;
        }
      }
    }

    if (!data) {
      return { loaded: false, messages: 0 };
    }

    fromJSON(data);

    const msgCount = count();
    log(`[terminal-messages] Loaded ${msgCount} messages`);

    return { loaded: true, recovered, messages: msgCount };
  }

  // ── Serialization ─────────────────────────────────────────

  function toJSON() {
    const msgArray = [];
    for (const msg of messages.values()) {
      if (!msg.deleted) msgArray.push({ ...msg });
    }
    const unread = {};
    for (const [tid, cnt] of unreadCounts) {
      unread[tid] = cnt;
    }
    return { messages: msgArray, unread };
  }

  function fromJSON(data) {
    messages.clear();
    unreadCounts.clear();

    if (data.messages && Array.isArray(data.messages)) {
      for (const msg of data.messages) {
        messages.set(msg.id, { ...msg });
      }
    }

    if (data.unread && typeof data.unread === 'object') {
      for (const [tid, cnt] of Object.entries(data.unread)) {
        unreadCounts.set(tid, cnt);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────

  return {
    send,
    get,
    getAll,
    getThread,
    getInbox,
    getOutbox,
    delete: del,
    clear,
    markRead,
    getUnreadCount,
    count,
    save,
    load,
    toJSON,
    fromJSON,
    get isPersistent() { return !!persistPath; },
    get persistPath() { return persistPath; },
  };
}
