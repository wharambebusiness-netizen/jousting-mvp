// ============================================================
// Analytics Chart Renderers (P8)
// ============================================================
// Server-side SVG chart generators for the analytics dashboard.
// Pure template-literal rendering, zero external dependencies.
// ============================================================

import { escapeHtml, formatCost, formatDuration } from './helpers.mjs';

// ── Helpers ──────────────────────────────────────────────────

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function formatPct(n) {
  return Math.round(n) + '%';
}

function dateKey(iso) {
  return iso ? iso.slice(0, 10) : '';
}

/**
 * Generate an array of the last N days as YYYY-MM-DD strings.
 */
function lastNDays(n, now = new Date()) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// ── Aggregate Functions ─────────────────────────────────────

/**
 * Aggregate chain data into analytics metrics.
 * @param {Array} chains - Array of chain objects (full, not summaries)
 * @returns {object} Aggregated analytics data
 */
export function aggregateAnalytics(chains) {
  const totalChains = chains.length;
  const totalCost = chains.reduce((s, c) => s + (c.totalCostUsd || 0), 0);
  const totalDuration = chains.reduce((s, c) => s + (c.totalDurationMs || 0), 0);
  const totalSessions = chains.reduce((s, c) => s + (c.sessions?.length || 0), 0);
  const totalTurns = chains.reduce((s, c) => s + (c.totalTurns || 0), 0);

  // Token totals from session data
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const c of chains) {
    for (const s of c.sessions || []) {
      totalInputTokens += s.inputTokens || 0;
      totalOutputTokens += s.outputTokens || 0;
    }
  }

  // Status breakdown
  const byStatus = {};
  for (const c of chains) {
    const st = c.status || 'unknown';
    if (!byStatus[st]) byStatus[st] = { count: 0, cost: 0 };
    byStatus[st].count++;
    byStatus[st].cost += c.totalCostUsd || 0;
  }

  // Model breakdown
  const byModel = {};
  for (const c of chains) {
    const m = c.config?.model || 'sonnet';
    if (!byModel[m]) byModel[m] = { count: 0, cost: 0, tokens: 0 };
    byModel[m].count++;
    byModel[m].cost += c.totalCostUsd || 0;
    for (const s of c.sessions || []) {
      byModel[m].tokens += (s.inputTokens || 0) + (s.outputTokens || 0);
    }
  }

  // Daily cost (last 30 days)
  const days = lastNDays(30);
  const dailyCost = {};
  for (const d of days) dailyCost[d] = 0;
  for (const c of chains) {
    const day = dateKey(c.startedAt);
    if (day && dailyCost[day] !== undefined) {
      dailyCost[day] += c.totalCostUsd || 0;
    }
  }

  // Success rate
  const completed = (byStatus.complete?.count || 0) + (byStatus['assumed-complete']?.count || 0);
  const failed = (byStatus.failed?.count || 0) + (byStatus.aborted?.count || 0);
  const finished = completed + failed + (byStatus['max-continuations']?.count || 0);
  const successRate = finished > 0 ? (completed / finished) * 100 : 0;

  // Top chains by cost
  const topChains = [...chains]
    .sort((a, b) => (b.totalCostUsd || 0) - (a.totalCostUsd || 0))
    .slice(0, 10);

  return {
    totalChains, totalCost, totalDuration, totalSessions, totalTurns,
    totalInputTokens, totalOutputTokens,
    byStatus, byModel, dailyCost, days,
    successRate, completed, failed, finished,
    topChains,
    avgCostPerChain: totalChains > 0 ? totalCost / totalChains : 0,
    avgDurationPerChain: totalChains > 0 ? totalDuration / totalChains : 0,
    avgSessionsPerChain: totalChains > 0 ? totalSessions / totalChains : 0,
  };
}

// ── SVG Chart Renderers ─────────────────────────────────────

const STATUS_COLORS = {
  complete: '#22c55e',
  'assumed-complete': '#4ade80',
  running: '#6366f1',
  failed: '#ef4444',
  aborted: '#f97316',
  'max-continuations': '#eab308',
};

const MODEL_COLORS = {
  opus: '#a78bfa',
  sonnet: '#6366f1',
  haiku: '#38bdf8',
};

/**
 * Render daily cost bar chart as SVG.
 */
export function renderCostTimeline(data) {
  const { dailyCost, days } = data;
  const values = days.map(d => dailyCost[d] || 0);
  const maxVal = Math.max(0.01, ...values);

  const svgW = 600;
  const svgH = 200;
  const padL = 50;
  const padR = 10;
  const padT = 20;
  const padB = 40;
  const chartW = svgW - padL - padR;
  const chartH = svgH - padT - padB;
  const barW = Math.max(2, (chartW / days.length) - 2);

  // Y-axis labels
  const yTicks = 4;
  const yLabels = [];
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxVal / yTicks) * i;
    const y = padT + chartH - (chartH * (i / yTicks));
    yLabels.push(`<text x="${padL - 8}" y="${y + 4}" text-anchor="end" class="chart-label">${formatCost(val)}</text>`);
    if (i > 0) {
      yLabels.push(`<line x1="${padL}" y1="${y}" x2="${svgW - padR}" y2="${y}" class="chart-grid"/>`);
    }
  }

  // Bars
  const bars = values.map((v, i) => {
    const h = v > 0 ? Math.max(2, (v / maxVal) * chartH) : 0;
    const x = padL + (i * (chartW / days.length)) + 1;
    const y = padT + chartH - h;
    const day = days[i];
    const label = day.slice(5); // MM-DD
    return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" class="chart-bar" rx="2">
      <title>${label}: ${formatCost(v)}</title>
    </rect>`;
  });

  // X-axis labels (show every 5th day)
  const xLabels = days.map((d, i) => {
    if (i % 5 !== 0 && i !== days.length - 1) return '';
    const x = padL + (i * (chartW / days.length)) + barW / 2;
    const y = svgH - 8;
    return `<text x="${x}" y="${y}" text-anchor="middle" class="chart-label">${d.slice(5)}</text>`;
  }).filter(Boolean);

  return `<div class="chart-container">
    <h3 class="chart-title">Daily Cost (Last 30 Days)</h3>
    <svg viewBox="0 0 ${svgW} ${svgH}" class="chart-svg" role="img" aria-label="Daily cost bar chart">
      <line x1="${padL}" y1="${padT + chartH}" x2="${svgW - padR}" y2="${padT + chartH}" class="chart-axis"/>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" class="chart-axis"/>
      ${yLabels.join('\n      ')}
      ${bars.join('\n      ')}
      ${xLabels.join('\n      ')}
    </svg>
  </div>`;
}

/**
 * Render status breakdown as SVG donut chart.
 */
export function renderStatusBreakdown(data) {
  const { byStatus, totalChains } = data;
  if (totalChains === 0) {
    return `<div class="chart-container">
      <h3 class="chart-title">Chain Outcomes</h3>
      <p class="empty-state">No chains to analyze.</p>
    </div>`;
  }

  const entries = Object.entries(byStatus).sort((a, b) => b[1].count - a[1].count);
  const cx = 100, cy = 100, r = 80, inner = 50;

  let cumAngle = -Math.PI / 2; // Start at top
  const arcs = [];
  const legendItems = [];

  for (const [status, { count }] of entries) {
    const pct = count / totalChains;
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
    const color = STATUS_COLORS[status] || '#64748b';

    arcs.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${largeArc} 0 ${ix2} ${iy2} Z"
      fill="${color}" opacity="0.85">
      <title>${escapeHtml(status)}: ${count} (${formatPct(pct * 100)})</title>
    </path>`);

    legendItems.push(`<div class="legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      <span>${escapeHtml(status)}</span>
      <span class="legend-count">${count}</span>
    </div>`);

    cumAngle += angle;
  }

  return `<div class="chart-container">
    <h3 class="chart-title">Chain Outcomes</h3>
    <div class="donut-layout">
      <svg viewBox="0 0 200 200" class="donut-svg" role="img" aria-label="Chain status donut chart">
        ${arcs.join('\n        ')}
        <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="donut-center-label">${totalChains}</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" class="donut-center-sub">chains</text>
      </svg>
      <div class="legend">${legendItems.join('\n        ')}</div>
    </div>
  </div>`;
}

/**
 * Render model usage as horizontal bar chart.
 */
export function renderModelUsage(data) {
  const { byModel } = data;
  const entries = Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost);
  if (entries.length === 0) {
    return `<div class="chart-container">
      <h3 class="chart-title">Model Usage</h3>
      <p class="empty-state">No model data.</p>
    </div>`;
  }

  const maxCost = Math.max(0.01, ...entries.map(([, v]) => v.cost));

  const bars = entries.map(([model, { count, cost, tokens }]) => {
    const pct = Math.max(3, (cost / maxCost) * 100);
    const color = MODEL_COLORS[model] || '#64748b';
    return `<div class="hbar-row">
      <span class="hbar-label">${escapeHtml(model)}</span>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${pct}%;background:${color}" title="${formatCost(cost)}"></div>
      </div>
      <span class="hbar-value">${formatCost(cost)}</span>
      <span class="hbar-meta">${count} chains &middot; ${formatNumber(tokens)} tokens</span>
    </div>`;
  });

  return `<div class="chart-container">
    <h3 class="chart-title">Model Usage</h3>
    ${bars.join('\n    ')}
  </div>`;
}

/**
 * Render key analytics metrics as cards.
 */
export function renderAnalyticsMetrics(data) {
  const cards = [
    { label: 'Total Cost', value: formatCost(data.totalCost), sub: `${data.totalChains} chains` },
    { label: 'Success Rate', value: formatPct(data.successRate), sub: `${data.completed}/${data.finished} finished` },
    { label: 'Avg Cost/Chain', value: formatCost(data.avgCostPerChain), sub: `${data.totalSessions} total sessions` },
    { label: 'Avg Duration', value: formatDuration(data.avgDurationPerChain), sub: `${data.avgSessionsPerChain.toFixed(1)} sessions/chain` },
    { label: 'Total Turns', value: formatNumber(data.totalTurns), sub: `${formatNumber(data.totalInputTokens + data.totalOutputTokens)} tokens` },
    { label: 'Total Duration', value: formatDuration(data.totalDuration), sub: `${data.totalSessions} sessions` },
  ];

  return `<div class="metrics-grid">
    ${cards.map(c => `<div class="metric-card">
      <div class="metric-card__label">${c.label}</div>
      <div class="metric-card__value">${c.value}</div>
      <div class="metric-card__sub">${c.sub}</div>
    </div>`).join('\n    ')}
  </div>`;
}

/**
 * Render top chains by cost as a table.
 */
export function renderTopChains(data) {
  const { topChains } = data;
  if (!topChains.length) {
    return `<div class="chart-container">
      <h3 class="chart-title">Top Chains by Cost</h3>
      <p class="empty-state">No chains to rank.</p>
    </div>`;
  }

  const rows = topChains.map((c, i) => {
    const task = escapeHtml(
      c.task.length > 60 ? c.task.slice(0, 57) + '...' : c.task
    );
    const model = escapeHtml(c.config?.model || 'sonnet');
    return `<tr>
      <td class="tabular-nums">${i + 1}</td>
      <td><a href="/chains/${c.id}">${task}</a></td>
      <td>${model}</td>
      <td class="tabular-nums">${c.sessions?.length || 0}</td>
      <td class="tabular-nums">${formatCost(c.totalCostUsd)}</td>
      <td>${formatDuration(c.totalDurationMs)}</td>
    </tr>`;
  });

  return `<div class="chart-container">
    <h3 class="chart-title">Top Chains by Cost</h3>
    <table class="analytics-table">
      <thead><tr>
        <th>#</th><th>Task</th><th>Model</th><th>Sessions</th><th>Cost</th><th>Duration</th>
      </tr></thead>
      <tbody>${rows.join('\n      ')}</tbody>
    </table>
  </div>`;
}

/**
 * Render the complete analytics panel (all charts combined).
 */
export function renderAnalyticsPanel(chains) {
  const data = aggregateAnalytics(chains);
  return `<div class="analytics-panel">
    ${renderAnalyticsMetrics(data)}
    <div class="analytics-charts">
      ${renderCostTimeline(data)}
      <div class="analytics-row">
        ${renderStatusBreakdown(data)}
        ${renderModelUsage(data)}
      </div>
      ${renderTopChains(data)}
    </div>
  </div>`;
}
