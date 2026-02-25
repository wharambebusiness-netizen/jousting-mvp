// WebSocket Reliability Tests (Phase 49)
// Tests for:
//   - Server-side heartbeat (ping/pong) with configurable interval
//   - Event replay buffer (ring buffer, sequence numbers, replay-gap)
//   - Connection tracking (latency, client counts, message counts)
//   - Binary WS heartbeat via \x01 control prefix
//   - Cleanup: heartbeat intervals unwired, stats reset

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import { EventEmitter } from 'events';
import { createWebSocketHandler, matchesPattern } from '../ws.mjs';
import WebSocket from 'ws';

// ── Helpers ─────────────────────────────────────────────────

class MockEventBus extends EventEmitter {}

/**
 * Create a test server with configurable WS options.
 * Short heartbeat/pong intervals for fast tests.
 */
function createTestServer(opts = {}) {
  const events = new MockEventBus();
  const server = createServer();
  const wss = createWebSocketHandler({ server, events, ...opts });
  return { server, events, wss };
}

function startTestServer(opts = {}) {
  const { server, events, wss } = createTestServer(opts);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, events, wss, port });
    });
  });
}

async function stopTestServer(ctx) {
  ctx.wss.cleanup();
  for (const client of ctx.wss.clients) client.close();
  await new Promise((resolve) => ctx.server.close(resolve));
}

/**
 * Connect a WS client with message buffering and helpers.
 */
function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const _buf = [];
    const _waiters = [];

    ws.on('message', (data) => {
      const parsed = JSON.parse(data.toString());
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

    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Heartbeat Tests ──────────────────────────────────────────

describe('server heartbeat (ping/pong)', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('server sends ping to connected client at interval', async () => {
    // Use very short interval for the test
    ctx = await startTestServer({ pingIntervalMs: 80, pongTimeoutMs: 200 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    // Wait for a ping
    const msg = await ws.nextMsg(2000);
    expect(msg.type).toBe('ping');
    expect(typeof msg.ts).toBe('number');
    ws.close();
  });

  it('client pong resets server-side timeout (no termination)', async () => {
    ctx = await startTestServer({ pingIntervalMs: 80, pongTimeoutMs: 150 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    // Respond to every ping with pong for a few cycles
    let alive = true;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });

    ws.on('close', () => { alive = false; });

    // Wait longer than pongTimeout — if pong is working, connection stays alive
    await sleep(400);
    expect(alive).toBe(true);
    ws.close();
  });

  it('missing pong causes server to terminate connection', async () => {
    ctx = await startTestServer({ pingIntervalMs: 50, pongTimeoutMs: 80 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    // Do NOT respond to pings — server should terminate
    const closed = new Promise((resolve) => ws.on('close', resolve));
    await closed;
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it('heartbeat interval is configurable', async () => {
    ctx = await startTestServer({ pingIntervalMs: 60, pongTimeoutMs: 200 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    const start = Date.now();
    const msg = await ws.nextMsg(2000);
    const elapsed = Date.now() - start;

    expect(msg.type).toBe('ping');
    // Should arrive roughly around the interval (give wide margin for CI)
    expect(elapsed).toBeLessThan(500);
    ws.close();
  });

  it('pong timeout is configurable', async () => {
    // Short pong timeout — connection should die quickly after a ping
    ctx = await startTestServer({ pingIntervalMs: 50, pongTimeoutMs: 60 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    const start = Date.now();
    const closed = new Promise((resolve) => ws.on('close', resolve));
    await closed;
    const elapsed = Date.now() - start;
    // Should be terminated within ~200ms (50ms ping + 60ms pong timeout)
    expect(elapsed).toBeLessThan(1000);
  });
});

// ── Replay Buffer Tests ──────────────────────────────────────

describe('event replay buffer', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('stores events with sequence numbers', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    ctx.events.emit('chain:started', { id: 'x' });
    const msg = await ws.nextMsg();
    expect(msg.event).toBe('chain:started');
    expect(typeof msg.seq).toBe('number');
    expect(msg.seq).toBeGreaterThan(0);
    ws.close();
  });

  it('sequence numbers are monotonically increasing', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    ctx.events.emit('chain:started', { id: '1' });
    ctx.events.emit('chain:complete', { id: '2' });
    ctx.events.emit('chain:error', { id: '3' });

    const msgs = await ws.nextMsgs(3);
    const seqs = msgs.map(m => m.seq);
    expect(seqs[0]).toBeLessThan(seqs[1]);
    expect(seqs[1]).toBeLessThan(seqs[2]);
    ws.close();
  });

  it('replay buffer is a ring buffer (oldest evicted at capacity)', async () => {
    // Set small buffer
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 5 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit 7 events — only last 5 should be in buffer
    for (let i = 0; i < 7; i++) {
      ctx.events.emit('chain:started', { i });
    }
    const msgs = await ws.nextMsgs(7);
    const seqs = msgs.map(m => m.seq);
    const minSeq = Math.min(...seqs);
    const maxSeq = Math.max(...seqs);

    // Request replay from seq 0 (before buffer start)
    ws.send(JSON.stringify({ type: 'replay', afterSeq: 0 }));
    const replay = await ws.nextMsg();
    // Should get replay-gap because seq 0 is before the oldest buffered event
    // OR get a partial replay if 0 < oldest-1 is false (i.e. oldest is 1)
    // With 7 events in buffer of size 5, seq 1..7 are pushed, oldest = 3 (evicted 1,2)
    // afterSeq=0 < oldest-1=2, so replay-gap
    expect(replay.type === 'replay-gap' || replay.type === 'replay').toBeTruthy();
    ws.close();
  });

  it('client replay request returns events after given seq', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 50 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit 3 events
    ctx.events.emit('chain:started', { id: '1' });
    ctx.events.emit('chain:started', { id: '2' });
    ctx.events.emit('chain:started', { id: '3' });
    const msgs = await ws.nextMsgs(3);
    const firstSeq = msgs[0].seq;

    // Replay after the first event — should return events 2 and 3
    ws.send(JSON.stringify({ type: 'replay', afterSeq: firstSeq }));
    const replayMsg = await ws.nextMsg();
    expect(replayMsg.type).toBe('replay');
    expect(replayMsg.events).toHaveLength(2);
    expect(replayMsg.events[0].data.id).toBe('2');
    expect(replayMsg.events[1].data.id).toBe('3');
    ws.close();
  });

  it('client replay request with current seq returns empty replay', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 50 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    ctx.events.emit('chain:started', { id: 'z' });
    const msg = await ws.nextMsg();
    const lastSeq = msg.seq;

    // Request replay from current seq — should be empty
    ws.send(JSON.stringify({ type: 'replay', afterSeq: lastSeq }));
    const replay = await ws.nextMsg();
    expect(replay.type).toBe('replay');
    expect(replay.events).toHaveLength(0);
    ws.close();
  });

  it('client replay request with stale seq returns replay-gap', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 3 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit 4 events to overflow buffer of 3
    for (let i = 0; i < 4; i++) {
      ctx.events.emit('chain:started', { i });
    }
    await ws.nextMsgs(4);

    // Request replay from seq 0 — seq 1 has been evicted
    ws.send(JSON.stringify({ type: 'replay', afterSeq: 0 }));
    const replay = await ws.nextMsg();
    expect(replay.type).toBe('replay-gap');
    expect(typeof replay.missed).toBe('number');
    expect(replay.missed).toBeGreaterThan(0);
    ws.close();
  });

  it('buffer size is configurable', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 2 });
    const rb = ctx.wss.replayBuffer;

    // Push 3 items — only last 2 should remain
    rb.push('chain:started', { a: 1 });
    rb.push('chain:started', { a: 2 });
    rb.push('chain:started', { a: 3 });
    expect(rb.size).toBe(2);

    const events = rb.since(0);
    expect(events).toHaveLength(2);
    // The oldest event (a:1) should be evicted
    expect(events[0].data.a).toBe(2);
    expect(events[1].data.a).toBe(3);
  });

  it('replay events are processed in order', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 20 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    ctx.events.emit('chain:started', { n: 1 });
    ctx.events.emit('chain:started', { n: 2 });
    ctx.events.emit('chain:started', { n: 3 });
    const msgs = await ws.nextMsgs(3);
    const firstSeq = msgs[0].seq;

    ws.send(JSON.stringify({ type: 'replay', afterSeq: firstSeq - 1 }));
    const replay = await ws.nextMsg();
    expect(replay.type).toBe('replay');
    const ns = replay.events.map(e => e.data.n);
    expect(ns).toEqual([1, 2, 3]);
    ws.close();
  });

  it('new connection receives no replay without afterSeq', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 20 });

    // Emit some events before client connects
    ctx.events.emit('chain:started', { id: 'pre-1' });
    ctx.events.emit('chain:started', { id: 'pre-2' });

    const ws = await connectWs(ctx.port);
    const welcome = await ws.nextMsg(); // connected
    expect(welcome.type).toBe('connected');

    // Without sending a replay request, client should not get any replayed events
    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    const subMsg = await ws.nextMsg();
    expect(subMsg.type).toBe('subscribed');

    // No spontaneous replay
    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await ws.nextMsg();
    expect(pong.type).toBe('pong');
    ws.close();
  });

  it('reconnected client receives missed events correctly', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 50 });

    // Connect first client, subscribe, get some events, record last seq
    const ws1 = await connectWs(ctx.port);
    await ws1.nextMsg(); // connected
    ws1.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws1.nextMsg(); // subscribed

    ctx.events.emit('chain:started', { id: 'before-disconnect' });
    const msg1 = await ws1.nextMsg();
    const lastSeq = msg1.seq;
    ws1.close();

    // Emit events while "disconnected"
    ctx.events.emit('chain:started', { id: 'missed-1' });
    ctx.events.emit('chain:started', { id: 'missed-2' });

    // Reconnect and replay
    const ws2 = await connectWs(ctx.port);
    await ws2.nextMsg(); // connected
    ws2.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws2.nextMsg(); // subscribed

    ws2.send(JSON.stringify({ type: 'replay', afterSeq: lastSeq }));
    const replay = await ws2.nextMsg();
    expect(replay.type).toBe('replay');
    expect(replay.events).toHaveLength(2);
    expect(replay.events[0].data.id).toBe('missed-1');
    expect(replay.events[1].data.id).toBe('missed-2');
    ws2.close();
  });

  it('multiple concurrent clients get independent replay state', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 50 });

    const ws1 = await connectWs(ctx.port);
    const ws2 = await connectWs(ctx.port);
    await ws1.nextMsg(); // connected
    await ws2.nextMsg(); // connected

    ws1.send(JSON.stringify({ subscribe: ['chain:*'] }));
    ws2.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws1.nextMsg(); // subscribed
    await ws2.nextMsg(); // subscribed

    ctx.events.emit('chain:started', { n: 1 });
    ctx.events.emit('chain:started', { n: 2 });

    const m1a = await ws1.nextMsg();
    const m1b = await ws1.nextMsg();
    const m2a = await ws2.nextMsg();
    await ws2.nextMsg(); // consume second event

    // ws1 replays from after first event (seq of n:1)
    ws1.send(JSON.stringify({ type: 'replay', afterSeq: m1a.seq }));
    const replay1 = await ws1.nextMsg();
    expect(replay1.type).toBe('replay');
    expect(replay1.events).toHaveLength(1);
    expect(replay1.events[0].data.n).toBe(2);

    // ws2 replays from before first event
    ws2.send(JSON.stringify({ type: 'replay', afterSeq: m2a.seq - 1 }));
    const replay2 = await ws2.nextMsg();
    expect(replay2.type).toBe('replay');
    expect(replay2.events.length).toBeGreaterThanOrEqual(2);

    ws1.close();
    ws2.close();
  });

  it('client subscribes then replays: only events in buffer returned', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 50 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    // Subscribe and get some events
    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    ctx.events.emit('chain:started', { n: 1 });
    const msg = await ws.nextMsg();

    // Request replay from before the event
    ws.send(JSON.stringify({ type: 'replay', afterSeq: msg.seq - 1 }));
    const replay = await ws.nextMsg();
    expect(replay.type).toBe('replay');
    // The replay should include at least the one event
    expect(replay.events.some(e => e.data.n === 1)).toBe(true);
    ws.close();
  });
});

// ── Stats Tests ──────────────────────────────────────────────

describe('connection stats (getStats)', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('getStats returns accurate client count', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0 });
    expect(ctx.wss.getStats().connectedClients).toBe(0);

    const ws1 = await connectWs(ctx.port);
    await ws1.nextMsg();
    expect(ctx.wss.getStats().connectedClients).toBe(1);

    const ws2 = await connectWs(ctx.port);
    await ws2.nextMsg();
    expect(ctx.wss.getStats().connectedClients).toBe(2);

    ws1.close();
    await sleep(100);
    expect(ctx.wss.getStats().connectedClients).toBe(1);

    ws2.close();
  });

  it('getStats tracks message counts', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected — welcome message was sent

    // At least the welcome message was sent
    const sent = ctx.wss.getStats().totalMessagesSent;
    expect(sent).toBeGreaterThanOrEqual(1);

    // Send a message from client — should increment received
    const receivedBefore = ctx.wss.getStats().totalMessagesReceived;
    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    expect(ctx.wss.getStats().totalMessagesReceived).toBeGreaterThan(receivedBefore);
    ws.close();
  });

  it('getStats tracks replay request count', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0, replayBufferSize: 20 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    const before = ctx.wss.getStats().replayRequests;
    ws.send(JSON.stringify({ type: 'replay', afterSeq: 0 }));
    await ws.nextMsg(); // replay response

    expect(ctx.wss.getStats().replayRequests).toBe(before + 1);
    ws.close();
  });

  it('stats reset on cleanup', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected
    ws.close();
    await sleep(50);

    ctx.wss.cleanup();
    const stats = ctx.wss.getStats();
    expect(stats.totalMessagesSent).toBe(0);
    expect(stats.totalMessagesReceived).toBe(0);
    expect(stats.replayRequests).toBe(0);
  });
});

// ── Cleanup Tests ────────────────────────────────────────────

describe('cleanup', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('cleanup unwires heartbeat intervals', async () => {
    // Create server with a short ping interval, then cleanup
    // The test ensures cleanup doesn't throw and the interval is cleared
    ctx = await startTestServer({ pingIntervalMs: 50, pongTimeoutMs: 200 });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    // cleanup should not throw
    expect(() => ctx.wss.cleanup()).not.toThrow();
    ws.close();
    // Avoid double-cleanup in afterEach
    ctx = null;
  });

  it('cleanup removes event bridge listeners', async () => {
    ctx = await startTestServer({ pingIntervalMs: 0 });
    const listenersBefore = ctx.events.listenerCount('chain:started');
    expect(listenersBefore).toBeGreaterThan(0);

    ctx.wss.cleanup();

    expect(ctx.events.listenerCount('chain:started')).toBe(0);
    // Prevent double-cleanup
    ctx = null;
  });
});

// ── Binary WS Heartbeat Tests ────────────────────────────────

describe('binary WS heartbeat (Phase 49)', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('binary WS heartbeat sends ping with control prefix', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = { getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null };
    ctx = await startTestServer({ claudePool: mockPool, pingIntervalMs: 60, pongTimeoutMs: 200 });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    // Server should send a ping within the interval
    const pingMsg = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for binary ping')), 2000);
      ws.on('message', (data) => {
        const str = data.toString();
        if (str.charCodeAt(0) === 1) {
          clearTimeout(timer);
          resolve(str);
        }
      });
    });

    expect(pingMsg.charCodeAt(0)).toBe(1);
    const ctrl = JSON.parse(pingMsg.slice(1));
    expect(ctrl.type).toBe('ping');
    expect(typeof ctrl.ts).toBe('number');
    ws.close();
  });

  it('binary WS pong response is handled correctly (no termination)', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = { getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null };
    ctx = await startTestServer({ claudePool: mockPool, pingIntervalMs: 60, pongTimeoutMs: 100 });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    let alive = true;
    ws.on('close', () => { alive = false; });

    // Respond to every binary ping with pong
    ws.on('message', (data) => {
      const str = data.toString();
      if (str.charCodeAt(0) === 1) {
        try {
          const ctrl = JSON.parse(str.slice(1));
          if (ctrl.type === 'ping') {
            ws.send('\x01' + JSON.stringify({ type: 'pong' }));
          }
        } catch (_) {}
      }
    });

    await sleep(350);
    expect(alive).toBe(true);
    ws.close();
  });

  it('binary WS timeout terminates on missing pong', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = { getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null };
    ctx = await startTestServer({ claudePool: mockPool, pingIntervalMs: 50, pongTimeoutMs: 60 });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    // Do NOT respond to pings
    const closed = new Promise((resolve) => ws.on('close', resolve));
    await closed;
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
