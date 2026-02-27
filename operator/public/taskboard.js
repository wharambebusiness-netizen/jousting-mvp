// ============================================================
// Task Board — Kanban UI for Coordination Tasks (Phase 12-14)
// ============================================================
// Fetches tasks from /api/coordination/tasks, renders as cards
// in status columns. Real-time updates via WebSocket.
// Drag-and-drop for cancel (→ failed) and retry (→ pending).
//
// Phase 13 additions:
//   - Filter/search bar with text, status, priority, category
//   - Keyboard shortcuts (?, n, /, Esc, 1-5, a, d, r, g, k, t)
//   - Task detail/edit dialog (click card, PATCH to update)
//   - Batch select and batch cancel/retry operations
//
// Phase 14 additions:
//   - DAG dependency visualization (SVG graph view)
//   - Task templates (predefined DAG workflows)
//   - View toggle (Kanban / DAG)
// ============================================================

/* global createWS, showToast */

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────
  var tasks = {};           // id → task object
  var draggedId = null;     // currently dragged task id
  var refreshTimer = null;
  var wsHandle = null;      // WS connection handle for cleanup
  var selected = {};        // id → true for selected tasks
  var filterText = '';      // current search text
  var filterStatus = '';    // current status filter
  var filterPriority = '';  // current priority filter
  var filterCategory = '';  // current category filter
  var detailTaskId = null;  // task shown in detail dialog
  var currentView = 'kanban'; // 'kanban' or 'dag'
  var cachedGraph = null;     // last graph response from API
  var templateData = null;    // cached templates from API
  var selectedTemplate = null; // template being previewed

  // DAG Edit Mode (Phase 53)
  var dagEditMode = false;
  var dagEditSource = null;  // source node ID for edge drawing

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
  var boardStatus    = document.getElementById('board-status');
  var boardEmpty     = document.getElementById('board-empty');
  var progressFill   = document.getElementById('progress-fill');
  var progressText   = document.getElementById('progress-text');
  var addTaskBtn     = document.getElementById('add-task-btn');
  var addTaskDialog  = document.getElementById('add-task-dialog');
  var addTaskClose   = document.getElementById('add-task-close');
  var addTaskForm    = document.getElementById('add-task-form');
  var boardSearch    = document.getElementById('board-search');
  var filterStatusEl = document.getElementById('filter-status');
  var filterPriorityEl = document.getElementById('filter-priority');
  var filterCategoryEl = document.getElementById('filter-category');
  var filterCountEl  = document.getElementById('filter-count');
  var batchBar       = document.getElementById('batch-bar');
  var batchCountEl   = document.getElementById('batch-count');
  var detailDialog   = document.getElementById('detail-dialog');
  var shortcutsDialog = document.getElementById('shortcuts-dialog');
  var dagView        = document.getElementById('dag-view');
  var dagContainer   = document.getElementById('dag-container');
  var kanbanBoard    = document.getElementById('task-board');
  var viewKanbanBtn  = document.getElementById('view-kanban');
  var viewDagBtn     = document.getElementById('view-dag');
  var templateBtn    = document.getElementById('template-btn');
  var templateDialog = document.getElementById('template-dialog');

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

  function priorityBucket(p) {
    if (p >= 10) return 'high';
    if (p >= 5) return 'med';
    if (p >= 1) return 'low';
    return 'none';
  }

  // ── Filtering ───────────────────────────────────────────────

  function matchesFilter(task) {
    // Text search: match against id, task description, category, worker
    if (filterText) {
      var q = filterText.toLowerCase();
      var haystack = (task.id + ' ' + task.task + ' ' + (task.category || '') + ' ' + (task.assignedTo || '')).toLowerCase();
      if (haystack.indexOf(q) === -1) return false;
    }
    // Status filter
    if (filterStatus) {
      if (task.status !== filterStatus) return false;
    }
    // Priority filter
    if (filterPriority) {
      if (priorityBucket(task.priority) !== filterPriority) return false;
    }
    // Category filter
    if (filterCategory) {
      if ((task.category || '') !== filterCategory) return false;
    }
    return true;
  }

  function getFilteredTasks() {
    var all = Object.values(tasks);
    if (!filterText && !filterStatus && !filterPriority && !filterCategory) return all;
    var result = [];
    for (var i = 0; i < all.length; i++) {
      if (matchesFilter(all[i])) result.push(all[i]);
    }
    return result;
  }

  function updateCategoryDropdown() {
    var cats = {};
    var all = Object.values(tasks);
    for (var i = 0; i < all.length; i++) {
      if (all[i].category) cats[all[i].category] = true;
    }
    var sorted = Object.keys(cats).sort();
    var current = filterCategoryEl.value;
    // Preserve first option
    filterCategoryEl.innerHTML = '<option value="">All Categories</option>';
    for (var j = 0; j < sorted.length; j++) {
      var opt = document.createElement('option');
      opt.value = sorted[j];
      opt.textContent = sorted[j];
      filterCategoryEl.appendChild(opt);
    }
    filterCategoryEl.value = current;
  }

  function updateFilterCount(filtered, total) {
    if (filtered < total) {
      filterCountEl.textContent = 'Showing ' + filtered + ' of ' + total;
      filterCountEl.style.display = '';
    } else {
      filterCountEl.textContent = '';
      filterCountEl.style.display = 'none';
    }
  }

  // ── Selection ───────────────────────────────────────────────

  function toggleSelect(taskId) {
    if (selected[taskId]) {
      delete selected[taskId];
    } else {
      selected[taskId] = true;
    }
    updateSelectUI();
  }

  function clearSelection() {
    selected = {};
    updateSelectUI();
  }

  function selectAllVisible() {
    var filtered = getFilteredTasks();
    for (var i = 0; i < filtered.length; i++) {
      selected[filtered[i].id] = true;
    }
    updateSelectUI();
  }

  function updateSelectUI() {
    var count = Object.keys(selected).length;
    // Update batch bar
    if (count > 0) {
      batchBar.style.display = '';
      batchCountEl.textContent = count + ' selected';
    } else {
      batchBar.style.display = 'none';
    }
    // Update card visual selection
    var cards = document.querySelectorAll('.task-card');
    for (var i = 0; i < cards.length; i++) {
      if (selected[cards[i].dataset.id]) {
        cards[i].classList.add('task-card--selected');
      } else {
        cards[i].classList.remove('task-card--selected');
      }
    }
  }

  // ── Card Rendering ──────────────────────────────────────────

  function renderCard(task) {
    var card = document.createElement('div');
    card.className = 'task-card';
    if (selected[task.id]) card.className += ' task-card--selected';
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
    actionsHtml += '<input type="checkbox" class="task-card__checkbox" data-select="' + escapeHtml(task.id) + '"' + (selected[task.id] ? ' checked' : '') + ' title="Select task">';
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
        '<span class="task-card__actions">' + actionsHtml + '</span>' +
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
    var allTasks = Object.values(tasks);
    var filteredTasks = getFilteredTasks();

    // Group by status (cancelled goes into failed column)
    var groups = { pending: [], assigned: [], running: [], complete: [], failed: [] };
    for (var i = 0; i < filteredTasks.length; i++) {
      var t = filteredTasks[i];
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
      var colEl = columns[status];
      if (!colEl) continue;

      colEl.innerHTML = '';
      if (groups[status].length === 0) {
        colEl.innerHTML = '<div class="task-board__col-empty">No tasks</div>';
      } else {
        for (var j = 0; j < groups[status].length; j++) {
          colEl.appendChild(renderCard(groups[status][j]));
        }
      }
      if (counts[status]) {
        counts[status].textContent = groups[status].length;
      }
    }

    // Progress bar (uses all tasks, not filtered)
    var total = allTasks.length;
    var done = 0;
    var failedCount = 0;
    for (var k = 0; k < allTasks.length; k++) {
      if (allTasks[k].status === 'complete') done++;
      if (allTasks[k].status === 'failed' || allTasks[k].status === 'cancelled') failedCount++;
    }
    if (total > 0) {
      var pct = Math.round(((done + failedCount) / total) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = done + ' / ' + total + ' tasks complete';
    } else {
      progressFill.style.width = '0%';
      progressText.textContent = '0 / 0 tasks';
    }

    // Filter count
    updateFilterCount(filteredTasks.length, total);

    // Empty state
    boardEmpty.style.display = total === 0 ? '' : 'none';
    var hasTasks = total > 0;
    if (currentView === 'kanban') {
      kanbanBoard.style.display = hasTasks ? '' : 'none';
      dagView.style.display = 'none';
    } else {
      kanbanBoard.style.display = 'none';
      dagView.style.display = hasTasks ? '' : 'none';
    }
    document.querySelector('.task-board__progress').style.display = hasTasks ? '' : 'none';
    document.getElementById('board-filters').style.display = hasTasks ? '' : 'none';

    // Update category dropdown options
    updateCategoryDropdown();

    // Clean up selected tasks that no longer exist
    var selIds = Object.keys(selected);
    for (var s = 0; s < selIds.length; s++) {
      if (!tasks[selIds[s]]) delete selected[selIds[s]];
    }
    updateSelectUI();

    // Also refresh DAG if in DAG view
    if (currentView === 'dag') {
      loadGraph();
    }
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
        var arr = Array.isArray(data) ? data : (data && data.items ? data.items : []);
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

  function updateTask(id, fields) {
    fetch('/api/coordination/tasks/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || 'HTTP ' + r.status); });
        return r.json();
      })
      .then(function () {
        if (typeof showToast === 'function') showToast('Task updated', 'success');
        detailDialog.close();
        loadTasks();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Update failed: ' + err.message, 'error');
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

  // ── Batch Operations ────────────────────────────────────────

  function batchCancel() {
    var ids = Object.keys(selected).filter(function (id) {
      var t = tasks[id];
      return t && (t.status === 'pending' || t.status === 'assigned');
    });
    if (ids.length === 0) {
      if (typeof showToast === 'function') showToast('No cancellable tasks selected', 'error');
      return;
    }
    fetch('/api/bulk/tasks/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids }),
    })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (typeof showToast === 'function') showToast('Cancelled ' + body.succeeded + '/' + body.total + ' tasks', body.failed > 0 ? 'warning' : 'success');
        loadTasks();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Batch cancel failed: ' + err.message, 'error');
      });
    clearSelection();
  }

  function batchRetry() {
    var ids = Object.keys(selected).filter(function (id) {
      var t = tasks[id];
      return t && (t.status === 'failed' || t.status === 'cancelled');
    });
    if (ids.length === 0) {
      if (typeof showToast === 'function') showToast('No retryable tasks selected', 'error');
      return;
    }
    fetch('/api/bulk/tasks/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids }),
    })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (typeof showToast === 'function') showToast('Retried ' + body.succeeded + '/' + body.total + ' tasks', body.failed > 0 ? 'warning' : 'success');
        loadTasks();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Batch retry failed: ' + err.message, 'error');
      });
    clearSelection();
  }

  // ── Task Detail/Edit Dialog ─────────────────────────────────

  function openDetail(taskId) {
    var task = tasks[taskId];
    if (!task) return;
    detailTaskId = taskId;

    document.getElementById('detail-title').textContent = 'Task: ' + task.id;
    document.getElementById('detail-id').textContent = task.id;
    document.getElementById('detail-status').textContent = task.status;
    document.getElementById('detail-worker').textContent = task.assignedTo || '—';
    // Render deps — editable chips for pending/assigned tasks (Phase 53)
    var editable = task.status === 'pending' || task.status === 'assigned';
    var depsEl = document.getElementById('detail-deps');
    if (editable && task.deps) {
      var depsHtml = '';
      for (var di = 0; di < task.deps.length; di++) {
        var depIdStr = task.deps[di];
        depsHtml += '<span class="dep-chip">' + escapeHtml(depIdStr) +
          ' <span class="dep-chip__remove" data-remove-dep="' + escapeHtml(depIdStr) + '" title="Remove dependency">&times;</span></span>';
      }
      if (task.deps.length === 0) depsHtml = '—';
      depsHtml += ' <span class="dep-add-autocomplete" id="dep-add-wrap">' +
        '<button class="btn btn--sm" id="dep-add-btn" type="button" title="Add dependency">+ Dep</button>' +
        '<div class="dep-add-autocomplete__list" id="dep-add-list" style="display:none"></div></span>';
      depsEl.innerHTML = depsHtml;

      // Remove dep click handlers
      depsEl.querySelectorAll('[data-remove-dep]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var removeId = btn.getAttribute('data-remove-dep');
          fetch('/api/coordination/tasks/' + encodeURIComponent(taskId) + '/deps/' + encodeURIComponent(removeId), { method: 'DELETE' })
            .then(function (r) {
              if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || 'HTTP ' + r.status); });
              return r.json();
            })
            .then(function (updatedTask) {
              if (typeof showToast === 'function') showToast('Dep removed', 'success');
              tasks[taskId] = updatedTask;
              openDetail(taskId);
              loadTasks();
            })
            .catch(function (err) {
              if (typeof showToast === 'function') showToast(err.message, 'error');
            });
        });
      });

      // Add dep button + autocomplete
      var addBtn = document.getElementById('dep-add-btn');
      var addList = document.getElementById('dep-add-list');
      if (addBtn && addList) {
        addBtn.addEventListener('click', function () {
          if (addList.style.display !== 'none') { addList.style.display = 'none'; return; }
          // Populate with available tasks (not self, not already a dep)
          var items = '';
          var taskIds = Object.keys(tasks);
          for (var ti = 0; ti < taskIds.length; ti++) {
            var tid = taskIds[ti];
            if (tid === taskId) continue;
            if (task.deps && task.deps.indexOf(tid) !== -1) continue;
            items += '<div class="dep-add-autocomplete__item" data-add-dep="' + escapeHtml(tid) + '">' + escapeHtml(tid) + '</div>';
          }
          addList.innerHTML = items || '<div class="dep-add-autocomplete__item" style="opacity:.5">No tasks available</div>';
          addList.style.display = '';
        });
        addList.addEventListener('click', function (ev) {
          var item = ev.target.closest('[data-add-dep]');
          if (!item) return;
          var newDepId = item.getAttribute('data-add-dep');
          addList.style.display = 'none';
          fetch('/api/coordination/tasks/' + encodeURIComponent(taskId) + '/deps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ depId: newDepId }),
          })
            .then(function (r) {
              if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || 'HTTP ' + r.status); });
              return r.json();
            })
            .then(function (updatedTask) {
              if (typeof showToast === 'function') showToast('Dep added', 'success');
              tasks[taskId] = updatedTask;
              openDetail(taskId);
              loadTasks();
            })
            .catch(function (err) {
              if (typeof showToast === 'function') showToast(err.message, 'error');
            });
        });
      }
    } else {
      depsEl.textContent = task.deps && task.deps.length ? task.deps.join(', ') : '—';
    }
    document.getElementById('detail-created').textContent = task.createdAt || '—';
    document.getElementById('detail-started').textContent = task.startedAt || '—';
    document.getElementById('detail-completed').textContent = task.completedAt || '—';

    var resultRow = document.getElementById('detail-result-row');
    var errorRow = document.getElementById('detail-error-row');
    if (task.result) {
      document.getElementById('detail-result').textContent = typeof task.result === 'string' ? task.result : JSON.stringify(task.result);
      resultRow.style.display = '';
    } else {
      resultRow.style.display = 'none';
    }
    if (task.error) {
      document.getElementById('detail-error').textContent = task.error;
      errorRow.style.display = '';
    } else {
      errorRow.style.display = 'none';
    }

    // Editable only for pending/assigned (editable var declared above for dep chips)
    var detailForm = document.getElementById('detail-form');
    var saveBtn = document.getElementById('detail-save-btn');
    if (editable) {
      detailForm.style.display = '';
      saveBtn.style.display = '';
      document.getElementById('detail-task-input').value = task.task || '';
      document.getElementById('detail-priority-input').value = String(task.priority || 0);
      document.getElementById('detail-category-input').value = task.category || '';
    } else {
      detailForm.style.display = 'none';
      saveBtn.style.display = 'none';
    }

    detailDialog.showModal();
  }

  function saveDetail() {
    if (!detailTaskId) return;
    var fields = {
      task: document.getElementById('detail-task-input').value.trim(),
      priority: parseInt(document.getElementById('detail-priority-input').value, 10) || 0,
      category: document.getElementById('detail-category-input').value.trim() || null,
    };
    updateTask(detailTaskId, fields);
  }

  // ── View Toggle ────────────────────────────────────────────

  function switchView(view) {
    currentView = view;
    if (view === 'kanban') {
      viewKanbanBtn.classList.add('task-board__view-btn--active');
      viewDagBtn.classList.remove('task-board__view-btn--active');
      kanbanBoard.style.display = '';
      dagView.style.display = 'none';
    } else {
      viewDagBtn.classList.add('task-board__view-btn--active');
      viewKanbanBtn.classList.remove('task-board__view-btn--active');
      kanbanBoard.style.display = 'none';
      dagView.style.display = '';
      loadGraph();
    }
  }

  viewKanbanBtn.addEventListener('click', function () { switchView('kanban'); });
  viewDagBtn.addEventListener('click', function () { switchView('dag'); });

  // ── DAG Visualization ──────────────────────────────────────

  var DAG_NODE_W = 160;
  var DAG_NODE_H = 52;
  var DAG_COL_GAP = 60;
  var DAG_ROW_GAP = 24;
  var DAG_PAD = 32;

  var DAG_STATUS_CLASS = {
    pending: 'pending',
    assigned: 'assigned',
    running: 'running',
    complete: 'complete',
    failed: 'failed',
    cancelled: 'cancelled',
  };

  function loadGraph() {
    fetch('/api/coordination/graph')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (graph) {
        cachedGraph = graph;
        renderDAG(graph);
      })
      .catch(function () {
        dagContainer.innerHTML = '<div class="task-board__dag-empty">No dependency graph available.</div>';
      });
  }

  function renderDAG(graph) {
    if (!graph || !graph.nodes || graph.nodes.length === 0) {
      dagContainer.innerHTML = '<div class="task-board__dag-empty">No tasks to visualize.</div>';
      return;
    }

    var levels = graph.levels || [];
    if (levels.length === 0) {
      // Fallback: all nodes in one level
      levels = [graph.nodes.slice()];
    }

    // Build lookup: nodeId → task data
    var taskMap = {};
    for (var i = 0; i < graph.nodes.length; i++) {
      var nid = graph.nodes[i];
      taskMap[nid] = tasks[nid] || { id: nid, task: nid, status: 'pending', deps: [] };
    }

    // Calculate node positions: x by level, y by index within level
    var positions = {};
    var maxRows = 0;
    for (var li = 0; li < levels.length; li++) {
      if (levels[li].length > maxRows) maxRows = levels[li].length;
    }

    for (var lj = 0; lj < levels.length; lj++) {
      var level = levels[lj];
      var levelHeight = level.length * (DAG_NODE_H + DAG_ROW_GAP) - DAG_ROW_GAP;
      var totalHeight = maxRows * (DAG_NODE_H + DAG_ROW_GAP) - DAG_ROW_GAP;
      var yOffset = (totalHeight - levelHeight) / 2;
      for (var ni = 0; ni < level.length; ni++) {
        positions[level[ni]] = {
          x: DAG_PAD + lj * (DAG_NODE_W + DAG_COL_GAP),
          y: DAG_PAD + yOffset + ni * (DAG_NODE_H + DAG_ROW_GAP),
        };
      }
    }

    // SVG dimensions
    var svgW = DAG_PAD * 2 + levels.length * (DAG_NODE_W + DAG_COL_GAP) - DAG_COL_GAP;
    var svgH = DAG_PAD * 2 + maxRows * (DAG_NODE_H + DAG_ROW_GAP) - DAG_ROW_GAP;
    if (svgW < 300) svgW = 300;
    if (svgH < 200) svgH = 200;

    // Build SVG elements
    var edgesHtml = '';
    var arrowsHtml = '';
    var nodesHtml = '';

    // Arrow marker def
    var defs = '<defs><marker id="dag-arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
      '<polygon points="0 0, 8 3, 0 6" class="dag-edge-arrow"/></marker>' +
      '<marker id="dag-arrowhead-done" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">' +
      '<polygon points="0 0, 8 3, 0 6" class="dag-edge-arrow dag-edge-arrow--complete"/></marker></defs>';

    // Render edges
    var edges = graph.edges || [];
    for (var ei = 0; ei < edges.length; ei++) {
      var edge = edges[ei];
      var fromPos = positions[edge.from];
      var toPos = positions[edge.to];
      if (!fromPos || !toPos) continue;

      var fromTask = taskMap[edge.from];
      var isDone = fromTask && fromTask.status === 'complete';
      var edgeClass = isDone ? 'dag-edge dag-edge--complete' : 'dag-edge';
      var markerId = isDone ? 'dag-arrowhead-done' : 'dag-arrowhead';

      // Bezier curve from right of source to left of target
      var x1 = fromPos.x + DAG_NODE_W;
      var y1 = fromPos.y + DAG_NODE_H / 2;
      var x2 = toPos.x;
      var y2 = toPos.y + DAG_NODE_H / 2;
      var cx1 = x1 + (x2 - x1) * 0.4;
      var cx2 = x2 - (x2 - x1) * 0.4;

      edgesHtml += '<path d="M ' + x1 + ' ' + y1 + ' C ' + cx1 + ' ' + y1 + ', ' + cx2 + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" class="' + edgeClass + '" data-from="' + escapeHtml(edge.from) + '" data-to="' + escapeHtml(edge.to) + '" marker-end="url(#' + markerId + ')"' + (dagEditMode ? ' style="cursor:pointer;pointer-events:stroke"' : '') + '/>';
    }

    // Render nodes
    for (var nk = 0; nk < graph.nodes.length; nk++) {
      var nodeId = graph.nodes[nk];
      var pos = positions[nodeId];
      if (!pos) continue;
      var task = taskMap[nodeId];
      var statusClass = DAG_STATUS_CLASS[task.status] || 'pending';
      var label = nodeId.length > 18 ? nodeId.substring(0, 16) + '..' : nodeId;
      var desc = (task.task || '').length > 22 ? task.task.substring(0, 20) + '..' : (task.task || '');

      nodesHtml += '<g class="dag-node" data-id="' + escapeHtml(nodeId) + '" transform="translate(' + pos.x + ',' + pos.y + ')">' +
        '<rect width="' + DAG_NODE_W + '" height="' + DAG_NODE_H + '" rx="6" class="dag-node__bg dag-node__bg--' + statusClass + '"/>' +
        '<circle cx="12" cy="14" r="4" class="dag-node__status-dot dag-node__bg--' + statusClass + '" fill="currentColor" style="fill:' + getStatusColor(statusClass) + '"/>' +
        '<text x="22" y="17" class="dag-node__label">' + escapeHtml(label) + '</text>' +
        '<text x="12" y="36" class="dag-node__desc">' + escapeHtml(desc) + '</text>' +
        '</g>';
    }

    dagContainer.innerHTML = '<svg viewBox="0 0 ' + svgW + ' ' + svgH + '" width="' + svgW + '" height="' + svgH + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Task dependency graph">' +
      defs + edgesHtml + nodesHtml + '</svg>';

    // Apply edit mode class if active
    if (dagEditMode) dagContainer.classList.add('dag-edit-mode');
    else dagContainer.classList.remove('dag-edit-mode');

    // Highlight source node in edit mode
    if (dagEditMode && dagEditSource) {
      var srcNode = dagContainer.querySelector('.dag-node[data-id="' + dagEditSource + '"]');
      if (srcNode) srcNode.classList.add('dag-node--source');
    }

    // Click handler for nodes
    var svgEl = dagContainer.querySelector('svg');
    if (svgEl) {
      svgEl.addEventListener('click', function (e) {
        var node = e.target.closest('.dag-node');

        if (dagEditMode) {
          if (!node || !node.dataset.id) {
            // Clicked empty space — cancel selection
            dagEditSource = null;
            dagContainer.querySelectorAll('.dag-node--source').forEach(function (n) { n.classList.remove('dag-node--source'); });
            return;
          }

          var clickedId = node.dataset.id;

          if (!dagEditSource) {
            // First click: set source
            dagEditSource = clickedId;
            node.classList.add('dag-node--source');
          } else {
            // Second click: add dep (target depends on source)
            var targetId = clickedId;
            if (targetId === dagEditSource) {
              // Clicked same node — cancel
              dagEditSource = null;
              dagContainer.querySelectorAll('.dag-node--source').forEach(function (n) { n.classList.remove('dag-node--source'); });
              return;
            }
            fetch('/api/coordination/tasks/' + encodeURIComponent(targetId) + '/deps', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ depId: dagEditSource }),
            })
              .then(function (r) {
                if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || 'HTTP ' + r.status); });
                return r.json();
              })
              .then(function () {
                if (typeof showToast === 'function') showToast('Dependency added', 'success');
                dagEditSource = null;
                loadGraph();
                loadTasks();
              })
              .catch(function (err) {
                if (typeof showToast === 'function') showToast(err.message, 'error');
                dagEditSource = null;
                dagContainer.querySelectorAll('.dag-node--source').forEach(function (n) { n.classList.remove('dag-node--source'); });
              });
          }
          return;
        }

        // Normal mode: open detail
        if (node && node.dataset.id) {
          openDetail(node.dataset.id);
        }
      });

      // Edge click handler for removing deps in edit mode
      svgEl.addEventListener('click', function (e) {
        if (!dagEditMode) return;
        var path = e.target.closest('.dag-edge');
        if (!path) return;

        // Toggle removing state on the edge
        if (path.classList.contains('dag-edge--removing')) {
          // Second click: actually remove the dep
          var fromId = path.dataset.from;
          var toId = path.dataset.to;
          if (fromId && toId) {
            fetch('/api/coordination/tasks/' + encodeURIComponent(toId) + '/deps/' + encodeURIComponent(fromId), {
              method: 'DELETE',
            })
              .then(function (r) {
                if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || 'HTTP ' + r.status); });
                return r.json();
              })
              .then(function () {
                if (typeof showToast === 'function') showToast('Dependency removed', 'success');
                loadGraph();
                loadTasks();
              })
              .catch(function (err) {
                if (typeof showToast === 'function') showToast(err.message, 'error');
              });
          }
        } else {
          // First click: highlight for removal
          svgEl.querySelectorAll('.dag-edge--removing').forEach(function (p) { p.classList.remove('dag-edge--removing'); });
          path.classList.add('dag-edge--removing');
        }
      });
    }

    // Render edit toolbar
    renderDagEditToolbar();
  }

  // ── DAG Edit Toolbar (Phase 53) ──────────────────────────

  function renderDagEditToolbar() {
    var existing = document.getElementById('dag-edit-toolbar');
    if (existing) existing.remove();

    if (currentView !== 'dag') return;

    var toolbar = document.createElement('div');
    toolbar.id = 'dag-edit-toolbar';
    toolbar.className = 'dag-edit-toolbar';

    var editBtn = document.createElement('button');
    editBtn.className = 'btn btn--sm' + (dagEditMode ? ' btn--active' : '');
    editBtn.textContent = dagEditMode ? 'Exit Edit' : 'Edit Deps';
    editBtn.title = 'Toggle DAG edit mode (e)';
    editBtn.addEventListener('click', function () {
      toggleDagEditMode();
    });
    toolbar.appendChild(editBtn);

    if (dagEditMode) {
      var hint = document.createElement('span');
      hint.style.fontSize = '0.8rem';
      hint.style.color = 'var(--text-muted)';
      hint.textContent = dagEditSource
        ? 'Click target node to add dep from "' + dagEditSource + '"'
        : 'Click source node, then target node to add dependency';
      toolbar.appendChild(hint);
    }

    dagView.insertBefore(toolbar, dagContainer);
  }

  function toggleDagEditMode() {
    dagEditMode = !dagEditMode;
    dagEditSource = null;
    if (cachedGraph) {
      renderGraph(cachedGraph);
    } else {
      renderDagEditToolbar();
    }
  }

  function getStatusColor(status) {
    var colors = {
      pending: '#636370',
      assigned: '#3b82f6',
      running: '#22c55e',
      complete: '#6366f1',
      failed: '#ef4444',
      cancelled: '#636370',
    };
    return colors[status] || '#636370';
  }

  // ── Task Templates ─────────────────────────────────────────

  function loadTemplates() {
    if (templateData) return;
    fetch('/api/coordination/templates')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        templateData = data;
      })
      .catch(function () {
        templateData = [];
      });
  }

  function openTemplateDialog() {
    loadTemplates();
    selectedTemplate = null;
    renderTemplateList();
    templateDialog.showModal();
  }

  function renderTemplateList() {
    var list = document.getElementById('template-list');
    var preview = document.getElementById('template-preview');
    var applyBtn = document.getElementById('template-apply-btn');
    var backBtn = document.getElementById('template-back');

    list.style.display = '';
    preview.style.display = 'none';
    applyBtn.style.display = 'none';
    backBtn.style.display = 'none';

    if (!templateData || templateData.length === 0) {
      list.innerHTML = '<div class="task-board__dag-empty">No templates available.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < templateData.length; i++) {
      var tmpl = templateData[i];
      html += '<div class="task-board__template-item" data-template="' + escapeHtml(tmpl.id) + '">' +
        '<div class="task-board__template-item-name">' + escapeHtml(tmpl.name) + '</div>' +
        '<div class="task-board__template-item-desc">' + escapeHtml(tmpl.description) + '</div>' +
        '<div class="task-board__template-item-count">' + tmpl.tasks.length + ' tasks</div>' +
        '</div>';
    }
    list.innerHTML = html;

    // Click handlers
    list.addEventListener('click', function handler(e) {
      var item = e.target.closest('[data-template]');
      if (!item) return;
      list.removeEventListener('click', handler);
      var tmplId = item.dataset.template;
      for (var j = 0; j < templateData.length; j++) {
        if (templateData[j].id === tmplId) {
          selectTemplate(templateData[j]);
          break;
        }
      }
    });
  }

  function selectTemplate(tmpl) {
    selectedTemplate = tmpl;
    var list = document.getElementById('template-list');
    var preview = document.getElementById('template-preview');
    var applyBtn = document.getElementById('template-apply-btn');
    var backBtn = document.getElementById('template-back');

    list.style.display = 'none';
    preview.style.display = '';
    applyBtn.style.display = '';
    backBtn.style.display = '';

    document.getElementById('template-preview-title').textContent = tmpl.name;
    document.getElementById('template-preview-desc').textContent = tmpl.description;
    document.getElementById('template-prefix').value = '';

    var tasksHtml = '';
    for (var i = 0; i < tmpl.tasks.length; i++) {
      var t = tmpl.tasks[i];
      var depsText = t.deps && t.deps.length ? 'deps: ' + t.deps.join(', ') : '';
      tasksHtml += '<div class="task-board__template-task">' +
        '<span class="task-board__template-task-id">' + escapeHtml(t.id) + '</span>' +
        '<span class="task-board__template-task-desc">' + escapeHtml(t.task) + '</span>' +
        (depsText ? '<span class="task-board__template-task-deps">' + escapeHtml(depsText) + '</span>' : '') +
        '</div>';
    }
    document.getElementById('template-preview-tasks').innerHTML = tasksHtml;
  }

  function applyTemplate() {
    if (!selectedTemplate) return;
    var prefix = (document.getElementById('template-prefix').value || '').trim();
    var batchTasks = [];
    for (var i = 0; i < selectedTemplate.tasks.length; i++) {
      var t = selectedTemplate.tasks[i];
      var taskDef = {
        id: prefix + t.id,
        task: t.task,
        priority: t.priority || 0,
      };
      if (t.category) taskDef.category = t.category;
      if (t.deps && t.deps.length) {
        taskDef.deps = [];
        for (var j = 0; j < t.deps.length; j++) {
          taskDef.deps.push(prefix + t.deps[j]);
        }
      }
      batchTasks.push(taskDef);
    }

    fetch('/api/coordination/tasks/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: batchTasks }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || 'HTTP ' + r.status); });
        return r.json();
      })
      .then(function (created) {
        var count = Array.isArray(created) ? created.length : 0;
        if (typeof showToast === 'function') showToast(count + ' tasks created from template', 'success');
        templateDialog.close();
        loadTasks();
      })
      .catch(function (err) {
        if (typeof showToast === 'function') showToast('Template failed: ' + err.message, 'error');
      });
  }

  // Template dialog event handlers
  templateBtn.addEventListener('click', function () { openTemplateDialog(); });
  document.getElementById('template-close').addEventListener('click', function () { templateDialog.close(); });
  document.getElementById('template-cancel-btn').addEventListener('click', function () { templateDialog.close(); });
  document.getElementById('template-apply-btn').addEventListener('click', function () { applyTemplate(); });
  document.getElementById('template-back').addEventListener('click', function () {
    selectedTemplate = null;
    renderTemplateList();
  });

  // ── Event Delegation (action buttons + card click) ──────────

  document.getElementById('task-board').addEventListener('click', function (e) {
    // Checkbox selection
    var cb = e.target.closest('[data-select]');
    if (cb) {
      e.stopPropagation();
      toggleSelect(cb.dataset.select);
      return;
    }
    // Action buttons
    var btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      var action = btn.dataset.action;
      var id = btn.dataset.id;
      if (action === 'cancel') cancelTask(id);
      if (action === 'retry') retryTask(id);
      return;
    }
    // Card click → detail dialog
    var card = e.target.closest('.task-card');
    if (card && card.dataset.id) {
      openDetail(card.dataset.id);
    }
  });

  // ── Filter Events ───────────────────────────────────────────

  boardSearch.addEventListener('input', function () {
    filterText = boardSearch.value.trim();
    renderBoard();
  });
  filterStatusEl.addEventListener('change', function () {
    filterStatus = filterStatusEl.value;
    renderBoard();
  });
  filterPriorityEl.addEventListener('change', function () {
    filterPriority = filterPriorityEl.value;
    renderBoard();
  });
  filterCategoryEl.addEventListener('change', function () {
    filterCategory = filterCategoryEl.value;
    renderBoard();
  });

  // ── Export Events (Phase 36) ─────────────────────────────────

  var exportBtn = document.getElementById('export-btn');
  var exportMenu = document.getElementById('export-menu');

  if (exportBtn && exportMenu) {
    exportBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      exportMenu.style.display = exportMenu.style.display === 'none' ? 'flex' : 'none';
    });

    // Close menu when clicking outside
    document.addEventListener('click', function () {
      if (exportMenu) exportMenu.style.display = 'none';
    });

    // Export option clicks
    exportMenu.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-format]');
      if (!btn) return;
      var format = btn.dataset.format;
      var url = '/api/export/tasks?format=' + encodeURIComponent(format);
      if (filterStatus) url += '&status=' + encodeURIComponent(filterStatus);
      if (filterCategory) url += '&category=' + encodeURIComponent(filterCategory);
      window.location.href = url;
      exportMenu.style.display = 'none';
    });
  }

  // ── Batch Bar Events ────────────────────────────────────────

  document.getElementById('batch-select-all').addEventListener('click', function () {
    selectAllVisible();
  });
  document.getElementById('batch-clear').addEventListener('click', function () {
    clearSelection();
  });
  document.getElementById('batch-cancel').addEventListener('click', function () {
    batchCancel();
  });
  document.getElementById('batch-retry').addEventListener('click', function () {
    batchRetry();
  });

  // ── Detail Dialog Events ────────────────────────────────────

  document.getElementById('detail-close').addEventListener('click', function () {
    detailDialog.close();
  });
  document.getElementById('detail-cancel-btn').addEventListener('click', function () {
    detailDialog.close();
  });
  document.getElementById('detail-save-btn').addEventListener('click', function () {
    saveDetail();
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

  // ── Category Auto-Detect (Phase 33) ───────────────────────────

  var addTaskDescInput = addTaskForm.querySelector('input[name="task"]');
  var addTaskCatInput = addTaskForm.querySelector('input[name="category"]');

  if (addTaskDescInput && addTaskCatInput) {
    addTaskDescInput.addEventListener('blur', function () {
      var desc = addTaskDescInput.value.trim();
      var cat = addTaskCatInput.value.trim();
      if (!desc || cat) return; // skip if no text or category already set
      fetch('/api/coordination/categories/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: desc }),
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data && data.category && !addTaskCatInput.value.trim()) {
            addTaskCatInput.value = data.category;
            addTaskCatInput.classList.add('auto-detected');
          }
        })
        .catch(function () { /* ignore detection errors */ });
    });

    addTaskCatInput.addEventListener('input', function () {
      addTaskCatInput.classList.remove('auto-detected');
    });
  }

  // ── Keyboard Shortcuts ──────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

    // Escape always works — close dialogs, clear search, cancel DAG edit
    if (e.key === 'Escape') {
      if (addTaskDialog.open) { addTaskDialog.close(); e.preventDefault(); return; }
      if (detailDialog.open) { detailDialog.close(); e.preventDefault(); return; }
      if (shortcutsDialog.open) { shortcutsDialog.close(); e.preventDefault(); return; }
      if (templateDialog.open) { templateDialog.close(); e.preventDefault(); return; }
      // Phase 53: cancel DAG edit source selection or exit edit mode
      if (dagEditMode) {
        if (dagEditSource) {
          dagEditSource = null;
          var dagEl = document.getElementById('dag-container');
          if (dagEl) dagEl.querySelectorAll('.dag-node--source').forEach(function (n) { n.classList.remove('dag-node--source'); });
          renderDagEditToolbar();
        } else {
          toggleDagEditMode();
        }
        e.preventDefault();
        return;
      }
      if (inInput && boardSearch === e.target) {
        boardSearch.value = '';
        filterText = '';
        boardSearch.blur();
        renderBoard();
        e.preventDefault();
        return;
      }
      return;
    }

    // Skip remaining shortcuts when in form fields
    if (inInput) return;

    // ? — help dialog
    if (e.key === '?') {
      shortcutsDialog.showModal();
      e.preventDefault();
      return;
    }

    // / — focus search
    if (e.key === '/') {
      boardSearch.focus();
      boardSearch.select();
      e.preventDefault();
      return;
    }

    // n — add task
    if (e.key === 'n' || e.key === 'N') {
      addTaskDialog.showModal();
      e.preventDefault();
      return;
    }

    // g — DAG view
    if (e.key === 'g' || e.key === 'G') {
      switchView('dag');
      e.preventDefault();
      return;
    }

    // k — Kanban view
    if (e.key === 'k' || e.key === 'K') {
      switchView('kanban');
      e.preventDefault();
      return;
    }

    // t — templates
    if (e.key === 't' || e.key === 'T') {
      openTemplateDialog();
      e.preventDefault();
      return;
    }

    // e — toggle DAG edit mode (Phase 53)
    if (e.key === 'e' || e.key === 'E') {
      if (currentView === 'dag') {
        toggleDagEditMode();
      } else {
        switchView('dag');
        dagEditMode = true;
        dagEditSource = null;
        loadGraph();
      }
      e.preventDefault();
      return;
    }

    // r — refresh
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
      loadTasks();
      loadStatus();
      if (typeof showToast === 'function') showToast('Refreshed', 'info');
      e.preventDefault();
      return;
    }

    // a — select all
    if (e.key === 'a' && !e.ctrlKey && !e.metaKey) {
      selectAllVisible();
      e.preventDefault();
      return;
    }

    // d — deselect all
    if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
      clearSelection();
      e.preventDefault();
      return;
    }

    // 1-5 — scroll to column
    if (e.key >= '1' && e.key <= '5') {
      var colNames = ['pending', 'assigned', 'running', 'complete', 'failed'];
      var idx = parseInt(e.key, 10) - 1;
      var colEl = columns[colNames[idx]];
      if (colEl) colEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      e.preventDefault();
      return;
    }
  });

  // Shortcuts dialog close
  document.getElementById('shortcuts-close').addEventListener('click', function () {
    shortcutsDialog.close();
  });

  // ── WebSocket Real-Time Updates ─────────────────────────────

  if (typeof createWS === 'function') {
    wsHandle = createWS(['coord:*', 'claude-terminal:task-assigned', 'claude-terminal:task-released', 'claude-terminal:task-completed', 'dlq:*'], function (msg) {
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
      } else if (ev === 'claude-terminal:task-assigned') {
        // Terminal claimed a task — refresh to show assignment
        if (data.taskId && tasks[data.taskId]) {
          tasks[data.taskId].status = 'assigned';
          tasks[data.taskId].assignedTo = data.terminalId || null;
          renderBoard();
        } else {
          loadTasks();
        }
      } else if (ev === 'claude-terminal:task-released') {
        // Terminal released a task — refresh to show it back as pending
        if (data.taskId && tasks[data.taskId]) {
          tasks[data.taskId].status = 'pending';
          tasks[data.taskId].assignedTo = null;
          renderBoard();
        } else {
          loadTasks();
        }
      } else if (ev === 'claude-terminal:task-completed') {
        // Terminal completed a task
        if (data.taskId && tasks[data.taskId]) {
          tasks[data.taskId].status = data.status === 'failed' ? 'failed' : 'complete';
          tasks[data.taskId].completedAt = new Date().toISOString();
          if (data.result) tasks[data.taskId].result = data.result;
          if (data.error) tasks[data.taskId].error = data.error;
          renderBoard();
        } else {
          loadTasks();
        }
      } else if (ev === 'coord:dep-added' || ev === 'coord:dep-removed') {
        // Dependency graph changed — reload tasks and graph (Phase 53)
        loadTasks();
        if (currentView === 'dag') loadGraph();
      } else if (ev === 'dlq:added' || ev === 'dlq:retried' || ev === 'dlq:dismissed') {
        // Dead letter queue changed — reload DLQ section
        loadDeadLetters();
        if (ev === 'dlq:added' && typeof showToast === 'function') {
          showToast('Task moved to dead letter queue: ' + (data.taskId || ''));
        }
      }
    });
  }

  // ── Dead Letter Queue (Phase 32) ─────────────────────────────

  var dlqEntries = [];

  function loadDeadLetters() {
    fetch('/api/coordination/dead-letters')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        dlqEntries = data.entries || [];
        renderDeadLetters(data.entries || [], data.total || 0);
      })
      .catch(function () { /* DLQ not available */ });
  }

  function renderDeadLetters(list, total) {
    var section = document.getElementById('dlq-section');
    var container = document.getElementById('dlq-list');
    var badge = document.getElementById('dlq-badge');
    if (!section || !container) return;

    // Count pending entries
    var pendingCount = list.filter(function (e) { return e.status === 'pending'; }).length;
    badge.textContent = String(pendingCount);

    if (total === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var statusClass = 'dlq-status--' + e.status;
      var taskDesc = typeof e.task === 'string' ? e.task : (e.task && e.task.task ? e.task.task : e.taskId || '?');
      var timeAgo = e.failedAt ? new Date(e.failedAt).toLocaleString() : '';
      html += '<div class="task-board__dlq-card" data-dlq-id="' + e.id + '">';
      html += '<div class="task-board__dlq-card-header">';
      html += '<span class="task-board__dlq-status ' + statusClass + '">' + e.status + '</span>';
      html += '<span class="task-board__dlq-task-id">' + (e.taskId || '') + '</span>';
      if (e.category) html += '<span class="task-board__dlq-category">' + e.category + '</span>';
      html += '</div>';
      html += '<div class="task-board__dlq-desc">' + escapeHtml(taskDesc) + '</div>';
      if (e.error) html += '<div class="task-board__dlq-error">' + escapeHtml(String(e.error)) + '</div>';
      html += '<div class="task-board__dlq-meta">Retries: ' + (e.retryCount || 0) + ' | Failed: ' + timeAgo + '</div>';
      html += '<div class="task-board__dlq-actions">';
      if (e.status === 'pending') {
        html += '<button class="btn btn--sm" onclick="window._dlqRetry(\'' + e.id + '\')">Retry</button>';
        html += '<button class="btn btn--sm btn--ghost" onclick="window._dlqDismiss(\'' + e.id + '\')">Dismiss</button>';
      }
      html += '<button class="btn btn--sm btn--ghost" onclick="window._dlqDelete(\'' + e.id + '\')">Delete</button>';
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window._dlqRetry = function (id) {
    fetch('/api/coordination/dead-letters/' + id + '/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          if (typeof showToast === 'function') showToast('Task re-queued for retry');
          loadDeadLetters();
          loadTasks();
        }
      });
  };

  window._dlqDismiss = function (id) {
    var reason = prompt('Dismissal reason (optional):') || '';
    fetch('/api/coordination/dead-letters/' + id + '/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason }) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          if (typeof showToast === 'function') showToast('Dead letter dismissed');
          loadDeadLetters();
        }
      });
  };

  window._dlqDelete = function (id) {
    fetch('/api/coordination/dead-letters/' + id, { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          if (typeof showToast === 'function') showToast('Dead letter removed');
          loadDeadLetters();
        }
      });
  };

  // ── Drop Zone Setup ─────────────────────────────────────────
  setupDropZones();

  // ── Initial Load + Polling ──────────────────────────────────
  loadTasks();
  loadStatus();
  loadTemplates();
  loadDeadLetters();
  refreshTimer = setInterval(function () {
    loadTasks();
    loadStatus();
    loadDeadLetters();
  }, 10000);

  // Cleanup on page unload (full navigation)
  window.addEventListener('beforeunload', function () {
    if (refreshTimer) clearInterval(refreshTimer);
    if (wsHandle) { wsHandle.close(); wsHandle = null; }
  });
  // Cleanup on HTMX navigation (SPA boost)
  if (typeof onPageCleanup === 'function') {
    onPageCleanup(function () {
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      if (wsHandle) { wsHandle.close(); wsHandle = null; }
    });
  }
})();
