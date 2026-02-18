// ============================================================
// File Watcher (P9)
// ============================================================
// Watches project directories for file changes and emits
// events on the EventBus for real-time UI updates.
// Uses Node.js built-in fs.watch with recursive mode.
// ============================================================

import { watch, existsSync } from 'fs';
import { resolve } from 'path';

const IGNORED_SEGMENTS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.cache', '.turbo', '.parcel-cache', 'coverage', '.nyc_output',
]);

/**
 * Check if a file path should be ignored (contains an ignored segment).
 */
function shouldIgnore(filename) {
  if (!filename) return true;
  const parts = filename.replace(/\\/g, '/').split('/');
  return parts.some(p => IGNORED_SEGMENTS.has(p));
}

/**
 * Create a file watcher that monitors project directories.
 *
 * @param {EventBus} events  EventBus to emit project:files-changed events
 * @returns {{ watchProject, unwatchAll, isWatching, watchedDirs }}
 */
export function createFileWatcher(events) {
  const watchers = new Map(); // projectDir → FSWatcher
  const debounceTimers = new Map(); // projectDir → timeout

  const DEBOUNCE_MS = 1000;

  /**
   * Start watching a project directory.
   * No-op if already watching or directory doesn't exist.
   */
  function watchProject(projectDir) {
    if (!projectDir || projectDir === '(default)') return;

    const resolved = resolve(projectDir).replace(/\\/g, '/');
    if (watchers.has(resolved)) return;

    if (!existsSync(resolved)) return;

    try {
      const watcher = watch(resolved, { recursive: true }, (_eventType, filename) => {
        if (shouldIgnore(filename)) return;

        // Debounce per project — batch rapid changes
        if (debounceTimers.has(resolved)) {
          clearTimeout(debounceTimers.get(resolved));
        }
        debounceTimers.set(resolved, setTimeout(() => {
          debounceTimers.delete(resolved);
          events.emit('project:files-changed', {
            projectDir: resolved,
            timestamp: new Date().toISOString(),
          });
        }, DEBOUNCE_MS));
      });

      watcher.on('error', () => {
        // Silently remove broken watchers
        unwatchProject(resolved);
      });

      watchers.set(resolved, watcher);
    } catch {
      // Can't watch this directory — skip
    }
  }

  /**
   * Stop watching a specific project directory.
   */
  function unwatchProject(dir) {
    const resolved = resolve(dir).replace(/\\/g, '/');
    const watcher = watchers.get(resolved);
    if (watcher) {
      try { watcher.close(); } catch { /* already closed */ }
      watchers.delete(resolved);
    }
    const timer = debounceTimers.get(resolved);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(resolved);
    }
  }

  /**
   * Stop watching all directories. Used for cleanup on shutdown.
   */
  function unwatchAll() {
    for (const [dir, watcher] of watchers) {
      try { watcher.close(); } catch { /* already closed */ }
      watchers.delete(dir);
    }
    for (const [dir, timer] of debounceTimers) {
      clearTimeout(timer);
      debounceTimers.delete(dir);
    }
  }

  /**
   * Check if a directory is being watched.
   */
  function isWatching(dir) {
    return watchers.has(resolve(dir).replace(/\\/g, '/'));
  }

  /**
   * Get list of currently watched directories.
   */
  function watchedDirs() {
    return [...watchers.keys()];
  }

  return { watchProject, unwatchProject, unwatchAll, isWatching, watchedDirs };
}
