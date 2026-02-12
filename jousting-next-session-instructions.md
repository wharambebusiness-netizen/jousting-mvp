# Next Session Instructions — Orchestrator v10 Efficiency

## Context
The orchestrator (v9, `jousting-mvp/orchestrator/orchestrator.mjs`, 3134 lines) now has a streaming agent pool (`runAgentPool`) that eliminates batch barriers, and pipelined sims that overlap with agent execution. The next improvements should focus on making each round cheaper, faster, and smarter.

Read `jousting-handoff-s48.md` for what was just done.
Read `MEMORY.md` for full project context and the efficiency roadmap.

## High-Impact Items (pick 2-3 per session)

### 1. Incremental Testing (saves ~10s/round, biggest bang for buck)
**Problem**: All 908 tests run after every round even if only one CSS file changed.
**Solution**: Map test files to source files, only run affected suites.

```
calculator.test.ts     ← calculator.ts, balance-config.ts
phase-resolution.test.ts ← phase-joust.ts, phase-melee.ts, calculator.ts
match.test.ts          ← match.ts, phase-joust.ts, phase-melee.ts, calculator.ts
playtest.test.ts       ← *.ts (always run — property-based)
gigling-gear.test.ts   ← gigling-gear.ts
player-gear.test.ts    ← player-gear.ts
gear-variants.test.ts  ← gigling-gear.ts, player-gear.ts, calculator.ts
ai.test.ts             ← src/ai/*.ts
```

Implementation:
- In `processAgentResult`, collect `result.filesModified` (already parsed from handoff META)
- Before `runTests()`, check which files were modified this round
- Build a `--testPathPattern` filter for vitest that only includes affected test files
- Fallback: run all tests if the mapping can't determine affected suites (e.g., types.ts changed)
- Always run full suite on the first round and after any revert

### 2. Adaptive Timeouts (saves stuck-agent waste)
**Problem**: Flat 20-min timeout per agent. Some agents (producer/haiku) finish in 1-2 min, others (balance-tuner/sonnet) take 5-10 min. A stuck agent wastes the full 20 min.
**Solution**: Track per-agent runtime history, set timeout to `max(2 * avgRuntime, minTimeoutMs)`.

Implementation:
- Add `agentRuntimeHistory = {}` (agentId → array of elapsed times, last 5 runs)
- After each `processAgentResult`, push `result.elapsed` to history
- In `runAgent()`, compute timeout as `Math.max(2 * avg(history), agent.timeoutMs * 0.25, 120000)`
- Cap at `agent.timeoutMs` (never exceed configured max)
- Log adapted timeout: `Starting ${agent.id}... (timeout: ${adaptedTimeout}s, avg: ${avg}s)`
- First run uses configured `agent.timeoutMs` as fallback

### 3. Context-Aware Prompt Trimming (saves tokens + cost)
**Problem**: Every agent gets balance context, param search context, shared rules, and role template regardless of relevance. A CSS artist doesn't need balance data.
**Solution**: Already partially done (line 746-747 filters balance context to `BALANCE_AWARE_ROLES`). Extend this pattern:

- **Param search context**: Already filtered to `balance-analyst` only (line 760). Good.
- **Balance context**: Already filtered (line 746). Good.
- **Shared rules** (`_common-rules.md`): Injected to ALL agents (line 773). Consider trimming sections irrelevant to the agent's role.
- **Role template**: Already role-specific. Good.
- **Handoff content**: The full handoff of EVERY other agent is NOT injected (agents only see their own). This is already efficient.
- **New opportunity**: The `CLAUDE.md` file (injected by Claude CLI itself) is ~4000 tokens. Agents that only do CSS or design don't need the full engine API signatures, stat pipeline, gear system docs. Consider creating a minimal `CLAUDE-agent.md` for non-engine agents, or add a `claudeMdOverride` field to agent config.

### 4. Multi-Round Lookahead (saves empty-round overhead)
**Problem**: Rounds 2, 4-6 in the overnight test were empty — all agents idle, no work to do. Each empty round still creates a git tag, checks all agents, and logs output.
**Solution**: After agent filtering, if zero agents are active, skip directly to the next round where an agent would be due (based on `minFrequencyRounds`).

Implementation:
- After the "No agents can run this round" check (line ~2482), instead of `continue`:
- Calculate `nextActivationRound = min(lastRunRound[id] + minFrequencyRounds)` across all agents
- If `nextActivationRound > round + 1`, jump `round` forward: `round = nextActivationRound - 1` (loop increment adds 1)
- Log: `Skipping to round ${nextActivationRound} (next scheduled agent activation)`
- This could skip 5-10 empty rounds per overnight run

### 5. Unified Agent Pool (eliminates Phase A/B barrier)
**Problem**: Phase A (code agents) must ALL finish before Phase B (coordination agents) start. This is the last remaining batch barrier.
**Why it exists**: Coordination agents need to see fresh handoffs from code agents. Tests must run between code changes and coordination review.
**Solution**: Keep the test barrier but allow coordination agents to start as soon as tests pass, without waiting for ALL Phase A results to be processed.

This is more complex and may not be worth it yet — the Phase A/B split is clean and correct. Only pursue if overnight runs show significant Phase B idle time.

## Architecture Notes for Implementation

### Where things live in `orchestrator.mjs`:
- **Agent pool**: `runAgentPool()` at line ~1948 — queue-drain pattern
- **Result processing**: `processAgentResult()` at line ~1982 — per-agent callback
- **Agent filtering**: lines ~2340-2420 — work-gating, pre-flight checks
- **Main loop**: lines ~2450-2630 — Phase A → tests → Phase B → overhead
- **Test runner**: `runTests()` at line ~2008 — spawns `npx vitest run`
- **Prompt building**: lines ~700-790 — assembles prompt parts per agent
- **Report generation**: lines ~2860-3100 — overnight report with timing table

### Key variables (all inside `main()`):
- `trackingCtx = { lastRunRound, consecutiveEmptyRounds, consecutiveAgentFailures }` — passed to processAgentResult
- `costLog` — per-agent cost accumulation
- `roundLog` — round-by-round timeline for report
- `roundTiming` — `{ roundStart, phaseA, phaseB, tests, preSim, postSim, overhead }`

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
- Don't break the `processAgentResult` callback pattern — it's the foundation for future per-agent streaming
