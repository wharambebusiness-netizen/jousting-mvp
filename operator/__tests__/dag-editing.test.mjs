// ============================================================
// DAG Editing Tests — Phase 53 Interactive DAG Editing
// ============================================================
// Tests for addDep/removeDep on task queue, coordinator wrapper,
// persistent queue auto-save, and HTTP route endpoints.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTaskQueue } from '../coordination/task-queue.mjs';
import { createPersistentQueue } from '../coordination/persistent-queue.mjs';
import { createCoordinator } from '../coordination/coordinator.mjs';
import { EventBus } from '../../shared/event-bus.mjs';
import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';

// ── Test Helpers ────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_dag_editing');

function setupDir(dir) {
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {}
  mkdirSync(dir, { recursive: true });
}

function teardownDir(dir) {
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {}
}

function mockPool(workers = []) {
  const sent = [];
  return {
    getStatus: () => workers.map(w => ({ id: w.id || w, status: w.status || 'running' })),
    sendTo: (id, msg) => { sent.push({ id, msg }); return true; },
    activeCount: () => workers.filter(w => (w.status || 'running') === 'running').length,
    getSent: () => sent,
    clearSent: () => sent.length = 0,
  };
}

// ============================================================
// 1. Task Queue — addDep / removeDep
// ============================================================

describe('TaskQueue addDep/removeDep', () => {
  let queue;

  beforeEach(() => {
    queue = createTaskQueue();
    queue.add({ id: 'a', task: 'task A' });
    queue.add({ id: 'b', task: 'task B' });
    queue.add({ id: 'c', task: 'task C' });
  });

  // Test 1
  it('addDep adds dependency to pending task', () => {
    const result = queue.addDep('b', 'a');
    expect(result.deps).toContain('a');
    expect(result.id).toBe('b');
  });

  // Test 2
  it('addDep adds dependency to assigned task', () => {
    queue.assign('b', 'worker-1');
    const result = queue.addDep('b', 'a');
    expect(result.deps).toContain('a');
  });

  // Test 3
  it('addDep rejects for running task', () => {
    queue.assign('b', 'worker-1');
    queue.start('b');
    expect(() => queue.addDep('b', 'a')).toThrow('Cannot modify deps of running task');
  });

  // Test 4
  it('addDep rejects for complete task', () => {
    queue.assign('b', 'worker-1');
    queue.start('b');
    queue.complete('b');
    expect(() => queue.addDep('b', 'a')).toThrow('Cannot modify deps of complete task');
  });

  // Test 5
  it('addDep rejects for failed task', () => {
    queue.assign('b', 'worker-1');
    queue.start('b');
    queue.fail('b', 'error');
    expect(() => queue.addDep('b', 'a')).toThrow('Cannot modify deps of failed task');
  });

  // Test 6
  it('addDep rejects self-dependency', () => {
    expect(() => queue.addDep('a', 'a')).toThrow('Cannot add self-dependency');
  });

  // Test 7: Direct cycle A->B, then B->A
  it('addDep rejects if would create cycle (A->B, then B->A)', () => {
    queue.addDep('b', 'a'); // B depends on A
    expect(() => queue.addDep('a', 'b')).toThrow('cycle');
  });

  // Test 8
  it('addDep rejects if depId task does not exist', () => {
    expect(() => queue.addDep('a', 'nonexistent')).toThrow('not found');
  });

  // Test 9
  it('addDep rejects if taskId does not exist', () => {
    expect(() => queue.addDep('nonexistent', 'a')).toThrow('not found');
  });

  // Test 10
  it('addDep is idempotent (adding existing dep is no-op)', () => {
    queue.addDep('b', 'a');
    const result = queue.addDep('b', 'a'); // should not throw
    expect(result.deps.filter(d => d === 'a').length).toBe(1);
  });

  // Test 11
  it('removeDep removes dependency', () => {
    queue.addDep('b', 'a');
    const result = queue.removeDep('b', 'a');
    expect(result.deps).not.toContain('a');
  });

  // Test 12
  it('removeDep is no-op if dep does not exist in task', () => {
    const result = queue.removeDep('b', 'a'); // 'a' is not a dep of 'b'
    expect(result.id).toBe('b');
    expect(result.deps).not.toContain('a');
  });

  // Test 13
  it('removeDep rejects for running task', () => {
    queue.addDep('b', 'a');
    queue.assign('b', 'worker-1');
    queue.start('b');
    expect(() => queue.removeDep('b', 'a')).toThrow('Cannot modify deps of running task');
  });

  // Test 14: Graph reflects addDep
  it('after addDep, getDependencyGraph reflects new edge', () => {
    queue.addDep('b', 'a');
    const graph = queue.getDependencyGraph();
    const edge = graph.edges.find(e => e.from === 'a' && e.to === 'b');
    expect(edge).toBeDefined();
  });

  // Test 15: Graph reflects removeDep
  it('after removeDep, getDependencyGraph reflects removed edge', () => {
    queue.addDep('b', 'a');
    queue.removeDep('b', 'a');
    const graph = queue.getDependencyGraph();
    const edge = graph.edges.find(e => e.from === 'a' && e.to === 'b');
    expect(edge).toBeUndefined();
  });

  // Test 16: Transitive cycle detection
  it('cycle detection: transitive cycle A->B->C, then adding C->A rejected', () => {
    queue.addDep('b', 'a'); // B depends on A
    queue.addDep('c', 'b'); // C depends on B
    expect(() => queue.addDep('a', 'c')).toThrow('cycle');
  });

  // Test 25: Task readiness updates after dep removal
  it('task readiness updates after dep removal (task becomes ready if all other deps complete)', () => {
    queue.addDep('c', 'a');
    queue.addDep('c', 'b');

    // Complete a
    queue.assign('a', 'w');
    queue.start('a');
    queue.complete('a');

    // C still blocked because B not complete
    let ready = queue.getReady();
    expect(ready.find(t => t.id === 'c')).toBeUndefined();

    // Remove dep on B — now only dep is completed A
    queue.removeDep('c', 'b');
    ready = queue.getReady();
    expect(ready.find(t => t.id === 'c')).toBeDefined();
  });

  // Test 26: Task readiness updates after dep addition
  it('task readiness updates after dep addition (task becomes blocked)', () => {
    // C is ready (no deps)
    let ready = queue.getReady();
    expect(ready.find(t => t.id === 'c')).toBeDefined();

    // Add dep on A (not complete)
    queue.addDep('c', 'a');
    ready = queue.getReady();
    expect(ready.find(t => t.id === 'c')).toBeUndefined();
  });

  // Test 27: Levels recalculation after dep add/remove
  it('levels recalculation after dep add/remove', () => {
    // Initially all at level 0
    let levels = queue.getLevels();
    expect(levels.length).toBe(1);
    expect(levels[0]).toContain('a');
    expect(levels[0]).toContain('b');
    expect(levels[0]).toContain('c');

    // Add chain: a -> b -> c
    queue.addDep('b', 'a');
    queue.addDep('c', 'b');
    levels = queue.getLevels();
    expect(levels.length).toBe(3);
    expect(levels[0]).toContain('a');
    expect(levels[1]).toContain('b');
    expect(levels[2]).toContain('c');

    // Remove b -> a dep: now b is level 0, c level 1
    queue.removeDep('b', 'a');
    levels = queue.getLevels();
    expect(levels.length).toBe(2);
    expect(levels[0]).toContain('a');
    expect(levels[0]).toContain('b');
    expect(levels[1]).toContain('c');
  });
});

// ============================================================
// 2. Coordinator — event emission
// ============================================================

describe('Coordinator addDep/removeDep', () => {
  let events, coordinator;

  beforeEach(() => {
    events = new EventBus();
    const pool = mockPool([{ id: 'w1', status: 'running' }]);
    coordinator = createCoordinator({
      events,
      pool,
      options: { rateLimiterTickMs: 0, enableAdaptiveRate: false },
    });
    coordinator.start();
    coordinator.addTask({ id: 'a', task: 'task A' });
    coordinator.addTask({ id: 'b', task: 'task B' });
  });

  afterEach(() => {
    coordinator.stop();
  });

  // Test 17
  it('emits coord:dep-added event', () => {
    const emitted = [];
    events.on('coord:dep-added', (data) => emitted.push(data));
    coordinator.addDep('b', 'a');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ taskId: 'b', depId: 'a' });
  });

  // Test 18
  it('emits coord:dep-removed event', () => {
    coordinator.addDep('b', 'a');
    const emitted = [];
    events.on('coord:dep-removed', (data) => emitted.push(data));
    coordinator.removeDep('b', 'a');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ taskId: 'b', depId: 'a' });
  });
});

// ============================================================
// 3. Persistent Queue — auto-save on addDep/removeDep
// ============================================================

describe('PersistentQueue saves after addDep/removeDep', () => {
  const PQ_DIR = join(TEST_DIR, 'pq');

  beforeEach(() => {
    setupDir(PQ_DIR);
  });

  afterEach(() => {
    teardownDir(TEST_DIR);
  });

  // Test 19
  it('persistent queue saves after addDep', () => {
    const filePath = join(PQ_DIR, 'queue.json');
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 'x', task: 'X' });
    pq.add({ id: 'y', task: 'Y' });
    pq.addDep('y', 'x');

    // Verify file was written and contains the dep
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const taskY = data.tasks.find(t => t.id === 'y');
    expect(taskY.deps).toContain('x');
  });
});

// ============================================================
// 4. HTTP Routes — dep management
// ============================================================

describe('Coordination dep routes', () => {
  let appInstance, baseUrl;

  async function startServer() {
    const { createApp } = await import('../server.mjs');
    const operatorDir = join(TEST_DIR, 'routes');
    setupDir(operatorDir);

    appInstance = createApp({
      operatorDir,
      enableFileWatcher: false,
      pool: true,
      coordination: {
        rateLimiterTickMs: 0,
        globalBudgetUsd: 50,
        perWorkerBudgetUsd: 10,
      },
      auth: false,
    });
    return new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        const port = appInstance.server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  async function stopServer() {
    if (appInstance) {
      await appInstance.close();
      appInstance = null;
    }
  }

  beforeEach(async () => {
    setupDir(TEST_DIR);
    await startServer();
    // Start coordinator
    await fetch(`${baseUrl}/api/coordination/start`, { method: 'POST' });
    // Add tasks
    await fetch(`${baseUrl}/api/coordination/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't1', task: 'Task 1' }),
    });
    await fetch(`${baseUrl}/api/coordination/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't2', task: 'Task 2' }),
    });
    await fetch(`${baseUrl}/api/coordination/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 't3', task: 'Task 3' }),
    });
  });

  afterEach(async () => {
    await stopServer();
    teardownDir(TEST_DIR);
  });

  // Test 20
  it('POST /api/coordination/tasks/:id/deps adds dep', async () => {
    const res = await fetch(`${baseUrl}/api/coordination/tasks/t2/deps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depId: 't1' }),
    });
    expect(res.status).toBe(200);
    const task = await res.json();
    expect(task.deps).toContain('t1');
  });

  // Test 21
  it('POST /api/coordination/tasks/:id/deps rejects cycle with 400', async () => {
    // Add t2 depends on t1
    await fetch(`${baseUrl}/api/coordination/tasks/t2/deps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depId: 't1' }),
    });

    // Try to add t1 depends on t2 (cycle)
    const res = await fetch(`${baseUrl}/api/coordination/tasks/t1/deps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depId: 't2' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cycle/i);
  });

  // Test 22
  it('DELETE /api/coordination/tasks/:id/deps/:depId removes dep', async () => {
    // First add the dep
    await fetch(`${baseUrl}/api/coordination/tasks/t2/deps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depId: 't1' }),
    });

    // Then remove it
    const res = await fetch(`${baseUrl}/api/coordination/tasks/t2/deps/t1`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const task = await res.json();
    expect(task.deps).not.toContain('t1');
  });

  // Test 23
  it('POST returns 400 for missing depId in body', async () => {
    const res = await fetch(`${baseUrl}/api/coordination/tasks/t2/deps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/depId/i);
  });

  // Test 24
  it('DELETE returns 404 for non-existent task', async () => {
    const res = await fetch(`${baseUrl}/api/coordination/tasks/nonexistent/deps/t1`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});
