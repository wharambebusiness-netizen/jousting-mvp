// Audit Log Tests (Phase 31)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import express from 'express';
import { createAuditLog, DEFAULT_MAX_ENTRIES } from '../audit-log.mjs';
import { createAuditRoutes } from '../routes/audit.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_audit_log');
const PERSIST_PATH = join(TEST_DIR, '.data', 'audit-log.jsonl');

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
  it('exports DEFAULT_MAX_ENTRIES', () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(10_000);
  });
});

// ── record() ────────────────────────────────────────────────

describe('record()', () => {
  it('appends to JSONL file with correct fields', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'terminal.spawn', actor: 'user1', target: 't1', detail: { foo: 1 }, reqId: 'req-1' });

    const raw = readFileSync(PERSIST_PATH, 'utf8').trim();
    const entry = JSON.parse(raw);
    expect(entry.ts).toBeTruthy();
    expect(entry.action).toBe('terminal.spawn');
    expect(entry.actor).toBe('user1');
    expect(entry.target).toBe('t1');
    expect(entry.detail).toEqual({ foo: 1 });
    expect(entry.reqId).toBe('req-1');
  });

  it('multiple entries create multiple lines', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'a1' });
    auditLog.record({ action: 'a2' });
    auditLog.record({ action: 'a3' });

    const lines = readFileSync(PERSIST_PATH, 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[0]).action).toBe('a1');
    expect(JSON.parse(lines[1]).action).toBe('a2');
    expect(JSON.parse(lines[2]).action).toBe('a3');
  });

  it('emits audit:recorded event on EventBus', () => {
    const events = new EventBus();
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, events });
    const recorded = [];
    events.on('audit:recorded', (data) => recorded.push(data));

    auditLog.record({ action: 'test.action', target: 'tgt' });

    expect(recorded.length).toBe(1);
    expect(recorded[0].action).toBe('test.action');
    expect(recorded[0].target).toBe('tgt');
  });

  it('null-fills missing optional fields', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'minimal' });

    const entry = JSON.parse(readFileSync(PERSIST_PATH, 'utf8').trim());
    expect(entry.actor).toBeNull();
    expect(entry.target).toBeNull();
    expect(entry.detail).toBeNull();
    expect(entry.reqId).toBeNull();
  });
});

// ── query() ─────────────────────────────────────────────────

describe('query()', () => {
  it('returns entries in reverse chronological order', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'first' });
    auditLog.record({ action: 'second' });
    auditLog.record({ action: 'third' });

    const { entries } = auditLog.query();
    expect(entries[0].action).toBe('third');
    expect(entries[1].action).toBe('second');
    expect(entries[2].action).toBe('first');
  });

  it('filters by action', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'terminal.spawn' });
    auditLog.record({ action: 'terminal.exit' });
    auditLog.record({ action: 'terminal.spawn' });

    const { entries, total } = auditLog.query({ action: 'terminal.spawn' });
    expect(total).toBe(2);
    expect(entries.every(e => e.action === 'terminal.spawn')).toBe(true);
  });

  it('filters by actor', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'a', actor: 'alice' });
    auditLog.record({ action: 'b', actor: 'bob' });
    auditLog.record({ action: 'c', actor: 'alice' });

    const { entries, total } = auditLog.query({ actor: 'alice' });
    expect(total).toBe(2);
    expect(entries.every(e => e.actor === 'alice')).toBe(true);
  });

  it('filters by target', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'a', target: 't1' });
    auditLog.record({ action: 'b', target: 't2' });
    auditLog.record({ action: 'c', target: 't1' });

    const { entries, total } = auditLog.query({ target: 't1' });
    expect(total).toBe(2);
    expect(entries.every(e => e.target === 't1')).toBe(true);
  });

  it('filters by time range (since/until)', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });

    // Write entries with explicit timestamps
    const lines = [
      JSON.stringify({ ts: '2025-01-01T00:00:00.000Z', action: 'old' }),
      JSON.stringify({ ts: '2025-06-15T00:00:00.000Z', action: 'mid' }),
      JSON.stringify({ ts: '2025-12-31T00:00:00.000Z', action: 'new' }),
    ];
    writeFileSync(PERSIST_PATH, lines.join('\n') + '\n', 'utf8');

    const { entries } = auditLog.query({
      since: '2025-03-01T00:00:00.000Z',
      until: '2025-09-01T00:00:00.000Z',
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('mid');
  });

  it('paginates with limit/offset', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    for (let i = 0; i < 10; i++) {
      auditLog.record({ action: `a${i}` });
    }

    // Reverse chronological: a9, a8, a7, a6, a5, a4, a3, a2, a1, a0
    const { entries, total } = auditLog.query({ limit: 3, offset: 2 });
    expect(total).toBe(10);
    expect(entries.length).toBe(3);
    expect(entries[0].action).toBe('a7');
    expect(entries[1].action).toBe('a6');
    expect(entries[2].action).toBe('a5');
  });

  it('returns total count independent of pagination', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    for (let i = 0; i < 20; i++) {
      auditLog.record({ action: 'bulk' });
    }

    const { entries, total } = auditLog.query({ limit: 5 });
    expect(entries.length).toBe(5);
    expect(total).toBe(20);
  });

  it('returns empty result for empty log', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    const { entries, total } = auditLog.query();
    expect(entries).toEqual([]);
    expect(total).toBe(0);
  });
});

// ── Auto-subscriptions ──────────────────────────────────────

describe('auto-subscriptions', () => {
  it('claude-terminal:spawned creates audit entry', () => {
    const events = new EventBus();
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, events });

    events.emit('claude-terminal:spawned', { terminalId: 'term-1' });

    const { entries } = auditLog.query();
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('terminal.spawn');
    expect(entries[0].target).toBe('term-1');
  });

  it('claude-terminal:task-completed creates audit entry', () => {
    const events = new EventBus();
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, events });

    events.emit('claude-terminal:task-completed', { taskId: 'task-42' });

    const { entries } = auditLog.query();
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('task.complete');
    expect(entries[0].target).toBe('task-42');
  });

  it('shared-memory:updated creates audit entry', () => {
    const events = new EventBus();
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, events });

    events.emit('shared-memory:updated', { key: 'config/theme' });

    const { entries } = auditLog.query();
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('memory.write');
    expect(entries[0].target).toBe('config/theme');
  });

  it('claude-terminal:exit creates audit entry', () => {
    const events = new EventBus();
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, events });

    events.emit('claude-terminal:exit', { terminalId: 'term-2', exitCode: 0 });

    const { entries } = auditLog.query();
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('terminal.exit');
    expect(entries[0].target).toBe('term-2');
  });

  it('coord:started creates audit entry', () => {
    const events = new EventBus();
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, events });

    events.emit('coord:started', {});

    const { entries } = auditLog.query();
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('coordinator.start');
  });

  it('coord:task-failed creates audit entry', () => {
    const events = new EventBus();
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, events });

    events.emit('coord:task-failed', { taskId: 'fail-1' });

    const { entries } = auditLog.query();
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('task.fail');
    expect(entries[0].target).toBe('fail-1');
  });
});

// ── rotate() ────────────────────────────────────────────────

describe('rotate()', () => {
  it('archives old file and starts fresh', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'before-rotate' });
    expect(auditLog.count()).toBe(1);

    auditLog.rotate();

    const rotatedPath = PERSIST_PATH.replace(/\.jsonl$/, '.1.jsonl');
    expect(existsSync(rotatedPath)).toBe(true);
    expect(auditLog.count()).toBe(0);

    // Rotated file has the original content
    const rotatedContent = readFileSync(rotatedPath, 'utf8').trim();
    expect(JSON.parse(rotatedContent).action).toBe('before-rotate');
  });

  it('deletes existing .1 file before renaming', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    const rotatedPath = PERSIST_PATH.replace(/\.jsonl$/, '.1.jsonl');

    // Create a pre-existing rotation
    mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
    writeFileSync(rotatedPath, '{"action":"very-old"}\n', 'utf8');

    auditLog.record({ action: 'current' });
    auditLog.rotate();

    // .1 should now have 'current', not 'very-old'
    const content = readFileSync(rotatedPath, 'utf8').trim();
    expect(JSON.parse(content).action).toBe('current');
  });
});

// ── maxEntries auto-rotation ────────────────────────────────

describe('maxEntries auto-rotation', () => {
  it('triggers auto-rotation when maxEntries exceeded', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, maxEntries: 5 });

    for (let i = 0; i < 6; i++) {
      auditLog.record({ action: `entry-${i}` });
    }

    // After 6th entry exceeds maxEntries=5, rotation happened
    // The 6th record triggers rotation: first 6 lines get rotated, then file is empty
    // But the 6th line was written before rotation check, so rotated file has 6 lines
    const rotatedPath = PERSIST_PATH.replace(/\.jsonl$/, '.1.jsonl');
    expect(existsSync(rotatedPath)).toBe(true);
    // After rotation, main file is empty (rotation renames it)
    expect(auditLog.count()).toBe(0);
  });
});

// ── destroy() ───────────────────────────────────────────────

describe('destroy()', () => {
  it('unwires EventBus listeners (emit after destroy creates no entries)', () => {
    const events = new EventBus();
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH, events });

    // Verify subscription works
    events.emit('claude-terminal:spawned', { terminalId: 'before' });
    expect(auditLog.count()).toBe(1);

    auditLog.destroy();

    // Emit after destroy — no new entry
    events.emit('claude-terminal:spawned', { terminalId: 'after' });
    expect(auditLog.count()).toBe(1);
  });
});

// ── stats() ─────────────────────────────────────────────────

describe('stats()', () => {
  it('returns correct per-action counts', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'terminal.spawn' });
    auditLog.record({ action: 'terminal.spawn' });
    auditLog.record({ action: 'terminal.exit' });
    auditLog.record({ action: 'task.complete' });

    const s = auditLog.stats();
    expect(s.total).toBe(4);
    expect(s.byAction['terminal.spawn']).toBe(2);
    expect(s.byAction['terminal.exit']).toBe(1);
    expect(s.byAction['task.complete']).toBe(1);
  });

  it('returns dateRange with oldest and newest', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'first' });
    auditLog.record({ action: 'last' });

    const s = auditLog.stats();
    expect(s.dateRange.oldest).toBeTruthy();
    expect(s.dateRange.newest).toBeTruthy();
    expect(s.dateRange.oldest <= s.dateRange.newest).toBe(true);
  });

  it('returns null dateRange for empty log', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    const s = auditLog.stats();
    expect(s.total).toBe(0);
    expect(s.dateRange.oldest).toBeNull();
    expect(s.dateRange.newest).toBeNull();
  });
});

// ── Corrupt JSONL ───────────────────────────────────────────

describe('corrupt JSONL handling', () => {
  it('skips corrupt lines during query (no crash)', () => {
    mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
    const content = [
      '{"ts":"2025-01-01T00:00:00.000Z","action":"good1"}',
      'NOT VALID JSON {{{',
      '{"ts":"2025-01-02T00:00:00.000Z","action":"good2"}',
      '',
      '{"ts":"2025-01-03T00:00:00.000Z","action":"good3"}',
    ].join('\n') + '\n';
    writeFileSync(PERSIST_PATH, content, 'utf8');

    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    const { entries, total } = auditLog.query();
    expect(total).toBe(3);
    expect(entries.every(e => e.action.startsWith('good'))).toBe(true);
  });
});

// ── count() ─────────────────────────────────────────────────

describe('count()', () => {
  it('returns number of entries', () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    expect(auditLog.count()).toBe(0);
    auditLog.record({ action: 'x' });
    expect(auditLog.count()).toBe(1);
    auditLog.record({ action: 'y' });
    expect(auditLog.count()).toBe(2);
  });
});

// ── Routes ──────────────────────────────────────────────────

describe('audit routes', () => {
  let server, baseUrl;

  function startTestServer(auditLog) {
    const app = express();
    app.use(express.json());
    app.use('/api', createAuditRoutes({ auditLog }));
    return new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  afterEach(() => {
    if (server) { server.close(); server = null; }
  });

  it('GET /api/audit returns entries', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'terminal.spawn', target: 'r1' });
    auditLog.record({ action: 'terminal.exit', target: 'r2' });
    await startTestServer(auditLog);

    const res = await fetch(`${baseUrl}/api/audit`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.entries.length).toBe(2);
    expect(body.entries[0].action).toBe('terminal.exit'); // reverse chron
  });

  it('GET /api/audit with query params filters', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'terminal.spawn' });
    auditLog.record({ action: 'terminal.exit' });
    auditLog.record({ action: 'terminal.spawn' });
    await startTestServer(auditLog);

    const res = await fetch(`${baseUrl}/api/audit?action=terminal.spawn`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.entries.every(e => e.action === 'terminal.spawn')).toBe(true);
  });

  it('GET /api/audit/stats returns stats', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    auditLog.record({ action: 'terminal.spawn' });
    auditLog.record({ action: 'terminal.spawn' });
    auditLog.record({ action: 'task.complete' });
    await startTestServer(auditLog);

    const res = await fetch(`${baseUrl}/api/audit/stats`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.byAction['terminal.spawn']).toBe(2);
    expect(body.byAction['task.complete']).toBe(1);
    expect(body.dateRange.oldest).toBeTruthy();
  });

  it('GET /api/audit returns 503 when auditLog is null', async () => {
    await startTestServer(null);
    const res = await fetch(`${baseUrl}/api/audit`);
    expect(res.status).toBe(503);
  });
});
