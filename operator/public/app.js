// ============================================================
// Shared UI Utilities — Operator Dashboard
// ============================================================
// Progress bar, toast, WS reconnect, keyboard shortcuts,
// confirm dialog, and global API toast listener.
// Loaded by all HTML pages.
// ============================================================

// ── Progress Bar ──────────────────────────────────────────────

document.body.addEventListener('htmx:beforeRequest', function () {
  document.getElementById('progress-bar').classList.add('active');
  document.getElementById('progress-bar').classList.remove('done');
});

document.body.addEventListener('htmx:afterRequest', function () {
  var bar = document.getElementById('progress-bar');
  bar.classList.remove('active');
  bar.classList.add('done');
  setTimeout(function () { bar.classList.remove('done'); bar.style.width = ''; }, 400);
});

// ── Toast System ──────────────────────────────────────────────

function showToast(msg, type) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var toast = document.createElement('div');
  toast.className = 'toast toast--' + (type || 'info');
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(function () { toast.remove(); }, 4000);
}

function _actionMessage(path, ok) {
  if (path.includes('/abort')) return ok ? 'Chain aborted' : 'Failed to abort chain';
  if (path.includes('/restart')) return ok ? 'Chain restarted' : 'Failed to restart chain';
  if (path.includes('/git/push')) return ok ? 'Pushed to remote' : 'Push failed';
  if (path.includes('/git/commit')) return ok ? 'Changes committed' : 'Commit failed';
  if (path.includes('/git/pr')) return ok ? 'PR created' : 'PR creation failed';
  if (path.includes('/orchestrator/start')) return ok ? 'Orchestrator started' : 'Failed to start orchestrator';
  if (path.includes('/orchestrator/stop')) return ok ? 'Orchestrator stopped' : 'Failed to stop orchestrator';
  if (path === '/api/chains') return ok ? 'Chain created' : 'Failed to create chain';
  return ok ? 'Success' : 'Action failed';
}

// ── WebSocket Utility (reconnect with exponential backoff) ───

function createWS(subscriptions, onMessage, opts) {
  opts = opts || {};
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = proto + '//' + location.host + '/ws';
  var backoff = 1000;
  var maxBackoff = 30000;
  var ws = null;
  var closed = false;

  function updateDot(state) {
    if (!opts.trackStatus) return;
    var dot = document.getElementById('ws-dot');
    if (!dot) return;
    dot.className = (dot.className.includes('sidebar-nav__ws-dot') ? 'sidebar-nav__ws-dot ' : '') + 'ws-dot ws-dot--' + state;
    dot.title = 'WebSocket: ' + state;
  }

  function connect() {
    if (closed) return;
    try { ws = new WebSocket(url); } catch (_) { return; }

    updateDot('connecting');

    ws.onopen = function() {
      backoff = 1000;
      updateDot('connected');
      ws.send(JSON.stringify({ subscribe: subscriptions }));
      if (opts.onConnect) opts.onConnect();
    };

    ws.onmessage = function(e) {
      try { onMessage(JSON.parse(e.data)); } catch (_) {}
    };

    ws.onclose = function() {
      updateDot('disconnected');
      if (opts.onDisconnect) opts.onDisconnect();
      if (!closed) {
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      }
    };
  }

  connect();
  return { close: function() { closed = true; if (ws) ws.close(); } };
}

// ── Page Cleanup on HTMX Navigation ─────────────────────────
// Pages register cleanup callbacks (e.g. WS close, interval clear).
// HTMX boost re-runs scripts without full page unload, so we need
// to clean up previous page state before the new page initializes.
var _pageCleanups = [];
function onPageCleanup(fn) { _pageCleanups.push(fn); }
document.body.addEventListener('htmx:beforeSwap', function () {
  for (var i = 0; i < _pageCleanups.length; i++) {
    try { _pageCleanups[i](); } catch (_) {}
  }
  _pageCleanups = [];
});

// ── Branch Name Auto-Generation ──────────────────────────────

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function autoFillBranch(task) {
  var el = document.getElementById('chain-branch');
  if (!el || el.dataset.manual === '1') return;
  var slug = slugify(task);
  el.value = slug ? 'auto/' + slug : '';
}

// Mark branch as manually edited so auto-fill stops
(function() {
  var el = document.getElementById('chain-branch');
  if (el) {
    el.addEventListener('input', function() { el.dataset.manual = '1'; });
    // Reset manual flag when form resets
    var form = el.closest('form');
    if (form) form.addEventListener('reset', function() { el.dataset.manual = ''; });
  }
})();

// ── Auto-Push Toggle ─────────────────────────────────────────

function toggleAutoPush(enabled) {
  fetch('/api/settings')
    .then(function(r) { return r.json(); })
    .then(function(s) {
      s.autoPush = enabled;
      return fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
    })
    .catch(function() {});
}

// Reset bulk selection after chain table reload
document.body.addEventListener('htmx:afterSwap', function(evt) {
  if (evt.detail.target && evt.detail.target.closest && evt.detail.target.closest('#chain-table')) {
    var selectAll = document.getElementById('select-all');
    if (selectAll) selectAll.checked = false;
    updateBulkBar();
  }
});

// Dashboard chain WS: auto-push + real-time updates
(function() {
  var lastDashReload = 0;

  createWS(['chain:*'], function(msg) {
    if (!msg.event || !msg.event.startsWith('chain:')) return;

    // Auto-push on completion (check server-side setting)
    if (msg.event === 'chain:complete' || msg.event === 'chain:assumed-complete') {
      fetch('/api/settings')
        .then(function(r) { return r.json(); })
        .then(function(s) {
          if (!s.autoPush) return;
          fetch('/api/git/push', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) {
              showToast(r.ok ? 'Auto-pushed to remote' : 'Auto-push failed', r.ok ? 'success' : 'error');
              var git = document.getElementById('git-panel');
              if (git) htmx.trigger(git, 'reload');
            })
            .catch(function() { showToast('Auto-push failed', 'error'); });
        })
        .catch(function() {});
    }

    // Real-time dashboard updates: debounce to 2s
    var now = Date.now();
    if (now - lastDashReload < 2000) return;
    lastDashReload = now;

    var chainTable = document.getElementById('chain-table');
    if (chainTable) htmx.trigger(chainTable, 'reload');
    var costGrid = document.getElementById('cost-summary-grid');
    if (costGrid) htmx.trigger(costGrid, 'reload');
  }, { trackStatus: true });
})();

// ── Project Filter ───────────────────────────────────────────

function onProjectChange(value) {
  localStorage.setItem('operator-project', value);
  // Reload all HTMX-driven panels
  var targets = ['#chain-table', '#cost-summary-grid', '#git-panel', '#orch-content', '#mission-launcher', '#report-viewer', '#projects-panel'];
  for (var i = 0; i < targets.length; i++) {
    var el = document.querySelector(targets[i]);
    if (el) htmx.trigger(el, 'reload');
  }
  // Also reload child tbody for chain table
  var tbody = document.querySelector('#chain-table tbody');
  if (tbody) htmx.trigger(document.getElementById('chain-table'), 'reload');
}

function loadProjects() {
  var select = document.getElementById('project-select');
  if (!select) return;
  var saved = localStorage.getItem('operator-project') || '';

  fetch('/api/projects')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var projects = data.projects || [];
      // Keep "All Projects" as first option
      var html = '<option value="">All Projects</option>';
      for (var i = 0; i < projects.length; i++) {
        var p = projects[i];
        var dir = p.projectDir || '(default)';
        // Show just the last path segment for brevity
        var label = dir.split('/').pop() || dir.split('\\').pop() || dir;
        if (dir === '(default)') label = '(default)';
        var selected = dir === saved ? ' selected' : '';
        html += '<option value="' + dir.replace(/"/g, '&quot;') + '"' + selected + '>' + label + ' (' + p.chains + ')</option>';
      }
      select.innerHTML = html;

      // Hide dropdown if only 0-1 projects
      select.style.display = projects.length <= 1 ? 'none' : '';
    })
    .catch(function() {
      select.style.display = 'none';
    });
}

// ── Sidebar Nav Active Link ─────────────────────────────────
function updateSidebarActiveLink() {
  var path = window.location.pathname;
  var links = document.querySelectorAll('.sidebar-nav__link');
  for (var i = 0; i < links.length; i++) {
    var linkPage = links[i].getAttribute('data-page');
    var isActive = (linkPage === path) || (linkPage === '/' && path === '/index.html');
    links[i].classList.toggle('sidebar-nav__link--active', isActive);
  }
}

// Update active link after HTMX navigation
document.body.addEventListener('htmx:afterSettle', function() {
  updateSidebarActiveLink();
});

// Inject project filter into all HTMX GET requests
document.body.addEventListener('htmx:configRequest', function(evt) {
  var project = localStorage.getItem('operator-project');
  if (project && evt.detail.verb === 'get') {
    evt.detail.parameters.project = project;
  }
});

loadProjects();

// ── Settings Defaults ────────────────────────────────────────

function applySettingsDefaults() {
  fetch('/api/settings')
    .then(function(r) { return r.json(); })
    .then(function(s) {
      // Pre-fill quick-start form model select
      var modelSelect = document.querySelector('.quick-start select[name="model"]');
      if (modelSelect && s.model) modelSelect.value = s.model;
    })
    .catch(function() {});
}

applySettingsDefaults();

// ── Confirm Dialog ───────────────────────────────────────────

(function() {
  var dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';
  dialog.innerHTML =
    '<div class="confirm-dialog__body">' +
      '<p class="confirm-dialog__msg"></p>' +
      '<div class="confirm-dialog__actions">' +
        '<button class="btn btn--ghost" data-action="cancel">Cancel</button>' +
        '<button class="btn btn--primary" data-action="confirm">Confirm</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(dialog);

  var msgEl = dialog.querySelector('.confirm-dialog__msg');
  var confirmBtn = dialog.querySelector('[data-action="confirm"]');
  var cancelBtn = dialog.querySelector('[data-action="cancel"]');
  var _cb = null;

  function close() { dialog.close(); _cb = null; }

  cancelBtn.onclick = close;
  confirmBtn.onclick = function() { var cb = _cb; close(); if (cb) cb(); };
  dialog.addEventListener('click', function(e) {
    if (e.target === dialog) close();
  });

  window._showConfirm = function(msg, cb) {
    msgEl.textContent = msg;
    _cb = cb;
    var danger = /delete|abort|stop/i.test(msg);
    confirmBtn.className = danger ? 'btn btn--danger' : 'btn btn--primary';
    if (/delete/i.test(msg)) confirmBtn.textContent = 'Delete';
    else if (/abort/i.test(msg)) confirmBtn.textContent = 'Abort';
    else if (/stop/i.test(msg)) confirmBtn.textContent = 'Stop';
    else confirmBtn.textContent = 'Confirm';
    dialog.showModal();
    cancelBtn.focus();
  };
})();

// Intercept HTMX confirm dialogs
document.body.addEventListener('htmx:confirm', function(evt) {
  if (!evt.detail.question) return;
  evt.preventDefault();
  _showConfirm(evt.detail.question, function() {
    evt.detail.issueRequest();
  });
});

// ── Keyboard Shortcuts ───────────────────────────────────────

document.addEventListener('keydown', function(e) {
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'n') {
    e.preventDefault();
    var taskInput = document.getElementById('chain-task');
    if (taskInput) {
      var details = taskInput.closest('details');
      if (details) details.open = true;
      taskInput.focus();
    }
  }

  if (e.key === '/') {
    e.preventDefault();
    var searchInput = document.querySelector('#chain-filters input[type="search"]');
    if (searchInput) searchInput.focus();
  }
});

// ── Bulk Chain Actions ────────────────────────────────────────

function updateBulkBar() {
  var checks = document.querySelectorAll('.chain-check:checked');
  var bar = document.getElementById('bulk-bar');
  var countEl = document.getElementById('bulk-count');
  var selectAll = document.getElementById('select-all');
  if (bar) bar.style.display = checks.length > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = checks.length;
  if (selectAll) {
    var total = document.querySelectorAll('.chain-check');
    selectAll.checked = total.length > 0 && checks.length === total.length;
    selectAll.indeterminate = checks.length > 0 && checks.length < total.length;
  }
}
window.updateBulkBar = updateBulkBar;

function toggleSelectAll(el) {
  var checks = document.querySelectorAll('.chain-check');
  checks.forEach(function(c) { c.checked = el.checked; });
  updateBulkBar();
}
window.toggleSelectAll = toggleSelectAll;

function bulkClearSelection() {
  var checks = document.querySelectorAll('.chain-check');
  checks.forEach(function(c) { c.checked = false; });
  var selectAll = document.getElementById('select-all');
  if (selectAll) selectAll.checked = false;
  updateBulkBar();
}
window.bulkClearSelection = bulkClearSelection;

function bulkDelete() {
  var checks = document.querySelectorAll('.chain-check:checked');
  var ids = Array.from(checks).map(function(c) { return c.value; });
  if (ids.length === 0) return;
  _showConfirm('Delete ' + ids.length + ' chain(s) permanently?', function() {
    fetch('/api/chains/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    }).then(function(r) {
      if (r.ok) {
        showToast('Deleted ' + ids.length + ' chain(s)', 'success');
        htmx.trigger(document.getElementById('chain-table'), 'reload');
        htmx.trigger(document.getElementById('cost-summary-grid'), 'reload');
        bulkClearSelection();
      } else {
        r.json().then(function(d) { showToast(d.error || 'Delete failed', 'error'); });
      }
    }).catch(function() { showToast('Delete failed', 'error'); });
  });
}
window.bulkDelete = bulkDelete;

// Global listener: show toast for all API POST/DELETE actions
document.body.addEventListener('htmx:afterRequest', function (evt) {
  var detail = evt.detail;
  var verb = detail.requestConfig && detail.requestConfig.verb;
  var path = detail.pathInfo && detail.pathInfo.requestPath;
  if (!path || !path.startsWith('/api/') || verb === 'get') return;

  if (detail.successful) {
    showToast(_actionMessage(path, true), 'success');
  } else {
    var msg = _actionMessage(path, false);
    try {
      var data = JSON.parse(detail.xhr.responseText);
      if (data.error) msg = data.error;
    } catch (_) {}
    showToast(msg, 'error');
  }
});

// ── Project File Tree ──────────────────────────────────────────

/**
 * Load a tree node's children via fetch (called on <details> ontoggle).
 * ontoggle fires AFTER the browser toggles open state, so details.open is reliable.
 */
function loadTreeNode(details) {
  // Only load on open, and only if not already loaded
  if (!details.open || details.dataset.loaded === '1') return;
  details.dataset.loaded = '1';

  var card = details.closest('.project-card') || details.closest('.project-tree');
  var root = card ? card.dataset.root : '';
  var path = details.dataset.path || '';

  if (!root) return;

  var children = details.querySelector('.tree-children');
  if (!children) return;

  fetch('/views/file-tree?root=' + encodeURIComponent(root) + '&path=' + encodeURIComponent(path))
    .then(function(r) { return r.text(); })
    .then(function(html) {
      children.innerHTML = html;
      // Re-apply any active search filter
      var search = card && card.querySelector('.tree-search');
      if (search && search.value) filterTree(search);
    })
    .catch(function() { children.innerHTML = '<div class="tree-empty">Failed to load</div>'; });
}
window.loadTreeNode = loadTreeNode;

/**
 * Refresh a project's file tree (re-fetch all open directories).
 */
function refreshProjectTree(card) {
  if (!card) return;
  var btn = card.querySelector('.project-card__refresh');
  if (btn) btn.classList.add('refreshing');

  var root = card.dataset.root;
  var tree = card.querySelector('.project-tree');
  if (!tree || !root) return;

  // Re-fetch root entries
  fetch('/views/file-tree?root=' + encodeURIComponent(root) + '&path=')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      tree.innerHTML = html;
      if (btn) setTimeout(function() { btn.classList.remove('refreshing'); }, 400);
      // Re-apply search filter
      var search = card.querySelector('.tree-search');
      if (search && search.value) filterTree(search);
    })
    .catch(function() {
      if (btn) btn.classList.remove('refreshing');
    });
}
window.refreshProjectTree = refreshProjectTree;

// ── File Preview ────────────────────────────────────────────────

// Keyboard support for clickable file tree entries
document.addEventListener('keydown', function(e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tree-file--clickable')) {
    e.preventDefault();
    previewFile(e.target);
  }
});

function previewFile(el) {
  var card = el.closest('.project-card');
  var root = card ? card.dataset.root : '';
  var path = el.dataset.path || '';
  if (!root || !path) return;

  // Highlight active file
  var prev = document.querySelector('.tree-file--active');
  if (prev) prev.classList.remove('tree-file--active');
  el.classList.add('tree-file--active');

  var panel = document.getElementById('file-preview');
  if (!panel) return;

  var pathEl = panel.querySelector('.file-preview__path');
  var codeEl = panel.querySelector('.file-preview__code code');
  if (pathEl) pathEl.textContent = path;
  if (codeEl) codeEl.textContent = 'Loading…';
  panel.style.display = '';

  fetch('/api/files/content?root=' + encodeURIComponent(root) + '&path=' + encodeURIComponent(path))
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); });
      return r.json();
    })
    .then(function(data) {
      if (codeEl) {
        // Add line numbers
        var lines = data.content.split('\n');
        var numbered = lines.map(function(line, i) {
          var num = String(i + 1);
          var pad = '     '.slice(num.length);
          return '<span class="line-num">' + pad + num + '</span>  ' + escapePreviewHtml(line);
        }).join('\n');
        codeEl.innerHTML = numbered;
      }
    })
    .catch(function(err) {
      if (codeEl) codeEl.textContent = err.message || 'Failed to load file';
    });
}
window.previewFile = previewFile;

function closePreview() {
  var panel = document.getElementById('file-preview');
  if (panel) panel.style.display = 'none';
  var active = document.querySelector('.tree-file--active');
  if (active) active.classList.remove('tree-file--active');
}
window.closePreview = closePreview;

function escapePreviewHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── File Tree Search ────────────────────────────────────────────

var _filterTimer = null;
function filterTree(input) {
  if (_filterTimer) clearTimeout(_filterTimer);
  _filterTimer = setTimeout(function() { _doFilterTree(input); }, 150);
}
window.filterTree = filterTree;

function _doFilterTree(input) {
  var card = input.closest('.project-card');
  if (!card) return;
  var tree = card.querySelector('.project-tree');
  if (!tree) return;

  var query = (input.value || '').toLowerCase().trim();

  // Show all entries if query is empty
  var files = tree.querySelectorAll('.tree-file');
  var dirs = tree.querySelectorAll('.tree-dir');

  if (!query) {
    for (var i = 0; i < files.length; i++) files[i].style.display = '';
    for (var j = 0; j < dirs.length; j++) dirs[j].style.display = '';
    return;
  }

  // Filter files: show if name matches
  for (var fi = 0; fi < files.length; fi++) {
    var nameEl = files[fi].querySelector('.tree-name');
    var name = nameEl ? nameEl.textContent.toLowerCase() : '';
    files[fi].style.display = name.includes(query) ? '' : 'none';
  }

  // Show dirs if they contain any visible children
  for (var di = dirs.length - 1; di >= 0; di--) {
    var children = dirs[di].querySelector('.tree-children');
    var hasVisible = false;
    if (children) {
      var visFiles = children.querySelectorAll('.tree-file:not([style*="display: none"])');
      var visDirs = children.querySelectorAll('.tree-dir:not([style*="display: none"])');
      hasVisible = visFiles.length > 0 || visDirs.length > 0;
    }
    // Also check if dir name matches
    var dirName = dirs[di].querySelector('.tree-name');
    var dirNameText = dirName ? dirName.textContent.toLowerCase() : '';
    if (dirNameText.includes(query)) hasVisible = true;
    dirs[di].style.display = hasVisible ? '' : 'none';
    // Auto-open dirs with matches
    if (hasVisible && !dirs[di].open) {
      dirs[di].open = true;
      loadTreeNode(dirs[di]);
    }
  }
}

// ── Collapsible Project Cards ───────────────────────────────────

function toggleProjectCard(card) {
  if (!card) return;
  var body = card.querySelector('.project-card__body');
  var btn = card.querySelector('.project-card__toggle');
  if (!body) return;

  var collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if (btn) {
    btn.textContent = collapsed ? '▾' : '▸';
    btn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
  }

  // Persist state
  var root = card.dataset.root || '';
  var key = 'proj-collapsed';
  try {
    var state = JSON.parse(localStorage.getItem(key) || '{}');
    if (collapsed) { delete state[root]; } else { state[root] = true; }
    localStorage.setItem(key, JSON.stringify(state));
  } catch (_) {}
}
window.toggleProjectCard = toggleProjectCard;

// Restore collapsed state on load
(function() {
  function restoreCollapsed() {
    try {
      var state = JSON.parse(localStorage.getItem('proj-collapsed') || '{}');
      var cards = document.querySelectorAll('.project-card');
      for (var i = 0; i < cards.length; i++) {
        var root = cards[i].dataset.root || '';
        if (state[root]) {
          var body = cards[i].querySelector('.project-card__body');
          var btn = cards[i].querySelector('.project-card__toggle');
          if (body) body.style.display = 'none';
          if (btn) { btn.textContent = '▸'; btn.setAttribute('aria-expanded', 'false'); }
        }
      }
    } catch (_) {}
  }

  // Run after HTMX loads the projects panel
  document.body.addEventListener('htmx:afterSwap', function(evt) {
    if (evt.detail.target && evt.detail.target.id === 'projects-panel') {
      restoreCollapsed();
    }
  });
})();

// ── Real-time File Change Listener ─────────────────────────────

(function() {
  var lastChange = {};
  var DEBOUNCE = 3000;

  createWS(['project:*'], function(msg) {
    if (msg.event !== 'project:files-changed') return;
    var dir = msg.data && msg.data.projectDir;
    if (!dir) return;

    // Debounce per project
    var now = Date.now();
    if (lastChange[dir] && now - lastChange[dir] < DEBOUNCE) return;
    lastChange[dir] = now;

    // Find matching project cards and refresh open trees
    var cards = document.querySelectorAll('.project-card');
    for (var i = 0; i < cards.length; i++) {
      var cardRoot = (cards[i].dataset.root || '').replace(/\\/g, '/');
      if (cardRoot === dir.replace(/\\/g, '/')) {
        // Refresh open details within this card
        var openDirs = cards[i].querySelectorAll('details.tree-dir[open]');
        for (var j = 0; j < openDirs.length; j++) {
          openDirs[j].dataset.loaded = '0';
          loadTreeNode(openDirs[j]);
          // Re-mark as open since loadTreeNode checks details.open
          openDirs[j].open = true;
        }
        // Also refresh root-level tree if visible
        var tree = cards[i].querySelector('.project-tree');
        if (tree && !openDirs.length) {
          refreshProjectTree(cards[i]);
        }
      }
    }
  });
})();

// ── Open Project in Terminal ─────────────────────────────────

function openProjectInTerminal(projectDir) {
  sessionStorage.setItem('pending-terminal-project', projectDir);
  window.location.href = '/terminals';
}
window.openProjectInTerminal = openProjectInTerminal;
