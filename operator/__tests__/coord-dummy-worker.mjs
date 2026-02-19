// ============================================================
// Coordination-Aware Dummy Worker — For Integration Tests
// ============================================================
// Handles all IPC messages that a real orchestrator-worker would,
// but without actually spawning orchestrator processes.
//
// Responds to coord:* messages from coordinator and can be
// instructed to send coord:* events back via test:* messages.
//
// Mode: 'auto' — automatically completes tasks on coord:proceed
//        'manual' — waits for explicit test:* messages
// ============================================================

let workerId = process.env.WORKER_ID || 'unknown';
let mode = 'auto'; // default: auto-complete tasks
let autoCompleteDelay = 10; // ms
let currentTask = null;

function send(msg) {
  if (typeof process.send === 'function') {
    try { process.send(msg); } catch { /* IPC closed */ }
  }
}

function sendEvent(event, data) {
  send({ type: 'event', event, data });
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'init':
      workerId = msg.workerId || workerId;
      if (msg.config && msg.config.mode) mode = msg.config.mode;
      if (msg.config && msg.config.autoCompleteDelay != null) {
        autoCompleteDelay = msg.config.autoCompleteDelay;
      }
      send({ type: 'ready' });
      break;

    case 'ping':
      send({ type: 'pong' });
      break;

    case 'shutdown':
      process.exit(0);
      break;

    case 'start':
      sendEvent('orchestrator:started', { workerId });
      break;

    // ── Coordination messages from coordinator ──

    case 'coord:proceed':
      currentTask = { taskId: msg.taskId, task: msg.task };
      sendEvent('coord:proceed-received', {
        taskId: msg.taskId,
        task: msg.task,
      });
      if (mode === 'auto') {
        setTimeout(() => {
          sendEvent('coord:complete', {
            taskId: msg.taskId,
            result: { status: 'auto-completed' },
          });
          currentTask = null;
        }, autoCompleteDelay);
      }
      break;

    case 'coord:wait':
      sendEvent('coord:wait-received', { reason: msg.reason });
      break;

    case 'coord:rate-grant':
      sendEvent('coord:rate-grant-received', { remaining: msg.remaining });
      break;

    case 'coord:rate-wait':
      sendEvent('coord:rate-wait-received', {
        waitMs: msg.waitMs,
        remaining: msg.remaining,
      });
      break;

    case 'coord:budget-stop':
      sendEvent('coord:budget-stop-received', {
        workerExceeded: msg.workerExceeded,
        globalExceeded: msg.globalExceeded,
      });
      break;

    // ── Test control messages (for manual mode) ──

    case 'test:complete-task':
      if (currentTask) {
        sendEvent('coord:complete', {
          taskId: msg.taskId || currentTask.taskId,
          result: msg.result || { status: 'manual-completed' },
        });
        currentTask = null;
      }
      break;

    case 'test:fail-task':
      if (currentTask) {
        sendEvent('coord:failed', {
          taskId: msg.taskId || currentTask.taskId,
          error: msg.error || 'manual-failure',
        });
        currentTask = null;
      }
      break;

    case 'test:request-task':
      sendEvent('coord:request', {});
      break;

    case 'test:rate-request':
      sendEvent('coord:rate-request', {
        tokens: msg.tokens || 0,
      });
      break;

    case 'test:report-cost':
      sendEvent('coord:cost', {
        totalUsd: msg.totalUsd || 0,
        inputTokens: msg.inputTokens || 0,
        outputTokens: msg.outputTokens || 0,
      });
      break;

    case 'test:session-complete':
      sendEvent('session:complete', {
        costUsd: msg.costUsd || 0,
        inputTokens: msg.inputTokens || 0,
        outputTokens: msg.outputTokens || 0,
      });
      break;

    case 'test:set-mode':
      mode = msg.mode || 'auto';
      break;
  }
});
