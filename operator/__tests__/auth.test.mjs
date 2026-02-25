// Authentication & Session Tokens Tests (Phase 27)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import http from 'http';
import { createAuth, TOKEN_PREFIX, TOKEN_BYTE_LENGTH, TOKEN_ID_LENGTH } from '../auth.mjs';
import { createAuthRoutes } from '../routes/auth.mjs';
import { createWsAuthCheck } from '../ws.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_auth');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// Helper: create a minimal Express app with auth middleware for integration tests
function createTestApp(auth) {
  const app = express();
  app.use(express.json());
  app.use(auth.authMiddleware);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/protected', (_req, res) => res.json({ data: 'secret' }));
  app.use('/api', createAuthRoutes({ auth }));
  app.get('/public-page', (_req, res) => res.send('Hello'));
  return app;
}

// Helper: make an HTTP request to a test app
function request(app, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url = new URL(path, `http://127.0.0.1:${port}`);
      const options = {
        hostname: '127.0.0.1',
        port,
        path: url.pathname + url.search,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json', ...headers },
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ── Exports ─────────────────────────────────────────────────

describe('exports', () => {
  it('exports TOKEN_PREFIX as jst_', () => {
    expect(TOKEN_PREFIX).toBe('jst_');
  });

  it('exports TOKEN_BYTE_LENGTH as 32', () => {
    expect(TOKEN_BYTE_LENGTH).toBe(32);
  });

  it('exports TOKEN_ID_LENGTH as 8', () => {
    expect(TOKEN_ID_LENGTH).toBe(8);
  });
});

// ── Token Generation ────────────────────────────────────────

describe('generateToken', () => {
  it('returns token with jst_ prefix and 64 hex chars', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const result = auth.generateToken();
    expect(result.token).toMatch(/^jst_[0-9a-f]{64}$/);
  });

  it('returns unique id with 8 hex chars', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const result = auth.generateToken();
    expect(result.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns label when provided', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const result = auth.generateToken('my-cli-tool');
    expect(result.label).toBe('my-cli-tool');
  });

  it('returns empty label when not provided', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const result = auth.generateToken();
    expect(result.label).toBe('');
  });

  it('returns createdAt ISO timestamp', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const result = auth.generateToken();
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generates unique tokens each time', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const a = auth.generateToken();
    const b = auth.generateToken();
    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
  });
});

// ── Token Validation ────────────────────────────────────────

describe('validateToken', () => {
  it('validates a valid token', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { token } = auth.generateToken('test');
    const result = auth.validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.label).toBe('test');
  });

  it('rejects null token', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    expect(auth.validateToken(null).valid).toBe(false);
  });

  it('rejects empty string', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    expect(auth.validateToken('').valid).toBe(false);
  });

  it('rejects token without jst_ prefix', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    expect(auth.validateToken('abc123').valid).toBe(false);
  });

  it('rejects invalid token with correct prefix', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken(); // ensure store exists
    const result = auth.validateToken('jst_' + '0'.repeat(64));
    expect(result.valid).toBe(false);
  });

  it('rejects revoked token', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { id, token } = auth.generateToken();
    expect(auth.validateToken(token).valid).toBe(true);
    auth.revokeToken(id);
    expect(auth.validateToken(token).valid).toBe(false);
  });

  it('returns id and label on valid token', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { id, token } = auth.generateToken('my-label');
    const result = auth.validateToken(token);
    expect(result.id).toBe(id);
    expect(result.label).toBe('my-label');
  });
});

// ── Token Revocation ────────────────────────────────────────

describe('revokeToken', () => {
  it('returns true when token exists', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { id } = auth.generateToken();
    expect(auth.revokeToken(id)).toBe(true);
  });

  it('returns false for unknown id', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    expect(auth.revokeToken('nonexistent')).toBe(false);
  });

  it('removes token from list', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { id } = auth.generateToken();
    expect(auth.listTokens()).toHaveLength(1);
    auth.revokeToken(id);
    expect(auth.listTokens()).toHaveLength(0);
  });
});

// ── Token Listing ───────────────────────────────────────────

describe('listTokens', () => {
  it('returns empty array when no tokens', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    expect(auth.listTokens()).toEqual([]);
  });

  it('returns id, label, createdAt (no secrets)', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken('api-key-1');
    const list = auth.listTokens();
    expect(list).toHaveLength(1);
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('label', 'api-key-1');
    expect(list[0]).toHaveProperty('createdAt');
    // No raw token or hash in listing
    expect(list[0]).not.toHaveProperty('token');
    expect(list[0]).not.toHaveProperty('hash');
  });

  it('lists multiple tokens', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken('a');
    auth.generateToken('b');
    auth.generateToken('c');
    expect(auth.listTokens()).toHaveLength(3);
  });
});

// ── Token Persistence ───────────────────────────────────────

describe('persistence', () => {
  it('persists tokens to disk and reloads', () => {
    const auth1 = createAuth({ operatorDir: TEST_DIR });
    const { token } = auth1.generateToken('persisted');

    // Create new instance (simulating server restart)
    const auth2 = createAuth({ operatorDir: TEST_DIR });
    const result = auth2.validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.label).toBe('persisted');
  });

  it('creates .data directory if missing', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken();
    expect(existsSync(join(TEST_DIR, '.data', 'auth-tokens.json'))).toBe(true);
  });

  it('writes valid JSON to disk', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken('test');
    const raw = readFileSync(join(TEST_DIR, '.data', 'auth-tokens.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(typeof parsed).toBe('object');
    const ids = Object.keys(parsed);
    expect(ids).toHaveLength(1);
    expect(parsed[ids[0]]).toHaveProperty('hash');
    expect(parsed[ids[0]]).toHaveProperty('label', 'test');
    expect(parsed[ids[0]]).toHaveProperty('createdAt');
  });

  it('handles corrupt token file gracefully', () => {
    mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.data', 'auth-tokens.json'), 'NOT VALID JSON!!!');
    const auth = createAuth({ operatorDir: TEST_DIR });
    // Should not throw — returns empty list
    expect(auth.listTokens()).toEqual([]);
    // Can still generate new tokens (overwrites corrupt file)
    const { token } = auth.generateToken();
    expect(auth.validateToken(token).valid).toBe(true);
  });
});

// ── Auth Middleware ──────────────────────────────────────────

describe('authMiddleware', () => {
  it('returns 401 on missing token', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken(); // ensure at least one token exists
    const app = createTestApp(auth);
    const res = await request(app, 'GET', '/api/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it('returns 401 on invalid token', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken();
    const app = createTestApp(auth);
    const res = await request(app, 'GET', '/api/protected', {
      headers: { Authorization: 'Bearer jst_bad' },
    });
    expect(res.status).toBe(401);
  });

  it('passes with valid Bearer token', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { token } = auth.generateToken();
    const app = createTestApp(auth);
    const res = await request(app, 'GET', '/api/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toBe('secret');
  });

  it('passes with valid query param token', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { token } = auth.generateToken();
    const app = createTestApp(auth);
    const res = await request(app, 'GET', `/api/protected?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBe('secret');
  });

  it('skips auth for /api/health', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken();
    const app = createTestApp(auth);
    const res = await request(app, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('skips auth for non-API paths (static files)', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken();
    const app = createTestApp(auth);
    const res = await request(app, 'GET', '/public-page');
    expect(res.status).toBe(200);
  });
});

// ── Auth Routes ─────────────────────────────────────────────

describe('auth routes', () => {
  it('POST /api/auth/tokens generates a new token', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { token: authToken } = auth.generateToken('bootstrap');
    const app = createTestApp(auth);

    const res = await request(app, 'POST', '/api/auth/tokens', {
      headers: { Authorization: `Bearer ${authToken}` },
      body: { label: 'new-key' },
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^jst_[0-9a-f]{64}$/);
    expect(res.body.label).toBe('new-key');
    expect(res.body.id).toMatch(/^[0-9a-f]{8}$/);
    expect(res.body.createdAt).toBeTruthy();
  });

  it('GET /api/auth/tokens lists tokens without secrets', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { token } = auth.generateToken('bootstrap');
    auth.generateToken('key-2');

    const app = createTestApp(auth);
    const res = await request(app, 'GET', '/api/auth/tokens', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.tokens).toHaveLength(2);
    // No raw tokens in listing
    for (const t of res.body.tokens) {
      expect(t).not.toHaveProperty('token');
      expect(t).not.toHaveProperty('hash');
    }
  });

  it('DELETE /api/auth/tokens/:id revokes a token', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { token } = auth.generateToken('admin');
    const { id: targetId, token: targetToken } = auth.generateToken('to-revoke');

    const app = createTestApp(auth);
    const res = await request(app, 'DELETE', `/api/auth/tokens/${targetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);

    // Verify token no longer works
    expect(auth.validateToken(targetToken).valid).toBe(false);
  });

  it('DELETE /api/auth/tokens/:id returns 404 for unknown id', async () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { token } = auth.generateToken('admin');

    const app = createTestApp(auth);
    const res = await request(app, 'DELETE', '/api/auth/tokens/deadbeef', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

// ── WebSocket Auth Check ────────────────────────────────────

describe('createWsAuthCheck', () => {
  it('returns valid:true when auth is null (disabled)', () => {
    const check = createWsAuthCheck(null);
    const url = new URL('ws://localhost/ws');
    expect(check(url).valid).toBe(true);
  });

  it('rejects WS upgrade without token', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken();
    const check = createWsAuthCheck(auth);
    const url = new URL('ws://localhost/ws');
    expect(check(url).valid).toBe(false);
  });

  it('rejects WS upgrade with invalid token', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    auth.generateToken();
    const check = createWsAuthCheck(auth);
    const url = new URL('ws://localhost/ws?token=jst_bad');
    expect(check(url).valid).toBe(false);
  });

  it('accepts WS upgrade with valid token in query param', () => {
    const auth = createAuth({ operatorDir: TEST_DIR });
    const { token } = auth.generateToken();
    const check = createWsAuthCheck(auth);
    const url = new URL(`ws://localhost/ws?token=${token}`);
    const result = check(url);
    expect(result.valid).toBe(true);
  });
});
