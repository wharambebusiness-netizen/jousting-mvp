// File Watcher tests (P9)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createFileWatcher } from '../file-watcher.mjs';

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_filewatcher');

function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

function createMockEvents() {
  const emitted = [];
  return {
    emit(event, data) { emitted.push({ event, data }); },
    on() {},
    emitted,
  };
}

// ── shouldIgnore (via watchProject behavior) ──────────────────

describe('File Watcher — Creation & State', () => {
  let watcher;
  let events;

  beforeEach(() => {
    setup();
    events = createMockEvents();
    watcher = createFileWatcher(events);
  });

  afterEach(() => {
    if (watcher) watcher.unwatchAll();
    teardown();
  });

  it('watchProject starts watching a valid directory', () => {
    watcher.watchProject(TEST_DIR);
    expect(watcher.isWatching(TEST_DIR)).toBe(true);
    expect(watcher.watchedDirs().length).toBe(1);
  });

  it('watchProject is idempotent (no duplicate watchers)', () => {
    watcher.watchProject(TEST_DIR);
    watcher.watchProject(TEST_DIR);
    expect(watcher.watchedDirs().length).toBe(1);
  });

  it('watchProject ignores null/undefined', () => {
    watcher.watchProject(null);
    watcher.watchProject(undefined);
    expect(watcher.watchedDirs().length).toBe(0);
  });

  it('watchProject ignores "(default)" string', () => {
    watcher.watchProject('(default)');
    expect(watcher.watchedDirs().length).toBe(0);
  });

  it('watchProject ignores nonexistent directory', () => {
    watcher.watchProject(join(TEST_DIR, 'does-not-exist'));
    expect(watcher.watchedDirs().length).toBe(0);
  });

  it('isWatching returns false for unwatched directory', () => {
    expect(watcher.isWatching(TEST_DIR)).toBe(false);
  });

  it('watchedDirs returns empty array initially', () => {
    expect(watcher.watchedDirs()).toEqual([]);
  });

  it('watchedDirs returns watched paths with forward slashes', () => {
    watcher.watchProject(TEST_DIR);
    const dirs = watcher.watchedDirs();
    expect(dirs.length).toBe(1);
    expect(dirs[0]).not.toContain('\\');
  });
});

describe('File Watcher — Unwatch', () => {
  let watcher;
  let events;

  beforeEach(() => {
    setup();
    events = createMockEvents();
    watcher = createFileWatcher(events);
  });

  afterEach(() => {
    if (watcher) watcher.unwatchAll();
    teardown();
  });

  it('unwatchProject removes a watched directory', () => {
    watcher.watchProject(TEST_DIR);
    expect(watcher.isWatching(TEST_DIR)).toBe(true);
    watcher.unwatchProject(TEST_DIR);
    expect(watcher.isWatching(TEST_DIR)).toBe(false);
    expect(watcher.watchedDirs().length).toBe(0);
  });

  it('unwatchProject is safe to call for unwatched dir', () => {
    expect(() => watcher.unwatchProject(TEST_DIR)).not.toThrow();
  });

  it('unwatchAll removes all watchers', () => {
    const subA = join(TEST_DIR, 'a');
    const subB = join(TEST_DIR, 'b');
    mkdirSync(subA);
    mkdirSync(subB);
    watcher.watchProject(subA);
    watcher.watchProject(subB);
    expect(watcher.watchedDirs().length).toBe(2);
    watcher.unwatchAll();
    expect(watcher.watchedDirs().length).toBe(0);
    expect(watcher.isWatching(subA)).toBe(false);
    expect(watcher.isWatching(subB)).toBe(false);
  });

  it('unwatchAll is safe to call when empty', () => {
    expect(() => watcher.unwatchAll()).not.toThrow();
  });
});

describe('File Watcher — Event Emission', () => {
  let watcher;
  let events;

  beforeEach(() => {
    setup();
    events = createMockEvents();
    watcher = createFileWatcher(events);
  });

  afterEach(() => {
    if (watcher) watcher.unwatchAll();
    teardown();
  });

  it('emits project:files-changed after file write (with debounce)', async () => {
    watcher.watchProject(TEST_DIR);

    // Write a file to trigger the watcher
    writeFileSync(join(TEST_DIR, 'test.txt'), 'hello');

    // Wait for debounce (1s) + buffer
    await new Promise(r => setTimeout(r, 1500));

    const fileEvents = events.emitted.filter(e => e.event === 'project:files-changed');
    expect(fileEvents.length).toBeGreaterThanOrEqual(1);
    expect(fileEvents[0].data.projectDir).toBe(resolve(TEST_DIR).replace(/\\/g, '/'));
    expect(fileEvents[0].data.timestamp).toBeDefined();
  });

  it('debounces rapid changes into single event', async () => {
    watcher.watchProject(TEST_DIR);

    // Rapid writes
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(TEST_DIR, `file${i}.txt`), `content ${i}`);
    }

    // Wait for debounce to fire
    await new Promise(r => setTimeout(r, 1500));

    const fileEvents = events.emitted.filter(e => e.event === 'project:files-changed');
    // Should be exactly 1 due to debounce (all changes within 1s window)
    expect(fileEvents.length).toBe(1);
  });

  it('does not emit events for ignored paths (node_modules)', async () => {
    const nmDir = join(TEST_DIR, 'node_modules');
    mkdirSync(nmDir);
    watcher.watchProject(TEST_DIR);

    writeFileSync(join(nmDir, 'pkg.json'), '{}');

    // Wait for potential debounce
    await new Promise(r => setTimeout(r, 1500));

    const fileEvents = events.emitted.filter(e => e.event === 'project:files-changed');
    expect(fileEvents.length).toBe(0);
  });

  it('does not emit events after unwatchProject', async () => {
    watcher.watchProject(TEST_DIR);
    watcher.unwatchProject(TEST_DIR);

    writeFileSync(join(TEST_DIR, 'after-unwatch.txt'), 'hello');

    await new Promise(r => setTimeout(r, 1500));

    const fileEvents = events.emitted.filter(e => e.event === 'project:files-changed');
    expect(fileEvents.length).toBe(0);
  });
});
