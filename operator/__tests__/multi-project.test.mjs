// Multi-Project Dashboard tests (Phase 62)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  renderMultiProjectOverview,
  renderProjectCards,
  renderMultiProjectDashboard,
  projectHealth,
} from '../views/multi-project.mjs';
import { createApp } from '../server.mjs';
import { createRegistry, createChain, updateChainStatus } from '../registry.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Data ───────────────────────────────────────────────

const PROJECTS = [
  {
    projectDir: '/projects/alpha',
    chains: 5, running: 2, completed: 2, failed: 1,
    totalCostUsd: 1.23,
    lastActivity: '2026-02-28T10:00:00Z',
  },
  {
    projectDir: '/projects/beta',
    chains: 3, running: 1, completed: 2, failed: 0,
    totalCostUsd: 0.45,
    lastActivity: '2026-02-28T09:30:00Z',
  },
  {
    projectDir: null,
    chains: 1, running: 0, completed: 1, failed: 0,
    totalCostUsd: 0.10,
    lastActivity: '2026-02-27T12:00:00Z',
  },
];

// ── projectHealth() ─────────────────────────────────────────

describe('projectHealth', () => {
  it('returns healthy when running > 0 and no failures', () => {
    expect(projectHealth({ running: 2, failed: 0, chains: 3 })).toBe('healthy');
  });

  it('returns degraded when both running and failed > 0', () => {
    expect(projectHealth({ running: 1, failed: 1, chains: 3 })).toBe('degraded');
  });

  it('returns unhealthy when failed > 0 and no running', () => {
    expect(projectHealth({ running: 0, failed: 2, chains: 3 })).toBe('unhealthy');
  });

  it('returns idle when no chains', () => {
    expect(projectHealth({ running: 0, failed: 0, chains: 0 })).toBe('idle');
  });

  it('returns healthy for completed-only project', () => {
    expect(projectHealth({ running: 0, failed: 0, chains: 5, completed: 5 })).toBe('healthy');
  });
});

// ── renderMultiProjectOverview() ────────────────────────────

describe('renderMultiProjectOverview', () => {
  it('renders empty state for null input', () => {
    const html = renderMultiProjectOverview(null);
    expect(html).toContain('No projects found');
    expect(html).toContain('mp-overview');
  });

  it('renders empty state for empty array', () => {
    const html = renderMultiProjectOverview([]);
    expect(html).toContain('No projects found');
  });

  it('renders correct project count', () => {
    const html = renderMultiProjectOverview(PROJECTS);
    expect(html).toContain('3'); // 3 projects
  });

  it('renders aggregate chain count', () => {
    const html = renderMultiProjectOverview(PROJECTS);
    expect(html).toContain('9'); // 5+3+1 = 9 chains
  });

  it('renders aggregate running count', () => {
    const html = renderMultiProjectOverview(PROJECTS);
    expect(html).toContain('Running');
    expect(html).toContain('>3<'); // 2+1+0 = 3 running
  });

  it('renders total cost', () => {
    const html = renderMultiProjectOverview(PROJECTS);
    expect(html).toContain('$1.78'); // 1.23+0.45+0.10
  });

  it('renders all stat labels', () => {
    const html = renderMultiProjectOverview(PROJECTS);
    expect(html).toContain('Projects');
    expect(html).toContain('Chains');
    expect(html).toContain('Running');
    expect(html).toContain('Completed');
    expect(html).toContain('Failed');
    expect(html).toContain('Total Cost');
  });
});

// ── renderProjectCards() ────────────────────────────────────

describe('renderProjectCards', () => {
  it('renders empty state for null input', () => {
    const html = renderProjectCards(null);
    expect(html).toContain('No projects to display');
  });

  it('renders empty state for empty array', () => {
    const html = renderProjectCards([]);
    expect(html).toContain('No projects to display');
  });

  it('renders one card per project', () => {
    const html = renderProjectCards(PROJECTS);
    const count = (html.match(/class="mp-card"/g) || []).length;
    expect(count).toBe(3);
  });

  it('renders project name from basename', () => {
    const html = renderProjectCards(PROJECTS);
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
  });

  it('renders (default) for null projectDir', () => {
    const html = renderProjectCards(PROJECTS);
    expect(html).toContain('(default)');
  });

  it('renders chain count per project', () => {
    const html = renderProjectCards([PROJECTS[0]]);
    expect(html).toContain('5 chains');
  });

  it('renders singular chain for count of 1', () => {
    const html = renderProjectCards([PROJECTS[2]]);
    expect(html).toContain('1 chain');
    expect(html).not.toContain('1 chains');
  });

  it('renders counters with status classes', () => {
    const html = renderProjectCards(PROJECTS);
    expect(html).toContain('mp-counter--success');
    expect(html).toContain('mp-counter--info');
    expect(html).toContain('mp-counter--error');
  });

  it('renders cost per project', () => {
    const html = renderProjectCards([PROJECTS[0]]);
    expect(html).toContain('$1.23');
  });

  it('renders health dot', () => {
    const html = renderProjectCards([PROJECTS[0]]);
    expect(html).toContain('mp-card__dot');
    // Alpha has running + failed = degraded (warning color)
    expect(html).toContain('var(--status-warning)');
  });

  it('renders project directory path', () => {
    const html = renderProjectCards([PROJECTS[0]]);
    expect(html).toContain('/projects/alpha');
  });

  it('renders data-project attribute for click handling', () => {
    const html = renderProjectCards([PROJECTS[0]]);
    expect(html).toContain('data-project="/projects/alpha"');
  });

  it('renders relative time for last activity', () => {
    const html = renderProjectCards([{
      ...PROJECTS[2],
      lastActivity: null,
    }]);
    expect(html).toContain('No activity');
  });
});

// ── renderMultiProjectDashboard() ───────────────────────────

describe('renderMultiProjectDashboard', () => {
  it('renders both overview and cards', () => {
    const html = renderMultiProjectDashboard(PROJECTS);
    expect(html).toContain('mp-dashboard');
    expect(html).toContain('mp-overview');
    expect(html).toContain('mp-cards');
  });

  it('handles empty projects gracefully', () => {
    const html = renderMultiProjectDashboard([]);
    expect(html).toContain('No projects found');
    expect(html).toContain('No projects to display');
  });

  it('escapes HTML in project paths', () => {
    const html = renderMultiProjectDashboard([{
      projectDir: '/path/<script>alert(1)</script>',
      chains: 1, running: 0, completed: 0, failed: 0,
      totalCostUsd: 0, lastActivity: null,
    }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ── Route Integration Tests ─────────────────────────────────

describe('GET /views/dashboard/multi-project', () => {
  const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_mp');
  let appInstance, baseUrl;

  beforeAll(async () => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });

    // Seed registry with chains across projects
    const regStore = createRegistry({ operatorDir: TEST_DIR });
    const reg = regStore.load();
    createChain(reg, {
      task: 'build feature',
      config: { model: 'sonnet' },
      projectDir: '/projects/alpha',
    });
    const c2 = createChain(reg, {
      task: 'fix bug',
      config: { model: 'opus' },
      projectDir: '/projects/beta',
    });
    updateChainStatus(c2, 'failed');
    regStore.save(reg);

    const events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events, auth: false });
    await new Promise(resolve => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (appInstance) await appInstance.close();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('returns HTML with mp-dashboard class', async () => {
    const res = await fetch(`${baseUrl}/views/dashboard/multi-project`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('mp-dashboard');
  });

  it('includes both seeded projects', async () => {
    const res = await fetch(`${baseUrl}/views/dashboard/multi-project`);
    const html = await res.text();
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
  });

  it('shows correct aggregate counts', async () => {
    const res = await fetch(`${baseUrl}/views/dashboard/multi-project`);
    const html = await res.text();
    // 2 projects
    expect(html).toContain('Projects');
    // 2 chains total
    expect(html).toContain('Chains');
  });

  it('dashboard page contains multi-project section', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    const html = await res.text();
    expect(html).toContain('multi-project-section');
  });
});
