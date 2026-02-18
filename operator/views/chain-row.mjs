// ============================================================
// Chain Row Renderer (M5)
// ============================================================
// Renders a single chain as a table row for the dashboard.
// Input: chain summary object from getChainSummary().
// ============================================================

import { escapeHtml, formatCost, relativeTime, statusLabel } from './helpers.mjs';

export function renderChainRow(chain) {
  const task = escapeHtml(
    chain.task.length > 80 ? chain.task.slice(0, 77) + '...' : chain.task
  );
  const killBtn = chain.status === 'running'
    ? `<button class="btn btn--sm btn--danger" hx-post="/api/chains/${chain.id}/abort"
         hx-confirm="Abort this chain?" hx-target="closest tr" hx-swap="outerHTML"
         hx-on::after-request="htmx.trigger('#chain-table','reload')">Kill</button>`
    : '';

  return `<tr>
    <td><span class="status-dot status-dot--${chain.status}"></span> ${statusLabel(chain.status)}</td>
    <td><a href="/chains/${chain.id}">${task}</a></td>
    <td>${escapeHtml(chain.config?.model || 'sonnet')}</td>
    <td>${chain.sessions ?? 0}</td>
    <td>${formatCost(chain.totalCostUsd)}</td>
    <td>${relativeTime(chain.updatedAt)}</td>
    <td>${killBtn}</td>
  </tr>`;
}

export function renderChainTable(chains) {
  if (!chains.length) {
    return '<tr><td colspan="7" class="empty-state">No chains yet. Start one below!</td></tr>';
  }
  return chains.map(renderChainRow).join('\n');
}
