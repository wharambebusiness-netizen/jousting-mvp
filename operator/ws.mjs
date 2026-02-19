// ============================================================
// WebSocket Event Bridge (M4)
// ============================================================
// Bridges EventBus events to connected WebSocket clients.
// Clients subscribe to event patterns (e.g. "chain:*") and
// receive real-time JSON messages.
//
// Protocol:
//   Client → Server: { "subscribe": ["chain:*", "session:*"] }
//   Client → Server: { "unsubscribe": ["session:*"] }
//   Server → Client: { "event": "chain:started", "data": { ... } }
//   Server → Client: { "type": "subscribed", "patterns": ["chain:*"] }
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
 * @returns {WebSocketServer}
 */
export function createWebSocketHandler({ server, events }) {
  const wss = new WebSocketServer({ noServer: true });

  // Output throttle: 1 message per second per client
  const outputThrottle = createThrottle(1000);

  // Track client subscriptions
  const clientSubscriptions = new WeakMap();

  // Handle upgrade requests
  server.on('upgrade', (request, socket, head) => {
    // Only handle /ws path
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
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
    'coord:conflicts-detected',
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
        if (isOutput && !outputThrottle.shouldSend(client)) continue;

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
  };

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
