// ============================================================
// Master Console — Console Page JS (Phase 57)
// ============================================================
// Interactive master terminal + worker panel.
// Connects to Claude terminal PTY via binary WS.
// ============================================================

(function() {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  var masterTerminal = null;    // xterm.js Terminal instance
  var masterFitAddon = null;    // FitAddon instance
  var masterBinaryWs = null;    // Binary WS to master PTY
  var masterTerminalId = null;  // ID of the master terminal
  var masterOnDataDisposable = null;   // disposable from masterTerminal.onData()
  var masterOnResizeDisposable = null; // disposable from masterTerminal.onResize()
  var masterResizeHandler = null;      // bound window resize handler (for removal)
  var masterResizeObserver = null;     // ResizeObserver instance (for disconnect)
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

  // ── Master Terminal ────────────────────────────────────────

  function initMasterTerminal() {
    var container = document.getElementById('master-terminal-container');
    if (!container) return;

    masterTerminal = new Terminal({
      theme: MASTER_THEME,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 10000,
      convertEol: true,
      disableStdin: false
    });

    masterFitAddon = new FitAddon.FitAddon();
    masterTerminal.loadAddon(masterFitAddon);
    masterTerminal.open(container);

    // Slight delay to ensure container has dimensions before fitting
    setTimeout(function() {
      if (masterFitAddon) masterFitAddon.fit();
    }, 50);

    // Clean up any previous resize listeners before adding new ones
    if (masterResizeHandler) {
      window.removeEventListener('resize', masterResizeHandler);
    }
    if (masterResizeObserver) {
      masterResizeObserver.disconnect();
      masterResizeObserver = null;
    }

    // Resize handler (named reference for removal)
    masterResizeHandler = debounce(function() {
      if (masterFitAddon) masterFitAddon.fit();
    }, 100);
    window.addEventListener('resize', masterResizeHandler);

    // ResizeObserver for container size changes (e.g. panel drag)
    if (typeof ResizeObserver !== 'undefined') {
      masterResizeObserver = new ResizeObserver(debounce(function() {
        if (masterFitAddon) masterFitAddon.fit();
      }, 50));
      masterResizeObserver.observe(container);
    }
  }

  function connectMasterBinaryWs(terminalId) {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/ws/claude-terminal/' + encodeURIComponent(terminalId);

    masterBinaryWs = new WebSocket(url);
    masterBinaryWs.binaryType = 'arraybuffer';

    masterBinaryWs.onopen = function() {
      // Send initial resize
      if (masterFitAddon) {
        var dims = masterFitAddon.proposeDimensions();
        if (dims) {
          masterBinaryWs.send('\x01' + JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    };

    masterBinaryWs.onmessage = function(evt) {
      var data = typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data);

      // Check for control messages (0x01 prefix)
      if (data.length > 0 && data.charCodeAt(0) === 1) {
        try {
          var ctrl = JSON.parse(data.slice(1));
          if (ctrl.type === 'ping') {
            masterBinaryWs.send('\x01' + JSON.stringify({ type: 'pong' }));
          }
        } catch(e) { /* ignore malformed control */ }
        return;
      }

      if (masterTerminal) masterTerminal.write(data);
    };

    masterBinaryWs.onclose = function() {
      if (masterTerminal) {
        masterTerminal.write('\r\n\x1b[33m[Master terminal disconnected]\x1b[0m\r\n');
      }
      showMasterDisconnected();
    };

    masterBinaryWs.onerror = function() {
      if (masterTerminal) {
        masterTerminal.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n');
      }
    };

    // Dispose previous handlers to prevent stacking on reconnect
    if (masterOnDataDisposable) { masterOnDataDisposable.dispose(); masterOnDataDisposable = null; }
    if (masterOnResizeDisposable) { masterOnResizeDisposable.dispose(); masterOnResizeDisposable = null; }

    // User input -> WS
    masterOnDataDisposable = masterTerminal.onData(function(data) {
      if (masterBinaryWs && masterBinaryWs.readyState === WebSocket.OPEN) {
        masterBinaryWs.send(data);
      }
    });

    // Resize -> WS
    masterOnResizeDisposable = masterTerminal.onResize(function(size) {
      if (masterBinaryWs && masterBinaryWs.readyState === WebSocket.OPEN) {
        masterBinaryWs.send('\x01' + JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
      }
    });
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

  // ── Start / Stop Master ────────────────────────────────────

  async function startMaster() {
    var btn = document.getElementById('start-master-btn');
    btn.disabled = true;
    btn.textContent = 'Starting...';

    try {
      // Clear any lingering reconnect timer from a previous disconnect
      if (masterReconnectTimer) {
        clearInterval(masterReconnectTimer);
        masterReconnectTimer = null;
      }

      // Clean up any stale master terminal from previous session
      try {
        await fetch('/api/claude-terminals/master', { method: 'DELETE' });
      } catch(e) { /* ignore — may not exist */ }

      // Clean up local xterm if restarting
      if (masterOnDataDisposable) { masterOnDataDisposable.dispose(); masterOnDataDisposable = null; }
      if (masterOnResizeDisposable) { masterOnResizeDisposable.dispose(); masterOnResizeDisposable = null; }
      if (masterBinaryWs) { masterBinaryWs.close(); masterBinaryWs = null; }
      if (masterTerminal) { masterTerminal.dispose(); masterTerminal = null; }
      masterFitAddon = null;
      var container = document.getElementById('master-terminal-container');
      if (container) container.innerHTML = '';

      // Read master context for system prompt
      var systemPrompt = '';
      try {
        var contextResp = await fetch('/master-context.md');
        if (contextResp.ok) {
          systemPrompt = await contextResp.text();
        }
      } catch(e) { /* optional — proceed without context */ }

      // Spawn master terminal via API
      var resp = await fetch('/api/claude-terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'master',
          role: 'master',
          persistent: true,
          dangerouslySkipPermissions: true,
          autoHandoff: true,
          systemPrompt: systemPrompt.slice(0, 8000)
        })
      });

      if (!resp.ok) {
        var err = await resp.json().catch(function() { return { error: 'Unknown error' }; });
        throw new Error(err.error || 'Failed to spawn master');
      }

      var data = await resp.json();
      masterTerminalId = data.id;

      // Show terminal, hide placeholder
      document.getElementById('master-placeholder').style.display = 'none';
      document.getElementById('master-terminal-container').style.display = '';
      document.getElementById('start-master-btn').style.display = 'none';
      document.getElementById('stop-master-btn').style.display = '';
      document.getElementById('master-status').textContent = 'Master running';
      document.getElementById('master-status').classList.add('console-header__status--running');

      // Init xterm.js and connect binary WS
      initMasterTerminal();
      connectMasterBinaryWs(masterTerminalId);

      // Show prompt input for first instruction
      showPromptInput();

      if (window.showToast) window.showToast('Master terminal started', 'success');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Start Master';
      if (window.showToast) window.showToast(err.message, 'error');
    }
  }

  async function stopMaster() {
    if (!masterTerminalId) return;

    try {
      await fetch('/api/claude-terminals/' + encodeURIComponent(masterTerminalId), { method: 'DELETE' });

      // Clean up resources
      if (masterOnDataDisposable) { masterOnDataDisposable.dispose(); masterOnDataDisposable = null; }
      if (masterOnResizeDisposable) { masterOnResizeDisposable.dispose(); masterOnResizeDisposable = null; }
      if (masterBinaryWs) { masterBinaryWs.close(); masterBinaryWs = null; }
      if (masterTerminal) { masterTerminal.dispose(); masterTerminal = null; }
      masterFitAddon = null;
      masterTerminalId = null;

      // Reset UI
      document.getElementById('master-placeholder').style.display = '';
      document.getElementById('master-terminal-container').style.display = 'none';
      document.getElementById('master-terminal-container').innerHTML = '';
      document.getElementById('start-master-btn').style.display = '';
      document.getElementById('start-master-btn').disabled = false;
      document.getElementById('start-master-btn').textContent = 'Start Master';
      document.getElementById('stop-master-btn').style.display = 'none';
      document.getElementById('master-status').textContent = 'No master terminal';
      document.getElementById('master-status').classList.remove('console-header__status--running');

      if (window.showToast) window.showToast('Master terminal stopped', 'info');
    } catch (err) {
      if (window.showToast) window.showToast('Failed to stop master: ' + err.message, 'error');
    }
  }

  // ── Master Disconnect / Reconnect ────────────────────────

  var masterReconnectTimer = null;

  function showMasterDisconnected() {
    // Clean up WS (terminal stays visible with scrollback)
    if (masterBinaryWs) { masterBinaryWs = null; }

    // Update header status
    var statusEl = document.getElementById('master-status');
    if (statusEl) {
      statusEl.textContent = 'Master disconnected — checking for respawn...';
      statusEl.classList.remove('console-header__status--running');
    }

    // Hide prompt input if open
    hidePromptInput();

    // Poll for auto-handoff respawn — the pool may respawn the master under the same ID
    var attempts = 0;
    var maxAttempts = 15; // 15 attempts × 2s = 30s window
    if (masterReconnectTimer) clearInterval(masterReconnectTimer);

    masterReconnectTimer = setInterval(async function() {
      attempts++;
      try {
        var resp = await fetch('/api/claude-terminals/master');
        if (resp.ok) {
          var master = await resp.json();
          if (master.status === 'running') {
            // Master is back (auto-handoff respawned it)
            clearInterval(masterReconnectTimer);
            masterReconnectTimer = null;
            masterTerminalId = master.id;

            if (masterTerminal) {
              masterTerminal.write('\r\n\x1b[32m[Master respawned — reconnecting...]\x1b[0m\r\n');
            }

            // Reconnect binary WS to the new PTY
            connectMasterBinaryWs(masterTerminalId);

            // Update UI
            if (statusEl) {
              statusEl.textContent = 'Master running';
              statusEl.classList.add('console-header__status--running');
            }
            document.getElementById('start-master-btn').style.display = 'none';
            document.getElementById('stop-master-btn').style.display = '';

            if (window.showToast) window.showToast('Master auto-reconnected', 'success');
            return;
          }
        }
      } catch(e) { /* non-critical */ }

      // Update countdown
      if (statusEl) {
        var remaining = (maxAttempts - attempts) * 2;
        statusEl.textContent = 'Master disconnected — checking for respawn... (' + remaining + 's)';
      }

      if (attempts >= maxAttempts) {
        // Give up — show manual restart button
        clearInterval(masterReconnectTimer);
        masterReconnectTimer = null;

        if (statusEl) statusEl.textContent = 'Master disconnected';

        var startBtn = document.getElementById('start-master-btn');
        var stopBtn = document.getElementById('stop-master-btn');
        if (startBtn) {
          startBtn.style.display = '';
          startBtn.disabled = false;
          startBtn.textContent = 'Restart Master';
        }
        if (stopBtn) stopBtn.style.display = 'none';

        if (window.showToast) window.showToast('Master disconnected — click Restart to start fresh', 'warning');
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

  function sendInitialPrompt() {
    var ta = document.getElementById('master-prompt-input');
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) return;

    // Send to master terminal via binary WS
    if (masterBinaryWs && masterBinaryWs.readyState === WebSocket.OPEN) {
      masterBinaryWs.send(text + '\n');
      hidePromptInput();
      if (window.showToast) window.showToast('Prompt sent to master', 'success');
    } else {
      // WS not ready yet — retry after a short delay
      if (window.showToast) window.showToast('Waiting for terminal connection...', 'info');
      setTimeout(function() {
        if (masterBinaryWs && masterBinaryWs.readyState === WebSocket.OPEN) {
          masterBinaryWs.send(text + '\n');
          hidePromptInput();
          if (window.showToast) window.showToast('Prompt sent to master', 'success');
        } else {
          if (window.showToast) window.showToast('Terminal not connected — try again', 'error');
        }
      }, 1500);
    }
  }

  function skipPrompt() {
    hidePromptInput();
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
        return t.id !== 'master' && t.role !== 'master';
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

    // ── Meta row (status + age) ─────────────────────────────
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

    // Click card to open in terminals page
    card.addEventListener('click', function() {
      window.open('/terminals#' + encodeURIComponent(w.id), '_blank');
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
          if (termId && termId !== 'master') {
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

        // Handle master terminal exit
        if (type === 'claude-terminal:exit') {
          if (data.id === 'master' || data.id === masterTerminalId) {
            document.getElementById('master-status').textContent = 'Master exited';
            document.getElementById('master-status').classList.remove('console-header__status--running');
            document.getElementById('start-master-btn').style.display = '';
            document.getElementById('start-master-btn').disabled = false;
            document.getElementById('start-master-btn').textContent = 'Restart Master';
            document.getElementById('stop-master-btn').style.display = 'none';
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

  // ── Init ───────────────────────────────────────────────────

  async function init() {
    // Check if master terminal already exists
    try {
      var resp = await fetch('/api/claude-terminals/master');
      if (resp.ok) {
        var master = await resp.json();
        masterTerminalId = master.id;

        // Master exists — show terminal
        document.getElementById('master-placeholder').style.display = 'none';
        document.getElementById('master-terminal-container').style.display = '';
        document.getElementById('start-master-btn').style.display = 'none';
        document.getElementById('stop-master-btn').style.display = '';

        if (master.status === 'running') {
          document.getElementById('master-status').textContent = 'Master running';
          document.getElementById('master-status').classList.add('console-header__status--running');
        } else {
          document.getElementById('master-status').textContent = 'Master stopped';
          document.getElementById('start-master-btn').style.display = '';
          document.getElementById('start-master-btn').textContent = 'Restart Master';
          document.getElementById('stop-master-btn').style.display = 'none';
        }

        initMasterTerminal();

        // Restore scrollback from raw ANSI output buffer (preserves colors)
        try {
          var outputResp = await fetch('/api/claude-terminals/master/output?lines=500&raw=1');
          if (outputResp.ok) {
            var outputData = await outputResp.json();
            if (outputData.lines && outputData.lines.length > 0) {
              masterTerminal.write(outputData.lines.join('\n'));
              masterTerminal.scrollToBottom();
            }
          }
        } catch(e2) { /* non-critical */ }

        if (master.status === 'running') {
          connectMasterBinaryWs(masterTerminalId);
        }
      }
    } catch(e) { /* master does not exist yet — that's fine */ }

    // Button handlers
    document.getElementById('start-master-btn').addEventListener('click', startMaster);
    document.getElementById('stop-master-btn').addEventListener('click', stopMaster);
    document.getElementById('spawn-worker-btn').addEventListener('click', spawnWorker);

    // Prompt input handlers
    document.getElementById('send-prompt-btn').addEventListener('click', sendInitialPrompt);
    document.getElementById('skip-prompt-btn').addEventListener('click', skipPrompt);
    document.getElementById('master-prompt-input').addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === 'Enter') {
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

    // Refit terminals when page is restored from cache
    document.addEventListener('terminal-page-restored', function(e) {
      if (e.detail && e.detail.page === '/console') {
        if (masterFitAddon) {
          try { masterFitAddon.fit(); } catch (_) {}
        }
        Object.keys(workerTerminals).forEach(function(id) {
          var entry = workerTerminals[id];
          if (entry && entry.fitAddon) {
            try { entry.fitAddon.fit(); } catch (_) {}
          }
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
    // Master terminal cleanup
    if (masterOnDataDisposable) { masterOnDataDisposable.dispose(); masterOnDataDisposable = null; }
    if (masterOnResizeDisposable) { masterOnResizeDisposable.dispose(); masterOnResizeDisposable = null; }
    if (masterBinaryWs) { try { masterBinaryWs.close(); } catch(_) {} masterBinaryWs = null; }
    if (masterTerminal) { try { masterTerminal.dispose(); } catch(_) {} masterTerminal = null; }
    masterFitAddon = null;
    if (masterResizeHandler) { window.removeEventListener('resize', masterResizeHandler); masterResizeHandler = null; }
    if (masterResizeObserver) { masterResizeObserver.disconnect(); masterResizeObserver = null; }
    if (masterReconnectTimer) { clearInterval(masterReconnectTimer); masterReconnectTimer = null; }

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
