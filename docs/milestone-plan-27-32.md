# Milestone Plan: Phases 27-32

## Overview

Phases 27-32 harden the Jousting operator system for real-world use. The first two phases address the highest-risk gaps: **authentication/authorization** (Phase 27) and **structured observability** (Phase 28). Phase 29 adds **input validation and API hardening** as a second security layer. Phase 30 introduces a **data migration framework** to replace the current ad-hoc JSON persistence. Phase 31 adds **audit logging** for accountability and debugging. Phase 32 delivers a **dead letter queue and manual intervention UI** for tasks that fail permanently, closing the resilience gap.

Each phase is scoped for a single session (~80-150 lines of production code, 20-30 tests), builds incrementally on prior work, and follows existing factory/EventBus/atomic-write patterns.

---

## Phase 27: Authentication & Session Tokens

### Rationale
The server binds to `127.0.0.1` but has zero authentication. Any local process can hit every API endpoint, spawn terminals, kill swarms, or read shared memory. A lightweight token-based auth layer prevents accidental or malicious local access and is a prerequisite for any future network exposure.

### Changes

- **`operator/auth.mjs` (new, ~90 lines)**: Factory `createAuth(ctx)` with:
  - `generateToken()` — creates a cryptographically random 32-byte hex token, stores hash in `operatorDir/.data/auth-tokens.json` (atomic write, same pattern as `settings.mjs`)
  - `validateToken(token)` — constant-time comparison of SHA-256 hash against stored hash
  - `revokeToken(token)` — removes from store
  - `listTokens()` — returns list of `{ id, createdAt, label }` (no raw tokens)
  - Token format: `jst_<hex>` prefix for easy identification in logs
  - `authMiddleware(req, res, next)` — Express middleware that checks `Authorization: Bearer jst_<token>` header or `?token=` query param; returns 401 if invalid; skips `/api/health` and static files
  - Exported constant `AUTH_HEADER = 'Authorization'`, `TOKEN_PREFIX = 'jst_'`

- **`operator/server.mjs` (~20 lines changed)**:
  - Import and wire `createAuth({ operatorDir })`
  - Add `app.use(authMiddleware)` after `express.json()` but before API routes (gated by `options.auth !== false` for test backward-compat)
  - Pass `auth` to `createApp` return object
  - On first startup with no tokens: auto-generate one token and print to stdout (`Initial access token: jst_...`)
  - `--no-auth` CLI flag to disable auth (for development)

- **`operator/routes/auth.mjs` (new, ~40 lines)**:
  - `POST /api/auth/tokens` — generate new token (body: `{ label }`) — returns raw token once
  - `GET /api/auth/tokens` — list tokens (no secrets)
  - `DELETE /api/auth/tokens/:id` — revoke token
  - All auth routes require a valid existing token (bootstrap token printed to console)

- **WebSocket auth** (~10 lines in `ws.mjs`): Validate token from `?token=` query parameter on upgrade request; reject with 4401 close code if invalid

### Test Plan
- `operator/__tests__/auth.test.mjs` (~25 tests):
  - Token generation returns valid format (`jst_` prefix, 64 hex chars)
  - Token validation: valid token passes, invalid rejects, revoked rejects
  - Constant-time comparison (mock `timingSafeEqual`)
  - Token persistence: save + reload round-trip
  - Middleware: 401 on missing token, 401 on bad token, passes valid token
  - `/api/health` skips auth
  - Static file routes skip auth
  - Token label stored and returned in list
  - Token CRUD via route handlers (generate, list, revoke)
  - WebSocket upgrade rejects without token

### Dependencies
- None (first phase, no prior-phase deps)

---

## Phase 28: Structured Logging & Request Correlation

### Rationale
The system uses `log: () => {}` everywhere (a silent noop) or bare `console.log`. There is no structured logging, no request IDs, no correlation between HTTP requests and the events they trigger. This makes debugging production issues nearly impossible.

### Changes

- **`operator/logger.mjs` (new, ~80 lines)**: Factory `createLogger(ctx)` with:
  - `log(level, message, meta)` — structured JSON log line: `{ ts, level, msg, reqId?, terminalId?, taskId?, ...meta }`
  - Levels: `debug`, `info`, `warn`, `error` with numeric ordering
  - `ctx.minLevel` (default `'info'`), `ctx.sink` (default `process.stderr` writable, override for tests)
  - `child(meta)` — returns new logger with merged metadata (for passing terminal-scoped logger to subsystems)
  - `fromRequest(req)` — creates child logger with `reqId` from `req.id`
  - Exported constant `LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }`

- **`operator/middleware/request-id.mjs` (new, ~20 lines)**: Express middleware:
  - Generates `reqId` (8-char hex from `crypto.randomBytes(4)`) or reads from `X-Request-Id` header
  - Sets `req.id = reqId`, adds `X-Request-Id` response header
  - Logs `{ level: 'info', msg: 'request', method, path, reqId }` on request start
  - Logs `{ level: 'info', msg: 'response', method, path, reqId, status, durationMs }` on `res.on('finish')`

- **`operator/server.mjs` (~15 lines changed)**:
  - Create logger instance: `const logger = createLogger({ minLevel: options.logLevel || 'info' })`
  - Wire `requestIdMiddleware(logger)` after CORS, before routes
  - Pass `logger` to `createApp` return object and as `log` to coordinator/pool/sharedMemory/messageBus factories (replacing `() => {}`)
  - Add `--log-level` CLI flag (debug/info/warn/error)

- **EventBus correlation** (~10 lines in `shared/event-bus.mjs`):
  - Add optional `_reqId` field to event data when emitted from request context
  - Logger child instances carry `reqId` through to subsystem log calls

### Test Plan
- `operator/__tests__/logger.test.mjs` (~25 tests):
  - Structured output format (JSON parse each line)
  - Level filtering (debug suppressed at info level, error always shown)
  - `child()` merges metadata
  - `fromRequest()` extracts reqId
  - Request-id middleware generates ID, reads from header, sets response header
  - Request/response logging with duration
  - Sink override captures output in tests
  - Log levels exported as constants

### Dependencies
- Phase 27 (auth middleware ordering — request-id should run before auth for correlation of rejected requests)

---

## Phase 29: Input Validation & API Hardening

### Rationale
Current routes do minimal validation — IDs are checked with a regex in `claude-terminals.mjs` but most routes accept arbitrary body shapes. There is no body size limit, no type coercion safety, and error responses are inconsistent (`{ error: string }` vs raw 500s). This phase adds a validation layer and standardizes error responses.

### Changes

- **`operator/validation.mjs` (new, ~100 lines)**: Lightweight validation helpers (no external deps):
  - `validateBody(schema)(req, res, next)` — Express middleware factory. Schema is a plain object: `{ field: { type, required, min, max, pattern, enum, default } }`
  - Supported types: `'string'`, `'number'`, `'boolean'`, `'array'`, `'object'`
  - On failure: returns `res.status(400).json({ error, field, details })` with consistent shape
  - `sanitizeId(value)` — strips non-alphanumeric-dash-underscore, max 64 chars
  - `sanitizeString(value, maxLen)` — trims, truncates, strips control chars
  - `paginationParams(req, defaults)` — extracts and clamps `limit` (1-100, default 50), `offset` (0+, default 0) from `req.query`
  - Body size limit constant: `MAX_BODY_SIZE = 1_048_576` (1MB)

- **`operator/server.mjs` (~5 lines changed)**:
  - Replace `app.use(express.json())` with `app.use(express.json({ limit: '1mb' }))`
  - Add `app.use(express.urlencoded({ extended: false, limit: '1mb' }))`

- **`operator/error-response.mjs` (new, ~30 lines)**: Standardized error handling:
  - `errorHandler(logger)` — Express error-handling middleware (`err, req, res, next`): logs error, returns `{ error, code, reqId }`
  - `notFoundHandler(req, res)` — catch-all 404: `{ error: 'Not found', path: req.path }`

- **Apply validation to 5 highest-risk routes** (~40 lines across route files):
  - `POST /api/claude-terminals` — validate id (string, required, pattern), model (string, enum), cols/rows (number, min 1)
  - `POST /api/coordination/tasks` — validate task (string, required), priority (number, 1-10), category (string)
  - `POST /api/coordination/tasks/batch` — validate tasks (array, required)
  - `PUT /api/shared-memory/key` — validate key (string, required), value (required)
  - `POST /api/terminal-messages` (send) — validate to (string, required), body (string, required)

- **`operator/server.mjs` (~5 lines)**: Wire `notFoundHandler` and `errorHandler(logger)` after all routes

### Test Plan
- `operator/__tests__/validation.test.mjs` (~25 tests):
  - `validateBody`: rejects missing required fields, rejects wrong types, clamps numbers, applies defaults
  - `sanitizeId`: strips invalid chars, truncates
  - `sanitizeString`: trims, truncates, strips control chars
  - `paginationParams`: defaults, clamping, NaN handling
  - Error handler: logs and returns consistent shape with reqId
  - 404 handler: returns path
  - Integration: validated routes reject bad input with 400, accept good input

### Dependencies
- Phase 28 (logger instance passed to `errorHandler`)

---

## Phase 30: Data Migration Framework

### Rationale
The system persists data via JSON files (`settings.json`, `shared-memory.json`, `terminal-messages.json`, `task-queue.json`, `registry.json`). There is no versioning, no migration path when schemas change, and no retention/cleanup policies. Adding a field to a persisted structure currently requires manual compatibility code scattered across load functions.

### Changes

- **`operator/migrations.mjs` (new, ~120 lines)**: Factory `createMigrationRunner(ctx)`:
  - `ctx.migrationsDir` — directory containing numbered migration files (or inline migration registry)
  - `ctx.dataDir` — the `.data/` directory where JSON files live
  - `ctx.log` — logger
  - Inline migration registry pattern (no separate files): `migrations` is an array of `{ version: number, name: string, up(dataDir): void, down(dataDir): void }`
  - `getCurrentVersion()` — reads `dataDir/.migration-version` (plain text integer, default 0)
  - `setVersion(n)` — atomic write to `.migration-version`
  - `migrate()` — runs all pending `up()` migrations in order, updates version after each, returns `{ from, to, applied: string[] }`
  - `rollback(targetVersion)` — runs `down()` in reverse order to target version
  - Each migration's `up(dataDir)` loads the target JSON file, transforms, and atomic-writes back
  - Built-in Migration 1: Add `version` field to `shared-memory.json`, `terminal-messages.json`, `task-queue.json` if missing (idempotent — skips if already present)
  - Built-in Migration 2: Add `createdAt` field to registry chain entries that lack it (backfills from `startedAt`)

- **`operator/retention.mjs` (new, ~50 lines)**: Factory `createRetentionPolicy(ctx)`:
  - `ctx.dataDir`, `ctx.log`, `ctx.maxAgeDays` (default 30), `ctx.maxEntries` (default 1000)
  - `cleanMessages(messageBus)` — deletes messages older than `maxAgeDays`
  - `cleanSnapshots(sharedMemory)` — deletes terminal snapshots older than `maxAgeDays`
  - `cleanCompletedTasks(taskQueue)` — removes tasks in terminal states (complete/failed/cancelled) older than `maxAgeDays`, capped at `maxEntries` most recent kept
  - `runAll({ messageBus, sharedMemory, taskQueue })` — runs all cleanup, returns `{ messagesRemoved, snapshotsRemoved, tasksRemoved }`

- **`operator/server.mjs` (~15 lines changed)**:
  - On startup (after subsystem creation): run `createMigrationRunner({ dataDir }).migrate()`, log results
  - Optional `--retention` CLI flag to run retention cleanup on startup
  - Add `GET /api/system/migrations` route returning current version and available migrations
  - Add `POST /api/system/retention` route to trigger manual retention cleanup

### Test Plan
- `operator/__tests__/migrations.test.mjs` (~25 tests):
  - Version tracking: read/write `.migration-version`
  - `migrate()`: runs pending migrations in order, skips already-applied
  - `migrate()`: idempotent (running twice is safe)
  - `rollback()`: runs down() in reverse, updates version
  - Migration 1: adds version fields to JSON files
  - Migration 2: backfills createdAt on chain entries
  - Retention: deletes old messages, snapshots, tasks
  - Retention: respects maxEntries cap
  - Retention: no-op when nothing is old
  - Empty data dir: migrate() succeeds with no-op
  - Corrupt `.migration-version`: falls back to 0

### Dependencies
- None directly, but benefits from Phase 28 (logger) and Phase 29 (validation)

---

## Phase 31: Audit Log

### Rationale
There is no record of who did what and when. When a terminal is killed, a task is cancelled, or swarm settings are changed, the only trace is ephemeral EventBus events that are not persisted. An audit log provides an immutable, queryable record for debugging, compliance, and the activity timeline UX feature.

### Changes

- **`operator/audit-log.mjs` (new, ~90 lines)**: Factory `createAuditLog(ctx)`:
  - `ctx.persistPath` — path to `operatorDir/.data/audit-log.jsonl` (JSON Lines format, append-only)
  - `ctx.events` — EventBus to auto-subscribe to auditable events
  - `ctx.log` — logger
  - `ctx.maxEntries` (default 10000) — ring buffer / max entries before rotation
  - `record({ action, actor, target, detail, reqId })` — appends JSON line to file with `{ ts, action, actor, target, detail, reqId }`
  - `query({ action?, actor?, target?, since?, until?, limit?, offset? })` — reads and filters entries (reverse chronological), returns `{ entries, total }`
  - `rotate()` — when file exceeds `maxEntries`: rename to `.audit-log.1.jsonl`, start fresh file
  - Auto-subscriptions on creation (wired via EventBus):
    - `claude-terminal:spawned` -> action `terminal.spawn`
    - `claude-terminal:exit` -> action `terminal.exit`
    - `claude-terminal:task-completed` -> action `task.complete`
    - `claude-terminal:swarm-started` -> action `swarm.start`
    - `claude-terminal:swarm-stopped` -> action `swarm.stop`
    - `coord:started` -> action `coordinator.start`
    - `coord:stopped` -> action `coordinator.stop`
    - `coord:task-failed` -> action `task.fail`
    - `shared-memory:updated` -> action `memory.write`
  - `destroy()` — unwires EventBus listeners

- **`operator/routes/audit.mjs` (new, ~30 lines)**:
  - `GET /api/audit` — query audit log (`?action=`, `?actor=`, `?target=`, `?since=`, `?until=`, `?limit=`, `?offset=`)
  - `GET /api/audit/stats` — summary: total entries, entries per action type, date range

- **`operator/server.mjs` (~10 lines changed)**:
  - Create `auditLog = createAuditLog({ persistPath, events, log })` after EventBus
  - Wire `createAuditRoutes({ auditLog })` to `app.use('/api', ...)`
  - Pass `auditLog` in return object

- **WS bridge** (~2 lines in `ws.mjs`): Add `audit:recorded` to BRIDGED_EVENTS (emitted by `record()`)

### Test Plan
- `operator/__tests__/audit-log.test.mjs` (~25 tests):
  - `record()` appends to JSONL file with correct fields
  - `query()` filters by action, actor, target, time range
  - `query()` paginates with limit/offset
  - Auto-subscription: emitting terminal:spawned creates audit entry
  - Auto-subscription: emitting task-completed creates audit entry
  - `rotate()` archives old file, starts fresh
  - `maxEntries` triggers auto-rotation on record
  - `destroy()` unwires EventBus listeners
  - Empty log: query returns `{ entries: [], total: 0 }`
  - Stats: correct per-action counts
  - Corrupt JSONL lines: skipped during query (partial parse)
  - Round-trip: record + query returns same data

### Dependencies
- Phase 28 (logger for structured log output)
- Phase 27 (auth — audit entries can include token ID as actor)

---

## Phase 32: Dead Letter Queue & Manual Intervention

### Rationale
When a task fails permanently (max retries exhausted, no recovery possible), it simply sits in `failed` status with no mechanism for human review or re-routing. The swarm auto-respawn has a 3-retry limit but no fallback. A dead letter queue (DLQ) captures these permanently-failed items and a UI panel allows operators to inspect, retry, reassign, or dismiss them.

### Changes

- **`operator/coordination/dead-letter-queue.mjs` (new, ~80 lines)**: Factory `createDeadLetterQueue(ctx)`:
  - `ctx.events` — EventBus
  - `ctx.persistPath` — path to `operatorDir/.data/dead-letters.json`
  - `ctx.log` — logger
  - `ctx.maxEntries` (default 500)
  - `add({ taskId, task, category, error, workerId, failedAt, retryCount, metadata })` — adds to DLQ, emits `dlq:added`
  - `get(id)` — retrieve single entry
  - `getAll({ status?, category?, limit?, offset? })` — list entries (status: `pending`, `retrying`, `dismissed`)
  - `retry(id, opts?)` — marks entry as `retrying`, returns task def for re-queue; optional `opts.reassignTo` (terminal ID)
  - `dismiss(id, reason?)` — marks as `dismissed` with reason
  - `remove(id)` — permanently deletes entry
  - `getStats()` — counts by status and category
  - Persistence: atomic write on every mutation (same pattern as `persistent-queue.mjs`)
  - `load()` / `save()` for startup recovery

- **Auto-DLQ wiring in `operator/coordination/coordinator.mjs`** (~20 lines changed):
  - Accept `ctx.deadLetterQueue` option
  - In `coord:failed` handler: after `taskQueue.fail()`, if task has been retried N times (check `task.retryCount >= maxTaskRetries`, default 3), call `deadLetterQueue.add(...)` instead of leaving in failed state
  - New option: `ctx.options.maxTaskRetries` (default 3), `ctx.options.enableDLQ` (default true if DLQ injected)

- **`operator/routes/dead-letter.mjs` (new, ~50 lines)**:
  - `GET /api/coordination/dead-letters` — list DLQ entries (`?status=`, `?category=`, `?limit=`, `?offset=`)
  - `GET /api/coordination/dead-letters/stats` — DLQ summary stats
  - `GET /api/coordination/dead-letters/:id` — single entry detail
  - `POST /api/coordination/dead-letters/:id/retry` — retry: re-add to task queue (body: `{ reassignTo?, priority? }`)
  - `POST /api/coordination/dead-letters/:id/dismiss` — dismiss with reason (body: `{ reason }`)
  - `DELETE /api/coordination/dead-letters/:id` — permanently remove

- **`operator/server.mjs` (~15 lines changed)**:
  - Create `deadLetterQueue` when coordinator exists: `createDeadLetterQueue({ events, persistPath, log })`
  - Pass to coordinator: `deadLetterQueue` option
  - Wire `createDeadLetterRoutes({ deadLetterQueue, coordinator })` to router

- **WS bridge** (~3 lines in `ws.mjs`): Add `dlq:added`, `dlq:retried`, `dlq:dismissed` to BRIDGED_EVENTS

- **Taskboard DLQ panel** (~30 lines in `public/taskboard.js`):
  - New "Dead Letters" tab/section below Kanban board
  - Fetches `GET /api/coordination/dead-letters`
  - Shows failed task card with: task description, error message, failure count, terminal ID, timestamp
  - Action buttons per card: "Retry" (POST retry), "Dismiss" (POST dismiss), "Delete" (DELETE)
  - "Retry" button optionally shows terminal dropdown for `reassignTo`
  - Real-time updates via `dlq:added`, `dlq:retried`, `dlq:dismissed` WS events
  - Badge counter showing pending DLQ items in taskboard nav

### Test Plan
- `operator/__tests__/dead-letter-queue.test.mjs` (~25 tests):
  - `add()` stores entry with all fields
  - `getAll()` returns entries, filters by status and category
  - `getAll()` paginates with limit/offset
  - `retry()` changes status to retrying, returns task def
  - `dismiss()` changes status, stores reason
  - `remove()` permanently deletes
  - `getStats()` returns correct counts
  - Persistence: save/load round-trip
  - Persistence: crash recovery from .tmp file
  - `maxEntries`: oldest dismissed entries evicted when full
  - Coordinator integration: task failing N+1 times goes to DLQ
  - Coordinator integration: DLQ retry re-adds task to queue
  - `dlq:added` event emitted on add
  - `dlq:retried` event emitted on retry
  - Empty DLQ: getAll returns `{ entries: [], total: 0 }`
  - Route handlers: CRUD operations return correct responses

### Dependencies
- Phase 28 (logger)
- Phase 29 (validation for route inputs)
- Phase 31 (audit log records DLQ actions for accountability)

---

## Summary Table

| Phase | Title | Priority Area | New Files | Changed Files | Est. Tests |
|-------|-------|--------------|-----------|---------------|------------|
| 27 | Authentication & Session Tokens | Security | `auth.mjs`, `routes/auth.mjs` | `server.mjs`, `ws.mjs` | 25 |
| 28 | Structured Logging & Request Correlation | Observability | `logger.mjs`, `middleware/request-id.mjs` | `server.mjs`, `event-bus.mjs` | 25 |
| 29 | Input Validation & API Hardening | Security | `validation.mjs`, `error-response.mjs` | `server.mjs`, 5 route files | 25 |
| 30 | Data Migration Framework | Persistence | `migrations.mjs`, `retention.mjs` | `server.mjs` | 25 |
| 31 | Audit Log | Observability | `audit-log.mjs`, `routes/audit.mjs` | `server.mjs`, `ws.mjs` | 25 |
| 32 | Dead Letter Queue & Manual Intervention | Resilience | `coordination/dead-letter-queue.mjs`, `routes/dead-letter.mjs` | `coordinator.mjs`, `server.mjs`, `ws.mjs`, `taskboard.js` | 25 |

**Total estimated: ~150 new tests across 6 new test files, ~750 lines of new production code, ~80 lines changed in existing files.**
