# Next Session Instructions (S95)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S94

S94 completed **all P6 features** (UI feature gaps):

1. **Git commit UI** — Added commit message input + Commit button to the git-status fragment when the working tree is dirty. Form POSTs to `/api/git/commit` with the message, reloads the git panel after. Push button sits alongside the Commit button in a flex row.

2. **Chain text search** — Added `?q=` query param filter in `views.mjs` chain-list handler (case-insensitive task text match). Added debounced (300ms) search input to `index.html` `#chain-filters`. Resets to page 1 on search. Styled consistent with other filter controls via `.chain-filters input[type="search"]` CSS.

3. **Chain detail branch display** — Added `Branch: <strong>...</strong>` to chain-meta section in chain-detail view. Only shows when `chain.config.branch` is set.

4. **Form submission loading states** — CSS-based loading states targeting `button[type="submit"]` inside `.htmx-request` elements. Buttons get `opacity: 0.6`, `pointer-events: none`, and a spinning border indicator via `::after` pseudo-element. Works automatically on all HTMX forms.

5. **Auto-push server-side persistence** — Added `autoPush: false` to `settings.mjs` DEFAULTS, `loadSettings()`, and `saveSettings()`. Git-status toggle now renders `checked` state from server settings. `toggleAutoPush()` in `app.js` now reads current settings then PUTs updated value to `/api/settings`. WS auto-push listener fetches `/api/settings` to check the flag. Added autoPush checkbox to settings form fragment.

**1491 tests, 24 suites, all passing.** (No new tests — all changes were UI/view layer.)

## What Changed (Files Modified)

```
EDIT: operator/routes/views.mjs       Git commit form, ?q= search filter, branch in chain-meta,
                                       autoPush server-rendered toggle, autoPush in settings form
EDIT: operator/public/index.html       Search input in #chain-filters with debounce
EDIT: operator/public/style.css        .chain-filters input[type="search"], HTMX loading state CSS
EDIT: operator/public/app.js           toggleAutoPush → PUT /api/settings, WS listener checks server
EDIT: operator/settings.mjs            autoPush field in DEFAULTS, loadSettings, saveSettings
EDIT: docs/session-history.md          S94 entry
```

## Remaining Operator Improvement Roadmap

### Priority 7: Polish & Enhancements (LOW) — NEXT UP

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

These are all low-priority polish items. Pick a subset that seems most impactful and implement them. Suggested high-impact picks:
1. **WebSocket reconnection** — currently no reconnect in app.js dashboard WS listener if connection drops mid-session
2. **Keyboard shortcuts** — N=new chain (focus task input), /=search (focus chain search)
3. **Favicon** — simple SVG favicon for the operator brand
4. **WS connection status indicator** — small dot in nav showing connected/disconnected
5. **Modal/dialog** — replace native confirm() for delete/abort actions with styled dialog

## Key Architecture Notes

- **Settings schema**: `{ model, maxTurns, maxContinuations, maxBudgetUsd, autoPush }` — validated+clamped on both load and save. `autoPush` is a boolean (!!coerced).
- **Auto-push flow**: git-status fragment reads `loadSettings().autoPush` for initial checkbox state → user toggles → `toggleAutoPush()` GETs current settings, sets `autoPush`, PUTs back → WS listener on `chain:complete` fetches `/api/settings` to check `autoPush` before pushing.
- **Chain search**: `?q=` param in chain-list view filters by `(c.task || '').toLowerCase().includes(q)`. The search input uses `oninput` with `clearTimeout`/`setTimeout` for 300ms debounce.
- **Loading states**: Pure CSS approach — `.htmx-request button[type="submit"]` and `.htmx-request .btn` get disabled styling. Submit buttons also get a `::after` spinner pseudo-element. No JS needed.
- **Git commit form**: Wraps commit input + Commit + Push buttons in a `<form>` that POSTs to `/api/git/commit`. Push button is `type="button"` with its own `hx-post` to avoid being part of the commit form submission.

## Codebase Stats

```
Operator: 16 source files, ~3,600 lines code + ~2,800 lines tests
Routes:   24 API endpoints, 9 view fragment routes, 3 page routes, 1 WebSocket
Events:   17 bridged WS events, pattern-based subscriptions
Tests:    235 operator tests (server 86, views 85, errors 43, registry 21)
Total:    1491 tests across 24 suites (8 engine + 12 orchestrator + 4 operator)
```

## Running the Operator

```bash
node operator/server.mjs                    # API server on http://127.0.0.1:3100
node operator/server.mjs --port 8080        # Custom port
node operator/server.mjs --operator         # Combined mode: API + chain execution
```

Dashboard at http://127.0.0.1:3100, Orchestrator at /orchestrator, Settings at /settings.

## Working Style Reminder

- **Use Task subagents aggressively** for research/exploration (they CANNOT write/edit)
- Do all edits yourself in the main context
- Full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Run `npm test` to verify after changes (1491 tests, 24 suites)

## Reference

- Operator plan: `docs/operator-plan.md` (M1-M6 specs)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
