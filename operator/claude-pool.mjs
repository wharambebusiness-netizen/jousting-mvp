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
const MAX_MASTERS = 4;                   // max concurrent master terminals (Phase 66)
const MASTER_DOMAIN_AFFINITY_BONUS = 5;  // scoring bonus for master domain match (Phase 66)
const MASTER_OWNER_AFFINITY_BONUS = 4;  // scoring bonus for worker's own master's tasks (Phase 69)
const ACTIVITY_CHECK_INTERVAL_MS = 2000; // check activity state transitions every 2s
const STALE_TERMINAL_TTL_MS = 5 * 60 * 1000; // remove non-persistent stopped terminals after 5 minutes

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
 * @param {object}   [ctx.auth] - Auth instance for generating terminal API tokens
 * @returns {object} Pool methods
 */
export function createClaudePool(ctx) {
  const { events, projectDir } = ctx;
  const log = ctx.log || console.log;
  let maxTerminals = ctx.maxTerminals ?? MAX_TERMINALS;
  const sharedMemory = ctx.sharedMemory || null;
  const coordinator = ctx.coordinator || null;
  const auth = ctx.auth || null;
  const worktreeManager = ctx.worktreeManager || null;
  const messageBus = ctx.messageBus || null;

  // Master registry: tracks each master's state for multi-master coordination (Phase 66)
  const _masterRegistry = new Map(); // masterId → { id, spawnedAt, claimedTaskIds: Set, workerIds: Set, domain: null }

  // Discovery watchers per master (Phase 67 coordination)
  const _discoveryWatchers = new Map(); // masterId → unwatch function

  // ── Coordination Helpers (Phase 67) ────────────────────

  /**
   * Build a coordination summary for a master terminal.
   * Reads other masters' heartbeats, discoveries, file claims, focus, and unread messages.
   * @param {string} masterId - The master to build context for
   * @returns {string} Coordination summary text (empty string if nothing to report)
   */
  function buildCoordinationSummary(masterId) {
    if (!sharedMemory) return '';
    const parts = [];

    // 1. Other active masters
    const allKeys = sharedMemory.keys();
    const otherMasters = [];
    for (const key of allKeys) {
      if (!key.startsWith('master:') || !key.endsWith(':heartbeat')) continue;
      const id = key.replace('master:', '').replace(':heartbeat', '');
      if (id === masterId) continue;
      const hb = sharedMemory.get(key);
      if (!hb || !hb.alive) continue;
      otherMasters.push({ id, domain: hb.domain || 'unassigned', claimedTasks: hb.claimedTasks || 0, workerCount: hb.workerCount || 0 });
    }
    if (otherMasters.length > 0) {
      parts.push('## Other Active Masters');
      for (const m of otherMasters) {
        parts.push(`- ${m.id}: domain=${m.domain}, tasks=${m.claimedTasks}, workers=${m.workerCount}`);
      }
    }

    // 2. Focus declarations
    const focusEntries = [];
    for (const key of allKeys) {
      if (!key.startsWith('focus:')) continue;
      const id = key.replace('focus:', '');
      if (id === masterId) continue;
      const val = sharedMemory.get(key);
      if (val) focusEntries.push({ id, focus: String(val).slice(0, 200) });
    }
    if (focusEntries.length > 0) {
      parts.push('## Other Masters\' Focus');
      for (const f of focusEntries) {
        parts.push(`- ${f.id}: ${f.focus}`);
      }
    }

    // 3. Recent discoveries from other masters
    const discoveries = [];
    for (const key of allKeys) {
      if (!key.startsWith('discovery:')) continue;
      const rest = key.slice('discovery:'.length);
      const colonIdx = rest.indexOf(':');
      const id = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
      if (id === masterId) continue;
      const topic = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';
      const val = sharedMemory.get(key);
      if (val) discoveries.push({ id, topic, value: String(val).slice(0, 200) });
    }
    if (discoveries.length > 0) {
      parts.push('## Recent Discoveries');
      for (const d of discoveries) {
        parts.push(`- [${d.id}] ${d.topic}: ${d.value}`);
      }
    }

    // 4. File claims from other masters
    const claims = [];
    for (const key of allKeys) {
      if (!key.startsWith('claim:')) continue;
      const rest = key.slice('claim:'.length);
      const colonIdx = rest.indexOf(':');
      const id = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
      if (id === masterId) continue;
      const filepath = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';
      claims.push({ id, filepath });
    }
    if (claims.length > 0) {
      parts.push('## File Claims (do NOT edit these files)');
      for (const c of claims) {
        parts.push(`- ${c.id} owns: ${c.filepath}`);
      }
    }

    // 5. Unread messages from message bus
    if (messageBus) {
      const unread = messageBus.getUnreadCount(masterId);
      if (unread > 0) {
        const inbox = messageBus.getInbox(masterId, { limit: 5 });
        const recent = inbox.filter(m => !m.deleted).slice(0, 5);
        if (recent.length > 0) {
          parts.push('## Unread Messages');
          for (const msg of recent) {
            parts.push(`- [${msg.from}] ${String(msg.content).slice(0, 150)}`);
          }
        }
        messageBus.markRead(masterId);
      }
    }

    if (parts.length === 0) return '';
    return ['[COORDINATION CONTEXT]', ...parts].join('\n');
  }

  /**
   * Publish a discovery to shared memory.
   * @param {string} masterId
   * @param {string} topic
   * @param {string} value - Max 200 chars
   */
  function publishDiscovery(masterId, topic, value) {
    if (!sharedMemory || !masterId || !topic) return false;
    const key = `discovery:${masterId}:${topic}`;
    sharedMemory.set(key, String(value).slice(0, 200), 'master');
    events.emit('master:discovery-published', { masterId, topic, value: String(value).slice(0, 200) });
    return true;
  }

  /**
   * Claim a file for exclusive editing.
   * @param {string} masterId
   * @param {string} filepath
   * @returns {{ ok: boolean, holder?: string }} ok=true if claimed, holder=existing claimer if rejected
   */
  function claimFile(masterId, filepath) {
    if (!sharedMemory || !masterId || !filepath) return { ok: false };
    // Check for existing claim by another master
    const allKeys = sharedMemory.keys();
    for (const key of allKeys) {
      if (!key.startsWith('claim:')) continue;
      const rest = key.slice('claim:'.length);
      const colonIdx = rest.indexOf(':');
      const id = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
      const claimedPath = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';
      if (id !== masterId && claimedPath === filepath) {
        return { ok: false, holder: id };
      }
    }
    const key = `claim:${masterId}:${filepath}`;
    sharedMemory.set(key, filepath, 'master');
    events.emit('master:file-claimed', { masterId, filepath });
    return { ok: true };
  }

  /**
   * Release a file claim.
   * @param {string} masterId
   * @param {string} filepath
   */
  function releaseClaim(masterId, filepath) {
    if (!sharedMemory || !masterId || !filepath) return false;
    const key = `claim:${masterId}:${filepath}`;
    sharedMemory.delete(key);
    events.emit('master:file-released', { masterId, filepath });
    return true;
  }

  /**
   * Set a master's current focus description.
   * @param {string} masterId
   * @param {string} focus
   */
  function setMasterFocus(masterId, focus) {
    if (!sharedMemory || !masterId) return false;
    const key = `focus:${masterId}`;
    sharedMemory.set(key, String(focus).slice(0, 200), 'master');
    return true;
  }

  /**
   * Clean up all coordination keys for a departing master.
   * @param {string} masterId
   */
  function cleanupMasterCoordinationKeys(masterId) {
    if (!sharedMemory) return;
    const allKeys = sharedMemory.keys();
    for (const key of allKeys) {
      if (key.startsWith(`claim:${masterId}:`) ||
          key.startsWith(`discovery:${masterId}:`) ||
          key === `focus:${masterId}`) {
        sharedMemory.delete(key);
      }
    }
  }

  /**
   * Set up discovery watcher for a master — emits events when other masters publish.
   * @param {string} masterId
   */
  function setupDiscoveryWatcher(masterId) {
    if (!sharedMemory || _discoveryWatchers.has(masterId)) return;
    const unwatch = sharedMemory.watchPrefix('discovery:', (key, value) => {
      // Only fire for discoveries from OTHER masters
      const rest = key.slice('discovery:'.length);
      const colonIdx = rest.indexOf(':');
      const sourceId = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
      if (sourceId !== masterId) {
        events.emit('master:discovery-received', { masterId, sourceId, key, value });
      }
    });
    _discoveryWatchers.set(masterId, unwatch);
  }

  /**
   * Tear down discovery watcher for a master.
   * @param {string} masterId
   */
  function teardownDiscoveryWatcher(masterId) {
    const unwatch = _discoveryWatchers.get(masterId);
    if (unwatch) {
      unwatch();
      _discoveryWatchers.delete(masterId);
    }
  }

  // Generate a long-lived token for spawned terminals to call the operator API
  let terminalApiToken = null;
  if (auth) {
    // Reuse existing terminal-pool token or generate a new one
    const existing = auth.listTokens().find(t => t.label === 'terminal-pool');
    if (existing) auth.revokeToken(existing.id);
    terminalApiToken = auth.generateToken('terminal-pool').token;
  }

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
    _masterId: null,
    _scaleTimer: null,
    _counter: 0,
    _tickCount: 0,
    _crashCounts: new Map(),
    _consecutiveSpawnFailures: 0,
    _circuitBroken: false,
    _lastRespawnTimes: new Map(),
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

  // ── Activity State Tracking ─────────────────────────────
  // Periodically check for activity state transitions and emit events
  const _activityCheckTimer = setInterval(() => {
    for (const entry of terminals.values()) {
      const currentState = getActivityState(entry);
      const previousState = entry._lastActivityState || null;
      if (previousState && currentState !== previousState) {
        entry._lastActivityState = currentState;
        // Track utilization time transitions
        const now = Date.now();
        if (previousState === 'active') {
          entry._utilization.activeMs += now - (entry._utilization._lastStateAt || now);
        } else if (previousState === 'idle' || previousState === 'waiting') {
          entry._utilization.idleMs += now - (entry._utilization._lastStateAt || now);
        }
        entry._utilization._lastStateAt = now;

        events.emit('claude-terminal:activity-changed', {
          terminalId: entry.id,
          state: currentState,
          previousState,
          assignedTask: entry.assignedTask ? (entry.assignedTask.task || entry.assignedTask.taskId) : null,
        });
      } else if (!previousState) {
        entry._lastActivityState = currentState;
      }
    }

    // ── Stale stopped-terminal cleanup ───────────────────
    // Remove non-swarm, non-persistent stopped terminals older than TTL
    const nowMs = Date.now();
    for (const entry of [...terminals.values()]) {
      if (entry.status !== 'stopped') continue;
      if (entry.swarmManaged) continue;  // swarm manages its own lifecycle
      if (entry.persistent) continue;   // persistent terminals are intentionally kept
      if (!entry.stoppedAt) continue;
      const age = nowMs - new Date(entry.stoppedAt).getTime();
      if (age < STALE_TERMINAL_TTL_MS) continue;

      terminals.delete(entry.id);

      // Clean up stale context-refresh shared-memory key for this terminal
      if (sharedMemory) {
        try { sharedMemory.del(`context-refresh:${entry.id}:handoff`); } catch { /* key may not exist */ }
      }

      events.emit('claude-terminal:stale-removed', {
        terminalId: entry.id,
        stoppedAt: entry.stoppedAt,
        age,
      });
    }
  }, ACTIVITY_CHECK_INTERVAL_MS);

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

    // Build extra env vars for spawned terminals
    const termEnv = {};
    if (terminalApiToken) {
      termEnv.OPERATOR_API_TOKEN = terminalApiToken;
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
      env: termEnv,
      log,
    });

    // Multi-master support (Phase 66)
    if (opts.role === 'master') {
      // Count running masters
      let runningMasters = 0;
      for (const [, existing] of terminals) {
        if (existing.role === 'master' && existing.status === 'running') {
          runningMasters++;
        }
      }
      if (runningMasters >= MAX_MASTERS) {
        throw new Error(`Maximum masters (${MAX_MASTERS}) reached`);
      }
      // Clean up stopped/stale master entries
      for (const [existingId, existing] of terminals) {
        if (existing.role === 'master' && existing.status !== 'running' && existingId !== terminalId) {
          terminals.delete(existingId);
        }
      }
    }

    // Worktree isolation for master's workers (Phase 66)
    let worktreePath = null;
    if (worktreeManager && opts._masterId) {
      try {
        const wtResult = await worktreeManager.createForMaster(opts._masterId, terminalId);
        if (wtResult.ok) {
          worktreePath = wtResult.path;
          // Override project dir to the worktree path
          // Note: the terminal is already created with opts.projectDir,
          // but the worktree path should be used for the worker's context
        }
      } catch (err) {
        log(`[claude-pool] Worktree creation failed for ${terminalId}: ${err.message}`);
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
      worktreePath: worktreePath || null,
      contextRefreshCount: opts._contextRefreshCount || 0,
      _contextRefreshState: null,   // null | 'requesting-handoff' | 'committing' | 'restarting'
      _contextRefreshOutputCapture: '',
      _contextRefreshTimer: null,
      _taskHistory: [],
      _completionTimer: null,
      _taskActivityBytes: 0,
      _lastActivityState: 'active',
      _utilization: {
        tasksCompleted: 0,
        tasksFailed: 0,
        activeMs: 0,
        idleMs: 0,
        _lastStateAt: Date.now(),
        lastTaskCompletedAt: null,
      },
    };

    terminals.set(terminalId, entry);

    // Register worker in its master's workerIds (Phase 69)
    if (opts._masterId && opts.role !== 'master') {
      const masterInfo = _masterRegistry.get(opts._masterId);
      if (masterInfo) {
        masterInfo.workerIds.add(terminalId);
        events.emit('master:worker-added', { masterId: opts._masterId, workerId: terminalId, workerCount: masterInfo.workerIds.size });
      }
    }

    // Register in master registry (Phase 66)
    if (opts.role === 'master') {
      _masterRegistry.set(terminalId, {
        id: terminalId,
        spawnedAt: now,
        claimedTaskIds: new Set(),
        workerIds: new Set(),
        domain: null,
      });
      events.emit('master:spawned', { id: terminalId, count: _masterRegistry.size });
      events.emit('master:count-changed', { count: _masterRegistry.size });

      // Inject coordination context if other masters exist (Phase 67)
      if (_masterRegistry.size > 1) {
        const coordSummary = buildCoordinationSummary(terminalId);
        if (coordSummary) {
          // Prepend to system prompt via PTY write after brief delay for shell init
          setTimeout(() => {
            if (entry.status === 'running') {
              write(terminalId, coordSummary + '\r');
            }
          }, 500);
        }
      }

      // Set up discovery watcher for this master (Phase 67)
      setupDiscoveryWatcher(terminalId);
    }

    // Wire terminal events to EventBus
    terminal.on('data', (data) => {
      const previousState = entry._lastActivityState;
      entry.lastActivityAt = new Date().toISOString();

      // Immediate transition detection: idle/waiting→active on data arrival
      if (previousState && previousState !== 'active') {
        const now = Date.now();
        if (previousState === 'idle' || previousState === 'waiting') {
          entry._utilization.idleMs += now - (entry._utilization._lastStateAt || now);
        }
        entry._utilization._lastStateAt = now;
        entry._lastActivityState = 'active';
        events.emit('claude-terminal:activity-changed', {
          terminalId,
          state: 'active',
          previousState,
          assignedTask: entry.assignedTask ? (entry.assignedTask.task || entry.assignedTask.taskId) : null,
        });
      }

      events.emit('claude-terminal:data', {
        terminalId,
        data,
      });
    });

    terminal.on('exit', (exitCode, signal) => {
      // Emit activity-changed to stopped
      const previousState = entry._lastActivityState;
      entry.status = 'stopped';
      entry.stoppedAt = new Date().toISOString();

      if (previousState && previousState !== 'stopped') {
        const now = Date.now();
        if (previousState === 'active') {
          entry._utilization.activeMs += now - (entry._utilization._lastStateAt || now);
        } else {
          entry._utilization.idleMs += now - (entry._utilization._lastStateAt || now);
        }
        entry._utilization._lastStateAt = now;
        entry._lastActivityState = 'stopped';
        events.emit('claude-terminal:activity-changed', {
          terminalId,
          state: 'stopped',
          previousState,
          assignedTask: entry.assignedTask ? (entry.assignedTask.task || entry.assignedTask.taskId) : null,
        });
      }

      events.emit('claude-terminal:exit', {
        terminalId,
        exitCode,
        signal,
      });

      // Master exit cleanup (Phase 66)
      if (entry.role === 'master') {
        const masterInfo = _masterRegistry.get(terminalId);
        if (masterInfo) {
          // Release all claimed tasks back to pending
          if (coordinator && coordinator.taskQueue) {
            for (const taskId of masterInfo.claimedTaskIds) {
              try {
                coordinator.taskQueue.fail(taskId, `Master ${terminalId} exited`);
                coordinator.taskQueue.retry(taskId);
              } catch { /* task may be in terminal state */ }
            }
          }
          _masterRegistry.delete(terminalId);
          events.emit('master:exited', { id: terminalId, releasedTasks: [...masterInfo.claimedTaskIds] });
          events.emit('master:count-changed', { count: _masterRegistry.size });
        }
        // Clean up coordination keys and discovery watcher (Phase 67)
        cleanupMasterCoordinationKeys(terminalId);
        teardownDiscoveryWatcher(terminalId);
      }

      // Remove worker from its master's workerIds (Phase 69)
      if (entry.config._masterId && entry.role !== 'master') {
        const masterInfo = _masterRegistry.get(entry.config._masterId);
        if (masterInfo) {
          masterInfo.workerIds.delete(terminalId);
          events.emit('master:worker-removed', { masterId: entry.config._masterId, workerId: terminalId, workerCount: masterInfo.workerIds.size });
        }
      }

      // Worktree cleanup on worker exit (Phase 66)
      if (entry.worktreePath && worktreeManager && entry.config._masterId) {
        const compositeId = `${entry.config._masterId}/${terminalId}`;
        if (exitCode === 0) {
          // Clean exit: attempt auto-merge
          worktreeManager.mergeIfClean(compositeId)
            .then((result) => {
              if (result.merged) {
                log(`[claude-pool] Auto-merged worktree for ${terminalId}`);
              } else if (result.conflicted) {
                log(`[claude-pool] Merge conflict for ${terminalId}: ${result.files.join(', ')}`);
                events.emit('master:merge-conflict', {
                  terminalId,
                  masterId: entry.config._masterId,
                  files: result.files,
                });
              }
            })
            .catch((err) => {
              log(`[claude-pool] Worktree merge failed for ${terminalId}: ${err.message}`);
            });
        } else {
          // Crash exit: leave worktree for inspection
          log(`[claude-pool] Worker ${terminalId} crashed — leaving worktree for inspection`);
        }
      }

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

    let recovered = false;
    try {
      coordinator.taskQueue.fail(taskId, `Terminal ${entry.id} crashed (exit code ${exitCode})`);
      coordinator.taskQueue.retry(taskId);
      recovered = true;
    } catch (err) {
      log(`[claude-pool] Task recovery failed for ${taskId}: ${err.message}`);
      events.emit('claude-terminal:task-recovery-failed', {
        terminalId: entry.id,
        taskId,
        exitCode,
        error: err.message,
      });
    }

    entry.assignedTask = null;
    swarmState._metrics.totalCrashes++;

    if (recovered) {
      swarmState._metrics.tasksRecovered++;
      events.emit('claude-terminal:task-recovered', {
        terminalId: entry.id,
        taskId,
        exitCode,
      });
    }
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
    // Sanitize handoff: replace "## HANDOFF" headings so the system prompt echo
    // doesn't get re-detected as a fresh handoff by parseHandoffFromOutput().
    // Use "Previous Handoff" which won't match the /^##\s+HANDOFF\b/ pattern.
    const sanitizedHandoff = handoff.replace(/^##\s+HANDOFF\b/gmi, '### Previous Handoff');
    const parts = [
      '[CONTEXT-REFRESH] This terminal was restarted with a fresh context window.',
      `This is context refresh #${entry.contextRefreshCount + 1} for terminal ${entry.id}.`,
      '',
      'The previous session generated the following handoff:',
      '',
      sanitizedHandoff,
      '',
      'Continue working from where the previous session left off.',
      'Do NOT repeat work that was already completed.',
    ];
    if (entry.assignedTask) {
      parts.push('', `Active task: ${entry.assignedTask.taskId} — ${entry.assignedTask.task}`);
    }
    // Append coordination context for master-role terminals (Phase 67)
    if (entry.role === 'master') {
      const coordSummary = buildCoordinationSummary(entry.id);
      if (coordSummary) {
        parts.push('', coordSummary);
      }
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
    entry._contextRefreshCaptureStart = Date.now();
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
    const CAPTURE_GRACE_MS = 500; // skip system prompt echo phase (belt-and-suspenders)
    const dataHandler = (evtData) => {
      if (evtData.terminalId !== entry.id) return;
      if (entry._contextRefreshState !== 'requesting-handoff') return;
      // Skip early output — system prompt echo can contain previous handoff headings
      if (entry._contextRefreshCaptureStart && Date.now() - entry._contextRefreshCaptureStart < CAPTURE_GRACE_MS) return;
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
    entry._contextRefreshCaptureStart = null;

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

    // Multi-master exclusion: skip tasks claimed by other masters (Phase 66)
    if (_masterRegistry.size > 1) {
      const callerEntry = terminalId ? terminals.get(terminalId) : null;
      if (callerEntry && callerEntry.role === 'master') {
        const otherMasterClaimed = new Set();
        for (const [mId, mInfo] of _masterRegistry) {
          if (mId !== terminalId) {
            for (const tId of mInfo.claimedTaskIds) otherMasterClaimed.add(tId);
          }
        }
        for (let i = claimable.length - 1; i >= 0; i--) {
          if (otherMasterClaimed.has(claimable[i].id)) claimable.splice(i, 1);
        }
      }
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

    // Master domain affinity: boost tasks matching this master's domain (Phase 66)
    const masterInfo = entry.role === 'master' ? _masterRegistry.get(terminalId) : null;
    const masterDomain = masterInfo ? masterInfo.domain : null;

    // Master owner affinity: workers prefer tasks created by their owning master (Phase 69)
    const workerMasterId = entry.config._masterId || null;

    // File conflict scoring: deprioritize tasks whose metadata.files overlap with other masters' claims (Phase 67)
    const FILE_CONFLICT_PENALTY = 3;
    let claimedFilesSet = null;
    if (sharedMemory && _masterRegistry.size > 1) {
      claimedFilesSet = new Set();
      const allKeys = sharedMemory.keys();
      for (const key of allKeys) {
        if (!key.startsWith('claim:')) continue;
        const rest = key.slice('claim:'.length);
        const colonIdx = rest.indexOf(':');
        const claimerId = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
        if (claimerId !== terminalId) {
          const claimedPath = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';
          if (claimedPath) claimedFilesSet.add(claimedPath);
        }
      }
      if (claimedFilesSet.size === 0) claimedFilesSet = null;
    }

    filtered.sort((a, b) => {
      let scoreA = _affinityScore(a, history, mostRecent);
      let scoreB = _affinityScore(b, history, mostRecent);
      if (masterDomain) {
        if (a.category === masterDomain) scoreA += MASTER_DOMAIN_AFFINITY_BONUS;
        if (b.category === masterDomain) scoreB += MASTER_DOMAIN_AFFINITY_BONUS;
      }
      // Apply master owner affinity (Phase 69)
      if (workerMasterId) {
        const createdByA = (a.metadata && a.metadata.createdBy) || null;
        const createdByB = (b.metadata && b.metadata.createdBy) || null;
        if (createdByA === workerMasterId) scoreA += MASTER_OWNER_AFFINITY_BONUS;
        if (createdByB === workerMasterId) scoreB += MASTER_OWNER_AFFINITY_BONUS;
      }
      // Apply file conflict penalty (Phase 67)
      if (claimedFilesSet) {
        const filesA = (a.metadata && a.metadata.files) || [];
        const filesB = (b.metadata && b.metadata.files) || [];
        if (filesA.some(f => claimedFilesSet.has(f))) scoreA -= FILE_CONFLICT_PENALTY;
        if (filesB.some(f => claimedFilesSet.has(f))) scoreB -= FILE_CONFLICT_PENALTY;
      }
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

      // Register in master's claimed set (Phase 66)
      const masterInfoForClaim = _masterRegistry.get(terminalId);
      if (masterInfoForClaim) {
        masterInfoForClaim.claimedTaskIds.add(claimable.id);
      }

      // Write the task prompt to PTY, with coordination context for multi-master (Phase 67)
      let prompt = `[AUTO-DISPATCH] Task ${claimable.id}: ${claimable.task}`;
      if (entry.role === 'master' && _masterRegistry.size > 1) {
        const coordSummary = buildCoordinationSummary(terminalId);
        if (coordSummary) {
          prompt += '\n\n' + coordSummary;
        }
      }
      write(terminalId, prompt + '\r');

      log(`[claude-pool] ${terminalId} auto-dispatched task ${claimable.id}`);

      events.emit('claude-terminal:auto-dispatch', {
        terminalId,
        taskId: claimable.id,
        task: claimable.task,
      });

      // Bridge with coordinator events for task board integration
      events.emit('coord:assigned', {
        taskId: claimable.id,
        workerId: terminalId,
        strategy: 'claude-pool',
        category: claimable.category,
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
      if (entry) {
        entry._utilization.tasksCompleted++;
        entry._utilization.lastTaskCompletedAt = new Date().toISOString();
      }
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
      const failEntry = terminals.get(data.terminalId);
      if (failEntry) {
        failEntry._utilization.tasksFailed++;
      }
    }

    // Remove from master's claimed set (Phase 66)
    if (data.taskId) {
      for (const [, mInfo] of _masterRegistry) {
        mInfo.claimedTaskIds.delete(data.taskId);
      }
    }

    // Auto-broadcast task completion to message bus (Phase 67)
    if (messageBus && data.terminalId && data.taskId) {
      try {
        messageBus.send({
          from: data.terminalId,
          to: null, // broadcast
          content: `[TASK-COMPLETE] ${data.taskId}: ${data.status}${data.category ? ` (${data.category})` : ''}`,
          category: 'coordination',
        });
      } catch { /* message bus failure is non-critical */ }
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

  /**
   * Update the stored system prompt for a terminal (takes effect on next respawn).
   * @param {string} terminalId
   * @param {string|null} systemPrompt
   * @returns {boolean} true if updated
   */
  function setSystemPrompt(terminalId, systemPrompt) {
    const entry = terminals.get(terminalId);
    if (!entry) return false;
    entry.config.systemPrompt = systemPrompt ?? null;
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
    // Clean up discovery watchers (Phase 67)
    for (const [masterId] of _discoveryWatchers) {
      teardownDiscoveryWatcher(masterId);
    }
  }

  async function shutdownAll() {
    // Stop activity state tracking
    if (_activityCheckTimer) {
      clearInterval(_activityCheckTimer);
    }

    // Stop swarm mode if active
    if (swarmState._scaleTimer) {
      clearInterval(swarmState._scaleTimer);
      swarmState._scaleTimer = null;
      swarmState.enabled = false;
    }
    // Stop per-master swarm timer (Phase 69)
    if (_masterSwarmTimer) {
      clearInterval(_masterSwarmTimer);
      _masterSwarmTimer = null;
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

    // Clean up all worktrees (Phase 66)
    if (worktreeManager) {
      try {
        await worktreeManager.cleanupAll();
      } catch (err) {
        log(`[claude-pool] Worktree cleanup failed: ${err.message}`);
      }
    }

    destroy();
  }

  // ── Master Console (Phase 57 + Phase 66 Multi-Master) ────

  /**
   * Get a master terminal entry by id, or the first master if no id given.
   * @param {string} [id] - Optional master terminal id
   * @returns {object|null}
   */
  function getMasterTerminal(id) {
    if (id) {
      const entry = terminals.get(id);
      if (entry && entry.role === 'master') return formatEntry(entry);
      return null;
    }
    // Backward compat: return first master
    for (const [, entry] of terminals) {
      if (entry.role === 'master') return formatEntry(entry);
    }
    return null;
  }

  /**
   * Get all master terminal entries.
   * @returns {Array<object>}
   */
  function getMasterTerminals() {
    const masters = [];
    for (const [, entry] of terminals) {
      if (entry.role === 'master') masters.push(formatEntry(entry));
    }
    return masters;
  }

  /**
   * Get the master registry info (for coordination).
   * @returns {Array<object>}
   */
  function getMasterRegistry() {
    const result = [];
    for (const [id, info] of _masterRegistry) {
      result.push({
        id,
        spawnedAt: info.spawnedAt,
        claimedTaskIds: [...info.claimedTaskIds],
        workerIds: [...info.workerIds],
        domain: info.domain,
      });
    }
    return result;
  }

  /**
   * Set a master's domain affinity.
   * @param {string} masterId
   * @param {string|null} domain
   * @returns {boolean}
   */
  function setMasterDomain(masterId, domain) {
    const info = _masterRegistry.get(masterId);
    if (!info) return false;
    info.domain = domain;
    return true;
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
      worktreePath: entry.worktreePath || null,
      contextRefreshCount: entry.contextRefreshCount || 0,
      contextRefreshState: entry._contextRefreshState || null,
      taskHistory: [...(entry._taskHistory || [])],
      utilization: {
        tasksCompleted: entry._utilization?.tasksCompleted || 0,
        tasksFailed: entry._utilization?.tasksFailed || 0,
        activeMs: entry._utilization?.activeMs || 0,
        idleMs: entry._utilization?.idleMs || 0,
        lastTaskCompletedAt: entry._utilization?.lastTaskCompletedAt || null,
      },
    };
  }

  /**
   * Get aggregate pool status summary.
   * @returns {object} { total, running, stopped, active, idle, waiting, withTask, withAutoDispatch }
   */
  function getPoolStatus() {
    let running = 0, stopped = 0, active = 0, idle = 0, waiting = 0, withTask = 0, withAutoDispatch = 0, withAutoComplete = 0;
    let totalTasksCompleted = 0, totalTasksFailed = 0;
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
      totalTasksCompleted += entry._utilization?.tasksCompleted || 0;
      totalTasksFailed += entry._utilization?.tasksFailed || 0;
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
      totalTasksCompleted,
      totalTasksFailed,
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
   * Track consecutive spawn failures and trip circuit breaker at threshold.
   */
  function _handleSpawnFailure() {
    swarmState._consecutiveSpawnFailures++;
    if (swarmState._consecutiveSpawnFailures >= 5) {
      swarmState._circuitBroken = true;
      log(`[claude-pool] Circuit breaker tripped: ${swarmState._consecutiveSpawnFailures} consecutive spawn failures — swarm halted`);
      events.emit('claude-terminal:swarm-halted', {
        reason: 'circuit-breaker',
        consecutiveFailures: swarmState._consecutiveSpawnFailures,
      });
    }
  }

  /**
   * Swarm scale-up/scale-down check (runs on interval).
   */
  function _swarmScaleCheck() {
    if (!swarmState.enabled) return;
    if (swarmState._circuitBroken) return;

    swarmState._tickCount++;

    // ── Crash recovery: respawn stopped swarm terminals (with backoff) ───
    for (const entry of terminals.values()) {
      if (!entry.swarmManaged || entry.status !== 'stopped') continue;
      const crashes = swarmState._crashCounts.get(entry.id) || 0;
      if (crashes >= SWARM_MAX_CRASH_RETRIES) continue;

      // Exponential backoff: 5s * 2^crashes (5s, 10s, 20s)
      const backoffMs = SWARM_SCALE_CHECK_MS * Math.pow(2, crashes);
      const lastRespawn = swarmState._lastRespawnTimes.get(entry.id) || 0;
      if (Date.now() - lastRespawn < backoffMs) continue;

      const newCrashCount = crashes + 1;

      // Remove stopped entry and respawn with fresh ID
      terminals.delete(entry.id);
      swarmState._lastRespawnTimes.delete(entry.id);
      const freshId = SWARM_ID_PREFIX + swarmState._counter++;
      // Transfer crash count to new ID for lineage tracking
      swarmState._crashCounts.set(freshId, newCrashCount);
      swarmState._lastRespawnTimes.set(freshId, Date.now());
      const swarmOpts = {
        projectDir: swarmState.projectDir,
        model: swarmState.model,
        dangerouslySkipPermissions: swarmState.dangerouslySkipPermissions,
        systemPrompt: swarmState.systemPrompt,
        autoHandoff: true,
        autoDispatch: true,
        autoComplete: true,
        _swarmManaged: true,
        ...(swarmState._masterId ? { _masterId: swarmState._masterId } : {}),
      };
      spawn(freshId, swarmOpts)
        .then(() => {
          log(`[claude-pool] Swarm respawned: ${entry.id} → ${freshId} (crash #${newCrashCount}, backoff ${backoffMs}ms)`);
          swarmState._metrics.totalSpawns++;
          swarmState._consecutiveSpawnFailures = 0;
          setTimeout(() => maybeAutoDispatch(freshId), AUTO_DISPATCH_DELAY_MS);
        })
        .catch((err) => {
          log(`[claude-pool] Swarm respawn failed for ${freshId}: ${err.message}`);
          _handleSpawnFailure();
        });
      break; // one respawn per tick
    }

    // ── Scale-up: batch spawn up to 4 terminals if pending tasks need workers
    const readyTasks = countClaimableTasks();
    let idleTerminals = 0;
    for (const entry of terminals.values()) {
      if (entry.status === 'running' && !entry.assignedTask && getActivityState(entry) === 'idle') {
        idleTerminals++;
      }
    }

    const slotsAvailable = _effectiveMaxTerminals - activeCount();
    const needed = readyTasks - idleTerminals;
    const toSpawn = Math.min(needed, slotsAvailable, 4); // batch up to 4

    for (let i = 0; i < toSpawn; i++) {
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
        ...(swarmState._masterId ? { _masterId: swarmState._masterId } : {}),
      };
      spawn(swarmId, swarmOpts)
        .then(() => {
          log(`[claude-pool] Swarm scaled up: ${swarmId} (${readyTasks} pending tasks)`);
          swarmState._metrics.scaleUps++;
          swarmState._metrics.totalSpawns++;
          swarmState._consecutiveSpawnFailures = 0;
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
          _handleSpawnFailure();
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
   * Update the pool's max terminal cap at runtime (Phase 69).
   * @param {number} newMax
   */
  function setMaxTerminals(newMax) {
    maxTerminals = Math.max(2, Math.min(64, newMax || MAX_TERMINALS));
    if (!swarmState.enabled) {
      _effectiveMaxTerminals = maxTerminals;
    }
  }

  /**
   * Enable/disable per-master swarm mode (Phase 69).
   * Each master gets its own min/max worker limits.
   * @param {string} masterId
   * @param {object} opts - { enabled, minTerminals, maxTerminals, model }
   * @returns {{ ok: boolean, swarm?: object, error?: string }}
   */
  function setMasterSwarm(masterId, opts = {}) {
    const masterInfo = _masterRegistry.get(masterId);
    if (!masterInfo) return { ok: false, error: 'Master not found' };

    if (opts.enabled) {
      masterInfo.swarm = {
        enabled: true,
        minTerminals: Math.max(1, Math.min(16, parseInt(opts.minTerminals) || 2)),
        maxTerminals: Math.max(1, Math.min(16, parseInt(opts.maxTerminals) || 8)),
        model: opts.model || 'sonnet',
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions !== false,
      };
      // Raise effective cap to accommodate per-master workers
      const totalPerMaster = _getTotalPerMasterMax();
      _effectiveMaxTerminals = Math.max(maxTerminals, totalPerMaster + MAX_MASTERS);
      events.emit('master:swarm-started', { masterId, swarm: masterInfo.swarm });
      _ensureMasterSwarmTimer();
    } else {
      masterInfo.swarm = null;
      // Recalculate effective cap
      const totalPerMaster = _getTotalPerMasterMax();
      if (swarmState.enabled) {
        _effectiveMaxTerminals = Math.max(maxTerminals, swarmState.maxTerminals, totalPerMaster + MAX_MASTERS);
      } else {
        _effectiveMaxTerminals = Math.max(maxTerminals, totalPerMaster + MAX_MASTERS);
      }
      events.emit('master:swarm-stopped', { masterId });
      _ensureMasterSwarmTimer();
    }
    return { ok: true, swarm: masterInfo.swarm };
  }

  /**
   * Get total maxTerminals across all per-master swarm configs.
   */
  function _getTotalPerMasterMax() {
    let total = 0;
    for (const [, info] of _masterRegistry) {
      if (info.swarm && info.swarm.enabled) {
        total += info.swarm.maxTerminals;
      }
    }
    return total;
  }

  /**
   * Get a master's swarm config.
   * @param {string} masterId
   * @returns {object|null}
   */
  function getMasterSwarm(masterId) {
    const masterInfo = _masterRegistry.get(masterId);
    if (!masterInfo) return null;
    const swarm = masterInfo.swarm || null;
    const workerCount = masterInfo.workerIds.size;
    const runningWorkers = [...masterInfo.workerIds].filter(wId => {
      const entry = terminals.get(wId);
      return entry && entry.status === 'running';
    }).length;
    return { swarm, workerCount, runningWorkers };
  }

  // Per-master swarm scale timer (Phase 69)
  let _masterSwarmTimer = null;

  /**
   * Per-master scale check: ensure each master with swarm config has enough workers.
   * Spawns workers to fill up to minTerminals, caps at maxTerminals.
   */
  function _masterSwarmScaleCheck() {
    for (const [masterId, masterInfo] of _masterRegistry) {
      if (!masterInfo.swarm || !masterInfo.swarm.enabled) continue;
      const sw = masterInfo.swarm;

      // Count running workers for this master
      let runningWorkers = 0;
      for (const wId of masterInfo.workerIds) {
        const entry = terminals.get(wId);
        if (entry && entry.status === 'running') runningWorkers++;
      }

      // Scale up if below min
      if (runningWorkers < sw.minTerminals) {
        const toSpawn = Math.min(sw.minTerminals - runningWorkers, 2); // batch up to 2
        for (let i = 0; i < toSpawn; i++) {
          const wId = `${masterId}-w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
          spawn(wId, {
            role: 'worker',
            model: sw.model,
            dangerouslySkipPermissions: sw.dangerouslySkipPermissions,
            autoHandoff: true,
            autoDispatch: true,
            autoComplete: true,
            _masterId: masterId,
            _swarmManaged: true,
          }).then(() => {
            log(`[claude-pool] Master ${masterId} swarm: spawned worker ${wId} (${runningWorkers + 1}/${sw.maxTerminals})`);
            setTimeout(() => maybeAutoDispatch(wId), AUTO_DISPATCH_DELAY_MS);
          }).catch((err) => {
            log(`[claude-pool] Master ${masterId} swarm spawn failed: ${err.message}`);
          });
        }
      }

      // Scale down idle workers beyond min (every 6th tick = ~30s)
      if (runningWorkers > sw.minTerminals) {
        for (const wId of masterInfo.workerIds) {
          if (runningWorkers <= sw.minTerminals) break;
          const entry = terminals.get(wId);
          if (!entry || entry.status !== 'running') continue;
          if (entry.assignedTask) continue;
          const state = getActivityState(entry);
          if (state !== 'idle') continue;
          const idleMs = Date.now() - new Date(entry.lastActivityAt).getTime();
          if (idleMs >= SWARM_SCALE_DOWN_IDLE_MS) {
            kill(wId);
            runningWorkers--;
            log(`[claude-pool] Master ${masterId} swarm: scaled down worker ${wId}`);
          }
        }
      }
    }

    // Stop timer if no masters have swarm enabled
    const anyActive = [..._masterRegistry.values()].some(m => m.swarm && m.swarm.enabled);
    if (!anyActive && _masterSwarmTimer) {
      clearInterval(_masterSwarmTimer);
      _masterSwarmTimer = null;
    }
  }

  /**
   * Start or stop the per-master swarm timer as needed.
   */
  function _ensureMasterSwarmTimer() {
    const anyActive = [..._masterRegistry.values()].some(m => m.swarm && m.swarm.enabled);
    if (anyActive && !_masterSwarmTimer) {
      _masterSwarmTimer = setInterval(_masterSwarmScaleCheck, SWARM_SCALE_CHECK_MS);
    }
    if (!anyActive && _masterSwarmTimer) {
      clearInterval(_masterSwarmTimer);
      _masterSwarmTimer = null;
    }
  }

  /**
   * Enable or disable swarm mode.
   * @param {object} opts - { enabled, minTerminals, maxTerminals, projectDir, model, ... }
   * @returns {object} Updated swarmState summary
   */
  function setSwarmMode(opts = {}) {
    const SWARM_CONFIG_KEYS = ['enabled', 'minTerminals', 'maxTerminals', 'projectDir', 'model', 'dangerouslySkipPermissions', 'systemPrompt', 'scaleUpThreshold', '_masterId'];
    for (const key of SWARM_CONFIG_KEYS) {
      if (key in opts) swarmState[key] = opts[key];
    }

    if (swarmState.enabled) {
      _effectiveMaxTerminals = Math.max(maxTerminals, swarmState.maxTerminals);
      if (!swarmState._scaleTimer) {
        swarmState._tickCount = 0;
        swarmState._crashCounts.clear();
        swarmState._consecutiveSpawnFailures = 0;
        swarmState._circuitBroken = false;
        swarmState._lastRespawnTimes.clear();
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
      _masterId: swarmState._masterId || null,
      running: activeCount(),
      pending: countClaimableTasks(),
      circuitBroken: swarmState._circuitBroken,
      consecutiveSpawnFailures: swarmState._consecutiveSpawnFailures,
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
    setSystemPrompt,
    assignTask,
    releaseTask,
    getAssignedTask,
    getStatus,
    getTerminal,
    getTerminalHandle,
    activeCount,
    getPoolStatus,
    getMasterTerminal,
    getMasterTerminals,
    getMasterRegistry,
    setMasterDomain,
    getOutputPreview,
    getRawOutputPreview,
    findNextClaimableTask,
    setMaxTerminals,
    setMasterSwarm,
    getMasterSwarm,
    setSwarmMode,
    getSwarmState,
    getSwarmMetrics,
    publishDiscovery,
    claimFile,
    releaseClaim,
    setMasterFocus,
    buildCoordinationSummary,
    shutdownAll,
    destroy,
  };
}

export { MAX_TERMINALS, FORCE_KILL_TIMEOUT_MS, AUTO_DISPATCH_DELAY_MS, IDLE_THRESHOLD_MS, COMPLETION_IDLE_THRESHOLD_MS, MIN_ACTIVITY_BYTES, SWARM_SCALE_CHECK_MS, SWARM_SCALE_DOWN_IDLE_MS, SWARM_ID_PREFIX, SWARM_MAX_CRASH_RETRIES, MAX_TASK_HISTORY, AFFINITY_CATEGORY_BONUS, AFFINITY_RECENT_BONUS, CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS, CONTEXT_REFRESH_GIT_TIMEOUT_MS, CONTEXT_REFRESH_SPAWN_DELAY_MS, MAX_CONTEXT_REFRESHES, ACTIVITY_CHECK_INTERVAL_MS, STALE_TERMINAL_TTL_MS, MAX_MASTERS, MASTER_DOMAIN_AFFINITY_BONUS, MASTER_OWNER_AFFINITY_BONUS };
