// ============================================================
// Master Coordinator — Multi-Master Heartbeat & Domain Affinity
// ============================================================
// Provides heartbeat monitoring, domain claiming, and dead master
// recovery for multi-master configurations.
//
// Uses shared memory (not terminal messages) to avoid burning
// context tokens. Each master writes its heartbeat to:
//   master:{id}:heartbeat
//
// Factory: createMasterCoordinator(ctx) returns coordinator methods.
// ============================================================

const HEARTBEAT_INTERVAL_MS = 30_000;  // 30s heartbeat write
const STALE_THRESHOLD_MS = 90_000;     // 90s = dead master
const RECOVERY_CHECK_INTERVAL_MS = 15_000; // 15s dead-master check

/**
 * Create a master coordinator for multi-master setups.
 * @param {object} ctx
 * @param {object} ctx.events - EventBus
 * @param {object} ctx.sharedMemory - Shared memory instance
 * @param {object} ctx.claudePool - Claude pool instance
 * @param {object} [ctx.coordinator] - Task coordinator (for task recovery)
 * @param {Function} [ctx.log] - Logger
 * @returns {object} Master coordinator methods
 */
export function createMasterCoordinator(ctx) {
  const { events, sharedMemory, claudePool } = ctx;
  const coordinator = ctx.coordinator || null;
  const log = ctx.log || (() => {});

  /** @type {Map<string, NodeJS.Timer>} heartbeat timers per master */
  const _heartbeatTimers = new Map();

  /** @type {NodeJS.Timer|null} recovery check timer */
  let _recoveryTimer = null;

  // ── Registration ──────────────────────────────────────

  /**
   * Register a master terminal for heartbeat monitoring.
   * @param {string} masterId
   * @param {object} [opts]
   * @param {string} [opts.domain] - Domain affinity claim
   */
  function register(masterId, opts = {}) {
    if (!masterId) throw new Error('masterId is required');

    // Write initial heartbeat
    _writeHeartbeat(masterId, opts.domain || null);

    // Start heartbeat interval
    const timer = setInterval(() => {
      _writeHeartbeat(masterId);
    }, HEARTBEAT_INTERVAL_MS);
    timer.unref();
    _heartbeatTimers.set(masterId, timer);

    // Set domain if provided
    if (opts.domain && claudePool) {
      claudePool.setMasterDomain(masterId, opts.domain);
    }

    log(`[master-coordinator] Registered master: ${masterId}${opts.domain ? ` (domain: ${opts.domain})` : ''}`);
    events.emit('master-coordinator:registered', { masterId, domain: opts.domain || null });

    // Start recovery timer if not running
    if (!_recoveryTimer) {
      _recoveryTimer = setInterval(_checkForDeadMasters, RECOVERY_CHECK_INTERVAL_MS);
      _recoveryTimer.unref();
    }
  }

  /**
   * Deregister a master terminal.
   * @param {string} masterId
   */
  function deregister(masterId) {
    // Stop heartbeat
    const timer = _heartbeatTimers.get(masterId);
    if (timer) {
      clearInterval(timer);
      _heartbeatTimers.delete(masterId);
    }

    // Clean up shared memory
    try {
      sharedMemory.delete(`master:${masterId}:heartbeat`);
    } catch { /* key may not exist */ }

    log(`[master-coordinator] Deregistered master: ${masterId}`);
    events.emit('master-coordinator:deregistered', { masterId });

    // Stop recovery timer if no masters left
    if (_heartbeatTimers.size === 0 && _recoveryTimer) {
      clearInterval(_recoveryTimer);
      _recoveryTimer = null;
    }
  }

  // ── Domain Claiming ──────────────────────────────────

  /**
   * Claim a domain for a master.
   * @param {string} masterId
   * @param {string} domain - Category name (e.g., 'testing', 'features')
   * @returns {boolean} true if claimed
   */
  function claimDomain(masterId, domain) {
    if (!masterId || !domain) return false;

    // Update in shared memory
    const key = `master:${masterId}:heartbeat`;
    const existing = sharedMemory.get(key);
    if (existing) {
      sharedMemory.set(key, { ...existing, domain }, 'master-coordinator');
    }

    // Update in pool
    if (claudePool) {
      claudePool.setMasterDomain(masterId, domain);
    }

    events.emit('master-coordinator:domain-claimed', { masterId, domain });
    return true;
  }

  /**
   * Release a master's domain claim.
   * @param {string} masterId
   * @returns {boolean}
   */
  function releaseDomain(masterId) {
    return claimDomain(masterId, null) || true;
  }

  // ── Status ──────────────────────────────────────────

  /**
   * Get aggregated multi-master status from shared memory.
   * @returns {object} { masters: [...], totalMasters, activeMasters, staleMasters }
   */
  function getMultiMasterStatus() {
    const masters = [];
    const now = Date.now();
    const allKeys = sharedMemory.keys();

    for (const key of allKeys) {
      if (!key.startsWith('master:') || !key.endsWith(':heartbeat')) continue;

      const value = sharedMemory.get(key);
      if (!value) continue;

      const masterId = key.replace('master:', '').replace(':heartbeat', '');
      const lastBeat = value.lastBeat ? new Date(value.lastBeat).getTime() : 0;
      const staleness = now - lastBeat;
      const isStale = staleness > STALE_THRESHOLD_MS;

      masters.push({
        id: masterId,
        alive: value.alive !== false && !isStale,
        lastBeat: value.lastBeat,
        staleMs: staleness,
        isStale,
        domain: value.domain || null,
        claimedTasks: value.claimedTasks || 0,
        workerCount: value.workerCount || 0,
      });
    }

    return {
      masters,
      totalMasters: masters.length,
      activeMasters: masters.filter(m => m.alive).length,
      staleMasters: masters.filter(m => m.isStale).length,
    };
  }

  // ── Internal ──────────────────────────────────────────

  /**
   * Write heartbeat to shared memory for a master.
   * @param {string} masterId
   * @param {string|null} [domainOverride]
   */
  function _writeHeartbeat(masterId, domainOverride) {
    const key = `master:${masterId}:heartbeat`;

    // Gather current state from pool
    let claimedTasks = 0;
    let workerCount = 0;
    let domain = domainOverride !== undefined ? domainOverride : null;

    if (claudePool) {
      const registry = claudePool.getMasterRegistry();
      const masterInfo = registry.find(m => m.id === masterId);
      if (masterInfo) {
        claimedTasks = masterInfo.claimedTaskIds.length;
        workerCount = masterInfo.workerIds.length;
        if (domainOverride === undefined) {
          domain = masterInfo.domain;
        }
      }
    }

    sharedMemory.set(key, {
      alive: true,
      lastBeat: new Date().toISOString(),
      claimedTasks,
      workerCount,
      domain,
    }, 'master-coordinator');
  }

  /**
   * Check for dead masters and recover their tasks.
   */
  function _checkForDeadMasters() {
    const status = getMultiMasterStatus();

    for (const master of status.masters) {
      if (!master.isStale) continue;

      log(`[master-coordinator] Stale master detected: ${master.id} (${Math.round(master.staleMs / 1000)}s since last heartbeat)`);

      // Release tasks back to pending
      if (coordinator && coordinator.taskQueue) {
        const registry = claudePool ? claudePool.getMasterRegistry() : [];
        const masterInfo = registry.find(m => m.id === master.id);
        if (masterInfo) {
          for (const taskId of masterInfo.claimedTaskIds) {
            try {
              coordinator.taskQueue.fail(taskId, `Master ${master.id} stale (heartbeat timeout)`);
              coordinator.taskQueue.retry(taskId);
            } catch { /* task may be in terminal state */ }
          }
        }
      }

      // Clean up shared memory heartbeat
      try {
        sharedMemory.delete(`master:${master.id}:heartbeat`);
      } catch { /* already deleted */ }

      events.emit('master-coordinator:stale-recovered', {
        masterId: master.id,
        staleMs: master.staleMs,
      });
    }
  }

  // ── Cleanup ──────────────────────────────────────────

  /**
   * Destroy the coordinator, clean up all timers.
   */
  function destroy() {
    for (const [, timer] of _heartbeatTimers) {
      clearInterval(timer);
    }
    _heartbeatTimers.clear();

    if (_recoveryTimer) {
      clearInterval(_recoveryTimer);
      _recoveryTimer = null;
    }
  }

  return {
    register,
    deregister,
    claimDomain,
    releaseDomain,
    getMultiMasterStatus,
    destroy,
  };
}

export { HEARTBEAT_INTERVAL_MS, STALE_THRESHOLD_MS, RECOVERY_CHECK_INTERVAL_MS };
