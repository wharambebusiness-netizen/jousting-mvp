// Notifications Tests (Phase 41)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import express from 'express';
import { createNotifications, DEFAULT_MAX_ENTRIES } from '../notifications.mjs';
import { createNotificationRoutes } from '../routes/notifications.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_notifications');
const PERSIST_PATH = join(TEST_DIR, '.data', 'notifications.json');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── Exports ─────────────────────────────────────────────────

describe('exports', () => {
  it('exports DEFAULT_MAX_ENTRIES', () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(200);
  });
});

// ── Notification Structure ──────────────────────────────────

describe('notification structure', () => {
  it('has correct fields (id, type, severity, title, message, read, ts, metadata)', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('claude-terminal:task-completed', { taskId: 't1', terminalId: 'term-1' });

    const { items } = notifs.getAll();
    expect(items.length).toBe(1);
    const n = items[0];
    expect(n.id).toBeTruthy();
    expect(n.id.length).toBe(8); // 4 bytes hex
    expect(n.type).toBe('task_complete');
    expect(n.severity).toBe('success');
    expect(n.title).toBe('Task completed');
    expect(n.message).toContain('t1');
    expect(n.read).toBe(false);
    expect(n.ts).toBeTruthy();
    expect(n.metadata).toEqual({ taskId: 't1', terminalId: 'term-1' });

    notifs.destroy();
  });
});

// ── Auto-subscriptions ──────────────────────────────────────

describe('auto-subscriptions', () => {
  it('task-completed event creates success notification', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('claude-terminal:task-completed', { taskId: 't1', terminalId: 'term-1' });

    const { items } = notifs.getAll();
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('task_complete');
    expect(items[0].severity).toBe('success');

    notifs.destroy();
  });

  it('task-failed event creates error notification', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('coord:task-failed', { taskId: 'fail-1' });

    const { items } = notifs.getAll();
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('task_failed');
    expect(items[0].severity).toBe('error');
    expect(items[0].message).toContain('fail-1');

    notifs.destroy();
  });

  it('dlq:added creates error notification', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('dlq:added', { taskId: 'dlq-1' });

    const { items } = notifs.getAll();
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('dlq_added');
    expect(items[0].severity).toBe('error');
    expect(items[0].message).toContain('dlq-1');

    notifs.destroy();
  });

  it('swarm-started creates info notification', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('claude-terminal:swarm-started', {});

    const { items } = notifs.getAll();
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('swarm_event');
    expect(items[0].severity).toBe('info');
    expect(items[0].title).toBe('Swarm started');

    notifs.destroy();
  });

  it('swarm-stopped creates info notification', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('claude-terminal:swarm-stopped', {});

    const { items } = notifs.getAll();
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('swarm_event');
    expect(items[0].severity).toBe('info');
    expect(items[0].title).toBe('Swarm stopped');

    notifs.destroy();
  });

  it('terminal exit with non-zero code creates warning notification', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('claude-terminal:exit', { terminalId: 'term-2', exitCode: 1 });

    const { items } = notifs.getAll();
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('terminal_exit');
    expect(items[0].severity).toBe('warning');
    expect(items[0].message).toContain('term-2');
    expect(items[0].message).toContain('1');

    notifs.destroy();
  });

  it('terminal exit with zero code does NOT create notification', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('claude-terminal:exit', { terminalId: 'term-2', exitCode: 0 });

    const { items } = notifs.getAll();
    expect(items.length).toBe(0);

    notifs.destroy();
  });

  it('budget warning creates warning notification', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    events.emit('coord:budget-warning', { percent: 0.85 });

    const { items } = notifs.getAll();
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('budget_warning');
    expect(items[0].severity).toBe('warning');
    expect(items[0].message).toContain('85%');

    notifs.destroy();
  });
});

// ── getAll() ────────────────────────────────────────────────

describe('getAll()', () => {
  it('returns items with total and unreadCount', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'system', severity: 'info', title: 'Test', message: 'Hello' });
    notifs.add({ type: 'system', severity: 'info', title: 'Test2', message: 'World' });

    const result = notifs.getAll();
    expect(result.items.length).toBe(2);
    expect(result.total).toBe(2);
    expect(result.unreadCount).toBe(2);
  });

  it('filters by unreadOnly', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'system', severity: 'info', title: 'A', message: 'a' });
    const b = notifs.add({ type: 'system', severity: 'info', title: 'B', message: 'b' });
    notifs.markRead(b.id);

    const result = notifs.getAll({ unreadOnly: true });
    expect(result.items.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.items[0].title).toBe('A');
  });

  it('filters by type', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'task_complete', severity: 'success', title: 'T1', message: 't1' });
    notifs.add({ type: 'task_failed', severity: 'error', title: 'T2', message: 't2' });
    notifs.add({ type: 'task_complete', severity: 'success', title: 'T3', message: 't3' });

    const result = notifs.getAll({ type: 'task_complete' });
    expect(result.items.length).toBe(2);
    expect(result.items.every(n => n.type === 'task_complete')).toBe(true);
  });

  it('paginates with limit/offset', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    for (let i = 0; i < 10; i++) {
      notifs.add({ type: 'system', severity: 'info', title: `N${i}`, message: `m${i}` });
    }

    // Reverse chronological: N9, N8, N7, ...
    const result = notifs.getAll({ limit: 3, offset: 2 });
    expect(result.total).toBe(10);
    expect(result.items.length).toBe(3);
    expect(result.items[0].title).toBe('N7');
    expect(result.items[1].title).toBe('N6');
    expect(result.items[2].title).toBe('N5');
  });

  it('empty state: returns empty items and unreadCount 0', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    const result = notifs.getAll();
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.unreadCount).toBe(0);
  });
});

// ── markRead() ──────────────────────────────────────────────

describe('markRead()', () => {
  it('marks single notification as read', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    const n = notifs.add({ type: 'system', severity: 'info', title: 'Test', message: 'msg' });

    expect(notifs.getUnreadCount()).toBe(1);
    const ok = notifs.markRead(n.id);
    expect(ok).toBe(true);
    expect(notifs.getUnreadCount()).toBe(0);
  });

  it('returns false for non-existent id', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    const ok = notifs.markRead('nonexistent');
    expect(ok).toBe(false);
  });
});

// ── markAllRead() ───────────────────────────────────────────

describe('markAllRead()', () => {
  it('marks all as read', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'system', severity: 'info', title: 'A', message: 'a' });
    notifs.add({ type: 'system', severity: 'info', title: 'B', message: 'b' });
    notifs.add({ type: 'system', severity: 'info', title: 'C', message: 'c' });

    expect(notifs.getUnreadCount()).toBe(3);
    const changed = notifs.markAllRead();
    expect(changed).toBe(3);
    expect(notifs.getUnreadCount()).toBe(0);
  });
});

// ── dismiss() ───────────────────────────────────────────────

describe('dismiss()', () => {
  it('removes notification', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    const n = notifs.add({ type: 'system', severity: 'info', title: 'Test', message: 'msg' });

    const ok = notifs.dismiss(n.id);
    expect(ok).toBe(true);
    expect(notifs.getAll().total).toBe(0);
  });

  it('returns false for non-existent id', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    const ok = notifs.dismiss('nonexistent');
    expect(ok).toBe(false);
  });
});

// ── clear() ─────────────────────────────────────────────────

describe('clear()', () => {
  it('removes all notifications', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'system', severity: 'info', title: 'A', message: 'a' });
    notifs.add({ type: 'system', severity: 'info', title: 'B', message: 'b' });

    notifs.clear();
    expect(notifs.getAll().total).toBe(0);
    expect(notifs.getUnreadCount()).toBe(0);
  });
});

// ── getUnreadCount() ────────────────────────────────────────

describe('getUnreadCount()', () => {
  it('returns correct count', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    expect(notifs.getUnreadCount()).toBe(0);

    const n1 = notifs.add({ type: 'system', severity: 'info', title: 'A', message: 'a' });
    notifs.add({ type: 'system', severity: 'info', title: 'B', message: 'b' });
    expect(notifs.getUnreadCount()).toBe(2);

    notifs.markRead(n1.id);
    expect(notifs.getUnreadCount()).toBe(1);
  });
});

// ── maxEntries eviction ─────────────────────────────────────

describe('maxEntries eviction', () => {
  it('evicts oldest when at capacity (ring buffer)', () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH, maxEntries: 3 });
    notifs.add({ type: 'system', severity: 'info', title: 'A', message: 'a' });
    notifs.add({ type: 'system', severity: 'info', title: 'B', message: 'b' });
    notifs.add({ type: 'system', severity: 'info', title: 'C', message: 'c' });
    notifs.add({ type: 'system', severity: 'info', title: 'D', message: 'd' });

    const { items, total } = notifs.getAll();
    expect(total).toBe(3);
    // Oldest (A) should be evicted; reverse chron: D, C, B
    expect(items[0].title).toBe('D');
    expect(items[1].title).toBe('C');
    expect(items[2].title).toBe('B');
  });
});

// ── Persistence ─────────────────────────────────────────────

describe('persistence', () => {
  it('save/load round-trip', () => {
    const notifs1 = createNotifications({ persistPath: PERSIST_PATH });
    notifs1.add({ type: 'task_complete', severity: 'success', title: 'Done', message: 'Task done' });
    notifs1.add({ type: 'system', severity: 'info', title: 'Hello', message: 'World' });

    // Verify file exists
    expect(existsSync(PERSIST_PATH)).toBe(true);

    // Load in new instance
    const notifs2 = createNotifications({ persistPath: PERSIST_PATH });
    const { items, total } = notifs2.getAll();
    expect(total).toBe(2);
    expect(items[0].title).toBe('Hello'); // reverse chron
    expect(items[1].title).toBe('Done');
  });
});

// ── destroy() ───────────────────────────────────────────────

describe('destroy()', () => {
  it('unwires EventBus listeners (emit after destroy creates no entries)', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });

    // Verify subscription works
    events.emit('claude-terminal:task-completed', { taskId: 't1', terminalId: 'term-1' });
    expect(notifs.getAll().total).toBe(1);

    notifs.destroy();

    // Emit after destroy — no new notification
    events.emit('claude-terminal:task-completed', { taskId: 't2', terminalId: 'term-2' });
    expect(notifs.getAll().total).toBe(1);
  });
});

// ── notification:new event ──────────────────────────────────

describe('notification:new event', () => {
  it('emitted on add', () => {
    const events = new EventBus();
    const notifs = createNotifications({ events, persistPath: PERSIST_PATH });
    const received = [];
    events.on('notification:new', (data) => received.push(data));

    notifs.add({ type: 'system', severity: 'info', title: 'Test', message: 'msg' });

    expect(received.length).toBe(1);
    expect(received[0].type).toBe('system');
    expect(received[0].title).toBe('Test');

    notifs.destroy();
  });
});

// ── Routes ──────────────────────────────────────────────────

describe('notification routes', () => {
  let server, baseUrl;

  function startTestServer(notifs) {
    const app = express();
    app.use(express.json());
    app.use('/api', createNotificationRoutes({ notifications: notifs }));
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

  it('GET /api/notifications returns notifications', async () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'system', severity: 'info', title: 'Hello', message: 'World' });
    notifs.add({ type: 'task_complete', severity: 'success', title: 'Done', message: 'Task done' });
    await startTestServer(notifs);

    const res = await fetch(`${baseUrl}/api/notifications`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.items.length).toBe(2);
    expect(body.unreadCount).toBe(2);
  });

  it('GET /api/notifications/unread-count returns count', async () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'system', severity: 'info', title: 'A', message: 'a' });
    notifs.add({ type: 'system', severity: 'info', title: 'B', message: 'b' });
    await startTestServer(notifs);

    const res = await fetch(`${baseUrl}/api/notifications/unread-count`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
  });

  it('POST /api/notifications/:id/read marks as read', async () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    const n = notifs.add({ type: 'system', severity: 'info', title: 'Test', message: 'msg' });
    await startTestServer(notifs);

    const res = await fetch(`${baseUrl}/api/notifications/${n.id}/read`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(notifs.getUnreadCount()).toBe(0);
  });

  it('POST /api/notifications/read-all marks all as read', async () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'system', severity: 'info', title: 'A', message: 'a' });
    notifs.add({ type: 'system', severity: 'info', title: 'B', message: 'b' });
    await startTestServer(notifs);

    const res = await fetch(`${baseUrl}/api/notifications/read-all`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.count).toBe(2);
    expect(notifs.getUnreadCount()).toBe(0);
  });

  it('DELETE /api/notifications/:id dismisses notification', async () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    const n = notifs.add({ type: 'system', severity: 'info', title: 'Test', message: 'msg' });
    await startTestServer(notifs);

    const res = await fetch(`${baseUrl}/api/notifications/${n.id}`, { method: 'DELETE' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(notifs.getAll().total).toBe(0);
  });

  it('DELETE /api/notifications clears all', async () => {
    const notifs = createNotifications({ persistPath: PERSIST_PATH });
    notifs.add({ type: 'system', severity: 'info', title: 'A', message: 'a' });
    notifs.add({ type: 'system', severity: 'info', title: 'B', message: 'b' });
    await startTestServer(notifs);

    const res = await fetch(`${baseUrl}/api/notifications`, { method: 'DELETE' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(notifs.getAll().total).toBe(0);
  });

  it('returns 503 when notifications is null', async () => {
    await startTestServer(null);

    const res = await fetch(`${baseUrl}/api/notifications`);
    expect(res.status).toBe(503);
  });
});
