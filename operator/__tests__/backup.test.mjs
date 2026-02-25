// Backup Manager Tests (Phase 51)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync,
} from 'fs';
import { join } from 'path';
import { createBackupManager } from '../backup.mjs';
import { createApp } from '../server.mjs';
import { EventBus } from '../../shared/event-bus.mjs';
import http from 'http';
import express from 'express';
import { createBackupRoutes } from '../routes/backup.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_backup');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── HTTP request helper (same pattern as existing tests) ────

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
            resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: res.headers });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

function createTestApp(backupManager, coordinator = null) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createBackupRoutes({ backupManager, coordinator }));
  return app;
}

// Seed some test files into the operator directory
function seedFiles() {
  writeFileSync(join(TEST_DIR, 'registry.json'), JSON.stringify({ chains: [] }));
  writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ model: 'sonnet' }));
  writeFileSync(join(TEST_DIR, '.data', 'task-queue.json'), JSON.stringify({ tasks: [] }));
  writeFileSync(join(TEST_DIR, '.data', 'shared-memory.json'), JSON.stringify({ keys: {} }));
  writeFileSync(join(TEST_DIR, '.data', 'audit-log.jsonl'), '{"event":"test","ts":"2024-01-01"}\n{"event":"test2","ts":"2024-01-02"}\n');
  writeFileSync(join(TEST_DIR, '.data', 'secrets.vault'), JSON.stringify({ _version: 1, entries: {} }));
  writeFileSync(join(TEST_DIR, '.data', 'auth-tokens.json'), JSON.stringify({ tokens: [] }));
}

// ── Core: createBackup ──────────────────────────────────────

describe('createBackup', () => {
  it('returns valid bundle with version field', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    expect(bundle.version).toBe(1);
    expect(bundle.createdAt).toMatch(/^\d{4}-/);
    expect(bundle.files).toBeDefined();
    expect(bundle.manifest).toBeDefined();
  });

  it('includes registry.json in files', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    expect(bundle.files['registry.json']).toBeDefined();
    // Decode and verify content
    const decoded = Buffer.from(bundle.files['registry.json'], 'base64').toString('utf-8');
    expect(JSON.parse(decoded)).toEqual({ chains: [] });
  });

  it('includes settings.json in files', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    expect(bundle.files['settings.json']).toBeDefined();
    const decoded = Buffer.from(bundle.files['settings.json'], 'base64').toString('utf-8');
    expect(JSON.parse(decoded)).toEqual({ model: 'sonnet' });
  });

  it('includes .data/ files that exist', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    expect(bundle.files['.data/task-queue.json']).toBeDefined();
    expect(bundle.files['.data/shared-memory.json']).toBeDefined();
    expect(bundle.files['.data/audit-log.jsonl']).toBeDefined();
  });

  it('skips files that do not exist (no error)', () => {
    // Only create registry.json, nothing else
    writeFileSync(join(TEST_DIR, 'registry.json'), '{}');
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    expect(bundle.files['registry.json']).toBeDefined();
    // .data files don't exist but no error thrown
    expect(bundle.files['.data/webhooks.json']).toBeUndefined();
    expect(bundle.manifest.fileCount).toBe(1);
  });

  it('with excludeSecrets omits secrets.vault and auth-tokens.json', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup({ excludeSecrets: true });
    expect(bundle.files['.data/secrets.vault']).toBeUndefined();
    expect(bundle.files['.data/auth-tokens.json']).toBeUndefined();
    // Other files still present
    expect(bundle.files['registry.json']).toBeDefined();
  });

  it('with excludeAudit omits audit-log.jsonl', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup({ excludeAudit: true });
    expect(bundle.files['.data/audit-log.jsonl']).toBeUndefined();
    // Other files still present
    expect(bundle.files['registry.json']).toBeDefined();
  });

  it('manifest includes correct fileCount and totalBytes', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    expect(bundle.manifest.fileCount).toBe(Object.keys(bundle.files).length);
    expect(bundle.manifest.totalBytes).toBeGreaterThan(0);
    // Verify totalBytes matches actual file sizes
    let expectedBytes = 0;
    expectedBytes += Buffer.byteLength(JSON.stringify({ chains: [] }));
    expectedBytes += Buffer.byteLength(JSON.stringify({ model: 'sonnet' }));
    expectedBytes += Buffer.byteLength(JSON.stringify({ tasks: [] }));
    expectedBytes += Buffer.byteLength(JSON.stringify({ keys: {} }));
    expectedBytes += Buffer.byteLength('{"event":"test","ts":"2024-01-01"}\n{"event":"test2","ts":"2024-01-02"}\n');
    expectedBytes += Buffer.byteLength(JSON.stringify({ _version: 1, entries: {} }));
    expectedBytes += Buffer.byteLength(JSON.stringify({ tokens: [] }));
    expect(bundle.manifest.totalBytes).toBe(expectedBytes);
  });
});

// ── Core: restoreBackup ─────────────────────────────────────

describe('restoreBackup', () => {
  it('writes files to correct paths', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();

    // Wipe files
    rmSync(join(TEST_DIR, 'registry.json'), { force: true });
    rmSync(join(TEST_DIR, 'settings.json'), { force: true });

    const result = mgr.restoreBackup(bundle);
    expect(result.restored).toContain('registry.json');
    expect(result.restored).toContain('settings.json');

    // Verify file contents were restored
    const restored = JSON.parse(readFileSync(join(TEST_DIR, 'registry.json'), 'utf-8'));
    expect(restored).toEqual({ chains: [] });
  });

  it('uses atomic write (temp file created)', () => {
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = {
      version: 1,
      createdAt: new Date().toISOString(),
      files: {
        'registry.json': Buffer.from('{"test":true}').toString('base64'),
      },
      manifest: { fileCount: 1, totalBytes: 13 },
    };

    const result = mgr.restoreBackup(bundle);
    expect(result.restored).toContain('registry.json');
    // After restore, the file exists and .tmp should be gone
    expect(existsSync(join(TEST_DIR, 'registry.json'))).toBe(true);
    // .tmp should not linger
    expect(existsSync(join(TEST_DIR, 'registry.json.tmp'))).toBe(false);
  });

  it('validates bundle version field (rejects version !== 1)', () => {
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const result = mgr.restoreBackup({ version: 99, files: {} });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('version');
    expect(result.restored).toHaveLength(0);
  });

  it('rejects invalid/corrupt bundle (no version, no files)', () => {
    const mgr = createBackupManager({ operatorDir: TEST_DIR });

    // No version
    const r1 = mgr.restoreBackup({ files: {} });
    expect(r1.errors.length).toBeGreaterThan(0);

    // No files
    const r2 = mgr.restoreBackup({ version: 1 });
    expect(r2.errors.length).toBeGreaterThan(0);

    // Not an object
    const r3 = mgr.restoreBackup(null);
    expect(r3.errors.length).toBeGreaterThan(0);

    // String
    const r4 = mgr.restoreBackup('junk');
    expect(r4.errors.length).toBeGreaterThan(0);
  });

  it('with dryRun returns files without writing', () => {
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = {
      version: 1,
      createdAt: new Date().toISOString(),
      files: {
        'registry.json': Buffer.from('{"dry":"run"}').toString('base64'),
        'settings.json': Buffer.from('{"x":1}').toString('base64'),
      },
      manifest: { fileCount: 2, totalBytes: 20 },
    };

    const result = mgr.restoreBackup(bundle, { dryRun: true });
    expect(result.restored).toContain('registry.json');
    expect(result.restored).toContain('settings.json');
    // Files should NOT be written on disk
    expect(existsSync(join(TEST_DIR, 'registry.json'))).toBe(false);
  });

  it('returns restored/skipped/errors counts', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();

    // Add an unknown file path that should be skipped
    bundle.files['unknown/bad.json'] = Buffer.from('{}').toString('base64');

    const result = mgr.restoreBackup(bundle);
    expect(result.restored.length).toBeGreaterThan(0);
    expect(result.skipped).toContain('unknown/bad.json');
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ── Round-trip ──────────────────────────────────────────────

describe('round-trip', () => {
  it('backup then restore produces identical files', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });

    // Create backup
    const bundle = mgr.createBackup();

    // Corrupt the files by overwriting
    writeFileSync(join(TEST_DIR, 'registry.json'), '"corrupted"');
    writeFileSync(join(TEST_DIR, 'settings.json'), '"corrupted"');

    // Restore
    const result = mgr.restoreBackup(bundle);
    expect(result.errors).toHaveLength(0);

    // Verify originals are back
    const reg = JSON.parse(readFileSync(join(TEST_DIR, 'registry.json'), 'utf-8'));
    expect(reg).toEqual({ chains: [] });
    const settings = JSON.parse(readFileSync(join(TEST_DIR, 'settings.json'), 'utf-8'));
    expect(settings).toEqual({ model: 'sonnet' });
  });
});

// ── autoBackup ──────────────────────────────────────────────

describe('autoBackup', () => {
  it('creates timestamped backup file', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const result = mgr.autoBackup();

    expect(result.path).toContain('.backup-');
    expect(result.size).toBeGreaterThan(0);
    expect(existsSync(result.path)).toBe(true);

    // Verify the file is valid JSON with version 1
    const content = JSON.parse(readFileSync(result.path, 'utf-8'));
    expect(content.version).toBe(1);
  });
});

// ── listBackups ─────────────────────────────────────────────

describe('listBackups', () => {
  it('returns saved backup files', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });

    // Create an auto-backup
    mgr.autoBackup();

    const list = mgr.listBackups();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].name).toMatch(/^\.backup-.*\.json$/);
    expect(list[0].size).toBeGreaterThan(0);
    expect(list[0].createdAt).toMatch(/^\d{4}-/);
  });
});

// ── getBackupInfo ───────────────────────────────────────────

describe('getBackupInfo', () => {
  it('returns manifest without restoring', () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    const info = mgr.getBackupInfo(bundle);

    expect(info.fileCount).toBe(bundle.manifest.fileCount);
    expect(info.totalBytes).toBe(bundle.manifest.totalBytes);
    expect(info.createdAt).toBe(bundle.createdAt);
    expect(info.files).toEqual(Object.keys(bundle.files));
  });
});

// ── Base64 encoding ─────────────────────────────────────────

describe('base64 encoding', () => {
  it('handles binary-like data correctly', () => {
    // Write binary-ish content
    const binaryData = Buffer.from([0x00, 0xFF, 0x80, 0x7F, 0xDE, 0xAD, 0xBE, 0xEF]);
    writeFileSync(join(TEST_DIR, 'registry.json'), binaryData);

    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    expect(bundle.files['registry.json']).toBeDefined();

    // Wipe and restore
    rmSync(join(TEST_DIR, 'registry.json'), { force: true });
    mgr.restoreBackup(bundle);

    const restored = readFileSync(join(TEST_DIR, 'registry.json'));
    expect(Buffer.compare(restored, binaryData)).toBe(0);
  });

  it('handles JSONL content correctly', () => {
    const jsonl = '{"event":"a","ts":"2024-01-01"}\n{"event":"b","ts":"2024-01-02"}\n';
    writeFileSync(join(TEST_DIR, '.data', 'audit-log.jsonl'), jsonl);

    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();

    // Wipe and restore
    rmSync(join(TEST_DIR, '.data', 'audit-log.jsonl'), { force: true });
    mgr.restoreBackup(bundle);

    const restored = readFileSync(join(TEST_DIR, '.data', 'audit-log.jsonl'), 'utf-8');
    expect(restored).toBe(jsonl);
  });
});

// ── Edge cases ──────────────────────────────────────────────

describe('edge cases', () => {
  it('empty operatorDir: backup produces valid (minimal) bundle', () => {
    // TEST_DIR exists but has no persistence files (just .data dir)
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();
    expect(bundle.version).toBe(1);
    expect(bundle.manifest.fileCount).toBe(0);
    expect(bundle.manifest.totalBytes).toBe(0);
    expect(Object.keys(bundle.files)).toHaveLength(0);
  });

  it('restore creates .data directory if missing', () => {
    // Remove .data directory
    rmSync(join(TEST_DIR, '.data'), { recursive: true, force: true });
    expect(existsSync(join(TEST_DIR, '.data'))).toBe(false);

    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = {
      version: 1,
      createdAt: new Date().toISOString(),
      files: {
        '.data/task-queue.json': Buffer.from('{"tasks":[]}').toString('base64'),
      },
      manifest: { fileCount: 1, totalBytes: 12 },
    };

    const result = mgr.restoreBackup(bundle);
    expect(result.restored).toContain('.data/task-queue.json');
    expect(existsSync(join(TEST_DIR, '.data'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.data', 'task-queue.json'))).toBe(true);
  });
});

// ── Route Tests ─────────────────────────────────────────────

describe('routes', () => {
  it('POST /api/backup returns bundle JSON', async () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const app = createTestApp(mgr);

    const res = await request(app, 'POST', '/api/backup');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.files).toBeDefined();
    expect(res.body.manifest).toBeDefined();
    expect(res.headers['content-disposition']).toContain('operator-backup-');
  });

  it('POST /api/backup/restore restores from bundle', async () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();

    // Corrupt a file
    writeFileSync(join(TEST_DIR, 'registry.json'), '"bad"');

    const app = createTestApp(mgr);
    const res = await request(app, 'POST', '/api/backup/restore', { body: bundle });
    expect(res.status).toBe(200);
    expect(res.body.restored).toContain('registry.json');
    expect(res.body.errors).toHaveLength(0);

    // Verify file was restored
    const content = JSON.parse(readFileSync(join(TEST_DIR, 'registry.json'), 'utf-8'));
    expect(content).toEqual({ chains: [] });
  });

  it('POST /api/backup/restore rejects when coordinator is running', async () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();

    const mockCoordinator = { getState: () => 'running' };
    const app = createTestApp(mgr, mockCoordinator);

    const res = await request(app, 'POST', '/api/backup/restore', { body: bundle });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('running');
  });

  it('POST /api/backup/restore/preview returns dry-run results', async () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const bundle = mgr.createBackup();

    // Remove files to verify they are NOT re-created (dry-run)
    rmSync(join(TEST_DIR, 'registry.json'), { force: true });

    const app = createTestApp(mgr);
    const res = await request(app, 'POST', '/api/backup/restore/preview', { body: bundle });
    expect(res.status).toBe(200);
    expect(res.body.restored).toContain('registry.json');
    // File should still NOT exist (dry run)
    expect(existsSync(join(TEST_DIR, 'registry.json'))).toBe(false);
  });

  it('GET /api/backup/list returns backup list', async () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    mgr.autoBackup();

    const app = createTestApp(mgr);
    const res = await request(app, 'GET', '/api/backup/list');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].name).toMatch(/^\.backup-/);
  });

  it('POST /api/backup/auto triggers auto-backup', async () => {
    seedFiles();
    const mgr = createBackupManager({ operatorDir: TEST_DIR });
    const app = createTestApp(mgr);

    const res = await request(app, 'POST', '/api/backup/auto');
    expect(res.status).toBe(200);
    expect(res.body.path).toBeDefined();
    expect(res.body.size).toBeGreaterThan(0);
    expect(existsSync(res.body.path)).toBe(true);
  });

  it('returns 503 when backupManager is null', async () => {
    const app = createTestApp(null);
    const res = await request(app, 'POST', '/api/backup');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('not available');
  });
});

// ── Integration with createApp ──────────────────────────────

describe('createApp integration', () => {
  it('createApp returns backupManager in result', () => {
    const events = new EventBus();
    const instance = createApp({ operatorDir: TEST_DIR, events, auth: false });
    expect(instance.backupManager).toBeDefined();
    expect(typeof instance.backupManager.createBackup).toBe('function');
    instance.close();
  });
});
