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

import { createClaudeTerminal, isNodePtyAvailable, MIN_UPTIME_FOR_HANDOFF_MS, stripAnsi } from './claude-terminal.mjs';
import { execSync } from 'child_process';

// ── Constants ───────────────────────────────────────────────

const MAX_TERMINALS = 8;
const FORCE_KILL_TIMEOUT_MS = 5000;
const AUTO_DISPATCH_DELAY_MS = 2000;
const IDLE_THRESHOLD_MS = 10000; // 10s of no output = idle
const COMPLETION_IDLE_THRESHOLD_MS = 30000; // 30s idle after activity = task complete
const MIN_ACTIVITY_BYTES = 100; // min output before auto-complete triggers
const SWARM_SCALE_CHECK_MS = 5000;       // scale-up check interval
const SWARM_SCALE_DOWN_IDLE_MS = 60000;  // kill idle swarm terminal after 60s
const SWARM_ID_PREFIX = 'swarm-';
const SWARM_MAX_CRASH_RETRIES = 3;       // max respawn attempts per crashed terminal
const MAX_TASK_HISTORY = 5;              // max categories tracked per terminal
const AFFINITY_CATEGORY_BONUS = 2;       // bonus for matching any history category
const AFFINITY_RECENT_BONUS = 1;         // extra bonus for matching most recent category

// ── Context Refresh Constants ────────────────────────────
const CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS = 60000;  // 60s to wait for handoff
const CONTEXT_REFRESH_GIT_TIMEOUT_MS = 15000;      // 15s for git operations
const CONTEXT_REFRESH_SPAWN_DELAY_MS = 3000;       // delay before fresh spawn
const MAX_CONTEXT_REFRESHES = 10;                   // prevent infinite loops

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

  // ── Effective max (raised by swarm mode) ─────────────
  let _effectiveMaxTerminals = maxTerminals;

  // ── Swarm State ──────────────────────────────────────
  let swarmState = {
    enabled: false,
    minTerminals: 1,
    maxTerminals: 16,
    projectDir: ctx.projectDir,
    model: 'sonnet',
    dangerouslySkipPermissions: true,
    systemPrompt: null,
    scaleUpThreshold: 2,
    _scaleTimer: null,
    _counter: 0,
    _tickCount: 0,
    _crashCounts: new Map(),
    _metrics: {
      startedAt: null,
      tasksCompleted: 0,
      tasksFailed: 0,
      tasksRecovered: 0,
      totalSpawns: 0,
      totalCrashes: 0,
      scaleUps: 0,
      scaleDowns: 0,
    },
  };

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

    if (activeCount() >= _effectiveMaxTerminals) {
      throw new Error(`Maximum terminals (${_effectiveMaxTerminals}) reached`);
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

    // Master terminal uniqueness guard (Phase 57)
    if (opts.role === 'master') {
      for (const [existingId, existing] of terminals) {
        if (existing.role === 'master') {
          if (existing.status === 'running') {
            throw new Error('Master terminal already exists');
          }
          // Clean up stopped/stale master entries so the new one can take the ID
          terminals.delete(existingId);
        }
      }
    }

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
      swarmManaged: !!opts._swarmManaged,
      capabilities: opts.capabilities || null,
      role: opts.role || null,
      persistent: !!opts.persistent,
      contextRefreshCount: opts._contextRefreshCount || 0,
      _contextRefreshState: null,   // null | 'requesting-handoff' | 'committing' | 'restarting'
      _contextRefreshOutputCapture: '',
      _contextRefreshTimer: null,
      _taskHistory: [],
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

      // Crash recovery: release task back to pending on non-zero exit
      maybeRecoverTask(entry, exitCode);

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

      // Trigger context-refresh instead of waiting for compaction
      if (entry.autoHandoff) {
        maybeContextRefresh(entry);
      }
    });

    events.emit('claude-terminal:spawned', {
      terminalId,
      pid: terminal.pid,
      config: opts,
    });

    return { id: terminalId, pid: terminal.pid, status: 'running' };
  }

  // ── Crash Recovery ─────────────────────────────────────

  /**
   * Recover a task when a terminal crashes (non-zero exit).
   * Releases the task back to pending in the coordinator queue.
   * @param {object} entry - Pool entry
   * @param {number} exitCode - Exit code (non-zero = crash)
   */
  function maybeRecoverTask(entry, exitCode) {
    if (exitCode === 0) return;
    if (!entry.assignedTask) return;
    if (!coordinator || !coordinator.taskQueue) return;

    const taskId = entry.assignedTask.taskId;
    log(`[claude-pool] ${entry.id} crashed with task ${taskId} — releasing back to pending`);

    try {
      coordinator.taskQueue.fail(taskId, `Terminal ${entry.id} crashed (exit code ${exitCode})`);
      coordinator.taskQueue.retry(taskId);
    } catch { /* task may already be in terminal state */ }

    entry.assignedTask = null;
    swarmState._metrics.tasksRecovered++;
    swarmState._metrics.totalCrashes++;

    events.emit('claude-terminal:task-recovered', {
      terminalId: entry.id,
      taskId,
      exitCode,
    });
  }

  // ── Auto-Handoff ────────────────────────────────────────

  /**
   * Attempt auto-handoff when a terminal exits cleanly.
   * Respawns with fresh context (no -c flag), injecting handoff via --append-system-prompt.
   */
  function maybeAutoHandoff(entry, exitCode) {
    if (!entry.autoHandoff) return;
    if (exitCode !== 0) return;

    // Skip if context-refresh is handling this terminal
    if (entry._contextRefreshState) return;

    // Check minimum uptime to prevent rapid restart loops
    const uptime = Date.now() - new Date(entry.spawnedAt).getTime();
    if (uptime < MIN_UPTIME_FOR_HANDOFF_MS) {
      log(`[claude-pool] ${entry.id} exited too quickly (${uptime}ms) — skipping auto-handoff`);
      return;
    }

    const newCount = entry.handoffCount + 1;
    log(`[claude-pool] ${entry.id} auto-handoff #${newCount} — fresh restart`);

    // Parse handoff from output buffer or use tail as context
    const buf = entry.terminal.getOutputBuffer();
    const stripped = stripAnsi(buf);
    const handoff = parseHandoffFromOutput(stripped) || stripped.slice(-2000).trim() || '(no output captured)';

    // Write snapshot before handoff (capture final state)
    if (sharedMemory) {
      try {
        sharedMemory.writeSnapshot(entry.id, {
          lastOutput: buf,
          model: entry.config.model || null,
          handoffCount: newCount,
          reason: 'handoff',
          handoff,
          metadata: entry.config.snapshotMetadata || null,
        });
      } catch (err) {
        log(`[claude-pool] ${entry.id} handoff snapshot write failed: ${err.message}`);
      }
    }

    // Respawn with fresh context — NO continueSession
    const hadAutoDispatch = entry.autoDispatch;
    const hadAutoComplete = entry.autoComplete;
    const savedTask = entry.assignedTask;
    const config = {
      ...entry.config,
      continueSession: false,
      resumeSessionId: undefined,
      systemPrompt: buildContextRefreshPrompt(handoff, entry),
      autoHandoff: true,
      autoDispatch: hadAutoDispatch,
      autoComplete: hadAutoComplete,
      _handoffCount: newCount,
      _contextRefreshCount: entry.contextRefreshCount,
    };

    // Remove old entry and spawn new (async, fire-and-forget)
    terminals.delete(entry.id);

    spawn(entry.id, config)
      .then(() => {
        // Restore carried task on new entry
        if (savedTask && coordinator) {
          const newEntry = terminals.get(entry.id);
          if (newEntry) {
            newEntry.assignedTask = savedTask;
            newEntry._taskActivityBytes = 0;
            // Re-inject task context after Claude initializes
            setTimeout(() => {
              write(entry.id, `[CONTEXT-RESUMED] Continuing task ${savedTask.taskId}: ${savedTask.task}\r`);
              if (newEntry.autoComplete) resetCompletionTimer(entry.id);
            }, AUTO_DISPATCH_DELAY_MS);
          }
        }

        events.emit('claude-terminal:handoff', {
          terminalId: entry.id,
          handoffCount: newCount,
          freshRestart: true,
        });
        // Auto-dispatch after handoff respawn (with delay for Claude to initialize)
        // Skip if task was carried over from the previous session
        if (hadAutoDispatch && !savedTask) {
          setTimeout(() => maybeAutoDispatch(entry.id), AUTO_DISPATCH_DELAY_MS);
        }
      })
      .catch((err) => {
        log(`[claude-pool] ${entry.id} auto-handoff failed: ${err.message}`);
        // If we had a saved task and handoff failed, release it back to pending
        if (savedTask && coordinator && coordinator.taskQueue) {
          try {
            coordinator.taskQueue.fail(savedTask.taskId, 'Handoff respawn failed');
            coordinator.taskQueue.retry(savedTask.taskId);
          } catch { /* task may already be in terminal state */ }
        }
        events.emit('claude-terminal:error', {
          terminalId: entry.id,
          error: `Auto-handoff failed: ${err.message}`,
        });
      });
  }

  // ── Context Refresh ─────────────────────────────────────

  /**
   * Parse a structured handoff from terminal output text.
   * Looks for a ## HANDOFF section (markdown heading).
   * @param {string} text - ANSI-stripped terminal output
   * @returns {string|null} Parsed handoff text, or null if not found
   */
  function parseHandoffFromOutput(text) {
    // Find the ## HANDOFF heading line
    const headingIdx = text.search(/^##\s+HANDOFF\b/mi);
    if (headingIdx === -1) return null;

    // Skip the heading line itself
    const afterHeading = text.slice(headingIdx);
    const lines = afterHeading.split('\n');
    const content = [];
    for (let i = 1; i < lines.length; i++) {
      // Stop at next heading or horizontal rule
      if (/^##\s/.test(lines[i]) || /^━/.test(lines[i])) break;
      content.push(lines[i]);
    }
    const handoff = content.join('\n').trim();
    return handoff.length > 50 ? handoff : null; // require meaningful content
  }

  /**
   * Generate a synthetic handoff from output buffer when Claude doesn't produce one.
   * @param {object} entry - Pool entry
   * @returns {string} Synthetic handoff text
   */
  function generateSyntheticContextHandoff(entry) {
    const buf = entry.terminal.getOutputBuffer();
    const stripped = stripAnsi(buf);
    // Take last ~2000 chars of output as context
    const tail = stripped.slice(-2000).trim();
    const taskInfo = entry.assignedTask
      ? `Task: ${entry.assignedTask.taskId} — ${entry.assignedTask.task}`
      : 'No specific task assigned';
    return [
      '## HANDOFF (auto-generated)',
      '',
      `Terminal: ${entry.id}`,
      taskInfo,
      `Context refresh #${entry.contextRefreshCount + 1}`,
      '',
      '### Recent Output (tail)',
      '```',
      tail || '(no output captured)',
      '```',
    ].join('\n');
  }

  /**
   * Build the system prompt for a context-refreshed terminal.
   * @param {string} handoff - Handoff text
   * @param {object} entry - Pool entry (old)
   * @returns {string} System prompt text
   */
  function buildContextRefreshPrompt(handoff, entry) {
    const parts = [
      '[CONTEXT-REFRESH] This terminal was restarted with a fresh context window.',
      `This is context refresh #${entry.contextRefreshCount + 1} for terminal ${entry.id}.`,
      '',
      'The previous session generated the following handoff:',
      '',
      handoff,
      '',
      'Continue working from where the previous session left off.',
      'Do NOT repeat work that was already completed.',
    ];
    if (entry.assignedTask) {
      parts.push('', `Active task: ${entry.assignedTask.taskId} — ${entry.assignedTask.task}`);
    }
    return parts.join('\n');
  }

  /**
   * Execute git commit + push for a context refresh.
   * Non-blocking — failures are logged but don't block the refresh.
   * @param {object} entry - Pool entry
   * @param {string} handoff - Handoff summary (first line used in commit msg)
   */
  function gitCommitForRefresh(entry, handoff) {
    const summary = (handoff.split('\n').find(l => l.trim() && !l.startsWith('#')) || 'context refresh').slice(0, 60);
    const count = entry.contextRefreshCount + 1;
    const msg = `context-refresh: ${entry.id} #${count} — ${summary}`;

    try {
      execSync('git add -A', {
        cwd: entry.config.projectDir || projectDir,
        timeout: CONTEXT_REFRESH_GIT_TIMEOUT_MS,
        stdio: 'ignore',
      });
      execSync(`git diff --cached --quiet`, {
        cwd: entry.config.projectDir || projectDir,
        timeout: 5000,
        stdio: 'ignore',
      });
      // If git diff --cached --quiet exits 0, there's nothing staged — skip commit
      log(`[claude-pool] ${entry.id} context-refresh: no changes to commit`);
    } catch {
      // Non-zero exit from git diff --cached --quiet means there ARE staged changes
      try {
        execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, {
          cwd: entry.config.projectDir || projectDir,
          timeout: CONTEXT_REFRESH_GIT_TIMEOUT_MS,
          stdio: 'ignore',
        });
        log(`[claude-pool] ${entry.id} context-refresh: committed`);
      } catch (err) {
        log(`[claude-pool] ${entry.id} context-refresh commit failed: ${err.message}`);
      }
    }

    try {
      execSync('git push', {
        cwd: entry.config.projectDir || projectDir,
        timeout: CONTEXT_REFRESH_GIT_TIMEOUT_MS,
        stdio: 'ignore',
      });
    } catch (err) {
      log(`[claude-pool] ${entry.id} context-refresh push failed: ${err.message}`);
    }
  }

  /**
   * Initiate a context refresh: request handoff from Claude, then restart fresh.
   * Guards against re-entry, max refreshes, and minimum uptime.
   * @param {object} entry - Pool entry
   */
  function maybeContextRefresh(entry) {
    // Guard: already in progress
    if (entry._contextRefreshState) return;

    // Guard: max refreshes reached — fall back to natural compaction
    if (entry.contextRefreshCount >= MAX_CONTEXT_REFRESHES) {
      log(`[claude-pool] ${entry.id} max context refreshes (${MAX_CONTEXT_REFRESHES}) reached — allowing compaction`);
      return;
    }

    // Note: no MIN_UPTIME guard here — context pressure detection already implies
    // significant runtime. The uptime guard is only needed in maybeAutoHandoff
    // (prevents rapid restart loops on immediate exit).

    entry._contextRefreshState = 'requesting-handoff';
    entry._contextRefreshOutputCapture = '';
    log(`[claude-pool] ${entry.id} context-refresh started (refresh #${entry.contextRefreshCount + 1})`);

    events.emit('claude-terminal:context-refresh-started', {
      terminalId: entry.id,
      refreshCount: entry.contextRefreshCount + 1,
    });

    // Write handoff-generation prompt to PTY
    const handoffPrompt = [
      '\n/clear\n',
      'IMPORTANT: Your context window is nearly full. Generate a handoff document NOW.',
      'Write a section starting with exactly "## HANDOFF" on its own line.',
      'Include: (1) what was accomplished, (2) what is in progress, (3) what to do next,',
      '(4) any important file paths or decisions, (5) current errors or blockers.',
      'Be thorough but concise. This handoff will be injected into a fresh session.\r',
    ].join('\n');
    try {
      entry.terminal.write(handoffPrompt);
    } catch {
      // Terminal may already be dead
      _finishContextRefresh(entry, null);
      return;
    }

    // Listen for output to capture handoff
    const dataHandler = (evtData) => {
      if (evtData.terminalId !== entry.id) return;
      if (entry._contextRefreshState !== 'requesting-handoff') return;
      const chunk = typeof evtData.data === 'string' ? evtData.data : '';
      entry._contextRefreshOutputCapture += stripAnsi(chunk);

      // Check if handoff is present
      const handoff = parseHandoffFromOutput(entry._contextRefreshOutputCapture);
      if (handoff) {
        events.off('claude-terminal:data', dataHandler);
        events.off('claude-terminal:exit', exitHandler);
        if (entry._contextRefreshTimer) {
          clearTimeout(entry._contextRefreshTimer);
          entry._contextRefreshTimer = null;
        }
        _finishContextRefresh(entry, handoff);
      }
    };
    events.on('claude-terminal:data', dataHandler);

    // Handle terminal exit during handoff request
    const exitHandler = (evtData) => {
      if (evtData.terminalId !== entry.id) return;
      events.off('claude-terminal:data', dataHandler);
      events.off('claude-terminal:exit', exitHandler);
      if (entry._contextRefreshTimer) {
        clearTimeout(entry._contextRefreshTimer);
        entry._contextRefreshTimer = null;
      }
      // Use whatever was captured
      const handoff = parseHandoffFromOutput(entry._contextRefreshOutputCapture);
      _finishContextRefresh(entry, handoff);
    };
    events.on('claude-terminal:exit', exitHandler);

    // Timeout: use synthetic handoff after CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS
    entry._contextRefreshTimer = setTimeout(() => {
      entry._contextRefreshTimer = null;
      events.off('claude-terminal:data', dataHandler);
      events.off('claude-terminal:exit', exitHandler);
      log(`[claude-pool] ${entry.id} handoff timeout — using synthetic handoff`);
      _finishContextRefresh(entry, null);
    }, CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS);
  }

  /**
   * Complete the context refresh: git commit, kill terminal, spawn fresh.
   * @param {object} entry - Pool entry
   * @param {string|null} handoff - Parsed handoff text, or null for synthetic
   */
  function _finishContextRefresh(entry, handoff) {
    // Guard: prevent double-call (e.g., exit fires after data handler already completed)
    if (entry._contextRefreshState === 'committing' || entry._contextRefreshState === 'restarting') return;

    const finalHandoff = handoff || generateSyntheticContextHandoff(entry);
    entry._contextRefreshState = 'committing';

    // Git commit + push (fire-and-forget, don't block on failure)
    try {
      gitCommitForRefresh(entry, finalHandoff);
    } catch (err) {
      log(`[claude-pool] ${entry.id} context-refresh git failed: ${err.message}`);
    }

    // Write handoff to shared memory
    if (sharedMemory) {
      try {
        sharedMemory.writeSnapshot(entry.id, {
          lastOutput: entry.terminal.getOutputBuffer(),
          model: entry.config.model || null,
          handoffCount: entry.handoffCount,
          contextRefreshCount: entry.contextRefreshCount + 1,
          reason: 'context-refresh',
          handoff: finalHandoff,
          metadata: entry.config.snapshotMetadata || null,
        });
        sharedMemory.set(`context-refresh:${entry.id}:handoff`, finalHandoff);
      } catch (err) {
        log(`[claude-pool] ${entry.id} context-refresh snapshot write failed: ${err.message}`);
      }
    }

    entry._contextRefreshState = 'restarting';

    // Preserve state for respawn
    const savedTask = entry.assignedTask;
    const hadAutoDispatch = entry.autoDispatch;
    const hadAutoComplete = entry.autoComplete;
    const newRefreshCount = entry.contextRefreshCount + 1;
    const newHandoffCount = entry.handoffCount + 1;

    // Build fresh config — NO continueSession, NO resumeSessionId
    const config = {
      ...entry.config,
      continueSession: false,
      resumeSessionId: undefined,
      systemPrompt: buildContextRefreshPrompt(finalHandoff, entry),
      autoHandoff: true,
      autoDispatch: hadAutoDispatch,
      autoComplete: hadAutoComplete,
      _handoffCount: newHandoffCount,
      _contextRefreshCount: newRefreshCount,
    };

    // Temporarily disable autoHandoff so the old exit handler doesn't also fire
    entry.autoHandoff = false;

    // Kill old terminal
    try {
      entry.terminal.kill();
    } catch { /* already dead */ }

    // Wait for exit then spawn fresh
    const doSpawn = () => {
      terminals.delete(entry.id);

      setTimeout(() => {
        spawn(entry.id, config)
          .then(() => {
            // Restore carried task
            if (savedTask && coordinator) {
              const newEntry = terminals.get(entry.id);
              if (newEntry) {
                newEntry.assignedTask = savedTask;
                newEntry._taskActivityBytes = 0;
                setTimeout(() => {
                  write(entry.id, `[CONTEXT-REFRESHED] Continuing task ${savedTask.taskId}: ${savedTask.task}\r`);
                  if (newEntry.autoComplete) resetCompletionTimer(entry.id);
                }, AUTO_DISPATCH_DELAY_MS);
              }
            }

            events.emit('claude-terminal:context-refresh-completed', {
              terminalId: entry.id,
              refreshCount: newRefreshCount,
              hadTask: !!savedTask,
              handoffLength: finalHandoff.length,
            });

            log(`[claude-pool] ${entry.id} context-refresh #${newRefreshCount} completed — fresh terminal spawned`);

            // Auto-dispatch if enabled and no carried task
            if (hadAutoDispatch && !savedTask) {
              setTimeout(() => maybeAutoDispatch(entry.id), AUTO_DISPATCH_DELAY_MS);
            }
          })
          .catch((err) => {
            log(`[claude-pool] ${entry.id} context-refresh respawn failed: ${err.message}`);
            // Release task back if respawn fails
            if (savedTask && coordinator && coordinator.taskQueue) {
              try {
                coordinator.taskQueue.fail(savedTask.taskId, 'Context-refresh respawn failed');
                coordinator.taskQueue.retry(savedTask.taskId);
              } catch { /* task may already be in terminal state */ }
            }
            events.emit('claude-terminal:context-refresh-failed', {
              terminalId: entry.id,
              error: err.message,
            });
          });
      }, CONTEXT_REFRESH_SPAWN_DELAY_MS);
    };

    // If terminal is already stopped, spawn immediately
    if (entry.status === 'stopped') {
      doSpawn();
    } else {
      // Wait for exit
      const exitWaiter = (evtData) => {
        if (evtData.terminalId !== entry.id) return;
        events.off('claude-terminal:exit', exitWaiter);
        doSpawn();
      };
      events.on('claude-terminal:exit', exitWaiter);
      // Safety timeout
      setTimeout(() => {
        events.off('claude-terminal:exit', exitWaiter);
        if (terminals.has(entry.id) && terminals.get(entry.id).status === 'running') {
          // Force spawn anyway
          doSpawn();
        }
      }, FORCE_KILL_TIMEOUT_MS + 2000);
    }
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
   * When terminalId is provided, uses affinity scoring (history + capabilities).
   * Otherwise returns the highest-priority pending task whose deps are all complete.
   * @param {string} [terminalId] - Optional terminal for affinity-based selection
   * @returns {object|null} claimable task or null
   */
  function findNextClaimableTask(terminalId) {
    if (!coordinator) return null;
    const taskQueue = coordinator.taskQueue;
    if (!taskQueue) return null;

    const allTasks = taskQueue.getAll();
    const pending = allTasks.filter(t => t.status === 'pending');

    // Filter to tasks with deps met
    const claimable = [];
    for (const task of pending) {
      if (!task.deps || task.deps.length === 0) {
        claimable.push(task);
        continue;
      }
      const depsComplete = task.deps.every(depId => {
        const dep = allTasks.find(t => t.id === depId);
        return dep && dep.status === 'complete';
      });
      if (depsComplete) claimable.push(task);
    }

    if (claimable.length === 0) return null;

    // If no terminalId, fall back to priority-only
    const entry = terminalId ? terminals.get(terminalId) : null;

    if (!entry) {
      claimable.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      return claimable[0];
    }

    // Capability filtering: skip tasks whose category is not in capabilities
    const caps = entry.capabilities;
    const filtered = caps
      ? claimable.filter(t => !t.category || caps.includes(t.category))
      : claimable;

    if (filtered.length === 0) return null;

    // Affinity scoring: base = priority, + bonuses for history match
    const history = entry._taskHistory || [];
    const mostRecent = history.length > 0 ? history[history.length - 1] : null;

    filtered.sort((a, b) => {
      const scoreA = _affinityScore(a, history, mostRecent);
      const scoreB = _affinityScore(b, history, mostRecent);
      return scoreB - scoreA;
    });

    return filtered[0];
  }

  /**
   * Compute affinity score for a task relative to a terminal's history.
   * @param {object} task
   * @param {string[]} history - Recent category history
   * @param {string|null} mostRecent - Most recent category
   * @returns {number} score
   */
  function _affinityScore(task, history, mostRecent) {
    let score = task.priority ?? 0;
    const cat = task.category;
    if (!cat || history.length === 0) return score;
    if (history.includes(cat)) score += AFFINITY_CATEGORY_BONUS;
    if (mostRecent && cat === mostRecent) score += AFFINITY_RECENT_BONUS;
    return score;
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

    const claimable = findNextClaimableTask(terminalId);
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

  // Listen for task completion to auto-dispatch next task + track metrics + history
  const _onTaskCompleted = (data) => {
    if (data.status === 'complete') {
      swarmState._metrics.tasksCompleted++;
      // Track completed task category in terminal's history
      const entry = terminals.get(data.terminalId);
      if (entry && data.category) {
        entry._taskHistory.push(data.category);
        if (entry._taskHistory.length > MAX_TASK_HISTORY) {
          entry._taskHistory.shift();
        }
      }
      if (entry && entry.autoDispatch) {
        setTimeout(() => maybeAutoDispatch(data.terminalId), AUTO_DISPATCH_DELAY_MS);
      }
    } else if (data.status === 'failed') {
      swarmState._metrics.tasksFailed++;
    }
  };
  events.on('claude-terminal:task-completed', _onTaskCompleted);

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
    const taskCategory = entry.assignedTask.category || null;
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

      // Emit task-completed (triggers auto-dispatch + history tracking)
      events.emit('claude-terminal:task-completed', {
        terminalId,
        taskId,
        status: 'complete',
        category: taskCategory,
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

  // ── Set Capabilities ──────────────────────────────────

  /**
   * Set capability categories for a terminal (limits which tasks it claims).
   * @param {string} terminalId
   * @param {string[]|null} capabilities - Array of category strings, or null for all
   * @returns {boolean} true if updated
   */
  function setCapabilities(terminalId, capabilities) {
    const entry = terminals.get(terminalId);
    if (!entry) return false;
    entry.capabilities = Array.isArray(capabilities) ? [...capabilities] : null;
    return true;
  }

  // Track PTY activity for completion detection
  const _onData = (data) => {
    const entry = terminals.get(data.terminalId);
    if (!entry || !entry.autoComplete || !entry.assignedTask) return;
    if (entry.status !== 'running') return;

    // Accumulate activity bytes
    entry._taskActivityBytes += (data.data ? data.data.length : 0);

    // Reset idle timer (starts/restarts on each data event)
    resetCompletionTimer(data.terminalId);
  };
  events.on('claude-terminal:data', _onData);

  // Stop completion watch when task is released manually
  const _onTaskReleased = (data) => {
    stopCompletionWatch(data.terminalId);
  };
  events.on('claude-terminal:task-released', _onTaskReleased);

  // Stop completion watch when terminal exits
  const _onExit = (data) => {
    stopCompletionWatch(data.terminalId);
  };
  events.on('claude-terminal:exit', _onExit);

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
  /**
   * Remove all EventBus listeners registered by the pool.
   */
  function destroy() {
    events.off('claude-terminal:task-completed', _onTaskCompleted);
    events.off('claude-terminal:data', _onData);
    events.off('claude-terminal:task-released', _onTaskReleased);
    events.off('claude-terminal:exit', _onExit);
  }

  async function shutdownAll() {
    // Stop swarm mode if active
    if (swarmState._scaleTimer) {
      clearInterval(swarmState._scaleTimer);
      swarmState._scaleTimer = null;
      swarmState.enabled = false;
    }

    const ids = [...terminals.keys()];

    // Clear all completion timers and context-refresh timers
    for (const id of ids) {
      stopCompletionWatch(id);
      const entry = terminals.get(id);
      if (entry && entry._contextRefreshTimer) {
        clearTimeout(entry._contextRefreshTimer);
        entry._contextRefreshTimer = null;
      }
    }

    if (ids.length === 0) {
      destroy();
      return;
    }

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

    destroy();
  }

  // ── Master Console (Phase 57) ────────────────────

  /**
   * Get the master terminal entry, or null if no master exists.
   * @returns {object|null}
   */
  function getMasterTerminal() {
    for (const [, entry] of terminals) {
      if (entry.role === 'master') return formatEntry(entry);
    }
    return null;
  }

  /**
   * Get the last N lines of terminal output as a string array.
   * @param {string} terminalId
   * @param {number} [maxLines=20]
   * @returns {string[]|null} null if terminal not found
   */
  function getOutputPreview(terminalId, maxLines = 20) {
    const entry = terminals.get(terminalId);
    if (!entry) return null;
    const buf = entry.terminal.getOutputBuffer();
    if (!buf) return [];
    const lines = buf.split('\n');
    return lines.slice(-maxLines);
  }

  /**
   * Get the last N lines of raw terminal output (ANSI codes preserved).
   * @param {string} terminalId
   * @param {number} [maxLines=20]
   * @returns {string[]|null} null if terminal not found
   */
  function getRawOutputPreview(terminalId, maxLines = 20) {
    const entry = terminals.get(terminalId);
    if (!entry) return null;
    const buf = entry.terminal.getRawOutputBuffer();
    if (!buf) return [];
    const lines = buf.split('\n');
    return lines.slice(-maxLines);
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
      swarmManaged: entry.swarmManaged || false,
      capabilities: entry.capabilities || null,
      role: entry.role || null,
      persistent: entry.persistent || false,
      contextRefreshCount: entry.contextRefreshCount || 0,
      contextRefreshState: entry._contextRefreshState || null,
      taskHistory: [...(entry._taskHistory || [])],
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
      maxTerminals: _effectiveMaxTerminals,
    };
  }

  // ── Swarm Mode ───────────────────────────────────────────

  /**
   * Count pending tasks that are claimable (all deps met).
   * @returns {number}
   */
  function countClaimableTasks() {
    if (!coordinator) return 0;
    const taskQueue = coordinator.taskQueue;
    if (!taskQueue) return 0;

    const allTasks = taskQueue.getAll();
    const pending = allTasks.filter(t => t.status === 'pending');
    let count = 0;
    for (const task of pending) {
      if (!task.deps || task.deps.length === 0) {
        count++;
        continue;
      }
      const depsComplete = task.deps.every(depId => {
        const dep = allTasks.find(t => t.id === depId);
        return dep && dep.status === 'complete';
      });
      if (depsComplete) count++;
    }
    return count;
  }

  /**
   * Swarm scale-up/scale-down check (runs on interval).
   */
  function _swarmScaleCheck() {
    if (!swarmState.enabled) return;

    swarmState._tickCount++;

    // ── Crash recovery: respawn stopped swarm terminals ───
    for (const entry of terminals.values()) {
      if (!entry.swarmManaged || entry.status !== 'stopped') continue;
      const crashes = swarmState._crashCounts.get(entry.id) || 0;
      if (crashes >= SWARM_MAX_CRASH_RETRIES) continue;
      const newCrashCount = crashes + 1;

      // Remove stopped entry and respawn with fresh ID
      terminals.delete(entry.id);
      const freshId = SWARM_ID_PREFIX + swarmState._counter++;
      // Transfer crash count to new ID for lineage tracking
      swarmState._crashCounts.set(freshId, newCrashCount);
      const swarmOpts = {
        projectDir: swarmState.projectDir,
        model: swarmState.model,
        dangerouslySkipPermissions: swarmState.dangerouslySkipPermissions,
        systemPrompt: swarmState.systemPrompt,
        autoHandoff: true,
        autoDispatch: true,
        autoComplete: true,
        _swarmManaged: true,
      };
      spawn(freshId, swarmOpts)
        .then(() => {
          log(`[claude-pool] Swarm respawned: ${entry.id} → ${freshId} (crash #${crashes + 1})`);
          swarmState._metrics.totalSpawns++;
          setTimeout(() => maybeAutoDispatch(freshId), AUTO_DISPATCH_DELAY_MS);
        })
        .catch((err) => {
          log(`[claude-pool] Swarm respawn failed for ${freshId}: ${err.message}`);
        });
      break; // one respawn per tick
    }

    // ── Scale-up: spawn if pending tasks exist and no idle terminals
    const readyTasks = countClaimableTasks();
    let idleTerminals = 0;
    for (const entry of terminals.values()) {
      if (entry.status === 'running' && !entry.assignedTask && getActivityState(entry) === 'idle') {
        idleTerminals++;
      }
    }

    if (readyTasks > 0 && idleTerminals === 0 && activeCount() < _effectiveMaxTerminals) {
      const swarmId = SWARM_ID_PREFIX + swarmState._counter++;
      const swarmOpts = {
        projectDir: swarmState.projectDir,
        model: swarmState.model,
        dangerouslySkipPermissions: swarmState.dangerouslySkipPermissions,
        systemPrompt: swarmState.systemPrompt,
        autoHandoff: true,
        autoDispatch: true,
        autoComplete: true,
        _swarmManaged: true,
      };
      spawn(swarmId, swarmOpts)
        .then(() => {
          log(`[claude-pool] Swarm scaled up: ${swarmId} (${readyTasks} pending tasks)`);
          swarmState._metrics.scaleUps++;
          swarmState._metrics.totalSpawns++;
          events.emit('claude-terminal:swarm-scaled-up', {
            terminalId: swarmId,
            pendingTasks: readyTasks,
            activeTerminals: activeCount(),
          });
          // Trigger auto-dispatch after spawn delay
          setTimeout(() => maybeAutoDispatch(swarmId), AUTO_DISPATCH_DELAY_MS);
        })
        .catch((err) => {
          log(`[claude-pool] Swarm scale-up failed: ${err.message}`);
        });
    }

    // Scale-down: every 6th tick (~30s), kill oldest idle swarm terminal
    if (swarmState._tickCount % 6 === 0) {
      let oldestIdleId = null;
      let oldestIdleTime = Infinity;
      for (const entry of terminals.values()) {
        if (!entry.swarmManaged) continue;
        if (entry.persistent || entry.role === 'master') continue; // Skip persistent/master terminals (Phase 57)
        if (entry._contextRefreshState) continue; // Skip terminals mid-context-refresh
        if (entry.status !== 'running') continue;
        if (entry.assignedTask) continue;
        const state = getActivityState(entry);
        if (state !== 'idle') continue;
        const idleMs = Date.now() - new Date(entry.lastActivityAt).getTime();
        if (idleMs >= SWARM_SCALE_DOWN_IDLE_MS && new Date(entry.spawnedAt).getTime() < oldestIdleTime) {
          oldestIdleTime = new Date(entry.spawnedAt).getTime();
          oldestIdleId = entry.id;
        }
      }

      if (oldestIdleId && activeCount() > swarmState.minTerminals) {
        log(`[claude-pool] Swarm scaling down: ${oldestIdleId}`);
        kill(oldestIdleId);
        swarmState._metrics.scaleDowns++;
        events.emit('claude-terminal:swarm-scaled-down', {
          terminalId: oldestIdleId,
          activeTerminals: activeCount() - 1,
        });
      }
    }
  }

  /**
   * Enable or disable swarm mode.
   * @param {object} opts - { enabled, minTerminals, maxTerminals, projectDir, model, ... }
   * @returns {object} Updated swarmState summary
   */
  function setSwarmMode(opts = {}) {
    const SWARM_CONFIG_KEYS = ['enabled', 'minTerminals', 'maxTerminals', 'projectDir', 'model', 'dangerouslySkipPermissions', 'systemPrompt', 'scaleUpThreshold'];
    for (const key of SWARM_CONFIG_KEYS) {
      if (key in opts) swarmState[key] = opts[key];
    }

    if (swarmState.enabled) {
      _effectiveMaxTerminals = Math.max(maxTerminals, swarmState.maxTerminals);
      if (!swarmState._scaleTimer) {
        swarmState._tickCount = 0;
        swarmState._crashCounts.clear();
        swarmState._metrics = {
          startedAt: new Date().toISOString(),
          tasksCompleted: 0,
          tasksFailed: 0,
          tasksRecovered: 0,
          totalSpawns: 0,
          totalCrashes: 0,
          scaleUps: 0,
          scaleDowns: 0,
        };
        swarmState._scaleTimer = setInterval(_swarmScaleCheck, SWARM_SCALE_CHECK_MS);
      }
      events.emit('claude-terminal:swarm-started', {
        minTerminals: swarmState.minTerminals,
        maxTerminals: swarmState.maxTerminals,
        model: swarmState.model,
      });
    } else {
      _effectiveMaxTerminals = maxTerminals;
      if (swarmState._scaleTimer) {
        clearInterval(swarmState._scaleTimer);
        swarmState._scaleTimer = null;
      }
      events.emit('claude-terminal:swarm-stopped', {});
    }

    return getSwarmState();
  }

  /**
   * Get swarm metrics (completed, failed, recovered, throughput).
   * @returns {object}
   */
  function getSwarmMetrics() {
    const m = swarmState._metrics;
    const uptimeMs = m.startedAt ? Date.now() - new Date(m.startedAt).getTime() : 0;
    const uptimeHrs = uptimeMs / 3600000;
    const totalProcessed = m.tasksCompleted + m.tasksFailed;
    return {
      ...m,
      uptimeMs,
      tasksPerHour: uptimeHrs > 0 ? Math.round((totalProcessed / uptimeHrs) * 10) / 10 : 0,
    };
  }

  /**
   * Get current swarm state summary.
   * @returns {object}
   */
  function getSwarmState() {
    return {
      enabled: swarmState.enabled,
      minTerminals: swarmState.minTerminals,
      maxTerminals: swarmState.maxTerminals,
      model: swarmState.model,
      dangerouslySkipPermissions: swarmState.dangerouslySkipPermissions,
      systemPrompt: swarmState.systemPrompt,
      scaleUpThreshold: swarmState.scaleUpThreshold,
      running: activeCount(),
      pending: countClaimableTasks(),
      metrics: getSwarmMetrics(),
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
    setCapabilities,
    assignTask,
    releaseTask,
    getAssignedTask,
    getStatus,
    getTerminal,
    getTerminalHandle,
    activeCount,
    getPoolStatus,
    getMasterTerminal,
    getOutputPreview,
    getRawOutputPreview,
    findNextClaimableTask,
    setSwarmMode,
    getSwarmState,
    getSwarmMetrics,
    shutdownAll,
    destroy,
  };
}

export { MAX_TERMINALS, FORCE_KILL_TIMEOUT_MS, AUTO_DISPATCH_DELAY_MS, IDLE_THRESHOLD_MS, COMPLETION_IDLE_THRESHOLD_MS, MIN_ACTIVITY_BYTES, SWARM_SCALE_CHECK_MS, SWARM_SCALE_DOWN_IDLE_MS, SWARM_ID_PREFIX, SWARM_MAX_CRASH_RETRIES, MAX_TASK_HISTORY, AFFINITY_CATEGORY_BONUS, AFFINITY_RECENT_BONUS, CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS, CONTEXT_REFRESH_GIT_TIMEOUT_MS, CONTEXT_REFRESH_SPAWN_DELAY_MS, MAX_CONTEXT_REFRESHES };
