# Session 48 Handoff — Orchestrator v9: Streaming Agent Pipeline

## Summary
Replaced the orchestrator's batch execution model with a streaming agent pool and pipelined sim execution. This eliminates idle time between agents and overlaps I/O-bound work (sims) with compute-bound work (agents, tests). Estimated ~24% faster per round, ~90 min saved over a 21-round overnight run.

## What Changed

### `orchestrator/orchestrator.mjs` (3105 → 3134 lines, +29 net)

**1. `runAgentPool()` — replaces `runAgentsWithConcurrency()`**
- Queue-drain pool pattern: launches up to `maxConcurrency` agents
- As each finishes, fires `onAgentComplete` callback immediately, launches next from queue
- Results in completion order (not submission order) — all downstream consumers verified order-independent
- Single-agent case degenerates to simple runAgent + callback (no behavioral change)

**2. `processAgentResult()` — extracted from duplicated Phase A/B blocks**
- Handles: logging, roundAgents tracking, lastRunRound, cost accumulation, empty-work detection, model escalation triggers
- Takes `ctx` parameter (`{ lastRunRound, consecutiveEmptyRounds, consecutiveAgentFailures }`) to access main()-scoped tracking objects
- Eliminates ~30 lines of duplicated code

**3. Pre-sim pipelined with Phase A**
- `runBalanceSims(round, 'pre')` runs concurrently with `runAgentPool()` via `Promise.all`
- Safe: pre-sim writes to `balance-data/` JSON, agents read source code — no file conflicts
- Saves ~45s/round (sim hidden behind agent execution)

**4. Post-sim pipelined with tests**
- `runBalanceSims(round, 'post')` runs concurrently with `runTests()` via `Promise.all`
- Optimistic execution: always launches post-sim, discards results if tests fail + revert
- Saves ~45s/round (sim hidden behind test execution)

**5. Updated timing schema**
- `roundTiming.sims` → split into `roundTiming.preSim` + `roundTiming.postSim`
- Both are concurrent (subsumed into phaseA/tests wall-clock), tracked for visibility
- Overhead formula: `total - phaseA - phaseB - tests` (sims no longer serial)
- `runBalanceSims()` now returns top-level `elapsedMs`

**6. Updated overnight report**
- Timeline table: `Sims` column → `Pre-Sim` + `Post-Sim` columns
- Backwards-compatible with old v8 round logs (falls back to `t.sims` field)

## Bug Found & Fixed During Verification

**`ReferenceError: lastRunRound is not defined`** — `processAgentResult()` was initially defined at module scope but referenced `lastRunRound`, `consecutiveEmptyRounds`, and `consecutiveAgentFailures` which are `const` inside `main()`. Fixed by passing a `trackingCtx` object by reference.

## Verification

### Run 1: Balance-tuning mission (3 agents)
- Crashed on Round 1 with `lastRunRound` scoping bug → diagnosed, fixed

### Run 2: Balance-tuning mission (3 agents, after fix)
- 7 rounds, zero crashes
- `processAgentResult` with `trackingCtx` working correctly
- Single-agent pool degenerate case verified

### Run 3: Overnight mission (7 agents, maxConcurrency=4)
- 5 rounds, zero crashes
- **Round 1**: 2 concurrent Phase B agents (producer + reviewer), completion-order callbacks verified (reviewer 3.7m first, producer 4.4m second)
- **Round 2**: Single code agent (ui-dev) → tests passed
- **Round 3**: Full pipeline — Phase A (ui-dev 3.2m) → tests → Phase B (producer 1.8m + reviewer 3.2m concurrent)
- **Round 4**: All idle, correctly skipped
- **Round 5**: 2 concurrent Phase B agents (reviewer + designer)

### All 908 tests passing throughout.

## Commits
- `d5aaddd` — `feat(orchestrator): streaming agent pool + pipelined sims (v9)` (pushed to origin/master)

## What's NOT Yet Tested
- Pre-sim + Phase A concurrent pipeline (requires balance-tuning mission with active code agents + sim config)
- Post-sim + test concurrent pipeline (same — needs sims enabled + code agent changes)
- Multi-agent code pool (>1 Phase A agents running simultaneously)
- Test regression → revert → post-sim discard path

These paths are structurally correct but weren't exercised because the overnight mission had no balance sims configured and only 1 code agent was active at a time.

## Next Steps (from Efficiency Roadmap)
1. **Priority-based scheduling** (Phase 1.2) — fast-track P1 regressions/test fixes
2. **Adaptive timeouts** (Phase 1.3) — track per-agent avg runtime, set timeout to 2x average
3. **Context-aware prompt trimming** (Phase 2.4) — only inject sections an agent needs
4. **Task decomposition** (Phase 2.5) — break large tasks into focused 5-min subtasks
5. **Incremental testing** (Phase 2.6) — detect which files changed, run affected suites only

## Files Modified
- `orchestrator/orchestrator.mjs` — streaming pool, pipelined sims, processAgentResult extraction
