# Next Session Instructions (S93)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S92

S92 completed **all P3 features** plus P4 test coverage:

1. **Multi-project dashboard** — Added `<select id="project-select">` to nav on all 4 pages (index, chain, orchestrator, settings). `loadProjects()` fetches `/api/projects` and populates dropdown. `onProjectChange()` saves to localStorage and reloads all HTMX panels. Global `htmx:configRequest` listener injects `?project=` param into every HTMX GET request automatically. Cost summary route now supports `?project=` filtering.

2. **Settings page** — New `operator/settings.mjs` with atomic file persistence (temp+rename), validation, and clamping. Schema: model (haiku/sonnet/opus), maxTurns (1-200), maxContinuations (1-20), maxBudgetUsd (0-100). New `operator/routes/settings.mjs` with GET/PUT endpoints. New `operator/public/settings.html` with form UI. `applySettingsDefaults()` in app.js pre-fills the quick-start form model select from saved settings.

3. **Session output viewer** — New `operator/views/terminal.mjs` with `ansiToHtml()` (16 ANSI colors + bold → HTML spans with `.ansi-*` classes) and `renderTerminalViewer()` (macOS-style terminal chrome with title bar, dots, scrollable pre). Replaces raw `<pre>` in session handoff lazy-load route.

4. **Real-time chain progress** — Expanded WS subscriptions from specific events to `chain:*` wildcard. Added `chain:assumed-complete` to BRIDGED_EVENTS in ws.mjs. Reduced aggressive polling: cost-summary 5s→30s, chain-list 5s→15s, chain-detail 5s→30s. Dashboard reloads chain table + cost grid on any `chain:*` WS event (2s debounce). Chain detail page has per-chain WS listener that only reloads on events matching its chainId.

5. **P4 test coverage** — +26 new tests: settings API (4: GET defaults, PUT save, PUT clamp, PUT empty), settings page route (1), chain sort/direction (2), terminal ANSI conversion (5), terminal render (4), settings form view (1), cost-summary project filter (2), chain list sort/direction (3), chain list project filter (2), agent grid in orch-status (2).

**1482 tests, 24 suites, all passing.** (+26 new tests.)

## What Changed (Files Modified)

```
NEW:  operator/settings.mjs               Settings persistence (atomic writes, validation, clamping)
NEW:  operator/routes/settings.mjs         GET/PUT /api/settings routes
NEW:  operator/views/terminal.mjs          ANSI-to-HTML converter + terminal viewer renderer
NEW:  operator/public/settings.html        Settings page with form UI
EDIT: operator/server.mjs                  Mount settings routes, settings page route, initSettings()
EDIT: operator/routes/views.mjs            Project filter on cost-summary, terminal viewer for handoffs,
                                            settings-form view route
EDIT: operator/ws.mjs                      Added chain:assumed-complete to BRIDGED_EVENTS
EDIT: operator/public/index.html           Project selector in nav, Settings link, reduced polling,
                                            cost-summary-grid ID with reload trigger
EDIT: operator/public/chain.html           Project selector, Settings link, reduced polling,
                                            WS-driven per-chain real-time reload
EDIT: operator/public/orchestrator.html    Project selector, Settings link
EDIT: operator/public/app.js               Project filter system, settings defaults, expanded WS to chain:*,
                                            dashboard real-time reload with 2s debounce
EDIT: operator/public/style.css            .nav__project-select, .settings-grid, .terminal-viewer,
                                            .terminal__title, .terminal__body, ANSI color classes
EDIT: operator/__tests__/server.test.mjs   +7 tests (settings API, settings page, chain sort)
EDIT: operator/__tests__/views.test.mjs    +19 tests (terminal, settings form, cost filter, sort, agent grid)
EDIT: CLAUDE.md                            Updated test counts, operator architecture section
EDIT: docs/session-history.md              S92 entry
```

## Remaining Operator Improvement Roadmap

### Priority 5: Integration & Core Gaps (HIGH) — NEXT UP

1. **Settings → operator CLI integration** — `operator.mjs` hardcodes defaults (MAX_CONTINUATIONS=5, MAX_TURNS=30, MAX_BUDGET=5.0) and never imports `loadSettings()`. Saved settings only affect the UI form pre-fill. Fix: import settings.mjs in operator.mjs and use saved values as fallback defaults when no CLI flags provided.

2. **Combined mode `--operator` wiring** — `server.mjs` parses `--operator` flag but never starts the operator daemon or provides `runChainFn`. POST /api/chains creates registry entries but can't execute chains. Fix: import operator chain runner and wire it up.

3. **Chain delete button** — DELETE /api/chains/:id exists but no button in chain table or chain detail page. Fix: add delete button (with hx-confirm) for non-running chains in chain-row.mjs and/or chain detail view.

4. **Chain pagination** — API supports limit/offset but views.mjs hardcodes `.slice(0, 50)` with no UI controls. Fix: add prev/next pagination below chain table.

### Priority 6: UI Feature Gaps (MEDIUM)

5. **Git commit UI** — POST /api/git/commit exists but git-status fragment only shows Push button. Add commit message input + Commit button when dirty.

6. **Chain text search** — No search by task text. Add `?q=` param to chain-list view and search input in filters.

7. **Chain detail branch display** — Chain meta section omits `chain.config.branch` even though it's a first-class field. Add it.

8. **Empty state text fix** — chain-row.mjs says "Start one below!" but the form is above the table.

9. **Form submission loading states** — No spinner or disabled state on Start/Launch buttons during HTMX requests.

10. **Auto-push server-side persistence** — Currently localStorage only. Move to settings.mjs so it persists across browsers and CLI can respect it.

### Priority 7: Polish & Enhancements (LOW)

- Per-model cost breakdown in cost summary
- Orchestrator run history (persist past runs)
- WebSocket reconnection with exponential backoff
- Modal/dialog component for confirmations (replace native confirm())
- Bulk chain actions (select multiple → delete/abort)
- Chain export (CSV/JSON)
- Keyboard shortcuts (N=new chain, /=search)
- Favicon
- Dark/light theme toggle
- Side-by-side handoff viewer
- WebSocket connection status indicator
- Chain dependency graph visualization

## Key Architecture Notes

- **app.js** now has 6 systems: (1) progress bar, (2) toast + global API toast listener, (3) branch auto-gen with manual override, (4) auto-push WS listener, (5) project filter with htmx:configRequest injection, (6) settings defaults pre-fill.
- **Project filter** flows: nav select → localStorage → htmx:configRequest listener injects `project` param into all GET requests → server routes filter by project.
- **Settings** flows: settings.html form → PUT /api/settings → settings.mjs validates+clamps → atomic write. Read by views.mjs settings-form route and app.js applySettingsDefaults().
- **Terminal viewer** flows: session-handoff view route → reads handoff file → ansiToHtml() converts ANSI escapes → renderTerminalViewer() wraps in terminal chrome → served as HTML fragment.
- **Real-time updates** flow: EventBus emits chain:* events → ws.mjs bridges to WebSocket clients → app.js receives → debounced htmx.trigger() on chain-table + cost-summary-grid. Chain detail page has its own WS listener that filters by chainId.
- **Settings NOT integrated with operator CLI** — this is the #1 gap for S93.

## Codebase Stats

```
Operator: 16 source files, ~3,400 lines code + ~2,700 lines tests
Routes:   24 API endpoints, 9 view fragment routes, 3 page routes, 1 WebSocket
Events:   16 bridged WS events, pattern-based subscriptions
Tests:    226 operator tests (server 85, views 77, errors 43, registry 21)
Total:    1482 tests across 24 suites (8 engine + 12 orchestrator + 4 operator)
```

## Running the Operator

```bash
node operator/server.mjs                    # API server on http://127.0.0.1:3100
node operator/server.mjs --port 8080        # Custom port
node operator/server.mjs --operator         # Combined mode (not yet wired — P5 task)
```

Dashboard at http://127.0.0.1:3100, Orchestrator at /orchestrator, Settings at /settings.

## Working Style Reminder

- **Use Task subagents aggressively** for research/exploration (they CANNOT write/edit)
- Do all edits yourself in the main context
- Full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Run `npm test` to verify after changes (1482 tests, 24 suites)

## Reference

- Operator plan: `docs/operator-plan.md` (M1-M6 specs)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
