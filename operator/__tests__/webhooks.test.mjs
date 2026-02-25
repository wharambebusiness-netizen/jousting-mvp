// Phase 38 — Webhook & Event Subscription Tests
// Tests for webhook manager core, dispatch, HMAC, retries, persistence, and REST routes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';
import http from 'http';
import express from 'express';
import { createWebhookManager } from '../webhooks.mjs';
import { createWebhookRoutes } from '../routes/webhooks.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_webhooks');
const PERSIST_PATH = join(TEST_DIR, '.data', 'webhooks.json');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

// Mock fetch that captures calls
function createMockFetch(statusCode = 200) {
  const calls = [];
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url, opts });
    return { status: statusCode, ok: statusCode >= 200 && statusCode < 300 };
  });
  fn.calls = calls;
  return fn;
}

beforeEach(setup);
afterEach(teardown);

// ============================================================
// Core Webhook Manager Tests
// ============================================================

describe('Webhook Manager — register()', () => {
  it('creates webhook with correct fields and generated ID', () => {
    const mgr = createWebhookManager({ fetch: createMockFetch() });
    const wh = mgr.register({
      url: 'https://example.com/hook',
      events: ['coord:*'],
      label: 'My Hook',
    });

    expect(wh.id).toBeTruthy();
    expect(wh.id.length).toBe(8);
    expect(wh.url).toBe('https://example.com/hook');
    expect(wh.events).toEqual(['coord:*']);
    expect(wh.label).toBe('My Hook');
    expect(wh.active).toBe(true);
    expect(wh.createdAt).toBeTruthy();
    // No secret in response
    expect(wh.secret).toBeUndefined();

    mgr.destroy();
  });

  it('persists to disk', () => {
    const mgr = createWebhookManager({ persistPath: PERSIST_PATH, fetch: createMockFetch() });
    mgr.register({
      url: 'https://example.com/hook',
      events: ['coord:*'],
    });

    expect(existsSync(PERSIST_PATH)).toBe(true);
    const data = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(data.webhooks.length).toBe(1);
    expect(data.webhooks[0].url).toBe('https://example.com/hook');

    mgr.destroy();
  });

  it('validates URL format (rejects non-URL strings)', () => {
    const mgr = createWebhookManager({ fetch: createMockFetch() });
    expect(() => mgr.register({
      url: 'not-a-url',
      events: ['test:*'],
    })).toThrow('Invalid URL');

    mgr.destroy();
  });
});

describe('Webhook Manager — unregister()', () => {
  it('removes webhook and persists', () => {
    const mgr = createWebhookManager({ persistPath: PERSIST_PATH, fetch: createMockFetch() });
    const wh = mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    expect(mgr.unregister(wh.id)).toBe(true);
    expect(mgr.get(wh.id)).toBeNull();
    expect(mgr.list().length).toBe(0);

    // Persistence updated
    const data = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(data.webhooks.length).toBe(0);

    mgr.destroy();
  });

  it('returns false for unknown id', () => {
    const mgr = createWebhookManager({ fetch: createMockFetch() });
    expect(mgr.unregister('nonexistent')).toBe(false);
    mgr.destroy();
  });
});

describe('Webhook Manager — setActive()', () => {
  it('toggles active flag and persists', () => {
    const mgr = createWebhookManager({ persistPath: PERSIST_PATH, fetch: createMockFetch() });
    const wh = mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    expect(mgr.setActive(wh.id, false)).toBe(true);
    expect(mgr.get(wh.id).active).toBe(false);

    expect(mgr.setActive(wh.id, true)).toBe(true);
    expect(mgr.get(wh.id).active).toBe(true);

    mgr.destroy();
  });
});

describe('Webhook Manager — list()', () => {
  it('returns all webhooks without secrets', () => {
    const mgr = createWebhookManager({ fetch: createMockFetch() });
    mgr.register({ url: 'https://a.com/hook', events: ['a:*'], secret: 'secret-a' });
    mgr.register({ url: 'https://b.com/hook', events: ['b:*'] });

    const all = mgr.list();
    expect(all.length).toBe(2);

    // No secret field, but hasSecret present
    for (const wh of all) {
      expect(wh.secret).toBeUndefined();
      expect(typeof wh.hasSecret).toBe('boolean');
    }

    mgr.destroy();
  });

  it('shows hasSecret: true/false', () => {
    const mgr = createWebhookManager({ fetch: createMockFetch() });
    mgr.register({ url: 'https://a.com/hook', events: ['a:*'], secret: 'my-secret' });
    mgr.register({ url: 'https://b.com/hook', events: ['b:*'] });

    const all = mgr.list();
    const withSecret = all.find(wh => wh.url === 'https://a.com/hook');
    const withoutSecret = all.find(wh => wh.url === 'https://b.com/hook');

    expect(withSecret.hasSecret).toBe(true);
    expect(withoutSecret.hasSecret).toBe(false);

    mgr.destroy();
  });
});

describe('Webhook Manager — get()', () => {
  it('returns single webhook', () => {
    const mgr = createWebhookManager({ fetch: createMockFetch() });
    const created = mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    const wh = mgr.get(created.id);
    expect(wh).toBeTruthy();
    expect(wh.url).toBe('https://example.com/hook');
    expect(wh.events).toEqual(['test:*']);
    expect(wh.secret).toBeUndefined();

    mgr.destroy();
  });
});

// ============================================================
// Event Dispatch Tests
// ============================================================

describe('Webhook Manager — event dispatch', () => {
  it('matching event triggers fetch POST', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    mgr.register({ url: 'https://example.com/hook', events: ['test:fired'] });

    events.emit('test:fired', { key: 'value' });

    // Wait for async delivery
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const call = mockFetch.calls[0];
    expect(call.url).toBe('https://example.com/hook');
    expect(call.opts.method).toBe('POST');

    const body = JSON.parse(call.opts.body);
    expect(body.event).toBe('test:fired');
    expect(body.data.key).toBe('value');

    mgr.destroy();
  });

  it('non-matching event does not trigger', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    mgr.register({ url: 'https://example.com/hook', events: ['coord:*'] });

    events.emit('session:output', { text: 'hello' });

    // Brief wait to confirm no call
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();

    mgr.destroy();
  });

  it('wildcard patterns work (coord:* matches coord:started)', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    mgr.register({ url: 'https://example.com/hook', events: ['coord:*'] });

    events.emit('coord:started', { taskId: 't1' });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const body = JSON.parse(mockFetch.calls[0].opts.body);
    expect(body.event).toBe('coord:started');

    mgr.destroy();
  });

  it('inactive webhooks skipped', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    const wh = mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });
    mgr.setActive(wh.id, false);

    events.emit('test:fired', { x: 1 });

    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();

    mgr.destroy();
  });
});

// ============================================================
// HMAC Signature Tests
// ============================================================

describe('Webhook Manager — HMAC signatures', () => {
  it('correct HMAC signature when secret configured', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();
    const secret = 'my-webhook-secret';
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    mgr.register({ url: 'https://example.com/hook', events: ['test:*'], secret });

    events.emit('test:fired', { payload: 'data' });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const call = mockFetch.calls[0];
    const sigHeader = call.opts.headers['X-Jousting-Signature'];
    expect(sigHeader).toBeTruthy();
    expect(sigHeader.startsWith('sha256=')).toBe(true);

    // Verify HMAC
    const expectedHmac = createHmac('sha256', secret).update(call.opts.body).digest('hex');
    expect(sigHeader).toBe(`sha256=${expectedHmac}`);

    mgr.destroy();
  });

  it('no signature header when no secret', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    events.emit('test:fired', { x: 1 });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const call = mockFetch.calls[0];
    expect(call.opts.headers['X-Jousting-Signature']).toBeUndefined();

    mgr.destroy();
  });
});

// ============================================================
// Delivery Headers Tests
// ============================================================

describe('Webhook Manager — delivery headers', () => {
  it('X-Jousting-Event and X-Jousting-Delivery headers present', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    events.emit('test:fired', {});

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const headers = mockFetch.calls[0].opts.headers;
    expect(headers['X-Jousting-Event']).toBe('test:fired');
    expect(headers['X-Jousting-Delivery']).toBeTruthy();
    // UUID format
    expect(headers['X-Jousting-Delivery'].length).toBeGreaterThan(10);

    mgr.destroy();
  });
});

// ============================================================
// Retry Tests
// ============================================================

describe('Webhook Manager — retries', () => {
  it('retries on non-2xx response', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const events = new EventBus();
    const mockFetch = createMockFetch(500);
    const mgr = createWebhookManager({ events, fetch: mockFetch, maxRetries: 2 });

    mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    events.emit('test:fired', {});

    // First attempt
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Advance past first retry delay (1s)
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Advance past second retry delay (4s)
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    mgr.destroy();
    vi.useRealTimers();
  });

  it('gives up after maxRetries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const events = new EventBus();
    const mockFetch = createMockFetch(500);
    const mgr = createWebhookManager({ events, fetch: mockFetch, maxRetries: 1 });

    mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    events.emit('test:fired', {});

    // First attempt
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Advance past retry delay (1s)
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Advance much more — no more retries should happen
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockFetch).toHaveBeenCalledTimes(2); // 1 initial + 1 retry = 2

    mgr.destroy();
    vi.useRealTimers();
  });
});

// ============================================================
// Delivery Log Tests
// ============================================================

describe('Webhook Manager — delivery log', () => {
  it('records success', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch(200);
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    const wh = mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    events.emit('test:fired', {});

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // Small delay for delivery log to be recorded
    await new Promise(r => setTimeout(r, 10));

    const log = mgr.getDeliveryLog(wh.id);
    expect(log.length).toBe(1);
    expect(log[0].status).toBe('success');
    expect(log[0].statusCode).toBe(200);
    expect(log[0].event).toBe('test:fired');
    expect(log[0].deliveryId).toBeTruthy();
    expect(log[0].ts).toBeTruthy();

    mgr.destroy();
  });

  it('records failure', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch(500);
    const mgr = createWebhookManager({ events, fetch: mockFetch, maxRetries: 0 });

    const wh = mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    events.emit('test:fired', {});

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 10));

    const log = mgr.getDeliveryLog(wh.id);
    expect(log.length).toBe(1);
    expect(log[0].status).toBe('failed');
    expect(log[0].error).toBe('HTTP 500');

    mgr.destroy();
  });

  it('getDeliveryLog() returns recent entries', async () => {
    const events = new EventBus();
    const mockFetch = createMockFetch(200);
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    const wh = mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    // Fire multiple events
    events.emit('test:a', {});
    events.emit('test:b', {});
    events.emit('test:c', {});

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    await new Promise(r => setTimeout(r, 10));

    const log = mgr.getDeliveryLog(wh.id);
    expect(log.length).toBe(3);

    // Can limit
    const limited = mgr.getDeliveryLog(wh.id, 2);
    expect(limited.length).toBe(2);

    mgr.destroy();
  });
});

// ============================================================
// Test Endpoint
// ============================================================

describe('Webhook Manager — sendTest()', () => {
  it('sends test event to webhook URL', async () => {
    const mockFetch = createMockFetch(200);
    const mgr = createWebhookManager({ fetch: mockFetch });

    const wh = mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    const result = await mgr.sendTest(wh.id);
    expect(result).toBeTruthy();
    expect(result.event).toBe('webhook:test');
    expect(result.status).toBe('success');

    // Verify the fetch call
    const body = JSON.parse(mockFetch.calls[0].opts.body);
    expect(body.event).toBe('webhook:test');
    expect(body.data.message).toBe('Test delivery');

    mgr.destroy();
  });
});

// ============================================================
// Persistence Tests
// ============================================================

describe('Webhook Manager — persistence', () => {
  it('load() restores webhooks from disk', () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();

    // Create and register
    const mgr1 = createWebhookManager({ events, persistPath: PERSIST_PATH, fetch: mockFetch });
    mgr1.register({ url: 'https://a.com/hook', events: ['a:*'], label: 'Alpha' });
    mgr1.register({ url: 'https://b.com/hook', events: ['b:*'], label: 'Beta', secret: 'sec' });
    mgr1.destroy();

    // Load from new instance (fresh EventBus to avoid double interception)
    const events2 = new EventBus();
    const mgr2 = createWebhookManager({ events: events2, persistPath: PERSIST_PATH, fetch: mockFetch });
    mgr2.load();

    const all = mgr2.list();
    expect(all.length).toBe(2);

    const alpha = all.find(w => w.label === 'Alpha');
    const beta = all.find(w => w.label === 'Beta');
    expect(alpha.url).toBe('https://a.com/hook');
    expect(beta.hasSecret).toBe(true);

    mgr2.destroy();
  });
});

// ============================================================
// Destroy Tests
// ============================================================

describe('Webhook Manager — destroy()', () => {
  it('unwires EventBus listeners and clears state', () => {
    const events = new EventBus();
    const mockFetch = createMockFetch();
    const mgr = createWebhookManager({ events, fetch: mockFetch });

    mgr.register({ url: 'https://example.com/hook', events: ['test:*'] });

    mgr.destroy();

    // After destroy, emitting should not trigger webhook dispatch
    events.emit('test:fired', {});

    // No fetch calls
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mgr.list().length).toBe(0);
  });
});

// ============================================================
// Route Tests
// ============================================================

describe('Webhook routes', () => {
  let server, baseUrl;

  function startTestServer(webhookManager) {
    const app = express();
    app.use(express.json());
    app.use('/api', createWebhookRoutes({ webhookManager }));
    return new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  it('returns 503 when webhookManager is null', async () => {
    await startTestServer(null);
    const res = await fetch(`${baseUrl}/api/webhooks`);
    expect(res.status).toBe(503);
  });

  it('CRUD responses correct', async () => {
    const mockFetch = createMockFetch();
    const mgr = createWebhookManager({ fetch: mockFetch });
    await startTestServer(mgr);

    // POST create
    const createRes = await fetch(`${baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['test:*'], label: 'Test' }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeTruthy();
    expect(created.url).toBe('https://example.com/hook');

    // GET list
    const listRes = await fetch(`${baseUrl}/api/webhooks`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBe(1);

    // GET single
    const getRes = await fetch(`${baseUrl}/api/webhooks/${created.id}`);
    expect(getRes.status).toBe(200);
    const got = await getRes.json();
    expect(got.url).toBe('https://example.com/hook');

    // PATCH update
    const patchRes = await fetch(`${baseUrl}/api/webhooks/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Updated', active: false }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.label).toBe('Updated');
    expect(patched.active).toBe(false);

    // DELETE
    const deleteRes = await fetch(`${baseUrl}/api/webhooks/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.ok).toBe(true);

    // Confirm gone
    const getAfter = await fetch(`${baseUrl}/api/webhooks/${created.id}`);
    expect(getAfter.status).toBe(404);

    mgr.destroy();
  });
});
