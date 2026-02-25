// ============================================================
// WebSocket Event Bridge (M4 + Phase 15B + Phase 49)
// ============================================================
// Bridges EventBus events to connected WebSocket clients.
// Clients subscribe to event patterns (e.g. "chain:*") and
// receive real-time JSON messages.
//
// Phase 15B: Binary WebSocket for Claude terminals.
// Path /ws/claude-terminal/:id carries raw PTY I/O.
// Control messages use \x01 prefix (e.g. resize).
//
// Phase 49: WebSocket Reliability
//   - Server-side heartbeat (ping/pong) with configurable interval
//   - Event replay buffer (ring buffer of last N events with seq numbers)
//   - Connection quality tracking (latency via ping-pong RTT)
//   - getStats() for connected client count and message counts
//   - Binary WS heartbeat via \x01{"type":"ping"} control prefix
//
// Protocol (JSON bridge — /ws):
//   Client → Server: { "subscribe": ["chain:*", "session:*"] }
//   Client → Server: { "unsubscribe": ["session:*"] }
//   Client → Server: { "type": "replay", "afterSeq": N }
//   Client → Server: { "type": "pong" }  ← heartbeat response
//   Server → Client: { "event": "chain:started", "data": { ... }, "seq": N }
//   Server → Client: { "type": "subscribed", "patterns": ["chain:*"] }
//   Server → Client: { "type": "ping", "ts": N }  ← heartbeat
//   Server → Client: { "type": "replay", "events": [...] }
//   Server → Client: { "type": "replay-gap", "missed": N }
//
// Protocol (binary terminal — /ws/claude-terminal/:id):
//   Client → Server: raw input text (typed by user)
//   Client → Server: \x01{"type":"resize","cols":N,"rows":N}
//   Client → Server: \x01{"type":"pong"}  ← binary heartbeat response
//   Server → Client: raw PTY output data
//   Server → Client: \x01{"type":"ping"}  ← binary heartbeat
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

// ── Replay Buffer ────────────────────────────────────────────

/**
 * Create a fixed-size ring buffer for event replay.
 * Stores events with monotonically increasing sequence numbers.
 */
function createReplayBuffer(maxSize) {
  const buffer = [];
  let seq = 0;

  return {
    push(event, data) {
      seq += 1;
      const entry = { event, data, ts: Date.now(), seq };
      if (buffer.length >= maxSize) {
        buffer.shift(); // evict oldest
      }
      buffer.push(entry);
      return seq;
    },

    /** Returns events after the given sequence number. */
    since(afterSeq) {
      return buffer.filter(e => e.seq > afterSeq);
    },

    /** Returns the oldest sequence number in the buffer (or null if empty). */
    oldestSeq() {
      return buffer.length > 0 ? buffer[0].seq : null;
    },

    /** Returns the current (most recent) sequence number. */
    currentSeq() {
      return seq;
    },

    get size() {
      return buffer.length;
    },

    reset() {
      buffer.length = 0;
      seq = 0;
    },
  };
}

// ── WebSocket Handler ───────────────────────────────────────

/**
 * Create a WebSocket auth check function.
 * Validates ?token= query parameter on upgrade.
 * @param {object} auth - Auth instance from createAuth()
 * @returns {function} Check function: (url) => { valid, id?, label? }
 */
export function createWsAuthCheck(auth) {
  return function wsAuthCheck(url) {
    if (!auth) return { valid: true };
    const token = url.searchParams.get('token');
    return auth.validateToken(token);
  };
}

/**
 * Create WebSocket server and wire it to EventBus.
 * @param {object} options
 * @param {http.Server} options.server             - HTTP server for upgrade
 * @param {EventBus}    options.events             - EventBus to bridge
 * @param {object}      [options.claudePool]       - Claude terminal pool (Phase 15B)
 * @param {object}      [options.auth]             - Auth instance for WS token validation (Phase 27)
 * @param {number}      [options.pingIntervalMs]   - Heartbeat interval in ms (default 30000)
 * @param {number}      [options.pongTimeoutMs]    - Pong timeout in ms (default 10000)
 * @param {number}      [options.replayBufferSize] - Max replay buffer entries (default 100)
 * @returns {WebSocketServer}
 */
export function createWebSocketHandler({ server, events, claudePool, auth, pingIntervalMs, pongTimeoutMs, replayBufferSize } = {}) {
  const PING_INTERVAL_MS = pingIntervalMs ?? 30000;
  const PONG_TIMEOUT_MS = pongTimeoutMs ?? 10000;
  const REPLAY_BUFFER_SIZE = replayBufferSize ?? 100;

  const wss = new WebSocketServer({ noServer: true });

  // Binary terminal WSS for PTY I/O (Phase 15B)
  const termWss = new WebSocketServer({ noServer: true });

  // Output throttle: 1 message per second per client
  const outputThrottle = createThrottle(1000);

  // Track client subscriptions
  const clientSubscriptions = new WeakMap();

  // Event replay buffer (Phase 49) — shared across all clients
  const replayBuffer = createReplayBuffer(REPLAY_BUFFER_SIZE);

  // Connection stats (Phase 49)
  const stats = {
    totalMessagesReceived: 0,
    totalMessagesSent: 0,
    replayRequests: 0,
  };

  // Heartbeat interval handle (cleared on cleanup)
  let heartbeatInterval = null;

  // WS auth check (Phase 27)
  const wsAuthCheck = createWsAuthCheck(auth);

  // Handle upgrade requests — route by path
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    // Validate auth token on WebSocket upgrade
    const authResult = wsAuthCheck(url);
    if (!authResult.valid) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

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

  // ── Binary Terminal Handler (Phase 15B + Phase 49) ───────

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
          stats.totalMessagesSent += 1;
        }
      } catch { /* noop */ }
    };
    handle.on('data', dataHandler);

    // Binary heartbeat state
    let binaryPingTimer = null;
    let binaryPongTimer = null;

    function sendBinaryPing() {
      if (ws.readyState !== 1) return;
      try {
        ws.send('\x01' + JSON.stringify({ type: 'ping', ts: Date.now() }));
        stats.totalMessagesSent += 1;
        // Schedule pong timeout
        binaryPongTimer = setTimeout(() => {
          try { ws.terminate(); } catch { /* noop */ }
        }, PONG_TIMEOUT_MS);
      } catch { /* noop */ }
    }

    // Start binary heartbeat
    if (PING_INTERVAL_MS > 0) {
      binaryPingTimer = setInterval(sendBinaryPing, PING_INTERVAL_MS);
    }

    // WS → PTY (user input + control messages)
    ws.on('message', (raw) => {
      const str = raw.toString();
      stats.totalMessagesReceived += 1;

      // Control message prefix: \x01
      if (str.charCodeAt(0) === 1) {
        try {
          const ctrl = JSON.parse(str.slice(1));
          if (ctrl.type === 'resize' && ctrl.cols > 0 && ctrl.rows > 0) {
            handle.resize(ctrl.cols, ctrl.rows);
          }
          // Handle pong for binary heartbeat
          if (ctrl.type === 'pong') {
            if (binaryPongTimer) {
              clearTimeout(binaryPongTimer);
              binaryPongTimer = null;
            }
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
      if (binaryPingTimer) { clearInterval(binaryPingTimer); binaryPingTimer = null; }
      if (binaryPongTimer) { clearTimeout(binaryPongTimer); binaryPongTimer = null; }
    });
  });

  // ── JSON WS Client Heartbeat + Replay ───────────────────

  // Per-client state stored in a WeakMap
  const clientState = new WeakMap();
  // { pongTimer: Timeout|null, pingTs: number|null }

  function safeSendTracked(ws, obj) {
    safeSend(ws, obj);
    stats.totalMessagesSent += 1;
  }

  function sendPingToClient(ws) {
    if (ws.readyState !== 1) return;
    const ts = Date.now();
    const state = clientState.get(ws);
    if (state) state.pingTs = ts;
    safeSendTracked(ws, { type: 'ping', ts });

    // Set pong timeout
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch { /* noop */ }
    }, PONG_TIMEOUT_MS);
    if (state) state.pongTimer = timer;
  }

  // Start global heartbeat interval for JSON WS clients
  if (PING_INTERVAL_MS > 0) {
    heartbeatInterval = setInterval(() => {
      for (const client of wss.clients) {
        if (client.readyState === 1) { // OPEN
          sendPingToClient(client);
        }
      }
    }, PING_INTERVAL_MS);
    // Allow process to exit even if this interval is running
    if (heartbeatInterval.unref) heartbeatInterval.unref();
  }

  // Handle new connections
  wss.on('connection', (ws) => {
    const subscriptions = new Set();
    clientSubscriptions.set(ws, subscriptions);
    clientState.set(ws, { pongTimer: null, pingTs: null, latency: null });

    // Send welcome message
    safeSendTracked(ws, {
      type: 'connected',
      timestamp: new Date().toISOString(),
    });

    ws.on('message', (raw) => {
      stats.totalMessagesReceived += 1;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        safeSendTracked(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      // Handle subscribe
      if (msg.subscribe && Array.isArray(msg.subscribe)) {
        for (const pattern of msg.subscribe) {
          if (typeof pattern === 'string') {
            subscriptions.add(pattern);
          }
        }
        safeSendTracked(ws, {
          type: 'subscribed',
          patterns: [...subscriptions],
        });
      }

      // Handle unsubscribe
      if (msg.unsubscribe && Array.isArray(msg.unsubscribe)) {
        for (const pattern of msg.unsubscribe) {
          subscriptions.delete(pattern);
        }
        safeSendTracked(ws, {
          type: 'subscribed',
          patterns: [...subscriptions],
        });
      }

      // Handle client-initiated ping (backward compat — existing test sends ping, expects pong)
      if (msg.type === 'ping') {
        safeSendTracked(ws, { type: 'pong', timestamp: new Date().toISOString() });
      }

      // Handle pong (response to server-sent ping heartbeat)
      if (msg.type === 'pong') {
        const state = clientState.get(ws);
        if (state) {
          // Clear pong timeout
          if (state.pongTimer) {
            clearTimeout(state.pongTimer);
            state.pongTimer = null;
          }
          // Measure latency
          if (state.pingTs !== null) {
            state.latency = Date.now() - state.pingTs;
            state.pingTs = null;
          }
        }
      }

      // Handle replay request (Phase 49)
      if (msg.type === 'replay') {
        stats.replayRequests += 1;
        const afterSeq = typeof msg.afterSeq === 'number' ? msg.afterSeq : -1;
        const oldest = replayBuffer.oldestSeq();
        const current = replayBuffer.currentSeq();

        // If afterSeq is older than the oldest buffered event, report a gap
        if (oldest !== null && afterSeq < oldest - 1) {
          const missed = oldest - 1 - afterSeq;
          safeSendTracked(ws, { type: 'replay-gap', missed });
        } else {
          // Return all events since afterSeq, filtered by subscriptions
          const allEvents = replayBuffer.since(afterSeq);
          const subs = clientSubscriptions.get(ws);
          const filtered = subs && subs.size > 0
            ? allEvents.filter(e => matchesAnyPattern(e.event, subs))
            : allEvents;
          safeSendTracked(ws, { type: 'replay', events: filtered, currentSeq: current });
        }
      }
    });

    ws.on('close', () => {
      const state = clientState.get(ws);
      if (state && state.pongTimer) {
        clearTimeout(state.pongTimer);
      }
      clientSubscriptions.delete(ws);
      clientState.delete(ws);
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
    'claude-terminal:auto-complete', 'claude-terminal:auto-complete-changed',
    'claude-terminal:swarm-started', 'claude-terminal:swarm-stopped',
    'claude-terminal:swarm-scaled-up', 'claude-terminal:swarm-scaled-down',
    'claude-terminal:task-recovered',
    'claude-terminal:capabilities-changed',
    'shared-memory:updated', 'shared-memory:deleted',
    'shared-memory:cleared', 'shared-memory:snapshot-written',
    'terminal-message:sent', 'terminal-message:broadcast',
    'terminal-message:deleted', 'terminal-message:cleared',
    'audit:recorded',
    'dlq:added', 'dlq:retried', 'dlq:dismissed',
    'webhook:delivered', 'webhook:failed',
    'notification:new',
    'cost:alert',
    'perf:slow-request',
  ];

  const bridgeHandlers = [];
  for (const eventName of BRIDGED_EVENTS) {
    const handler = (data) => {
      const isOutput = eventName === 'session:output';

      // Add event to replay buffer (Phase 49) — skip high-volume output events
      let seq;
      if (!isOutput) {
        seq = replayBuffer.push(eventName, data);
      }

      for (const client of wss.clients) {
        if (client.readyState !== 1) continue; // OPEN = 1

        const subs = clientSubscriptions.get(client);
        if (!subs || subs.size === 0) continue;
        if (!matchesAnyPattern(eventName, subs)) continue;

        // Throttle session:output to 1/sec per client
        if (isOutput && !outputThrottle(client)) continue;

        // Include seq number for non-output events so client can track replay position
        const msg = isOutput
          ? { event: eventName, data }
          : { event: eventName, data, seq };

        safeSend(client, msg);
        stats.totalMessagesSent += 1;
      }
    };
    events.on(eventName, handler);
    bridgeHandlers.push({ eventName, handler });
  }

  // ── Stats API (Phase 49) ───────────────────────────────────

  wss.getStats = () => ({
    connectedClients: wss.clients.size,
    binaryClients: termWss.clients.size,
    totalMessagesReceived: stats.totalMessagesReceived,
    totalMessagesSent: stats.totalMessagesSent,
    replayRequests: stats.replayRequests,
  });

  // Expose cleanup for shutdown/tests
  wss.cleanup = () => {
    // Clear heartbeat interval
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    // Clear any pending pong timers
    for (const client of wss.clients) {
      const state = clientState.get(client);
      if (state && state.pongTimer) {
        clearTimeout(state.pongTimer);
      }
    }

    for (const { eventName, handler } of bridgeHandlers) {
      events.off(eventName, handler);
    }
    bridgeHandlers.length = 0;

    // Reset stats
    stats.totalMessagesReceived = 0;
    stats.totalMessagesSent = 0;
    stats.replayRequests = 0;

    // Close binary terminal WS connections
    for (const client of termWss.clients) {
      client.close(1001, 'Server shutting down');
    }
  };

  // Expose terminal WSS for tests/inspection
  wss.termWss = termWss;

  // Expose replay buffer for tests
  wss.replayBuffer = replayBuffer;

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
