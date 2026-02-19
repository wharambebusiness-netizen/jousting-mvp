// ============================================================
// Orchestrator Worker — Child Process Entry Point
// ============================================================
// Spawned by process-pool.mjs via fork(). Communicates with
// parent through IPC messages. Uses IPCEventBus so all events
// automatically propagate to the parent's EventBus.
//
// IPC Protocol (parent → worker):
//   { type: 'init', workerId, config, projectDir, handoffFile? }
//   { type: 'start', mission?, dryRun?, model?, handoffFile? }
//   { type: 'stop' }
//   { type: 'shutdown' }
//   { type: 'ping' }
//   { type: 'coord:proceed', taskId, task, category?, metadata? }
//   { type: 'coord:wait', reason }
//   { type: 'coord:rate-grant', remaining }
//   { type: 'coord:rate-wait', waitMs, remaining }
//   { type: 'coord:budget-stop', workerExceeded, globalExceeded, workerTotal, globalTotal }
//
// IPC Protocol (worker → parent):
//   { type: 'ready' }
//   { type: 'pong' }
//   { type: 'status', status: {...} }
//   { type: 'event', event: '...', data: {...} }
//   { type: 'error', message: '...' }
//
// ============================================================

import { fork } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { IPCEventBus } from '../shared/event-bus.mjs';

// ── Worker State ────────────────────────────────────────────

let workerId = process.env.WORKER_ID || 'unknown';
let projectDir = null;
let config = {};
let handoffFile = null;
let events = null;
let orchProcess = null;
let running = false;

// ── IPC Helpers ─────────────────────────────────────────────

function sendToParent(msg) {
  if (typeof process.send === 'function') {
    try { process.send(msg); } catch { /* IPC closed */ }
  }
}

function sendStatus() {
  sendToParent({
    type: 'status',
    status: {
      workerId,
      running,
      pid: orchProcess?.pid || null,
      currentTask: currentTask ? currentTask.taskId : null,
      budgetExceeded,
    },
  });
}

// ── Coordination State ──────────────────────────────────────

let currentTask = null;     // Currently assigned coordination task
let budgetExceeded = false;  // Whether budget-stop has been received

/**
 * Handle coordinator IPC messages routed from parent.
 * Re-emits them on the local IPCEventBus so internal code can react.
 */
function handleCoordMessage(msg) {
  if (!events) return; // Not initialized yet

  switch (msg.type) {
    case 'coord:proceed':
      currentTask = { taskId: msg.taskId, task: msg.task, category: msg.category, metadata: msg.metadata };
      events.emit('coord:proceed', {
        workerId,
        taskId: msg.taskId,
        task: msg.task,
        category: msg.category,
        metadata: msg.metadata,
      });
      break;

    case 'coord:wait':
      events.emit('coord:wait', { workerId, reason: msg.reason });
      break;

    case 'coord:rate-grant':
      events.emit('coord:rate-grant', { workerId, remaining: msg.remaining });
      break;

    case 'coord:rate-wait':
      events.emit('coord:rate-wait', { workerId, waitMs: msg.waitMs, remaining: msg.remaining });
      break;

    case 'coord:budget-stop':
      budgetExceeded = true;
      events.emit('coord:budget-stop', {
        workerId,
        workerExceeded: msg.workerExceeded,
        globalExceeded: msg.globalExceeded,
        workerTotal: msg.workerTotal,
        globalTotal: msg.globalTotal,
      });
      // Actually stop the orchestrator when budget is exceeded
      if (running && orchProcess) {
        // Report current task as failed due to budget
        if (currentTask) {
          sendToParent({
            type: 'event',
            event: 'coord:failed',
            data: {
              workerId,
              taskId: currentTask.taskId,
              error: msg.globalExceeded ? 'Global budget exceeded' : 'Per-worker budget exceeded',
            },
          });
          currentTask = null;
        }
        stopOrchestrator();
      }
      break;
  }
}

// ── Orchestrator Management ─────────────────────────────────

function startOrchestrator(opts = {}) {
  if (running) {
    sendToParent({ type: 'error', message: 'Already running' });
    return;
  }

  const { mission, dryRun, model } = opts;
  // Use handoffFile from start message, falling back to init-level handoffFile
  const resolvedHandoffFile = opts.handoffFile || handoffFile;

  const orchPath = join(projectDir, 'orchestrator', 'orchestrator.mjs');
  if (!existsSync(orchPath)) {
    sendToParent({ type: 'error', message: `Orchestrator not found: ${orchPath}` });
    return;
  }

  // Build args
  const args = [];
  if (mission) {
    const missionPath = mission.includes('/')
      ? mission
      : join('orchestrator', 'missions', mission);
    args.push(missionPath);
  }
  if (dryRun) args.push('--dry-run');
  if (model) args.push('--model', model);
  if (resolvedHandoffFile) args.push(`--handoff-file=${resolvedHandoffFile}`);

  // Emit started event via IPCEventBus (propagates to parent)
  events.emit('orchestrator:started', {
    workerId,
    mission: mission || null,
    model: model || null,
    dryRun: dryRun || false,
  });

  try {
    const child = fork(orchPath, args, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      detached: false,
    });

    orchProcess = child;
    running = true;

    // Forward stdout/stderr as events
    if (child.stdout) {
      child.stdout.on('data', (data) => {
        events.emit('orchestrator:log', {
          workerId,
          stream: 'stdout',
          text: data.toString(),
        });
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => {
        events.emit('orchestrator:log', {
          workerId,
          stream: 'stderr',
          text: data.toString(),
        });
      });
    }

    // Handle orchestrator exit
    child.on('exit', (code, signal) => {
      running = false;
      orchProcess = null;
      // Clear stale task state
      currentTask = null;
      events.emit('orchestrator:stopped', {
        workerId,
        code,
        signal,
      });
      sendStatus();
    });

    child.on('error', (err) => {
      running = false;
      orchProcess = null;
      events.emit('orchestrator:stopped', {
        workerId,
        error: err.message,
      });
      sendToParent({ type: 'error', message: `Orchestrator error: ${err.message}` });
      sendStatus();
    });

    sendStatus();
  } catch (err) {
    sendToParent({ type: 'error', message: `Fork failed: ${err.message}` });
  }
}

function stopOrchestrator() {
  if (!running || !orchProcess) {
    sendToParent({ type: 'error', message: 'Not running' });
    return;
  }

  // Try IPC shutdown first (Windows-safe)
  try { orchProcess.send({ type: 'shutdown' }); } catch { /* noop */ }

  // Fallback: SIGTERM after 2s if still alive
  const fallback = setTimeout(() => {
    try {
      if (orchProcess && !orchProcess.killed) {
        orchProcess.kill('SIGTERM');
      }
    } catch { /* already dead */ }
  }, 2000);
  fallback.unref();
}

// ── IPC Message Handler ─────────────────────────────────────

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'init':
      workerId = msg.workerId || workerId;
      projectDir = msg.projectDir || projectDir;
      config = msg.config || config;
      // Store init-level handoff file path (can be overridden per-start)
      if (msg.handoffFile) handoffFile = msg.handoffFile;
      // Create IPCEventBus with worker ID for event tagging
      events = new IPCEventBus({ workerId });
      sendToParent({ type: 'ready' });
      break;

    case 'start':
      if (!events || !projectDir) {
        sendToParent({ type: 'error', message: 'Not initialized' });
        return;
      }
      startOrchestrator(msg);
      break;

    case 'stop':
      stopOrchestrator();
      break;

    case 'ping':
      sendToParent({ type: 'pong' });
      break;

    case 'shutdown':
      // Graceful shutdown: stop orchestrator if running, then exit
      if (running && orchProcess) {
        stopOrchestrator();
        // Wait for orchestrator to exit, then exit ourselves
        const exitTimer = setTimeout(() => process.exit(0), 5000);
        exitTimer.unref();
        if (orchProcess) {
          orchProcess.once('exit', () => process.exit(0));
        }
      } else {
        process.exit(0);
      }
      break;

    // ── Coordination IPC messages (from coordinator via pool.sendTo) ──
    case 'coord:proceed':
    case 'coord:wait':
    case 'coord:rate-grant':
    case 'coord:rate-wait':
    case 'coord:budget-stop':
      handleCoordMessage(msg);
      break;

    default:
      sendToParent({ type: 'error', message: `Unknown message type: ${msg.type}` });
  }
}

// ── Bootstrap ───────────────────────────────────────────────

// Only run as worker when spawned via fork() (process.send available)
if (typeof process.send === 'function') {
  process.on('message', handleMessage);

  // Handle unexpected disconnection from parent
  process.on('disconnect', () => {
    if (running && orchProcess) {
      try { orchProcess.kill('SIGTERM'); } catch { /* noop */ }
    }
    process.exit(1);
  });
}

// Export for testing
export { handleMessage, handleCoordMessage, startOrchestrator, stopOrchestrator };
