// ============================================================
// Master Console — Console Page JS (Phase 57 + Phase 66 Multi-Master)
// ============================================================
// Interactive multi-master terminal + worker panel.
// Connects to Claude terminal PTY via binary WS.
// Supports up to 4 concurrent master terminals with tabbed UI.
// ============================================================

(function() {
  'use strict';

  // ── Multi-Master State (Phase 66) ───────────────────────
  var masters = {};            // { id: { terminal, fitAddon, binaryWs, panel, tab, colorIdx, onDataDisposable, onResizeDisposable, reconnectTimer } }
  var activeMasterId = null;   // Currently visible master tab
  var masterCounter = 0;       // Counter for generating unique master IDs
  var MASTER_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#22d3ee'];
  var MAX_MASTERS = 4;
  var masterSystemPrompt = '';  // Cached master-context.md

  // ── Worker State ─────────────────────────────────────────
  var workers = {};             // { id: { ...terminalData } }
  var seenWorkers = {};         // { id: { ...terminalData, _stopped: bool } } — persists across refreshes
  var workerTerminals = {};     // { id: { term, fitAddon, binaryWs } } — xterm.js instances
  var workerRefreshTimer = null;

  // ── xterm.js Theme ────────────────────────────────────────
  // Nebula theme — primary accent color for master terminal
  var MASTER_THEME = {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#6366f1',
    cursorAccent: '#0d1117',
    selectionBackground: 'rgba(99, 102, 241, 0.3)',
    black: '#0d1117',
    red: '#ef4444',
    green: '#10b981',
    yellow: '#f59e0b',
    blue: '#6366f1',
    magenta: '#a855f7',
    cyan: '#22d3ee',
    white: '#e6edf3',
    brightBlack: '#484f58',
    brightRed: '#ff7b72',
    brightGreen: '#3fb950',
    brightYellow: '#d29922',
    brightBlue: '#79c0ff',
    brightMagenta: '#bc8cff',
    brightCyan: '#39d2c0',
    brightWhite: '#f0f6fc'
  };

  // ── Multi-Master Helpers ──────────────────────────────────

  function getMasterColor(index) {
    return MASTER_COLORS[index % MASTER_COLORS.length];
  }

  function getMasterLabel(id) {
    var match = id.match(/master-(\d+)/);
    var idx = match ? parseInt(match[1]) : 1;
    return 'M' + idx;
  }

  function getMasterCount() {
    return Object.keys(masters).length;
  }

  function updateMasterCount() {
    var count = getMasterCount();
    var el = document.getElementById('master-count');
    if (el) el.textContent = count + '/' + MAX_MASTERS + ' masters';
    var statusEl = document.getElementById('status-masters');
    if (statusEl) statusEl.textContent = count + '/' + MAX_MASTERS + ' masters';

    // Update header status
    var headerStatus = document.getElementById('master-status');
    if (headerStatus) {
      if (count === 0) {
        headerStatus.textContent = 'No masters';
        headerStatus.classList.remove('console-header__status--running');
      } else {
        headerStatus.textContent = count + ' master' + (count !== 1 ? 's' : '') + ' running';
        headerStatus.classList.add('console-header__status--running');
      }
    }

    // Show/hide tabs bar and placeholder
    var tabsBar = document.getElementById('master-tabs-bar');
    var placeholder = document.getElementById('master-placeholder');
    if (tabsBar) tabsBar.style.display = count > 0 ? '' : 'none';
    if (placeholder) placeholder.style.display = count > 0 ? 'none' : '';

    // Show/hide stop button based on active master
    var stopBtn = document.getElementById('stop-master-btn');
    if (stopBtn) stopBtn.style.display = activeMasterId ? '' : 'none';

    // Disable add button at max
    var addBtn = document.getElementById('add-master-btn');
    if (addBtn) addBtn.disabled = count >= MAX_MASTERS;
  }

  // ── Master Terminal Creation ──────────────────────────────

  function addMasterTab(id, colorIdx) {
    var tabsEl = document.getElementById('master-tabs');
    var panelsEl = document.getElementById('master-panels');
    if (!tabsEl || !panelsEl) return;

    // Create tab button
    var tab = document.createElement('button');
    tab.className = 'master-tab';
    tab.dataset.masterId = id;
    tab.style.borderColor = getMasterColor(colorIdx);
    tab.innerHTML = '<span class="master-tab-dot" style="background:' + getMasterColor(colorIdx) + '"></span> ' + getMasterLabel(id);
    tab.onclick = function() { switchToMaster(id); };

    // Add close button on the tab
    var closeBtn = document.createElement('span');
    closeBtn.className = 'master-tab-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Stop ' + getMasterLabel(id);
    closeBtn.onclick = function(e) {
      e.stopPropagation();
      stopMaster(id);
    };
    tab.appendChild(closeBtn);

    tabsEl.appendChild(tab);

    // Create terminal panel
    var panel = document.createElement('div');
    panel.className = 'master-panel';
    panel.id = 'master-panel-' + id;
    panel.style.display = 'none';
    panelsEl.appendChild(panel);

    // Create xterm.js terminal
    var theme = Object.assign({}, MASTER_THEME, { cursor: getMasterColor(colorIdx) });
    var terminal = new Terminal({
      theme: theme,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 10000,
      convertEol: true,
      disableStdin: false
    });

    var fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(panel);

    // Slight delay to ensure container has dimensions before fitting
    setTimeout(function() {
      if (fitAddon) {
        try { fitAddon.fit(); } catch(_) {}
      }
    }, 50);

    masters[id] = {
      terminal: terminal,
      fitAddon: fitAddon,
      binaryWs: null,
      panel: panel,
      tab: tab,
      colorIdx: colorIdx,
      onDataDisposable: null,
      onResizeDisposable: null,
      reconnectTimer: null
    };
  }

  function removeMasterTab(id) {
    var entry = masters[id];
    if (!entry) return;

    // Clear reconnect timer
    if (entry.reconnectTimer) {
      clearInterval(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    // Clean up WS and disposables
    if (entry.onDataDisposable) { entry.onDataDisposable.dispose(); }
    if (entry.onResizeDisposable) { entry.onResizeDisposable.dispose(); }
    if (entry.binaryWs) { try { entry.binaryWs.close(); } catch(_) {} }

    // Dispose terminal
    if (entry.terminal) { try { entry.terminal.dispose(); } catch(_) {} }

    // Remove DOM elements
    if (entry.tab) entry.tab.remove();
    if (entry.panel) entry.panel.remove();

    delete masters[id];

    // Switch to another master if this was active
    if (activeMasterId === id) {
      var remaining = Object.keys(masters);
      if (remaining.length > 0) {
        switchToMaster(remaining[0]);
      } else {
        activeMasterId = null;
      }
    }

    updateMasterCount();
  }

  function switchToMaster(id) {
    var ids = Object.keys(masters);
    for (var i = 0; i < ids.length; i++) {
      var mId = ids[i];
      var entry = masters[mId];
      if (!entry) continue;
      var isActive = mId === id;
      entry.panel.style.display = isActive ? '' : 'none';
      entry.tab.classList.toggle('active', isActive);
      if (isActive) {
        setTimeout(function() {
          try { entry.fitAddon.fit(); } catch(_) {}
        }, 50);
      }
    }
    activeMasterId = id;

    // Update stop button visibility
    var stopBtn = document.getElementById('stop-master-btn');
    if (stopBtn) stopBtn.style.display = id ? '' : 'none';
  }

  function connectMasterBinaryWs(id) {
    var entry = masters[id];
    if (!entry) return;

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/ws/claude-terminal/' + encodeURIComponent(id);

    var ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = function() {
      entry.tab.classList.remove('disconnected');
      // Send initial resize
      if (entry.fitAddon) {
        var dims = entry.fitAddon.proposeDimensions();
        if (dims) {
          ws.send('\x01' + JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    };

    ws.onmessage = function(evt) {
      var data = typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data);

      // Check for control messages (0x01 prefix)
      if (data.length > 0 && data.charCodeAt(0) === 1) {
        try {
          var ctrl = JSON.parse(data.slice(1));
          if (ctrl.type === 'ping') {
            ws.send('\x01' + JSON.stringify({ type: 'pong' }));
          }
        } catch(e) { /* ignore malformed control */ }
        return;
      }

      if (entry.terminal) entry.terminal.write(data);
    };

    ws.onclose = function() {
      entry.tab.classList.add('disconnected');
      if (entry.terminal) {
        entry.terminal.write('\r\n\x1b[33m[' + getMasterLabel(id) + ' disconnected]\x1b[0m\r\n');
      }
      entry.binaryWs = null;
      showMasterDisconnected(id);
    };

    ws.onerror = function() {
      if (entry.terminal) {
        entry.terminal.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n');
      }
    };

    // Dispose previous handlers to prevent stacking on reconnect
    if (entry.onDataDisposable) { entry.onDataDisposable.dispose(); entry.onDataDisposable = null; }
    if (entry.onResizeDisposable) { entry.onResizeDisposable.dispose(); entry.onResizeDisposable = null; }

    // User input -> WS
    entry.onDataDisposable = entry.terminal.onData(function(data) {
      if (entry.binaryWs && entry.binaryWs.readyState === WebSocket.OPEN) {
        entry.binaryWs.send(data);
      }
    });

    // Resize -> WS
    entry.onResizeDisposable = entry.terminal.onResize(function(size) {
      if (entry.binaryWs && entry.binaryWs.readyState === WebSocket.OPEN) {
        entry.binaryWs.send('\x01' + JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      }
    });

    entry.binaryWs = ws;
  }

  // ── Spawn / Stop Master ──────────────────────────────────

  async function spawnMaster() {
    if (getMasterCount() >= MAX_MASTERS) {
      if (window.showToast) window.showToast('Maximum masters (' + MAX_MASTERS + ') reached', 'warning');
      return;
    }

    masterCounter++;
    var id = 'master-' + masterCounter;
    var colorIdx = getMasterCount();

    var btn = document.getElementById('start-master-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }

    try {
      // Load master-context.md if not cached
      if (!masterSystemPrompt) {
        try {
          var contextResp = await fetch('/master-context.md');
          if (contextResp.ok) {
            masterSystemPrompt = await contextResp.text();
          }
        } catch(e) { /* optional */ }
      }

      // Append dynamic system state
      var systemPrompt = masterSystemPrompt || '';
      try {
        var stateLines = ['\n\n## Current System State (at spawn time)\n'];
        var results = await Promise.all([
          fetch('/api/health').then(function(r) { return r.json(); }).catch(function() { return null; }),
          fetch('/api/coordination/tasks').then(function(r) { return r.json(); }).catch(function() { return null; }),
          fetch('/api/claude-terminals/pool-status').then(function(r) { return r.json(); }).catch(function() { return null; })
        ]);
        var healthResp = results[0], tasksResp = results[1], poolResp = results[2];
        if (healthResp) stateLines.push('- Health: ' + (healthResp.status || 'unknown'));
        if (tasksResp && tasksResp.items) {
          var pending = tasksResp.items.filter(function(t) { return t.status === 'pending'; }).length;
          var assigned = tasksResp.items.filter(function(t) { return t.status === 'assigned'; }).length;
          var done = tasksResp.items.filter(function(t) { return t.status === 'done'; }).length;
          stateLines.push('- Tasks: ' + tasksResp.items.length + ' total (' + pending + ' pending, ' + assigned + ' in-progress, ' + done + ' done)');
        } else {
          stateLines.push('- Tasks: No tasks yet');
        }
        if (poolResp) {
          stateLines.push('- Workers: ' + (poolResp.active || 0) + ' active, swarm ' + (poolResp.swarm && poolResp.swarm.enabled ? 'ON' : 'OFF'));
        }
        stateLines.push('- Masters: ' + getMasterCount() + '/' + MAX_MASTERS + ' active');
        stateLines.push('- Master ID: ' + id + ' (' + getMasterLabel(id) + ')');
        stateLines.push('- Time: ' + new Date().toLocaleString());
        systemPrompt += stateLines.join('\n');
      } catch(e) { /* dynamic state is optional */ }

      // Spawn master terminal via API
      var resp = await fetch('/api/claude-terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id,
          role: 'master',
          persistent: true,
          dangerouslySkipPermissions: true,
          autoHandoff: true,
          systemPrompt: systemPrompt.slice(0, 12000)
        })
      });

      if (!resp.ok) {
        var err = await resp.json().catch(function() { return { error: 'Unknown error' }; });
        throw new Error(err.error || 'Failed to spawn master');
      }

      // Create tab + terminal
      addMasterTab(id, colorIdx);
      connectMasterBinaryWs(id);
      switchToMaster(id);
      updateMasterCount();

      // Show prompt input for first instruction
      showPromptInput();

      if (window.showToast) window.showToast(getMasterLabel(id) + ' started', 'success');
    } catch (err) {
      masterCounter--; // Roll back counter on failure
      if (window.showToast) window.showToast(err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '+ Master'; }
    }
  }

  async function stopMaster(id) {
    if (!id) id = activeMasterId;
    if (!id) return;

    try {
      await fetch('/api/claude-terminals/' + encodeURIComponent(id), { method: 'DELETE' });
      removeMasterTab(id);
      if (window.showToast) window.showToast(getMasterLabel(id) + ' stopped', 'info');
    } catch (err) {
      if (window.showToast) window.showToast('Failed to stop master: ' + err.message, 'error');
    }
  }

  // ── Master Disconnect / Reconnect ────────────────────────

  function showMasterDisconnected(id) {
    var entry = masters[id];
    if (!entry) return;

    // Update tab to show disconnected
    if (entry.tab) entry.tab.classList.add('disconnected');

    // Hide prompt input if this is active master
    if (activeMasterId === id) {
      hidePromptInput();
    }

    // Poll for auto-handoff respawn
    var attempts = 0;
    var maxAttempts = 15; // 15 attempts x 2s = 30s window

    if (entry.reconnectTimer) clearInterval(entry.reconnectTimer);

    entry.reconnectTimer = setInterval(async function() {
      attempts++;
      try {
        var resp = await fetch('/api/claude-terminals/' + encodeURIComponent(id));
        if (resp.ok) {
          var data = await resp.json();
          if (data.status === 'running') {
            // Master is back (auto-handoff respawned it)
            clearInterval(entry.reconnectTimer);
            entry.reconnectTimer = null;

            if (entry.terminal) {
              entry.terminal.write('\r\n\x1b[32m[' + getMasterLabel(id) + ' respawned — reconnecting...]\x1b[0m\r\n');
            }

            connectMasterBinaryWs(id);
            if (entry.tab) entry.tab.classList.remove('disconnected');
            if (window.showToast) window.showToast(getMasterLabel(id) + ' auto-reconnected', 'success');
            return;
          }
        }
      } catch(e) { /* non-critical */ }

      if (attempts >= maxAttempts) {
        clearInterval(entry.reconnectTimer);
        entry.reconnectTimer = null;

        // Master didn't come back — remove the tab
        removeMasterTab(id);
        if (window.showToast) window.showToast(getMasterLabel(id) + ' disconnected permanently', 'warning');
      }
    }, 2000);
  }

  // ── Prompt Input ──────────────────────────────────────────

  function showPromptInput() {
    var el = document.getElementById('master-prompt');
    if (el) {
      el.style.display = '';
      var ta = document.getElementById('master-prompt-input');
      if (ta) ta.focus();
    }
  }

  function hidePromptInput() {
    var el = document.getElementById('master-prompt');
    if (el) el.style.display = 'none';
  }

  // Track original prompt text for revert
  var _originalPromptText = '';
  var _isEnhancedPreview = false;

  function enhancePrompt() {
    var ta = document.getElementById('master-prompt-input');
    var enhanceBtn = document.getElementById('enhance-prompt-btn');
    var sendBtn = document.getElementById('send-prompt-btn');
    var badge = document.getElementById('enhanced-badge');
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) return;

    // Save original for revert
    _originalPromptText = text;

    // Disable UI while enhancing
    if (enhanceBtn) { enhanceBtn.disabled = true; enhanceBtn.textContent = 'Enhancing...'; }
    if (sendBtn) sendBtn.disabled = true;
    ta.disabled = true;

    fetch('/api/enhance-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text })
    })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (enhanceBtn) { enhanceBtn.disabled = false; enhanceBtn.textContent = 'Enhance'; }
      if (sendBtn) sendBtn.disabled = false;
      ta.disabled = false;

      if (data && data.enhanced && !data.fallback) {
        // Show enhanced text in textarea for review
        ta.value = data.enhanced;
        ta.rows = Math.min(8, Math.max(3, data.enhanced.split('\n').length + 1));
        _isEnhancedPreview = true;
        // Show enhanced badge
        if (badge) badge.style.display = '';
        // Hide enhance button, focus textarea for editing
        if (enhanceBtn) enhanceBtn.style.display = 'none';
        ta.focus();
        if (window.showToast) window.showToast('Prompt enhanced — review and edit, then Send', 'success');
      } else {
        // Enhancement failed or returned fallback
        _isEnhancedPreview = false;
        if (badge) badge.style.display = 'none';
        ta.focus();
        if (window.showToast) window.showToast('Enhancement unavailable — send as-is or try again', 'warning');
      }
    })
    .catch(function(err) {
      if (enhanceBtn) { enhanceBtn.disabled = false; enhanceBtn.textContent = 'Enhance'; }
      if (sendBtn) sendBtn.disabled = false;
      ta.disabled = false;
      ta.focus();
      if (window.showToast) window.showToast('Enhancement failed: ' + (err.message || 'network error'), 'error');
    });
  }

  function revertPrompt() {
    var ta = document.getElementById('master-prompt-input');
    var enhanceBtn = document.getElementById('enhance-prompt-btn');
    var badge = document.getElementById('enhanced-badge');
    if (ta && _originalPromptText) {
      ta.value = _originalPromptText;
      ta.rows = 2;
    }
    _isEnhancedPreview = false;
    if (badge) badge.style.display = 'none';
    if (enhanceBtn) enhanceBtn.style.display = '';
    if (ta) ta.focus();
  }

  function sendInitialPrompt() {
    var ta = document.getElementById('master-prompt-input');
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) return;

    _sendToMasterTerminal(text, _isEnhancedPreview);
  }

  function _sendToMasterTerminal(text, wasEnhanced) {
    var sendBtn = document.getElementById('send-prompt-btn');
    var enhanceBtn = document.getElementById('enhance-prompt-btn');
    var ta = document.getElementById('master-prompt-input');
    var badge = document.getElementById('enhanced-badge');

    // Get the active master's binary WS
    var entry = activeMasterId ? masters[activeMasterId] : null;
    var ws = entry ? entry.binaryWs : null;

    function doSend() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(text + '\r');
        hidePromptInput();
        // Reset enhance state
        _isEnhancedPreview = false;
        _originalPromptText = '';
        if (badge) badge.style.display = 'none';
        if (enhanceBtn) enhanceBtn.style.display = '';
        if (window.showToast) {
          var label = activeMasterId ? getMasterLabel(activeMasterId) : 'Master';
          window.showToast(wasEnhanced ? 'Enhanced prompt sent to ' + label : 'Prompt sent to ' + label, 'success');
        }
      } else {
        if (window.showToast) window.showToast('Terminal not connected — try again', 'error');
        // Re-enable UI
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send to Master'; }
        if (ta) ta.disabled = false;
      }
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      doSend();
    } else {
      if (window.showToast) window.showToast('Waiting for terminal connection...', 'info');
      setTimeout(doSend, 1500);
    }
  }

  function skipPrompt() {
    hidePromptInput();
  }

  // ── Worker Mini-Terminals ─────────────────────────────────

  /**
   * Create a tiny xterm.js instance for a worker card.
   * @param {string} workerId
   * @param {HTMLElement} container - DOM element to mount into
   */
  function initWorkerTerminal(workerId, container) {
    if (workerTerminals[workerId]) return; // already exists

    var term = new Terminal({
      theme: MASTER_THEME,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 9,
      lineHeight: 1.2,
      cursorBlink: false,
      scrollback: 1000,
      convertEol: true,
      disableStdin: true
    });

    var fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    setTimeout(function() {
      try { fitAddon.fit(); } catch (_) {}
    }, 50);

    workerTerminals[workerId] = { term: term, fitAddon: fitAddon, binaryWs: null };

    // Load raw ANSI output for restoration
    fetch('/api/claude-terminals/' + encodeURIComponent(workerId) + '/output?lines=200&raw=1')
      .then(function(resp) { return resp.ok ? resp.json() : null; })
      .then(function(data) {
        if (data && data.lines && data.lines.length > 0 && workerTerminals[workerId]) {
          workerTerminals[workerId].term.write(data.lines.join('\n'));
        }
      })
      .catch(function() { /* non-critical */ });
  }

  /**
   * Connect a read-only binary WS for live streaming to a worker terminal.
   * @param {string} workerId
   */
  function connectWorkerBinaryWs(workerId) {
    var entry = workerTerminals[workerId];
    if (!entry || entry.binaryWs) return;

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/ws/claude-terminal/' + encodeURIComponent(workerId);

    var ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    entry.binaryWs = ws;

    ws.onmessage = function(evt) {
      var data = typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data);
      // Skip control messages (0x01 prefix)
      if (data.length > 0 && data.charCodeAt(0) === 1) {
        try {
          var ctrl = JSON.parse(data.slice(1));
          if (ctrl.type === 'ping') {
            ws.send('\x01' + JSON.stringify({ type: 'pong' }));
          }
        } catch(_) {}
        return;
      }
      if (entry.term) entry.term.write(data);
    };

    ws.onclose = function() {
      if (entry) entry.binaryWs = null;
    };
  }

  /**
   * Dispose a worker terminal and its WS.
   * @param {string} workerId
   */
  function disposeWorkerTerminal(workerId) {
    var entry = workerTerminals[workerId];
    if (!entry) return;
    if (entry.binaryWs) { try { entry.binaryWs.close(); } catch(_) {} }
    if (entry.term) { try { entry.term.dispose(); } catch(_) {} }
    delete workerTerminals[workerId];
  }

  // ── Quick Actions ────────────────────────────────────────

  var swarmRunning = false;

  async function toggleSwarm() {
    var btn = document.getElementById('swarm-btn');
    try {
      if (swarmRunning) {
        await fetch('/api/claude-terminals/swarm/stop', { method: 'POST' });
        swarmRunning = false;
        if (btn) btn.textContent = 'Swarm';
        if (window.showToast) window.showToast('Swarm stopped', 'info');
      } else {
        var resp = await fetch('/api/claude-terminals/swarm/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minTerminals: 3, maxTerminals: 3 })
        });
        if (resp.ok) {
          swarmRunning = true;
          if (btn) btn.textContent = 'Stop Swarm';
          if (window.showToast) window.showToast('Swarm started with 3 workers', 'success');
        } else {
          var err = await resp.json().catch(function() { return {}; });
          if (window.showToast) window.showToast(err.error || 'Failed to start swarm', 'error');
        }
      }
    } catch(e) {
      if (window.showToast) window.showToast('Swarm action failed', 'error');
    }
    refreshWorkers();
  }

  function showCreateTask() {
    var dialog = document.getElementById('create-task-dialog');
    if (dialog && dialog.showModal) dialog.showModal();
  }

  async function submitCreateTask(e) {
    e.preventDefault();
    var title = document.getElementById('task-title-input');
    var desc = document.getElementById('task-desc-input');
    if (!title || !title.value.trim()) return;

    try {
      var resp = await fetch('/api/coordination/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: title.value.trim(),
          description: desc ? desc.value.trim() : ''
        })
      });
      if (resp.ok) {
        if (window.showToast) window.showToast('Task created', 'success');
        title.value = '';
        if (desc) desc.value = '';
        var dialog = document.getElementById('create-task-dialog');
        if (dialog) dialog.close();
        refreshTaskPanel();
      } else {
        var err = await resp.json().catch(function() { return {}; });
        if (window.showToast) window.showToast(err.error || 'Failed to create task', 'error');
      }
    } catch(e2) {
      if (window.showToast) window.showToast('Failed to create task', 'error');
    }
  }

  function toggleTaskPanel() {
    var panel = document.getElementById('task-panel');
    if (!panel) return;
    var visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : '';
    if (!visible) refreshTaskPanel();
  }

  async function refreshTaskPanel() {
    try {
      var resp = await fetch('/api/coordination/tasks');
      if (!resp.ok) return;
      var data = await resp.json();
      var tasks = data.tasks || data || [];
      renderTaskList(tasks);
    } catch(e) { /* non-critical */ }
  }

  function renderTaskList(tasks) {
    var list = document.getElementById('task-list');
    if (!list) return;

    if (!tasks || tasks.length === 0) {
      list.innerHTML = '<p class="console-taskpanel__empty">No tasks yet.</p>';
      return;
    }

    var html = '';
    tasks.forEach(function(t) {
      var status = t.status || 'pending';
      var title = t.task || t.title || t.id || '(untitled)';
      var assignee = t.assignedTo ? '<span class="console-task__assignee">' + escapeHtml(t.assignedTo) + '</span>' : '';

      html += '<div class="console-task console-task--' + escapeHtml(status) + '">' +
        '<span class="console-task__status">' + escapeHtml(status) + '</span>' +
        '<span class="console-task__title">' + escapeHtml(title) + '</span>' +
        assignee +
      '</div>';
    });

    list.innerHTML = html;
  }

  async function checkHealth() {
    try {
      var resp = await fetch('/api/health');
      if (!resp.ok) throw new Error('Health check failed');
      var data = await resp.json();
      var status = data.status || 'unknown';
      var msg = 'System: ' + status;
      if (data.components) {
        var degraded = Object.entries(data.components).filter(function(e) { return e[1].status !== 'healthy'; });
        if (degraded.length > 0) {
          msg += ' (' + degraded.map(function(e) { return e[0] + ': ' + e[1].status; }).join(', ') + ')';
        }
      }
      if (window.showToast) window.showToast(msg, status === 'healthy' ? 'success' : 'warning');
    } catch(e) {
      if (window.showToast) window.showToast('Health check failed', 'error');
    }
  }

  async function checkSwarmStatus() {
    try {
      var resp = await fetch('/api/claude-terminals/swarm/status');
      if (resp.ok) {
        var data = await resp.json();
        swarmRunning = data.enabled || false;
        var btn = document.getElementById('swarm-btn');
        if (btn) btn.textContent = swarmRunning ? 'Stop Swarm' : 'Swarm';
      }
    } catch(e) { /* non-critical */ }
  }

  // ── Worker Panel ───────────────────────────────────────────

  async function refreshWorkers() {
    try {
      // Fetch terminals and cost data in parallel
      var results = await Promise.all([
        fetch('/api/claude-terminals').then(function(r) { return r.ok ? r.json() : null; }),
        fetch('/api/coordination/costs').then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; })
      ]);

      var data = results[0];
      var costData = results[1];
      if (!data) return;

      var terminals = data.terminals || data || [];

      // Build per-worker cost lookup
      var workerCosts = {};
      if (costData && costData.workers) {
        Object.keys(costData.workers).forEach(function(wid) {
          workerCosts[wid] = costData.workers[wid].totalUsd || 0;
        });
      }

      // Filter: keep only non-master terminals
      var workerList = terminals.filter(function(t) {
        return t.role !== 'master';
      });

      // Merge cost data into each worker
      workerList.forEach(function(w) {
        if (workerCosts[w.id] != null) {
          w._costUsd = workerCosts[w.id];
        }
      });

      // Build live lookup
      workers = {};
      var liveIds = {};
      workerList.forEach(function(w) {
        workers[w.id] = w;
        liveIds[w.id] = true;
        seenWorkers[w.id] = w;
      });

      // Mark disappeared workers as stopped
      Object.keys(seenWorkers).forEach(function(id) {
        if (!liveIds[id]) {
          seenWorkers[id]._stopped = true;
          seenWorkers[id].status = 'stopped';
        }
      });

      // Merged list: live workers first, then stopped (seen) workers
      var mergedList = workerList.slice();
      Object.keys(seenWorkers).forEach(function(id) {
        if (!liveIds[id]) {
          mergedList.push(seenWorkers[id]);
        }
      });

      renderWorkerPanel(mergedList);
      updateStatusBar(workerList);
      updateDismissAllButton();
    } catch (err) {
      // Silently retry on next interval
    }
  }

  function renderWorkerPanel(workerList) {
    var list = document.getElementById('worker-list');
    var empty = document.getElementById('worker-empty');
    if (!list) return;

    if (workerList.length === 0) {
      if (empty) empty.style.display = '';
      // Remove stale cards but preserve empty message
      var cards = list.querySelectorAll('.worker-card');
      cards.forEach(function(c) { c.remove(); });
      return;
    }

    if (empty) empty.style.display = 'none';

    // DOM-diff: track which cards exist, add/update/remove as needed
    var existingCards = {};
    list.querySelectorAll('.worker-card').forEach(function(card) {
      existingCards[card.getAttribute('data-id')] = card;
    });

    var desiredIds = {};
    workerList.forEach(function(w) {
      desiredIds[w.id] = true;

      if (existingCards[w.id]) {
        // Update existing card metadata (don't recreate — preserves xterm)
        updateWorkerCardMeta(existingCards[w.id], w);
      } else {
        // Create new card
        var card = createWorkerCard(w);
        list.appendChild(card);
      }
    });

    // Remove cards no longer in list
    Object.keys(existingCards).forEach(function(id) {
      if (!desiredIds[id]) {
        existingCards[id].remove();
        disposeWorkerTerminal(id);
      }
    });
  }

  /**
   * Map activityState to CSS dot class suffix.
   */
  function activityDotClass(w) {
    var isStopped = w._stopped || w.status === 'stopped';
    if (isStopped) return 'worker-card__dot--stopped';
    var state = w.activityState || (w.status === 'running' ? 'active' : 'stopped');
    switch (state) {
      case 'active':  return 'worker-card__dot--active';
      case 'idle':    return 'worker-card__dot--idle';
      case 'waiting': return 'worker-card__dot--waiting';
      default:        return w.status === 'running' ? 'worker-card__dot--running' : 'worker-card__dot--stopped';
    }
  }

  /**
   * Detect model family from model string.
   * @returns {'opus'|'sonnet'|'haiku'|null}
   */
  function detectModelFamily(model) {
    if (!model) return null;
    var m = model.toLowerCase();
    if (m.indexOf('opus') !== -1) return 'opus';
    if (m.indexOf('sonnet') !== -1) return 'sonnet';
    if (m.indexOf('haiku') !== -1) return 'haiku';
    return null;
  }

  /**
   * Format cost value to short string.
   */
  function formatCost(usd) {
    if (usd == null) return null;
    if (usd < 0.01) return '<$0.01';
    return '$' + usd.toFixed(2);
  }

  /**
   * Render a master ownership badge for a worker card.
   */
  function renderWorkerMasterBadge(w) {
    if (!w.config || !w.config._masterId) return '';
    var masterId = w.config._masterId;
    var label = getMasterLabel(masterId);
    var match = masterId.match(/master-(\d+)/);
    var idx = match ? parseInt(match[1]) - 1 : 0;
    var color = getMasterColor(Math.max(0, idx));
    return '<span class="worker-master-badge" style="background:' + color + '">' + label + '</span>';
  }

  /**
   * Create a worker card DOM element with embedded xterm mini-terminal.
   */
  function createWorkerCard(w) {
    var isRunning = w.status === 'running';
    var isStopped = w._stopped || w.status === 'stopped';
    var card = document.createElement('div');
    card.className = 'worker-card' + (isStopped ? ' worker-card--stopped' : '');
    card.setAttribute('data-id', w.id);

    // ── Header row ──────────────────────────────────────────
    var header = document.createElement('div');
    header.className = 'worker-card__header';

    var dot = document.createElement('span');
    dot.className = 'worker-card__dot ' + activityDotClass(w);
    header.appendChild(dot);

    var idSpan = document.createElement('span');
    idSpan.className = 'worker-card__id';
    idSpan.textContent = w.id;
    header.appendChild(idSpan);

    // Master ownership badge (Phase 66)
    var badgeHtml = renderWorkerMasterBadge(w);
    if (badgeHtml) {
      var badgeContainer = document.createElement('span');
      badgeContainer.innerHTML = badgeHtml;
      header.appendChild(badgeContainer.firstChild);
    }

    // Model badge
    var modelFamily = detectModelFamily(w.model);
    if (modelFamily) {
      var modelBadge = document.createElement('span');
      modelBadge.className = 'worker-card__model worker-card__model--' + modelFamily;
      modelBadge.textContent = modelFamily;
      header.appendChild(modelBadge);
    }

    // Quick actions (shown on hover for running workers)
    if (isRunning && !isStopped) {
      var actions = document.createElement('span');
      actions.className = 'worker-card__actions';

      var handoffBtn = document.createElement('button');
      handoffBtn.className = 'btn btn--xs btn--ghost';
      handoffBtn.title = 'Trigger context refresh';
      handoffBtn.textContent = 'Handoff';
      handoffBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        triggerHandoff(w.id);
      });
      actions.appendChild(handoffBtn);

      header.appendChild(actions);
    }

    if (isStopped) {
      var respawnBtn = document.createElement('button');
      respawnBtn.className = 'worker-card__respawn btn btn--xs btn--accent';
      respawnBtn.title = 'Respawn worker';
      respawnBtn.textContent = 'Respawn';
      respawnBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        respawnWorker(w);
      });
      header.appendChild(respawnBtn);

      var dismissBtn = document.createElement('button');
      dismissBtn.className = 'worker-card__dismiss btn btn--xs btn--ghost';
      dismissBtn.title = 'Dismiss';
      dismissBtn.textContent = '\u00d7';
      dismissBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        dismissWorker(w.id);
      });
      header.appendChild(dismissBtn);
    } else {
      var killBtn = document.createElement('button');
      killBtn.className = 'worker-card__kill btn btn--xs btn--ghost';
      killBtn.title = 'Kill worker';
      killBtn.textContent = '\u00d7';
      killBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        killWorker(w.id);
      });
      header.appendChild(killBtn);
    }

    card.appendChild(header);

    // ── Task line with priority badge ───────────────────────
    var taskDiv = document.createElement('div');
    if (w.assignedTask) {
      var taskLabel = w.assignedTask.task || w.assignedTask.taskId || w.assignedTask.id || '';
      taskDiv.className = 'worker-card__task';
      taskDiv.textContent = taskLabel;

      var priority = w.assignedTask.priority;
      if (priority != null && priority > 5) {
        var priBadge = document.createElement('span');
        priBadge.className = 'worker-card__priority';
        priBadge.textContent = 'P' + priority;
        taskDiv.appendChild(priBadge);
      }
    } else if (isRunning) {
      taskDiv.className = 'worker-card__task worker-card__task--idle';
      taskDiv.textContent = 'Idle';
    }
    card.appendChild(taskDiv);

    // ── Info row: cost | handoffs | context ──────────────────
    var info = document.createElement('div');
    info.className = 'worker-card__info';

    var costStr = formatCost(w._costUsd);
    if (costStr) {
      var costSpan = document.createElement('span');
      costSpan.className = 'worker-card__cost';
      costSpan.textContent = costStr;
      info.appendChild(costSpan);
    }

    if (w.handoffCount != null && w.handoffCount > 0) {
      var hoSpan = document.createElement('span');
      hoSpan.className = 'worker-card__handoffs';
      hoSpan.textContent = w.handoffCount + ' handoff' + (w.handoffCount !== 1 ? 's' : '');
      info.appendChild(hoSpan);
    }

    var ctxLabel = w.contextRefreshState ? w.contextRefreshState : 'healthy';
    var ctxSpan = document.createElement('span');
    ctxSpan.className = 'worker-card__ctx' + (w.contextRefreshState ? ' worker-card__ctx--refreshing' : '');
    ctxSpan.textContent = 'ctx: ' + ctxLabel;
    info.appendChild(ctxSpan);

    // Utilization: tasks completed
    if (w.utilization && w.utilization.tasksCompleted > 0) {
      var utilSpan = document.createElement('span');
      utilSpan.className = 'worker-card__util';
      utilSpan.textContent = w.utilization.tasksCompleted + ' done';
      info.appendChild(utilSpan);
    }

    if (info.children.length > 0) {
      card.appendChild(info);
    }

    // ── Capabilities pills ──────────────────────────────────
    if (w.capabilities && w.capabilities.length > 0) {
      var capsDiv = document.createElement('div');
      capsDiv.className = 'worker-card__caps';
      w.capabilities.forEach(function(cap) {
        var pill = document.createElement('span');
        pill.className = 'worker-card__cap';
        pill.textContent = cap;
        capsDiv.appendChild(pill);
      });
      card.appendChild(capsDiv);
    }

    // ── Meta row (status + age + exit info) ─────────────────
    var meta = document.createElement('div');
    meta.className = 'worker-card__meta';
    var statusSpan = document.createElement('span');
    statusSpan.textContent = w.status || 'unknown';
    meta.appendChild(statusSpan);
    if (w.spawnedAt) {
      var ageSpan = document.createElement('span');
      ageSpan.textContent = timeSince(new Date(w.spawnedAt));
      meta.appendChild(ageSpan);
    }
    card.appendChild(meta);

    // Exit code/signal for stopped workers
    if (isStopped && (w.exitCode != null || w.exitSignal)) {
      var exitDiv = document.createElement('div');
      exitDiv.className = 'worker-card__exit';
      var parts = [];
      if (w.exitCode != null) parts.push('exit ' + w.exitCode);
      if (w.exitSignal) parts.push(w.exitSignal);
      exitDiv.textContent = parts.join(' / ');
      card.appendChild(exitDiv);
    }

    // ── Mini-terminal container (expandable) ────────────────
    var termContainer = document.createElement('div');
    termContainer.className = 'worker-card__terminal';
    termContainer.id = 'worker-term-' + w.id;

    // Expand toggle icon
    var expandBtn = document.createElement('button');
    expandBtn.className = 'worker-card__expand';
    expandBtn.title = 'Expand/collapse terminal';
    expandBtn.innerHTML = '&#9650;';
    expandBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleWorkerExpand(w.id, termContainer, expandBtn);
    });
    termContainer.appendChild(expandBtn);

    card.appendChild(termContainer);

    // ── Inline prompt input for running workers ──────────────
    if (isRunning) {
      var promptDiv = document.createElement('div');
      promptDiv.className = 'worker-card__prompt';
      var textarea = document.createElement('textarea');
      textarea.placeholder = 'Send instruction...';
      textarea.rows = 1;
      textarea.addEventListener('click', function(e) { e.stopPropagation(); });
      textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          sendWorkerPrompt(w.id, textarea);
        }
      });
      promptDiv.appendChild(textarea);
      var sendBtnW = document.createElement('button');
      sendBtnW.className = 'btn btn--xs btn--accent';
      sendBtnW.textContent = 'Send';
      sendBtnW.addEventListener('click', function(e) {
        e.stopPropagation();
        sendWorkerPrompt(w.id, textarea);
      });
      promptDiv.appendChild(sendBtnW);
      card.appendChild(promptDiv);
    }

    // Click card to open in terminals page (same tab)
    card.addEventListener('click', function() {
      window.location.href = '/terminals?tab=' + encodeURIComponent(w.id);
    });

    // Init xterm.js mini-terminal after DOM insertion
    setTimeout(function() {
      initWorkerTerminal(w.id, termContainer);
      if (isRunning) {
        connectWorkerBinaryWs(w.id);
      }
    }, 50);

    return card;
  }

  /**
   * Toggle expand/collapse on a worker mini-terminal.
   */
  function toggleWorkerExpand(workerId, termContainer, expandBtn) {
    var expanded = termContainer.classList.toggle('worker-card__terminal--expanded');
    expandBtn.innerHTML = expanded ? '&#9660;' : '&#9650;';

    // Refit xterm after expand transition
    var entry = workerTerminals[workerId];
    if (entry && entry.fitAddon) {
      setTimeout(function() {
        try { entry.fitAddon.fit(); } catch(_) {}
      }, 220);
    }
  }

  /**
   * Trigger a context refresh / respawn for a worker.
   */
  async function triggerHandoff(workerId) {
    try {
      var resp = await fetch('/api/claude-terminals/' + encodeURIComponent(workerId) + '/respawn', { method: 'POST' });
      if (resp.ok) {
        if (window.showToast) window.showToast('Respawn triggered for ' + workerId, 'success');
        refreshWorkers();
      } else {
        var err = await resp.json().catch(function() { return {}; });
        if (window.showToast) window.showToast(err.error || 'Respawn failed', 'error');
      }
    } catch(e) {
      if (window.showToast) window.showToast('Respawn failed', 'error');
    }
  }

  /**
   * Update an existing worker card's metadata without recreating the xterm instance.
   */
  function updateWorkerCardMeta(card, w) {
    var isRunning = w.status === 'running';
    var isStopped = w._stopped || w.status === 'stopped';

    // Update stopped class
    card.classList.toggle('worker-card--stopped', isStopped);

    // Update activity dot
    var dot = card.querySelector('.worker-card__dot');
    if (dot) {
      dot.className = 'worker-card__dot ' + activityDotClass(w);
    }

    // Update model badge
    var modelFamily = detectModelFamily(w.model);
    var existingModel = card.querySelector('.worker-card__model');
    if (modelFamily && !existingModel) {
      var modelBadge = document.createElement('span');
      modelBadge.className = 'worker-card__model worker-card__model--' + modelFamily;
      modelBadge.textContent = modelFamily;
      var header = card.querySelector('.worker-card__header');
      var idEl = header && header.querySelector('.worker-card__id');
      if (idEl && idEl.nextSibling) {
        header.insertBefore(modelBadge, idEl.nextSibling);
      } else if (header) {
        header.appendChild(modelBadge);
      }
    } else if (modelFamily && existingModel) {
      existingModel.className = 'worker-card__model worker-card__model--' + modelFamily;
      existingModel.textContent = modelFamily;
    }

    // Update master ownership badge (Phase 66)
    var existingBadge = card.querySelector('.worker-master-badge');
    if (w.config && w.config._masterId && !existingBadge) {
      var badgeHtml = renderWorkerMasterBadge(w);
      if (badgeHtml) {
        var headerEl = card.querySelector('.worker-card__header');
        var idEl2 = headerEl && headerEl.querySelector('.worker-card__id');
        if (idEl2) {
          var tmp = document.createElement('span');
          tmp.innerHTML = badgeHtml;
          idEl2.insertAdjacentElement('afterend', tmp.firstChild);
        }
      }
    }

    // Update task info
    var taskDiv = card.querySelector('.worker-card__task');
    if (taskDiv) {
      if (w.assignedTask) {
        var taskLabel = w.assignedTask.task || w.assignedTask.taskId || w.assignedTask.id || '';
        taskDiv.className = 'worker-card__task';
        taskDiv.textContent = taskLabel;

        var priority = w.assignedTask.priority;
        if (priority != null && priority > 5) {
          var priBadge = document.createElement('span');
          priBadge.className = 'worker-card__priority';
          priBadge.textContent = 'P' + priority;
          taskDiv.appendChild(priBadge);
        }
      } else if (isRunning) {
        taskDiv.className = 'worker-card__task worker-card__task--idle';
        taskDiv.textContent = 'Idle';
      } else {
        taskDiv.className = 'worker-card__task';
        taskDiv.textContent = '';
      }
    }

    // Update info row (cost, handoffs, context)
    var infoRow = card.querySelector('.worker-card__info');
    if (infoRow) {
      // Update cost
      var costEl = infoRow.querySelector('.worker-card__cost');
      var costStr = formatCost(w._costUsd);
      if (costEl && costStr) {
        costEl.textContent = costStr;
      } else if (!costEl && costStr) {
        var cs = document.createElement('span');
        cs.className = 'worker-card__cost';
        cs.textContent = costStr;
        infoRow.insertBefore(cs, infoRow.firstChild);
      }

      // Update handoffs
      var hoEl = infoRow.querySelector('.worker-card__handoffs');
      if (hoEl && w.handoffCount != null) {
        hoEl.textContent = w.handoffCount + ' handoff' + (w.handoffCount !== 1 ? 's' : '');
      }

      // Update context state
      var ctxEl = infoRow.querySelector('.worker-card__ctx');
      if (ctxEl) {
        var ctxLabel = w.contextRefreshState ? w.contextRefreshState : 'healthy';
        ctxEl.textContent = 'ctx: ' + ctxLabel;
        ctxEl.classList.toggle('worker-card__ctx--refreshing', !!w.contextRefreshState);
      }
    }

    // Update capabilities
    var capsDiv = card.querySelector('.worker-card__caps');
    if (w.capabilities && w.capabilities.length > 0) {
      if (!capsDiv) {
        capsDiv = document.createElement('div');
        capsDiv.className = 'worker-card__caps';
        var metaDiv = card.querySelector('.worker-card__meta');
        if (metaDiv) {
          card.insertBefore(capsDiv, metaDiv);
        } else {
          card.appendChild(capsDiv);
        }
      }
      capsDiv.innerHTML = '';
      w.capabilities.forEach(function(cap) {
        var pill = document.createElement('span');
        pill.className = 'worker-card__cap';
        pill.textContent = cap;
        capsDiv.appendChild(pill);
      });
    } else if (capsDiv) {
      capsDiv.remove();
    }

    // Update utilization
    var utilEl = card.querySelector('.worker-card__util');
    if (w.utilization && w.utilization.tasksCompleted > 0) {
      if (!utilEl) {
        utilEl = document.createElement('span');
        utilEl.className = 'worker-card__util';
        var infoR = card.querySelector('.worker-card__info');
        if (infoR) infoR.appendChild(utilEl);
      }
      if (utilEl) utilEl.textContent = w.utilization.tasksCompleted + ' done';
    }

    // Update meta
    var meta = card.querySelector('.worker-card__meta');
    if (meta) {
      var spans = meta.querySelectorAll('span');
      if (spans[0]) spans[0].textContent = w.status || 'unknown';
      if (spans[1] && w.spawnedAt) spans[1].textContent = timeSince(new Date(w.spawnedAt));
    }

    // Connect binary WS if running and not yet connected
    if (isRunning && workerTerminals[w.id] && !workerTerminals[w.id].binaryWs) {
      connectWorkerBinaryWs(w.id);
    }
  }

  /**
   * Dismiss a stopped worker from the panel.
   */
  function dismissWorker(workerId) {
    delete seenWorkers[workerId];
    disposeWorkerTerminal(workerId);
    var card = document.querySelector('.worker-card[data-id="' + workerId + '"]');
    if (card) card.remove();

    // Check if list is now empty
    var list = document.getElementById('worker-list');
    var empty = document.getElementById('worker-empty');
    if (list && empty && !list.querySelector('.worker-card')) {
      empty.style.display = '';
    }
  }

  async function spawnWorker() {
    var workerId = 'worker-' + Math.random().toString(36).slice(2, 6);
    try {
      var resp = await fetch('/api/claude-terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: workerId,
          role: 'worker',
          autoDispatch: true,
          autoComplete: true,
          dangerouslySkipPermissions: true
        })
      });
      if (resp.ok) {
        if (window.showToast) window.showToast('Worker ' + workerId + ' spawned', 'success');
        refreshWorkers();
      } else {
        var err = await resp.json().catch(function() { return {}; });
        if (window.showToast) window.showToast(err.error || 'Failed to spawn worker', 'error');
      }
    } catch(e) {
      if (window.showToast) window.showToast('Failed to spawn worker', 'error');
    }
  }

  async function killWorker(workerId) {
    try {
      await fetch('/api/claude-terminals/' + encodeURIComponent(workerId), { method: 'DELETE' });
      if (window.showToast) window.showToast('Worker ' + workerId + ' killed', 'info');
      refreshWorkers();
    } catch(e) { /* non-critical */ }
  }

  /**
   * Send an instruction to a running worker via PTY input.
   */
  async function sendWorkerPrompt(workerId, textarea) {
    var text = textarea.value.trim();
    if (!text) return;
    try {
      var resp = await fetch('/api/claude-terminals/' + encodeURIComponent(workerId) + '/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: text + '\r' })
      });
      if (resp.ok) {
        textarea.value = '';
        if (window.showToast) window.showToast('Sent to ' + workerId, 'success');
      } else {
        var err = await resp.json().catch(function() { return {}; });
        if (window.showToast) window.showToast(err.error || 'Send failed', 'error');
      }
    } catch(e) {
      if (window.showToast) window.showToast('Send failed', 'error');
    }
  }

  /**
   * Respawn a stopped worker with a new ID and same config.
   */
  async function respawnWorker(w) {
    var newId = 'worker-' + Math.random().toString(36).slice(2, 6);
    try {
      var resp = await fetch('/api/claude-terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          role: 'worker',
          autoDispatch: w.autoDispatch !== false,
          autoComplete: w.autoComplete !== false,
          dangerouslySkipPermissions: w.dangerouslySkipPermissions !== false,
          capabilities: w.capabilities || undefined
        })
      });
      if (resp.ok) {
        dismissWorker(w.id);
        if (window.showToast) window.showToast('Respawned as ' + newId, 'success');
        refreshWorkers();
      } else {
        var err = await resp.json().catch(function() { return {}; });
        if (window.showToast) window.showToast(err.error || 'Respawn failed', 'error');
      }
    } catch(e) {
      if (window.showToast) window.showToast('Respawn failed', 'error');
    }
  }

  /**
   * Dismiss all stopped workers from the panel.
   */
  function dismissAllStopped() {
    var ids = Object.keys(seenWorkers).filter(function(id) {
      return seenWorkers[id]._stopped;
    });
    ids.forEach(function(id) { dismissWorker(id); });
    updateDismissAllButton();
  }

  /**
   * Show/hide the "Dismiss All Stopped" button based on stopped worker count.
   */
  function updateDismissAllButton() {
    var btn = document.getElementById('dismiss-all-btn');
    if (!btn) return;
    var stoppedCount = Object.keys(seenWorkers).filter(function(id) {
      return seenWorkers[id]._stopped;
    }).length;
    btn.style.display = stoppedCount > 0 ? '' : 'none';
  }

  // ── Status Bar ─────────────────────────────────────────────

  async function updateStatusBar(workerList) {
    // Task progress
    try {
      var resp = await fetch('/api/coordination/tasks');
      if (resp.ok) {
        var data = await resp.json();
        var tasks = data.tasks || data || [];
        var total = tasks.length;
        var complete = tasks.filter(function(t) { return t.status === 'complete'; }).length;
        var pct = total > 0 ? (complete / total * 100) : 0;

        document.getElementById('task-count').textContent = complete + '/' + total;
        document.getElementById('task-progress-fill').style.width = pct + '%';
      }
    } catch(e) { /* non-critical */ }

    // Cost
    try {
      var costResp = await fetch('/api/coordination/costs');
      if (costResp.ok) {
        var costData = await costResp.json();
        var totalCost = costData.globalTotalUsd || costData.totalUsd || 0;
        document.getElementById('cost-display').textContent = 'Cost: $' + totalCost.toFixed(2);
      }
    } catch(e) { /* non-critical */ }

    // Worker count with active indicator
    var runningWorkers = workerList ? workerList.filter(function(w) { return w.status === 'running'; }).length : 0;
    var activeWorkers = workerList ? workerList.filter(function(w) { return w.activityState === 'active'; }).length : 0;
    var workerText = 'Workers: ' + runningWorkers;
    if (activeWorkers > 0) workerText += ' (' + activeWorkers + ' active)';
    document.getElementById('worker-count-display').textContent = workerText;

    // Master count (Phase 66)
    updateMasterCount();
  }

  // ── Utilities ──────────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function timeSince(date) {
    var secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 0) return 'just now';
    if (secs < 60) return secs + 's ago';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
    return Math.floor(secs / 86400) + 'd ago';
  }

  function debounce(fn, delay) {
    var timer;
    return function() {
      var ctx = this, args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
    };
  }

  // ── WebSocket Events ──────────────────────────────────────

  function setupWsEvents() {
    if (typeof createWS !== 'function') return;

    createWS(['claude-terminal:*', 'coord:task-*'], function(msg) {
      try {
        var type = msg.type || msg.event || '';
        var data = msg.data || {};

        // Real-time activity state change — update worker card dot immediately
        if (type === 'claude-terminal:activity-changed') {
          var termId = data.terminalId || data.id;
          if (termId && !masters[termId]) {
            updateWorkerActivityDot(termId, data.state, data.previousState, data.assignedTask);
            appendLiveFeedEntry(termId, data.state, data.previousState, data.assignedTask);
          }
          return; // skip full refresh for activity changes (handled inline)
        }

        // Refresh workers on terminal or task events
        if (type.startsWith('claude-terminal:') || type.startsWith('coord:task-')) {
          refreshWorkers();
        }

        // Append to live feed for significant terminal events
        if (type === 'claude-terminal:spawned') {
          appendLiveFeedEntry(data.terminalId || data.id, 'spawned', null, null);
        } else if (type === 'claude-terminal:exit') {
          appendLiveFeedEntry(data.terminalId || data.id, 'stopped', null, null);
        } else if (type === 'claude-terminal:task-assigned') {
          appendLiveFeedEntry(data.terminalId || data.id, 'task-assigned', null, data.task || data.taskId);
        } else if (type === 'claude-terminal:task-completed') {
          appendLiveFeedEntry(data.terminalId || data.id, 'task-completed', null, data.task || data.taskId);
        }

        // Handle master terminal exit (Phase 66 — multi-master)
        if (type === 'claude-terminal:exit') {
          var exitId = data.id || data.terminalId;
          if (exitId && masters[exitId]) {
            // Master exited — the disconnect handler will try reconnect
            // If it times out, removeMasterTab will be called
          }
        }
      } catch(e) { /* ignore parse errors */ }
    }, { trackStatus: true });
  }

  /**
   * Update a specific worker card's activity dot without a full refresh.
   */
  function updateWorkerActivityDot(terminalId, state, previousState, taskLabel) {
    var card = document.querySelector('.worker-card[data-id="' + terminalId + '"]');
    if (!card) return;

    var dot = card.querySelector('.worker-card__dot');
    if (dot) {
      var dotClass = 'worker-card__dot ';
      switch (state) {
        case 'active':  dotClass += 'worker-card__dot--active'; break;
        case 'idle':    dotClass += 'worker-card__dot--idle'; break;
        case 'waiting': dotClass += 'worker-card__dot--waiting'; break;
        case 'stopped': dotClass += 'worker-card__dot--stopped'; break;
        default:        dotClass += 'worker-card__dot--running'; break;
      }
      dot.className = dotClass;
    }

    // Update task line if transitioning to waiting
    var taskDiv = card.querySelector('.worker-card__task');
    if (taskDiv) {
      if (state === 'idle' && !taskLabel) {
        taskDiv.className = 'worker-card__task worker-card__task--idle';
        taskDiv.textContent = 'Idle';
      }
    }

    // Update local workers cache
    if (workers[terminalId]) {
      workers[terminalId].activityState = state;
    }
    if (seenWorkers[terminalId]) {
      seenWorkers[terminalId].activityState = state;
    }
  }

  // ── Live Feed ──────────────────────────────────────────────

  var liveFeedCount = 0;
  var MAX_LIVE_FEED_ENTRIES = 50;

  var FEED_LABELS = {
    'active':         { icon: '\u25cf', color: '#10b981', text: 'active' },
    'idle':           { icon: '\u25cb', color: '#f59e0b', text: 'idle' },
    'waiting':        { icon: '\u25d4', color: '#6366f1', text: 'waiting' },
    'stopped':        { icon: '\u25a0', color: '#ef4444', text: 'stopped' },
    'spawned':        { icon: '+',     color: '#10b981', text: 'spawned' },
    'task-assigned':  { icon: '\u2192', color: '#22d3ee', text: 'task assigned' },
    'task-completed': { icon: '\u2713', color: '#4ade80', text: 'task completed' },
  };

  function appendLiveFeedEntry(terminalId, state, previousState, taskLabel) {
    var list = document.getElementById('live-feed-list');
    var countEl = document.getElementById('live-feed-count');
    if (!list) return;

    var entry = document.createElement('div');
    entry.className = 'console-livefeed__entry';

    var info = FEED_LABELS[state] || { icon: '\u00b7', color: '#999', text: state };

    var timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    var transitionText = previousState ? (previousState + ' \u2192 ' + state) : info.text;
    var taskText = taskLabel ? ' \u2014 ' + taskLabel : '';

    entry.innerHTML = '<span class="console-livefeed__time">' + escapeHtml(timestamp) + '</span>' +
      '<span class="console-livefeed__icon" style="color:' + info.color + '">' + info.icon + '</span>' +
      '<span class="console-livefeed__id">' + escapeHtml(terminalId) + '</span>' +
      '<span class="console-livefeed__text">' + escapeHtml(transitionText) + escapeHtml(taskText) + '</span>';

    list.insertBefore(entry, list.firstChild);

    // Trim old entries
    while (list.children.length > MAX_LIVE_FEED_ENTRIES) {
      list.removeChild(list.lastChild);
    }

    liveFeedCount++;
    if (countEl) countEl.textContent = liveFeedCount;
  }

  function initLiveFeed() {
    var toggle = document.getElementById('live-feed-toggle');
    var list = document.getElementById('live-feed-list');
    if (toggle && list) {
      toggle.addEventListener('click', function() {
        list.classList.toggle('console-livefeed__list--collapsed');
      });
    }
  }

  // ── Init Multi-Master (Phase 66) ─────────────────────────

  /**
   * On page load, fetch existing masters and reconnect to them.
   */
  async function initMultiMaster() {
    try {
      var res = await fetch('/api/claude-terminals/masters');
      if (!res.ok) return;
      var data = await res.json();
      var masterList = data.masters || [];

      masterList.forEach(function(master, idx) {
        if (master.status === 'running') {
          // Track the highest counter
          var match = master.id.match(/master-(\d+)/);
          if (match) {
            var num = parseInt(match[1]);
            if (num > masterCounter) masterCounter = num;
          }

          addMasterTab(master.id, idx);

          // Restore scrollback from raw ANSI output buffer
          var entry = masters[master.id];
          if (entry && entry.terminal) {
            fetch('/api/claude-terminals/' + encodeURIComponent(master.id) + '/output?lines=500&raw=1')
              .then(function(resp) { return resp.ok ? resp.json() : null; })
              .then(function(outputData) {
                if (outputData && outputData.lines && outputData.lines.length > 0 && entry.terminal) {
                  entry.terminal.write(outputData.lines.join('\n'));
                  entry.terminal.scrollToBottom();
                }
              })
              .catch(function() { /* non-critical */ });
          }

          connectMasterBinaryWs(master.id);
          if (!activeMasterId) switchToMaster(master.id);
        }
      });

      updateMasterCount();
    } catch (err) {
      // Masters API not available — that's fine, proceed without
    }
  }

  // ── Init ───────────────────────────────────────────────────

  async function init() {
    // Initialize multi-master — load existing masters
    await initMultiMaster();

    // Button handlers (Phase 66: start-master-btn now spawns a new master)
    document.getElementById('start-master-btn').addEventListener('click', spawnMaster);
    document.getElementById('stop-master-btn').addEventListener('click', function() { stopMaster(); });
    document.getElementById('add-master-btn').addEventListener('click', spawnMaster);
    document.getElementById('spawn-worker-btn').addEventListener('click', spawnWorker);
    document.getElementById('dismiss-all-btn').addEventListener('click', dismissAllStopped);

    // Prompt input handlers
    document.getElementById('enhance-prompt-btn').addEventListener('click', enhancePrompt);
    document.getElementById('send-prompt-btn').addEventListener('click', sendInitialPrompt);
    document.getElementById('skip-prompt-btn').addEventListener('click', skipPrompt);
    document.getElementById('revert-prompt-btn').addEventListener('click', revertPrompt);
    document.getElementById('master-prompt-input').addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        enhancePrompt();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        sendInitialPrompt();
      }
    });

    // Quick action handlers
    document.getElementById('swarm-btn').addEventListener('click', toggleSwarm);
    document.getElementById('create-task-btn').addEventListener('click', showCreateTask);
    document.getElementById('toggle-tasks-btn').addEventListener('click', toggleTaskPanel);
    document.getElementById('health-btn').addEventListener('click', checkHealth);

    // Task panel handlers
    document.getElementById('close-task-panel-btn').addEventListener('click', function() {
      document.getElementById('task-panel').style.display = 'none';
    });
    document.getElementById('create-task-form').addEventListener('submit', submitCreateTask);
    document.getElementById('cancel-task-btn').addEventListener('click', function() {
      document.getElementById('create-task-dialog').close();
    });

    // Check swarm status on load
    checkSwarmStatus();

    // Initial worker refresh + periodic polling
    refreshWorkers();
    workerRefreshTimer = setInterval(refreshWorkers, 5000);

    // Real-time WS events + live feed
    setupWsEvents();
    initLiveFeed();

    // Resize handler — fit the active master terminal
    var resizeHandler = debounce(function() {
      if (activeMasterId && masters[activeMasterId]) {
        try { masters[activeMasterId].fitAddon.fit(); } catch(_) {}
      }
    }, 100);
    window.addEventListener('resize', resizeHandler);

    // Refit terminals when page is restored from cache
    document.addEventListener('terminal-page-restored', function(e) {
      if (e.detail && e.detail.page === '/console') {
        // Use rAF + setTimeout to ensure CSS layout is complete before measuring
        requestAnimationFrame(function() {
          setTimeout(function() {
            if (activeMasterId && masters[activeMasterId]) {
              try { masters[activeMasterId].fitAddon.fit(); } catch (_) {}
            }
            Object.keys(workerTerminals).forEach(function(id) {
              var entry = workerTerminals[id];
              if (entry && entry.fitAddon) {
                try { entry.fitAddon.fit(); } catch (_) {}
              }
            });
          }, 50);
        });
      }
    });

    // Register cleanup for HTMX navigation away (uses app.js page cleanup system)
    // For cached pages, these run only when the cache is disposed, not on initial detach.
    if (typeof onPageCleanup === 'function') {
      onPageCleanup(cleanup);
    }
    window.addEventListener('beforeunload', cleanup);
  }

  /**
   * Full cleanup — close all WS connections, dispose xterm instances, clear timers.
   * Called before page navigation (hx-boost swap or full reload).
   */
  function cleanup() {
    // Multi-master cleanup (Phase 66)
    Object.keys(masters).forEach(function(id) {
      var entry = masters[id];
      if (entry.onDataDisposable) { entry.onDataDisposable.dispose(); }
      if (entry.onResizeDisposable) { entry.onResizeDisposable.dispose(); }
      if (entry.binaryWs) { try { entry.binaryWs.close(); } catch(_) {} }
      if (entry.terminal) { try { entry.terminal.dispose(); } catch(_) {} }
      if (entry.reconnectTimer) { clearInterval(entry.reconnectTimer); }
    });
    masters = {};
    activeMasterId = null;

    // Worker terminals cleanup
    Object.keys(workerTerminals).forEach(function(id) { disposeWorkerTerminal(id); });

    // Clear polling timers
    if (workerRefreshTimer) { clearInterval(workerRefreshTimer); workerRefreshTimer = null; }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
