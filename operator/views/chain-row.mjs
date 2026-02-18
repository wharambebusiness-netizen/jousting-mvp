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
  const restartable = ['failed', 'aborted', 'max-continuations'].includes(chain.status);
  const restartBtn = restartable
    ? `<button class="btn btn--sm btn--ghost" hx-post="/api/chains/${chain.id}/restart"
         hx-swap="none"
         hx-on::after-request="htmx.trigger('#chain-table','reload')">Restart</button>`
    : '';
  const deleteBtn = chain.status !== 'running'
    ? `<button class="btn btn--sm btn--ghost btn--delete" hx-delete="/api/chains/${chain.id}"
         hx-confirm="Delete this chain permanently?" hx-swap="none"
         hx-on::after-request="htmx.trigger('#chain-table','reload')">Del</button>`
    : '';

  return `<tr>
    <td class="bulk-col"><input type="checkbox" class="chain-check" value="${chain.id}" onchange="updateBulkBar()"></td>
    <td><span class="status-dot status-dot--${chain.status}"></span> ${statusLabel(chain.status)}</td>
    <td><a href="/chains/${chain.id}">${task}</a></td>
    <td>${escapeHtml(chain.config?.model || 'sonnet')}</td>
    <td>${chain.sessions ?? 0}</td>
    <td>${formatCost(chain.totalCostUsd)}</td>
    <td>${relativeTime(chain.updatedAt)}</td>
    <td>${killBtn}${restartBtn}${deleteBtn}</td>
  </tr>`;
}

export function renderChainTable(chains) {
  if (!chains.length) {
    return '<tr><td colspan="8" class="empty-state">No chains yet. Start one above!</td></tr>';
  }
  return chains.map(renderChainRow).join('\n');
}
