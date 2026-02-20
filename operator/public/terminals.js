// ============================================================
// Terminals Page — Multi-Instance xterm.js Terminal UI
// ============================================================
// Manages tabbed/grid terminal views for multiple orchestrator
// instances. Each instance gets its own xterm.js Terminal with
// a unique color theme, status bar, and WS event routing.
// ============================================================

/* global Terminal, FitAddon, SearchAddon, createWS, showToast */

// ── Color Themes ─────────────────────────────────────────────
var THEMES = [
  {
    id: 1, name: 'Indigo', accent: '#6366f1', bg: '#0d0d14',
    xterm: {
      background: '#0d0d14', foreground: '#e2e8f0', cursor: '#6366f1',
      cursorAccent: '#0d0d14', selectionBackground: 'rgba(99,102,241,0.3)',
      black: '#1e1e2e', red: '#f43f5e', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e8f0',
      brightBlack: '#4a4a5a', brightRed: '#fb7185', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#f8fafc',
    }
  },
  {
    id: 2, name: 'Emerald', accent: '#10b981', bg: '#0a0f0d',
    xterm: {
      background: '#0a0f0d', foreground: '#e2e8f0', cursor: '#10b981',
      cursorAccent: '#0a0f0d', selectionBackground: 'rgba(16,185,129,0.3)',
      black: '#1e2e1e', red: '#f43f5e', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e8f0',
      brightBlack: '#4a5a4a', brightRed: '#fb7185', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#f8fafc',
    }
  },
  {
    id: 3, name: 'Amber', accent: '#f59e0b', bg: '#0f0e0a',
    xterm: {
      background: '#0f0e0a', foreground: '#e2e8f0', cursor: '#f59e0b',
      cursorAccent: '#0f0e0a', selectionBackground: 'rgba(245,158,11,0.3)',
      black: '#2e2e1e', red: '#f43f5e', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e8f0',
      brightBlack: '#5a5a4a', brightRed: '#fb7185', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#f8fafc',
    }
  },
  {
    id: 4, name: 'Rose', accent: '#f43f5e', bg: '#0f0a0c',
    xterm: {
      background: '#0f0a0c', foreground: '#e2e8f0', cursor: '#f43f5e',
      cursorAccent: '#0f0a0c', selectionBackground: 'rgba(244,63,94,0.3)',
      black: '#2e1e1e', red: '#f43f5e', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e8f0',
      brightBlack: '#5a4a4a', brightRed: '#fb7185', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#f8fafc',
    }
  },
];

// ── State ────────────────────────────────────────────────────
// id → { id, theme, terminal, fitAddon, panel, tab, running, round, agents, cost, mission, model, coord }
// coord: { tasks: {total,pending,assigned,running,complete,failed,cancelled}, rateLimitOk, costUsd, budgetUsd, worktree, budgetWarning }
var instances = new Map();
var activeTabId = null;
var viewMode = localStorage.getItem('term-view') || 'tabs'; // 'tabs' | 'grid'
var themeIndex = 0;

// ── DOM refs ─────────────────────────────────────────────────
var tabBar = document.getElementById('term-tabs');
var panels = document.getElementById('term-panels');
var emptyState = document.getElementById('term-empty');
var viewToggle = document.getElementById('view-toggle-icon');

// ── State: maximized panel ───────────────────────────────────
var maximizedId = null; // id of maximized panel in grid mode, or null
var wsHandle = null;    // WebSocket connection handle for cleanup

// ── Initialization ───────────────────────────────────────────
(function init() {
  applyViewMode();
  loadInstances();
  loadMissions();
  // Close previous WS connection (HTMX boost re-runs scripts without full page unload)
  if (wsHandle) { wsHandle.close(); wsHandle = null; }
  connectWS();
  // Register cleanup for HTMX navigation away
  if (typeof onPageCleanup === 'function') {
    onPageCleanup(function() {
      if (wsHandle) { wsHandle.close(); wsHandle = null; }
    });
  }
  checkPendingProject();

  // ── Keyboard Shortcuts ──────────────────────────────────
  document.addEventListener('keydown', function(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

    // Escape — close dialogs, search bars, dropdowns (always active)
    if (e.key === 'Escape') {
      var dialog = document.getElementById('new-instance-dialog');
      if (dialog && dialog.open) { dialog.close(); e.preventDefault(); return; }
      var dd = document.querySelector('.handoff-history__dropdown');
      if (dd) { dd.remove(); e.preventDefault(); return; }
      // Close search bar on active terminal
      if (activeTabId) {
        var inst = instances.get(activeTabId);
        if (inst && inst.searchBar && inst.searchBar.style.display !== 'none') {
          closeTerminalSearch(activeTabId);
          e.preventDefault();
          return;
        }
      }
      return;
    }

    // Skip remaining shortcuts when in form fields
    if (inInput) return;

    // Ctrl+1-4: switch to Nth tab
    if (e.ctrlKey && !e.shiftKey && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      var idx = parseInt(e.key) - 1;
      var ids = Array.from(instances.keys());
      if (ids[idx]) switchTab(ids[idx]);
      return;
    }

    // Ctrl+N: new instance
    if (e.ctrlKey && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      addInstance();
      return;
    }

    // Ctrl+W: close/remove active terminal
    if (e.ctrlKey && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      if (activeTabId) removeInstance(activeTabId);
      return;
    }

    // Ctrl+H: handoff active terminal
    if (e.ctrlKey && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      if (activeTabId) handoffInstance(activeTabId);
      return;
    }

    // Ctrl+F: open terminal search
    if (e.ctrlKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      if (activeTabId) openTerminalSearch(activeTabId);
      return;
    }

    // Ctrl+Shift+Left/Right: navigate between tabs
    if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      var allIds = Array.from(instances.keys());
      if (allIds.length < 2) return;
      var curIdx = allIds.indexOf(activeTabId);
      if (curIdx === -1) return;
      var newIdx;
      if (e.key === 'ArrowLeft') {
        newIdx = (curIdx - 1 + allIds.length) % allIds.length;
      } else {
        newIdx = (curIdx + 1) % allIds.length;
      }
      switchTab(allIds[newIdx]);
      return;
    }

    // Ctrl+Shift+G: toggle grid/tab view
    if (e.ctrlKey && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
      e.preventDefault();
      toggleTerminalView();
      return;
    }

    // Ctrl+Shift+M: maximize/restore panel in grid mode
    if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
      e.preventDefault();
      if (activeTabId) toggleMaximize(activeTabId);
      return;
    }
  });
})();

// ── Load existing instances from API ─────────────────────────
function loadInstances() {
  // Show loading state
  if (emptyState) {
    emptyState.innerHTML = '<div class="term-loading"><div class="term-loading__spinner"></div><span>Loading instances...</span></div>';
    emptyState.style.display = 'flex';
  }

  fetch('/api/orchestrator/instances')
    .then(function(r) { return r.json(); })
    .then(function(list) {
      if (!list || !list.length) {
        // Restore original empty state
        if (emptyState) {
          emptyState.innerHTML = '<p>No orchestrator instances running.</p><p>Click <strong>+ New Instance</strong> to start one, or go to the <a href="/orchestrator">Orchestrator</a> page to launch a mission.</p>';
        }
        updateEmptyState();
        return;
      }
      list.forEach(function(inst) {
        addTerminalInstance(inst.id, inst);
      });
      // Restore active tab from localStorage or use first
      var saved = localStorage.getItem('term-active-tab');
      if (saved && instances.has(saved)) {
        switchTab(saved);
      } else if (instances.size > 0) {
        switchTab(instances.keys().next().value);
      }
    })
    .catch(function() {
      if (emptyState) {
        emptyState.innerHTML = '<p>No orchestrator instances running.</p><p>Click <strong>+ New Instance</strong> to start one, or go to the <a href="/orchestrator">Orchestrator</a> page to launch a mission.</p>';
      }
      updateEmptyState();
    });
}

// ── Load missions for the new-instance dialog ────────────────
function loadMissions() {
  fetch('/api/orchestrator/missions')
    .then(function(r) { return r.json(); })
    .then(function(missions) {
      var sel = document.getElementById('instance-mission-select');
      if (!sel) return;
      sel.innerHTML = '<option value="">(none — free run)</option>';
      missions.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m.file;
        opt.textContent = m.name || m.file;
        sel.appendChild(opt);
      });
    })
    .catch(function() {
      var sel = document.getElementById('instance-mission-select');
      if (sel) sel.innerHTML = '<option value="">(none — free run)</option>';
    });
}

// ── Add a terminal instance ──────────────────────────────────
function addTerminalInstance(id, state) {
  if (instances.has(id)) {
    // Update existing instance state
    var existing = instances.get(id);
    existing.running = state ? state.running : false;
    existing.round = state ? state.round : 0;
    existing.agents = state ? (state.agents || []) : [];
    existing.cost = state ? (state.cost || 0) : 0;
    existing.mission = state ? state.mission : null;
    existing.model = state ? state.model : null;
    updateStatusBar(id);
    updateTabDot(id);
    return;
  }

  var theme = THEMES[themeIndex % THEMES.length];
  themeIndex++;

  // Create xterm.js Terminal
  var term = new Terminal({
    theme: theme.xterm,
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    fontSize: 13,
    lineHeight: 1.3,
    cursorBlink: true,
    scrollback: 5000,
    convertEol: true,
    disableStdin: true,
  });

  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  // Search addon
  var searchAddon = null;
  if (typeof SearchAddon !== 'undefined' && SearchAddon.SearchAddon) {
    searchAddon = new SearchAddon.SearchAddon();
    term.loadAddon(searchAddon);
  }

  // Create tab
  var tab = document.createElement('button');
  tab.className = 'term-tab';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  tab.style.setProperty('--tab-accent', theme.accent);
  tab.dataset.instanceId = id;
  tab.innerHTML =
    '<span class="term-tab__dot' + (state && state.running ? ' term-tab__dot--running' : ' term-tab__dot--stopped') + '"></span>' +
    '<span class="term-tab__label">' + escHtml(id) + '</span>' +
    '<button class="term-tab__close" onclick="event.stopPropagation(); removeInstance(\'' + escHtml(id) + '\')" title="Remove" aria-label="Remove ' + escHtml(id) + '">&times;</button>';
  tab.addEventListener('click', function() { switchTab(id); });
  tabBar.appendChild(tab);

  // Create panel
  var panel = document.createElement('div');
  panel.className = 'term-panel';
  panel.dataset.instanceId = id;
  panel.style.setProperty('--panel-accent', theme.accent);
  panel.style.setProperty('--panel-bg', theme.bg);

  // Status bar
  var statusBar = document.createElement('div');
  statusBar.className = 'term-status';
  statusBar.innerHTML =
    '<span class="term-status__dot ' + (state && state.running ? 'term-status__dot--running' : 'term-status__dot--stopped') + '"></span>' +
    '<span class="term-status__id">' + escHtml(id) + '</span>' +
    '<span data-field="mission">' + (state && state.mission ? escHtml(state.mission) : '') + '</span>' +
    '<span data-field="model">' + (state && state.model ? escHtml(state.model) : '') + '</span>' +
    '<span data-field="round">R:' + (state ? state.round : 0) + '</span>' +
    '<span data-field="agents">A:' + (state && state.agents ? state.agents.length : 0) + '</span>' +
    '<span class="term-status__spacer"></span>' +
    '<span class="term-status__actions">' +
      '<button class="term-status__btn" onclick="startInstance(\'' + escHtml(id) + '\')" data-action="start">Start</button>' +
      '<button class="term-status__btn term-status__btn--danger" onclick="stopInstance(\'' + escHtml(id) + '\')" data-action="stop">Stop</button>' +
      '<button class="term-status__btn btn--accent" onclick="handoffInstance(\'' + escHtml(id) + '\')" data-action="handoff"' + (state && state.running ? '' : ' disabled') + '>Handoff</button>' +
      '<span class="handoff-history" style="position:relative;display:inline-block;">' +
        '<button class="term-status__btn" onclick="showHandoffHistory(\'' + escHtml(id) + '\', this)" data-action="history">History</button>' +
      '</span>' +
      '<button class="term-status__btn" onclick="openConfigDialog(\'' + escHtml(id) + '\')" data-action="config" title="Configure instance">\u2699</button>' +
      '<button class="term-status__btn" onclick="toggleMaximize(\'' + escHtml(id) + '\')" data-action="maximize" title="Maximize/Restore (Ctrl+Shift+M)">\u26F6</button>' +
    '</span>';
  panel.appendChild(statusBar);

  // Coordination status bar (hidden by default, shown when coord events arrive)
  var coordBar = document.createElement('div');
  coordBar.className = 'term-coord';
  coordBar.style.display = 'none';
  coordBar.innerHTML =
    '<span class="term-coord__tasks" data-coord="tasks" title="Task progress">' +
      '<span class="term-coord__label">Tasks</span>' +
      '<span class="term-coord__bar"><span class="term-coord__fill"></span></span>' +
      '<span class="term-coord__count">0/0</span>' +
    '</span>' +
    '<span class="term-coord__rate" data-coord="rate" title="Rate limit status">' +
      '<span class="term-coord__dot term-coord__dot--ok"></span>' +
      '<span class="term-coord__label">Rate</span>' +
    '</span>' +
    '<span class="term-coord__cost" data-coord="cost" title="Cost tracking">' +
      '<span class="term-coord__label">Cost</span>' +
      '<span class="term-coord__value">$0.00</span>' +
    '</span>' +
    '<span class="term-coord__worktree" data-coord="worktree" style="display:none" title="Git worktree">' +
      '<span class="term-coord__label">⎇</span>' +
      '<span class="term-coord__value"></span>' +
    '</span>';
  panel.appendChild(coordBar);

  // Search bar (hidden by default)
  var searchBar = document.createElement('div');
  searchBar.className = 'term-search';
  searchBar.style.display = 'none';
  searchBar.innerHTML =
    '<input type="text" class="term-search__input" placeholder="Search terminal..." aria-label="Search terminal">' +
    '<span class="term-search__count" data-search-count></span>' +
    '<button class="term-search__btn" data-search-prev title="Previous (Shift+Enter)">\u2191</button>' +
    '<button class="term-search__btn" data-search-next title="Next (Enter)">\u2193</button>' +
    '<button class="term-search__btn term-search__close" data-search-close title="Close (Escape)">\u00d7</button>';
  panel.appendChild(searchBar);

  // Wire search bar events
  (function(instanceId, sBar, sAddon) {
    var input = sBar.querySelector('.term-search__input');
    var countEl = sBar.querySelector('[data-search-count]');
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (sAddon) {
          if (e.shiftKey) { sAddon.findPrevious(input.value); }
          else { sAddon.findNext(input.value); }
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeTerminalSearch(instanceId);
      }
    });
    input.addEventListener('input', function() {
      if (sAddon && input.value) {
        sAddon.findNext(input.value);
      }
      if (!input.value && countEl) countEl.textContent = '';
    });
    sBar.querySelector('[data-search-prev]').addEventListener('click', function() {
      if (sAddon && input.value) sAddon.findPrevious(input.value);
    });
    sBar.querySelector('[data-search-next]').addEventListener('click', function() {
      if (sAddon && input.value) sAddon.findNext(input.value);
    });
    sBar.querySelector('[data-search-close]').addEventListener('click', function() {
      closeTerminalSearch(instanceId);
    });
  })(id, searchBar, searchAddon);

  // Terminal container
  var xtermContainer = document.createElement('div');
  xtermContainer.className = 'term-xterm';
  panel.appendChild(xtermContainer);

  panels.appendChild(panel);

  // Open terminal in DOM
  term.open(xtermContainer);

  // Fit after a short delay to ensure DOM is ready
  setTimeout(function() {
    try { fitAddon.fit(); } catch (e) { /* ignore */ }
  }, 50);

  // Write welcome message
  term.writeln('\x1b[1;' + ansiColorCode(theme.accent) + 'm' + '═══ ' + id + ' ═══\x1b[0m');
  term.writeln('\x1b[90mOrchestrator terminal ready. ' + (state && state.running ? 'Instance is running.' : 'Instance is stopped.') + '\x1b[0m');
  term.writeln('');

  // Store instance
  instances.set(id, {
    id: id,
    theme: theme,
    terminal: term,
    fitAddon: fitAddon,
    searchAddon: searchAddon,
    searchBar: searchBar,
    panel: panel,
    tab: tab,
    running: state ? state.running : false,
    round: state ? state.round : 0,
    agents: state ? (state.agents || []) : [],
    cost: state ? (state.cost || 0) : 0,
    mission: state ? state.mission : null,
    model: state ? state.model : null,
    maximized: false,
    coord: {
      tasks: { total: 0, pending: 0, assigned: 0, running: 0, complete: 0, failed: 0, cancelled: 0 },
      rateLimitOk: true,
      costUsd: 0,
      budgetUsd: 0,
      worktree: null,
      budgetWarning: false,
      budgetExceeded: false,
      active: false,
    },
  });

  updateEmptyState();
  applyViewMode();

  // If no active tab, activate this one
  if (!activeTabId) {
    switchTab(id);
  }
}

// ── Switch active tab ────────────────────────────────────────
function switchTab(id) {
  if (!instances.has(id)) return;
  activeTabId = id;
  localStorage.setItem('term-active-tab', id);

  instances.forEach(function(inst, instId) {
    var isActive = instId === id;
    inst.tab.classList.toggle('term-tab--active', isActive);
    inst.tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    inst.panel.classList.toggle('term-panel--active', isActive);
  });

  // Refit active terminal
  var active = instances.get(id);
  if (active) {
    setTimeout(function() {
      try { active.fitAddon.fit(); } catch (e) { /* ignore */ }
    }, 10);
  }
}

// ── Remove instance ──────────────────────────────────────────
function removeInstance(id) {
  var inst = instances.get(id);
  if (!inst) return;

  if (inst.running) {
    showToast('Stop the instance before removing it', 'error');
    return;
  }

  // DELETE from API
  fetch('/api/orchestrator/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function(r) {
      if (!r.ok && r.status !== 404) throw new Error('Delete failed');
    })
    .catch(function() { /* ignore */ });

  // Clean up DOM
  inst.terminal.dispose();
  inst.tab.remove();
  inst.panel.remove();
  instances.delete(id);

  // Switch to another tab if this was active
  if (activeTabId === id) {
    activeTabId = null;
    var remaining = Array.from(instances.keys());
    if (remaining.length > 0) {
      switchTab(remaining[0]);
    }
  }
  updateEmptyState();
}

// ── Start instance ───────────────────────────────────────────
function startInstance(id) {
  var inst = instances.get(id);
  if (!inst) return;
  if (inst.running) {
    showToast(id + ' is already running', 'info');
    return;
  }

  setBtnLoading(inst, 'start', true);
  fetch('/api/orchestrator/' + encodeURIComponent(id) + '/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Start failed'); });
      inst.running = true;
      inst.terminal.writeln('\x1b[32m--- Started ---\x1b[0m');
      updateStatusBar(id);
      updateTabDot(id);
      showToast(id + ' started', 'success');
    })
    .catch(function(err) {
      showToast('Failed to start ' + id + ': ' + err.message, 'error');
    })
    .finally(function() {
      setBtnLoading(inst, 'start', false);
    });
}

// ── Stop instance ────────────────────────────────────────────
function stopInstance(id) {
  var inst = instances.get(id);
  if (!inst) return;
  if (!inst.running) {
    showToast(id + ' is not running', 'info');
    return;
  }

  setBtnLoading(inst, 'stop', true);
  fetch('/api/orchestrator/' + encodeURIComponent(id) + '/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Stop failed'); });
      inst.running = false;
      inst.terminal.writeln('\x1b[31m--- Stopped ---\x1b[0m');
      updateStatusBar(id);
      updateTabDot(id);
      showToast(id + ' stopped', 'success');
    })
    .catch(function(err) {
      showToast('Failed to stop ' + id + ': ' + err.message, 'error');
    })
    .finally(function() {
      setBtnLoading(inst, 'stop', false);
    });
}

// ── Submit new instance from dialog ──────────────────────────
function submitNewInstance(e) {
  e.preventDefault();
  var form = e.target;
  var dialog = document.getElementById('new-instance-dialog');
  var id = form.instanceId.value.trim();
  var mission = form.mission.value;
  var model = form.model.value;
  var dryRun = form.dryRun.checked;
  var projectDir = dialog.dataset.projectDir || undefined;

  if (!id) {
    showToast('Instance ID is required', 'error');
    return false;
  }

  if (instances.has(id)) {
    showToast('Instance "' + id + '" already exists', 'error');
    return false;
  }

  // Create the tab/terminal immediately
  addTerminalInstance(id, { running: false, round: 0, agents: [], mission: mission, model: model });

  // Start via API
  fetch('/api/orchestrator/' + encodeURIComponent(id) + '/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mission: mission || undefined,
      model: model,
      dryRun: dryRun,
      projectDir: projectDir,
    }),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Start failed'); });
      var inst = instances.get(id);
      if (inst) {
        inst.running = true;
        inst.terminal.writeln('\x1b[32m--- Started ---\x1b[0m');
        updateStatusBar(id);
        updateTabDot(id);
      }
      showToast(id + ' started', 'success');
    })
    .catch(function(err) {
      showToast('Failed to start ' + id + ': ' + err.message, 'error');
    });

  delete dialog.dataset.projectDir; // clear pending project
  dialog.close();
  form.reset();
  switchTab(id);
  return false;
}

// ── Add instance button handler ──────────────────────────────
function addInstance() {
  var dialog = document.getElementById('new-instance-dialog');
  // Generate a default ID
  var nextNum = instances.size + 1;
  var defaultId = 'worker-' + nextNum;
  while (instances.has(defaultId)) {
    nextNum++;
    defaultId = 'worker-' + nextNum;
  }
  var form = document.getElementById('new-instance-form');
  form.instanceId.value = defaultId;
  dialog.showModal();
}

// ── View mode toggle ─────────────────────────────────────────
function toggleTerminalView() {
  viewMode = viewMode === 'tabs' ? 'grid' : 'tabs';
  localStorage.setItem('term-view', viewMode);
  applyViewMode();
}

function applyViewMode() {
  var isGrid = viewMode === 'grid';
  panels.classList.toggle('term-panels--grid', isGrid);
  panels.classList.toggle('term-panels--tabs', !isGrid);
  viewToggle.textContent = isGrid ? '\u25A3' : '\u25A6\u25A6';

  // Clear maximize state when switching to tabs
  if (!isGrid && maximizedId) {
    var maxInst = instances.get(maximizedId);
    if (maxInst) {
      maxInst.maximized = false;
      maxInst.panel.classList.remove('term-panel--maximized');
      var btn = maxInst.panel.querySelector('[data-action="maximize"]');
      if (btn) btn.textContent = '\u26F6';
    }
    maximizedId = null;
  }

  if (isGrid) {
    // Show all panels in grid (unless one is maximized)
    instances.forEach(function(inst) {
      inst.panel.classList.add('term-panel--active');
      if (maximizedId && inst.id !== maximizedId) {
        inst.panel.style.display = 'none';
      } else {
        inst.panel.style.display = 'flex';
      }
    });
  } else {
    // Show only active tab
    instances.forEach(function(inst, instId) {
      inst.panel.classList.toggle('term-panel--active', instId === activeTabId);
      inst.panel.style.display = '';
    });
  }

  // Refit all terminals
  setTimeout(function() {
    instances.forEach(function(inst) {
      try { inst.fitAddon.fit(); } catch (e) { /* ignore */ }
    });
  }, 50);
}

// ── WebSocket event routing ──────────────────────────────────
function connectWS() {
  wsHandle = createWS([
    'worker:*',
    'orchestrator:*',
    'agent:*',
    'round:*',
    'handoff:*',
    'coord:*',
  ], function(msg) {
    if (!msg || !msg.event || !msg.data) return;

    var instanceId = msg.data.workerId || msg.data.instanceId || 'default';
    var inst = instances.get(instanceId);

    // Route event to the correct terminal
    switch (msg.event) {
      case 'worker:log':
      case 'orchestrator:log':
        if (inst && msg.data.text) {
          writeLogToTerminal(inst, msg.data.text, msg.data.stream);
        }
        break;

      case 'worker:spawned':
        if (!inst) {
          // Auto-create tab for new worker
          addTerminalInstance(instanceId, { running: false, round: 0, agents: [] });
          inst = instances.get(instanceId);
        }
        if (inst) {
          inst.terminal.writeln('\x1b[36m[SYSTEM] Worker spawned (PID: ' + (msg.data.pid || '?') + ')\x1b[0m');
        }
        updateHealthFromEvent(instanceId, { status: 'starting', pid: msg.data.pid });
        break;

      case 'worker:ready':
        if (inst) {
          inst.running = true;
          inst.terminal.writeln('\x1b[32m[SYSTEM] Worker ready\x1b[0m');
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
        updateHealthFromEvent(instanceId, { status: 'running' });
        break;

      case 'worker:exit':
        if (inst) {
          inst.running = false;
          inst.terminal.writeln('\x1b[33m[SYSTEM] Worker exited (code: ' + (msg.data.code !== undefined ? msg.data.code : '?') + ')\x1b[0m');
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
        updateHealthFromEvent(instanceId, { status: 'stopped', exitCode: msg.data.code });
        break;

      case 'worker:error':
        if (inst) {
          inst.terminal.writeln('\x1b[31m[ERROR] ' + (msg.data.error || msg.data.message || 'Unknown error') + '\x1b[0m');
        }
        break;

      case 'worker:unhealthy':
        if (inst) {
          inst.terminal.writeln('\x1b[31;1m[WARN] Worker unhealthy — missed heartbeats\x1b[0m');
        }
        updateHealthFromEvent(instanceId, { status: 'running' });
        break;

      case 'worker:restarted':
        if (inst) {
          inst.terminal.writeln('\x1b[33m[SYSTEM] Worker restarted (restart #' + (msg.data.restartCount || '?') + ')\x1b[0m');
          inst.running = true;
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
        updateHealthFromEvent(instanceId, { status: 'running', restartCount: msg.data.restartCount || 0 });
        break;

      case 'worker:idle-killed':
        if (inst) {
          inst.terminal.writeln('\x1b[33m[SYSTEM] Worker killed (idle ' + Math.round((msg.data.idleMs || 0) / 1000) + 's)\x1b[0m');
          inst.running = false;
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
        updateHealthFromEvent(instanceId, { status: 'stopped' });
        break;

      case 'worker:circuit-open':
        if (inst) {
          inst.terminal.writeln('\x1b[31;1m[HEALTH] Circuit breaker OPEN — ' + (msg.data.consecutiveFailures || '?') + ' consecutive failures\x1b[0m');
        }
        updateHealthFromEvent(instanceId, {
          circuitState: 'open',
          consecutiveFailures: msg.data.consecutiveFailures || 0,
        });
        break;

      case 'worker:circuit-half-open':
        if (inst) {
          inst.terminal.writeln('\x1b[33m[HEALTH] Circuit breaker half-open — attempting recovery\x1b[0m');
        }
        updateHealthFromEvent(instanceId, { circuitState: 'half-open' });
        break;

      case 'worker:max-restarts':
        if (inst) {
          inst.terminal.writeln('\x1b[31;1m[HEALTH] Max restarts exceeded (' + (msg.data.maxRestarts || '?') + ') — worker abandoned\x1b[0m');
        }
        showToast('Worker ' + instanceId + ' exceeded max restarts', 'error');
        updateHealthFromEvent(instanceId, {
          status: 'stopped',
          consecutiveFailures: msg.data.consecutiveFailures || 0,
          restartCount: msg.data.restartCount || 0,
        });
        break;

      case 'orchestrator:started':
        if (inst) {
          inst.running = true;
          inst.mission = msg.data.mission || inst.mission;
          inst.model = msg.data.model || inst.model;
          inst.terminal.writeln('\x1b[32;1m═══ Orchestrator started ═══\x1b[0m');
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
        break;

      case 'orchestrator:stopped':
        if (inst) {
          inst.running = false;
          inst.terminal.writeln('\x1b[31;1m═══ Orchestrator stopped ═══\x1b[0m');
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
        break;

      case 'round:start':
        if (inst) {
          inst.round = msg.data.round || (inst.round + 1);
          inst.terminal.writeln('\x1b[34m── Round ' + inst.round + ' ──\x1b[0m');
          updateStatusBar(instanceId);
        }
        break;

      case 'round:complete':
        if (inst) {
          inst.terminal.writeln('\x1b[34m── Round ' + (msg.data.round || inst.round) + ' complete ──\x1b[0m');
        }
        break;

      case 'agent:start':
        if (inst) {
          var agentId = msg.data.agentId || msg.data.id || '?';
          var role = msg.data.role || '';
          inst.terminal.writeln('\x1b[36m▶ Agent started: ' + agentId + (role ? ' (' + role + ')' : '') + '\x1b[0m');
          inst.agents = msg.data.agents || inst.agents;
          updateStatusBar(instanceId);
        }
        break;

      case 'agent:complete':
        if (inst) {
          var agentId2 = msg.data.agentId || msg.data.id || '?';
          var costStr = msg.data.cost !== undefined ? ' $' + Number(msg.data.cost).toFixed(4) : '';
          inst.terminal.writeln('\x1b[32m✓ Agent complete: ' + agentId2 + costStr + '\x1b[0m');
          if (msg.data.cost !== undefined) {
            inst.cost = (inst.cost || 0) + Number(msg.data.cost);
          }
          updateStatusBar(instanceId);
        }
        break;

      case 'agent:error':
        if (inst) {
          var agentId3 = msg.data.agentId || msg.data.id || '?';
          inst.terminal.writeln('\x1b[31m✗ Agent error: ' + agentId3 + ' — ' + (msg.data.error || 'unknown') + '\x1b[0m');
        }
        break;

      case 'agent:continuation':
        if (inst) {
          var agentId4 = msg.data.agentId || msg.data.id || '?';
          inst.terminal.writeln('\x1b[33m↻ Agent continuation: ' + agentId4 + '\x1b[0m');
        }
        break;

      case 'handoff:generated':
        if (inst) {
          inst.terminal.writeln('\x1b[35;1m📋 Handoff generated: ' + (msg.data.summary || '') + '\x1b[0m');
          showToast('Handoff generated for ' + instanceId, 'success');
        }
        break;

      case 'handoff:restart':
        if (inst) {
          inst.terminal.writeln('\x1b[35;1m🔄 Handoff restart — context preserved\x1b[0m');
          inst.running = true;
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
          showToast('Handoff restart for ' + instanceId, 'success');
        }
        break;

      // ── Coordination Events ──────────────────────────────

      case 'coord:started':
        // Global event — show on all instances
        instances.forEach(function(i) {
          i.coord.active = true;
          i.terminal.writeln('\x1b[35m[COORD] Coordinator started\x1b[0m');
          showCoordBar(i.id);
        });
        break;

      case 'coord:stopped':
        instances.forEach(function(i) {
          i.coord.active = false;
          i.terminal.writeln('\x1b[35m[COORD] Coordinator stopped\x1b[0m');
        });
        break;

      case 'coord:draining':
        instances.forEach(function(i) {
          i.terminal.writeln('\x1b[33m[COORD] Draining — no new tasks\x1b[0m');
        });
        break;

      case 'coord:assigned':
        if (inst) {
          inst.coord.active = true;
          showCoordBar(instanceId);
          inst.terminal.writeln('\x1b[35m[COORD] Task assigned: ' + (msg.data.taskId || '?') + '\x1b[0m');
          // Update task counts via progress fetch
          fetchCoordProgress();
        }
        break;

      case 'coord:task-complete':
        if (inst) {
          inst.terminal.writeln('\x1b[32m[COORD] Task complete: ' + (msg.data.taskId || '?') + '\x1b[0m');
          fetchCoordProgress();
        }
        break;

      case 'coord:task-failed':
        if (inst) {
          inst.terminal.writeln('\x1b[31m[COORD] Task failed: ' + (msg.data.taskId || '?') + ' — ' + (msg.data.error || 'unknown') + '\x1b[0m');
          fetchCoordProgress();
        }
        break;

      case 'coord:all-complete':
        instances.forEach(function(i) {
          var d = msg.data || {};
          i.terminal.writeln('\x1b[32;1m[COORD] All tasks complete (' + (d.complete || 0) + '/' + (d.total || 0) + ')\x1b[0m');
          fetchCoordProgress();
        });
        showToast('All coordination tasks complete', 'success');
        break;

      case 'coord:budget-warning':
        if (msg.data.workerId && instances.has(msg.data.workerId)) {
          var wi = instances.get(msg.data.workerId);
          wi.coord.budgetWarning = true;
          wi.terminal.writeln('\x1b[33;1m[COORD] Budget warning: $' + Number(msg.data.totalUsd || 0).toFixed(2) + ' / $' + Number(msg.data.budgetUsd || 0).toFixed(2) + '\x1b[0m');
          updateCoordBar(msg.data.workerId);
        } else {
          instances.forEach(function(i) {
            i.coord.budgetWarning = true;
            i.terminal.writeln('\x1b[33;1m[COORD] Global budget warning: $' + Number(msg.data.totalUsd || 0).toFixed(2) + '\x1b[0m');
            updateCoordBar(i.id);
          });
        }
        break;

      case 'coord:budget-exceeded':
        if (msg.data.workerId && instances.has(msg.data.workerId)) {
          var ei = instances.get(msg.data.workerId);
          ei.coord.budgetExceeded = true;
          ei.terminal.writeln('\x1b[31;1m[COORD] BUDGET EXCEEDED: $' + Number(msg.data.totalUsd || 0).toFixed(2) + '\x1b[0m');
          updateCoordBar(msg.data.workerId);
        } else {
          instances.forEach(function(i) {
            i.coord.budgetExceeded = true;
            i.terminal.writeln('\x1b[31;1m[COORD] GLOBAL BUDGET EXCEEDED\x1b[0m');
            updateCoordBar(i.id);
          });
        }
        showToast('Budget exceeded!', 'error');
        break;

      case 'coord:worktree-created':
        if (inst) {
          inst.coord.worktree = { branch: msg.data.branch || '', path: msg.data.path || '' };
          inst.terminal.writeln('\x1b[36m[COORD] Worktree created: ' + (msg.data.branch || '') + '\x1b[0m');
          updateCoordBar(instanceId);
        }
        break;

      case 'coord:worktree-removed':
        if (inst) {
          inst.coord.worktree = null;
          inst.terminal.writeln('\x1b[36m[COORD] Worktree removed\x1b[0m');
          updateCoordBar(instanceId);
        }
        break;

      case 'coord:worktree-merged':
        if (inst) {
          inst.terminal.writeln('\x1b[32m[COORD] Worktree merged: ' + (msg.data.branch || '') + (msg.data.mergeCommit ? ' (' + msg.data.mergeCommit.slice(0, 7) + ')' : '') + '\x1b[0m');
          inst.coord.worktree = null;
          updateCoordBar(instanceId);
        }
        break;

      case 'coord:conflicts-detected':
        instances.forEach(function(i) {
          var conflicts = msg.data.conflicted || [];
          if (conflicts.length > 0) {
            i.terminal.writeln('\x1b[31;1m[COORD] Merge conflicts detected: ' + conflicts.join(', ') + '\x1b[0m');
          }
        });
        break;

      case 'coord:config-updated':
        // Refresh metrics panel if open
        var metricsPanel = document.getElementById('term-metrics');
        if (metricsPanel && metricsPanel.open) loadCoordMetrics();
        break;

      case 'coord:rate-adjusted':
        // Update adaptive rate card directly from WS data (no extra fetch)
        updateAdaptiveCard({ enabled: true, state: msg.data.state, factor: msg.data.factor });
        break;
    }
  }, {
    trackStatus: true,
    onConnect: function() { setWsOverlay(true); },
    onDisconnect: function() { setWsOverlay(false); },
  });
}

// ── Coordination Bar Helpers ─────────────────────────────────

function showCoordBar(id) {
  var inst = instances.get(id);
  if (!inst) return;
  var bar = inst.panel.querySelector('.term-coord');
  if (bar) bar.style.display = 'flex';
}

function updateCoordBar(id) {
  var inst = instances.get(id);
  if (!inst) return;
  var bar = inst.panel.querySelector('.term-coord');
  if (!bar) return;

  var c = inst.coord;

  // Tasks progress
  var tasksEl = bar.querySelector('[data-coord="tasks"]');
  if (tasksEl) {
    var pct = c.tasks.total > 0 ? ((c.tasks.complete / c.tasks.total) * 100) : 0;
    var fill = tasksEl.querySelector('.term-coord__fill');
    if (fill) fill.style.width = pct + '%';
    var count = tasksEl.querySelector('.term-coord__count');
    if (count) count.textContent = c.tasks.complete + '/' + c.tasks.total;
  }

  // Rate limit dot
  var rateEl = bar.querySelector('[data-coord="rate"]');
  if (rateEl) {
    var dot = rateEl.querySelector('.term-coord__dot');
    if (dot) {
      dot.className = 'term-coord__dot ' + (c.rateLimitOk ? 'term-coord__dot--ok' : 'term-coord__dot--wait');
    }
  }

  // Cost
  var costEl = bar.querySelector('[data-coord="cost"]');
  if (costEl) {
    var val = costEl.querySelector('.term-coord__value');
    if (val) {
      var costStr = '$' + Number(c.costUsd || 0).toFixed(2);
      if (c.budgetUsd > 0) costStr += ' / $' + Number(c.budgetUsd).toFixed(0);
      val.textContent = costStr;
    }
    costEl.classList.toggle('term-coord__cost--warning', c.budgetWarning && !c.budgetExceeded);
    costEl.classList.toggle('term-coord__cost--exceeded', c.budgetExceeded);
  }

  // Worktree
  var wtEl = bar.querySelector('[data-coord="worktree"]');
  if (wtEl) {
    if (c.worktree) {
      wtEl.style.display = '';
      var wtVal = wtEl.querySelector('.term-coord__value');
      if (wtVal) wtVal.textContent = c.worktree.branch || '';
    } else {
      wtEl.style.display = 'none';
    }
  }
}

var coordProgressDebounce = null;
function fetchCoordProgress() {
  // Debounce rapid progress fetches
  if (coordProgressDebounce) return;
  coordProgressDebounce = setTimeout(function() {
    coordProgressDebounce = null;
    fetch('/api/coordination/progress')
      .then(function(r) { return r.json(); })
      .then(function(progress) {
        instances.forEach(function(inst) {
          inst.coord.tasks = progress;
          updateCoordBar(inst.id);
        });
      })
      .catch(function() { /* coordination not active */ });
    fetch('/api/coordination/costs')
      .then(function(r) { return r.json(); })
      .then(function(costs) {
        instances.forEach(function(inst) {
          var wCost = costs.workers && costs.workers[inst.id];
          inst.coord.costUsd = wCost ? wCost.totalUsd : 0;
          inst.coord.budgetUsd = costs.perWorkerBudgetUsd || 0;
          updateCoordBar(inst.id);
        });
      })
      .catch(function() { /* ignore */ });
  }, 200);
}

// ── Write log text to terminal ───────────────────────────────
function writeLogToTerminal(inst, text, stream) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i] && i === lines.length - 1) continue; // skip trailing empty
    if (stream === 'stderr') {
      inst.terminal.writeln('\x1b[31m' + lines[i] + '\x1b[0m');
    } else {
      inst.terminal.writeln(lines[i]);
    }
  }
}

// ── Update status bar for an instance ────────────────────────
function updateStatusBar(id) {
  var inst = instances.get(id);
  if (!inst) return;

  var statusBar = inst.panel.querySelector('.term-status');
  if (!statusBar) return;

  var dot = statusBar.querySelector('.term-status__dot');
  if (dot) {
    dot.className = 'term-status__dot ' + (inst.running ? 'term-status__dot--running' : 'term-status__dot--stopped');
  }

  var missionEl = statusBar.querySelector('[data-field="mission"]');
  if (missionEl) missionEl.textContent = inst.mission || '';

  var modelEl = statusBar.querySelector('[data-field="model"]');
  if (modelEl) modelEl.textContent = inst.model || '';

  var roundEl = statusBar.querySelector('[data-field="round"]');
  if (roundEl) roundEl.textContent = 'R:' + (inst.round || 0);

  var agentsEl = statusBar.querySelector('[data-field="agents"]');
  if (agentsEl) agentsEl.textContent = 'A:' + (inst.agents ? inst.agents.length : 0);

  // Disable/enable start/stop/handoff buttons
  var startBtn = statusBar.querySelector('[data-action="start"]');
  var stopBtn = statusBar.querySelector('[data-action="stop"]');
  var handoffBtn = statusBar.querySelector('[data-action="handoff"]');
  if (startBtn) startBtn.disabled = inst.running;
  if (stopBtn) stopBtn.disabled = !inst.running;
  if (handoffBtn) handoffBtn.disabled = !inst.running;
}

// ── Update tab dot (running/stopped) ─────────────────────────
function updateTabDot(id) {
  var inst = instances.get(id);
  if (!inst) return;
  var dot = inst.tab.querySelector('.term-tab__dot');
  if (dot) {
    dot.className = 'term-tab__dot ' + (inst.running ? 'term-tab__dot--running' : 'term-tab__dot--stopped');
  }
}

// ── Update empty state visibility ────────────────────────────
function updateEmptyState() {
  if (emptyState) {
    emptyState.style.display = instances.size === 0 ? 'flex' : 'none';
  }
}

// ── Button Loading State ──────────────────────────────────────
function setBtnLoading(inst, action, loading) {
  if (!inst || !inst.panel) return;
  var btn = inst.panel.querySelector('[data-action="' + action + '"]');
  if (btn) {
    btn.classList.toggle('term-status__btn--loading', loading);
    btn.disabled = loading;
  }
}

// ── WS Disconnect Overlay ────────────────────────────────────
var wsConnected = true;
function setWsOverlay(connected) {
  wsConnected = connected;
  instances.forEach(function(inst) {
    var existing = inst.panel.querySelector('.term-panel__overlay');
    if (!connected) {
      if (!existing) {
        var overlay = document.createElement('div');
        overlay.className = 'term-panel__overlay';
        overlay.innerHTML = '<div class="term-panel__overlay-msg"><div class="term-loading__spinner"></div>Connection lost — reconnecting...</div>';
        inst.panel.style.position = 'relative';
        inst.panel.appendChild(overlay);
      }
    } else {
      if (existing) existing.remove();
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────
function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function ansiColorCode(hex) {
  // Map theme accent to nearest ANSI 256 foreground code
  // Simplified: just use bright versions of known colors
  var map = {
    '#6366f1': '34', // blue
    '#10b981': '32', // green
    '#f59e0b': '33', // yellow
    '#f43f5e': '31', // red
  };
  return map[hex] || '37';
}

// ── Handoff Instance ─────────────────────────────────────────
function handoffInstance(id) {
  var inst = instances.get(id);
  if (!inst) return;
  if (!inst.running) {
    showToast(id + ' is not running', 'info');
    return;
  }

  var term = inst.terminal;
  var accent = ansiColorCode(inst.theme.accent);

  // 5-step ANSI progress
  term.writeln('');
  term.writeln('\x1b[1;' + accent + 'm═══ Handoff Restart ═══\x1b[0m');
  term.writeln('\x1b[' + accent + 'm  [1/5] Generating handoff document...\x1b[0m');

  fetch('/api/orchestrator/' + encodeURIComponent(id) + '/handoff-restart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Handoff failed'); });
      return r.json();
    })
    .then(function(data) {
      term.writeln('\x1b[' + accent + 'm  [2/5] Handoff saved: ' + (data.handoffFile || '').split(/[/\\]/).pop() + '\x1b[0m');
      term.writeln('\x1b[' + accent + 'm  [3/5] Stopping instance...\x1b[0m');
      term.writeln('\x1b[' + accent + 'm  [4/5] Restarting with context...\x1b[0m');
      term.writeln('\x1b[32;1m  [5/5] Complete! Context preserved.\x1b[0m');
      term.writeln('');
      showToast('Handoff restart complete for ' + id, 'success');
    })
    .catch(function(err) {
      term.writeln('\x1b[31;1m  [✗] Handoff failed: ' + err.message + '\x1b[0m');
      term.writeln('');
      showToast('Handoff failed: ' + err.message, 'error');
    });
}

// ── Show Handoff History Dropdown ────────────────────────────
function showHandoffHistory(id, triggerBtn) {
  // Close any existing dropdown
  var existing = document.querySelector('.handoff-history__dropdown');
  if (existing) { existing.remove(); return; }

  fetch('/api/orchestrator/' + encodeURIComponent(id) + '/handoffs')
    .then(function(r) { return r.json(); })
    .then(function(files) {
      if (!files || !files.length) {
        showToast('No handoff history for ' + id, 'info');
        return;
      }

      var dropdown = document.createElement('div');
      dropdown.className = 'handoff-history__dropdown';
      var html = '<div class="handoff-history__title">Handoff History</div>';
      files.forEach(function(f) {
        var sizeKb = (f.size / 1024).toFixed(1);
        html += '<div class="handoff-history__item">' +
          '<span class="handoff-history__file">' + escHtml(f.file) + '</span>' +
          '<span class="handoff-history__meta">' + sizeKb + ' KB</span>' +
          '</div>';
      });
      dropdown.innerHTML = html;

      // Position relative to trigger
      var wrapper = triggerBtn.closest('.handoff-history');
      if (wrapper) wrapper.appendChild(dropdown);
    })
    .catch(function() {
      showToast('Failed to load handoff history', 'error');
    });
}

// Close handoff dropdown on click outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.handoff-history')) {
    var dd = document.querySelector('.handoff-history__dropdown');
    if (dd) dd.remove();
  }
});

// ── Terminal Search ───────────────────────────────────────────
function openTerminalSearch(id) {
  var inst = instances.get(id);
  if (!inst || !inst.searchBar) return;
  inst.searchBar.style.display = 'flex';
  var input = inst.searchBar.querySelector('.term-search__input');
  if (input) {
    input.focus();
    input.select();
  }
}

function closeTerminalSearch(id) {
  var inst = instances.get(id);
  if (!inst || !inst.searchBar) return;
  inst.searchBar.style.display = 'none';
  if (inst.searchAddon) inst.searchAddon.clearDecorations();
  var input = inst.searchBar.querySelector('.term-search__input');
  if (input) input.value = '';
  var count = inst.searchBar.querySelector('[data-search-count]');
  if (count) count.textContent = '';
}

// ── Maximize / Restore Panel ─────────────────────────────────
function toggleMaximize(id) {
  if (viewMode !== 'grid') {
    // In tabs mode, switch to grid first then maximize
    viewMode = 'grid';
    localStorage.setItem('term-view', viewMode);
    applyViewMode();
  }

  var inst = instances.get(id);
  if (!inst) return;

  if (maximizedId === id) {
    // Restore
    maximizedId = null;
    inst.maximized = false;
    inst.panel.classList.remove('term-panel--maximized');
    var maxBtn = inst.panel.querySelector('[data-action="maximize"]');
    if (maxBtn) maxBtn.textContent = '\u26F6';
    // Show all panels
    instances.forEach(function(i) {
      i.panel.style.display = 'flex';
    });
  } else {
    // If another was maximized, restore it first
    if (maximizedId) {
      var prev = instances.get(maximizedId);
      if (prev) {
        prev.maximized = false;
        prev.panel.classList.remove('term-panel--maximized');
        var prevBtn = prev.panel.querySelector('[data-action="maximize"]');
        if (prevBtn) prevBtn.textContent = '\u26F6';
      }
    }
    // Maximize this one
    maximizedId = id;
    inst.maximized = true;
    inst.panel.classList.add('term-panel--maximized');
    var maxBtn2 = inst.panel.querySelector('[data-action="maximize"]');
    if (maxBtn2) maxBtn2.textContent = '\u2716';
    // Hide others
    instances.forEach(function(i, iId) {
      if (iId !== id) i.panel.style.display = 'none';
    });
  }

  // Refit all visible terminals
  setTimeout(function() {
    instances.forEach(function(i) {
      if (i.panel.style.display !== 'none') {
        try { i.fitAddon.fit(); } catch (e) { /* ignore */ }
      }
    });
  }, 50);
}

// ── Project-to-Terminal Completion ───────────────────────────
function checkPendingProject() {
  var pending = sessionStorage.getItem('pending-terminal-project');
  if (!pending) return;
  sessionStorage.removeItem('pending-terminal-project');

  var nextNum = instances.size + 1;
  var defaultId = 'worker-' + nextNum;
  while (instances.has(defaultId)) {
    nextNum++;
    defaultId = 'worker-' + nextNum;
  }

  var dialog = document.getElementById('new-instance-dialog');
  var form = document.getElementById('new-instance-form');
  form.instanceId.value = defaultId;
  dialog.dataset.projectDir = pending;
  dialog.showModal();
}

// ── Window resize handler ────────────────────────────────────
var resizeTimeout;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(function() {
    instances.forEach(function(inst) {
      try { inst.fitAddon.fit(); } catch (e) { /* ignore */ }
    });
  }, 100);
});

// ── Worker Health Panel ──────────────────────────────────────

var healthGrid = document.getElementById('health-grid');
var healthBadge = document.getElementById('health-badge');
var healthEmpty = document.getElementById('health-empty');
var healthData = new Map(); // workerId → health state

function loadWorkerHealth() {
  fetch('/api/orchestrator/workers/health')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.poolActive) {
        if (healthBadge) healthBadge.textContent = '0';
        if (healthEmpty) healthEmpty.style.display = 'block';
        return;
      }
      updateHealthCards(data.workers);
    })
    .catch(function() { /* pool not active */ });
}

function updateHealthCards(workers) {
  if (!healthGrid) return;

  if (!workers || workers.length === 0) {
    if (healthBadge) healthBadge.textContent = '0';
    if (healthEmpty) healthEmpty.style.display = 'block';
    // Remove stale cards
    healthData.forEach(function(_, id) { removeHealthCard(id); });
    healthData.clear();
    return;
  }

  if (healthEmpty) healthEmpty.style.display = 'none';
  if (healthBadge) healthBadge.textContent = String(workers.length);

  var seenIds = new Set();
  workers.forEach(function(w) {
    seenIds.add(w.id);
    healthData.set(w.id, w);
    renderHealthCard(w);
  });

  // Remove cards for workers no longer present
  healthData.forEach(function(_, id) {
    if (!seenIds.has(id)) {
      removeHealthCard(id);
      healthData.delete(id);
    }
  });
}

function renderHealthCard(w) {
  var existing = healthGrid.querySelector('[data-health-id="' + w.id + '"]');
  var card = existing || document.createElement('div');
  card.className = 'term-health__card';
  card.dataset.healthId = w.id;

  var statusClass = w.status === 'running' ? 'running' :
    w.status === 'starting' ? 'starting' :
    w.status === 'stopping' ? 'stopping' : 'stopped';

  var circuitClass = w.circuitState === 'open' ? 'open' :
    w.circuitState === 'half-open' ? 'half-open' : 'closed';

  var now = Date.now();
  var heartbeatAge = w.lastHeartbeat ? Math.round((now - new Date(w.lastHeartbeat).getTime()) / 1000) : 0;
  var activityAge = w.lastActivity ? Math.round((now - new Date(w.lastActivity).getTime()) / 1000) : 0;

  card.innerHTML =
    '<div class="term-health__header">' +
      '<span class="term-health__dot term-health__dot--' + statusClass + '"></span>' +
      '<span class="term-health__id">' + escHtml(w.id) + '</span>' +
      '<span class="term-health__circuit term-health__circuit--' + circuitClass + '">' + w.circuitState + '</span>' +
    '</div>' +
    '<div class="term-health__stats">' +
      '<span title="Consecutive failures">' +
        '<span class="term-health__stat-label">Fails</span>' +
        '<span class="term-health__stat-value' + (w.consecutiveFailures > 0 ? ' term-health__stat--warn' : '') + '">' + w.consecutiveFailures + '</span>' +
      '</span>' +
      '<span title="Restart count">' +
        '<span class="term-health__stat-label">Restarts</span>' +
        '<span class="term-health__stat-value">' + w.restartCount + '</span>' +
      '</span>' +
      '<span title="Last heartbeat">' +
        '<span class="term-health__stat-label">Heartbeat</span>' +
        '<span class="term-health__stat-value">' + formatAge(heartbeatAge) + '</span>' +
      '</span>' +
      '<span title="Last activity">' +
        '<span class="term-health__stat-label">Activity</span>' +
        '<span class="term-health__stat-value">' + formatAge(activityAge) + '</span>' +
      '</span>' +
    '</div>';

  if (!existing) {
    healthGrid.appendChild(card);
  }
}

function removeHealthCard(id) {
  if (!healthGrid) return;
  var card = healthGrid.querySelector('[data-health-id="' + id + '"]');
  if (card) card.remove();
}

function formatAge(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  return Math.floor(seconds / 3600) + 'h';
}

// Refresh health every 10 seconds when panel is open
setInterval(function() {
  var details = document.getElementById('term-health');
  if (details && details.open) loadWorkerHealth();
}, 10000);

// Load health data when details panel is opened
(function() {
  var details = document.getElementById('term-health');
  if (details) {
    details.addEventListener('toggle', function() {
      if (details.open) loadWorkerHealth();
    });
  }
})();

// Update health cards from WS events
function updateHealthFromEvent(workerId, updates) {
  var w = healthData.get(workerId);
  if (!w) {
    loadWorkerHealth();
    return;
  }
  Object.assign(w, updates);
  renderHealthCard(w);
}

// ── Coordination Metrics Panel ──────────────────────────────

var metricsStateBadge = document.getElementById('metrics-state-badge');
var metricsGrid = document.getElementById('metrics-grid');
var metricsEmpty = document.getElementById('metrics-empty');

function loadCoordMetrics() {
  fetch('/api/coordination/metrics')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (metricsGrid) metricsGrid.style.display = '';
      if (metricsEmpty) metricsEmpty.style.display = 'none';
      updateMetricsCards(data);
    })
    .catch(function() {
      if (metricsGrid) metricsGrid.style.display = 'none';
      if (metricsEmpty) { metricsEmpty.style.display = 'block'; metricsEmpty.textContent = 'Coordination not active'; }
    });

  // Also fetch coordinator state for badge
  fetch('/api/coordination/status')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (metricsStateBadge) {
        metricsStateBadge.textContent = data.state || '--';
        metricsStateBadge.className = 'term-metrics__badge';
        if (data.state === 'running') metricsStateBadge.className += ' term-metrics__badge--running';
        else if (data.state === 'draining') metricsStateBadge.className += ' term-metrics__badge--draining';
        else metricsStateBadge.className += ' term-metrics__badge--stopped';
      }
    })
    .catch(function() {
      if (metricsStateBadge) {
        metricsStateBadge.textContent = '--';
        metricsStateBadge.className = 'term-metrics__badge term-metrics__badge--stopped';
      }
    });

  // Fetch adaptive rate limiter status
  fetch('/api/coordination/adaptive-rate')
    .then(function(r) { return r.json(); })
    .then(function(data) { updateAdaptiveCard(data); })
    .catch(function() { updateAdaptiveCard(null); });
}

function updateMetricsCards(data) {
  var throughputEl = document.getElementById('metric-throughput');
  var avgTimeEl = document.getElementById('metric-avg-time');
  var utilEl = document.getElementById('metric-utilization');
  var utilFill = document.getElementById('metric-util-fill');
  var completeEl = document.getElementById('metric-complete');
  var completeRecentEl = document.getElementById('metric-complete-recent');
  var failedEl = document.getElementById('metric-failed');
  var failedRecentEl = document.getElementById('metric-failed-recent');
  var pendingRunningEl = document.getElementById('metric-pending-running');
  var cancelledEl = document.getElementById('metric-cancelled');

  if (throughputEl) throughputEl.textContent = data.throughputPerMinute != null ? data.throughputPerMinute.toFixed(2) : '--';
  if (avgTimeEl) avgTimeEl.textContent = data.avgCompletionMs != null ? formatDurationMs(data.avgCompletionMs) : '--';
  if (utilEl) utilEl.textContent = data.workerUtilization != null ? Math.round(data.workerUtilization * 100) + '%' : '--';
  if (utilFill) utilFill.style.width = (data.workerUtilization != null ? Math.round(data.workerUtilization * 100) : 0) + '%';
  if (completeEl && data.outcomes) completeEl.textContent = data.outcomes.complete || 0;
  if (completeRecentEl) completeRecentEl.textContent = (data.recentCompletions || 0) + ' in 5m window';
  if (failedEl && data.outcomes) failedEl.textContent = data.outcomes.failed || 0;
  if (failedRecentEl) failedRecentEl.textContent = (data.recentFailures || 0) + ' in 5m window';
  if (pendingRunningEl && data.outcomes) pendingRunningEl.textContent = (data.outcomes.pending || 0) + ' / ' + (data.outcomes.running || 0);
  if (cancelledEl && data.outcomes) cancelledEl.textContent = (data.outcomes.cancelled || 0) + ' cancelled';
}

function formatDurationMs(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  if (ms < 3600000) return (ms / 60000).toFixed(1) + 'm';
  return (ms / 3600000).toFixed(1) + 'h';
}

function updateAdaptiveCard(data) {
  var pctEl = document.getElementById('metric-adaptive-pct');
  var stateEl = document.getElementById('metric-adaptive-state');
  var cardEl = document.getElementById('metric-adaptive-card');

  if (!data || !data.enabled) {
    if (pctEl) pctEl.textContent = '--';
    if (stateEl) { stateEl.textContent = 'disabled'; stateEl.className = 'term-metrics__adaptive-badge'; }
    return;
  }

  var pct = Math.round((data.factor || 1) * 100);
  if (pctEl) {
    pctEl.textContent = pct + '%';
    pctEl.className = 'term-metrics__value';
    if (pct <= 25) pctEl.className += ' term-metrics__value--danger';
    else if (pct < 100) pctEl.className += ' term-metrics__value--warn';
  }

  if (stateEl) {
    stateEl.textContent = data.state || 'normal';
    stateEl.className = 'term-metrics__adaptive-badge';
    if (data.state === 'backing-off') stateEl.className += ' term-metrics__adaptive-badge--backing-off';
    else if (data.state === 'recovering') stateEl.className += ' term-metrics__adaptive-badge--recovering';
  }
}

// Refresh metrics every 10 seconds when panel is open
setInterval(function() {
  var details = document.getElementById('term-metrics');
  if (details && details.open) loadCoordMetrics();
}, 10000);

// Load metrics when panel is opened
(function() {
  var details = document.getElementById('term-metrics');
  if (details) {
    details.addEventListener('toggle', function() {
      if (details.open) loadCoordMetrics();
    });
  }
})();

// ── Coordination Config Dialog ──────────────────────────────

function openCoordConfigDialog() {
  var dialog = document.getElementById('coord-config-dialog');
  if (!dialog) return;

  // Pre-fill with current values from API
  fetch('/api/coordination/rate-limit')
    .then(function(r) { return r.json(); })
    .then(function(rl) {
      var rpmInput = document.getElementById('coord-max-rpm');
      var tpmInput = document.getElementById('coord-max-tpm');
      if (rpmInput && rl.maxRequestsPerMinute) rpmInput.value = rl.maxRequestsPerMinute;
      if (tpmInput && rl.maxTokensPerMinute) tpmInput.value = rl.maxTokensPerMinute;
    })
    .catch(function() {});

  fetch('/api/coordination/costs')
    .then(function(r) { return r.json(); })
    .then(function(costs) {
      var globalInput = document.getElementById('coord-global-budget');
      var workerInput = document.getElementById('coord-worker-budget');
      if (globalInput && costs.globalBudgetUsd != null) globalInput.value = costs.globalBudgetUsd;
      if (workerInput && costs.perWorkerBudgetUsd != null) workerInput.value = costs.perWorkerBudgetUsd;
    })
    .catch(function() {});

  dialog.showModal();
}

function submitCoordConfig(e) {
  e.preventDefault();
  var form = e.target;
  var body = {};

  var rpm = parseInt(form.maxRequestsPerMinute.value);
  var tpm = parseInt(form.maxTokensPerMinute.value);
  var globalBudget = parseFloat(form.globalBudgetUsd.value);
  var workerBudget = parseFloat(form.perWorkerBudgetUsd.value);

  if (rpm > 0) body.maxRequestsPerMinute = rpm;
  if (tpm > 0) body.maxTokensPerMinute = tpm;
  if (globalBudget > 0) body.globalBudgetUsd = globalBudget;
  if (workerBudget > 0) body.perWorkerBudgetUsd = workerBudget;

  fetch('/api/coordination/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Config update failed'); });
      return r.json();
    })
    .then(function() {
      showToast('Coordination config updated', 'success');
      document.getElementById('coord-config-dialog').close();
      // Refresh metrics to reflect new settings
      var details = document.getElementById('term-metrics');
      if (details && details.open) loadCoordMetrics();
    })
    .catch(function(err) {
      showToast('Config update failed: ' + err.message, 'error');
    });

  return false;
}

// ── Config Dialog ────────────────────────────────────────────

function openConfigDialog(id) {
  var inst = instances.get(id);
  if (!inst) return;

  var dialog = document.getElementById('config-dialog');
  var idLabel = document.getElementById('config-dialog-id');
  var idInput = document.getElementById('config-instance-id');
  var modelSel = document.getElementById('config-model');
  var budgetInput = document.getElementById('config-budget');
  var turnsInput = document.getElementById('config-turns');

  if (idLabel) idLabel.textContent = id;
  if (idInput) idInput.value = id;
  if (modelSel) modelSel.value = inst.model || 'sonnet';
  if (budgetInput) budgetInput.value = inst.maxBudgetUsd || 5;
  if (turnsInput) turnsInput.value = inst.maxTurns || 30;

  dialog.showModal();
}

function submitConfig(e) {
  e.preventDefault();
  var form = e.target;
  var id = form.instanceId.value;
  var model = form.model.value;
  var maxBudgetUsd = parseFloat(form.maxBudgetUsd.value) || 5;
  var maxTurns = parseInt(form.maxTurns.value) || 30;

  fetch('/api/orchestrator/' + encodeURIComponent(id) + '/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model, maxBudgetUsd: maxBudgetUsd, maxTurns: maxTurns }),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Config update failed'); });
      return r.json();
    })
    .then(function(data) {
      var inst = instances.get(id);
      if (inst) {
        inst.model = data.config.model;
        inst.maxBudgetUsd = data.config.maxBudgetUsd;
        inst.maxTurns = data.config.maxTurns;
        updateStatusBar(id);
        inst.terminal.writeln('\x1b[36m[CONFIG] Updated: model=' + data.config.model + ', budget=$' + data.config.maxBudgetUsd + ', turns=' + data.config.maxTurns + '\x1b[0m');
      }
      showToast('Configuration updated for ' + id, 'success');
      document.getElementById('config-dialog').close();
    })
    .catch(function(err) {
      showToast('Config update failed: ' + err.message, 'error');
    });

  return false;
}

// ── Expose to window for onclick handlers ────────────────────
window.toggleTerminalView = toggleTerminalView;
window.addInstance = addInstance;
window.removeInstance = removeInstance;
window.startInstance = startInstance;
window.stopInstance = stopInstance;
window.submitNewInstance = submitNewInstance;
window.handoffInstance = handoffInstance;
window.showHandoffHistory = showHandoffHistory;
window.toggleMaximize = toggleMaximize;
window.openTerminalSearch = openTerminalSearch;
window.closeTerminalSearch = closeTerminalSearch;
window.toggleShortcutsHelp = toggleShortcutsHelp;
window.openConfigDialog = openConfigDialog;
window.submitConfig = submitConfig;
window.openCoordConfigDialog = openCoordConfigDialog;
window.submitCoordConfig = submitCoordConfig;

function toggleShortcutsHelp() {
  var dialog = document.getElementById('shortcuts-dialog');
  if (!dialog) return;
  if (dialog.open) { dialog.close(); } else { dialog.showModal(); }
}
