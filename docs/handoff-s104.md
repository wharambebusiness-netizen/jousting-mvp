# Session 104 Handoff — Phase 1: Process Pool + Multi-Instance Backend

## What S104 Did

**Phase 1 of multi-orchestrator plan**: Built the process pool, worker entry point, and multi-instance orchestrator routes.

### 1. Process Pool (`operator/process-pool.mjs`, ~300 lines)
- `createProcessPool(ctx)` factory returns pool methods with enclosed state
- **spawn(workerId, config)**: forks `orchestrator-worker.mjs` with IPC, tracks in workers Map
- **kill(workerId)**: IPC shutdown message → force-kill after 5s timeout (Windows-safe)
- **restart(workerId)**: kill → re-spawn with original config, tracks restartCount
- **sendTo(workerId, msg)**: route IPC messages to specific worker
- **getStatus()**: all workers as array, **getWorker(id)**: single worker status
- **remove(workerId)**: remove stopped worker from pool (throws if running)
- **shutdownAll()**: graceful coordinated shutdown of all workers
- **activeCount()**: count of running/starting workers
- **Heartbeat**: 30s interval ping, 3 missed (90s timeout) triggers restart
- **IPC bridge**: worker messages re-emitted on parent EventBus with workerId
- Worker states: `starting` → `running` (on ready) → `stopping` → `stopped`

### 2. Orchestrator Worker (`operator/orchestrator-worker.mjs`)
- Child process entry point, spawned via `fork()` by process pool
- IPC protocol (parent → worker): init, start, stop, ping, shutdown
- IPC protocol (worker → parent): ready, pong, status, event, error
- Uses `IPCEventBus` from `shared/event-bus.mjs` — events auto-propagate to parent
- Forks `orchestrator/orchestrator.mjs` as grandchild with stdout/stderr forwarding
- Graceful shutdown: stops orchestrator child, then exits
- Handles parent disconnect (kills orchestrator, exits with code 1)

### 3. Multi-Instance Orchestrator Routes
- `routes/orchestrator.mjs` refactored from single-instance to multi-instance
- **instances Map**: per-instance state (status, round, agents, mission, etc.)
- **instanceAgentMaps**: per-instance agent tracking
- **directProcesses Map**: for backward-compat direct fork mode (no pool)
- **New endpoints**:
  - `GET /api/orchestrator/instances` — list all instances with pool status
  - `POST /api/orchestrator/:id/start` — start named instance
  - `POST /api/orchestrator/:id/stop` — stop named instance
  - `DELETE /api/orchestrator/:id` — remove stopped instance
- **Legacy endpoints preserved** (use 'default' instance):
  - `GET /api/orchestrator/status` — default instance status
  - `POST /api/orchestrator/start` — start default instance
  - `POST /api/orchestrator/stop` — stop default instance
- **Event routing**: all events include `workerId`, handlers route to correct instance
- **Run history**: `instanceId` added to history records
- **Pool integration**: uses `pool.spawn()` + `pool.sendTo()` when pool available, falls back to direct fork

### 4. Server Integration
- `server.mjs` imports `createProcessPool`
- `createApp()` accepts `pool` option (true=auto-create, object=inject)
- Pool passed to orchestrator routes via ctx
- Pool shutdown in graceful shutdown handler
- Pool exposed in return value: `{ app, server, events, wss, pool, close }`

### 5. WebSocket Events
- 7 worker events added to `BRIDGED_EVENTS` in `ws.mjs` (17 → 24 total):
  - `worker:spawned`, `worker:ready`, `worker:exit`
  - `worker:error`, `worker:log`, `worker:unhealthy`, `worker:restarted`

### 6. Tests (43 new)
- `operator/__tests__/process-pool.test.mjs` — 43 tests across 6 describe blocks:
  - **ProcessPool Unit** (18): spawn, getStatus, getWorker, duplicate detection, re-spawn after exit, kill, sendTo, IPC ready/events/exit, activeCount, remove, shutdownAll, status transitions
  - **Multi-Instance Routes** (19): instances list, legacy start/stop, events with workerId, named instances start/stop/delete, concurrent instances, run history with instanceId
  - **WS Bridge** (1): worker events bridged to WebSocket clients
  - **IPCEventBus** (2): local emit, workerId tracking
  - **Pool Option** (3): auto-create, inject, null default

### All 1647 tests pass across 26 suites.

## Files Created

| File | Description |
|------|-------------|
| `operator/process-pool.mjs` | Process pool manager (~300 lines) |
| `operator/orchestrator-worker.mjs` | Worker child process entry point (~200 lines) |
| `operator/__tests__/process-pool.test.mjs` | 43 tests for pool + multi-instance |

## Files Modified

| File | Change |
|------|--------|
| `operator/routes/orchestrator.mjs` | Multi-instance refactor (instances Map, new endpoints, event routing) |
| `operator/server.mjs` | Pool import, pool option, orchestrator routes ctx, shutdown, return |
| `operator/ws.mjs` | 7 worker events added to BRIDGED_EVENTS |
| `CLAUDE.md` | Test counts, architecture, new files |
| `docs/multi-orchestrator-plan.md` | Phase 1 checked off |
| `docs/session-history.md` | S104 entry |

## What S105 Should Do

**Phase 2: Multi-Terminal UI** — per `docs/multi-orchestrator-plan.md`:

### Priority 1: New terminals page
- `operator/public/terminals.html` with xterm.js via CDN
- Tab bar component (vanilla JS) with per-instance color themes
- 4 color themes: Indigo, Emerald, Amber, Rose

### Priority 2: Terminal rendering
- xterm.js + xterm-addon-fit for GPU-accelerated terminal
- Per-instance status bar (running indicator, round count, cost)
- WS integration: events tagged with workerId → route to correct terminal

### Priority 3: View toggle
- Tab view ↔ 2x2 grid view
- CSS grid layout for multi-terminal display
- Keyboard shortcuts (Ctrl+1-4 for tab switching)

### Priority 4: Nav + tests
- "Terminals" link on all HTML pages
- Tests for terminal page rendering, tab switching, grid layout

## Key Architecture Notes

- **Process pool is optional**: server works without pool (direct fork mode, backward compat)
- **Workers are grandchild processes**: pool forks worker, worker forks orchestrator
- **IPC message flow**: orchestrator → (stdout/stderr) → worker → (process.send) → pool → (EventBus.emit) → ws.mjs → browser
- **Event routing by workerId**: all events include `workerId` field, routes look up instance state by `data.workerId || 'default'`
- **Legacy endpoints**: existing UI works unchanged — uses 'default' instance
- **Heartbeat is optional**: only runs when workers exist, timer is unref'd
- **Windows-safe shutdown**: IPC shutdown messages, never relies on catching SIGTERM

## Current State

- **1647 tests ALL PASSING** across 26 test suites
- **Balance ALL ZERO FLAGS**
- **Phase 0 + Phase 1 COMPLETE** — multi-instance backend fully functional
