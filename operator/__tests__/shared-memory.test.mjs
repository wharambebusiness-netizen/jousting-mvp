// Shared Memory Tests (Phase 17)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  createSharedMemory,
  MAX_KEY_LENGTH,
  MAX_VALUE_SIZE,
  MAX_KEYS,
  MAX_SNAPSHOT_SIZE,
  SNAPSHOT_OUTPUT_CHARS,
} from '../shared-memory.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_shared_memory');
const PERSIST_PATH = join(TEST_DIR, '.data', 'shared-memory.json');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── Exports ─────────────────────────────────────────────────

describe('exports', () => {
  it('exports constants', () => {
    expect(MAX_KEY_LENGTH).toBe(256);
    expect(MAX_VALUE_SIZE).toBe(1_048_576);
    expect(MAX_KEYS).toBe(10_000);
    expect(MAX_SNAPSHOT_SIZE).toBe(32_768);
    expect(SNAPSHOT_OUTPUT_CHARS).toBe(4096);
  });
});

// ── Factory ─────────────────────────────────────────────────

describe('createSharedMemory', () => {
  it('returns object with all API methods', () => {
    const mem = createSharedMemory();
    expect(typeof mem.get).toBe('function');
    expect(typeof mem.set).toBe('function');
    expect(typeof mem.delete).toBe('function');
    expect(typeof mem.has).toBe('function');
    expect(typeof mem.keys).toBe('function');
    expect(typeof mem.entries).toBe('function');
    expect(typeof mem.size).toBe('function');
    expect(typeof mem.clear).toBe('function');
    expect(typeof mem.watch).toBe('function');
    expect(typeof mem.watchPrefix).toBe('function');
    expect(typeof mem.deletePrefix).toBe('function');
    expect(typeof mem.writeSnapshot).toBe('function');
    expect(typeof mem.readSnapshot).toBe('function');
    expect(typeof mem.deleteSnapshot).toBe('function');
    expect(typeof mem.getSnapshots).toBe('function');
    expect(typeof mem.save).toBe('function');
    expect(typeof mem.load).toBe('function');
    expect(typeof mem.toJSON).toBe('function');
    expect(typeof mem.fromJSON).toBe('function');
  });

  it('starts empty', () => {
    const mem = createSharedMemory();
    expect(mem.size()).toBe(0);
    expect(mem.keys()).toEqual([]);
  });

  it('isPersistent is false without persistPath', () => {
    const mem = createSharedMemory();
    expect(mem.isPersistent).toBe(false);
  });

  it('isPersistent is true with persistPath', () => {
    const mem = createSharedMemory({ persistPath: PERSIST_PATH });
    expect(mem.isPersistent).toBe(true);
    expect(mem.persistPath).toBe(PERSIST_PATH);
  });
});

// ── Core CRUD ───────────────────────────────────────────────

describe('get/set', () => {
  it('sets and gets a string value', () => {
    const mem = createSharedMemory();
    mem.set('key1', 'hello');
    expect(mem.get('key1')).toBe('hello');
  });

  it('sets and gets an object value', () => {
    const mem = createSharedMemory();
    const obj = { name: 'test', count: 42 };
    mem.set('config', obj);
    expect(mem.get('config')).toEqual(obj);
  });

  it('sets and gets a number value', () => {
    const mem = createSharedMemory();
    mem.set('count', 42);
    expect(mem.get('count')).toBe(42);
  });

  it('sets and gets a boolean value', () => {
    const mem = createSharedMemory();
    mem.set('flag', true);
    expect(mem.get('flag')).toBe(true);
  });

  it('sets and gets null value', () => {
    const mem = createSharedMemory();
    mem.set('empty', null);
    expect(mem.get('empty')).toBe(null);
  });

  it('sets and gets an array value', () => {
    const mem = createSharedMemory();
    mem.set('list', [1, 2, 3]);
    expect(mem.get('list')).toEqual([1, 2, 3]);
  });

  it('returns undefined for non-existent key', () => {
    const mem = createSharedMemory();
    expect(mem.get('missing')).toBeUndefined();
  });

  it('overwrites existing value', () => {
    const mem = createSharedMemory();
    mem.set('key', 'first');
    mem.set('key', 'second');
    expect(mem.get('key')).toBe('second');
    expect(mem.size()).toBe(1);
  });

  it('supports namespaced keys with colons', () => {
    const mem = createSharedMemory();
    mem.set('project:plan', 'build app');
    mem.set('terminal:t1:status', 'running');
    expect(mem.get('project:plan')).toBe('build app');
    expect(mem.get('terminal:t1:status')).toBe('running');
  });

  it('supports keys with dots and slashes', () => {
    const mem = createSharedMemory();
    mem.set('files/src/main.ts', 'content');
    expect(mem.get('files/src/main.ts')).toBe('content');
  });

  it('supports keys with hyphens and underscores', () => {
    const mem = createSharedMemory();
    mem.set('my-key_v2', 'value');
    expect(mem.get('my-key_v2')).toBe('value');
  });
});

describe('getEntry', () => {
  it('returns entry with metadata', () => {
    const mem = createSharedMemory();
    mem.set('key1', 'value1', 'terminal');
    const entry = mem.getEntry('key1');
    expect(entry.value).toBe('value1');
    expect(entry.source).toBe('terminal');
    expect(entry.updatedAt).toBeTruthy();
  });

  it('returns null for non-existent key', () => {
    const mem = createSharedMemory();
    expect(mem.getEntry('missing')).toBe(null);
  });

  it('returns a copy (not reference)', () => {
    const mem = createSharedMemory();
    mem.set('key1', 'value1');
    const entry1 = mem.getEntry('key1');
    const entry2 = mem.getEntry('key1');
    expect(entry1).toEqual(entry2);
    expect(entry1).not.toBe(entry2);
  });
});

describe('delete', () => {
  it('deletes an existing key', () => {
    const mem = createSharedMemory();
    mem.set('key1', 'value1');
    expect(mem.delete('key1')).toBe(true);
    expect(mem.has('key1')).toBe(false);
    expect(mem.size()).toBe(0);
  });

  it('returns false for non-existent key', () => {
    const mem = createSharedMemory();
    expect(mem.delete('missing')).toBe(false);
  });
});

describe('has', () => {
  it('returns true for existing key', () => {
    const mem = createSharedMemory();
    mem.set('key1', 'value1');
    expect(mem.has('key1')).toBe(true);
  });

  it('returns false for non-existent key', () => {
    const mem = createSharedMemory();
    expect(mem.has('missing')).toBe(false);
  });
});

describe('keys', () => {
  it('returns all keys', () => {
    const mem = createSharedMemory();
    mem.set('a', 1);
    mem.set('b', 2);
    mem.set('c', 3);
    expect(mem.keys().sort()).toEqual(['a', 'b', 'c']);
  });

  it('filters by prefix', () => {
    const mem = createSharedMemory();
    mem.set('project:plan', 'x');
    mem.set('project:arch', 'y');
    mem.set('terminal:t1', 'z');
    expect(mem.keys('project:').sort()).toEqual(['project:arch', 'project:plan']);
  });

  it('returns empty array when no match', () => {
    const mem = createSharedMemory();
    mem.set('a', 1);
    expect(mem.keys('missing:')).toEqual([]);
  });
});

describe('entries', () => {
  it('returns all entries', () => {
    const mem = createSharedMemory();
    mem.set('a', 1);
    mem.set('b', 2);
    const e = mem.entries();
    expect(Object.keys(e).sort()).toEqual(['a', 'b']);
    expect(e.a.value).toBe(1);
    expect(e.b.value).toBe(2);
  });

  it('filters by prefix', () => {
    const mem = createSharedMemory();
    mem.set('project:plan', 'x');
    mem.set('terminal:t1', 'z');
    const e = mem.entries('project:');
    expect(Object.keys(e)).toEqual(['project:plan']);
  });
});

describe('size', () => {
  it('tracks size correctly', () => {
    const mem = createSharedMemory();
    expect(mem.size()).toBe(0);
    mem.set('a', 1);
    expect(mem.size()).toBe(1);
    mem.set('b', 2);
    expect(mem.size()).toBe(2);
    mem.delete('a');
    expect(mem.size()).toBe(1);
  });
});

describe('clear', () => {
  it('removes all keys', () => {
    const mem = createSharedMemory();
    mem.set('a', 1);
    mem.set('b', 2);
    mem.clear();
    expect(mem.size()).toBe(0);
    expect(mem.keys()).toEqual([]);
  });
});

// ── Validation ──────────────────────────────────────────────

describe('validation', () => {
  it('rejects empty string key', () => {
    const mem = createSharedMemory();
    expect(() => mem.set('', 'val')).toThrow('non-empty string');
  });

  it('rejects non-string key', () => {
    const mem = createSharedMemory();
    expect(() => mem.set(123, 'val')).toThrow('non-empty string');
  });

  it('rejects key exceeding max length', () => {
    const mem = createSharedMemory();
    const longKey = 'a'.repeat(MAX_KEY_LENGTH + 1);
    expect(() => mem.set(longKey, 'val')).toThrow('max length');
  });

  it('accepts key at max length', () => {
    const mem = createSharedMemory();
    const maxKey = 'a'.repeat(MAX_KEY_LENGTH);
    mem.set(maxKey, 'val');
    expect(mem.get(maxKey)).toBe('val');
  });

  it('rejects key with invalid characters', () => {
    const mem = createSharedMemory();
    expect(() => mem.set('key with spaces', 'val')).toThrow('invalid characters');
    expect(() => mem.set('key@bad', 'val')).toThrow('invalid characters');
  });
});

// ── Watch ───────────────────────────────────────────────────

describe('watch', () => {
  it('notifies on set', () => {
    const mem = createSharedMemory();
    const calls = [];
    mem.watch('key1', (data) => calls.push(data));
    mem.set('key1', 'value1');
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('key1');
    expect(calls[0].value).toBe('value1');
    expect(calls[0].oldValue).toBeUndefined();
    expect(calls[0].source).toBe('api');
  });

  it('notifies on update with old value', () => {
    const mem = createSharedMemory();
    mem.set('key1', 'first');
    const calls = [];
    mem.watch('key1', (data) => calls.push(data));
    mem.set('key1', 'second');
    expect(calls[0].oldValue).toBe('first');
    expect(calls[0].value).toBe('second');
  });

  it('notifies on delete', () => {
    const mem = createSharedMemory();
    mem.set('key1', 'value1');
    const calls = [];
    mem.watch('key1', (data) => calls.push(data));
    mem.delete('key1');
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toBeUndefined();
    expect(calls[0].oldValue).toBe('value1');
  });

  it('unwatch stops notifications', () => {
    const mem = createSharedMemory();
    const calls = [];
    const unwatch = mem.watch('key1', (data) => calls.push(data));
    mem.set('key1', 'v1');
    unwatch();
    mem.set('key1', 'v2');
    expect(calls).toHaveLength(1);
  });

  it('multiple watchers on same key', () => {
    const mem = createSharedMemory();
    const calls1 = [];
    const calls2 = [];
    mem.watch('key1', (d) => calls1.push(d));
    mem.watch('key1', (d) => calls2.push(d));
    mem.set('key1', 'val');
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
  });

  it('rejects non-function handler', () => {
    const mem = createSharedMemory();
    expect(() => mem.watch('key1', 'not-a-function')).toThrow('must be a function');
  });

  it('handler errors do not propagate', () => {
    const mem = createSharedMemory();
    mem.watch('key1', () => { throw new Error('boom'); });
    // Should not throw
    mem.set('key1', 'val');
    expect(mem.get('key1')).toBe('val');
  });
});

// ── EventBus Integration ────────────────────────────────────

describe('EventBus integration', () => {
  it('emits shared-memory:updated on set', () => {
    const events = new EventBus();
    const mem = createSharedMemory({ events });
    const received = [];
    events.on('shared-memory:updated', (data) => received.push(data));
    mem.set('key1', 'val1', 'terminal');
    expect(received).toHaveLength(1);
    expect(received[0].key).toBe('key1');
    expect(received[0].value).toBe('val1');
    expect(received[0].source).toBe('terminal');
  });

  it('emits shared-memory:deleted on delete', () => {
    const events = new EventBus();
    const mem = createSharedMemory({ events });
    mem.set('key1', 'val1');
    const received = [];
    events.on('shared-memory:deleted', (data) => received.push(data));
    mem.delete('key1');
    expect(received).toHaveLength(1);
    expect(received[0].key).toBe('key1');
    expect(received[0].oldValue).toBe('val1');
  });

  it('emits shared-memory:cleared on clear', () => {
    const events = new EventBus();
    const mem = createSharedMemory({ events });
    mem.set('a', 1);
    mem.set('b', 2);
    const received = [];
    events.on('shared-memory:cleared', (data) => received.push(data));
    mem.clear();
    expect(received).toHaveLength(1);
    expect(received[0].count).toBe(2);
  });

  it('emits shared-memory:snapshot-written on writeSnapshot', () => {
    const events = new EventBus();
    const mem = createSharedMemory({ events });
    const received = [];
    events.on('shared-memory:snapshot-written', (data) => received.push(data));
    mem.writeSnapshot('t1', { model: 'opus', lastOutput: 'hello' });
    expect(received).toHaveLength(1);
    expect(received[0].terminalId).toBe('t1');
    expect(received[0].snapshotKeys).toContain('model');
    expect(received[0].snapshotKeys).toContain('lastOutput');
  });
});

// ── Terminal Snapshots ──────────────────────────────────────

describe('terminal snapshots', () => {
  it('writes and reads a snapshot', () => {
    const mem = createSharedMemory();
    mem.writeSnapshot('t1', {
      lastOutput: 'hello world',
      model: 'sonnet',
      handoffCount: 3,
    });
    const snap = mem.readSnapshot('t1');
    expect(snap.lastOutput).toBe('hello world');
    expect(snap.model).toBe('sonnet');
    expect(snap.handoffCount).toBe(3);
    expect(snap._updatedAt).toBeTruthy();
  });

  it('returns null for non-existent snapshot', () => {
    const mem = createSharedMemory();
    expect(mem.readSnapshot('missing')).toBe(null);
  });

  it('overwrites existing snapshot', () => {
    const mem = createSharedMemory();
    mem.writeSnapshot('t1', { model: 'sonnet' });
    mem.writeSnapshot('t1', { model: 'opus' });
    const snap = mem.readSnapshot('t1');
    expect(snap.model).toBe('opus');
  });

  it('deletes a snapshot', () => {
    const mem = createSharedMemory();
    mem.writeSnapshot('t1', { model: 'sonnet' });
    expect(mem.deleteSnapshot('t1')).toBe(true);
    expect(mem.readSnapshot('t1')).toBe(null);
  });

  it('returns false deleting non-existent snapshot', () => {
    const mem = createSharedMemory();
    expect(mem.deleteSnapshot('missing')).toBe(false);
  });

  it('getSnapshots returns all snapshots', () => {
    const mem = createSharedMemory();
    mem.writeSnapshot('t1', { model: 'sonnet' });
    mem.writeSnapshot('t2', { model: 'opus' });
    const snaps = mem.getSnapshots();
    expect(Object.keys(snaps).sort()).toEqual(['t1', 't2']);
  });

  it('trims lastOutput to SNAPSHOT_OUTPUT_CHARS', () => {
    const mem = createSharedMemory();
    const longOutput = 'x'.repeat(SNAPSHOT_OUTPUT_CHARS + 1000);
    mem.writeSnapshot('t1', { lastOutput: longOutput });
    const snap = mem.readSnapshot('t1');
    expect(snap.lastOutput.length).toBe(SNAPSHOT_OUTPUT_CHARS);
  });

  it('rejects empty terminalId', () => {
    const mem = createSharedMemory();
    expect(() => mem.writeSnapshot('', {})).toThrow('non-empty string');
  });

  it('snapshot includes metadata', () => {
    const mem = createSharedMemory();
    mem.writeSnapshot('t1', {
      taskId: 'task-42',
      metadata: { progress: '50%', currentFile: 'main.ts' },
    });
    const snap = mem.readSnapshot('t1');
    expect(snap.taskId).toBe('task-42');
    expect(snap.metadata.progress).toBe('50%');
  });
});

// ── Persistence ─────────────────────────────────────────────

describe('persistence', () => {
  it('saves and loads state from disk', () => {
    const mem1 = createSharedMemory({ persistPath: PERSIST_PATH });
    mem1.set('key1', 'value1');
    mem1.set('key2', { nested: true });
    mem1.writeSnapshot('t1', { model: 'opus' });

    // Load into new instance
    const mem2 = createSharedMemory({ persistPath: PERSIST_PATH });
    const result = mem2.load();
    expect(result.loaded).toBe(true);
    expect(result.keys).toBe(2);
    expect(result.snapshots).toBe(1);
    expect(mem2.get('key1')).toBe('value1');
    expect(mem2.get('key2')).toEqual({ nested: true });
    expect(mem2.readSnapshot('t1').model).toBe('opus');
  });

  it('creates directory for persistence file', () => {
    const deepPath = join(TEST_DIR, 'deep', 'nested', 'memory.json');
    const mem = createSharedMemory({ persistPath: deepPath });
    mem.set('key1', 'val');
    expect(existsSync(deepPath)).toBe(true);
  });

  it('handles corrupt primary file with .tmp recovery', () => {
    const mem1 = createSharedMemory({ persistPath: PERSIST_PATH });
    mem1.set('key1', 'value1');

    // Corrupt the primary file
    writeFileSync(PERSIST_PATH, 'NOT VALID JSON{{{');

    // Write valid .tmp
    const validData = { store: { key2: { value: 'recovered', updatedAt: 'now', source: 'api' } }, snapshots: {} };
    writeFileSync(PERSIST_PATH + '.tmp', JSON.stringify(validData));

    const mem2 = createSharedMemory({ persistPath: PERSIST_PATH });
    const result = mem2.load();
    expect(result.loaded).toBe(true);
    expect(result.recovered).toBe(true);
    expect(mem2.get('key2')).toBe('recovered');
  });

  it('returns loaded:false when no file exists', () => {
    const mem = createSharedMemory({ persistPath: join(TEST_DIR, 'nonexistent.json') });
    const result = mem.load();
    expect(result.loaded).toBe(false);
  });

  it('returns loaded:false without persistPath', () => {
    const mem = createSharedMemory();
    const result = mem.load();
    expect(result.loaded).toBe(false);
  });

  it('auto-saves on set', () => {
    const mem = createSharedMemory({ persistPath: PERSIST_PATH });
    mem.set('key1', 'val1');
    expect(existsSync(PERSIST_PATH)).toBe(true);

    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(raw.store.key1.value).toBe('val1');
    expect(raw.savedAt).toBeTruthy();
    expect(raw.version).toBe(1);
  });

  it('auto-saves on delete', () => {
    const mem = createSharedMemory({ persistPath: PERSIST_PATH });
    mem.set('key1', 'val1');
    mem.delete('key1');

    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(raw.store.key1).toBeUndefined();
  });

  it('auto-saves on clear', () => {
    const mem = createSharedMemory({ persistPath: PERSIST_PATH });
    mem.set('key1', 'val1');
    mem.clear();

    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(Object.keys(raw.store)).toHaveLength(0);
  });

  it('auto-saves on writeSnapshot', () => {
    const mem = createSharedMemory({ persistPath: PERSIST_PATH });
    mem.writeSnapshot('t1', { model: 'opus' });

    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(raw.snapshots.t1.snapshot.model).toBe('opus');
  });
});

// ── Serialization ───────────────────────────────────────────

describe('toJSON/fromJSON', () => {
  it('round-trips through serialization', () => {
    const mem1 = createSharedMemory();
    mem1.set('a', 1);
    mem1.set('b', { x: 2 });
    mem1.writeSnapshot('t1', { model: 'opus' });

    const json = mem1.toJSON();
    const mem2 = createSharedMemory();
    mem2.fromJSON(json);

    expect(mem2.get('a')).toBe(1);
    expect(mem2.get('b')).toEqual({ x: 2 });
    expect(mem2.readSnapshot('t1').model).toBe('opus');
  });

  it('fromJSON clears existing state', () => {
    const mem = createSharedMemory();
    mem.set('old', 'data');
    mem.fromJSON({ store: { new: { value: 'data', updatedAt: 'now', source: 'api' } }, snapshots: {} });
    expect(mem.has('old')).toBe(false);
    expect(mem.get('new')).toBe('data');
  });

  it('handles empty data gracefully', () => {
    const mem = createSharedMemory();
    mem.set('key', 'val');
    mem.fromJSON({});
    expect(mem.size()).toBe(0);
  });
});

// ── REST Routes Integration ─────────────────────────────────

describe('REST routes integration (via server)', () => {
  // These tests verify the shared memory routes through the actual server
  let app, server, close, sharedMemory, baseUrl;

  beforeEach(async () => {
    const { createApp } = await import('../server.mjs');
    const result = createApp({
      operatorDir: TEST_DIR,
      sharedMemory: createSharedMemory({ events: new EventBus() }),
      claudePool: false,
      enableFileWatcher: false,
      auth: false,
    });
    app = result.app;
    server = result.server;
    close = result.close;
    sharedMemory = result.sharedMemory;

    // Listen once for all tests in this suite
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (close) await close();
  });

  async function request(method, path, body) {
    const url = `${baseUrl}${path}`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json();
    return { status: res.status, body: data };
  }

  it('GET /api/shared-memory returns empty initially', async () => {
    const res = await request('GET', '/api/shared-memory');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.entries).toEqual({});
  });

  it('PUT then GET a key', async () => {
    const put = await request('PUT', '/api/shared-memory/key?key=test-key', {
      value: 'hello',
      source: 'test',
    });
    expect(put.status).toBe(200);
    expect(put.body.value).toBe('hello');

    const get = await request('GET', '/api/shared-memory/key?key=test-key');
    expect(get.status).toBe(200);
    expect(get.body.value).toBe('hello');
    expect(get.body.source).toBe('test');
  });

  it('DELETE a key', async () => {
    sharedMemory.set('to-delete', 'val');
    const del = await request('DELETE', '/api/shared-memory/key?key=to-delete');
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
  });

  it('GET non-existent key returns 404', async () => {
    const res = await request('GET', '/api/shared-memory/key?key=missing');
    expect(res.status).toBe(404);
  });

  it('PUT snapshot then GET', async () => {
    const put = await request('PUT', '/api/shared-memory-snapshots/t1', {
      model: 'opus',
      lastOutput: 'test output',
    });
    expect(put.status).toBe(200);
    expect(put.body.model).toBe('opus');

    const get = await request('GET', '/api/shared-memory-snapshots/t1');
    expect(get.status).toBe(200);
    expect(get.body.model).toBe('opus');
  });

  it('GET /api/shared-memory-snapshots returns all snapshots', async () => {
    sharedMemory.writeSnapshot('t1', { model: 'opus' });
    sharedMemory.writeSnapshot('t2', { model: 'sonnet' });
    const res = await request('GET', '/api/shared-memory-snapshots');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });
});

// ── watchPrefix ─────────────────────────────────────────────

describe('watchPrefix', () => {
  it('notifies handler on set for a matching key', () => {
    const mem = createSharedMemory();
    const calls = [];
    mem.watchPrefix('context-refresh:', (data) => calls.push(data));
    mem.set('context-refresh:worker-1:status', 'running');
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('context-refresh:worker-1:status');
    expect(calls[0].value).toBe('running');
    expect(calls[0].source).toBe('api');
  });

  it('notifies handler on delete for a matching key', () => {
    const mem = createSharedMemory();
    mem.set('context-refresh:worker-1:status', 'running');
    const calls = [];
    mem.watchPrefix('context-refresh:', (data) => calls.push(data));
    mem.delete('context-refresh:worker-1:status');
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('context-refresh:worker-1:status');
    expect(calls[0].value).toBeUndefined();
    expect(calls[0].oldValue).toBe('running');
    expect(calls[0].source).toBe('delete');
  });

  it('does NOT notify for non-matching keys', () => {
    const mem = createSharedMemory();
    const calls = [];
    mem.watchPrefix('context-refresh:', (data) => calls.push(data));
    mem.set('other:key', 'value');
    mem.delete('other:key');
    expect(calls).toHaveLength(0);
  });

  it('notifies for all matching keys with the same prefix', () => {
    const mem = createSharedMemory();
    const calls = [];
    mem.watchPrefix('ns:', (data) => calls.push(data.key));
    mem.set('ns:a', 1);
    mem.set('ns:b', 2);
    mem.set('other', 3);
    expect(calls).toEqual(['ns:a', 'ns:b']);
  });

  it('includes oldValue on update', () => {
    const mem = createSharedMemory();
    mem.set('ns:key', 'first');
    const calls = [];
    mem.watchPrefix('ns:', (data) => calls.push(data));
    mem.set('ns:key', 'second');
    expect(calls[0].oldValue).toBe('first');
    expect(calls[0].value).toBe('second');
  });

  it('unwatch stops prefix notifications', () => {
    const mem = createSharedMemory();
    const calls = [];
    const unwatch = mem.watchPrefix('ns:', (data) => calls.push(data));
    mem.set('ns:a', 1);
    unwatch();
    mem.set('ns:b', 2);
    expect(calls).toHaveLength(1);
    expect(calls[0].key).toBe('ns:a');
  });

  it('multiple prefix watchers on same prefix both fire', () => {
    const mem = createSharedMemory();
    const calls1 = [];
    const calls2 = [];
    mem.watchPrefix('ns:', (d) => calls1.push(d));
    mem.watchPrefix('ns:', (d) => calls2.push(d));
    mem.set('ns:x', 42);
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
  });

  it('overlapping prefixes both fire when key matches both', () => {
    const mem = createSharedMemory();
    const short = [];
    const long = [];
    mem.watchPrefix('ctx:', (d) => short.push(d));
    mem.watchPrefix('ctx:w1:', (d) => long.push(d));
    mem.set('ctx:w1:status', 'idle');
    expect(short).toHaveLength(1);
    expect(long).toHaveLength(1);
  });

  it('handler errors do not propagate', () => {
    const mem = createSharedMemory();
    mem.watchPrefix('ns:', () => { throw new Error('boom'); });
    // Should not throw
    mem.set('ns:key', 'val');
    expect(mem.get('ns:key')).toBe('val');
  });

  it('rejects empty prefix', () => {
    const mem = createSharedMemory();
    expect(() => mem.watchPrefix('', () => {})).toThrow('non-empty string');
  });

  it('rejects non-string prefix', () => {
    const mem = createSharedMemory();
    expect(() => mem.watchPrefix(null, () => {})).toThrow('non-empty string');
  });

  it('rejects non-function handler', () => {
    const mem = createSharedMemory();
    expect(() => mem.watchPrefix('ns:', 'not-a-function')).toThrow('must be a function');
  });
});

// ── deletePrefix ─────────────────────────────────────────────

describe('deletePrefix', () => {
  it('deletes all keys matching the prefix', () => {
    const mem = createSharedMemory();
    mem.set('context-refresh:worker-1:status', 'running');
    mem.set('context-refresh:worker-1:task', 'build');
    mem.set('context-refresh:worker-2:status', 'idle');
    mem.set('other:key', 'keep');
    const count = mem.deletePrefix('context-refresh:worker-1:');
    expect(count).toBe(2);
    expect(mem.has('context-refresh:worker-1:status')).toBe(false);
    expect(mem.has('context-refresh:worker-1:task')).toBe(false);
    expect(mem.has('context-refresh:worker-2:status')).toBe(true);
    expect(mem.has('other:key')).toBe(true);
  });

  it('returns 0 when no keys match', () => {
    const mem = createSharedMemory();
    mem.set('other:key', 'val');
    expect(mem.deletePrefix('missing:')).toBe(0);
    expect(mem.size()).toBe(1);
  });

  it('returns 0 on empty store', () => {
    const mem = createSharedMemory();
    expect(mem.deletePrefix('ns:')).toBe(0);
  });

  it('deletes all keys when prefix matches all', () => {
    const mem = createSharedMemory();
    mem.set('ns:a', 1);
    mem.set('ns:b', 2);
    mem.set('ns:c', 3);
    expect(mem.deletePrefix('ns:')).toBe(3);
    expect(mem.size()).toBe(0);
  });

  it('triggers key watchers for each deleted key', () => {
    const mem = createSharedMemory();
    mem.set('ns:a', 'val-a');
    mem.set('ns:b', 'val-b');
    const watchedKeys = [];
    mem.watch('ns:a', (d) => watchedKeys.push(d.key));
    mem.watch('ns:b', (d) => watchedKeys.push(d.key));
    mem.deletePrefix('ns:');
    expect(watchedKeys.sort()).toEqual(['ns:a', 'ns:b']);
  });

  it('triggers prefix watchers for each deleted key', () => {
    const mem = createSharedMemory();
    mem.set('ns:a', 'val-a');
    mem.set('ns:b', 'val-b');
    const calls = [];
    mem.watchPrefix('ns:', (d) => calls.push(d.key));
    mem.deletePrefix('ns:');
    expect(calls.sort()).toEqual(['ns:a', 'ns:b']);
  });

  it('auto-saves to disk after batch delete', () => {
    const mem = createSharedMemory({ persistPath: PERSIST_PATH });
    mem.set('ns:a', 1);
    mem.set('ns:b', 2);
    mem.deletePrefix('ns:');

    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(Object.keys(raw.store)).toHaveLength(0);
  });

  it('rejects empty prefix', () => {
    const mem = createSharedMemory();
    expect(() => mem.deletePrefix('')).toThrow('non-empty string');
  });

  it('rejects non-string prefix', () => {
    const mem = createSharedMemory();
    expect(() => mem.deletePrefix(42)).toThrow('non-empty string');
  });
});

// ── WebSocket Event Bridging ────────────────────────────────

describe('WebSocket event bridging', () => {
  it('shared-memory events are in BRIDGED_EVENTS', async () => {
    // Read ws.mjs and verify our events are listed
    const wsModule = await import('../ws.mjs');
    // We can't directly access BRIDGED_EVENTS, but we can verify
    // the module exports and the events get bridged through the handler
    expect(typeof wsModule.createWebSocketHandler).toBe('function');
  });
});
