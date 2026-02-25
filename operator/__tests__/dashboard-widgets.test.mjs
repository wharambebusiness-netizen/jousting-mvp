// Dashboard Widget Renderers Tests (Phase 47)
import { describe, it, expect } from 'vitest';
import {
  renderSystemHealth,
  renderActiveTerminals,
  renderTaskSummary,
  renderRecentNotifications,
  renderCostBurnRate,
} from '../views/dashboard-widgets.mjs';

// ── renderSystemHealth ──────────────────────────────────────

describe('renderSystemHealth', () => {
  it('renders null gracefully', () => {
    const html = renderSystemHealth(null);
    expect(html).toContain('Health data unavailable');
    expect(html).toContain('dw-card--health');
  });

  it('renders healthy status with green dot', () => {
    const data = {
      ok: true,
      status: 'healthy',
      uptime: 3600,
      components: {
        coordinator: { status: 'healthy' },
        disk: { status: 'healthy' },
      },
    };
    const html = renderSystemHealth(data);
    expect(html).toContain('Healthy');
    expect(html).toContain('var(--status-success)');
    expect(html).toContain('coordinator');
    expect(html).toContain('disk');
    expect(html).toContain('1h');
  });

  it('renders degraded status with yellow dot', () => {
    const data = {
      ok: true,
      status: 'degraded',
      uptime: 60,
      components: {
        deadLetterQueue: { status: 'degraded' },
      },
    };
    const html = renderSystemHealth(data);
    expect(html).toContain('Degraded');
    expect(html).toContain('var(--status-warning)');
  });

  it('renders unhealthy status with red dot', () => {
    const data = {
      ok: false,
      status: 'unhealthy',
      uptime: 10,
      components: {
        disk: { status: 'unhealthy' },
      },
    };
    const html = renderSystemHealth(data);
    expect(html).toContain('Unhealthy');
    expect(html).toContain('var(--status-error)');
  });

  it('handles empty components gracefully', () => {
    const data = { status: 'healthy', uptime: 0, components: {} };
    const html = renderSystemHealth(data);
    expect(html).toContain('Healthy');
    expect(html).toContain('dw-health-list');
  });
});

// ── renderActiveTerminals ───────────────────────────────────

describe('renderActiveTerminals', () => {
  it('renders null gracefully', () => {
    const html = renderActiveTerminals(null);
    expect(html).toContain('Terminal pool unavailable');
    expect(html).toContain('dw-card--terminals');
  });

  it('renders pool status with count badges', () => {
    const status = {
      total: 5, running: 3, active: 2, idle: 1, stopped: 2,
      withTask: 2, maxTerminals: 8,
    };
    const html = renderActiveTerminals(status);
    expect(html).toContain('5/8');
    expect(html).toContain('Running');
    expect(html).toContain('Active');
    expect(html).toContain('Idle');
    expect(html).toContain('Stopped');
    expect(html).toContain('2 terminals with assigned tasks');
  });

  it('handles zero values', () => {
    const status = {
      total: 0, running: 0, active: 0, idle: 0, stopped: 0,
      withTask: 0, maxTerminals: 4,
    };
    const html = renderActiveTerminals(status);
    expect(html).toContain('0/4');
    expect(html).toContain('0 terminals with assigned tasks');
  });

  it('shows singular form for 1 terminal with task', () => {
    const status = {
      total: 1, running: 1, active: 1, idle: 0, stopped: 0,
      withTask: 1, maxTerminals: 4,
    };
    const html = renderActiveTerminals(status);
    expect(html).toContain('1 terminal with assigned tasks');
  });
});

// ── renderTaskSummary ───────────────────────────────────────

describe('renderTaskSummary', () => {
  it('renders null gracefully', () => {
    const html = renderTaskSummary(null);
    expect(html).toContain('Coordinator unavailable');
    expect(html).toContain('dw-card--tasks');
  });

  it('renders empty task queue', () => {
    const html = renderTaskSummary({ outcomes: {} });
    expect(html).toContain('No tasks in queue');
  });

  it('renders SVG donut chart with task counts', () => {
    const metrics = {
      outcomes: { pending: 3, running: 2, completed: 5, failed: 1 },
    };
    const html = renderTaskSummary(metrics);
    expect(html).toContain('<svg');
    expect(html).toContain('donut');
    expect(html).toContain('11'); // total
    expect(html).toContain('tasks');
    // Legend items
    expect(html).toContain('pending');
    expect(html).toContain('running');
    expect(html).toContain('completed');
    expect(html).toContain('failed');
    // Status colors
    expect(html).toContain('#6366f1'); // pending
    expect(html).toContain('#ef4444'); // failed
    expect(html).toContain('#10b981'); // running
  });

  it('renders single-status as full circle', () => {
    const metrics = { outcomes: { completed: 10 } };
    const html = renderTaskSummary(metrics);
    expect(html).toContain('<circle');
    expect(html).toContain('10');
  });

  it('skips zero-count statuses', () => {
    const metrics = { outcomes: { pending: 0, running: 2 } };
    const html = renderTaskSummary(metrics);
    expect(html).not.toContain('pending');
    expect(html).toContain('running');
  });
});

// ── renderRecentNotifications ───────────────────────────────

describe('renderRecentNotifications', () => {
  it('renders null gracefully', () => {
    const html = renderRecentNotifications(null);
    expect(html).toContain('Notification system unavailable');
    expect(html).toContain('dw-card--notifications');
  });

  it('renders empty notification list', () => {
    const html = renderRecentNotifications({ items: [], unreadCount: 0 });
    expect(html).toContain('No notifications');
  });

  it('renders notifications with severity icons', () => {
    const result = {
      items: [
        { id: '1', severity: 'success', title: 'Task done', ts: new Date().toISOString(), read: true },
        { id: '2', severity: 'error', title: 'Task failed', ts: new Date().toISOString(), read: false },
        { id: '3', severity: 'warning', title: 'Budget low', ts: new Date().toISOString(), read: false },
      ],
      unreadCount: 2,
    };
    const html = renderRecentNotifications(result);
    // Severity icons present
    expect(html).toContain('var(--status-success)');
    expect(html).toContain('var(--status-error)');
    expect(html).toContain('var(--status-warning)');
    // Titles
    expect(html).toContain('Task done');
    expect(html).toContain('Task failed');
    expect(html).toContain('Budget low');
    // Unread badge
    expect(html).toContain('dw-unread-badge');
    expect(html).toContain('>2<');
    // Unread class
    expect(html).toContain('dw-notif--unread');
  });

  it('omits unread badge when count is zero', () => {
    const result = {
      items: [{ id: '1', severity: 'info', title: 'Info', ts: new Date().toISOString(), read: true }],
      unreadCount: 0,
    };
    const html = renderRecentNotifications(result);
    expect(html).not.toContain('dw-unread-badge');
  });
});

// ── renderCostBurnRate ──────────────────────────────────────

describe('renderCostBurnRate', () => {
  it('renders null gracefully', () => {
    const html = renderCostBurnRate(null);
    expect(html).toContain('Cost forecaster unavailable');
    expect(html).toContain('dw-card--cost');
  });

  it('renders cost metrics', () => {
    const forecast = {
      totalCost: 12.50,
      burnRate: { usdPerHour: 2.50, usdPerMinute: 0.0417 },
      budget: null,
      exhaustionEstimate: null,
      daily: { projectedDailyCost: 60.00 },
    };
    const html = renderCostBurnRate(forecast);
    expect(html).toContain('$12.50');
    expect(html).toContain('$2.50/hr');
    expect(html).toContain('$60.00/day');
    expect(html).toContain('Total Spent');
    expect(html).toContain('Burn Rate');
  });

  it('renders budget bar with percentage', () => {
    const forecast = {
      totalCost: 7.50,
      burnRate: { usdPerHour: 1.0 },
      budget: { total: 10.0, remaining: 2.50, usagePercent: 0.75 },
      exhaustionEstimate: { minutesRemaining: 150 },
      daily: { projectedDailyCost: 24.0 },
    };
    const html = renderCostBurnRate(forecast);
    expect(html).toContain('dw-budget-bar-fill');
    expect(html).toContain('width:75%');
    expect(html).toContain('data-pct="75"');
    expect(html).toContain('$7.50 of $10.00');
    expect(html).toContain('75%');
    // Warning color at 70%+
    expect(html).toContain('var(--status-warning)');
  });

  it('renders error color at 90%+ budget usage', () => {
    const forecast = {
      totalCost: 9.50,
      burnRate: { usdPerHour: 1.0 },
      budget: { total: 10.0, remaining: 0.50, usagePercent: 0.95 },
      exhaustionEstimate: { minutesRemaining: 30 },
      daily: { projectedDailyCost: 24.0 },
    };
    const html = renderCostBurnRate(forecast);
    expect(html).toContain('var(--status-error)');
    expect(html).toContain('width:95%');
  });

  it('renders success color at low budget usage', () => {
    const forecast = {
      totalCost: 2.0,
      burnRate: { usdPerHour: 0.5 },
      budget: { total: 10.0, remaining: 8.0, usagePercent: 0.20 },
      exhaustionEstimate: null,
      daily: { projectedDailyCost: 12.0 },
    };
    const html = renderCostBurnRate(forecast);
    expect(html).toContain('var(--status-success)');
    expect(html).toContain('width:20%');
  });

  it('renders time remaining when exhaustion estimate present', () => {
    const forecast = {
      totalCost: 5.0,
      burnRate: { usdPerHour: 1.0 },
      budget: { total: 10.0, remaining: 5.0, usagePercent: 0.50 },
      exhaustionEstimate: { minutesRemaining: 300 },
      daily: { projectedDailyCost: 24.0 },
    };
    const html = renderCostBurnRate(forecast);
    expect(html).toContain('Budget exhausts in');
    expect(html).toContain('5h');
  });

  it('omits budget bar when no budget configured', () => {
    const forecast = {
      totalCost: 5.0,
      burnRate: { usdPerHour: 1.0 },
      budget: null,
      exhaustionEstimate: null,
      daily: { projectedDailyCost: 24.0 },
    };
    const html = renderCostBurnRate(forecast);
    expect(html).not.toContain('dw-budget-bar');
  });
});
