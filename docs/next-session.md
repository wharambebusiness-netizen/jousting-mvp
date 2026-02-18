# Next Session Instructions (S96)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S95

S95 completed **5 P7 polish & enhancement features**:

1. **WebSocket reconnection with exponential backoff** — Created shared `createWS(subscriptions, onMessage, opts)` utility in `app.js`. Handles reconnection with backoff (1s→2s→4s→8s→16s→30s max), resets on successful connect. Refactored all 3 WS connection points (dashboard chain events, chain detail, orchestrator log) to use it instead of inline `new WebSocket()` + `setTimeout(reconnect, N)`.

2. **Keyboard shortcuts** — Added global `keydown` listener in `app.js`. `N` key opens the "New Chain" details and focuses the task input. `/` key focuses the chain search input. Both skip when user is already in an input/textarea/select or using modifier keys.

3. **SVG favicon** — Two interlocking circles (chain links) in accent colors (`#6366f1` and `#818cf8`) as an inline SVG data URI. Added `<link rel="icon">` to all 4 HTML pages (index, chain, orchestrator, settings).

4. **WS connection status indicator** — Small 6px dot next to "Operator" brand text in the nav bar on all pages. Green with glow when connected, red when disconnected, yellow with pulse animation when connecting. Driven by `createWS` `trackStatus` option (only the primary dashboard WS drives the dot).

5. **Styled confirm dialog** — HTML `<dialog>` element dynamically created in `app.js`. Intercepts HTMX `hx-confirm` events globally via `htmx:confirm` event listener, preventing the native `confirm()`. Shows a styled modal with backdrop blur, contextual button text (Delete/Abort/Stop/Confirm), danger styling for destructive actions. Cancel button auto-focused. Click-outside-to-close.

**1491 tests, 24 suites, all passing.** (No new tests — all changes were UI/view layer.)

## What Changed (Files Modified)

```
EDIT: operator/public/app.js           createWS() utility, keyboard shortcuts, confirm dialog, refactored dashboard WS
EDIT: operator/public/style.css        WS status indicator styles (.ws-dot), confirm dialog styles (.confirm-dialog)
EDIT: operator/public/index.html       Favicon link, WS dot in nav brand
EDIT: operator/public/chain.html       Favicon link, WS dot in nav brand, refactored inline WS to use createWS()
EDIT: operator/public/orchestrator.html Favicon link, WS dot in nav brand, refactored inline WS to use createWS()
EDIT: operator/public/settings.html    Favicon link, WS dot in nav brand
EDIT: docs/session-history.md          S95 entry
```

## Remaining Operator Improvement Roadmap

### Priority 7 (continued): Polish & Enhancements

Completed in S95: WS reconnection, keyboard shortcuts, favicon, WS status indicator, modal/dialog.

Remaining items:
- Per-model cost breakdown in cost summary
- Orchestrator run history (persist past runs)
- Bulk chain actions (select multiple → delete/abort)
- Chain export (CSV/JSON)
- Dark/light theme toggle
- Side-by-side handoff viewer
- Chain dependency graph visualization

These are all low-priority polish items. Suggested next picks:
1. **Per-model cost breakdown** — show input/output token costs per model in cost summary cards
2. **Chain export** — download chain list as CSV or JSON for external analysis
3. **Bulk chain actions** — checkbox selection on chain rows, batch delete/abort
4. **Side-by-side handoff viewer** — compare consecutive session handoffs

## Key Architecture Notes

- **createWS(subs, onMsg, opts)** in `app.js`: shared WS utility with exponential backoff. `opts.trackStatus = true` drives the `#ws-dot` element. Returns `{ close }`. All pages use it.
- **Confirm dialog**: intercepts `htmx:confirm` event globally. Uses `evt.detail.issueRequest()` to proceed. Danger detection via regex on message text (`/delete|abort|stop/i`).
- **Keyboard shortcuts**: `N` = new chain (opens details + focuses `#chain-task`), `/` = search (focuses `#chain-filters input[type="search"]`). Skips when in form elements.
- **Settings schema**: `{ model, maxTurns, maxContinuations, maxBudgetUsd, autoPush }` — validated+clamped on both load and save.
- **app.js** now has 8 systems: progress bar, toast, createWS utility, branch auto-gen, auto-push toggle, project filter, confirm dialog, keyboard shortcuts.

## Codebase Stats

```
Operator: 16 source files, ~3,700 lines code + ~2,800 lines tests
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
