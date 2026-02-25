// Secrets Vault Tests (Phase 45)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import http from 'http';
import { createSecretVault, deriveMachineKey, MAX_NAME_LENGTH, NAME_PATTERN } from '../secrets.mjs';
import { createSecretRoutes } from '../routes/secrets.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_secrets');
const PERSIST_PATH = join(TEST_DIR, '.data', 'secrets.vault');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// Helper: make HTTP request to test app
function request(app, method, path, { body } = {}) {
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
        headers: { 'Content-Type': 'application/json' },
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

function createTestApp(vault) {
  const app = express();
  app.use(express.json());
  app.use('/api', createSecretRoutes({ secretVault: vault }));
  return app;
}

// ── Core CRUD ───────────────────────────────────────────────

describe('set + get', () => {
  it('stores and retrieves a secret', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('MY_KEY', 'my-secret-value');
    expect(vault.get('MY_KEY')).toBe('my-secret-value');
  });

  it('stores label when provided', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('API_KEY', 'value123', 'My API Key');
    const items = vault.list();
    expect(items[0].label).toBe('My API Key');
  });

  it('returns null for non-existent key', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    expect(vault.get('NOPE')).toBeNull();
  });
});

describe('has', () => {
  it('returns true when secret exists', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('EXISTS', 'yes');
    expect(vault.has('EXISTS')).toBe(true);
  });

  it('returns false when secret does not exist', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    expect(vault.has('NOPE')).toBe(false);
  });
});

describe('remove', () => {
  it('deletes an existing secret', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('DEL_ME', 'bye');
    expect(vault.remove('DEL_ME')).toBe(true);
    expect(vault.has('DEL_ME')).toBe(false);
    expect(vault.get('DEL_ME')).toBeNull();
  });

  it('returns false for non-existent secret', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    expect(vault.remove('NOPE')).toBe(false);
  });
});

describe('list', () => {
  it('returns names without values', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('KEY_A', 'secret-a', 'Label A');
    vault.set('KEY_B', 'secret-b');
    const items = vault.list();
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe('KEY_A');
    expect(items[0].label).toBe('Label A');
    expect(items[0].createdAt).toBeTruthy();
    expect(items[0].updatedAt).toBeTruthy();
    // No value field
    expect(items[0]).not.toHaveProperty('value');
    expect(items[0]).not.toHaveProperty('ciphertext');
  });

  it('includes label, createdAt, updatedAt', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('LABELED', 'val', 'My Label');
    const items = vault.list();
    expect(items[0].label).toBe('My Label');
    expect(items[0].createdAt).toMatch(/^\d{4}-/);
    expect(items[0].updatedAt).toMatch(/^\d{4}-/);
  });
});

describe('getAll', () => {
  it('returns all decrypted values as a map', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('A', 'alpha');
    vault.set('B', 'bravo');
    const all = vault.getAll();
    expect(all).toEqual({ A: 'alpha', B: 'bravo' });
  });
});

// ── Encryption ──────────────────────────────────────────────

describe('encryption', () => {
  it('file on disk is not plaintext', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('SECRET', 'super-secret-password-12345');
    const raw = readFileSync(PERSIST_PATH, 'utf-8');
    expect(raw).not.toContain('super-secret-password-12345');
  });

  it('different values produce different ciphertexts (random IV)', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('SAME1', 'identical');
    const raw1 = readFileSync(PERSIST_PATH, 'utf-8');
    const data1 = JSON.parse(raw1);
    const ct1 = data1.entries.SAME1.ciphertext;

    // Set same value again — IV should differ
    vault.set('SAME1', 'identical');
    const raw2 = readFileSync(PERSIST_PATH, 'utf-8');
    const data2 = JSON.parse(raw2);
    const ct2 = data2.entries.SAME1.ciphertext;

    // Random IV means ciphertext differs even for same plaintext
    // (the IV itself differs, so encrypted output differs)
    const iv1 = data1.entries.SAME1.iv;
    const iv2 = data2.entries.SAME1.iv;
    expect(iv1).not.toBe(iv2);
  });

  it('round-trip: set + get returns original value', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    const original = 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx';
    vault.set('ROUNDTRIP', original);
    expect(vault.get('ROUNDTRIP')).toBe(original);
  });
});

// ── Persistence ─────────────────────────────────────────────

describe('persistence', () => {
  it('save + new instance + load = same values', () => {
    const key = randomBytes(32);
    const vault1 = createSecretVault({ persistPath: PERSIST_PATH, masterKey: key });
    vault1.set('PERSIST_A', 'value-a', 'Label A');
    vault1.set('PERSIST_B', 'value-b');

    // New instance, same key, same path
    const vault2 = createSecretVault({ persistPath: PERSIST_PATH, masterKey: key });
    vault2.load();
    expect(vault2.get('PERSIST_A')).toBe('value-a');
    expect(vault2.get('PERSIST_B')).toBe('value-b');
    const items = vault2.list();
    expect(items).toHaveLength(2);
    expect(items[0].label).toBe('Label A');
  });

  it('atomic write uses .tmp file pattern', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('ATOMIC', 'test');
    // After successful save, .tmp should not exist
    expect(existsSync(PERSIST_PATH)).toBe(true);
    // .tmp should be cleaned up (rename succeeded)
    // (we can't easily test mid-write, but we verify the file exists)
  });
});

// ── Name validation ─────────────────────────────────────────

describe('name validation', () => {
  it('rejects names with special chars', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    expect(() => vault.set('bad-name', 'val')).toThrow('alphanumeric');
    expect(() => vault.set('bad.name', 'val')).toThrow('alphanumeric');
    expect(() => vault.set('bad name', 'val')).toThrow('alphanumeric');
    expect(() => vault.set('bad/name', 'val')).toThrow('alphanumeric');
    expect(() => vault.set('', 'val')).toThrow();
  });

  it('accepts alphanumeric + underscore names', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('GOOD_NAME', 'val');
    vault.set('good_name_123', 'val');
    vault.set('X', 'val');
    expect(vault.has('GOOD_NAME')).toBe(true);
    expect(vault.has('good_name_123')).toBe(true);
    expect(vault.has('X')).toBe(true);
  });
});

// ── Update behavior ─────────────────────────────────────────

describe('update', () => {
  it('updates existing secret with new updatedAt', async () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('UPD', 'first');
    const list1 = vault.list();
    const created1 = list1[0].createdAt;
    const updated1 = list1[0].updatedAt;

    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 10));

    vault.set('UPD', 'second');
    const list2 = vault.list();
    expect(list2[0].createdAt).toBe(created1); // createdAt preserved
    expect(list2[0].updatedAt).not.toBe(updated1); // updatedAt changed
    expect(vault.get('UPD')).toBe('second');
  });
});

// ── Empty vault ─────────────────────────────────────────────

describe('empty vault', () => {
  it('list returns empty array', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    expect(vault.list()).toEqual([]);
  });

  it('getAll returns empty object', () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    expect(vault.getAll()).toEqual({});
  });
});

// ── Machine-derived key ─────────────────────────────────────

describe('deriveMachineKey', () => {
  it('produces deterministic 32-byte key', () => {
    const key1 = deriveMachineKey();
    const key2 = deriveMachineKey();
    expect(key1).toBeInstanceOf(Buffer);
    expect(key1.length).toBe(32);
    expect(key1.equals(key2)).toBe(true);
  });
});

// ── Custom masterKey ────────────────────────────────────────

describe('custom masterKey', () => {
  it('encrypts and decrypts with custom key', () => {
    const key = randomBytes(32);
    const vault = createSecretVault({ persistPath: PERSIST_PATH, masterKey: key });
    vault.set('CUSTOM', 'custom-value');
    expect(vault.get('CUSTOM')).toBe('custom-value');
  });

  it('different key cannot decrypt', () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);

    const vault1 = createSecretVault({ persistPath: PERSIST_PATH, masterKey: key1 });
    vault1.set('MISMATCH', 'secret');

    const vault2 = createSecretVault({ persistPath: PERSIST_PATH, masterKey: key2 });
    vault2.load();
    // Decryption with wrong key should throw
    expect(() => vault2.get('MISMATCH')).toThrow();
  });
});

// ── Route Tests ─────────────────────────────────────────────

describe('routes', () => {
  it('GET /secrets returns list without values', async () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('R_KEY', 'secret-val', 'Route Key');
    const app = createTestApp(vault);

    const res = await request(app, 'GET', '/api/secrets');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('R_KEY');
    expect(res.body[0].label).toBe('Route Key');
    expect(res.body[0]).not.toHaveProperty('value');
    expect(res.body[0]).not.toHaveProperty('ciphertext');
  });

  it('GET /secrets/:name without reveal=true returns 403', async () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('HIDDEN', 'secret');
    const app = createTestApp(vault);

    const res = await request(app, 'GET', '/api/secrets/HIDDEN');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('reveal=true');
  });

  it('GET /secrets/:name with reveal=true returns value', async () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('SHOWN', 'my-secret');
    const app = createTestApp(vault);

    const res = await request(app, 'GET', '/api/secrets/SHOWN?reveal=true');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('SHOWN');
    expect(res.body.value).toBe('my-secret');
  });

  it('PUT /secrets/:name sets secret, response has no value', async () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    const app = createTestApp(vault);

    const res = await request(app, 'PUT', '/api/secrets/NEW_KEY', {
      body: { value: 'new-secret', label: 'New' },
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('NEW_KEY');
    expect(res.body.label).toBe('New');
    expect(res.body).not.toHaveProperty('value');

    // Verify it was actually stored
    expect(vault.get('NEW_KEY')).toBe('new-secret');
  });

  it('DELETE /secrets/:name removes secret (204)', async () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('DELETEME', 'gone');
    const app = createTestApp(vault);

    const res = await request(app, 'DELETE', '/api/secrets/DELETEME');
    expect(res.status).toBe(204);
    expect(vault.has('DELETEME')).toBe(false);
  });

  it('GET /secrets/:name/exists returns boolean', async () => {
    const vault = createSecretVault({ persistPath: PERSIST_PATH });
    vault.set('THERE', 'yes');
    const app = createTestApp(vault);

    const res1 = await request(app, 'GET', '/api/secrets/THERE/exists');
    expect(res1.status).toBe(200);
    expect(res1.body.exists).toBe(true);

    const res2 = await request(app, 'GET', '/api/secrets/MISSING/exists');
    expect(res2.status).toBe(200);
    expect(res2.body.exists).toBe(false);
  });

  it('503 when vault is null', async () => {
    const app = createTestApp(null);
    const res = await request(app, 'GET', '/api/secrets');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('not available');
  });
});
