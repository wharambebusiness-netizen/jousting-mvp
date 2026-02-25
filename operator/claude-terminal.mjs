// ============================================================
// Claude Terminal — Single PTY Process Manager
// ============================================================
// Manages a single interactive Claude Code CLI session via PTY.
// Uses node-pty for pseudo-terminal support (ConPTY on Windows).
//
// Factory pattern: createClaudeTerminal(opts) returns terminal
// methods for lifecycle management + data I/O.
//
// Dynamic import of node-pty with graceful fallback if the
// native module is not installed.
//
// Phase 15A: PTY infrastructure layer.
// Phase 15E: Context-aware auto-handoff detection.
// ============================================================

import { randomUUID } from 'crypto';

// ── Dynamic node-pty Import ─────────────────────────────────

let nodePty = null;
let nodePtyError = null;

/**
 * Lazily load node-pty. Returns the module or throws.
 * @returns {Promise<object>}
 */
async function loadNodePty() {
  if (nodePty) return nodePty;
  if (nodePtyError) throw nodePtyError;

  try {
    // Dynamic import so the rest of the codebase works even
    // if the native module isn't installed.
    const mod = await import('node-pty');
    nodePty = mod.default || mod;
    return nodePty;
  } catch (err) {
    nodePtyError = new Error(
      `node-pty is not available: ${err.message}. ` +
      'Install it with: npm install node-pty'
    );
    throw nodePtyError;
  }
}

/**
 * Check if node-pty is available without throwing.
 * @returns {Promise<boolean>}
 */
export async function isNodePtyAvailable() {
  try {
    await loadNodePty();
    return true;
  } catch {
    return false;
  }
}

// ── Constants ───────────────────────────────────────────────

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const FORCE_KILL_TIMEOUT_MS = 5000;
const IS_WINDOWS = process.platform === 'win32';

// Context-pressure detection patterns (matched against ANSI-stripped PTY output)
const CONTEXT_PATTERNS = [
  /auto[- ]?compact/i,
  /compressing conversation/i,
  /context window (?:is )?(?:nearly |almost )?(?:full|exhausted|at capacity)/i,
  /conversation (?:is )?(?:too )?long/i,
  /summarizing prior conversation/i,
];

// Ring buffer size for PTY output scanning (bytes)
const OUTPUT_BUFFER_SIZE = 8192;

// Minimum uptime before auto-handoff triggers (ms) — prevents rapid restart loops
const MIN_UPTIME_FOR_HANDOFF_MS = 10000;

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a Claude terminal — a PTY-based interactive Claude CLI session.
 *
 * @param {object} opts
 * @param {string}   opts.projectDir - Working directory for the Claude session
 * @param {string}   [opts.id] - Terminal identifier (auto-generated if omitted)
 * @param {string}   [opts.model] - Model to use (e.g., 'sonnet', 'opus')
 * @param {boolean}  [opts.dangerouslySkipPermissions] - Skip permission prompts
 * @param {string}   [opts.systemPrompt] - Append to system prompt
 * @param {string}   [opts.resumeSessionId] - Resume a previous session (-r flag)
 * @param {boolean}  [opts.continueSession] - Continue last session (-c flag)
 * @param {number}   [opts.cols] - Terminal columns (default 120)
 * @param {number}   [opts.rows] - Terminal rows (default 30)
 * @param {Function} [opts.onData] - Callback for PTY output data
 * @param {Function} [opts.onExit] - Callback for process exit
 * @param {Function} [opts.log] - Logger function
 * @returns {Promise<object>} Terminal control object
 */
export async function createClaudeTerminal(opts) {
  const pty = await loadNodePty();

  const id = opts.id || `claude-${randomUUID().slice(0, 8)}`;
  const projectDir = opts.projectDir;
  const log = opts.log || (() => {});
  const cols = opts.cols || DEFAULT_COLS;
  const rows = opts.rows || DEFAULT_ROWS;

  if (!projectDir) {
    throw new Error('projectDir is required');
  }

  // ── Build CLI args ──────────────────────────────────────

  const cliArgs = buildCliArgs(opts);

  // ── Spawn PTY ───────────────────────────────────────────

  // node-pty on Windows needs a fully-resolved path
  let shell = 'claude';
  if (IS_WINDOWS) {
    try {
      const { execSync } = await import('child_process');
      shell = execSync('where claude', { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    } catch { shell = 'claude.exe'; }
  }

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(shell, cliArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: projectDir,
      env: {
        ...process.env,
        // Clear nested-session guard so spawned Claude doesn't refuse to start
        CLAUDECODE: '',
        // Set autocompact threshold for handoff detection
        CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: '70',
        // Force color output
        FORCE_COLOR: '1',
      },
    });
  } catch (err) {
    throw new Error(`Failed to spawn Claude PTY: ${err.message}`);
  }

  // ── State ───────────────────────────────────────────────

  const state = {
    id,
    pid: ptyProcess.pid,
    status: 'running',     // running | stopped
    projectDir,
    model: opts.model || null,
    dangerouslySkipPermissions: !!opts.dangerouslySkipPermissions,
    resumeSessionId: opts.resumeSessionId || null,
    continueSession: !!opts.continueSession,
    systemPrompt: opts.systemPrompt || null,
    cols,
    rows,
    spawnedAt: new Date().toISOString(),
    exitCode: null,
    exitSignal: null,
  };

  // ── Event Handlers ──────────────────────────────────────

  const listeners = {
    data: [],
    exit: [],
    error: [],
    'context-warning': [],
  };

  function emit(event, ...args) {
    for (const fn of listeners[event] || []) {
      try { fn(...args); } catch (e) { log(`[claude-terminal] listener error: ${e.message}`); }
    }
  }

  // ── Context Detection ─────────────────────────────────

  let outputBuffer = '';
  let contextWarningEmitted = false;

  function checkContextPressure(chunk) {
    // Append to ring buffer, keep last OUTPUT_BUFFER_SIZE chars
    outputBuffer += chunk;
    if (outputBuffer.length > OUTPUT_BUFFER_SIZE) {
      outputBuffer = outputBuffer.slice(-OUTPUT_BUFFER_SIZE);
    }

    // Only scan the new chunk (stripped of ANSI codes)
    const stripped = stripAnsi(chunk);
    for (const pattern of CONTEXT_PATTERNS) {
      if (pattern.test(stripped)) {
        if (!contextWarningEmitted) {
          contextWarningEmitted = true;
          emit('context-warning', { pattern: pattern.source });
          log(`[claude-terminal] ${id} context pressure detected: ${pattern.source}`);
        }
        return;
      }
    }
  }

  // PTY data output
  ptyProcess.onData((data) => {
    checkContextPressure(data);
    emit('data', data);
    if (opts.onData) {
      try { opts.onData(data); } catch { /* noop */ }
    }
  });

  // PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    state.status = 'stopped';
    state.exitCode = exitCode;
    state.exitSignal = signal;
    log(`[claude-terminal] ${id} exited (code=${exitCode}, signal=${signal})`);

    emit('exit', exitCode, signal);
    if (opts.onExit) {
      try { opts.onExit(exitCode, signal); } catch { /* noop */ }
    }
  });

  log(`[claude-terminal] ${id} spawned (pid=${ptyProcess.pid}, cols=${cols}, rows=${rows})`);

  // ── Public API ──────────────────────────────────────────

  /**
   * Write data to the PTY (user input).
   * @param {string} data - Input data to send
   */
  function write(data) {
    if (state.status !== 'running') return;
    ptyProcess.write(data);
  }

  /**
   * Resize the PTY terminal.
   * @param {number} newCols
   * @param {number} newRows
   */
  function resize(newCols, newRows) {
    if (state.status !== 'running') return;
    state.cols = newCols;
    state.rows = newRows;
    ptyProcess.resize(newCols, newRows);
  }

  /**
   * Kill the PTY process.
   * Sends SIGTERM first, then SIGKILL after timeout.
   */
  function kill() {
    if (state.status !== 'running') return;

    try {
      ptyProcess.kill();
    } catch { /* already dead */ }

    // Force kill after timeout
    const timer = setTimeout(() => {
      try {
        if (state.status === 'running') {
          ptyProcess.kill('SIGKILL');
        }
      } catch { /* already dead */ }
    }, FORCE_KILL_TIMEOUT_MS);
    timer.unref();
  }

  /**
   * Get current terminal status.
   * @returns {object}
   */
  function getStatus() {
    return { ...state };
  }

  /**
   * Register an event listener.
   * @param {'data'|'exit'|'error'} event
   * @param {Function} handler
   */
  function on(event, handler) {
    if (listeners[event]) {
      listeners[event].push(handler);
    }
  }

  /**
   * Remove an event listener.
   * @param {'data'|'exit'|'error'} event
   * @param {Function} handler
   */
  function off(event, handler) {
    const list = listeners[event];
    if (list) {
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  /**
   * Get the current output ring buffer (ANSI-stripped).
   * Useful for shared memory snapshots before handoff.
   * @returns {string}
   */
  function getOutputBuffer() {
    return stripAnsi(outputBuffer);
  }

  return {
    id,
    pid: ptyProcess.pid,
    write,
    resize,
    kill,
    getStatus,
    getOutputBuffer,
    on,
    off,
  };
}

// ── Helpers ─────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;

/**
 * Strip ANSI escape codes from a string.
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

/**
 * Build CLI arguments for the Claude command.
 * @param {object} opts - Terminal options
 * @returns {string[]}
 */
export function buildCliArgs(opts) {
  const args = [];

  if (opts.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  if (opts.model) {
    args.push('--model', opts.model);
  }

  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
  }

  if (opts.resumeSessionId) {
    args.push('-r', opts.resumeSessionId);
  } else if (opts.continueSession) {
    args.push('-c');
  }

  return args;
}

export {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  FORCE_KILL_TIMEOUT_MS,
  CONTEXT_PATTERNS,
  OUTPUT_BUFFER_SIZE,
  MIN_UPTIME_FOR_HANDOFF_MS,
  loadNodePty,
};
