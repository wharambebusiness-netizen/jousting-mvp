// ============================================================
// View Helpers (M5)
// ============================================================
// Shared formatting and escaping utilities for HTML renderers.
// ============================================================

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => HTML_ENTITIES[c]);
}

export function formatCost(usd) {
  return `$${(usd || 0).toFixed(2)}`;
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h}h ${remM}m` : `${h}h`;
}

export function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function statusLabel(status) {
  const labels = {
    running: 'Running',
    complete: 'Complete',
    failed: 'Failed',
    aborted: 'Aborted',
    'max-continuations': 'Max Cont.',
    'assumed-complete': 'Assumed Done',
  };
  return labels[status] || status || 'Unknown';
}
