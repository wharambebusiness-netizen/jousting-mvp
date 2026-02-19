// ============================================================
// Session Card Renderer (M5)
// ============================================================
// Renders a session detail card for the chain detail page.
// Also renders the session timeline bar and cost breakdown.
// ============================================================

import { escapeHtml, formatCost, formatDuration, statusLabel } from './helpers.mjs';

export function renderSessionCard(session) {
  const status = session.status || 'complete';
  const badges = [];
  if (session.preCompacted) badges.push('<span class="badge badge--neutral">Pre-compacted</span>');
  if (session.hitMaxTurns) badges.push('<span class="badge badge--warning">Max turns</span>');
  if (session.handoffComplete) badges.push('<span class="badge badge--success">Handoff complete</span>');
  if (session.error) badges.push(`<span class="badge badge--error">${escapeHtml(String(session.error).slice(0, 40))}</span>`);

  let handoffSection = '';
  if (session.handoffFile) {
    handoffSection = `<details>
      <summary>Handoff</summary>
      <div class="handoff-content"
           hx-get="/views/session-handoff/${session._chainId}/${session.index}"
           hx-trigger="toggle once"
           hx-swap="innerHTML">Loading...</div>
    </details>`;
  }

  return `<article class="session-card session-${status}">
    <header>
      <span class="status-dot status-dot--${status}" aria-hidden="true"></span>
      Session ${(session.index ?? 0) + 1} &mdash; ${statusLabel(status)}
    </header>
    <div class="session-meta">
      <span>Turns: ${session.turns ?? 0}</span>
      <span>Cost: ${formatCost(session.costUsd)}</span>
      <span>Duration: ${formatDuration(session.durationMs)}</span>
      ${badges.join(' ')}
    </div>
    ${handoffSection}
  </article>`;
}

export function renderTimeline(sessions) {
  if (!sessions || !sessions.length) return '<p class="empty-state">No sessions yet.</p>';

  const maxTurns = Math.max(1, ...sessions.map(s => s.turns || 1));
  const blocks = sessions.map(s => {
    const width = Math.max(5, Math.round(((s.turns || 1) / maxTurns) * 100));
    const status = s.status || 'complete';
    return `<div class="timeline__segment timeline--${status}" style="flex:${s.turns || 1}" title="Session ${(s.index ?? 0) + 1}: ${s.turns || 0} turns, ${formatCost(s.costUsd)}">
      S${(s.index ?? 0) + 1}
    </div>`;
  });

  return `<div class="timeline">${blocks.join('')}</div>`;
}

export function renderCostBreakdown(sessions) {
  if (!sessions || !sessions.length) return '';

  const totalCost = sessions.reduce((sum, s) => sum + (s.costUsd || 0), 0);
  if (totalCost === 0) return '<p class="empty-state">No cost data.</p>';

  const bars = sessions.map(s => {
    const pct = Math.max(2, Math.round(((s.costUsd || 0) / totalCost) * 100));
    return `<div class="cost-segment cost-${s.status || 'complete'}" style="width:${pct}%" title="Session ${(s.index ?? 0) + 1}: ${formatCost(s.costUsd)}">
      ${formatCost(s.costUsd)}
    </div>`;
  });

  return `<div class="cost-bar">${bars.join('')}</div>
    <p class="cost-total">Total: ${formatCost(totalCost)}</p>`;
}
