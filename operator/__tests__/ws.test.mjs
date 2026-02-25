// WebSocket Event Bridge Tests (Phase 16.2)
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import { EventEmitter } from 'events';
import { createWebSocketHandler, matchesPattern, matchesAnyPattern } from '../ws.mjs';
import WebSocket from 'ws';

// ── Helpers ─────────────────────────────────────────────────

class MockEventBus extends EventEmitter {}

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
 * Connect a WS client with a built-in message buffer.
 * Starts queuing messages immediately (before 'open'), so the welcome
 * message is never lost to a race condition.
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

    /** Read next message (resolves immediately if buffered). */
    ws.nextMsg = (timeout = 2000) => {
      if (_buf.length > 0) return Promise.resolve(_buf.shift());
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('Timeout waiting for message')), timeout);
        _waiters.push((msg) => { clearTimeout(timer); res(msg); });
      });
    };

    /** Read N messages sequentially. */
    ws.nextMsgs = async (count, timeout = 3000) => {
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

// ── Pattern Matching (pure functions) ───────────────────────

describe('matchesPattern', () => {
  it('matches exact event name', () => {
    expect(matchesPattern('chain:started', 'chain:started')).toBe(true);
  });

  it('does not match different exact names', () => {
    expect(matchesPattern('chain:started', 'chain:stopped')).toBe(false);
  });

  it('matches wildcard * (all events)', () => {
    expect(matchesPattern('chain:started', '*')).toBe(true);
    expect(matchesPattern('session:output', '*')).toBe(true);
    expect(matchesPattern('anything', '*')).toBe(true);
  });

  it('matches prefix wildcard (chain:*)', () => {
    expect(matchesPattern('chain:started', 'chain:*')).toBe(true);
    expect(matchesPattern('chain:complete', 'chain:*')).toBe(true);
    expect(matchesPattern('chain:error', 'chain:*')).toBe(true);
  });

  it('does not match wrong prefix with wildcard', () => {
    expect(matchesPattern('session:output', 'chain:*')).toBe(false);
    expect(matchesPattern('worker:spawned', 'chain:*')).toBe(false);
  });

  it('does not match partial prefix without wildcard', () => {
    expect(matchesPattern('chain:started', 'chain:')).toBe(false);
    expect(matchesPattern('chain:started', 'chain')).toBe(false);
  });

  it('matches coord:* prefix patterns', () => {
    expect(matchesPattern('coord:started', 'coord:*')).toBe(true);
    expect(matchesPattern('coord:task-complete', 'coord:*')).toBe(true);
  });

  it('matches claude-terminal:* prefix patterns', () => {
    expect(matchesPattern('claude-terminal:spawned', 'claude-terminal:*')).toBe(true);
    expect(matchesPattern('claude-terminal:exit', 'claude-terminal:*')).toBe(true);
  });

  it('matches worker:* prefix patterns', () => {
    expect(matchesPattern('worker:spawned', 'worker:*')).toBe(true);
    expect(matchesPattern('worker:circuit-open', 'worker:*')).toBe(true);
  });
});

describe('matchesAnyPattern', () => {
  it('returns true when any pattern matches', () => {
    expect(matchesAnyPattern('chain:started', new Set(['chain:*', 'session:*']))).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    expect(matchesAnyPattern('worker:spawned', new Set(['chain:*', 'session:*']))).toBe(false);
  });

  it('works with empty set', () => {
    expect(matchesAnyPattern('chain:started', new Set())).toBe(false);
  });

  it('works with wildcard in set', () => {
    expect(matchesAnyPattern('anything:at-all', new Set(['*']))).toBe(true);
  });

  it('works with mixed patterns', () => {
    expect(matchesAnyPattern('chain:complete', new Set(['session:output', 'chain:complete']))).toBe(true);
  });
});

// ── Connection ──────────────────────────────────────────────

describe('WebSocket connection', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('sends welcome message on connect', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    const msg = await ws.nextMsg();
    expect(msg.type).toBe('connected');
    expect(msg.timestamp).toBeDefined();
    ws.close();
  });

  it('responds to ping with pong', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await ws.nextMsg();
    expect(msg.type).toBe('pong');
    expect(msg.timestamp).toBeDefined();
    ws.close();
  });

  it('sends error on invalid JSON', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected
    ws.send('not json!!');
    const msg = await ws.nextMsg();
    expect(msg.type).toBe('error');
    expect(msg.message).toBe('Invalid JSON');
    ws.close();
  });

  it('destroys socket for unknown upgrade paths', async () => {
    ctx = await startTestServer();
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/unknown`);
    await new Promise((resolve) => {
      ws.on('error', resolve);
      ws.on('close', resolve);
    });
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});

// ── Subscriptions ───────────────────────────────────────────

describe('subscriptions', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('subscribes to event patterns', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*', 'session:*'] }));
    const msg = await ws.nextMsg();
    expect(msg.type).toBe('subscribed');
    expect(msg.patterns).toEqual(expect.arrayContaining(['chain:*', 'session:*']));
    ws.close();
  });

  it('accumulates subscriptions across multiple messages', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg();

    ws.send(JSON.stringify({ subscribe: ['session:*'] }));
    const msg = await ws.nextMsg();
    expect(msg.patterns).toEqual(expect.arrayContaining(['chain:*', 'session:*']));
    ws.close();
  });

  it('unsubscribes from patterns', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*', 'session:*'] }));
    await ws.nextMsg();

    ws.send(JSON.stringify({ unsubscribe: ['session:*'] }));
    const msg = await ws.nextMsg();
    expect(msg.patterns).toEqual(['chain:*']);
    ws.close();
  });

  it('ignores non-string patterns', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: [123, null, 'chain:*'] }));
    const msg = await ws.nextMsg();
    expect(msg.patterns).toEqual(['chain:*']);
    ws.close();
  });
});

// ── Event Bridging ──────────────────────────────────────────

describe('event bridging', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('bridges matching events to subscribed clients', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    ctx.events.emit('chain:started', { id: 'test-1' });
    const msg = await ws.nextMsg();
    expect(msg.event).toBe('chain:started');
    expect(msg.data).toEqual({ id: 'test-1' });
    ws.close();
  });

  it('does not bridge events that do not match subscription', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit non-matching event
    ctx.events.emit('worker:spawned', { id: 'w1' });

    // Emit matching event
    ctx.events.emit('chain:complete', { id: 'test-1' });
    const msg = await ws.nextMsg();
    expect(msg.event).toBe('chain:complete'); // Should skip worker event
    ws.close();
  });

  it('does not send events to clients with no subscriptions', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    // No subscribe message sent — client has empty subscriptions

    ctx.events.emit('chain:started', { id: 'test-1' });

    // Send a ping to verify the connection works
    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await ws.nextMsg();
    // Should get pong, not the chain:started event
    expect(msg.type).toBe('pong');
    ws.close();
  });

  it('bridges events to multiple subscribed clients', async () => {
    ctx = await startTestServer();
    const ws1 = await connectWs(ctx.port);
    const ws2 = await connectWs(ctx.port);
    await ws1.nextMsg(); // connected
    await ws2.nextMsg(); // connected

    ws1.send(JSON.stringify({ subscribe: ['chain:*'] }));
    ws2.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws1.nextMsg();
    await ws2.nextMsg();

    ctx.events.emit('chain:started', { id: 'test-1' });

    const msg1 = await ws1.nextMsg();
    const msg2 = await ws2.nextMsg();
    expect(msg1.event).toBe('chain:started');
    expect(msg2.event).toBe('chain:started');
    ws1.close();
    ws2.close();
  });

  it('bridges events from different categories', async () => {
    ctx = await startTestServer({ claudePool: null });
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['*'] }));
    await ws.nextMsg(); // subscribed

    // Emit a sample from each category (not session:output to avoid throttle)
    const samples = [
      'chain:started', 'orchestrator:started',
      'worker:spawned', 'coord:started', 'claude-terminal:spawned',
      'handoff:generated',
    ];
    for (const eventName of samples) {
      ctx.events.emit(eventName, { test: true });
    }

    const msgs = await ws.nextMsgs(samples.length);
    const receivedEvents = msgs.map((m) => m.event);
    for (const ev of samples) {
      expect(receivedEvents).toContain(ev);
    }
    ws.close();
  });
});

// ── Output Throttling ───────────────────────────────────────

describe('output throttling', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('throttles session:output to 1/sec per client', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['session:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit 5 rapid session:output events
    for (let i = 0; i < 5; i++) {
      ctx.events.emit('session:output', { text: `line ${i}` });
    }

    // Should only receive 1 (first one passes, rest throttled)
    const msg = await ws.nextMsg();
    expect(msg.event).toBe('session:output');

    // Verify no more messages arrive quickly
    await sleep(100);
    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await ws.nextMsg();
    // Next message is pong, not another output
    expect(pong.type).toBe('pong');
    ws.close();
  });

  it('does not throttle non-output events', async () => {
    ctx = await startTestServer();
    const ws = await connectWs(ctx.port);
    await ws.nextMsg(); // connected

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMsg(); // subscribed

    // Emit 3 rapid chain events
    ctx.events.emit('chain:started', { id: '1' });
    ctx.events.emit('chain:complete', { id: '2' });
    ctx.events.emit('chain:error', { id: '3' });

    const msgs = await ws.nextMsgs(3);
    expect(msgs).toHaveLength(3);
    ws.close();
  });
});

// ── Cleanup ─────────────────────────────────────────────────

describe('cleanup', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('removes event listeners on cleanup', async () => {
    ctx = await startTestServer();
    const listenersBefore = ctx.events.listenerCount('chain:started');
    expect(listenersBefore).toBeGreaterThan(0);

    ctx.wss.cleanup();

    const listenersAfter = ctx.events.listenerCount('chain:started');
    expect(listenersAfter).toBe(0);
  });

  it('exposes termWss for inspection', () => {
    const events = new MockEventBus();
    const server = createServer();
    const wss = createWebSocketHandler({ server, events });
    expect(wss.termWss).toBeDefined();
    wss.cleanup();
    server.close();
  });
});

// ── Binary Terminal WebSocket ───────────────────────────────

describe('binary terminal WebSocket', () => {
  let ctx;
  afterEach(async () => { if (ctx) await stopTestServer(ctx); });

  it('closes with 4404 when terminal not found', async () => {
    const mockPool = {
      getTerminalHandle: () => null,
    };
    ctx = await startTestServer({ claudePool: mockPool });
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/nonexistent`);
    const closeCode = await new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
    });
    expect(closeCode).toBe(4404);
  });

  it('pipes PTY data to WebSocket client', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = {
      getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null,
    };
    ctx = await startTestServer({ claudePool: mockPool });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    const received = new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
    });
    mockHandle.emit('data', Buffer.from('Hello from PTY'));
    const output = await received;
    expect(output).toBe('Hello from PTY');
    ws.close();
  });

  it('forwards user input to PTY handle.write()', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = {
      getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null,
    };
    ctx = await startTestServer({ claudePool: mockPool });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    ws.send('ls -la');
    await sleep(100);
    expect(mockHandle.write).toHaveBeenCalledWith('ls -la');
    ws.close();
  });

  it('handles resize control messages', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = {
      getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null,
    };
    ctx = await startTestServer({ claudePool: mockPool });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    const ctrlMsg = '\x01' + JSON.stringify({ type: 'resize', cols: 120, rows: 40 });
    ws.send(ctrlMsg);
    await sleep(100);
    expect(mockHandle.resize).toHaveBeenCalledWith(120, 40);
    expect(mockHandle.write).not.toHaveBeenCalled();
    ws.close();
  });

  it('ignores invalid control messages', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = {
      getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null,
    };
    ctx = await startTestServer({ claudePool: mockPool });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    ws.send('\x01not json');
    await sleep(100);
    expect(mockHandle.resize).not.toHaveBeenCalled();
    expect(mockHandle.write).not.toHaveBeenCalled();
    ws.close();
  });

  it('ignores resize with invalid dimensions', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = {
      getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null,
    };
    ctx = await startTestServer({ claudePool: mockPool });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    ws.send('\x01' + JSON.stringify({ type: 'resize', cols: 0, rows: 40 }));
    await sleep(100);
    expect(mockHandle.resize).not.toHaveBeenCalled();
    ws.close();
  });

  it('closes WS when PTY exits', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = {
      getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null,
    };
    ctx = await startTestServer({ claudePool: mockPool });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    const closed = new Promise((resolve) => ws.on('close', resolve));
    mockHandle.emit('exit');
    await closed;
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it('removes listeners on WS close', async () => {
    const mockHandle = new EventEmitter();
    mockHandle.write = vi.fn();
    mockHandle.resize = vi.fn();

    const mockPool = {
      getTerminalHandle: (id) => id === 'term-1' ? mockHandle : null,
    };
    ctx = await startTestServer({ claudePool: mockPool });

    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/term-1`);
    await new Promise((resolve) => ws.on('open', resolve));

    const dataListenersBefore = mockHandle.listenerCount('data');
    const exitListenersBefore = mockHandle.listenerCount('exit');
    expect(dataListenersBefore).toBeGreaterThan(0);
    expect(exitListenersBefore).toBeGreaterThan(0);

    ws.close();
    await sleep(100);

    expect(mockHandle.listenerCount('data')).toBe(dataListenersBefore - 1);
    expect(mockHandle.listenerCount('exit')).toBe(exitListenersBefore - 1);
  });

  it('destroys socket when path starts with /ws/claude-terminal/ but no claudePool', async () => {
    ctx = await startTestServer(); // no claudePool
    const ws = new WebSocket(`ws://127.0.0.1:${ctx.port}/ws/claude-terminal/test`);
    await new Promise((resolve) => {
      ws.on('error', resolve);
      ws.on('close', resolve);
    });
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
