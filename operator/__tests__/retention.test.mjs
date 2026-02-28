// Retention Policy Tests (Phase 30)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRetentionPolicy, DEFAULT_MAX_AGE_DAYS, DEFAULT_MAX_ENTRIES } from '../retention.mjs';

// ── Helpers ─────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Create an ISO timestamp N days ago from now. */
function daysAgo(n) {
  return new Date(Date.now() - n * MS_PER_DAY).toISOString();
}

/** Create a mock messageBus with configurable messages. */
function mockMessageBus(messages = []) {
  return {
    getAll: vi.fn(() => [...messages]),
    delete: vi.fn(),
  };
}

/** Create a mock sharedMemory with configurable entries keyed by snapshot key. */
function mockSharedMemory(entries = {}) {
  return {
    keys: vi.fn((prefix) => Object.keys(entries).filter(k => k.startsWith(prefix))),
    getEntry: vi.fn((key) => entries[key] || null),
    delete: vi.fn(),
  };
}

/** Create a mock taskQueue with configurable tasks. */
function mockTaskQueue(tasks = []) {
  return {
    getAll: vi.fn(() => [...tasks]),
    remove: vi.fn(),
  };
}

// ── Exports ─────────────────────────────────────────────────

describe('exports', () => {
  it('DEFAULT_MAX_AGE_DAYS is 30', () => {
    expect(DEFAULT_MAX_AGE_DAYS).toBe(30);
  });

  it('DEFAULT_MAX_ENTRIES is 1000', () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(1000);
  });
});

// ── Factory ─────────────────────────────────────────────────

describe('factory', () => {
  it('returns object with expected methods and getters', () => {
    const policy = createRetentionPolicy();
    expect(typeof policy.cleanMessages).toBe('function');
    expect(typeof policy.cleanSnapshots).toBe('function');
    expect(typeof policy.cleanCompletedTasks).toBe('function');
    expect(typeof policy.runAll).toBe('function');
    expect(policy.maxAgeDays).toBe(DEFAULT_MAX_AGE_DAYS);
    expect(policy.maxEntries).toBe(DEFAULT_MAX_ENTRIES);
  });
});

// ── cleanMessages ───────────────────────────────────────────

describe('cleanMessages', () => {
  it('returns 0 for null bus', () => {
    const policy = createRetentionPolicy();
    expect(policy.cleanMessages(null)).toBe(0);
  });

  it('removes old messages and keeps recent ones', () => {
    const policy = createRetentionPolicy({ maxAgeDays: 10 });
    const bus = mockMessageBus([
      { id: 'old-1', timestamp: daysAgo(15) },
      { id: 'old-2', timestamp: daysAgo(20) },
      { id: 'new-1', timestamp: daysAgo(3) },
      { id: 'new-2', timestamp: daysAgo(1) },
    ]);

    const removed = policy.cleanMessages(bus);

    expect(removed).toBe(2);
    expect(bus.delete).toHaveBeenCalledTimes(2);
    expect(bus.delete).toHaveBeenCalledWith('old-1');
    expect(bus.delete).toHaveBeenCalledWith('old-2');
  });

  it('logs when removing messages', () => {
    const log = { info: vi.fn() };
    const policy = createRetentionPolicy({ log, maxAgeDays: 5 });
    const bus = mockMessageBus([
      { id: 'm1', timestamp: daysAgo(10) },
      { id: 'm2', timestamp: daysAgo(7) },
    ]);

    policy.cleanMessages(bus);

    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('Retention: removed 2 old messages');
  });
});

// ── cleanSnapshots ──────────────────────────────────────────

describe('cleanSnapshots', () => {
  it('returns 0 for null memory', () => {
    const policy = createRetentionPolicy();
    expect(policy.cleanSnapshots(null)).toBe(0);
  });

  it('removes old snapshots and keeps recent ones', () => {
    const policy = createRetentionPolicy({ maxAgeDays: 7 });
    const mem = mockSharedMemory({
      'snapshot:old-a': { updatedAt: daysAgo(14) },
      'snapshot:old-b': { updatedAt: daysAgo(30) },
      'snapshot:new-a': { updatedAt: daysAgo(2) },
      'snapshot:new-b': { updatedAt: daysAgo(1) },
    });

    const removed = policy.cleanSnapshots(mem);

    expect(removed).toBe(2);
    expect(mem.delete).toHaveBeenCalledTimes(2);
    expect(mem.delete).toHaveBeenCalledWith('snapshot:old-a');
    expect(mem.delete).toHaveBeenCalledWith('snapshot:old-b');
  });
});

// ── cleanCompletedTasks ─────────────────────────────────────

describe('cleanCompletedTasks', () => {
  it('returns 0 for null queue', () => {
    const policy = createRetentionPolicy();
    expect(policy.cleanCompletedTasks(null)).toBe(0);
  });

  it('removes old completed tasks beyond maxAgeDays', () => {
    const policy = createRetentionPolicy({ maxAgeDays: 10, maxEntries: 100 });
    const queue = mockTaskQueue([
      { id: 't1', status: 'complete', completedAt: daysAgo(15) },
      { id: 't2', status: 'failed', completedAt: daysAgo(20) },
      { id: 't3', status: 'complete', completedAt: daysAgo(5) },
    ]);

    const removed = policy.cleanCompletedTasks(queue);

    expect(removed).toBe(2);
    expect(queue.remove).toHaveBeenCalledWith('t1');
    expect(queue.remove).toHaveBeenCalledWith('t2');
  });

  it('keeps recent tasks within maxEntries', () => {
    const policy = createRetentionPolicy({ maxAgeDays: 30, maxEntries: 5 });
    const tasks = [];
    for (let i = 0; i < 5; i++) {
      tasks.push({ id: `t${i}`, status: 'complete', completedAt: daysAgo(i + 1) });
    }
    const queue = mockTaskQueue(tasks);

    const removed = policy.cleanCompletedTasks(queue);

    expect(removed).toBe(0);
    expect(queue.remove).not.toHaveBeenCalled();
  });

  it('skips non-terminal status tasks', () => {
    const policy = createRetentionPolicy({ maxAgeDays: 1, maxEntries: 100 });
    const queue = mockTaskQueue([
      { id: 'pending-1', status: 'pending', createdAt: daysAgo(10) },
      { id: 'assigned-1', status: 'assigned', createdAt: daysAgo(10) },
      { id: 'running-1', status: 'running', createdAt: daysAgo(10) },
      { id: 'complete-1', status: 'complete', completedAt: daysAgo(5) },
    ]);

    const removed = policy.cleanCompletedTasks(queue);

    // Only the complete task is terminal and old enough
    expect(removed).toBe(1);
    expect(queue.remove).toHaveBeenCalledWith('complete-1');
    expect(queue.remove).not.toHaveBeenCalledWith('pending-1');
    expect(queue.remove).not.toHaveBeenCalledWith('assigned-1');
    expect(queue.remove).not.toHaveBeenCalledWith('running-1');
  });

  it('removes tasks beyond count cap even if recent', () => {
    const policy = createRetentionPolicy({ maxAgeDays: 30, maxEntries: 2 });
    const queue = mockTaskQueue([
      { id: 't1', status: 'complete', completedAt: daysAgo(1) },
      { id: 't2', status: 'complete', completedAt: daysAgo(2) },
      { id: 't3', status: 'complete', completedAt: daysAgo(3) },
      { id: 't4', status: 'failed', completedAt: daysAgo(4) },
      { id: 't5', status: 'cancelled', completedAt: daysAgo(5) },
    ]);

    const removed = policy.cleanCompletedTasks(queue);

    // Sorted newest-first: t1, t2, t3, t4, t5
    // maxEntries=2, so indices 2+ (t3, t4, t5) are removed
    expect(removed).toBe(3);
    expect(queue.remove).toHaveBeenCalledWith('t3');
    expect(queue.remove).toHaveBeenCalledWith('t4');
    expect(queue.remove).toHaveBeenCalledWith('t5');
  });
});

// ── runAll ──────────────────────────────────────────────────

describe('runAll', () => {
  it('calls all three cleanup methods and returns counts', () => {
    const policy = createRetentionPolicy({ maxAgeDays: 5, maxEntries: 100 });
    const bus = mockMessageBus([
      { id: 'm1', timestamp: daysAgo(10) },
    ]);
    const mem = mockSharedMemory({
      'snapshot:s1': { updatedAt: daysAgo(10) },
      'snapshot:s2': { updatedAt: daysAgo(10) },
    });
    const queue = mockTaskQueue([
      { id: 't1', status: 'complete', completedAt: daysAgo(10) },
      { id: 't2', status: 'failed', completedAt: daysAgo(10) },
      { id: 't3', status: 'cancelled', completedAt: daysAgo(10) },
    ]);

    const result = policy.runAll({ messageBus: bus, sharedMemory: mem, taskQueue: queue });

    expect(result.messagesRemoved).toBe(1);
    expect(result.snapshotsRemoved).toBe(2);
    expect(result.tasksRemoved).toBe(3);
  });

  it('handles missing subsystems gracefully', () => {
    const policy = createRetentionPolicy();

    // All undefined
    const result1 = policy.runAll({});
    expect(result1.messagesRemoved).toBe(0);
    expect(result1.snapshotsRemoved).toBe(0);
    expect(result1.tasksRemoved).toBe(0);

    // No argument at all
    const result2 = policy.runAll();
    expect(result2.messagesRemoved).toBe(0);
    expect(result2.snapshotsRemoved).toBe(0);
    expect(result2.tasksRemoved).toBe(0);
  });
});

// ── Custom config ───────────────────────────────────────────

describe('custom maxAgeDays/maxEntries', () => {
  it('respects custom values', () => {
    const policy = createRetentionPolicy({ maxAgeDays: 7, maxEntries: 50 });
    expect(policy.maxAgeDays).toBe(7);
    expect(policy.maxEntries).toBe(50);

    // A message 8 days old should be removed with maxAgeDays=7
    const bus = mockMessageBus([
      { id: 'within', timestamp: daysAgo(5) },
      { id: 'beyond', timestamp: daysAgo(8) },
    ]);

    const removed = policy.cleanMessages(bus);
    expect(removed).toBe(1);
    expect(bus.delete).toHaveBeenCalledWith('beyond');
  });
});
