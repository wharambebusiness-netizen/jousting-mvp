// ============================================================
// Persistent Queue — Disk-Backed Task Queue Wrapper
// ============================================================
// Wraps createTaskQueue() with atomic file persistence so the
// coordination queue survives coordinator restarts and crashes.
//
// Uses the same atomic-write + lockfile pattern as registry.mjs:
//   1. Write to .tmp file
//   2. Rename .tmp → primary (atomic on most OS)
//   3. Fallback to direct write if rename fails
//   4. Lockfile guards concurrent writes
//   5. .tmp recovery on load (crash between write + rename)
//
// On load, in-flight tasks (assigned/running) are reset to
// pending since the workers that held them are gone.
//
// Factory: createPersistentQueue({ filePath }) returns a queue
// object with the same API as createTaskQueue() plus load/save.
// ============================================================

import { createTaskQueue } from './task-queue.mjs';
import {
  writeFileSync, readFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { lockSync, unlockSync } from 'proper-lockfile';

// Methods that trigger auto-save (meaningful state changes).
// assign/start are skipped — they're intermediate states that
// get reset to pending on recovery anyway.
const SAVE_METHODS = new Set([
  'add', 'remove', 'complete', 'fail', 'cancel', 'retry', 'clear',
]);

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a persistent task queue backed by a JSON file.
 * @param {object} options
 * @param {string} options.filePath - Path to the persistence file
 * @param {Function} [options.log] - Logger function
 * @returns {object} Queue methods (same as createTaskQueue + load/save/filePath)
 */
export function createPersistentQueue({ filePath, log: _log } = {}) {
  if (!filePath) throw new Error('PersistentQueue requires a filePath');
  const log = _log || (() => {});

  const queue = createTaskQueue({ log });

  // ── Atomic Write ────────────────────────────────────────

  function atomicWrite(data) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = filePath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      renameSync(tmpFile, filePath);
    } catch (_err) {
      // Fallback: direct write if rename fails (cross-device, Windows edge cases)
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      try { unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }
  }

  // ── Save ────────────────────────────────────────────────

  function save() {
    const data = queue.toJSON();
    data.savedAt = new Date().toISOString();
    data.version = 1;

    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let release;
    try {
      release = lockSync(filePath, { realpath: false });
    } catch (_) { /* proceed without lock if file doesn't exist yet */ }

    try {
      atomicWrite(data);
    } finally {
      if (release) {
        try { unlinkSync(filePath + '.lock'); } catch (_) { /* ignore */ }
      }
    }
  }

  // ── Load ────────────────────────────────────────────────

  /**
   * Load queue state from disk. Resets in-flight tasks to pending.
   * @returns {{ loaded: boolean, recovered?: boolean, tasks: number, reset: number }}
   */
  function load() {
    let data = null;
    let recovered = false;

    // Try primary file
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf-8');
        data = JSON.parse(raw);
        // Clean up orphaned .tmp
        try { unlinkSync(filePath + '.tmp'); } catch (_) { /* ignore */ }
      } catch (_err) {
        log(`[persist] Failed to read primary file: ${_err.message}`);
        data = null;
      }
    }

    // Fallback: try .tmp recovery (crash between write and rename)
    if (!data) {
      const tmpFile = filePath + '.tmp';
      if (existsSync(tmpFile)) {
        try {
          const raw = readFileSync(tmpFile, 'utf-8');
          data = JSON.parse(raw);
          // Promote .tmp to primary
          try { renameSync(tmpFile, filePath); } catch (_) { /* ignore */ }
          recovered = true;
          log('[persist] Recovered from .tmp file');
        } catch (_err) {
          log(`[persist] Failed to recover from .tmp: ${_err.message}`);
          data = null;
        }
      }
    }

    if (!data || !Array.isArray(data.tasks)) {
      return { loaded: false, tasks: 0, reset: 0 };
    }

    // Reset in-flight tasks (assigned/running → pending)
    // Workers are gone after a restart, so these must be re-queued.
    let resetCount = 0;
    for (const task of data.tasks) {
      if (task.status === 'assigned' || task.status === 'running') {
        task.status = 'pending';
        task.assignedTo = null;
        task.assignedAt = null;
        task.startedAt = null;
        resetCount++;
      }
    }

    queue.fromJSON(data);
    log(`[persist] Loaded ${data.tasks.length} tasks (${resetCount} reset to pending)`);

    return {
      loaded: true,
      recovered,
      tasks: queue.size(),
      reset: resetCount,
    };
  }

  // ── Proxy Methods ───────────────────────────────────────

  const proxy = {};

  // Get all method names from the queue
  for (const key of Object.keys(queue)) {
    if (typeof queue[key] !== 'function') {
      proxy[key] = queue[key];
      continue;
    }

    if (SAVE_METHODS.has(key)) {
      // Wrap mutation methods with auto-save
      proxy[key] = (...args) => {
        const result = queue[key](...args);
        save();
        return result;
      };
    } else {
      // Pass-through for read methods
      proxy[key] = (...args) => queue[key](...args);
    }
  }

  // Override toJSON/fromJSON — fromJSON should NOT auto-save
  proxy.toJSON = () => queue.toJSON();
  proxy.fromJSON = (json) => queue.fromJSON(json);

  // Add persistence-specific methods
  proxy.load = load;
  proxy.save = save;
  proxy.filePath = filePath;
  proxy.isPersistent = true;

  return proxy;
}
