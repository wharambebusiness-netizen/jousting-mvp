# Next Session Instructions — Orchestrator v10+ Efficiency

## Context
The orchestrator (v10, `jousting-mvp/orchestrator/orchestrator.mjs`, 3311 lines) now has:
- **v9**: Streaming agent pool (`runAgentPool`), pipelined sims
- **v10**: Adaptive per-agent timeouts, multi-round lookahead, incremental testing

Read `jousting-handoff-s49.md` for what was just done.
Read `MEMORY.md` for full project context and the efficiency roadmap.

## Completed Items (don't redo these)
- ~~Streaming agent pipeline~~ (S48/v9)
- ~~Adaptive timeouts~~ (S49/v10)
- ~~Multi-round lookahead~~ (S49/v10)
- ~~Incremental testing~~ (S49/v10)
- ~~Smart per-agent revert~~ (S47/v8)

## High-Impact Items (pick 2-3 per session)

### 1. Priority-Based Scheduling (Phase 1.2 — fast-track critical work)
**Problem**: All active agents run at equal priority. A P1 regression fix competes with a P4 polish task for the same concurrency slot.
**Solution**: Sort agent queue by task priority before feeding to `runAgentPool()`.

Implementation:
- Before passing agents to `runAgentPool()`, sort by highest-priority pending task
- In Phase A, code agents with P1 tasks should get first concurrency slots
- Consider splitting the pool: P1-P2 tasks get immediate launch, P3-P4 wait if resources constrained
- This interacts with `runAgentPool()`'s queue order — just sorting the input array before calling it

### 2. Context-Aware Prompt Trimming (Phase 2.4 — saves tokens + cost)
**Problem**: Every agent gets shared rules, and `CLAUDE.md` (injected by Claude CLI) is ~4000 tokens. A CSS artist doesn't need engine API signatures.
**Solution**: Already partially done (balance context + param search filtered by role). Extend:

- **Shared rules** (`_common-rules.md`): Injected to ALL agents (line ~785). Consider splitting into "core rules" (all agents) and "engine rules" (engine agents only)
- **New opportunity**: Create a minimal `CLAUDE-agent.md` for non-engine agents, or add a `claudeMdOverride` field to agent config that tells Claude CLI to use a different CLAUDE.md
- **Measure first**: Log prompt tokens per agent per round. Identify which agents get bloated prompts. Target the biggest offenders.

### 3. Task Decomposition (Phase 2.5 — more tasks completed per round)
**Problem**: Agents get 20-min open-ended runs. A 3-min task wastes 17 min of context window.
**Solution**: Break large backlog tasks into smaller subtasks (5 min each).

Implementation:
- Producer agent could generate subtasks instead of monolithic tasks
- Or: orchestrator decomposes tasks before assignment (harder — needs task understanding)
- Simpler approach: add `maxRuntimeMinutes` to backlog tasks, set per-agent timeout per-task instead of per-agent
- Works well with adaptive timeouts (history builds up, timeout shrinks to match actual work)

### 4. Unified Agent Pool (Phase 3.5 — eliminates Phase A/B barrier)
**Problem**: Phase A (code agents) must ALL finish before Phase B (coordination agents) start.
**Why it exists**: Coordination agents need to see fresh handoffs. Tests must run between code/coordination.
**Solution**: Keep the test barrier but let coordination agents start as soon as tests pass.

This is complex — the Phase A/B split is clean and correct. Only pursue if overnight runs show significant Phase B idle time.

### 5. Live Progress Dashboard (Phase 4.10)
**Problem**: Orchestrator output is just sequential log lines. Hard to see real-time status at a glance.
**Solution**: Add a periodic status line showing: `[R3] Agent: producer(2.1m) qa(idle) balance-tuner(running 4.5m)...`

## Architecture Notes for Implementation

### Where things live in `orchestrator.mjs` (v10, 3311 lines):
- **Adaptive timeouts**: `agentRuntimeHistory`, `recordAgentRuntime()`, `getAdaptiveTimeout()` at line ~1962
- **Agent pool**: `runAgentPool()` at line ~1994 — queue-drain pattern
- **Result processing**: `processAgentResult()` at line ~2028 — per-agent callback, returns `{ status, isEmptyWork, filesModified }`
- **Incremental testing**: `SOURCE_TO_TESTS`, `getTestFilter()` at line ~2050, `runTests(testFilter)` at line ~2110
- **Multi-round lookahead**: inside main loop at "No agents can run" check, line ~2538
- **Agent filtering**: lines ~2490-2570 — work-gating, pre-flight checks
- **Main loop**: lines ~2600-2780 — Phase A → tests → Phase B → overhead
- **Prompt building**: lines ~700-800 — assembles prompt parts per agent
- **Report generation**: lines ~3050-3280 — overnight report with timing table

### Key variables (all inside `main()`):
- `trackingCtx = { lastRunRound, consecutiveEmptyRounds, consecutiveAgentFailures }` — passed to processAgentResult
- `costLog` — per-agent cost accumulation
- `roundLog` — round-by-round timeline for report
- `roundTiming` — `{ roundStart, phaseA, phaseB, tests, preSim, postSim, overhead }`
- `roundModifiedFiles` — collected per-round from processAgentResult callbacks (for incremental testing)

### Testing strategy:
1. `node -c orchestrator/orchestrator.mjs` — syntax check
2. `npx vitest run` — 908 game engine tests (unrelated to orchestrator but must still pass)
3. Run with `balance-tuning.json` (3 agents, fast iteration) to verify changes
4. Run with `overnight.json` (7 agents, maxConcurrency=4) for full pipeline test
5. Check logs for correct timing, no crashes through 3+ rounds

## What NOT to Do
- Don't restructure the Phase A/B split unless you have a concrete case where it causes problems
- Don't add orchestrator unit tests (it's an integration script, test it by running it)
- Don't touch balance config or game engine code — this is orchestrator-only work
- Don't increase complexity beyond what's needed — the orchestrator should stay readable
- Don't break the `processAgentResult` callback pattern — it's the foundation for per-agent streaming
