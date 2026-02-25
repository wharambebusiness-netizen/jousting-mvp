// Global Search Tests (Phase 46)
import { describe, it, expect, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';
import { createSearchEngine } from '../search.mjs';
import { createSearchRoutes } from '../routes/search.mjs';
import { createTaskQueue } from '../coordination/task-queue.mjs';
import { createTerminalMessageBus } from '../terminal-messages.mjs';
import { createSharedMemory } from '../shared-memory.mjs';

// ── Helpers ─────────────────────────────────────────────────

function makeCoordinator(taskQueue) {
  return { taskQueue };
}

function makeAuditLog(entries = []) {
  return {
    query: (opts = {}) => {
      let result = [...entries];
      if (opts.action) result = result.filter(e => e.action === opts.action);
      if (opts.since) result = result.filter(e => e.ts >= opts.since);
      if (opts.until) result = result.filter(e => e.ts <= opts.until);
      result.reverse();
      const total = result.length;
      const off = opts.offset || 0;
      const lim = opts.limit || 50;
      return { entries: result.slice(off, off + lim), total };
    },
  };
}

function makeRegistry(chains = []) {
  return {
    load: () => ({ version: 1, chains }),
  };
}

function makeClaudePool(terminals = []) {
  return {
    getStatus: () => terminals,
  };
}

function makeRequest(app, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}${path}`;
      fetch(url)
        .then(r => r.json().then(data => ({ status: r.status, data })))
        .then(result => { server.close(); resolve(result); })
        .catch(err => { server.close(); reject(err); });
    });
  });
}

// ── Search Engine Tests ─────────────────────────────────────

describe('createSearchEngine', () => {
  let tq, coord, mb, sm, auditLog, registry, pool;

  beforeEach(() => {
    tq = createTaskQueue();
    coord = makeCoordinator(tq);
    mb = createTerminalMessageBus();
    sm = createSharedMemory();
    auditLog = makeAuditLog();
    registry = makeRegistry();
    pool = makeClaudePool();
  });

  // ── getSources ────────────────────────────────────────

  it('getSources returns available sources', () => {
    const engine = createSearchEngine({ coordinator: coord, messageBus: mb, auditLog, registry, claudePool: pool, sharedMemory: sm });
    const sources = engine.getSources();
    expect(sources).toContain('tasks');
    expect(sources).toContain('messages');
    expect(sources).toContain('audit');
    expect(sources).toContain('chains');
    expect(sources).toContain('terminals');
    expect(sources).toContain('memory');
    expect(sources.length).toBe(6);
  });

  it('missing subsystem excluded from sources', () => {
    const engine = createSearchEngine({ coordinator: coord });
    const sources = engine.getSources();
    expect(sources).toContain('tasks');
    expect(sources).not.toContain('messages');
    expect(sources).not.toContain('audit');
    expect(sources).not.toContain('chains');
    expect(sources).not.toContain('terminals');
    expect(sources).not.toContain('memory');
  });

  it('all subsystems null returns empty sources', () => {
    const engine = createSearchEngine({});
    expect(engine.getSources()).toEqual([]);
  });

  // ── search: tasks ─────────────────────────────────────

  it('search finds task by description', () => {
    tq.add({ id: 't1', task: 'Fix authentication bug', priority: 5 });
    tq.add({ id: 't2', task: 'Write tests for parser', priority: 3 });
    const engine = createSearchEngine({ coordinator: coord });
    const result = engine.search('authentication');
    expect(result.results.length).toBe(1);
    expect(result.results[0].source).toBe('tasks');
    expect(result.results[0].id).toBe('t1');
    expect(result.results[0].title).toContain('authentication');
  });

  // ── search: messages ──────────────────────────────────

  it('search finds message by content', () => {
    mb.send({ from: 'term-1', to: 'term-2', content: 'Please review the deployment script' });
    mb.send({ from: 'term-2', to: 'term-1', content: 'Done with the review' });
    const engine = createSearchEngine({ messageBus: mb });
    const result = engine.search('deployment');
    expect(result.results.length).toBe(1);
    expect(result.results[0].source).toBe('messages');
    expect(result.results[0].snippet).toContain('deployment');
  });

  // ── search: audit ─────────────────────────────────────

  it('search finds audit entry by action', () => {
    const entries = [
      { ts: '2026-01-15T10:00:00Z', action: 'terminal.spawn', actor: 'user1', target: 't1', detail: null },
      { ts: '2026-01-15T11:00:00Z', action: 'task.complete', actor: 'user2', target: 't2', detail: null },
    ];
    const al = makeAuditLog(entries);
    const engine = createSearchEngine({ auditLog: al });
    const result = engine.search('terminal.spawn');
    expect(result.results.length).toBe(1);
    expect(result.results[0].source).toBe('audit');
    expect(result.results[0].title).toBe('terminal.spawn');
  });

  // ── search: chains ────────────────────────────────────

  it('search finds chain by task description', () => {
    const chains = [
      { id: 'c1', task: 'Implement user profile page', status: 'running', startedAt: '2026-01-10T00:00:00Z', updatedAt: '2026-01-10T01:00:00Z' },
      { id: 'c2', task: 'Fix CSS layout on mobile', status: 'complete', startedAt: '2026-01-11T00:00:00Z', updatedAt: '2026-01-11T01:00:00Z' },
    ];
    const reg = makeRegistry(chains);
    const engine = createSearchEngine({ registry: reg });
    const result = engine.search('profile');
    expect(result.results.length).toBe(1);
    expect(result.results[0].source).toBe('chains');
    expect(result.results[0].id).toBe('c1');
  });

  // ── search: terminals ─────────────────────────────────

  it('search finds terminal by ID', () => {
    const terminals = [
      { id: 'claude-alpha', status: 'running', model: 'sonnet', capabilities: null, spawnedAt: '2026-01-15T00:00:00Z' },
      { id: 'claude-beta', status: 'stopped', model: 'opus', capabilities: ['code'], spawnedAt: '2026-01-15T01:00:00Z' },
    ];
    const cp = makeClaudePool(terminals);
    const engine = createSearchEngine({ claudePool: cp });
    const result = engine.search('alpha');
    expect(result.results.length).toBe(1);
    expect(result.results[0].source).toBe('terminals');
    expect(result.results[0].id).toBe('claude-alpha');
  });

  // ── search: memory ────────────────────────────────────

  it('search finds shared memory by key', () => {
    sm.set('project/config', { version: 2, name: 'jousting' }, 'test');
    sm.set('status/build', 'passing', 'test');
    const engine = createSearchEngine({ sharedMemory: sm });
    const result = engine.search('config');
    expect(result.results.length).toBe(1);
    expect(result.results[0].source).toBe('memory');
    expect(result.results[0].id).toBe('project/config');
  });

  // ── Scoring ───────────────────────────────────────────

  it('results sorted by score descending', () => {
    tq.add({ id: 't1', task: 'authentication', priority: 0 }); // exact in primary = 1.0
    sm.set('auth/token', 'authentication-data', 'test'); // contains in secondary = 0.5
    const engine = createSearchEngine({ coordinator: coord, sharedMemory: sm });
    const result = engine.search('authentication');
    expect(result.results.length).toBe(2);
    // Task has exact match in primary field: 1.0, memory match in secondary: 0.5
    expect(result.results[0].source).toBe('tasks');
    expect(result.results[0].score).toBeGreaterThanOrEqual(result.results[1].score);
  });

  it('exact match scores higher than partial', () => {
    tq.add({ id: 't1', task: 'auth', priority: 0 }); // exact
    tq.add({ id: 't2', task: 'authentication service', priority: 0 }); // partial
    const engine = createSearchEngine({ coordinator: coord });
    const result = engine.search('auth');
    expect(result.results.length).toBe(2);
    expect(result.results[0].id).toBe('t1'); // exact match first
    expect(result.results[0].score).toBeGreaterThan(result.results[1].score);
  });

  it('case-insensitive matching', () => {
    tq.add({ id: 't1', task: 'Fix Authentication Bug' });
    const engine = createSearchEngine({ coordinator: coord });
    const result = engine.search('fix authentication');
    expect(result.results.length).toBe(1);
    expect(result.results[0].id).toBe('t1');
  });

  // ── Options ───────────────────────────────────────────

  it('sources filter limits search scope', () => {
    tq.add({ id: 't1', task: 'deploy service' });
    sm.set('deploy/status', 'active', 'test');
    const engine = createSearchEngine({ coordinator: coord, sharedMemory: sm });
    const result = engine.search('deploy', { sources: ['memory'] });
    expect(result.results.length).toBe(1);
    expect(result.results[0].source).toBe('memory');
  });

  it('limit caps results', () => {
    for (let i = 0; i < 10; i++) {
      tq.add({ id: `t${i}`, task: `task item number ${i}` });
    }
    const engine = createSearchEngine({ coordinator: coord });
    const result = engine.search('task', { limit: 3 });
    expect(result.results.length).toBe(3);
    expect(result.total).toBe(10);
  });

  it('since/until date range filter', () => {
    tq.add({ id: 't-old', task: 'old task' });
    // Manually set createdAt for date range filtering
    const allTasks = tq.getAll();
    // Can't mutate directly — instead search with date range
    // Tasks are created with current timestamps, so use a future window
    const engine = createSearchEngine({ coordinator: coord });
    const futureDate = '2099-01-01T00:00:00Z';
    const result = engine.search('old', { since: futureDate });
    expect(result.results.length).toBe(0);
  });

  it('until filter excludes future entries', () => {
    tq.add({ id: 't1', task: 'recent task' });
    const engine = createSearchEngine({ coordinator: coord });
    const pastDate = '2020-01-01T00:00:00Z';
    const result = engine.search('recent', { until: pastDate });
    expect(result.results.length).toBe(0);
  });

  // ── Edge cases ────────────────────────────────────────

  it('empty query returns empty results', () => {
    tq.add({ id: 't1', task: 'something' });
    const engine = createSearchEngine({ coordinator: coord });
    const result = engine.search('');
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('no results returns empty array', () => {
    tq.add({ id: 't1', task: 'hello world' });
    const engine = createSearchEngine({ coordinator: coord });
    const result = engine.search('zzzznotfound');
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('multiple matches across sources combined', () => {
    tq.add({ id: 't1', task: 'deploy the service' });
    mb.send({ from: 'term-1', content: 'deploy started' });
    sm.set('deploy/log', 'deploy running', 'test');
    const engine = createSearchEngine({ coordinator: coord, messageBus: mb, sharedMemory: sm });
    const result = engine.search('deploy');
    expect(result.results.length).toBe(3);
    const sources = result.results.map(r => r.source);
    expect(sources).toContain('tasks');
    expect(sources).toContain('messages');
    expect(sources).toContain('memory');
  });

  it('snippet generation trims context around match', () => {
    const longText = 'A'.repeat(80) + ' search_term ' + 'B'.repeat(80);
    tq.add({ id: 't1', task: longText });
    const engine = createSearchEngine({ coordinator: coord });
    const result = engine.search('search_term');
    expect(result.results.length).toBe(1);
    expect(result.results[0].snippet).toContain('search_term');
    expect(result.results[0].snippet.length).toBeLessThan(longText.length);
  });

  it('score tiebreaker: newer entries first', () => {
    // Two tasks with same match quality, different timestamps
    const reg = makeRegistry([
      { id: 'c1', task: 'deploy alpha', status: 'running', startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'c2', task: 'deploy beta', status: 'running', startedAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
    ]);
    const engine = createSearchEngine({ registry: reg });
    const result = engine.search('deploy');
    expect(result.results.length).toBe(2);
    // Both partial matches: same score, but c2 is newer
    expect(result.results[0].id).toBe('c2');
    expect(result.results[1].id).toBe('c1');
  });

  it('all subsystems null returns empty results', () => {
    const engine = createSearchEngine({});
    const result = engine.search('anything');
    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.sources).toEqual([]);
  });
});

// ── Route Tests ─────────────────────────────────────────────

describe('search routes', () => {
  let tq, coord, engine;

  beforeEach(() => {
    tq = createTaskQueue();
    tq.add({ id: 't1', task: 'Fix login bug' });
    tq.add({ id: 't2', task: 'Add search feature' });
    coord = makeCoordinator(tq);
    engine = createSearchEngine({ coordinator: coord });
  });

  function buildApp(eng) {
    const app = express();
    app.use(express.json());
    app.use('/api', createSearchRoutes({ searchEngine: eng }));
    return app;
  }

  it('GET /api/search returns results', async () => {
    const app = buildApp(engine);
    const { status, data } = await makeRequest(app, '/api/search?q=login');
    expect(status).toBe(200);
    expect(data.results.length).toBe(1);
    expect(data.results[0].id).toBe('t1');
    expect(data.total).toBe(1);
    expect(data.sources).toContain('tasks');
  });

  it('GET /api/search/sources returns list', async () => {
    const app = buildApp(engine);
    const { status, data } = await makeRequest(app, '/api/search/sources');
    expect(status).toBe(200);
    expect(data.sources).toContain('tasks');
  });

  it('GET /api/search returns 400 on missing q param', async () => {
    const app = buildApp(engine);
    const { status, data } = await makeRequest(app, '/api/search');
    expect(status).toBe(400);
    expect(data.error).toContain('required');
  });

  it('GET /api/search returns 503 when engine is null', async () => {
    const app = buildApp(null);
    const { status, data } = await makeRequest(app, '/api/search?q=test');
    expect(status).toBe(503);
    expect(data.error).toContain('not available');
  });
});
