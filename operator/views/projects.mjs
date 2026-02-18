// ============================================================
// Projects View Renderers (P9)
// ============================================================
// Server-side HTML generators for the project file explorer.
// Pure functions — take data, return HTML strings.
// ============================================================

import { escapeHtml, formatCost, relativeTime } from './helpers.mjs';

// ── File Size Formatter ─────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── File Icon Helper ────────────────────────────────────────

const EXT_ICONS = {
  js: '📜', mjs: '📜', cjs: '📜',
  ts: '🔷', tsx: '🔷', jsx: '📜',
  json: '📋', md: '📝', txt: '📝',
  html: '🌐', css: '🎨', svg: '🖼️',
  png: '🖼️', jpg: '🖼️', gif: '🖼️', ico: '🖼️',
  yml: '⚙️', yaml: '⚙️', toml: '⚙️',
  sh: '⚡', bat: '⚡', ps1: '⚡',
  lock: '🔒',
};

function fileIcon(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return EXT_ICONS[ext] || '📄';
}

// ── File Tree Renderers ─────────────────────────────────────

/**
 * Render a single file entry as HTML.
 */
function renderFileEntry(entry, _root) {
  if (entry.type === 'dir') {
    const ePath = escapeHtml(entry.path);
    const countLabel = entry.children === 1 ? '1 item' : `${entry.children} items`;
    return `<details class="tree-dir" data-path="${ePath}" ontoggle="loadTreeNode(this)">
      <summary class="tree-summary tree-summary--dir">
        <span class="tree-icon tree-icon--dir">📁</span>
        <span class="tree-name">${escapeHtml(entry.name)}/</span>
        <span class="tree-meta">${countLabel}</span>
      </summary>
      <div class="tree-children"><div class="tree-loading">Loading…</div></div>
    </details>`;
  }

  return `<div class="tree-file">
    <span class="tree-icon">${fileIcon(entry.name)}</span>
    <span class="tree-name">${escapeHtml(entry.name)}</span>
    <span class="tree-meta">${formatSize(entry.size)}</span>
  </div>`;
}

/**
 * Render a file listing (array of entries) as HTML.
 * Used for both root-level rendering and HTMX subtree responses.
 *
 * @param {Array} entries  Array from scanDirectory()
 * @param {string} root    Project root path
 * @returns {string}       HTML string
 */
export function renderFileTree(entries, root) {
  if (!entries.length) {
    return '<div class="tree-empty">Empty directory</div>';
  }
  return entries.map(e => renderFileEntry(e, root)).join('\n');
}

// ── Project Card Renderer ───────────────────────────────────

/**
 * Render a single project card with stats and file tree.
 *
 * @param {object} project     Project summary from /api/projects
 * @param {Array}  rootEntries Root-level directory entries
 * @returns {string}           HTML string
 */
export function renderProjectCard(project, rootEntries) {
  const dir = project.projectDir || '(default)';
  const displayName = dir === '(default)' ? 'Default Project' : dir.replace(/\\/g, '/').split('/').pop();
  const displayPath = dir === '(default)' ? '' : escapeHtml(dir.replace(/\\/g, '/'));
  const eDir = escapeHtml(dir);

  const statusParts = [];
  if (project.running > 0)   statusParts.push(`<span class="proj-stat proj-stat--running">${project.running} running</span>`);
  if (project.completed > 0) statusParts.push(`<span class="proj-stat proj-stat--done">${project.completed} done</span>`);
  if (project.failed > 0)    statusParts.push(`<span class="proj-stat proj-stat--fail">${project.failed} failed</span>`);

  const lastAct = project.lastActivity ? relativeTime(project.lastActivity) : 'never';

  return `<div class="project-card" data-root="${eDir}">
    <div class="project-card__header">
      <div class="project-card__title">
        <h3 class="project-card__name">${escapeHtml(displayName)}</h3>
        ${displayPath ? `<span class="project-card__path">${displayPath}</span>` : ''}
      </div>
      <button class="project-card__refresh" onclick="refreshProjectTree(this.closest('.project-card'))" title="Refresh file tree">↻</button>
    </div>
    <div class="project-card__stats">
      <span class="proj-stat">${project.chains} chain${project.chains !== 1 ? 's' : ''}</span>
      ${statusParts.join('\n      ')}
      <span class="proj-stat">${formatCost(project.totalCostUsd)}</span>
      <span class="proj-stat proj-stat--time">${lastAct}</span>
    </div>
    <div class="project-tree" data-root="${eDir}">
      ${dir === '(default)' ? '<div class="tree-empty">No project directory set</div>' : renderFileTree(rootEntries, dir)}
    </div>
  </div>`;
}

// ── Full Panel Renderer ─────────────────────────────────────

/**
 * Render the complete projects panel.
 *
 * @param {Array} projects        Array of project summaries (from /api/projects)
 * @param {Map}   rootEntriesMap  Map of projectDir → rootEntries array
 * @returns {string}              HTML string
 */
export function renderProjectsPanel(projects, rootEntriesMap) {
  if (!projects.length) {
    return `<div class="projects-panel">
      <div class="empty-state">
        <p>No projects found. Start a chain to see your projects here.</p>
      </div>
    </div>`;
  }

  const cards = projects.map(p => {
    const entries = rootEntriesMap.get(p.projectDir || '(default)') || [];
    return renderProjectCard(p, entries);
  }).join('\n');

  return `<div class="projects-panel">${cards}</div>`;
}
