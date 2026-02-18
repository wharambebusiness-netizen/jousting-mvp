// ============================================================
// Terminal Viewer Renderer (P3)
// ============================================================
// Renders session output in a terminal-style viewer with ANSI
// color support. Converts ANSI escape codes to HTML spans.
// ============================================================

import { escapeHtml } from './helpers.mjs';

// ANSI color code → CSS class mapping
const ANSI_COLORS = {
  '30': 'ansi-black',   '31': 'ansi-red',     '32': 'ansi-green',
  '33': 'ansi-yellow',  '34': 'ansi-blue',    '35': 'ansi-magenta',
  '36': 'ansi-cyan',    '37': 'ansi-white',
  '90': 'ansi-bright-black',  '91': 'ansi-bright-red',
  '92': 'ansi-bright-green',  '93': 'ansi-bright-yellow',
  '94': 'ansi-bright-blue',   '95': 'ansi-bright-magenta',
  '96': 'ansi-bright-cyan',   '97': 'ansi-bright-white',
};

/**
 * Convert text with ANSI escape codes to HTML with colored spans.
 * @param {string} text - Raw text potentially containing ANSI codes
 * @returns {string} HTML string with spans for ANSI colors
 */
export function ansiToHtml(text) {
  if (!text) return '';

  // Escape HTML first, then process ANSI codes
  let html = escapeHtml(text);

  // Replace ANSI escape sequences with spans
  // Pattern: ESC[<code>m  (ESC = \x1b or \033)
  html = html.replace(/\x1b\[([0-9;]+)m/g, (_match, codes) => {
    const parts = codes.split(';');
    const classes = [];
    let bold = false;

    for (const code of parts) {
      if (code === '0') return '</span>'; // Reset
      if (code === '1') bold = true;
      if (ANSI_COLORS[code]) classes.push(ANSI_COLORS[code]);
    }

    if (classes.length === 0 && !bold) return '';

    const cls = [...classes, ...(bold ? ['ansi-bold'] : [])].join(' ');
    return `<span class="${cls}">`;
  });

  // Clean up any remaining escape sequences
  html = html.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  return html;
}

/**
 * Render a terminal-style viewer for session output.
 * @param {object} opts
 * @param {string} opts.content - Text content to display
 * @param {string} [opts.title] - Optional title bar text
 * @param {number} [opts.maxHeight] - Max height in pixels (default 500)
 * @returns {string} HTML string
 */
export function renderTerminalViewer(opts) {
  const { content, title, maxHeight = 500 } = opts;

  if (!content) {
    return '<p class="empty-state">No output available.</p>';
  }

  const html = ansiToHtml(content);
  const titleBar = title
    ? `<div class="terminal__title"><span class="terminal__dots"><span></span><span></span><span></span></span>${escapeHtml(title)}</div>`
    : '';

  return `<div class="terminal-viewer">
    ${titleBar}
    <pre class="terminal__body" style="max-height:${maxHeight}px">${html}</pre>
  </div>`;
}
