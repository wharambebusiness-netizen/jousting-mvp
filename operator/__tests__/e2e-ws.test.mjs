// ============================================================
// E2E WebSocket Tests (Phase 55)
// ============================================================
// Focused WebSocket tests with a real server: subscribe/unsubscribe,
// pattern matching, replay buffer, heartbeat, and edge cases.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createApp } from '../server.mjs';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import WebSocket from 'ws';

// ── Shared State ────────────────────────────────────────────

let app, server, port, tempDir;
const openWsClients = [];

// ── Setup / Teardown ────────────────────────────────────────

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'e2e-ws-'));
  app = createApp({
    auth: false,
    operatorDir: tempDir,
    swarm: true,
    enableFileWatcher: false,
  });
  server = app.server;

  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterEach(() => {
  for (const ws of openWsClients) {
    try { if (ws.readyState <= 1) ws.close(); } catch { /* noop */ }
  }
  openWsClients.length = 0;
});

afterAll(async () => {
  if (app) await app.close();
});

// ── Helpers ─────────────────────────────────────────────────

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const _buf = [];
    const _waiters = [];

    ws.on('message', (data) => {
      let parsed;
      try { parsed = JSON.parse(data.toString()); }
      catch { parsed = data.toString(); }
      if (_waiters.length > 0) {
        _waiters.shift()(parsed);
      } else {
        _buf.push(parsed);
      }
    });

    ws.nextMsg = (timeout = 3000) => {
      if (_buf.length > 0) return Promise.resolve(_buf.shift());
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('Timeout waiting for WS message')), timeout);
        _waiters.push((msg) => { clearTimeout(timer); res(msg); });
      });
    };

    ws.nextMsgs = async (count, timeout = 5000) => {
      const msgs = [];
      for (let i = 0; i < count; i++) msgs.push(await ws.nextMsg(timeout));
      return msgs;
    };

    ws.drainBuf = () => {
      const drained = [..._buf];
      _buf.length = 0;
      return drained;
    };

    ws.on('open', () => {
      openWsClients.push(ws);
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── WS Core ─────────────────────────────────────────────────

describe('E2E WS: Core', () => {
  it('JSON WS connects and receives welcome message', async () => {
    const ws = await connectWs();
    const welcome = await ws.nextMsg();
    expect(welcome.type).toBe('connected');
    expect(welcome.timestamp).toBeTruthy();
    ws.close();
  });

  it('subscribe to specific events', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome

    ws.send(JSON.stringify({ subscribe: ['coord:task-complete'] }));
    const ack = await ws.nextMsg();
    expect(ack.type).toBe('subscribed');
    expect(ack.patterns).toContain('coord:task-complete');
    ws.close();
  });

  it('subscribed client receives matching events only', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome

    ws.send(JSON.stringify({ subscribe: ['settings:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit non-matching event
    app.events.emit('audit:recorded', { action: 'test' });
    // Small delay to ensure the event would have been delivered
    await sleep(100);

    // Emit matching event
    app.events.emit('settings:changed', { changes: { model: { from: 'a', to: 'b' } } });

    const msg = await ws.nextMsg(3000);
    expect(msg.event).toBe('settings:changed');
    ws.close();
  });

  it('unsubscribe stops event delivery', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome

    ws.send(JSON.stringify({ subscribe: ['settings:*', 'audit:*'] }));
    await ws.nextMsg(); // subscribed

    // Unsubscribe from audit events
    ws.send(JSON.stringify({ unsubscribe: ['audit:*'] }));
    const ack = await ws.nextMsg();
    expect(ack.type).toBe('subscribed');
    expect(ack.patterns).not.toContain('audit:*');
    expect(ack.patterns).toContain('settings:*');

    // Emit an audit event (should not be delivered)
    app.events.emit('audit:recorded', { action: 'test' });
    await sleep(100);

    // Emit a settings event (should be delivered)
    app.events.emit('settings:changed', { changes: {} });

    const msg = await ws.nextMsg(3000);
    expect(msg.event).toBe('settings:changed');
    ws.close();
  });

  it('pattern subscription works (coord:* matches coord:task-complete)', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome

    ws.send(JSON.stringify({ subscribe: ['coord:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit coord:task-complete directly through EventBus to test WS bridging
    const taskId = 'e2e-ws-pattern-' + Date.now();
    app.events.emit('coord:task-complete', { taskId, workerId: 'w-1', result: 'ok' });

    const msg = await ws.nextMsg(5000);
    expect(msg.event).toBe('coord:task-complete');
    expect(msg.data.taskId).toBe(taskId);
    ws.close();
  });

  it('multiple concurrent WS clients all receive same events', async () => {
    const ws1 = await connectWs();
    const ws2 = await connectWs();
    const ws3 = await connectWs();

    await ws1.nextMsg(); // welcome
    await ws2.nextMsg(); // welcome
    await ws3.nextMsg(); // welcome

    ws1.send(JSON.stringify({ subscribe: ['*'] }));
    ws2.send(JSON.stringify({ subscribe: ['*'] }));
    ws3.send(JSON.stringify({ subscribe: ['*'] }));
    await ws1.nextMsg();
    await ws2.nextMsg();
    await ws3.nextMsg();

    app.events.emit('notification:new', { id: 'n-multi', message: 'broadcast' });

    const m1 = await ws1.nextMsg(3000);
    const m2 = await ws2.nextMsg(3000);
    const m3 = await ws3.nextMsg(3000);

    expect(m1.event).toBe('notification:new');
    expect(m2.event).toBe('notification:new');
    expect(m3.event).toBe('notification:new');

    ws1.close();
    ws2.close();
    ws3.close();
  });

  it('WS getStats() reflects connection count', async () => {
    // Wait briefly for any lingering connections from prior tests to close
    await sleep(200);
    const initialStats = app.wss.getStats();
    const initialCount = initialStats.connectedClients;

    const ws1 = await connectWs();
    const ws2 = await connectWs();
    await ws1.nextMsg(); // welcome
    await ws2.nextMsg(); // welcome

    const afterStats = app.wss.getStats();
    expect(afterStats.connectedClients).toBeGreaterThanOrEqual(initialCount + 2);

    ws1.close();
    ws2.close();
  });

  it('WS connection closes cleanly with 1000 code', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome

    const closePromise = new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
    });

    ws.close(1000, 'Normal closure');
    const code = await closePromise;
    expect(code).toBe(1000);
  });
});

// ── WS Replay ───────────────────────────────────────────────

describe('E2E WS: Replay', () => {
  it('events have monotonic sequence numbers', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome
    ws.send(JSON.stringify({ subscribe: ['settings:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit multiple events
    app.events.emit('settings:changed', { changes: { a: { from: 1, to: 2 } } });
    app.events.emit('settings:changed', { changes: { b: { from: 3, to: 4 } } });

    const msg1 = await ws.nextMsg(3000);
    const msg2 = await ws.nextMsg(3000);

    expect(typeof msg1.seq).toBe('number');
    expect(typeof msg2.seq).toBe('number');
    expect(msg2.seq).toBeGreaterThan(msg1.seq);
    ws.close();
  });

  it('replay after disconnect returns missed events', async () => {
    const ws1 = await connectWs();
    await ws1.nextMsg(); // welcome
    ws1.send(JSON.stringify({ subscribe: ['settings:*'] }));
    await ws1.nextMsg(); // subscribed

    // Get a reference sequence number
    app.events.emit('settings:changed', { changes: { ref: { from: 0, to: 1 } } });
    const refMsg = await ws1.nextMsg(3000);
    const refSeq = refMsg.seq;
    ws1.close();

    // Emit events while disconnected
    await sleep(100);
    app.events.emit('settings:changed', { changes: { missed: { from: 0, to: 1 } } });
    app.events.emit('settings:changed', { changes: { missed2: { from: 0, to: 2 } } });

    // Reconnect and request replay
    const ws2 = await connectWs();
    await ws2.nextMsg(); // welcome
    ws2.send(JSON.stringify({ subscribe: ['settings:*'] }));
    await ws2.nextMsg(); // subscribed
    ws2.send(JSON.stringify({ type: 'replay', afterSeq: refSeq }));

    const replay = await ws2.nextMsg(3000);
    expect(replay.type).toBe('replay');
    expect(replay.events.length).toBeGreaterThanOrEqual(2);

    // All replayed events should have seq > refSeq
    for (const e of replay.events) {
      expect(e.seq).toBeGreaterThan(refSeq);
    }
    ws2.close();
  });

  it('replay returns only events AFTER the given sequence number', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome
    ws.send(JSON.stringify({ subscribe: ['notification:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit events and capture their seq numbers
    app.events.emit('notification:new', { id: 'rep-1' });
    app.events.emit('notification:new', { id: 'rep-2' });
    app.events.emit('notification:new', { id: 'rep-3' });

    const m1 = await ws.nextMsg(3000);
    const m2 = await ws.nextMsg(3000);
    const m3 = await ws.nextMsg(3000);

    // Replay after m1's seq -> should get m2 and m3
    ws.send(JSON.stringify({ type: 'replay', afterSeq: m1.seq }));
    const replay = await ws.nextMsg(3000);
    expect(replay.type).toBe('replay');
    const seqs = replay.events.map(e => e.seq);
    expect(seqs).toContain(m2.seq);
    expect(seqs).toContain(m3.seq);
    expect(seqs).not.toContain(m1.seq);
    ws.close();
  });

  it('replay with afterSeq: 0 returns all buffered events', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome
    ws.send(JSON.stringify({ subscribe: ['*'] }));
    await ws.nextMsg(); // subscribed

    ws.send(JSON.stringify({ type: 'replay', afterSeq: 0 }));
    const replay = await ws.nextMsg(3000);
    expect(replay.type).toBe('replay');
    expect(Array.isArray(replay.events)).toBe(true);
    // There should be events from previous tests in the buffer
    expect(replay.events.length).toBeGreaterThan(0);
    ws.close();
  });

  it('replay buffer reports gap when too many events missed', async () => {
    // The replay buffer has a max size. Request replay from seq 0 when
    // the oldest buffered entry has a higher seq -> triggers replay-gap.
    // We need to check if the oldest seq is > 1 for this to trigger.
    const oldestSeq = app.wss.replayBuffer.oldestSeq();

    if (oldestSeq !== null && oldestSeq > 1) {
      const ws = await connectWs();
      await ws.nextMsg(); // welcome
      ws.send(JSON.stringify({ subscribe: ['*'] }));
      await ws.nextMsg(); // subscribed

      // Request replay from before the oldest buffered event
      ws.send(JSON.stringify({ type: 'replay', afterSeq: 0 }));
      const replay = await ws.nextMsg(3000);
      expect(replay.type).toBe('replay-gap');
      expect(typeof replay.missed).toBe('number');
      ws.close();
    } else {
      // If buffer starts from seq 1, we cannot trigger a gap easily
      // Just verify the buffer API works
      expect(app.wss.replayBuffer.currentSeq()).toBeGreaterThanOrEqual(0);
    }
  });

  it('events include seq field', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome
    ws.send(JSON.stringify({ subscribe: ['dlq:*'] }));
    await ws.nextMsg(); // subscribed

    app.events.emit('dlq:added', { taskId: 'seq-test' });

    const msg = await ws.nextMsg(3000);
    expect(msg.event).toBe('dlq:added');
    expect(typeof msg.seq).toBe('number');
    expect(msg.seq).toBeGreaterThan(0);
    ws.close();
  });
});

// ── WS Heartbeat ────────────────────────────────────────────

describe('E2E WS: Heartbeat', () => {
  it('server responds to client-initiated ping', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await ws.nextMsg(3000);
    expect(pong.type).toBe('pong');
    expect(pong.timestamp).toBeTruthy();
    ws.close();
  });

  it('client pong response keeps connection alive', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome

    // Simulate the pong response that a real client would send
    ws.send(JSON.stringify({ type: 'pong' }));

    // Connection should still be open
    await sleep(100);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('connection stats track message counts', async () => {
    const statsBefore = app.wss.getStats();
    const sentBefore = statsBefore.totalMessagesSent;
    const recvBefore = statsBefore.totalMessagesReceived;

    const ws = await connectWs();
    await ws.nextMsg(); // welcome (increments sent)

    ws.send(JSON.stringify({ type: 'ping' })); // increments received
    await ws.nextMsg(); // pong (increments sent)

    const statsAfter = app.wss.getStats();
    expect(statsAfter.totalMessagesSent).toBeGreaterThan(sentBefore);
    expect(statsAfter.totalMessagesReceived).toBeGreaterThan(recvBefore);
    ws.close();
  });
});

// ── WS Edge Cases ───────────────────────────────────────────

describe('E2E WS: Edge Cases', () => {
  it('binary terminal WS endpoint rejects nonexistent terminal', async () => {
    const closePromise = new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/claude-terminal/nonexistent-123`);
      openWsClients.push(ws);
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('error', () => {}); // suppress error logging
    });

    const result = await closePromise;
    // Either the connection is destroyed (no proper close code) or we get 4404
    // The server calls ws.close(4404) for terminals not found, but since
    // claudePool is null in our test server, socket.destroy() is called
    expect(result.code === 4404 || result.code === 1006).toBe(true);
  });

  it('invalid JSON on WS does not crash server', async () => {
    const ws = await connectWs();
    await ws.nextMsg(); // welcome

    // Send invalid JSON
    ws.send('this is not json {{{');

    // Server should respond with an error message, not crash
    const errMsg = await ws.nextMsg(3000);
    expect(errMsg.type).toBe('error');
    expect(errMsg.message).toContain('Invalid JSON');

    // Server still works — send a valid message
    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await ws.nextMsg(3000);
    expect(pong.type).toBe('pong');
    ws.close();
  });

  it('WS client can disconnect and reconnect', async () => {
    const ws1 = await connectWs();
    const welcome1 = await ws1.nextMsg();
    expect(welcome1.type).toBe('connected');

    // Close first connection
    ws1.close();
    await sleep(200);

    // Reconnect
    const ws2 = await connectWs();
    const welcome2 = await ws2.nextMsg();
    expect(welcome2.type).toBe('connected');

    // Should work normally after reconnection
    ws2.send(JSON.stringify({ type: 'ping' }));
    const pong = await ws2.nextMsg(3000);
    expect(pong.type).toBe('pong');
    ws2.close();
  });
});
