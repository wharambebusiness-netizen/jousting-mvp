// ============================================================
// WebSocket Event Bridge (M4 + Phase 15B)
// ============================================================
// Bridges EventBus events to connected WebSocket clients.
// Clients subscribe to event patterns (e.g. "chain:*") and
// receive real-time JSON messages.
//
// Phase 15B: Binary WebSocket for Claude terminals.
// Path /ws/claude-terminal/:id carries raw PTY I/O.
// Control messages use \x01 prefix (e.g. resize).
//
// Protocol (JSON bridge — /ws):
//   Client → Server: { "subscribe": ["chain:*", "session:*"] }
//   Client → Server: { "unsubscribe": ["session:*"] }
//   Server → Client: { "event": "chain:started", "data": { ... } }
//   Server → Client: { "type": "subscribed", "patterns": ["chain:*"] }
//
// Protocol (binary terminal — /ws/claude-terminal/:id):
//   Client → Server: raw input text (typed by user)
//   Client → Server: \x01{"type":"resize","cols":N,"rows":N}
//   Server → Client: raw PTY output data
//
// ============================================================

import { WebSocketServer } from 'ws';

// ── Pattern Matching ────────────────────────────────────────

/**
 * Check if an event name matches a subscription pattern.
 * Patterns support * as a wildcard suffix (e.g. "chain:*" matches "chain:started").
 * Exact matches also work (e.g. "chain:started" matches "chain:started").
 */
function matchesPattern(event, pattern) {
  if (pattern === '*') return true;
  if (pattern === event) return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // "chain:" from "chain:*"
    return event.startsWith(prefix);
  }
  return false;
}

/**
 * Check if an event matches any pattern in a set.
 */
function matchesAnyPattern(event, patterns) {
  for (const p of patterns) {
    if (matchesPattern(event, p)) return true;
  }
  return false;
}

// ── Throttle ────────────────────────────────────────────────

/**
 * Create a throttled sender for a specific event type per client.
 * Returns a function that sends at most once per interval.
 */
function createThrottle(intervalMs) {
  const lastSent = new WeakMap(); // key (object) → timestamp — weak refs prevent leaking disconnected clients

  return function shouldSend(key) {
    const now = Date.now();
    const last = lastSent.get(key) || 0;
    if (now - last < intervalMs) return false;
    lastSent.set(key, now);
    return true;
  };
}

// ── WebSocket Handler ───────────────────────────────────────

/**
 * Create WebSocket server and wire it to EventBus.
 * @param {object} options
 * @param {http.Server} options.server - HTTP server for upgrade
 * @param {EventBus}    options.events - EventBus to bridge
 * @param {object}      [options.claudePool] - Claude terminal pool (Phase 15B)
 * @returns {WebSocketServer}
 */
export function createWebSocketHandler({ server, events, claudePool }) {
  const wss = new WebSocketServer({ noServer: true });

  // Binary terminal WSS for PTY I/O (Phase 15B)
  const termWss = new WebSocketServer({ noServer: true });

  // Output throttle: 1 message per second per client
  const outputThrottle = createThrottle(1000);

  // Track client subscriptions
  const clientSubscriptions = new WeakMap();

  // Handle upgrade requests — route by path
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === '/ws') {
      // JSON event bridge
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (url.pathname.startsWith('/ws/claude-terminal/') && claudePool) {
      // Binary terminal I/O
      const terminalId = decodeURIComponent(url.pathname.split('/').pop());
      termWss.handleUpgrade(request, socket, head, (ws) => {
        termWss.emit('connection', ws, request, terminalId);
      });
    } else {
      socket.destroy();
    }
  });

  // ── Binary Terminal Handler (Phase 15B) ─────────────────

  termWss.on('connection', (ws, _request, terminalId) => {
    const handle = claudePool ? claudePool.getTerminalHandle(terminalId) : null;
    if (!handle) {
      ws.close(4404, 'Terminal not found');
      return;
    }

    // PTY → WS (output data)
    const dataHandler = (data) => {
      try {
        if (ws.readyState === 1) { // OPEN
          ws.send(data);
        }
      } catch { /* noop */ }
    };
    handle.on('data', dataHandler);

    // WS → PTY (user input + control messages)
    ws.on('message', (raw) => {
      const str = raw.toString();

      // Control message prefix: \x01
      if (str.charCodeAt(0) === 1) {
        try {
          const ctrl = JSON.parse(str.slice(1));
          if (ctrl.type === 'resize' && ctrl.cols > 0 && ctrl.rows > 0) {
            handle.resize(ctrl.cols, ctrl.rows);
          }
        } catch { /* ignore bad control message */ }
        return;
      }

      // Regular input
      handle.write(str);
    });

    // Close WS when PTY exits
    const exitHandler = () => {
      try {
        if (ws.readyState === 1) {
          ws.close(1000, 'Terminal exited');
        }
      } catch { /* noop */ }
    };
    handle.on('exit', exitHandler);

    // Cleanup on WS close
    ws.on('close', () => {
      handle.off('data', dataHandler);
      handle.off('exit', exitHandler);
    });
  });

  // Handle new connections
  wss.on('connection', (ws) => {
    const subscriptions = new Set();
    clientSubscriptions.set(ws, subscriptions);

    // Send welcome message
    safeSend(ws, {
      type: 'connected',
      timestamp: new Date().toISOString(),
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        safeSend(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      // Handle subscribe
      if (msg.subscribe && Array.isArray(msg.subscribe)) {
        for (const pattern of msg.subscribe) {
          if (typeof pattern === 'string') {
            subscriptions.add(pattern);
          }
        }
        safeSend(ws, {
          type: 'subscribed',
          patterns: [...subscriptions],
        });
      }

      // Handle unsubscribe
      if (msg.unsubscribe && Array.isArray(msg.unsubscribe)) {
        for (const pattern of msg.unsubscribe) {
          subscriptions.delete(pattern);
        }
        safeSend(ws, {
          type: 'subscribed',
          patterns: [...subscriptions],
        });
      }

      // Handle ping
      if (msg.type === 'ping') {
        safeSend(ws, { type: 'pong', timestamp: new Date().toISOString() });
      }
    });

    ws.on('close', () => {
      clientSubscriptions.delete(ws);
    });
  });

  // ── Event Bridge ──────────────────────────────────────────

  // All event types to bridge
  const BRIDGED_EVENTS = [
    'chain:started', 'chain:session-complete', 'chain:complete',
    'chain:error', 'chain:aborted', 'chain:assumed-complete', 'chain:deleted',
    'session:output',
    'orchestrator:started', 'orchestrator:stopped',
    'round:start', 'round:complete',
    'agent:start', 'agent:complete', 'agent:error',
    'agent:continuation',
    'orchestrator:log',
    'project:files-changed',
    'worker:spawned', 'worker:ready', 'worker:exit',
    'worker:error', 'worker:log', 'worker:unhealthy', 'worker:restarted',
    'worker:idle-killed', 'worker:circuit-open', 'worker:circuit-half-open', 'worker:max-restarts',
    'handoff:generated', 'handoff:restart',
    'coord:started', 'coord:stopped', 'coord:draining',
    'coord:assigned', 'coord:task-complete', 'coord:task-failed',
    'coord:all-complete', 'coord:budget-warning', 'coord:budget-exceeded',
    'coord:scale-up', 'coord:drain-timeout', 'coord:queue-loaded',
    'coord:worktree-created', 'coord:worktree-removed', 'coord:worktree-merged',
    'coord:conflicts-detected', 'coord:config-updated',
    'coord:rate-adjusted',
    'claude-terminal:spawned', 'claude-terminal:exit',
    'claude-terminal:error', 'claude-terminal:removed',
    'claude-terminal:respawned', 'claude-terminal:permission-changed',
    'claude-terminal:handoff', 'claude-terminal:context-warning',
    'claude-terminal:auto-handoff-changed',
    'claude-terminal:task-assigned', 'claude-terminal:task-released',
    'claude-terminal:task-completed',
    'claude-terminal:auto-dispatch', 'claude-terminal:auto-dispatch-changed',
    'shared-memory:updated', 'shared-memory:deleted',
    'shared-memory:cleared', 'shared-memory:snapshot-written',
    'terminal-message:sent', 'terminal-message:broadcast',
    'terminal-message:deleted', 'terminal-message:cleared',
  ];

  const bridgeHandlers = [];
  for (const eventName of BRIDGED_EVENTS) {
    const handler = (data) => {
      const isOutput = eventName === 'session:output';

      for (const client of wss.clients) {
        if (client.readyState !== 1) continue; // OPEN = 1

        const subs = clientSubscriptions.get(client);
        if (!subs || subs.size === 0) continue;
        if (!matchesAnyPattern(eventName, subs)) continue;

        // Throttle session:output to 1/sec per client
        if (isOutput && !outputThrottle(client)) continue;

        safeSend(client, {
          event: eventName,
          data,
        });
      }
    };
    events.on(eventName, handler);
    bridgeHandlers.push({ eventName, handler });
  }

  // Expose cleanup for shutdown/tests
  wss.cleanup = () => {
    for (const { eventName, handler } of bridgeHandlers) {
      events.off(eventName, handler);
    }
    bridgeHandlers.length = 0;

    // Close binary terminal WS connections
    for (const client of termWss.clients) {
      client.close(1001, 'Server shutting down');
    }
  };

  // Expose terminal WSS for tests/inspection
  wss.termWss = termWss;

  return wss;
}

// ── Helpers ─────────────────────────────────────────────────

function safeSend(ws, obj) {
  try {
    if (ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify(obj));
    }
  } catch (_) { /* noop */ }
}

export { matchesPattern, matchesAnyPattern };
