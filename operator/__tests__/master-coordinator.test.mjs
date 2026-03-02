// ============================================================
// Master Coordinator Tests (Phase 66)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMasterCoordinator, HEARTBEAT_INTERVAL_MS, STALE_THRESHOLD_MS, RECOVERY_CHECK_INTERVAL_MS } from '../master-coordinator.mjs';

function createEvents() {
  const handlers = {};
  return {
    on: vi.fn((e, h) => { (handlers[e] = handlers[e] || []).push(h); }),
    off: vi.fn(),
    emit: vi.fn((e, d) => { (handlers[e] || []).forEach(h => { try { h(d); } catch {} }); }),
  };
}

function createMockSharedMemory() {
  const store = new Map();
  return {
    get: vi.fn((key) => {
      const entry = store.get(key);
      return entry ? entry.value : undefined;
    }),
    set: vi.fn((key, value, source) => {
      store.set(key, { value, source });
      return true;
    }),
    delete: vi.fn((key) => store.delete(key)),
    has: vi.fn((key) => store.has(key)),
    keys: vi.fn(() => [...store.keys()]),
    _store: store,
  };
}

function createMockClaudePool() {
  const registry = [];
  return {
    getMasterRegistry: vi.fn(() => [...registry]),
    setMasterDomain: vi.fn(),
    getMasterTerminals: vi.fn(() => []),
    _registry: registry,
    _addMaster: (id, domain = null) => {
      registry.push({ id, claimedTaskIds: [], workerIds: [], domain });
    },
  };
}

function createMockCoordinator() {
  return {
    taskQueue: {
      fail: vi.fn(),
      retry: vi.fn(),
    },
  };
}

describe('Master Coordinator (Phase 66)', () => {
  let mc, events, sharedMemory, claudePool, coordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    events = createEvents();
    sharedMemory = createMockSharedMemory();
    claudePool = createMockClaudePool();
    coordinator = createMockCoordinator();
  });

  afterEach(() => {
    if (mc) mc.destroy();
    vi.useRealTimers();
  });

  describe('Constants', () => {
    it('should export heartbeat interval', () => {
      expect(HEARTBEAT_INTERVAL_MS).toBe(30000);
    });

    it('should export stale threshold', () => {
      expect(STALE_THRESHOLD_MS).toBe(90000);
    });

    it('should export recovery check interval', () => {
      expect(RECOVERY_CHECK_INTERVAL_MS).toBe(15000);
    });
  });

  describe('Registration', () => {
    it('should write heartbeat on register', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');

      expect(sharedMemory.set).toHaveBeenCalledWith(
        'master:master-1:heartbeat',
        expect.objectContaining({ alive: true, lastBeat: expect.any(String) }),
        'master-coordinator'
      );
    });

    it('should emit registered event', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');

      const emitCall = events.emit.mock.calls.find(c => c[0] === 'master-coordinator:registered');
      expect(emitCall).toBeTruthy();
      expect(emitCall[1].masterId).toBe('master-1');
    });

    it('should register with domain', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1', { domain: 'testing' });

      expect(claudePool.setMasterDomain).toHaveBeenCalledWith('master-1', 'testing');
      expect(sharedMemory.set).toHaveBeenCalledWith(
        'master:master-1:heartbeat',
        expect.objectContaining({ domain: 'testing' }),
        'master-coordinator'
      );
    });

    it('should throw on empty masterId', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      expect(() => mc.register('')).toThrow('masterId is required');
    });

    it('should write periodic heartbeats', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');

      // Initial write
      expect(sharedMemory.set).toHaveBeenCalledTimes(1);

      // Advance time by one heartbeat interval
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(sharedMemory.set).toHaveBeenCalledTimes(2);

      // Another interval
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(sharedMemory.set).toHaveBeenCalledTimes(3);
    });
  });

  describe('Deregistration', () => {
    it('should clean up heartbeat on deregister', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');
      mc.deregister('master-1');

      expect(sharedMemory.delete).toHaveBeenCalledWith('master:master-1:heartbeat');
    });

    it('should emit deregistered event', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');
      mc.deregister('master-1');

      const emitCall = events.emit.mock.calls.find(c => c[0] === 'master-coordinator:deregistered');
      expect(emitCall).toBeTruthy();
      expect(emitCall[1].masterId).toBe('master-1');
    });

    it('should stop heartbeat timer on deregister', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');
      mc.deregister('master-1');

      // Clear the initial write count
      const countAfterDeregister = sharedMemory.set.mock.calls.length;

      // Advance time — should NOT write more heartbeats
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
      expect(sharedMemory.set).toHaveBeenCalledTimes(countAfterDeregister);
    });
  });

  describe('Domain claiming', () => {
    it('should claim domain', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');

      const ok = mc.claimDomain('master-1', 'testing');
      expect(ok).toBe(true);
      expect(claudePool.setMasterDomain).toHaveBeenCalledWith('master-1', 'testing');
    });

    it('should emit domain-claimed event', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');
      mc.claimDomain('master-1', 'features');

      const emitCall = events.emit.mock.calls.find(c => c[0] === 'master-coordinator:domain-claimed');
      expect(emitCall).toBeTruthy();
      expect(emitCall[1].domain).toBe('features');
    });

    it('should return false for empty inputs', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      expect(mc.claimDomain('', 'testing')).toBe(false);
      expect(mc.claimDomain('master-1', '')).toBe(false);
    });

    it('should release domain', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');
      mc.claimDomain('master-1', 'testing');

      const ok = mc.releaseDomain('master-1');
      expect(ok).toBe(true);
    });
  });

  describe('Stale detection', () => {
    it('should detect stale masters', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });

      // Manually write a stale heartbeat
      sharedMemory._store.set('master:dead-1:heartbeat', {
        value: {
          alive: true,
          lastBeat: new Date(Date.now() - STALE_THRESHOLD_MS - 1000).toISOString(),
          domain: null,
          claimedTasks: 0,
          workerCount: 0,
        },
      });

      const status = mc.getMultiMasterStatus();
      expect(status.staleMasters).toBe(1);
      expect(status.masters[0].isStale).toBe(true);
    });

    it('should mark active masters as alive', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');

      const status = mc.getMultiMasterStatus();
      expect(status.activeMasters).toBe(1);
      expect(status.masters[0].alive).toBe(true);
    });

    it('should release tasks from stale masters', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });

      // Add a master with claimed tasks
      claudePool._addMaster('stale-master', null);
      claudePool._registry[0].claimedTaskIds = ['t1', 't2'];

      // Write stale heartbeat
      sharedMemory._store.set('master:stale-master:heartbeat', {
        value: {
          alive: true,
          lastBeat: new Date(Date.now() - STALE_THRESHOLD_MS - 5000).toISOString(),
          domain: null,
          claimedTasks: 2,
          workerCount: 0,
        },
      });

      // Register a live master to start recovery timer
      mc.register('master-1');

      // Advance to trigger recovery check
      vi.advanceTimersByTime(RECOVERY_CHECK_INTERVAL_MS);

      // Should have recovered tasks
      const staleEvent = events.emit.mock.calls.find(c => c[0] === 'master-coordinator:stale-recovered');
      expect(staleEvent).toBeTruthy();
      expect(staleEvent[1].masterId).toBe('stale-master');
    });
  });

  describe('Status aggregation', () => {
    it('should aggregate multiple masters', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');
      mc.register('master-2');
      mc.register('master-3');

      const status = mc.getMultiMasterStatus();
      expect(status.totalMasters).toBe(3);
      expect(status.activeMasters).toBe(3);
      expect(status.staleMasters).toBe(0);
    });

    it('should include domain in status', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1', { domain: 'testing' });

      const status = mc.getMultiMasterStatus();
      expect(status.masters[0].domain).toBe('testing');
    });

    it('should return empty when no masters', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      const status = mc.getMultiMasterStatus();
      expect(status.totalMasters).toBe(0);
      expect(status.masters).toHaveLength(0);
    });
  });

  describe('EventBus integration', () => {
    it('should emit events for all lifecycle operations', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });

      mc.register('master-1');
      mc.claimDomain('master-1', 'testing');
      mc.deregister('master-1');

      const eventTypes = events.emit.mock.calls.map(c => c[0]);
      expect(eventTypes).toContain('master-coordinator:registered');
      expect(eventTypes).toContain('master-coordinator:domain-claimed');
      expect(eventTypes).toContain('master-coordinator:deregistered');
    });
  });

  describe('Destroy', () => {
    it('should clean up all timers on destroy', () => {
      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');
      mc.register('master-2');

      mc.destroy();

      // Advance time — no more heartbeats should fire
      const countBefore = sharedMemory.set.mock.calls.length;
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
      expect(sharedMemory.set).toHaveBeenCalledTimes(countBefore);
    });
  });

  describe('Heartbeat data', () => {
    it('should include pool data in heartbeat', () => {
      claudePool._addMaster('master-1', 'testing');
      claudePool._registry[0].claimedTaskIds = ['t1'];
      claudePool._registry[0].workerIds = ['w1', 'w2'];

      mc = createMasterCoordinator({ events, sharedMemory, claudePool, coordinator });
      mc.register('master-1');

      const heartbeat = sharedMemory.set.mock.calls[0][1];
      expect(heartbeat.claimedTasks).toBe(1);
      expect(heartbeat.workerCount).toBe(2);
    });
  });
});
