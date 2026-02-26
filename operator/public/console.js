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

    // Resize handler
    window.addEventListener('resize', debounce(function() {
      if (masterFitAddon) masterFitAddon.fit();
    }, 100));

    // ResizeObserver for container size changes (e.g. panel drag)
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(debounce(function() {
        if (masterFitAddon) masterFitAddon.fit();
      }, 50)).observe(container);
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

    // User input -> WS
    masterTerminal.onData(function(data) {
      if (masterBinaryWs && masterBinaryWs.readyState === WebSocket.OPEN) {
        masterBinaryWs.send(data);
      }
    });

    // Resize -> WS
    masterTerminal.onResize(function(size) {
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
      // Clean up any stale master terminal from previous session
      try {
        await fetch('/api/claude-terminals/master', { method: 'DELETE' });
      } catch(e) { /* ignore — may not exist */ }

      // Clean up local xterm if restarting
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

  // ── Master Disconnect / Restart ──────────────────────────

  function showMasterDisconnected() {
    // Clean up WS (terminal stays visible with scrollback)
    if (masterBinaryWs) { masterBinaryWs = null; }

    // Update header status
    var statusEl = document.getElementById('master-status');
    if (statusEl) {
      statusEl.textContent = 'Master disconnected';
      statusEl.classList.remove('console-header__status--running');
    }

    // Show restart button, hide stop
    var startBtn = document.getElementById('start-master-btn');
    var stopBtn = document.getElementById('stop-master-btn');
    if (startBtn) {
      startBtn.style.display = '';
      startBtn.disabled = false;
      startBtn.textContent = 'Restart Master';
    }
    if (stopBtn) stopBtn.style.display = 'none';

    // Hide prompt input if open
    hidePromptInput();
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
    }

    hidePromptInput();
    if (window.showToast) window.showToast('Prompt sent to master', 'success');
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
          body: JSON.stringify({ workerCount: 3 })
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
      var resp = await fetch('/api/claude-terminals');
      if (!resp.ok) return;
      var data = await resp.json();
      var terminals = data.terminals || data || [];

      // Filter: keep only non-master terminals
      var workerList = terminals.filter(function(t) {
        return t.id !== 'master' && t.role !== 'master';
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
   * Create a worker card DOM element with embedded xterm mini-terminal.
   */
  function createWorkerCard(w) {
    var isRunning = w.status === 'running';
    var isStopped = w._stopped || w.status === 'stopped';
    var card = document.createElement('div');
    card.className = 'worker-card' + (isStopped ? ' worker-card--stopped' : '');
    card.setAttribute('data-id', w.id);

    // Header
    var header = document.createElement('div');
    header.className = 'worker-card__header';

    var dot = document.createElement('span');
    dot.className = 'worker-card__dot ' + (isRunning ? 'worker-card__dot--running' : 'worker-card__dot--stopped');
    header.appendChild(dot);

    var idSpan = document.createElement('span');
    idSpan.className = 'worker-card__id';
    idSpan.textContent = w.id;
    header.appendChild(idSpan);

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

    // Task info
    var taskDiv = document.createElement('div');
    if (w.assignedTask) {
      var taskLabel = w.assignedTask.task || w.assignedTask.taskId || w.assignedTask.id || '';
      taskDiv.className = 'worker-card__task';
      taskDiv.textContent = taskLabel;
    } else if (isRunning) {
      taskDiv.className = 'worker-card__task worker-card__task--idle';
      taskDiv.textContent = 'Idle';
    }
    card.appendChild(taskDiv);

    // Meta
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

    // Mini-terminal container
    var termContainer = document.createElement('div');
    termContainer.className = 'worker-card__terminal';
    termContainer.id = 'worker-term-' + w.id;
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
   * Update an existing worker card's metadata without recreating the xterm instance.
   */
  function updateWorkerCardMeta(card, w) {
    var isRunning = w.status === 'running';
    var isStopped = w._stopped || w.status === 'stopped';

    // Update stopped class
    card.classList.toggle('worker-card--stopped', isStopped);

    // Update dot
    var dot = card.querySelector('.worker-card__dot');
    if (dot) {
      dot.className = 'worker-card__dot ' + (isRunning ? 'worker-card__dot--running' : 'worker-card__dot--stopped');
    }

    // Update task info
    var taskDiv = card.querySelector('.worker-card__task');
    if (taskDiv) {
      if (w.assignedTask) {
        var taskLabel = w.assignedTask.task || w.assignedTask.taskId || w.assignedTask.id || '';
        taskDiv.className = 'worker-card__task';
        taskDiv.textContent = taskLabel;
      } else if (isRunning) {
        taskDiv.className = 'worker-card__task worker-card__task--idle';
        taskDiv.textContent = 'Idle';
      } else {
        taskDiv.className = 'worker-card__task';
        taskDiv.textContent = '';
      }
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

    // Worker count
    var runningWorkers = workerList ? workerList.filter(function(w) { return w.status === 'running'; }).length : 0;
    document.getElementById('worker-count-display').textContent = 'Workers: ' + runningWorkers;
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

        // Refresh workers on terminal or task events
        if (type.startsWith('claude-terminal:') || type.startsWith('coord:task-')) {
          refreshWorkers();
        }

        // Handle master terminal exit
        if (type === 'claude-terminal:exit') {
          var data = msg.data || {};
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

    // Real-time WS events
    setupWsEvents();

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
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
