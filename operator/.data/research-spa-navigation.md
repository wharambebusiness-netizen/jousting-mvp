# SPA Navigation Research — Master Console & Worker System

**Date:** 2026-02-27
**Analyst:** Research Worker
**Source file:** operator/public/app.js (1890 lines)
**Supporting files:** console.js, terminals.js, taskboard.js, style.css, *.html

---

## Executive Summary

The operator dashboard uses HTMX boost (`hx-boost="true"` on `<body>`) to create SPA-like navigation while keeping server-rendered HTML. A page cache mechanism preserves `<main>` DOM elements (and their xterm.js instances) across navigation. The system is largely functional but has five significant gaps: (1) no `popstate` handler for browser back/forward with cached pages, (2) no initial `updateSidebarActiveLink()` call on hard refresh, (3) no transition animations on page swap or sidebar active state, (4) console.js binary WS connections are not tracked for potential cleanup, and (5) fitAddon.fit() timing is synchronous when it should use rAF deferral.

---

## 1. Page Cache Mechanism

### Architecture (app.js:267–356)

```
_pageCache = { '/console': { main: HTMLElement, cleanups: [] }, ... }
CACHEABLE_PAGES = ['/console', '/terminals']
```

**Save path (htmx:beforeSwap, app.js:270):**
1. Fired when HTMX is about to replace `<body>` content
2. Checks for `<main data-page-id="…">` on current page
3. If `'/' + pageId` is in `CACHEABLE_PAGES`:
   - Calls `currentMain.remove()` — detaches from DOM, preserving all JS state in xterm closures
   - Saves `{ main, cleanups: _pageCleanups.slice() }` to `_pageCache[pagePath]`
   - Resets `_pageCleanups = []`
   - Returns early (skips running cleanups)
4. Otherwise: runs all registered `onPageCleanup` callbacks

**Restore path (click handler, app.js:344–356):**
1. Intercepts clicks on `.sidebar-nav__link` with `data-page` attribute
2. If pagePath is in CACHEABLE_PAGES AND `_pageCache[pagePath]` exists:
   - `e.preventDefault()` + `e.stopPropagation()` — blocks HTMX navigation
   - Calls `restoreCachedPage(pagePath)`

**restoreCachedPage (app.js:299–327):**
1. Removes current `<main>` from DOM
2. Inserts cached `<main>` after `#sidebar-nav` (or before toast container)
3. Restores `_pageCleanups = cached.cleanups`
4. Deletes cache entry (`delete _pageCache[pagePath]` — single-use cache)
5. Calls `history.pushState({}, '', pagePath)` — updates URL
6. Calls `updateSidebarActiveLink()` — updates sidebar highlight
7. Dispatches `terminal-page-restored` custom event with `{ page: pagePath }`

**disposeCachedPage (app.js:334–341):** Runs saved cleanups and deletes entry. Currently only called manually; nothing calls it automatically.

### Key Properties

| Property | Value |
|---|---|
| Cache is keyed by | URL path (e.g., `/console`) |
| Cache is single-use | Yes — entry deleted after restore |
| Cache entry preserved when | Navigating AWAY from a cacheable page |
| Cache entry used when | Clicking sidebar link for cached page |
| Non-cacheable pages | Run all `onPageCleanup` callbacks on departure |

### Bugs and Gaps

**BUG-1: `data-page-id` mismatch risk**
The cache key is `'/' + currentMain.getAttribute('data-page-id')`. The console page has `data-page-id="console"` → key `/console`. The terminals page has `data-page-id="terminals"` → key `/terminals`. This matches CACHEABLE_PAGES. Works correctly but is a fragile implicit convention.

**BUG-2: Cache entry never pre-warmed**
The cache only holds a page if you've visited it. Navigating directly to `/settings` → clicking `/console` goes through HTMX (no cache hit). Only visiting `/console` and then navigating away creates a cache entry. This is expected behavior but means "first navigation" always does a full page load.

**GAP: No automatic cache eviction**
If the user never returns to `/console`, the cache entry and all xterm instances (plus binary WS) stay alive forever. Low memory pressure risk but worth noting. `disposeCachedPage` exists but is never called automatically.

---

## 2. WebSocket Connection Lifecycle Across Page Navigation

### Global WS connections (app.js — initialized once, persist forever)

These are top-level IIFE calls in app.js. Since app.js is in `<head>`, it's NOT replaced by HTMX body swaps. They run exactly once per browser tab session:

| Connection | Subscriptions | Location |
|---|---|---|
| Notification bell | `['notification:*']` | app.js:498 |
| Dashboard chain updates | `['chain:*']` | app.js:587 |
| File watcher | `['project:*']` | app.js:1258 |

**These survive all navigation without issue.**

### Per-page WS connections

**terminals.js (correct pattern):**
```js
// On page init (re-runs on each HTMX navigation to /terminals):
if (wsHandle) { wsHandle.close(); wsHandle = null; }  // close old
connectWS();  // create new
onPageCleanup(function() {  // register cleanup for departure
  if (wsHandle) { wsHandle.close(); wsHandle = null; }
  instances.forEach(function(inst) {
    if (inst.type === 'claude' && inst.binaryWs) inst.binaryWs.close();
  });
});
```
Since `/terminals` is cacheable, the `onPageCleanup` callback is SAVED (not run) when navigating away. The WS survives in the detached DOM's closure. On restore, the WS is still live. **No re-init needed.**

**taskboard.js (correct pattern):**
```js
onPageCleanup(function () {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (wsHandle) { wsHandle.close(); wsHandle = null; }
});
```
Taskboard is NOT cacheable, so cleanup runs on departure. WS is properly closed. ✓

**console.js (incomplete pattern):**
```js
// setupWsEvents() creates: createWS(['claude-terminal:*', 'coord:task-*'], ...)
// NO onPageCleanup registered anywhere in console.js
```
Since `/console` is cacheable, this omission is benign — the page is never truly "cleaned up" while navigating, it's always detached/restored. But if CACHEABLE_PAGES were changed to remove `/console`, WS connections would leak.

**console.js binary WS connections:**
- `masterBinaryWs` — binary PTY stream to master terminal
- `workerTerminals[id].binaryWs` — binary PTY streams to workers

Both are stored in the console.js IIFE closure. They survive page cache/restore perfectly. The master PTY session on the server remains connected throughout navigation.

### WS Connection State During Navigation

| State | masterBinaryWs | workerTerminals WS | event WS (createWS) |
|---|---|---|---|
| On /console | OPEN | OPEN | OPEN |
| Navigate to /settings (console cached) | OPEN (detached) | OPEN (detached) | OPEN (detached) |
| Restore /console from cache | OPEN (reattached) | OPEN (reattached) | OPEN (reattached) |
| Navigate to /settings (no cache hit) | (impossible — always cached after first visit) | — | — |

### Key Finding: WS Connections Survive Cache

All WS connections in console.js survive navigation because the `/console` page is always cached, never truly destroyed. The PTY sessions on the server stay connected. This is the intended behavior and works correctly.

---

## 3. xterm Instance Preservation

### How xterm Survives Navigation

xterm.js `Terminal` objects are held in JS closure variables:
- `masterTerminal` — master Claude session
- `masterFitAddon` — FitAddon for master
- `workerTerminals = { [id]: { term, fitAddon, binaryWs } }` — per-worker terminals

These are module-level variables inside the console.js IIFE. When `<main>` is detached from DOM:
- The `<div>` containers that xterm rendered into are detached (part of `<main>`)
- The xterm Terminal objects remain alive (not GC'd, referenced by closure)
- xterm's internal canvas element is also part of the detached subtree — it's preserved!

When `<main>` is reattached:
- The canvas elements come back into the live DOM
- xterm continues rendering to the same canvas
- Binary WS data is still flowing, and xterm writes continue working

### Refit on Restore

`terminal-page-restored` event triggers `fitAddon.fit()` on all terminals:

**console.js (app.js:1500–1512):**
```js
document.addEventListener('terminal-page-restored', function(e) {
  if (e.detail && e.detail.page === '/console') {
    if (masterFitAddon) masterFitAddon.fit();
    Object.keys(workerTerminals).forEach(function(id) {
      if (workerTerminals[id] && workerTerminals[id].fitAddon)
        workerTerminals[id].fitAddon.fit();
    });
  }
});
```

**terminals.js (app.js:201–207):**
```js
document.addEventListener('terminal-page-restored', function(e) {
  if (e.detail && e.detail.page === '/terminals') {
    instances.forEach(function(inst) {
      if (inst.fitAddon) inst.fitAddon.fit();
    });
  }
});
```

### BUG: fitAddon.fit() timing

`fitAddon.fit()` is called synchronously immediately after `<main>` reattachment. At this moment:
- The element is in the DOM
- CSS layout hasn't been calculated yet (layout is async)
- `fit()` measures container dimensions — which may be 0 or stale

Fix: defer `fit()` calls with `requestAnimationFrame` + 50ms:
```js
document.addEventListener('terminal-page-restored', function(e) {
  if (e.detail && e.detail.page === '/console') {
    requestAnimationFrame(function() {
      setTimeout(function() {
        if (masterFitAddon) { try { masterFitAddon.fit(); } catch (_) {} }
        Object.keys(workerTerminals).forEach(function(id) {
          var entry = workerTerminals[id];
          if (entry && entry.fitAddon) { try { entry.fitAddon.fit(); } catch (_) {} }
        });
      }, 50);
    });
  }
});
```

### ResizeObserver Across Detach/Reattach

`masterResizeObserver` in console.js observes the master terminal container. When `<main>` is detached:
- The observed element is no longer in the live DOM
- ResizeObserver callbacks stop firing (browser suppresses them for detached elements)
- When reattached, the observer resumes automatically (no re-registration needed)

This is correct behavior in Chrome/Firefox. **No action needed.**

---

## 4. History API Routing (pushState/popState)

### Current State

**pushState usage:**
- HTMX boost handles pushState for all normal navigations (links, forms)
- `restoreCachedPage()` calls `history.pushState({}, '', pagePath)` manually (app.js:320)

**popState: NOT HANDLED**

There is no `window.addEventListener('popstate', ...)` anywhere in the codebase. This means:

**Scenario: Back button on cached page**
1. User at `/` → navigates to `/console` (cache miss, HTMX loads page)
2. User navigates to `/settings` (console saved to cache, HTMX loads settings)
3. User presses Back button
4. Browser fires `popstate` with URL = `/console`
5. **No handler** → browser does a full page reload of `/console` from server
6. Console.js reinitializes, creates new xterm instances, new WS connections
7. The cached `_pageCache['/console']` entry is orphaned (never disposed)

**Scenario: Forward button after back**
Same problem — forward button after a back navigation causes full page reload.

**Impact:** Every browser back/forward navigation destroys xterm instances even when a cache entry exists. The page cache only helps with sidebar link clicks, not browser navigation.

### Proposal: popstate Handler

Add to app.js (after `restoreCachedPage` definition):

```js
// Handle browser back/forward for cached pages
window.addEventListener('popstate', function(e) {
  var path = window.location.pathname;
  if (CACHEABLE_PAGES.indexOf(path) !== -1 && _pageCache[path]) {
    // Restore cached page — don't call pushState again (we're navigating in history)
    var cached = _pageCache[path];

    // Save current page to cache if cacheable
    var currentMain = document.querySelector('main[data-page-id]');
    if (currentMain) {
      var currentPageId = currentMain.getAttribute('data-page-id');
      var currentPath = '/' + currentPageId;
      if (CACHEABLE_PAGES.indexOf(currentPath) !== -1) {
        currentMain.remove();
        _pageCache[currentPath] = { main: currentMain, cleanups: _pageCleanups.slice() };
        _pageCleanups = [];
      }
    }

    // Reattach cached page
    var existing = document.querySelector('main');
    if (existing) existing.remove();
    var sidebar = document.getElementById('sidebar-nav');
    if (sidebar && sidebar.nextSibling) {
      sidebar.parentNode.insertBefore(cached.main, sidebar.nextSibling);
    } else {
      document.body.insertBefore(cached.main, document.getElementById('toast-container'));
    }
    _pageCleanups = cached.cleanups;
    delete _pageCache[path];

    updateSidebarActiveLink();
    document.dispatchEvent(new CustomEvent('terminal-page-restored', { detail: { page: path } }));
  }
  // For non-cached pages, HTMX handles popstate via its own popstate handler
});
```

### Proposal: Rich History State

Replace empty `history.pushState({}, '', pagePath)` with typed state:

```js
// In restoreCachedPage:
history.pushState({ spa: true, fromCache: true, page: pagePath }, '', pagePath);

// In htmx:afterSettle (HTMX boost navigation):
// HTMX already calls pushState — we can't easily enrich this without HTMX plugin
```

Rich state allows `popstate` handler to distinguish between "HTMX-managed" and "cache-managed" history entries.

### Proposal: URL fragment routing

For `/console` sub-navigation (e.g., which worker is expanded), use URL fragments:
```
/console#worker-abc123
```
`restoreCachedPage` could restore and scroll to the fragment target. This is lower priority than the popstate fix.

---

## 5. Sidebar Active State Management

### Current Implementation (app.js:665–686)

```js
function updateSidebarActiveLink() {
  var path = window.location.pathname;
  var links = document.querySelectorAll('.sidebar-nav__link');
  for (var i = 0; i < links.length; i++) {
    var linkPage = links[i].getAttribute('data-page');
    var isActive = (linkPage === path)
      || (linkPage === '/' && path === '/index.html');
    links[i].classList.toggle('sidebar-nav__link--active', isActive);
  }
}

// Called on:
document.body.addEventListener('htmx:afterSettle', function() {
  updateSidebarActiveLink();
});
// And in restoreCachedPage() — line 321
```

### CSS (style.css:251–258)

```css
.sidebar-nav__link--active {
  color: var(--accent-hover);
  background: var(--accent-bg);
  box-shadow: inset 2px 0 0 var(--accent);
}
```

**No transition is defined** — active state flips instantaneously.

### BUG: No initial active state on hard refresh

`updateSidebarActiveLink()` is only called on `htmx:afterSettle` and `restoreCachedPage()`. On initial hard page load:
- `htmx:afterSettle` does NOT fire (HTMX fires it after its own swaps, not on initial load)
- `restoreCachedPage()` doesn't run (no cache on fresh load)
- **Result:** No sidebar link shows as active on hard refresh

**Fix:** Call `updateSidebarActiveLink()` immediately (or on `DOMContentLoaded`):
```js
// At bottom of app.js, after function definitions:
updateSidebarActiveLink();
```
Since app.js is loaded at end of body (or with defer), this runs after DOM is ready.

### BUG: Chain detail pages don't highlight Dashboard

When viewing `/chains/some-id`, no sidebar link is active because `data-page="/chains/some-id"` doesn't exist. The dashboard link has `data-page="/"`.

**Fix:** Prefix matching:
```js
function updateSidebarActiveLink() {
  var path = window.location.pathname;
  var links = document.querySelectorAll('.sidebar-nav__link');
  for (var i = 0; i < links.length; i++) {
    var linkPage = links[i].getAttribute('data-page');
    var isActive = (linkPage === path)
      || (linkPage === '/' && (path === '/index.html' || path.startsWith('/chains/')))
      || (path.startsWith(linkPage) && linkPage !== '/');
    links[i].classList.toggle('sidebar-nav__link--active', isActive);
  }
}
```

### GAP: No transition animation

Active state changes are instant. Adding CSS transitions gives polish:
```css
.sidebar-nav__link {
  transition: background 150ms ease, color 150ms ease, box-shadow 150ms ease;
}
```

### GAP: No page enter animation

HTMX body swaps are instant. Adding a subtle fade/slide:
```css
@keyframes page-enter {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}
main.page {
  animation: page-enter 180ms ease;
}
```
This only applies to HTMX-swapped `<main>` elements (not cached restores, which reuse the existing element).

---

## 6. Implementation Proposals (Prioritized)

### Priority 1 — Bug Fixes (No new features, minimal risk)

#### P1-A: Initial sidebar active state
**File:** `operator/public/app.js`
**Change:** Add `updateSidebarActiveLink();` call at bottom of file (after `loadProjects()` and `applySettingsDefaults()`).
**Risk:** None. Function is idempotent.

#### P1-B: fitAddon.fit() timing fix
**Files:** `operator/public/console.js`, `operator/public/terminals.js`
**Change:** Wrap `fit()` calls in `terminal-page-restored` handler with `requestAnimationFrame(() => setTimeout(() => ..., 50))`.
**Risk:** Low. Adds a ~66ms delay before terminal resize; invisible to users.

#### P1-C: Chain detail sidebar highlight
**File:** `operator/public/app.js`
**Change:** Update `updateSidebarActiveLink()` to use prefix matching for `/chains/` → `/`.
**Risk:** Low. Only changes class toggling logic.

### Priority 2 — UX Improvements (Low complexity)

#### P2-A: Sidebar transition animation
**File:** `operator/public/style.css`
**Change:** Add `transition: background 150ms ease, color 150ms ease;` to `.sidebar-nav__link`.
**Risk:** None. Pure CSS.

#### P2-B: Page enter animation
**File:** `operator/public/style.css`
**Change:** Add `@keyframes page-enter` + `animation` on `main.page`.
**Risk:** None. Does not apply to cache restores (element already animated on first visit).

### Priority 3 — Architecture Improvements (Moderate complexity)

#### P3-A: popstate handler for cached pages
**File:** `operator/public/app.js`
**Change:** Add `window.addEventListener('popstate', ...)` after `restoreCachedPage` definition.
**Risk:** Medium. Need to avoid interfering with HTMX's own popstate handler. Test: HTMX boost already registers its own popstate handler that fetches new pages. The custom handler must only intercept cached pages; for all others, fall through to HTMX.

**Implementation note:** Check HTMX popstate handling — HTMX 2.x listens to `popstate` and re-fetches. If we `e.preventDefault()` on the popstate event for cached pages, HTMX won't fetch. We need to call our handler FIRST (which we can ensure by registering before HTMX).

```js
// Register BEFORE htmx.js loads — or use capturing phase:
window.addEventListener('popstate', function(e) {
  var path = window.location.pathname;
  if (CACHEABLE_PAGES.indexOf(path) !== -1 && _pageCache[path]) {
    e.stopImmediatePropagation(); // prevent HTMX from fetching
    // ... restore from cache ...
  }
}, true);  // capturing phase = fires before HTMX's bubbling handler
```

#### P3-B: Extend CACHEABLE_PAGES to /projects
**Files:** `operator/public/app.js`, `operator/public/projects.html`
**Change:**
1. Add `data-page-id="projects"` to `<main>` in `projects.html`
2. Add `'/projects'` to `CACHEABLE_PAGES`
3. Register `onPageCleanup` for the projects WS connection (real-time file watcher)

**Benefit:** Preserves file tree expansion state, scroll position, and open file preview when navigating away and back.
**Risk:** Low. No xterm involved; DOM preservation is simpler.

#### P3-C: console.js defensive onPageCleanup registration
**File:** `operator/public/console.js`
**Change:** Register cleanup at end of init (as a safeguard if CACHEABLE_PAGES ever changes):
```js
if (typeof onPageCleanup === 'function') {
  onPageCleanup(function() {
    if (masterBinaryWs) { try { masterBinaryWs.close(); } catch(_) {} masterBinaryWs = null; }
    Object.keys(workerTerminals).forEach(function(id) {
      var e = workerTerminals[id];
      if (e && e.binaryWs) { try { e.binaryWs.close(); } catch(_) {} }
    });
  });
}
```
Since `/console` is cacheable, this cleanup is SAVED (not run) — no behavioral change today. But it provides safety if caching is ever disabled.

### Priority 4 — Future Architecture (High complexity)

#### P4-A: Full History API routing
Convert the app to use `pushState`/`popState` as the primary routing mechanism instead of HTMX boost. Pages would be loaded once and cached, with routing managed entirely in JS.

This is a significant architectural change requiring:
- A router module to manage page state
- Lazy page initialization (only init xterm on first visit)
- Proper forward/back stack management
- Server-side route handling for direct URL loads

**Recommendation:** Defer this until P3-A proves the popstate approach works. P3-A is a stepping stone.

#### P4-B: URL-based terminal selection
For `/console#master` or `/console#worker-abc123` — navigate to console and scroll to/expand the right panel.

---

## 7. Architecture Diagram

```
Browser Tab (single document lifetime)
│
├─ app.js (HEAD — loads once, persists forever)
│  ├─ Global WS: notification:*, chain:*, project:*  ← survives all navigation
│  ├─ _pageCache = {}                                ← terminal page stash
│  ├─ CACHEABLE_PAGES = ['/console', '/terminals']
│  ├─ htmx:beforeSwap → save cacheable <main>
│  ├─ sidebar click → restoreCachedPage()
│  └─ [MISSING] popstate → restoreCachedPage()
│
├─ HTMX Boost (hx-boost="true" on body)
│  ├─ Intercepts <a> clicks, fetches new page
│  ├─ Swaps <body> inner content (not <head>)
│  ├─ Fires htmx:beforeSwap, htmx:afterSettle
│  └─ Manages pushState/popstate for non-cached pages
│
├─ /console page (console.js — in <body>, re-runs on HTMX nav)
│  ├─ masterTerminal (xterm.js)       ← preserved in _pageCache
│  ├─ masterBinaryWs (PTY stream)     ← preserved in _pageCache
│  ├─ workerTerminals[id] (xterm.js)  ← preserved in _pageCache
│  ├─ Event WS (createWS)             ← preserved in _pageCache
│  └─ terminal-page-restored → fit()
│
├─ /terminals page (terminals.js — in <body>)
│  ├─ instances[] (xterm.js)          ← preserved in _pageCache
│  ├─ wsHandle (event WS)             ← preserved (via onPageCleanup saved)
│  └─ terminal-page-restored → fit()
│
└─ Other pages (/settings, /taskboard, /projects, /timeline)
   └─ Not cached → cleanup runs on departure, fresh init on return
```

---

## 8. Test Scenarios

### Test the existing cache mechanism:
1. Navigate to `/console`, start master terminal
2. Navigate to `/` (dashboard)
3. Click Console in sidebar → should restore instantly, terminal still running
4. ✓ Pass: terminal shows, WS connected, no re-init

### Test the missing popstate (current bug):
1. Navigate to `/console`, start master terminal
2. Navigate to `/settings` (console cached)
3. Press browser Back button
4. ✗ Fail: full page reload, terminal lost, cache entry orphaned

### Test initial active state (current bug):
1. Direct URL: `http://localhost:3100/console`
2. ✗ Fail: no sidebar link highlighted on initial load
3. Click any link and come back
4. ✓ Pass: active state updates on HTMX navigation

### Test fitAddon timing:
1. Navigate to `/console` with wide window
2. Navigate away (console cached)
3. Resize window to narrow
4. Navigate back to `/console`
5. Check: terminal dimensions should match new window size
6. Current: may work incorrectly (fit runs before layout)

---

## 9. Summary of Bugs vs. Enhancements

| ID | Type | Description | File | Priority |
|---|---|---|---|---|
| B1 | Bug | No popstate handler — back button destroys cached pages | app.js | P3-A |
| B2 | Bug | No initial `updateSidebarActiveLink()` call | app.js | P1-A |
| B3 | Bug | fitAddon.fit() called before CSS layout completes | console.js, terminals.js | P1-B |
| B4 | Bug | Chain detail pages don't highlight Dashboard link | app.js | P1-C |
| E1 | Enhancement | Sidebar link transition animation | style.css | P2-A |
| E2 | Enhancement | Page enter fade animation | style.css | P2-B |
| E3 | Enhancement | Cache /projects page | app.js, projects.html | P3-B |
| E4 | Enhancement | Defensive onPageCleanup in console.js | console.js | P3-C |
| E5 | Future | Full History API router | major refactor | P4-A |
| E6 | Future | URL fragment terminal selection | app.js, console.js | P4-B |
