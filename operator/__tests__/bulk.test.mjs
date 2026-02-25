// ============================================================
// Bulk Operations Tests (Phase 40)
// ============================================================
// Tests for POST /api/bulk/* endpoints — task cancel, retry,
// update, chain archive, DLQ retry, DLQ dismiss.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createApp } from '../server.mjs';
import { createRegistry, createChain, updateChainStatus } from '../registry.mjs';
import { createTaskQueue } from '../coordination/task-queue.mjs';
import { createDeadLetterQueue } from '../coordination/dead-letter-queue.mjs';
import { createAuditLog } from '../audit-log.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_bulk');

function setupTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
}

function teardownTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

let appInstance, baseUrl, events, coordinator, deadLetterQueue, registry, auditLog;

async function startServer(opts = {}) {
  events = new EventBus();

  // Create registry with test chains
  registry = createRegistry({ operatorDir: TEST_DIR, log: () => {} });

  // DLQ
  deadLetterQueue = createDeadLetterQueue({
    events,
    log: () => {},
  });

  // Audit log
  auditLog = createAuditLog({
    persistPath: join(TEST_DIR, '.data', 'audit-log.jsonl'),
    log: () => {},
  });

  appInstance = createApp({
    operatorDir: TEST_DIR,
    events,
    auth: false,
    pool: true,
    registry,
    deadLetterQueue,
    auditLog,
    sharedMemory: false,
    messageBus: false,
    webhooks: false,
    preferences: false,
    migrations: false,
    ...opts,
  });

  // Grab coordinator from the app instance
  coordinator = appInstance.coordinator;

  return new Promise((resolve) => {
    appInstance.server.listen(0, '127.0.0.1', () => {
      const port = appInstance.server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve({ port });
    });
  });
}

async function stopServer() {
  if (appInstance) {
    await appInstance.close();
    appInstance = null;
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ── Helper: Add tasks to the coordinator ──────────────────

let taskCounter = 0;

function addTestTasks(count = 3) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    taskCounter++;
    const task = coordinator.addTask({
      id: `bulk-test-${taskCounter}-${Date.now()}`,
      task: `Test task ${i}`,
      priority: 5,
      category: 'testing',
    });
    ids.push(task.id);
  }
  return ids;
}

function failTask(taskId) {
  coordinator.taskQueue.assign(taskId, 'worker-1');
  coordinator.taskQueue.start(taskId);
  coordinator.taskQueue.fail(taskId, 'Test failure');
}

// ── Tests ───────────────────────────────────────────────────

describe('Bulk Operations — Tasks', () => {
  beforeAll(async () => {
    setupTestDir();
    await startServer();
    coordinator.start();
  });

  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  // ── Bulk Cancel ──────────────────────────────

  it('cancels multiple tasks', async () => {
    const ids = addTestTasks(3);
    const { status, body } = await api('/api/bulk/tasks/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    expect(status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.succeeded).toBe(3);
    expect(body.failed).toBe(0);
    expect(body.results).toHaveLength(3);
    expect(body.results[0].success).toBe(true);
  });

  it('handles not-found task gracefully in cancel', async () => {
    const { status, body } = await api('/api/bulk/tasks/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids: ['nonexistent-1', 'nonexistent-2'] }),
    });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(0);
    expect(body.failed).toBe(2);
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toBeDefined();
  });

  // ── Bulk Retry Tasks ─────────────────────────

  it('retries multiple failed tasks', async () => {
    const ids = addTestTasks(2);
    ids.forEach(id => failTask(id));

    const { status, body } = await api('/api/bulk/tasks/retry', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);
  });

  it('handles already-completed task in retry', async () => {
    const ids = addTestTasks(1);
    coordinator.taskQueue.assign(ids[0], 'w');
    coordinator.taskQueue.start(ids[0]);
    coordinator.taskQueue.complete(ids[0]);

    const { status, body } = await api('/api/bulk/tasks/retry', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    expect(status).toBe(200);
    expect(body.failed).toBe(1);
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toMatch(/failed or cancelled/);
  });

  // ── Bulk Update Tasks ────────────────────────

  it('updates priority for multiple tasks', async () => {
    const ids = addTestTasks(2);

    const { status, body } = await api('/api/bulk/tasks/update', {
      method: 'POST',
      body: JSON.stringify({ ids, updates: { priority: 10 } }),
    });

    expect(status).toBe(200);
    expect(body.succeeded).toBe(2);
    // Verify updates applied
    const t = coordinator.taskQueue.get(ids[0]);
    expect(t.priority).toBe(10);
  });

  it('updates category for multiple tasks', async () => {
    const ids = addTestTasks(2);

    const { status, body } = await api('/api/bulk/tasks/update', {
      method: 'POST',
      body: JSON.stringify({ ids, updates: { category: 'refactoring' } }),
    });

    expect(status).toBe(200);
    expect(body.succeeded).toBe(2);
    const t = coordinator.taskQueue.get(ids[0]);
    expect(t.category).toBe('refactoring');
  });

  it('handles mixed success/failure in update', async () => {
    const ids = addTestTasks(1);
    // Complete the task so it can't be updated
    coordinator.taskQueue.assign(ids[0], 'w');
    coordinator.taskQueue.start(ids[0]);
    coordinator.taskQueue.complete(ids[0]);

    // Mix with a valid pending task
    const ids2 = addTestTasks(1);
    const allIds = [...ids, ...ids2];

    const { status, body } = await api('/api/bulk/tasks/update', {
      method: 'POST',
      body: JSON.stringify({ ids: allIds, updates: { priority: 8 } }),
    });

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(1);
  });
});

describe('Bulk Operations — Chains', () => {
  beforeAll(async () => {
    setupTestDir();
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('archives multiple chains', async () => {
    const regData = registry.load();
    const c1 = createChain(regData, { task: 'archive me 1', config: {} });
    const c2 = createChain(regData, { task: 'archive me 2', config: {} });
    updateChainStatus(c1, 'complete');
    updateChainStatus(c2, 'complete');
    registry.save(regData);

    const { status, body } = await api('/api/bulk/chains/archive', {
      method: 'POST',
      body: JSON.stringify({ ids: [c1.id, c2.id] }),
    });

    expect(status).toBe(200);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);

    // Verify status was set
    const updated = registry.load();
    const chain1 = updated.chains.find(c => c.id === c1.id);
    expect(chain1.status).toBe('archived');
  });

  it('handles not-found chain in archive', async () => {
    const { status, body } = await api('/api/bulk/chains/archive', {
      method: 'POST',
      body: JSON.stringify({ ids: ['no-such-chain'] }),
    });

    expect(status).toBe(200);
    expect(body.failed).toBe(1);
    expect(body.results[0].error).toBe('Chain not found');
  });
});

describe('Bulk Operations — DLQ', () => {
  beforeAll(async () => {
    setupTestDir();
    await startServer();
    coordinator = appInstance.coordinator;
    if (coordinator) coordinator.start();
  });

  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('retries multiple DLQ entries', async () => {
    const e1 = deadLetterQueue.add({ taskId: 'dt-1', task: 'fix bug A', category: 'dev' });
    const e2 = deadLetterQueue.add({ taskId: 'dt-2', task: 'fix bug B', category: 'dev' });

    const { status, body } = await api('/api/bulk/dead-letters/retry', {
      method: 'POST',
      body: JSON.stringify({ ids: [e1.id, e2.id] }),
    });

    expect(status).toBe(200);
    expect(body.succeeded).toBe(2);
    // Verify tasks were re-added to coordinator
    if (coordinator) {
      const all = coordinator.taskQueue.getAll();
      const retried = all.filter(t => t.metadata?.retriedFrom === e1.id || t.metadata?.retriedFrom === e2.id);
      expect(retried.length).toBe(2);
    }
  });

  it('handles not-found DLQ entry in retry', async () => {
    const { status, body } = await api('/api/bulk/dead-letters/retry', {
      method: 'POST',
      body: JSON.stringify({ ids: ['no-such-dlq'] }),
    });

    expect(status).toBe(200);
    expect(body.failed).toBe(1);
    expect(body.results[0].error).toBe('Not found');
  });

  it('dismisses multiple DLQ entries with reason', async () => {
    const e1 = deadLetterQueue.add({ taskId: 'dd-1', task: 'old task', category: 'ops' });
    const e2 = deadLetterQueue.add({ taskId: 'dd-2', task: 'stale task', category: 'ops' });

    const { status, body } = await api('/api/bulk/dead-letters/dismiss', {
      method: 'POST',
      body: JSON.stringify({ ids: [e1.id, e2.id], reason: 'no longer relevant' }),
    });

    expect(status).toBe(200);
    expect(body.succeeded).toBe(2);

    // Verify dismissal
    const entry = deadLetterQueue.get(e1.id);
    expect(entry.status).toBe('dismissed');
    expect(entry.dismissReason).toBe('no longer relevant');
  });

  it('handles not-found DLQ entry in dismiss', async () => {
    const { status, body } = await api('/api/bulk/dead-letters/dismiss', {
      method: 'POST',
      body: JSON.stringify({ ids: ['ghost-entry'] }),
    });

    expect(status).toBe(200);
    expect(body.failed).toBe(1);
    expect(body.results[0].error).toBe('Not found');
  });
});

describe('Bulk Operations — Validation', () => {
  beforeAll(async () => {
    setupTestDir();
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('rejects missing ids array', async () => {
    const { status, body } = await api('/api/bulk/tasks/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/ids must be an array/);
  });

  it('rejects empty ids array', async () => {
    const { status, body } = await api('/api/bulk/tasks/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids: [] }),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/must not be empty/);
  });

  it('rejects ids array > 100', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const { status, body } = await api('/api/bulk/tasks/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/exceeds maximum/);
  });

  it('rejects non-array ids', async () => {
    const { status, body } = await api('/api/bulk/tasks/retry', {
      method: 'POST',
      body: JSON.stringify({ ids: 'not-an-array' }),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/ids must be an array/);
  });
});

describe('Bulk Operations — 503 when subsystem unavailable', () => {
  beforeAll(async () => {
    setupTestDir();
    // Start without pool (no coordinator), no DLQ, no registry
    await startServer({ pool: false, deadLetterQueue: null, coordination: false });
  });

  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('returns 503 for bulk cancel when no coordinator', async () => {
    const { status, body } = await api('/api/bulk/tasks/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids: ['x'] }),
    });
    expect(status).toBe(503);
    expect(body.error).toMatch(/not available/);
  });

  it('returns 503 for bulk DLQ retry when no DLQ', async () => {
    const { status, body } = await api('/api/bulk/dead-letters/retry', {
      method: 'POST',
      body: JSON.stringify({ ids: ['x'] }),
    });
    expect(status).toBe(503);
    expect(body.error).toMatch(/not available/);
  });

  it('returns 503 for bulk DLQ dismiss when no DLQ', async () => {
    const { status, body } = await api('/api/bulk/dead-letters/dismiss', {
      method: 'POST',
      body: JSON.stringify({ ids: ['x'] }),
    });
    expect(status).toBe(503);
    expect(body.error).toMatch(/not available/);
  });
});

describe('Bulk Operations — Response Shape & Audit', () => {
  beforeAll(async () => {
    setupTestDir();
    await startServer();
    coordinator = appInstance.coordinator;
    coordinator.start();
  });

  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('returns correct total/succeeded/failed counts', async () => {
    const ids = addTestTasks(3);
    // Fail one and cancel it, then retry should only work on failed
    failTask(ids[0]);

    const { body } = await api('/api/bulk/tasks/retry', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    // ids[0] was failed → retried (success)
    // ids[1] and ids[2] are pending → can't retry (failure)
    expect(body.total).toBe(3);
    expect(body.succeeded).toBe(1);
    expect(body.failed).toBe(2);
    expect(body.results).toHaveLength(3);
  });

  it('records bulk action in audit log', async () => {
    // Clear audit log to start fresh
    const ids = addTestTasks(2);

    await api('/api/bulk/tasks/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    // Query audit log for our bulk action
    const { body } = await api('/api/audit?action=bulk.tasks.cancel');
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
    const entry = body.entries[0];
    expect(entry.action).toBe('bulk.tasks.cancel');
    expect(entry.detail.count).toBe(2);
    expect(entry.detail.succeeded).toBe(2);
    expect(entry.detail.failed).toBe(0);
  });

  it('processes each item independently — one failure does not stop others', async () => {
    const ids = addTestTasks(3);
    // Make the middle task running so it CAN'T be cancelled (throws error)
    coordinator.taskQueue.assign(ids[1], 'w');
    coordinator.taskQueue.start(ids[1]);

    const { body } = await api('/api/bulk/tasks/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });

    expect(body.total).toBe(3);
    // First and third should succeed (pending), second should fail (running)
    expect(body.results[0].success).toBe(true);
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].error).toMatch(/running/i);
    expect(body.results[2].success).toBe(true);
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(1);
  });
});
