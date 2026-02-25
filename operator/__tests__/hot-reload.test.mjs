// ============================================================
// Configuration Hot-Reload Tests (Phase 52)
// ============================================================
// Tests for settings change propagation, coordinator reaction,
// rate limiter / cost aggregator reconfigure, and file watcher.
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { createSettings, DEFAULTS } from '../settings.mjs';
import { createRateLimiter } from '../coordination/rate-limiter.mjs';
import { createCostAggregator } from '../coordination/cost-aggregator.mjs';
import { createCoordinator } from '../coordination/coordinator.mjs';
import { createApp } from '../server.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_hot_reload');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── Helper: mock pool for coordinator tests ─────────────────

function mockPool(workers = []) {
  const sent = [];
  return {
    getStatus: () => workers.map(w => ({ id: w.id || w, status: w.status || 'running' })),
    sendTo: (id, msg) => { sent.push({ id, msg }); return true; },
    activeCount: () => workers.filter(w => (w.status || 'running') === 'running').length,
    getSent: () => sent,
    clearSent: () => { sent.length = 0; },
  };
}

// ============================================================
// 1. Settings Change Detection & Events
// ============================================================

describe('Settings change detection', () => {
  it('1. save() emits settings:changed event with old/new diff', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load(); // populate _previousSettings

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    s.save({ ...DEFAULTS, model: 'opus' });

    expect(received.length).toBe(1);
    expect(received[0].changes.model).toEqual({ from: 'sonnet', to: 'opus' });
  });

  it('2. save() only emits when values actually changed (no-op save = no event)', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load(); // populate _previousSettings

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    // Save exact same defaults
    s.save({ ...DEFAULTS });

    expect(received.length).toBe(0);
  });

  it('3. save() includes correct changes object shape (from/to per field)', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load();

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    s.save({ ...DEFAULTS, maxTurns: 100, maxBudgetUsd: 20 });

    expect(received.length).toBe(1);
    const { changes } = received[0];
    expect(changes.maxTurns).toEqual({ from: 30, to: 100 });
    expect(changes.maxBudgetUsd).toEqual({ from: 5.0, to: 20 });
    // Fields that didn't change should NOT be present
    expect(changes.model).toBeUndefined();
  });

  it('7. onChange() callback fires on save', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load();

    const calls = [];
    s.onChange((data) => calls.push(data));

    s.save({ ...DEFAULTS, autoPush: true });

    expect(calls.length).toBe(1);
    expect(calls[0].changes.autoPush).toEqual({ from: false, to: true });
  });

  it('8. get(key) returns single setting value', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load();

    expect(s.get('model')).toBe('sonnet');
    expect(s.get('maxTurns')).toBe(30);
    expect(s.get('autoPush')).toBe(false);
  });

  it('9. get(key) returns undefined for unknown key', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load();

    expect(s.get('nonExistentKey')).toBeUndefined();
  });

  it('19. Multiple rapid saves only emit for actual changes', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load();

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    // First save changes model
    s.save({ ...DEFAULTS, model: 'opus' });
    // Second save: same model (opus), no change
    s.save({ ...DEFAULTS, model: 'opus' });
    // Third save: change model back to haiku
    s.save({ ...DEFAULTS, model: 'haiku' });

    expect(received.length).toBe(2); // Only 2 actual changes
    expect(received[0].changes.model.to).toBe('opus');
    expect(received[1].changes.model.to).toBe('haiku');
  });

  it('20. EventBus not provided: save works without emitting (backward compat)', () => {
    const s = createSettings({ operatorDir: TEST_DIR }); // No events
    s.load();

    // Should not throw
    const result = s.save({ ...DEFAULTS, model: 'opus' });
    expect(result.model).toBe('opus');
  });

  it('21. settings:changed event includes full new settings object', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load();

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    s.save({ ...DEFAULTS, model: 'opus' });

    expect(received[0].settings).toEqual({ ...DEFAULTS, model: 'opus' });
  });

  it('25. Change detection only includes fields that actually differ', () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.load();

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    // Change only one field
    s.save({ ...DEFAULTS, coordGlobalBudgetUsd: 100 });

    expect(received.length).toBe(1);
    const changeKeys = Object.keys(received[0].changes);
    expect(changeKeys).toEqual(['coordGlobalBudgetUsd']);
    expect(received[0].changes.coordGlobalBudgetUsd).toEqual({ from: 50, to: 100 });
  });
});

// ============================================================
// 2. File Watcher
// ============================================================

describe('Settings file watcher', () => {
  it('4. watch() detects file modification and emits settings:changed', async () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });

    // Initial save to create file + populate _previousSettings
    s.save({ ...DEFAULTS });
    s.load(); // ensure _previousSettings set

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    // Start watching with a short interval
    s.watch(50);

    // Wait a bit so initial mtime is captured
    await new Promise(r => setTimeout(r, 100));

    // Externally modify the file
    writeFileSync(
      join(TEST_DIR, 'settings.json'),
      JSON.stringify({ ...DEFAULTS, model: 'opus' }, null, 2)
    );

    // Wait for watcher to detect
    await new Promise(r => setTimeout(r, 200));

    s.stopWatch();

    // Should have detected the change
    expect(received.length).toBeGreaterThanOrEqual(1);
    const lastChange = received[received.length - 1];
    expect(lastChange.changes.model).toEqual({ from: 'sonnet', to: 'opus' });
  });

  it('5. watch() does not emit when file unchanged', async () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.save({ ...DEFAULTS });
    s.load();

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    s.watch(50);

    // Wait several poll cycles without modifying
    await new Promise(r => setTimeout(r, 250));

    s.stopWatch();

    expect(received.length).toBe(0);
  });

  it('6. stopWatch() stops polling', async () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.save({ ...DEFAULTS });
    s.load();

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    s.watch(50);
    s.stopWatch(); // Stop immediately

    // Now modify the file
    await new Promise(r => setTimeout(r, 50));
    writeFileSync(
      join(TEST_DIR, 'settings.json'),
      JSON.stringify({ ...DEFAULTS, model: 'opus' }, null, 2)
    );

    await new Promise(r => setTimeout(r, 200));

    // Should NOT have detected change since watcher was stopped
    expect(received.length).toBe(0);
  });

  it('18. Settings saved externally (file edit) detected by watcher', async () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.save({ ...DEFAULTS });
    s.load();

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    s.watch(50);
    await new Promise(r => setTimeout(r, 100));

    // External edit: change multiple fields
    writeFileSync(
      join(TEST_DIR, 'settings.json'),
      JSON.stringify({ ...DEFAULTS, maxTurns: 100, autoPush: true }, null, 2)
    );

    await new Promise(r => setTimeout(r, 200));
    s.stopWatch();

    expect(received.length).toBeGreaterThanOrEqual(1);
    const lastChange = received[received.length - 1];
    expect(lastChange.changes.maxTurns).toBeDefined();
    expect(lastChange.changes.autoPush).toBeDefined();
  });

  it('23. Watcher interval is configurable (for testing)', async () => {
    const events = new EventBus();
    const s = createSettings({ operatorDir: TEST_DIR, events });
    s.save({ ...DEFAULTS });
    s.load();

    const received = [];
    events.on('settings:changed', (data) => received.push(data));

    // Use a very short interval
    s.watch(30);
    await new Promise(r => setTimeout(r, 80));

    writeFileSync(
      join(TEST_DIR, 'settings.json'),
      JSON.stringify({ ...DEFAULTS, model: 'haiku' }, null, 2)
    );

    await new Promise(r => setTimeout(r, 100));
    s.stopWatch();

    expect(received.length).toBeGreaterThanOrEqual(1);
  });

  it('24. Watcher handles missing settings file gracefully', async () => {
    const events = new EventBus();
    // Create settings pointing to a directory with no settings file
    const emptyDir = join(TEST_DIR, 'empty');
    mkdirSync(emptyDir, { recursive: true });
    const s = createSettings({ operatorDir: emptyDir, events });
    s.load(); // defaults

    // Should not throw
    s.watch(50);
    await new Promise(r => setTimeout(r, 150));
    s.stopWatch();
    // No crash = pass
  });
});

// ============================================================
// 3. Rate Limiter Reconfigure
// ============================================================

describe('Rate limiter reconfigure', () => {
  it('14. reconfigure() updates maxRequestsPerMinute', () => {
    const limiter = createRateLimiter({ maxRequestsPerMinute: 60 });

    limiter.reconfigure({ maxRequestsPerMinute: 120 });

    const status = limiter.getStatus();
    expect(status.maxRequestsPerMinute).toBe(120);
  });

  it('15. reconfigure() updates maxTokensPerMinute', () => {
    const limiter = createRateLimiter({ maxTokensPerMinute: 100000 });

    limiter.reconfigure({ maxTokensPerMinute: 500000 });

    const status = limiter.getStatus();
    expect(status.maxTokensPerMinute).toBe(500000);
  });
});

// ============================================================
// 4. Cost Aggregator Reconfigure
// ============================================================

describe('Cost aggregator reconfigure', () => {
  it('16. reconfigure() updates globalBudgetUsd', () => {
    const agg = createCostAggregator({ globalBudgetUsd: 50 });

    agg.reconfigure({ globalBudgetUsd: 200 });

    const status = agg.getStatus();
    expect(status.globalBudgetUsd).toBe(200);
  });

  it('17. reconfigure() updates perWorkerBudgetUsd', () => {
    const agg = createCostAggregator({ perWorkerBudgetUsd: 10 });

    agg.reconfigure({ perWorkerBudgetUsd: 30 });

    const status = agg.getStatus();
    expect(status.perWorkerBudgetUsd).toBe(30);
  });
});

// ============================================================
// 5. Coordinator Settings Reaction
// ============================================================

describe('Coordinator settings:changed reaction', () => {
  let events, pool, coordinator;

  beforeEach(() => {
    events = new EventBus();
    pool = mockPool([{ id: 'w1', status: 'running' }]);
    coordinator = createCoordinator({
      events,
      pool,
      options: {
        maxRequestsPerMinute: 60,
        maxTokensPerMinute: 100000,
        globalBudgetUsd: 50,
        perWorkerBudgetUsd: 10,
        rateLimiterTickMs: 0,
        autoScaleCheckMs: 0,
        enableAdaptiveRate: false,
      },
      log: () => {},
    });
    coordinator.start();
  });

  afterEach(() => {
    if (coordinator.getState() !== 'stopped') coordinator.stop();
  });

  it('10. Coordinator reacts to settings:changed: rate limiter reconfigured', () => {
    events.emit('settings:changed', {
      changes: {
        coordMaxRequestsPerMinute: { from: 60, to: 120 },
      },
      settings: { ...DEFAULTS, coordMaxRequestsPerMinute: 120 },
    });

    const status = coordinator.rateLimiter.getStatus();
    expect(status.maxRequestsPerMinute).toBe(120);
  });

  it('11. Coordinator reacts to settings:changed: cost aggregator reconfigured', () => {
    events.emit('settings:changed', {
      changes: {
        coordGlobalBudgetUsd: { from: 50, to: 200 },
      },
      settings: { ...DEFAULTS, coordGlobalBudgetUsd: 200 },
    });

    const status = coordinator.costAggregator.getStatus();
    expect(status.globalBudgetUsd).toBe(200);
  });

  it('12. Coordinator emits coordinator:reconfigured after reconfigure', () => {
    const received = [];
    events.on('coordinator:reconfigured', (data) => received.push(data));

    events.emit('settings:changed', {
      changes: {
        coordMaxTokensPerMinute: { from: 100000, to: 500000 },
      },
      settings: { ...DEFAULTS, coordMaxTokensPerMinute: 500000 },
    });

    expect(received.length).toBe(1);
    expect(received[0].changes.coordMaxTokensPerMinute).toBe(500000);
  });

  it('13. Coordinator ignores changes to non-coordinator settings', () => {
    const received = [];
    events.on('coordinator:reconfigured', (data) => received.push(data));

    events.emit('settings:changed', {
      changes: {
        model: { from: 'sonnet', to: 'opus' },
        autoPush: { from: false, to: true },
      },
      settings: { ...DEFAULTS, model: 'opus', autoPush: true },
    });

    // Should NOT emit coordinator:reconfigured
    expect(received.length).toBe(0);
  });
});

// ============================================================
// 6. Integration: PUT /api/settings triggers change event
// ============================================================

describe('PUT /api/settings triggers change event', () => {
  let ctx, baseUrl;

  beforeEach(async () => {
    const operatorDir = join(TEST_DIR, 'int');
    mkdirSync(operatorDir, { recursive: true });
    ctx = createApp({
      operatorDir,
      auth: false,
      enableFileWatcher: false,
      sharedMemory: false,
      messageBus: false,
      auditLog: false,
      webhooks: false,
      notifications: false,
      secrets: false,
      terminalSessions: false,
      migrations: false,
    });
    await new Promise((resolve) => {
      ctx.server.listen(0, '127.0.0.1', () => {
        const port = ctx.server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (ctx) await ctx.close();
  });

  it('22. Route: PUT /api/settings triggers change event', async () => {
    // First GET to populate _previousSettings
    await fetch(`${baseUrl}/api/settings`);

    const received = [];
    ctx.events.on('settings:changed', (data) => received.push(data));

    // PUT new settings
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...DEFAULTS, model: 'opus' }),
    });

    expect(res.status).toBe(200);
    expect(received.length).toBe(1);
    expect(received[0].changes.model).toEqual({ from: 'sonnet', to: 'opus' });
  });
});
