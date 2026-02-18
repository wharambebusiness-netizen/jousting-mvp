# Next Session Instructions (S98)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S97

S97 completed the **final P7 features** (theme toggle skipped per user request):

1. **Orchestrator run history** — Past orchestrator runs now persisted to `orch-history.json` (atomic writes, max 50 entries). Records mission, model, dryRun, startedAt, stoppedAt, durationMs, outcome, rounds, agents. New `GET /api/orchestrator/history` API endpoint. New `/views/orch-history` HTMX fragment renders a table with status dots, mission, model, rounds, agents, duration, relative time. Added "Run History" section to orchestrator page with 30s polling + WS-triggered reload when orchestrator stops.

2. **Chain dependency/lineage graph** — Chains now track `restartedFrom` field linking to the parent chain ID. `POST /api/chains/:id/restart` automatically sets the lineage link. New `getChainLineage()` function in registry.mjs walks the tree (BFS from root) and returns ordered array with depth. New `/views/chain-lineage/:id` fragment renders a CSS tree with connector lines and current-chain highlighting. Auto-loads on chain detail page via lazy HTMX fetch. Returns empty for standalone chains (no visual noise).

**P7 is now COMPLETE.** The operator dashboard is feature-complete for production use.

**1504 tests, 24 suites, all passing.**

## What Changed (Files Modified)

```
EDIT: operator/server.mjs               Pass operatorDir + getOrchHistory to orchestrator routes & views
EDIT: operator/routes/orchestrator.mjs   Run history persistence (load/save/record), GET /api/orchestrator/history, getHistory export
EDIT: operator/registry.mjs             restartedFrom field in createChain/getChainSummary, getChainLineage() BFS helper
EDIT: operator/routes/chains.mjs        Pass restartedFrom on chain restart
EDIT: operator/routes/views.mjs         /views/orch-history fragment, /views/chain-lineage/:id fragment, lineage section in chain detail
EDIT: operator/public/orchestrator.html  Run History section, WS reload on stop
EDIT: operator/public/style.css         orch-history-table, lineage tree styles (nodes, connectors, current highlight)
EDIT: operator/__tests__/server.test.mjs History endpoint tests (empty, start+stop, multiple runs, limit), chain restart lineage tests
EDIT: operator/__tests__/views.test.mjs  Orch history view tests, chain lineage unit tests (standalone, tree, branching), lineage fragment tests
EDIT: docs/session-history.md           S97 entry
```

## Operator Polish Status — P7 COMPLETE

All P7 items completed across S95-S97:
- WS reconnection with exponential backoff (S95)
- Keyboard shortcuts (N, /) (S95)
- SVG favicon (S95)
- WS connection status indicator (S95)
- Styled confirm dialog (S95)
- Per-model cost breakdown (S96)
- Chain export CSV/JSON (S96)
- Bulk chain actions (S96)
- Side-by-side handoff viewer (S96)
- Orchestrator run history (S97)
- Chain lineage graph (S97)
- ~~Dark/light theme toggle~~ (skipped per user)

## Future Directions

The operator dashboard is now feature-complete. Potential future work:
- **Performance optimization** — virtual scrolling for large chain lists, indexed persistence
- **Multi-user support** — auth, user roles, shared dashboards
- **Alerting** — email/slack notifications on chain failures or budget overruns
- **Analytics** — cost trends over time, agent efficiency metrics, charts
- **Mobile app** — PWA manifest, push notifications

## Key Architecture Notes

- **Orch history** persisted in `operatorDir/orch-history.json` — array of run objects, newest first. `operatorDir` passed to orchestrator routes via ctx for file path resolution.
- **Chain lineage** uses `restartedFrom` field (null for original chains). `getChainLineage()` walks up to root via `restartedFrom`, then BFS down to collect all descendants with depth. Handles branching (multiple restarts from same parent).
- **Run recording** hooks into existing `orchestrator:started` and `orchestrator:stopped` events — zero new events needed.

## Codebase Stats

```
Operator: 16 source files, ~4,200 lines code + ~3,000 lines tests
Routes:   28 API endpoints, 12 view fragment routes, 3 page routes, 1 WebSocket
Events:   17 bridged WS events, pattern-based subscriptions
Tests:    248 operator tests (server 92, views 92, errors 43, registry 21)
Total:    1504 tests across 24 suites (8 engine + 12 orchestrator + 4 operator)
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
- Run `npm test` to verify after changes (1504 tests, 24 suites)

## Reference

- Operator plan: `docs/operator-plan.md` (M1-M6 specs)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
