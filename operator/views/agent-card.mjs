// ============================================================
// Agent Card Renderer (M5)
// ============================================================
// Renders agent status cards for the orchestrator view.
// Supports both simple (string ID) and rich (object) agent data.
// ============================================================

import { escapeHtml, statusLabel, formatCost, formatDuration } from './helpers.mjs';

export function renderAgentCard(agent) {
  const status = agent.status || 'unknown';
  const id = escapeHtml(agent.id || agent.agentId || 'unknown');
  const role = escapeHtml(agent.role || '');
  const model = escapeHtml(agent.model || '');

  // Build metrics row from available data
  const metrics = [];
  if (model && model !== 'default') metrics.push(`<span class="agent-metric">${model}</span>`);
  if (agent.elapsedMs != null) metrics.push(`<span class="agent-metric">${formatDuration(agent.elapsedMs)}</span>`);
  if (agent.cost != null) metrics.push(`<span class="agent-metric">${formatCost(agent.cost)}</span>`);
  if (agent.continuations > 0) metrics.push(`<span class="agent-metric">${agent.continuations} cont.</span>`);

  return `<article class="agent-card agent-${status}">
    <header>
      <span class="status-dot status-dot--${status}"></span>
      ${id}
      <small>${statusLabel(status)}</small>
    </header>
    ${role ? `<p class="agent-role">${role}</p>` : ''}
    ${metrics.length ? `<div class="agent-metrics">${metrics.join('')}</div>` : ''}
  </article>`;
}

export function renderAgentGrid(agents) {
  if (!agents || !agents.length) {
    return '<p class="empty-state">No agents active.</p>';
  }
  return `<div class="agent-grid">${agents.map(renderAgentCard).join('')}</div>`;
}
