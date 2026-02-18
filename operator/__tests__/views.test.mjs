// ============================================================
// M5: View Renderer & Route Tests
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createApp } from '../server.mjs';
import { initRegistry, loadRegistry, createChain, recordSession, updateChainStatus, saveRegistry } from '../registry.mjs';

// ── View Helpers ────────────────────────────────────────────

import { escapeHtml, formatCost, formatDuration, relativeTime, statusLabel } from '../views/helpers.mjs';

describe('View Helpers', () => {
  it('escapes HTML entities', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('handles null/undefined input', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('formats cost', () => {
    expect(formatCost(0.42)).toBe('$0.42');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(null)).toBe('$0.00');
  });

  it('formats duration', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3600000)).toBe('1h');
    expect(formatDuration(3660000)).toBe('1h 1m');
    expect(formatDuration(null)).toBe('0s');
  });

  it('formats relative time', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toMatch(/0s ago|1s ago/);
    expect(relativeTime(null)).toBe('');

    const fiveMinAgo = new Date(Date.now() - 300000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns status labels', () => {
    expect(statusLabel('running')).toBe('Running');
    expect(statusLabel('complete')).toBe('Complete');
    expect(statusLabel('failed')).toBe('Failed');
    expect(statusLabel('max-continuations')).toBe('Max Cont.');
    expect(statusLabel('something-new')).toBe('something-new');
  });
});

// ── Chain Row Renderer ──────────────────────────────────────

import { renderChainRow, renderChainTable } from '../views/chain-row.mjs';

describe('Chain Row Renderer', () => {
  const mockChain = {
    id: 'abc-123',
    task: 'Build a feature',
    status: 'running',
    sessions: 3,
    totalCostUsd: 0.42,
    config: { model: 'sonnet' },
    updatedAt: new Date().toISOString(),
  };

  it('renders a chain row with correct data', () => {
    const html = renderChainRow(mockChain);
    expect(html).toContain('status-dot--running');
    expect(html).toContain('Build a feature');
    expect(html).toContain('/chains/abc-123');
    expect(html).toContain('sonnet');
    expect(html).toContain('$0.42');
  });

  it('shows kill button for running chains', () => {
    const html = renderChainRow(mockChain);
    expect(html).toContain('Kill');
    expect(html).toContain('hx-post="/api/chains/abc-123/abort"');
  });

  it('hides kill button for completed chains', () => {
    const html = renderChainRow({ ...mockChain, status: 'complete' });
    expect(html).not.toContain('Kill');
  });

  it('truncates long task descriptions', () => {
    const html = renderChainRow({ ...mockChain, task: 'x'.repeat(100) });
    expect(html).toContain('...');
  });

  it('escapes HTML in task description', () => {
    const html = renderChainRow({ ...mockChain, task: '<script>alert(1)</script>' });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders empty table message', () => {
    const html = renderChainTable([]);
    expect(html).toContain('No chains yet');
  });

  it('shows restart button for failed chains', () => {
    const html = renderChainRow({ ...mockChain, status: 'failed' });
    expect(html).toContain('Restart');
    expect(html).toContain('/restart');
  });

  it('shows restart button for aborted chains', () => {
    const html = renderChainRow({ ...mockChain, status: 'aborted' });
    expect(html).toContain('Restart');
  });

  it('hides restart button for running chains', () => {
    const html = renderChainRow(mockChain);
    expect(html).not.toContain('Restart');
  });

  it('renders multiple rows', () => {
    const html = renderChainTable([mockChain, { ...mockChain, id: 'def-456', status: 'complete' }]);
    expect(html).toContain('abc-123');
    expect(html).toContain('def-456');
  });
});

// ── Session Card Renderer ───────────────────────────────────

import { renderSessionCard, renderTimeline, renderCostBreakdown } from '../views/session-card.mjs';

describe('Session Card Renderer', () => {
  const mockSession = {
    index: 0,
    status: 'complete',
    turns: 5,
    costUsd: 0.07,
    durationMs: 30000,
    preCompacted: false,
    hitMaxTurns: false,
    handoffComplete: false,
    handoffFile: null,
    _chainId: 'abc-123',
  };

  it('renders session card with correct data', () => {
    const html = renderSessionCard(mockSession);
    expect(html).toContain('Session 1');
    expect(html).toContain('Complete');
    expect(html).toContain('Turns: 5');
    expect(html).toContain('$0.07');
    expect(html).toContain('30s');
  });

  it('shows badges for preCompacted and hitMaxTurns', () => {
    const html = renderSessionCard({ ...mockSession, preCompacted: true, hitMaxTurns: true });
    expect(html).toContain('Pre-compacted');
    expect(html).toContain('Max turns');
  });

  it('shows error badge', () => {
    const html = renderSessionCard({ ...mockSession, error: 'ECONNRESET' });
    expect(html).toContain('ECONNRESET');
    expect(html).toContain('badge--error');
  });

  it('renders handoff section when handoffFile exists', () => {
    const html = renderSessionCard({ ...mockSession, handoffFile: '/tmp/handoff.md' });
    expect(html).toContain('Handoff');
    expect(html).toContain('hx-get');
  });
});

describe('Session Timeline', () => {
  it('renders empty message for no sessions', () => {
    expect(renderTimeline([])).toContain('No sessions');
    expect(renderTimeline(null)).toContain('No sessions');
  });

  it('renders timeline blocks', () => {
    const sessions = [
      { index: 0, turns: 5, costUsd: 0.05, status: 'complete' },
      { index: 1, turns: 10, costUsd: 0.10, status: 'running' },
    ];
    const html = renderTimeline(sessions);
    expect(html).toContain('timeline--complete');
    expect(html).toContain('timeline--running');
    expect(html).toContain('S1');
    expect(html).toContain('S2');
  });
});

describe('Cost Breakdown', () => {
  it('renders empty for no sessions', () => {
    expect(renderCostBreakdown([])).toBe('');
  });

  it('renders cost segments', () => {
    const sessions = [
      { index: 0, costUsd: 0.30, status: 'complete' },
      { index: 1, costUsd: 0.70, status: 'complete' },
    ];
    const html = renderCostBreakdown(sessions);
    expect(html).toContain('$0.30');
    expect(html).toContain('$0.70');
    expect(html).toContain('$1.00');
  });
});

// ── Agent Card Renderer ─────────────────────────────────────

import { renderAgentCard, renderAgentGrid } from '../views/agent-card.mjs';

describe('Agent Card Renderer', () => {
  it('renders agent card', () => {
    const html = renderAgentCard({ id: 'dev', status: 'active', role: 'developer' });
    expect(html).toContain('dev');
    expect(html).toContain('status-dot--active');
    expect(html).toContain('developer');
  });

  it('handles missing fields', () => {
    const html = renderAgentCard({});
    expect(html).toContain('unknown');
  });

  it('escapes HTML in agent ID', () => {
    const html = renderAgentCard({ id: '<script>' });
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders empty grid message', () => {
    expect(renderAgentGrid([])).toContain('No agents');
  });

  it('renders agent grid', () => {
    const agents = [
      { id: 'dev', status: 'active' },
      { id: 'test', status: 'complete' },
    ];
    const html = renderAgentGrid(agents);
    expect(html).toContain('dev');
    expect(html).toContain('test');
    expect(html).toContain('agent-grid');
  });

  it('renders metrics when available', () => {
    const html = renderAgentCard({
      id: 'engine-dev',
      status: 'complete',
      model: 'sonnet',
      elapsedMs: 65000,
      cost: 0.42,
      continuations: 2,
    });
    expect(html).toContain('agent-metrics');
    expect(html).toContain('sonnet');
    expect(html).toContain('1m 5s');
    expect(html).toContain('$0.42');
    expect(html).toContain('2 cont.');
  });

  it('omits metrics row when no metric data', () => {
    const html = renderAgentCard({ id: 'dev', status: 'running' });
    expect(html).not.toContain('agent-metrics');
  });

  it('omits default model from metrics', () => {
    const html = renderAgentCard({ id: 'dev', status: 'running', model: 'default' });
    expect(html).not.toContain('agent-metrics');
  });
});

// ── View Routes (HTTP) ──────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_views');
let appCtx;

function setupApp() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  appCtx = createApp({ operatorDir: TEST_DIR });
}

function teardownApp() {
  if (appCtx) appCtx.close();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

async function get(path) {
  return new Promise((resolve) => {
    const port = 0; // random
    const server = appCtx.server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async (res) => {
          const text = await res.text();
          resolve({ status: res.status, text, headers: Object.fromEntries(res.headers) });
          server.close();
        });
    });
  });
}

describe('View Routes — Chain List', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/chain-list returns HTML', async () => {
    const res = await get('/views/chain-list');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('No chains yet');
  });

  it('GET /views/chain-list shows chains after creation', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'Test task for views', config: { model: 'haiku' } });
    saveRegistry(reg);

    const res = await get('/views/chain-list');
    expect(res.text).toContain('Test task for views');
    expect(res.text).toContain('haiku');
  });

  it('GET /views/chain-list filters by status', async () => {
    const reg = loadRegistry();
    createChain(reg, { task: 'Running chain', config: { model: 'sonnet' } });
    const chain2 = createChain(reg, { task: 'Failed chain', config: { model: 'sonnet' } });
    chain2.status = 'failed';
    saveRegistry(reg);

    const res = await get('/views/chain-list?status=failed');
    expect(res.text).toContain('Failed chain');
    expect(res.text).not.toContain('Running chain');
  });
});

describe('View Routes — Cost Summary', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/cost-summary returns HTML with stats', async () => {
    const res = await get('/views/cost-summary');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Total Cost');
    expect(res.text).toContain('$0.00');
  });

  it('reflects accumulated costs', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'cost test', config: {} });
    recordSession(chain, { turns: 5, costUsd: 1.23, durationMs: 5000 });
    saveRegistry(reg);

    const res = await get('/views/cost-summary');
    expect(res.text).toContain('$1.23');
  });
});

describe('View Routes — Chain Detail', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/chain-detail/:id returns chain info', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'Detail test chain', config: { model: 'opus' } });
    recordSession(chain, { turns: 3, costUsd: 0.05, durationMs: 3000 });
    saveRegistry(reg);

    const res = await get(`/views/chain-detail/${chain.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Detail test chain');
    expect(res.text).toContain('opus');
    expect(res.text).toContain('Session 1');
  });

  it('returns not found for invalid chain ID', async () => {
    const res = await get('/views/chain-detail/nonexistent');
    expect(res.text).toContain('not found');
  });
});

describe('View Routes — Orchestrator Status', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/orch-status returns orchestrator panel', async () => {
    const res = await get('/views/orch-status');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Orchestrator');
    expect(res.text).toContain('Stopped');
  });

  it('shows running status after event', async () => {
    appCtx.events.emit('orchestrator:started', { mission: 'test-mission', dryRun: true });

    const res = await get('/views/orch-status');
    expect(res.text).toContain('Running');
    expect(res.text).toContain('test-mission');
    expect(res.text).toContain('dry-run');
  });
});

describe('View Routes — Page Routes', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET / serves dashboard HTML', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Dashboard');
    expect(res.text).toContain('htmx');
  });

  it('GET /orchestrator serves orchestrator HTML', async () => {
    const res = await get('/orchestrator');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Orchestrator');
  });

  it('GET /chains/:id serves chain detail HTML with ID injected', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'page test', config: {} });
    saveRegistry(reg);

    const res = await get(`/chains/${chain.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(chain.id);
    expect(res.text).toContain('chain-detail');
  });

  it('GET /style.css serves CSS', async () => {
    const res = await get('/style.css');
    expect(res.status).toBe(200);
    expect(res.text).toContain('.status-dot');
  });
});

describe('View Routes — Git Status Fragment', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/git-status returns HTML', async () => {
    const res = await get('/views/git-status');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

describe('View Routes — Report Viewer Fragment', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/report-viewer returns HTML', async () => {
    const res = await get('/views/report-viewer');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    // Should contain either report content or empty state
    expect(res.text.length).toBeGreaterThan(10);
  });

  it('shows report content or empty state', async () => {
    const res = await get('/views/report-viewer');
    // Either shows a report with content div or empty state
    const hasReports = res.text.includes('report-content');
    const isEmpty = res.text.includes('No reports');
    expect(hasReports || isEmpty).toBe(true);
  });
});

describe('View Routes — Chain Restart Button', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('shows restart button for failed chains in chain-list', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'failed task', config: { model: 'sonnet' } });
    updateChainStatus(chain, 'failed');
    saveRegistry(reg);

    const res = await get('/views/chain-list');
    expect(res.text).toContain('Restart');
    expect(res.text).toContain(`/api/chains/${chain.id}/restart`);
  });

  it('shows restart button on chain detail for aborted chains', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'aborted task', config: {} });
    updateChainStatus(chain, 'aborted');
    saveRegistry(reg);

    const res = await get(`/views/chain-detail/${chain.id}`);
    expect(res.text).toContain('Restart Chain');
  });

  it('does not show restart for running chains', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'running task', config: {} });
    saveRegistry(reg);

    const res = await get(`/views/chain-detail/${chain.id}`);
    expect(res.text).not.toContain('Restart Chain');
  });
});

describe('View Routes — Mission Launcher Fragment', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/mission-launcher returns form HTML', async () => {
    const res = await get('/views/mission-launcher');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    // Should contain either form (stopped) or running message
    expect(res.text.length).toBeGreaterThan(10);
  });

  it('mission launcher includes model dropdown', async () => {
    const res = await get('/views/mission-launcher');
    expect(res.text).toContain('name="model"');
    expect(res.text).toContain('Sonnet');
    expect(res.text).toContain('Opus');
    expect(res.text).toContain('Haiku');
  });
});

// ── S91: New Feature View Tests ──────────────────────────────

describe('View Routes — Chain Detail PR Button (S91)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('shows Create PR button for completed chains', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'completed task', config: { model: 'sonnet' } });
    recordSession(chain, { turns: 5, costUsd: 0.10, durationMs: 5000 });
    updateChainStatus(chain, 'complete');
    saveRegistry(reg);

    const res = await get(`/views/chain-detail/${chain.id}`);
    expect(res.text).toContain('Create PR');
    expect(res.text).toContain('/api/git/pr');
  });

  it('hides Create PR button for running chains', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'running task', config: {} });
    saveRegistry(reg);

    const res = await get(`/views/chain-detail/${chain.id}`);
    expect(res.text).not.toContain('Create PR');
  });
});

describe('View Routes — Orchestrator Model Display (S91)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('shows model in orchestrator status when set', async () => {
    appCtx.events.emit('orchestrator:started', { mission: 'test', model: 'opus', dryRun: false });

    const res = await get('/views/orch-status');
    expect(res.text).toContain('opus');
  });
});

describe('View Routes — Report Filter (S91)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('report viewer includes search input when reports exist', async () => {
    const res = await get('/views/report-viewer');
    // If there are reports, the search filter should be present
    if (res.text.includes('report-content')) {
      expect(res.text).toContain('report-search');
      expect(res.text).toContain('filterReports');
    }
  });
});

describe('View Routes — Git Status Auto-Push Toggle (S91)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('git status fragment includes auto-push toggle', async () => {
    const res = await get('/views/git-status');
    expect(res.text).toContain('auto-push-toggle');
    expect(res.text).toContain('Auto-push');
  });
});
