// ============================================================
// Multi-Master Tests (Phase 66)
// ============================================================
// Tests for multi-master pool support: spawn up to MAX_MASTERS,
// master registry, domain affinity, task exclusion, lifecycle events.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Fake terminal factory ──────────────────────────────────

function createFakeTerminal(id, pid = 100) {
  const listeners = { data: [], exit: [], error: [], 'context-warning': [] };
  let status = 'running';
  let exitCode = null;
  let exitSignal = null;
  return {
    id,
    pid,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => {
      setTimeout(() => {
        status = 'stopped';
        exitCode = 0;
        for (const fn of listeners.exit) fn(0, null);
      }, 10);
    }),
    getStatus: () => ({
      id, pid, status,
      projectDir: '/tmp/pool-test',
      model: null,
      dangerouslySkipPermissions: false,
      resumeSessionId: null,
      continueSession: false,
      systemPrompt: null,
      cols: 120, rows: 30,
      spawnedAt: new Date().toISOString(),
      exitCode, exitSignal,
    }),
    on(event, handler) {
      if (listeners[event]) listeners[event].push(handler);
    },
    off(event, handler) {
      const list = listeners[event];
      if (list) {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      }
    },
    _triggerExit(code = 0, signal = null) {
      status = 'stopped';
      exitCode = code;
      exitSignal = signal;
      for (const fn of listeners.exit) fn(code, signal);
    },
    _triggerData(data) {
      for (const fn of listeners.data) fn(data);
    },
    getOutputBuffer() {
      return '';
    },
    getRawOutputBuffer() {
      return '';
    },
  };
}

// ── Mock claude-terminal.mjs ───────────────────────────────

vi.mock('../claude-terminal.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createClaudeTerminal: vi.fn(),
    isNodePtyAvailable: vi.fn().mockResolvedValue(true),
  };
});

const { createClaudePool, MAX_MASTERS, MASTER_DOMAIN_AFFINITY_BONUS } = await import('../claude-pool.mjs');
const claudeTermMock = await import('../claude-terminal.mjs');

// ── Mock task queue helper ──────────────────────────────────

function createMockTaskQueue(tasks = []) {
  const store = new Map(tasks.map(t => [t.id, { ...t }]));
  return {
    getAll: () => [...store.values()],
    assign: vi.fn((id, workerId) => {
      const t = store.get(id);
      if (t) { t.status = 'assigned'; t.assignedTo = workerId; }
    }),
    start: vi.fn((id) => {
      const t = store.get(id);
      if (t) t.status = 'running';
    }),
    fail: vi.fn((id, reason) => {
      const t = store.get(id);
      if (t) t.status = 'failed';
    }),
    retry: vi.fn((id) => {
      const t = store.get(id);
      if (t) t.status = 'pending';
    }),
    complete: vi.fn((id) => {
      const t = store.get(id);
      if (t) t.status = 'complete';
    }),
  };
}

// ============================================================
// Tests
// ============================================================

describe('Multi-Master Pool (Phase 66)', () => {
  let pool, events, pidCounter;

  beforeEach(() => {
    events = new EventBus();
    pidCounter = 300;
    claudeTermMock.createClaudeTerminal.mockImplementation(async (opts) => {
      return createFakeTerminal(opts.id, pidCounter++);
    });
    claudeTermMock.isNodePtyAvailable.mockResolvedValue(true);
  });

  afterEach(async () => {
    if (pool) {
      try { await pool.shutdownAll(); } catch { /* noop */ }
    }
    vi.clearAllMocks();
  });

  describe('MAX_MASTERS constant', () => {
    it('should export MAX_MASTERS = 4', () => {
      expect(MAX_MASTERS).toBe(4);
    });

    it('should export MASTER_DOMAIN_AFFINITY_BONUS = 5', () => {
      expect(MASTER_DOMAIN_AFFINITY_BONUS).toBe(5);
    });
  });

  describe('Spawn multiple masters', () => {
    it('should spawn 4 masters simultaneously', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });

      for (let i = 1; i <= 4; i++) {
        await pool.spawn(`master-${i}`, { role: 'master', persistent: true });
      }

      const status = pool.getStatus();
      const masters = status.filter(t => t.role === 'master');
      expect(masters).toHaveLength(4);
      masters.forEach(m => expect(m.status).toBe('running'));
    });

    it('should reject 5th master with MAX_MASTERS error', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });

      for (let i = 1; i <= 4; i++) {
        await pool.spawn(`master-${i}`, { role: 'master', persistent: true });
      }

      await expect(
        pool.spawn('master-5', { role: 'master', persistent: true })
      ).rejects.toThrow(/Maximum masters.*4/);
    });

    it('should allow new master after one exits', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });

      for (let i = 1; i <= 4; i++) {
        await pool.spawn(`master-${i}`, { role: 'master', persistent: true });
      }

      // Kill master-1
      pool.kill('master-1');
      await new Promise(r => setTimeout(r, 50));

      // Should now allow a 5th (replacing the exited one)
      const result = await pool.spawn('master-5', { role: 'master', persistent: true });
      expect(result.status).toBe('running');
    });
  });

  describe('Master events', () => {
    it('should emit master:spawned on master spawn', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      const spawnedEvents = [];
      events.on('master:spawned', (d) => spawnedEvents.push(d));

      await pool.spawn('master-1', { role: 'master', persistent: true });

      expect(spawnedEvents).toHaveLength(1);
      expect(spawnedEvents[0].id).toBe('master-1');
      expect(spawnedEvents[0].count).toBe(1);
    });

    it('should emit master:count-changed on spawn', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      const countEvents = [];
      events.on('master:count-changed', (d) => countEvents.push(d));

      await pool.spawn('master-1', { role: 'master', persistent: true });

      expect(countEvents).toHaveLength(1);
      expect(countEvents[0].count).toBe(1);
    });

    it('should emit master:exited on master exit', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      const exitedEvents = [];
      events.on('master:exited', (d) => exitedEvents.push(d));

      await pool.spawn('master-1', { role: 'master', persistent: true });
      pool.kill('master-1');
      await new Promise(r => setTimeout(r, 50));

      expect(exitedEvents).toHaveLength(1);
      expect(exitedEvents[0].id).toBe('master-1');
    });

    it('should decrement count on exit', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      const countEvents = [];
      events.on('master:count-changed', (d) => countEvents.push(d));

      await pool.spawn('master-1', { role: 'master', persistent: true });
      await pool.spawn('master-2', { role: 'master', persistent: true });

      pool.kill('master-1');
      await new Promise(r => setTimeout(r, 50));

      // Last count-changed should show count=1 (master-2 still running)
      const last = countEvents[countEvents.length - 1];
      expect(last.count).toBe(1);
    });

    it('should not emit master events for worker spawn', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      const spawnedEvents = [];
      events.on('master:spawned', (d) => spawnedEvents.push(d));

      await pool.spawn('worker-1', {});

      expect(spawnedEvents).toHaveLength(0);
    });
  });

  describe('getMasterTerminal() backward compat', () => {
    it('should return first master when called with no args', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });
      await pool.spawn('master-2', { role: 'master', persistent: true });

      const master = pool.getMasterTerminal();
      expect(master).toBeTruthy();
      expect(master.role).toBe('master');
    });

    it('should return specific master by id', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });
      await pool.spawn('master-2', { role: 'master', persistent: true });

      const m2 = pool.getMasterTerminal('master-2');
      expect(m2).toBeTruthy();
      expect(m2.id).toBe('master-2');
    });

    it('should return null for non-existent master id', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });

      const result = pool.getMasterTerminal('master-99');
      expect(result).toBeNull();
    });

    it('should return null for worker id passed to getMasterTerminal', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('worker-1', {});

      const result = pool.getMasterTerminal('worker-1');
      expect(result).toBeNull();
    });
  });

  describe('getMasterTerminals()', () => {
    it('should return all masters', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });
      await pool.spawn('master-2', { role: 'master', persistent: true });
      await pool.spawn('worker-1', {});

      const masters = pool.getMasterTerminals();
      expect(masters).toHaveLength(2);
      expect(masters.every(m => m.role === 'master')).toBe(true);
    });

    it('should return empty array when no masters', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('worker-1', {});

      const masters = pool.getMasterTerminals();
      expect(masters).toHaveLength(0);
    });
  });

  describe('getMasterRegistry()', () => {
    it('should track master registration', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });

      const registry = pool.getMasterRegistry();
      expect(registry).toHaveLength(1);
      expect(registry[0].id).toBe('master-1');
      expect(registry[0].claimedTaskIds).toEqual([]);
      expect(registry[0].workerIds).toEqual([]);
      expect(registry[0].domain).toBeNull();
    });

    it('should track multiple masters', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });
      await pool.spawn('master-2', { role: 'master', persistent: true });

      const registry = pool.getMasterRegistry();
      expect(registry).toHaveLength(2);
      const ids = registry.map(r => r.id).sort();
      expect(ids).toEqual(['master-1', 'master-2']);
    });

    it('should remove from registry on exit', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });

      pool.kill('master-1');
      await new Promise(r => setTimeout(r, 50));

      const registry = pool.getMasterRegistry();
      expect(registry).toHaveLength(0);
    });

    it('should not include workers in registry', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('worker-1', {});
      await pool.spawn('master-1', { role: 'master', persistent: true });

      const registry = pool.getMasterRegistry();
      expect(registry).toHaveLength(1);
      expect(registry[0].id).toBe('master-1');
    });
  });

  describe('setMasterDomain()', () => {
    it('should set domain for a master', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });

      const ok = pool.setMasterDomain('master-1', 'testing');
      expect(ok).toBe(true);

      const registry = pool.getMasterRegistry();
      expect(registry[0].domain).toBe('testing');
    });

    it('should return false for non-master', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      const ok = pool.setMasterDomain('nonexistent', 'testing');
      expect(ok).toBe(false);
    });

    it('should allow clearing domain with null', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('master-1', { role: 'master', persistent: true });
      pool.setMasterDomain('master-1', 'testing');
      pool.setMasterDomain('master-1', null);

      const registry = pool.getMasterRegistry();
      expect(registry[0].domain).toBeNull();
    });
  });

  describe('Domain affinity for task scoring', () => {
    it('should prefer tasks matching master domain', async () => {
      const tasks = [
        { id: 't1', task: 'Test task', status: 'pending', priority: 5, category: 'testing' },
        { id: 't2', task: 'Feature task', status: 'pending', priority: 5, category: 'features' },
      ];
      const taskQueue = createMockTaskQueue(tasks);
      const coordinator = { taskQueue };

      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {}, coordinator });
      await pool.spawn('master-1', { role: 'master', persistent: true });
      pool.setMasterDomain('master-1', 'testing');

      const next = pool.findNextClaimableTask('master-1');
      expect(next).toBeTruthy();
      expect(next.id).toBe('t1'); // testing domain affinity should prefer t1
    });

    it('should not apply domain affinity for workers', async () => {
      const tasks = [
        { id: 't1', task: 'Test task', status: 'pending', priority: 3, category: 'testing' },
        { id: 't2', task: 'Feature task', status: 'pending', priority: 5, category: 'features' },
      ];
      const taskQueue = createMockTaskQueue(tasks);
      const coordinator = { taskQueue };

      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {}, coordinator });
      await pool.spawn('worker-1', {});

      // Worker should get highest priority task (t2) since no domain affinity
      const next = pool.findNextClaimableTask('worker-1');
      expect(next).toBeTruthy();
      expect(next.id).toBe('t2');
    });
  });

  describe('Multi-master task exclusion', () => {
    it('should exclude tasks assigned to other masters via taskQueue status', async () => {
      const tasks = [
        { id: 't1', task: 'Task 1', status: 'pending', priority: 5 },
        { id: 't2', task: 'Task 2', status: 'pending', priority: 5 },
      ];
      const taskQueue = createMockTaskQueue(tasks);
      const coordinator = { taskQueue };

      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {}, coordinator });
      await pool.spawn('master-1', { role: 'master', persistent: true });
      await pool.spawn('master-2', { role: 'master', persistent: true });

      // Master-1 claims t1 through taskQueue (marks as assigned)
      taskQueue.assign('t1', 'master-1');
      pool.assignTask('master-1', tasks[0]);

      // Master-2 should only see t2 (t1 is now 'assigned', not 'pending')
      const next = pool.findNextClaimableTask('master-2');
      expect(next).toBeTruthy();
      expect(next.id).toBe('t2');
    });

    it('should not apply exclusion for single master', async () => {
      const tasks = [
        { id: 't1', task: 'Task 1', status: 'pending', priority: 5 },
      ];
      const taskQueue = createMockTaskQueue(tasks);
      const coordinator = { taskQueue };

      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {}, coordinator });
      await pool.spawn('master-1', { role: 'master', persistent: true });

      const next = pool.findNextClaimableTask('master-1');
      expect(next).toBeTruthy();
      expect(next.id).toBe('t1');
    });
  });

  describe('Master task release on exit', () => {
    it('should emit releasedTasks when master exits', async () => {
      const tasks = [
        { id: 't1', task: 'Task 1', status: 'running', priority: 5 },
      ];
      const taskQueue = createMockTaskQueue(tasks);
      const coordinator = { taskQueue };

      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {}, coordinator });
      await pool.spawn('master-1', { role: 'master', persistent: true });

      const exitedEvents = [];
      events.on('master:exited', (d) => exitedEvents.push(d));

      pool.kill('master-1');
      await new Promise(r => setTimeout(r, 50));

      expect(exitedEvents).toHaveLength(1);
      expect(exitedEvents[0].releasedTasks).toBeDefined();
      expect(Array.isArray(exitedEvents[0].releasedTasks)).toBe(true);
    });
  });

  describe('Swarm scale-down protection', () => {
    it('should protect all masters from swarm scale-down (persistent flag)', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });

      await pool.spawn('master-1', { role: 'master', persistent: true });
      await pool.spawn('master-2', { role: 'master', persistent: true });

      const status = pool.getStatus();
      const masters = status.filter(t => t.role === 'master');
      expect(masters).toHaveLength(2);
      masters.forEach(m => {
        expect(m.persistent).toBe(true);
      });
    });
  });

  describe('Worker not affected by master exclusion', () => {
    it('should not apply master exclusion for worker terminals', async () => {
      const tasks = [
        { id: 't1', task: 'Task 1', status: 'pending', priority: 5 },
      ];
      const taskQueue = createMockTaskQueue(tasks);
      const coordinator = { taskQueue };

      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {}, coordinator });
      await pool.spawn('worker-1', { autoDispatch: true });

      const next = pool.findNextClaimableTask('worker-1');
      expect(next).toBeTruthy();
      expect(next.id).toBe('t1');
    });
  });

  describe('Backward compatibility', () => {
    it('should still allow single master (no regression)', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      const result = await pool.spawn('master', { role: 'master', persistent: true });
      expect(result.status).toBe('running');

      const master = pool.getMasterTerminal();
      expect(master).toBeTruthy();
      expect(master.id).toBe('master');
    });

    it('should still work when no masters exist', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      const master = pool.getMasterTerminal();
      expect(master).toBeNull();

      const masters = pool.getMasterTerminals();
      expect(masters).toHaveLength(0);

      const registry = pool.getMasterRegistry();
      expect(registry).toHaveLength(0);
    });

    it('should not break existing pool operations without masters', async () => {
      pool = createClaudePool({ events, projectDir: '/tmp/pool-test', log: () => {} });
      await pool.spawn('worker-1', {});
      await pool.spawn('worker-2', {});

      const status = pool.getStatus();
      expect(status).toHaveLength(2);
      expect(status.every(t => t.role === null)).toBe(true);

      // Pool status should work
      const poolStatus = pool.getPoolStatus();
      expect(poolStatus.active).toBe(2);
    });
  });
});
