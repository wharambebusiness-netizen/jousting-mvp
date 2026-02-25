// ============================================================
// Pagination & List Improvements Tests (Phase 35)
// ============================================================
// Tests for paginatedResponse() helper and paginated list endpoints.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import { paginatedResponse, paginationParams } from '../validation.mjs';
import { createCoordinationRoutes } from '../routes/coordination.mjs';
import { createSharedMemoryRoutes } from '../routes/shared-memory.mjs';
import { createTerminalMessageRoutes } from '../routes/terminal-messages.mjs';
import { createAuditRoutes } from '../routes/audit.mjs';
import { createDeadLetterRoutes } from '../routes/dead-letter.mjs';
import { createTaskQueue } from '../coordination/task-queue.mjs';
import { createSharedMemory } from '../shared-memory.mjs';
import { createTerminalMessageBus } from '../terminal-messages.mjs';
import { createDeadLetterQueue } from '../coordination/dead-letter-queue.mjs';

// ── Helpers ────────────────────────────────────────────────

function mockReq(query = {}) {
  return { query };
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ============================================================
// paginatedResponse() unit tests
// ============================================================

describe('paginatedResponse()', () => {
  it('computes hasMore: true when more items exist', () => {
    const result = paginatedResponse({ items: [1, 2, 3], total: 10, limit: 3, offset: 0 });
    expect(result.hasMore).toBe(true);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.total).toBe(10);
    expect(result.limit).toBe(3);
    expect(result.offset).toBe(0);
  });

  it('computes hasMore: false on last page', () => {
    const result = paginatedResponse({ items: [8, 9, 10], total: 10, limit: 3, offset: 7 });
    expect(result.hasMore).toBe(false);
  });

  it('handles empty items (total=0)', () => {
    const result = paginatedResponse({ items: [], total: 0, limit: 50, offset: 0 });
    expect(result.hasMore).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('boundary: offset + items.length === total means hasMore: false', () => {
    const result = paginatedResponse({ items: ['a', 'b'], total: 5, limit: 2, offset: 3 });
    // offset(3) + items.length(2) = 5 === total(5) → hasMore: false
    expect(result.hasMore).toBe(false);
  });

  it('hasMore is boolean (not truthy value)', () => {
    const result1 = paginatedResponse({ items: [1], total: 5, limit: 1, offset: 0 });
    expect(result1.hasMore).toBe(true);
    expect(typeof result1.hasMore).toBe('boolean');

    const result2 = paginatedResponse({ items: [], total: 0, limit: 50, offset: 0 });
    expect(result2.hasMore).toBe(false);
    expect(typeof result2.hasMore).toBe('boolean');
  });

  it('single-item total with offset 0 gives hasMore: false', () => {
    const result = paginatedResponse({ items: ['x'], total: 1, limit: 50, offset: 0 });
    expect(result.hasMore).toBe(false);
  });

  it('hasMore: true when mid-page', () => {
    const result = paginatedResponse({ items: [3, 4], total: 10, limit: 2, offset: 2 });
    // offset(2) + items.length(2) = 4 < total(10) → hasMore: true
    expect(result.hasMore).toBe(true);
  });
});

// ============================================================
// Coordination tasks endpoint pagination
// ============================================================

describe('GET /api/coordination/tasks — paginated', () => {
  let server, baseUrl;

  function createMockCoordinator() {
    const taskQueue = createTaskQueue();
    return {
      taskQueue,
      getState: () => 'running',
      rateLimiter: { getStatus: () => ({}) },
      costAggregator: { getStatus: () => ({}) },
      addTask: (def) => taskQueue.add(def),
      addTasks: (defs) => defs.map(d => taskQueue.add(d)),
    };
  }

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  it('returns paginated results with items/total/limit/offset/hasMore', async () => {
    const coordinator = createMockCoordinator();
    coordinator.addTask({ id: 't1', task: 'Task 1', category: 'code' });
    coordinator.addTask({ id: 't2', task: 'Task 2', category: 'test' });

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBe(2);
    expect(typeof body.total).toBe('number');
    expect(body.total).toBe(2);
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
  });

  it('respects limit param', async () => {
    const coordinator = createMockCoordinator();
    for (let i = 0; i < 10; i++) {
      coordinator.addTask({ id: `t${i}`, task: `Task ${i}` });
    }

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks?limit=3`);
    const body = await res.json();

    expect(body.items.length).toBe(3);
    expect(body.total).toBe(10);
    expect(body.limit).toBe(3);
    expect(body.hasMore).toBe(true);
  });

  it('respects offset param', async () => {
    const coordinator = createMockCoordinator();
    for (let i = 0; i < 5; i++) {
      coordinator.addTask({ id: `t${i}`, task: `Task ${i}` });
    }

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks?offset=3&limit=50`);
    const body = await res.json();

    expect(body.items.length).toBe(2);
    expect(body.total).toBe(5);
    expect(body.offset).toBe(3);
    expect(body.hasMore).toBe(false);
  });

  it('filters by status', async () => {
    const coordinator = createMockCoordinator();
    coordinator.addTask({ id: 't1', task: 'A' });
    coordinator.addTask({ id: 't2', task: 'B' });
    coordinator.taskQueue.assign('t1', 'worker1');
    coordinator.taskQueue.start('t1');
    coordinator.taskQueue.complete('t1', 'done');

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks?status=pending`);
    const body = await res.json();

    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe('t2');
    expect(body.total).toBe(1);
  });

  it('filters by category', async () => {
    const coordinator = createMockCoordinator();
    coordinator.addTask({ id: 't1', task: 'A', category: 'code' });
    coordinator.addTask({ id: 't2', task: 'B', category: 'test' });
    coordinator.addTask({ id: 't3', task: 'C', category: 'code' });

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks?category=code`);
    const body = await res.json();

    expect(body.items.length).toBe(2);
    expect(body.total).toBe(2);
    expect(body.items.every(t => t.category === 'code')).toBe(true);
  });

  it('returns total count independent of pagination', async () => {
    const coordinator = createMockCoordinator();
    for (let i = 0; i < 8; i++) {
      coordinator.addTask({ id: `t${i}`, task: `Task ${i}` });
    }

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks?limit=2&offset=0`);
    const body = await res.json();

    expect(body.items.length).toBe(2);
    expect(body.total).toBe(8);
  });

  it('default limit applied when not specified', async () => {
    const coordinator = createMockCoordinator();
    coordinator.addTask({ id: 't1', task: 'A' });

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks`);
    const body = await res.json();

    expect(body.limit).toBe(50); // default from paginationParams
  });

  it('limit clamped to max 100', async () => {
    const coordinator = createMockCoordinator();
    coordinator.addTask({ id: 't1', task: 'A' });

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks?limit=500`);
    const body = await res.json();

    expect(body.limit).toBe(100);
  });

  it('offset defaults to 0', async () => {
    const coordinator = createMockCoordinator();
    coordinator.addTask({ id: 't1', task: 'A' });

    const app = express();
    app.use('/api', createCoordinationRoutes({ coordinator }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/tasks`);
    const body = await res.json();

    expect(body.offset).toBe(0);
  });
});

// ============================================================
// Shared memory endpoint pagination
// ============================================================

describe('GET /api/shared-memory — paginated', () => {
  let server, baseUrl;

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  it('paginates key listing', async () => {
    const sharedMemory = createSharedMemory();
    for (let i = 0; i < 10; i++) {
      sharedMemory.set(`key-${String(i).padStart(2, '0')}`, `val-${i}`, 'test');
    }

    const app = express();
    app.use('/api', createSharedMemoryRoutes({ sharedMemory }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/shared-memory?limit=3`);
    const body = await res.json();

    expect(body.items.length).toBe(3);
    expect(body.total).toBe(10);
    expect(body.hasMore).toBe(true);
    // Backward compat
    expect(body.count).toBe(3);
    expect(typeof body.entries).toBe('object');
  });

  it('filters by prefix', async () => {
    const sharedMemory = createSharedMemory();
    sharedMemory.set('proj:a', 1, 'test');
    sharedMemory.set('proj:b', 2, 'test');
    sharedMemory.set('other:c', 3, 'test');

    const app = express();
    app.use('/api', createSharedMemoryRoutes({ sharedMemory }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/shared-memory?prefix=proj:`);
    const body = await res.json();

    expect(body.total).toBe(2);
    expect(body.items.length).toBe(2);
    expect(body.items.every(k => k.startsWith('proj:'))).toBe(true);
  });

  it('returns standard envelope fields', async () => {
    const sharedMemory = createSharedMemory();

    const app = express();
    app.use('/api', createSharedMemoryRoutes({ sharedMemory }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/shared-memory`);
    const body = await res.json();

    expect(typeof body.total).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
    expect(Array.isArray(body.items)).toBe(true);
  });
});

// ============================================================
// Terminal messages endpoint pagination
// ============================================================

describe('GET /api/terminal-messages — paginated', () => {
  let server, baseUrl;

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  it('returns standardized envelope', async () => {
    const messageBus = createTerminalMessageBus();
    messageBus.send({ from: 'a', to: 'b', content: 'hello' });
    messageBus.send({ from: 'b', to: 'a', content: 'world' });

    const app = express();
    app.use(express.json());
    app.use('/api', createTerminalMessageRoutes({ messageBus }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/terminal-messages`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBe(2);
    expect(body.total).toBe(2);
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
    // Backward compat
    expect(body.count).toBe(2);
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

// ============================================================
// Audit endpoint pagination
// ============================================================

describe('GET /api/audit — paginated', () => {
  let server, baseUrl;

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  it('wraps in standard envelope with entries as alias', async () => {
    // Create a mock auditLog with query method
    const auditLog = {
      query: ({ limit, offset }) => ({
        entries: [
          { ts: '2024-01-01T00:00:00Z', action: 'test.action', actor: null, target: null },
          { ts: '2024-01-01T00:01:00Z', action: 'test.action2', actor: null, target: null },
        ],
        total: 2,
      }),
      stats: () => ({ total: 2, byAction: {}, dateRange: {} }),
    };

    const app = express();
    app.use('/api', createAuditRoutes({ auditLog }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/audit`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBe(2);
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
    // Backward compat
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(2);
  });
});

// ============================================================
// Dead letter queue endpoint pagination
// ============================================================

describe('GET /api/coordination/dead-letters — paginated', () => {
  let server, baseUrl;

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  it('returns standardized envelope with entries alias', async () => {
    const dlq = createDeadLetterQueue({});
    dlq.add({ taskId: 't1', category: 'code', error: 'err1' });
    dlq.add({ taskId: 't2', category: 'test', error: 'err2' });
    dlq.add({ taskId: 't3', category: 'code', error: 'err3' });

    const app = express();
    app.use(express.json());
    app.use('/api', createDeadLetterRoutes({ deadLetterQueue: dlq }));
    ({ server, baseUrl } = await startServer(app));

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBe(3);
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
    // Backward compat
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(3);
  });
});
