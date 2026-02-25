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
 * @returns {object} Pool methods
 */
export function createClaudePool(ctx) {
  const { events, projectDir } = ctx;
  const log = ctx.log || console.log;
  const maxTerminals = ctx.maxTerminals ?? MAX_TERMINALS;
  const sharedMemory = ctx.sharedMemory || null;

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
    const entry = {
      id: terminalId,
      terminal,
      status: 'running',
      config: { ...opts },
      spawnedAt: new Date().toISOString(),
      stoppedAt: null,
      autoHandoff: !!opts.autoHandoff,
      handoffCount: opts._handoffCount || 0,
    };

    terminals.set(terminalId, entry);

    // Wire terminal events to EventBus
    terminal.on('data', (data) => {
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
    const config = {
      ...entry.config,
      continueSession: true,
      resumeSessionId: undefined, // -c takes precedence
      autoHandoff: true,
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
      handoffCount: entry.handoffCount,
      cols: termStatus.cols,
      rows: termStatus.rows,
      spawnedAt: entry.spawnedAt,
      stoppedAt: entry.stoppedAt,
      exitCode: termStatus.exitCode,
      exitSignal: termStatus.exitSignal,
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
    getStatus,
    getTerminal,
    getTerminalHandle,
    activeCount,
    shutdownAll,
  };
}

export { MAX_TERMINALS, FORCE_KILL_TIMEOUT_MS };
