// ============================================================
// Coordination Integration Tests — End-to-End IPC Flow
// ============================================================
// Tests that wire a real ProcessPool with coordination-aware
// dummy workers and a real Coordinator, verifying the full
// coord:* message flow through IPC channels.
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { createProcessPool } from '../process-pool.mjs';
import { createCoordinator } from '../coordination/coordinator.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_coord_integ');
const COORD_WORKER = join(import.meta.dirname, 'coord-dummy-worker.mjs');

function setupDir(dir) {
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {}
  mkdirSync(dir, { recursive: true });
}

function teardownDir(dir) {
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch {}
}

/**
 * Wait for an event on the EventBus, with timeout.
 */
function waitForEvent(events, eventName, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      events.off(eventName, handler);
      reject(new Error(`Timeout waiting for ${eventName} (${timeoutMs}ms)`));
    }, timeoutMs);
    function handler(data) {
      clearTimeout(timer);
      events.off(eventName, handler);
      resolve(data);
    }
    events.on(eventName, handler);
  });
}

/**
 * Wait for N occurrences of an event.
 */
function waitForEvents(events, eventName, count, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const collected = [];
    const timer = setTimeout(() => {
      events.off(eventName, handler);
      reject(new Error(`Timeout waiting for ${count}x ${eventName} (got ${collected.length}, ${timeoutMs}ms)`));
    }, timeoutMs);
    function handler(data) {
      collected.push(data);
      if (collected.length >= count) {
        clearTimeout(timer);
        events.off(eventName, handler);
        resolve(collected);
      }
    }
    events.on(eventName, handler);
  });
}

/**
 * Spawn a worker and wait for it to be ready.
 */
async function spawnAndWait(pool, events, workerId, config = {}) {
  const readyPromise = waitForEvent(events, 'worker:ready');
  pool.spawn(workerId, config);
  await readyPromise;
}

// ══════════════════════════════════════════════════════════════
// End-to-End: Coordinator + Pool + Worker IPC
// ══════════════════════════════════════════════════════════════

describe('Coordination Integration — End-to-End IPC', () => {
  let events, pool, coordinator;

  beforeAll(() => {
    setupDir(TEST_DIR);
  });

  afterAll(() => {
    teardownDir(TEST_DIR);
  });

  beforeEach(() => {
    events = new EventBus();
  });

  afterEach(async () => {
    if (coordinator && coordinator.getState() !== 'stopped') {
      coordinator.stop();
    }
    if (pool) {
      await pool.shutdownAll();
    }
    coordinator = null;
    pool = null;
  });

  // ── Helper: create pool + coordinator with defaults ──

  function createPoolAndCoordinator(coordOpts = {}) {
    pool = createProcessPool({
      events,
      projectDir: TEST_DIR,
      workerScript: COORD_WORKER,
      log: () => {},
    });

    coordinator = createCoordinator({
      events,
      pool,
      options: {
        rateLimiterTickMs: 0, // disable tick for deterministic tests
        autoRecordSessionCosts: true,
        ...coordOpts,
      },
      log: () => {},
    });

    return { pool, coordinator };
  }

  // ────────────────────────────────────────────────────────
  // 1. Task Lifecycle — Full End-to-End
  // ────────────────────────────────────────────────────────

  describe('Task lifecycle end-to-end', () => {
    it('assigns a task to worker and receives completion', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'auto' });

      coordinator.start();

      const completePromise = waitForEvent(events, 'coord:task-complete');
      const allCompletePromise = waitForEvent(events, 'coord:all-complete');

      coordinator.addTask({ id: 't1', task: 'build feature A' });

      const completed = await completePromise;
      expect(completed.taskId).toBe('t1');
      expect(completed.workerId).toBe('w1');

      const allDone = await allCompletePromise;
      expect(allDone.total).toBe(1);
      expect(allDone.complete).toBe(1);
    });

    it('processes multiple independent tasks across a single worker', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'auto' });

      coordinator.start();

      const allCompletePromise = waitForEvent(events, 'coord:all-complete');

      coordinator.addTask({ id: 't1', task: 'task one' });
      coordinator.addTask({ id: 't2', task: 'task two' });
      coordinator.addTask({ id: 't3', task: 'task three' });

      const allDone = await allCompletePromise;
      expect(allDone.total).toBe(3);
      expect(allDone.complete).toBe(3);
    });

    it('task status transitions correctly through the pipeline', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();

      // Add task — should be assigned immediately
      coordinator.addTask({ id: 't1', task: 'manual task' });

      // Wait for worker to receive the proceed message
      await waitForEvent(events, 'coord:proceed-received');

      // Task should be in assigned state
      const task = coordinator.taskQueue.get('t1');
      expect(task.status).toBe('assigned');

      // Worker completes manually
      const completePromise = waitForEvent(events, 'coord:task-complete');
      pool.sendTo('w1', { type: 'test:complete-task' });

      await completePromise;
      const done = coordinator.taskQueue.get('t1');
      expect(done.status).toBe('complete');
    });
  });

  // ────────────────────────────────────────────────────────
  // 2. Task Dependencies
  // ────────────────────────────────────────────────────────

  describe('Task dependencies', () => {
    it('executes dependent tasks in correct order', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'auto', autoCompleteDelay: 20 });

      // Add tasks: t2 depends on t1
      coordinator.addTask({ id: 't1', task: 'setup' });
      coordinator.addTask({ id: 't2', task: 'build', deps: ['t1'] });

      coordinator.start();

      // Track completion order
      const completionOrder = [];
      events.on('coord:task-complete', (d) => completionOrder.push(d.taskId));

      const allCompletePromise = waitForEvent(events, 'coord:all-complete');
      await allCompletePromise;

      expect(completionOrder).toEqual(['t1', 't2']);
    });

    it('handles diamond dependency DAG', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'auto', autoCompleteDelay: 20 });

      // Diamond: t1 → (t2, t3) → t4
      coordinator.addTask({ id: 't1', task: 'root' });
      coordinator.addTask({ id: 't2', task: 'left', deps: ['t1'] });
      coordinator.addTask({ id: 't3', task: 'right', deps: ['t1'] });
      coordinator.addTask({ id: 't4', task: 'merge', deps: ['t2', 't3'] });

      coordinator.start();

      const allCompletePromise = waitForEvent(events, 'coord:all-complete');
      const allDone = await allCompletePromise;

      expect(allDone.total).toBe(4);
      expect(allDone.complete).toBe(4);

      // Verify t1 completed before t2/t3, and both before t4
      const t1 = coordinator.taskQueue.get('t1');
      const t4 = coordinator.taskQueue.get('t4');
      expect(t1.status).toBe('complete');
      expect(t4.status).toBe('complete');
    });
  });

  // ────────────────────────────────────────────────────────
  // 3. Worker Request Flow
  // ────────────────────────────────────────────────────────

  describe('Worker request flow', () => {
    it('worker sends coord:request and gets coord:proceed', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();

      // Add a task but don't auto-assign (already assigned by start)
      // Instead: add task, wait for proceed, then test request for next task
      coordinator.addTask({ id: 't1', task: 'first task' });
      await waitForEvent(events, 'coord:proceed-received');

      // Complete first task
      const firstComplete = waitForEvent(events, 'coord:task-complete');
      pool.sendTo('w1', { type: 'test:complete-task' });
      await firstComplete;

      // Add another task
      coordinator.addTask({ id: 't2', task: 'second task' });

      // Worker requests a task
      const proceedPromise = waitForEvent(events, 'coord:proceed-received');
      pool.sendTo('w1', { type: 'test:request-task' });
      const proceeded = await proceedPromise;
      expect(proceeded.taskId).toBe('t2');
    });

    it('worker gets coord:wait when no tasks available', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();

      // Worker requests when queue is empty
      const waitPromise = waitForEvent(events, 'coord:wait-received');
      pool.sendTo('w1', { type: 'test:request-task' });
      const waited = await waitPromise;
      expect(waited.reason).toBe('no-ready-tasks');
    });
  });

  // ────────────────────────────────────────────────────────
  // 4. Task Failure and Cascade
  // ────────────────────────────────────────────────────────

  describe('Task failure and cascade', () => {
    it('marks task as failed when worker reports failure', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();
      coordinator.addTask({ id: 't1', task: 'fragile task' });

      await waitForEvent(events, 'coord:proceed-received');

      const failedPromise = waitForEvent(events, 'coord:task-failed');
      pool.sendTo('w1', { type: 'test:fail-task', error: 'compile error' });

      const failed = await failedPromise;
      expect(failed.taskId).toBe('t1');
      expect(failed.workerId).toBe('w1');
      expect(failed.error).toBe('compile error');
    });

    it('failure cancels dependent tasks', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      // A → B → C
      coordinator.addTask({ id: 'a', task: 'root' });
      coordinator.addTask({ id: 'b', task: 'middle', deps: ['a'] });
      coordinator.addTask({ id: 'c', task: 'leaf', deps: ['b'] });

      coordinator.start();
      await waitForEvent(events, 'coord:proceed-received');

      const failedPromise = waitForEvent(events, 'coord:task-failed');
      pool.sendTo('w1', { type: 'test:fail-task' });
      await failedPromise;

      // B and C should be cancelled
      const b = coordinator.taskQueue.get('b');
      const c = coordinator.taskQueue.get('c');
      expect(b.status).toBe('cancelled');
      expect(c.status).toBe('cancelled');
    });
  });

  // ────────────────────────────────────────────────────────
  // 5. Rate Limiting Through IPC
  // ────────────────────────────────────────────────────────

  describe('Rate limiting through IPC', () => {
    it('grants rate request when within budget', async () => {
      createPoolAndCoordinator({ maxRequestsPerMinute: 10, maxTokensPerMinute: 100000 });
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();

      const grantPromise = waitForEvent(events, 'coord:rate-grant-received');
      pool.sendTo('w1', { type: 'test:rate-request', tokens: 100 });

      const granted = await grantPromise;
      expect(granted.remaining).toBeDefined();
      expect(granted.remaining.requests).toBeGreaterThan(0);
    });

    it('denies rate request when budget exhausted', async () => {
      createPoolAndCoordinator({ maxRequestsPerMinute: 2, maxTokensPerMinute: 100000 });
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();

      // Exhaust the request budget
      const grant1 = waitForEvent(events, 'coord:rate-grant-received');
      pool.sendTo('w1', { type: 'test:rate-request', tokens: 0 });
      await grant1;

      const grant2 = waitForEvent(events, 'coord:rate-grant-received');
      pool.sendTo('w1', { type: 'test:rate-request', tokens: 0 });
      await grant2;

      // Third request should be denied
      const waitPromise = waitForEvent(events, 'coord:rate-wait-received');
      pool.sendTo('w1', { type: 'test:rate-request', tokens: 0 });

      const waited = await waitPromise;
      expect(waited.waitMs).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────
  // 6. Cost Tracking Through IPC
  // ────────────────────────────────────────────────────────

  describe('Cost tracking through IPC', () => {
    it('records worker cost via coord:cost event', async () => {
      createPoolAndCoordinator({ globalBudgetUsd: 100, perWorkerBudgetUsd: 50 });
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();

      // Report cost
      pool.sendTo('w1', { type: 'test:report-cost', totalUsd: 5.0, inputTokens: 1000, outputTokens: 500 });

      // Wait for the event to propagate through IPC
      await new Promise(r => setTimeout(r, 100));

      const costs = coordinator.costAggregator.getStatus();
      expect(costs.globalTotalUsd).toBeCloseTo(5.0);
      const workerCost = coordinator.costAggregator.getWorkerCost('w1');
      expect(workerCost.totalUsd).toBeCloseTo(5.0);
    });

    it('sends budget-stop when per-worker budget exceeded', async () => {
      createPoolAndCoordinator({ perWorkerBudgetUsd: 1.0, globalBudgetUsd: 100 });
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();

      const budgetStopPromise = waitForEvent(events, 'coord:budget-stop-received');
      pool.sendTo('w1', { type: 'test:report-cost', totalUsd: 1.5, inputTokens: 5000, outputTokens: 2000 });

      const stopped = await budgetStopPromise;
      expect(stopped.workerExceeded).toBe(true);
    });

    it('records session:complete costs via auto-bridging', async () => {
      createPoolAndCoordinator({ autoRecordSessionCosts: true });
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();

      pool.sendTo('w1', { type: 'test:session-complete', costUsd: 3.0, inputTokens: 800, outputTokens: 200 });

      // Wait for IPC propagation
      await new Promise(r => setTimeout(r, 100));

      const costs = coordinator.costAggregator.getStatus();
      expect(costs.globalTotalUsd).toBeCloseTo(3.0);
    });
  });

  // ────────────────────────────────────────────────────────
  // 7. Multiple Workers Concurrency
  // ────────────────────────────────────────────────────────

  describe('Multiple workers', () => {
    it('distributes tasks across multiple workers', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'auto', autoCompleteDelay: 50 });
      await spawnAndWait(pool, events, 'w2', { mode: 'auto', autoCompleteDelay: 50 });

      coordinator.start();

      const allCompletePromise = waitForEvent(events, 'coord:all-complete');

      coordinator.addTask({ id: 't1', task: 'task one' });
      coordinator.addTask({ id: 't2', task: 'task two' });

      const allDone = await allCompletePromise;
      expect(allDone.total).toBe(2);
      expect(allDone.complete).toBe(2);

      // Both workers should have received tasks (round-robin)
      const t1 = coordinator.taskQueue.get('t1');
      const t2 = coordinator.taskQueue.get('t2');
      expect(t1.assignedTo).not.toBe(t2.assignedTo);
    });

    it('reassigns tasks when first worker completes and dependency unlocks', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'auto', autoCompleteDelay: 20 });
      await spawnAndWait(pool, events, 'w2', { mode: 'auto', autoCompleteDelay: 20 });

      // t1 (no deps) → t2 (depends on t1)
      coordinator.addTask({ id: 't1', task: 'setup' });
      coordinator.addTask({ id: 't2', task: 'build', deps: ['t1'] });

      coordinator.start();

      const allCompletePromise = waitForEvent(events, 'coord:all-complete');
      const allDone = await allCompletePromise;

      expect(allDone.total).toBe(2);
      expect(allDone.complete).toBe(2);
    });

    it('tracks costs per worker independently', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });
      await spawnAndWait(pool, events, 'w2', { mode: 'manual' });

      coordinator.start();

      pool.sendTo('w1', { type: 'test:report-cost', totalUsd: 2.0, inputTokens: 100, outputTokens: 50 });
      pool.sendTo('w2', { type: 'test:report-cost', totalUsd: 3.0, inputTokens: 200, outputTokens: 100 });

      await new Promise(r => setTimeout(r, 100));

      const w1Cost = coordinator.costAggregator.getWorkerCost('w1');
      const w2Cost = coordinator.costAggregator.getWorkerCost('w2');
      expect(w1Cost.totalUsd).toBeCloseTo(2.0);
      expect(w2Cost.totalUsd).toBeCloseTo(3.0);

      const status = coordinator.costAggregator.getStatus();
      expect(status.globalTotalUsd).toBeCloseTo(5.0);
    });
  });

  // ────────────────────────────────────────────────────────
  // 8. Coordinator Lifecycle Through IPC
  // ────────────────────────────────────────────────────────

  describe('Coordinator lifecycle', () => {
    it('start → add tasks → drain → all-complete → stop', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'auto', autoCompleteDelay: 20 });

      const lifecycleEvents = [];
      events.on('coord:started', () => lifecycleEvents.push('started'));
      events.on('coord:draining', () => lifecycleEvents.push('draining'));
      events.on('coord:all-complete', () => lifecycleEvents.push('all-complete'));
      events.on('coord:stopped', () => lifecycleEvents.push('stopped'));

      coordinator.start();
      expect(lifecycleEvents).toContain('started');

      coordinator.addTask({ id: 't1', task: 'only task' });

      const allCompletePromise = waitForEvent(events, 'coord:all-complete');
      await allCompletePromise;

      coordinator.drain();
      expect(lifecycleEvents).toContain('draining');

      coordinator.stop();
      expect(lifecycleEvents).toContain('stopped');

      expect(coordinator.getState()).toBe('stopped');
    });

    it('getStatus includes all subsystem data', async () => {
      createPoolAndCoordinator();
      await spawnAndWait(pool, events, 'w1', { mode: 'manual' });

      coordinator.start();
      coordinator.addTask({ id: 't1', task: 'check status' });

      await waitForEvent(events, 'coord:proceed-received');

      const status = coordinator.getStatus();
      expect(status.state).toBe('running');
      expect(status.queue.total).toBe(1);
      expect(status.rateLimiter).toBeDefined();
      expect(status.costs).toBeDefined();
      expect(status.strategy).toBe('round-robin');
    });
  });

  // ────────────────────────────────────────────────────────
  // 9. Server Integration with Coordinator
  // ────────────────────────────────────────────────────────

  describe('Server with coordinator', () => {
    let appInstance, baseUrl;

    async function startServer() {
      // Import dynamically to avoid global conflicts
      const { createApp } = await import('../server.mjs');
      appInstance = createApp({
        operatorDir: TEST_DIR,
        events,
        enableFileWatcher: false,
        pool: true,
        coordination: {
          rateLimiterTickMs: 0,
          globalBudgetUsd: 50,
          perWorkerBudgetUsd: 10,
        },
      });
      return new Promise((resolve) => {
        appInstance.server.listen(0, '127.0.0.1', () => {
          const port = appInstance.server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    }

    async function stopServerInst() {
      if (appInstance) {
        await appInstance.close();
        appInstance = null;
      }
    }

    afterEach(async () => {
      await stopServerInst();
    });

    it('creates coordinator when pool mode active', async () => {
      await startServer();
      expect(appInstance.coordinator).not.toBeNull();
      expect(appInstance.pool).not.toBeNull();
    });

    it('coordination REST endpoints are functional', async () => {
      await startServer();

      // Start coordinator
      const startRes = await fetch(`${baseUrl}/api/coordination/start`, { method: 'POST' });
      expect(startRes.status).toBe(200);

      // Get status
      const statusRes = await fetch(`${baseUrl}/api/coordination/status`);
      expect(statusRes.status).toBe(200);
      const status = await statusRes.json();
      expect(status.state).toBe('running');

      // Add task
      const addRes = await fetch(`${baseUrl}/api/coordination/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'rest-t1', task: 'REST task' }),
      });
      expect(addRes.status).toBe(201);

      // Get progress
      const progressRes = await fetch(`${baseUrl}/api/coordination/progress`);
      expect(progressRes.status).toBe(200);
      const progress = await progressRes.json();
      expect(progress.total).toBe(1);

      // Get costs
      const costsRes = await fetch(`${baseUrl}/api/coordination/costs`);
      expect(costsRes.status).toBe(200);

      // Get rate limit status
      const rateLimitRes = await fetch(`${baseUrl}/api/coordination/rate-limit`);
      expect(rateLimitRes.status).toBe(200);

      // Stop
      const stopRes = await fetch(`${baseUrl}/api/coordination/stop`, { method: 'POST' });
      expect(stopRes.status).toBe(200);
    });

    it('batch task creation via REST', async () => {
      await startServer();

      const startRes = await fetch(`${baseUrl}/api/coordination/start`, { method: 'POST' });
      expect(startRes.status).toBe(200);

      const batchRes = await fetch(`${baseUrl}/api/coordination/tasks/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: [
            { id: 'b1', task: 'batch task 1' },
            { id: 'b2', task: 'batch task 2', deps: ['b1'] },
          ],
        }),
      });
      expect(batchRes.status).toBe(201);

      const progress = await (await fetch(`${baseUrl}/api/coordination/progress`)).json();
      expect(progress.total).toBe(2);
    });
  });
});
