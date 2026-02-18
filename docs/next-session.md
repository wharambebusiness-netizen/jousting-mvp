# Next Session Instructions (S91)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S90

S90 completed **all P1 UX polish items** for the operator dashboard:

1. **Toast notifications wired to all API actions** — Created shared `operator/public/app.js` with progress bar, `showToast()`, and a global `htmx:afterRequest` listener that detects all POST/DELETE to `/api/*` and shows contextual success/error toasts. Replaces duplicated inline scripts across all 3 HTML pages. Covers: chain create, abort, restart, git push, orchestrator start/stop.

2. **Report auto-refresh** — Report viewer now polls every 15s (`hx-trigger="load, every 15s"`).

3. **Enriched agent cards** — Orchestrator routes now track per-agent state via a Map (not string array). Listens for `agent:start`, `agent:complete`, `agent:error`, `agent:continuation` events. Agent cards now show model, duration, cost, and continuation count as metric badges.

4. **Chain table filtering + sorting** — Added status filter dropdown, sortable column headers (status, sessions, cost, updated). Uses `hx-include` to pass filter params to `/views/chain-list` on every poll. Server-side sort/filter support in views.mjs.

5. **Action buttons fixed** — Replaced all `location.reload()` patterns with `htmx.trigger()` so toasts remain visible after actions. Added `reload` custom triggers to chain-content, orch-content, mission-launcher divs.

**1437 tests, 24 suites, all passing.** (+7 new tests for enriched agent cards and chain filtering.)

## What Changed (Files Modified)

```
NEW:  operator/public/app.js        (~60 lines) Shared toast system + progress bar
EDIT: operator/public/index.html     Added chain-filters bar, sortable headers, hx-include, inline sort JS
EDIT: operator/public/orchestrator.html  Removed inline scripts (uses app.js), added reload triggers, report polling
EDIT: operator/public/chain.html     Uses app.js, added reload trigger to chain-content
EDIT: operator/public/style.css      Added: chain-filters, sortable th, sorted-asc/desc, agent-metrics
EDIT: operator/views/agent-card.mjs  Renders model, elapsedMs, cost, continuations as metric badges
EDIT: operator/routes/orchestrator.mjs  Per-agent Map tracking (agent:start/complete/error/continuation listeners)
EDIT: operator/routes/views.mjs      Chain-list accepts sort/dir/status/project params; agent normalization fix
EDIT: operator/__tests__/server.test.mjs  Updated agent assertion (objects not strings), +3 agent event tests
EDIT: operator/__tests__/views.test.mjs   +4 agent card metric tests, +1 chain filter test
```

## Remaining Operator Improvement Roadmap

### Priority 2: Missing M6 Features (Medium) — NEXT UP

5. **Model tier override in mission launcher** — Add model dropdown (sonnet/haiku/opus) to the start form.

6. **Report filtering** — Filter reports by date, mission name, or status. Currently a flat list.

7. **Side-by-side handoff viewer** — Chain detail shows handoffs in expandable `<details>`. A proper viewer would show prev handoff | session output | next handoff side-by-side.

8. **Auto-push toggle** — Persistent UI toggle for auto-pushing after each chain session completes.

9. **Branch auto-generation** — Generate branch names from task description when starting chains.

10. **PR body auto-generation** — Build PR body from chain summary (sessions, costs, files changed).

### Priority 3: New Pages & Features (Medium-Large)

11. **Multi-project dashboard** — Project selector in nav, filter all views by project.

12. **Settings page** — Configure defaults: model, max turns, max continuations, budget cap.

13. **Session output viewer** — Terminal-style viewer for full session output with ANSI color support.

14. **Real-time chain progress** — Use WebSocket to live-update chain status during runs.

### Priority 4: Test Coverage Gaps

15. **Git endpoint tests** — `POST /api/git/push` and `POST /api/git/pr` have zero tests.
16. **Malformed request body tests** — No tests for invalid JSON, oversized payloads.

## Key Architecture Notes

- **app.js** is shared across all 3 HTML pages. Contains progress bar handlers, `showToast()`, and global API toast listener. The global listener auto-generates friendly messages based on the request path.
- **Agent tracking** uses a `Map<agentId, agentObj>` in orchestrator routes. Agent objects have: `id, status, model, round, startedAt, elapsedMs, cost, continuations, statusDetail`. The `agents` array in `orchestratorStatus` is rebuilt from Map values after each event.
- **Chain list filtering** uses `hx-include="#chain-filters"` to pass form values as query params. Hidden inputs for sort field/direction are updated by JS click handlers on `<th>` elements.
- Action buttons now use `htmx.trigger('#target', 'reload')` instead of `location.reload()` — this preserves toast visibility and avoids full page refreshes.

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
- Run `npm test` to verify after changes (1437 tests, 24 suites)

## Reference

- Handoff: `docs/archive/handoff-s89.md`
- Operator plan: `docs/operator-plan.md` (M1-M6 specs, some M6 features still unimplemented)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
