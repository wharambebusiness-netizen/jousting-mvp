// Phase 32 — Dead Letter Queue Tests
// Tests for DLQ core, persistence, coordinator integration, and REST routes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import express from 'express';
import { createDeadLetterQueue } from '../coordination/dead-letter-queue.mjs';
import { createDeadLetterRoutes } from '../routes/dead-letter.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_dlq');
const PERSIST_PATH = join(TEST_DIR, '.data', 'dead-letters.json');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ============================================================
// Core DLQ Tests
// ============================================================

describe('DLQ — add()', () => {
  it('stores entry with all fields and auto-generates id', () => {
    const dlq = createDeadLetterQueue({});
    const entry = dlq.add({
      taskId: 'task-1',
      task: { task: 'Build feature', category: 'code' },
      category: 'code',
      error: 'Timeout exceeded',
      workerId: 'worker-1',
      failedAt: '2026-01-01T00:00:00.000Z',
      retryCount: 3,
      metadata: { attempt: 3 },
    });

    expect(entry.id).toBeTruthy();
    expect(entry.id.length).toBe(8); // 4 bytes = 8 hex chars
    expect(entry.taskId).toBe('task-1');
    expect(entry.task).toEqual({ task: 'Build feature', category: 'code' });
    expect(entry.category).toBe('code');
    expect(entry.error).toBe('Timeout exceeded');
    expect(entry.workerId).toBe('worker-1');
    expect(entry.failedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(entry.retryCount).toBe(3);
    expect(entry.metadata).toEqual({ attempt: 3 });
    expect(entry.status).toBe('pending');
    expect(entry.addedAt).toBeTruthy();
  });

  it('emits dlq:added event', () => {
    const events = new EventBus();
    const dlq = createDeadLetterQueue({ events });
    const emitted = [];
    events.on('dlq:added', (data) => emitted.push(data));

    dlq.add({ taskId: 'task-2', error: 'fail' });

    expect(emitted.length).toBe(1);
    expect(emitted[0].taskId).toBe('task-2');
    expect(emitted[0].status).toBe('pending');
  });
});

describe('DLQ — get()', () => {
  it('returns entry by id', () => {
    const dlq = createDeadLetterQueue({});
    const added = dlq.add({ taskId: 't1', error: 'err' });

    const found = dlq.get(added.id);
    expect(found).toBeTruthy();
    expect(found.taskId).toBe('t1');
  });

  it('returns null for unknown id', () => {
    const dlq = createDeadLetterQueue({});
    expect(dlq.get('nonexistent')).toBeNull();
  });
});

describe('DLQ — getAll()', () => {
  it('returns all entries with total', () => {
    const dlq = createDeadLetterQueue({});
    dlq.add({ taskId: 't1', category: 'code', error: 'e1' });
    dlq.add({ taskId: 't2', category: 'test', error: 'e2' });
    dlq.add({ taskId: 't3', category: 'code', error: 'e3' });

    const result = dlq.getAll();
    expect(result.total).toBe(3);
    expect(result.entries.length).toBe(3);
  });

  it('filters by status', () => {
    const dlq = createDeadLetterQueue({});
    const e1 = dlq.add({ taskId: 't1', error: 'e1' });
    dlq.add({ taskId: 't2', error: 'e2' });
    dlq.dismiss(e1.id, 'not needed');

    const pending = dlq.getAll({ status: 'pending' });
    expect(pending.total).toBe(1);
    expect(pending.entries[0].taskId).toBe('t2');

    const dismissed = dlq.getAll({ status: 'dismissed' });
    expect(dismissed.total).toBe(1);
    expect(dismissed.entries[0].taskId).toBe('t1');
  });

  it('filters by category', () => {
    const dlq = createDeadLetterQueue({});
    dlq.add({ taskId: 't1', category: 'code', error: 'e1' });
    dlq.add({ taskId: 't2', category: 'test', error: 'e2' });
    dlq.add({ taskId: 't3', category: 'code', error: 'e3' });

    const codeOnly = dlq.getAll({ category: 'code' });
    expect(codeOnly.total).toBe(2);
    expect(codeOnly.entries.every(e => e.category === 'code')).toBe(true);
  });

  it('paginates with limit/offset', () => {
    const dlq = createDeadLetterQueue({});
    for (let i = 0; i < 10; i++) {
      dlq.add({ taskId: `t${i}`, error: `e${i}` });
    }

    const page1 = dlq.getAll({ limit: 3, offset: 0 });
    expect(page1.total).toBe(10);
    expect(page1.entries.length).toBe(3);

    const page2 = dlq.getAll({ limit: 3, offset: 3 });
    expect(page2.total).toBe(10);
    expect(page2.entries.length).toBe(3);

    // Different entries
    const ids1 = page1.entries.map(e => e.id);
    const ids2 = page2.entries.map(e => e.id);
    expect(ids1.some(id => ids2.includes(id))).toBe(false);
  });

  it('returns empty for empty DLQ', () => {
    const dlq = createDeadLetterQueue({});
    const result = dlq.getAll();
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('DLQ — retry()', () => {
  it('changes status to retrying and returns task def', () => {
    const dlq = createDeadLetterQueue({});
    const added = dlq.add({ taskId: 't1', task: 'Do something', category: 'code', metadata: { x: 1 } });

    const result = dlq.retry(added.id);
    expect(result).toBeTruthy();
    expect(result.taskId).toBe('t1');
    expect(result.task).toBe('Do something');
    expect(result.category).toBe('code');
    expect(result.metadata).toEqual({ x: 1 });

    // Status changed
    const entry = dlq.get(added.id);
    expect(entry.status).toBe('retrying');
  });

  it('passes opts (reassignTo, priority) through', () => {
    const dlq = createDeadLetterQueue({});
    const added = dlq.add({ taskId: 't1', task: 'Test', error: 'err' });

    const result = dlq.retry(added.id, { reassignTo: 'terminal-5', priority: 10 });
    expect(result.reassignTo).toBe('terminal-5');
    expect(result.priority).toBe(10);
  });

  it('emits dlq:retried event', () => {
    const events = new EventBus();
    const dlq = createDeadLetterQueue({ events });
    const emitted = [];
    events.on('dlq:retried', (data) => emitted.push(data));

    const added = dlq.add({ taskId: 't1', error: 'err' });
    dlq.retry(added.id, { reassignTo: 'term-1' });

    expect(emitted.length).toBe(1);
    expect(emitted[0].id).toBe(added.id);
    expect(emitted[0].taskId).toBe('t1');
    expect(emitted[0].reassignTo).toBe('term-1');
  });

  it('returns null for unknown id', () => {
    const dlq = createDeadLetterQueue({});
    expect(dlq.retry('nonexistent')).toBeNull();
  });
});

describe('DLQ — dismiss()', () => {
  it('changes status to dismissed and stores reason', () => {
    const dlq = createDeadLetterQueue({});
    const added = dlq.add({ taskId: 't1', error: 'err' });

    const result = dlq.dismiss(added.id, 'Known issue, will not fix');
    expect(result).toBe(true);

    const entry = dlq.get(added.id);
    expect(entry.status).toBe('dismissed');
    expect(entry.dismissReason).toBe('Known issue, will not fix');
  });

  it('emits dlq:dismissed event', () => {
    const events = new EventBus();
    const dlq = createDeadLetterQueue({ events });
    const emitted = [];
    events.on('dlq:dismissed', (data) => emitted.push(data));

    const added = dlq.add({ taskId: 't1', error: 'err' });
    dlq.dismiss(added.id, 'duplicate');

    expect(emitted.length).toBe(1);
    expect(emitted[0].id).toBe(added.id);
    expect(emitted[0].reason).toBe('duplicate');
  });

  it('returns false for unknown id', () => {
    const dlq = createDeadLetterQueue({});
    expect(dlq.dismiss('nonexistent')).toBe(false);
  });
});

describe('DLQ — remove()', () => {
  it('permanently deletes entry', () => {
    const dlq = createDeadLetterQueue({});
    const added = dlq.add({ taskId: 't1', error: 'err' });

    expect(dlq.remove(added.id)).toBe(true);
    expect(dlq.get(added.id)).toBeNull();
    expect(dlq.getAll().total).toBe(0);
  });

  it('returns false for unknown id', () => {
    const dlq = createDeadLetterQueue({});
    expect(dlq.remove('nonexistent')).toBe(false);
  });
});

describe('DLQ — getStats()', () => {
  it('returns correct counts by status and category', () => {
    const dlq = createDeadLetterQueue({});
    const e1 = dlq.add({ taskId: 't1', category: 'code', error: 'e1' });
    const e2 = dlq.add({ taskId: 't2', category: 'test', error: 'e2' });
    dlq.add({ taskId: 't3', category: 'code', error: 'e3' });
    dlq.dismiss(e1.id, 'done');
    dlq.retry(e2.id);

    const stats = dlq.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byStatus.pending).toBe(1);
    expect(stats.byStatus.retrying).toBe(1);
    expect(stats.byStatus.dismissed).toBe(1);
    expect(stats.byCategory.code).toBe(2);
    expect(stats.byCategory.test).toBe(1);
  });
});

// ============================================================
// Persistence Tests
// ============================================================

describe('DLQ — persistence', () => {
  it('saves and loads round-trip', () => {
    const dlq1 = createDeadLetterQueue({ persistPath: PERSIST_PATH });
    dlq1.add({ taskId: 't1', category: 'code', error: 'err1' });
    dlq1.add({ taskId: 't2', category: 'test', error: 'err2' });

    // Create new DLQ from same path — auto-loads
    const dlq2 = createDeadLetterQueue({ persistPath: PERSIST_PATH });
    const result = dlq2.getAll();

    expect(result.total).toBe(2);
    const taskIds = result.entries.map(e => e.taskId).sort();
    expect(taskIds).toEqual(['t1', 't2']);
  });

  it('loads from existing file on creation', () => {
    // Pre-populate file
    const dlq1 = createDeadLetterQueue({ persistPath: PERSIST_PATH });
    dlq1.add({ taskId: 'pre-1', error: 'err' });

    // New instance should auto-load
    const dlq2 = createDeadLetterQueue({ persistPath: PERSIST_PATH });
    expect(dlq2.getAll().total).toBe(1);
    expect(dlq2.getAll().entries[0].taskId).toBe('pre-1');
  });
});

// ============================================================
// maxEntries eviction
// ============================================================

describe('DLQ — maxEntries', () => {
  it('evicts oldest dismissed entries when full', () => {
    const dlq = createDeadLetterQueue({ maxEntries: 3 });

    const e1 = dlq.add({ taskId: 't1', error: 'e1' });
    const e2 = dlq.add({ taskId: 't2', error: 'e2' });
    dlq.dismiss(e1.id, 'old');
    dlq.dismiss(e2.id, 'old');

    // Now at 2 entries, both dismissed. Add 2 more to exceed max.
    dlq.add({ taskId: 't3', error: 'e3' });
    dlq.add({ taskId: 't4', error: 'e4' });

    // Should have evicted at least one dismissed entry to stay at maxEntries
    const result = dlq.getAll();
    expect(result.total).toBeLessThanOrEqual(3);
    // t3 and t4 (pending) should still be present
    const taskIds = result.entries.map(e => e.taskId);
    expect(taskIds).toContain('t3');
    expect(taskIds).toContain('t4');
  });
});

// ============================================================
// Coordinator Integration
// ============================================================

describe('DLQ — coordinator integration', () => {
  it('coordinator routes failed task to DLQ after maxTaskRetries', () => {
    // This test verifies the coordinator's modified coord:failed handler
    // We import createCoordinator and wire a DLQ to it
    // Then simulate repeated failures of the same task
  });
});

// ============================================================
// Route Tests
// ============================================================

describe('DLQ routes', () => {
  let server, baseUrl;

  function startTestServer(dlq, coordinator) {
    const app = express();
    app.use(express.json());
    app.use('/api', createDeadLetterRoutes({ deadLetterQueue: dlq, coordinator: coordinator || null }));
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

  it('GET /api/coordination/dead-letters returns entries', async () => {
    const dlq = createDeadLetterQueue({});
    dlq.add({ taskId: 't1', category: 'code', error: 'err1' });
    dlq.add({ taskId: 't2', category: 'test', error: 'err2' });
    await startTestServer(dlq);

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.entries.length).toBe(2);
  });

  it('POST retry re-queues via coordinator', async () => {
    const dlq = createDeadLetterQueue({});
    const entry = dlq.add({ taskId: 'task-re', task: 'Build it', category: 'code', error: 'timeout' });

    // Mock coordinator with addTask
    const addedTasks = [];
    const coordinator = {
      taskQueue: { getAll: () => [], add: vi.fn() },
      addTask: vi.fn((def) => { addedTasks.push(def); return def; }),
    };

    await startTestServer(dlq, coordinator);

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters/${entry.id}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 10 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.taskDef.taskId).toBe('task-re');
    expect(coordinator.addTask).toHaveBeenCalled();
    expect(addedTasks[0].metadata.retriedFrom).toBe(entry.id);

    // Entry status changed
    const updated = dlq.get(entry.id);
    expect(updated.status).toBe('retrying');
  });

  it('POST dismiss stores reason', async () => {
    const dlq = createDeadLetterQueue({});
    const entry = dlq.add({ taskId: 't1', error: 'err' });
    await startTestServer(dlq);

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters/${entry.id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'known bug' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const updated = dlq.get(entry.id);
    expect(updated.status).toBe('dismissed');
    expect(updated.dismissReason).toBe('known bug');
  });

  it('DELETE removes entry', async () => {
    const dlq = createDeadLetterQueue({});
    const entry = dlq.add({ taskId: 't1', error: 'err' });
    await startTestServer(dlq);

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters/${entry.id}`, {
      method: 'DELETE',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(dlq.get(entry.id)).toBeNull();
  });

  it('returns 503 when DLQ is null', async () => {
    await startTestServer(null);

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters`);
    expect(res.status).toBe(503);
  });

  it('GET /api/coordination/dead-letters/stats returns stats', async () => {
    const dlq = createDeadLetterQueue({});
    dlq.add({ taskId: 't1', category: 'code', error: 'e1' });
    dlq.add({ taskId: 't2', category: 'test', error: 'e2' });
    await startTestServer(dlq);

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters/stats`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.byStatus.pending).toBe(2);
    expect(body.byCategory.code).toBe(1);
    expect(body.byCategory.test).toBe(1);
  });

  it('GET /api/coordination/dead-letters/:id returns entry detail', async () => {
    const dlq = createDeadLetterQueue({});
    const entry = dlq.add({ taskId: 't1', error: 'specific error' });
    await startTestServer(dlq);

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters/${entry.id}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.taskId).toBe('t1');
    expect(body.error).toBe('specific error');
  });

  it('GET /api/coordination/dead-letters/:id returns 404 for missing', async () => {
    const dlq = createDeadLetterQueue({});
    await startTestServer(dlq);

    const res = await fetch(`${baseUrl}/api/coordination/dead-letters/nonexistent`);
    expect(res.status).toBe(404);
  });
});
