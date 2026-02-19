# Session 111 Handoff — Phase 6: Inter-Orchestrator Coordination

## What S111 Did

### Phase 5 COMPLETE — Skill Pool System

#### Phase 5A: Skill Registry + Manifests (commit 2b139ca)

1. **Skill Manifest Schema** (`operator/skills/schema/skill.schema.json`):
   - JSON Schema: id, name, version, description, shortDescription, category, tags, triggerExamples, parameters, requires, conflicts, enhancedBy, sideEffects, idempotent, requiresConfirmation, handler, model, estimatedDurationMs
   - Valid categories: git, code, research, audit, testing, deployment, analysis
   - IDs kebab-case, versions semver, tags lowercase kebab

2. **17 Skill Manifests** (`operator/skills/manifests/`):
   - `git/`: git-status, git-commit, git-push
   - `code/`: file-read, test-runner, lint
   - `research/`: web-search, codebase-search, project-detect
   - `audit/`: accessibility-audit, security-scan, performance-audit, dependency-audit, test-coverage-audit, code-review, agent-report, orchestrator-status

3. **Skill Registry** (`operator/skills/registry.mjs`): SkillRegistry class — load, validate, index, search
4. **Skill Resolver** (`operator/skills/resolver.mjs`): dependency walk, conflict detection, topological sort
5. **Skill Selector** (`operator/skills/selector.mjs`): two-stage pipeline, 6 AGENT_PROFILES

#### Phase 5B: Agent Integration + Analytics (commit c2a377e)

6. **Skill Tracker** (`operator/skills/tracker.mjs`): usage analytics, per-turn re-evaluation
7. **Skill Discovery** (`operator/skills/discovery.mjs`): file-based mid-task protocol
8. **Skill Assignment** (`operator/skills/assignment.mjs`): ROLE_PROFILE_MAP (22+ roles), assignSkillsToAgent, reassignSkills

**Tests**: 233 new (158 Phase 5A + 75 Phase 5B) — **1979 tests across 30 suites ALL PASSING**

---

## What S112 Should Do

### Phase 6: Inter-Orchestrator Coordination

**Goal**: Enable multiple orchestrator instances running in parallel via the process pool to cooperate on shared projects without conflicts.

**Reference**: `docs/multi-orchestrator-plan.md` Phase 6 section.

#### 6A: Coordination Core (~3 new modules)

1. **Task Queue with Dependency Graph** (`operator/coordination/task-queue.mjs`):
   - Tasks have `id`, `status` (pending/assigned/running/complete/failed), `deps[]`, `assignedTo` (workerId), `priority`
   - Topological sort for execution ordering
   - Ready tasks: all deps completed, not yet assigned
   - `createTaskQueue()` factory → `{add, remove, assign, complete, fail, getReady, getByWorker, getDependencyGraph, size}`
   - Cycle detection on add (reject tasks that would create circular deps)

2. **Work Assignment** (`operator/coordination/work-assigner.mjs`):
   - Three strategies:
     - **Static**: round-robin to available workers
     - **Capability-based**: match task category to worker's agent profile (uses Phase 5 AGENT_PROFILES)
     - **Work-stealing**: idle workers pull from busy workers' queues
   - `createWorkAssigner(strategy, pool, taskQueue)` factory
   - `assign()` picks best worker for next ready task, calls `pool.sendTo()` to dispatch
   - Should emit `coord:assigned` events on EventBus

3. **Coordination Manager** (`operator/coordination/coordinator.mjs`):
   - Central broker: listens to worker events via EventBus, routes coordination messages via `pool.sendTo()`
   - `createCoordinator(ctx)` factory — ctx has `{events, pool, taskQueue, workAssigner}`
   - Message routing: worker emits `coord:*` IPC events → parent EventBus → coordinator routes to target worker
   - Manages coordination lifecycle: init → running → draining → stopped
   - Tracks shared state: which worker owns which files/resources

#### 6B: Conflict Prevention

4. **Git Worktree Isolation** (extend `operator/routes/git.mjs` or new module):
   - Each worker gets its own git worktree (`git worktree add`) with a branch-per-worker
   - `setupWorktree(projectDir, workerId)` / `teardownWorktree(projectDir, workerId)`
   - Conflict detection: periodic `git merge --no-commit --no-ff` dry runs between worker branches
   - Merge queue: completed tasks validated by tests before merge to main branch

5. **Rate Limiter** (`operator/coordination/rate-limiter.mjs`):
   - Shared token bucket for API calls across all workers
   - `createRateLimiter({maxTokensPerMinute, maxRequestsPerMinute})` factory
   - Workers request tokens before API calls; coordinator grants/denies
   - IPC protocol: worker sends `coord:rate-request`, coordinator replies `coord:rate-grant` or `coord:rate-wait`

6. **Cost Aggregator** (extend existing cost tracking):
   - Sum costs across all workers in real-time
   - Enforce per-worker and global budget caps
   - Emit `coord:budget-warning` / `coord:budget-exceeded` events

#### 6C: Tests + Wiring

7. **Tests** (`operator/__tests__/coordination.test.mjs`):
   - Task queue: add, deps, ready, assign, complete, fail, cycle detection
   - Work assigner: round-robin, capability-based, work-stealing
   - Coordinator: message routing, lifecycle, event emission
   - Rate limiter: token bucket, grant/deny/wait
   - Git worktree: setup, teardown, conflict detection (mock git)
   - Target: 80-120 new tests

8. **Wiring**:
   - Add `coord:*` events to `BRIDGED_EVENTS` in `ws.mjs`
   - Add coordination REST endpoints to orchestrator routes (or new `routes/coordination.mjs`)
   - Wire coordinator into `server.mjs` (create on startup if pool mode)
   - Add coordination status to the terminals UI

---

## Key Architecture Context

### IPC is the only inter-worker channel

Workers cannot talk directly to each other. All communication goes through the parent process:
```
Worker A → IPC → Parent (EventBus + pool.sendTo) → IPC → Worker B
```

The `pool.sendTo(workerId, msg)` method sends arbitrary IPC messages. Worker events arrive on the parent EventBus with `data.workerId` injected by `process-pool.mjs` line 86-89.

### Existing infrastructure to build on

| Module | What it provides for Phase 6 |
|--------|------------------------------|
| `operator/process-pool.mjs` | `spawn`, `sendTo`, `kill`, `handoff`, heartbeats, event routing |
| `operator/ws.mjs` | BRIDGED_EVENTS (26 events), WS subscription patterns, `matchesPattern()` |
| `operator/routes/orchestrator.mjs` | `instances` Map, `instanceAgentMaps`, dual-mode (pool/direct), handoff protocol |
| `operator/orchestrator-worker.mjs` | IPC message handler, IPCEventBus, orchestrator fork |
| `operator/skills/assignment.mjs` | ROLE_PROFILE_MAP, detectProfile (for capability-based assignment) |
| `shared/event-bus.mjs` | EventBus + IPCEventBus classes |
| `orchestrator/dag-scheduler.mjs` | Existing DAG pattern (may inform task-queue design) |

### New IPC message types needed

Parent → Worker: `coord:proceed`, `coord:wait`, `coord:rate-grant`, `coord:rate-wait`, `coord:conflict`
Worker → Parent: `coord:request`, `coord:complete`, `coord:rate-request`, `coord:conflict-check`

### New BRIDGED_EVENTS to add

`coord:assigned`, `coord:complete`, `coord:conflict`, `coord:budget-warning`, `coord:rate-limited`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `operator/process-pool.mjs` | Worker management — spawn, sendTo, kill, heartbeat |
| `operator/ws.mjs` | WebSocket bridge — 26 BRIDGED_EVENTS, pattern subscriptions |
| `operator/routes/orchestrator.mjs` | Multi-instance routes — instances Map, event wiring, handoff |
| `operator/orchestrator-worker.mjs` | Child process IPC handler, IPCEventBus |
| `operator/skills/assignment.mjs` | ROLE_PROFILE_MAP, detectProfile (for capability-based work assignment) |
| `orchestrator/dag-scheduler.mjs` | Existing DAG scheduler pattern (reference for task queue) |
| `operator/__tests__/process-pool.test.mjs` | 43 pool tests (pattern to follow) |
| `docs/multi-orchestrator-plan.md` | Full Phase 6 spec |

## Architecture State

- **1979 tests** across 30 suites — ALL PASSING
- **Phase 0-5**: DONE (factory patterns → skill pool system)
- **Phase 6**: TODO (inter-orchestrator coordination)
- **Phase 7**: TODO (polish + scaling — S113-S114)

## What NOT to Do
- Don't modify Phase 1-5 code unless wiring coordination into existing flows
- Don't break the 1979 existing tests
- Don't touch the game engine or React frontend
- Don't add direct worker-to-worker communication — all routing must go through parent process
- Don't use shared memory between workers — IPC messages only
