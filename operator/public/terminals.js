// ============================================================
// Terminals Page — Multi-Instance xterm.js Terminal UI
// ============================================================
// Manages tabbed/grid terminal views for multiple orchestrator
// instances. Each instance gets its own xterm.js Terminal with
// a unique color theme, status bar, and WS event routing.
// ============================================================

/* global Terminal, FitAddon, SearchAddon, createWS, showToast */

// ── Dynamic xterm.js Loader ─────────────────────────────────
// When navigating via HTMX boost, <head> scripts may not reload.
// Ensure xterm.js and addons are available before init.
var _xtermReady = (typeof Terminal !== 'undefined');
function ensureXtermLoaded(callback) {
  if (typeof Terminal !== 'undefined') { callback(); return; }
  // Load CSS if missing
  if (!document.querySelector('link[href*="xterm"]')) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css';
    document.head.appendChild(link);
  }
  // Load scripts sequentially (each depends on prior)
  var scripts = [
    'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js',
    'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js',
    'https://cdn.jsdelivr.net/npm/@xterm/addon-search@0.15.0/lib/addon-search.min.js',
  ];
  var idx = 0;
  function loadNext() {
    if (idx >= scripts.length) { _xtermReady = true; callback(); return; }
    // Skip if already loaded
    if (document.querySelector('script[src="' + scripts[idx] + '"]')) { idx++; loadNext(); return; }
    var s = document.createElement('script');
    s.src = scripts[idx];
    s.onload = function() { idx++; loadNext(); };
    s.onerror = function() { idx++; loadNext(); }; // best-effort
    document.head.appendChild(s);
  }
  loadNext();
}

// ── Color Themes — Space Palette ─────────────────────────────
var THEMES = [
  {
    id: 1, name: 'Nebula', accent: '#6366f1', bg: '#08082a', glow: 'rgba(99,102,241,0.30)',
    xterm: {
      background: '#08082a', foreground: '#e2e4f0', cursor: '#6366f1',
      cursorAccent: '#08082a', selectionBackground: 'rgba(99,102,241,0.3)',
      black: '#12123a', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e4f0',
      brightBlack: '#505278', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  {
    id: 2, name: 'Aurora', accent: '#10b981', bg: '#061a14', glow: 'rgba(16,185,129,0.30)',
    xterm: {
      background: '#061a14', foreground: '#e2e4f0', cursor: '#10b981',
      cursorAccent: '#061a14', selectionBackground: 'rgba(16,185,129,0.25)',
      black: '#0c2a1e', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e4f0',
      brightBlack: '#3a6852', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  {
    id: 3, name: 'Solar', accent: '#f59e0b', bg: '#1a1606', glow: 'rgba(245,158,11,0.30)',
    xterm: {
      background: '#1a1606', foreground: '#e2e4f0', cursor: '#f59e0b',
      cursorAccent: '#1a1606', selectionBackground: 'rgba(245,158,11,0.25)',
      black: '#2a2410', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e4f0',
      brightBlack: '#68583a', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  {
    id: 4, name: 'Mars', accent: '#ef4444', bg: '#1a0606', glow: 'rgba(239,68,68,0.30)',
    xterm: {
      background: '#1a0606', foreground: '#e2e4f0', cursor: '#ef4444',
      cursorAccent: '#1a0606', selectionBackground: 'rgba(239,68,68,0.25)',
      black: '#2a1010', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e4f0',
      brightBlack: '#683838', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  {
    id: 5, name: 'Pulsar', accent: '#a78bfa', bg: '#0e0828', glow: 'rgba(167,139,250,0.30)',
    xterm: {
      background: '#0e0828', foreground: '#e2e4f0', cursor: '#a78bfa',
      cursorAccent: '#0e0828', selectionBackground: 'rgba(167,139,250,0.25)',
      black: '#1a1240', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e4f0',
      brightBlack: '#5c5078', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  {
    id: 6, name: 'Quasar', accent: '#22d3ee', bg: '#061420', glow: 'rgba(34,211,238,0.30)',
    xterm: {
      background: '#061420', foreground: '#e2e4f0', cursor: '#22d3ee',
      cursorAccent: '#061420', selectionBackground: 'rgba(34,211,238,0.25)',
      black: '#0c2238', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e4f0',
      brightBlack: '#386068', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  {
    id: 7, name: 'Comet', accent: '#ec4899', bg: '#1a0618', glow: 'rgba(236,72,153,0.30)',
    xterm: {
      background: '#1a0618', foreground: '#e2e4f0', cursor: '#ec4899',
      cursorAccent: '#1a0618', selectionBackground: 'rgba(236,72,153,0.25)',
      black: '#2a0c28', red: '#ef4444', green: '#10b981', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#ec4899', cyan: '#22d3ee', white: '#e2e4f0',
      brightBlack: '#683858', brightRed: '#f87171', brightGreen: '#34d399',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#f9a8d4',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
  {
    id: 8, name: 'Stellar', accent: '#84cc16', bg: '#0c1a06', glow: 'rgba(132,204,22,0.30)',
    xterm: {
      background: '#0c1a06', foreground: '#e2e4f0', cursor: '#84cc16',
      cursorAccent: '#0c1a06', selectionBackground: 'rgba(132,204,22,0.25)',
      black: '#142a0c', red: '#ef4444', green: '#84cc16', yellow: '#f59e0b',
      blue: '#6366f1', magenta: '#a78bfa', cyan: '#22d3ee', white: '#e2e4f0',
      brightBlack: '#3a6830', brightRed: '#f87171', brightGreen: '#a3e635',
      brightYellow: '#fbbf24', brightBlue: '#818cf8', brightMagenta: '#c4b5fd',
      brightCyan: '#67e8f9', brightWhite: '#ffffff',
    }
  },
];

// ── State ────────────────────────────────────────────────────
// id → { id, theme, terminal, fitAddon, panel, tab, running, round, agents, cost, mission, model, coord }
// coord: { tasks: {total,pending,assigned,running,complete,failed,cancelled}, rateLimitOk, costUsd, budgetUsd, worktree, budgetWarning }
var instances = new Map();
var activeTabId = null;
var viewMode = localStorage.getItem('term-view') || 'tabs'; // 'tabs' | 'grid'
var gridLayout = localStorage.getItem('term-layout') || 'quad'; // 'single' | 'split-h' | 'split-v' | 'triple' | 'quad'
var themeIndex = 0;

// ── DOM refs ─────────────────────────────────────────────────
var tabBar = document.getElementById('term-tabs');
var panels = document.getElementById('term-panels');
var emptyState = document.getElementById('term-empty');
var viewToggle = document.getElementById('view-toggle-icon');

// ── State: maximized panel ───────────────────────────────────
var maximizedId = null; // id of maximized panel in grid mode, or null
var wsHandle = null;    // WebSocket connection handle for cleanup

// ── State: file sidebar ─────────────────────────────────────
var sidebarOpen = localStorage.getItem('term-sidebar-open') === '1';
var sidebarRoot = ''; // current project root shown in sidebar
var sidebarFilterTimer = null;

// ── Initialization ───────────────────────────────────────────
(function init() {
  applyViewMode();
  initSidebar();
  loadMissions();
  // Ensure xterm.js is loaded before creating terminal instances
  ensureXtermLoaded(function() {
    loadInstances();
    loadClaudeTerminals();
  });
  // Close previous WS connection (HTMX boost re-runs scripts without full page unload)
  if (wsHandle) { wsHandle.close(); wsHandle = null; }
  connectWS();
  // Register cleanup for HTMX navigation away
  if (typeof onPageCleanup === 'function') {
    onPageCleanup(function() {
      if (wsHandle) { wsHandle.close(); wsHandle = null; }
      // Close all Claude terminal binary WS connections
      instances.forEach(function(inst) {
        if (inst.type === 'claude' && inst.binaryWs) {
          try { inst.binaryWs.close(); } catch(e) { /* noop */ }
        }
      });
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
      var claudeDialog = document.getElementById('new-claude-dialog');
      if (claudeDialog && claudeDialog.open) { claudeDialog.close(); e.preventDefault(); return; }
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

    // Ctrl+Shift+C: new Claude terminal
    if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      addClaudeTerminal();
      return;
    }

    // Ctrl+B: toggle file sidebar
    if (e.ctrlKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Ctrl+M: shared memory panel
    if (e.ctrlKey && !e.shiftKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      toggleMemoryPanel();
      return;
    }

    // Ctrl+Shift+I: terminal messages panel
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
      e.preventDefault();
      toggleMessagePanel();
      return;
    }

    // Ctrl+Shift+A: toggle auto-handoff on active Claude terminal
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      if (activeTabId) toggleAutoHandoff(activeTabId);
      return;
    }

    // Ctrl+Shift+D: toggle auto-dispatch on active Claude terminal
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      if (activeTabId) toggleAutoDispatch(activeTabId);
      return;
    }

    // 1-5: quick layout switch (no modifiers, not in form fields)
    if (!e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey) {
      var layouts = { '1': 'single', '2': 'split-h', '3': 'split-v', '4': 'triple', '5': 'quad' };
      if (layouts[e.key]) {
        e.preventDefault();
        setLayout(layouts[e.key]);
        return;
      }
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
          emptyState.innerHTML = '<p>No terminals running.</p><p>Click <strong>+ Claude</strong> to start an interactive Claude session, or <strong>+ Orchestrator</strong> for a managed worker instance.</p>';
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
        emptyState.innerHTML = '<p>No terminals running.</p><p>Click <strong>+ Claude</strong> to start an interactive Claude session, or <strong>+ Orchestrator</strong> for a managed worker instance.</p>';
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

// ── Load existing Claude terminals from API ──────────────────
function loadClaudeTerminals() {
  fetch('/api/claude-terminals')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || !data.terminals || !data.terminals.length) return;
      data.terminals.forEach(function(t) {
        addClaudeTerminalInstance(t.id, t);
      });
      // If sidebar is open and we haven't loaded a tree yet, try the active tab
      if (sidebarOpen && !sidebarRoot && activeTabId) {
        var inst = instances.get(activeTabId);
        if (inst && inst.type === 'claude') {
          fetchSidebarRootForTerminal(activeTabId);
        }
      }
    })
    .catch(function() { /* Claude terminals not available */ });
}

// ── Add a Claude terminal instance (interactive PTY) ─────────
function addClaudeTerminalInstance(id, state) {
  if (instances.has(id)) {
    // Update existing
    var existing = instances.get(id);
    if (state) {
      existing.running = state.status === 'running';
      existing.model = state.model;
      existing.dangerouslySkipPermissions = state.dangerouslySkipPermissions;
      if (typeof state.autoHandoff !== 'undefined') existing.autoHandoff = !!state.autoHandoff;
      if (typeof state.autoDispatch !== 'undefined') existing.autoDispatch = !!state.autoDispatch;
      if (typeof state.handoffCount !== 'undefined') existing.handoffCount = state.handoffCount;
    }
    updateStatusBar(id);
    updateTabDot(id);
    return;
  }

  var theme = THEMES[themeIndex % THEMES.length];
  themeIndex++;

  // Create xterm.js Terminal — interactive (disableStdin: false)
  var term = new Terminal({
    theme: theme.xterm,
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    fontSize: 13,
    lineHeight: 1.3,
    cursorBlink: true,
    scrollback: 10000,
    convertEol: true,
    disableStdin: false,
  });

  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  var searchAddon = null;
  if (typeof SearchAddon !== 'undefined' && SearchAddon.SearchAddon) {
    searchAddon = new SearchAddon.SearchAddon();
    term.loadAddon(searchAddon);
  }

  // Create tab (with Claude badge)
  var tab = document.createElement('button');
  tab.className = 'term-tab';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  tab.style.setProperty('--tab-accent', theme.accent);
  tab.style.setProperty('--tab-glow', theme.glow);
  tab.dataset.instanceId = id;
  var isRunning = state && state.status === 'running';
  tab.innerHTML =
    '<span class="term-tab__dot' + (isRunning ? ' term-tab__dot--running' : ' term-tab__dot--stopped') + '"></span>' +
    '<span class="term-tab__label">' + escHtml(id) + '</span>' +
    '<button class="term-tab__close" onclick="event.stopPropagation(); removeClaudeInstance(\'' + escHtml(id) + '\')" title="Remove" aria-label="Remove ' + escHtml(id) + '">&times;</button>';
  tab.addEventListener('click', function() { switchTab(id); });
  tabBar.appendChild(tab);

  // Create panel
  var panel = document.createElement('div');
  panel.className = 'term-panel';
  panel.dataset.instanceId = id;
  panel.style.setProperty('--panel-accent', theme.accent);
  panel.style.setProperty('--panel-bg', theme.bg);
  panel.style.setProperty('--panel-glow', theme.glow);

  // Status bar (Claude-specific: permission toggle, auto-handoff, kill, maximize)
  var permLabel = state && state.dangerouslySkipPermissions ? '\u26A0 No Perms' : '\u2705 Safe';
  var isAutoHandoff = state && state.autoHandoff;
  var isAutoDispatch = state && state.autoDispatch;
  var handoffCount = (state && state.handoffCount) || 0;
  var statusBar = document.createElement('div');
  statusBar.className = 'term-status';
  statusBar.innerHTML =
    '<span class="term-status__dot ' + (isRunning ? 'term-status__dot--running' : 'term-status__dot--stopped') + '"></span>' +
    '<span class="term-status__id">\u2728 ' + escHtml(id) + '</span>' +
    '<span data-field="model">' + (state && state.model ? escHtml(state.model) : '') + '</span>' +
    '<span data-field="permissions" class="' + (state && state.dangerouslySkipPermissions ? 'term-status__perm--danger' : 'term-status__perm--safe') + '">' + permLabel + '</span>' +
    '<span data-field="handoff-badge" class="term-status__handoff-badge' + (isAutoHandoff ? ' term-status__handoff-badge--active' : '') + '" title="Auto-handoff ' + (isAutoHandoff ? 'ON' : 'OFF') + (handoffCount > 0 ? ' (' + handoffCount + ' handoffs)' : '') + '">' +
      (isAutoHandoff ? '\u21BB' : '\u21BB') +
      (handoffCount > 0 ? ' ' + handoffCount : '') +
    '</span>' +
    '<span class="term-status__spacer"></span>' +
    '<span class="term-status__actions">' +
      '<button class="term-status__btn' + (isAutoHandoff ? ' term-status__btn--active' : '') + '" onclick="toggleAutoHandoff(\'' + escHtml(id) + '\')" data-action="toggle-handoff" title="Toggle auto-handoff (Ctrl+Shift+A)">\u21BB</button>' +
      '<button class="term-status__btn' + (isAutoDispatch ? ' term-status__btn--active' : '') + '" onclick="toggleAutoDispatch(\'' + escHtml(id) + '\')" data-action="toggle-dispatch" title="Toggle auto-dispatch (Ctrl+Shift+D)">\u26A1</button>' +
      '<button class="term-status__btn" onclick="toggleClaudePermissions(\'' + escHtml(id) + '\')" data-action="toggle-perms" title="Toggle permission mode">\u{1F512}</button>' +
      '<button class="term-status__btn" onclick="claimTask(\'' + escHtml(id) + '\')" data-action="claim-task" title="Claim next task">&#9776;</button>' +
      '<button class="term-status__btn term-status__btn--danger" onclick="killClaudeInstance(\'' + escHtml(id) + '\')" data-action="kill">Kill</button>' +
      '<button class="term-status__btn" onclick="toggleMaximize(\'' + escHtml(id) + '\')" data-action="maximize" title="Maximize/Restore">\u26F6</button>' +
    '</span>';
  panel.appendChild(statusBar);

  // Task indicator bar (Phase 19, hidden by default)
  var taskIndicator = document.createElement('div');
  taskIndicator.className = 'term-task-indicator';
  taskIndicator.style.display = 'none';
  panel.appendChild(taskIndicator);

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
      if (sAddon && input.value) sAddon.findNext(input.value);
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
  term.open(xtermContainer);

  setTimeout(function() {
    try { fitAddon.fit(); } catch (e) { /* ignore */ }
  }, 50);

  // Write welcome message
  term.writeln('\x1b[1;' + ansiColorCode(theme.accent) + 'm' + '\u2728 Claude Terminal: ' + id + '\x1b[0m');
  term.writeln('\x1b[90mInteractive Claude Code session.' + (isRunning ? ' Connected.' : ' Waiting for connection.') + '\x1b[0m');
  term.writeln('');

  // Store instance
  var inst = {
    id: id,
    type: 'claude',
    theme: theme,
    terminal: term,
    fitAddon: fitAddon,
    searchAddon: searchAddon,
    searchBar: searchBar,
    panel: panel,
    tab: tab,
    running: isRunning,
    round: 0,
    agents: [],
    cost: 0,
    mission: null,
    model: state ? state.model : null,
    maximized: false,
    dangerouslySkipPermissions: state ? !!state.dangerouslySkipPermissions : false,
    autoHandoff: state ? !!state.autoHandoff : false,
    autoDispatch: state ? !!state.autoDispatch : false,
    handoffCount: state ? (state.handoffCount || 0) : 0,
    binaryWs: null,
    coord: {
      tasks: { total: 0, pending: 0, assigned: 0, running: 0, complete: 0, failed: 0, cancelled: 0 },
      rateLimitOk: true, costUsd: 0, budgetUsd: 0, worktree: null,
      budgetWarning: false, budgetExceeded: false, active: false,
    },
  };
  instances.set(id, inst);

  // Connect binary WS for PTY I/O
  if (isRunning) {
    connectClaudeBinaryWs(inst);
  }

  // Load assigned task state (Phase 19)
  loadTerminalTask(id);

  updateEmptyState();
  applyViewMode();

  if (!activeTabId) {
    switchTab(id);
  }
}

// ── Binary WebSocket for Claude terminal PTY I/O ─────────────
function connectClaudeBinaryWs(inst) {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = proto + '//' + location.host + '/ws/claude-terminal/' + encodeURIComponent(inst.id);
  var ws = new WebSocket(url);

  ws.onopen = function() {
    inst.terminal.writeln('\x1b[32m--- Connected ---\x1b[0m');

    // Send resize on connect
    var dims = inst.fitAddon.proposeDimensions();
    if (dims) {
      ws.send('\x01' + JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    }
  };

  ws.onmessage = function(evt) {
    // Raw PTY output → write to xterm
    inst.terminal.write(evt.data);
  };

  ws.onclose = function() {
    inst.terminal.writeln('\r\n\x1b[31m--- Disconnected ---\x1b[0m');
    inst.binaryWs = null;
  };

  ws.onerror = function() {
    inst.terminal.writeln('\r\n\x1b[31m--- WebSocket Error ---\x1b[0m');
  };

  inst.binaryWs = ws;

  // User input → WS → PTY
  inst.terminal.onData(function(data) {
    if (ws.readyState === 1) { // OPEN
      ws.send(data);
    }
  });

  // Resize → WS control message
  inst.terminal.onResize(function(size) {
    if (ws.readyState === 1) {
      ws.send('\x01' + JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
    }
  });
}

// ── New terminal chooser ─────────────────────────────────────
function openNewTerminal() {
  var dialog = document.getElementById('new-terminal-chooser');
  if (dialog) dialog.showModal();
}

// ── Add Claude terminal button handler ───────────────────────
function addClaudeTerminal() {
  var dialog = document.getElementById('new-claude-dialog');
  var nextNum = 1;
  var defaultId = 'claude-' + nextNum;
  while (instances.has(defaultId)) {
    nextNum++;
    defaultId = 'claude-' + nextNum;
  }
  var form = document.getElementById('new-claude-form');
  form.terminalId.value = defaultId;
  dialog.showModal();
}

// ── Submit new Claude terminal from dialog ───────────────────
function submitNewClaude(e) {
  e.preventDefault();
  var form = e.target;
  var dialog = document.getElementById('new-claude-dialog');
  var id = form.terminalId.value.trim();
  var model = form.model.value;
  var skipPerms = form.dangerouslySkipPermissions.checked;
  var autoHandoff = form.autoHandoff.checked;
  var autoDispatch = form.autoDispatch.checked;

  if (!id) {
    showToast('Terminal ID is required', 'error');
    return false;
  }

  if (instances.has(id)) {
    showToast('Terminal "' + id + '" already exists', 'error');
    return false;
  }

  // Spawn via API
  fetch('/api/claude-terminals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: id,
      model: model || undefined,
      dangerouslySkipPermissions: skipPerms,
      autoHandoff: autoHandoff,
      autoDispatch: autoDispatch,
    }),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Spawn failed'); });
      return r.json();
    })
    .then(function(data) {
      // Create the interactive terminal instance
      addClaudeTerminalInstance(id, {
        status: 'running',
        model: model,
        dangerouslySkipPermissions: skipPerms,
        autoHandoff: autoHandoff,
        autoDispatch: autoDispatch,
      });
      switchTab(id);
      showToast('Claude terminal ' + id + ' started', 'success');
    })
    .catch(function(err) {
      showToast('Failed to start Claude terminal: ' + err.message, 'error');
    });

  dialog.close();
  form.reset();
  return false;
}

// ── Kill Claude terminal ─────────────────────────────────────
function killClaudeInstance(id) {
  var inst = instances.get(id);
  if (!inst || inst.type !== 'claude') return;

  // Close binary WS
  if (inst.binaryWs) {
    try { inst.binaryWs.close(); } catch(e) { /* noop */ }
    inst.binaryWs = null;
  }

  // Kill via API
  fetch('/api/claude-terminals/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function(r) {
      if (!r.ok && r.status !== 404) throw new Error('Kill failed');
      inst.running = false;
      inst.terminal.writeln('\r\n\x1b[31m--- Killed ---\x1b[0m');
      updateStatusBar(id);
      updateTabDot(id);
      showToast(id + ' killed', 'success');
    })
    .catch(function(err) {
      showToast('Failed to kill ' + id + ': ' + err.message, 'error');
    });
}

// ── Remove Claude terminal (from DOM + pool) ─────────────────
function removeClaudeInstance(id) {
  var inst = instances.get(id);
  if (!inst || inst.type !== 'claude') {
    // Fall back to orchestrator remove
    removeInstance(id);
    return;
  }

  if (inst.running) {
    showToast('Kill the terminal before removing it', 'error');
    return;
  }

  // Close binary WS if still open
  if (inst.binaryWs) {
    try { inst.binaryWs.close(); } catch(e) { /* noop */ }
  }

  // DELETE from API
  fetch('/api/claude-terminals/' + encodeURIComponent(id), { method: 'DELETE' })
    .catch(function() { /* ignore */ });

  // Clean up DOM
  inst.terminal.dispose();
  inst.tab.remove();
  inst.panel.remove();
  instances.delete(id);

  if (activeTabId === id) {
    activeTabId = null;
    var remaining = Array.from(instances.keys());
    if (remaining.length > 0) switchTab(remaining[0]);
  }
  updateEmptyState();
}

// ── Toggle Claude terminal permissions ───────────────────────
function toggleClaudePermissions(id) {
  var inst = instances.get(id);
  if (!inst || inst.type !== 'claude') return;

  var newSkip = !inst.dangerouslySkipPermissions;
  var label = newSkip ? 'skip permissions (dangerous)' : 'safe mode';

  inst.terminal.writeln('\r\n\x1b[33m[PERMISSIONS] Restarting with ' + label + '...\x1b[0m');

  // Close existing binary WS
  if (inst.binaryWs) {
    try { inst.binaryWs.close(); } catch(e) { /* noop */ }
    inst.binaryWs = null;
  }

  // Toggle via API (respawns with new config)
  fetch('/api/claude-terminals/' + encodeURIComponent(id) + '/toggle-permissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Toggle failed'); });
      return r.json();
    })
    .then(function(data) {
      inst.dangerouslySkipPermissions = data.dangerouslySkipPermissions;
      inst.running = true;
      updateStatusBar(id);
      updateTabDot(id);
      // Reconnect binary WS
      connectClaudeBinaryWs(inst);
      showToast(id + ' restarted with ' + label, 'success');
    })
    .catch(function(err) {
      showToast('Failed to toggle permissions: ' + err.message, 'error');
    });
}

// ── Toggle Claude terminal auto-handoff ─────────────────────
function toggleAutoHandoff(id) {
  var inst = instances.get(id);
  if (!inst || inst.type !== 'claude') return;

  fetch('/api/claude-terminals/' + encodeURIComponent(id) + '/toggle-auto-handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Toggle failed'); });
      return r.json();
    })
    .then(function(data) {
      inst.autoHandoff = data.autoHandoff;
      updateStatusBar(id);
      var label = data.autoHandoff ? 'enabled' : 'disabled';
      inst.terminal.writeln('\r\n\x1b[33m[AUTO-HANDOFF] ' + label + '\x1b[0m');
      showToast(id + ' auto-handoff ' + label, 'success');
    })
    .catch(function(err) {
      showToast('Failed to toggle auto-handoff: ' + err.message, 'error');
    });
}

// ── Toggle auto-dispatch on a Claude terminal ─────────────────
function toggleAutoDispatch(id) {
  var inst = instances.get(id);
  if (!inst || inst.type !== 'claude') return;

  fetch('/api/claude-terminals/' + encodeURIComponent(id) + '/toggle-auto-dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Toggle failed'); });
      return r.json();
    })
    .then(function(data) {
      inst.autoDispatch = data.autoDispatch;
      updateStatusBar(id);
      var label = data.autoDispatch ? 'enabled' : 'disabled';
      inst.terminal.writeln('\r\n\x1b[33m[AUTO-DISPATCH] ' + label + '\x1b[0m');
      showToast(id + ' auto-dispatch ' + label, 'success');
    })
    .catch(function(err) {
      showToast('Failed to toggle auto-dispatch: ' + err.message, 'error');
    });
}

// ── Add a terminal instance (orchestrator) ───────────────────
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
  tab.style.setProperty('--tab-glow', theme.glow);
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
  panel.style.setProperty('--panel-glow', theme.glow);

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
    type: 'orchestrator',
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

  // Update sidebar if open and switching to a Claude terminal
  if (sidebarOpen && active && active.type === 'claude') {
    fetchSidebarRootForTerminal(id);
  }
}

// ── Remove instance ──────────────────────────────────────────
function removeInstance(id) {
  var inst = instances.get(id);
  if (!inst) return;

  // Claude terminals have their own removal flow
  if (inst.type === 'claude') {
    removeClaudeInstance(id);
    return;
  }

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
  // Layout selector is only visible in grid mode (CSS handles showing/hiding)
  applyViewMode();
}

function applyViewMode() {
  var isGrid = viewMode === 'grid';
  panels.classList.toggle('term-panels--grid', isGrid);
  panels.classList.toggle('term-panels--tabs', !isGrid);
  viewToggle.textContent = isGrid ? '\u25A3' : '\u25A6\u25A6';

  // Apply grid layout attribute
  if (isGrid) {
    panels.setAttribute('data-layout', gridLayout);
  } else {
    panels.removeAttribute('data-layout');
  }

  // Update layout selector active state
  var layoutBtns = document.querySelectorAll('.layout-selector__btn');
  for (var i = 0; i < layoutBtns.length; i++) {
    layoutBtns[i].classList.toggle('layout-selector__btn--active', layoutBtns[i].getAttribute('data-layout') === gridLayout);
  }

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

function setLayout(layout) {
  gridLayout = layout;
  localStorage.setItem('term-layout', layout);
  // Auto-switch to grid mode if not already
  if (viewMode !== 'grid') {
    viewMode = 'grid';
    localStorage.setItem('term-view', viewMode);
  }
  applyViewMode();
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
    'claude-terminal:*',
    'shared-memory:*',
    'terminal-message:*',
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

      // ── Claude Terminal Events ─────────────────────────────

      case 'claude-terminal:spawned': {
        var cId = msg.data.terminalId;
        if (cId && !instances.has(cId)) {
          addClaudeTerminalInstance(cId, {
            status: 'running',
            model: msg.data.config ? msg.data.config.model : null,
            dangerouslySkipPermissions: msg.data.config ? msg.data.config.dangerouslySkipPermissions : false,
          });
        }
        break;
      }

      case 'claude-terminal:exit': {
        var cId2 = msg.data.terminalId;
        var cInst = instances.get(cId2);
        if (cInst && cInst.type === 'claude') {
          cInst.running = false;
          updateStatusBar(cId2);
          updateTabDot(cId2);
        }
        break;
      }

      case 'claude-terminal:error': {
        var cId3 = msg.data.terminalId;
        var cInst3 = instances.get(cId3);
        if (cInst3 && cInst3.type === 'claude') {
          cInst3.terminal.writeln('\r\n\x1b[31m[ERROR] ' + (msg.data.error || 'Unknown error') + '\x1b[0m');
        }
        break;
      }

      case 'claude-terminal:removed': {
        var cId4 = msg.data.terminalId;
        // If still in instances, mark as removed
        var cInst4 = instances.get(cId4);
        if (cInst4 && cInst4.type === 'claude') {
          cInst4.running = false;
          updateStatusBar(cId4);
          updateTabDot(cId4);
        }
        break;
      }

      case 'claude-terminal:permission-changed': {
        var cId5 = msg.data.terminalId;
        var cInst5 = instances.get(cId5);
        if (cInst5 && cInst5.type === 'claude') {
          cInst5.dangerouslySkipPermissions = !!msg.data.dangerouslySkipPermissions;
          updateStatusBar(cId5);
        }
        break;
      }

      case 'claude-terminal:handoff': {
        var hId = msg.data.terminalId;
        var hInst = instances.get(hId);
        if (hInst && hInst.type === 'claude') {
          hInst.handoffCount = msg.data.handoffCount || 0;
          hInst.running = true;
          hInst.terminal.writeln('\r\n\x1b[1;36m[AUTO-HANDOFF] Session #' + hInst.handoffCount + ' — continuing with -c\x1b[0m');
          updateStatusBar(hId);
          updateTabDot(hId);
          // Reconnect binary WS for new PTY process
          if (hInst.binaryWs) {
            try { hInst.binaryWs.close(); } catch(e) { /* noop */ }
            hInst.binaryWs = null;
          }
          connectClaudeBinaryWs(hInst);
          showToast(hId + ' auto-handoff #' + hInst.handoffCount, 'success');
        }
        break;
      }

      case 'claude-terminal:context-warning': {
        var cwId = msg.data.terminalId;
        var cwInst = instances.get(cwId);
        if (cwInst && cwInst.type === 'claude') {
          cwInst.terminal.writeln('\r\n\x1b[1;33m[CONTEXT] Approaching context limit — ' + (cwInst.autoHandoff ? 'auto-handoff will continue session' : 'consider saving work') + '\x1b[0m');
          showToast(cwId + ': context pressure detected', 'warning');
        }
        break;
      }

      case 'claude-terminal:auto-handoff-changed': {
        var ahId = msg.data.terminalId;
        var ahInst = instances.get(ahId);
        if (ahInst && ahInst.type === 'claude') {
          ahInst.autoHandoff = !!msg.data.autoHandoff;
          updateStatusBar(ahId);
        }
        break;
      }

      case 'claude-terminal:auto-dispatch-changed': {
        var adId = msg.data.terminalId;
        var adInst = instances.get(adId);
        if (adInst && adInst.type === 'claude') {
          adInst.autoDispatch = !!msg.data.autoDispatch;
          updateStatusBar(adId);
        }
        break;
      }

      case 'claude-terminal:auto-dispatch': {
        var dispId = msg.data.terminalId;
        showToast(dispId + ' auto-dispatched task ' + msg.data.taskId, 'success');
        break;
      }

      // Auto-refresh shared memory panel when open
      case 'shared-memory:updated':
      case 'shared-memory:deleted':
      case 'shared-memory:cleared':
      case 'shared-memory:snapshot-written': {
        var memDialog = document.getElementById('memory-dialog');
        if (memDialog && memDialog.open) {
          refreshMemoryPanel();
        }
        break;
      }

      // Terminal task bridge (Phase 19)
      case 'claude-terminal:task-assigned': {
        var taskInst = instances.get(msg.data.terminalId);
        if (taskInst) {
          taskInst.assignedTask = { taskId: msg.data.taskId, task: msg.data.task, category: msg.data.category };
          updateTaskIndicator(msg.data.terminalId);
          showToast(msg.data.terminalId + ' claimed task: ' + (msg.data.task || '').slice(0, 60), 'success');
        }
        break;
      }
      case 'claude-terminal:task-released': {
        var relInst = instances.get(msg.data.terminalId);
        if (relInst) {
          relInst.assignedTask = null;
          updateTaskIndicator(msg.data.terminalId);
        }
        break;
      }
      case 'claude-terminal:task-completed': {
        var compInst = instances.get(msg.data.terminalId);
        if (compInst) {
          compInst.assignedTask = null;
          updateTaskIndicator(msg.data.terminalId);
          showToast(msg.data.terminalId + ' ' + msg.data.status + ' task ' + msg.data.taskId, msg.data.status === 'complete' ? 'success' : 'error');
        }
        break;
      }

      // Terminal messages (Phase 18)
      case 'terminal-message:sent':
      case 'terminal-message:broadcast':
      case 'terminal-message:deleted':
      case 'terminal-message:cleared': {
        var msgDialog = document.getElementById('messages-dialog');
        if (msgDialog && msgDialog.open) {
          refreshMessagePanel();
        }
        updateMessageUnreadBadge();
        // Toast on targeted message to active terminal
        if (msg.event === 'terminal-message:sent' && msg.data.to && activeTabId && msg.data.to === activeTabId) {
          showToast('Message from ' + msg.data.from + ': ' + msg.data.content.slice(0, 60), 'info');
        }
        break;
      }
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

  // Claude terminal: update permissions, auto-handoff, kill
  if (inst.type === 'claude') {
    var permEl = statusBar.querySelector('[data-field="permissions"]');
    if (permEl) {
      var permLabel = inst.dangerouslySkipPermissions ? '\u26A0 No Perms' : '\u2705 Safe';
      permEl.textContent = permLabel;
      permEl.className = inst.dangerouslySkipPermissions ? 'term-status__perm--danger' : 'term-status__perm--safe';
    }
    // Update auto-handoff badge
    var handoffBadge = statusBar.querySelector('[data-field="handoff-badge"]');
    if (handoffBadge) {
      var isAH = inst.autoHandoff;
      handoffBadge.className = 'term-status__handoff-badge' + (isAH ? ' term-status__handoff-badge--active' : '');
      handoffBadge.title = 'Auto-handoff ' + (isAH ? 'ON' : 'OFF') + (inst.handoffCount > 0 ? ' (' + inst.handoffCount + ' handoffs)' : '');
      handoffBadge.textContent = '\u21BB' + (inst.handoffCount > 0 ? ' ' + inst.handoffCount : '');
    }
    // Update auto-handoff toggle button active state
    var handoffToggle = statusBar.querySelector('[data-action="toggle-handoff"]');
    if (handoffToggle) {
      handoffToggle.className = 'term-status__btn' + (inst.autoHandoff ? ' term-status__btn--active' : '');
    }
    // Update auto-dispatch toggle button active state
    var dispatchToggle = statusBar.querySelector('[data-action="toggle-dispatch"]');
    if (dispatchToggle) {
      dispatchToggle.className = 'term-status__btn' + (inst.autoDispatch ? ' term-status__btn--active' : '');
    }
    var killBtn = statusBar.querySelector('[data-action="kill"]');
    if (killBtn) killBtn.disabled = !inst.running;
    updateTerminalCount();
    return;
  }

  // Orchestrator: disable/enable start/stop/handoff buttons
  var startBtn = statusBar.querySelector('[data-action="start"]');
  var stopBtn = statusBar.querySelector('[data-action="stop"]');
  var handoffBtn = statusBar.querySelector('[data-action="handoff"]');
  if (startBtn) startBtn.disabled = inst.running;
  if (stopBtn) stopBtn.disabled = !inst.running;
  if (handoffBtn) handoffBtn.disabled = !inst.running;
  updateTerminalCount();
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
  updateTerminalCount();
}

// ── Update terminal count badge in page header ───────────────
function updateTerminalCount() {
  var badge = document.getElementById('terminal-count-badge');
  if (!badge) return;
  var total = instances.size;
  var running = 0;
  instances.forEach(function(inst) { if (inst.running) running++; });
  if (total === 0) {
    badge.textContent = '';
    badge.style.display = 'none';
  } else {
    badge.textContent = running + ' / ' + total;
    badge.title = running + ' running, ' + (total - running) + ' stopped';
    badge.style.display = 'inline-flex';
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
    '#6366f1': '34', // blue (Indigo)
    '#10b981': '32', // green (Emerald)
    '#f59e0b': '33', // yellow (Amber)
    '#f43f5e': '31', // red (Rose)
    '#a78bfa': '35', // magenta (Violet)
    '#22d3ee': '36', // cyan (Cyan)
    '#ec4899': '35', // magenta (Pink)
    '#84cc16': '32', // green (Lime)
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

// ── File Sidebar ─────────────────────────────────────────────

function initSidebar() {
  var sidebar = document.getElementById('term-sidebar');
  if (!sidebar) return;

  // Restore persisted state
  if (sidebarOpen) {
    sidebar.classList.remove('term-sidebar--hidden');
  }

  // Set up drag-and-drop on the panels container
  setupDropTargets();
}

function toggleSidebar() {
  var sidebar = document.getElementById('term-sidebar');
  if (!sidebar) return;

  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('term-sidebar--hidden', !sidebarOpen);
  localStorage.setItem('term-sidebar-open', sidebarOpen ? '1' : '0');

  // If opening and we have an active Claude terminal, load its project files
  if (sidebarOpen && activeTabId) {
    var inst = instances.get(activeTabId);
    if (inst && inst.type === 'claude') {
      fetchSidebarRootForTerminal(activeTabId);
    }
  }

  // Refit terminals after sidebar toggle (width changed)
  setTimeout(function() {
    instances.forEach(function(inst) {
      try { inst.fitAddon.fit(); } catch (e) { /* ignore */ }
    });
  }, 50);
}

function fetchSidebarRootForTerminal(terminalId) {
  fetch('/api/claude-terminals/' + encodeURIComponent(terminalId))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.projectDir) {
        loadSidebarTree(data.projectDir);
      }
    })
    .catch(function() { /* ignore */ });
}

function loadSidebarTree(root) {
  if (!root || root === sidebarRoot) return;
  sidebarRoot = root;

  var tree = document.getElementById('sidebar-tree');
  if (!tree) return;

  tree.dataset.root = root;
  tree.innerHTML = '<div class="tree-loading">Loading…</div>';

  fetch('/views/file-tree?root=' + encodeURIComponent(root) + '&path=')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      tree.innerHTML = html;
      setupDragOnTreeFiles(tree);
    })
    .catch(function() {
      tree.innerHTML = '<div class="tree-empty">Failed to load files</div>';
    });
}

function refreshSidebarTree() {
  if (!sidebarRoot) return;
  var tree = document.getElementById('sidebar-tree');
  if (!tree) return;

  // Reset loaded state on all open directories
  var dirs = tree.querySelectorAll('.tree-dir[data-loaded="1"]');
  for (var i = 0; i < dirs.length; i++) {
    dirs[i].removeAttribute('data-loaded');
  }

  tree.innerHTML = '<div class="tree-loading">Loading…</div>';
  fetch('/views/file-tree?root=' + encodeURIComponent(sidebarRoot) + '&path=')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      tree.innerHTML = html;
      setupDragOnTreeFiles(tree);
    })
    .catch(function() {
      tree.innerHTML = '<div class="tree-empty">Failed to load files</div>';
    });
}

function filterSidebarTree(input) {
  if (sidebarFilterTimer) clearTimeout(sidebarFilterTimer);
  sidebarFilterTimer = setTimeout(function() { _doFilterSidebar(input); }, 150);
}

function _doFilterSidebar(input) {
  var tree = document.getElementById('sidebar-tree');
  if (!tree) return;

  var query = (input.value || '').toLowerCase().trim();
  var files = tree.querySelectorAll('.tree-file');
  var dirs = tree.querySelectorAll('.tree-dir');

  if (!query) {
    for (var i = 0; i < files.length; i++) files[i].style.display = '';
    for (var j = 0; j < dirs.length; j++) dirs[j].style.display = '';
    return;
  }

  // Filter files by name
  for (var fi = 0; fi < files.length; fi++) {
    var nameEl = files[fi].querySelector('.tree-name');
    var name = nameEl ? nameEl.textContent.toLowerCase() : '';
    files[fi].style.display = name.includes(query) ? '' : 'none';
  }

  // Show dirs containing visible children, bottom-up
  for (var di = dirs.length - 1; di >= 0; di--) {
    var children = dirs[di].querySelector('.tree-children');
    var hasVisible = false;
    if (children) {
      var visFiles = children.querySelectorAll('.tree-file:not([style*="display: none"])');
      var visDirs = children.querySelectorAll('.tree-dir:not([style*="display: none"])');
      hasVisible = visFiles.length > 0 || visDirs.length > 0;
    }
    var dirName = dirs[di].querySelector('.tree-name');
    var dirNameText = dirName ? dirName.textContent.toLowerCase() : '';
    if (dirNameText.includes(query)) hasVisible = true;
    dirs[di].style.display = hasVisible ? '' : 'none';
    if (hasVisible && !dirs[di].open) {
      dirs[di].open = true;
      if (typeof loadTreeNode === 'function') loadTreeNode(dirs[di]);
    }
  }
}

// ── Drag-and-Drop: Files → Terminal ──────────────────────────

function setupDragOnTreeFiles(container) {
  container.addEventListener('dragstart', function(e) {
    // Support both files and folder drag handles
    var el = e.target.closest('.tree-file') || e.target.closest('.tree-drag-handle');
    if (!el) return;
    var path = el.dataset.path;
    if (!path) return;
    var itemType = el.dataset.type === 'dir' ? 'dir' : 'file';
    e.dataTransfer.setData('text/plain', path);
    e.dataTransfer.setData('application/x-tree-type', itemType);
    e.dataTransfer.effectAllowed = 'copy';
  });
}

function setupDropTargets() {
  var panelsEl = document.getElementById('term-panels');
  if (!panelsEl) return;

  panelsEl.addEventListener('dragover', function(e) {
    // Only accept text/plain (file paths from sidebar)
    if (!e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    // Find the target panel
    var panel = e.target.closest('.term-panel');
    if (panel && !panel.classList.contains('term-panel--drag-over')) {
      // Remove drag-over from all panels
      var all = panelsEl.querySelectorAll('.term-panel--drag-over');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('term-panel--drag-over');
      panel.classList.add('term-panel--drag-over');
    }
  });

  panelsEl.addEventListener('dragleave', function(e) {
    var panel = e.target.closest('.term-panel');
    if (panel && !panel.contains(e.relatedTarget)) {
      panel.classList.remove('term-panel--drag-over');
    }
  });

  panelsEl.addEventListener('drop', function(e) {
    e.preventDefault();
    // Remove all drag-over highlights
    var all = panelsEl.querySelectorAll('.term-panel--drag-over');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('term-panel--drag-over');

    var filePath = e.dataTransfer.getData('text/plain');
    if (!filePath) return;

    // Find which terminal this panel belongs to
    var panel = e.target.closest('.term-panel');
    if (!panel) return;
    var termId = panel.dataset.instanceId;
    if (!termId) return;

    var inst = instances.get(termId);
    if (!inst) return;

    if (inst.type === 'claude' && inst.binaryWs && inst.binaryWs.readyState === 1) {
      var fullPath = sidebarRoot ? sidebarRoot.replace(/\\/g, '/') + '/' + filePath : filePath;
      var itemType = e.dataTransfer.getData('application/x-tree-type');
      if (itemType === 'dir') {
        // Send cd command for folders
        inst.binaryWs.send('cd ' + fullPath + '\r');
        showToast('cd ' + filePath + ' in ' + termId, 'success');
      } else {
        // Send /add command for files
        inst.binaryWs.send('/add ' + fullPath + '\r');
        showToast('Added ' + filePath + ' to ' + termId, 'success');
      }
    } else if (inst.type === 'claude') {
      showToast('Terminal ' + termId + ' is not connected', 'error');
    } else {
      showToast('Can only drop files/folders on Claude terminals', 'error');
    }
  });
}

// ── Shared Memory Panel (Phase 17) ──────────────────────────

function toggleMemoryPanel() {
  var dialog = document.getElementById('memory-dialog');
  if (!dialog) return;
  if (dialog.open) { dialog.close(); } else { dialog.showModal(); refreshMemoryPanel(); }
}

function refreshMemoryPanel() {
  // Fetch keys
  fetch('/api/shared-memory')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var container = document.getElementById('memory-entries');
      var countBadge = document.getElementById('memory-key-count');
      if (!container) return;

      var count = data.count || 0;
      if (countBadge) countBadge.textContent = count;

      if (count === 0) {
        container.innerHTML = '<p class="text-muted">No keys stored yet.</p>';
        return;
      }

      var html = '<table class="memory-table" style="width:100%;font-size:0.85rem"><thead><tr><th>Key</th><th>Value</th><th>Source</th><th></th></tr></thead><tbody>';
      var entries = data.entries || {};
      var keys = Object.keys(entries).sort();
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var e = entries[k];
        var val = typeof e.value === 'object' ? JSON.stringify(e.value) : String(e.value);
        if (val.length > 80) val = val.slice(0, 80) + '...';
        html += '<tr><td><code>' + escapeHtml(k) + '</code></td><td>' + escapeHtml(val) + '</td><td><small>' + escapeHtml(e.source || '') + '</small></td>';
        html += '<td><button class="btn btn--xs btn--ghost" onclick="deleteMemoryKey(\'' + escapeHtml(k) + '\')" title="Delete">&times;</button></td></tr>';
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    })
    .catch(function() {
      var container = document.getElementById('memory-entries');
      if (container) container.innerHTML = '<p class="text-muted">Failed to load shared memory.</p>';
    });

  // Fetch snapshots
  fetch('/api/shared-memory-snapshots')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var container = document.getElementById('memory-snapshots');
      var countBadge = document.getElementById('memory-snapshot-count');
      if (!container) return;

      var count = data.count || 0;
      if (countBadge) countBadge.textContent = count;

      if (count === 0) {
        container.innerHTML = '<p class="text-muted">No snapshots yet.</p>';
        return;
      }

      var html = '';
      var snaps = data.snapshots || {};
      var ids = Object.keys(snaps).sort();
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i];
        var s = snaps[id];
        var snap = s.snapshot || {};
        html += '<details class="memory-snapshot-card" style="margin-bottom:var(--sp-2);padding:var(--sp-2);border:1px solid rgba(255,255,255,0.06);border-radius:var(--sp-1)">';
        html += '<summary style="cursor:pointer"><strong>' + escapeHtml(id) + '</strong>';
        if (snap.model) html += ' <span class="badge badge--neutral">' + escapeHtml(snap.model) + '</span>';
        if (snap.handoffCount) html += ' <span class="badge badge--neutral">handoff #' + snap.handoffCount + '</span>';
        if (snap.reason) html += ' <small style="color:var(--clr-text-muted)">(' + escapeHtml(snap.reason) + ')</small>';
        html += '</summary>';
        if (snap.lastOutput) {
          html += '<pre style="font-size:0.75rem;max-height:120px;overflow-y:auto;margin-top:var(--sp-1);padding:var(--sp-1);background:var(--bg-root);border-radius:2px">' + escapeHtml(snap.lastOutput.slice(-500)) + '</pre>';
        }
        if (snap.taskId) html += '<p style="margin:var(--sp-1) 0 0"><small>Task: ' + escapeHtml(snap.taskId) + '</small></p>';
        if (snap.metadata) html += '<p style="margin:var(--sp-1) 0 0"><small>Metadata: ' + escapeHtml(JSON.stringify(snap.metadata)) + '</small></p>';
        html += '</details>';
      }
      container.innerHTML = html;
    })
    .catch(function() {
      var container = document.getElementById('memory-snapshots');
      if (container) container.innerHTML = '<p class="text-muted">Failed to load snapshots.</p>';
    });
}

function addMemoryKey() {
  var keyInput = document.getElementById('memory-new-key');
  var valInput = document.getElementById('memory-new-value');
  if (!keyInput || !valInput) return;

  var key = keyInput.value.trim();
  var val = valInput.value.trim();
  if (!key) { showToast('Key is required', 'error'); return; }

  // Try to parse as JSON, fallback to string
  var parsed = val;
  try { parsed = JSON.parse(val); } catch (_) { /* use as string */ }

  fetch('/api/shared-memory/key?key=' + encodeURIComponent(key), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: parsed, source: 'ui' }),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      return r.json();
    })
    .then(function() {
      keyInput.value = '';
      valInput.value = '';
      showToast('Key "' + key + '" saved', 'success');
      refreshMemoryPanel();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}

function deleteMemoryKey(key) {
  fetch('/api/shared-memory/key?key=' + encodeURIComponent(key), {
    method: 'DELETE',
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      return r.json();
    })
    .then(function() {
      showToast('Key "' + key + '" deleted', 'success');
      refreshMemoryPanel();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}

function clearAllMemory() {
  if (!confirm('Clear ALL shared memory keys? This cannot be undone.')) return;

  // Fetch all keys and delete them one by one (no bulk clear API yet)
  fetch('/api/shared-memory')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var keys = Object.keys(data.entries || {});
      return Promise.all(keys.map(function(k) {
        return fetch('/api/shared-memory/key?key=' + encodeURIComponent(k), { method: 'DELETE' });
      }));
    })
    .then(function() {
      showToast('Shared memory cleared', 'success');
      refreshMemoryPanel();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}

// ── Terminal Task Bridge (Phase 19) ──────────────────────

function claimTask(terminalId) {
  fetch('/api/claude-terminals/' + encodeURIComponent(terminalId) + '/claim-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(function(r) { return r.json().then(function(d) { return { status: r.status, body: d }; }); })
    .then(function(res) {
      if (res.body.claimed) {
        showToast('Claimed task: ' + (res.body.task.task || '').slice(0, 60), 'success');
      } else if (res.body.message) {
        showToast(res.body.message, 'info');
      } else {
        showToast(res.body.error || 'Failed to claim task', 'error');
      }
    })
    .catch(function(err) { showToast('Error: ' + err.message, 'error'); });
}

function releaseTask(terminalId) {
  fetch('/api/claude-terminals/' + encodeURIComponent(terminalId) + '/release-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      return r.json();
    })
    .then(function() { showToast('Task released', 'success'); })
    .catch(function(err) { showToast('Error: ' + err.message, 'error'); });
}

function completeTask(terminalId, status) {
  var result = status === 'complete' ? prompt('Result summary (optional):') : null;
  var error = status === 'failed' ? prompt('Error reason (optional):') : null;

  var body = { status: status };
  if (result) body.result = result;
  if (error) body.error = error;

  fetch('/api/claude-terminals/' + encodeURIComponent(terminalId) + '/complete-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      return r.json();
    })
    .then(function(data) { showToast('Task ' + data.status, data.status === 'complete' ? 'success' : 'error'); })
    .catch(function(err) { showToast('Error: ' + err.message, 'error'); });
}

function updateTaskIndicator(terminalId) {
  var inst = instances.get(terminalId);
  if (!inst || !inst.panel) return;
  var indicator = inst.panel.querySelector('.term-task-indicator');
  if (!indicator) return;

  var task = inst.assignedTask;
  if (task) {
    indicator.innerHTML = '<span class="term-task-badge" title="' + escapeHtml(task.task || task.taskId) + '">'
      + '&#9654; ' + escapeHtml((task.task || task.taskId || '').slice(0, 40))
      + '</span>'
      + '<button class="btn btn--xs btn--ghost" onclick="completeTask(\'' + escapeHtml(terminalId) + '\',\'complete\')" title="Complete task">&#10004;</button>'
      + '<button class="btn btn--xs btn--ghost" onclick="completeTask(\'' + escapeHtml(terminalId) + '\',\'failed\')" title="Fail task">&#10008;</button>'
      + '<button class="btn btn--xs btn--ghost" onclick="releaseTask(\'' + escapeHtml(terminalId) + '\')" title="Release task">&#8617;</button>';
    indicator.style.display = 'flex';
  } else {
    indicator.innerHTML = '';
    indicator.style.display = 'none';
  }
}

function loadTerminalTask(terminalId) {
  fetch('/api/claude-terminals/' + encodeURIComponent(terminalId) + '/task')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var inst = instances.get(terminalId);
      if (inst && data.task) {
        inst.assignedTask = data.task;
        updateTaskIndicator(terminalId);
      }
    })
    .catch(function() { /* ignore */ });
}

// ── Terminal Messages Panel (Phase 18) ───────────────────────

function toggleMessagePanel() {
  var dialog = document.getElementById('messages-dialog');
  if (!dialog) return;
  if (dialog.open) { dialog.close(); } else { dialog.showModal(); populateRecipientDropdown(); refreshMessagePanel(); }
}

function populateRecipientDropdown() {
  var fromSel = document.getElementById('msg-from');
  var toSel = document.getElementById('msg-to');
  if (!fromSel || !toSel) return;

  // Collect known Claude terminal IDs
  var termIds = [];
  instances.forEach(function(inst, id) {
    if (inst.type === 'claude') termIds.push(id);
  });

  // From dropdown
  fromSel.innerHTML = '<option value="">From...</option>';
  termIds.forEach(function(id) {
    fromSel.innerHTML += '<option value="' + id + '">' + id + '</option>';
  });
  // Auto-select active terminal
  if (activeTabId && termIds.indexOf(activeTabId) !== -1) {
    fromSel.value = activeTabId;
  }

  // To dropdown
  toSel.innerHTML = '<option value="">Broadcast (all)</option>';
  termIds.forEach(function(id) {
    toSel.innerHTML += '<option value="' + id + '">' + id + '</option>';
  });
}

function refreshMessagePanel() {
  fetch('/api/terminal-messages?limit=50')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var container = document.getElementById('msg-list');
      var countBadge = document.getElementById('msg-count');
      if (!container) return;

      var msgs = data.messages || [];
      if (countBadge) countBadge.textContent = data.count || 0;

      if (msgs.length === 0) {
        container.innerHTML = '<p class="text-muted">No messages yet.</p>';
        return;
      }

      var html = '';
      for (var i = 0; i < msgs.length; i++) {
        html += renderMessageCard(msgs[i]);
      }
      container.innerHTML = html;
    })
    .catch(function() {
      var container = document.getElementById('msg-list');
      if (container) container.innerHTML = '<p class="text-muted">Failed to load messages.</p>';
    });

  updateMessageUnreadBadge();
}

function renderMessageCard(msg) {
  var html = '<div class="msg-card" style="padding:var(--sp-2);border:1px solid rgba(255,255,255,0.06);border-radius:var(--sp-1);margin-bottom:var(--sp-1)">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-1)">';
  html += '<span><strong>' + escapeHtml(msg.from) + '</strong>';
  if (msg.to) {
    html += ' &rarr; <strong>' + escapeHtml(msg.to) + '</strong>';
  } else {
    html += ' <span class="badge badge--neutral" style="font-size:0.7rem">broadcast</span>';
  }
  html += '</span>';
  html += '<span style="display:flex;gap:var(--sp-1);align-items:center">';
  if (msg.category && msg.category !== 'general') {
    html += '<span class="badge badge--neutral" style="font-size:0.7rem">' + escapeHtml(msg.category) + '</span>';
  }
  html += '<small style="color:var(--clr-text-muted)">' + relativeTime(msg.timestamp) + '</small>';
  html += '</span>';
  html += '</div>';
  html += '<div style="font-size:0.85rem;white-space:pre-wrap;word-break:break-word">' + escapeHtml(msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content) + '</div>';
  html += '<div style="display:flex;gap:var(--sp-1);margin-top:var(--sp-1)">';
  if (msg.replyTo) {
    html += '<small style="color:var(--clr-text-muted)">reply</small>';
  }
  html += '<button class="btn btn--xs btn--ghost" onclick="openThread(\'' + msg.id + '\')" title="View thread">thread</button>';
  html += '<button class="btn btn--xs btn--ghost" onclick="deleteMessage(\'' + msg.id + '\')" title="Delete" style="color:var(--clr-error)">&times;</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function sendTerminalMessage() {
  var fromSel = document.getElementById('msg-from');
  var toSel = document.getElementById('msg-to');
  var catSel = document.getElementById('msg-category');
  var contentEl = document.getElementById('msg-content');
  if (!fromSel || !contentEl) return;

  var from = fromSel.value;
  var to = toSel ? toSel.value : '';
  var category = catSel ? catSel.value : 'general';
  var content = contentEl.value.trim();

  if (!from) { showToast('Select a "From" terminal', 'error'); return; }
  if (!content) { showToast('Message content is required', 'error'); return; }

  var body = { from: from, content: content, category: category };
  if (to) body.to = to;

  fetch('/api/terminal-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      return r.json();
    })
    .then(function() {
      contentEl.value = '';
      showToast('Message sent', 'success');
      refreshMessagePanel();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}

function openThread(messageId) {
  var threadView = document.getElementById('msg-thread-view');
  var listView = document.getElementById('msg-list');
  if (!threadView || !listView) return;

  document.getElementById('msg-thread-root').value = messageId;

  fetch('/api/terminal-messages/' + messageId + '/thread')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var container = document.getElementById('msg-thread-list');
      if (!container) return;

      var msgs = data.messages || [];
      if (msgs.length === 0) {
        container.innerHTML = '<p class="text-muted">No thread messages.</p>';
      } else {
        var html = '';
        for (var i = 0; i < msgs.length; i++) {
          html += renderMessageCard(msgs[i]);
        }
        container.innerHTML = html;
      }

      listView.parentElement.querySelector('div:first-of-type').style.display = 'none';
      listView.style.display = 'none';
      threadView.style.display = 'block';
    })
    .catch(function() {
      showToast('Failed to load thread', 'error');
    });
}

function closeThreadView() {
  var threadView = document.getElementById('msg-thread-view');
  var listView = document.getElementById('msg-list');
  if (!threadView || !listView) return;

  threadView.style.display = 'none';
  listView.style.display = '';
  listView.parentElement.querySelector('div:first-of-type').style.display = '';
}

function sendThreadReply() {
  var rootId = document.getElementById('msg-thread-root').value;
  var replyInput = document.getElementById('msg-thread-reply');
  var fromSel = document.getElementById('msg-from');
  if (!rootId || !replyInput || !fromSel) return;

  var content = replyInput.value.trim();
  var from = fromSel.value;
  if (!from) { showToast('Select a "From" terminal first', 'error'); return; }
  if (!content) { showToast('Reply content is required', 'error'); return; }

  // Find the last message in the thread to reply to
  fetch('/api/terminal-messages/' + rootId + '/thread')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var msgs = data.messages || [];
      var replyTo = msgs.length > 0 ? msgs[msgs.length - 1].id : rootId;
      return fetch('/api/terminal-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from, content: content, replyTo: replyTo }),
      });
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      return r.json();
    })
    .then(function() {
      replyInput.value = '';
      showToast('Reply sent', 'success');
      openThread(rootId); // Refresh thread
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}

function deleteMessage(messageId) {
  fetch('/api/terminal-messages/' + messageId, { method: 'DELETE' })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      return r.json();
    })
    .then(function() {
      showToast('Message deleted', 'success');
      refreshMessagePanel();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}

function clearAllMessages() {
  if (!confirm('Clear ALL terminal messages? This cannot be undone.')) return;
  fetch('/api/terminal-messages', { method: 'DELETE' })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error); });
      return r.json();
    })
    .then(function() {
      showToast('All messages cleared', 'success');
      refreshMessagePanel();
    })
    .catch(function(err) {
      showToast('Error: ' + err.message, 'error');
    });
}

function updateMessageUnreadBadge() {
  var badge = document.getElementById('msg-unread-badge');
  if (!badge) return;

  // Sum unread for all active Claude terminals
  var totalUnread = 0;
  var promises = [];
  instances.forEach(function(inst, id) {
    if (inst.type === 'claude') {
      promises.push(
        fetch('/api/terminal-messages/unread/' + encodeURIComponent(id))
          .then(function(r) { return r.json(); })
          .then(function(data) { totalUnread += data.unread || 0; })
          .catch(function() { /* ignore */ })
      );
    }
  });

  Promise.all(promises).then(function() {
    if (totalUnread > 0) {
      badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  });
}

function relativeTime(isoString) {
  var diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function escapeHtml(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Expose to window for onclick handlers ────────────────────
window.toggleTerminalView = toggleTerminalView;
window.setLayout = setLayout;
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
window.addClaudeTerminal = addClaudeTerminal;
window.submitNewClaude = submitNewClaude;
window.killClaudeInstance = killClaudeInstance;
window.removeClaudeInstance = removeClaudeInstance;
window.toggleClaudePermissions = toggleClaudePermissions;
window.toggleAutoHandoff = toggleAutoHandoff;
window.toggleAutoDispatch = toggleAutoDispatch;
window.toggleSidebar = toggleSidebar;
window.refreshSidebarTree = refreshSidebarTree;
window.filterSidebarTree = filterSidebarTree;
window.toggleMemoryPanel = toggleMemoryPanel;
window.refreshMemoryPanel = refreshMemoryPanel;
window.addMemoryKey = addMemoryKey;
window.deleteMemoryKey = deleteMemoryKey;
window.clearAllMemory = clearAllMemory;
window.toggleMessagePanel = toggleMessagePanel;
window.refreshMessagePanel = refreshMessagePanel;
window.sendTerminalMessage = sendTerminalMessage;
window.openThread = openThread;
window.closeThreadView = closeThreadView;
window.sendThreadReply = sendThreadReply;
window.deleteMessage = deleteMessage;
window.clearAllMessages = clearAllMessages;
window.claimTask = claimTask;
window.releaseTask = releaseTask;
window.completeTask = completeTask;

function toggleShortcutsHelp() {
  var dialog = document.getElementById('shortcuts-dialog');
  if (!dialog) return;
  if (dialog.open) { dialog.close(); } else { dialog.showModal(); }
}
