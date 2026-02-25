// Phase 30 — Data Migration Framework & Retention Policy Tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createMigrationRunner, loadJson, saveJson } from '../migrations.mjs';
import { createRetentionPolicy } from '../retention.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_migrations');
const DATA_DIR = join(TEST_DIR, '.data');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(DATA_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ============================================================
// Migration Runner Tests
// ============================================================

describe('createMigrationRunner', () => {

  // ── Version Tracking ──────────────────────────────────────

  describe('version tracking', () => {
    it('getCurrentVersion returns 0 when file does not exist', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      expect(runner.getCurrentVersion()).toBe(0);
    });

    it('getCurrentVersion returns 0 when file is corrupt/NaN', () => {
      writeFileSync(join(DATA_DIR, '.migration-version'), 'garbage');
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      expect(runner.getCurrentVersion()).toBe(0);
    });

    it('setVersion writes and getCurrentVersion reads correctly', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(5);
      expect(runner.getCurrentVersion()).toBe(5);
    });

    it('setVersion uses atomic write pattern', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(3);
      const raw = readFileSync(join(DATA_DIR, '.migration-version'), 'utf-8');
      expect(raw.trim()).toBe('3');
    });
  });

  // ── migrate() ──────────────────────────────────────────────

  describe('migrate()', () => {
    it('runs all pending migrations in order', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      const result = runner.migrate();
      expect(result.from).toBe(0);
      expect(result.to).toBe(2);
      expect(result.applied).toEqual(['add-version-fields', 'backfill-created-at']);
    });

    it('skips already-applied migrations (idempotent)', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.migrate();
      const result2 = runner.migrate();
      expect(result2.from).toBe(2);
      expect(result2.to).toBe(2);
      expect(result2.applied).toEqual([]);
    });

    it('returns empty applied when no pending', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(99);
      const result = runner.migrate();
      expect(result.from).toBe(99);
      expect(result.to).toBe(99);
      expect(result.applied).toEqual([]);
    });

    it('updates version after each migration', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.migrate();
      expect(runner.getCurrentVersion()).toBe(2);
    });
  });

  // ── rollback() ─────────────────────────────────────────────

  describe('rollback()', () => {
    it('runs down() in reverse order and updates version', () => {
      // First apply all migrations
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      // Create a shared-memory.json so migration 1 has something to work with
      saveJson(join(DATA_DIR, 'shared-memory.json'), { store: {}, snapshots: {} });
      runner.migrate();
      expect(runner.getCurrentVersion()).toBe(2);

      // Roll back to version 0
      const result = runner.rollback(0);
      expect(result.from).toBe(2);
      expect(result.to).toBe(0);
      expect(result.applied).toEqual(['backfill-created-at', 'add-version-fields']);
      expect(runner.getCurrentVersion()).toBe(0);
    });

    it('rollback to current version is a no-op', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.migrate();
      const result = runner.rollback(2);
      expect(result.from).toBe(2);
      expect(result.to).toBe(2);
      expect(result.applied).toEqual([]);
    });

    it('rollback to version above current is a no-op', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(1);
      const result = runner.rollback(5);
      expect(result.from).toBe(1);
      expect(result.to).toBe(1);
      expect(result.applied).toEqual([]);
    });
  });

  // ── getMigrations() ────────────────────────────────────────

  describe('getMigrations()', () => {
    it('returns list of all registered migrations', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      const list = runner.getMigrations();
      expect(list).toEqual([
        { version: 1, name: 'add-version-fields' },
        { version: 2, name: 'backfill-created-at' },
      ]);
    });
  });

  // ── Migration 1: add-version-fields ────────────────────────

  describe('Migration 1: add-version-fields', () => {
    it('adds _schemaVersion to existing JSON files', () => {
      // Create data files without _schemaVersion
      saveJson(join(DATA_DIR, 'shared-memory.json'), { store: {}, snapshots: {} });
      saveJson(join(DATA_DIR, 'terminal-messages.json'), { messages: [], unread: {} });
      saveJson(join(DATA_DIR, 'persistent-queue.json'), { tasks: [] });

      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(0);
      runner.migrate();

      const sm = loadJson(join(DATA_DIR, 'shared-memory.json'));
      expect(sm._schemaVersion).toBe(1);

      const tm = loadJson(join(DATA_DIR, 'terminal-messages.json'));
      expect(tm._schemaVersion).toBe(1);

      const pq = loadJson(join(DATA_DIR, 'persistent-queue.json'));
      expect(pq._schemaVersion).toBe(1);
    });

    it('is idempotent — does not overwrite existing _schemaVersion', () => {
      saveJson(join(DATA_DIR, 'shared-memory.json'), { store: {}, _schemaVersion: 1 });

      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(0);
      runner.migrate();

      const sm = loadJson(join(DATA_DIR, 'shared-memory.json'));
      expect(sm._schemaVersion).toBe(1);
    });

    it('skips files that do not exist', () => {
      // No files created — migration should not error
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      const result = runner.migrate();
      expect(result.applied.length).toBeGreaterThan(0);
    });

    it('down removes _schemaVersion fields', () => {
      saveJson(join(DATA_DIR, 'shared-memory.json'), { store: {}, _schemaVersion: 1 });
      saveJson(join(DATA_DIR, 'terminal-messages.json'), { messages: [], _schemaVersion: 1 });

      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(2);
      runner.rollback(0);

      const sm = loadJson(join(DATA_DIR, 'shared-memory.json'));
      expect(sm._schemaVersion).toBeUndefined();

      const tm = loadJson(join(DATA_DIR, 'terminal-messages.json'));
      expect(tm._schemaVersion).toBeUndefined();
    });
  });

  // ── Migration 2: backfill-created-at ───────────────────────

  describe('Migration 2: backfill-created-at', () => {
    it('backfills createdAt from startedAt on chain entries', () => {
      // registry.json lives at dataDir/../registry.json
      const registryPath = join(TEST_DIR, 'registry.json');
      saveJson(registryPath, {
        version: 1,
        chains: [
          { id: 'c1', startedAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
          { id: 'c2', createdAt: '2025-06-01T00:00:00Z', startedAt: '2025-06-01T00:00:00Z' },
        ],
      });

      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(1); // skip migration 1
      runner.migrate();

      const data = loadJson(registryPath);
      expect(data.chains[0].createdAt).toBe('2025-01-01T00:00:00Z');
      expect(data.chains[1].createdAt).toBe('2025-06-01T00:00:00Z'); // unchanged
    });

    it('does not error when registry.json does not exist', () => {
      const runner = createMigrationRunner({ dataDir: DATA_DIR });
      runner.setVersion(1);
      const result = runner.migrate();
      expect(result.applied).toContain('backfill-created-at');
    });
  });
});

// ============================================================
// loadJson / saveJson Helpers
// ============================================================

describe('loadJson / saveJson', () => {
  it('loadJson returns null for missing file', () => {
    expect(loadJson(join(DATA_DIR, 'nonexistent.json'))).toBeNull();
  });

  it('loadJson returns null for corrupt file', () => {
    writeFileSync(join(DATA_DIR, 'bad.json'), '{not valid json!!!');
    expect(loadJson(join(DATA_DIR, 'bad.json'))).toBeNull();
  });

  it('saveJson atomic write round-trip', () => {
    const filePath = join(DATA_DIR, 'test-rw.json');
    const data = { hello: 'world', n: 42, nested: { arr: [1, 2, 3] } };
    saveJson(filePath, data);
    const loaded = loadJson(filePath);
    expect(loaded).toEqual(data);
  });

  it('saveJson creates parent directories', () => {
    const filePath = join(DATA_DIR, 'deep', 'nested', 'data.json');
    saveJson(filePath, { ok: true });
    expect(loadJson(filePath)).toEqual({ ok: true });
  });
});

// ============================================================
// Retention Policy Tests
// ============================================================

describe('createRetentionPolicy', () => {

  // ── cleanMessages ──────────────────────────────────────────

  describe('cleanMessages', () => {
    it('removes messages older than maxAgeDays', () => {
      const policy = createRetentionPolicy({ maxAgeDays: 7 });
      const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const newDate = new Date().toISOString();

      const deleted = new Set();
      const messageBus = {
        getAll: () => [
          { id: 'm1', timestamp: oldDate },
          { id: 'm2', timestamp: newDate },
          { id: 'm3', timestamp: oldDate },
        ],
        delete: (id) => { deleted.add(id); return true; },
      };

      const count = policy.cleanMessages(messageBus);
      expect(count).toBe(2);
      expect(deleted.has('m1')).toBe(true);
      expect(deleted.has('m3')).toBe(true);
      expect(deleted.has('m2')).toBe(false);
    });

    it('no-op when nothing is old', () => {
      const policy = createRetentionPolicy({ maxAgeDays: 30 });
      const now = new Date().toISOString();

      const messageBus = {
        getAll: () => [
          { id: 'm1', timestamp: now },
          { id: 'm2', timestamp: now },
        ],
        delete: () => true,
      };

      const count = policy.cleanMessages(messageBus);
      expect(count).toBe(0);
    });

    it('returns 0 when messageBus is null', () => {
      const policy = createRetentionPolicy();
      expect(policy.cleanMessages(null)).toBe(0);
    });
  });

  // ── cleanSnapshots ─────────────────────────────────────────

  describe('cleanSnapshots', () => {
    it('removes old snapshot keys from shared memory', () => {
      const policy = createRetentionPolicy({ maxAgeDays: 7 });
      const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const newDate = new Date().toISOString();

      const deleted = new Set();
      const sharedMemory = {
        keys: (prefix) => ['snapshot:t1', 'snapshot:t2', 'snapshot:t3'].filter(k => k.startsWith(prefix)),
        getEntry: (key) => {
          if (key === 'snapshot:t1') return { value: {}, updatedAt: oldDate };
          if (key === 'snapshot:t2') return { value: {}, updatedAt: newDate };
          if (key === 'snapshot:t3') return { value: {}, updatedAt: oldDate };
          return null;
        },
        delete: (key) => { deleted.add(key); return true; },
      };

      const count = policy.cleanSnapshots(sharedMemory);
      expect(count).toBe(2);
      expect(deleted.has('snapshot:t1')).toBe(true);
      expect(deleted.has('snapshot:t3')).toBe(true);
    });

    it('returns 0 when sharedMemory is null', () => {
      const policy = createRetentionPolicy();
      expect(policy.cleanSnapshots(null)).toBe(0);
    });
  });

  // ── cleanCompletedTasks ────────────────────────────────────

  describe('cleanCompletedTasks', () => {
    it('removes old terminal-state tasks', () => {
      const policy = createRetentionPolicy({ maxAgeDays: 7, maxEntries: 1000 });
      const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
      const newDate = new Date().toISOString();

      const removed = new Set();
      const taskQueue = {
        getAll: () => [
          { id: 't1', status: 'complete', completedAt: oldDate, createdAt: oldDate },
          { id: 't2', status: 'pending', createdAt: newDate },
          { id: 't3', status: 'failed', completedAt: oldDate, createdAt: oldDate },
          { id: 't4', status: 'complete', completedAt: newDate, createdAt: newDate },
        ],
        remove: (id) => { removed.add(id); return true; },
      };

      const count = policy.cleanCompletedTasks(taskQueue);
      expect(count).toBe(2); // t1 and t3 are old
      expect(removed.has('t1')).toBe(true);
      expect(removed.has('t3')).toBe(true);
      expect(removed.has('t4')).toBe(false);
    });

    it('respects maxEntries cap', () => {
      const policy = createRetentionPolicy({ maxAgeDays: 365, maxEntries: 2 });
      const now = new Date().toISOString();

      const removed = new Set();
      const taskQueue = {
        getAll: () => [
          { id: 't1', status: 'complete', completedAt: now, createdAt: now },
          { id: 't2', status: 'complete', completedAt: now, createdAt: now },
          { id: 't3', status: 'complete', completedAt: now, createdAt: now },
          { id: 't4', status: 'complete', completedAt: now, createdAt: now },
        ],
        remove: (id) => { removed.add(id); return true; },
      };

      const count = policy.cleanCompletedTasks(taskQueue);
      expect(count).toBe(2); // keep 2, remove 2
    });

    it('returns 0 when taskQueue is null', () => {
      const policy = createRetentionPolicy();
      expect(policy.cleanCompletedTasks(null)).toBe(0);
    });
  });

  // ── runAll ──────────────────────────────────────────────────

  describe('runAll', () => {
    it('returns combined counts from all cleanup', () => {
      const policy = createRetentionPolicy({ maxAgeDays: 7 });
      const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();

      const messageBus = {
        getAll: () => [{ id: 'm1', timestamp: oldDate }],
        delete: () => true,
      };

      const sharedMemory = {
        keys: () => ['snapshot:x'],
        getEntry: () => ({ value: {}, updatedAt: oldDate }),
        delete: () => true,
      };

      const taskQueue = {
        getAll: () => [{ id: 't1', status: 'complete', completedAt: oldDate, createdAt: oldDate }],
        remove: () => true,
      };

      const result = policy.runAll({ messageBus, sharedMemory, taskQueue });
      expect(result).toEqual({
        messagesRemoved: 1,
        snapshotsRemoved: 1,
        tasksRemoved: 1,
      });
    });

    it('handles missing subsystems gracefully', () => {
      const policy = createRetentionPolicy();
      const result = policy.runAll({});
      expect(result).toEqual({
        messagesRemoved: 0,
        snapshotsRemoved: 0,
        tasksRemoved: 0,
      });
    });
  });
});
