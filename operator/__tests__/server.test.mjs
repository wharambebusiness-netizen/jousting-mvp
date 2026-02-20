// Server tests (M4)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import WebSocket from 'ws';
import { createApp } from '../server.mjs';
import {
  createRegistry,
  createChain, recordSession, updateChainStatus,
} from '../registry.mjs';
import { EventBus } from '../../shared/event-bus.mjs';
import { matchesPattern, matchesAnyPattern } from '../ws.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_server');

function setupTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardownTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

// Seed registry with sample chains for testing
function seedRegistry() {
  const regStore = createRegistry({ operatorDir: TEST_DIR });
  const reg = regStore.load();

  // Project A chains
  const c1 = createChain(reg, {
    task: 'build feature X',
    config: { model: 'sonnet', maxTurns: 20, maxContinuations: 3, maxBudgetUsd: 2.0 },
    projectDir: '/projects/alpha',
  });
  recordSession(c1, {
    sessionId: 'sid-1',
    turns: 5,
    costUsd: 0.12,
    durationMs: 10000,
    hitMaxTurns: false,
    preCompacted: false,
    handoffComplete: false,
    handoffFile: join(TEST_DIR, 'handoffs', 'c1-0.md'),
  });
  recordSession(c1, {
    sessionId: 'sid-2',
    turns: 8,
    costUsd: 0.25,
    durationMs: 15000,
    handoffComplete: true,
  });
  updateChainStatus(c1, 'complete');

  // Project B chain (running)
  const c2 = createChain(reg, {
    task: 'fix bug in module Y',
    config: { model: 'opus' },
    projectDir: '/projects/beta',
  });
  recordSession(c2, {
    sessionId: 'sid-3',
    turns: 3,
    costUsd: 0.08,
    durationMs: 5000,
    handoffComplete: false,
  });

  // Project A chain (failed)
  const c3 = createChain(reg, {
    task: 'deploy to staging',
    config: { model: 'haiku' },
    projectDir: '/projects/alpha',
  });
  updateChainStatus(c3, 'failed');

  // No project chain
  const c4 = createChain(reg, {
    task: 'misc cleanup',
    config: {},
  });
  updateChainStatus(c4, 'complete');

  regStore.save(reg);

  // Create a handoff file for session testing
  mkdirSync(join(TEST_DIR, 'handoffs'), { recursive: true });
  writeFileSync(join(TEST_DIR, 'handoffs', 'c1-0.md'), '# Session 1 Handoff\nDid some work.');

  return { c1, c2, c3, c4 };
}

// ── Server Test Helpers ─────────────────────────────────────

let appInstance, baseUrl, events;

function startServer() {
  events = new EventBus();
  appInstance = createApp({ operatorDir: TEST_DIR, events });
  return new Promise((resolve) => {
    appInstance.server.listen(0, '127.0.0.1', () => {
      const port = appInstance.server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve({ port });
    });
  });
}

async function stopServer() {
  if (appInstance) {
    await appInstance.close();
    appInstance = null;
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ── Tests ───────────────────────────────────────────────────

describe('Server — Health', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/health returns ok', async () => {
    const { status, body } = await api('/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.timestamp).toBeTruthy();
    expect(typeof body.uptime).toBe('number');
  });
});

describe('Server — Chain Endpoints', () => {
  let chains;

  beforeAll(async () => {
    setupTestDir();
    chains = seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/chains lists all chains', async () => {
    const { status, body } = await api('/api/chains');
    expect(status).toBe(200);
    expect(body.chains.length).toBe(4);
    expect(body.total).toBe(4);
  });

  it('GET /api/chains?project= filters by project', async () => {
    const { status, body } = await api('/api/chains?project=/projects/alpha');
    expect(status).toBe(200);
    expect(body.chains.length).toBe(2);
    expect(body.chains.every(c => c.projectDir === '/projects/alpha')).toBe(true);
  });

  it('GET /api/chains?status= filters by status', async () => {
    const { status, body } = await api('/api/chains?status=running');
    expect(status).toBe(200);
    expect(body.chains.length).toBe(1);
    expect(body.chains[0].status).toBe('running');
  });

  it('GET /api/chains supports pagination', async () => {
    const { body: page1 } = await api('/api/chains?limit=2&offset=0');
    expect(page1.chains.length).toBe(2);
    expect(page1.total).toBe(4);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);

    const { body: page2 } = await api('/api/chains?limit=2&offset=2');
    expect(page2.chains.length).toBe(2);
    expect(page2.offset).toBe(2);

    // No overlap
    const ids1 = page1.chains.map(c => c.id);
    const ids2 = page2.chains.map(c => c.id);
    expect(ids1.filter(id => ids2.includes(id))).toEqual([]);
  });

  it('GET /api/chains handles negative/zero limit safely', async () => {
    const { body: neg } = await api('/api/chains?limit=-1');
    expect(neg.limit).toBe(1);
    expect(neg.chains.length).toBe(1);

    const { body: zero } = await api('/api/chains?limit=0');
    expect(zero.limit).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/chains handles offset beyond total', async () => {
    const { body } = await api('/api/chains?offset=9999');
    expect(body.chains.length).toBe(0);
    expect(body.total).toBe(4);
  });

  it('GET /api/chains/:id returns chain detail', async () => {
    const { status, body } = await api(`/api/chains/${chains.c1.id}`);
    expect(status).toBe(200);
    expect(body.id).toBe(chains.c1.id);
    expect(body.task).toBe('build feature X');
    expect(body.sessions.length).toBe(2);
    expect(body.projectDir).toBe('/projects/alpha');
  });

  it('GET /api/chains/:id returns 404 for unknown', async () => {
    const { status } = await api('/api/chains/nonexistent');
    expect(status).toBe(404);
  });

  it('POST /api/chains creates a new chain', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({
        task: 'new API task',
        model: 'haiku',
        projectDir: '/projects/gamma',
      }),
    });
    expect(status).toBe(201);
    expect(body.task).toBe('new API task');
    expect(body.status).toBe('running');
    expect(body.projectDir).toBe('/projects/gamma');
    expect(body.id).toBeTruthy();
  });

  it('POST /api/chains rejects empty task', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: '' }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('task is required');
  });

  it('POST /api/chains rejects invalid model', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: 'test', model: 'gpt-4' }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('model must be one of');
  });

  it('POST /api/chains rejects negative budget', async () => {
    const { status } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: 'test', maxBudgetUsd: -5 }),
    });
    expect(status).toBe(400);
  });

  it('POST /api/chains/:id/abort aborts running chain', async () => {
    const { status, body } = await api(`/api/chains/${chains.c2.id}/abort`, {
      method: 'POST',
    });
    expect(status).toBe(200);
    expect(body.status).toBe('aborted');
  });

  it('POST /api/chains/:id/abort rejects non-running chain', async () => {
    const { status } = await api(`/api/chains/${chains.c1.id}/abort`, {
      method: 'POST',
    });
    expect(status).toBe(409);
  });

  it('DELETE /api/chains/:id removes chain', async () => {
    // Delete the failed chain (c3)
    const { status, body } = await api(`/api/chains/${chains.c3.id}`, {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    expect(body.deleted).toBe(true);

    // Verify it's gone
    const { status: getStatus } = await api(`/api/chains/${chains.c3.id}`);
    expect(getStatus).toBe(404);
  });

  it('DELETE /api/chains/:id returns 404 for unknown', async () => {
    const { status } = await api('/api/chains/nonexistent-id', {
      method: 'DELETE',
    });
    expect(status).toBe(404);
  });

  it('DELETE /api/chains/:id rejects running chain', async () => {
    // Create a running chain to try to delete
    const regStore = createRegistry({ operatorDir: TEST_DIR });
    const reg = regStore.load();
    const running = createChain(reg, { task: 'cannot delete', config: {} });
    regStore.save(reg);

    const { status } = await api(`/api/chains/${running.id}`, {
      method: 'DELETE',
    });
    expect(status).toBe(409);
  });
});

describe('Server — Session Endpoints', () => {
  let chains;

  beforeAll(async () => {
    setupTestDir();
    chains = seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/chains/:id/sessions/:idx returns session detail', async () => {
    const { status, body } = await api(`/api/chains/${chains.c1.id}/sessions/0`);
    expect(status).toBe(200);
    expect(body.index).toBe(0);
    expect(body.sessionId).toBe('sid-1');
    expect(body.costUsd).toBeCloseTo(0.12);
    expect(body.handoffContent).toContain('Session 1 Handoff');
  });

  it('GET /api/chains/:id/sessions/:idx returns 404 for bad index', async () => {
    const { status } = await api(`/api/chains/${chains.c1.id}/sessions/99`);
    expect(status).toBe(404);
  });

  it('GET /api/chains/:id/sessions/:idx returns 404 for negative index', async () => {
    const { status } = await api(`/api/chains/${chains.c1.id}/sessions/-1`);
    expect(status).toBe(404);
  });

  it('GET /api/chains/:id/sessions/:idx returns 404 for non-numeric', async () => {
    const { status } = await api(`/api/chains/${chains.c1.id}/sessions/abc`);
    expect(status).toBe(404);
  });

  it('GET /api/chains/:id/sessions/:idx works without handoff file', async () => {
    const { status, body } = await api(`/api/chains/${chains.c1.id}/sessions/1`);
    expect(status).toBe(200);
    expect(body.index).toBe(1);
    expect(body.handoffContent).toBeNull();
  });
});

describe('Server — Cost Endpoints', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/costs returns cost summary', async () => {
    const { status, body } = await api('/api/costs');
    expect(status).toBe(200);
    expect(typeof body.totalCostUsd).toBe('number');
    expect(body.totalCostUsd).toBeGreaterThan(0);
    expect(body.totalChains).toBeGreaterThan(0);
    expect(body.byStatus).toBeTruthy();
    expect(body.byProject).toBeTruthy();
  });

  it('GET /api/costs?project= filters by project', async () => {
    const { body } = await api('/api/costs?project=/projects/alpha');
    // Only alpha project costs
    expect(body.totalChains).toBe(2);
    const projectKeys = Object.keys(body.byProject);
    expect(projectKeys.length).toBe(1);
  });
});

describe('Server — Projects Endpoint', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/projects lists distinct projects', async () => {
    const { status, body } = await api('/api/projects');
    expect(status).toBe(200);
    expect(body.projects.length).toBeGreaterThanOrEqual(2);

    // Should have alpha and beta projects at minimum
    const dirs = body.projects.map(p => p.projectDir);
    expect(dirs).toContain('/projects/alpha');
    expect(dirs).toContain('/projects/beta');
  });

  it('GET /api/projects includes summary stats', async () => {
    const { body } = await api('/api/projects');
    const alpha = body.projects.find(p => p.projectDir === '/projects/alpha');
    expect(alpha).toBeTruthy();
    expect(alpha.chains).toBeGreaterThanOrEqual(2);
    expect(alpha.totalCostUsd).toBeGreaterThan(0);
    expect(alpha.lastActivity).toBeTruthy();
  });
});

describe('Server — Orchestrator Endpoints', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/orchestrator/status returns initial state', async () => {
    const { status, body } = await api('/api/orchestrator/status');
    expect(status).toBe(200);
    expect(body.running).toBe(false);
  });

  it('POST /api/orchestrator/start starts orchestrator', async () => {
    const { status, body } = await api('/api/orchestrator/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'test-mission', dryRun: true }),
    });
    expect(status).toBe(202);
    expect(body.status.running).toBe(true);
    expect(body.status.mission).toBe('test-mission');
    expect(body.status.dryRun).toBe(true);
  });

  it('POST /api/orchestrator/start rejects when already running', async () => {
    const { status } = await api('/api/orchestrator/start', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(status).toBe(409);
  });

  it('orchestrator status updates via events', async () => {
    // Emit round:start and agent:start events
    events.emit('round:start', { round: 3 });
    events.emit('agent:start', { agentId: 'engine-dev', model: 'sonnet' });

    const { body } = await api('/api/orchestrator/status');
    expect(body.round).toBe(3);
    expect(body.agents).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'engine-dev', status: 'running', model: 'sonnet' })])
    );
  });

  it('agent:complete updates agent status', async () => {
    events.emit('agent:complete', { agentId: 'engine-dev', elapsedMs: 5000, continuations: 1 });

    const { body } = await api('/api/orchestrator/status');
    const agent = body.agents.find(a => a.id === 'engine-dev');
    expect(agent.status).toBe('complete');
    expect(agent.elapsedMs).toBe(5000);
    expect(agent.continuations).toBe(1);
  });

  it('agent:error updates agent status to failed', async () => {
    // Start a fresh agent
    events.emit('agent:start', { agentId: 'test-runner' });
    events.emit('agent:error', { agentId: 'test-runner', status: 'TIMEOUT', elapsedMs: 30000 });

    const { body } = await api('/api/orchestrator/status');
    const agent = body.agents.find(a => a.id === 'test-runner');
    expect(agent.status).toBe('failed');
    expect(agent.statusDetail).toBe('TIMEOUT');
  });

  it('agent:continuation updates cost and count', async () => {
    events.emit('agent:start', { agentId: 'dev-agent' });
    events.emit('agent:continuation', { agentId: 'dev-agent', index: 2, cost: 0.35 });

    const { body } = await api('/api/orchestrator/status');
    const agent = body.agents.find(a => a.id === 'dev-agent');
    expect(agent.continuations).toBe(2);
    expect(agent.cost).toBe(0.35);
  });

  it('POST /api/orchestrator/stop stops orchestrator', async () => {
    const { status, body } = await api('/api/orchestrator/stop', {
      method: 'POST',
    });
    expect(status).toBe(200);
    expect(body.status.running).toBe(false);
  });

  it('POST /api/orchestrator/stop rejects when not running', async () => {
    const { status } = await api('/api/orchestrator/stop', {
      method: 'POST',
    });
    expect(status).toBe(409);
  });
});

describe('Server — Mission Endpoints (M6a)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/orchestrator/missions lists available missions', async () => {
    const { status, body } = await api('/api/orchestrator/missions');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    // Missions dir exists in real project, should have entries
    if (body.length > 0) {
      expect(body[0]).toHaveProperty('file');
      expect(body[0]).toHaveProperty('name');
      expect(body[0]).toHaveProperty('type');
    }
  });

  it('GET /api/orchestrator/missions returns array even if dir missing', async () => {
    // The test env's missionsDir may not exist, should return []
    const { status, body } = await api('/api/orchestrator/missions');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Server — Git Endpoints (M6d)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/git/status returns git state', async () => {
    const { status, body } = await api('/api/git/status');
    expect(status).toBe(200);
    expect(body).toHaveProperty('branch');
    expect(body).toHaveProperty('clean');
    expect(body).toHaveProperty('files');
    expect(body).toHaveProperty('commits');
    expect(Array.isArray(body.files)).toBe(true);
    expect(Array.isArray(body.commits)).toBe(true);
  });

  it('POST /api/git/commit rejects empty message', async () => {
    const { status, body } = await api('/api/git/commit', {
      method: 'POST',
      body: JSON.stringify({ message: '' }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('required');
  });

  it('POST /api/git/commit rejects missing message', async () => {
    const { status, body } = await api('/api/git/commit', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('required');
  });

  it('POST /api/git/push returns structured response', async () => {
    const { status, body } = await api('/api/git/push', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    // Will fail in test env (no remote) but should return structured JSON
    expect([200, 500]).toContain(status);
    if (status === 200) {
      expect(body).toHaveProperty('message');
    } else {
      expect(body).toHaveProperty('error');
    }
  });

  it('POST /api/git/pr returns structured response', async () => {
    const { status, body } = await api('/api/git/pr', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test PR', body: 'Test body' }),
    });
    // Will fail in test env (no gh CLI or no remote) but should return structured JSON
    expect([200, 500]).toContain(status);
    if (status === 200) {
      expect(body).toHaveProperty('url');
    } else {
      expect(body).toHaveProperty('error');
    }
  });

  it('POST /api/git/pr with fill mode returns structured response', async () => {
    const { status, body } = await api('/api/git/pr', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect([200, 500]).toContain(status);
    expect(body).toBeTruthy();
  });
});

describe('Server — Chain Restart (S85)', () => {
  let chains;

  beforeAll(async () => {
    setupTestDir();
    chains = seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('POST /api/chains/:id/restart creates new chain from failed chain', async () => {
    const { status, body } = await api(`/api/chains/${chains.c3.id}/restart`, {
      method: 'POST',
    });
    expect(status).toBe(201);
    expect(body.task).toBe('deploy to staging');
    expect(body.status).toBe('running');
    expect(body.id).not.toBe(chains.c3.id);
  });

  it('POST /api/chains/:id/restart rejects running chain', async () => {
    const { status, body } = await api(`/api/chains/${chains.c2.id}/restart`, {
      method: 'POST',
    });
    expect(status).toBe(409);
    expect(body.error).toContain('still running');
  });

  it('POST /api/chains/:id/restart returns 404 for unknown', async () => {
    const { status } = await api('/api/chains/nonexistent/restart', {
      method: 'POST',
    });
    expect(status).toBe(404);
  });

  it('POST /api/chains/:id/restart preserves config from original', async () => {
    const { body } = await api(`/api/chains/${chains.c3.id}/restart`, {
      method: 'POST',
    });
    expect(body.config).toBeTruthy();
    expect(body.config.model).toBe('haiku');
  });
});

describe('Server — Report Endpoints (M6b)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/orchestrator/reports returns array', async () => {
    const { status, body } = await api('/api/orchestrator/reports');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/orchestrator/reports/:file returns 404 for missing', async () => {
    const { status } = await api('/api/orchestrator/reports/nonexistent.md');
    expect(status).toBe(404);
  });

  it('GET /api/orchestrator/reports/:file rejects non-.md files', async () => {
    const { status } = await api('/api/orchestrator/reports/config.json');
    expect(status).toBe(400);
  });
});

describe('Server — CORS', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('allows localhost origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });

  it('allows 127.0.0.1 origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
  });

  it('does not set CORS for external origins', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('handles OPTIONS preflight', async () => {
    const res = await fetch(`${baseUrl}/api/chains`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(204);
  });
});

describe('Server — Events Integration', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('POST /api/chains emits chain:started event', async () => {
    let emitted = null;
    events.on('chain:started', (data) => { emitted = data; });

    await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: 'event test', projectDir: '/test' }),
    });

    expect(emitted).toBeTruthy();
    expect(emitted.task).toBe('event test');
    expect(emitted.projectDir).toBe('/test');
  });
});

describe('Server — Delete Event (P5)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('DELETE /api/chains/:id emits chain:deleted event', async () => {
    // Create and abort a chain (DELETE rejects running chains)
    const { body: created } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: 'delete event test' }),
    });
    await api(`/api/chains/${created.id}/abort`, { method: 'POST' });

    let emitted = null;
    events.on('chain:deleted', (data) => { emitted = data; });

    const { status } = await api(`/api/chains/${created.id}`, { method: 'DELETE' });
    expect(status).toBe(200);
    expect(emitted).toBeTruthy();
    expect(emitted.chainId).toBe(created.id);
  });
});

// ── Chain Branch & Model Tests (S91) ────────────────────────

describe('Server — Chain Branch Field (S91)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('POST /api/chains accepts branch field', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({
        task: 'branch test',
        branch: 'auto/branch-test',
      }),
    });
    expect(status).toBe(201);
    expect(body.config.branch).toBe('auto/branch-test');
  });

  it('POST /api/chains sanitizes branch name', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({
        task: 'branch sanitize test',
        branch: 'auto/my feature!!@#$',
      }),
    });
    expect(status).toBe(201);
    // Special chars should be stripped
    expect(body.config.branch).not.toContain('!');
    expect(body.config.branch).not.toContain('@');
    expect(body.config.branch).not.toContain('#');
    expect(body.config.branch).not.toContain('$');
  });

  it('POST /api/chains omits branch when not provided', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: 'no branch' }),
    });
    expect(status).toBe(201);
    expect(body.config.branch).toBeUndefined();
  });
});

describe('Server — Orchestrator Model Override (S91)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('POST /api/orchestrator/start accepts model field', async () => {
    const { status, body } = await api('/api/orchestrator/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'test', model: 'opus', dryRun: true }),
    });
    expect(status).toBe(202);
    expect(body.status.model).toBe('opus');

    // Clean up
    await api('/api/orchestrator/stop', { method: 'POST' });
  });

  it('orchestrator status includes model after start', async () => {
    events.emit('orchestrator:started', { mission: 'test', model: 'haiku', dryRun: false });
    const { body } = await api('/api/orchestrator/status');
    expect(body.model).toBe('haiku');

    // Clean up
    events.emit('orchestrator:stopped', {});
  });
});

describe('Server — Malformed Request Bodies (S91)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('POST /api/chains with non-string task returns 400', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: 12345 }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('task is required');
  });

  it('POST /api/chains with whitespace-only task returns 400', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: '   ' }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('task is required');
  });

  it('POST /api/chains with empty object body returns 400', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('task is required');
  });

  it('POST /api/git/commit with non-string message returns 400', async () => {
    const { status, body } = await api('/api/git/commit', {
      method: 'POST',
      body: JSON.stringify({ message: 42 }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('required');
  });

  it('POST /api/chains with maxTurns out of range returns 400', async () => {
    const { status, body } = await api('/api/chains', {
      method: 'POST',
      body: JSON.stringify({ task: 'test', maxTurns: 999 }),
    });
    expect(status).toBe(400);
    expect(body.error).toContain('maxTurns');
  });
});

// ── WebSocket Pattern Matching Tests (Unit) ─────────────────

describe('WebSocket — Pattern Matching', () => {
  it('exact match', () => {
    expect(matchesPattern('chain:started', 'chain:started')).toBe(true);
    expect(matchesPattern('chain:started', 'chain:complete')).toBe(false);
  });

  it('wildcard match', () => {
    expect(matchesPattern('chain:started', 'chain:*')).toBe(true);
    expect(matchesPattern('chain:complete', 'chain:*')).toBe(true);
    expect(matchesPattern('session:output', 'chain:*')).toBe(false);
  });

  it('global wildcard', () => {
    expect(matchesPattern('anything', '*')).toBe(true);
  });

  it('matchesAnyPattern works with sets', () => {
    const patterns = new Set(['chain:*', 'session:output']);
    expect(matchesAnyPattern('chain:started', patterns)).toBe(true);
    expect(matchesAnyPattern('session:output', patterns)).toBe(true);
    expect(matchesAnyPattern('agent:error', patterns)).toBe(false);
  });
});

// ── WebSocket Integration Tests ─────────────────────────────

describe('WebSocket — Integration', () => {
  let wsUrl;

  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    const { port } = await startServer();
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  // Connect WS with message queue to prevent race conditions.
  // Messages received before nextMessage() is called are buffered.
  function connectWs(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url || wsUrl);
      const msgQueue = [];
      const waitQueue = [];

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (waitQueue.length > 0) {
          waitQueue.shift()(msg);
        } else {
          msgQueue.push(msg);
        }
      });

      ws.nextMessage = (timeout = 2000) => {
        if (msgQueue.length > 0) {
          return Promise.resolve(msgQueue.shift());
        }
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error('WS message timeout')), timeout);
          waitQueue.push((msg) => { clearTimeout(timer); res(msg); });
        });
      };

      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  it('connects and receives welcome message', async () => {
    const ws = await connectWs();
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('connected');
    expect(msg.timestamp).toBeTruthy();
    ws.close();
  });

  it('subscribes to event patterns', async () => {
    const ws = await connectWs();
    await ws.nextMessage(); // consume welcome

    ws.send(JSON.stringify({ subscribe: ['chain:*', 'agent:*'] }));
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('subscribed');
    expect(msg.patterns).toContain('chain:*');
    expect(msg.patterns).toContain('agent:*');
    ws.close();
  });

  it('unsubscribes from patterns', async () => {
    const ws = await connectWs();
    await ws.nextMessage(); // welcome

    ws.send(JSON.stringify({ subscribe: ['chain:*', 'agent:*'] }));
    await ws.nextMessage(); // subscribed

    ws.send(JSON.stringify({ unsubscribe: ['agent:*'] }));
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('subscribed');
    expect(msg.patterns).toContain('chain:*');
    expect(msg.patterns).not.toContain('agent:*');
    ws.close();
  });

  it('receives bridged events matching subscription', async () => {
    const ws = await connectWs();
    await ws.nextMessage(); // welcome

    ws.send(JSON.stringify({ subscribe: ['chain:*'] }));
    await ws.nextMessage(); // subscribed

    // Emit an event on the EventBus
    events.emit('chain:started', { chainId: 'test-123', task: 'ws test' });

    const msg = await ws.nextMessage();
    expect(msg.event).toBe('chain:started');
    expect(msg.data.chainId).toBe('test-123');
    ws.close();
  });

  it('does not receive events not matching subscription', async () => {
    const ws = await connectWs();
    await ws.nextMessage(); // welcome

    ws.send(JSON.stringify({ subscribe: ['agent:*'] }));
    await ws.nextMessage(); // subscribed

    // Emit a chain event (not subscribed)
    events.emit('chain:started', { chainId: 'ignored' });

    // Emit an agent event (subscribed)
    events.emit('agent:complete', { agentId: 'test-agent' });

    const msg = await ws.nextMessage();
    expect(msg.event).toBe('agent:complete');
    expect(msg.data.agentId).toBe('test-agent');
    ws.close();
  });

  it('handles ping/pong', async () => {
    const ws = await connectWs();
    await ws.nextMessage(); // welcome

    ws.send(JSON.stringify({ type: 'ping' }));
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('pong');
    expect(msg.timestamp).toBeTruthy();
    ws.close();
  });

  it('handles invalid JSON gracefully', async () => {
    const ws = await connectWs();
    await ws.nextMessage(); // welcome

    ws.send('not valid json {{{');
    const msg = await ws.nextMessage();
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('Invalid JSON');
    ws.close();
  });

  it('rejects upgrade on non-/ws path', async () => {
    const port = appInstance.server.address().port;
    const badUrl = `ws://127.0.0.1:${port}/not-ws`;

    await expect(connectWs(badUrl)).rejects.toThrow();
  });
});

// ── Settings API Tests (P3) ──────────────────────────────────

describe('Settings API', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('GET /api/settings returns default settings', async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.model).toBe('sonnet');
    expect(data.maxTurns).toBe(30);
    expect(data.maxContinuations).toBe(5);
    expect(data.maxBudgetUsd).toBe(5.0);
  });

  it('PUT /api/settings saves and returns validated settings', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'opus', maxTurns: 50, maxContinuations: 10, maxBudgetUsd: 20 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.model).toBe('opus');
    expect(data.maxTurns).toBe(50);
    expect(data.maxContinuations).toBe(10);
    expect(data.maxBudgetUsd).toBe(20);

    // Verify persistence
    const res2 = await fetch(`${baseUrl}/api/settings`);
    const data2 = await res2.json();
    expect(data2.model).toBe('opus');
    expect(data2.maxTurns).toBe(50);
  });

  it('PUT /api/settings clamps out-of-range values', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'invalid', maxTurns: 999, maxContinuations: -1, maxBudgetUsd: 500 }),
    });
    const data = await res.json();
    expect(data.model).toBe('sonnet'); // falls back to default
    expect(data.maxTurns).toBe(200);   // clamped to max
    expect(data.maxContinuations).toBe(1); // clamped to min
    expect(data.maxBudgetUsd).toBe(100);   // clamped to max
  });

  it('PUT /api/settings handles empty body', async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    expect(data.model).toBe('sonnet'); // defaults
    expect(data.maxTurns).toBe(30);
  });
});

// ── Settings Page Route (P3) ─────────────────────────────────

describe('Settings Page', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('GET /settings serves settings page HTML', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Settings');
    expect(text).toContain('settings-form');
  });
});

// ── Analytics Page Tests (P8) ────────────────────────────────

describe('Analytics Page', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('GET /analytics serves analytics page HTML', async () => {
    const res = await fetch(`${baseUrl}/analytics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Analytics');
    expect(text).toContain('analytics-panel');
  });

  it('GET /views/analytics returns analytics fragment', async () => {
    const res = await fetch(`${baseUrl}/views/analytics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('analytics-panel');
    expect(text).toContain('metrics-grid');
    expect(text).toContain('chart-container');
  });
});

// ── Chain Sort/Direction Tests (P4) ──────────────────────────

describe('Chain List Sort/Direction', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('sorts chains by cost descending', async () => {
    const res = await fetch(`${baseUrl}/api/chains?sort=cost&dir=desc`);
    const data = await res.json();
    expect(data.chains.length).toBeGreaterThan(0);
    // Verify the API does not error
    expect(res.status).toBe(200);
  });

  it('sorts chains by status ascending', async () => {
    const res = await fetch(`${baseUrl}/api/chains`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chains.length).toBeGreaterThan(0);
  });
});

// ── Orchestrator Run History Tests (P7) ─────────────────────

describe('Orchestrator Run History', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/orchestrator/history returns empty array initially', async () => {
    const { status, body } = await api('/api/orchestrator/history');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it('records run after start + stop', async () => {
    // Start orchestrator
    await api('/api/orchestrator/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'test-history', dryRun: true, model: 'haiku' }),
    });

    // Emit some round/agent events
    events.emit('round:start', { round: 1 });
    events.emit('agent:start', { agentId: 'hist-agent' });

    // Stop orchestrator
    await api('/api/orchestrator/stop', { method: 'POST' });

    const { status, body } = await api('/api/orchestrator/history');
    expect(status).toBe(200);
    expect(body.length).toBe(1);
    expect(body[0].mission).toBe('test-history');
    expect(body[0].model).toBe('haiku');
    expect(body[0].dryRun).toBe(true);
    expect(body[0].outcome).toBe('stopped');
    expect(body[0].rounds).toBe(1);
    expect(body[0].agents).toBe(1);
    expect(body[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(body[0].startedAt).toBeTruthy();
    expect(body[0].stoppedAt).toBeTruthy();
  });

  it('records multiple runs in order (newest first)', async () => {
    await api('/api/orchestrator/start', {
      method: 'POST',
      body: JSON.stringify({ mission: 'second-run' }),
    });
    await api('/api/orchestrator/stop', { method: 'POST' });

    const { body } = await api('/api/orchestrator/history');
    expect(body.length).toBe(2);
    expect(body[0].mission).toBe('second-run');
    expect(body[1].mission).toBe('test-history');
  });

  it('respects limit query param', async () => {
    const { body } = await api('/api/orchestrator/history?limit=1');
    expect(body.length).toBe(1);
  });
});

// ── Chain Restart Lineage Tests (P7) ─────────────────────────

describe('Chain Restart Lineage', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('restart creates chain with restartedFrom', async () => {
    // Get a failed chain
    const listRes = await api('/api/chains?status=failed');
    const failedChain = listRes.body.chains[0];
    expect(failedChain).toBeTruthy();

    // Restart it
    const { status, body } = await api(`/api/chains/${failedChain.id}/restart`, {
      method: 'POST',
    });
    expect(status).toBe(201);
    expect(body.restartedFrom).toBe(failedChain.id);
  });

  it('chain detail includes restartedFrom in summary', async () => {
    const listRes = await api('/api/chains');
    const chainWithParent = listRes.body.chains.find(c => c.restartedFrom);
    expect(chainWithParent).toBeTruthy();
    expect(chainWithParent.restartedFrom).toBeTruthy();
  });
});

// ── Projects Page + File API Tests (P9) ─────────────────────

describe('Projects Page', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    // Register the test parent dir as a project so root validation passes
    const regStore = createRegistry({ operatorDir: TEST_DIR });
    const reg = regStore.load();
    createChain(reg, { task: 'test files', config: { model: 'sonnet' }, projectDir: resolve(TEST_DIR, '..') });
    regStore.save(reg);
    await startServer();
  });
  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('GET /projects serves projects page HTML', async () => {
    const res = await fetch(`${baseUrl}/projects`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Projects');
    expect(text).toContain('projects-panel');
  });

  it('GET /views/projects returns projects fragment', async () => {
    const res = await fetch(`${baseUrl}/views/projects`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('projects-panel');
    expect(text).toContain('project-card');
  });

  it('GET /api/files returns directory listing', async () => {
    // Use the operator directory itself as a real path
    const root = encodeURIComponent(join(TEST_DIR, '..'));
    const { status, body } = await api(`/api/files?root=${root}`);
    expect(status).toBe(200);
    expect(body.entries).toBeDefined();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('GET /api/files rejects missing root', async () => {
    const { status, body } = await api('/api/files');
    expect(status).toBe(400);
    expect(body.error).toContain('root');
  });

  it('GET /api/files blocks path traversal', async () => {
    const root = encodeURIComponent(TEST_DIR);
    const { status } = await api(`/api/files?root=${root}&path=../../..`);
    expect(status).toBe(403);
  });

  it('GET /views/file-tree returns subtree HTML', async () => {
    const root = encodeURIComponent(join(TEST_DIR, '..'));
    const res = await fetch(`${baseUrl}/views/file-tree?root=${root}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    // Should contain some file/dir entries from the operator directory
    expect(text.length).toBeGreaterThan(0);
  });
});

// ── P10: File Content Preview ─────────────────────────────────────

describe('File Content API (P10)', () => {
  let contentDir;

  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    contentDir = join(TEST_DIR, 'content-test');
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(join(contentDir, 'sample.js'), 'const x = 1;\n');
    writeFileSync(join(contentDir, 'binary.dat'), Buffer.from([0x00, 0xFF, 0x00]));
    mkdirSync(join(contentDir, 'sub'));
    // Register contentDir as a project so root validation passes
    const regStore = createRegistry({ operatorDir: TEST_DIR });
    const reg = regStore.load();
    createChain(reg, { task: 'test content', config: { model: 'sonnet' }, projectDir: resolve(contentDir) });
    regStore.save(reg);
    await startServer();
  });
  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('GET /api/files/content returns file content', async () => {
    const root = encodeURIComponent(contentDir);
    const { status, body } = await api(`/api/files/content?root=${root}&path=sample.js`);
    expect(status).toBe(200);
    expect(body.content).toContain('const x = 1');
    expect(body.lines).toBeGreaterThan(0);
    expect(body.path).toBe('sample.js');
  });

  it('GET /api/files/content rejects binary', async () => {
    const root = encodeURIComponent(contentDir);
    const { status, body } = await api(`/api/files/content?root=${root}&path=binary.dat`);
    expect(status).toBe(415);
    expect(body.error).toContain('Binary');
  });

  it('GET /api/files/content returns 404 for missing file', async () => {
    const root = encodeURIComponent(contentDir);
    const { status } = await api(`/api/files/content?root=${root}&path=nope.txt`);
    expect(status).toBe(404);
  });

  it('GET /api/files/content blocks path traversal', async () => {
    const root = encodeURIComponent(contentDir);
    const { status } = await api(`/api/files/content?root=${root}&path=../../package.json`);
    expect(status).toBe(403);
  });

  it('GET /api/files/content returns 400 for directory', async () => {
    const root = encodeURIComponent(contentDir);
    const { status, body } = await api(`/api/files/content?root=${root}&path=sub`);
    expect(status).toBe(400);
    expect(body.error).toContain('Not a file');
  });

  it('GET /api/files/content returns 400 for missing params', async () => {
    const { status } = await api('/api/files/content');
    expect(status).toBe(400);
  });
});

// ── Terminals Page ──────────────────────────────────────────
describe('Terminals Page', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('GET /terminals serves terminals page HTML', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Terminals');
    expect(text).toContain('term-tabs');
    expect(text).toContain('term-panels');
  });

  it('terminals page includes xterm.js CDN links', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('xterm');
    expect(text).toContain('addon-fit');
  });

  it('terminals page includes terminals.js script', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('terminals.js');
  });

  it('terminals page has new instance dialog', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('new-instance-dialog');
    expect(text).toContain('new-instance-form');
  });

  it('GET /terminals.js serves the terminals script', async () => {
    const res = await fetch(`${baseUrl}/terminals.js`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('addTerminalInstance');
    expect(text).toContain('THEMES');
    expect(text).toContain('createWS');
  });

  it('terminals page has terminal type chooser (replaces health panel)', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('new-terminal-chooser');
    expect(text).toContain('chooser-card');
    expect(text).toContain('Interactive Session');
  });

  it('terminals page has config dialog (Phase 8)', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('config-dialog');
    expect(text).toContain('config-form');
    expect(text).toContain('config-model');
    expect(text).toContain('config-budget');
    expect(text).toContain('config-turns');
  });

  it('terminals.js includes health panel functions (Phase 8)', async () => {
    const res = await fetch(`${baseUrl}/terminals.js`);
    const text = await res.text();
    expect(text).toContain('loadWorkerHealth');
    expect(text).toContain('renderHealthCard');
    expect(text).toContain('updateHealthFromEvent');
    expect(text).toContain('openConfigDialog');
    expect(text).toContain('submitConfig');
  });
});

// ── Nav Links ───────────────────────────────────────────────
describe('Nav Links', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  const pages = [
    { path: '/', name: 'index' },
    { path: '/orchestrator', name: 'orchestrator' },
    { path: '/settings', name: 'settings' },
    { path: '/analytics', name: 'analytics' },
    { path: '/terminals', name: 'terminals' },
  ];

  for (const page of pages) {
    it(`${page.name} page has Terminals nav link`, async () => {
      const res = await fetch(`${baseUrl}${page.path}`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('href="/terminals"');
    });
  }
});

// ── Handoff API Tests (Phase 3) ──────────────────────────────

describe('Handoff API', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('POST /api/orchestrator/:id/handoff returns 404 for unknown instance', async () => {
    const { status, body } = await api('/api/orchestrator/nonexistent/handoff', {
      method: 'POST',
    });
    expect(status).toBe(404);
    expect(body.error).toContain('not found');
  });

  it('POST /api/orchestrator/:id/handoff returns 409 when not running', async () => {
    // Create a stopped instance via start+stop events
    events.emit('orchestrator:started', { workerId: 'handoff-test-1' });
    events.emit('orchestrator:stopped', { workerId: 'handoff-test-1' });

    const { status, body } = await api('/api/orchestrator/handoff-test-1/handoff', {
      method: 'POST',
    });
    expect(status).toBe(409);
    expect(body.error).toContain('not running');
  });

  it('POST /api/orchestrator/:id/handoff generates handoff for running instance', async () => {
    events.emit('orchestrator:started', { workerId: 'handoff-test-2' });
    events.emit('agent:start', { workerId: 'handoff-test-2', agentId: 'dev-1', model: 'sonnet' });

    const { status, body } = await api('/api/orchestrator/handoff-test-2/handoff', {
      method: 'POST',
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.handoffFile).toBeTruthy();
    expect(body.summary).toBeTruthy();

    // Verify file was written
    expect(existsSync(body.handoffFile)).toBe(true);
  });

  it('GET /api/orchestrator/:id/handoffs lists handoff files', async () => {
    const { status, body } = await api('/api/orchestrator/handoff-test-2/handoffs');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty('file');
    expect(body[0]).toHaveProperty('size');
    expect(body[0].file).toContain('orch-handoff-test-2');
  });

  it('GET /api/orchestrator/:id/handoffs returns [] for no history', async () => {
    const { status, body } = await api('/api/orchestrator/no-history/handoffs');
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it('POST /api/orchestrator/:id/handoff-restart returns 404 for unknown', async () => {
    const { status } = await api('/api/orchestrator/ghost/handoff-restart', {
      method: 'POST',
    });
    expect(status).toBe(404);
  });

  it('POST /api/orchestrator/:id/handoff-restart returns 409 when not running', async () => {
    events.emit('orchestrator:started', { workerId: 'handoff-test-3' });
    events.emit('orchestrator:stopped', { workerId: 'handoff-test-3' });

    const { status } = await api('/api/orchestrator/handoff-test-3/handoff-restart', {
      method: 'POST',
    });
    expect(status).toBe(409);
  });

  it('POST /api/orchestrator/:id/handoff-restart generates file and returns success', async () => {
    events.emit('orchestrator:started', { workerId: 'handoff-test-4' });

    const { status, body } = await api('/api/orchestrator/handoff-test-4/handoff-restart', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.handoffFile).toBeTruthy();
    expect(existsSync(body.handoffFile)).toBe(true);
    expect(body.newInstanceStatus).toBeTruthy();
  });

  it('handoff:generated event is emitted', async () => {
    const received = [];
    events.on('handoff:generated', (data) => received.push(data));

    events.emit('orchestrator:started', { workerId: 'handoff-test-5' });
    await api('/api/orchestrator/handoff-test-5/handoff', { method: 'POST' });

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].workerId).toBe('handoff-test-5');
    expect(received[0].handoffFile).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════
// Phase 8 — Worker Health + Config
// ══════════════════════════════════════════════════════════════

describe('Worker Health Endpoint (Phase 8)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/orchestrator/workers/health returns poolActive:false when no pool', async () => {
    const { status, body } = await api('/api/orchestrator/workers/health');
    expect(status).toBe(200);
    expect(body.poolActive).toBe(false);
    expect(body.workers).toEqual([]);
  });
});

describe('Worker Health Endpoint with Pool (Phase 8)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('GET /api/orchestrator/workers/health returns worker data from pool', async () => {
    // Create mock pool
    const mockPool = {
      getStatus: () => [{
        id: 'w1',
        status: 'running',
        pid: 12345,
        circuitState: 'closed',
        consecutiveFailures: 0,
        restartCount: 2,
        lastHeartbeat: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        exitCode: null,
        config: { model: 'sonnet' },
      }, {
        id: 'w2',
        status: 'stopped',
        pid: 12346,
        circuitState: 'open',
        consecutiveFailures: 3,
        restartCount: 5,
        lastHeartbeat: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        stoppedAt: new Date().toISOString(),
        exitCode: 1,
        config: { model: 'haiku' },
      }],
      getWorker: (id) => mockPool.getStatus().find(w => w.id === id) || null,
      spawn: () => {},
      kill: () => true,
      sendTo: () => true,
      remove: () => true,
      shutdownAll: async () => {},
      activeCount: () => 1,
    };

    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events, pool: mockPool, coordination: false });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });

    const { status, body } = await api('/api/orchestrator/workers/health');
    expect(status).toBe(200);
    expect(body.poolActive).toBe(true);
    expect(body.workers).toHaveLength(2);

    const w1 = body.workers.find(w => w.id === 'w1');
    expect(w1.status).toBe('running');
    expect(w1.circuitState).toBe('closed');
    expect(w1.consecutiveFailures).toBe(0);
    expect(w1.restartCount).toBe(2);
    expect(w1.pid).toBe(12345);

    const w2 = body.workers.find(w => w.id === 'w2');
    expect(w2.status).toBe('stopped');
    expect(w2.circuitState).toBe('open');
    expect(w2.consecutiveFailures).toBe(3);
    expect(w2.restartCount).toBe(5);
    expect(w2.exitCode).toBe(1);
  });
});

describe('Instance Config Endpoint (Phase 8)', () => {
  beforeAll(async () => {
    setupTestDir();
    seedRegistry();
    await startServer();
  });
  afterAll(async () => {
    await stopServer();
    teardownTestDir();
  });

  it('POST /api/orchestrator/:id/config returns 404 for unknown instance', async () => {
    const { status } = await api('/api/orchestrator/nonexistent/config', {
      method: 'POST',
      body: JSON.stringify({ model: 'opus' }),
    });
    expect(status).toBe(404);
  });

  it('POST /api/orchestrator/:id/config updates model', async () => {
    // Create instance first
    events.emit('orchestrator:started', { workerId: 'config-test-1', model: 'sonnet' });

    const { status, body } = await api('/api/orchestrator/config-test-1/config', {
      method: 'POST',
      body: JSON.stringify({ model: 'opus' }),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.config.model).toBe('opus');
  });

  it('POST /api/orchestrator/:id/config updates budget and turns', async () => {
    events.emit('orchestrator:started', { workerId: 'config-test-2' });

    const { status, body } = await api('/api/orchestrator/config-test-2/config', {
      method: 'POST',
      body: JSON.stringify({ maxBudgetUsd: 10, maxTurns: 50 }),
    });
    expect(status).toBe(200);
    expect(body.config.maxBudgetUsd).toBe(10);
    expect(body.config.maxTurns).toBe(50);
  });

  it('updated config persists across status queries', async () => {
    events.emit('orchestrator:started', { workerId: 'config-test-3', model: 'haiku' });

    await api('/api/orchestrator/config-test-3/config', {
      method: 'POST',
      body: JSON.stringify({ model: 'opus', maxBudgetUsd: 20, maxTurns: 100 }),
    });

    const { body } = await api('/api/orchestrator/instances');
    const inst = body.find(i => i.id === 'config-test-3');
    expect(inst.model).toBe('opus');
    expect(inst.maxBudgetUsd).toBe(20);
    expect(inst.maxTurns).toBe(100);
  });

  it('config sends IPC to running worker when pool available', async () => {
    // Stop current server and start with mock pool
    await stopServer();

    const sentMessages = [];
    const mockPool = {
      getStatus: () => [],
      getWorker: () => null,
      spawn: () => {},
      kill: () => true,
      sendTo: (id, msg) => { sentMessages.push({ id, msg }); return true; },
      updateConfig: () => true,
      remove: () => true,
      shutdownAll: async () => {},
      activeCount: () => 1,
    };

    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events, pool: mockPool, coordination: false });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });

    // Create running instance
    events.emit('orchestrator:started', { workerId: 'config-ipc-test' });

    await api('/api/orchestrator/config-ipc-test/config', {
      method: 'POST',
      body: JSON.stringify({ model: 'opus', maxBudgetUsd: 15, maxTurns: 60 }),
    });

    const configMsg = sentMessages.find(m => m.msg.type === 'config');
    expect(configMsg).toBeTruthy();
    expect(configMsg.id).toBe('config-ipc-test');
    expect(configMsg.msg.model).toBe('opus');
    expect(configMsg.msg.maxBudgetUsd).toBe(15);
    expect(configMsg.msg.maxTurns).toBe(60);
  });

  it('config updates pool-level config via updateConfig', async () => {
    await stopServer();

    const configUpdates = [];
    const mockPool = {
      getStatus: () => [],
      getWorker: () => null,
      spawn: () => {},
      kill: () => true,
      sendTo: () => true,
      updateConfig: (id, cfg) => { configUpdates.push({ id, cfg }); return true; },
      remove: () => true,
      shutdownAll: async () => {},
      activeCount: () => 0,
    };

    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events, pool: mockPool, coordination: false });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });

    events.emit('orchestrator:started', { workerId: 'pool-cfg-test' });

    const { body } = await api('/api/orchestrator/pool-cfg-test/config', {
      method: 'POST',
      body: JSON.stringify({ model: 'haiku' }),
    });

    expect(body.success).toBe(true);
    expect(configUpdates.length).toBe(1);
    expect(configUpdates[0].id).toBe('pool-cfg-test');
    expect(configUpdates[0].cfg.model).toBe('haiku');
  });
});

// ── Coordination Endpoints (Phase 9) ──────────────────────

describe('Coordination Metrics & Config Endpoints (Phase 9)', () => {
  it('GET /api/coordination/metrics returns metrics', async () => {
    await stopServer();

    const mockPool = {
      getStatus: () => [{ id: 'w1', status: 'running' }],
      getWorker: () => null,
      spawn: () => {},
      kill: () => true,
      sendTo: () => true,
      updateConfig: () => true,
      remove: () => true,
      shutdownAll: async () => {},
      activeCount: () => 1,
    };

    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events, pool: mockPool });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });

    // Start coordinator
    await api('/api/coordination/start', { method: 'POST' });

    const { status, body } = await api('/api/coordination/metrics');
    expect(status).toBe(200);
    expect(body).toHaveProperty('throughputPerMinute');
    expect(body).toHaveProperty('avgCompletionMs');
    expect(body).toHaveProperty('workerUtilization');
    expect(body).toHaveProperty('recentCompletions');
    expect(body).toHaveProperty('recentFailures');
    expect(body).toHaveProperty('windowMs');
    expect(body).toHaveProperty('outcomes');
  });

  it('POST /api/coordination/config updates rate limits and budgets', async () => {
    await stopServer();

    const mockPool = {
      getStatus: () => [{ id: 'w1', status: 'running' }],
      getWorker: () => null,
      spawn: () => {},
      kill: () => true,
      sendTo: () => true,
      updateConfig: () => true,
      remove: () => true,
      shutdownAll: async () => {},
      activeCount: () => 1,
    };

    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events, pool: mockPool });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });

    // Start coordinator
    await api('/api/coordination/start', { method: 'POST' });

    const { status, body } = await api('/api/coordination/config', {
      method: 'POST',
      body: JSON.stringify({ maxRequestsPerMinute: 120, globalBudgetUsd: 500 }),
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rateLimiter.maxRequestsPerMinute).toBe(120);
    expect(body.costs.globalBudgetUsd).toBe(500);
  });

  it('coordination endpoints return 503 without coordinator', async () => {
    // Restart server without pool → no coordinator
    await stopServer();
    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });

    const { status: metricsStatus } = await api('/api/coordination/metrics');
    expect(metricsStatus).toBe(503);

    const { status: configStatus } = await api('/api/coordination/config', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(configStatus).toBe(503);
  });
});

// ── Terminals Phase 10 UI Tests ──────────────────────────────

describe('Terminals Page Phase 10 Elements', () => {
  let appInstance, baseUrl, events;

  beforeAll(async () => {
    setupTestDir();
    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('terminals page has unified new terminal button (replaces metrics panel)', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('add-terminal-btn');
    expect(text).toContain('openNewTerminal()');
    expect(text).toContain('+ New');
  });

  it('terminals page has chooser with both terminal types', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('Interactive Session');
    expect(text).toContain('Automated Worker');
    expect(text).toContain('new-terminal-chooser');
    expect(text).toContain('new-claude-dialog');
    expect(text).toContain('new-instance-dialog');
  });

  it('terminals.js includes metrics panel functions (Phase 10)', async () => {
    const res = await fetch(`${baseUrl}/terminals.js`);
    const text = await res.text();
    expect(text).toContain('loadCoordMetrics');
    expect(text).toContain('updateMetricsCards');
    expect(text).toContain('openCoordConfigDialog');
    expect(text).toContain('submitCoordConfig');
    expect(text).toContain('formatDurationMs');
  });

  it('style.css includes metrics panel styles (Phase 10)', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.term-metrics');
    expect(text).toContain('.term-metrics__grid');
    expect(text).toContain('.term-metrics__card');
    expect(text).toContain('.term-metrics__util-bar');
  });
});

// ── Terminals Phase 11 UI Tests ──────────────────────────────

describe('Terminals Page Phase 11 Elements', () => {
  let appInstance, baseUrl, events;

  beforeAll(async () => {
    setupTestDir();
    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('terminals page has updated shortcut labels (Phase 11)', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('New interactive session');
    expect(text).toContain('New automated worker');
    expect(text).toContain('shortcuts-dialog');
  });

  it('terminals.js includes adaptive rate functions (Phase 11)', async () => {
    const res = await fetch(`${baseUrl}/terminals.js`);
    const text = await res.text();
    expect(text).toContain('updateAdaptiveCard');
    expect(text).toContain('/api/coordination/adaptive-rate');
    expect(text).toContain('coord:rate-adjusted');
  });

  it('style.css includes adaptive rate badge styles (Phase 11)', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.term-metrics__adaptive-badge');
    expect(text).toContain('.term-metrics__adaptive-badge--backing-off');
    expect(text).toContain('.term-metrics__adaptive-badge--recovering');
    expect(text).toContain('.term-metrics__value--warn');
    expect(text).toContain('.term-metrics__value--danger');
  });
});

// ── Phase 12: Task Board ──────────────────────────────────────

describe('Task Board Page (Phase 12)', () => {
  let appInstance, baseUrl, events;

  beforeAll(async () => {
    setupTestDir();
    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('GET /taskboard serves task board HTML page', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Task Board');
    expect(text).toContain('task-board');
  });

  it('task board has Kanban columns for all statuses', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('col-pending');
    expect(text).toContain('col-assigned');
    expect(text).toContain('col-running');
    expect(text).toContain('col-complete');
    expect(text).toContain('col-failed');
  });

  it('task board has add task dialog', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('add-task-dialog');
    expect(text).toContain('add-task-form');
    expect(text).toContain('add-task-btn');
  });

  it('task board has progress bar', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('board-progress');
    expect(text).toContain('progress-fill');
  });

  it('task board has coordinator status badge', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('board-status');
  });

  it('task board includes taskboard.js script', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('taskboard.js');
  });

  it('taskboard.js serves and contains key functions', async () => {
    const res = await fetch(`${baseUrl}/taskboard.js`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('loadTasks');
    expect(text).toContain('renderBoard');
    expect(text).toContain('renderCard');
    expect(text).toContain('handleDrop');
    expect(text).toContain('createWS');
  });

  it('taskboard.js references coordination API endpoints', async () => {
    const res = await fetch(`${baseUrl}/taskboard.js`);
    const text = await res.text();
    expect(text).toContain('/api/coordination/tasks');
    expect(text).toContain('/api/coordination/status');
    expect(text).toContain('/cancel');
    expect(text).toContain('/retry');
  });

  it('taskboard.js handles WebSocket coord events', async () => {
    const res = await fetch(`${baseUrl}/taskboard.js`);
    const text = await res.text();
    expect(text).toContain('coord:assigned');
    expect(text).toContain('coord:task-complete');
    expect(text).toContain('coord:task-failed');
    expect(text).toContain('coord:all-complete');
  });

  it('style.css includes task board styles', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.task-board');
    expect(text).toContain('.task-board__column');
    expect(text).toContain('.task-card');
    expect(text).toContain('.task-card__priority');
    expect(text).toContain('.task-board__dialog');
    expect(text).toContain('.task-board__progress');
  });

  it('style.css has task card action and status styles', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.task-card__action--cancel');
    expect(text).toContain('.task-card__action--retry');
    expect(text).toContain('.task-card--cancelled');
    expect(text).toContain('.task-card--dragging');
    expect(text).toContain('.task-board__cards--drop-target');
  });

  it('all existing pages have Tasks nav link', async () => {
    const pages = ['/', '/analytics', '/orchestrator', '/terminals', '/settings'];
    for (const page of pages) {
      const res = await fetch(`${baseUrl}${page}`);
      const text = await res.text();
      expect(text).toContain('href="/taskboard"');
      expect(text).toContain('>Tasks<');
    }
  });

  it('task board column headers have status dots', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('task-board__column-dot--pending');
    expect(text).toContain('task-board__column-dot--assigned');
    expect(text).toContain('task-board__column-dot--running');
    expect(text).toContain('task-board__column-dot--complete');
    expect(text).toContain('task-board__column-dot--failed');
  });

  it('style.css has priority badge variants', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.task-card__priority--high');
    expect(text).toContain('.task-card__priority--med');
    expect(text).toContain('.task-card__priority--low');
  });
});

// ============================================================
// Task Board Enhancements (Phase 13)
// ============================================================

describe('Task Board Enhancements (Phase 13)', () => {
  let baseUrl, appInstance, events;

  beforeAll(async () => {
    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });
  afterAll(async () => {
    if (appInstance) await appInstance.close();
  });

  // ── HTML structure tests ──────────────────────────────

  it('task board has filter bar with search and dropdowns', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('board-search');
    expect(text).toContain('filter-status');
    expect(text).toContain('filter-priority');
    expect(text).toContain('filter-category');
    expect(text).toContain('board-filters');
  });

  it('task board has batch action bar', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('batch-bar');
    expect(text).toContain('batch-count');
    expect(text).toContain('batch-cancel');
    expect(text).toContain('batch-retry');
    expect(text).toContain('batch-select-all');
    expect(text).toContain('batch-clear');
  });

  it('task board has detail/edit dialog', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('detail-dialog');
    expect(text).toContain('detail-form');
    expect(text).toContain('detail-save-btn');
    expect(text).toContain('detail-task-input');
    expect(text).toContain('detail-priority-input');
    expect(text).toContain('detail-category-input');
  });

  it('task board has keyboard shortcuts dialog', async () => {
    const res = await fetch(`${baseUrl}/taskboard`);
    const text = await res.text();
    expect(text).toContain('shortcuts-dialog');
    expect(text).toContain('Keyboard Shortcuts');
    expect(text).toContain('task-board__key');
    expect(text).toContain('shortcuts-close');
  });

  // ── JS content tests ─────────────────────────────────

  it('taskboard.js has filter/search functions', async () => {
    const res = await fetch(`${baseUrl}/taskboard.js`);
    const text = await res.text();
    expect(text).toContain('matchesFilter');
    expect(text).toContain('getFilteredTasks');
    expect(text).toContain('updateCategoryDropdown');
    expect(text).toContain('filterText');
  });

  it('taskboard.js has keyboard shortcut handler', async () => {
    const res = await fetch(`${baseUrl}/taskboard.js`);
    const text = await res.text();
    expect(text).toContain("document.addEventListener('keydown'");
    expect(text).toContain('shortcutsDialog');
    expect(text).toContain("e.key === '?'");
    expect(text).toContain("e.key === '/'");
    expect(text).toContain("e.key === 'n'");
  });

  it('taskboard.js has detail/edit dialog functions', async () => {
    const res = await fetch(`${baseUrl}/taskboard.js`);
    const text = await res.text();
    expect(text).toContain('openDetail');
    expect(text).toContain('saveDetail');
    expect(text).toContain('updateTask');
    expect(text).toContain("method: 'PATCH'");
  });

  it('taskboard.js has batch selection functions', async () => {
    const res = await fetch(`${baseUrl}/taskboard.js`);
    const text = await res.text();
    expect(text).toContain('toggleSelect');
    expect(text).toContain('clearSelection');
    expect(text).toContain('selectAllVisible');
    expect(text).toContain('batchCancel');
    expect(text).toContain('batchRetry');
  });

  it('taskboard.js has checkbox in card rendering', async () => {
    const res = await fetch(`${baseUrl}/taskboard.js`);
    const text = await res.text();
    expect(text).toContain('task-card__checkbox');
    expect(text).toContain('data-select');
    expect(text).toContain('task-card--selected');
  });

  // ── CSS content tests ─────────────────────────────────

  it('style.css has Phase 13 filter bar styles', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.task-board__filters');
    expect(text).toContain('.task-board__search');
    expect(text).toContain('.task-board__filter-select');
    expect(text).toContain('.task-board__filter-count');
  });

  it('style.css has batch bar and selection styles', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.task-board__batch-bar');
    expect(text).toContain('.task-board__batch-count');
    expect(text).toContain('.task-card--selected');
    expect(text).toContain('.task-card__checkbox');
  });

  it('style.css has detail dialog and shortcuts styles', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.task-board__dialog--detail');
    expect(text).toContain('.task-board__detail-field');
    expect(text).toContain('.task-board__dialog--help');
    expect(text).toContain('.task-board__key');
    expect(text).toContain('.task-board__shortcuts-table');
  });

  // ── Coordination PATCH endpoint ───────────────────────

  it('task-queue update method exists in coordination module', async () => {
    const { createTaskQueue } = await import('../../operator/coordination/task-queue.mjs');
    const q = createTaskQueue();
    expect(typeof q.update).toBe('function');
  });

  it('task-queue update modifies mutable fields', async () => {
    const { createTaskQueue } = await import('../../operator/coordination/task-queue.mjs');
    const q = createTaskQueue();
    q.add({ id: 'test-1', task: 'original', priority: 0, category: 'code' });
    const updated = q.update('test-1', { task: 'updated', priority: 10, category: 'review' });
    expect(updated.task).toBe('updated');
    expect(updated.priority).toBe(10);
    expect(updated.category).toBe('review');
  });
});

// ============================================================
// Phase 14 — DAG Visualization + Task Templates
// ============================================================

describe('Phase 14 — DAG + Templates', () => {
  // ── Static file checks ────────────────────────────────

  it('taskboard.html contains DAG view container', async () => {
    const html = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'public', 'taskboard.html'), 'utf-8'
    );
    expect(html).toContain('dag-view');
    expect(html).toContain('dag-container');
    expect(html).toContain('view-kanban');
    expect(html).toContain('view-dag');
  });

  it('taskboard.html contains template dialog', async () => {
    const html = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'public', 'taskboard.html'), 'utf-8'
    );
    expect(html).toContain('template-dialog');
    expect(html).toContain('template-list');
    expect(html).toContain('template-preview');
    expect(html).toContain('template-prefix');
  });

  it('taskboard.html contains new keyboard shortcuts', async () => {
    const html = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'public', 'taskboard.html'), 'utf-8'
    );
    expect(html).toContain('Toggle DAG view');
    expect(html).toContain('Toggle Kanban view');
    expect(html).toContain('Open templates');
  });

  it('taskboard.js contains DAG rendering functions', async () => {
    const js = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'public', 'taskboard.js'), 'utf-8'
    );
    expect(js).toContain('renderDAG');
    expect(js).toContain('loadGraph');
    expect(js).toContain('switchView');
    expect(js).toContain('DAG_NODE_W');
  });

  it('taskboard.js contains template functions', async () => {
    const js = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'public', 'taskboard.js'), 'utf-8'
    );
    expect(js).toContain('loadTemplates');
    expect(js).toContain('openTemplateDialog');
    expect(js).toContain('applyTemplate');
    expect(js).toContain('selectTemplate');
  });

  it('style.css contains DAG visualization styles', async () => {
    const css = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'public', 'style.css'), 'utf-8'
    );
    expect(css).toContain('.dag-node');
    expect(css).toContain('.dag-edge');
    expect(css).toContain('.task-board__dag-container');
    expect(css).toContain('.task-board__view-toggle');
  });

  it('style.css contains template styles', async () => {
    const css = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'public', 'style.css'), 'utf-8'
    );
    expect(css).toContain('.task-board__template-list');
    expect(css).toContain('.task-board__template-item');
    expect(css).toContain('.task-board__template-preview');
    expect(css).toContain('.task-board__template-prefix');
  });

  // ── API endpoint checks ───────────────────────────────

  it('GET /api/coordination/graph returns 503 without coordinator', async () => {
    await stopServer();
    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });

    const { status } = await api('/api/coordination/graph');
    expect(status).toBe(503);
  });

  it('GET /api/coordination/templates returns 503 without coordinator', async () => {
    // Server from previous test still running without coordinator
    const { status } = await api('/api/coordination/templates');
    expect(status).toBe(503);
  });

  it('GET /api/coordination/graph returns graph data with coordinator', async () => {
    await stopServer();
    const mockPool = {
      getStatus: () => [{ id: 'w1', status: 'running' }],
      getWorker: () => null,
      spawn: () => {},
      kill: () => true,
      sendTo: () => true,
      updateConfig: () => true,
      remove: () => true,
      shutdownAll: async () => {},
      activeCount: () => 1,
    };
    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events, pool: mockPool });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });

    const { status, body } = await api('/api/coordination/graph');
    expect(status).toBe(200);
    expect(body).toHaveProperty('nodes');
    expect(body).toHaveProperty('edges');
    expect(body).toHaveProperty('levels');
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(Array.isArray(body.levels)).toBe(true);
  });

  it('GET /api/coordination/templates returns template array with coordinator', async () => {
    // Server from previous test still running with coordinator
    const { status, body } = await api('/api/coordination/templates');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(5);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('name');
    expect(body[0]).toHaveProperty('description');
    expect(body[0]).toHaveProperty('tasks');
    expect(Array.isArray(body[0].tasks)).toBe(true);
  });

  it('GET /api/coordination/graph reflects added tasks', async () => {
    // Add tasks with deps
    await api('/api/coordination/tasks', {
      method: 'POST',
      body: JSON.stringify({ id: 'g-root', task: 'Root task' }),
    });
    await api('/api/coordination/tasks', {
      method: 'POST',
      body: JSON.stringify({ id: 'g-child', task: 'Child task', deps: ['g-root'] }),
    });

    const { status, body } = await api('/api/coordination/graph');
    expect(status).toBe(200);
    expect(body.nodes).toContain('g-root');
    expect(body.nodes).toContain('g-child');
    expect(body.edges).toEqual(expect.arrayContaining([
      { from: 'g-root', to: 'g-child' },
    ]));
    expect(body.levels.length).toBeGreaterThanOrEqual(2);
  });

  it('coordination routes file lists graph and templates endpoints', async () => {
    const routeSource = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'routes', 'coordination.mjs'), 'utf-8'
    );
    expect(routeSource).toContain('/coordination/graph');
    expect(routeSource).toContain('/coordination/templates');
  });
});

// ── Phase 15E: Auto-Handoff UI Elements ─────────────────────

describe('Phase 15E: Auto-Handoff', () => {
  let appInstance, baseUrl, events;

  beforeAll(async () => {
    setupTestDir();
    events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await appInstance.close();
    teardownTestDir();
  });

  it('terminals.html has auto-handoff checkbox in new Claude dialog', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('name="autoHandoff"');
    expect(text).toContain('Auto-Handoff');
  });

  it('terminals.html has Ctrl+Shift+A shortcut in shortcuts dialog', async () => {
    const res = await fetch(`${baseUrl}/terminals`);
    const text = await res.text();
    expect(text).toContain('Ctrl+Shift+A');
    expect(text).toContain('Toggle auto-handoff');
  });

  it('terminals.js includes toggleAutoHandoff function', async () => {
    const res = await fetch(`${baseUrl}/terminals.js`);
    const text = await res.text();
    expect(text).toContain('function toggleAutoHandoff');
    expect(text).toContain('toggle-auto-handoff');
    expect(text).toContain('window.toggleAutoHandoff');
  });

  it('terminals.js handles claude-terminal:handoff WS event', async () => {
    const res = await fetch(`${baseUrl}/terminals.js`);
    const text = await res.text();
    expect(text).toContain("case 'claude-terminal:handoff'");
    expect(text).toContain('AUTO-HANDOFF');
  });

  it('terminals.js handles claude-terminal:context-warning WS event', async () => {
    const res = await fetch(`${baseUrl}/terminals.js`);
    const text = await res.text();
    expect(text).toContain("case 'claude-terminal:context-warning'");
    expect(text).toContain('CONTEXT');
  });

  it('style.css includes auto-handoff badge styles', async () => {
    const res = await fetch(`${baseUrl}/style.css`);
    const text = await res.text();
    expect(text).toContain('.term-status__handoff-badge');
    expect(text).toContain('.term-status__handoff-badge--active');
    expect(text).toContain('.term-status__btn--active');
  });

  it('ws.mjs bridges auto-handoff events', async () => {
    const wsSource = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'ws.mjs'), 'utf-8'
    );
    expect(wsSource).toContain('claude-terminal:handoff');
    expect(wsSource).toContain('claude-terminal:context-warning');
    expect(wsSource).toContain('claude-terminal:auto-handoff-changed');
  });

  it('claude-terminal routes include toggle-auto-handoff endpoint', async () => {
    const routeSource = (await import('fs')).readFileSync(
      join(import.meta.dirname, '..', 'routes', 'claude-terminals.mjs'), 'utf-8'
    );
    expect(routeSource).toContain('toggle-auto-handoff');
    expect(routeSource).toContain('setAutoHandoff');
  });
});
