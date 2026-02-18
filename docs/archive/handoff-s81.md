# Session 81 Handoff — Operator M4: HTTP API Layer

## HANDOFF: COMPLETE

**Accomplished:** Built the complete M4 HTTP API layer for the operator system, then ran 3 parallel review agents that found 8+ bugs. All bugs fixed, 16 WebSocket integration tests added.

## What Was Built

### New Files (5)
1. **`operator/server.mjs`** (~195 lines) — Express + WebSocket server
   - `createApp()` factory for testability (returns app, server, events, wss, close)
   - Binds to 127.0.0.1:3100 by default (localhost only)
   - CORS restricted to localhost origins
   - Graceful shutdown with `close()` method for clean teardown
   - Signal handlers only registered in CLI mode (prevents test accumulation)
   - CLI: `--port`, `--host`, `--operator` (combined mode), `--help`

2. **`operator/routes/chains.mjs`** (~327 lines) — Chain CRUD + sessions + costs
   - `GET /api/chains` — List chains, filter by `?project=` and `?status=`, pagination via `?limit=&offset=`
   - `GET /api/chains/:id` — Full chain detail with all sessions
   - `POST /api/chains` — Create new chain (validates task, model, maxTurns, maxBudgetUsd, projectDir)
   - `POST /api/chains/:id/abort` — Abort running chain (409 if not running)
   - `DELETE /api/chains/:id` — Remove chain (409 if running)
   - `GET /api/chains/:id/sessions/:idx` — Session detail + handoff file content
   - `GET /api/costs` — Cost summary (total, by-status, by-project breakdowns)
   - `GET /api/projects` — Distinct projects with summary stats

3. **`operator/routes/orchestrator.mjs`** (~103 lines) — Orchestrator status/control
   - `GET /api/orchestrator/status` — Current state (running, round, agents, mission)
   - `POST /api/orchestrator/start` — Start orchestrator (placeholder for M6, state via EventBus)
   - `POST /api/orchestrator/stop` — Graceful stop
   - EventBus-driven state tracking (no double status-set)

4. **`operator/ws.mjs`** (~209 lines) — WebSocket event bridge
   - WebSocket on `/ws` path (upgrade-based, no separate port)
   - Pattern-based subscriptions: `{ "subscribe": ["chain:*", "session:*"] }`
   - Bridges 14 EventBus event types to subscribed clients (including `agent:continuation`)
   - `session:output` throttled to 1 msg/sec per client via WeakMap (no memory leak)
   - `wss.cleanup()` removes all EventBus listeners on shutdown
   - Ping/pong support, graceful connection handling

5. **`operator/__tests__/server.test.mjs`** (~530 lines, 50 tests)
   - REST: health, chain CRUD, pagination edge cases, session detail, costs, projects, orchestrator lifecycle, CORS, events
   - WebSocket integration: connect+welcome, subscribe, unsubscribe, event bridging, non-matching events filtered, ping/pong, invalid JSON, path rejection
   - Message queue pattern in `connectWs()` prevents race conditions

### Bugs Found & Fixed by Review Agents
| Bug | Severity | Fix |
|-----|----------|-----|
| Throttle state Map → memory leak on disconnected clients | HIGH | Changed to WeakMap |
| Negative limit in pagination | HIGH | `Math.max(1, Math.min(...))` guard |
| `req.body` undefined crash on empty POST | MEDIUM | `req.body \|\| {}` guard |
| Signal handlers registered in test imports | MEDIUM | Only register when `_registerSignalHandlers` option |
| `close()` double-calling `server.close()` | MEDIUM | Call `shutdown()` then listen for `close` event |
| Orchestrator start/stop double status-set | LOW | Removed inline set, event listener handles it |
| Missing `agent:continuation` in BRIDGED_EVENTS | LOW | Added to event list |
| No `wss.cleanup()` for EventBus listeners | LOW | Added cleanup method, called on shutdown |

### Multi-Project Design
- `POST /api/chains` accepts `projectDir` in body
- `GET /api/chains?project=/path` filters chains by project
- `GET /api/costs?project=/path` scopes cost summary to one project
- `GET /api/projects` lists all distinct projects with stats — easy navigation
- Path normalization handles Windows backslashes vs forward slashes

### Dependencies Added
- `express` (v4) — HTTP server framework
- `ws` — WebSocket library

## Files Modified
- `operator/server.mjs` (NEW — 195 lines)
- `operator/routes/chains.mjs` (NEW — 327 lines)
- `operator/routes/orchestrator.mjs` (NEW — 103 lines)
- `operator/ws.mjs` (NEW — 209 lines)
- `operator/__tests__/server.test.mjs` (NEW — 530 lines, 50 tests)
- `CLAUDE.md` (updated commands, architecture, test count)
- `docs/operator-plan.md` (M4 marked COMPLETE, changelog entry)
- `package.json` / `package-lock.json` (added express + ws)

## Test Status
- **1348 tests ALL PASSING** across 23 suites (22 existing + 50 new server tests, net +50)

## Commits
- `41c24e0` — S81: Operator M4 — HTTP API layer (initial build)
- `70b71d8` — S81: Fix M4 bugs found by review agents, add WebSocket integration tests

## What's Next

### Immediate: M5 — Web UI Dashboard
Read `docs/operator-plan.md` section "M5: Web UI Dashboard". Server-rendered HTML with HTMX + Pico CSS (no build pipeline). Builds directly on M4 API endpoints. Key pages: chain list, chain detail, orchestrator status, cost dashboard.

### After M5: M6 — Orchestrator Management + Git Integration
Full orchestrator control from UI. Start/stop, mission selection, git integration.
