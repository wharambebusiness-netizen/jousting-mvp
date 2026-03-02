// ============================================================
// Shared UI Utilities — Operator Dashboard
// ============================================================
// Progress bar, toast, WS reconnect, keyboard shortcuts,
// confirm dialog, and global API toast listener.
// Loaded by all HTML pages.
// ============================================================

// ── CSRF Token Helper (Phase 58) ────────────────────────────────

function getCsrfToken() {
  var match = document.cookie.match(/(^|;\s*)_csrf=([^;]+)/);
  return match ? match[2] : '';
}

// Inject CSRF token into HTMX requests
document.body.addEventListener('htmx:configRequest', function(e) {
  var method = (e.detail.verb || '').toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    e.detail.headers['X-CSRF-Token'] = getCsrfToken();
  }
});

// Wrap native fetch to auto-inject CSRF token on state-changing requests
(function() {
  var _origFetch = window.fetch;
  window.fetch = function(url, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
      opts.headers = opts.headers || {};
      if (!opts.headers['X-CSRF-Token'] && !opts.headers['Authorization']) {
        opts.headers['X-CSRF-Token'] = getCsrfToken();
      }
    }
    return _origFetch.call(this, url, opts);
  };
})();

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

// ── WebSocket Utility (reconnect with exponential backoff + Phase 49 reliability) ───

function createWS(subscriptions, onMessage, opts) {
  opts = opts || {};
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = proto + '//' + location.host + '/ws';
  var backoff = 1000;
  var maxBackoff = 30000;
  var ws = null;
  var closed = false;

  // Phase 49: replay + quality tracking
  var _lastSeq = -1;          // last received sequence number
  var _reconnectCount = 0;    // number of reconnects
  var _latency = null;        // last ping-pong RTT in ms
  var _reconnectTimer = null; // active reconnect countdown timer
  var _countdownInterval = null; // banner countdown interval

  function updateDot(state, attempt) {
    if (!opts.trackStatus) return;
    var dot = document.getElementById('ws-dot');
    if (!dot) return;
    dot.className = (dot.className.includes('sidebar-nav__ws-dot') ? 'sidebar-nav__ws-dot ' : '') + 'ws-dot ws-dot--' + state;
    if (state === 'reconnecting' && attempt) {
      dot.title = 'WebSocket: Reconnecting... (attempt ' + attempt + ')';
    } else {
      dot.title = 'WebSocket: ' + state;
    }
  }

  // Phase 49: reconnection banner
  function showReconnectBanner(delayMs, attempt) {
    hideBanner();
    var banner = document.createElement('div');
    banner.id = 'ws-reconnect-banner';
    banner.className = 'ws-reconnect-banner';
    var secs = Math.ceil(delayMs / 1000);
    banner.innerHTML =
      '<span class="ws-reconnect-banner__msg">Connection lost. Reconnecting in ' +
      '<span id="ws-reconnect-countdown">' + secs + '</span>s...' +
      ' (attempt ' + attempt + ')</span>' +
      '<button class="ws-reconnect-banner__btn" onclick="(function(){' +
        'var b=document.getElementById(\'ws-reconnect-banner\');' +
        'if(b)b.remove();' +
        'window._wsReconnectNow && window._wsReconnectNow();' +
      '})()">Reconnect Now</button>' +
      '<button class="ws-reconnect-banner__dismiss" onclick="document.getElementById(\'ws-reconnect-banner\')&&document.getElementById(\'ws-reconnect-banner\').remove()" title="Dismiss">&times;</button>';
    document.body.insertBefore(banner, document.body.firstChild);
    // Start countdown
    var remaining = secs;
    _countdownInterval = setInterval(function() {
      remaining--;
      var el = document.getElementById('ws-reconnect-countdown');
      if (el) el.textContent = remaining > 0 ? remaining : 0;
      if (remaining <= 0) {
        clearInterval(_countdownInterval);
        _countdownInterval = null;
      }
    }, 1000);
  }

  function hideBanner() {
    if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
    var banner = document.getElementById('ws-reconnect-banner');
    if (banner) banner.remove();
  }

  // Expose for "Reconnect Now" button
  window._wsReconnectNow = function() {
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    backoff = 1000;
    connect();
  };

  // Phase 49: latency badge update
  function updateQuality() {
    if (!opts.onQuality) return;
    opts.onQuality({ latency: _latency, reconnects: _reconnectCount, connected: true });
  }

  function connect() {
    if (closed) return;
    try { ws = new WebSocket(url); } catch (_) { return; }

    updateDot('connecting');

    ws.onopen = function() {
      backoff = 1000;
      updateDot('connected');
      hideBanner();
      ws.send(JSON.stringify({ subscribe: subscriptions }));
      // Phase 49: request replay of missed events on reconnect
      if (_reconnectCount > 0 && _lastSeq >= 0) {
        ws.send(JSON.stringify({ type: 'replay', afterSeq: _lastSeq }));
      }
      if (opts.onConnect) opts.onConnect();
    };

    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);

        // Phase 49: track sequence numbers from bridged events
        if (msg.event && typeof msg.seq === 'number' && msg.seq > _lastSeq) {
          _lastSeq = msg.seq;
        }

        // Phase 49: handle server-side heartbeat ping
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // Phase 49: handle pong from server (response to client-initiated ping — latency measurement)
        if (msg.type === 'pong' && msg._pingTs) {
          _latency = Date.now() - msg._pingTs;
          updateQuality();
          return;
        }

        // Phase 49: handle replay response
        if (msg.type === 'replay') {
          var replayed = msg.events || [];
          if (replayed.length > 0) {
            showToast('Replayed ' + replayed.length + ' missed event' + (replayed.length !== 1 ? 's' : ''), 'info');
            for (var i = 0; i < replayed.length; i++) {
              var re = replayed[i];
              if (re.seq > _lastSeq) _lastSeq = re.seq;
              try { onMessage({ event: re.event, data: re.data, seq: re.seq, replayed: true }); } catch (_) {}
              if (opts.onReplay) opts.onReplay(re);
            }
          }
          return;
        }

        // Phase 49: handle replay gap notification
        if (msg.type === 'replay-gap') {
          showToast('Missed ' + msg.missed + ' event' + (msg.missed !== 1 ? 's' : '') + ' during disconnection', 'warning');
          return;
        }

        onMessage(msg);
      } catch (_) {}
    };

    ws.onclose = function() {
      _reconnectCount++;
      updateDot('reconnecting', _reconnectCount);
      if (opts.onDisconnect) opts.onDisconnect();
      if (!closed) {
        // Show banner for extended disconnection (backoff > 1s means second+ attempt)
        if (backoff > 1000) {
          showReconnectBanner(backoff, _reconnectCount);
        }
        _reconnectTimer = setTimeout(function() {
          _reconnectTimer = null;
          connect();
        }, backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      } else {
        updateDot('disconnected');
      }
    };
  }

  connect();
  return {
    close: function() {
      closed = true;
      hideBanner();
      window._wsReconnectNow = null;
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
      if (ws) ws.close();
    },
    getLastSeq: function() { return _lastSeq; },
    getLatency: function() { return _latency; },
    getReconnectCount: function() { return _reconnectCount; },
  };
}

// ── Page Cleanup on HTMX Navigation ─────────────────────────
// Pages register cleanup callbacks (e.g. WS close, interval clear).
// HTMX boost re-runs scripts without full page unload, so we need
// to clean up previous page state before the new page initializes.
var _pageCleanups = [];
function onPageCleanup(fn) { _pageCleanups.push(fn); }

// ── Page Cache (Terminal Persistence) ────────────────────────
// Cache terminal pages so xterm.js instances survive navigation.
var _pageCache = {};
var CACHEABLE_PAGES = ['/console', '/terminals'];

document.body.addEventListener('htmx:beforeSwap', function () {
  // Check if current page is cacheable — detach <main> instead of destroying
  var currentMain = document.querySelector('main[data-page-id]');
  if (currentMain) {
    var pageId = currentMain.getAttribute('data-page-id');
    var pagePath = '/' + pageId;
    if (CACHEABLE_PAGES.indexOf(pagePath) !== -1) {
      // Save scroll position before detaching
      var scrollTop = currentMain.scrollTop || document.documentElement.scrollTop || 0;
      // Detach to JS variable (preserves xterm instances)
      currentMain.remove();
      _pageCache[pagePath] = {
        main: currentMain,
        cleanups: _pageCleanups.slice(),  // save cleanups for later disposal
        scrollTop: scrollTop
      };
      _pageCleanups = [];
      return; // skip running cleanups for cached pages
    }
  }

  for (var i = 0; i < _pageCleanups.length; i++) {
    try { _pageCleanups[i](); } catch (_) {}
  }
  _pageCleanups = [];
});

/**
 * Restore a cached page by re-attaching its <main> element.
 * @param {string} pagePath - e.g. '/console'
 * @returns {boolean} true if restored
 */
function restoreCachedPage(pagePath) {
  var cached = _pageCache[pagePath];
  if (!cached) return false;

  // Remove current <main>
  var currentMain = document.querySelector('main');
  if (currentMain) currentMain.remove();

  // Re-attach cached <main>
  var sidebar = document.getElementById('sidebar-nav');
  if (sidebar && sidebar.nextSibling) {
    sidebar.parentNode.insertBefore(cached.main, sidebar.nextSibling);
  } else {
    document.body.insertBefore(cached.main, document.getElementById('toast-container'));
  }

  // Restore cleanups
  _pageCleanups = cached.cleanups;
  delete _pageCache[pagePath];

  // Update browser state
  history.pushState({}, '', pagePath);
  updateSidebarActiveLink();

  // Restore scroll position
  var savedScroll = cached.scrollTop || 0;
  requestAnimationFrame(function() {
    (cached.main || document.documentElement).scrollTop = savedScroll;
  });

  // Add fade-in animation class
  cached.main.classList.add('page--restored');
  setTimeout(function() { cached.main.classList.remove('page--restored'); }, 250);

  // Notify page scripts to refit terminals and reconnect WS
  document.dispatchEvent(new CustomEvent('terminal-page-restored', { detail: { page: pagePath } }));

  return true;
}

/**
 * Dispose a cached page (run its cleanups and discard).
 * Called when the cache entry is no longer needed.
 * @param {string} pagePath
 */
function disposeCachedPage(pagePath) {
  var cached = _pageCache[pagePath];
  if (!cached) return;
  for (var i = 0; i < cached.cleanups.length; i++) {
    try { cached.cleanups[i](); } catch (_) {}
  }
  delete _pageCache[pagePath];
}

// Intercept sidebar link clicks for cached pages
document.addEventListener('click', function(e) {
  var link = e.target.closest('.sidebar-nav__link');
  if (!link) return;

  var pagePath = link.getAttribute('data-page');
  if (!pagePath || CACHEABLE_PAGES.indexOf(pagePath) === -1) return;
  if (!_pageCache[pagePath]) return;

  // We have a cached version — restore instead of navigating
  e.preventDefault();
  e.stopImmediatePropagation();  // prevent HTMX from also processing the click
  restoreCachedPage(pagePath);
});

// ── Notification Bell (Phase 41) ─────────────────────────────

(function() {
  // Inject bell into sidebar nav (between links and footer)
  var sidebar = document.getElementById('sidebar-nav');
  if (!sidebar) return;

  var bell = document.createElement('div');
  bell.className = 'sidebar-nav__notif';
  bell.innerHTML = '<button class="sidebar-nav__notif-btn" id="notif-bell" title="Notifications" aria-label="Notifications">' +
    '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M10 2a5 5 0 00-5 5c0 4-2 5-2 5h14s-2-1-2-5a5 5 0 00-5-5z"/>' +
    '<path d="M8.5 17a1.5 1.5 0 003 0"/></svg>' +
    '<span class="notif-badge" id="notif-badge" style="display:none">0</span></button>';

  // Insert before the first footer
  var footers = sidebar.querySelectorAll('.sidebar-nav__footer');
  if (footers.length > 0) {
    sidebar.insertBefore(bell, footers[0]);
  } else {
    sidebar.appendChild(bell);
  }

  // Dropdown
  var dropdown = document.createElement('div');
  dropdown.className = 'notif-dropdown';
  dropdown.id = 'notif-dropdown';
  dropdown.style.display = 'none';
  dropdown.innerHTML = '<div class="notif-dropdown__header">' +
    '<span class="notif-dropdown__title">Notifications</span>' +
    '<button class="notif-dropdown__mark-all" id="notif-mark-all">Mark all read</button></div>' +
    '<div class="notif-dropdown__list" id="notif-list"></div>';
  document.body.appendChild(dropdown);

  var badgeEl = document.getElementById('notif-badge');
  var bellBtn = document.getElementById('notif-bell');
  var dropdownEl = document.getElementById('notif-dropdown');
  var listEl = document.getElementById('notif-list');
  var markAllBtn = document.getElementById('notif-mark-all');

  function updateBadge(count) {
    if (!badgeEl) return;
    if (count > 0) {
      badgeEl.textContent = count > 99 ? '99+' : String(count);
      badgeEl.style.display = '';
    } else {
      badgeEl.style.display = 'none';
    }
  }

  function fetchUnreadCount() {
    fetch('/api/notifications/unread-count')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) { if (data) updateBadge(data.count); })
      .catch(function() {});
  }

  var severityIcon = {
    success: '&#10003;', error: '&#10007;', warning: '&#9888;', info: '&#8505;'
  };

  function renderNotifications(items) {
    if (!listEl) return;
    if (!items || items.length === 0) {
      listEl.innerHTML = '<div class="notif-dropdown__empty">No notifications</div>';
      return;
    }
    listEl.innerHTML = items.map(function(n) {
      return '<div class="notif-item' + (n.read ? '' : ' notif-item--unread') + '" data-id="' + n.id + '">' +
        '<span class="notif-item__icon notif-item__icon--' + n.severity + '">' + (severityIcon[n.severity] || '') + '</span>' +
        '<div class="notif-item__body"><div class="notif-item__title">' + n.title + '</div>' +
        '<div class="notif-item__msg">' + n.message + '</div></div>' +
        '<button class="notif-item__dismiss" data-dismiss="' + n.id + '" title="Dismiss">&times;</button></div>';
    }).join('');
  }

  function loadNotifications() {
    fetch('/api/notifications?limit=20')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data) return;
        renderNotifications(data.items);
        updateBadge(data.unreadCount);
      })
      .catch(function() {});
  }

  // Toggle dropdown
  if (bellBtn) {
    bellBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = dropdownEl.style.display !== 'none';
      if (isOpen) {
        dropdownEl.style.display = 'none';
      } else {
        loadNotifications();
        // Position dropdown near bell
        var rect = bellBtn.getBoundingClientRect();
        dropdownEl.style.top = rect.top + 'px';
        dropdownEl.style.left = (rect.right + 8) + 'px';
        dropdownEl.style.display = '';
      }
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', function(e) {
    if (dropdownEl && dropdownEl.style.display !== 'none') {
      if (!dropdownEl.contains(e.target) && e.target !== bellBtn) {
        dropdownEl.style.display = 'none';
      }
    }
  });

  // Mark all read
  if (markAllBtn) {
    markAllBtn.addEventListener('click', function() {
      fetch('/api/notifications/read-all', { method: 'POST' })
        .then(function() { loadNotifications(); })
        .catch(function() {});
    });
  }

  // Dismiss button delegation
  if (listEl) {
    listEl.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-dismiss]');
      if (btn) {
        var id = btn.getAttribute('data-dismiss');
        fetch('/api/notifications/' + id, { method: 'DELETE' })
          .then(function() { loadNotifications(); })
          .catch(function() {});
      }
    });
  }

  // Initial fetch
  fetchUnreadCount();

  // WS subscription for real-time badge updates
  createWS(['notification:*'], function(msg) {
    if (msg.event === 'notification:new') {
      fetchUnreadCount();
      // If dropdown is open, refresh it
      if (dropdownEl && dropdownEl.style.display !== 'none') {
        loadNotifications();
      }
    }
  });
})();

// ── User Preferences (Phase 39) ─────────────────────────────

window._userPrefs = null;

(function() {
  fetch('/api/preferences')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(prefs) {
      if (!prefs) return;
      window._userPrefs = prefs;

      // Apply sidebar collapsed state
      var sidebar = document.getElementById('project-sidebar');
      if (sidebar && prefs.sidebarCollapsed) {
        sidebar.classList.add('collapsed');
      }
    })
    .catch(function() {});
})();

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
  fetch('/api/settings')
    .then(function(r) { return r.json(); })
    .then(function(s) {
      s.autoPush = enabled;
      return fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
    })
    .catch(function() {});
}

// Reset bulk selection after chain table reload
document.body.addEventListener('htmx:afterSwap', function(evt) {
  if (evt.detail.target && evt.detail.target.closest && evt.detail.target.closest('#chain-table')) {
    var selectAll = document.getElementById('select-all');
    if (selectAll) selectAll.checked = false;
    updateBulkBar();
  }
});

// Dashboard chain WS: auto-push + real-time updates
(function() {
  var lastDashReload = 0;

  createWS(['chain:*'], function(msg) {
    if (!msg.event || !msg.event.startsWith('chain:')) return;

    // Auto-push on completion (check server-side setting)
    if (msg.event === 'chain:complete' || msg.event === 'chain:assumed-complete') {
      fetch('/api/settings')
        .then(function(r) { return r.json(); })
        .then(function(s) {
          if (!s.autoPush) return;
          fetch('/api/git/push', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) {
              showToast(r.ok ? 'Auto-pushed to remote' : 'Auto-push failed', r.ok ? 'success' : 'error');
              var git = document.getElementById('git-panel');
              if (git) htmx.trigger(git, 'reload');
            })
            .catch(function() { showToast('Auto-push failed', 'error'); });
        })
        .catch(function() {});
    }

    // Real-time dashboard updates: debounce to 2s
    var now = Date.now();
    if (now - lastDashReload < 2000) return;
    lastDashReload = now;

    var chainTable = document.getElementById('chain-table');
    if (chainTable) htmx.trigger(chainTable, 'reload');
    var costGrid = document.getElementById('cost-summary-grid');
    if (costGrid) htmx.trigger(costGrid, 'reload');
  }, { trackStatus: true });
})();

// ── Project Filter ───────────────────────────────────────────

function onProjectChange(value) {
  localStorage.setItem('operator-project', value);
  // Reload all HTMX-driven panels
  var targets = ['#chain-table', '#cost-summary-grid', '#git-panel', '#analytics-panel', '#report-viewer', '#projects-panel'];
  for (var i = 0; i < targets.length; i++) {
    var el = document.querySelector(targets[i]);
    if (el) htmx.trigger(el, 'reload');
  }
  // Also reload child tbody for chain table
  var tbody = document.querySelector('#chain-table tbody');
  if (tbody) htmx.trigger(document.getElementById('chain-table'), 'reload');
}

function loadProjects() {
  var select = document.getElementById('project-select');
  if (!select) return;
  var saved = localStorage.getItem('operator-project') || '';

  fetch('/api/projects')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var projects = data.projects || [];
      // Keep "All Projects" as first option
      var html = '<option value="">All Projects</option>';
      for (var i = 0; i < projects.length; i++) {
        var p = projects[i];
        var dir = p.projectDir || '(default)';
        // Show just the last path segment for brevity
        var label = dir.split('/').pop() || dir.split('\\').pop() || dir;
        if (dir === '(default)') label = '(default)';
        var selected = dir === saved ? ' selected' : '';
        html += '<option value="' + dir.replace(/"/g, '&quot;') + '"' + selected + '>' + label + ' (' + p.chains + ')</option>';
      }
      select.innerHTML = html;

      // Hide dropdown if only 0-1 projects
      select.style.display = projects.length <= 1 ? 'none' : '';
    })
    .catch(function() {
      select.style.display = 'none';
    });
}

// ── Sidebar Nav Active Link ─────────────────────────────────
function updateSidebarActiveLink() {
  var path = window.location.pathname;
  var links = document.querySelectorAll('.sidebar-nav__link');
  for (var i = 0; i < links.length; i++) {
    var linkPage = links[i].getAttribute('data-page');
    var isActive = (linkPage === path) || (linkPage === '/' && path === '/index.html');
    // Prefix matching: /chains/*, /chain/* highlight Dashboard
    if (!isActive && linkPage === '/dashboard' && (path.startsWith('/chains/') || path.startsWith('/chain/'))) {
      isActive = true;
    }
    links[i].classList.toggle('sidebar-nav__link--active', isActive);
  }
}

// Update active link after HTMX navigation
document.body.addEventListener('htmx:afterSettle', function() {
  updateSidebarActiveLink();
});

// Inject project filter into all HTMX GET requests
document.body.addEventListener('htmx:configRequest', function(evt) {
  var project = localStorage.getItem('operator-project');
  if (project && evt.detail.verb === 'get') {
    evt.detail.parameters.project = project;
  }
});

loadProjects();
updateSidebarActiveLink();

// ── Settings Defaults ────────────────────────────────────────

function applySettingsDefaults() {
  fetch('/api/settings')
    .then(function(r) { return r.json(); })
    .then(function(s) {
      // Pre-fill quick-start form model select
      var modelSelect = document.querySelector('.quick-start select[name="model"]');
      if (modelSelect && s.model) modelSelect.value = s.model;
      // Apply particle visibility
      var canvas = document.getElementById('space-particles');
      if (canvas && s.particlesEnabled === false) canvas.style.display = 'none';
    })
    .catch(function() {});
}

applySettingsDefaults();

// ── Confirm Dialog ───────────────────────────────────────────

(function() {
  var dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';
  dialog.innerHTML =
    '<div class="confirm-dialog__body">' +
      '<p class="confirm-dialog__msg"></p>' +
      '<div class="confirm-dialog__actions">' +
        '<button class="btn btn--ghost" data-action="cancel">Cancel</button>' +
        '<button class="btn btn--primary" data-action="confirm">Confirm</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(dialog);

  var msgEl = dialog.querySelector('.confirm-dialog__msg');
  var confirmBtn = dialog.querySelector('[data-action="confirm"]');
  var cancelBtn = dialog.querySelector('[data-action="cancel"]');
  var _cb = null;

  function close() { dialog.close(); _cb = null; }

  cancelBtn.onclick = close;
  confirmBtn.onclick = function() { var cb = _cb; close(); if (cb) cb(); };
  dialog.addEventListener('click', function(e) {
    if (e.target === dialog) close();
  });

  window._showConfirm = function(msg, cb) {
    msgEl.textContent = msg;
    _cb = cb;
    var danger = /delete|abort|stop/i.test(msg);
    confirmBtn.className = danger ? 'btn btn--danger' : 'btn btn--primary';
    if (/delete/i.test(msg)) confirmBtn.textContent = 'Delete';
    else if (/abort/i.test(msg)) confirmBtn.textContent = 'Abort';
    else if (/stop/i.test(msg)) confirmBtn.textContent = 'Stop';
    else confirmBtn.textContent = 'Confirm';
    dialog.showModal();
    cancelBtn.focus();
  };
})();

// Intercept HTMX confirm dialogs
document.body.addEventListener('htmx:confirm', function(evt) {
  if (!evt.detail.question) return;
  evt.preventDefault();
  _showConfirm(evt.detail.question, function() {
    evt.detail.issueRequest();
  });
});

// ── Keyboard Shortcuts ───────────────────────────────────────

document.addEventListener('keydown', function(e) {
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'n') {
    e.preventDefault();
    var taskInput = document.getElementById('chain-task');
    if (taskInput) {
      var details = taskInput.closest('details');
      if (details) details.open = true;
      taskInput.focus();
    }
  }

  if (e.key === '/') {
    e.preventDefault();
    var searchInput = document.querySelector('#chain-filters input[type="search"]');
    if (searchInput) searchInput.focus();
  }
});

// ── Command Palette (Phase 46) — Ctrl+K / Cmd+K ─────────────

(function() {
  var overlay = document.createElement('div');
  overlay.className = 'search-palette';
  overlay.id = 'search-palette';
  overlay.style.display = 'none';
  overlay.innerHTML =
    '<div class="search-palette__box">' +
      '<input type="text" class="search-input" id="search-palette-input" placeholder="Search tasks, messages, chains, terminals..." autocomplete="off" />' +
      '<div class="search-recent" id="search-recent"></div>' +
      '<div class="search-results" id="search-results"></div>' +
      '<div class="search-empty" id="search-empty" style="display:none">No results found</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var paletteEl = document.getElementById('search-palette');
  var inputEl = document.getElementById('search-palette-input');
  var resultsEl = document.getElementById('search-results');
  var emptyEl = document.getElementById('search-empty');
  var recentEl = document.getElementById('search-recent');
  var debounceTimer = null;

  var sourceIcons = {
    tasks: '\u2611', messages: '\u2709', audit: '\u{1F4CB}',
    chains: '\u26D3', terminals: '\u25B6', memory: '\u{1F4BE}'
  };

  var sourcePages = {
    tasks: '/taskboard', messages: '/terminals', audit: '/timeline',
    chains: '/chains/', terminals: '/terminals', memory: '/terminals'
  };

  function openPalette() {
    paletteEl.style.display = '';
    inputEl.value = '';
    resultsEl.innerHTML = '';
    emptyEl.style.display = 'none';
    renderRecent();
    setTimeout(function() { inputEl.focus(); }, 50);
  }

  function closePalette() {
    paletteEl.style.display = 'none';
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  function getRecent() {
    try { return JSON.parse(localStorage.getItem('search-recent') || '[]'); } catch { return []; }
  }

  function saveRecent(query) {
    var list = getRecent().filter(function(q) { return q !== query; });
    list.unshift(query);
    if (list.length > 5) list = list.slice(0, 5);
    localStorage.setItem('search-recent', JSON.stringify(list));
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function renderRecent() {
    var list = getRecent();
    if (list.length === 0) { recentEl.innerHTML = ''; return; }
    recentEl.innerHTML = '<div class="search-recent__label">Recent</div>' +
      list.map(function(q) {
        return '<button class="search-recent__item" data-query="' + escapeHtml(q) + '">' + escapeHtml(q) + '</button>';
      }).join('');
  }

  function renderResults(data) {
    if (!data || !data.results || data.results.length === 0) {
      resultsEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';
    resultsEl.innerHTML = data.results.map(function(r) {
      var icon = sourceIcons[r.source] || '';
      var page = r.source === 'chains' ? '/chains/' + escapeHtml(r.id) : (sourcePages[r.source] || '/');
      return '<a class="search-result" href="' + page + '" data-source="' + escapeHtml(r.source) + '">' +
        '<span class="search-result__badge">' + icon + ' ' + escapeHtml(r.source) + '</span>' +
        '<span class="search-result__title">' + escapeHtml(r.title || r.id) + '</span>' +
        '<span class="search-result__snippet">' + escapeHtml(r.snippet || '') + '</span>' +
      '</a>';
    }).join('');
  }

  function doSearch(query) {
    if (!query || query.trim().length === 0) {
      resultsEl.innerHTML = '';
      emptyEl.style.display = 'none';
      renderRecent();
      return;
    }
    recentEl.innerHTML = '';
    fetch('/api/search?q=' + encodeURIComponent(query.trim()) + '&limit=15')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (data) {
          renderResults(data);
          saveRecent(query.trim());
        }
      })
      .catch(function() {
        resultsEl.innerHTML = '';
        emptyEl.style.display = '';
      });
  }

  // Debounced input
  if (inputEl) {
    inputEl.addEventListener('input', function() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() { doSearch(inputEl.value); }, 300);
    });
  }

  // Click recent search
  if (recentEl) {
    recentEl.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-query]');
      if (btn) {
        inputEl.value = btn.dataset.query;
        doSearch(btn.dataset.query);
      }
    });
  }

  // Click result closes palette
  if (resultsEl) {
    resultsEl.addEventListener('click', function() {
      closePalette();
    });
  }

  // Click backdrop closes
  paletteEl.addEventListener('click', function(e) {
    if (e.target === paletteEl) closePalette();
  });

  // Escape closes
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && paletteEl.style.display !== 'none') {
      e.preventDefault();
      closePalette();
    }
    // Ctrl+K / Cmd+K opens
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (paletteEl.style.display === 'none') openPalette();
      else closePalette();
    }
  });

  window._openSearchPalette = openPalette;
  window._closeSearchPalette = closePalette;
})();

// ── Bulk Chain Actions ────────────────────────────────────────

function updateBulkBar() {
  var checks = document.querySelectorAll('.chain-check:checked');
  var bar = document.getElementById('bulk-bar');
  var countEl = document.getElementById('bulk-count');
  var selectAll = document.getElementById('select-all');
  if (bar) bar.style.display = checks.length > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = checks.length;
  if (selectAll) {
    var total = document.querySelectorAll('.chain-check');
    selectAll.checked = total.length > 0 && checks.length === total.length;
    selectAll.indeterminate = checks.length > 0 && checks.length < total.length;
  }
}
window.updateBulkBar = updateBulkBar;

function toggleSelectAll(el) {
  var checks = document.querySelectorAll('.chain-check');
  checks.forEach(function(c) { c.checked = el.checked; });
  updateBulkBar();
}
window.toggleSelectAll = toggleSelectAll;

function bulkClearSelection() {
  var checks = document.querySelectorAll('.chain-check');
  checks.forEach(function(c) { c.checked = false; });
  var selectAll = document.getElementById('select-all');
  if (selectAll) selectAll.checked = false;
  updateBulkBar();
}
window.bulkClearSelection = bulkClearSelection;

function bulkDelete() {
  var checks = document.querySelectorAll('.chain-check:checked');
  var ids = Array.from(checks).map(function(c) { return c.value; });
  if (ids.length === 0) return;
  _showConfirm('Delete ' + ids.length + ' chain(s) permanently?', function() {
    fetch('/api/chains/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    }).then(function(r) {
      if (r.ok) {
        showToast('Deleted ' + ids.length + ' chain(s)', 'success');
        htmx.trigger(document.getElementById('chain-table'), 'reload');
        htmx.trigger(document.getElementById('cost-summary-grid'), 'reload');
        bulkClearSelection();
      } else {
        r.json().then(function(d) { showToast(d.error || 'Delete failed', 'error'); });
      }
    }).catch(function() { showToast('Delete failed', 'error'); });
  });
}
window.bulkDelete = bulkDelete;

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

// ── Project File Tree ──────────────────────────────────────────

/**
 * Load a tree node's children via fetch (called on <details> ontoggle).
 * ontoggle fires AFTER the browser toggles open state, so details.open is reliable.
 */
function loadTreeNode(details) {
  // Only load on open, and only if not already loaded
  if (!details.open || details.dataset.loaded === '1') return;
  details.dataset.loaded = '1';

  var card = details.closest('.project-card') || details.closest('.project-tree');
  var root = card ? card.dataset.root : '';
  var path = details.dataset.path || '';

  if (!root) return;

  var children = details.querySelector('.tree-children');
  if (!children) return;

  fetch('/views/file-tree?root=' + encodeURIComponent(root) + '&path=' + encodeURIComponent(path))
    .then(function(r) { return r.text(); })
    .then(function(html) {
      children.innerHTML = html;
      // Re-apply any active search filter
      var search = card && card.querySelector('.tree-search');
      if (search && search.value) filterTree(search);
    })
    .catch(function() { children.innerHTML = '<div class="tree-empty">Failed to load</div>'; });
}
window.loadTreeNode = loadTreeNode;

/**
 * Refresh a project's file tree (re-fetch all open directories).
 */
function refreshProjectTree(card) {
  if (!card) return;
  var btn = card.querySelector('.project-card__refresh');
  if (btn) btn.classList.add('refreshing');

  var root = card.dataset.root;
  var tree = card.querySelector('.project-tree');
  if (!tree || !root) return;

  // Re-fetch root entries
  fetch('/views/file-tree?root=' + encodeURIComponent(root) + '&path=')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      tree.innerHTML = html;
      if (btn) setTimeout(function() { btn.classList.remove('refreshing'); }, 400);
      // Re-apply search filter
      var search = card.querySelector('.tree-search');
      if (search && search.value) filterTree(search);
    })
    .catch(function() {
      if (btn) btn.classList.remove('refreshing');
    });
}
window.refreshProjectTree = refreshProjectTree;

// ── File Preview ────────────────────────────────────────────────

// Keyboard support for clickable file tree entries
document.addEventListener('keydown', function(e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tree-file--clickable')) {
    e.preventDefault();
    previewFile(e.target);
  }
});

function previewFile(el) {
  var card = el.closest('.project-card');
  var root = card ? card.dataset.root : '';
  var path = el.dataset.path || '';
  if (!root || !path) return;

  // Highlight active file
  var prev = document.querySelector('.tree-file--active');
  if (prev) prev.classList.remove('tree-file--active');
  el.classList.add('tree-file--active');

  var panel = document.getElementById('file-preview');
  if (!panel) return;

  var pathEl = panel.querySelector('.file-preview__path');
  var codeEl = panel.querySelector('.file-preview__code code');
  if (pathEl) pathEl.textContent = path;
  if (codeEl) codeEl.textContent = 'Loading…';
  panel.style.display = '';

  fetch('/api/files/content?root=' + encodeURIComponent(root) + '&path=' + encodeURIComponent(path))
    .then(function(r) {
      if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Failed'); });
      return r.json();
    })
    .then(function(data) {
      if (codeEl) {
        // Add line numbers
        var lines = data.content.split('\n');
        var numbered = lines.map(function(line, i) {
          var num = String(i + 1);
          var pad = '     '.slice(num.length);
          return '<span class="line-num">' + pad + num + '</span>  ' + escapePreviewHtml(line);
        }).join('\n');
        codeEl.innerHTML = numbered;
      }
    })
    .catch(function(err) {
      if (codeEl) codeEl.textContent = err.message || 'Failed to load file';
    });
}
window.previewFile = previewFile;

function closePreview() {
  var panel = document.getElementById('file-preview');
  if (panel) panel.style.display = 'none';
  var active = document.querySelector('.tree-file--active');
  if (active) active.classList.remove('tree-file--active');
}
window.closePreview = closePreview;

function escapePreviewHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── File Tree Search ────────────────────────────────────────────

var _filterTimer = null;
function filterTree(input) {
  if (_filterTimer) clearTimeout(_filterTimer);
  _filterTimer = setTimeout(function() { _doFilterTree(input); }, 150);
}
window.filterTree = filterTree;

function _doFilterTree(input) {
  var card = input.closest('.project-card');
  if (!card) return;
  var tree = card.querySelector('.project-tree');
  if (!tree) return;

  var query = (input.value || '').toLowerCase().trim();

  // Show all entries if query is empty
  var files = tree.querySelectorAll('.tree-file');
  var dirs = tree.querySelectorAll('.tree-dir');

  if (!query) {
    for (var i = 0; i < files.length; i++) files[i].style.display = '';
    for (var j = 0; j < dirs.length; j++) dirs[j].style.display = '';
    return;
  }

  // Filter files: show if name matches
  for (var fi = 0; fi < files.length; fi++) {
    var nameEl = files[fi].querySelector('.tree-name');
    var name = nameEl ? nameEl.textContent.toLowerCase() : '';
    files[fi].style.display = name.includes(query) ? '' : 'none';
  }

  // Show dirs if they contain any visible children
  for (var di = dirs.length - 1; di >= 0; di--) {
    var children = dirs[di].querySelector('.tree-children');
    var hasVisible = false;
    if (children) {
      var visFiles = children.querySelectorAll('.tree-file:not([style*="display: none"])');
      var visDirs = children.querySelectorAll('.tree-dir:not([style*="display: none"])');
      hasVisible = visFiles.length > 0 || visDirs.length > 0;
    }
    // Also check if dir name matches
    var dirName = dirs[di].querySelector('.tree-name');
    var dirNameText = dirName ? dirName.textContent.toLowerCase() : '';
    if (dirNameText.includes(query)) hasVisible = true;
    dirs[di].style.display = hasVisible ? '' : 'none';
    // Auto-open dirs with matches
    if (hasVisible && !dirs[di].open) {
      dirs[di].open = true;
      loadTreeNode(dirs[di]);
    }
  }
}

// ── Collapsible Project Cards ───────────────────────────────────

function toggleProjectCard(card) {
  if (!card) return;
  var body = card.querySelector('.project-card__body');
  var btn = card.querySelector('.project-card__toggle');
  if (!body) return;

  var collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if (btn) {
    btn.textContent = collapsed ? '▾' : '▸';
    btn.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
  }

  // Persist state
  var root = card.dataset.root || '';
  var key = 'proj-collapsed';
  try {
    var state = JSON.parse(localStorage.getItem(key) || '{}');
    if (collapsed) { delete state[root]; } else { state[root] = true; }
    localStorage.setItem(key, JSON.stringify(state));
  } catch (_) {}
}
window.toggleProjectCard = toggleProjectCard;

// Restore collapsed state on load
(function() {
  function restoreCollapsed() {
    try {
      var state = JSON.parse(localStorage.getItem('proj-collapsed') || '{}');
      var cards = document.querySelectorAll('.project-card');
      for (var i = 0; i < cards.length; i++) {
        var root = cards[i].dataset.root || '';
        if (state[root]) {
          var body = cards[i].querySelector('.project-card__body');
          var btn = cards[i].querySelector('.project-card__toggle');
          if (body) body.style.display = 'none';
          if (btn) { btn.textContent = '▸'; btn.setAttribute('aria-expanded', 'false'); }
        }
      }
    } catch (_) {}
  }

  // Run after HTMX loads the projects panel
  document.body.addEventListener('htmx:afterSwap', function(evt) {
    if (evt.detail.target && evt.detail.target.id === 'projects-panel') {
      restoreCollapsed();
    }
  });
})();

// ── Real-time File Change Listener ─────────────────────────────

(function() {
  var lastChange = {};
  var DEBOUNCE = 3000;

  createWS(['project:*'], function(msg) {
    if (msg.event !== 'project:files-changed') return;
    var dir = msg.data && msg.data.projectDir;
    if (!dir) return;

    // Debounce per project
    var now = Date.now();
    if (lastChange[dir] && now - lastChange[dir] < DEBOUNCE) return;
    lastChange[dir] = now;

    // Find matching project cards and refresh open trees
    var cards = document.querySelectorAll('.project-card');
    for (var i = 0; i < cards.length; i++) {
      var cardRoot = (cards[i].dataset.root || '').replace(/\\/g, '/');
      if (cardRoot === dir.replace(/\\/g, '/')) {
        // Refresh open details within this card
        var openDirs = cards[i].querySelectorAll('details.tree-dir[open]');
        for (var j = 0; j < openDirs.length; j++) {
          openDirs[j].dataset.loaded = '0';
          loadTreeNode(openDirs[j]);
          // Re-mark as open since loadTreeNode checks details.open
          openDirs[j].open = true;
        }
        // Also refresh root-level tree if visible
        var tree = cards[i].querySelector('.project-tree');
        if (tree && !openDirs.length) {
          refreshProjectTree(cards[i]);
        }
      }
    }
  });
})();

// ── Open Project in Terminal ─────────────────────────────────

function openProjectInTerminal(projectDir) {
  sessionStorage.setItem('pending-terminal-project', projectDir);
  window.location.href = '/terminals';
}
window.openProjectInTerminal = openProjectInTerminal;

// ── Space Scene Animation ──────────────────────────────────
// Deep-space scene: stars, planets, 6 ship types (fighters,
// cruisers, frigates, scouts, bombers, mothership), treasure,
// comets, Dyson sphere superstructure. Pauses on hidden tab.

(function() {
  var canvas = document.createElement('canvas');
  canvas.id = 'space-particles';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
  document.body.insertBefore(canvas, document.body.firstChild);

  var ctx = canvas.getContext('2d');
  var w = 0, h = 0;
  var animId = null;
  var paused = false;

  // Object pools
  var stars = [];
  var planets = [];
  var ships = [];
  var treasures = [];
  var comets = [];
  var structures = [];
  var nextCometTime = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  // ── Stars (background dots) ──────────────────────────────
  function createStar() {
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.3 + Math.random() * 1.8,
      dx: (Math.random() - 0.5) * 0.1,
      dy: -0.03 - Math.random() * 0.1,
      alpha: 0.06 + Math.random() * 0.28,
      twinkleSpeed: 0.003 + Math.random() * 0.012,
      twinklePhase: Math.random() * Math.PI * 2,
      hue: Math.random() < 0.3 ? (220 + Math.random() * 40) : 0,
      sat: Math.random() < 0.3 ? (40 + Math.random() * 30) : 0,
    };
  }

  function drawStar(p, time) {
    var twinkle = Math.sin(time * p.twinkleSpeed + p.twinklePhase);
    var alpha = p.alpha + twinkle * p.alpha * 0.6;
    if (alpha < 0.02) alpha = 0.02;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    if (p.sat > 0) {
      ctx.fillStyle = 'hsla(' + p.hue + ',' + p.sat + '%,75%,' + alpha + ')';
    } else {
      ctx.fillStyle = 'rgba(200,210,240,' + alpha + ')';
    }
    ctx.fill();
    if (p.r > 1.3) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(140,160,255,' + (alpha * 0.1) + ')';
      ctx.fill();
    }
    p.x += p.dx; p.y += p.dy;
    if (p.x < -5) p.x = w + 5;
    if (p.x > w + 5) p.x = -5;
    if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; }
    if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w; }
  }

  // ── Planets ──────────────────────────────────────────────
  function createPlanet() {
    var r = 10 + Math.random() * 18;
    var hues = [15, 30, 180, 210, 280, 340]; // orange, amber, teal, blue, purple, red
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      r: r,
      dx: (Math.random() - 0.5) * 0.02,
      dy: (Math.random() - 0.5) * 0.015,
      hue: hues[Math.floor(Math.random() * hues.length)],
      alpha: 0.04 + Math.random() * 0.04,
      ringChance: Math.random(),
      phase: Math.random() * Math.PI * 2,
    };
  }

  function drawPlanet(p, time) {
    var pulse = Math.sin(time * 0.001 + p.phase) * 0.01;
    var a = p.alpha + pulse;
    // Planet body with gradient
    var g = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, 0, p.x, p.y, p.r);
    g.addColorStop(0, 'hsla(' + p.hue + ',50%,50%,' + (a * 1.5) + ')');
    g.addColorStop(0.7, 'hsla(' + p.hue + ',40%,30%,' + a + ')');
    g.addColorStop(1, 'hsla(' + p.hue + ',30%,15%,' + (a * 0.5) + ')');
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // Ring for some planets
    if (p.ringChance > 0.5) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r * 1.6, p.r * 0.3, 0.3, 0, Math.PI * 2);
      ctx.strokeStyle = 'hsla(' + p.hue + ',30%,60%,' + (a * 0.6) + ')';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Atmosphere glow
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 1.4, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(' + p.hue + ',40%,50%,' + (a * 0.15) + ')';
    ctx.fill();
    p.x += p.dx; p.y += p.dy;
    // Soft wrap
    if (p.x < -p.r * 2) p.x = w + p.r * 2;
    if (p.x > w + p.r * 2) p.x = -p.r * 2;
    if (p.y < -p.r * 2) p.y = h + p.r * 2;
    if (p.y > h + p.r * 2) p.y = -p.r * 2;
  }

  // ── Ships — 6 types ──────────────────────────────────────
  // Types: fighter, cruiser, frigate, scout, bomber, mothership
  var SHIP_TYPES = ['fighter', 'cruiser', 'frigate', 'scout', 'bomber', 'mothership'];

  function createShip(type) {
    var isMotherShip = type === 'mothership';
    var speed = isMotherShip ? 0.12 : (type === 'scout' ? 0.7 : 0.2 + Math.random() * 0.35);
    var angle = Math.random() * Math.PI * 2;
    var size = isMotherShip ? 18 + Math.random() * 8 :
               type === 'cruiser' ? 7 + Math.random() * 4 :
               type === 'bomber' ? 6 + Math.random() * 3 :
               type === 'frigate' ? 5 + Math.random() * 3 :
               3 + Math.random() * 2; // fighter, scout
    return {
      type: type,
      x: Math.random() * w,
      y: Math.random() * h,
      size: size,
      speed: speed,
      angle: angle,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      alpha: isMotherShip ? 0.07 : 0.04 + Math.random() * 0.04,
      turnRate: 0.001 + Math.random() * 0.003,
      engineGlow: Math.random() * Math.PI * 2,
      chaseTarget: null, // assigned later for some ships
      hue: isMotherShip ? 200 :
           type === 'fighter' ? 30 + Math.random() * 20 :
           type === 'cruiser' ? 210 + Math.random() * 30 :
           type === 'frigate' ? 170 + Math.random() * 20 :
           type === 'scout' ? 55 + Math.random() * 15 :
           0 + Math.random() * 15,  // bomber = red
    };
  }

  function drawShip(s, time) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    var a = s.alpha;
    var sz = s.size;

    // Engine glow (pulsing)
    var eg = 0.5 + Math.sin(time * 0.008 + s.engineGlow) * 0.3;
    ctx.beginPath();
    ctx.arc(-sz * 0.6, 0, sz * 0.4 * eg, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(' + s.hue + ',80%,60%,' + (a * 0.8 * eg) + ')';
    ctx.fill();

    if (s.type === 'mothership') {
      // Large elliptical hull with spine
      ctx.beginPath();
      ctx.ellipse(0, 0, sz, sz * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + s.hue + ',25%,25%,' + a + ')';
      ctx.fill();
      ctx.strokeStyle = 'hsla(' + s.hue + ',40%,50%,' + (a * 0.7) + ')';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // Bridge dome
      ctx.beginPath();
      ctx.arc(sz * 0.3, 0, sz * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(190,60%,60%,' + (a * 1.2) + ')';
      ctx.fill();
      // Side docking bays
      ctx.fillStyle = 'hsla(' + s.hue + ',30%,40%,' + (a * 0.5) + ')';
      ctx.fillRect(-sz * 0.2, -sz * 0.5, sz * 0.3, sz * 0.12);
      ctx.fillRect(-sz * 0.2, sz * 0.38, sz * 0.3, sz * 0.12);
      // Rear engines (3)
      for (var ei = -1; ei <= 1; ei++) {
        ctx.beginPath();
        ctx.arc(-sz * 0.9, ei * sz * 0.2, sz * 0.12 * eg, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(200,90%,70%,' + (a * 1.5 * eg) + ')';
        ctx.fill();
      }
    } else if (s.type === 'cruiser') {
      // Elongated diamond
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(0, -sz * 0.35);
      ctx.lineTo(-sz * 0.7, -sz * 0.25);
      ctx.lineTo(-sz * 0.5, 0);
      ctx.lineTo(-sz * 0.7, sz * 0.25);
      ctx.lineTo(0, sz * 0.35);
      ctx.closePath();
      ctx.fillStyle = 'hsla(' + s.hue + ',30%,30%,' + a + ')';
      ctx.fill();
      ctx.strokeStyle = 'hsla(' + s.hue + ',40%,55%,' + (a * 0.6) + ')';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    } else if (s.type === 'frigate') {
      // Boxy with turret
      ctx.beginPath();
      ctx.moveTo(sz * 0.8, 0);
      ctx.lineTo(sz * 0.2, -sz * 0.4);
      ctx.lineTo(-sz * 0.6, -sz * 0.35);
      ctx.lineTo(-sz * 0.6, sz * 0.35);
      ctx.lineTo(sz * 0.2, sz * 0.4);
      ctx.closePath();
      ctx.fillStyle = 'hsla(' + s.hue + ',25%,28%,' + a + ')';
      ctx.fill();
      // Turret
      ctx.beginPath();
      ctx.arc(sz * 0.1, 0, sz * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + s.hue + ',30%,45%,' + (a * 0.8) + ')';
      ctx.fill();
    } else if (s.type === 'bomber') {
      // Wide, flat triangle
      ctx.beginPath();
      ctx.moveTo(sz * 0.6, 0);
      ctx.lineTo(-sz * 0.5, -sz * 0.5);
      ctx.lineTo(-sz * 0.3, 0);
      ctx.lineTo(-sz * 0.5, sz * 0.5);
      ctx.closePath();
      ctx.fillStyle = 'hsla(' + s.hue + ',35%,28%,' + a + ')';
      ctx.fill();
    } else if (s.type === 'scout') {
      // Tiny sleek dart
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(-sz * 0.4, -sz * 0.3);
      ctx.lineTo(-sz * 0.2, 0);
      ctx.lineTo(-sz * 0.4, sz * 0.3);
      ctx.closePath();
      ctx.fillStyle = 'hsla(' + s.hue + ',40%,40%,' + a + ')';
      ctx.fill();
    } else {
      // Fighter — classic chevron
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(-sz * 0.5, -sz * 0.45);
      ctx.lineTo(-sz * 0.15, 0);
      ctx.lineTo(-sz * 0.5, sz * 0.45);
      ctx.closePath();
      ctx.fillStyle = 'hsla(' + s.hue + ',35%,35%,' + a + ')';
      ctx.fill();
    }
    ctx.restore();

    // Chase behavior
    if (s.chaseTarget) {
      var t = s.chaseTarget;
      var dx = t.x - s.x, dy = t.y - s.y;
      var targetAngle = Math.atan2(dy, dx);
      var diff = targetAngle - s.angle;
      // Normalize angle diff
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      s.angle += diff * 0.015;
    } else {
      // Gentle meandering
      s.angle += Math.sin(time * s.turnRate) * 0.003;
    }
    s.dx = Math.cos(s.angle) * s.speed;
    s.dy = Math.sin(s.angle) * s.speed;
    s.x += s.dx; s.y += s.dy;
    // Wrap
    var margin = s.size * 3;
    if (s.x < -margin) s.x = w + margin;
    if (s.x > w + margin) s.x = -margin;
    if (s.y < -margin) s.y = h + margin;
    if (s.y > h + margin) s.y = -margin;
  }

  // ── Treasure ─────────────────────────────────────────────
  function createTreasure() {
    var types = ['gem', 'coin', 'chest'];
    var t = types[Math.floor(Math.random() * types.length)];
    return {
      shape: t,
      x: Math.random() * w,
      y: Math.random() * h,
      size: t === 'chest' ? 5 + Math.random() * 3 : 3 + Math.random() * 2,
      dx: (Math.random() - 0.5) * 0.08,
      dy: (Math.random() - 0.5) * 0.06,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: 0.002 + Math.random() * 0.006,
      alpha: 0.06 + Math.random() * 0.06,
      hue: t === 'gem' ? 280 + Math.random() * 40 :
           t === 'coin' ? 45 + Math.random() * 15 : 30,
      twinklePhase: Math.random() * Math.PI * 2,
    };
  }

  function drawTreasure(t, time) {
    ctx.save();
    ctx.translate(t.x, t.y);
    t.rotation += t.rotSpeed;
    ctx.rotate(t.rotation);
    var twinkle = Math.sin(time * 0.005 + t.twinklePhase);
    var a = t.alpha + twinkle * 0.02;
    var sz = t.size;

    if (t.shape === 'gem') {
      // Diamond shape
      ctx.beginPath();
      ctx.moveTo(0, -sz);
      ctx.lineTo(sz * 0.6, 0);
      ctx.lineTo(0, sz * 0.7);
      ctx.lineTo(-sz * 0.6, 0);
      ctx.closePath();
      ctx.fillStyle = 'hsla(' + t.hue + ',60%,55%,' + a + ')';
      ctx.fill();
      // Sparkle
      ctx.beginPath();
      ctx.arc(0, -sz * 0.3, sz * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + t.hue + ',80%,80%,' + (a * 1.5) + ')';
      ctx.fill();
    } else if (t.shape === 'coin') {
      // Circle with inner ring
      ctx.beginPath();
      ctx.arc(0, 0, sz, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(' + t.hue + ',70%,50%,' + a + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, sz * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'hsla(' + t.hue + ',60%,70%,' + (a * 0.8) + ')';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    } else {
      // Chest — small rectangle with lid
      ctx.fillStyle = 'hsla(' + t.hue + ',50%,30%,' + a + ')';
      ctx.fillRect(-sz, -sz * 0.5, sz * 2, sz);
      ctx.fillStyle = 'hsla(50,70%,50%,' + (a * 0.8) + ')';
      ctx.fillRect(-sz * 0.9, -sz * 0.6, sz * 1.8, sz * 0.3);
      // Latch
      ctx.beginPath();
      ctx.arc(0, -sz * 0.1, sz * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(50,80%,60%,' + (a * 1.2) + ')';
      ctx.fill();
    }
    // Glow
    ctx.beginPath();
    ctx.arc(0, 0, sz * 2, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(' + t.hue + ',50%,50%,' + (a * 0.08) + ')';
    ctx.fill();
    ctx.restore();

    t.x += t.dx; t.y += t.dy;
    if (t.x < -10) t.x = w + 10;
    if (t.x > w + 10) t.x = -10;
    if (t.y < -10) t.y = h + 10;
    if (t.y > h + 10) t.y = -10;
  }

  // ── Comets ───────────────────────────────────────────────
  function spawnComet() {
    var fromLeft = Math.random() > 0.5;
    var startX = fromLeft ? -20 : w + 20;
    var startY = Math.random() * h * 0.6;
    var angle = fromLeft ? (-0.2 + Math.random() * 0.4) : (Math.PI - 0.2 + Math.random() * 0.4);
    var speed = 2.5 + Math.random() * 3;
    return {
      x: startX,
      y: startY,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed + 0.5,
      size: 2 + Math.random() * 2,
      alpha: 0.3 + Math.random() * 0.3,
      tailLen: 40 + Math.random() * 60,
      hue: Math.random() < 0.5 ? 200 : 30, // blue or amber
      life: 0,
      maxLife: 200 + Math.random() * 150,
    };
  }

  function drawComet(c) {
    c.life++;
    var fadeIn = Math.min(c.life / 15, 1);
    var fadeOut = Math.max(1 - (c.life - c.maxLife + 30) / 30, 0);
    var a = c.alpha * fadeIn * (c.life > c.maxLife - 30 ? fadeOut : 1);
    if (a <= 0) return;

    // Tail (gradient line)
    var angle = Math.atan2(c.dy, c.dx);
    var tx = c.x - Math.cos(angle) * c.tailLen;
    var ty = c.y - Math.sin(angle) * c.tailLen;
    var grad = ctx.createLinearGradient(c.x, c.y, tx, ty);
    grad.addColorStop(0, 'hsla(' + c.hue + ',70%,70%,' + a + ')');
    grad.addColorStop(0.3, 'hsla(' + c.hue + ',50%,50%,' + (a * 0.4) + ')');
    grad.addColorStop(1, 'hsla(' + c.hue + ',40%,40%,0)');
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = grad;
    ctx.lineWidth = c.size * 0.8;
    ctx.stroke();

    // Head
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(' + c.hue + ',60%,80%,' + a + ')';
    ctx.fill();
    // Head glow
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.size * 3, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(' + c.hue + ',50%,60%,' + (a * 0.15) + ')';
    ctx.fill();

    c.x += c.dx; c.y += c.dy;
  }

  // ── Structures (Dyson Sphere) ────────────────────────────
  function createStructure() {
    return {
      x: w * (0.15 + Math.random() * 0.7),
      y: h * (0.15 + Math.random() * 0.7),
      r: 25 + Math.random() * 20,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: 0.0003 + Math.random() * 0.0005,
      alpha: 0.025 + Math.random() * 0.02,
      ringCount: 2 + Math.floor(Math.random() * 2),
      starHue: 40 + Math.random() * 20,
    };
  }

  function drawStructure(s, time) {
    s.rotation += s.rotSpeed;
    var a = s.alpha;
    // Central star
    var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 0.25);
    g.addColorStop(0, 'hsla(' + s.starHue + ',80%,70%,' + (a * 2.5) + ')');
    g.addColorStop(0.5, 'hsla(' + s.starHue + ',60%,50%,' + (a * 1.2) + ')');
    g.addColorStop(1, 'hsla(' + s.starHue + ',40%,30%,0)');
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // Dyson rings
    ctx.strokeStyle = 'hsla(210,30%,50%,' + (a * 1.2) + ')';
    ctx.lineWidth = 0.8;
    for (var i = 0; i < s.ringCount; i++) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rotation + (i * Math.PI / s.ringCount));
      ctx.beginPath();
      ctx.ellipse(0, 0, s.r, s.r * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Orbital energy nodes (small dots on rings)
    for (var j = 0; j < 4; j++) {
      var nodeAngle = s.rotation * 2 + j * Math.PI * 0.5;
      var nx = s.x + Math.cos(nodeAngle) * s.r * 0.9;
      var ny = s.y + Math.sin(nodeAngle) * s.r * 0.3;
      ctx.beginPath();
      ctx.arc(nx, ny, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = 'hsla(190,70%,60%,' + (a * 2) + ')';
      ctx.fill();
    }

    // Outer glow
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 1.3, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(220,30%,40%,' + (a * 0.2) + ')';
    ctx.fill();
  }

  // ── Initialization ───────────────────────────────────────
  function init() {
    resize();
    stars = []; planets = []; ships = []; treasures = []; comets = []; structures = [];

    // 75 stars
    for (var i = 0; i < 75; i++) stars.push(createStar());

    // 4 planets
    for (var i = 0; i < 4; i++) planets.push(createPlanet());

    // 12 ships: 4 fighters, 2 cruisers, 2 frigates, 2 scouts, 1 bomber, 1 mothership
    var shipCounts = { fighter: 4, cruiser: 2, frigate: 2, scout: 2, bomber: 1, mothership: 1 };
    for (var type in shipCounts) {
      for (var j = 0; j < shipCounts[type]; j++) {
        ships.push(createShip(type));
      }
    }

    // Set up chase pairs: some fighters chase each other, scouts chase mothership
    var fighters = ships.filter(function(s) { return s.type === 'fighter'; });
    var scouts = ships.filter(function(s) { return s.type === 'scout'; });
    var mothership = ships.find(function(s) { return s.type === 'mothership'; });
    // Pair fighters: 0 chases 1, 1 chases 0 (dogfight), 2 chases 3
    if (fighters.length >= 4) {
      fighters[0].chaseTarget = fighters[1];
      fighters[1].chaseTarget = fighters[0];
      fighters[2].chaseTarget = fighters[3];
    }
    // Scouts escort mothership
    scouts.forEach(function(s) { s.chaseTarget = mothership; });

    // 5 treasure items
    for (var i = 0; i < 5; i++) treasures.push(createTreasure());

    // 1 Dyson sphere
    structures.push(createStructure());

    // First comet after 5-15s
    nextCometTime = 5000 + Math.random() * 10000;
  }

  // ── Main draw loop ───────────────────────────────────────
  function draw(time) {
    if (paused) { animId = null; return; }

    ctx.clearRect(0, 0, w, h);

    // Faint nebula gradient
    var grd = ctx.createRadialGradient(w * 0.7, h * 0.3, 0, w * 0.7, h * 0.3, w * 0.5);
    grd.addColorStop(0, 'rgba(99, 102, 241, 0.015)');
    grd.addColorStop(0.5, 'rgba(139, 92, 246, 0.008)');
    grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    // Second nebula (lower left)
    var grd2 = ctx.createRadialGradient(w * 0.2, h * 0.8, 0, w * 0.2, h * 0.8, w * 0.4);
    grd2.addColorStop(0, 'rgba(16, 185, 129, 0.01)');
    grd2.addColorStop(0.6, 'rgba(34, 211, 238, 0.006)');
    grd2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grd2;
    ctx.fillRect(0, 0, w, h);

    // Draw layers back to front
    // 1. Structures (furthest back)
    for (var i = 0; i < structures.length; i++) drawStructure(structures[i], time);

    // 2. Planets
    for (var i = 0; i < planets.length; i++) drawPlanet(planets[i], time);

    // 3. Stars
    for (var i = 0; i < stars.length; i++) drawStar(stars[i], time);

    // 4. Treasure
    for (var i = 0; i < treasures.length; i++) drawTreasure(treasures[i], time);

    // 5. Ships
    for (var i = 0; i < ships.length; i++) drawShip(ships[i], time);

    // 6. Comets (foreground)
    if (time > nextCometTime && comets.length < 3) {
      comets.push(spawnComet());
      nextCometTime = time + 8000 + Math.random() * 22000; // 8-30s between comets
    }
    for (var i = comets.length - 1; i >= 0; i--) {
      drawComet(comets[i]);
      if (comets[i].life > comets[i].maxLife || comets[i].x < -100 || comets[i].x > w + 100 || comets[i].y > h + 100) {
        comets.splice(i, 1);
      }
    }

    animId = requestAnimationFrame(draw);
  }

  // Pause when tab not visible
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      paused = true;
    } else {
      paused = false;
      if (!animId) animId = requestAnimationFrame(draw);
    }
  });

  window.addEventListener('resize', function() {
    resize();
  });

  init();
  animId = requestAnimationFrame(draw);
})();
