# Next Session Instructions (S94)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S93

S93 completed **all P5 features** (integration & core gaps):

1. **Settings → operator CLI integration** — `operator.mjs` now imports `loadSettings()` from `settings.mjs`. Removed `default:` values from `parseArgs` for the 4 settings fields so CLI flags can be distinguished from defaults. Merge priority: CLI flag > saved settings > hardcoded default. `MODEL_MAP` hoisted to module-level constant (eliminates 3 duplicate definitions).

2. **Combined mode `--operator` wiring** — `server.mjs` now imports `runChain` and `MODEL_MAP` from `operator.mjs` when `--operator` flag is set. Creates adapter wrapper bridging `runChainFn(chain)` → `runChain(config, registry, chain)`. `operator.mjs` has `isMain` guard so `main()` only runs when executed directly, not when imported.

3. **Chain delete button** — Delete button (`btn--delete btn--sm btn--ghost`) in `chain-row.mjs` for non-running chains (uses `hx-delete` + `hx-confirm`). Delete button also on chain detail page in `views.mjs`. `chain:deleted` event emitted from DELETE handler in `chains.mjs` and added to `BRIDGED_EVENTS` in `ws.mjs` for real-time dashboard refresh.

4. **Chain pagination** — `views.mjs` chain-list now accepts `page` and `limit` query params. Uses `hx-swap-oob` to render pagination controls (`#chain-pagination`) outside `<tbody>`. Hidden `page` input added to `#chain-filters` in `index.html`. `setPage()` JS function. Page resets to 1 on sort/filter changes. Default: 25 per page.

5. **Misc fixes** — Empty state text changed from "Start one below!" to "Start one above!". Pagination CSS styles added.

**1491 tests, 24 suites, all passing.** (+9 new tests.)

## What Changed (Files Modified)

```
EDIT: operator/operator.mjs          Import loadSettings/initSettings, remove parseArgs defaults,
                                      merge CLI > settings > hardcoded, MODEL_MAP to module level,
                                      export runChain/MODEL_MAP/OPERATOR_DIR, isMain guard
EDIT: operator/server.mjs            Combined mode imports runChain, creates adapter, passes runChainFn
EDIT: operator/routes/chains.mjs     chain:deleted event emission from DELETE handler
EDIT: operator/routes/views.mjs      Pagination (page/limit params, hx-swap-oob), delete button on
                                      chain detail page
EDIT: operator/views/chain-row.mjs   Delete button for non-running chains, empty state text fix
EDIT: operator/ws.mjs                chain:deleted added to BRIDGED_EVENTS
EDIT: operator/public/index.html     Pagination container, page hidden input, setPage(), page reset
EDIT: operator/public/style.css      .pagination, .pagination__info, .btn--delete styles
EDIT: operator/__tests__/server.test.mjs  +1 test (delete event emission)
EDIT: operator/__tests__/views.test.mjs   +8 tests (delete buttons, pagination)
EDIT: CLAUDE.md                      Updated test counts
EDIT: docs/session-history.md        S93 entry
```

## Remaining Operator Improvement Roadmap

### Priority 6: UI Feature Gaps (MEDIUM) — NEXT UP

1. **Git commit UI** — POST /api/git/commit exists but git-status fragment only shows Push button. Add commit message input + Commit button when dirty.

2. **Chain text search** — No search by task text. Add `?q=` param to chain-list view and search input in filters.

3. **Chain detail branch display** — Chain meta section omits `chain.config.branch` even though it's a first-class field. Add it.

4. **Form submission loading states** — No spinner or disabled state on Start/Launch buttons during HTMX requests.

5. **Auto-push server-side persistence** — Currently localStorage only. Move to settings.mjs so it persists across browsers and CLI can respect it.

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

- **Settings CLI integration**: `parseCliArgs()` in `operator.mjs` calls `initSettings({ operatorDir: OPERATOR_DIR })` then `loadSettings()`. For each of the 4 settings fields, if the CLI flag was provided (not `undefined`), uses CLI value; otherwise falls back to saved setting. The `MODEL_MAP` is now a module-level constant shared by `parseCliArgs()`, the resume path, and the export for combined mode.
- **Combined mode**: `server.mjs` dynamically imports `operator.mjs` only when `--operator` flag is set. The adapter wrapper translates from `runChainFn(chain)` signature (used by `chains.mjs`) to `runChain(config, registry, chain)` signature. The adapter reads `chain.config.*` fields to build the config object.
- **Pagination**: The `<tbody>` can only contain `<tr>` elements, so pagination controls are rendered via `hx-swap-oob="innerHTML:#chain-pagination"` which swaps content into a `<div id="chain-pagination">` below the table. The `page` value is stored in a hidden input inside `#chain-filters` so it's included in `hx-include`.
- **Delete flow**: Delete button uses `hx-delete` with `hx-confirm` for native browser confirmation. In chain-row (table), triggers `reload` on `#chain-table`. In chain detail, navigates to `/` via `hx-on::after-request`.

## Codebase Stats

```
Operator: 16 source files, ~3,500 lines code + ~2,800 lines tests
Routes:   24 API endpoints, 9 view fragment routes, 3 page routes, 1 WebSocket
Events:   17 bridged WS events (added chain:deleted), pattern-based subscriptions
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
