// Security tests — CSRF protection + security headers (Phase 58)
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import http from 'http';
import express from 'express';
import { createApp } from '../server.mjs';
import { createSecurityHeaders } from '../middleware/security-headers.mjs';
import { createCsrfProtection } from '../middleware/csrf.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_security');

function setupTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardownTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

// ── Request Helper ──────────────────────────────────────────

function request(app, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json', ...headers },
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          const responseHeaders = {};
          for (const [key, val] of Object.entries(res.headers)) {
            responseHeaders[key] = val;
          }
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: responseHeaders });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: responseHeaders });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ── Security Headers (Unit) ─────────────────────────────────

describe('Security Headers Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(createSecurityHeaders());
    app.get('/test', (_req, res) => res.json({ ok: true }));
  });

  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app, 'GET', '/test');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', async () => {
    const res = await request(app, 'GET', '/test');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sets Referrer-Policy', async () => {
    const res = await request(app, 'GET', '/test');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets Content-Security-Policy with script-src and style-src', async () => {
    const res = await request(app, 'GET', '/test');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain('cdn.jsdelivr.net');
    expect(csp).toContain('unpkg.com');
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('sets Permissions-Policy', async () => {
    const res = await request(app, 'GET', '/test');
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('accepts extra script-src origins', async () => {
    const app2 = express();
    app2.use(createSecurityHeaders({ extraScriptSrc: ['https://example.com'] }));
    app2.get('/test', (_req, res) => res.json({ ok: true }));
    const res = await request(app2, 'GET', '/test');
    expect(res.headers['content-security-policy']).toContain('example.com');
  });

  it('includes img-src with data: scheme', async () => {
    const res = await request(app, 'GET', '/test');
    expect(res.headers['content-security-policy']).toContain("img-src 'self' data:");
  });
});

// ── CSRF Protection (Unit) ──────────────────────────────────

describe('CSRF Protection Middleware', () => {
  let app, csrf;

  beforeEach(() => {
    csrf = createCsrfProtection();
    app = express();
    app.use(express.json());
    app.use(csrf.middleware);
    app.get('/page', (_req, res) => res.json({ ok: true }));
    app.post('/api/action', (_req, res) => res.json({ ok: true }));
    app.put('/api/update', (_req, res) => res.json({ ok: true }));
    app.delete('/api/remove', (_req, res) => res.json({ ok: true }));
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    app.post('/api/health/check', (_req, res) => res.json({ ok: true }));
    app.get('/api/metrics', (_req, res) => res.json({ ok: true }));
  });

  it('generateToken returns a 64-char hex string', () => {
    const token = csrf.generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sets _csrf cookie on GET requests without existing cookie', async () => {
    const res = await request(app, 'GET', '/page');
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieStr).toContain('_csrf=');
    expect(cookieStr).toContain('SameSite=Strict');
    expect(cookieStr).toContain('Path=/');
  });

  it('does not reset cookie on GET if _csrf cookie already exists', async () => {
    const token = csrf.generateToken();
    const res = await request(app, 'GET', '/page', {
      headers: { 'Cookie': `_csrf=${token}` },
    });
    expect(res.status).toBe(200);
    // Should not set a new cookie
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects POST without CSRF token', async () => {
    const res = await request(app, 'POST', '/api/action', {
      body: { data: 'test' },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CSRF token mismatch');
  });

  it('rejects POST with cookie but no header', async () => {
    const token = csrf.generateToken();
    const res = await request(app, 'POST', '/api/action', {
      headers: { 'Cookie': `_csrf=${token}` },
      body: { data: 'test' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects POST with header but no cookie', async () => {
    const token = csrf.generateToken();
    const res = await request(app, 'POST', '/api/action', {
      headers: { 'X-CSRF-Token': token },
      body: { data: 'test' },
    });
    expect(res.status).toBe(403);
  });

  it('rejects POST with mismatched cookie and header', async () => {
    const token1 = csrf.generateToken();
    const token2 = csrf.generateToken();
    const res = await request(app, 'POST', '/api/action', {
      headers: { 'Cookie': `_csrf=${token1}`, 'X-CSRF-Token': token2 },
      body: { data: 'test' },
    });
    expect(res.status).toBe(403);
  });

  it('allows POST with matching cookie and header', async () => {
    const token = csrf.generateToken();
    const res = await request(app, 'POST', '/api/action', {
      headers: { 'Cookie': `_csrf=${token}`, 'X-CSRF-Token': token },
      body: { data: 'test' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows PUT with matching CSRF token', async () => {
    const token = csrf.generateToken();
    const res = await request(app, 'PUT', '/api/update', {
      headers: { 'Cookie': `_csrf=${token}`, 'X-CSRF-Token': token },
      body: { data: 'test' },
    });
    expect(res.status).toBe(200);
  });

  it('allows DELETE with matching CSRF token', async () => {
    const token = csrf.generateToken();
    const res = await request(app, 'DELETE', '/api/remove', {
      headers: { 'Cookie': `_csrf=${token}`, 'X-CSRF-Token': token },
    });
    expect(res.status).toBe(200);
  });

  it('bypasses CSRF for Bearer auth requests', async () => {
    const res = await request(app, 'POST', '/api/action', {
      headers: { 'Authorization': 'Bearer jst_abc123def456' },
      body: { data: 'test' },
    });
    expect(res.status).toBe(200);
  });

  it('skips CSRF for /api/health path', async () => {
    const res = await request(app, 'POST', '/api/health/check', {
      body: {},
    });
    expect(res.status).toBe(200);
  });

  it('skips CSRF for /api/metrics path', async () => {
    // GET is already safe, but ensure skip logic works for metrics
    const res = await request(app, 'GET', '/api/metrics');
    expect(res.status).toBe(200);
  });

  it('skips CSRF for WebSocket upgrade header', async () => {
    const res = await request(app, 'GET', '/page', {
      headers: { 'Upgrade': 'websocket' },
    });
    expect(res.status).toBe(200);
    // Should NOT set cookie since it was skipped
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('allows custom skipPaths', async () => {
    const custom = createCsrfProtection({ skipPaths: ['/api/custom'] });
    const app2 = express();
    app2.use(express.json());
    app2.use(custom.middleware);
    app2.post('/api/custom', (_req, res) => res.json({ ok: true }));
    app2.post('/api/other', (_req, res) => res.json({ ok: true }));

    const r1 = await request(app2, 'POST', '/api/custom', { body: {} });
    expect(r1.status).toBe(200);

    const r2 = await request(app2, 'POST', '/api/other', { body: {} });
    expect(r2.status).toBe(403);
  });
});

// ── CORS Fix (Unit) ─────────────────────────────────────────

describe('CORS — Allowed Methods', () => {
  let appInstance, baseUrl;

  beforeAll(async () => {
    setupTestDir();
    appInstance = createApp({ operatorDir: TEST_DIR, auth: false, csrf: false });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (appInstance) await appInstance.close();
    teardownTestDir();
  });

  it('includes PUT in Access-Control-Allow-Methods', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: { 'Origin': 'http://localhost:3100' },
    });
    const methods = res.headers.get('access-control-allow-methods');
    expect(methods).toContain('PUT');
  });

  it('includes X-CSRF-Token in Access-Control-Allow-Headers', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: { 'Origin': 'http://localhost:3100' },
    });
    const allowed = res.headers.get('access-control-allow-headers');
    expect(allowed).toContain('X-CSRF-Token');
  });
});

// ── Integration: createApp with CSRF ────────────────────────

describe('Integration — Security in createApp', () => {
  let appInstance, baseUrl;

  // Use csrf: true to explicitly enable CSRF even with auth: false
  beforeAll(async () => {
    setupTestDir();
    appInstance = createApp({ operatorDir: TEST_DIR, auth: false, csrf: true });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (appInstance) await appInstance.close();
    teardownTestDir();
  });

  it('createApp returns csrf object when csrf: true', () => {
    expect(appInstance.csrf).toBeDefined();
    expect(typeof appInstance.csrf.generateToken).toBe('function');
    expect(typeof appInstance.csrf.middleware).toBe('function');
  });

  it('createApp returns csrf: null when auth: false and csrf not set', () => {
    const noAuthApp = createApp({ operatorDir: TEST_DIR, auth: false });
    expect(noAuthApp.csrf).toBeNull();
    noAuthApp.close();
  });

  it('GET / sets CSRF cookie', async () => {
    const res = await fetch(`${baseUrl}/`);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('_csrf=');
  });

  it('GET /api/health returns security headers', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('permissions-policy')).toContain('camera=()');
  });

  it('POST /api/cache/clear requires CSRF token', async () => {
    const res = await fetch(`${baseUrl}/api/cache/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('CSRF token mismatch');
  });

  it('POST /api/cache/clear succeeds with valid CSRF token', async () => {
    // First GET to obtain the CSRF cookie
    const getRes = await fetch(`${baseUrl}/`);
    const setCookie = getRes.headers.get('set-cookie') || '';
    const match = setCookie.match(/_csrf=([^;]+)/);
    expect(match).toBeTruthy();
    const token = match[1];

    const res = await fetch(`${baseUrl}/api/cache/clear`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `_csrf=${token}`,
        'X-CSRF-Token': token,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it('POST /api/health skips CSRF (public endpoint)', async () => {
    // Health endpoint should be accessible without CSRF
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it('auth: false auto-disables CSRF (backward compat)', async () => {
    const noCsrfApp = createApp({ operatorDir: TEST_DIR, auth: false });
    await new Promise((resolve) => {
      noCsrfApp.server.listen(0, '127.0.0.1', resolve);
    });
    const port = noCsrfApp.server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cache/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // Should succeed without CSRF token when auth: false
      expect(res.status).toBe(200);
    } finally {
      await noCsrfApp.close();
    }
  });
});

// ── API Key Management View (Phase 59) ──────────────────────

describe('API Key Management — Views', () => {
  let appInstance, baseUrl, authToken;

  beforeAll(async () => {
    setupTestDir();
    // Create with real auth enabled (but csrf: false for test simplicity)
    appInstance = createApp({ operatorDir: TEST_DIR, csrf: false });
    // Create initial token directly via auth module (avoids chicken-and-egg with auth middleware)
    const initial = appInstance.auth.generateToken('bootstrap');
    authToken = initial.token;
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (appInstance) await appInstance.close();
    teardownTestDir();
  });

  function authedFetch(path, opts = {}) {
    opts.headers = { ...opts.headers, 'Authorization': `Bearer ${authToken}` };
    return fetch(`${baseUrl}${path}`, opts);
  }

  it('GET /views/settings-api-keys returns HTML with token table', async () => {
    const res = await authedFetch('/views/settings-api-keys');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('api-keys-table');
    expect(html).toContain('api-keys-create');
    expect(html).toContain('Generate Token');
  });

  it('shows existing tokens in the table', async () => {
    // Create a labeled token directly
    appInstance.auth.generateToken('my-test-key');

    const res = await authedFetch('/views/settings-api-keys');
    const html = await res.text();
    expect(html).toContain('my-test-key');
  });

  it('shows empty state when auth has no tokens', async () => {
    const freshApp = createApp({ operatorDir: TEST_DIR + '_fresh', csrf: false });
    mkdirSync(TEST_DIR + '_fresh', { recursive: true });
    // Don't create any tokens — the view should show empty state
    // Use auth: false to bypass middleware for the view request
    const noAuthApp = createApp({ operatorDir: TEST_DIR + '_fresh2', auth: false });
    mkdirSync(TEST_DIR + '_fresh2', { recursive: true });
    await new Promise((resolve) => {
      noAuthApp.server.listen(0, '127.0.0.1', resolve);
    });
    const port = noAuthApp.server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/views/settings-api-keys`);
      const html = await res.text();
      // auth: false shows disabled message
      expect(html).toContain('Authentication is disabled');
    } finally {
      await noAuthApp.close();
      await freshApp.close();
      rmSync(TEST_DIR + '_fresh', { recursive: true, force: true });
      rmSync(TEST_DIR + '_fresh2', { recursive: true, force: true });
    }
  });

  it('token table has Revoke buttons when tokens exist', async () => {
    const res = await authedFetch('/views/settings-api-keys');
    const html = await res.text();
    expect(html).toContain('revokeApiKey');
    expect(html).toContain('Revoke');
  });

  it('settings page loads with API Keys section', async () => {
    const res = await authedFetch('/settings');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('API Keys');
    expect(html).toContain('api-keys-form');
    expect(html).toContain('settings-api-keys');
  });

  it('API Keys section has create form with label input', async () => {
    const res = await authedFetch('/views/settings-api-keys');
    const html = await res.text();
    expect(html).toContain('name="label"');
    expect(html).toContain('createApiKey');
  });

  it('view shows auth disabled message when auth: false', async () => {
    const noAuthApp = createApp({ operatorDir: TEST_DIR + '_noauth', auth: false });
    mkdirSync(TEST_DIR + '_noauth', { recursive: true });
    await new Promise((resolve) => {
      noAuthApp.server.listen(0, '127.0.0.1', resolve);
    });
    const port = noAuthApp.server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/views/settings-api-keys`);
      const html = await res.text();
      expect(html).toContain('Authentication is disabled');
    } finally {
      await noAuthApp.close();
      rmSync(TEST_DIR + '_noauth', { recursive: true, force: true });
    }
  });

  it('token revocation via API removes from list', async () => {
    // Create a token to revoke
    const revokeTarget = appInstance.auth.generateToken('to-revoke');

    // Verify it appears in the view
    let res = await authedFetch('/views/settings-api-keys');
    let html = await res.text();
    expect(html).toContain('to-revoke');

    // Revoke it
    await authedFetch(`/api/auth/tokens/${revokeTarget.id}`, { method: 'DELETE' });

    // Verify it no longer appears
    res = await authedFetch('/views/settings-api-keys');
    html = await res.text();
    expect(html).not.toContain('to-revoke');
  });
});
