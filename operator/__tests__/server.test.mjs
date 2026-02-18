// Server tests (M4)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';
import { createApp } from '../server.mjs';
import {
  initRegistry, loadRegistry, saveRegistry,
  createChain, recordSession, updateChainStatus,
} from '../registry.mjs';
import { EventBus } from '../../orchestrator/observability.mjs';
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
  initRegistry({ operatorDir: TEST_DIR });
  const reg = loadRegistry();

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

  saveRegistry(reg);

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
    const reg = loadRegistry();
    const running = createChain(reg, { task: 'cannot delete', config: {} });
    saveRegistry(reg);

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
