// ============================================================
// Shared UI Utilities — Operator Dashboard
// ============================================================
// Progress bar, toast system, and global API toast listener.
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
  localStorage.setItem('operator-auto-push', enabled ? '1' : '0');
}

// Listen for chain completion via WS and auto-push if enabled
(function connectAutoPushWs() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var ws;
  try { ws = new WebSocket(proto + '//' + location.host + '/ws'); } catch (_) { return; }

  ws.onopen = function() {
    ws.send(JSON.stringify({ subscribe: ['chain:complete', 'chain:assumed-complete'] }));
  };

  ws.onmessage = function(e) {
    try {
      var msg = JSON.parse(e.data);
      if ((msg.event === 'chain:complete' || msg.event === 'chain:assumed-complete') &&
          localStorage.getItem('operator-auto-push') === '1') {
        fetch('/api/git/push', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
          .then(function(r) {
            showToast(r.ok ? 'Auto-pushed to remote' : 'Auto-push failed', r.ok ? 'success' : 'error');
            var git = document.getElementById('git-panel');
            if (git) htmx.trigger(git, 'reload');
          })
          .catch(function() { showToast('Auto-push failed', 'error'); });
      }
    } catch (_) {}
  };

  ws.onclose = function() { setTimeout(connectAutoPushWs, 5000); };
})();

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
