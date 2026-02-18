# Next Session Instructions (S97)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S96

S96 completed **4 P7 features** (continuing the polish & enhancements phase):

1. **Per-model cost breakdown** — Dashboard cost summary now shows per-model metric cards (Opus/Sonnet/Haiku) with cost and chain count. Added `byModel` aggregation to `GET /api/costs` API. Extended session data model to persist `inputTokens`/`outputTokens` from SDK results (future sessions will have token-level data).

2. **Chain export (CSV/JSON)** — New `GET /api/chains/export?format=csv|json` endpoint exports chain list with all metadata. JSON/CSV download buttons added next to "Chains" title on dashboard. Supports `?project=` filter.

3. **Bulk chain actions** — Checkbox column on chain table rows with select-all header checkbox (supports indeterminate state). Bulk action bar appears when items are selected showing count + "Delete Selected" + "Clear" buttons. New `POST /api/chains/batch-delete` endpoint. Uses the styled confirm dialog for destructive actions. Selection resets on table reload.

4. **Side-by-side handoff viewer** — New `/views/handoff-compare/:chainId` fragment with session picker dropdowns. Renders two handoffs in a side-by-side grid layout via terminal viewer. Auto-loads on chain detail page when 2+ sessions have handoffs. Responsive: stacks vertically on mobile.

**1491 tests, 24 suites, all passing.**

## What Changed (Files Modified)

```
EDIT: operator/registry.mjs             Added inputTokens/outputTokens to session data model
EDIT: operator/operator.mjs             Pass token data from SDK result to recordSession()
EDIT: operator/routes/chains.mjs        byModel aggregation in GET /api/costs, GET /api/chains/export, POST /api/chains/batch-delete
EDIT: operator/routes/views.mjs         Per-model cards in cost-summary, handoff-compare fragment, compare section in chain detail
EDIT: operator/views/chain-row.mjs      Checkbox column in chain rows, colspan 7→8
EDIT: operator/public/index.html        Checkbox th, bulk action bar, export links, colspan 7→8
EDIT: operator/public/style.css         metric-card__sub, metric-card--model, btn--xs, export-links, bulk-bar, bulk-col, handoff-compare
EDIT: operator/public/app.js            Bulk selection JS (updateBulkBar, toggleSelectAll, bulkDelete, bulkClearSelection), table reload reset
EDIT: docs/session-history.md           S96 entry
```

## Remaining Operator Improvement Roadmap

### Priority 7 (continued): Polish & Enhancements

Completed through S95-S96:
- WS reconnection with exponential backoff
- Keyboard shortcuts (N, /)
- SVG favicon
- WS connection status indicator
- Styled confirm dialog
- Per-model cost breakdown
- Chain export (CSV/JSON)
- Bulk chain actions
- Side-by-side handoff viewer

Remaining items:
- **Orchestrator run history** — persist past orchestrator runs (start time, duration, mission, outcome) so users can review previous runs
- **Dark/light theme toggle** — add theme switcher to settings or nav
- **Chain dependency graph visualization** — visual representation of chain relationships/dependencies

These are all low-priority polish items. The dashboard is fully functional for production use.

## Key Architecture Notes

- **Session token data** now persisted: `inputTokens` and `outputTokens` fields in session objects (backward-compatible — defaults to 0 for old sessions).
- **Bulk delete** uses `POST /api/chains/batch-delete` with `{ ids: string[] }` body. Rejects if any chain is running (409). Emits `chain:deleted` for each removed chain.
- **Chain export** at `GET /api/chains/export?format=csv|json` — defaults to JSON, supports project filter. CSV uses proper escaping for commas/quotes/newlines.
- **Handoff compare** fragment auto-shows picker when no `?a=&b=` params specified, then renders side-by-side via htmx.ajax() on button click.
- **Bulk bar JS**: `updateBulkBar()`, `toggleSelectAll()`, `bulkDelete()`, `bulkClearSelection()` all exposed as `window.*` globals. Select-all supports indeterminate state. Selection resets on htmx:afterSwap of chain table.
- **app.js** now has 10 systems: progress bar, toast, createWS utility, branch auto-gen, auto-push toggle, project filter, confirm dialog, keyboard shortcuts, bulk actions, table reload reset.

## Codebase Stats

```
Operator: 16 source files, ~4,000 lines code + ~2,800 lines tests
Routes:   27 API endpoints, 10 view fragment routes, 3 page routes, 1 WebSocket
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
