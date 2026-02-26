// ============================================================
// Dashboard Widget Renderers (Phase 47)
// ============================================================
// Server-side HTML fragment generators for real-time dashboard
// widgets. Each renderer accepts subsystem data and returns an
// HTML string suitable for HTMX partial swaps.
//
// Widgets: system health, active terminals, task summary,
//          recent notifications, cost burn rate.
// ============================================================

import { escapeHtml, formatCost, formatDuration, relativeTime } from './helpers.mjs';

// ── Status color helpers ────────────────────────────────────

const HEALTH_COLORS = {
  healthy:   { dot: 'var(--status-success)', label: 'Healthy' },
  degraded:  { dot: 'var(--status-warning)', label: 'Degraded' },
  unhealthy: { dot: 'var(--status-error)',   label: 'Unhealthy' },
};

const SEVERITY_ICONS = {
  success: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--status-success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 5.5"/></svg>',
  error:   '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--status-error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',
  warning: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--status-warning)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L1 14h14L8 2z"/><line x1="8" y1="6" x2="8" y2="10"/><circle cx="8" cy="12" r="0.5" fill="var(--status-warning)"/></svg>',
  info:    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--status-info)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><line x1="8" y1="7" x2="8" y2="11"/><circle cx="8" cy="5" r="0.5" fill="var(--status-info)"/></svg>',
};

const TASK_STATUS_COLORS = {
  pending:   '#6366f1',
  ready:     '#22d3ee',
  running:   '#10b981',
  completed: '#4ade80',
  failed:    '#ef4444',
  cancelled: '#64748b',
};

// ── 1. System Health ────────────────────────────────────────

/**
 * Render system health card with overall status, component list, and uptime.
 * @param {object|null} data - Output of healthChecker.check()
 * @returns {string} HTML
 */
export function renderSystemHealth(data) {
  if (!data) {
    return `<div class="dw-card dw-card--health">
      <div class="dw-card__header"><h3 class="dw-card__title">System Health</h3></div>
      <p class="dw-empty">Health data unavailable</p>
    </div>`;
  }

  const { status, uptime, components } = data;
  const colors = HEALTH_COLORS[status] || HEALTH_COLORS.healthy;
  const uptimeStr = formatDuration((uptime || 0) * 1000);

  const componentRows = Object.entries(components || {}).map(([name, info]) => {
    const compColors = HEALTH_COLORS[info.status] || { dot: 'var(--text-muted)', label: info.status || 'unknown' };
    return `<div class="dw-health-row">
      <span class="dw-health-dot" style="background:${compColors.dot}"></span>
      <span class="dw-health-name">${escapeHtml(name)}</span>
      <span class="dw-health-status">${escapeHtml(compColors.label)}</span>
    </div>`;
  }).join('');

  return `<div class="dw-card dw-card--health">
    <div class="dw-card__header">
      <h3 class="dw-card__title">System Health</h3>
      <span class="dw-status-badge" style="--badge-color:${colors.dot}">
        <span class="dw-status-dot" style="background:${colors.dot}"></span>
        ${escapeHtml(colors.label)}
      </span>
    </div>
    <div class="dw-health-list">${componentRows}</div>
    <div class="dw-card__footer">Uptime: ${escapeHtml(uptimeStr)}</div>
  </div>`;
}

// ── 2. Active Terminals ─────────────────────────────────────

/**
 * Render terminal count badges and status breakdown.
 * @param {object|null} poolStatus - Output of claudePool.getPoolStatus()
 * @returns {string} HTML
 */
export function renderActiveTerminals(poolStatus) {
  if (!poolStatus) {
    return `<div class="dw-card dw-card--terminals">
      <div class="dw-card__header"><h3 class="dw-card__title">Active Terminals</h3></div>
      <p class="dw-empty">Terminal pool unavailable</p>
    </div>`;
  }

  const { total, running, active, idle, stopped, withTask, maxTerminals } = poolStatus;
  const badges = [
    { label: 'Running',  value: running  ?? 0, color: 'var(--status-success)' },
    { label: 'Active',   value: active   ?? 0, color: 'var(--accent)' },
    { label: 'Idle',     value: idle     ?? 0, color: 'var(--status-warning)' },
    { label: 'Stopped',  value: stopped  ?? 0, color: 'var(--text-muted)' },
  ];

  const badgeHtml = badges.map(b =>
    `<div class="dw-term-badge">
      <span class="dw-term-count" style="color:${b.color}">${b.value}</span>
      <span class="dw-term-label">${b.label}</span>
    </div>`
  ).join('');

  const tasked = withTask ?? 0;
  const max = maxTerminals ?? 0;
  const completed = poolStatus.totalTasksCompleted ?? 0;
  const failed = poolStatus.totalTasksFailed ?? 0;

  let footerParts = [`${tasked} terminal${tasked !== 1 ? 's' : ''} with assigned tasks`];
  if (completed > 0 || failed > 0) {
    footerParts.push(`${completed} tasks done${failed > 0 ? `, ${failed} failed` : ''}`);
  }

  return `<div class="dw-card dw-card--terminals">
    <div class="dw-card__header">
      <h3 class="dw-card__title">Active Terminals</h3>
      <span class="dw-card__count">${total ?? 0}/${max}</span>
    </div>
    <div class="dw-term-badges">${badgeHtml}</div>
    <div class="dw-card__footer">${footerParts.join(' · ')}</div>
  </div>`;
}

// ── 3. Task Summary ─────────────────────────────────────────

/**
 * Render task status distribution as SVG donut chart with legend.
 * @param {object|null} metrics - Output of coordinator.getMetrics()
 * @returns {string} HTML
 */
export function renderTaskSummary(metrics) {
  if (!metrics) {
    return `<div class="dw-card dw-card--tasks">
      <div class="dw-card__header"><h3 class="dw-card__title">Task Summary</h3></div>
      <p class="dw-empty">Coordinator unavailable</p>
    </div>`;
  }

  const outcomes = metrics.outcomes || {};
  const entries = Object.entries(outcomes).filter(([, count]) => count > 0);
  const totalTasks = entries.reduce((s, [, c]) => s + c, 0);

  if (totalTasks === 0) {
    return `<div class="dw-card dw-card--tasks">
      <div class="dw-card__header"><h3 class="dw-card__title">Task Summary</h3></div>
      <p class="dw-empty">No tasks in queue</p>
    </div>`;
  }

  // SVG donut
  const cx = 60, cy = 60, r = 50, inner = 32;
  let cumAngle = -Math.PI / 2;
  const arcs = [];
  const legendItems = [];

  for (const [status, count] of entries) {
    const pct = count / totalTasks;
    const angle = pct * 2 * Math.PI;
    const x1 = cx + r * Math.cos(cumAngle);
    const y1 = cy + r * Math.sin(cumAngle);
    const x2 = cx + r * Math.cos(cumAngle + angle);
    const y2 = cy + r * Math.sin(cumAngle + angle);
    const ix1 = cx + inner * Math.cos(cumAngle + angle);
    const iy1 = cy + inner * Math.sin(cumAngle + angle);
    const ix2 = cx + inner * Math.cos(cumAngle);
    const iy2 = cy + inner * Math.sin(cumAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const color = TASK_STATUS_COLORS[status] || '#64748b';

    if (entries.length === 1) {
      // Full circle — single status
      arcs.push(`<circle cx="${cx}" cy="${cy}" r="${(r + inner) / 2}" fill="none" stroke="${color}" stroke-width="${r - inner}" opacity="0.85"/>`);
    } else {
      arcs.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${largeArc} 0 ${ix2} ${iy2} Z" fill="${color}" opacity="0.85"><title>${escapeHtml(status)}: ${count}</title></path>`);
    }

    legendItems.push(`<div class="dw-legend-item">
      <span class="dw-legend-dot" style="background:${color}"></span>
      <span>${escapeHtml(status)}</span>
      <span class="dw-legend-count">${count}</span>
    </div>`);

    cumAngle += angle;
  }

  return `<div class="dw-card dw-card--tasks">
    <div class="dw-card__header"><h3 class="dw-card__title">Task Summary</h3></div>
    <div class="dw-donut-layout">
      <svg viewBox="0 0 120 120" class="dw-donut-svg" role="img" aria-label="Task status donut chart">
        ${arcs.join('\n        ')}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="dw-donut-center">${totalTasks}</text>
        <text x="${cx}" y="${cy + 10}" text-anchor="middle" class="dw-donut-sub">tasks</text>
      </svg>
      <div class="dw-legend">${legendItems.join('')}</div>
    </div>
  </div>`;
}

// ── 4. Recent Notifications ─────────────────────────────────

/**
 * Render last 5 notifications with severity icon and relative time.
 * @param {object|null} result - Output of notifications.getAll({limit:5})
 * @returns {string} HTML
 */
export function renderRecentNotifications(result) {
  if (!result) {
    return `<div class="dw-card dw-card--notifications">
      <div class="dw-card__header"><h3 class="dw-card__title">Notifications</h3></div>
      <p class="dw-empty">Notification system unavailable</p>
    </div>`;
  }

  const { items, unreadCount } = result;
  if (!items || items.length === 0) {
    return `<div class="dw-card dw-card--notifications">
      <div class="dw-card__header">
        <h3 class="dw-card__title">Notifications</h3>
      </div>
      <p class="dw-empty">No notifications</p>
    </div>`;
  }

  const rows = items.map(n => {
    const icon = SEVERITY_ICONS[n.severity] || SEVERITY_ICONS.info;
    const unreadClass = n.read ? '' : ' dw-notif--unread';
    return `<div class="dw-notif${unreadClass}">
      <span class="dw-notif-icon">${icon}</span>
      <span class="dw-notif-title">${escapeHtml(n.title)}</span>
      <span class="dw-notif-time">${relativeTime(n.ts)}</span>
    </div>`;
  }).join('');

  const badge = (unreadCount ?? 0) > 0
    ? `<span class="dw-unread-badge">${unreadCount}</span>` : '';

  return `<div class="dw-card dw-card--notifications">
    <div class="dw-card__header">
      <h3 class="dw-card__title">Notifications ${badge}</h3>
    </div>
    <div class="dw-notif-list">${rows}</div>
  </div>`;
}

// ── 5. Cost Burn Rate ───────────────────────────────────────

/**
 * Render burn rate, total cost, budget bar, and time remaining.
 * @param {object|null} forecast - Output of costForecaster.getForecast()
 * @returns {string} HTML
 */
export function renderCostBurnRate(forecast) {
  if (!forecast) {
    return `<div class="dw-card dw-card--cost">
      <div class="dw-card__header"><h3 class="dw-card__title">Cost &amp; Burn Rate</h3></div>
      <p class="dw-empty">Cost forecaster unavailable</p>
    </div>`;
  }

  const { totalCost, burnRate, budget, exhaustionEstimate, daily } = forecast;
  const rateStr = burnRate ? `${formatCost(burnRate.usdPerHour)}/hr` : '$0.00/hr';
  const dailyStr = daily ? formatCost(daily.projectedDailyCost) : '$0.00';

  let budgetBar = '';
  if (budget && budget.total > 0) {
    const pct = Math.min(100, Math.round((budget.usagePercent ?? 0) * 100));
    const barColor = pct >= 90 ? 'var(--status-error)' : pct >= 70 ? 'var(--status-warning)' : 'var(--status-success)';
    budgetBar = `<div class="dw-budget-bar-wrap">
      <div class="dw-budget-bar-track">
        <div class="dw-budget-bar-fill" style="width:${pct}%;background:${barColor}" data-pct="${pct}"></div>
      </div>
      <div class="dw-budget-bar-labels">
        <span>${formatCost(totalCost ?? 0)} of ${formatCost(budget.total)}</span>
        <span>${pct}%</span>
      </div>
    </div>`;
  }

  let timeRemaining = '';
  if (exhaustionEstimate) {
    const mins = exhaustionEstimate.minutesRemaining ?? 0;
    timeRemaining = `<div class="dw-cost-remaining">Budget exhausts in ${formatDuration(mins * 60_000)}</div>`;
  }

  return `<div class="dw-card dw-card--cost">
    <div class="dw-card__header"><h3 class="dw-card__title">Cost &amp; Burn Rate</h3></div>
    <div class="dw-cost-metrics">
      <div class="dw-cost-metric">
        <span class="dw-cost-value">${formatCost(totalCost ?? 0)}</span>
        <span class="dw-cost-label">Total Spent</span>
      </div>
      <div class="dw-cost-metric">
        <span class="dw-cost-value">${escapeHtml(rateStr)}</span>
        <span class="dw-cost-label">Burn Rate</span>
      </div>
      <div class="dw-cost-metric">
        <span class="dw-cost-value">${escapeHtml(dailyStr)}/day</span>
        <span class="dw-cost-label">Projected Daily</span>
      </div>
    </div>
    ${budgetBar}
    ${timeRemaining}
  </div>`;
}
