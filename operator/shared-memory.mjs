// ============================================================
// Shared Memory — Cross-Terminal Persistent State Layer
// ============================================================
// Shared key-value store accessible by all Claude terminals,
// coordination workers, and the REST API. Provides:
//
// 1. Key-value store with namespaces (shared, terminal, project)
// 2. Watch/subscribe for change notifications
// 3. Atomic disk persistence (same pattern as persistent-queue)
// 4. Terminal snapshot support (context handoff between sessions)
// 5. EventBus integration for real-time UI updates
//
// Factory: createSharedMemory(ctx) returns memory API.
// ============================================================

import {
  writeFileSync, readFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// ── Constants ───────────────────────────────────────────────

const MAX_KEY_LENGTH = 256;
const MAX_VALUE_SIZE = 1_048_576; // 1MB per value
const MAX_KEYS = 10_000;
const MAX_SNAPSHOT_SIZE = 32_768; // 32KB per terminal snapshot
const SNAPSHOT_OUTPUT_CHARS = 4096; // Last N chars of terminal output to keep

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a shared memory store for cross-terminal state.
 *
 * @param {object} ctx
 * @param {object}   [ctx.events]      - EventBus for change notifications
 * @param {string}   [ctx.persistPath] - Path to persistence file (null = in-memory only)
 * @param {Function} [ctx.log]         - Logger function
 * @returns {object} Shared memory API
 */
export function createSharedMemory(ctx = {}) {
  const events = ctx.events || null;
  const persistPath = ctx.persistPath || null;
  const log = ctx.log || (() => {});

  // ── Internal State ──────────────────────────────────────

  /** @type {Map<string, { value: any, updatedAt: string, source: string }>} */
  const store = new Map();

  /** @type {Map<string, { snapshot: object, updatedAt: string }>} */
  const terminalSnapshots = new Map();

  /** @type {Map<string, Set<Function>>} */
  const watchers = new Map();

  let dirty = false;

  // ── Validation ────────────────────────────────────────────

  function validateKey(key) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('Key must be a non-empty string');
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(`Key exceeds max length (${MAX_KEY_LENGTH})`);
    }
    if (/[^\w:.\-/]/.test(key)) {
      throw new Error('Key contains invalid characters (allowed: alphanumeric, :, ., -, /, _)');
    }
  }

  function validateValue(value) {
    const serialized = JSON.stringify(value);
    if (serialized && serialized.length > MAX_VALUE_SIZE) {
      throw new Error(`Value exceeds max size (${MAX_VALUE_SIZE} bytes)`);
    }
  }

  // ── Core CRUD ─────────────────────────────────────────────

  /**
   * Get a value by key.
   * @param {string} key
   * @returns {any} Value or undefined if not found
   */
  function get(key) {
    validateKey(key);
    const entry = store.get(key);
    return entry ? entry.value : undefined;
  }

  /**
   * Get a value with metadata.
   * @param {string} key
   * @returns {object|null} { value, updatedAt, source } or null
   */
  function getEntry(key) {
    validateKey(key);
    const entry = store.get(key);
    return entry ? { ...entry } : null;
  }

  /**
   * Set a value. Emits shared-memory:updated event.
   * @param {string} key
   * @param {any}    value - Must be JSON-serializable
   * @param {string} [source='api'] - Source identifier (terminal, coord, api)
   * @returns {boolean} true if set
   */
  function set(key, value, source = 'api') {
    validateKey(key);
    validateValue(value);

    if (store.size >= MAX_KEYS && !store.has(key)) {
      throw new Error(`Maximum keys (${MAX_KEYS}) reached`);
    }

    const oldEntry = store.get(key);
    const oldValue = oldEntry ? oldEntry.value : undefined;

    const entry = {
      value,
      updatedAt: new Date().toISOString(),
      source,
    };
    store.set(key, entry);
    dirty = true;

    // Notify watchers
    const keyWatchers = watchers.get(key);
    if (keyWatchers) {
      for (const handler of keyWatchers) {
        try { handler({ key, value, oldValue, source }); } catch { /* noop */ }
      }
    }

    // Emit event
    if (events) {
      events.emit('shared-memory:updated', { key, value, oldValue, source });
    }

    // Auto-persist
    if (persistPath) save();

    return true;
  }

  /**
   * Delete a key. Emits shared-memory:deleted event.
   * @param {string} key
   * @returns {boolean} true if key existed and was deleted
   */
  function del(key) {
    validateKey(key);

    if (!store.has(key)) return false;

    const oldEntry = store.get(key);
    store.delete(key);
    dirty = true;

    // Notify watchers
    const keyWatchers = watchers.get(key);
    if (keyWatchers) {
      for (const handler of keyWatchers) {
        try { handler({ key, value: undefined, oldValue: oldEntry.value, source: 'delete' }); } catch { /* noop */ }
      }
    }

    if (events) {
      events.emit('shared-memory:deleted', { key, oldValue: oldEntry.value });
    }

    if (persistPath) save();

    return true;
  }

  /**
   * Check if a key exists.
   * @param {string} key
   * @returns {boolean}
   */
  function has(key) {
    validateKey(key);
    return store.has(key);
  }

  /**
   * Get all keys, optionally filtered by prefix.
   * @param {string} [prefix] - Filter keys starting with this prefix
   * @returns {string[]}
   */
  function keys(prefix) {
    const allKeys = [...store.keys()];
    if (!prefix) return allKeys;
    return allKeys.filter(k => k.startsWith(prefix));
  }

  /**
   * Get all entries as a plain object, optionally filtered by prefix.
   * @param {string} [prefix]
   * @returns {object} { key: { value, updatedAt, source } }
   */
  function entries(prefix) {
    const result = {};
    for (const [key, entry] of store) {
      if (!prefix || key.startsWith(prefix)) {
        result[key] = { ...entry };
      }
    }
    return result;
  }

  /**
   * Get the number of stored keys.
   * @returns {number}
   */
  function size() {
    return store.size;
  }

  /**
   * Clear all keys. Emits shared-memory:cleared event.
   */
  function clear() {
    const count = store.size;
    store.clear();
    dirty = true;

    if (events) {
      events.emit('shared-memory:cleared', { count });
    }

    if (persistPath) save();
  }

  // ── Watch ─────────────────────────────────────────────────

  /**
   * Watch a key for changes.
   * @param {string} key
   * @param {Function} handler - Called with { key, value, oldValue, source }
   * @returns {Function} Unwatch function
   */
  function watch(key, handler) {
    validateKey(key);
    if (typeof handler !== 'function') {
      throw new Error('Watch handler must be a function');
    }

    if (!watchers.has(key)) watchers.set(key, new Set());
    watchers.get(key).add(handler);

    // Return unwatch function
    return () => {
      const set = watchers.get(key);
      if (set) {
        set.delete(handler);
        if (set.size === 0) watchers.delete(key);
      }
    };
  }

  // ── Terminal Snapshots ────────────────────────────────────

  /**
   * Write a terminal snapshot (called on context-warning or before handoff).
   * Contains terminal state for the next session to pick up.
   *
   * @param {string} terminalId
   * @param {object} snapshot
   * @param {string}   [snapshot.lastOutput]   - Last N chars of terminal output
   * @param {string}   [snapshot.model]        - Model in use
   * @param {string}   [snapshot.sessionId]    - Claude CLI session ID
   * @param {number}   [snapshot.handoffCount] - Number of handoffs so far
   * @param {string}   [snapshot.taskId]       - Current coordination task ID
   * @param {object}   [snapshot.metadata]     - Arbitrary state to carry forward
   */
  function writeSnapshot(terminalId, snapshot = {}) {
    if (!terminalId || typeof terminalId !== 'string') {
      throw new Error('terminalId must be a non-empty string');
    }

    // Trim output to max size
    if (snapshot.lastOutput && snapshot.lastOutput.length > SNAPSHOT_OUTPUT_CHARS) {
      snapshot.lastOutput = snapshot.lastOutput.slice(-SNAPSHOT_OUTPUT_CHARS);
    }

    // Size check
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_SNAPSHOT_SIZE) {
      log(`[shared-memory] Snapshot for ${terminalId} exceeds max size, trimming`);
      // Drop lastOutput to fit
      snapshot.lastOutput = undefined;
    }

    const entry = {
      snapshot: { ...snapshot },
      updatedAt: new Date().toISOString(),
    };
    terminalSnapshots.set(terminalId, entry);
    dirty = true;

    if (events) {
      events.emit('shared-memory:snapshot-written', {
        terminalId,
        snapshotKeys: Object.keys(snapshot),
      });
    }

    if (persistPath) save();
  }

  /**
   * Read a terminal snapshot (called on respawn to restore context).
   * @param {string} terminalId
   * @returns {object|null} Snapshot data or null
   */
  function readSnapshot(terminalId) {
    const entry = terminalSnapshots.get(terminalId);
    return entry ? { ...entry.snapshot, _updatedAt: entry.updatedAt } : null;
  }

  /**
   * Delete a terminal snapshot.
   * @param {string} terminalId
   * @returns {boolean}
   */
  function deleteSnapshot(terminalId) {
    if (!terminalSnapshots.has(terminalId)) return false;
    terminalSnapshots.delete(terminalId);
    dirty = true;
    if (persistPath) save();
    return true;
  }

  /**
   * Get all terminal snapshots.
   * @returns {object} { terminalId: { snapshot, updatedAt } }
   */
  function getSnapshots() {
    const result = {};
    for (const [id, entry] of terminalSnapshots) {
      result[id] = { ...entry };
    }
    return result;
  }

  // ── Persistence ───────────────────────────────────────────

  /**
   * Save state to disk (atomic write).
   */
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
      // Fallback: direct write
      writeFileSync(persistPath, JSON.stringify(data, null, 2));
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }

    dirty = false;
  }

  /**
   * Load state from disk.
   * @returns {{ loaded: boolean, recovered?: boolean, keys: number, snapshots: number }}
   */
  function load() {
    if (!persistPath) return { loaded: false, keys: 0, snapshots: 0 };

    let data = null;
    let recovered = false;

    // Try primary file
    if (existsSync(persistPath)) {
      try {
        const raw = readFileSync(persistPath, 'utf-8');
        data = JSON.parse(raw);
        // Clean up orphaned .tmp
        try { unlinkSync(persistPath + '.tmp'); } catch { /* ignore */ }
      } catch (_err) {
        log(`[shared-memory] Failed to read primary file: ${_err.message}`);
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
          try { renameSync(tmpFile, persistPath); } catch { /* ignore */ }
          recovered = true;
          log('[shared-memory] Recovered from .tmp file');
        } catch (_err) {
          log(`[shared-memory] Failed to recover from .tmp: ${_err.message}`);
          data = null;
        }
      }
    }

    if (!data) {
      return { loaded: false, keys: 0, snapshots: 0 };
    }

    fromJSON(data);
    dirty = false;

    log(`[shared-memory] Loaded ${store.size} keys, ${terminalSnapshots.size} snapshots`);

    return {
      loaded: true,
      recovered,
      keys: store.size,
      snapshots: terminalSnapshots.size,
    };
  }

  // ── Serialization ─────────────────────────────────────────

  /**
   * Serialize all state to JSON-safe object.
   */
  function toJSON() {
    const storeData = {};
    for (const [key, entry] of store) {
      storeData[key] = entry;
    }

    const snapshotData = {};
    for (const [id, entry] of terminalSnapshots) {
      snapshotData[id] = entry;
    }

    return {
      store: storeData,
      snapshots: snapshotData,
    };
  }

  /**
   * Restore state from a serialized object.
   * @param {object} data - From toJSON()
   */
  function fromJSON(data) {
    store.clear();
    terminalSnapshots.clear();

    if (data.store && typeof data.store === 'object') {
      for (const [key, entry] of Object.entries(data.store)) {
        store.set(key, entry);
      }
    }

    if (data.snapshots && typeof data.snapshots === 'object') {
      for (const [id, entry] of Object.entries(data.snapshots)) {
        terminalSnapshots.set(id, entry);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────

  return {
    // Core CRUD
    get,
    getEntry,
    set,
    delete: del,
    has,
    keys,
    entries,
    size,
    clear,

    // Watch
    watch,

    // Terminal snapshots
    writeSnapshot,
    readSnapshot,
    deleteSnapshot,
    getSnapshots,

    // Persistence
    save,
    load,
    toJSON,
    fromJSON,
    get isPersistent() { return !!persistPath; },
    get persistPath() { return persistPath; },
  };
}

export {
  MAX_KEY_LENGTH,
  MAX_VALUE_SIZE,
  MAX_KEYS,
  MAX_SNAPSHOT_SIZE,
  SNAPSHOT_OUTPUT_CHARS,
};
