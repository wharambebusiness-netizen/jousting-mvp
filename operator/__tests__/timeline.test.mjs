// Timeline Tests (Phase 37)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import http from 'http';
import express from 'express';
import { createAuditLog } from '../audit-log.mjs';
import {
  createTimelineRoutes,
  ACTION_CATEGORY_MAP,
  CATEGORY_ACTIONS,
  generateSummary,
  categorizeAction,
} from '../routes/timeline.mjs';
import { renderTimeline, renderTimelineSummary } from '../views/timeline.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_timeline');
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

// ── Helper: create test server ──────────────────────────────

function createTestServer(auditLog) {
  const app = express();
  app.use(express.json());
  app.use('/api', createTimelineRoutes({ auditLog }));
  return app;
}

function startTestServer(auditLog) {
  const app = createTestServer(auditLog);
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ── Helper: seed entries with explicit timestamps ───────────

function seedEntries(auditLog, entries) {
  const lines = entries.map(e => JSON.stringify({
    ts: e.ts || new Date().toISOString(),
    action: e.action || null,
    actor: e.actor || null,
    target: e.target || null,
    detail: e.detail || null,
    reqId: e.reqId || null,
  }));
  mkdirSync(join(TEST_DIR, '.data'), { recursive: true });
  writeFileSync(PERSIST_PATH, lines.join('\n') + '\n', 'utf8');
}

// ── Timeline API ────────────────────────────────────────────

describe('GET /api/timeline', () => {
  let server;
  afterEach(() => { if (server) { server.close(); server = null; } });

  it('returns entries in reverse chronological order', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    seedEntries(auditLog, [
      { ts: '2026-02-25T10:00:00.000Z', action: 'terminal.spawn', target: 't1' },
      { ts: '2026-02-25T11:00:00.000Z', action: 'terminal.exit', target: 't2' },
      { ts: '2026-02-25T12:00:00.000Z', action: 'task.complete', target: 'task-1' },
    ]);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-25T00:00:00.000Z`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items.length).toBe(3);
    // Reverse chronological: task.complete first, terminal.exit second, terminal.spawn last
    expect(body.items[0].action).toBe('task.complete');
    expect(body.items[1].action).toBe('terminal.exit');
    expect(body.items[2].action).toBe('terminal.spawn');
  });

  it('filters by category', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    seedEntries(auditLog, [
      { ts: '2026-02-25T10:00:00.000Z', action: 'terminal.spawn', target: 't1' },
      { ts: '2026-02-25T11:00:00.000Z', action: 'task.complete', target: 'task-1' },
      { ts: '2026-02-25T12:00:00.000Z', action: 'terminal.exit', target: 't2' },
    ]);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-25T00:00:00.000Z&category=terminal`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items.length).toBe(2);
    expect(body.items.every(i => i.category === 'terminal')).toBe(true);
  });

  it('filters by time range (since/until)', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    seedEntries(auditLog, [
      { ts: '2026-02-20T10:00:00.000Z', action: 'terminal.spawn', target: 't1' },
      { ts: '2026-02-25T10:00:00.000Z', action: 'terminal.exit', target: 't2' },
      { ts: '2026-02-28T10:00:00.000Z', action: 'task.complete', target: 'task-1' },
    ]);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-24T00:00:00.000Z&until=2026-02-26T00:00:00.000Z`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items.length).toBe(1);
    expect(body.items[0].action).toBe('terminal.exit');
  });

  it('paginates with limit/offset', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    const entries = [];
    for (let i = 0; i < 10; i++) {
      entries.push({
        ts: `2026-02-25T${String(i).padStart(2, '0')}:00:00.000Z`,
        action: 'terminal.spawn',
        target: `t${i}`,
      });
    }
    seedEntries(auditLog, entries);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-25T00:00:00.000Z&limit=3&offset=2`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items.length).toBe(3);
    expect(body.total).toBe(10);
    expect(body.limit).toBe(3);
    expect(body.offset).toBe(2);
  });

  it('enriches entries with summary field', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    seedEntries(auditLog, [
      { ts: '2026-02-25T10:00:00.000Z', action: 'terminal.spawn', target: 'term-abc' },
    ]);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-25T00:00:00.000Z`);
    const body = await res.json();

    expect(body.items[0].summary).toBe('Terminal term-abc spawned');
  });

  it('enriches entries with category field', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    seedEntries(auditLog, [
      { ts: '2026-02-25T10:00:00.000Z', action: 'task.complete', target: 'task-99' },
    ]);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-25T00:00:00.000Z`);
    const body = await res.json();

    expect(body.items[0].category).toBe('task');
  });

  it('defaults since to last 24 hours', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    const now = new Date();
    const recentTs = new Date(now.getTime() - 3600 * 1000).toISOString(); // 1 hour ago
    const oldTs = new Date(now.getTime() - 48 * 3600 * 1000).toISOString(); // 2 days ago
    seedEntries(auditLog, [
      { ts: oldTs, action: 'terminal.spawn', target: 'old' },
      { ts: recentTs, action: 'terminal.exit', target: 'recent' },
    ]);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline`);
    const body = await res.json();

    expect(body.items.length).toBe(1);
    expect(body.items[0].target).toBe('recent');
  });

  it('returns empty timeline for empty audit log', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-25T00:00:00.000Z`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('response has hasMore pagination field', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    const entries = [];
    for (let i = 0; i < 5; i++) {
      entries.push({
        ts: `2026-02-25T${String(i).padStart(2, '0')}:00:00.000Z`,
        action: 'terminal.spawn',
        target: `t${i}`,
      });
    }
    seedEntries(auditLog, entries);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-25T00:00:00.000Z&limit=3`);
    const body = await res.json();

    expect(body.hasMore).toBe(true);

    const res2 = await fetch(`${result.baseUrl}/api/timeline?since=2026-02-25T00:00:00.000Z&limit=10`);
    const body2 = await res2.json();

    expect(body2.hasMore).toBe(false);
  });

  it('returns 503 when audit log not available', async () => {
    const result = await startTestServer(null);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline`);
    expect(res.status).toBe(503);
  });
});

// ── Summary Endpoint ────────────────────────────────────────

describe('GET /api/timeline/summary', () => {
  let server;
  afterEach(() => { if (server) { server.close(); server = null; } });

  it('returns correct counts per category', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });
    seedEntries(auditLog, [
      { ts: '2026-02-25T10:00:00.000Z', action: 'terminal.spawn' },
      { ts: '2026-02-25T10:01:00.000Z', action: 'terminal.exit' },
      { ts: '2026-02-25T10:02:00.000Z', action: 'task.complete' },
      { ts: '2026-02-25T10:03:00.000Z', action: 'swarm.start' },
      { ts: '2026-02-25T10:04:00.000Z', action: 'memory.write' },
    ]);

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline/summary?since=2026-02-25T00:00:00.000Z`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.terminal).toBe(2);
    expect(body.task).toBe(1);
    expect(body.swarm).toBe(1);
    expect(body.system).toBe(0);
    expect(body.memory).toBe(1);
    expect(body.total).toBe(5);
  });

  it('returns all zeros for empty log', async () => {
    const auditLog = createAuditLog({ persistPath: PERSIST_PATH });

    const result = await startTestServer(auditLog);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline/summary?since=2026-02-25T00:00:00.000Z`);
    const body = await res.json();

    expect(body.terminal).toBe(0);
    expect(body.task).toBe(0);
    expect(body.swarm).toBe(0);
    expect(body.system).toBe(0);
    expect(body.memory).toBe(0);
    expect(body.total).toBe(0);
  });

  it('returns 503 when audit log not available', async () => {
    const result = await startTestServer(null);
    server = result.server;

    const res = await fetch(`${result.baseUrl}/api/timeline/summary`);
    expect(res.status).toBe(503);
  });
});

// ── Summary Generation ──────────────────────────────────────

describe('generateSummary()', () => {
  it('terminal.spawn: "Terminal {target} spawned"', () => {
    expect(generateSummary({ action: 'terminal.spawn', target: 'abc' }))
      .toBe('Terminal abc spawned');
  });

  it('terminal.exit: "Terminal {target} exited"', () => {
    expect(generateSummary({ action: 'terminal.exit', target: 'xyz' }))
      .toBe('Terminal xyz exited');
  });

  it('task.complete: "Task {target} completed"', () => {
    expect(generateSummary({ action: 'task.complete', target: 'task-42' }))
      .toBe('Task task-42 completed');
  });

  it('task.fail: "Task {target} failed"', () => {
    expect(generateSummary({ action: 'task.fail', target: 'task-99' }))
      .toBe('Task task-99 failed');
  });

  it('swarm.start: "Swarm mode started"', () => {
    expect(generateSummary({ action: 'swarm.start' }))
      .toBe('Swarm mode started');
  });

  it('swarm.stop: "Swarm mode stopped"', () => {
    expect(generateSummary({ action: 'swarm.stop' }))
      .toBe('Swarm mode stopped');
  });

  it('coordinator.start: "Coordinator started"', () => {
    expect(generateSummary({ action: 'coordinator.start' }))
      .toBe('Coordinator started');
  });

  it('coordinator.stop: "Coordinator stopped"', () => {
    expect(generateSummary({ action: 'coordinator.stop' }))
      .toBe('Coordinator stopped');
  });

  it('memory.write: "Shared memory key \'{target}\' updated"', () => {
    expect(generateSummary({ action: 'memory.write', target: 'config/theme' }))
      .toBe("Shared memory key 'config/theme' updated");
  });
});

// ── Action-to-Category Mapping ──────────────────────────────

describe('categorizeAction()', () => {
  it('maps all known actions correctly', () => {
    expect(categorizeAction('terminal.spawn')).toBe('terminal');
    expect(categorizeAction('terminal.exit')).toBe('terminal');
    expect(categorizeAction('task.complete')).toBe('task');
    expect(categorizeAction('task.fail')).toBe('task');
    expect(categorizeAction('swarm.start')).toBe('swarm');
    expect(categorizeAction('swarm.stop')).toBe('swarm');
    expect(categorizeAction('coordinator.start')).toBe('system');
    expect(categorizeAction('coordinator.stop')).toBe('system');
    expect(categorizeAction('memory.write')).toBe('memory');
  });

  it('maps unknown actions to system category', () => {
    expect(categorizeAction('some.unknown.action')).toBe('system');
    expect(categorizeAction(undefined)).toBe('system');
    expect(categorizeAction(null)).toBe('system');
  });
});

// ── CATEGORY_ACTIONS mapping ────────────────────────────────

describe('CATEGORY_ACTIONS', () => {
  it('has entries for all 5 categories', () => {
    expect(Object.keys(CATEGORY_ACTIONS)).toEqual(
      expect.arrayContaining(['terminal', 'task', 'swarm', 'system', 'memory'])
    );
  });

  it('terminal category has spawn and exit', () => {
    expect(CATEGORY_ACTIONS.terminal).toContain('terminal.spawn');
    expect(CATEGORY_ACTIONS.terminal).toContain('terminal.exit');
  });

  it('task category has complete and fail', () => {
    expect(CATEGORY_ACTIONS.task).toContain('task.complete');
    expect(CATEGORY_ACTIONS.task).toContain('task.fail');
  });
});

// ── View Renderers ──────────────────────────────────────────

describe('renderTimeline()', () => {
  it('produces HTML with timeline-entry elements', () => {
    const entries = [
      { ts: '2026-02-25T10:00:00.000Z', action: 'terminal.spawn', target: 't1', category: 'terminal', summary: 'Terminal t1 spawned', detail: {} },
      { ts: '2026-02-25T11:00:00.000Z', action: 'task.complete', target: 'task-1', category: 'task', summary: 'Task task-1 completed', detail: {} },
    ];
    const html = renderTimeline(entries);

    expect(html).toContain('timeline-entry');
    expect(html).toContain('timeline-entry--terminal');
    expect(html).toContain('timeline-entry--task');
    expect(html).toContain('Terminal t1 spawned');
    expect(html).toContain('Task task-1 completed');
  });

  it('returns empty message for no entries', () => {
    const html = renderTimeline([]);
    expect(html).toContain('No activity');
  });

  it('returns empty message for null input', () => {
    const html = renderTimeline(null);
    expect(html).toContain('No activity');
  });

  it('groups entries by date', () => {
    const today = new Date().toISOString().slice(0, 10);
    const entries = [
      { ts: `${today}T10:00:00.000Z`, action: 'terminal.spawn', target: 't1', category: 'terminal', summary: 'Terminal t1 spawned', detail: {} },
    ];
    const html = renderTimeline(entries);
    expect(html).toContain('Today');
  });
});

describe('renderTimelineSummary()', () => {
  it('produces HTML with badge elements', () => {
    const counts = { terminal: 5, task: 3, swarm: 1, system: 2, memory: 4, total: 15 };
    const html = renderTimelineSummary(counts);

    expect(html).toContain('timeline-badge');
    expect(html).toContain('timeline-badge--terminal');
    expect(html).toContain('timeline-badge--task');
    expect(html).toContain('timeline-badge--swarm');
    expect(html).toContain('timeline-badge--system');
    expect(html).toContain('timeline-badge--memory');
    expect(html).toContain('Total: 15');
  });

  it('returns empty string for null input', () => {
    expect(renderTimelineSummary(null)).toBe('');
  });

  it('shows zero counts', () => {
    const counts = { terminal: 0, task: 0, swarm: 0, system: 0, memory: 0, total: 0 };
    const html = renderTimelineSummary(counts);
    expect(html).toContain('Total: 0');
  });
});
