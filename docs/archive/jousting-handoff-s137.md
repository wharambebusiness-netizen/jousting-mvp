# Handoff: S137 → S138+

## What was done (S137)

1. **Enhanced space background**: Replaced 80 dot particles with a full space scene — 75 stars, 4 ringed planets, 12 ships (6 types: fighter, cruiser, frigate, scout, bomber, mothership), 5 treasure items (gem/coin/chest), comets (8-30s interval), 1 Dyson sphere superstructure. Ships have chase AI (fighter dogfights, scouts escort mothership). Dual nebula gradients (indigo + emerald).
2. **Blacker backgrounds**: `--bg-root` shifted from `#06061a` to `#030308`. Pico CSS overrides now reference CSS variables (`var(--bg-root)`) instead of hardcoded hex, fixing the blue/black split-page bug.
3. **Settings control center**: Redesigned from 1 flat form into 6 sections: Agent Configuration, Git & Automation, Coordination, UI Preferences, System Info, Danger Zone. Each section loads via its own HTMX fragment (`/views/settings-*`).
4. **New persisted settings**: `particlesEnabled`, `defaultTerminalTheme`, `coordMaxRequestsPerMinute`, `coordMaxTokensPerMinute`, `coordGlobalBudgetUsd`, `coordPerWorkerBudgetUsd`. All coordination fields are always editable (not disabled when coordinator is inactive) — values persist and apply on next coordinator start.
5. **Merge-save pattern**: All settings forms use a merge helper (`mergeSettings()`) that reads existing settings, applies overrides, then saves — prevents partial form submissions from clobbering other fields.
6. **4 new tests**: `settings-git`, `settings-coordination`, `settings-ui`, `settings-system` fragment tests in views.test.mjs.
7. **2526 tests all passing** across 34 suites. Commits: `3f3e8ea` + `57edc20`, pushed to origin/master.

## Architecture notes

- Zero npm frontend deps — all vanilla JS, Pico CSS + HTMX 2.0
- app.js is loaded on every page — shared animation + settings
- style.css uses CSS custom properties in :root[data-theme="dark"]
- Settings persistence: `operator/settings.mjs` with atomic writes
- Tests don't reference visual/color values — safe to change freely
- Server runs at `node operator/server.mjs` on port 3100
- All 6 HTML pages: index.html, terminals.html, taskboard.html, projects.html, settings.html, chain.html
- Terminal themes are in terminals.js lines 45-142

## Test verification

```bash
npm test    # 2526 tests, 34 suites — all must pass
```

---

## Milestones for S138+ (Next Claude Sessions)

Based on comprehensive analysis by 4 research agents exploring UI/UX, architecture, developer workflow, and testing quality, here is the prioritized milestone roadmap:

---

### Phase 16: Test Coverage Foundation (Priority: CRITICAL)

**Goal**: Close the most dangerous test gaps before adding new features.

**Why first**: The system has 2526 tests but critical modules like `operator.mjs` (840 lines, CLI daemon), `ws.mjs` (300 lines, WebSocket bridge), and `settings.mjs` have ZERO tests. Frontend JS (5400+ lines across 3 files) is completely untested. Adding features without this foundation risks silent regressions.

**Tasks**:

1. **Settings persistence tests** (12-15 tests, ~0.5 days)
   - Files: new `operator/__tests__/settings.test.mjs`
   - Test: defaults, roundtrip save/load, value clamping, corrupt JSON recovery, atomic write fallback, new coord* fields
   - Approach: temp directory per test, mock fs failures

2. **WebSocket bridge tests** (20-25 tests, ~1-2 days)
   - Files: new `operator/__tests__/ws.test.mjs`
   - Test: pattern matching (exact, wildcard `*`, overlap), subscription management, event throttling (1s per client), binary WS upgrade for Claude terminals, PTY data flow, control message parsing (`\x01` prefix), WeakMap cleanup
   - Approach: mock WebSocket + EventBus, fake timers

3. **Route endpoint gap tests** (40-50 tests, ~1-2 days)
   - Files: extend `operator/__tests__/server.test.mjs`
   - Test: orchestrator CRUD (start/stop/delete), config hot-reconfiguration, file route edge cases (large files, symlinks, permission errors), git merge conflicts, chain pagination boundaries
   - Approach: extend existing test patterns

4. **Worker IPC unit tests** (15-20 tests, ~1 day)
   - Files: new `operator/__tests__/orchestrator-worker.test.mjs`
   - Test: all 11 message types individually (`coord:proceed`, `coord:wait`, `coord:rate-grant`, `coord:config`, etc.), state transitions (currentTask, budgetExceeded), parent close handling
   - Approach: export handleMessage() for testing, mock orchestrator spawn

**Target**: ~100 new tests → 2626 total

---

### Phase 17: Scalability & Reliability (Priority: HIGH)

**Goal**: Enable 20+ worker scaling and prevent silent task loss.

**Tasks**:

1. **Task orphan detection & requeue** (~100 lines, coordinator.mjs + task-queue.mjs)
   - Track `taskToWorker` bidirectional map
   - On worker exit: find assigned/running tasks → revert to `pending`
   - Max 3 retries per task before `failed`
   - Emit `coord:task-orphaned` event

2. **Staggered heartbeat** (~50 lines, process-pool.mjs)
   - Split workers into K heartbeat buckets (e.g., 5 groups)
   - Stagger pings across ticks to reduce spike load
   - 20 workers → 4 pings per tick instead of 20

3. **IPC message batching** (~80 lines, process-pool.mjs + orchestrator-worker.mjs)
   - Accumulate `worker:log` events for 100ms batches
   - Priority levels: critical (immediate) → normal → batch
   - Reduces EventBus queue depth by 50-70%

4. **Graduated circuit breaker** (~80 lines, process-pool.mjs)
   - Classify errors: transient (network timeout) → 5s cooldown vs fatal (missing file) → 30s
   - Require 2 successful completions to close (not just 1 heartbeat)

5. **Cached worker state** (~120 lines, work-assigner.mjs)
   - Cache `pool.getStatus()` with 500ms TTL
   - Pre-stage task assignments in batches
   - O(N) → O(1) amortized assignment time

**Target**: ~30 new tests for these subsystems

---

### Phase 18: Observability & Monitoring (Priority: HIGH)

**Goal**: Understand what's happening inside the system.

**Tasks**:

1. **E2E task latency tracking** (~100 lines, task-queue.mjs + coordinator.mjs)
   - Add `timing: {addedAt, assignedAt, startedAt, completedAt}` to tasks
   - Compute p50/p95/p99 latencies for queue wait, execution, total
   - Expose via `/api/coordination/metrics`

2. **Cost sparklines on dashboard** (~150 lines, analytics.mjs + index.html + style.css)
   - Tiny 7-day cost trend SVG in cost cards
   - Budget runway indicator ("X days remaining at current burn rate")
   - Model cost breakdown (opus vs sonnet vs haiku)

3. **Per-worker resource metrics** (~100 lines, process-pool.mjs + routes/orchestrator.mjs)
   - Track memory RSS per worker (platform-specific)
   - Add `/api/orchestrator/workers/resource-usage` endpoint
   - Emit `worker:high-memory` if RSS > 500MB

4. **Loading skeleton pulse animation** (~20 lines, style.css)
   - Add subtle pulse keyframe to `.skeleton` class
   - Visual feedback that content is loading vs empty

---

### Phase 19: Developer Workflow (Priority: MEDIUM-HIGH)

**Goal**: Smarter cost management and better chain workflows.

**Tasks**:

1. **Cost-aware model routing** (new `operator/model-router.mjs`)
   - Rule: if tokens < 2K → haiku; 2K-8K → sonnet; >8K → opus
   - Budget check: if spent > 80% of budget → downgrade to cheaper model
   - Chain config: `modelStrategy: 'fixed' | 'adaptive' | 'fallback'`
   - ~150 lines + 20 tests

2. **Chain branching** (extend registry.mjs + routes/chains.mjs)
   - `POST /api/chains/:id/branch` — fork chain at session N
   - Checkpoint labeling: `POST /api/chains/:id/checkpoint`
   - Lineage DAG visualization in chain detail page
   - ~200 lines + 15 tests

3. **Session notes / annotations** (extend registry.mjs + chain.html)
   - `POST /api/chains/:id/notes` — add notes mid-run
   - Display in timeline view
   - "Copy handoff prompt" button for quick context sharing
   - ~100 lines + 10 tests

---

### Phase 20: UI Polish & Accessibility (Priority: MEDIUM)

**Goal**: Professional-grade interface.

**Tasks**:

1. **Global search** (Ctrl+K command palette)
   - Search chains, workers, tasks, files from one modal
   - `/views/global-search-results?q=...` endpoint
   - ~200 lines app.js + 50 lines views.mjs + CSS

2. **Accessibility audit & fixes**
   - Add `aria-live="polite"` to cost cards, status indicators
   - Skip-to-content link (hidden, visible on focus)
   - Text labels on all color-only indicators (status dots)
   - High-contrast mode toggle in UI Preferences
   - `aria-describedby` on form fields

3. **Mobile responsive improvements**
   - Sidebar collapse on <768px
   - Terminal layouts → vertical stacking on mobile
   - Touch-friendly 44px button targets
   - Sticky table headers

4. **Visual polish**
   - Hover states on table rows (currently missing)
   - Card hover elevation (translateY + shadow)
   - Custom scrollbar styling for terminals
   - Dialog backdrop blur

---

### Phase 21: Advanced Coordination (Priority: MEDIUM)

**Goal**: Mission chaining and inter-agent context sharing.

**Tasks**:

1. **Mission dependency graph** (new `operator/mission-dag.mjs`)
   - `depends` + `condition` fields in mission schema
   - Conditional routing: if mission A passes → run B, else → run C
   - 5 built-in mission templates (test-fix-verify, refactor-validate, etc.)

2. **Shared context buffer** (new `operator/shared-context.mjs`)
   - Per-chain shared state: discoveries, patterns, decisions
   - Agents contribute via `<context-discovery>` sections in handoffs
   - Decision log prevents re-debating settled topics
   - 8KB cap with LRU eviction

3. **Notification system** (new `operator/notifier.mjs`)
   - Multi-channel: in-app toast, webhook, Slack
   - Event severity routing (critical → all channels, info → in-app only)
   - Smart batching for non-urgent events

---

### Phase 22: Skill System Evolution (Priority: LOW-MEDIUM)

**Goal**: Skills that compose and evolve.

1. Skill composition framework (`composedOf: [skillId]`)
2. Runtime skill discovery protocol (agent requests → admin review → hot-load)
3. Skill versioning & rollback
4. Skill capability matching by task description

---

## Key files for next sessions

| Area | Key Files |
|------|-----------|
| Space animation | `operator/public/app.js` (lines 716-end) |
| Settings system | `operator/settings.mjs`, `operator/routes/views.mjs` (lines 564-777), `operator/public/settings.html` |
| CSS tokens | `operator/public/style.css` (lines 1-108 tokens, 1175-1340 settings) |
| Coordination | `operator/coordination/coordinator.mjs`, `operator/coordination/task-queue.mjs`, `operator/coordination/work-assigner.mjs` |
| Process pool | `operator/process-pool.mjs` (615 lines) |
| Worker IPC | `operator/orchestrator-worker.mjs` (350 lines) |
| WebSocket | `operator/ws.mjs` (309 lines) |
| Tests | `operator/__tests__/` (12 test files, 1183 operator tests) |
| Frontend JS | `operator/public/app.js` (1310 lines), `terminals.js` (2860 lines), `taskboard.js` (1252 lines) |

## Critical gotchas for next Claude

- **Settings merge pattern**: All settings forms use `mergeSettings()` to read-modify-write. Never PUT partial settings directly.
- **Pico CSS overrides**: Always use `var(--bg-root)` etc. in Pico overrides, not hardcoded hex values.
- **Mock pool needs `activeCount()`**: All mock pools in tests must include `activeCount: () => N`.
- **BRIDGED_EVENTS = 57**: Check `operator/ws.mjs` for the full list before adding new ones.
- **runAgentPool must NOT be async** — pool not awaited.
- **runAgent uses Promise constructor** — use `.then()/.catch()` not `await` inside.
- **publicDir in server.mjs** resolves from `import.meta.dirname` (not operatorDir).
- **createChain in registry.mjs** hard-codes config fields — new fields need explicit spread.
- **Vitest excludes**: `.worktrees/` and `__test_tmp_*/` excluded from test discovery.
