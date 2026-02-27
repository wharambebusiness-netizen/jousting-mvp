# Research: Task Board Integration with Workers

## Executive Summary

The coordination system (task board, coordinator, work assigner) and the Claude terminal pool (workers) are two largely independent subsystems that are bridged through the `coordinator` object. The primary blocker for task board functionality is the **"pool mode required"** error, which occurs because the coordinator is only created when the server is started with `--pool` or `--swarm` flags. For the Master Console use case (spawning Claude terminal workers to drain tasks), `--swarm` is the correct flag.

---

## 1. "Pool Mode Required" Error — Root Cause & Fix

### Root Cause

**File:** `operator/routes/coordination.mjs:107-112`

```js
router.use('/coordination', (req, res, next) => {
  if (!coordinator) {
    return res.status(503).json({ error: 'Coordination not available (pool mode required)' });
  }
  next();
});
```

The `coordinator` is `null` because the server was started without `--pool` or `--swarm`. The initialization logic in `server.mjs:287-288`:

```js
let coordinator = null;
const needsCoordinator = (pool && options.coordination !== false) || options.swarm;
```

**Two paths to a non-null coordinator:**
1. `--pool` → creates a process pool (for multi-orchestrator IPC workers) → coordinator wraps that pool
2. `--swarm` → creates coordinator with a null pool stub (no IPC workers) → for Claude terminal workers

### Fix

For the Master Console workflow (Claude terminal workers draining tasks), start the server with:

```bash
node operator/server.mjs --swarm
```

This enables:
- Coordinator with persistent task queue (`operator/.data/task-queue.json`)
- Dead letter queue for permanently-failed tasks
- Claude pool receives the coordinator reference for auto-dispatch
- All `/api/coordination/*` routes become functional
- Task board UI works fully

**Key difference: `--pool` vs `--swarm`:**
| Flag | Process Pool | Coordinator | Claude Pool gets coordinator | Use Case |
|------|-------------|-------------|---------------------------|----------|
| (none) | No | No | No | Basic server, no task board |
| `--pool` | Yes (IPC workers) | Yes | Yes | Multi-orchestrator processes |
| `--swarm` | No (null stub) | Yes | Yes | Claude terminal workers drain tasks |

### Proposed Enhancement

The current behavior is confusing because the task board page loads but all API calls fail silently. Two improvements:

**A. Auto-enable coordinator when claudePool is active:**

In `server.mjs`, after line 288, add logic to also create coordinator when `options.claudePool` is true (which is always true in CLI mode per line 867):

```js
const needsCoordinator = (pool && options.coordination !== false)
  || options.swarm
  || options.claudePool;  // Always enable when terminals are available
```

This would make the task board work out of the box without requiring `--swarm`.

**B. Show clear error state in taskboard.js:**

Currently `taskboard.js:407-411` silently catches the 503 error and shows an empty board. Add a visible banner:

```js
.catch(function (err) {
  tasks = {};
  renderBoard();
  // Show a clear error message explaining the fix
  boardEmpty.innerHTML = '<p>Coordination not available.</p>' +
    '<p>Restart server with <code>--swarm</code> flag to enable task board.</p>';
  boardEmpty.style.display = '';
});
```

---

## 2. Task Queue Auto-Dispatch Mechanism

### How Tasks Get from Queue to Workers

There are **two parallel dispatch systems** that coexist:

#### System A: Coordinator + Work Assigner (for IPC process pool workers)

**Files:** `coordinator.mjs`, `work-assigner.mjs`

This is the original system designed for orchestrator worker processes communicating via IPC:

1. **Task added** → `coordinator.addTask()` → `taskQueue.add()` → `workAssigner.assignAll()`
2. **Work assigner** picks a worker using strategy (round-robin/capability/work-stealing)
3. **Assignment sent** via `pool.sendTo(workerId, { type: 'coord:proceed', ... })`
4. **Worker completes** → sends `coord:complete` IPC event → coordinator marks complete → triggers `workAssigner.assignAll()` for newly-ready tasks

This system is designed for IPC `process-pool.mjs` workers, NOT Claude terminal workers.

#### System B: Claude Pool Auto-Dispatch (for Claude terminal workers)

**File:** `claude-pool.mjs`

This is the system that connects task board tasks to Claude terminal workers:

1. **Terminal spawned** with `autoDispatch: true`
2. **Task completion event** (`claude-terminal:task-completed`) triggers `maybeAutoDispatch()` after 2-second delay
3. **`maybeAutoDispatch()`** checks: autoDispatch enabled? coordinator exists? terminal idle? no assigned task? terminal running?
4. **`findNextClaimableTask()`** queries coordinator's task queue for pending tasks with deps satisfied
5. **Affinity scoring** ranks tasks by: priority + capability match + task history match
6. **Task assigned** in queue → written to terminal PTY as `[AUTO-DISPATCH] Task {id}: {description}\r`

### How Workers Claim Tasks

**Manual claim route:** `POST /api/claude-terminals/:id/claim-task`

```
routes/claude-terminals.mjs → claudePool.findNextClaimableTask(id) → taskQueue.assign() → taskQueue.start() → claudePool.assignTask()
```

**Auto-dispatch flow:**
```
task-completed event → 2s delay → maybeAutoDispatch() → findNextClaimableTask() → taskQueue.assign() → taskQueue.start() → assignTask() → write to PTY
```

### Task Claiming Algorithm (`findNextClaimableTask`)

**File:** `claude-pool.mjs` (around line 922)

1. Get all tasks from `coordinator.taskQueue.getAll()`
2. Filter to `status === 'pending'`
3. Filter to deps satisfied (all dep tasks have `status === 'complete'`)
4. **Capability filtering:** If terminal has capabilities set, skip tasks whose category doesn't match
5. **Affinity scoring:**
   - Base score = `task.priority` (higher is better)
   - +2 bonus if task category matches terminal's most recent completed task category
   - +1 bonus if task category exists anywhere in terminal's task history (max 5 entries)
6. Sort by score descending, return top task

### Gap: Two Systems Don't Fully Integrate

**Problem:** The coordinator's `workAssigner.assignAll()` uses `pool.getStatus()` which returns IPC process workers, NOT Claude terminal workers. When using `--swarm` mode (null pool stub), `pool.getStatus()` returns `[]`, so the coordinator's work assigner **never assigns tasks** — it always finds zero available workers.

The Claude pool's auto-dispatch system bypasses the work assigner entirely by directly accessing `coordinator.taskQueue`. This means:

- The coordinator's `coord:assigned` event is NOT emitted when Claude workers claim tasks
- The coordinator's metrics (throughput, utilization) don't track Claude worker assignments
- The coordinator's work assigner strategies (capability, work-stealing) are unused

**Proposed Fix:** Bridge the two systems by having Claude pool emit `coord:assigned` events when tasks are claimed, and register Claude terminals as "virtual workers" in the work assigner's capability map.

---

## 3. Full Task Lifecycle: Creation to Completion

### State Machine

```
pending → assigned → running → complete
                            → failed → [DLQ after N retries]
pending → cancelled (cascade from failed dependency)
failed/cancelled → pending (retry)
```

### Step-by-Step Lifecycle

#### Phase 1: Task Creation

1. **User creates task** via:
   - Task board UI "Add Task" dialog → `POST /api/coordination/tasks`
   - Task template application → `POST /api/coordination/tasks/batch`
   - Programmatic API call

2. **Route handler** (`coordination.mjs:160-171`):
   - Validates body (task string required, priority 1-10, category optional)
   - Calls `coordinator.addTask(req.body)`

3. **Coordinator** (`coordinator.mjs:568-596`):
   - Auto-detects category if not specified (via `categoryDetector.detect()`)
   - Adds to task queue: `taskQueue.add(taskDef)`
   - If coordinator is running, calls `workAssigner.assignAll()` to auto-assign
   - Checks auto-scale thresholds

4. **Task Queue** (`task-queue.mjs:42-82`):
   - Validates unique ID, validates deps don't create cycles
   - Creates task object with `status: 'pending'`, timestamps, metadata
   - Returns task copy

#### Phase 2: Task Assignment

**Path A — Auto-dispatch to Claude terminal:**
1. Terminal's `maybeAutoDispatch()` fires (on previous task completion or terminal idle)
2. `findNextClaimableTask()` finds highest-affinity pending task
3. `taskQueue.assign(taskId, terminalId)` → status becomes `'assigned'`
4. `taskQueue.start(taskId)` → status becomes `'running'`
5. `assignTask(terminalId, task)` stores task on terminal entry
6. Prompt written to PTY: `[AUTO-DISPATCH] Task {id}: {description}`
7. Event emitted: `claude-terminal:task-assigned`

**Path B — Manual claim via REST:**
1. `POST /api/claude-terminals/:id/claim-task`
2. Same flow as auto-dispatch but triggered by API call

**Path C — Coordinator work assigner (IPC workers only):**
1. `workAssigner.assignAll()` iterates ready tasks
2. Strategy selects worker from `pool.getStatus()`
3. `taskQueue.assign()` → `pool.sendTo(workerId, { type: 'coord:proceed', ... })`

#### Phase 3: Task Running

1. Claude terminal worker processes the task prompt
2. Worker writes output to its PTY (visible in terminals page)
3. Terminal activity tracking monitors active/idle state

#### Phase 4: Task Completion

1. **Complete via REST:** `POST /api/claude-terminals/:id/complete-task` with `{ status: 'complete', result: '...' }`
2. **Route handler** (`claude-terminals.mjs`):
   - Gets current assigned task from pool
   - Marks in coordinator task queue: `taskQueue.complete(taskId, result)` → status `'complete'`
   - Releases task from terminal: `claudePool.releaseTask(terminalId)`
   - Emits `claude-terminal:task-completed` event
3. **Auto-dispatch trigger:** Event listener in claude-pool sees task-completed → 2s delay → `maybeAutoDispatch()`
4. **Coordinator** picks up completion → emits `coord:task-complete` → checks if all tasks done

#### Phase 4b: Task Failure

1. `POST /api/claude-terminals/:id/complete-task` with `{ status: 'failed', error: '...' }`
2. Task queue marks `status: 'failed'`
3. Coordinator tracks retry count → if `>= maxTaskRetries` (default 3), routes to Dead Letter Queue
4. Dependent tasks are cascade-cancelled
5. `coord:task-failed` event emitted

#### Phase 5: Retry

1. User clicks retry button on task board → `POST /api/coordination/tasks/:id/retry`
2. `taskQueue.retry(taskId)` resets to `status: 'pending'`, clears assignment/timestamps
3. Task becomes eligible for next auto-dispatch cycle

### Lifecycle Events (WebSocket)

| Event | Trigger | Data |
|-------|---------|------|
| `coord:assigned` | Work assigner assigns task | `{ taskId, workerId, strategy }` |
| `coord:task-complete` | Coordinator processes completion | `{ taskId, workerId, result }` |
| `coord:task-failed` | Coordinator processes failure | `{ taskId, workerId, error }` |
| `coord:all-complete` | All tasks done | `{ total, complete, failed, cancelled }` |
| `coord:started/stopped/draining` | Lifecycle transitions | `{ state }` |
| `claude-terminal:task-assigned` | Claude worker claims task | `{ taskId, terminalId }` |
| `claude-terminal:task-released` | Claude worker releases task | `{ taskId, terminalId }` |
| `claude-terminal:task-completed` | Claude worker finishes task | `{ taskId, terminalId, status, result/error }` |

---

## 4. Task Board Real-Time Rendering (taskboard.js)

### Architecture

The task board is a vanilla JS IIFE (no framework) with two view modes:
- **Kanban view:** 5 columns (pending, assigned, running, complete, failed)
- **DAG view:** SVG dependency graph with bezier-curve edges

### Data Flow

```
Initial load:
  loadTasks() → GET /api/coordination/tasks → tasks = {} map → renderBoard()
  loadStatus() → GET /api/coordination/status → boardStatus badge

Real-time updates:
  createWS(['coord:*', 'claude-terminal:task-*', 'dlq:*']) → msg handler →
    patch local tasks{} → renderBoard()
```

### WebSocket Subscriptions

**File:** `taskboard.js:1517-1594`

Subscribes to glob patterns: `coord:*`, `claude-terminal:task-assigned`, `claude-terminal:task-released`, `claude-terminal:task-completed`, `dlq:*`

**Event handling strategy:**
- **Optimistic local update:** If the task ID exists in local state, patch it directly and re-render (no API call)
- **Fallback full reload:** If task ID is unknown, call `loadTasks()` for a full refresh
- This gives instant UI updates for known tasks while staying consistent for new tasks

### Rendering Pipeline

1. `renderBoard()` is the single entry point for all UI updates
2. Builds `filteredTasks` from current filter state (text, status, priority, category)
3. Groups tasks by status column (cancelled → failed column)
4. Sorts each column by priority desc, then creation time asc
5. Renders cards with: ID, priority badge, description, worker badge, category, deps count, time, actions
6. Updates progress bar (all tasks, not filtered)
7. Updates category dropdown options
8. Cleans up stale selections
9. If in DAG view, calls `loadGraph()` → `GET /api/coordination/graph` → `renderDAG()`

### DAG Rendering

- Nodes positioned by topological level (x) and index within level (y)
- Bezier curve edges with arrowhead markers
- Status-colored nodes and completion-aware edge styling
- Edit mode (Phase 53): click-to-add-dependency, click-to-remove-edge
- SVG rendered inline in `#dag-container`

### Key UI Features

- **Drag-and-drop:** Cards can be dragged to failed (cancel) or pending (retry) columns
- **Batch operations:** Multi-select with checkboxes → batch cancel/retry via `/api/bulk/tasks/*`
- **Detail dialog:** Click card → modal with all fields, editable for pending/assigned tasks
- **Dependency editing:** In detail dialog, dep chips with remove buttons + autocomplete add
- **Templates:** Load predefined DAG workflows from `/api/coordination/templates`
- **Category auto-detect:** On task description blur, calls `/api/coordination/categories/detect`
- **Keyboard shortcuts:** ?, n, /, Esc, 1-5, a, d, r, g, k, t, e
- **Export:** Tasks exportable in multiple formats via `/api/export/tasks`

### Bug: Status Mismatch in Terminal Task Events

**File:** `taskboard.js:1557`

```js
if (ev === 'claude-terminal:task-assigned') {
  tasks[data.taskId].status = 'in-progress';  // BUG: should be 'running'
```

The task queue uses `'running'` as the status, but the taskboard sets `'in-progress'` which doesn't match any Kanban column. This task card would not appear in any column after a `claude-terminal:task-assigned` event until the next full `loadTasks()` refresh.

**Fix:** Change `'in-progress'` to `'running'` (or `'assigned'` depending on desired granularity).

---

## 5. Implementation Proposals

### Proposal A: Make Task Board Work by Default (Priority: Critical)

**Goal:** Eliminate the "pool mode required" error for the common Master Console use case.

**Change 1:** In `server.mjs:288`, enable coordinator when claudePool is active:
```js
const needsCoordinator = (pool && options.coordination !== false)
  || options.swarm
  || options.claudePool;
```

**Change 2:** When coordinator is created for claudePool-only mode (no pool, no swarm), use null pool stub and persist path:
```js
if (needsCoordinator) {
  const coordPool = pool || createNullPool();
  const coordOpts = typeof options.coordination === 'object' ? options.coordination : {};
  if ((options.swarm || options.claudePool) && !coordOpts.persistPath) {
    coordOpts.persistPath = join(operatorDir, '.data', 'task-queue.json');
  }
  // ... rest of coordinator setup
}
```

**Impact:** Task board, task APIs, and auto-dispatch all work without needing `--swarm` flag.

### Proposal B: Fix Status Mismatch Bug (Priority: High)

**File:** `taskboard.js:1557`

Change:
```js
tasks[data.taskId].status = 'in-progress';
```
To:
```js
tasks[data.taskId].status = 'running';
```

### Proposal C: Bridge Coordinator Events for Claude Workers (Priority: Medium)

**Goal:** Make coordinator metrics and events reflect Claude terminal worker activity.

In `claude-pool.mjs`, when a task is claimed via `findNextClaimableTask()`:
```js
// After taskQueue.assign() and taskQueue.start()
if (events) {
  events.emit('coord:assigned', {
    taskId: task.id,
    workerId: terminalId,
    strategy: 'claude-pool-affinity',
    category: task.category,
  });
}
```

On task completion, emit through coordinator's handler:
```js
// In complete-task flow, also emit coord:complete
events.emit('coord:complete', { workerId: terminalId, taskId, result });
```

This would make coordinator metrics (throughput, utilization, completion time) accurate for Claude worker tasks.

### Proposal D: Auto-Start Coordinator on First Task Creation (Priority: Low)

Currently the coordinator must be manually started via `POST /api/coordination/start` before tasks will auto-dispatch. The coordinator starts in `'init'` state and won't assign tasks until `start()` is called.

**Option 1:** Auto-start on first `addTask()` call
**Option 2:** Auto-start when first Claude terminal is spawned with `autoDispatch: true`
**Option 3:** Add a "Start Coordinator" button to the task board UI (currently only status badge is shown)

Note: The `findNextClaimableTask()` in claude-pool.mjs bypasses the coordinator's state check — it directly queries the task queue regardless of coordinator state. So auto-dispatch works even when coordinator is in `'init'` state. But the work assigner's `assignAll()` (called on `addTask()`) checks `if (state === 'running')` and won't trigger unless coordinator is started.

### Proposal E: Task Board Error State UX (Priority: Low)

Show a clear error message when coordination is unavailable instead of a silent empty board.

In `taskboard.js`, enhance the `loadTasks` error handler:
```js
.catch(function (err) {
  tasks = {};
  renderBoard();
  if (boardEmpty) {
    boardEmpty.innerHTML =
      '<h3>Task Board Unavailable</h3>' +
      '<p>The coordination system is not running. Start the server with:</p>' +
      '<code>node operator/server.mjs --swarm</code>';
    boardEmpty.style.display = '';
  }
});
```

---

## 6. Summary of Findings

| Finding | Severity | Fix Effort |
|---------|----------|------------|
| Coordinator null without `--pool`/`--swarm` | Critical | Small — change `needsCoordinator` condition |
| `'in-progress'` status mismatch in taskboard.js | High | Trivial — one-line fix |
| Coordinator events not emitted for Claude worker tasks | Medium | Small — add event emissions in claude-pool |
| Coordinator not auto-started | Low | Small — auto-start on first task or terminal |
| Silent error state on task board | Low | Small — add error banner |
| Work assigner unused in swarm mode | Info | By design — Claude pool has its own affinity-based assignment |

### Quick Start for Master Console

To get the full task board + worker integration working today:

```bash
# Start server with swarm mode
node operator/server.mjs --swarm

# Then in the browser:
# 1. Go to /taskboard.html
# 2. Start coordinator: POST /api/coordination/start (or use terminals page)
# 3. Add tasks via task board UI
# 4. Spawn Claude terminals with autoDispatch enabled
# 5. Workers will auto-claim and drain tasks
```
