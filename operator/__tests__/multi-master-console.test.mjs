// ============================================================
// Multi-Master Console Tests (Phase 66 + Phase 68)
// ============================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createApp } from '../server.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_mmconsole');
let appInstance, baseUrl, events;

async function api(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
}

function createMockPool(overrides = {}) {
  return {
    getMasterTerminals: vi.fn(() => []),
    getStatus: vi.fn(() => []),
    getPoolStatus: vi.fn(() => ({ total: 0, running: 0, stopped: 0 })),
    getMasterTerminal: vi.fn(() => null),
    getMasterRegistry: vi.fn(() => []),
    getTerminal: vi.fn(() => null),
    activeCount: vi.fn(() => 0),
    getSwarmState: vi.fn(() => ({ enabled: false })),
    findNextClaimableTask: vi.fn(() => null),
    shutdownAll: vi.fn().mockResolvedValue(),
    destroy: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('Multi-Master Console (Phase 66 + Phase 68)', () => {
  describe('Console page HTML', () => {
    let localApp, localUrl;

    beforeAll(async () => {
      const dir = join(TEST_DIR, 'html');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      mkdirSync(dir, { recursive: true });

      const ev = new EventBus();
      localApp = createApp({ operatorDir: dir, events: ev, auth: false });
      await new Promise(resolve => {
        localApp.server.listen(0, '127.0.0.1', () => {
          localUrl = `http://127.0.0.1:${localApp.server.address().port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (localApp) await localApp.close();
      const dir = join(TEST_DIR, 'html');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    });

    it('should serve console page at /console', async () => {
      const res = await fetch(`${localUrl}/console`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Master Console');
    });

    it('should contain master strip (replacing tabs bar)', async () => {
      const res = await fetch(`${localUrl}/console`);
      const html = await res.text();
      expect(html).toContain('master-strip');
      expect(html).toContain('master-strip-cells');
    });

    it('should contain master-panels container', async () => {
      const res = await fetch(`${localUrl}/console`);
      const html = await res.text();
      expect(html).toContain('master-panels');
    });

    it('should contain alert banner', async () => {
      const res = await fetch(`${localUrl}/console`);
      const html = await res.text();
      expect(html).toContain('alert-banner');
      expect(html).toContain('alert-list');
    });

    it('should contain observer status indicator', async () => {
      const res = await fetch(`${localUrl}/console`);
      const html = await res.text();
      expect(html).toContain('observer-status');
      expect(html).toContain('Observer');
    });

    it('should contain multi-master status in status bar', async () => {
      const res = await fetch(`${localUrl}/console`);
      const html = await res.text();
      expect(html).toContain('status-masters');
      expect(html).toContain('0/4 masters');
    });

    it('should have + Master button in header', async () => {
      const res = await fetch(`${localUrl}/console`);
      const html = await res.text();
      expect(html).toContain('+ Master');
    });
  });

  describe('Console JS', () => {
    let localApp, localUrl;

    beforeAll(async () => {
      const dir = join(TEST_DIR, 'js');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      mkdirSync(dir, { recursive: true });

      const ev = new EventBus();
      localApp = createApp({ operatorDir: dir, events: ev, auth: false });
      await new Promise(resolve => {
        localApp.server.listen(0, '127.0.0.1', () => {
          localUrl = `http://127.0.0.1:${localApp.server.address().port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (localApp) await localApp.close();
      const dir = join(TEST_DIR, 'js');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    });

    it('should serve console.js with multi-master code', async () => {
      const res = await fetch(`${localUrl}/console.js`);
      expect(res.status).toBe(200);
      const js = await res.text();
      expect(js).toContain('Multi-Master State');
      expect(js).toContain('MASTER_COLORS');
      expect(js).toContain('MAX_MASTERS');
      expect(js).toContain('spawnMaster');
      expect(js).toContain('switchToMaster');
      expect(js).toContain('addMasterTab');
      expect(js).toContain('removeMasterTab');
    });

    it('should have master strip renderer', async () => {
      const res = await fetch(`${localUrl}/console.js`);
      const js = await res.text();
      expect(js).toContain('renderMasterStripCells');
      expect(js).toContain('refreshMasterStrip');
      expect(js).toContain('masterStripData');
    });

    it('should have worker grouping', async () => {
      const res = await fetch(`${localUrl}/console.js`);
      const js = await res.text();
      expect(js).toContain('renderWorkerGroups');
      expect(js).toContain('worker-group');
      expect(js).toContain('updateWorkerGroupHeader');
    });

    it('should have alert system', async () => {
      const res = await fetch(`${localUrl}/console.js`);
      const js = await res.text();
      expect(js).toContain('addAlert');
      expect(js).toContain('removeAlert');
      expect(js).toContain('renderAlertBanner');
      expect(js).toContain('checkAlerts');
    });

    it('should have master ownership badge rendering', async () => {
      const res = await fetch(`${localUrl}/console.js`);
      const js = await res.text();
      expect(js).toContain('renderWorkerMasterBadge');
      expect(js).toContain('worker-master-badge');
    });

    it('should have initMultiMaster for reconnecting on page load', async () => {
      const res = await fetch(`${localUrl}/console.js`);
      const js = await res.text();
      expect(js).toContain('initMultiMaster');
      expect(js).toContain('/api/claude-terminals/masters');
    });

    it('should subscribe to observer events via WS', async () => {
      const res = await fetch(`${localUrl}/console.js`);
      const js = await res.text();
      expect(js).toContain('observer:*');
      expect(js).toContain('observer:circuit-open');
      expect(js).toContain('observer:circuit-closed');
      expect(js).toContain('observer:budget-halt');
    });
  });

  describe('Master view fragments', () => {
    let localApp, localUrl;

    beforeAll(async () => {
      const dir = join(TEST_DIR, 'frags');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      mkdirSync(dir, { recursive: true });

      const mockPool = createMockPool({
        getMasterTerminals: vi.fn(() => [
          { id: 'master-1', status: 'running', role: 'master', assignedTask: null, config: {} },
        ]),
        getStatus: vi.fn(() => [
          { id: 'worker-1', status: 'running', role: null, config: { _masterId: 'master-1' }, assignedTask: null },
          { id: 'worker-2', status: 'running', role: null, config: {}, assignedTask: null },
        ]),
        activeCount: vi.fn(() => 3),
        getPoolStatus: vi.fn(() => ({ total: 3, running: 3, stopped: 0 })),
      });

      const ev = new EventBus();
      localApp = createApp({
        operatorDir: dir,
        events: ev,
        auth: false,
        claudePool: mockPool,
        coordination: false,
      });
      await new Promise(resolve => {
        localApp.server.listen(0, '127.0.0.1', () => {
          localUrl = `http://127.0.0.1:${localApp.server.address().port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (localApp) await localApp.close();
      const dir = join(TEST_DIR, 'frags');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    });

    it('GET /views/console/masters returns master info', async () => {
      const res = await fetch(`${localUrl}/views/console/masters`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('master-1');
      expect(html).toContain('M1');
      expect(html).toContain('running');
    });

    it('GET /views/console/workers returns worker cards with master badge', async () => {
      const res = await fetch(`${localUrl}/views/console/workers`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('worker-1');
      expect(html).toContain('worker-2');
      expect(html).toContain('M1'); // master badge for worker-1
      expect(html).toContain('worker-master-badge');
    });

    it('GET /views/console/workers does not show badge for unowned workers', async () => {
      const res = await fetch(`${localUrl}/views/console/workers`);
      const html = await res.text();
      // worker-2 has no _masterId, so should not get a badge
      // Count badge occurrences — should be exactly 1 (for worker-1)
      const matches = html.match(/worker-master-badge/g);
      expect(matches).toHaveLength(1);
    });

    it('GET /views/console/masters returns "No masters" when empty', async () => {
      // Create a fresh app with empty pool
      const dir2 = join(TEST_DIR, 'frags-empty');
      if (existsSync(dir2)) rmSync(dir2, { recursive: true });
      mkdirSync(dir2, { recursive: true });

      const emptyPool = createMockPool();
      const ev2 = new EventBus();
      const app2 = createApp({
        operatorDir: dir2,
        events: ev2,
        auth: false,
        claudePool: emptyPool,
        coordination: false,
      });
      await new Promise(resolve => {
        app2.server.listen(0, '127.0.0.1', () => resolve());
      });
      const url2 = `http://127.0.0.1:${app2.server.address().port}`;

      const res = await fetch(`${url2}/views/console/masters`);
      const html = await res.text();
      expect(html).toContain('No masters running');

      await app2.close();
      if (existsSync(dir2)) rmSync(dir2, { recursive: true });
    });
  });

  describe('Masters API endpoint', () => {
    let localApp, localUrl;

    beforeAll(async () => {
      const dir = join(TEST_DIR, 'api');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      mkdirSync(dir, { recursive: true });

      const mockPool = createMockPool({
        getMasterTerminals: vi.fn(() => [
          { id: 'master-1', status: 'running', role: 'master' },
          { id: 'master-2', status: 'running', role: 'master' },
        ]),
        getMasterTerminal: vi.fn((id) => {
          if (id === 'master') return { id: 'master-1' }; // backward compat
          return null;
        }),
        activeCount: vi.fn(() => 2),
        getPoolStatus: vi.fn(() => ({ total: 2, running: 2, stopped: 0 })),
      });

      const ev = new EventBus();
      localApp = createApp({
        operatorDir: dir,
        events: ev,
        auth: false,
        claudePool: mockPool,
        coordination: false,
      });
      await new Promise(resolve => {
        localApp.server.listen(0, '127.0.0.1', () => {
          localUrl = `http://127.0.0.1:${localApp.server.address().port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (localApp) await localApp.close();
      const dir = join(TEST_DIR, 'api');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    });

    it('GET /api/claude-terminals/masters returns master list with count', async () => {
      const res = await fetch(`${localUrl}/api/claude-terminals/masters`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.count).toBe(2);
      expect(data.masters).toHaveLength(2);
      expect(data.masters[0].id).toBe('master-1');
      expect(data.masters[1].id).toBe('master-2');
    });
  });

  describe('Master coordination status API (enriched fields)', () => {
    let localApp, localUrl;

    beforeAll(async () => {
      const dir = join(TEST_DIR, 'coord');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      mkdirSync(dir, { recursive: true });

      const ev = new EventBus();
      localApp = createApp({ operatorDir: dir, events: ev, auth: false });
      await new Promise(resolve => {
        localApp.server.listen(0, '127.0.0.1', () => {
          localUrl = `http://127.0.0.1:${localApp.server.address().port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (localApp) await localApp.close();
      const dir = join(TEST_DIR, 'coord');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    });

    it('returns empty status when master coordinator not available', async () => {
      const res = await fetch(`${localUrl}/api/master-coordination/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalMasters).toBe(0);
      expect(data.masters).toEqual([]);
    });

    it('enriched fields included in getMultiMasterStatus output', async () => {
      // Test the master-coordinator module directly
      const { createMasterCoordinator } = await import('../master-coordinator.mjs');
      const { createSharedMemory } = await import('../shared-memory.mjs');

      const ev = new EventBus();
      const sm = createSharedMemory({ events: ev });
      const mockPool = createMockPool({
        getMasterRegistry: vi.fn(() => [{
          id: 'master-1',
          claimedTaskIds: ['t1'],
          workerIds: ['w1', 'w2'],
          domain: 'testing',
        }]),
        setMasterDomain: vi.fn(),
      });

      const mc = createMasterCoordinator({ events: ev, sharedMemory: sm, claudePool: mockPool });

      // Write focus/claim/discovery keys BEFORE register so heartbeat picks them up
      sm.set('focus:master-1', 'fixing tests', 'test');
      sm.set('claim:master-1:src/foo.ts', true, 'test');
      sm.set('discovery:master-1:bugfix', 'Found the null pointer', 'test');

      mc.register('master-1', { domain: 'testing' });

      const status = mc.getMultiMasterStatus();
      expect(status.masters).toHaveLength(1);
      const m = status.masters[0];
      expect(m.currentFocus).toBe('fixing tests');
      expect(m.claimedFiles).toContain('src/foo.ts');
      expect(m.recentDiscoveries).toEqual(expect.arrayContaining([
        expect.objectContaining({ topic: 'bugfix' }),
      ]));

      mc.destroy();
    });
  });

  describe('Observer API', () => {
    let localApp, localUrl;

    beforeAll(async () => {
      const dir = join(TEST_DIR, 'observer');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      mkdirSync(dir, { recursive: true });

      const ev = new EventBus();
      localApp = createApp({ operatorDir: dir, events: ev, auth: false });
      await new Promise(resolve => {
        localApp.server.listen(0, '127.0.0.1', () => {
          localUrl = `http://127.0.0.1:${localApp.server.address().port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (localApp) await localApp.close();
      const dir = join(TEST_DIR, 'observer');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    });

    it('GET /api/observer/status returns running state', async () => {
      const res = await fetch(`${localUrl}/api/observer/status`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.running).toBe(true);
      expect(data).toHaveProperty('circuitOpen');
      expect(data).toHaveProperty('actionLog');
    });

    it('POST /api/observer/toggle stops and starts', async () => {
      // Stop
      const res1 = await fetch(`${localUrl}/api/observer/toggle`, { method: 'POST' });
      expect(res1.status).toBe(200);
      const d1 = await res1.json();
      expect(d1.running).toBe(false);

      // Start
      const res2 = await fetch(`${localUrl}/api/observer/toggle`, { method: 'POST' });
      expect(res2.status).toBe(200);
      const d2 = await res2.json();
      expect(d2.running).toBe(true);
    });
  });

  describe('CSS styles', () => {
    let localApp, localUrl;

    beforeAll(async () => {
      const dir = join(TEST_DIR, 'css');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
      mkdirSync(dir, { recursive: true });

      const ev = new EventBus();
      localApp = createApp({ operatorDir: dir, events: ev, auth: false });
      await new Promise(resolve => {
        localApp.server.listen(0, '127.0.0.1', () => {
          localUrl = `http://127.0.0.1:${localApp.server.address().port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      if (localApp) await localApp.close();
      const dir = join(TEST_DIR, 'css');
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    });

    it('style.css contains master strip styles (replacing tabs)', async () => {
      const res = await fetch(`${localUrl}/style.css`);
      expect(res.status).toBe(200);
      const css = await res.text();
      expect(css).toContain('.master-strip');
      expect(css).toContain('.master-strip__cells');
      expect(css).toContain('.master-cell');
      expect(css).toContain('.master-cell--active');
      expect(css).toContain('.master-cell--empty');
      expect(css).toContain('.master-cell__dot');
      expect(css).toContain('.master-cell__focus');
      expect(css).toContain('.master-cell__stats');
      // Legacy styles still present
      expect(css).toContain('.master-panels');
      expect(css).toContain('.master-panel');
      expect(css).toContain('.worker-master-badge');
    });

    it('style.css contains worker group styles', async () => {
      const res = await fetch(`${localUrl}/style.css`);
      const css = await res.text();
      expect(css).toContain('.worker-group');
      expect(css).toContain('.worker-group__header');
      expect(css).toContain('.worker-group__cards');
      expect(css).toContain('.worker-group__cards--collapsed');
    });

    it('style.css contains alert banner styles', async () => {
      const res = await fetch(`${localUrl}/style.css`);
      const css = await res.text();
      expect(css).toContain('.console-alerts');
      expect(css).toContain('.console-alert');
      expect(css).toContain('.console-alert--error');
      expect(css).toContain('.console-alert--warning');
    });

    it('style.css contains observer indicator styles', async () => {
      const res = await fetch(`${localUrl}/style.css`);
      const css = await res.text();
      expect(css).toContain('.console-statusbar__observer');
      expect(css).toContain('.observer--active');
    });
  });
});
