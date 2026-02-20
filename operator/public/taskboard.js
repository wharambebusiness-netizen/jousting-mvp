// ============================================================
// Task Board — Kanban UI for Coordination Tasks
// ============================================================
// Fetches tasks from /api/coordination/tasks, renders as cards
// in status columns. Real-time updates via WebSocket.
// Drag-and-drop for cancel (→ cancelled column implied) and retry.
// ============================================================

/* global createWS, showToast */

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────
  var tasks = {};           // id → task object
  var draggedId = null;     // currently dragged task id
  var refreshTimer = null;

  // ── DOM refs ────────────────────────────────────────────────
  var columns = {
    pending:  document.getElementById('col-pending'),
    assigned: document.getElementById('col-assigned'),
    running:  document.getElementById('col-running'),
    complete: document.getElementById('col-complete'),
    failed:   document.getElementById('col-failed'),
  };
  var counts = {
    pending:  document.getElementById('count-pending'),
    assigned: document.getElementById('count-assigned'),
    running:  document.getElementById('count-running'),
    complete: document.getElementById('count-complete'),
    failed:   document.getElementById('count-failed'),
  };
  var boardStatus   = document.getElementById('board-status');
  var boardEmpty    = document.getElementById('board-empty');
  var progressFill  = document.getElementById('progress-fill');
  var progressText  = document.getElementById('progress-text');
  var addTaskBtn    = document.getElementById('add-task-btn');
  var addTaskDialog = document.getElementById('add-task-dialog');
  var addTaskClose  = document.getElementById('add-task-close');
  var addTaskForm   = document.getElementById('add-task-form');

  // ── Helpers ─────────────────────────────────────────────────

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function relativeTime(iso) {
    if (!iso) return '';
    var diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return Math.round(diff / 1000) + 's ago';
    if (diff < 3600000) return Math.round(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.round(diff / 3600000) + 'h ago';
    return Math.round(diff / 86400000) + 'd ago';
  }

  function priorityLabel(p) {
    if (p >= 10) return 'high';
    if (p >= 5) return 'med';
    if (p >= 1) return 'low';
    return '';
  }

  // ── Card Rendering ──────────────────────────────────────────

  function renderCard(task) {
    var card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.id = task.id;
    card.setAttribute('draggable', 'true');

    var pri = priorityLabel(task.priority);
    var priHtml = pri
      ? '<span class="task-card__priority task-card__priority--' + pri + '">' + pri + '</span>'
      : '';

    var workerHtml = task.assignedTo
      ? '<span class="task-card__worker" title="Assigned to ' + escapeHtml(task.assignedTo) + '">' + escapeHtml(task.assignedTo) + '</span>'
      : '';

    var depsHtml = task.deps && task.deps.length
      ? '<span class="task-card__deps" title="Depends on: ' + escapeHtml(task.deps.join(', ')) + '">&#x1f517; ' + task.deps.length + '</span>'
      : '';

    var categoryHtml = task.category
      ? '<span class="task-card__category">' + escapeHtml(task.category) + '</span>'
      : '';

    var timeHtml = '';
    if (task.completedAt) {
      timeHtml = '<span class="task-card__time">done ' + relativeTime(task.completedAt) + '</span>';
    } else if (task.startedAt) {
      timeHtml = '<span class="task-card__time">started ' + relativeTime(task.startedAt) + '</span>';
    } else if (task.createdAt) {
      timeHtml = '<span class="task-card__time">created ' + relativeTime(task.createdAt) + '</span>';
    }

    var errorHtml = task.error
      ? '<div class="task-card__error" title="' + escapeHtml(task.error) + '">' + escapeHtml(task.error) + '</div>'
      : '';

    var actionsHtml = '';
    if (task.status === 'pending' || task.status === 'assigned') {
      actionsHtml += '<button class="task-card__action task-card__action--cancel" data-action="cancel" data-id="' + escapeHtml(task.id) + '" title="Cancel task">&times;</button>';
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      actionsHtml += '<button class="task-card__action task-card__action--retry" data-action="retry" data-id="' + escapeHtml(task.id) + '" title="Retry task">&#x21bb;</button>';
    }

    card.innerHTML =
      '<div class="task-card__header">' +
        '<span class="task-card__id">' + escapeHtml(task.id) + '</span>' +
        priHtml +
        (actionsHtml ? '<span class="task-card__actions">' + actionsHtml + '</span>' : '') +
      '</div>' +
      '<div class="task-card__desc">' + escapeHtml(task.task) + '</div>' +
      '<div class="task-card__meta">' +
        workerHtml + categoryHtml + depsHtml + timeHtml +
      '</div>' +
      errorHtml;

    // Cancelled tasks get visual treatment
    if (task.status === 'cancelled') {
      card.classList.add('task-card--cancelled');
    }

    // Drag events
    card.addEventListener('dragstart', function (e) {
      draggedId = task.id;
      card.classList.add('task-card--dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', task.id);
    });
    card.addEventListener('dragend', function () {
      draggedId = null;
      card.classList.remove('task-card--dragging');
      clearDropTargets();
    });

    return card;
  }

  // ── Board Rendering ─────────────────────────────────────────

  function renderBoard() {
    var taskList = Object.values(tasks);

    // Group by status (cancelled goes into failed column)
    var groups = { pending: [], assigned: [], running: [], complete: [], failed: [] };
    for (var i = 0; i < taskList.length; i++) {
      var t = taskList[i];
      var col = t.status === 'cancelled' ? 'failed' : t.status;
      if (groups[col]) groups[col].push(t);
    }

    // Sort: higher priority first, then by creation time
    function sortTasks(a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    }

    for (var status in groups) {
      groups[status].sort(sortTasks);
      var col = columns[status];
      if (!col) continue;

      col.innerHTML = '';
      if (groups[status].length === 0) {
        col.innerHTML = '<div class="task-board__col-empty">No tasks</div>';
      } else {
        for (var j = 0; j < groups[status].length; j++) {
          col.appendChild(renderCard(groups[status][j]));
        }
      }
      if (counts[status]) {
        counts[status].textContent = groups[status].length;
      }
    }

    // Progress bar
    var total = taskList.length;
    var done = (groups.complete || []).length;
    var failedCount = (groups.failed || []).length;
    if (total > 0) {
      var pct = Math.round(((done + failedCount) / total) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = done + ' / ' + total + ' tasks complete';
    } else {
      progressFill.style.width = '0%';
      progressText.textContent = '0 / 0 tasks';
    }

    // Empty state
    boardEmpty.style.display = total === 0 ? '' : 'none';
    document.getElementById('task-board').style.display = total === 0 ? 'none' : '';
    document.querySelector('.task-board__progress').style.display = total === 0 ? 'none' : '';
  }

  // ── Data Fetching ───────────────────────────────────────────

  function loadTasks() {
    fetch('/api/coordination/tasks')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        tasks = {};
        var arr = Array.isArray(data) ? data : [];
        for (var i = 0; i < arr.length; i++) {
          tasks[arr[i].id] = arr[i];
        }
        renderBoard();
      })
      .catch(function () {
        // Coordination not available — show empty
        tasks = {};
        renderBoard();
      });
  }

  function loadStatus() {
    fetch('/api/coordination/status')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.state) {
          boardStatus.textContent = data.state;
          boardStatus.className = 'task-board__status task-board__status--' + data.state;
        } else {
          boardStatus.textContent = 'unavailable';
          boardStatus.className = 'task-board__status task-board__status--stopped';
        }
      })
      .catch(function () {
        boardStatus.textContent = 'offline';
        boardStatus.className = 'task-board__status task-board__status--stopped';
      });
  }

  // ── Drag & Drop ─────────────────────────────────────────────

  function clearDropTargets() {
    var cols = document.querySelectorAll('.task-board__cards');
    for (var i = 0; i < cols.length; i++) {
      cols[i].classList.remove('task-board__cards--drop-target');
    }
  }

  function setupDropZones() {
    var allCols = document.querySelectorAll('.task-board__cards');
    for (var i = 0; i < allCols.length; i++) {
      (function (col) {
        col.addEventListener('dragover', function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          col.classList.add('task-board__cards--drop-target');
        });
        col.addEventListener('dragleave', function () {
          col.classList.remove('task-board__cards--drop-target');
        });
        col.addEventListener('drop', function (e) {
          e.preventDefault();
          col.classList.remove('task-board__cards--drop-target');
          var taskId = e.dataTransfer.getData('text/plain');
          var targetStatus = col.dataset.status;
          handleDrop(taskId, targetStatus);
        });
      })(allCols[i]);
    }
  }

  function handleDrop(taskId, targetStatus) {
    var task = tasks[taskId];
    if (!task) return;

    // Cancel: drop onto failed column from pending/assigned
    if (targetStatus === 'failed' && (task.status === 'pending' || task.status === 'assigned')) {
      cancelTask(taskId);
      return;
    }

    // Retry: drop onto pending column from failed
    if (targetStatus === 'pending' && (task.status === 'failed' || task.status === 'cancelled')) {
      retryTask(taskId);
      return;
    }

    // No other moves allowed
    if (typeof showToast === 'function') {
      showToast('Cannot move task to ' + targetStatus, 'error');
    }
  }

  // ── Task Actions ────────────────────────────────────────────

  function cancelTask(id) {
    fetch('/api/coordination/tasks/' + encodeURIComponent(id) + '/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled from task board' }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        if (typeof showToast === 'function') showToast('Task cancelled', 'success');
        loadTasks();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Cancel failed: ' + err.message, 'error');
      });
  }

  function retryTask(id) {
    fetch('/api/coordination/tasks/' + encodeURIComponent(id) + '/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        if (typeof showToast === 'function') showToast('Task queued for retry', 'success');
        loadTasks();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Retry failed: ' + err.message, 'error');
      });
  }

  function addTask(data) {
    fetch('/api/coordination/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || 'HTTP ' + r.status); });
        return r.json();
      })
      .then(function () {
        if (typeof showToast === 'function') showToast('Task added', 'success');
        addTaskDialog.close();
        addTaskForm.reset();
        loadTasks();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Add failed: ' + err.message, 'error');
      });
  }

  // ── Event Delegation (action buttons) ───────────────────────

  document.getElementById('task-board').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var id = btn.dataset.id;
    if (action === 'cancel') cancelTask(id);
    if (action === 'retry') retryTask(id);
  });

  // ── Add Task Dialog ─────────────────────────────────────────

  addTaskBtn.addEventListener('click', function () {
    addTaskDialog.showModal();
  });
  addTaskClose.addEventListener('click', function () {
    addTaskDialog.close();
  });
  addTaskForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(addTaskForm);
    var data = {
      id: fd.get('id').trim(),
      task: fd.get('task').trim(),
      priority: parseInt(fd.get('priority'), 10) || 0,
    };
    var cat = (fd.get('category') || '').trim();
    if (cat) data.category = cat;
    var depsStr = (fd.get('deps') || '').trim();
    if (depsStr) {
      data.deps = depsStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    addTask(data);
  });

  // ── WebSocket Real-Time Updates ─────────────────────────────

  if (typeof createWS === 'function') {
    createWS(['coord:*'], function (msg) {
      var ev = msg.event;
      var data = msg.data || {};

      if (ev === 'coord:assigned') {
        if (data.taskId && tasks[data.taskId]) {
          tasks[data.taskId].status = 'assigned';
          tasks[data.taskId].assignedTo = data.workerId || null;
          tasks[data.taskId].assignedAt = new Date().toISOString();
          renderBoard();
        } else {
          loadTasks();
        }
      } else if (ev === 'coord:task-complete') {
        if (data.taskId && tasks[data.taskId]) {
          tasks[data.taskId].status = 'complete';
          tasks[data.taskId].completedAt = new Date().toISOString();
          tasks[data.taskId].result = data.result || null;
          renderBoard();
        } else {
          loadTasks();
        }
      } else if (ev === 'coord:task-failed') {
        if (data.taskId && tasks[data.taskId]) {
          tasks[data.taskId].status = 'failed';
          tasks[data.taskId].completedAt = new Date().toISOString();
          tasks[data.taskId].error = data.error || 'Unknown error';
          renderBoard();
        } else {
          loadTasks();
        }
      } else if (ev === 'coord:started' || ev === 'coord:stopped' || ev === 'coord:draining') {
        loadStatus();
      } else if (ev === 'coord:all-complete') {
        loadTasks();
        if (typeof showToast === 'function') showToast('All tasks complete', 'success');
      }
    });
  }

  // ── Drop Zone Setup ─────────────────────────────────────────
  setupDropZones();

  // ── Initial Load + Polling ──────────────────────────────────
  loadTasks();
  loadStatus();
  refreshTimer = setInterval(function () {
    loadTasks();
    loadStatus();
  }, 10000);

  // Cleanup on page unload (SPA navigation)
  window.addEventListener('beforeunload', function () {
    if (refreshTimer) clearInterval(refreshTimer);
  });
})();
