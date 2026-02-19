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
// Windows-safe: uses IPC messages for shutdown (not SIGTERM).
// ============================================================

import { fork } from 'child_process';
import { resolve, join } from 'path';

// ── Constants ───────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;  // Send heartbeat every 30s
const HEARTBEAT_TIMEOUT_MS = 90_000;   // 3 missed = dead (90s)
const FORCE_KILL_TIMEOUT_MS = 5_000;   // Force kill after 5s

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a process pool for managing orchestrator workers.
 * @param {object} ctx
 * @param {EventBus} ctx.events - Parent EventBus (IPC events re-emitted here)
 * @param {string} ctx.projectDir - Project root directory
 * @param {Function} [ctx.log] - Logger function
 * @returns {object} Pool methods
 */
export function createProcessPool(ctx) {
  const { events, projectDir } = ctx;
  const log = ctx.log || console.log;

  /** @type {Map<string, WorkerEntry>} */
  const workers = new Map();

  // Resolve worker entry point from this module's directory
  const workerScript = ctx.workerScript ||
    join(resolve(import.meta.dirname || '.'), 'orchestrator-worker.mjs');

  // ── Heartbeat Checker ───────────────────────────────────

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
        break;

      case 'ready':
        // Worker initialization complete
        if (entry) {
          entry.status = 'running';
          entry.lastHeartbeat = Date.now();
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

    const entry = {
      id: workerId,
      process: child,
      pid: child.pid,
      status: 'starting',
      config,
      startedAt: new Date().toISOString(),
      lastHeartbeat: Date.now(),
      workerStatus: null,
      restartCount: 0,
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

    // Exit handler
    child.on('exit', (code, signal) => {
      const e = workers.get(workerId);
      if (e) {
        e.status = 'stopped';
        e.exitCode = code;
        e.exitSignal = signal;
        e.stoppedAt = new Date().toISOString();
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
   * @param {string} workerId
   */
  function restartWorker(workerId) {
    const entry = workers.get(workerId);
    if (!entry) return;

    const config = { ...entry.config };
    const restartCount = (entry.restartCount || 0) + 1;

    // Kill existing
    kill(workerId);

    // Wait for exit then respawn
    const onExit = () => {
      const newEntry = spawn(workerId, config);
      const w = workers.get(workerId);
      if (w) w.restartCount = restartCount;
      events.emit('worker:restarted', { workerId, restartCount });
    };

    if (entry.process && !entry.process.killed) {
      entry.process.once('exit', onExit);
    } else {
      // Already dead, respawn immediately
      workers.delete(workerId);
      onExit();
    }
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
    return sendTo(workerId, { type: 'start', handoffFile });
  }

  /**
   * Get status of all workers.
   * @returns {Array<object>}
   */
  function getStatus() {
    return [...workers.values()].map(w => ({
      id: w.id,
      pid: w.pid,
      status: w.status,
      config: w.config,
      startedAt: w.startedAt,
      stoppedAt: w.stoppedAt || null,
      lastHeartbeat: new Date(w.lastHeartbeat).toISOString(),
      restartCount: w.restartCount || 0,
      workerStatus: w.workerStatus,
      exitCode: w.exitCode ?? null,
    }));
  }

  /**
   * Get a single worker's status.
   * @param {string} workerId
   * @returns {object|null}
   */
  function getWorker(workerId) {
    const w = workers.get(workerId);
    if (!w) return null;
    return {
      id: w.id,
      pid: w.pid,
      status: w.status,
      config: w.config,
      startedAt: w.startedAt,
      stoppedAt: w.stoppedAt || null,
      lastHeartbeat: new Date(w.lastHeartbeat).toISOString(),
      restartCount: w.restartCount || 0,
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

export { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, FORCE_KILL_TIMEOUT_MS };
