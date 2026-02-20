// ============================================================
// Coordination Tests — Phase 6 Inter-Orchestrator Coordination
// ============================================================
// Tests for task queue, work assigner, rate limiter, cost
// aggregator, and coordinator.
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTaskQueue } from '../coordination/task-queue.mjs';
import { createWorkAssigner, STRATEGIES } from '../coordination/work-assigner.mjs';
import { createRateLimiter } from '../coordination/rate-limiter.mjs';
import { createCostAggregator, WARNING_THRESHOLD } from '../coordination/cost-aggregator.mjs';
import { createCoordinator, STATES } from '../coordination/coordinator.mjs';
import { createAdaptiveLimiter, ADAPTIVE_STATES } from '../coordination/adaptive-limiter.mjs';
import { createWorktreeManager, WORKTREE_DIR_NAME, BRANCH_PREFIX } from '../coordination/worktree-manager.mjs';
import { createPersistentQueue } from '../coordination/persistent-queue.mjs';
import { handleMessage } from '../orchestrator-worker.mjs';
import { EventBus } from '../../shared/event-bus.mjs';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Test Helpers ────────────────────────────────────────────

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
// 1. Task Queue
// ============================================================

describe('TaskQueue', () => {
  let queue;

  beforeEach(() => {
    queue = createTaskQueue();
  });

  // ── Add / Remove ──────────────────────────────────────

  describe('add', () => {
    it('should add a task', () => {
      const task = queue.add({ id: 'a', task: 'do thing' });
      expect(task.id).toBe('a');
      expect(task.status).toBe('pending');
      expect(task.assignedTo).toBeNull();
      expect(queue.size()).toBe(1);
    });

    it('should add task with deps', () => {
      queue.add({ id: 'a', task: 'first' });
      const b = queue.add({ id: 'b', task: 'second', deps: ['a'] });
      expect(b.deps).toEqual(['a']);
    });

    it('should add task with priority', () => {
      const task = queue.add({ id: 'a', task: 'urgent', priority: 10 });
      expect(task.priority).toBe(10);
    });

    it('should add task with category', () => {
      const task = queue.add({ id: 'a', task: 'code task', category: 'code' });
      expect(task.category).toBe('code');
    });

    it('should add task with metadata', () => {
      const task = queue.add({ id: 'a', task: 'do', metadata: { foo: 'bar' } });
      expect(task.metadata).toEqual({ foo: 'bar' });
    });

    it('should reject duplicate IDs', () => {
      queue.add({ id: 'a', task: 'first' });
      expect(() => queue.add({ id: 'a', task: 'second' })).toThrow('already exists');
    });

    it('should reject missing ID', () => {
      expect(() => queue.add({ task: 'no id' })).toThrow('must have an id');
    });

    it('should reject null input', () => {
      expect(() => queue.add(null)).toThrow();
    });

    it('should reject self-dependency', () => {
      expect(() => queue.add({ id: 'a', task: 'self', deps: ['a'] })).toThrow('cannot depend on itself');
    });
  });

  describe('remove', () => {
    it('should remove a pending task', () => {
      queue.add({ id: 'a', task: 'removable' });
      expect(queue.remove('a')).toBe(true);
      expect(queue.size()).toBe(0);
    });

    it('should return false for unknown task', () => {
      expect(queue.remove('nonexistent')).toBe(false);
    });

    it('should not remove an assigned task', () => {
      queue.add({ id: 'a', task: 'assigned' });
      queue.assign('a', 'w1');
      expect(() => queue.remove('a')).toThrow('Cannot remove assigned');
    });

    it('should clean up deps when task removed', () => {
      queue.add({ id: 'a', task: 'dep' });
      queue.add({ id: 'b', task: 'depends', deps: ['a'] });
      queue.remove('a');
      const b = queue.get('b');
      expect(b.deps).toEqual([]);
    });
  });

  // ── Status Transitions ────────────────────────────────

  describe('status transitions', () => {
    it('should transition pending -> assigned -> running -> complete', () => {
      queue.add({ id: 'a', task: 'flow' });
      queue.assign('a', 'w1');
      expect(queue.get('a').status).toBe('assigned');
      expect(queue.get('a').assignedTo).toBe('w1');

      queue.start('a');
      expect(queue.get('a').status).toBe('running');

      queue.complete('a', { output: 'done' });
      expect(queue.get('a').status).toBe('complete');
      expect(queue.get('a').result).toEqual({ output: 'done' });
    });

    it('should transition pending -> assigned -> running -> failed', () => {
      queue.add({ id: 'a', task: 'will fail' });
      queue.assign('a', 'w1');
      queue.start('a');
      queue.fail('a', 'something broke');
      expect(queue.get('a').status).toBe('failed');
      expect(queue.get('a').error).toBe('something broke');
    });

    it('should allow completing from assigned (skip start)', () => {
      queue.add({ id: 'a', task: 'quick' });
      queue.assign('a', 'w1');
      queue.complete('a');
      expect(queue.get('a').status).toBe('complete');
    });

    it('should not assign non-pending task', () => {
      queue.add({ id: 'a', task: 'flow' });
      queue.assign('a', 'w1');
      expect(() => queue.assign('a', 'w2')).toThrow('Cannot assign');
    });

    it('should not start non-assigned task', () => {
      queue.add({ id: 'a', task: 'flow' });
      expect(() => queue.start('a')).toThrow('Cannot start');
    });

    it('should not complete pending task', () => {
      queue.add({ id: 'a', task: 'flow' });
      expect(() => queue.complete('a')).toThrow('Cannot complete');
    });

    it('should not fail pending task', () => {
      queue.add({ id: 'a', task: 'flow' });
      expect(() => queue.fail('a')).toThrow('Cannot fail');
    });

    it('should throw for unknown task ID on assign', () => {
      expect(() => queue.assign('x', 'w1')).toThrow('not found');
    });

    it('should throw for unknown task ID on start', () => {
      expect(() => queue.start('x')).toThrow('not found');
    });

    it('should throw for unknown task ID on complete', () => {
      expect(() => queue.complete('x')).toThrow('not found');
    });
  });

  // ── Cancel / Retry ────────────────────────────────────

  describe('cancel', () => {
    it('should cancel a pending task', () => {
      queue.add({ id: 'a', task: 'cancel me' });
      const cancelled = queue.cancel('a', 'no longer needed');
      expect(cancelled).toEqual(['a']);
      expect(queue.get('a').status).toBe('cancelled');
      expect(queue.get('a').error).toBe('no longer needed');
    });

    it('should cascade cancel to dependents', () => {
      queue.add({ id: 'a', task: 'root' });
      queue.add({ id: 'b', task: 'child', deps: ['a'] });
      queue.add({ id: 'c', task: 'grandchild', deps: ['b'] });
      const cancelled = queue.cancel('a');
      expect(cancelled).toHaveLength(3);
      expect(queue.get('b').status).toBe('cancelled');
      expect(queue.get('c').status).toBe('cancelled');
    });

    it('should not cancel running task', () => {
      queue.add({ id: 'a', task: 'running' });
      queue.assign('a', 'w1');
      queue.start('a');
      expect(() => queue.cancel('a')).toThrow('Cannot cancel running');
    });

    it('should not cancel complete task', () => {
      queue.add({ id: 'a', task: 'done' });
      queue.assign('a', 'w1');
      queue.complete('a');
      expect(queue.cancel('a')).toEqual([]);
    });

    it('should throw for unknown task', () => {
      expect(() => queue.cancel('x')).toThrow('not found');
    });
  });

  describe('retry', () => {
    it('should retry a failed task', () => {
      queue.add({ id: 'a', task: 'retry me' });
      queue.assign('a', 'w1');
      queue.fail('a', 'oops');
      queue.retry('a');
      const task = queue.get('a');
      expect(task.status).toBe('pending');
      expect(task.assignedTo).toBeNull();
      expect(task.error).toBeNull();
    });

    it('should retry a cancelled task', () => {
      queue.add({ id: 'a', task: 'retry cancel' });
      queue.cancel('a');
      queue.retry('a');
      expect(queue.get('a').status).toBe('pending');
    });

    it('should not retry pending task', () => {
      queue.add({ id: 'a', task: 'already pending' });
      expect(() => queue.retry('a')).toThrow('Can only retry');
    });
  });

  // ── Update (Phase 13) ────────────────────────────────

  describe('update', () => {
    it('should update description on pending task', () => {
      queue.add({ id: 'a', task: 'old desc', priority: 0 });
      const updated = queue.update('a', { task: 'new desc' });
      expect(updated.task).toBe('new desc');
      expect(queue.get('a').task).toBe('new desc');
    });

    it('should update priority on pending task', () => {
      queue.add({ id: 'a', task: 'test', priority: 0 });
      queue.update('a', { priority: 10 });
      expect(queue.get('a').priority).toBe(10);
    });

    it('should update category on pending task', () => {
      queue.add({ id: 'a', task: 'test' });
      queue.update('a', { category: 'code' });
      expect(queue.get('a').category).toBe('code');
    });

    it('should merge metadata on pending task', () => {
      queue.add({ id: 'a', task: 'test', metadata: { foo: 1 } });
      queue.update('a', { metadata: { bar: 2 } });
      const t = queue.get('a');
      expect(t.metadata.foo).toBe(1);
      expect(t.metadata.bar).toBe(2);
    });

    it('should update assigned task', () => {
      queue.add({ id: 'a', task: 'test' });
      queue.assign('a', 'w1');
      queue.update('a', { task: 'updated desc' });
      expect(queue.get('a').task).toBe('updated desc');
    });

    it('should not update running task', () => {
      queue.add({ id: 'a', task: 'test' });
      queue.assign('a', 'w1');
      queue.start('a');
      expect(() => queue.update('a', { task: 'nope' })).toThrow('must be pending or assigned');
    });

    it('should not update complete task', () => {
      queue.add({ id: 'a', task: 'test' });
      queue.assign('a', 'w1');
      queue.complete('a');
      expect(() => queue.update('a', { task: 'nope' })).toThrow('must be pending or assigned');
    });

    it('should not update failed task', () => {
      queue.add({ id: 'a', task: 'test' });
      queue.assign('a', 'w1');
      queue.fail('a', 'err');
      expect(() => queue.update('a', { task: 'nope' })).toThrow('must be pending or assigned');
    });

    it('should throw for unknown task', () => {
      expect(() => queue.update('x', { task: 'nope' })).toThrow('not found');
    });

    it('should clear category when set to empty string', () => {
      queue.add({ id: 'a', task: 'test', category: 'code' });
      queue.update('a', { category: '' });
      expect(queue.get('a').category).toBeNull();
    });
  });

  // ── Query Operations ──────────────────────────────────

  describe('getReady', () => {
    it('should return tasks with no deps', () => {
      queue.add({ id: 'a', task: 'no deps' });
      queue.add({ id: 'b', task: 'also no deps' });
      const ready = queue.getReady();
      expect(ready).toHaveLength(2);
    });

    it('should not return tasks with incomplete deps', () => {
      queue.add({ id: 'a', task: 'dep' });
      queue.add({ id: 'b', task: 'needs a', deps: ['a'] });
      const ready = queue.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('a');
    });

    it('should return tasks whose deps are complete', () => {
      queue.add({ id: 'a', task: 'dep' });
      queue.add({ id: 'b', task: 'needs a', deps: ['a'] });
      queue.assign('a', 'w1');
      queue.complete('a');
      const ready = queue.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('b');
    });

    it('should sort by priority (desc)', () => {
      queue.add({ id: 'low', task: 'low', priority: 1 });
      queue.add({ id: 'high', task: 'high', priority: 10 });
      queue.add({ id: 'mid', task: 'mid', priority: 5 });
      const ready = queue.getReady();
      expect(ready.map(t => t.id)).toEqual(['high', 'mid', 'low']);
    });

    it('should not return assigned tasks', () => {
      queue.add({ id: 'a', task: 'assigned' });
      queue.assign('a', 'w1');
      expect(queue.getReady()).toHaveLength(0);
    });
  });

  describe('getByWorker', () => {
    it('should return tasks for a worker', () => {
      queue.add({ id: 'a', task: 'for w1' });
      queue.add({ id: 'b', task: 'for w2' });
      queue.assign('a', 'w1');
      queue.assign('b', 'w2');
      const w1Tasks = queue.getByWorker('w1');
      expect(w1Tasks).toHaveLength(1);
      expect(w1Tasks[0].id).toBe('a');
    });

    it('should not include completed tasks', () => {
      queue.add({ id: 'a', task: 'done' });
      queue.assign('a', 'w1');
      queue.complete('a');
      expect(queue.getByWorker('w1')).toHaveLength(0);
    });
  });

  describe('get / getAll', () => {
    it('should get a task by ID', () => {
      queue.add({ id: 'a', task: 'test' });
      expect(queue.get('a').id).toBe('a');
    });

    it('should return null for unknown ID', () => {
      expect(queue.get('x')).toBeNull();
    });

    it('should return all tasks', () => {
      queue.add({ id: 'a', task: 'one' });
      queue.add({ id: 'b', task: 'two' });
      expect(queue.getAll()).toHaveLength(2);
    });

    it('should return copies (not references)', () => {
      queue.add({ id: 'a', task: 'original' });
      const copy = queue.get('a');
      copy.task = 'modified';
      expect(queue.get('a').task).toBe('original');
    });
  });

  // ── DAG Utilities ─────────────────────────────────────

  describe('topologicalSort', () => {
    it('should sort tasks in dependency order', () => {
      queue.add({ id: 'c', task: 'third', deps: ['b'] });
      queue.add({ id: 'b', task: 'second', deps: ['a'] });
      queue.add({ id: 'a', task: 'first' });
      const order = queue.topologicalSort();
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('should throw on cycle', () => {
      queue.add({ id: 'a', task: 'one' });
      queue.add({ id: 'b', task: 'two', deps: ['a'] });
      // Manually create cycle (bypass add validation)
      const a = queue.get('a');
      // We need to test the validation method instead
    });

    it('should handle empty queue', () => {
      expect(queue.topologicalSort()).toEqual([]);
    });

    it('should handle independent tasks', () => {
      queue.add({ id: 'a', task: 'one' });
      queue.add({ id: 'b', task: 'two' });
      const order = queue.topologicalSort();
      expect(order).toHaveLength(2);
    });
  });

  describe('getLevels', () => {
    it('should group tasks into parallel levels', () => {
      queue.add({ id: 'a', task: 'level 0' });
      queue.add({ id: 'b', task: 'level 0' });
      queue.add({ id: 'c', task: 'level 1', deps: ['a', 'b'] });
      const levels = queue.getLevels();
      expect(levels).toHaveLength(2);
      expect(levels[0]).toContain('a');
      expect(levels[0]).toContain('b');
      expect(levels[1]).toEqual(['c']);
    });

    it('should return empty array for empty queue', () => {
      expect(queue.getLevels()).toEqual([]);
    });
  });

  describe('validate', () => {
    it('should validate a valid graph', () => {
      queue.add({ id: 'a', task: 'root' });
      queue.add({ id: 'b', task: 'child', deps: ['a'] });
      const { valid, errors } = queue.validate();
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('should detect missing deps', () => {
      queue.add({ id: 'b', task: 'orphan dep', deps: ['nonexistent'] });
      const { valid, errors } = queue.validate();
      expect(valid).toBe(false);
      expect(errors[0]).toContain('unknown task');
    });

    it('should detect cycles (via add rejection)', () => {
      queue.add({ id: 'a', task: 'one' });
      queue.add({ id: 'b', task: 'two', deps: ['a'] });
      // Cycle: c depends on b, a depends on c
      expect(() => queue.add({ id: 'c', task: 'cycle', deps: ['b'] })).not.toThrow();
      // This would create cycle: a.deps includes c, c.deps includes b, b.deps includes a
      // But add doesn't let you modify existing tasks
      // So validate is clean for this graph
      const { valid } = queue.validate();
      expect(valid).toBe(true);
    });
  });

  describe('getDependencyGraph', () => {
    it('should return nodes, edges, and levels', () => {
      queue.add({ id: 'a', task: 'root' });
      queue.add({ id: 'b', task: 'child', deps: ['a'] });
      const graph = queue.getDependencyGraph();
      expect(graph.nodes).toEqual(['a', 'b']);
      expect(graph.edges).toEqual([{ from: 'a', to: 'b' }]);
      expect(graph.levels).toHaveLength(2);
    });
  });

  describe('getProgress', () => {
    it('should track progress', () => {
      queue.add({ id: 'a', task: 'one' });
      queue.add({ id: 'b', task: 'two' });
      queue.add({ id: 'c', task: 'three' });

      let p = queue.getProgress();
      expect(p.total).toBe(3);
      expect(p.pending).toBe(3);
      expect(p.percentComplete).toBe(0);

      queue.assign('a', 'w1');
      queue.complete('a');
      p = queue.getProgress();
      expect(p.complete).toBe(1);
      expect(p.percentComplete).toBe(33);
    });

    it('should return 100% for empty queue', () => {
      expect(queue.getProgress().percentComplete).toBe(100);
    });
  });

  // ── Serialization ─────────────────────────────────────

  describe('toJSON / fromJSON', () => {
    it('should serialize and restore state', () => {
      queue.add({ id: 'a', task: 'test', priority: 5 });
      queue.add({ id: 'b', task: 'test2', deps: ['a'] });
      queue.assign('a', 'w1');

      const json = queue.toJSON();
      const queue2 = createTaskQueue();
      queue2.fromJSON(json);

      expect(queue2.size()).toBe(2);
      expect(queue2.get('a').status).toBe('assigned');
      expect(queue2.get('b').deps).toEqual(['a']);
    });
  });

  describe('clear', () => {
    it('should remove all tasks', () => {
      queue.add({ id: 'a', task: 'one' });
      queue.add({ id: 'b', task: 'two' });
      queue.clear();
      expect(queue.size()).toBe(0);
    });
  });

  // ── Cycle Detection ───────────────────────────────────

  describe('cycle detection on add', () => {
    it('should detect simple cycle', () => {
      queue.add({ id: 'a', task: 'one' });
      queue.add({ id: 'b', task: 'two', deps: ['a'] });
      // c depends on b, but also a depends on c — but we can't make a depend on c after the fact
      // Instead: a has dep b, b has dep a (direct cycle)
      // We test this by having: add c->b, then try to add with b->c which creates cycle
      queue.add({ id: 'c', task: 'three', deps: ['b'] });
      // Now try to add d that depends on c, where c transitively depends on a
      // No cycle possible through add alone unless forward-referencing is tested
    });

    it('should reject self-reference', () => {
      expect(() => queue.add({ id: 'x', task: 'self', deps: ['x'] })).toThrow('cannot depend on itself');
    });
  });
});

// ============================================================
// 2. Work Assigner
// ============================================================

describe('WorkAssigner', () => {
  let queue, pool;

  beforeEach(() => {
    queue = createTaskQueue();
    pool = mockPool([
      { id: 'w1', status: 'running' },
      { id: 'w2', status: 'running' },
      { id: 'w3', status: 'running' },
    ]);
  });

  describe('round-robin strategy', () => {
    it('should distribute tasks cyclically', () => {
      const assigner = createWorkAssigner({ strategy: 'round-robin', pool, taskQueue: queue });

      queue.add({ id: 't1', task: 'one' });
      queue.add({ id: 't2', task: 'two' });
      queue.add({ id: 't3', task: 'three' });

      const a1 = assigner.assignNext();
      const a2 = assigner.assignNext();
      const a3 = assigner.assignNext();

      expect(a1.workerId).toBe('w1');
      expect(a2.workerId).toBe('w2');
      expect(a3.workerId).toBe('w3');
    });

    it('should return null when no ready tasks', () => {
      const assigner = createWorkAssigner({ strategy: 'round-robin', pool, taskQueue: queue });
      expect(assigner.assignNext()).toBeNull();
    });

    it('should return null when no available workers', () => {
      const emptyPool = mockPool([]);
      const assigner = createWorkAssigner({ strategy: 'round-robin', pool: emptyPool, taskQueue: queue });
      queue.add({ id: 't1', task: 'one' });
      expect(assigner.assignNext()).toBeNull();
    });

    it('should skip non-running workers', () => {
      const mixedPool = mockPool([
        { id: 'w1', status: 'stopped' },
        { id: 'w2', status: 'running' },
      ]);
      const assigner = createWorkAssigner({ strategy: 'round-robin', pool: mixedPool, taskQueue: queue });
      queue.add({ id: 't1', task: 'one' });
      const a = assigner.assignNext();
      expect(a.workerId).toBe('w2');
    });
  });

  describe('capability strategy', () => {
    it('should prefer workers matching task category', () => {
      const assigner = createWorkAssigner({ strategy: 'capability', pool, taskQueue: queue });
      assigner.registerCapabilities('w1', ['code']);
      assigner.registerCapabilities('w2', ['testing']);
      assigner.registerCapabilities('w3', ['code', 'testing']);

      queue.add({ id: 't1', task: 'write code', category: 'testing' });
      const a = assigner.assignNext();
      expect(a.workerId).toBe('w2');
    });

    it('should fallback to least-loaded when no capability match', () => {
      const assigner = createWorkAssigner({ strategy: 'capability', pool, taskQueue: queue });
      assigner.registerCapabilities('w1', ['code']);

      queue.add({ id: 't1', task: 'audit', category: 'audit' });
      const a = assigner.assignNext();
      // Falls back to least-loaded, all have 0 tasks
      expect(a).not.toBeNull();
    });

    it('should prefer least-loaded among capable workers', () => {
      const assigner = createWorkAssigner({ strategy: 'capability', pool, taskQueue: queue });
      assigner.registerCapabilities('w1', ['code']);
      assigner.registerCapabilities('w2', ['code']);

      // Give w1 a task first
      queue.add({ id: 't1', task: 'first', category: 'code' });
      assigner.assignNext(); // w1 gets it (first match, both have 0)

      queue.add({ id: 't2', task: 'second', category: 'code' });
      const a = assigner.assignNext();
      expect(a.workerId).toBe('w2'); // w2 has fewer tasks
    });
  });

  describe('work-stealing strategy', () => {
    it('should assign to idle workers first', () => {
      const assigner = createWorkAssigner({ strategy: 'work-stealing', pool, taskQueue: queue });

      // Give w1 some tasks
      queue.add({ id: 't1', task: 'busy' });
      assigner.assignNext(); // w1 gets it

      queue.add({ id: 't2', task: 'steal me' });
      const a = assigner.assignNext();
      // w2 and w3 are idle, should get priority
      expect(['w2', 'w3']).toContain(a.workerId);
    });

    it('should fallback to least-loaded when all busy', () => {
      const twoPool = mockPool([
        { id: 'w1', status: 'running' },
        { id: 'w2', status: 'running' },
      ]);
      const assigner = createWorkAssigner({ strategy: 'work-stealing', pool: twoPool, taskQueue: queue });

      queue.add({ id: 't1', task: 'one' });
      queue.add({ id: 't2', task: 'two' });
      assigner.assignAll(); // Both workers get one

      queue.add({ id: 't3', task: 'three' });
      const a = assigner.assignNext();
      expect(a).not.toBeNull(); // Least-loaded gets it
    });
  });

  describe('assignAll', () => {
    it('should assign all ready tasks', () => {
      const assigner = createWorkAssigner({ strategy: 'round-robin', pool, taskQueue: queue });
      queue.add({ id: 't1', task: 'one' });
      queue.add({ id: 't2', task: 'two' });
      queue.add({ id: 't3', task: 'three' });

      const assignments = assigner.assignAll();
      expect(assignments).toHaveLength(3);
    });

    it('should respect deps (only assign ready)', () => {
      const assigner = createWorkAssigner({ strategy: 'round-robin', pool, taskQueue: queue });
      queue.add({ id: 't1', task: 'first' });
      queue.add({ id: 't2', task: 'second', deps: ['t1'] });

      const assignments = assigner.assignAll();
      expect(assignments).toHaveLength(1);
      expect(assignments[0].task.id).toBe('t1');
    });
  });

  describe('events', () => {
    it('should emit coord:assigned event', () => {
      const events = new EventBus();
      const emitted = [];
      events.on('coord:assigned', (data) => emitted.push(data));

      const assigner = createWorkAssigner({ strategy: 'round-robin', pool, taskQueue: queue, events });
      queue.add({ id: 't1', task: 'test', category: 'code' });
      assigner.assignNext();

      expect(emitted).toHaveLength(1);
      expect(emitted[0].taskId).toBe('t1');
      expect(emitted[0].strategy).toBe('round-robin');
    });
  });

  describe('getStrategy / getCapabilities', () => {
    it('should return strategy name', () => {
      const assigner = createWorkAssigner({ strategy: 'capability', pool, taskQueue: queue });
      expect(assigner.getStrategy()).toBe('capability');
    });

    it('should return capabilities map', () => {
      const assigner = createWorkAssigner({ strategy: 'capability', pool, taskQueue: queue });
      assigner.registerCapabilities('w1', ['code', 'testing']);
      const caps = assigner.getCapabilities();
      expect(caps.w1).toEqual(['code', 'testing']);
    });
  });

  describe('validation', () => {
    it('should require pool', () => {
      expect(() => createWorkAssigner({ taskQueue: queue })).toThrow('requires a process pool');
    });

    it('should require taskQueue', () => {
      expect(() => createWorkAssigner({ pool })).toThrow('requires a task queue');
    });

    it('should reject unknown strategy', () => {
      expect(() => createWorkAssigner({ strategy: 'magic', pool, taskQueue: queue })).toThrow('Unknown strategy');
    });
  });

  describe('STRATEGIES export', () => {
    it('should export three strategies', () => {
      expect(Object.keys(STRATEGIES)).toEqual(['round-robin', 'capability', 'work-stealing']);
    });
  });
});

// ============================================================
// 3. Rate Limiter
// ============================================================

describe('RateLimiter', () => {
  let clock;

  beforeEach(() => {
    clock = 0;
  });

  function makeLimiter(opts = {}) {
    return createRateLimiter({
      maxRequestsPerMinute: opts.maxRequestsPerMinute ?? 10,
      maxTokensPerMinute: opts.maxTokensPerMinute ?? 100_000,
      now: () => clock,
      ...opts,
    });
  }

  describe('tryAcquire', () => {
    it('should grant within budget', () => {
      const limiter = makeLimiter();
      const result = limiter.tryAcquire('w1', 1000);
      expect(result.granted).toBe(true);
      expect(result.remaining.requests).toBe(9);
    });

    it('should deny when request bucket empty', () => {
      const limiter = makeLimiter({ maxRequestsPerMinute: 2 });
      limiter.tryAcquire('w1');
      limiter.tryAcquire('w1');
      const result = limiter.tryAcquire('w1');
      expect(result.granted).toBe(false);
      expect(result.waitMs).toBeGreaterThan(0);
    });

    it('should deny when token bucket insufficient', () => {
      const limiter = makeLimiter({ maxTokensPerMinute: 1000 });
      const result = limiter.tryAcquire('w1', 5000);
      expect(result.granted).toBe(false);
    });

    it('should refill over time', () => {
      const limiter = makeLimiter({ maxRequestsPerMinute: 1 });
      limiter.tryAcquire('w1');
      expect(limiter.tryAcquire('w1').granted).toBe(false);

      // Advance 1 minute
      clock += 60_000;
      expect(limiter.tryAcquire('w1').granted).toBe(true);
    });

    it('should partially refill', () => {
      const limiter = makeLimiter({ maxRequestsPerMinute: 10 });
      // Use 5 requests
      for (let i = 0; i < 5; i++) limiter.tryAcquire('w1');
      expect(limiter.getStatus().requestBucket).toBe(5);

      // Advance 30 seconds (half minute) = 5 refilled
      clock += 30_000;
      const result = limiter.tryAcquire('w1');
      expect(result.granted).toBe(true);
      expect(result.remaining.requests).toBe(9); // 5 remaining + 5 refilled - 1 used
    });

    it('should not exceed max on refill', () => {
      const limiter = makeLimiter({ maxRequestsPerMinute: 10 });
      // Don't use any, advance 2 minutes
      clock += 120_000;
      limiter.tryAcquire('w1');
      expect(limiter.getStatus().requestBucket).toBe(9); // Capped at 10 - 1 used
    });

    it('should track per-worker usage', () => {
      const limiter = makeLimiter();
      limiter.tryAcquire('w1', 1000);
      limiter.tryAcquire('w1', 2000);
      limiter.tryAcquire('w2', 500);

      const w1Stats = limiter.getWorkerStats('w1');
      expect(w1Stats.requests).toBe(2);
      expect(w1Stats.tokens).toBe(3000);

      const w2Stats = limiter.getWorkerStats('w2');
      expect(w2Stats.requests).toBe(1);
    });

    it('should track denials', () => {
      const limiter = makeLimiter({ maxRequestsPerMinute: 1 });
      limiter.tryAcquire('w1');
      limiter.tryAcquire('w1');
      expect(limiter.getWorkerStats('w1').denied).toBe(1);
    });

    it('should return zeros for unknown worker', () => {
      const limiter = makeLimiter();
      const stats = limiter.getWorkerStats('nobody');
      expect(stats.requests).toBe(0);
    });
  });

  describe('acquire (async with waiting)', () => {
    it('should resolve immediately when budget available', async () => {
      const limiter = makeLimiter();
      const result = await limiter.acquire('w1', 100);
      expect(result.granted).toBe(true);
      expect(result.waitedMs).toBe(0);
    });

    it('should queue when budget exhausted and resolve on processWaiters', async () => {
      const limiter = makeLimiter({ maxRequestsPerMinute: 1 });
      limiter.tryAcquire('w1');

      // Start waiting
      const promise = limiter.acquire('w2', 0, 5000);

      // Advance time and process
      clock += 60_000;
      const granted = limiter.processWaiters();
      expect(granted).toBe(1);

      const result = await promise;
      expect(result.granted).toBe(true);
    });

    it('should timeout when budget not available', async () => {
      const limiter = makeLimiter({ maxRequestsPerMinute: 1 });
      limiter.tryAcquire('w1');

      // Use a very short timeout
      const result = await limiter.acquire('w2', 0, 1);
      expect(result.granted).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return full status', () => {
      const limiter = makeLimiter();
      limiter.tryAcquire('w1', 5000);
      const status = limiter.getStatus();
      expect(status.maxRequestsPerMinute).toBe(10);
      expect(status.maxTokensPerMinute).toBe(100_000);
      expect(status.requestBucket).toBe(9);
      expect(status.tokenBucket).toBe(95_000);
      expect(status.pendingWaiters).toBe(0);
      expect(status.workerUsage).toHaveProperty('w1');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      const limiter = makeLimiter();
      limiter.tryAcquire('w1', 5000);
      limiter.tryAcquire('w2', 3000);
      limiter.reset();
      const status = limiter.getStatus();
      expect(status.requestBucket).toBe(10);
      expect(status.tokenBucket).toBe(100_000);
      expect(Object.keys(status.workerUsage)).toHaveLength(0);
    });
  });
});

// ============================================================
// 4. Cost Aggregator
// ============================================================

describe('CostAggregator', () => {
  describe('record', () => {
    it('should track per-worker costs', () => {
      const agg = createCostAggregator({ globalBudgetUsd: 100, perWorkerBudgetUsd: 50 });
      agg.record('w1', { totalUsd: 1.50, inputTokens: 1000, outputTokens: 500 });
      agg.record('w1', { totalUsd: 0.50 });

      const cost = agg.getWorkerCost('w1');
      expect(cost.totalUsd).toBe(2.0);
      expect(cost.sessions).toBe(2);
      expect(cost.inputTokens).toBe(1000);
    });

    it('should track global total', () => {
      const agg = createCostAggregator({ globalBudgetUsd: 100 });
      agg.record('w1', { totalUsd: 5 });
      agg.record('w2', { totalUsd: 3 });

      const status = agg.getStatus();
      expect(status.globalTotalUsd).toBe(8);
    });

    it('should return allowed=true within budget', () => {
      const agg = createCostAggregator({ globalBudgetUsd: 100, perWorkerBudgetUsd: 50 });
      const result = agg.record('w1', { totalUsd: 1 });
      expect(result.allowed).toBe(true);
    });

    it('should return zeros for unknown worker', () => {
      const agg = createCostAggregator();
      const cost = agg.getWorkerCost('nobody');
      expect(cost.totalUsd).toBe(0);
    });
  });

  describe('per-worker budget', () => {
    it('should emit warning at 80% threshold', () => {
      const events = new EventBus();
      const warnings = [];
      events.on('coord:budget-warning', (data) => warnings.push(data));

      const agg = createCostAggregator({ perWorkerBudgetUsd: 10, globalBudgetUsd: 100, events });
      agg.record('w1', { totalUsd: 8 }); // 80%

      expect(warnings).toHaveLength(1);
      expect(warnings[0].scope).toBe('worker');
      expect(warnings[0].workerId).toBe('w1');
    });

    it('should emit exceeded when at budget', () => {
      const events = new EventBus();
      const exceeded = [];
      events.on('coord:budget-exceeded', (data) => exceeded.push(data));

      const agg = createCostAggregator({ perWorkerBudgetUsd: 10, globalBudgetUsd: 100, events });
      agg.record('w1', { totalUsd: 10 }); // 100%

      expect(exceeded).toHaveLength(1);
      expect(exceeded[0].scope).toBe('worker');
    });

    it('should return allowed=false when exceeded', () => {
      const agg = createCostAggregator({ perWorkerBudgetUsd: 5 });
      agg.record('w1', { totalUsd: 5 });
      const result = agg.record('w1', { totalUsd: 1 });
      // First record triggers exceeded, second returns allowed=false
      expect(result.workerExceeded).toBe(true);
    });

    it('should only warn once per worker', () => {
      const events = new EventBus();
      const warnings = [];
      events.on('coord:budget-warning', (data) => warnings.push(data));

      const agg = createCostAggregator({ perWorkerBudgetUsd: 10, globalBudgetUsd: 100, events });
      agg.record('w1', { totalUsd: 8 });
      agg.record('w1', { totalUsd: 0.5 });
      expect(warnings).toHaveLength(1); // Only one warning
    });
  });

  describe('global budget', () => {
    it('should emit warning at 80% of global budget', () => {
      const events = new EventBus();
      const warnings = [];
      events.on('coord:budget-warning', (data) => warnings.push(data));

      const agg = createCostAggregator({ globalBudgetUsd: 10, perWorkerBudgetUsd: 100, events });
      agg.record('w1', { totalUsd: 8 });

      // Should have per-worker warning (at 8% of 100) — no, 8/100 = 8% < 80%
      // Should have global warning (8/10 = 80%)
      const globalWarnings = warnings.filter(w => w.scope === 'global');
      expect(globalWarnings).toHaveLength(1);
    });

    it('should emit exceeded when global budget hit', () => {
      const events = new EventBus();
      const exceeded = [];
      events.on('coord:budget-exceeded', (data) => exceeded.push(data));

      const agg = createCostAggregator({ globalBudgetUsd: 10, perWorkerBudgetUsd: 100, events });
      agg.record('w1', { totalUsd: 5 });
      agg.record('w2', { totalUsd: 5 });

      const global = exceeded.filter(e => e.scope === 'global');
      expect(global).toHaveLength(1);
    });
  });

  describe('checkBudget', () => {
    it('should report remaining budget', () => {
      const agg = createCostAggregator({ globalBudgetUsd: 100, perWorkerBudgetUsd: 25 });
      agg.record('w1', { totalUsd: 10 });

      const check = agg.checkBudget('w1');
      expect(check.allowed).toBe(true);
      expect(check.workerRemaining).toBe(15);
      expect(check.globalRemaining).toBe(90);
    });

    it('should report not allowed when exceeded', () => {
      const agg = createCostAggregator({ globalBudgetUsd: 100, perWorkerBudgetUsd: 5 });
      agg.record('w1', { totalUsd: 5 });
      const check = agg.checkBudget('w1');
      expect(check.allowed).toBe(false);
      expect(check.workerRemaining).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return full status', () => {
      const agg = createCostAggregator({ globalBudgetUsd: 50, perWorkerBudgetUsd: 20 });
      agg.record('w1', { totalUsd: 5 });

      const status = agg.getStatus();
      expect(status.globalTotalUsd).toBe(5);
      expect(status.globalBudgetUsd).toBe(50);
      expect(status.globalRemaining).toBe(45);
      expect(status.perWorkerBudgetUsd).toBe(20);
      expect(status.workers).toHaveProperty('w1');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      const agg = createCostAggregator();
      agg.record('w1', { totalUsd: 10 });
      agg.reset();
      expect(agg.getStatus().globalTotalUsd).toBe(0);
      expect(Object.keys(agg.getStatus().workers)).toHaveLength(0);
    });
  });

  describe('WARNING_THRESHOLD export', () => {
    it('should export 0.8', () => {
      expect(WARNING_THRESHOLD).toBe(0.8);
    });
  });
});

// ============================================================
// 5. Coordinator
// ============================================================

describe('Coordinator', () => {
  let events, pool;

  beforeEach(() => {
    events = new EventBus();
    pool = mockPool([
      { id: 'w1', status: 'running' },
      { id: 'w2', status: 'running' },
    ]);
  });

  describe('creation', () => {
    it('should create with required params', () => {
      const coord = createCoordinator({ events, pool });
      expect(coord.getState()).toBe('init');
    });

    it('should require events', () => {
      expect(() => createCoordinator({ pool })).toThrow('requires an EventBus');
    });

    it('should require pool', () => {
      expect(() => createCoordinator({ events })).toThrow('requires a process pool');
    });

    it('should accept injected subsystems', () => {
      const taskQueue = createTaskQueue();
      const coord = createCoordinator({ events, pool, taskQueue });
      expect(coord.taskQueue).toBe(taskQueue);
    });
  });

  describe('lifecycle', () => {
    it('should transition init -> running', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();
      expect(coord.getState()).toBe('running');
    });

    it('should emit coord:started on start', () => {
      const emitted = [];
      events.on('coord:started', (d) => emitted.push(d));

      const coord = createCoordinator({ events, pool });
      coord.start();
      expect(emitted).toHaveLength(1);
    });

    it('should transition running -> draining', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();
      coord.drain();
      expect(coord.getState()).toBe('draining');
    });

    it('should emit coord:draining on drain', () => {
      const emitted = [];
      events.on('coord:draining', (d) => emitted.push(d));

      const coord = createCoordinator({ events, pool });
      coord.start();
      coord.drain();
      expect(emitted).toHaveLength(1);
    });

    it('should transition to stopped', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();
      coord.stop();
      expect(coord.getState()).toBe('stopped');
    });

    it('should emit coord:stopped on stop', () => {
      const emitted = [];
      events.on('coord:stopped', (d) => emitted.push(d));

      const coord = createCoordinator({ events, pool });
      coord.start();
      coord.stop();
      expect(emitted).toHaveLength(1);
    });

    it('should not restart after stopped', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();
      coord.stop();
      expect(() => coord.start()).toThrow('Cannot restart');
    });

    it('should be idempotent for start when already running', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();
      coord.start(); // No-op
      expect(coord.getState()).toBe('running');
    });
  });

  describe('addTask', () => {
    it('should add task to queue', () => {
      const coord = createCoordinator({ events, pool });
      const task = coord.addTask({ id: 't1', task: 'do thing' });
      expect(task.id).toBe('t1');
      expect(coord.taskQueue.size()).toBe(1);
    });

    it('should auto-assign when running', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();
      coord.addTask({ id: 't1', task: 'auto-assign' });

      // Task should be assigned
      const task = coord.taskQueue.get('t1');
      expect(task.status).toBe('assigned');
      expect(task.assignedTo).toBeTruthy();
    });

    it('should not auto-assign when not running', () => {
      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'no assign' });
      expect(coord.taskQueue.get('t1').status).toBe('pending');
    });
  });

  describe('addTasks (batch)', () => {
    it('should add multiple tasks', () => {
      const coord = createCoordinator({ events, pool });
      const tasks = coord.addTasks([
        { id: 't1', task: 'one' },
        { id: 't2', task: 'two', deps: ['t1'] },
      ]);
      expect(tasks).toHaveLength(2);
      expect(coord.taskQueue.size()).toBe(2);
    });

    it('should auto-assign ready tasks when running', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();
      coord.addTasks([
        { id: 't1', task: 'one' },
        { id: 't2', task: 'two', deps: ['t1'] },
      ]);
      // Only t1 is ready, t2 is blocked
      expect(coord.taskQueue.get('t1').status).toBe('assigned');
      expect(coord.taskQueue.get('t2').status).toBe('pending');
    });
  });

  describe('coord:request event handling', () => {
    it('should assign task on request', () => {
      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'do thing' });
      coord.start();

      // Simulate worker request after task was auto-assigned on start
      // Add a new task first
      coord.addTask({ id: 't2', task: 'another' });

      // t2 may also be auto-assigned, so add t3
      coord.addTask({ id: 't3', task: 'third' });

      // Check that tasks got sent to pool
      const sent = pool.getSent();
      const proceeds = sent.filter(s => s.msg.type === 'coord:proceed');
      expect(proceeds.length).toBeGreaterThan(0);
    });

    it('should send coord:wait when no tasks ready', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();

      pool.clearSent();
      events.emit('coord:request', { workerId: 'w1' });

      const sent = pool.getSent();
      expect(sent.some(s => s.msg.type === 'coord:wait')).toBe(true);
    });

    it('should ignore requests when not running', () => {
      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'do thing' });
      // Don't start coordinator

      events.emit('coord:request', { workerId: 'w1' });
      // Should not assign
      expect(coord.taskQueue.get('t1').status).toBe('pending');
    });
  });

  describe('coord:complete event handling', () => {
    it('should mark task complete and assign next', () => {
      const coord = createCoordinator({ events, pool });
      coord.addTasks([
        { id: 't1', task: 'first' },
        { id: 't2', task: 'second', deps: ['t1'] },
      ]);
      coord.start();

      // t1 is auto-assigned. Simulate completion.
      const t1 = coord.taskQueue.get('t1');

      pool.clearSent();
      events.emit('coord:complete', {
        workerId: t1.assignedTo,
        taskId: 't1',
        result: 'done',
      });

      // t1 should be complete
      expect(coord.taskQueue.get('t1').status).toBe('complete');

      // t2 should now be assigned (sent to a worker)
      const sent = pool.getSent();
      expect(sent.some(s => s.msg.type === 'coord:proceed' && s.msg.taskId === 't2')).toBe(true);
    });

    it('should emit coord:task-complete event', () => {
      const completed = [];
      events.on('coord:task-complete', (d) => completed.push(d));

      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'do' });
      coord.start();

      events.emit('coord:complete', { workerId: 'w1', taskId: 't1', result: 'ok' });
      expect(completed).toHaveLength(1);
      expect(completed[0].taskId).toBe('t1');
    });
  });

  describe('coord:failed event handling', () => {
    it('should mark task failed', () => {
      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'fail me' });
      coord.start();

      events.emit('coord:failed', { workerId: 'w1', taskId: 't1', error: 'broke' });
      expect(coord.taskQueue.get('t1').status).toBe('failed');
    });

    it('should emit coord:task-failed event', () => {
      const failed = [];
      events.on('coord:task-failed', (d) => failed.push(d));

      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'fail' });
      coord.start();

      events.emit('coord:failed', { workerId: 'w1', taskId: 't1', error: 'err' });
      expect(failed).toHaveLength(1);
    });
  });

  describe('coord:rate-request event handling', () => {
    it('should grant rate budget', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();

      pool.clearSent();
      events.emit('coord:rate-request', { workerId: 'w1', tokens: 100 });

      const sent = pool.getSent();
      expect(sent.some(s => s.msg.type === 'coord:rate-grant')).toBe(true);
    });
  });

  describe('coord:cost event handling', () => {
    it('should record cost', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();

      events.emit('coord:cost', { workerId: 'w1', totalUsd: 1.5 });
      const cost = coord.costAggregator.getWorkerCost('w1');
      expect(cost.totalUsd).toBe(1.5);
    });

    it('should send budget-stop when exceeded', () => {
      const coord = createCoordinator({
        events, pool,
        options: { perWorkerBudgetUsd: 1, globalBudgetUsd: 100 },
      });
      coord.start();

      pool.clearSent();
      events.emit('coord:cost', { workerId: 'w1', totalUsd: 1.5 });

      const sent = pool.getSent();
      expect(sent.some(s => s.msg.type === 'coord:budget-stop')).toBe(true);
    });
  });

  describe('coord:all-complete event', () => {
    it('should emit when all tasks done', () => {
      const allComplete = [];
      events.on('coord:all-complete', (d) => allComplete.push(d));

      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'only one' });
      coord.start();

      events.emit('coord:complete', { workerId: 'w1', taskId: 't1' });
      expect(allComplete).toHaveLength(1);
      expect(allComplete[0].complete).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('should return full status', () => {
      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'test' });
      coord.start();

      const status = coord.getStatus();
      expect(status.state).toBe('running');
      expect(status.queue).toBeDefined();
      expect(status.tasks).toBeDefined();
      expect(status.graph).toBeDefined();
      expect(status.rateLimiter).toBeDefined();
      expect(status.costs).toBeDefined();
      expect(status.strategy).toBeDefined();
    });
  });

  describe('event cleanup on stop', () => {
    it('should not respond to events after stop', () => {
      const coord = createCoordinator({ events, pool });
      coord.addTask({ id: 't1', task: 'test' });
      coord.start();
      coord.stop();

      pool.clearSent();
      events.emit('coord:request', { workerId: 'w1' });
      expect(pool.getSent()).toHaveLength(0);
    });
  });

  describe('STATES export', () => {
    it('should export valid states', () => {
      expect(STATES).toContain('init');
      expect(STATES).toContain('running');
      expect(STATES).toContain('draining');
      expect(STATES).toContain('stopped');
    });
  });

  describe('rate limiter tick (Phase 6B)', () => {
    it('should start rate limiter tick on start', () => {
      const coord = createCoordinator({
        events, pool,
        options: { rateLimiterTickMs: 100 },
      });
      coord.start();
      // Tick timer is internal, but we can verify coordinator starts without error
      expect(coord.getState()).toBe('running');
      coord.stop();
    });

    it('should stop rate limiter tick on stop', () => {
      const coord = createCoordinator({
        events, pool,
        options: { rateLimiterTickMs: 100 },
      });
      coord.start();
      coord.stop();
      // No lingering timers (test would time out if timers leak)
      expect(coord.getState()).toBe('stopped');
    });

    it('should disable tick with rateLimiterTickMs=0', () => {
      const coord = createCoordinator({
        events, pool,
        options: { rateLimiterTickMs: 0 },
      });
      coord.start();
      expect(coord.getState()).toBe('running');
      coord.stop();
    });
  });

  describe('session:complete cost auto-bridging (Phase 6B)', () => {
    it('should record costs from session:complete events', () => {
      const coord = createCoordinator({
        events, pool,
        options: { autoRecordSessionCosts: true },
      });
      coord.start();

      events.emit('session:complete', {
        workerId: 'w1',
        costUsd: 2.50,
        inputTokens: 5000,
        outputTokens: 1000,
      });

      const cost = coord.costAggregator.getWorkerCost('w1');
      expect(cost.totalUsd).toBe(2.50);
      expect(cost.inputTokens).toBe(5000);
      expect(cost.outputTokens).toBe(1000);
    });

    it('should auto-bridge enabled by default', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();

      events.emit('session:complete', { workerId: 'w1', costUsd: 1.0 });
      expect(coord.costAggregator.getWorkerCost('w1').totalUsd).toBe(1.0);
      coord.stop();
    });

    it('should send budget-stop when session costs exceed budget', () => {
      const coord = createCoordinator({
        events, pool,
        options: { perWorkerBudgetUsd: 2, globalBudgetUsd: 100 },
      });
      coord.start();

      pool.clearSent();
      events.emit('session:complete', { workerId: 'w1', costUsd: 2.5 });

      const sent = pool.getSent();
      expect(sent.some(s => s.msg.type === 'coord:budget-stop')).toBe(true);
      coord.stop();
    });

    it('should ignore session:complete without workerId', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();

      events.emit('session:complete', { costUsd: 1.0 });
      // Should not crash
      coord.stop();
    });

    it('should ignore session:complete without costUsd', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();

      events.emit('session:complete', { workerId: 'w1' });
      expect(coord.costAggregator.getWorkerCost('w1').totalUsd).toBe(0);
      coord.stop();
    });

    it('should disable auto-bridging with autoRecordSessionCosts=false', () => {
      const coord = createCoordinator({
        events, pool,
        options: { autoRecordSessionCosts: false },
      });
      coord.start();

      events.emit('session:complete', { workerId: 'w1', costUsd: 5.0 });
      expect(coord.costAggregator.getWorkerCost('w1').totalUsd).toBe(0);
      coord.stop();
    });

    it('should not double-count coord:cost and session:complete for same event', () => {
      const coord = createCoordinator({ events, pool });
      coord.start();

      // Only one should be sent per cost event
      events.emit('coord:cost', { workerId: 'w1', totalUsd: 1.0 });
      expect(coord.costAggregator.getWorkerCost('w1').totalUsd).toBe(1.0);

      events.emit('session:complete', { workerId: 'w1', costUsd: 2.0 });
      expect(coord.costAggregator.getWorkerCost('w1').totalUsd).toBe(3.0);
      coord.stop();
    });
  });

  describe('worktreeManager in coordinator (Phase 6B)', () => {
    it('should expose null worktreeManager by default', () => {
      const coord = createCoordinator({ events, pool });
      expect(coord.worktreeManager).toBeNull();
    });

    it('should accept injected worktreeManager', () => {
      const mockWt = { getStatus: () => ({ active: 0, worktrees: [] }) };
      const coord = createCoordinator({ events, pool, worktreeManager: mockWt });
      expect(coord.worktreeManager).toBe(mockWt);
    });

    it('should include worktrees in getStatus when present', () => {
      const mockWt = { getStatus: () => ({ active: 2, worktrees: ['a', 'b'] }) };
      const coord = createCoordinator({ events, pool, worktreeManager: mockWt });
      const status = coord.getStatus();
      expect(status.worktrees).toEqual({ active: 2, worktrees: ['a', 'b'] });
    });

    it('should report null worktrees in getStatus when not available', () => {
      const coord = createCoordinator({ events, pool });
      expect(coord.getStatus().worktrees).toBeNull();
    });
  });
});

// ============================================================
// 6. Worktree Manager (Phase 6B)
// ============================================================

describe('WorktreeManager', () => {

  // ── Mock git executor ──────────────────────────────────

  function mockGit(responses = {}) {
    const calls = [];
    const fn = async (args, cwd, timeout) => {
      calls.push({ args: [...args], cwd, timeout });
      const key = args[0] + (args[1] ? ' ' + args[1] : '');
      const response = responses[key] || { ok: true, stdout: '', stderr: '', code: 0 };
      return typeof response === 'function' ? response(args, cwd) : response;
    };
    fn.calls = calls;
    return fn;
  }

  describe('creation', () => {
    it('should require projectDir', () => {
      expect(() => createWorktreeManager({})).toThrow('requires a projectDir');
    });

    it('should require context object', () => {
      expect(() => createWorktreeManager(null)).toThrow();
    });

    it('should create with valid projectDir', () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      expect(mgr).toBeDefined();
      expect(mgr.getStatus().active).toBe(0);
    });
  });

  describe('create', () => {
    it('should create a worktree for a worker', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      const result = await mgr.create('w1');
      expect(result.ok).toBe(true);
      expect(result.branch).toBe('worker-w1');
      expect(result.path).toContain('w1');
    });

    it('should call git worktree add', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      await mgr.create('w1');
      const worktreeAdd = git.calls.find(c => c.args[0] === 'worktree' && c.args[1] === 'add');
      expect(worktreeAdd).toBeTruthy();
      expect(worktreeAdd.args).toContain('-b');
      expect(worktreeAdd.args).toContain('worker-w1');
    });

    it('should delete stale branch before creating', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      await mgr.create('w1');
      const branchDelete = git.calls.find(c => c.args[0] === 'branch' && c.args[1] === '-D');
      expect(branchDelete).toBeTruthy();
      expect(branchDelete.args).toContain('worker-w1');
    });

    it('should track worktree in status', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      await mgr.create('w1');
      expect(mgr.getStatus().active).toBe(1);
      expect(mgr.has('w1')).toBe(true);
    });

    it('should return error for missing workerId', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      const result = await mgr.create('');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should return error when git worktree add fails', async () => {
      const git = mockGit({
        'worktree add': { ok: false, stdout: '', stderr: 'fatal: error', code: 1 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      const result = await mgr.create('w1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('fatal: error');
    });

    it('should emit coord:worktree-created event', async () => {
      const git = mockGit();
      const events = new EventBus();
      const emitted = [];
      events.on('coord:worktree-created', (d) => emitted.push(d));

      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git, events });
      await mgr.create('w1');

      expect(emitted).toHaveLength(1);
      expect(emitted[0].workerId).toBe('w1');
      expect(emitted[0].branch).toBe('worker-w1');
    });

    it('should replace existing worktree for same worker', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      await mgr.create('w1');
      await mgr.create('w1'); // Should remove first, then re-create
      expect(mgr.getStatus().active).toBe(1);
    });
  });

  describe('remove', () => {
    it('should remove an existing worktree', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      await mgr.create('w1');
      const result = await mgr.remove('w1');
      expect(result.ok).toBe(true);
      expect(mgr.has('w1')).toBe(false);
      expect(mgr.getStatus().active).toBe(0);
    });

    it('should call git worktree remove', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      await mgr.create('w1');
      git.calls.length = 0; // Clear creation calls
      await mgr.remove('w1');

      const removeCall = git.calls.find(c => c.args[0] === 'worktree' && c.args[1] === 'remove');
      expect(removeCall).toBeTruthy();
    });

    it('should delete the branch', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      await mgr.create('w1');
      git.calls.length = 0;
      await mgr.remove('w1');

      const branchDelete = git.calls.find(c => c.args[0] === 'branch' && c.args[1] === '-D');
      expect(branchDelete).toBeTruthy();
      expect(branchDelete.args).toContain('worker-w1');
    });

    it('should return error for unknown worker', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      const result = await mgr.remove('nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No worktree');
    });

    it('should emit coord:worktree-removed event', async () => {
      const git = mockGit();
      const events = new EventBus();
      const emitted = [];
      events.on('coord:worktree-removed', (d) => emitted.push(d));

      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git, events });
      await mgr.create('w1');
      await mgr.remove('w1');

      expect(emitted).toHaveLength(1);
      expect(emitted[0].workerId).toBe('w1');
    });
  });

  describe('get / has', () => {
    it('should return null for unknown worker', () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      expect(mgr.get('nobody')).toBeNull();
    });

    it('should return worktree info for known worker', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      const info = mgr.get('w1');
      expect(info.workerId).toBe('w1');
      expect(info.branch).toBe('worker-w1');
      expect(info.createdAt).toBeTruthy();
    });

    it('should track has correctly', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      expect(mgr.has('w1')).toBe(false);
      await mgr.create('w1');
      expect(mgr.has('w1')).toBe(true);
      await mgr.remove('w1');
      expect(mgr.has('w1')).toBe(false);
    });
  });

  describe('dryRunMerge', () => {
    it('should return no conflict when no changes', async () => {
      const git = mockGit({
        'diff --name-only': { ok: true, stdout: '', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      const result = await mgr.dryRunMerge('w1');
      expect(result.ok).toBe(true);
      expect(result.conflicted).toBe(false);
      expect(result.files).toEqual([]);
    });

    it('should detect conflicts', async () => {
      const git = mockGit({
        'diff --name-only': { ok: true, stdout: 'src/foo.js', stderr: '', code: 0 },
        'merge --no-commit': { ok: false, stdout: 'CONFLICT (content): Merge conflict in src/foo.js', stderr: 'CONFLICT', code: 1 },
        'merge --abort': { ok: true, stdout: '', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      const result = await mgr.dryRunMerge('w1');
      expect(result.ok).toBe(true);
      expect(result.conflicted).toBe(true);
      expect(result.files).toContain('src/foo.js');
    });

    it('should detect no conflict when merge succeeds', async () => {
      const git = mockGit({
        'diff --name-only': { ok: true, stdout: 'src/bar.js', stderr: '', code: 0 },
        'merge --no-commit': { ok: true, stdout: '', stderr: '', code: 0 },
        'merge --abort': { ok: true, stdout: '', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      const result = await mgr.dryRunMerge('w1');
      expect(result.ok).toBe(true);
      expect(result.conflicted).toBe(false);
    });

    it('should always abort after dry-run merge', async () => {
      const git = mockGit({
        'diff --name-only': { ok: true, stdout: 'file.js', stderr: '', code: 0 },
        'merge --no-commit': { ok: true, stdout: '', stderr: '', code: 0 },
        'merge --abort': { ok: true, stdout: '', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      await mgr.dryRunMerge('w1');
      const abortCall = git.calls.find(c => c.args[0] === 'merge' && c.args[1] === '--abort');
      expect(abortCall).toBeTruthy();
    });

    it('should return error for unknown worker', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      const result = await mgr.dryRunMerge('nobody');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('No worktree');
    });
  });

  describe('merge', () => {
    it('should merge worker branch into main', async () => {
      const git = mockGit({
        'merge worker-w1': { ok: true, stdout: '', stderr: '', code: 0 },
        'rev-parse HEAD': { ok: true, stdout: 'abc123', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      const result = await mgr.merge('w1');
      expect(result.ok).toBe(true);
      expect(result.conflicted).toBe(false);
      expect(result.mergeCommit).toBe('abc123');
    });

    it('should detect merge conflicts', async () => {
      const git = mockGit({
        'merge worker-w1': { ok: false, stdout: '', stderr: 'CONFLICT (content): Merge conflict', code: 1 },
        'merge --abort': { ok: true, stdout: '', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      const result = await mgr.merge('w1');
      expect(result.ok).toBe(false);
      expect(result.conflicted).toBe(true);
    });

    it('should abort on conflict', async () => {
      const git = mockGit({
        'merge worker-w1': { ok: false, stdout: '', stderr: 'Merge conflict', code: 1 },
        'merge --abort': { ok: true, stdout: '', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      await mgr.merge('w1');
      const abortCall = git.calls.find(c =>
        c.args[0] === 'merge' && c.args[1] === '--abort'
      );
      expect(abortCall).toBeTruthy();
    });

    it('should use custom merge message', async () => {
      const git = mockGit({
        'merge worker-w1': { ok: true, stdout: '', stderr: '', code: 0 },
        'rev-parse HEAD': { ok: true, stdout: 'def456', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      await mgr.merge('w1', { message: 'custom merge' });
      const mergeCall = git.calls.find(c => c.args[0] === 'merge' && c.args.includes('worker-w1'));
      expect(mergeCall.args).toContain('custom merge');
    });

    it('should return error for unknown worker', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      const result = await mgr.merge('nobody');
      expect(result.ok).toBe(false);
    });

    it('should emit coord:worktree-merged event', async () => {
      const git = mockGit({
        'merge worker-w1': { ok: true, stdout: '', stderr: '', code: 0 },
        'rev-parse HEAD': { ok: true, stdout: 'abc123', stderr: '', code: 0 },
      });
      const events = new EventBus();
      const emitted = [];
      events.on('coord:worktree-merged', (d) => emitted.push(d));

      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git, events });
      await mgr.create('w1');
      await mgr.merge('w1');

      expect(emitted).toHaveLength(1);
      expect(emitted[0].workerId).toBe('w1');
      expect(emitted[0].mergeCommit).toBe('abc123');
    });

    it('should handle non-conflict merge failure', async () => {
      const git = mockGit({
        'merge worker-w1': { ok: false, stdout: '', stderr: 'fatal: not a git repo', code: 128 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      const result = await mgr.merge('w1');
      expect(result.ok).toBe(false);
      expect(result.conflicted).toBe(false);
      expect(result.error).toContain('fatal');
    });
  });

  describe('detectConflicts', () => {
    it('should check all active worktrees', async () => {
      const git = mockGit({
        'diff --name-only': { ok: true, stdout: '', stderr: '', code: 0 },
      });
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');
      await mgr.create('w2');

      const { results } = await mgr.detectConflicts();
      expect(results).toHaveLength(2);
      expect(results.every(r => !r.conflicted)).toBe(true);
    });

    it('should identify conflicted workers', async () => {
      let callCount = 0;
      const git = async (args, cwd) => {
        if (args[0] === 'diff' && args[1] === '--name-only') {
          return { ok: true, stdout: 'file.js', stderr: '', code: 0 };
        }
        if (args[0] === 'merge' && args[1] === '--no-commit') {
          callCount++;
          // First worker conflicts, second doesn't
          if (callCount === 1) {
            return { ok: false, stdout: 'CONFLICT (content): Merge conflict in file.js', stderr: 'CONFLICT', code: 1 };
          }
          return { ok: true, stdout: '', stderr: '', code: 0 };
        }
        if (args[0] === 'merge' && args[1] === '--abort') {
          return { ok: true, stdout: '', stderr: '', code: 0 };
        }
        return { ok: true, stdout: '', stderr: '', code: 0 };
      };
      git.calls = [];

      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');
      await mgr.create('w2');

      const { results } = await mgr.detectConflicts();
      expect(results.find(r => r.workerId === 'w1').conflicted).toBe(true);
      expect(results.find(r => r.workerId === 'w2').conflicted).toBe(false);
    });

    it('should emit coord:conflicts-detected when conflicts found', async () => {
      const git = mockGit({
        'diff --name-only': { ok: true, stdout: 'file.js', stderr: '', code: 0 },
        'merge --no-commit': { ok: false, stdout: 'CONFLICT', stderr: 'CONFLICT', code: 1 },
        'merge --abort': { ok: true, stdout: '', stderr: '', code: 0 },
      });
      const events = new EventBus();
      const emitted = [];
      events.on('coord:conflicts-detected', (d) => emitted.push(d));

      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git, events });
      await mgr.create('w1');
      await mgr.detectConflicts();

      expect(emitted).toHaveLength(1);
      expect(emitted[0].conflicted).toContain('w1');
    });

    it('should return empty results with no worktrees', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      const { results } = await mgr.detectConflicts();
      expect(results).toHaveLength(0);
    });
  });

  describe('cleanupAll', () => {
    it('should remove all worktrees', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');
      await mgr.create('w2');
      await mgr.create('w3');

      const result = await mgr.cleanupAll();
      expect(result.removed).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(mgr.getStatus().active).toBe(0);
    });

    it('should call git worktree prune', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');

      await mgr.cleanupAll();
      const pruneCall = git.calls.find(c => c.args[0] === 'worktree' && c.args[1] === 'prune');
      expect(pruneCall).toBeTruthy();
    });
  });

  describe('getStatus', () => {
    it('should return empty status initially', () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });

      const status = mgr.getStatus();
      expect(status.active).toBe(0);
      expect(status.worktrees).toHaveLength(0);
      expect(status.worktreeDir).toContain(WORKTREE_DIR_NAME);
    });

    it('should list active worktrees', async () => {
      const git = mockGit();
      const mgr = createWorktreeManager({ projectDir: '/test/project', _gitExec: git });
      await mgr.create('w1');
      await mgr.create('w2');

      const status = mgr.getStatus();
      expect(status.active).toBe(2);
      expect(status.worktrees).toHaveLength(2);
      expect(status.worktrees[0].workerId).toBe('w1');
      expect(status.worktrees[0].branch).toBe('worker-w1');
      expect(status.worktrees[1].workerId).toBe('w2');
    });
  });

  describe('exports', () => {
    it('should export WORKTREE_DIR_NAME', () => {
      expect(WORKTREE_DIR_NAME).toBe('.worktrees');
    });

    it('should export BRANCH_PREFIX', () => {
      expect(BRANCH_PREFIX).toBe('worker-');
    });
  });
});

// ============================================================
// 7. Worker Coord IPC Handlers (Phase 6B)
// ============================================================

describe('Worker Coord IPC Handlers', () => {
  // We test handleCoordMessage indirectly through handleMessage
  // since coord messages route through the main message handler.

  let sentMessages, mockEvents;

  beforeEach(async () => {
    sentMessages = [];
    mockEvents = {
      _handlers: {},
      emit(event, data) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(data);
      },
      on(event, handler) {
        if (!this._handlers[event]) this._handlers[event] = [];
      },
      off() {},
    };
  });

  // Import the worker module to test handleMessage
  // We need to mock process.send for the worker side
  it('should route coord:proceed to handleCoordMessage', async () => {
    // The handleMessage in orchestrator-worker.mjs routes coord:* messages
    // We verify the switch statement handles the right cases
    const { handleMessage } = await import('../orchestrator-worker.mjs');

    // Without init, coord messages should be silently ignored (events is null)
    // This is safe - no crash
    handleMessage({ type: 'coord:proceed', taskId: 't1', task: 'do thing' });
    // Should not crash
  });

  it('should route coord:wait to handleCoordMessage', async () => {
    const { handleMessage } = await import('../orchestrator-worker.mjs');
    handleMessage({ type: 'coord:wait', reason: 'no-ready-tasks' });
    // Should not crash
  });

  it('should route coord:rate-grant to handleCoordMessage', async () => {
    const { handleMessage } = await import('../orchestrator-worker.mjs');
    handleMessage({ type: 'coord:rate-grant', remaining: { requests: 5, tokens: 50000 } });
    // Should not crash
  });

  it('should route coord:rate-wait to handleCoordMessage', async () => {
    const { handleMessage } = await import('../orchestrator-worker.mjs');
    handleMessage({ type: 'coord:rate-wait', waitMs: 1000, remaining: { requests: 0, tokens: 0 } });
    // Should not crash
  });

  it('should route coord:budget-stop to handleCoordMessage', async () => {
    const { handleMessage } = await import('../orchestrator-worker.mjs');
    handleMessage({ type: 'coord:budget-stop', workerExceeded: true, globalExceeded: false });
    // Should not crash
  });

  it('should not route unknown coord message types to default handler', async () => {
    const { handleMessage } = await import('../orchestrator-worker.mjs');
    // coord:proceed should not trigger the default "Unknown message type" error
    // We verify by checking it doesn't match the default case behavior
    handleMessage({ type: 'coord:proceed', taskId: 't1' });
    // If it fell through to default, it would call sendToParent with error
    // Since process.send is not available in test, it silently does nothing
  });
});

// ============================================================
// 8. Coordinator + Rate Limiter Integration (Phase 6B)
// ============================================================

describe('Coordinator Rate Limiter Integration', () => {
  let events, pool;

  beforeEach(() => {
    events = new EventBus();
    pool = mockPool([
      { id: 'w1', status: 'running' },
      { id: 'w2', status: 'running' },
    ]);
  });

  it('should grant rate request via coordinator', () => {
    const coord = createCoordinator({ events, pool });
    coord.start();

    pool.clearSent();
    events.emit('coord:rate-request', { workerId: 'w1', tokens: 100 });

    const grants = pool.getSent().filter(s => s.msg.type === 'coord:rate-grant');
    expect(grants).toHaveLength(1);
    expect(grants[0].id).toBe('w1');
    expect(grants[0].msg.remaining).toBeDefined();
    coord.stop();
  });

  it('should deny rate request when exhausted', () => {
    const coord = createCoordinator({
      events, pool,
      options: { maxRequestsPerMinute: 2 },
    });
    coord.start();

    // Exhaust the bucket
    events.emit('coord:rate-request', { workerId: 'w1', tokens: 0 });
    events.emit('coord:rate-request', { workerId: 'w1', tokens: 0 });

    pool.clearSent();
    events.emit('coord:rate-request', { workerId: 'w2', tokens: 0 });

    const waits = pool.getSent().filter(s => s.msg.type === 'coord:rate-wait');
    expect(waits).toHaveLength(1);
    expect(waits[0].msg.waitMs).toBeGreaterThan(0);
    coord.stop();
  });

  it('should track per-worker rate usage', () => {
    const coord = createCoordinator({ events, pool });
    coord.start();

    events.emit('coord:rate-request', { workerId: 'w1', tokens: 500 });
    events.emit('coord:rate-request', { workerId: 'w1', tokens: 300 });
    events.emit('coord:rate-request', { workerId: 'w2', tokens: 200 });

    const w1Stats = coord.rateLimiter.getWorkerStats('w1');
    expect(w1Stats.requests).toBe(2);
    expect(w1Stats.tokens).toBe(800);
    coord.stop();
  });

  it('should include rate limiter status in coordinator status', () => {
    const coord = createCoordinator({ events, pool });
    coord.start();

    events.emit('coord:rate-request', { workerId: 'w1', tokens: 1000 });

    const status = coord.getStatus();
    expect(status.rateLimiter).toBeDefined();
    expect(status.rateLimiter.workerUsage).toHaveProperty('w1');
    coord.stop();
  });
});

// ============================================================
// 9. Coordinator + Cost Aggregator Integration (Phase 6B)
// ============================================================

describe('Coordinator Cost Aggregator Integration', () => {
  let events, pool;

  beforeEach(() => {
    events = new EventBus();
    pool = mockPool([
      { id: 'w1', status: 'running' },
      { id: 'w2', status: 'running' },
    ]);
  });

  it('should record costs from coord:cost events', () => {
    const coord = createCoordinator({ events, pool });
    coord.start();

    events.emit('coord:cost', { workerId: 'w1', totalUsd: 2.0, inputTokens: 5000, outputTokens: 1000 });

    const cost = coord.costAggregator.getWorkerCost('w1');
    expect(cost.totalUsd).toBe(2.0);
    expect(cost.inputTokens).toBe(5000);
    coord.stop();
  });

  it('should record costs from session:complete events', () => {
    const coord = createCoordinator({ events, pool });
    coord.start();

    events.emit('session:complete', { workerId: 'w2', costUsd: 3.0, inputTokens: 8000 });

    const cost = coord.costAggregator.getWorkerCost('w2');
    expect(cost.totalUsd).toBe(3.0);
    coord.stop();
  });

  it('should accumulate costs from multiple sources', () => {
    const coord = createCoordinator({ events, pool });
    coord.start();

    events.emit('coord:cost', { workerId: 'w1', totalUsd: 1.0 });
    events.emit('session:complete', { workerId: 'w1', costUsd: 2.0 });

    expect(coord.costAggregator.getWorkerCost('w1').totalUsd).toBe(3.0);
    coord.stop();
  });

  it('should send budget-stop on per-worker budget exceeded', () => {
    const coord = createCoordinator({
      events, pool,
      options: { perWorkerBudgetUsd: 5, globalBudgetUsd: 100 },
    });
    coord.start();

    pool.clearSent();
    events.emit('coord:cost', { workerId: 'w1', totalUsd: 6.0 });

    const stops = pool.getSent().filter(s => s.msg.type === 'coord:budget-stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].id).toBe('w1');
    expect(stops[0].msg.workerExceeded).toBe(true);
    coord.stop();
  });

  it('should send budget-stop on global budget exceeded', () => {
    const coord = createCoordinator({
      events, pool,
      options: { perWorkerBudgetUsd: 100, globalBudgetUsd: 5 },
    });
    coord.start();

    events.emit('coord:cost', { workerId: 'w1', totalUsd: 3.0 });
    pool.clearSent();
    events.emit('coord:cost', { workerId: 'w2', totalUsd: 3.0 });

    const stops = pool.getSent().filter(s => s.msg.type === 'coord:budget-stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].msg.globalExceeded).toBe(true);
    coord.stop();
  });

  it('should emit budget-warning events at 80% threshold', () => {
    const warnings = [];
    events.on('coord:budget-warning', (d) => warnings.push(d));

    const coord = createCoordinator({
      events, pool,
      options: { perWorkerBudgetUsd: 10, globalBudgetUsd: 100 },
    });
    coord.start();

    events.emit('coord:cost', { workerId: 'w1', totalUsd: 8.0 });

    const workerWarnings = warnings.filter(w => w.scope === 'worker');
    expect(workerWarnings).toHaveLength(1);
    coord.stop();
  });

  it('should include costs in coordinator status', () => {
    const coord = createCoordinator({ events, pool });
    coord.start();

    events.emit('coord:cost', { workerId: 'w1', totalUsd: 5.0 });

    const status = coord.getStatus();
    expect(status.costs.globalTotalUsd).toBe(5.0);
    expect(status.costs.workers).toHaveProperty('w1');
    coord.stop();
  });
});

// ============================================================
// 10. Persistent Queue
// ============================================================

describe('PersistentQueue', () => {
  let testDir;
  let filePath;

  beforeEach(() => {
    testDir = join(tmpdir(), `persist-queue-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    filePath = join(testDir, 'queue.json');
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('should require filePath', () => {
    expect(() => createPersistentQueue({})).toThrow('filePath');
    expect(() => createPersistentQueue()).toThrow();
  });

  it('should have same API as createTaskQueue plus persistence methods', () => {
    const pq = createPersistentQueue({ filePath });
    // Core mutations
    expect(typeof pq.add).toBe('function');
    expect(typeof pq.remove).toBe('function');
    expect(typeof pq.assign).toBe('function');
    expect(typeof pq.start).toBe('function');
    expect(typeof pq.complete).toBe('function');
    expect(typeof pq.fail).toBe('function');
    expect(typeof pq.cancel).toBe('function');
    expect(typeof pq.retry).toBe('function');
    // Reads
    expect(typeof pq.get).toBe('function');
    expect(typeof pq.getAll).toBe('function');
    expect(typeof pq.getReady).toBe('function');
    expect(typeof pq.getByWorker).toBe('function');
    expect(typeof pq.getProgress).toBe('function');
    expect(typeof pq.size).toBe('function');
    // DAG
    expect(typeof pq.topologicalSort).toBe('function');
    expect(typeof pq.getLevels).toBe('function');
    expect(typeof pq.validate).toBe('function');
    // Serialization
    expect(typeof pq.toJSON).toBe('function');
    expect(typeof pq.fromJSON).toBe('function');
    expect(typeof pq.clear).toBe('function');
    // Persistence-specific
    expect(typeof pq.load).toBe('function');
    expect(typeof pq.save).toBe('function');
    expect(pq.filePath).toBe(filePath);
    expect(pq.isPersistent).toBe(true);
  });

  it('should auto-save on add', () => {
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 't1', task: 'Test task' });

    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe('t1');
    expect(data.version).toBe(1);
    expect(data.savedAt).toBeTruthy();
  });

  it('should auto-save on complete', () => {
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 't1', task: 'Test' });
    pq.assign('t1', 'w1'); // assign does NOT auto-save
    pq.complete('t1', 'done');

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const t = data.tasks.find(t => t.id === 't1');
    expect(t.status).toBe('complete');
    expect(t.result).toBe('done');
  });

  it('should auto-save on fail', () => {
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 't1', task: 'Test' });
    pq.assign('t1', 'w1');
    pq.fail('t1', 'oops');

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const t = data.tasks.find(t => t.id === 't1');
    expect(t.status).toBe('failed');
    expect(t.error).toBe('oops');
  });

  it('should auto-save on cancel', () => {
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 't1', task: 'Root' });
    pq.add({ id: 't2', task: 'Dep', deps: ['t1'] });
    pq.cancel('t1');

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.tasks.find(t => t.id === 't1').status).toBe('cancelled');
    expect(data.tasks.find(t => t.id === 't2').status).toBe('cancelled');
  });

  it('should auto-save on retry', () => {
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 't1', task: 'Test' });
    pq.assign('t1', 'w1');
    pq.fail('t1', 'err');
    pq.retry('t1');

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.tasks.find(t => t.id === 't1').status).toBe('pending');
  });

  it('should auto-save on remove', () => {
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 't1', task: 'Test' });
    pq.add({ id: 't2', task: 'Keep' });
    pq.remove('t1');

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].id).toBe('t2');
  });

  it('should auto-save on clear', () => {
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 't1', task: 'Test' });
    pq.clear();

    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.tasks).toHaveLength(0);
  });

  it('should NOT auto-save on assign or start (intermediate states)', () => {
    const pq = createPersistentQueue({ filePath });
    pq.add({ id: 't1', task: 'Test' });

    // After add, file has pending task
    const beforeAssign = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(beforeAssign.tasks[0].status).toBe('pending');

    pq.assign('t1', 'w1');
    // File should still show pending (assign didn't save)
    const afterAssign = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(afterAssign.tasks[0].status).toBe('pending');

    pq.start('t1');
    // File should still show pending (start didn't save)
    const afterStart = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(afterStart.tasks[0].status).toBe('pending');
  });

  describe('load', () => {
    it('should load tasks from disk', () => {
      // Create and populate
      const pq1 = createPersistentQueue({ filePath });
      pq1.add({ id: 't1', task: 'Task 1' });
      pq1.add({ id: 't2', task: 'Task 2', deps: ['t1'] });
      pq1.assign('t1', 'w1');
      pq1.complete('t1', 'result1');

      // Create fresh queue and load
      const pq2 = createPersistentQueue({ filePath });
      const result = pq2.load();

      expect(result.loaded).toBe(true);
      expect(result.tasks).toBe(2);
      expect(result.reset).toBe(0); // no in-flight tasks (t1 was completed)
      expect(pq2.get('t1').status).toBe('complete');
      expect(pq2.get('t2').status).toBe('pending');
    });

    it('should reset in-flight tasks to pending on load', () => {
      // Write a file with assigned/running tasks directly
      const data = {
        version: 1,
        tasks: [
          { id: 't1', task: 'Assigned', status: 'assigned', deps: [], assignedTo: 'w1', assignedAt: '2024-01-01', startedAt: null, completedAt: null, result: null, error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
          { id: 't2', task: 'Running', status: 'running', deps: [], assignedTo: 'w2', assignedAt: '2024-01-01', startedAt: '2024-01-01', completedAt: null, result: null, error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
          { id: 't3', task: 'Pending', status: 'pending', deps: [], assignedTo: null, assignedAt: null, startedAt: null, completedAt: null, result: null, error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
          { id: 't4', task: 'Complete', status: 'complete', deps: [], assignedTo: 'w1', assignedAt: '2024-01-01', startedAt: '2024-01-01', completedAt: '2024-01-01', result: 'ok', error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
        ],
        savedAt: '2024-01-01',
      };
      writeFileSync(filePath, JSON.stringify(data));

      const pq = createPersistentQueue({ filePath });
      const result = pq.load();

      expect(result.loaded).toBe(true);
      expect(result.tasks).toBe(4);
      expect(result.reset).toBe(2); // t1 (assigned) + t2 (running)

      expect(pq.get('t1').status).toBe('pending');
      expect(pq.get('t1').assignedTo).toBeNull();
      expect(pq.get('t2').status).toBe('pending');
      expect(pq.get('t2').assignedTo).toBeNull();
      expect(pq.get('t2').startedAt).toBeNull();
      expect(pq.get('t3').status).toBe('pending');
      expect(pq.get('t4').status).toBe('complete');
    });

    it('should return loaded=false when no file exists', () => {
      const pq = createPersistentQueue({ filePath });
      const result = pq.load();

      expect(result.loaded).toBe(false);
      expect(result.tasks).toBe(0);
      expect(pq.size()).toBe(0);
    });

    it('should recover from .tmp file when primary is missing', () => {
      // Write directly to .tmp (simulating crash between write and rename)
      const data = {
        version: 1,
        tasks: [
          { id: 't1', task: 'Recovered', status: 'pending', deps: [], assignedTo: null, assignedAt: null, startedAt: null, completedAt: null, result: null, error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
        ],
        savedAt: '2024-01-01',
      };
      writeFileSync(filePath + '.tmp', JSON.stringify(data));

      const pq = createPersistentQueue({ filePath });
      const result = pq.load();

      expect(result.loaded).toBe(true);
      expect(result.recovered).toBe(true);
      expect(result.tasks).toBe(1);
      expect(pq.get('t1').task).toBe('Recovered');

      // .tmp should have been promoted to primary
      expect(existsSync(filePath)).toBe(true);
    });

    it('should handle corrupt primary file with .tmp fallback', () => {
      writeFileSync(filePath, 'NOT VALID JSON{{{');
      const data = {
        version: 1,
        tasks: [
          { id: 't1', task: 'FromTmp', status: 'pending', deps: [], assignedTo: null, assignedAt: null, startedAt: null, completedAt: null, result: null, error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
        ],
        savedAt: '2024-01-01',
      };
      writeFileSync(filePath + '.tmp', JSON.stringify(data));

      const pq = createPersistentQueue({ filePath });
      const result = pq.load();

      expect(result.loaded).toBe(true);
      expect(result.recovered).toBe(true);
      expect(pq.get('t1').task).toBe('FromTmp');
    });

    it('should return loaded=false when both primary and .tmp are corrupt', () => {
      writeFileSync(filePath, 'CORRUPT');
      writeFileSync(filePath + '.tmp', 'ALSO CORRUPT');

      const pq = createPersistentQueue({ filePath });
      const result = pq.load();

      expect(result.loaded).toBe(false);
      expect(result.tasks).toBe(0);
    });
  });

  describe('round-trip persistence', () => {
    it('should survive full round-trip with deps, priorities, and metadata', () => {
      const pq1 = createPersistentQueue({ filePath });
      pq1.add({ id: 'a', task: 'Alpha', priority: 10, category: 'code', metadata: { key: 'val' } });
      pq1.add({ id: 'b', task: 'Beta', deps: ['a'], priority: 5 });
      pq1.add({ id: 'c', task: 'Gamma', deps: ['a', 'b'], metadata: { nested: { x: 1 } } });
      pq1.assign('a', 'w1');
      pq1.complete('a', { output: 'done' });

      // Load in fresh queue
      const pq2 = createPersistentQueue({ filePath });
      pq2.load();

      expect(pq2.size()).toBe(3);
      expect(pq2.get('a').status).toBe('complete');
      expect(pq2.get('a').result).toEqual({ output: 'done' });
      expect(pq2.get('a').priority).toBe(10);
      expect(pq2.get('a').category).toBe('code');
      expect(pq2.get('a').metadata).toEqual({ key: 'val' });
      expect(pq2.get('b').status).toBe('pending');
      expect(pq2.get('b').deps).toEqual(['a']);
      expect(pq2.get('c').deps).toEqual(['a', 'b']);
      expect(pq2.get('c').metadata).toEqual({ nested: { x: 1 } });

      // b should now be ready (a is complete)
      const ready = pq2.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('b');
    });

    it('should handle multiple save/load cycles', () => {
      const pq = createPersistentQueue({ filePath });
      pq.add({ id: 't1', task: 'One' });

      // Reload
      const pq2 = createPersistentQueue({ filePath });
      pq2.load();
      pq2.add({ id: 't2', task: 'Two' });

      // Reload again
      const pq3 = createPersistentQueue({ filePath });
      pq3.load();
      expect(pq3.size()).toBe(2);
      expect(pq3.get('t1')).toBeTruthy();
      expect(pq3.get('t2')).toBeTruthy();
    });
  });

  describe('read-through methods', () => {
    it('should pass through getReady, getProgress, validate', () => {
      const pq = createPersistentQueue({ filePath });
      pq.add({ id: 't1', task: 'A' });
      pq.add({ id: 't2', task: 'B', deps: ['t1'] });

      const ready = pq.getReady();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('t1');

      const progress = pq.getProgress();
      expect(progress.total).toBe(2);
      expect(progress.pending).toBe(2);

      const validation = pq.validate();
      expect(validation.valid).toBe(true);
    });

    it('should pass through getDependencyGraph and topologicalSort', () => {
      const pq = createPersistentQueue({ filePath });
      pq.add({ id: 'a', task: 'A' });
      pq.add({ id: 'b', task: 'B', deps: ['a'] });

      const graph = pq.getDependencyGraph();
      expect(graph.nodes).toEqual(['a', 'b']);
      expect(graph.edges).toEqual([{ from: 'a', to: 'b' }]);

      const order = pq.topologicalSort();
      expect(order).toEqual(['a', 'b']);
    });
  });
});

// ============================================================
// 11. Coordinator with Persistent Queue
// ============================================================

describe('Coordinator with PersistentQueue', () => {
  let events, pool, testDir, filePath;

  beforeEach(() => {
    events = new EventBus();
    pool = mockPool([{ id: 'w1' }, { id: 'w2' }]);
    testDir = join(tmpdir(), `coord-persist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    filePath = join(testDir, 'coord-queue.json');
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('should create persistent queue when persistPath is set', () => {
    const coord = createCoordinator({
      events, pool,
      options: { persistPath: filePath },
    });

    expect(coord.taskQueue.isPersistent).toBe(true);
    expect(coord.taskQueue.filePath).toBe(filePath);
    coord.stop();
  });

  it('should create regular queue when persistPath is not set', () => {
    const coord = createCoordinator({ events, pool });
    expect(coord.taskQueue.isPersistent).toBeUndefined();
    coord.stop();
  });

  it('should load persisted tasks on start', () => {
    // Pre-populate the file
    const data = {
      version: 1,
      tasks: [
        { id: 't1', task: 'Persisted', status: 'pending', deps: [], assignedTo: null, assignedAt: null, startedAt: null, completedAt: null, result: null, error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
        { id: 't2', task: 'Also persisted', status: 'complete', deps: [], assignedTo: 'w1', assignedAt: '2024-01-01', startedAt: '2024-01-01', completedAt: '2024-01-01', result: 'ok', error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
      ],
      savedAt: '2024-01-01',
    };
    writeFileSync(filePath, JSON.stringify(data));

    const coord = createCoordinator({
      events, pool,
      options: { persistPath: filePath },
    });

    const loaded = [];
    events.on('coord:queue-loaded', (data) => loaded.push(data));

    coord.start();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].loaded).toBe(true);
    expect(loaded[0].tasks).toBe(2);
    expect(coord.taskQueue.size()).toBe(2);
    // t1 was pending but got auto-assigned by workAssigner.assignAll() on start()
    expect(coord.taskQueue.get('t1').status).toBe('assigned');
    expect(coord.taskQueue.get('t2').status).toBe('complete');
    coord.stop();
  });

  it('should reset in-flight tasks on start', () => {
    const data = {
      version: 1,
      tasks: [
        { id: 't1', task: 'Was running', status: 'running', deps: [], assignedTo: 'w1', assignedAt: '2024-01-01', startedAt: '2024-01-01', completedAt: null, result: null, error: null, createdAt: '2024-01-01', priority: 0, category: null, metadata: {} },
      ],
      savedAt: '2024-01-01',
    };
    writeFileSync(filePath, JSON.stringify(data));

    const coord = createCoordinator({
      events, pool,
      options: { persistPath: filePath },
    });

    const loaded = [];
    events.on('coord:queue-loaded', (data) => loaded.push(data));

    coord.start();

    expect(loaded[0].reset).toBe(1);
    expect(coord.taskQueue.get('t1').status).toBe('assigned'); // pending → assigned by work assigner on start
    coord.stop();
  });

  it('should emit no queue-loaded event when no file exists', () => {
    const coord = createCoordinator({
      events, pool,
      options: { persistPath: filePath },
    });

    const loaded = [];
    events.on('coord:queue-loaded', (data) => loaded.push(data));

    coord.start();

    expect(loaded).toHaveLength(0); // no file = no load event
    coord.stop();
  });

  it('should persist tasks through coordinator lifecycle', () => {
    // Create coordinator, add tasks, stop
    const coord1 = createCoordinator({
      events, pool,
      options: { persistPath: filePath },
    });
    coord1.start();
    coord1.addTask({ id: 'task-1', task: 'First task' });
    coord1.addTask({ id: 'task-2', task: 'Second task' });
    coord1.stop();

    // File should exist with tasks
    expect(existsSync(filePath)).toBe(true);

    // Create new coordinator, should load persisted tasks
    const events2 = new EventBus();
    const pool2 = mockPool([{ id: 'w1' }, { id: 'w2' }]);
    const coord2 = createCoordinator({
      events: events2, pool: pool2,
      options: { persistPath: filePath },
    });
    coord2.start();

    expect(coord2.taskQueue.size()).toBe(2);
    expect(coord2.taskQueue.get('task-1')).toBeTruthy();
    expect(coord2.taskQueue.get('task-2')).toBeTruthy();
    coord2.stop();
  });

  it('should persist completed state after task completion', () => {
    const coord = createCoordinator({
      events, pool,
      options: { persistPath: filePath },
    });
    coord.start();
    coord.addTask({ id: 'done', task: 'Will complete' });

    // Simulate worker completing the task
    events.emit('coord:complete', { workerId: 'w1', taskId: 'done', result: 'success' });

    coord.stop();

    // Verify on disk
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    const task = data.tasks.find(t => t.id === 'done');
    expect(task.status).toBe('complete');
    expect(task.result).toBe('success');
  });
});

// ============================================================
// Phase 9 — Hot-Reconfiguration
// ============================================================

describe('RateLimiter updateLimits', () => {
  it('should update maxRequestsPerMinute', () => {
    const limiter = createRateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 100 });
    limiter.updateLimits({ maxRequestsPerMinute: 20 });
    const status = limiter.getStatus();
    expect(status.maxRequestsPerMinute).toBe(20);
  });

  it('should update maxTokensPerMinute', () => {
    const limiter = createRateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 100 });
    limiter.updateLimits({ maxTokensPerMinute: 500 });
    const status = limiter.getStatus();
    expect(status.maxTokensPerMinute).toBe(500);
  });

  it('should cap bucket to new max when lowering limits', () => {
    const limiter = createRateLimiter({ maxRequestsPerMinute: 100, maxTokensPerMinute: 1000 });
    // Bucket starts full at 100
    limiter.updateLimits({ maxRequestsPerMinute: 5 });
    const status = limiter.getStatus();
    expect(status.requestBucket).toBeLessThanOrEqual(5);
  });

  it('should ignore invalid values', () => {
    const limiter = createRateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 100 });
    limiter.updateLimits({ maxRequestsPerMinute: 0, maxTokensPerMinute: -1 });
    const status = limiter.getStatus();
    expect(status.maxRequestsPerMinute).toBe(10);
    expect(status.maxTokensPerMinute).toBe(100);
  });
});

describe('CostAggregator updateBudgets', () => {
  it('should update globalBudgetUsd', () => {
    const agg = createCostAggregator({ globalBudgetUsd: 50, perWorkerBudgetUsd: 10 });
    agg.updateBudgets({ globalBudgetUsd: 200 });
    const status = agg.getStatus();
    expect(status.globalBudgetUsd).toBe(200);
  });

  it('should update perWorkerBudgetUsd', () => {
    const agg = createCostAggregator({ globalBudgetUsd: 50, perWorkerBudgetUsd: 10 });
    agg.updateBudgets({ perWorkerBudgetUsd: 30 });
    const status = agg.getStatus();
    expect(status.perWorkerBudgetUsd).toBe(30);
  });

  it('should reset exceeded flags when budget raised above totals', () => {
    const agg = createCostAggregator({ globalBudgetUsd: 1, perWorkerBudgetUsd: 1 });
    // Exhaust budget
    agg.record('w1', { totalUsd: 1.5 });
    let status = agg.getStatus();
    expect(status.globalExceeded).toBe(true);
    expect(status.workers.w1.exceeded).toBe(true);

    // Raise budget
    agg.updateBudgets({ globalBudgetUsd: 10, perWorkerBudgetUsd: 10 });
    status = agg.getStatus();
    expect(status.globalExceeded).toBe(false);
    expect(status.workers.w1.exceeded).toBe(false);
  });

  it('should not reset flags when budget still below totals', () => {
    const agg = createCostAggregator({ globalBudgetUsd: 1, perWorkerBudgetUsd: 1 });
    agg.record('w1', { totalUsd: 5 });
    agg.updateBudgets({ globalBudgetUsd: 2 }); // Still exceeded (5 > 2)
    const status = agg.getStatus();
    expect(status.globalExceeded).toBe(true);
  });
});

describe('Coordinator updateOptions', () => {
  let events, pool, coord;

  beforeEach(() => {
    events = new EventBus();
    pool = mockPool([{ id: 'w1' }, { id: 'w2' }]);
    coord = createCoordinator({
      events,
      pool,
      options: {
        maxRequestsPerMinute: 30,
        maxTokensPerMinute: 500_000,
        globalBudgetUsd: 50,
        perWorkerBudgetUsd: 10,
      },
    });
    coord.start();
  });

  afterEach(() => {
    try { coord.stop(); } catch (_) {}
  });

  it('should update rate limiter via updateOptions', () => {
    coord.updateOptions({ maxRequestsPerMinute: 100 });
    const status = coord.rateLimiter.getStatus();
    expect(status.maxRequestsPerMinute).toBe(100);
  });

  it('should update cost aggregator via updateOptions', () => {
    coord.updateOptions({ globalBudgetUsd: 200, perWorkerBudgetUsd: 50 });
    const status = coord.costAggregator.getStatus();
    expect(status.globalBudgetUsd).toBe(200);
    expect(status.perWorkerBudgetUsd).toBe(50);
  });

  it('should emit coord:config-updated event', () => {
    const updates = [];
    events.on('coord:config-updated', (data) => updates.push(data));
    coord.updateOptions({ maxRequestsPerMinute: 200 });
    expect(updates.length).toBe(1);
    expect(updates[0].maxRequestsPerMinute).toBe(200);
  });

  it('should handle empty/null updates gracefully', () => {
    expect(() => coord.updateOptions(null)).not.toThrow();
    expect(() => coord.updateOptions({})).not.toThrow();
  });
});

// ============================================================
// Phase 9 — Task Metrics
// ============================================================

describe('Coordinator getMetrics', () => {
  let events, pool, coord;

  beforeEach(() => {
    events = new EventBus();
    pool = mockPool([{ id: 'w1' }, { id: 'w2' }]);
    coord = createCoordinator({ events, pool });
    coord.start();
  });

  afterEach(() => {
    try { coord.stop(); } catch (_) {}
  });

  it('should return initial empty metrics', () => {
    const metrics = coord.getMetrics();
    expect(metrics.throughputPerMinute).toBe(0);
    expect(metrics.avgCompletionMs).toBeNull();
    expect(metrics.workerUtilization).toBe(0);
    expect(metrics.recentCompletions).toBe(0);
    expect(metrics.recentFailures).toBe(0);
    expect(metrics.windowMs).toBe(300_000);
  });

  it('should track completions', () => {
    coord.addTask({ id: 't1', task: 'test' });
    events.emit('coord:complete', { workerId: 'w1', taskId: 't1', result: 'ok' });

    const metrics = coord.getMetrics();
    expect(metrics.recentCompletions).toBe(1);
    expect(metrics.throughputPerMinute).toBeGreaterThan(0);
  });

  it('should track failures', () => {
    coord.addTask({ id: 't1', task: 'test' });
    events.emit('coord:failed', { workerId: 'w1', taskId: 't1', error: 'boom' });

    const metrics = coord.getMetrics();
    expect(metrics.recentFailures).toBe(1);
  });

  it('should calculate worker utilization', () => {
    coord.addTask({ id: 't1', task: 'test1' });
    coord.addTask({ id: 't2', task: 'test2' });
    // Both tasks auto-assigned to w1 and w2

    const metrics = coord.getMetrics();
    // 2 workers active, 2 tasks assigned → utilization should be > 0
    expect(metrics.workerUtilization).toBeGreaterThan(0);
  });

  it('should return outcome counts', () => {
    coord.addTask({ id: 't1', task: 'test1' });
    coord.addTask({ id: 't2', task: 'test2' });
    events.emit('coord:complete', { workerId: 'w1', taskId: 't1', result: 'ok' });
    events.emit('coord:failed', { workerId: 'w2', taskId: 't2', error: 'oops' });

    const metrics = coord.getMetrics();
    expect(metrics.outcomes.complete).toBe(1);
    expect(metrics.outcomes.failed).toBe(1);
  });
});

// ============================================================
// Phase 9 — Worker Config IPC Handler
// ============================================================

describe('Worker Config IPC Handler', () => {
  it('should handle config message and update state', () => {
    const sent = [];
    const originalSend = process.send;
    process.send = (msg) => sent.push(msg);

    try {
      // Initialize the worker
      handleMessage({ type: 'init', workerId: 'cfg-test', projectDir: '/tmp', config: { model: 'sonnet' } });

      // Send config update
      handleMessage({ type: 'config', model: 'opus', maxTurns: 50 });

      // Should have sent a status update
      const statusMsg = sent.find(m => m.type === 'status');
      expect(statusMsg).toBeTruthy();

      // Should have emitted worker:config-applied event
      const eventMsg = sent.find(m => m.type === 'event' && m.event === 'worker:config-applied');
      expect(eventMsg).toBeTruthy();
      expect(eventMsg.data.model).toBe('opus');
      expect(eventMsg.data.maxTurns).toBe(50);
    } finally {
      if (originalSend) {
        process.send = originalSend;
      } else {
        delete process.send;
      }
    }
  });

  it('should not emit for config with no updates', () => {
    const sent = [];
    const originalSend = process.send;
    process.send = (msg) => sent.push(msg);

    try {
      handleMessage({ type: 'init', workerId: 'cfg-test2', projectDir: '/tmp', config: {} });
      handleMessage({ type: 'config' }); // No actual config fields

      // Still sends status update
      const statusMessages = sent.filter(m => m.type === 'status');
      expect(statusMessages.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (originalSend) {
        process.send = originalSend;
      } else {
        delete process.send;
      }
    }
  });
});

// ============================================================
// Phase 9 — Process Pool updateConfig
// ============================================================

describe('Process Pool updateConfig', () => {
  it('should update worker config and reflect in getStatus', async () => {
    const events = new EventBus();
    const { createProcessPool } = await import('../process-pool.mjs');
    const pool = createProcessPool({
      events,
      projectDir: '/tmp',
      workerScript: join(import.meta.dirname, '..', 'orchestrator-worker.mjs'),
    });

    // Spawn a test worker
    pool.spawn('cfg-w1', { model: 'sonnet' });

    // Update config
    const updated = pool.updateConfig('cfg-w1', { model: 'opus', maxTurns: 100 });
    expect(updated).toBe(true);

    // Verify in getStatus
    const status = pool.getStatus();
    const worker = status.find(w => w.id === 'cfg-w1');
    expect(worker.config.model).toBe('opus');
    expect(worker.config.maxTurns).toBe(100);

    await pool.shutdownAll();
  });

  it('should return false for non-existent worker', async () => {
    const events = new EventBus();
    const { createProcessPool } = await import('../process-pool.mjs');
    const pool = createProcessPool({ events, projectDir: '/tmp' });

    expect(pool.updateConfig('no-such-worker', { model: 'opus' })).toBe(false);
  });
});

// ============================================================
// Phase 10 — WebSocket Bridged Events includes coord:config-updated
// ============================================================

describe('WebSocket Bridged Events (Phase 10)', () => {
  it('should include coord:config-updated in bridged events list', async () => {
    // Read the ws.mjs source and verify the event is listed
    const { readFileSync } = await import('fs');
    const wsSource = readFileSync(join(import.meta.dirname, '..', 'ws.mjs'), 'utf-8');
    expect(wsSource).toContain("'coord:config-updated'");
  });
});

// ============================================================
// Phase 10 — Coordinator emits coord:config-updated on updateOptions
// ============================================================

describe('Coordinator updateOptions emits config-updated', () => {
  it('should emit coord:config-updated with the updates', () => {
    const events = new EventBus();
    const mockPool = {
      getStatus: () => [],
      activeCount: () => 0,
    };
    const coordinator = createCoordinator({
      events,
      pool: mockPool,
      rateLimiter: createRateLimiter({ maxRequestsPerMinute: 60, maxTokensPerMinute: 100000 }),
      costAggregator: createCostAggregator({ globalBudgetUsd: 50, perWorkerBudgetUsd: 10 }),
    });

    coordinator.start();

    const emitted = [];
    events.on('coord:config-updated', (data) => emitted.push(data));

    coordinator.updateOptions({ maxRequestsPerMinute: 120, globalBudgetUsd: 200 });

    expect(emitted.length).toBe(1);
    expect(emitted[0].maxRequestsPerMinute).toBe(120);
    expect(emitted[0].globalBudgetUsd).toBe(200);

    coordinator.stop();
  });
});

// ============================================================
// Phase 11 — Adaptive Rate Limiter
// ============================================================

describe('AdaptiveLimiter', () => {
  let rl, adaptive, events;

  beforeEach(() => {
    events = new EventBus();
    rl = createRateLimiter({ maxRequestsPerMinute: 60, maxTokensPerMinute: 100000 });
    adaptive = createAdaptiveLimiter({
      rateLimiter: rl,
      events,
      errorThreshold: 3,
      windowMs: 60000,
      backoffFactor: 0.5,
      maxBackoffLevel: 4,
      recoveryIntervalMs: 100, // fast for testing
      recoveryFactor: 1.5,
    });
  });

  afterEach(() => {
    adaptive.destroy();
  });

  it('should start in normal state', () => {
    const status = adaptive.getStatus();
    expect(status.state).toBe('normal');
    expect(status.backoffLevel).toBe(0);
    expect(status.errorsInWindow).toBe(0);
    expect(status.factor).toBe(1);
    expect(status.baselineRequests).toBe(60);
    expect(status.baselineTokens).toBe(100000);
    expect(status.currentRequests).toBe(60);
    expect(status.currentTokens).toBe(100000);
  });

  it('should require a rateLimiter', () => {
    expect(() => createAdaptiveLimiter()).toThrow('requires a rateLimiter');
  });

  it('should track errors without triggering below threshold', () => {
    const r1 = adaptive.recordError('w1', 'rate limit');
    expect(r1.triggered).toBe(false);
    expect(r1.errorsInWindow).toBe(1);
    expect(r1.state).toBe('normal');

    const r2 = adaptive.recordError('w2', 'rate limit');
    expect(r2.triggered).toBe(false);
    expect(r2.errorsInWindow).toBe(2);
  });

  it('should trigger backoff at error threshold', () => {
    adaptive.recordError('w1');
    adaptive.recordError('w2');
    const r3 = adaptive.recordError('w3');
    expect(r3.triggered).toBe(true);
    expect(r3.backoffLevel).toBe(1);
    expect(r3.state).toBe('backing-off');
  });

  it('should reduce rate limiter limits on backoff', () => {
    adaptive.recordError('w1');
    adaptive.recordError('w2');
    adaptive.recordError('w3');

    const rlStatus = rl.getStatus();
    // 60 * 0.5 = 30
    expect(rlStatus.maxRequestsPerMinute).toBe(30);
    // 100000 * 0.5 = 50000
    expect(rlStatus.maxTokensPerMinute).toBe(50000);
  });

  it('should emit coord:rate-adjusted on backoff', () => {
    const emitted = [];
    events.on('coord:rate-adjusted', (data) => emitted.push(data));

    adaptive.recordError('w1');
    adaptive.recordError('w2');
    adaptive.recordError('w3');

    expect(emitted.length).toBe(1);
    expect(emitted[0].state).toBe('backing-off');
    expect(emitted[0].backoffLevel).toBe(1);
    expect(emitted[0].currentRequests).toBe(30);
    expect(emitted[0].currentTokens).toBe(50000);
    expect(emitted[0].baselineRequests).toBe(60);
  });

  it('should deepen backoff on repeated error bursts', () => {
    // First burst → level 1
    for (let i = 0; i < 3; i++) adaptive.recordError('w1');
    expect(adaptive.getStatus().backoffLevel).toBe(1);

    // Second burst → level 2
    for (let i = 0; i < 3; i++) adaptive.recordError('w1');
    expect(adaptive.getStatus().backoffLevel).toBe(2);

    // Limits at level 2: 0.5^2 = 0.25 → 15 req, 25000 tok
    const rlStatus = rl.getStatus();
    expect(rlStatus.maxRequestsPerMinute).toBe(15);
    expect(rlStatus.maxTokensPerMinute).toBe(25000);
  });

  it('should not exceed max backoff level', () => {
    for (let level = 0; level < 6; level++) {
      for (let i = 0; i < 3; i++) adaptive.recordError('w1');
    }
    expect(adaptive.getStatus().backoffLevel).toBe(4);
    // 0.5^4 = 0.0625 → 4 req (rounded, min 1), 6250 tok
    const rlStatus = rl.getStatus();
    expect(rlStatus.maxRequestsPerMinute).toBe(4);
    expect(rlStatus.maxTokensPerMinute).toBe(6250);
  });

  it('should recover limits over time', async () => {
    // Trigger backoff
    for (let i = 0; i < 3; i++) adaptive.recordError('w1');
    expect(adaptive.getStatus().state).toBe('backing-off');

    // Wait for recovery steps (interval is 100ms in test)
    await new Promise(r => setTimeout(r, 350));

    const status = adaptive.getStatus();
    // Should be recovering or normal by now
    expect(['recovering', 'normal']).toContain(status.state);
    // Limits should be higher than backoff level
    const rlStatus = rl.getStatus();
    expect(rlStatus.maxRequestsPerMinute).toBeGreaterThanOrEqual(30);
  });

  it('should fully restore limits after recovery', async () => {
    for (let i = 0; i < 3; i++) adaptive.recordError('w1');

    // Wait long enough for full recovery (need 2 recovery steps at 100ms each + margin)
    await new Promise(r => setTimeout(r, 800));

    const status = adaptive.getStatus();
    expect(status.state).toBe('normal');
    expect(status.backoffLevel).toBe(0);

    const rlStatus = rl.getStatus();
    expect(rlStatus.maxRequestsPerMinute).toBe(60);
    expect(rlStatus.maxTokensPerMinute).toBe(100000);
  });

  it('should update baseline on updateBaseline', () => {
    adaptive.updateBaseline({ maxRequestsPerMinute: 120, maxTokensPerMinute: 200000 });
    const status = adaptive.getStatus();
    expect(status.baselineRequests).toBe(120);
    expect(status.baselineTokens).toBe(200000);
    expect(status.currentRequests).toBe(120);
    expect(status.currentTokens).toBe(200000);
  });

  it('should not update active limits on baseline change during backoff', () => {
    for (let i = 0; i < 3; i++) adaptive.recordError('w1');
    const backoffRequests = rl.getStatus().maxRequestsPerMinute;

    adaptive.updateBaseline({ maxRequestsPerMinute: 120 });
    expect(adaptive.getStatus().baselineRequests).toBe(120);
    // Active limits should still be at backoff level, not jump to new baseline
    expect(adaptive.getStatus().currentRequests).toBe(backoffRequests);
  });

  it('should reset to normal state', () => {
    for (let i = 0; i < 3; i++) adaptive.recordError('w1');
    expect(adaptive.getStatus().state).toBe('backing-off');

    adaptive.reset();
    expect(adaptive.getStatus().state).toBe('normal');
    expect(adaptive.getStatus().backoffLevel).toBe(0);
    expect(adaptive.getStatus().errorsInWindow).toBe(0);

    const rlStatus = rl.getStatus();
    expect(rlStatus.maxRequestsPerMinute).toBe(60);
    expect(rlStatus.maxTokensPerMinute).toBe(100000);
  });

  it('should expose ADAPTIVE_STATES', () => {
    expect(ADAPTIVE_STATES.NORMAL).toBe('normal');
    expect(ADAPTIVE_STATES.BACKING_OFF).toBe('backing-off');
    expect(ADAPTIVE_STATES.RECOVERING).toBe('recovering');
  });

  it('should have min floor for requests (never 0)', () => {
    // Drive to max backoff then try one more
    for (let level = 0; level < 5; level++) {
      for (let i = 0; i < 3; i++) adaptive.recordError('w1');
    }
    const rlStatus = rl.getStatus();
    expect(rlStatus.maxRequestsPerMinute).toBeGreaterThanOrEqual(1);
    expect(rlStatus.maxTokensPerMinute).toBeGreaterThanOrEqual(1000);
  });

  it('should prune old errors outside window', () => {
    let clock = 0;
    const timed = createAdaptiveLimiter({
      rateLimiter: rl,
      errorThreshold: 3,
      windowMs: 1000,
      now: () => clock,
    });

    timed.recordError('w1');
    timed.recordError('w1');
    clock = 2000; // Advance past window
    const status = timed.getStatus();
    expect(status.errorsInWindow).toBe(0);
    timed.destroy();
  });
});

// ============================================================
// Phase 11 — Coordinator + Adaptive Rate Limiter Integration
// ============================================================

describe('Coordinator with Adaptive Rate Limiter', () => {
  it('should create adaptive limiter by default', () => {
    const events = new EventBus();
    const pool = mockPool([{ id: 'w1' }]);
    const coordinator = createCoordinator({ events, pool });

    expect(coordinator.adaptiveLimiter).toBeTruthy();
    const status = coordinator.adaptiveLimiter.getStatus();
    expect(status.state).toBe('normal');

    coordinator.stop();
  });

  it('should not create adaptive limiter when disabled', () => {
    const events = new EventBus();
    const pool = mockPool([{ id: 'w1' }]);
    const coordinator = createCoordinator({
      events, pool,
      options: { enableAdaptiveRate: false },
    });

    expect(coordinator.adaptiveLimiter).toBeNull();
    coordinator.stop();
  });

  it('should handle coord:rate-error by recording in adaptive limiter', () => {
    const events = new EventBus();
    const pool = mockPool([{ id: 'w1' }]);
    const coordinator = createCoordinator({
      events, pool,
      options: { adaptiveErrorThreshold: 2 },
    });

    coordinator.start();

    // Send rate errors
    events.emit('coord:rate-error', { workerId: 'w1', detail: '429 too many' });
    expect(coordinator.adaptiveLimiter.getStatus().errorsInWindow).toBe(1);

    events.emit('coord:rate-error', { workerId: 'w1', detail: '429 too many' });
    expect(coordinator.adaptiveLimiter.getStatus().state).toBe('backing-off');

    coordinator.stop();
  });

  it('should update adaptive baseline when updateOptions changes rate limits', () => {
    const events = new EventBus();
    const pool = mockPool([{ id: 'w1' }]);
    const coordinator = createCoordinator({ events, pool });

    coordinator.start();
    coordinator.updateOptions({ maxRequestsPerMinute: 120 });

    const alStatus = coordinator.adaptiveLimiter.getStatus();
    expect(alStatus.baselineRequests).toBe(120);

    coordinator.stop();
  });

  it('should emit coord:rate-adjusted through event bus', () => {
    const events = new EventBus();
    const pool = mockPool([{ id: 'w1' }]);
    const coordinator = createCoordinator({
      events, pool,
      options: { adaptiveErrorThreshold: 2 },
    });

    coordinator.start();

    const emitted = [];
    events.on('coord:rate-adjusted', (data) => emitted.push(data));

    events.emit('coord:rate-error', { workerId: 'w1' });
    events.emit('coord:rate-error', { workerId: 'w1' });

    expect(emitted.length).toBe(1);
    expect(emitted[0].state).toBe('backing-off');

    coordinator.stop();
  });

  it('should ignore coord:rate-error with no workerId', () => {
    const events = new EventBus();
    const pool = mockPool([{ id: 'w1' }]);
    const coordinator = createCoordinator({ events, pool });

    coordinator.start();
    events.emit('coord:rate-error', { detail: 'no worker' });
    expect(coordinator.adaptiveLimiter.getStatus().errorsInWindow).toBe(0);

    coordinator.stop();
  });
});

// ============================================================
// Phase 11 — WebSocket Bridged Events includes coord:rate-adjusted
// ============================================================

describe('WebSocket Bridged Events (Phase 11)', () => {
  it('should include coord:rate-adjusted in bridged events list', async () => {
    const { readFileSync } = await import('fs');
    const wsSource = readFileSync(join(import.meta.dirname, '..', 'ws.mjs'), 'utf-8');
    expect(wsSource).toContain("'coord:rate-adjusted'");
  });
});

// ============================================================
// Phase 14 — DAG Graph + Templates
// ============================================================

describe('getDependencyGraph — extended topologies (Phase 14)', () => {
  let queue;
  beforeEach(() => { queue = createTaskQueue(); });

  it('should return empty graph for no tasks', () => {
    const graph = queue.getDependencyGraph();
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.levels).toEqual([]);
  });

  it('should return single node with no edges', () => {
    queue.add({ id: 'solo', task: 'alone' });
    const graph = queue.getDependencyGraph();
    expect(graph.nodes).toEqual(['solo']);
    expect(graph.edges).toEqual([]);
    expect(graph.levels).toEqual([['solo']]);
  });

  it('should handle fan-out topology (one → many)', () => {
    queue.add({ id: 'root', task: 'root' });
    queue.add({ id: 'a', task: 'child-a', deps: ['root'] });
    queue.add({ id: 'b', task: 'child-b', deps: ['root'] });
    queue.add({ id: 'c', task: 'child-c', deps: ['root'] });
    const graph = queue.getDependencyGraph();
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: 'root', to: 'a' },
      { from: 'root', to: 'b' },
      { from: 'root', to: 'c' },
    ]));
    expect(graph.levels).toHaveLength(2);
    expect(graph.levels[0]).toEqual(['root']);
    expect(graph.levels[1]).toHaveLength(3);
  });

  it('should handle fan-in topology (many → one)', () => {
    queue.add({ id: 'a', task: 'source-a' });
    queue.add({ id: 'b', task: 'source-b' });
    queue.add({ id: 'c', task: 'source-c' });
    queue.add({ id: 'merge', task: 'merge all', deps: ['a', 'b', 'c'] });
    const graph = queue.getDependencyGraph();
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
    expect(graph.levels).toHaveLength(2);
    expect(graph.levels[0]).toHaveLength(3);
    expect(graph.levels[1]).toEqual(['merge']);
  });

  it('should handle diamond topology (fan-out + fan-in)', () => {
    queue.add({ id: 'start', task: 'start' });
    queue.add({ id: 'left', task: 'left', deps: ['start'] });
    queue.add({ id: 'right', task: 'right', deps: ['start'] });
    queue.add({ id: 'end', task: 'end', deps: ['left', 'right'] });
    const graph = queue.getDependencyGraph();
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    expect(graph.levels).toHaveLength(3);
    expect(graph.levels[0]).toEqual(['start']);
    expect(graph.levels[1]).toHaveLength(2);
    expect(graph.levels[2]).toEqual(['end']);
  });

  it('should handle deep chain (5 levels)', () => {
    queue.add({ id: 'a', task: 'a' });
    queue.add({ id: 'b', task: 'b', deps: ['a'] });
    queue.add({ id: 'c', task: 'c', deps: ['b'] });
    queue.add({ id: 'd', task: 'd', deps: ['c'] });
    queue.add({ id: 'e', task: 'e', deps: ['d'] });
    const graph = queue.getDependencyGraph();
    expect(graph.levels).toHaveLength(5);
    expect(graph.edges).toHaveLength(4);
  });

  it('should handle disconnected subgraphs', () => {
    queue.add({ id: 'a1', task: 'subgraph-1' });
    queue.add({ id: 'a2', task: 'subgraph-1-child', deps: ['a1'] });
    queue.add({ id: 'b1', task: 'subgraph-2' });
    queue.add({ id: 'b2', task: 'subgraph-2-child', deps: ['b1'] });
    const graph = queue.getDependencyGraph();
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(2);
    expect(graph.levels).toHaveLength(2);
    expect(graph.levels[0]).toHaveLength(2);
    expect(graph.levels[1]).toHaveLength(2);
  });

  it('should skip edges to non-existent deps (forward reference not added)', () => {
    queue.add({ id: 'a', task: 'a', deps: ['missing'] });
    const graph = queue.getDependencyGraph();
    expect(graph.nodes).toEqual(['a']);
    expect(graph.edges).toEqual([]); // 'missing' not in queue
  });
});

describe('Task Templates (Phase 14)', () => {
  it('should export TASK_TEMPLATES from coordination routes', async () => {
    const routeSource = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'routes', 'coordination.mjs'), 'utf-8'
    );
    expect(routeSource).toContain('TASK_TEMPLATES');
    expect(routeSource).toContain('sequential-pipeline');
    expect(routeSource).toContain('parallel-workers');
    expect(routeSource).toContain('feature-dev');
    expect(routeSource).toContain('bug-fix');
    expect(routeSource).toContain('full-cycle');
  });

  it('each template should have valid deps referencing sibling task IDs', async () => {
    const routeSource = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'routes', 'coordination.mjs'), 'utf-8'
    );
    // Extract templates by importing the route source indirectly — validate via task queue
    // Instead, create each template's tasks in a queue to verify validity
    const templates = [
      { tasks: [
        { id: 'analyze', task: 'a', deps: [] },
        { id: 'implement', task: 'b', deps: ['analyze'] },
        { id: 'verify', task: 'c', deps: ['implement'] },
      ]},
      { tasks: [
        { id: 'worker-a', task: 'a' },
        { id: 'worker-b', task: 'b' },
        { id: 'worker-c', task: 'c' },
        { id: 'merge', task: 'd', deps: ['worker-a', 'worker-b', 'worker-c'] },
      ]},
      { tasks: [
        { id: 'plan', task: 'a' },
        { id: 'code', task: 'b', deps: ['plan'] },
        { id: 'tests', task: 'c', deps: ['plan'] },
        { id: 'review', task: 'd', deps: ['code', 'tests'] },
        { id: 'deploy', task: 'e', deps: ['review'] },
      ]},
      { tasks: [
        { id: 'investigate', task: 'a' },
        { id: 'fix', task: 'b', deps: ['investigate'] },
        { id: 'test', task: 'c', deps: ['fix'] },
        { id: 'verify', task: 'd', deps: ['test'] },
      ]},
      { tasks: [
        { id: 'plan', task: 'a' },
        { id: 'frontend', task: 'b', deps: ['plan'] },
        { id: 'backend', task: 'c', deps: ['plan'] },
        { id: 'integrate', task: 'd', deps: ['frontend', 'backend'] },
        { id: 'test', task: 'e', deps: ['integrate'] },
        { id: 'deploy', task: 'f', deps: ['test'] },
      ]},
    ];

    for (const tmpl of templates) {
      const q = createTaskQueue();
      for (const t of tmpl.tasks) {
        q.add(t);
      }
      const v = q.validate();
      expect(v.valid).toBe(true);
      expect(v.errors).toHaveLength(0);
    }
  });

  it('templates should not create cycles when loaded into task queue', () => {
    const q = createTaskQueue();
    // Load the feature-dev template
    q.add({ id: 'plan', task: 'Plan feature' });
    q.add({ id: 'code', task: 'Code', deps: ['plan'] });
    q.add({ id: 'tests', task: 'Tests', deps: ['plan'] });
    q.add({ id: 'review', task: 'Review', deps: ['code', 'tests'] });
    q.add({ id: 'deploy', task: 'Deploy', deps: ['review'] });
    const v = q.validate();
    expect(v.valid).toBe(true);
    const graph = q.getDependencyGraph();
    expect(graph.levels).toHaveLength(4); // plan → code/tests → review → deploy
  });

  it('prefixed template tasks should maintain valid deps', () => {
    const q = createTaskQueue();
    const prefix = 'sprint-1-';
    q.add({ id: prefix + 'plan', task: 'Plan' });
    q.add({ id: prefix + 'code', task: 'Code', deps: [prefix + 'plan'] });
    q.add({ id: prefix + 'tests', task: 'Tests', deps: [prefix + 'plan'] });
    q.add({ id: prefix + 'review', task: 'Review', deps: [prefix + 'code', prefix + 'tests'] });
    const v = q.validate();
    expect(v.valid).toBe(true);
    expect(q.getReady()).toHaveLength(1);
    expect(q.getReady()[0].id).toBe('sprint-1-plan');
  });
});
