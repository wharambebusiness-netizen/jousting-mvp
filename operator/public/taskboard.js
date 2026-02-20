// ============================================================
// Task Board — Kanban UI for Coordination Tasks (Phase 12+13)
// ============================================================
// Fetches tasks from /api/coordination/tasks, renders as cards
// in status columns. Real-time updates via WebSocket.
// Drag-and-drop for cancel (→ failed) and retry (→ pending).
//
// Phase 13 additions:
//   - Filter/search bar with text, status, priority, category
//   - Keyboard shortcuts (?, n, /, Esc, 1-5, a, d, r)
//   - Task detail/edit dialog (click card, PATCH to update)
//   - Batch select and batch cancel/retry operations
// ============================================================

/* global createWS, showToast */

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────
  var tasks = {};           // id → task object
  var draggedId = null;     // currently dragged task id
  var refreshTimer = null;
  var selected = {};        // id → true for selected tasks
  var filterText = '';      // current search text
  var filterStatus = '';    // current status filter
  var filterPriority = '';  // current priority filter
  var filterCategory = '';  // current category filter
  var detailTaskId = null;  // task shown in detail dialog

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
    document.getElementById('task-board').style.display = total === 0 ? 'none' : '';
    document.querySelector('.task-board__progress').style.display = total === 0 ? 'none' : '';
    document.getElementById('board-filters').style.display = total === 0 ? 'none' : '';

    // Update category dropdown options
    updateCategoryDropdown();

    // Clean up selected tasks that no longer exist
    var selIds = Object.keys(selected);
    for (var s = 0; s < selIds.length; s++) {
      if (!tasks[selIds[s]]) delete selected[selIds[s]];
    }
    updateSelectUI();
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
    var ids = Object.keys(selected);
    var pending = 0;
    for (var i = 0; i < ids.length; i++) {
      var t = tasks[ids[i]];
      if (t && (t.status === 'pending' || t.status === 'assigned')) {
        cancelTask(ids[i]);
        pending++;
      }
    }
    if (pending === 0) {
      if (typeof showToast === 'function') showToast('No cancellable tasks selected', 'error');
    }
    clearSelection();
  }

  function batchRetry() {
    var ids = Object.keys(selected);
    var pending = 0;
    for (var i = 0; i < ids.length; i++) {
      var t = tasks[ids[i]];
      if (t && (t.status === 'failed' || t.status === 'cancelled')) {
        retryTask(ids[i]);
        pending++;
      }
    }
    if (pending === 0) {
      if (typeof showToast === 'function') showToast('No retryable tasks selected', 'error');
    }
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
    document.getElementById('detail-deps').textContent = task.deps && task.deps.length ? task.deps.join(', ') : '—';
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

    // Editable only for pending/assigned
    var editable = task.status === 'pending' || task.status === 'assigned';
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

  // ── Keyboard Shortcuts ──────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

    // Escape always works — close dialogs, clear search
    if (e.key === 'Escape') {
      if (addTaskDialog.open) { addTaskDialog.close(); e.preventDefault(); return; }
      if (detailDialog.open) { detailDialog.close(); e.preventDefault(); return; }
      if (shortcutsDialog.open) { shortcutsDialog.close(); e.preventDefault(); return; }
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
