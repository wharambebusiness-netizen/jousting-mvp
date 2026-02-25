// Preferences Persistence Tests (Phase 39)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import { createPreferences, DEFAULTS, VALID_LAYOUTS, VALID_TERMINAL_THEMES, VALID_TASKBOARD_VIEWS } from '../preferences.mjs';
import { createPreferencesRoutes } from '../routes/preferences.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_preferences');
const PERSIST_PATH = join(TEST_DIR, '.data', 'preferences.json');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── Exports ─────────────────────────────────────────────────

describe('exports', () => {
  it('exports DEFAULTS with all expected keys', () => {
    expect(DEFAULTS).toEqual({
      layout: 'grid',
      terminalTheme: 'nebula',
      autoRefreshInterval: 5000,
      sidebarCollapsed: false,
      notificationsEnabled: true,
      pageSize: 50,
      taskboardView: 'kanban',
    });
  });

  it('exports VALID_LAYOUTS', () => {
    expect(VALID_LAYOUTS).toEqual(['grid', 'tabs']);
  });

  it('exports VALID_TERMINAL_THEMES', () => {
    expect(VALID_TERMINAL_THEMES).toEqual(['nebula', 'aurora', 'solar', 'mars', 'pulsar', 'quasar', 'comet', 'stellar']);
  });

  it('exports VALID_TASKBOARD_VIEWS', () => {
    expect(VALID_TASKBOARD_VIEWS).toEqual(['kanban', 'list', 'dag']);
  });
});

// ── Factory ─────────────────────────────────────────────────

describe('createPreferences', () => {
  it('returns object with get, set, reset, getAll functions', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    expect(typeof prefs.get).toBe('function');
    expect(typeof prefs.set).toBe('function');
    expect(typeof prefs.reset).toBe('function');
    expect(typeof prefs.getAll).toBe('function');
  });
});

// ── get() ───────────────────────────────────────────────────

describe('get', () => {
  it('returns defaults when no stored prefs', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const result = prefs.get('user1');
    expect(result).toEqual(DEFAULTS);
  });

  it('returns merged defaults + stored prefs', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs' });
    const result = prefs.get('user1');
    expect(result.layout).toBe('tabs');
    expect(result.terminalTheme).toBe('nebula'); // default
    expect(result.pageSize).toBe(50); // default
  });

  it('returns fresh object each call (no shared references)', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const a = prefs.get('user1');
    const b = prefs.get('user1');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('uses custom defaults when provided', () => {
    const prefs = createPreferences({
      persistPath: PERSIST_PATH,
      defaults: { layout: 'tabs', pageSize: 25 },
    });
    const result = prefs.get('user1');
    expect(result.layout).toBe('tabs');
    expect(result.pageSize).toBe(25);
    expect(result.terminalTheme).toBe('nebula'); // from DEFAULTS
  });
});

// ── set() ───────────────────────────────────────────────────

describe('set', () => {
  it('stores partial prefs, merges with defaults on get', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const result = prefs.set('user1', { layout: 'tabs', pageSize: 25 });
    expect(result.layout).toBe('tabs');
    expect(result.pageSize).toBe(25);
    expect(result.terminalTheme).toBe('nebula'); // default
  });

  it('persists to disk', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs' });

    // Read raw file
    const raw = readFileSync(PERSIST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.user1).toBeDefined();
    expect(data.user1.layout).toBe('tabs');
  });

  it('validates layout enum (grid|tabs)', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'invalid' });
    const result = prefs.get('user1');
    expect(result.layout).toBe('grid'); // default, invalid was rejected
  });

  it('accepts all valid layouts', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    for (const layout of VALID_LAYOUTS) {
      prefs.set('user1', { layout });
      expect(prefs.get('user1').layout).toBe(layout);
    }
  });

  it('validates terminalTheme enum', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { terminalTheme: 'invalid' });
    expect(prefs.get('user1').terminalTheme).toBe('nebula'); // default
  });

  it('accepts all valid terminal themes', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    for (const theme of VALID_TERMINAL_THEMES) {
      prefs.set('user1', { terminalTheme: theme });
      expect(prefs.get('user1').terminalTheme).toBe(theme);
    }
  });

  it('validates taskboardView enum', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { taskboardView: 'bad' });
    expect(prefs.get('user1').taskboardView).toBe('kanban'); // default
  });

  it('accepts all valid taskboard views', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    for (const view of VALID_TASKBOARD_VIEWS) {
      prefs.set('user1', { taskboardView: view });
      expect(prefs.get('user1').taskboardView).toBe(view);
    }
  });

  it('validates autoRefreshInterval (number, min 1000)', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });

    // Too low
    prefs.set('user1', { autoRefreshInterval: 500 });
    expect(prefs.get('user1').autoRefreshInterval).toBe(5000); // default

    // Valid
    prefs.set('user1', { autoRefreshInterval: 2000 });
    expect(prefs.get('user1').autoRefreshInterval).toBe(2000);

    // Non-numeric
    prefs.set('user2', { autoRefreshInterval: 'abc' });
    expect(prefs.get('user2').autoRefreshInterval).toBe(5000); // default
  });

  it('validates pageSize (number, 10-100)', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });

    // Too low
    prefs.set('user1', { pageSize: 5 });
    expect(prefs.get('user1').pageSize).toBe(50); // default

    // Too high
    prefs.set('user1', { pageSize: 200 });
    expect(prefs.get('user1').pageSize).toBe(50); // still default (200 rejected, 5 was rejected earlier)

    // Valid
    prefs.set('user1', { pageSize: 25 });
    expect(prefs.get('user1').pageSize).toBe(25);

    // Boundary: exactly 10
    prefs.set('user1', { pageSize: 10 });
    expect(prefs.get('user1').pageSize).toBe(10);

    // Boundary: exactly 100
    prefs.set('user1', { pageSize: 100 });
    expect(prefs.get('user1').pageSize).toBe(100);
  });

  it('ignores unknown fields', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs', unknownField: 'hello', anotherOne: 42 });
    const result = prefs.get('user1');
    expect(result.layout).toBe('tabs');
    expect(result).not.toHaveProperty('unknownField');
    expect(result).not.toHaveProperty('anotherOne');
  });

  it('coerces boolean fields', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { sidebarCollapsed: 1, notificationsEnabled: 0 });
    const result = prefs.get('user1');
    expect(result.sidebarCollapsed).toBe(true);
    expect(result.notificationsEnabled).toBe(false);
  });

  it('merges successive set calls', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs' });
    prefs.set('user1', { pageSize: 25 });
    const result = prefs.get('user1');
    expect(result.layout).toBe('tabs');
    expect(result.pageSize).toBe(25);
  });
});

// ── reset() ─────────────────────────────────────────────────

describe('reset', () => {
  it('removes stored prefs, returns defaults', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs', pageSize: 25 });
    const result = prefs.reset('user1');
    expect(result).toEqual(DEFAULTS);
  });

  it('get returns defaults after reset', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs' });
    prefs.reset('user1');
    expect(prefs.get('user1')).toEqual(DEFAULTS);
  });

  it('does not affect other users', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs' });
    prefs.set('user2', { pageSize: 25 });
    prefs.reset('user1');
    expect(prefs.get('user1').layout).toBe('grid'); // default
    expect(prefs.get('user2').pageSize).toBe(25); // untouched
  });
});

// ── getAll() ────────────────────────────────────────────────

describe('getAll', () => {
  it('returns all users prefs', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs' });
    prefs.set('user2', { pageSize: 25 });
    const all = prefs.getAll();
    expect(all.user1).toBeDefined();
    expect(all.user1.layout).toBe('tabs');
    expect(all.user2).toBeDefined();
    expect(all.user2.pageSize).toBe(25);
  });

  it('returns empty object when no users have prefs', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    expect(prefs.getAll()).toEqual({});
  });

  it('returns copy (not internal reference)', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('user1', { layout: 'tabs' });
    const a = prefs.getAll();
    const b = prefs.getAll();
    expect(a).not.toBe(b);
  });
});

// ── Persistence ─────────────────────────────────────────────

describe('persistence', () => {
  it('save/load round-trip', () => {
    const prefs1 = createPreferences({ persistPath: PERSIST_PATH });
    prefs1.set('user1', { layout: 'tabs', pageSize: 30 });
    prefs1.set('user2', { terminalTheme: 'aurora' });

    // Create new instance from same path
    const prefs2 = createPreferences({ persistPath: PERSIST_PATH });
    expect(prefs2.get('user1').layout).toBe('tabs');
    expect(prefs2.get('user1').pageSize).toBe(30);
    expect(prefs2.get('user2').terminalTheme).toBe('aurora');
  });

  it('handles missing persist file gracefully', () => {
    const prefs = createPreferences({ persistPath: join(TEST_DIR, 'nonexistent', 'prefs.json') });
    expect(prefs.get('user1')).toEqual(DEFAULTS);
  });

  it('handles corrupt persist file gracefully', () => {
    writeFileSync(PERSIST_PATH, 'NOT VALID JSON!!!');
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    expect(prefs.get('user1')).toEqual(DEFAULTS);
  });

  it('creates directory if needed on save', () => {
    const deepPath = join(TEST_DIR, 'deep', 'nested', 'prefs.json');
    const prefs = createPreferences({ persistPath: deepPath });
    prefs.set('user1', { layout: 'tabs' });
    expect(existsSync(deepPath)).toBe(true);
  });
});

// ── Multiple Users ──────────────────────────────────────────

describe('multiple users', () => {
  it('maintains separate pref stores per user', () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    prefs.set('alice', { layout: 'tabs', pageSize: 20 });
    prefs.set('bob', { layout: 'grid', terminalTheme: 'aurora' });

    const alice = prefs.get('alice');
    const bob = prefs.get('bob');

    expect(alice.layout).toBe('tabs');
    expect(alice.pageSize).toBe(20);
    expect(alice.terminalTheme).toBe('nebula'); // default

    expect(bob.layout).toBe('grid');
    expect(bob.terminalTheme).toBe('aurora');
    expect(bob.pageSize).toBe(50); // default
  });
});

// ── Routes ──────────────────────────────────────────────────

describe('routes', () => {
  function createTestApp(prefs) {
    const app = express();
    app.use(express.json());
    app.use('/api', createPreferencesRoutes({ preferences: prefs }));
    return app;
  }

  async function request(app, method, path, body) {
    // Use supertest-like approach with raw http
    return new Promise((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const url = `http://127.0.0.1:${port}${path}`;
        const options = {
          method: method.toUpperCase(),
          headers: { 'Content-Type': 'application/json' },
        };
        if (body) options.body = JSON.stringify(body);

        fetch(url, options)
          .then(async (res) => {
            const json = await res.json();
            server.close();
            resolve({ status: res.status, body: json });
          })
          .catch((err) => {
            server.close();
            reject(err);
          });
      });
    });
  }

  it('GET returns defaults for new user', async () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const app = createTestApp(prefs);
    const res = await request(app, 'GET', '/api/preferences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULTS);
  });

  it('PATCH updates specific fields', async () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const app = createTestApp(prefs);
    const res = await request(app, 'PATCH', '/api/preferences', { layout: 'tabs', pageSize: 25 });
    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('tabs');
    expect(res.body.pageSize).toBe(25);
    expect(res.body.terminalTheme).toBe('nebula'); // default
  });

  it('GET returns updated prefs after PATCH', async () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const app = createTestApp(prefs);
    await request(app, 'PATCH', '/api/preferences', { layout: 'tabs' });
    const res = await request(app, 'GET', '/api/preferences');
    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('tabs');
  });

  it('DELETE resets to defaults', async () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const app = createTestApp(prefs);
    await request(app, 'PATCH', '/api/preferences', { layout: 'tabs' });
    const res = await request(app, 'DELETE', '/api/preferences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULTS);
  });

  it('PUT replaces all prefs (reset + set)', async () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const app = createTestApp(prefs);

    // First set some prefs
    await request(app, 'PATCH', '/api/preferences', { layout: 'tabs', pageSize: 25 });

    // PUT replaces all — only layout set, pageSize resets to default
    const res = await request(app, 'PUT', '/api/preferences', { layout: 'tabs' });
    expect(res.status).toBe(200);
    expect(res.body.layout).toBe('tabs');
    expect(res.body.pageSize).toBe(50); // default, not 25
  });

  it('user ID fallback to default when no auth', async () => {
    const prefs = createPreferences({ persistPath: PERSIST_PATH });
    const app = createTestApp(prefs);
    await request(app, 'PATCH', '/api/preferences', { layout: 'tabs' });
    // Verify stored under 'default' key
    const all = prefs.getAll();
    expect(all['default']).toBeDefined();
    expect(all['default'].layout).toBe('tabs');
  });

  it('returns 503 when preferences is null', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createPreferencesRoutes({ preferences: null }));

    const res = await request(app, 'GET', '/api/preferences');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('not available');
  });
});
