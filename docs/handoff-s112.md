# Session 112 Handoff — Phase 6A: Inter-Orchestrator Coordination Core

## What Was Done

Phase 6A of the multi-orchestrator plan: built the coordination core (5 new modules + routes + tests + wiring).

### New Files Created

1. **`operator/coordination/task-queue.mjs`** — DAG-based task queue
   - Factory: `createTaskQueue(options)` returns queue methods
   - Tasks have id, deps, priority, category, metadata, status (pending/assigned/running/complete/failed/cancelled)
   - Kahn's algorithm for cycle detection and topological sort
   - `getReady()` returns tasks with all deps complete, sorted by priority
   - `cancel()` cascades to dependents, handles failed-root case (doesn't re-cancel failed tasks)
   - `retry()` resets failed/cancelled tasks back to pending
   - `toJSON()`/`fromJSON()` for serialization

2. **`operator/coordination/work-assigner.mjs`** — Multi-strategy task assignment
   - Factory: `createWorkAssigner({strategy, pool, taskQueue, events})`
   - Three strategies:
     - **round-robin**: Cyclic distribution to running workers
     - **capability**: Match task category to worker capabilities (fallback: least-loaded)
     - **work-stealing**: Idle workers get priority, then least-loaded
   - `assignNext()` / `assignAll()` — assign ready tasks to workers
   - `registerCapabilities(workerId, categories)` — for capability strategy
   - Emits `coord:assigned` events

3. **`operator/coordination/rate-limiter.mjs`** — Shared token bucket
   - Factory: `createRateLimiter({maxRequestsPerMinute, maxTokensPerMinute})`
   - `tryAcquire(workerId, tokens)` — synchronous grant/deny
   - `acquire(workerId, tokens, timeoutMs)` — async with waiter queue
   - `processWaiters()` — drain waiter queue after refill
   - Per-minute refill proportional to elapsed time
   - Per-worker usage tracking (requests, tokens, denials)
   - Injectable clock (`now` option) for deterministic testing

4. **`operator/coordination/cost-aggregator.mjs`** — Cross-worker cost tracking
   - Factory: `createCostAggregator({globalBudgetUsd, perWorkerBudgetUsd, events})`
   - `record(workerId, {totalUsd, inputTokens, outputTokens})` — track costs
   - `checkBudget(workerId)` — check remaining budget
   - WARNING_THRESHOLD at 80% — emits `coord:budget-warning`
   - Budget exceeded — emits `coord:budget-exceeded`
   - Per-worker and global budget caps independently tracked

5. **`operator/coordination/coordinator.mjs`** — Central coordination broker
   - Factory: `createCoordinator({events, pool, options})`
   - Lifecycle: `init` → `running` → `draining` → `stopped`
   - Composes: taskQueue + workAssigner + rateLimiter + costAggregator
   - Event handlers:
     - `coord:request` → assign task or send `coord:wait`
     - `coord:complete` → mark complete, assign newly-ready tasks
     - `coord:failed` → mark failed, cascade cancel dependents
     - `coord:rate-request` → grant or deny rate budget
     - `coord:cost` → record cost, send `coord:budget-stop` if exceeded
   - `addTask()` / `addTasks()` — auto-assigns when running
   - Emits `coord:all-complete` when all tasks done
   - Cleans up event listeners on stop

6. **`operator/routes/coordination.mjs`** — REST API (13 endpoints)
   - `GET /api/coordination/status` — full coordination status
   - `POST /api/coordination/start|drain|stop` — lifecycle control
   - `GET|POST /api/coordination/tasks` — list/add tasks
   - `POST /api/coordination/tasks/batch` — batch add
   - `GET /api/coordination/tasks/:id` — task detail
   - `POST /api/coordination/tasks/:id/cancel|retry` — task management
   - `GET /api/coordination/progress` — progress summary
   - `GET /api/coordination/rate-limit` — rate limiter status
   - `GET /api/coordination/costs` — cost aggregation status
   - Returns 503 when coordinator not available (non-pool mode)

### Modified Files

- **`operator/ws.mjs`** — Added 9 coordination events to BRIDGED_EVENTS (26→35): `coord:started`, `coord:stopped`, `coord:draining`, `coord:assigned`, `coord:task-complete`, `coord:task-failed`, `coord:all-complete`, `coord:budget-warning`, `coord:budget-exceeded`
- **`operator/server.mjs`** — Auto-creates coordinator when pool mode active, wires coordination routes, graceful shutdown, exposed in createApp return value
- **`CLAUDE.md`** — Updated architecture tree, test counts (2115/31), added coordination modules
- **`docs/session-history.md`** — Added S112 entry

### Test Coverage

**136 new tests** in `operator/__tests__/coordination.test.mjs`:
- TaskQueue: 64 tests (add/remove, status transitions, cancel cascade, retry, getReady priority sort, getByWorker, get/getAll immutability, topological sort, getLevels, validate, getDependencyGraph, getProgress, toJSON/fromJSON, clear, cycle detection)
- WorkAssigner: 20 tests (3 strategies, assignAll with deps, events, validation, exports)
- RateLimiter: 14 tests (tryAcquire, deny on empty bucket, token budget, refill, partial refill, cap, per-worker tracking, denials, async acquire, processWaiters, timeout, status, reset)
- CostAggregator: 17 tests (record, global total, per-worker budget warning/exceeded, global budget warning/exceeded, only-once warnings, checkBudget, status, reset, WARNING_THRESHOLD export)
- Coordinator: 21 tests (creation validation, lifecycle transitions, event emissions, idempotent start, no restart after stop, addTask auto-assign, addTasks batch, coord:request/complete/failed/rate-request/cost handling, all-complete event, status, event cleanup on stop, STATES export)

## Test Status

**2115 tests ALL PASSING** across 31 suites (was 1979/30).

## What's Next — Phase 6B & 6C

Phase 6B: Conflict Prevention
1. **Git worktree isolation** — Per-worker worktrees with dedicated branches. Extend `operator/routes/git.mjs` or create new module. Each worker gets `git worktree add`, periodic conflict detection via dry-run merges, merge queue for validated changes.
2. **Rate limiter integration** — Wire rate limiter into the actual worker IPC protocol so workers check before API calls.
3. **Cost aggregator integration** — Wire cost events from worker sessions into the aggregator.

Phase 6C: Tests + Full Wiring
1. Add tests for git worktree operations (mock git commands).
2. Integration tests for coordinator + pool + worker IPC flow.
3. Add coordination status to terminals UI.

### Key Architecture Decisions

- **All coordination flows through parent EventBus** — workers emit `coord:*` events via IPCEventBus, coordinator listens and responds via `pool.sendTo()`. No direct worker-to-worker communication.
- **Coordinator is optional** — created only when pool mode is active (`options.pool` set). Non-pool server works unchanged.
- **Event-driven, not RPC** — workers emit events and coordinator responds asynchronously. No request-response blocking.
- **Factory pattern everywhere** — consistent with createRegistry, createProcessPool, createSettings, etc.
- **Subsystem injection** — coordinator accepts pre-built taskQueue/workAssigner/rateLimiter/costAggregator for testing.

### IPC Message Protocol (new coord:* types)

Parent → Worker:
- `coord:proceed` — worker may begin assigned task (taskId, task, category, metadata)
- `coord:wait` — no tasks available, reason given
- `coord:rate-grant` — API call budget granted (remaining)
- `coord:rate-wait` — API call budget denied (waitMs, remaining)
- `coord:budget-stop` — budget exceeded, worker should stop

Worker → Parent (via EventBus):
- `coord:request` — worker requests task assignment (workerId)
- `coord:complete` — worker finished task (workerId, taskId, result)
- `coord:failed` — worker's task failed (workerId, taskId, error)
- `coord:rate-request` — worker requests API token budget (workerId, tokens)
- `coord:cost` — worker reports cost (workerId, totalUsd, inputTokens, outputTokens)
