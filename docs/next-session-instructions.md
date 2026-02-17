# Next Session Instructions (S81)

## Context
This is Session 81 of the Jousting MVP project. Read `docs/archive/handoff-s80.md` for the previous session's handoff.

## Status
- **1298 tests ALL PASSING** across 22 suites
- **Operator M1-M3 complete** (walking skeleton, robust session mgmt, agent self-continuation)
- All code pushed to `origin/master`

## Task: Build Operator M4 — HTTP API Layer

Read `docs/operator-plan.md` section "M4: HTTP API Layer" for the full spec.

### What to build

1. **Install dependencies**: `npm install express ws` (Express v4 + WebSocket library)

2. **`operator/server.mjs`** — Express app + WebSocket setup
   - Binds to `127.0.0.1:3100` (localhost only, no auth needed)
   - Serves REST API + WebSocket endpoint at `/ws`
   - Can run standalone (monitoring) or combined with operator daemon (`--operator` flag)
   - Graceful shutdown: close WS connections, save registry

3. **REST Endpoints** (see plan doc for full table):
   - `GET /api/chains` — List all chains from registry (paginated)
   - `GET /api/chains/:id` — Chain detail with sessions
   - `POST /api/chains` — Start new chain `{ task, model, maxTurns, maxContinuations }`
   - `POST /api/chains/:id/abort` — Abort running chain
   - `GET /api/chains/:id/sessions/:idx` — Session detail + handoff content
   - `GET /api/costs` — Cost summary across all chains
   - `GET /api/orchestrator/status` — Current orchestrator state
   - `GET /api/health` — Health check

4. **WebSocket** — Single endpoint at `/ws`
   - Clients subscribe to event streams: `chain:*`, `session:*`, `orchestrator:*`
   - Bridge operator's internal EventEmitter → connected WS clients
   - Throttle `session:output` to 1 msg/sec

5. **Multi-project support** — API should accept `projectDir` in POST body for chain creation. Filter chains by project in GET endpoints (optional `?project=` query param).

### Key files to read first
- `docs/operator-plan.md` (M4 section — the spec)
- `operator/operator.mjs` (M2 implementation — the chain runner to integrate with)
- `operator/registry.mjs` (chain data source for API)
- `orchestrator/observability.mjs` (EventBus to pipe to WebSocket)

### Implementation notes
- Import `registry.mjs` directly for chain data (no database)
- CORS enabled for `localhost` only
- No authentication (single-user localhost tool)
- Route files go in `operator/routes/` (chains.mjs, orchestrator.mjs)
- WebSocket handler in `operator/ws.mjs`

### Testing
- Use supertest for REST endpoint tests in `operator/__tests__/server.test.mjs`
- Manual WebSocket testing with wscat
- 1298 tests currently passing — don't break them

### User preferences
- Multi-project views should be seamless and easy to navigate between
- No conflicts when running multiple projects in one instance
- The server should cleanly handle concurrent requests from different project contexts
