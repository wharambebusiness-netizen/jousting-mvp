// ============================================================
// Health Checker — Component-Level Health Probes (Phase 34)
// ============================================================
// Inspects each subsystem (coordinator, claude pool, shared
// memory, message bus, audit log, dead letter queue, disk)
// and produces a composite health status.
//
// Statuses: healthy | degraded | unhealthy
// Overall: unhealthy if ANY component is unhealthy,
//          degraded if any is degraded, else healthy.
//
// Factory: createHealthChecker(ctx) returns health API.
// ============================================================

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a health checker that probes all subsystems.
 *
 * @param {object} ctx
 * @param {object}  [ctx.coordinator]     - Coordinator instance
 * @param {object}  [ctx.claudePool]      - Claude terminal pool
 * @param {object}  [ctx.sharedMemory]    - Shared memory store
 * @param {object}  [ctx.messageBus]      - Terminal message bus
 * @param {object}  [ctx.auditLog]        - Audit log
 * @param {object}  [ctx.deadLetterQueue] - Dead letter queue
 * @param {string}  [ctx.dataDir]         - Path to .data/ directory for disk check
 * @returns {object} { check(), ready() }
 */
export function createHealthChecker(ctx = {}) {
  const {
    coordinator,
    claudePool,
    sharedMemory,
    messageBus,
    auditLog,
    deadLetterQueue,
    dataDir,
  } = ctx;

  /**
   * Probe a single component. Wraps the probe function in
   * try/catch so a faulty subsystem never crashes the checker.
   */
  function probeComponent(name, probeFn) {
    try {
      return probeFn();
    } catch (_err) {
      return { status: 'unhealthy', error: _err.message };
    }
  }

  /**
   * Full detailed health check.
   */
  function check() {
    const components = {};

    // ── Coordinator ──────────────────────────────────────
    components.coordinator = probeComponent('coordinator', () => {
      if (!coordinator) return { status: 'unavailable' };
      const state = coordinator.getState();
      const metrics = coordinator.getMetrics();
      const status = state === 'draining' ? 'degraded'
                   : (state === 'stopped' ? 'unhealthy' : 'healthy');
      return {
        status,
        state,
        tasksPending: metrics.outcomes?.pending ?? 0,
        tasksRunning: metrics.outcomes?.running ?? 0,
      };
    });

    // ── Claude Pool ──────────────────────────────────────
    components.claudePool = probeComponent('claudePool', () => {
      if (!claudePool) return { status: 'unavailable' };
      const ps = claudePool.getPoolStatus();
      return {
        status: 'healthy',
        running: ps.running,
        stopped: ps.stopped,
        maxTerminals: ps.maxTerminals,
      };
    });

    // ── Shared Memory ────────────────────────────────────
    components.sharedMemory = probeComponent('sharedMemory', () => {
      if (!sharedMemory) return { status: 'unavailable' };
      return {
        status: 'healthy',
        keyCount: sharedMemory.size(),
      };
    });

    // ── Message Bus ──────────────────────────────────────
    components.messageBus = probeComponent('messageBus', () => {
      if (!messageBus) return { status: 'unavailable' };
      return {
        status: 'healthy',
        messageCount: messageBus.count(),
      };
    });

    // ── Audit Log ────────────────────────────────────────
    components.auditLog = probeComponent('auditLog', () => {
      if (!auditLog) return { status: 'unavailable' };
      return {
        status: 'healthy',
        entryCount: auditLog.count(),
      };
    });

    // ── Dead Letter Queue ────────────────────────────────
    components.deadLetterQueue = probeComponent('deadLetterQueue', () => {
      if (!deadLetterQueue) return { status: 'unavailable' };
      const stats = deadLetterQueue.getStats();
      const pendingCount = stats.byStatus?.pending ?? 0;
      return {
        status: pendingCount > 10 ? 'degraded' : 'healthy',
        pendingCount,
      };
    });

    // ── Disk ─────────────────────────────────────────────
    components.disk = probeComponent('disk', () => {
      if (!dataDir) return { status: 'unavailable', dataDir: null, writable: false };
      // Ensure directory exists
      if (!existsSync(dataDir)) {
        try { mkdirSync(dataDir, { recursive: true }); } catch { /* ignore */ }
      }
      const testFile = join(dataDir, `.health-check-${Date.now()}.tmp`);
      try {
        writeFileSync(testFile, 'ok');
        unlinkSync(testFile);
        return { status: 'healthy', dataDir, writable: true };
      } catch (_err) {
        return { status: 'unhealthy', dataDir, writable: false };
      }
    });

    // ── Overall Status ───────────────────────────────────
    let overall = 'healthy';
    for (const comp of Object.values(components)) {
      if (comp.status === 'unhealthy') { overall = 'unhealthy'; break; }
      if (comp.status === 'degraded') { overall = 'degraded'; }
      // 'unavailable' does not degrade overall — subsystem simply isn't configured
    }

    return {
      ok: overall !== 'unhealthy',
      status: overall,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      components,
    };
  }

  /**
   * Lightweight readiness probe.
   */
  function ready() {
    return { ok: true };
  }

  return { check, ready };
}
