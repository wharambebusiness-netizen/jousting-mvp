// ============================================================
// Timeline View Renderers (Phase 37)
// ============================================================
// Server-side HTML fragment renderers for the activity timeline.
// Returns raw HTML strings for HTMX partial responses.
// ============================================================

import { escapeHtml, relativeTime } from './helpers.mjs';

// ── Category Icons (Unicode) ────────────────────────────────

const CATEGORY_ICONS = {
  terminal: '\u{1F5A5}',  // desktop computer
  task:     '\u2713',      // check mark (generic), overridden per action
  swarm:    '\u{1F537}',  // blue diamond
  system:   '\u2699',      // gear
  memory:   '\u{1F4BE}',  // floppy disk
};

function iconForEntry(entry) {
  if (entry.action === 'task.fail') return '\u2717'; // X mark for failures
  return CATEGORY_ICONS[entry.category] || '\u2022';
}

// ── Date Grouping ───────────────────────────────────────────

function dateLabel(isoTs) {
  if (!isoTs) return 'Unknown';
  const d = new Date(isoTs);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const entryDate = d.toISOString().slice(0, 10);

  if (entryDate === today) return 'Today';
  if (entryDate === yesterday) return 'Yesterday';
  return entryDate;
}

// ── Renderers ───────────────────────────────────────────────

/**
 * Render a vertical timeline of enriched audit entries as HTML.
 * @param {object[]} entries - Enriched entries (with category, summary fields)
 * @returns {string} HTML string
 */
export function renderTimeline(entries) {
  if (!entries || entries.length === 0) {
    return '<div class="timeline-empty">No activity in this time range.</div>';
  }

  let html = '';
  let currentGroup = null;

  for (const entry of entries) {
    const group = dateLabel(entry.ts);
    if (group !== currentGroup) {
      currentGroup = group;
      html += `<div class="timeline-group-header">${escapeHtml(group)}</div>`;
    }

    const icon = iconForEntry(entry);
    const cat = escapeHtml(entry.category || 'system');
    const summary = escapeHtml(entry.summary || '');
    const time = relativeTime(entry.ts);
    const isoTime = escapeHtml(entry.ts || '');
    const detailJson = escapeHtml(JSON.stringify(entry.detail || {}, null, 2));

    html += `<div class="timeline-entry timeline-entry--${cat}">
  <span class="timeline-time" title="${isoTime}">${escapeHtml(time)}</span>
  <span class="timeline-icon">${icon}</span>
  <span class="timeline-summary">${summary}</span>
  <details class="timeline-detail"><summary>detail</summary><pre>${detailJson}</pre></details>
</div>`;
  }

  return `<div class="timeline-list">${html}</div>`;
}

/**
 * Render category count badges for the timeline summary bar.
 * @param {object} counts - { terminal: N, task: N, swarm: N, system: N, memory: N, total: N }
 * @returns {string} HTML string
 */
export function renderTimelineSummary(counts) {
  if (!counts) return '';

  const badges = [
    { key: 'terminal', icon: CATEGORY_ICONS.terminal, label: 'Terminal' },
    { key: 'task',     icon: '\u2713',                 label: 'Task' },
    { key: 'swarm',    icon: CATEGORY_ICONS.swarm,     label: 'Swarm' },
    { key: 'system',   icon: CATEGORY_ICONS.system,    label: 'System' },
    { key: 'memory',   icon: CATEGORY_ICONS.memory,    label: 'Memory' },
  ];

  const badgeHtml = badges.map(b => {
    const count = counts[b.key] || 0;
    return `<span class="timeline-badge timeline-badge--${escapeHtml(b.key)}">${b.icon} ${count}</span>`;
  }).join('\n');

  return `<div class="timeline-summary-bar">
  ${badgeHtml}
  <span class="timeline-badge timeline-badge--total">Total: ${counts.total || 0}</span>
</div>`;
}
