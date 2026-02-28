// ============================================================
// Multi-Project Dashboard Renderers (Phase 62)
// ============================================================
// Server-side HTML fragment generators for the multi-project
// dashboard view. Aggregates chain data across all projects
// into overview stats and per-project cards.
// ============================================================

import { escapeHtml, formatCost, relativeTime } from './helpers.mjs';
import { basename } from 'path';

// ── Project health heuristic ────────────────────────────────

function projectHealth(proj) {
  if (proj.running > 0 && proj.failed === 0) return 'healthy';
  if (proj.failed > 0 && proj.running > 0) return 'degraded';
  if (proj.failed > 0 && proj.running === 0) return 'unhealthy';
  if (proj.chains === 0) return 'idle';
  return 'healthy';
}

const HEALTH_DOT = {
  healthy:   { color: 'var(--status-success)', label: 'Healthy' },
  degraded:  { color: 'var(--status-warning)', label: 'Degraded' },
  unhealthy: { color: 'var(--status-error)',   label: 'Unhealthy' },
  idle:      { color: 'var(--text-muted)',     label: 'Idle' },
};

// ── 1. Overview Stats Bar ───────────────────────────────────

/**
 * Render aggregate overview bar for all projects.
 * @param {object[]} projects - Array of project summaries
 * @returns {string} HTML
 */
export function renderMultiProjectOverview(projects) {
  if (!projects || projects.length === 0) {
    return `<div class="mp-overview">
      <p class="dw-empty">No projects found</p>
    </div>`;
  }

  const totalChains = projects.reduce((s, p) => s + (p.chains || 0), 0);
  const totalRunning = projects.reduce((s, p) => s + (p.running || 0), 0);
  const totalCompleted = projects.reduce((s, p) => s + (p.completed || 0), 0);
  const totalFailed = projects.reduce((s, p) => s + (p.failed || 0), 0);
  const totalCost = projects.reduce((s, p) => s + (p.totalCostUsd || 0), 0);

  const stats = [
    { label: 'Projects',  value: projects.length, color: 'var(--accent)' },
    { label: 'Chains',    value: totalChains,      color: 'var(--text-muted)' },
    { label: 'Running',   value: totalRunning,     color: 'var(--status-success)' },
    { label: 'Completed', value: totalCompleted,   color: 'var(--status-info)' },
    { label: 'Failed',    value: totalFailed,      color: 'var(--status-error)' },
  ];

  const statHtml = stats.map(s =>
    `<div class="mp-stat">
      <span class="mp-stat__value" style="color:${s.color}">${s.value}</span>
      <span class="mp-stat__label">${s.label}</span>
    </div>`
  ).join('');

  return `<div class="mp-overview">
    <div class="mp-overview__stats">${statHtml}</div>
    <div class="mp-overview__cost">
      <span class="mp-stat__value">${formatCost(totalCost)}</span>
      <span class="mp-stat__label">Total Cost</span>
    </div>
  </div>`;
}

// ── 2. Project Cards Grid ───────────────────────────────────

/**
 * Render a single project card.
 * @param {object} proj - Project summary
 * @returns {string} HTML
 */
function renderProjectCard(proj) {
  const health = projectHealth(proj);
  const dot = HEALTH_DOT[health] || HEALTH_DOT.idle;
  const name = proj.projectDir
    ? basename(proj.projectDir)
    : '(default)';
  const dir = proj.projectDir
    ? escapeHtml(proj.projectDir.replace(/\\/g, '/'))
    : '';

  const counters = [
    { label: 'Running',   value: proj.running   || 0, cls: 'success' },
    { label: 'Done',      value: proj.completed || 0, cls: 'info' },
    { label: 'Failed',    value: proj.failed    || 0, cls: 'error' },
  ];

  const counterHtml = counters.map(c =>
    `<span class="mp-counter mp-counter--${c.cls}">${c.value}</span>`
  ).join('');

  return `<div class="mp-card" data-project="${escapeHtml(proj.projectDir || '')}">
    <div class="mp-card__header">
      <span class="mp-card__dot" style="background:${dot.color}" title="${dot.label}"></span>
      <span class="mp-card__name">${escapeHtml(name)}</span>
      <span class="mp-card__chains">${proj.chains || 0} chain${(proj.chains || 0) !== 1 ? 's' : ''}</span>
    </div>
    ${dir ? `<div class="mp-card__path">${dir}</div>` : ''}
    <div class="mp-card__counters">${counterHtml}</div>
    <div class="mp-card__footer">
      <span class="mp-card__cost">${formatCost(proj.totalCostUsd || 0)}</span>
      <span class="mp-card__activity">${proj.lastActivity ? relativeTime(proj.lastActivity) : 'No activity'}</span>
    </div>
  </div>`;
}

/**
 * Render grid of project cards.
 * @param {object[]} projects - Array of project summaries
 * @returns {string} HTML
 */
export function renderProjectCards(projects) {
  if (!projects || projects.length === 0) {
    return `<div class="mp-cards">
      <p class="dw-empty">No projects to display</p>
    </div>`;
  }

  const cards = projects.map(renderProjectCard).join('');
  return `<div class="mp-cards">${cards}</div>`;
}

/**
 * Render the full multi-project dashboard fragment (overview + cards).
 * @param {object[]} projects - Array of project summaries
 * @returns {string} HTML
 */
export function renderMultiProjectDashboard(projects) {
  return `<div class="mp-dashboard">
    ${renderMultiProjectOverview(projects)}
    ${renderProjectCards(projects)}
  </div>`;
}

// Re-export health helper for testing
export { projectHealth };
