// ============================================================
// Claude Pool — Multi-Terminal Pool Manager
// ============================================================
// Manages multiple interactive Claude Code CLI terminal sessions.
// Each terminal is a PTY process (via claude-terminal.mjs) with
// full bidirectional I/O.
//
// Factory pattern: createClaudePool(ctx) returns pool methods.
// Events from terminals are re-emitted on the parent EventBus.
//
// Phase 15A: Pool management layer.
// Phase 15E: Auto-handoff on context exhaustion.
// ============================================================

import { createClaudeTerminal, isNodePtyAvailable, MIN_UPTIME_FOR_HANDOFF_MS } from './claude-terminal.mjs';

// ── Constants ───────────────────────────────────────────────

const MAX_TERMINALS = 8;
const FORCE_KILL_TIMEOUT_MS = 5000;
const AUTO_DISPATCH_DELAY_MS = 2000;
const IDLE_THRESHOLD_MS = 10000; // 10s of no output = idle
const COMPLETION_IDLE_THRESHOLD_MS = 30000; // 30s idle after activity = task complete
const MIN_ACTIVITY_BYTES = 100; // min output before auto-complete triggers

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a Claude terminal pool for managing multiple interactive sessions.
 *
 * @param {object} ctx
 * @param {EventBus} ctx.events - Parent EventBus (terminal events re-emitted here)
 * @param {string}   ctx.projectDir - Default project directory
 * @param {Function} [ctx.log] - Logger function
 * @param {number}   [ctx.maxTerminals] - Max concurrent terminals (default 8)
 * @param {object}   [ctx.sharedMemory] - Shared memory instance for cross-terminal state
 * @param {object}   [ctx.coordinator] - Coordinator instance for auto-dispatch task claiming
 * @returns {object} Pool methods
 */
export function createClaudePool(ctx) {
  const { events, projectDir } = ctx;
  const log = ctx.log || console.log;
  const maxTerminals = ctx.maxTerminals ?? MAX_TERMINALS;
  const sharedMemory = ctx.sharedMemory || null;
  const coordinator = ctx.coordinator || null;

  /** @type {Map<string, TerminalEntry>} */
  const terminals = new Map();

  // ── Spawn ─────────────────────────────────────────────

  /**
   * Spawn a new Claude terminal session.
   *
   * @param {string} terminalId - Unique terminal identifier
   * @param {object} [opts] - Terminal options
   * @param {string}   [opts.projectDir] - Override default project directory
   * @param {string}   [opts.model] - Model to use
   * @param {boolean}  [opts.dangerouslySkipPermissions] - Skip permissions
   * @param {string}   [opts.systemPrompt] - Append to system prompt
   * @param {string}   [opts.resumeSessionId] - Resume session ID
   * @param {boolean}  [opts.continueSession] - Continue last session
   * @param {number}   [opts.cols] - Terminal columns
   * @param {number}   [opts.rows] - Terminal rows
   * @returns {Promise<object>} Terminal info { id, pid, status }
   */
  async function spawn(terminalId, opts = {}) {
    // Validate
    if (terminals.has(terminalId)) {
      const existing = terminals.get(terminalId);
      if (existing.status === 'running') {
        throw new Error(`Terminal ${terminalId} is already running`);
      }
      // Clean up dead entry
      terminals.delete(terminalId);
    }

    if (activeCount() >= maxTerminals) {
      throw new Error(`Maximum terminals (${maxTerminals}) reached`);
    }

    // Check node-pty availability
    const available = await isNodePtyAvailable();
    if (!available) {
      throw new Error(
        'node-pty is not available. Install it with: npm install node-pty'
      );
    }

    // Create the terminal
    const terminal = await createClaudeTerminal({
      id: terminalId,
      projectDir: opts.projectDir || projectDir,
      model: opts.model,
      dangerouslySkipPermissions: opts.dangerouslySkipPermissions,
      systemPrompt: opts.systemPrompt,
      resumeSessionId: opts.resumeSessionId,
      continueSession: opts.continueSession,
      cols: opts.cols,
      rows: opts.rows,
      log,
    });

    // Create pool entry
    const now = new Date().toISOString();
    const entry = {
      id: terminalId,
      terminal,
      status: 'running',
      config: { ...opts },
      spawnedAt: now,
      stoppedAt: null,
      autoHandoff: !!opts.autoHandoff,
      autoDispatch: !!opts.autoDispatch,
      autoComplete: opts.autoComplete !== undefined ? !!opts.autoComplete : !!opts.autoDispatch,
      handoffCount: opts._handoffCount || 0,
      assignedTask: null,
      lastActivityAt: now,
      _completionTimer: null,
      _taskActivityBytes: 0,
    };

    terminals.set(terminalId, entry);

    // Wire terminal events to EventBus
    terminal.on('data', (data) => {
      entry.lastActivityAt = new Date().toISOString();
      events.emit('claude-terminal:data', {
        terminalId,
        data,
      });
    });

    terminal.on('exit', (exitCode, signal) => {
      entry.status = 'stopped';
      entry.stoppedAt = new Date().toISOString();

      events.emit('claude-terminal:exit', {
        terminalId,
        exitCode,
        signal,
      });

      // Auto-handoff: respawn with -c on clean exit
      maybeAutoHandoff(entry, exitCode);
    });

    terminal.on('error', (err) => {
      events.emit('claude-terminal:error', {
        terminalId,
        error: err.message || String(err),
      });
    });

    // Context pressure warning from terminal output scanning
    terminal.on('context-warning', (info) => {
      // Write snapshot to shared memory before potential handoff
      if (sharedMemory) {
        try {
          sharedMemory.writeSnapshot(terminalId, {
            lastOutput: terminal.getOutputBuffer(),
            model: opts.model || null,
            handoffCount: entry.handoffCount,
            reason: 'context-warning',
            pattern: info.pattern,
            metadata: entry.config.snapshotMetadata || null,
          });
        } catch (err) {
          log(`[claude-pool] ${terminalId} snapshot write failed: ${err.message}`);
        }
      }

      events.emit('claude-terminal:context-warning', {
        terminalId,
        pattern: info.pattern,
        handoffCount: entry.handoffCount,
        autoHandoff: entry.autoHandoff,
      });
    });

    events.emit('claude-terminal:spawned', {
      terminalId,
      pid: terminal.pid,
      config: opts,
    });

    return { id: terminalId, pid: terminal.pid, status: 'running' };
  }

  // ── Auto-Handoff ────────────────────────────────────────

  /**
   * Attempt auto-handoff when a terminal exits cleanly.
   * Respawns with -c (continue last session) if conditions are met.
   */
  function maybeAutoHandoff(entry, exitCode) {
    if (!entry.autoHandoff) return;
    if (exitCode !== 0) return;

    // Check minimum uptime to prevent rapid restart loops
    const uptime = Date.now() - new Date(entry.spawnedAt).getTime();
    if (uptime < MIN_UPTIME_FOR_HANDOFF_MS) {
      log(`[claude-pool] ${entry.id} exited too quickly (${uptime}ms) — skipping auto-handoff`);
      return;
    }

    const newCount = entry.handoffCount + 1;
    log(`[claude-pool] ${entry.id} auto-handoff #${newCount} — respawning with -c`);

    // Write snapshot before handoff (capture final state)
    if (sharedMemory) {
      try {
        sharedMemory.writeSnapshot(entry.id, {
          lastOutput: entry.terminal.getOutputBuffer(),
          model: entry.config.model || null,
          handoffCount: newCount,
          reason: 'handoff',
          metadata: entry.config.snapshotMetadata || null,
        });
      } catch (err) {
        log(`[claude-pool] ${entry.id} handoff snapshot write failed: ${err.message}`);
      }
    }

    // Respawn with continueSession=true, carrying forward config
    const hadAutoDispatch = entry.autoDispatch;
    const hadAutoComplete = entry.autoComplete;
    const config = {
      ...entry.config,
      continueSession: true,
      resumeSessionId: undefined, // -c takes precedence
      autoHandoff: true,
      autoDispatch: hadAutoDispatch,
      autoComplete: hadAutoComplete,
      _handoffCount: newCount,
    };

    // Remove old entry and spawn new (async, fire-and-forget)
    terminals.delete(entry.id);

    spawn(entry.id, config)
      .then(() => {
        events.emit('claude-terminal:handoff', {
          terminalId: entry.id,
          handoffCount: newCount,
        });
        // Auto-dispatch after handoff respawn (with delay for Claude to initialize)
        if (hadAutoDispatch) {
          setTimeout(() => maybeAutoDispatch(entry.id), AUTO_DISPATCH_DELAY_MS);
        }
      })
      .catch((err) => {
        log(`[claude-pool] ${entry.id} auto-handoff failed: ${err.message}`);
        events.emit('claude-terminal:error', {
          terminalId: entry.id,
          error: `Auto-handoff failed: ${err.message}`,
        });
      });
  }

  // ── Set Auto-Handoff ──────────────────────────────────

  /**
   * Enable or disable auto-handoff for a terminal.
   * @param {string} terminalId
   * @param {boolean} enabled
   * @returns {boolean} true if updated
   */
  function setAutoHandoff(terminalId, enabled) {
    const entry = terminals.get(terminalId);
    if (!entry) return false;
    entry.autoHandoff = !!enabled;
    entry.config.autoHandoff = !!enabled;
    return true;
  }

  // ── Set Auto-Dispatch ─────────────────────────────────

  /**
   * Enable or disable auto-dispatch for a terminal.
   * @param {string} terminalId
   * @param {boolean} enabled
   * @returns {boolean} true if updated
   */
  function setAutoDispatch(terminalId, enabled) {
    const entry = terminals.get(terminalId);
    if (!entry) return false;
    entry.autoDispatch = !!enabled;
    entry.config.autoDispatch = !!enabled;
    return true;
  }

  // ── Task Claiming Utility ─────────────────────────────

  /**
   * Find the next claimable task from the task queue.
   * Returns the highest-priority pending task whose deps are all complete.
   * @returns {object|null} claimable task or null
   */
  function findNextClaimableTask() {
    if (!coordinator) return null;
    const taskQueue = coordinator.taskQueue;
    if (!taskQueue) return null;

    const allTasks = taskQueue.getAll();
    const pending = allTasks.filter(t => t.status === 'pending');

    // Sort by priority descending (higher priority first)
    pending.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const task of pending) {
      if (!task.deps || task.deps.length === 0) return task;
      const depsComplete = task.deps.every(depId => {
        const dep = allTasks.find(t => t.id === depId);
        return dep && dep.status === 'complete';
      });
      if (depsComplete) return task;
    }
    return null;
  }

  // ── Auto-Dispatch ──────────────────────────────────────

  /**
   * Attempt to auto-claim the next ready task and inject it into the terminal.
   * Called after task completion or handoff respawn when autoDispatch is enabled.
   * @param {string} terminalId
   */
  function maybeAutoDispatch(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry) return;
    if (!entry.autoDispatch) return;
    if (!coordinator) return;

    // Skip if terminal already has a task
    if (entry.assignedTask) return;

    // Skip if terminal is not running
    if (entry.status !== 'running') return;

    const claimable = findNextClaimableTask();
    if (!claimable) return;

    const taskQueue = coordinator.taskQueue;
    try {
      // Assign in task queue
      taskQueue.assign(claimable.id, terminalId);
      taskQueue.start(claimable.id);

      // Track in pool
      assignTask(terminalId, claimable);

      // Write the task prompt to PTY
      const prompt = `[AUTO-DISPATCH] Task ${claimable.id}: ${claimable.task}`;
      write(terminalId, prompt + '\r');

      log(`[claude-pool] ${terminalId} auto-dispatched task ${claimable.id}`);

      events.emit('claude-terminal:auto-dispatch', {
        terminalId,
        taskId: claimable.id,
        task: claimable.task,
      });
    } catch (err) {
      log(`[claude-pool] ${terminalId} auto-dispatch failed: ${err.message}`);
    }
  }

  // Listen for task completion to auto-dispatch next task
  events.on('claude-terminal:task-completed', (data) => {
    if (data.status === 'complete') {
      const entry = terminals.get(data.terminalId);
      if (entry && entry.autoDispatch) {
        setTimeout(() => maybeAutoDispatch(data.terminalId), AUTO_DISPATCH_DELAY_MS);
      }
    }
  });

  // ── Auto-Complete Detection ───────────────────────────

  /**
   * Reset the completion idle timer for a terminal.
   * Called on each PTY data event when terminal has an active task.
   * @param {string} terminalId
   */
  function resetCompletionTimer(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry) return;

    // Clear existing timer
    if (entry._completionTimer) {
      clearTimeout(entry._completionTimer);
      entry._completionTimer = null;
    }

    // Start new idle timer
    entry._completionTimer = setTimeout(() => {
      entry._completionTimer = null;
      maybeAutoComplete(terminalId);
    }, COMPLETION_IDLE_THRESHOLD_MS);
  }

  /**
   * Stop completion watching for a terminal (clear timer + reset bytes).
   * @param {string} terminalId
   */
  function stopCompletionWatch(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry) return;
    if (entry._completionTimer) {
      clearTimeout(entry._completionTimer);
      entry._completionTimer = null;
    }
    entry._taskActivityBytes = 0;
  }

  /**
   * Auto-complete a task after sustained idle following meaningful activity.
   * @param {string} terminalId
   */
  function maybeAutoComplete(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry) return;
    if (!entry.autoComplete) return;
    if (!entry.assignedTask) return;
    if (entry.status !== 'running') return;

    // Require minimum activity to avoid false positives
    if (entry._taskActivityBytes < MIN_ACTIVITY_BYTES) return;

    const taskId = entry.assignedTask.taskId;
    const taskDesc = entry.assignedTask.task;
    const result = entry.terminal.getOutputBuffer();

    log(`[claude-pool] ${terminalId} auto-completing task ${taskId} (${entry._taskActivityBytes} bytes activity, ${COMPLETION_IDLE_THRESHOLD_MS}ms idle)`);

    try {
      // Update coordination queue if available
      if (coordinator && coordinator.taskQueue) {
        coordinator.taskQueue.complete(taskId, result);
      }

      // Release from pool (emits task-released)
      releaseTask(terminalId);

      // Reset completion state
      entry._taskActivityBytes = 0;

      // Emit task-completed (triggers auto-dispatch)
      events.emit('claude-terminal:task-completed', {
        terminalId,
        taskId,
        status: 'complete',
        result,
        autoCompleted: true,
      });

      // Emit auto-complete event for UI
      events.emit('claude-terminal:auto-complete', {
        terminalId,
        taskId,
        task: taskDesc,
      });
    } catch (err) {
      log(`[claude-pool] ${terminalId} auto-complete failed: ${err.message}`);
    }
  }

  /**
   * Enable or disable auto-complete for a terminal.
   * @param {string} terminalId
   * @param {boolean} enabled
   * @returns {boolean} true if updated
   */
  function setAutoComplete(terminalId, enabled) {
    const entry = terminals.get(terminalId);
    if (!entry) return false;
    entry.autoComplete = !!enabled;
    entry.config.autoComplete = !!enabled;
    if (!enabled) {
      stopCompletionWatch(terminalId);
    }
    return true;
  }

  // Track PTY activity for completion detection
  events.on('claude-terminal:data', (data) => {
    const entry = terminals.get(data.terminalId);
    if (!entry || !entry.autoComplete || !entry.assignedTask) return;
    if (entry.status !== 'running') return;

    // Accumulate activity bytes
    entry._taskActivityBytes += (data.data ? data.data.length : 0);

    // Reset idle timer (starts/restarts on each data event)
    resetCompletionTimer(data.terminalId);
  });

  // Stop completion watch when task is released manually
  events.on('claude-terminal:task-released', (data) => {
    stopCompletionWatch(data.terminalId);
  });

  // Stop completion watch when terminal exits
  events.on('claude-terminal:exit', (data) => {
    stopCompletionWatch(data.terminalId);
  });

  // ── Write ─────────────────────────────────────────────

  /**
   * Write data to a terminal's PTY (user input).
   * @param {string} terminalId
   * @param {string} data
   * @returns {boolean} true if data was written
   */
  function write(terminalId, data) {
    const entry = terminals.get(terminalId);
    if (!entry || entry.status !== 'running') return false;
    entry.terminal.write(data);
    return true;
  }

  // ── Resize ────────────────────────────────────────────

  /**
   * Resize a terminal's PTY.
   * @param {string} terminalId
   * @param {number} cols
   * @param {number} rows
   * @returns {boolean} true if resized
   */
  function resize(terminalId, cols, rows) {
    const entry = terminals.get(terminalId);
    if (!entry || entry.status !== 'running') return false;
    entry.terminal.resize(cols, rows);
    return true;
  }

  // ── Kill ──────────────────────────────────────────────

  /**
   * Kill a terminal's PTY process.
   * @param {string} terminalId
   * @returns {boolean} true if kill was initiated
   */
  function kill(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry || entry.status !== 'running') return false;
    entry.terminal.kill();
    return true;
  }

  // ── Remove ────────────────────────────────────────────

  /**
   * Remove a stopped terminal from the pool.
   * @param {string} terminalId
   * @returns {boolean} true if removed
   */
  function remove(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry) return false;
    if (entry.status === 'running') {
      throw new Error(`Cannot remove terminal ${terminalId} while running`);
    }
    terminals.delete(terminalId);
    events.emit('claude-terminal:removed', { terminalId });
    return true;
  }

  // ── Respawn ───────────────────────────────────────────

  /**
   * Kill and respawn a terminal with the same or updated config.
   * @param {string} terminalId
   * @param {object} [newOpts] - Override spawn options
   * @returns {Promise<object>} New terminal info
   */
  async function respawn(terminalId, newOpts = {}) {
    const entry = terminals.get(terminalId);
    if (!entry) throw new Error(`Terminal ${terminalId} not found`);

    const config = { ...entry.config, ...newOpts };

    // Kill if running
    if (entry.status === 'running') {
      entry.terminal.kill();

      // Wait for exit (with timeout)
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, FORCE_KILL_TIMEOUT_MS);
        timer.unref();
        entry.terminal.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    // Remove old entry
    terminals.delete(terminalId);

    // Spawn new
    return spawn(terminalId, config);
  }

  // ── Status ────────────────────────────────────────────

  /**
   * Get status of all terminals.
   * @returns {Array<object>}
   */
  function getStatus() {
    return [...terminals.values()].map(formatEntry);
  }

  /**
   * Get a single terminal's status.
   * @param {string} terminalId
   * @returns {object|null}
   */
  function getTerminal(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry) return null;
    return formatEntry(entry);
  }

  /**
   * Get the raw terminal object (for binary WS wiring).
   * @param {string} terminalId
   * @returns {object|null}
   */
  function getTerminalHandle(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry) return null;
    return entry.terminal;
  }

  /**
   * Get count of active (running) terminals.
   * @returns {number}
   */
  function activeCount() {
    let count = 0;
    for (const entry of terminals.values()) {
      if (entry.status === 'running') count++;
    }
    return count;
  }

  // ── Shutdown ──────────────────────────────────────────

  /**
   * Kill all running terminals.
   * @returns {Promise<void>}
   */
  async function shutdownAll() {
    const ids = [...terminals.keys()];
    if (ids.length === 0) return;

    // Kill all running terminals
    for (const id of ids) {
      const entry = terminals.get(id);
      if (entry && entry.status === 'running') {
        try { entry.terminal.kill(); } catch { /* already dead */ }
      }
    }

    // Wait for all to exit (with timeout)
    await Promise.all(ids.map(id => {
      const entry = terminals.get(id);
      if (!entry || entry.status === 'stopped') return Promise.resolve();

      return new Promise(resolve => {
        const timer = setTimeout(resolve, FORCE_KILL_TIMEOUT_MS + 1000);
        timer.unref();
        entry.terminal.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }));
  }

  // ── Helpers ───────────────────────────────────────────

  // ── Task Assignment (Phase 19) ───────────────────────

  /**
   * Assign a task to a terminal.
   * @param {string} terminalId
   * @param {object} task - { id, task, category, priority, metadata }
   * @returns {boolean}
   */
  function assignTask(terminalId, task) {
    const entry = terminals.get(terminalId);
    if (!entry) return false;
    entry.assignedTask = {
      taskId: task.id,
      task: task.task,
      category: task.category || null,
      priority: task.priority || 5,
      metadata: task.metadata || null,
      assignedAt: new Date().toISOString(),
    };
    events.emit('claude-terminal:task-assigned', {
      terminalId,
      taskId: task.id,
      task: task.task,
      category: task.category || null,
    });
    return true;
  }

  /**
   * Release a terminal's assigned task (without completing it).
   * @param {string} terminalId
   * @returns {object|null} The released task info, or null
   */
  function releaseTask(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry || !entry.assignedTask) return null;
    const released = entry.assignedTask;
    entry.assignedTask = null;
    events.emit('claude-terminal:task-released', {
      terminalId,
      taskId: released.taskId,
    });
    return released;
  }

  /**
   * Get the assigned task for a terminal.
   * @param {string} terminalId
   * @returns {object|null}
   */
  function getAssignedTask(terminalId) {
    const entry = terminals.get(terminalId);
    if (!entry) return null;
    return entry.assignedTask || null;
  }

  /**
   * Compute activity state for a terminal entry.
   * @param {object} entry
   * @returns {'active'|'idle'|'waiting'|'stopped'}
   */
  function getActivityState(entry) {
    if (entry.status !== 'running') return 'stopped';
    const idleMs = Date.now() - new Date(entry.lastActivityAt).getTime();
    if (idleMs < IDLE_THRESHOLD_MS) return 'active';
    return entry.assignedTask ? 'waiting' : 'idle';
  }

  function formatEntry(entry) {
    const termStatus = entry.terminal.getStatus();
    return {
      id: entry.id,
      pid: termStatus.pid,
      status: entry.status,
      config: entry.config,
      projectDir: termStatus.projectDir,
      model: termStatus.model,
      dangerouslySkipPermissions: termStatus.dangerouslySkipPermissions,
      autoHandoff: entry.autoHandoff,
      autoDispatch: entry.autoDispatch,
      autoComplete: entry.autoComplete,
      handoffCount: entry.handoffCount,
      cols: termStatus.cols,
      rows: termStatus.rows,
      spawnedAt: entry.spawnedAt,
      stoppedAt: entry.stoppedAt,
      exitCode: termStatus.exitCode,
      exitSignal: termStatus.exitSignal,
      assignedTask: entry.assignedTask || null,
      lastActivityAt: entry.lastActivityAt,
      activityState: getActivityState(entry),
    };
  }

  /**
   * Get aggregate pool status summary.
   * @returns {object} { total, running, stopped, active, idle, waiting, withTask, withAutoDispatch }
   */
  function getPoolStatus() {
    let running = 0, stopped = 0, active = 0, idle = 0, waiting = 0, withTask = 0, withAutoDispatch = 0, withAutoComplete = 0;
    for (const entry of terminals.values()) {
      if (entry.status === 'running') running++;
      else stopped++;
      const state = getActivityState(entry);
      if (state === 'active') active++;
      else if (state === 'idle') idle++;
      else if (state === 'waiting') waiting++;
      if (entry.assignedTask) withTask++;
      if (entry.autoDispatch) withAutoDispatch++;
      if (entry.autoComplete) withAutoComplete++;
    }
    return {
      total: terminals.size,
      running,
      stopped,
      active,
      idle,
      waiting,
      withTask,
      withAutoDispatch,
      withAutoComplete,
      maxTerminals,
    };
  }

  return {
    spawn,
    write,
    resize,
    kill,
    remove,
    respawn,
    setAutoHandoff,
    setAutoDispatch,
    setAutoComplete,
    assignTask,
    releaseTask,
    getAssignedTask,
    getStatus,
    getTerminal,
    getTerminalHandle,
    activeCount,
    getPoolStatus,
    findNextClaimableTask,
    shutdownAll,
  };
}

export { MAX_TERMINALS, FORCE_KILL_TIMEOUT_MS, AUTO_DISPATCH_DELAY_MS, IDLE_THRESHOLD_MS, COMPLETION_IDLE_THRESHOLD_MS, MIN_ACTIVITY_BYTES };
