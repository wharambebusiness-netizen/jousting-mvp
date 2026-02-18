// ============================================================
// Agent Card Renderer (M5)
// ============================================================
// Renders agent status cards for the orchestrator view.
// ============================================================

import { escapeHtml, statusLabel } from './helpers.mjs';

export function renderAgentCard(agent) {
  const status = agent.status || 'unknown';
  const id = escapeHtml(agent.id || agent.agentId || 'unknown');
  const role = escapeHtml(agent.role || '');

  return `<article class="agent-card agent-${status}">
    <header>
      <span class="status-dot status-dot--${status}"></span>
      ${id}
      <small>${statusLabel(status)}</small>
    </header>
    ${role ? `<p class="agent-role">${role}</p>` : ''}
  </article>`;
}

export function renderAgentGrid(agents) {
  if (!agents || !agents.length) {
    return '<p class="empty-state">No agents active.</p>';
  }
  return `<div class="agent-grid">${agents.map(renderAgentCard).join('')}</div>`;
}
