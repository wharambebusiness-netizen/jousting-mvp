# HANDOFF — Session 154

## What Happened This Session

**Bug fixes for Phase 60 console + navigation crash fix.** Two commits pushed.

**4,005 tests passing** across 74 suites (unchanged from S153).

### Commit 1: Fix 8 Console Bugs from Phase 60 (`e07245b`)

Reviewed all Phase 60 code (console daily-driver enhancements) and found/fixed 8 bugs:

| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| 1 | **High** | `master-context.md` never served (always 404) — master terminal launched without system prompt | Added `GET /master-context.md` route in `server.mjs` |
| 2 | **High** | `onData`/`onResize` handlers stacked on each WS reconnect — doubled/tripled keystrokes | Store disposables, dispose before re-attaching |
| 3 | **High** | `sendInitialPrompt()` silently dropped prompt when WS wasn't open yet | Retry after 1.5s delay, show appropriate toasts |
| 4 | **Medium** | `chain.html` breadcrumb pointed to `/` (→ console) instead of `/dashboard` | Changed `href` to `/dashboard` |
| 5 | **Medium** | Reconnect timer from old master session leaked into restart flow | Clear `masterReconnectTimer` in `startMaster()` |
| 6 | **Medium** | `window resize` listeners and `ResizeObserver` leaked on start/stop cycles | Track by reference, remove/disconnect before re-adding |
| 7 | **Medium** | Swarm toggle sent `workerCount: 3` which server ignores | Changed to `{ minTerminals: 3, maxTerminals: 3 }` |
| 8 | **Low** | Scrollback restoration requested 500 lines but API capped at 200 | Raised API cap to 500 |

### Commit 2: Fix Console/Terminals Navigation Crash (`30d7c45`)

**Root cause:** `hx-boost="true"` on `<body>` caused HTMX AJAX swaps when navigating to/from Console and Terminals pages. This destroyed xterm.js instances and WebSocket connections, causing a disconnect/reconnect crash loop.

**Fixes:**
1. **`hx-boost="false"` on Console and Terminals sidebar links** (all 8 HTML pages) — forces full page loads for pages with heavy JS/WS state
2. **`onPageCleanup(cleanup)` in console.js** — registers cleanup with the existing page cache system in app.js
3. **`stopImmediatePropagation()` in app.js** — prevents HTMX from competing with cached page restoration clicks

Also committed **7 worker research files** from the master console's 8-worker swarm (produced before server restart):

| File | Lines | Topic |
|------|-------|-------|
| `research-console-ux.md` | 647 | Worker card improvements |
| `research-monitoring.md` | 545 | Real-time monitoring & dashboard widgets |
| `research-spa-navigation.md` | 585 | SPA navigation (independently found same hx-boost bug) |
| `research-swarm.md` | 719 | Swarm mode & auto-scaling |
| `research-task-integration.md` | 462 | Task board ↔ workers integration |
| `research-terminals-integration.md` | 447 | Terminals page worker integration |
| `research-worker-prompts.md` | 361 | Worker prompt/instruction system |

### Files Modified

| File | Changes |
|------|---------|
| `operator/server.mjs` | Added `GET /master-context.md` route |
| `operator/routes/claude-terminals.mjs` | Raised output API cap from 200 → 500 lines |
| `operator/public/console.js` | Fixed handler stacking, prompt drop, reconnect timer, resize leaks, swarm params, added cleanup system |
| `operator/public/chain.html` | Fixed breadcrumb `/` → `/dashboard` |
| `operator/public/app.js` | `stopPropagation` → `stopImmediatePropagation` in page cache click handler |
| `operator/public/*.html` (all 8) | Added `hx-boost="false"` on Console + Terminals sidebar links |
| `operator/.data/research-*.md` (7 files) | Worker research output from swarm |

---

## Test Suite

**4,005 tests** across **74 suites** — all passing.
- Run: `npm test` or `npx vitest run`

## State Variables Added to console.js

```javascript
var masterOnDataDisposable = null;   // disposable from masterTerminal.onData()
var masterOnResizeDisposable = null; // disposable from masterTerminal.onResize()
var masterResizeHandler = null;      // bound window resize handler (for removal)
var masterResizeObserver = null;     // ResizeObserver instance (for disconnect)
```

Plus a `cleanup()` function registered via `onPageCleanup()` that closes all WS, disposes xterm instances, and clears timers.

## Gotchas

- `hx-boost="false"` on Console/Terminals links means these pages always do full browser navigation (not HTMX AJAX swaps), unless the page cache system intercepts and restores a cached version
- The page cache in app.js (`CACHEABLE_PAGES = ['/console', '/terminals']`) detaches `<main>` on navigation away and re-attaches on return — WS connections survive during caching
- `stopImmediatePropagation()` is critical in the cache click handler — `stopPropagation()` only blocks parent element handlers, not same-element handlers (like HTMX's)
- `master-context.md` is now served from `operator/master-context.md` (not `public/`) via explicit route before `express.static`
- Binary WS ping/pong: server pings every 30s, terminates if no pong in 10s — WS must respond to pings even when page is cached/detached

## Next Steps — PRIORITY: Review & Implement Worker Research

**The 7 worker research files have been reviewed. A detailed analysis with bugs, mistakes, and implementation priorities is saved at `memory/worker-research-review.md`. READ THAT FILE FIRST.**

### Step 1: Trivial Bug Fixes (do immediately)
- `taskboard.js:1557` — change `'in-progress'` to `'running'` (confirmed real bug, wrong status string)
- `app.js` — call `updateSidebarActiveLink()` on initial page load (function exists at ~line 665 but is never called on first load, so sidebar has no active highlight until navigation)
- `console.js` — wrap `fitAddon.fit()` calls in `requestAnimationFrame + setTimeout(50)` after cache restore (timing bug causes incorrect terminal sizing)

### Step 2: Task Board Integration (high value)
- `server.mjs` — extend `needsCoordinator` condition to include `|| options.claudePool` so coordinator auto-starts when terminals are active (currently task board shows "pool mode required" errors)
- `claude-pool.mjs` — emit `coord:assigned` event when a Claude worker claims a task (bridges coordinator events)

### Step 3: Console UX Improvements (from research-console-ux.md)
- Increase mini-terminal heights (80→120px collapsed, 240→360px expanded)
- Add respawn button for stopped workers (but do NOT pass `id` in spawn body — endpoint doesn't accept user-supplied IDs)
- Add "Dismiss All Stopped" button
- Show exit code/signal on stopped worker cards
- Add inline prompt textarea per worker (use `POST /api/claude-terminals/:id/input` — already exists)

### Step 4: Swarm Hardening (from research-swarm.md)
- Batch scale-up: spawn up to 4 terminals per tick instead of 1
- Circuit breaker: halt swarm after 5 consecutive spawn failures
- Exponential backoff on respawn after crash
- Try/catch around `taskQueue.retry()` in task recovery

### Step 5: Dashboard & Navigation Polish
- WS subscriptions in index.html to trigger widget reloads in near-real-time (no backend changes needed)
- Terminals page `?tab=<terminalId>` deep-linking for console worker card links

### Known Mistakes in Research Files (must fix before implementing)
| File | Mistake |
|------|---------|
| research-console-ux.md | Respawn POSTs with `id: w.id` — spawn endpoint ignores user-supplied IDs |
| research-console-ux.md | Hardcodes `dangerouslySkipPermissions: true` — should read from original worker |
| research-terminals-integration.md | Claims "no embedded xterm in worker cards" — **WRONG**, worker cards DO have live mini-xterm instances |
| research-swarm.md | References `tasksPerWorker` variable that doesn't exist — needs introduction |
| research-swarm.md | References `respawnWithModel()` function that doesn't exist — needs implementation |
| research-worker-prompts.md | No mention of CSRF tokens on fetch() calls — app.js wrapper handles it but verify |
| research-worker-prompts.md | Hardcodes `from: 'master'` — should use actual terminal ID or `'console-user'` |
| research-spa-navigation.md | Dashboard path analysis assumes `/` not `/dashboard` — Phase 60 changed this |
| research-monitoring.md | Claims 96 BRIDGED_EVENTS but MEMORY says 101 — verify actual count |

### After Research Implementation
1. **Phase 61: Template Library** — Pre-built task workflow patterns
2. **Phase 62: Multi-Project Dashboard** — Aggregate view across projects
3. Continue console polish items from HANDOFF-S153
