# Next Session Instructions (S92)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S91

S91 completed **all P2 missing M6 features**:

1. **Model tier override in mission launcher** — Added `<select name="model">` (Default/Sonnet/Opus/Haiku) to the mission launcher form. Model is destructured in POST /orchestrator/start, passed as `--model` CLI flag to the forked orchestrator process, and stored on `orchestratorStatus.model`. Displayed in orch-status fragment.

2. **Report filtering** — Added search input above report tabs with client-side `filterReports()` function that matches against report name and date. Reports count shown next to search.

3. **Branch auto-generation** — Added branch name input to the quick-start chain form on index.html. Auto-populates via `slugify()` → `auto/<slug>` from task description. Manual editing stops auto-fill. Branch stored in chain config via registry.mjs (spread operator). Sanitized server-side (only `a-zA-Z0-9/_-`, max 100 chars).

4. **PR body auto-generation** — Added "Create PR" button on chain detail page for completed/assumed-complete chains. Button sends `hx-post="/api/git/pr"` with `hx-vals` containing auto-generated title (first 70 chars of task) and body (summary with sessions, cost, duration, model, branch).

5. **Auto-push toggle** — Added toggle switch to git-status fragment. Preference stored in `localStorage('operator-auto-push')`. app.js opens a WS connection subscribing to `chain:complete`/`chain:assumed-complete`, auto-fires `POST /api/git/push` when enabled. Toast notification shown on success/failure.

6. **Test coverage** — Added git push/PR endpoint tests (structured response validation), chain branch field tests, orchestrator model override tests, malformed request body tests.

**1456 tests, 24 suites, all passing.** (+19 new tests.)

## What Changed (Files Modified)

```
EDIT: operator/routes/views.mjs         Mission launcher model dropdown, orch-status model display,
                                         report search filter, chain-detail PR button, git-status auto-push toggle
EDIT: operator/routes/orchestrator.mjs  Model field in POST /start, model on status object
EDIT: operator/routes/chains.mjs        Branch field in POST /chains
EDIT: operator/registry.mjs             Branch passthrough in createChain config
EDIT: operator/public/index.html        Branch input in quick-start form
EDIT: operator/public/app.js            slugify(), autoFillBranch(), toggleAutoPush(), WS auto-push listener
EDIT: operator/public/style.css         .branch-input responsive rules
EDIT: operator/__tests__/server.test.mjs  +13 new tests (git push/PR, branch, model, malformed)
EDIT: operator/__tests__/views.test.mjs   +6 new tests (model dropdown, PR button, model display, report filter, auto-push)
EDIT: docs/session-history.md           S90+S91 entries
```

## Remaining Operator Improvement Roadmap

### Priority 3: New Pages & Features (Medium-Large) — NEXT UP

11. **Multi-project dashboard** — Project selector in nav, filter all views by project.

12. **Settings page** — Configure defaults: model, max turns, max continuations, budget cap.

13. **Session output viewer** — Terminal-style viewer for full session output with ANSI color support.

14. **Real-time chain progress** — Use WebSocket to live-update chain status during runs.

### Priority 4: Remaining Test Coverage

15. **Sort/direction query param tests** — Chain list `?sort=cost&dir=asc` not tested in views.
16. **Project filter tests for views** — `?project=` on `/views/chain-list` untested.
17. **Agent grid in orch-status** — Agent card HTML after `agent:start` events not verified in view tests.

### Potential Enhancements

- **Side-by-side handoff viewer** — Chain detail shows handoffs in expandable `<details>`. A proper viewer would show prev handoff | session output | next handoff side-by-side.
- **WebSocket reconnection indicator** — Show connection status in the UI.
- **Chain dependency graph** — Visualize which chains were restarted from which.
- **Export chain data** — CSV/JSON export of chain history and costs.

## Key Architecture Notes

- **app.js** now has 3 systems: (1) progress bar + toast, (2) branch auto-gen with manual override detection, (3) auto-push WS listener with localStorage preference.
- **Branch field** flows: index.html form → POST /api/chains → chains.mjs sanitizes → registry.mjs spreads into config → stored in registry JSON.
- **Model override** flows: mission-launcher form → POST /api/orchestrator/start → orchestrator.mjs pushes `--model X` to fork args → emitted in `orchestrator:started` event → stored on `orchestratorStatus.model`.
- **PR auto-generation** uses `hx-vals` JSON attribute on the button — HTMX serializes it into the POST body automatically.
- **Auto-push** uses a separate WS connection in app.js (not the log WS in orchestrator.html) — connects on any page, subscribes to chain completion events.

## Running the Operator

```bash
node operator/server.mjs                    # API server on http://127.0.0.1:3100
node operator/server.mjs --port 8080        # Custom port
node operator/server.mjs --operator         # Combined mode (API + operator daemon)
```

Dashboard at http://127.0.0.1:3100, Orchestrator at http://127.0.0.1:3100/orchestrator.

## Working Style Reminder

- **Use Task subagents aggressively** for research/exploration (they CANNOT write/edit)
- Do all edits yourself in the main context
- Full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Run `npm test` to verify after changes (1456 tests, 24 suites)

## Reference

- Handoff: `docs/archive/handoff-s89.md` (most recent archived)
- Operator plan: `docs/operator-plan.md` (M1-M6 specs)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
