// ============================================================
// Retention Policy — Data Cleanup for Persisted State (Phase 30)
// ============================================================
// Age-based and count-based retention for messages, snapshots,
// and completed tasks. Works with existing subsystem APIs.
//
// Factory: createRetentionPolicy(ctx) returns cleanup API.
// ============================================================

// ── Constants ───────────────────────────────────────────────

const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_MAX_ENTRIES = 1000;
const MS_PER_DAY = 86_400_000;

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a retention policy for cleaning old data.
 *
 * @param {object} [ctx]
 * @param {object}   [ctx.log]          - Logger with .info() (optional)
 * @param {number}   [ctx.maxAgeDays]   - Max age in days (default 30)
 * @param {number}   [ctx.maxEntries]   - Max entries to keep (default 1000)
 * @returns {object} Retention policy API
 */
export function createRetentionPolicy(ctx = {}) {
  const log = ctx.log || null;
  const maxAgeDays = ctx.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const maxEntries = ctx.maxEntries ?? DEFAULT_MAX_ENTRIES;

  /**
   * Remove messages older than maxAgeDays.
   * @param {object} messageBus - Terminal message bus instance
   * @returns {number} Count of messages removed
   */
  function cleanMessages(messageBus) {
    if (!messageBus) return 0;

    const cutoff = new Date(Date.now() - maxAgeDays * MS_PER_DAY).toISOString();
    const all = messageBus.getAll();
    let removed = 0;

    for (const msg of all) {
      if (msg.timestamp < cutoff) {
        messageBus.delete(msg.id);
        removed++;
      }
    }

    if (removed > 0 && log) {
      log.info?.(`Retention: removed ${removed} old messages`);
    }

    return removed;
  }

  /**
   * Remove snapshots older than maxAgeDays.
   * Uses sharedMemory keys() with 'snapshot:' prefix.
   * @param {object} sharedMemory - Shared memory instance
   * @returns {number} Count of snapshots removed
   */
  function cleanSnapshots(sharedMemory) {
    if (!sharedMemory) return 0;

    const cutoff = new Date(Date.now() - maxAgeDays * MS_PER_DAY).toISOString();
    const snapshotKeys = sharedMemory.keys('snapshot:');
    let removed = 0;

    for (const key of snapshotKeys) {
      const entry = sharedMemory.getEntry(key);
      if (entry && entry.updatedAt < cutoff) {
        sharedMemory.delete(key);
        removed++;
      }
    }

    if (removed > 0 && log) {
      log.info?.(`Retention: removed ${removed} old snapshots`);
    }

    return removed;
  }

  /**
   * Remove old completed/failed/cancelled tasks beyond maxEntries and maxAgeDays.
   * @param {object} taskQueue - Task queue instance (with getAll/remove)
   * @returns {number} Count of tasks removed
   */
  function cleanCompletedTasks(taskQueue) {
    if (!taskQueue) return 0;

    const cutoff = new Date(Date.now() - maxAgeDays * MS_PER_DAY).toISOString();
    const terminalStatuses = new Set(['complete', 'failed', 'cancelled']);
    const all = taskQueue.getAll();

    // Filter to terminal-state tasks only
    const terminal = all.filter(t => terminalStatuses.has(t.status));

    // Sort by completedAt descending (newest first) to keep most recent
    terminal.sort((a, b) => {
      const aAt = a.completedAt || a.createdAt || '';
      const bAt = b.completedAt || b.createdAt || '';
      return bAt.localeCompare(aAt);
    });

    let removed = 0;

    for (let i = 0; i < terminal.length; i++) {
      const task = terminal[i];
      const taskTime = task.completedAt || task.createdAt || '';

      // Remove if over count cap OR over age limit
      if (i >= maxEntries || taskTime < cutoff) {
        try {
          taskQueue.remove(task.id);
          removed++;
        } catch {
          // Task might be in non-removable state; skip
        }
      }
    }

    if (removed > 0 && log) {
      log.info?.(`Retention: removed ${removed} old completed tasks`);
    }

    return removed;
  }

  /**
   * Run all cleanup policies.
   * @param {object} targets
   * @param {object} [targets.messageBus]
   * @param {object} [targets.sharedMemory]
   * @param {object} [targets.taskQueue]
   * @returns {{ messagesRemoved: number, snapshotsRemoved: number, tasksRemoved: number }}
   */
  function runAll({ messageBus, sharedMemory, taskQueue } = {}) {
    const messagesRemoved = cleanMessages(messageBus);
    const snapshotsRemoved = cleanSnapshots(sharedMemory);
    const tasksRemoved = cleanCompletedTasks(taskQueue);

    return { messagesRemoved, snapshotsRemoved, tasksRemoved };
  }

  return {
    cleanMessages,
    cleanSnapshots,
    cleanCompletedTasks,
    runAll,
    get maxAgeDays() { return maxAgeDays; },
    get maxEntries() { return maxEntries; },
  };
}

export { DEFAULT_MAX_AGE_DAYS, DEFAULT_MAX_ENTRIES };
