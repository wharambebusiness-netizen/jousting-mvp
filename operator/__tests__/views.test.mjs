// ============================================================
// M5+P3: View Renderer & Route Tests
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { createApp } from '../server.mjs';
import { createRegistry, createChain, recordSession, updateChainStatus, getChainLineage } from '../registry.mjs';

// ── View Helpers ────────────────────────────────────────────

import { escapeHtml, formatCost, formatDuration, relativeTime, statusLabel } from '../views/helpers.mjs';
import {
  aggregateAnalytics, renderAnalyticsMetrics, renderCostTimeline,
  renderStatusBreakdown, renderModelUsage, renderTopChains, renderAnalyticsPanel,
} from '../views/analytics.mjs';
import { renderProjectsPanel, renderProjectCard, renderFileTree } from '../views/projects.mjs';
import { scanDirectory, MAX_FILE_SIZE, TEXT_EXTS, isBinary } from '../routes/files.mjs';
import { getGitFileStatus } from '../routes/git.mjs';

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

// Convenience aliases matching old API names (each call creates a fresh store for the same path)
function loadRegistry() { return createRegistry({ operatorDir: TEST_DIR }).load(); }
function saveRegistry(data) { createRegistry({ operatorDir: TEST_DIR }).save(data); }

function setupApp() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  appCtx = createApp({ operatorDir: TEST_DIR, auth: false });
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

  it('GET /orchestrator returns 404 (page removed)', async () => {
    const res = await get('/orchestrator');
    expect(res.status).toBe(404);
  });

  it('dashboard contains analytics panel (merged from analytics page)', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('analytics-panel');
    expect(res.text).toContain('/views/analytics');
  });

  it('dashboard contains report viewer (merged from orchestrator page)', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('report-viewer');
    expect(res.text).toContain('/views/report-viewer');
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

// ── Terminal Viewer Tests (P3) ───────────────────────────────

import { ansiToHtml, renderTerminalViewer } from '../views/terminal.mjs';

describe('Terminal Viewer — ANSI to HTML', () => {
  it('converts basic ANSI color codes', () => {
    const result = ansiToHtml('\x1b[31mred text\x1b[0m');
    expect(result).toContain('ansi-red');
    expect(result).toContain('red text');
    expect(result).toContain('</span>');
  });

  it('escapes HTML in content', () => {
    const result = ansiToHtml('<script>alert("xss")</script>');
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('handles bold style', () => {
    const result = ansiToHtml('\x1b[1;32mbold green\x1b[0m');
    expect(result).toContain('ansi-bold');
    expect(result).toContain('ansi-green');
  });

  it('strips unknown ANSI sequences', () => {
    const result = ansiToHtml('before\x1b[2Kafter');
    expect(result).toBe('beforeafter');
  });

  it('handles empty input', () => {
    expect(ansiToHtml('')).toBe('');
    expect(ansiToHtml(null)).toBe('');
  });
});

describe('Terminal Viewer — renderTerminalViewer', () => {
  it('renders terminal with content', () => {
    const html = renderTerminalViewer({ content: 'hello world', title: 'Test' });
    expect(html).toContain('terminal-viewer');
    expect(html).toContain('terminal__body');
    expect(html).toContain('terminal__title');
    expect(html).toContain('Test');
    expect(html).toContain('hello world');
  });

  it('renders terminal without title', () => {
    const html = renderTerminalViewer({ content: 'output' });
    expect(html).toContain('terminal__body');
    expect(html).not.toContain('terminal__title');
  });

  it('shows empty state when no content', () => {
    const html = renderTerminalViewer({ content: '' });
    expect(html).toContain('empty-state');
  });

  it('respects maxHeight option', () => {
    const html = renderTerminalViewer({ content: 'data', maxHeight: 300 });
    expect(html).toContain('max-height:300px');
  });
});

// ── Settings Form View Route Tests (P3) ─────────────────────

describe('View Routes — Settings Form (P3)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('returns settings form with defaults', async () => {
    const res = await get('/views/settings-form');
    expect(res.status).toBe(200);
    expect(res.text).toContain('settings-save-form');
    expect(res.text).toContain('name="model"');
    expect(res.text).toContain('name="maxTurns"');
    expect(res.text).toContain('name="maxContinuations"');
    expect(res.text).toContain('name="maxBudgetUsd"');
    expect(res.text).toContain('Sonnet');
    expect(res.text).toContain('Opus');
    expect(res.text).toContain('Haiku');
  });

  it('returns git settings fragment', async () => {
    const res = await get('/views/settings-git');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="autoPush"');
    expect(res.text).toContain('Auto-push');
  });

  it('returns coordination settings fragment', async () => {
    const res = await get('/views/settings-coordination');
    expect(res.status).toBe(200);
    expect(res.text).toContain('maxRequestsPerMinute');
    expect(res.text).toContain('maxTokensPerMinute');
  });

  it('returns UI settings fragment', async () => {
    const res = await get('/views/settings-ui');
    expect(res.status).toBe(200);
    expect(res.text).toContain('particlesEnabled');
    expect(res.text).toContain('defaultTerminalTheme');
    expect(res.text).toContain('Nebula');
  });

  it('returns system info fragment', async () => {
    const res = await get('/views/settings-system');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Uptime');
    expect(res.text).toContain('Memory');
    expect(res.text).toContain('Node');
  });
});

// ── Cost Summary Project Filter Tests (P3) ──────────────────

describe('View Routes — Cost Summary Project Filter (P3)', () => {
  beforeEach(function() {
    setupApp();
    const reg = loadRegistry();
    createChain(reg, { task: 'alpha task', config: {}, projectDir: '/proj/alpha' });
    const c = createChain(reg, { task: 'beta task', config: {}, projectDir: '/proj/beta' });
    recordSession(c, { turns: 5, costUsd: 1.50, durationMs: 5000 });
    saveRegistry(reg);
  });
  afterEach(teardownApp);

  it('returns all costs without filter', async () => {
    const res = await get('/views/cost-summary');
    expect(res.status).toBe(200);
    expect(res.text).toContain('metric-card');
  });

  it('filters costs by project', async () => {
    const proj = encodeURIComponent('/proj/beta');
    const res = await get(`/views/cost-summary?project=${proj}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('$1.50');
  });
});

// ── Chain List Sort/Direction View Tests (P4) ────────────────

describe('View Routes — Chain List Sort/Direction (P4)', () => {
  beforeEach(function() {
    setupApp();
    const reg = loadRegistry();
    const c1 = createChain(reg, { task: 'cheap task', config: {} });
    recordSession(c1, { turns: 1, costUsd: 0.10, durationMs: 1000 });
    updateChainStatus(c1, 'complete');
    const c2 = createChain(reg, { task: 'expensive task', config: {} });
    recordSession(c2, { turns: 10, costUsd: 5.00, durationMs: 50000 });
    saveRegistry(reg);
  });
  afterEach(teardownApp);

  it('sorts by cost descending', async () => {
    const res = await get('/views/chain-list?sort=cost&dir=desc');
    expect(res.status).toBe(200);
    expect(res.text).toContain('expensive task');
    expect(res.text).toContain('cheap task');
  });

  it('sorts by cost ascending', async () => {
    const res = await get('/views/chain-list?sort=cost&dir=asc');
    expect(res.status).toBe(200);
    expect(res.text).toContain('cheap task');
    expect(res.text).toContain('expensive task');
  });

  it('sorts by status', async () => {
    const res = await get('/views/chain-list?sort=status');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<tr>');
  });
});

// ── Chain List Project Filter View Tests (P4) ────────────────

describe('View Routes — Chain List Project Filter (P4)', () => {
  beforeEach(function() {
    setupApp();
    const reg = loadRegistry();
    createChain(reg, { task: 'proj-a task', config: {}, projectDir: '/projects/a' });
    createChain(reg, { task: 'proj-b task', config: {}, projectDir: '/projects/b' });
    saveRegistry(reg);
  });
  afterEach(teardownApp);

  it('filters chains by project', async () => {
    const proj = encodeURIComponent('/projects/a');
    const res = await get(`/views/chain-list?project=${proj}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('proj-a task');
    expect(res.text).not.toContain('proj-b task');
  });

  it('shows all chains without project filter', async () => {
    const res = await get('/views/chain-list');
    expect(res.status).toBe(200);
    expect(res.text).toContain('proj-a task');
    expect(res.text).toContain('proj-b task');
  });
});

// ── Agent Grid in Orch Status Tests (P4) ────────────────────

// ── Delete Button Tests (P5) ────────────────────────────────

describe('Chain Row — Delete Button (P5)', () => {
  const mockChain = {
    id: 'del-123',
    task: 'Delete test',
    status: 'complete',
    sessions: 1,
    totalCostUsd: 0.10,
    config: { model: 'sonnet' },
    updatedAt: new Date().toISOString(),
  };

  it('shows delete button for non-running chains', () => {
    const html = renderChainRow(mockChain);
    expect(html).toContain('Del');
    expect(html).toContain('hx-delete="/api/chains/del-123"');
    expect(html).toContain('hx-confirm');
  });

  it('hides delete button for running chains', () => {
    const html = renderChainRow({ ...mockChain, status: 'running' });
    expect(html).not.toContain('hx-delete');
  });

  it('shows delete button for failed chains alongside restart', () => {
    const html = renderChainRow({ ...mockChain, status: 'failed' });
    expect(html).toContain('Restart');
    expect(html).toContain('Del');
  });
});

// ── Chain Detail Delete Button (P5) ──────────────────────────

describe('View Routes — Chain Detail Delete Button (P5)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('shows delete button on chain detail for complete chain', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'del detail test', config: { model: 'sonnet' } });
    updateChainStatus(chain, 'complete');
    saveRegistry(reg);

    const res = await get(`/views/chain-detail/${chain.id}`);
    expect(res.text).toContain('Delete Chain');
    expect(res.text).toContain(`hx-delete="/api/chains/${chain.id}"`);
  });

  it('hides delete button on chain detail for running chain', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'running no delete', config: { model: 'sonnet' } });
    saveRegistry(reg);

    const res = await get(`/views/chain-detail/${chain.id}`);
    expect(res.text).not.toContain('Delete Chain');
  });
});

// ── Pagination Tests (P5) ───────────────────────────────────

describe('View Routes — Chain List Pagination (P5)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('paginates with page and limit params', async () => {
    const reg = loadRegistry();
    for (let i = 0; i < 5; i++) {
      createChain(reg, { task: `Pagination task ${i}`, config: { model: 'sonnet' } });
    }
    saveRegistry(reg);

    const page1 = await get('/views/chain-list?limit=2&page=1');
    expect(page1.text).toContain('Pagination task');
    expect(page1.text).toContain('1–2 of 5');
    expect(page1.text).toContain('Next');
    expect(page1.text).not.toContain('Prev');

    const page2 = await get('/views/chain-list?limit=2&page=2');
    expect(page2.text).toContain('3–4 of 5');
    expect(page2.text).toContain('Prev');
    expect(page2.text).toContain('Next');

    const page3 = await get('/views/chain-list?limit=2&page=3');
    expect(page3.text).toContain('5–5 of 5');
    expect(page3.text).toContain('Prev');
    expect(page3.text).not.toContain('Next');
  });

  it('shows no pagination when under limit', async () => {
    const reg = loadRegistry();
    createChain(reg, { task: 'Solo chain', config: { model: 'sonnet' } });
    saveRegistry(reg);

    const res = await get('/views/chain-list?limit=25&page=1');
    expect(res.text).toContain('Solo chain');
    expect(res.text).not.toContain('pagination__info');
  });

  it('defaults to page 1 with limit 25', async () => {
    const reg = loadRegistry();
    for (let i = 0; i < 30; i++) {
      createChain(reg, { task: `Chain ${i}`, config: { model: 'sonnet' } });
    }
    saveRegistry(reg);

    const res = await get('/views/chain-list');
    expect(res.text).toContain('1–25 of 30');
  });
});

describe('View Routes — Agent Grid in Orch Status (P4)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('shows agent cards after agent:start events', async () => {
    // Emit orchestrator:started to set running state
    appCtx.events.emit('orchestrator:started', { mission: 'test-mission' });

    // Emit agent:start events to populate agent list
    appCtx.events.emit('agent:start', { agentId: 'agent-1', model: 'sonnet' });
    appCtx.events.emit('agent:start', { agentId: 'agent-2', model: 'opus' });

    const res = await get('/views/orch-status');
    expect(res.status).toBe(200);
    expect(res.text).toContain('agent-grid');
    expect(res.text).toContain('agent-1');
    expect(res.text).toContain('agent-2');
  });

  it('shows agent status change after completion', async () => {
    appCtx.events.emit('orchestrator:started', { mission: 'metrics-test' });
    appCtx.events.emit('agent:start', { agentId: 'agent-x', model: 'sonnet' });
    appCtx.events.emit('agent:complete', { agentId: 'agent-x', elapsedMs: 5000 });

    const res = await get('/views/orch-status');
    expect(res.text).toContain('agent-x');
    expect(res.text).toContain('Complete');
    expect(res.text).toContain('agent-complete');
  });
});

// ── Orchestrator Run History View (P7) ───────────────────────

describe('View Routes — Orch History (P7)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/orch-history shows empty state when no runs', async () => {
    const res = await get('/views/orch-history');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No orchestrator runs recorded yet');
  });

  it('GET /views/orch-history shows runs after start+stop', async () => {
    appCtx.events.emit('orchestrator:started', { mission: 'view-test', model: 'opus', dryRun: true });
    appCtx.events.emit('round:start', { round: 2 });
    appCtx.events.emit('agent:start', { agentId: 'v-agent' });
    appCtx.events.emit('orchestrator:stopped', {});

    const res = await get('/views/orch-history');
    expect(res.status).toBe(200);
    expect(res.text).toContain('orch-history-table');
    expect(res.text).toContain('view-test');
    expect(res.text).toContain('opus');
    expect(res.text).toContain('dry-run');
  });
});

// ── Chain Lineage View (P7) ──────────────────────────────────

describe('Chain Lineage (P7)', () => {
  it('returns single entry for standalone chain', () => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'solo chain', config: {} });
    saveRegistry(reg);

    const lineage = getChainLineage(reg, chain.id);
    expect(lineage.length).toBe(1);
    expect(lineage[0].id).toBe(chain.id);

    rmSync(TEST_DIR, { recursive: true });
  });

  it('builds lineage tree for restarted chains', () => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    const reg = loadRegistry();

    const root = createChain(reg, { task: 'original task', config: {} });
    updateChainStatus(root, 'failed');
    const child = createChain(reg, { task: 'original task', config: {}, restartedFrom: root.id });
    updateChainStatus(child, 'failed');
    const grandchild = createChain(reg, { task: 'original task', config: {}, restartedFrom: child.id });
    saveRegistry(reg);

    const lineage = getChainLineage(reg, grandchild.id);
    expect(lineage.length).toBe(3);
    expect(lineage[0].id).toBe(root.id);
    expect(lineage[0].depth).toBe(0);
    expect(lineage[1].id).toBe(child.id);
    expect(lineage[1].depth).toBe(1);
    expect(lineage[2].id).toBe(grandchild.id);
    expect(lineage[2].depth).toBe(2);

    rmSync(TEST_DIR, { recursive: true });
  });

  it('handles branching (multiple restarts from same parent)', () => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    const reg = loadRegistry();

    const root = createChain(reg, { task: 'parent task', config: {} });
    updateChainStatus(root, 'failed');
    const childA = createChain(reg, { task: 'parent task', config: {}, restartedFrom: root.id });
    const childB = createChain(reg, { task: 'parent task', config: {}, restartedFrom: root.id });
    saveRegistry(reg);

    const lineage = getChainLineage(reg, childA.id);
    expect(lineage.length).toBe(3);
    expect(lineage[0].depth).toBe(0);
    expect(lineage[1].depth).toBe(1);
    expect(lineage[2].depth).toBe(1);

    rmSync(TEST_DIR, { recursive: true });
  });
});

describe('View Routes — Chain Lineage Fragment (P7)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/chain-lineage/:id returns empty for standalone chain', async () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'standalone', config: {} });
    saveRegistry(reg);

    const res = await get(`/views/chain-lineage/${chain.id}`);
    expect(res.status).toBe(200);
    // Single-chain lineage returns empty (nothing to show)
    expect(res.text).not.toContain('lineage');
  });

  it('GET /views/chain-lineage/:id renders lineage for restarted chains', async () => {
    const reg = loadRegistry();
    const root = createChain(reg, { task: 'original chain task', config: {} });
    root.status = 'failed';
    const child = createChain(reg, { task: 'original chain task', config: {}, restartedFrom: root.id });
    saveRegistry(reg);

    const res = await get(`/views/chain-lineage/${child.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('lineage');
    expect(res.text).toContain('original chain task');
    expect(res.text).toContain('lineage__node--current');
  });
});

// ── Analytics Unit Tests (P8) ────────────────────────────────

describe('Analytics — aggregateAnalytics', () => {
  function makeChain(overrides = {}) {
    return {
      id: 'c-' + Math.random().toString(36).slice(2),
      task: overrides.task || 'test task',
      status: overrides.status || 'complete',
      startedAt: overrides.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: { model: overrides.model || 'sonnet' },
      sessions: overrides.sessions || [],
      totalCostUsd: overrides.totalCostUsd || 0,
      totalTurns: overrides.totalTurns || 0,
      totalDurationMs: overrides.totalDurationMs || 0,
      ...overrides,
    };
  }

  it('returns zeros for empty chains', () => {
    const data = aggregateAnalytics([]);
    expect(data.totalChains).toBe(0);
    expect(data.totalCost).toBe(0);
    expect(data.successRate).toBe(0);
    expect(data.topChains).toEqual([]);
    expect(data.days.length).toBe(30);
  });

  it('aggregates cost and turns', () => {
    const chains = [
      makeChain({ totalCostUsd: 1.50, totalTurns: 10, totalDurationMs: 5000 }),
      makeChain({ totalCostUsd: 2.50, totalTurns: 20, totalDurationMs: 10000 }),
    ];
    const data = aggregateAnalytics(chains);
    expect(data.totalCost).toBe(4.0);
    expect(data.totalTurns).toBe(30);
    expect(data.totalDuration).toBe(15000);
    expect(data.totalChains).toBe(2);
    expect(data.avgCostPerChain).toBe(2.0);
  });

  it('calculates success rate', () => {
    const chains = [
      makeChain({ status: 'complete' }),
      makeChain({ status: 'complete' }),
      makeChain({ status: 'failed' }),
      makeChain({ status: 'running' }),
    ];
    const data = aggregateAnalytics(chains);
    // 2 completed out of 3 finished (running not counted)
    expect(data.completed).toBe(2);
    expect(data.failed).toBe(1);
    expect(data.finished).toBe(3);
    expect(Math.round(data.successRate)).toBe(67);
  });

  it('groups by model', () => {
    const chains = [
      makeChain({ model: 'sonnet', totalCostUsd: 1.0 }),
      makeChain({ model: 'opus', totalCostUsd: 3.0 }),
      makeChain({ model: 'sonnet', totalCostUsd: 2.0 }),
    ];
    const data = aggregateAnalytics(chains);
    expect(data.byModel.sonnet.count).toBe(2);
    expect(data.byModel.sonnet.cost).toBe(3.0);
    expect(data.byModel.opus.count).toBe(1);
    expect(data.byModel.opus.cost).toBe(3.0);
  });

  it('groups by status', () => {
    const chains = [
      makeChain({ status: 'complete' }),
      makeChain({ status: 'failed' }),
      makeChain({ status: 'complete' }),
    ];
    const data = aggregateAnalytics(chains);
    expect(data.byStatus.complete.count).toBe(2);
    expect(data.byStatus.failed.count).toBe(1);
  });

  it('aggregates daily cost for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    const chains = [
      makeChain({ startedAt: new Date().toISOString(), totalCostUsd: 1.50 }),
    ];
    const data = aggregateAnalytics(chains);
    expect(data.dailyCost[today]).toBe(1.50);
  });

  it('aggregates token counts from sessions', () => {
    const chains = [
      makeChain({
        sessions: [
          { inputTokens: 1000, outputTokens: 500 },
          { inputTokens: 2000, outputTokens: 800 },
        ],
      }),
    ];
    const data = aggregateAnalytics(chains);
    expect(data.totalInputTokens).toBe(3000);
    expect(data.totalOutputTokens).toBe(1300);
  });

  it('ranks top chains by cost', () => {
    const chains = [
      makeChain({ task: 'cheap', totalCostUsd: 0.50 }),
      makeChain({ task: 'expensive', totalCostUsd: 5.00 }),
      makeChain({ task: 'medium', totalCostUsd: 2.00 }),
    ];
    const data = aggregateAnalytics(chains);
    expect(data.topChains[0].task).toBe('expensive');
    expect(data.topChains[1].task).toBe('medium');
    expect(data.topChains[2].task).toBe('cheap');
  });
});

describe('Analytics — Chart Renderers', () => {
  const sampleData = aggregateAnalytics([
    {
      id: 'c1', task: 'task one', status: 'complete',
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      config: { model: 'sonnet' },
      sessions: [{ inputTokens: 100, outputTokens: 50, costUsd: 0.5, turns: 5, durationMs: 3000 }],
      totalCostUsd: 0.5, totalTurns: 5, totalDurationMs: 3000,
    },
    {
      id: 'c2', task: 'task two', status: 'failed',
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      config: { model: 'opus' },
      sessions: [{ inputTokens: 200, outputTokens: 100, costUsd: 2.0, turns: 10, durationMs: 8000 }],
      totalCostUsd: 2.0, totalTurns: 10, totalDurationMs: 8000,
    },
  ]);

  it('renderAnalyticsMetrics returns metric cards', () => {
    const html = renderAnalyticsMetrics(sampleData);
    expect(html).toContain('metrics-grid');
    expect(html).toContain('metric-card');
    expect(html).toContain('Total Cost');
    expect(html).toContain('Success Rate');
    expect(html).toContain('$2.50');
    expect(html).toContain('2 chains');
  });

  it('renderCostTimeline returns SVG bar chart', () => {
    const html = renderCostTimeline(sampleData);
    expect(html).toContain('chart-container');
    expect(html).toContain('<svg');
    expect(html).toContain('chart-bar');
    expect(html).toContain('Daily Cost');
  });

  it('renderStatusBreakdown returns donut chart', () => {
    const html = renderStatusBreakdown(sampleData);
    expect(html).toContain('donut-svg');
    expect(html).toContain('Chain Outcomes');
    expect(html).toContain('legend-item');
    expect(html).toContain('complete');
    expect(html).toContain('failed');
  });

  it('renderStatusBreakdown handles empty data', () => {
    const emptyData = aggregateAnalytics([]);
    const html = renderStatusBreakdown(emptyData);
    expect(html).toContain('empty-state');
  });

  it('renderModelUsage returns horizontal bar chart', () => {
    const html = renderModelUsage(sampleData);
    expect(html).toContain('Model Usage');
    expect(html).toContain('hbar-row');
    expect(html).toContain('sonnet');
    expect(html).toContain('opus');
  });

  it('renderModelUsage handles empty data', () => {
    const emptyData = aggregateAnalytics([]);
    const html = renderModelUsage(emptyData);
    expect(html).toContain('empty-state');
  });

  it('renderTopChains returns cost leaderboard', () => {
    const html = renderTopChains(sampleData);
    expect(html).toContain('analytics-table');
    expect(html).toContain('Top Chains');
    expect(html).toContain('task two');
    expect(html).toContain('task one');
  });

  it('renderTopChains handles empty data', () => {
    const emptyData = aggregateAnalytics([]);
    const html = renderTopChains(emptyData);
    expect(html).toContain('empty-state');
  });

  it('renderAnalyticsPanel combines all charts', () => {
    const html = renderAnalyticsPanel([
      {
        id: 'c1', task: 'combined test', status: 'complete',
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        config: { model: 'sonnet' }, sessions: [],
        totalCostUsd: 1.0, totalTurns: 5, totalDurationMs: 3000,
      },
    ]);
    expect(html).toContain('analytics-panel');
    expect(html).toContain('metrics-grid');
    expect(html).toContain('chart-container');
    expect(html).toContain('analytics-table');
  });
});

// ── Analytics View Route Tests (P8) ──────────────────────────

describe('View Routes — Analytics (P8)', () => {
  beforeEach(function() {
    setupApp();
    const reg = loadRegistry();
    const c1 = createChain(reg, { task: 'analytics task 1', config: { model: 'sonnet' }, projectDir: '/proj/a' });
    recordSession(c1, { turns: 5, costUsd: 1.50, durationMs: 5000, inputTokens: 1000, outputTokens: 500 });
    updateChainStatus(c1, 'complete');
    const c2 = createChain(reg, { task: 'analytics task 2', config: { model: 'opus' }, projectDir: '/proj/b' });
    recordSession(c2, { turns: 10, costUsd: 3.00, durationMs: 10000, inputTokens: 2000, outputTokens: 800 });
    saveRegistry(reg);
  });
  afterEach(teardownApp);

  it('GET /views/analytics returns full analytics panel', async () => {
    const res = await get('/views/analytics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('analytics-panel');
    expect(res.text).toContain('metrics-grid');
    expect(res.text).toContain('chart-container');
    expect(res.text).toContain('$4.50');
  });

  it('GET /views/analytics filters by project', async () => {
    const proj = encodeURIComponent('/proj/a');
    const res = await get(`/views/analytics?project=${proj}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('$1.50');
    expect(res.text).not.toContain('$4.50');
  });

  it('GET /views/analytics returns empty state with no chains', async () => {
    // Reset to empty registry
    const reg = loadRegistry();
    // Clear chains
    reg.chains = [];
    saveRegistry(reg);

    const res = await get('/views/analytics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('empty-state');
  });
});

// ── scanDirectory Unit Tests (P9) ─────────────────────────────

describe('scanDirectory', () => {
  const SCAN_DIR = join(import.meta.dirname, '..', '__test_tmp_scan');

  beforeEach(() => {
    if (existsSync(SCAN_DIR)) rmSync(SCAN_DIR, { recursive: true });
    mkdirSync(join(SCAN_DIR, 'src', 'engine'), { recursive: true });
    mkdirSync(join(SCAN_DIR, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(SCAN_DIR, '.git', 'objects'), { recursive: true });
    writeFileSync(join(SCAN_DIR, 'package.json'), '{}');
    writeFileSync(join(SCAN_DIR, 'README.md'), '# Test');
    writeFileSync(join(SCAN_DIR, 'src', 'index.ts'), 'export {};');
    writeFileSync(join(SCAN_DIR, 'src', 'engine', 'types.ts'), '');
    writeFileSync(join(SCAN_DIR, 'node_modules', 'pkg', 'index.js'), '');
  });

  afterEach(() => {
    if (existsSync(SCAN_DIR)) rmSync(SCAN_DIR, { recursive: true });
  });

  it('lists directories before files alphabetically', () => {
    const entries = scanDirectory(SCAN_DIR);
    const names = entries.map(e => e.name);
    // src/ should come before package.json and README.md
    expect(names.indexOf('src')).toBeLessThan(names.indexOf('package.json'));
    expect(entries.find(e => e.name === 'src').type).toBe('dir');
    expect(entries.find(e => e.name === 'package.json').type).toBe('file');
  });

  it('excludes node_modules and .git', () => {
    const entries = scanDirectory(SCAN_DIR);
    const names = entries.map(e => e.name);
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
  });

  it('includes file size', () => {
    const entries = scanDirectory(SCAN_DIR);
    const pkg = entries.find(e => e.name === 'package.json');
    expect(pkg).toBeDefined();
    expect(pkg.size).toBe(2); // '{}'
  });

  it('includes child count for directories', () => {
    const entries = scanDirectory(SCAN_DIR);
    const src = entries.find(e => e.name === 'src');
    expect(src).toBeDefined();
    expect(src.children).toBeGreaterThan(0);
  });

  it('scans subdirectories with subPath', () => {
    const entries = scanDirectory(SCAN_DIR, 'src');
    const names = entries.map(e => e.name);
    expect(names).toContain('engine');
    expect(names).toContain('index.ts');
  });

  it('returns empty array for nonexistent path', () => {
    const entries = scanDirectory(SCAN_DIR, 'nonexistent');
    expect(entries).toEqual([]);
  });

  it('uses forward slashes in paths', () => {
    const entries = scanDirectory(SCAN_DIR, 'src');
    const engine = entries.find(e => e.name === 'engine');
    expect(engine.path).toBe('src/engine');
    expect(engine.path).not.toContain('\\');
  });
});

// ── Project View Renderer Tests (P9) ──────────────────────────

describe('Projects — renderFileTree', () => {
  it('renders directory entries with details/summary', () => {
    const entries = [
      { name: 'src', type: 'dir', path: 'src', children: 5 },
      { name: 'index.ts', type: 'file', path: 'index.ts', size: 100 },
    ];
    const html = renderFileTree(entries, '/proj');
    expect(html).toContain('tree-dir');
    expect(html).toContain('tree-summary');
    expect(html).toContain('src/');
    expect(html).toContain('5 items');
    expect(html).toContain('tree-file');
    expect(html).toContain('index.ts');
  });

  it('shows empty directory message', () => {
    const html = renderFileTree([], '/proj');
    expect(html).toContain('tree-empty');
    expect(html).toContain('Empty directory');
  });

  it('escapes HTML in file names', () => {
    const entries = [
      { name: '<script>alert(1)</script>', type: 'file', path: 'x', size: 0 },
    ];
    const html = renderFileTree(entries, '/proj');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });
});

describe('Projects — renderProjectCard', () => {
  it('renders project name from path', () => {
    const project = {
      projectDir: '/home/user/my-project',
      chains: 5, running: 1, completed: 3, failed: 1,
      totalCostUsd: 2.50, lastActivity: new Date().toISOString(),
    };
    const html = renderProjectCard(project, []);
    expect(html).toContain('project-card');
    expect(html).toContain('my-project');
    expect(html).toContain('5 chains');
    expect(html).toContain('1 running');
    expect(html).toContain('3 done');
    expect(html).toContain('1 failed');
    expect(html).toContain('$2.50');
  });

  it('handles default project', () => {
    const project = {
      projectDir: null,
      chains: 1, running: 0, completed: 1, failed: 0,
      totalCostUsd: 0, lastActivity: null,
    };
    const html = renderProjectCard(project, []);
    expect(html).toContain('Default Project');
    expect(html).toContain('No project directory set');
  });

  it('includes refresh button', () => {
    const project = {
      projectDir: '/proj',
      chains: 0, running: 0, completed: 0, failed: 0,
      totalCostUsd: 0, lastActivity: null,
    };
    const html = renderProjectCard(project, []);
    expect(html).toContain('project-card__refresh');
    expect(html).toContain('refreshProjectTree');
  });
});

describe('Projects — renderProjectsPanel', () => {
  it('renders empty state when no projects', () => {
    const html = renderProjectsPanel([], new Map());
    expect(html).toContain('projects-panel');
    expect(html).toContain('No projects found');
  });

  it('renders multiple project cards', () => {
    const projects = [
      { projectDir: '/proj/a', chains: 2, running: 0, completed: 2, failed: 0, totalCostUsd: 1, lastActivity: new Date().toISOString() },
      { projectDir: '/proj/b', chains: 1, running: 1, completed: 0, failed: 0, totalCostUsd: 0.5, lastActivity: new Date().toISOString() },
    ];
    const rootMap = new Map();
    rootMap.set('/proj/a', [{ name: 'src', type: 'dir', path: 'src', children: 3 }]);
    rootMap.set('/proj/b', []);
    const html = renderProjectsPanel(projects, rootMap);
    expect(html).toContain('project-card');
    expect(html).toContain('2 chains');
    expect(html).toContain('1 chain');
  });
});

// ── Projects View Route Tests (P9) ───────────────────────────

describe('View Routes — Projects (P9)', () => {
  beforeEach(function() {
    setupApp();
    const reg = loadRegistry();
    // Use a real path that exists for file tree scanning
    createChain(reg, {
      task: 'project test chain',
      config: { model: 'sonnet' },
      projectDir: join(import.meta.dirname, '..'),
    });
    saveRegistry(reg);
  });
  afterEach(teardownApp);

  it('GET /views/projects returns projects panel', async () => {
    const res = await get('/views/projects');
    expect(res.status).toBe(200);
    expect(res.text).toContain('projects-panel');
    expect(res.text).toContain('project-card');
  });

  it('GET /views/projects shows file tree entries', async () => {
    const res = await get('/views/projects');
    expect(res.status).toBe(200);
    // The operator/ directory should contain known files
    expect(res.text).toContain('tree-dir');
  });

  it('GET /views/file-tree returns subtree for valid path', async () => {
    const root = encodeURIComponent(join(import.meta.dirname, '..'));
    const res = await get(`/views/file-tree?root=${root}&path=views`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('helpers.mjs');
    expect(res.text).toContain('analytics.mjs');
    expect(res.text).toContain('projects.mjs');
  });

  it('GET /views/file-tree returns empty for missing root', async () => {
    const res = await get('/views/file-tree');
    expect(res.status).toBe(200);
    expect(res.text).toContain('No root specified');
  });

  it('GET /views/file-tree blocks path traversal', async () => {
    const root = encodeURIComponent(join(import.meta.dirname, '..'));
    const res = await get(`/views/file-tree?root=${root}&path=../../..`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Access denied');
  });

  it('GET /views/projects shows server project even with no chains', async () => {
    const reg = loadRegistry();
    reg.chains = [];
    saveRegistry(reg);

    const res = await get('/views/projects');
    expect(res.status).toBe(200);
    // Server always includes its own project directory
    expect(res.text).toContain('projects-panel');
    expect(res.text).toContain('0 chains');
  });
});

// ── P10: File Content Preview Tests ─────────────────────────────

describe('File Content API — isBinary', () => {
  it('detects binary files with null bytes', () => {
    const buf = Buffer.from([0x48, 0x65, 0x00, 0x6C, 0x6C, 0x6F]); // He\0llo
    expect(isBinary(buf)).toBe(true);
  });

  it('detects text files without null bytes', () => {
    const buf = Buffer.from('Hello world\nLine 2\n');
    expect(isBinary(buf)).toBe(false);
  });

  it('handles empty buffer', () => {
    expect(isBinary(Buffer.alloc(0))).toBe(false);
  });
});

describe('File Content API — TEXT_EXTS', () => {
  it('includes common text extensions', () => {
    for (const ext of ['js', 'mjs', 'ts', 'tsx', 'json', 'md', 'html', 'css', 'py', 'go', 'rs']) {
      expect(TEXT_EXTS.has(ext)).toBe(true);
    }
  });

  it('does not include image extensions', () => {
    for (const ext of ['png', 'jpg', 'gif', 'bmp', 'mp3', 'mp4']) {
      expect(TEXT_EXTS.has(ext)).toBe(false);
    }
  });
});

describe('File Content API — /api/files/content route', () => {
  const CONTENT_DIR = join(import.meta.dirname, '..', '__test_tmp_content');

  beforeEach(function() {
    setupApp();
    if (existsSync(CONTENT_DIR)) rmSync(CONTENT_DIR, { recursive: true });
    mkdirSync(CONTENT_DIR, { recursive: true });
    writeFileSync(join(CONTENT_DIR, 'hello.txt'), 'Hello\nWorld\n');
    writeFileSync(join(CONTENT_DIR, 'code.js'), 'const x = 42;\nconsole.log(x);\n');
    writeFileSync(join(CONTENT_DIR, 'binary.dat'), Buffer.from([0x00, 0xFF, 0x00, 0xFF]));
    mkdirSync(join(CONTENT_DIR, 'subdir'));
    // Register CONTENT_DIR as a project so root validation passes
    const reg = loadRegistry();
    createChain(reg, { task: 'test content', config: { model: 'sonnet' }, projectDir: resolve(CONTENT_DIR) });
    saveRegistry(reg);
  });

  afterEach(function() {
    teardownApp();
    if (existsSync(CONTENT_DIR)) rmSync(CONTENT_DIR, { recursive: true });
  });

  it('returns file content with line count', async () => {
    const root = encodeURIComponent(CONTENT_DIR);
    const res = await get(`/api/files/content?root=${root}&path=hello.txt`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.text);
    expect(data.content).toBe('Hello\nWorld\n');
    expect(data.lines).toBe(3); // 'Hello', 'World', ''
    expect(data.size).toBe(12);
    expect(data.path).toBe('hello.txt');
  });

  it('returns JS file content', async () => {
    const root = encodeURIComponent(CONTENT_DIR);
    const res = await get(`/api/files/content?root=${root}&path=code.js`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.text);
    expect(data.content).toContain('const x = 42');
  });

  it('rejects binary files', async () => {
    const root = encodeURIComponent(CONTENT_DIR);
    const res = await get(`/api/files/content?root=${root}&path=binary.dat`);
    expect(res.status).toBe(415);
    const data = JSON.parse(res.text);
    expect(data.error).toContain('Binary');
  });

  it('returns 404 for nonexistent file', async () => {
    const root = encodeURIComponent(CONTENT_DIR);
    const res = await get(`/api/files/content?root=${root}&path=nope.txt`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for directory', async () => {
    const root = encodeURIComponent(CONTENT_DIR);
    const res = await get(`/api/files/content?root=${root}&path=subdir`);
    expect(res.status).toBe(400);
    const data = JSON.parse(res.text);
    expect(data.error).toContain('Not a file');
  });

  it('returns 400 when missing params', async () => {
    const res = await get('/api/files/content');
    expect(res.status).toBe(400);
  });

  it('blocks path traversal', async () => {
    const root = encodeURIComponent(CONTENT_DIR);
    const res = await get(`/api/files/content?root=${root}&path=../../package.json`);
    expect(res.status).toBe(403);
  });
});

// ── P10: Git Status on File Tree Tests ──────────────────────────

describe('P10 — renderFileTree with git status', () => {
  it('renders git badge for modified files', () => {
    const entries = [
      { name: 'app.js', type: 'file', path: 'src/app.js', size: 200 },
      { name: 'clean.js', type: 'file', path: 'src/clean.js', size: 100 },
    ];
    const gitStatus = { 'src/app.js': 'M' };
    const html = renderFileTree(entries, '/proj', gitStatus);
    expect(html).toContain('git-badge');
    expect(html).toContain('git-modified');
    // clean file should NOT have badge
    const cleanPart = html.split('clean.js')[1];
    expect(cleanPart).not.toContain('git-badge');
  });

  it('renders untracked badge', () => {
    const entries = [
      { name: 'new.ts', type: 'file', path: 'new.ts', size: 50 },
    ];
    const gitStatus = { 'new.ts': '?' };
    const html = renderFileTree(entries, '/proj', gitStatus);
    expect(html).toContain('git-untracked');
    expect(html).toContain('title="Untracked"');
  });

  it('renders added badge', () => {
    const entries = [
      { name: 'added.ts', type: 'file', path: 'added.ts', size: 50 },
    ];
    const gitStatus = { 'added.ts': 'A' };
    const html = renderFileTree(entries, '/proj', gitStatus);
    expect(html).toContain('git-added');
  });

  it('renders deleted badge', () => {
    const entries = [
      { name: 'removed.ts', type: 'file', path: 'removed.ts', size: 0 },
    ];
    const gitStatus = { 'removed.ts': 'D' };
    const html = renderFileTree(entries, '/proj', gitStatus);
    expect(html).toContain('git-deleted');
  });

  it('shows change dot on directories with modified files', () => {
    const entries = [
      { name: 'src', type: 'dir', path: 'src', children: 3 },
    ];
    const gitStatus = { 'src/index.ts': 'M' };
    const html = renderFileTree(entries, '/proj', gitStatus);
    expect(html).toContain('git-dir-dot');
    expect(html).toContain('Contains changes');
  });

  it('no change dot on clean directories', () => {
    const entries = [
      { name: 'lib', type: 'dir', path: 'lib', children: 2 },
    ];
    const gitStatus = { 'src/other.ts': 'M' };
    const html = renderFileTree(entries, '/proj', gitStatus);
    expect(html).not.toContain('git-dir-dot');
  });

  it('works without gitStatus (backward compat)', () => {
    const entries = [
      { name: 'app.js', type: 'file', path: 'app.js', size: 100 },
    ];
    const html = renderFileTree(entries, '/proj');
    expect(html).toContain('app.js');
    expect(html).not.toContain('git-badge');
  });
});

// ── P10: Clickable Files ────────────────────────────────────────

describe('P10 — clickable file entries', () => {
  it('file entries have onclick previewFile', () => {
    const entries = [
      { name: 'test.ts', type: 'file', path: 'test.ts', size: 50 },
    ];
    const html = renderFileTree(entries, '/proj');
    expect(html).toContain('previewFile');
    expect(html).toContain('tree-file--clickable');
    expect(html).toContain('data-path="test.ts"');
  });
});

// ── P10: Project Card Enhancements ──────────────────────────────

describe('P10 — renderProjectCard enhancements', () => {
  const baseProject = {
    projectDir: '/home/user/proj',
    chains: 3, running: 0, completed: 3, failed: 0,
    totalCostUsd: 1.5, lastActivity: new Date().toISOString(),
  };

  it('includes collapse toggle button', () => {
    const html = renderProjectCard(baseProject, []);
    expect(html).toContain('project-card__toggle');
    expect(html).toContain('toggleProjectCard');
  });

  it('includes search input', () => {
    const html = renderProjectCard(baseProject, []);
    expect(html).toContain('tree-search');
    expect(html).toContain('filterTree');
    expect(html).toContain('Search files');
  });

  it('includes collapsible body wrapper', () => {
    const html = renderProjectCard(baseProject, []);
    expect(html).toContain('project-card__body');
    expect(html).toContain('project-card__search');
  });

  it('shows git changed count when gitStatus provided', () => {
    const gitStatus = { 'src/a.ts': 'M', 'src/b.ts': '?' };
    const html = renderProjectCard(baseProject, [], gitStatus);
    expect(html).toContain('2 changed');
    expect(html).toContain('proj-stat--git');
  });

  it('hides git changed count when no changes', () => {
    const html = renderProjectCard(baseProject, [], {});
    expect(html).not.toContain('changed');
    expect(html).not.toContain('proj-stat--git');
  });

  it('hides git changed count when gitStatus is null', () => {
    const html = renderProjectCard(baseProject, [], null);
    expect(html).not.toContain('proj-stat--git');
  });
});

// ── P10: renderProjectsPanel with git status ────────────────────

describe('P10 — renderProjectsPanel with gitStatusMap', () => {
  it('passes gitStatus to project cards', () => {
    const projects = [
      { projectDir: '/proj/a', chains: 1, running: 0, completed: 1, failed: 0, totalCostUsd: 0, lastActivity: new Date().toISOString() },
    ];
    const rootMap = new Map();
    rootMap.set('/proj/a', [{ name: 'index.js', type: 'file', path: 'index.js', size: 50 }]);
    const gitMap = new Map();
    gitMap.set('/proj/a', { 'index.js': 'M' });
    const html = renderProjectsPanel(projects, rootMap, gitMap);
    expect(html).toContain('git-badge');
    expect(html).toContain('1 changed');
  });

  it('includes file preview panel', () => {
    const projects = [
      { projectDir: '/proj/a', chains: 1, running: 0, completed: 1, failed: 0, totalCostUsd: 0, lastActivity: new Date().toISOString() },
    ];
    const html = renderProjectsPanel(projects, new Map([[ '/proj/a', [] ]]));
    expect(html).toContain('file-preview');
    expect(html).toContain('file-preview__header');
    expect(html).toContain('file-preview__close');
    expect(html).toContain('closePreview');
  });

  it('works without gitStatusMap (backward compat)', () => {
    const projects = [
      { projectDir: '/proj/a', chains: 1, running: 0, completed: 1, failed: 0, totalCostUsd: 0, lastActivity: null },
    ];
    const html = renderProjectsPanel(projects, new Map([[ '/proj/a', [] ]]));
    expect(html).toContain('project-card');
    expect(html).not.toContain('git-badge');
  });
});

// ── Orchestrator Summary Fragment (Phase 7a) ─────────────────

describe('View Routes — Orch Summary (Phase 7a)', () => {
  beforeEach(setupApp);
  afterEach(teardownApp);

  it('GET /views/orch-summary returns empty when no pool mode', async () => {
    const res = await get('/views/orch-summary');
    expect(res.status).toBe(200);
    expect(res.text).toBe('');
  });

  it('GET /views/orch-summary returns empty when no instances exist', async () => {
    // Start via event to register instance, then stop and remove it
    const res = await get('/views/orch-summary');
    expect(res.status).toBe(200);
    // Without pool mode, should be empty
    expect(res.text).toBe('');
  });

  it('GET /views/orch-summary shows instances after orchestrator events', async () => {
    // Emit orchestrator:started to create instance state
    appCtx.events.emit('orchestrator:started', {
      workerId: 'test-1',
      mission: 'balance-fix',
      model: 'sonnet',
      dryRun: false,
    });
    appCtx.events.emit('round:start', { workerId: 'test-1', round: 1 });

    const res = await get('/views/orch-summary');
    expect(res.status).toBe(200);
    // getOrchInstances tracks instances via events even without pool
    expect(res.text).toContain('orch-summary');
    expect(res.text).toContain('test-1');
    expect(res.text).toContain('balance-fix');
    expect(res.text).toContain('sonnet');
    expect(res.text).toContain('Orchestrators');
    expect(res.text).toContain('1 running');
    expect(res.text).toContain('R:1');
  });
});
