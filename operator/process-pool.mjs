// ============================================================
// Process Pool — Multi-Orchestrator Worker Management
// ============================================================
// Manages multiple orchestrator worker processes via fork() IPC.
// Each worker is an independent child process running
// orchestrator-worker.mjs with its own IPCEventBus.
//
// Factory pattern: createProcessPool(ctx) returns pool methods.
// IPC events from workers are re-emitted on the parent EventBus.
//
// Phase 7b: circuit breaker, idle kill, crash recovery with
// backoff, max restarts.
//
// Windows-safe: uses IPC messages for shutdown (not SIGTERM).
// ============================================================

import { fork } from 'child_process';
import { resolve, join } from 'path';

// ── Constants ───────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;  // Send heartbeat every 30s
const HEARTBEAT_TIMEOUT_MS = 90_000;   // 3 missed = dead (90s)
const FORCE_KILL_TIMEOUT_MS = 5_000;   // Force kill after 5s

// ── Robustness Defaults ─────────────────────────────────────

const DEFAULT_MAX_RESTARTS = 5;               // Max consecutive restarts before giving up
const DEFAULT_RESTART_BACKOFF_BASE_MS = 1000;  // 1s base, doubles each restart
const MAX_RESTART_BACKOFF_MS = 60_000;         // Cap at 60s
const DEFAULT_IDLE_TIMEOUT_MS = 0;             // 0 = disabled
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 3;   // Consecutive failures to open circuit
const DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000; // 30s before half-open

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a process pool for managing orchestrator workers.
 * @param {object} ctx
 * @param {EventBus} ctx.events - Parent EventBus (IPC events re-emitted here)
 * @param {string} ctx.projectDir - Project root directory
 * @param {Function} [ctx.log] - Logger function
 * @param {number} [ctx.maxRestarts] - Max consecutive restarts before giving up (default 5)
 * @param {number} [ctx.restartBackoffBaseMs] - Base delay between restarts in ms (default 1000)
 * @param {number} [ctx.idleTimeoutMs] - Kill workers idle longer than this (0 = disabled)
 * @param {number} [ctx.circuitBreakerThreshold] - Consecutive failures to open circuit (default 3)
 * @param {number} [ctx.circuitBreakerCooldownMs] - Time before half-open retry (default 30000)
 * @returns {object} Pool methods
 */
export function createProcessPool(ctx) {
  const { events, projectDir } = ctx;
  const log = ctx.log || console.log;

  // Robustness options
  const maxRestarts = ctx.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const restartBackoffBaseMs = ctx.restartBackoffBaseMs ?? DEFAULT_RESTART_BACKOFF_BASE_MS;
  const idleTimeoutMs = ctx.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const circuitBreakerThreshold = ctx.circuitBreakerThreshold ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLD;
  const circuitBreakerCooldownMs = ctx.circuitBreakerCooldownMs ?? DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS;

  /** @type {Map<string, WorkerEntry>} */
  const workers = new Map();

  // Resolve worker entry point from this module's directory
  const workerScript = ctx.workerScript ||
    join(resolve(import.meta.dirname || '.'), 'orchestrator-worker.mjs');

  // ── Heartbeat + Idle Checker ────────────────────────────

  let heartbeatTimer = null;

  function startHeartbeatChecker() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of workers) {
        if (entry.status !== 'running') continue;

        // Send ping
        try {
          entry.process.send({ type: 'ping' });
        } catch { /* IPC closed */ }

        // Check for missed heartbeats
        if (now - entry.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          log(`[pool] Worker ${id} missed heartbeats, restarting...`);
          events.emit('worker:unhealthy', { workerId: id });
          restartWorker(id);
          continue;
        }

        // Half-open recovery: worker survived a heartbeat cycle → close circuit
        if (entry.circuitState === 'half-open') {
          resetFailures(entry);
        }

        // Check for idle timeout
        if (idleTimeoutMs > 0 && (now - entry.lastActivity > idleTimeoutMs)) {
          log(`[pool] Worker ${id} idle for ${Math.round((now - entry.lastActivity) / 1000)}s, killing...`);
          events.emit('worker:idle-killed', { workerId: id, idleMs: now - entry.lastActivity });
          kill(id);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();
  }

  function stopHeartbeatChecker() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // ── Circuit Breaker Helpers ───────────────────────────────

  /**
   * Check if a worker's circuit breaker allows restart.
   * @param {object} entry - Worker entry
   * @returns {boolean} true if restart is allowed
   */
  function isCircuitAllowsRestart(entry) {
    if (entry.circuitState === 'closed') return true;
    if (entry.circuitState === 'half-open') return true;

    // Circuit is open — check cooldown
    if (entry.circuitState === 'open' && entry.circuitOpenedAt) {
      const elapsed = Date.now() - entry.circuitOpenedAt;
      if (elapsed >= circuitBreakerCooldownMs) {
        // Transition to half-open
        entry.circuitState = 'half-open';
        log(`[pool] Worker ${entry.id} circuit half-open after ${Math.round(elapsed / 1000)}s cooldown`);
        events.emit('worker:circuit-half-open', { workerId: entry.id, cooldownMs: elapsed });
        return true;
      }
    }

    return false;
  }

  /**
   * Record a worker failure and possibly open the circuit.
   * @param {object} entry - Worker entry
   */
  function recordFailure(entry) {
    entry.consecutiveFailures++;

    if (entry.consecutiveFailures >= circuitBreakerThreshold) {
      entry.circuitState = 'open';
      entry.circuitOpenedAt = Date.now();
      log(`[pool] Worker ${entry.id} circuit OPEN after ${entry.consecutiveFailures} consecutive failures`);
      events.emit('worker:circuit-open', {
        workerId: entry.id,
        consecutiveFailures: entry.consecutiveFailures,
        threshold: circuitBreakerThreshold,
      });
    }
  }

  /**
   * Reset failure tracking (worker successfully started).
   * @param {object} entry - Worker entry
   */
  function resetFailures(entry) {
    entry.consecutiveFailures = 0;
    if (entry.circuitState !== 'closed') {
      const prevState = entry.circuitState;
      entry.circuitState = 'closed';
      entry.circuitOpenedAt = null;
      if (prevState === 'half-open') {
        log(`[pool] Worker ${entry.id} circuit closed (recovered from half-open)`);
      }
    }
  }

  // ── IPC Message Handler ─────────────────────────────────

  function handleWorkerMessage(workerId, msg) {
    if (!msg || typeof msg !== 'object') return;

    const entry = workers.get(workerId);

    switch (msg.type) {
      case 'event':
        // Re-emit worker events on parent EventBus with workerId tag
        if (msg.event) {
          events.emit(msg.event, { ...msg.data, workerId });
        }
        // Activity: real work events count as activity
        if (entry) entry.lastActivity = Date.now();
        break;

      case 'pong':
        // Heartbeat response
        if (entry) entry.lastHeartbeat = Date.now();
        break;

      case 'status':
        // Worker status update
        if (entry && msg.status) {
          entry.workerStatus = msg.status;
        }
        if (entry) entry.lastActivity = Date.now();
        break;

      case 'ready':
        // Worker initialization complete
        // Note: do NOT reset failures here — worker must prove stable
        // (survive a heartbeat cycle) before failures are cleared.
        if (entry) {
          entry.status = 'running';
          entry.lastHeartbeat = Date.now();
          entry.lastActivity = Date.now();
          events.emit('worker:ready', { workerId });
        }
        break;

      case 'error':
        log(`[pool] Worker ${workerId} error: ${msg.message}`);
        events.emit('worker:error', { workerId, error: msg.message });
        break;
    }
  }

  // ── Worker Lifecycle ────────────────────────────────────

  /**
   * Spawn a new worker process.
   * @param {string} workerId - Unique worker identifier
   * @param {object} config - Worker configuration
   * @param {string} [config.model] - Model to use
   * @param {string} [config.mission] - Mission file path
   * @param {boolean} [config.dryRun] - Dry run mode
   * @param {string} [config.handoffFile] - Path to handoff context file
   * @returns {object} Worker entry
   */
  function spawn(workerId, config = {}) {
    if (workers.has(workerId)) {
      const existing = workers.get(workerId);
      if (existing.status === 'running' || existing.status === 'starting') {
        throw new Error(`Worker ${workerId} is already running`);
      }
      // Clean up dead worker entry
      workers.delete(workerId);
    }

    const child = fork(workerScript, [], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        WORKER_ID: workerId,
      },
    });

    const now = Date.now();
    const entry = {
      id: workerId,
      process: child,
      pid: child.pid,
      status: 'starting',
      config,
      startedAt: new Date().toISOString(),
      lastHeartbeat: now,
      lastActivity: now,
      workerStatus: null,
      restartCount: 0,
      consecutiveFailures: 0,
      circuitState: 'closed',    // closed | open | half-open
      circuitOpenedAt: null,
    };

    workers.set(workerId, entry);

    // IPC message handler
    child.on('message', (msg) => handleWorkerMessage(workerId, msg));

    // Stdout/stderr forwarding
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        events.emit('worker:log', {
          workerId,
          stream: 'stdout',
          text: data.toString(),
        });
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        events.emit('worker:log', {
          workerId,
          stream: 'stderr',
          text: data.toString(),
        });
      });
    }

    // Exit handler — distinguish clean exit vs crash
    child.on('exit', (code, signal) => {
      const e = workers.get(workerId);
      if (e) {
        e.status = 'stopped';
        e.exitCode = code;
        e.exitSignal = signal;
        e.stoppedAt = new Date().toISOString();

        // Non-zero exit = crash → record failure, attempt restart
        const isCrash = code !== 0 && code !== null;
        if (isCrash) {
          recordFailure(e);

          // Auto-restart with backoff if circuit allows and under max restarts
          if (e.consecutiveFailures <= maxRestarts && isCircuitAllowsRestart(e)) {
            const attempt = e.consecutiveFailures;
            const delay = Math.min(
              restartBackoffBaseMs * Math.pow(2, attempt - 1),
              MAX_RESTART_BACKOFF_MS
            );
            log(`[pool] Worker ${workerId} crashed (code ${code}), restart #${attempt} in ${delay}ms`);
            const backoffTimer = setTimeout(() => restartWorker(workerId), delay);
            backoffTimer.unref();
          } else if (e.consecutiveFailures > maxRestarts) {
            log(`[pool] Worker ${workerId} exceeded max restarts (${maxRestarts}), giving up`);
            events.emit('worker:max-restarts', {
              workerId,
              restartCount: e.restartCount,
              consecutiveFailures: e.consecutiveFailures,
              maxRestarts,
            });
          }
          // If circuit is open, recordFailure already emitted worker:circuit-open
        }
      }
      events.emit('worker:exit', { workerId, code, signal });
    });

    child.on('error', (err) => {
      log(`[pool] Worker ${workerId} process error: ${err.message}`);
      const e = workers.get(workerId);
      if (e) e.status = 'error';
      events.emit('worker:error', { workerId, error: err.message });
    });

    // Send initial config
    try {
      child.send({ type: 'init', workerId, config, projectDir, handoffFile: config.handoffFile || null });
    } catch (err) {
      log(`[pool] Failed to send init to worker ${workerId}: ${err.message}`);
    }

    // Start heartbeat checker if not already running
    startHeartbeatChecker();

    events.emit('worker:spawned', { workerId, pid: child.pid, config });

    return { id: workerId, pid: child.pid, status: entry.status };
  }

  /**
   * Kill a worker process (graceful IPC shutdown + force-kill timeout).
   * @param {string} workerId
   * @returns {boolean} true if worker was found and kill initiated
   */
  function kill(workerId) {
    const entry = workers.get(workerId);
    if (!entry) return false;
    if (entry.status === 'stopped') return false;

    // Send IPC shutdown message (Windows-safe, SIGTERM can't be caught)
    try {
      entry.process.send({ type: 'shutdown' });
    } catch { /* IPC may be closed */ }

    entry.status = 'stopping';

    // Force kill after timeout
    const forceTimer = setTimeout(() => {
      try {
        if (!entry.process.killed) {
          entry.process.kill('SIGKILL');
        }
      } catch { /* already dead */ }
    }, FORCE_KILL_TIMEOUT_MS);
    forceTimer.unref();

    return true;
  }

  /**
   * Restart a worker with its original config.
   * Preserves circuit breaker state and failure counts across restarts.
   * @param {string} workerId
   * @returns {boolean} false if restart was blocked by circuit breaker or max restarts
   */
  function restartWorker(workerId) {
    const entry = workers.get(workerId);
    if (!entry) return false;

    // Check circuit breaker
    if (!isCircuitAllowsRestart(entry)) {
      log(`[pool] Worker ${workerId} restart blocked — circuit is open`);
      return false;
    }

    // Check max restarts
    if (entry.consecutiveFailures > maxRestarts) {
      log(`[pool] Worker ${workerId} restart blocked — exceeded max restarts (${maxRestarts})`);
      return false;
    }

    const config = { ...entry.config };
    const restartCount = (entry.restartCount || 0) + 1;
    const failures = entry.consecutiveFailures;
    const circuitState = entry.circuitState;
    const circuitOpenedAt = entry.circuitOpenedAt;

    const onRespawn = () => {
      spawn(workerId, config);
      const w = workers.get(workerId);
      if (w) {
        w.restartCount = restartCount;
        // Carry forward circuit breaker state
        w.consecutiveFailures = failures;
        w.circuitState = circuitState;
        w.circuitOpenedAt = circuitOpenedAt;
      }
      events.emit('worker:restarted', { workerId, restartCount });
    };

    // If already stopped/dead, respawn immediately
    if (entry.status === 'stopped' || entry.status === 'error') {
      workers.delete(workerId);
      onRespawn();
    } else {
      // Kill existing and wait for exit
      kill(workerId);
      entry.process.once('exit', onRespawn);
    }

    return true;
  }

  /**
   * Send a message to a specific worker.
   * @param {string} workerId
   * @param {object} msg - IPC message
   * @returns {boolean} true if message was sent
   */
  function sendTo(workerId, msg) {
    const entry = workers.get(workerId);
    if (!entry || entry.status === 'stopped') return false;

    try {
      entry.process.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a handoff context file to a specific worker, triggering a start with that context.
   * @param {string} workerId
   * @param {string} handoffFile - Path to handoff context file
   * @returns {boolean} true if message was sent
   */
  function handoff(workerId, handoffFile) {
    const entry = workers.get(workerId);
    if (!entry || entry.status !== 'running') return false;
    return sendTo(workerId, { type: 'start', handoffFile });
  }

  /**
   * Get status of all workers.
   * @returns {Array<object>}
   */
  function getStatus() {
    return [...workers.values()].map(w => formatWorkerStatus(w));
  }

  /**
   * Get a single worker's status.
   * @param {string} workerId
   * @returns {object|null}
   */
  function getWorker(workerId) {
    const w = workers.get(workerId);
    if (!w) return null;
    return formatWorkerStatus(w);
  }

  function formatWorkerStatus(w) {
    return {
      id: w.id,
      pid: w.pid,
      status: w.status,
      config: w.config,
      startedAt: w.startedAt,
      stoppedAt: w.stoppedAt || null,
      lastHeartbeat: new Date(w.lastHeartbeat).toISOString(),
      lastActivity: new Date(w.lastActivity).toISOString(),
      restartCount: w.restartCount || 0,
      consecutiveFailures: w.consecutiveFailures || 0,
      circuitState: w.circuitState || 'closed',
      workerStatus: w.workerStatus,
      exitCode: w.exitCode ?? null,
    };
  }

  /**
   * Remove a stopped worker from the pool.
   * @param {string} workerId
   * @returns {boolean}
   */
  function remove(workerId) {
    const entry = workers.get(workerId);
    if (!entry) return false;
    if (entry.status === 'running' || entry.status === 'starting') {
      throw new Error(`Cannot remove worker ${workerId} while ${entry.status}`);
    }
    workers.delete(workerId);
    return true;
  }

  /**
   * Gracefully shut down all workers.
   * @returns {Promise<void>}
   */
  async function shutdownAll() {
    stopHeartbeatChecker();

    const ids = [...workers.keys()];
    if (ids.length === 0) return;

    // Send shutdown to all
    for (const id of ids) {
      kill(id);
    }

    // Wait for all to exit (with timeout)
    await Promise.all(ids.map(id => {
      const entry = workers.get(id);
      if (!entry || entry.status === 'stopped') return Promise.resolve();

      return new Promise(resolve => {
        const timer = setTimeout(() => {
          try {
            if (entry.process && !entry.process.killed) {
              entry.process.kill('SIGKILL');
            }
          } catch { /* already dead */ }
          resolve();
        }, FORCE_KILL_TIMEOUT_MS + 1000);
        timer.unref();

        entry.process.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }));
  }

  /**
   * Get count of active (running/starting) workers.
   * @returns {number}
   */
  function activeCount() {
    let count = 0;
    for (const w of workers.values()) {
      if (w.status === 'running' || w.status === 'starting') count++;
    }
    return count;
  }

  return {
    spawn,
    kill,
    restart: restartWorker,
    sendTo,
    handoff,
    getStatus,
    getWorker,
    remove,
    shutdownAll,
    activeCount,
  };
}

export {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  FORCE_KILL_TIMEOUT_MS,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_RESTART_BACKOFF_BASE_MS,
  MAX_RESTART_BACKOFF_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_CIRCUIT_BREAKER_COOLDOWN_MS,
};
