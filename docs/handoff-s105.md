# Session 105 Handoff — Phase 2: Multi-Terminal UI

## What S105 Should Do

**Phase 2 of multi-orchestrator plan**: Build the tabbed terminal interface with xterm.js and per-orchestrator color themes.

### Reference: `docs/multi-orchestrator-plan.md` Phase 2 checklist

### Priority 1: New terminals page
- `operator/public/terminals.html` — new HTML page following existing template pattern (doctype, head with Pico CSS + HTMX CDN, favicon, nav, main content area)
- Add xterm.js + xterm-addon-fit via CDN (unpkg or cdnjs, ~270KB total)
- Nav bar: add "Terminals" link on ALL 7 HTML pages (index, chain, projects, analytics, orchestrator, settings, terminals)
- Favicon on terminals.html (same inline SVG data URI as other pages)

### Priority 2: Tab bar component
- Vanilla JS tab bar (no framework) in terminals.html or a new `terminals.js`
- Tab per orchestrator instance with color-coded indicator dot
- 4 orchestrator color themes (CSS custom properties):
  - Indigo (#6366f1) — matches existing accent
  - Emerald (#10b981)
  - Amber (#f59e0b)
  - Rose (#f43f5e)
- CSS custom properties pattern: `[data-orch="1"]` through `[data-orch="4"]`
- Persist active tab to localStorage
- Click tab → switch terminal, keyboard shortcuts (Ctrl+1-4)
- Add/remove tab buttons

### Priority 3: Terminal rendering with xterm.js
- xterm.js Terminal instances, one per orchestrator
- xterm-addon-fit for responsive sizing (resize on window resize)
- Per-instance xterm.js theme objects using the 4 color palettes
- Terminal status bar per instance:
  - Running/stopped indicator dot (same semantic pattern as agent-card.mjs)
  - Round count, agent count, cost display
- WS integration:
  - Single WS connection using existing `createWS()` from app.js
  - Events tagged with `workerId` → client-side filtering → route to correct xterm.js instance
  - Key events to display: `worker:log`, `worker:ready`, `worker:exit`, `worker:error`, `worker:unhealthy`, `worker:restarted`, `worker:spawned`
  - Also display orchestrator events: `orchestrator:started`, `orchestrator:stopped`, `orchestrator:round`, `orchestrator:agent-started`, `orchestrator:agent-complete`

### Priority 4: View toggle
- Tab view ↔ 2x2 grid view toggle button
- CSS grid layout: `grid-template: 1fr 1fr / 1fr 1fr` for grid mode, single `1fr` for tab mode
- Grid view shows all 4 terminals simultaneously (smaller)
- Tab view shows one terminal full-width

### Priority 5: Instance management from terminals page
- "New Instance" button that POSTs to `/api/orchestrator/:id/start`
- Stop/restart buttons per terminal
- Instance status fetched from `GET /api/orchestrator/instances`
- Consider adding a simple form for instance config (mission file, model, dry-run)

### Priority 6: Tests
- Terminal page HTML renders correctly (server test)
- Tab switching logic (unit test if extracted)
- Grid layout toggle
- Nav link present on all pages
- WS event routing to correct terminal

## Current State

- **1647 tests ALL PASSING** across 26 test suites
- **Phase 0 + Phase 1 COMPLETE** — multi-instance backend fully functional
- Latest commit: `2500d29` — "S104: Phase 1 — process pool, multi-instance orchestrator, worker IPC"
- NOT pushed to remote yet

## Key Files to Read First

| File | Why |
|------|-----|
| `docs/multi-orchestrator-plan.md` | Full Phase 2 spec with color scheme |
| `operator/public/index.html` | Template for new HTML page structure |
| `operator/public/app.js` | Shared client JS — createWS(), toast system, keyboard shortcuts |
| `operator/public/style.css` | CSS design tokens, existing component styles |
| `operator/routes/orchestrator.mjs` | Multi-instance API endpoints (instances, :id/start, :id/stop) |
| `operator/ws.mjs` | BRIDGED_EVENTS (24 total, including 7 worker events) |
| `operator/process-pool.mjs` | Process pool API (spawn, kill, sendTo, getStatus) |
| `operator/routes/views.mjs` | HTMX fragment pattern for server-rendered views |
| `operator/views/agent-card.mjs` | Agent card HTML for reference on status rendering |

## Architecture Notes

- **Process pool is optional**: server works without pool (direct fork mode backward compat)
- **Workers are grandchild processes**: pool forks worker, worker forks orchestrator
- **IPC message flow**: orchestrator → (stdout/stderr) → worker → (process.send) → pool → (EventBus.emit) → ws.mjs → browser
- **Event routing by workerId**: all events include `workerId` field, routes look up instance state by `data.workerId || 'default'`
- **Legacy endpoints**: existing orchestrator UI works unchanged — uses 'default' instance
- **24 BRIDGED_EVENTS** in ws.mjs: chain:*, orchestrator:*, agent:*, project:files-changed, worker:*
- **xterm.js CDN**: use unpkg or cdnjs, no npm install needed (zero npm frontend deps policy)
- **CSS design tokens**: existing dark palette in style.css `:root[data-theme="dark"]` — extend with `--orch-N-accent` and `--orch-N-bg`
- **createWS()** in app.js: shared WS utility with exponential backoff, `trackStatus` drives nav indicator dot
- **Nav pattern**: sticky top, backdrop-filter blur, pill-shaped active link — grep any HTML page for the `<nav>` section
- **Favicon**: inline SVG data URI (two interlocking circles) — copy from any existing HTML page

## What NOT to Do

- Don't add npm frontend dependencies — CDN only (xterm.js, xterm-addon-fit)
- Don't break existing pages — terminals is a NEW page, existing orchestrator page stays
- Don't modify the process pool or orchestrator routes (Phase 1 is stable)
- Don't implement handoff workflow yet (that's Phase 3)
