// ============================================================
// Projects View Renderers (P9 + P10)
// ============================================================
// Server-side HTML generators for the project file explorer.
// Pure functions — take data, return HTML strings.
//
// P10 additions: git status badges, clickable file preview,
// search input, collapsible project cards.
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

// ── Git Status Helpers ──────────────────────────────────────

const GIT_STATUS_LABELS = {
  M: { label: 'M', cls: 'git-modified', title: 'Modified' },
  A: { label: 'A', cls: 'git-added', title: 'Added' },
  D: { label: 'D', cls: 'git-deleted', title: 'Deleted' },
  R: { label: 'R', cls: 'git-renamed', title: 'Renamed' },
  C: { label: 'C', cls: 'git-copied', title: 'Copied' },
  '?': { label: '?', cls: 'git-untracked', title: 'Untracked' },
  U: { label: 'U', cls: 'git-conflict', title: 'Conflict' },
};

function gitBadge(filePath, gitStatus) {
  if (!gitStatus) return '';
  const code = gitStatus[filePath];
  if (!code) return '';
  const info = GIT_STATUS_LABELS[code] || { label: code, cls: 'git-other', title: code };
  return `<span class="git-badge git-badge--${info.cls}" title="${info.title}">${info.label}</span>`;
}

// Check if a directory contains any modified files
function dirHasChanges(dirPath, gitStatus) {
  if (!gitStatus) return false;
  const prefix = dirPath + '/';
  for (const filePath of Object.keys(gitStatus)) {
    if (filePath.startsWith(prefix) || filePath === dirPath) return true;
  }
  return false;
}

// ── File Tree Renderers ─────────────────────────────────────

/**
 * Render a single file entry as HTML.
 */
function renderFileEntry(entry, _root, gitStatus) {
  if (entry.type === 'dir') {
    const ePath = escapeHtml(entry.path);
    const countLabel = entry.children === 1 ? '1 item' : `${entry.children} items`;
    const dirChanged = dirHasChanges(entry.path, gitStatus);
    const changeDot = dirChanged ? '<span class="git-dir-dot" title="Contains changes" aria-label="Contains changes"></span>' : '';
    return `<details class="tree-dir" data-path="${ePath}" ontoggle="loadTreeNode(this)">
      <summary class="tree-summary tree-summary--dir">
        <span class="tree-icon tree-icon--dir">📁</span>
        <span class="tree-name">${escapeHtml(entry.name)}/</span>
        ${changeDot}
        <span class="tree-meta">${countLabel}</span>
      </summary>
      <div class="tree-children"><div class="tree-loading">Loading…</div></div>
    </details>`;
  }

  const ePath = escapeHtml(entry.path);
  const badge = gitBadge(entry.path, gitStatus);
  return `<div class="tree-file tree-file--clickable" data-path="${ePath}" onclick="previewFile(this)" tabindex="0" role="button" aria-label="Preview ${escapeHtml(entry.name)}">
    <span class="tree-icon" aria-hidden="true">${fileIcon(entry.name)}</span>
    <span class="tree-name">${escapeHtml(entry.name)}</span>
    ${badge}
    <span class="tree-meta">${formatSize(entry.size)}</span>
  </div>`;
}

/**
 * Render a file listing (array of entries) as HTML.
 * Used for both root-level rendering and HTMX subtree responses.
 *
 * @param {Array} entries    Array from scanDirectory()
 * @param {string} root      Project root path
 * @param {object} gitStatus Optional map of filePath → status code
 * @returns {string}         HTML string
 */
export function renderFileTree(entries, root, gitStatus) {
  if (!entries.length) {
    return '<div class="tree-empty">Empty directory</div>';
  }
  return entries.map(e => renderFileEntry(e, root, gitStatus)).join('\n');
}

// ── Project Card Renderer ───────────────────────────────────

/**
 * Render a single project card with stats and file tree.
 *
 * @param {object} project     Project summary from /api/projects
 * @param {Array}  rootEntries Root-level directory entries
 * @param {object} gitStatus   Optional map of filePath → status code
 * @returns {string}           HTML string
 */
export function renderProjectCard(project, rootEntries, gitStatus) {
  const dir = project.projectDir || '(default)';
  const displayName = dir === '(default)' ? 'Default Project' : dir.replace(/\\/g, '/').split('/').pop();
  const displayPath = dir === '(default)' ? '' : escapeHtml(dir.replace(/\\/g, '/'));
  const eDir = escapeHtml(dir);

  const statusParts = [];
  if (project.running > 0)   statusParts.push(`<span class="proj-stat proj-stat--running">${project.running} running</span>`);
  if (project.completed > 0) statusParts.push(`<span class="proj-stat proj-stat--done">${project.completed} done</span>`);
  if (project.failed > 0)    statusParts.push(`<span class="proj-stat proj-stat--fail">${project.failed} failed</span>`);

  const gitChanges = gitStatus ? Object.keys(gitStatus).length : 0;
  const gitBadgeHtml = gitChanges > 0
    ? `<span class="proj-stat proj-stat--git">${gitChanges} changed</span>`
    : '';

  const lastAct = project.lastActivity ? relativeTime(project.lastActivity) : 'never';

  return `<div class="project-card" data-root="${eDir}">
    <div class="project-card__header">
      <div class="project-card__title">
        <h3 class="project-card__name">${escapeHtml(displayName)}</h3>
        ${displayPath ? `<span class="project-card__path">${displayPath}</span>` : ''}
      </div>
      <div class="project-card__actions">
        <button class="btn btn--sm btn--primary" onclick="openProjectInTerminal('${eDir}')" title="Open in Terminal" aria-label="Open project in terminal">&#x2328; Terminal</button>
        <button class="project-card__refresh" onclick="refreshProjectTree(this.closest('.project-card'))" title="Refresh file tree" aria-label="Refresh file tree">↻</button>
        <button class="project-card__toggle" onclick="toggleProjectCard(this.closest('.project-card'))" title="Collapse/expand" aria-label="Collapse/expand project" aria-expanded="true">▾</button>
      </div>
    </div>
    <div class="project-card__body">
      <div class="project-card__stats">
        <span class="proj-stat">${project.chains} chain${project.chains !== 1 ? 's' : ''}</span>
        ${statusParts.join('\n        ')}
        <span class="proj-stat">${formatCost(project.totalCostUsd)}</span>
        ${gitBadgeHtml}
        <span class="proj-stat proj-stat--time">${lastAct}</span>
      </div>
      <div class="project-card__search">
        <input type="search" class="tree-search" placeholder="Search files…" oninput="filterTree(this)" autocomplete="off" aria-label="Search files in project">
      </div>
      <div class="project-tree" data-root="${eDir}">
        ${dir === '(default)' ? '<div class="tree-empty">No project directory set</div>' : renderFileTree(rootEntries, dir, gitStatus)}
      </div>
    </div>
  </div>`;
}

// ── Full Panel Renderer ─────────────────────────────────────

/**
 * Render the complete projects panel.
 *
 * @param {Array} projects         Array of project summaries (from /api/projects)
 * @param {Map}   rootEntriesMap   Map of projectDir → rootEntries array
 * @param {Map}   gitStatusMap     Map of projectDir → gitStatus object
 * @returns {string}               HTML string
 */
export function renderProjectsPanel(projects, rootEntriesMap, gitStatusMap) {
  if (!projects.length) {
    return `<div class="projects-panel">
      <div class="empty-state">
        <p>No projects found. Start a chain to see your projects here.</p>
      </div>
    </div>`;
  }

  const cards = projects.map(p => {
    const key = p.projectDir || '(default)';
    const entries = rootEntriesMap.get(key) || [];
    const gitStatus = gitStatusMap ? gitStatusMap.get(key) : null;
    return renderProjectCard(p, entries, gitStatus);
  }).join('\n');

  // File preview panel (hidden by default, populated by client JS)
  const previewPanel = `<div id="file-preview" class="file-preview" style="display:none">
    <div class="file-preview__header">
      <span class="file-preview__path"></span>
      <button class="file-preview__close" onclick="closePreview()" title="Close preview" aria-label="Close file preview">✕</button>
    </div>
    <div class="file-preview__content">
      <pre class="file-preview__code"><code></code></pre>
    </div>
  </div>`;

  return `<div class="projects-panel">${cards}</div>\n${previewPanel}`;
}
