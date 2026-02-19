# Session 103 Handoff — Phase 0: Foundation Cleanup

## What S103 Did

**Phase 0 of multi-orchestrator plan**: Eliminated singleton blockers in registry, settings, and EventBus to enable multi-instance operation.

### 1. Registry Factory Pattern
- Converted `operator/registry.mjs` from module-level singleton (`initRegistry` + mutable global state) to `createRegistry(ctx)` factory pattern
- Factory returns `{ load, save }` with all path state and cache enclosed in closure
- Pure data functions (`createChain`, `recordSession`, `updateChainStatus`, `findIncompleteChains`, `findChainById`, `getChainSummary`, `getChainLineage`) remain standalone exports (no state dependency)
- `initRegistry` removed entirely — no longer needed
- `registryPath` export removed (was unused)

### 2. Settings Factory Pattern
- Converted `operator/settings.mjs` from `initSettings` + mutable `settingsPath` to `createSettings(ctx)` factory
- Factory returns `{ load, save }` with path enclosed in closure
- `initSettings` removed entirely
- `DEFAULTS` and `VALID_MODELS` remain standalone exports

### 3. File Locking (proper-lockfile)
- Added `proper-lockfile` npm dependency (~15KB pure JS, Windows NTFS compatible)
- Registry `save()` now acquires file lock before writing, releases in `finally` block
- Uses `realpath: false` for Windows compatibility
- Graceful fallback: if lock acquisition fails (e.g. file doesn't exist yet), proceeds without lock

### 4. EventBus Extraction
- Created `shared/event-bus.mjs` with `EventBus` class (extracted from `orchestrator/observability.mjs`)
- Created `IPCEventBus` subclass that also forwards events via `process.send()` for cross-process propagation
- `orchestrator/observability.mjs` now imports and re-exports EventBus from shared (backward compatible)
- `operator/server.mjs` and `operator/__tests__/server.test.mjs` import from `shared/event-bus.mjs`

### 5. Consumer Updates
- **server.mjs**: Creates `registry` and `settings` instances in `createApp()`, passes via ctx to routes
- **operator.mjs**: Creates instances in `main()`, passes `regStore` to `runChain()` as 4th parameter
- **routes/chains.mjs**: Destructures `ctx.registry` as `{ load: loadRegistry, save: saveRegistry }`
- **routes/views.mjs**: Gets `loadRegistry` from `ctx.registry.load`, `loadSettings` from `ctx.settings.load`
- **routes/settings.mjs**: Receives `ctx.settings`, destructures `{ load: loadSettings, save: saveSettings }`
- **Combined mode** (server.mjs CLI): Creates shared registry before `createApp()`, passes to both

### 6. Test Updates
- **registry.test.mjs**: Uses `createRegistry()` + convenience aliases `loadRegistry`/`saveRegistry`
- **server.test.mjs**: `seedRegistry()` creates local regStore, 3 inline regStore creations
- **views.test.mjs**: Module-level convenience functions that create fresh stores per call
- All `initRegistry`/`initSettings` calls removed from tests

### All 1604 tests pass across 25 suites.

## Files Modified

| File | Change |
|------|--------|
| `operator/registry.mjs` | Factory pattern + proper-lockfile |
| `operator/settings.mjs` | Factory pattern |
| `operator/server.mjs` | Create instances, pass via ctx, EventBus from shared |
| `operator/operator.mjs` | Create instances, pass regStore to runChain |
| `operator/routes/chains.mjs` | Destructure ctx.registry |
| `operator/routes/views.mjs` | Destructure ctx.registry + ctx.settings |
| `operator/routes/settings.mjs` | Destructure ctx.settings |
| `orchestrator/observability.mjs` | Import EventBus from shared, remove class definition |
| `operator/__tests__/registry.test.mjs` | Factory pattern |
| `operator/__tests__/server.test.mjs` | Factory pattern + shared EventBus |
| `operator/__tests__/views.test.mjs` | Factory pattern |
| `CLAUDE.md` | Updated test counts, added shared/ to architecture |

## Files Created

| File | Description |
|------|-------------|
| `shared/event-bus.mjs` | EventBus + IPCEventBus classes (extracted from observability.mjs) |

## Dependencies Added

| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| `proper-lockfile` | latest | ~15KB | Cross-process file locking for registry |

## What S104 Should Do

**Phase 1: Process Pool + Multi-Instance Backend** — per `docs/multi-orchestrator-plan.md`:

### Priority 1: Create `operator/process-pool.mjs`
- `spawn(workerId, config)` — fork worker with IPC channel
- `kill(workerId)` — IPC shutdown message + force-kill timeout
- `sendTo(workerId, msg)` — route commands to specific worker
- `getStatus()` — all workers' status
- `shutdownAll()` — graceful coordinated shutdown
- Use `IPCEventBus` from `shared/event-bus.mjs` for event propagation

### Priority 2: Create `operator/orchestrator-worker.mjs`
- Child process entry point
- Accepts commands via `process.on('message')`
- Uses `IPCEventBus` (events forward to parent)
- Runs operator chain logic in isolation

### Priority 3: Refactor `routes/orchestrator.mjs` for multi-instance
- `orchestrators` Map (keyed by instance ID) instead of single `orchestratorStatus`
- `POST /api/orchestrator/:id/start` — start specific instance
- `POST /api/orchestrator/:id/stop` — stop specific instance
- `GET /api/orchestrator/instances` — list all instances

### Priority 4: IPC Bridge
- Worker IPC events → parent EventBus → ws.mjs (no ws.mjs changes needed)
- Health check heartbeats (30s interval)

### Priority 5: Tests
- Process pool lifecycle, IPC bridge, multi-instance routes

## Key Architecture Notes

- **Factory pattern** is now the standard for all stateful modules in operator/
- **Pure functions** remain standalone exports — only `load`/`save` need factory closure
- **Consumer pattern**: Routes destructure `ctx.registry`/`ctx.settings` at factory top, code below is unchanged
- **IPCEventBus** extends EventBus with `process.send()` forwarding — transparent to existing code
- **Windows SIGTERM**: IPCEventBus already uses `process.send()`, not signals. Workers should listen for IPC shutdown messages.
- **File locking**: Uses `lockSync`/`unlockSync` with `realpath: false` — synchronous, Windows-compatible

## Current State

- **1604 tests ALL PASSING** across 25 test suites
- **Balance ALL ZERO FLAGS**
- **Phase 0 COMPLETE** — all 5 singleton blockers resolved
