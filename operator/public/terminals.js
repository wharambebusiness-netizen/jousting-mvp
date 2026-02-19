// ============================================================
// Terminals Page — Multi-Instance xterm.js Terminal UI
// ============================================================
// Manages tabbed/grid terminal views for multiple orchestrator
// instances. Each instance gets its own xterm.js Terminal with
// a unique color theme, status bar, and WS event routing.
// ============================================================

/* global Terminal, FitAddon, createWS, showToast */

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
var instances = new Map(); // id → { id, theme, terminal, fitAddon, panel, tab, running, round, agents, cost, mission, model }
var activeTabId = null;
var viewMode = localStorage.getItem('term-view') || 'tabs'; // 'tabs' | 'grid'
var themeIndex = 0;

// ── DOM refs ─────────────────────────────────────────────────
var tabBar = document.getElementById('term-tabs');
var panels = document.getElementById('term-panels');
var emptyState = document.getElementById('term-empty');
var viewToggle = document.getElementById('view-toggle-icon');

// ── Initialization ───────────────────────────────────────────
(function init() {
  applyViewMode();
  loadInstances();
  loadMissions();
  connectWS();
  checkPendingProject();

  // Keyboard shortcuts: Ctrl+1-4 to switch tabs
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      var idx = parseInt(e.key) - 1;
      var ids = Array.from(instances.keys());
      if (ids[idx]) switchTab(ids[idx]);
    }
  });
})();

// ── Load existing instances from API ─────────────────────────
function loadInstances() {
  fetch('/api/orchestrator/instances')
    .then(function(r) { return r.json(); })
    .then(function(list) {
      if (!list || !list.length) return;
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
      // API not available, that's fine
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
    '</span>';
  panel.appendChild(statusBar);

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
    panel: panel,
    tab: tab,
    running: state ? state.running : false,
    round: state ? state.round : 0,
    agents: state ? (state.agents || []) : [],
    cost: state ? (state.cost || 0) : 0,
    mission: state ? state.mission : null,
    model: state ? state.model : null,
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

  if (isGrid) {
    // Show all panels in grid
    instances.forEach(function(inst) {
      inst.panel.classList.add('term-panel--active');
      inst.panel.style.display = 'flex';
    });
  } else {
    // Show only active tab
    instances.forEach(function(inst, instId) {
      inst.panel.classList.toggle('term-panel--active', instId === activeTabId);
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
  createWS([
    'worker:*',
    'orchestrator:*',
    'agent:*',
    'round:*',
    'handoff:*',
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
        break;

      case 'worker:ready':
        if (inst) {
          inst.running = true;
          inst.terminal.writeln('\x1b[32m[SYSTEM] Worker ready\x1b[0m');
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
        break;

      case 'worker:exit':
        if (inst) {
          inst.running = false;
          inst.terminal.writeln('\x1b[33m[SYSTEM] Worker exited (code: ' + (msg.data.code !== undefined ? msg.data.code : '?') + ')\x1b[0m');
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
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
        break;

      case 'worker:restarted':
        if (inst) {
          inst.terminal.writeln('\x1b[33m[SYSTEM] Worker restarted\x1b[0m');
          inst.running = true;
          updateStatusBar(instanceId);
          updateTabDot(instanceId);
        }
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
    }
  });
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

// ── Expose to window for onclick handlers ────────────────────
window.toggleTerminalView = toggleTerminalView;
window.addInstance = addInstance;
window.removeInstance = removeInstance;
window.startInstance = startInstance;
window.stopInstance = stopInstance;
window.submitNewInstance = submitNewInstance;
window.handoffInstance = handoffInstance;
window.showHandoffHistory = showHandoffHistory;
