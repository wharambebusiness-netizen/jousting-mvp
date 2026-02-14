# Session 55 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (4183 lines)
```

Read these files first:
1. `CLAUDE.md` — project reference (232 lines), architecture, API, gotchas
2. This handoff — current state and next steps

## Current State

### Codebase
- **Branch**: master, clean working tree
- **Tests**: 908/908 passing across 8 suites
- **Engine**: Pure TypeScript, zero UI imports, portable to Unity C#
- **Stack**: Vite + React + TypeScript

### Balance — ALL ZERO FLAGS
All tiers and all gear variants have zero balance flags.

**High-precision validation (N=500, balanced variant):**
| Tier | Spread | Flags | Top | Bottom |
|------|--------|-------|-----|--------|
| Bare | 5.8pp | 0 | technician 53.0% | breaker 47.2% |
| Epic | 4.5pp | 0 | charger 53.0% | tactician 48.5% |
| Giga | 3.8pp | 0 | duelist 51.6% | bulwark 47.8% |

### Current Archetype Stats
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   64   70   55    59   55  = 303
bulwark:      58   52   64    53   62  = 289
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   62  = 294
duelist:      60   60   60    60   60  = 300
```

### Orchestrator v17 (4183 lines)
Fully featured multi-agent development system. All known bottlenecks addressed.

Key features (cumulative):
- **v17: Unified agent pool** — code + coordination agents run in a single pool (eliminates Phase A/B barrier, ~3min/round savings)
- **v17: Cost budget enforcement** — agents exceeding `maxBudgetUsd` skipped in pre-flight
- **v17: Stale session invalidation** — proactive cleanup after 5+ empty rounds or 10+ round session age
- **v17: Backlog role matching fix** — `taskMatchesAgent()` accepts agent ID OR role name (fixes task stalling bug)
- Session continuity (--session-id / --resume), delta prompts, inline handoff injection
- Streaming agent pool with adaptive timeouts, priority-based scheduling (P1 fast-path)
- Task decomposition with subtask support, live progress dashboard
- Pipelined sims, incremental testing, smart per-agent revert
- Model escalation, experiment logging, dynamic concurrency, agent effectiveness tracking

### Simulation Tools
- **simulate.ts** (837 lines): Balance sim CLI with `--json`, `--matches N`, `--override`, `--summary`, `--tiers`
- **param-search.ts** (686 lines): Parameter optimization with sweep/descent strategies, noise floor estimation

## What Was Done in S55

### 1. Orchestrator v17: Unified Agent Pool
Eliminated the Phase A/B barrier. Previously code agents ran in Phase A, then coordination agents ran in Phase B (concurrently with tests). Now ALL agents run in a single pool:
- Three execution paths (Phase A pool, Phase B concurrent, Phase B standalone) consolidated to ONE
- Coordination agents overlap with code agents (~3min savings per round, ~60min per overnight)
- Tests run after pool completes (only if code agents participated)
- Coord results discarded on revert (same safety as before)
- Simplified timing: `roundTiming.agents` replaces `.phaseA`/`.phaseB`
- Report table: "Agent Pool" column replaces "Phase A" + "Phase B"

### 2. Cost Budget Enforcement
Pre-flight check: `costLog[agent.id].totalCost >= agent.maxBudgetUsd` → skip agent. Prevents launching agents that have already consumed their budget.

### 3. Stale Session Invalidation
`invalidateStaleSessions()` at round start: invalidates sessions with 5+ consecutive empty rounds or 10+ round session age. Prevents context drift.

### 4. Backlog Role Matching Fix (CRITICAL BUG FIX)
**The bug**: Producer agents write agent IDs (e.g., `"balance-tuner"`) in backlog task `role` fields, but the orchestrator matched on role names (e.g., `"balance-analyst"`). This caused P1 tasks to stall for 7+ rounds — agents never saw their tasks.

**The fix**: New `taskMatchesAgent(task, role, agentId)` function accepts either format. Updated all 10 call sites: `getNextTasks`, `agentHasBacklogTask`, `agentHasCriticalTask`, `getAgentTaskPriority`, and their callers.

### 5. Overnight Run Results
Ran the overnight session (3 productive runs, 123 rounds). Results:
- Zero crashes, zero test regressions, zero failures
- Session continuity working: reviewer 5.0min (fresh) → 1.4min (resume), designer 2.8min → 0.5min
- Backlog role mismatch bug discovered and fixed (see #4)
- Agent handoffs reset from `all-done` to `complete` for balance-tuner, qa, producer

## Backlog (4 pending tasks)
```
BL-077 (P2, qa): Manual QA Testing — requires human tester, not AI-actionable
BL-079 (P1, balance-tuner): Variant-Specific Balance Sweep — run sims for aggressive/defensive variants
BL-080 (P2, qa): Variant Interaction Unit Tests — depends on BL-079
BL-083 (P3, balance-tuner): Legendary/Relic Tier Deep Dive — N=500 ultra-high tier analysis
```

## Potential Next Steps

1. **Run overnight session with the fix** — the backlog role matching fix means BL-079 (P1 variant balance sweep) will finally be picked up by balance-tuner. Use: `powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1`

2. **Agent result streaming with early test start** — add group completion callback to `runAgentPool` so tests start as soon as all CODE agents finish (while coord agents still run). Small additional savings.

3. **Overnight runner: detect all-done loop** — the runner kept restarting every 10s when all agents were all-done. Should detect this and stop gracefully.

4. **Run archetype-tuning search** — `npx tsx src/tools/param-search.ts orchestrator/search-configs/archetype-tuning.json`

5. **UI polish / new game features** — engine and orchestrator are mature; could shift focus to gameplay.

6. **Gigaverse integration** — currently tabled, but engine is ready.

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg; Port de Lance beats Coup en Passant
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg
- `createMatch()` takes 6 args: arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?
- `applyPlayerLoadout` does NOT add rarity bonus (mount-only feature)
- Breaker detection via `archetype.id` in phase-joust.ts and phase-melee.ts
- Balanced gear variant must match legacy GEAR_SLOT_STATS exactly
- softCap knee=100, K=55; at Giga only Bulwark GRD crosses knee
- Uncommon rarity bonus = 2 (not 1)
- **v17 backlog role matching**: `taskMatchesAgent()` checks both `t.role === agent.role` and `t.role === agent.id`. Producer AI may use either format.
- **v17 unified pool**: coord agents run alongside code agents. Their handoff data is from the previous round.
- Param search noise: at N=200, score noise ~ +/-0.84. Use baselineRuns>=3 and ignore deltas < noiseFloor

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
