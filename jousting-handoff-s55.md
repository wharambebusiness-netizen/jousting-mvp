# Session 55 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (4176 lines)
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
All tiers and all gear variants have zero balance flags. This is a historic milestone.

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

### Orchestrator v17 (4176 lines)
Fully featured multi-agent development system. All known bottlenecks addressed.

Key features (cumulative):
- **v17 NEW: Unified agent pool** — code + coordination agents run in a single pool (eliminates Phase A/B barrier)
- **v17 NEW: Cost budget enforcement** — agents exceeding `maxBudgetUsd` are skipped in pre-flight checks
- **v17 NEW: Stale session invalidation** — proactive cleanup after 5+ empty rounds or 10+ round session age
- **v17 NEW: Simplified timing** — "agents" column replaces "Phase A" + "Phase B" in overnight report
- Session continuity (--session-id / --resume), delta prompts, inline handoff injection
- Streaming agent pool with adaptive timeouts
- Priority-based scheduling (P1 fast-path)
- Task decomposition with subtask support
- Live progress dashboard (ANSI terminal)
- Pipelined sims, incremental testing
- Smart per-agent revert, model escalation, experiment logging
- Dynamic concurrency, agent effectiveness tracking, quality reports

### Simulation Tools
- **simulate.ts** (837 lines): Balance sim CLI with `--json`, `--matches N`, `--override`, `--summary`, `--tiers`
- **param-search.ts** (686 lines): Parameter optimization with sweep/descent strategies, noise floor estimation
- Both support archetype stat overrides (`--override archetype.breaker.stamina=65`)

## What Was Done in S55

### Orchestrator v17: Unified Agent Pool (+4 lines net, 4172→4176)

**The Problem**: The last major architectural bottleneck — the Phase A/B barrier. Code agents ran in Phase A, then coordination agents ran in Phase B (concurrently with tests). This meant coordination agents waited for ALL code agents to finish before starting. With 3-5 code agents taking 2-8 minutes each and 1-3 coordination agents taking 1-3 minutes, the barrier added ~3 minutes per round of unnecessary wait time.

**The Solution**: Merge all agents into a single unified pool.

1. **Single pool execution**: All active agents (code + coordination) run together in one `runAgentPool()` call. Code agents are sorted first (they take longer), then coordination agents. Both get priority-based ordering within their category.

2. **Result classification in callback**: The `onAgentComplete` callback classifies each result as code or coord based on `CODE_AGENT_ROLES`. Code results collect modified files and balance config changes. Coord results are tracked separately.

3. **Post-pool processing**: After the pool completes:
   - Code agent results are processed (changelog, task completion, ownership validation, escalation)
   - Tests run (if any code agents participated)
   - Smart revert on regression (same as before)
   - Coordination results are processed (or discarded on revert)
   - Balance sims, experiment logging, convergence checks, backlog generation

4. **Three paths → one**: The previous three execution paths (Phase A pool → concurrent Phase B pool, and standalone Phase B pool) are consolidated into a single unified pool call.

**Specific Changes**:
- Replaced `codeAgents`/`coordAgents` separate pools with unified `activeAgents` pool
- `codeAgentIds` Set tracks which agents are code vs coord (for callback classification)
- `codeResults`/`coordResults` arrays populated in callback, processed separately post-pool
- Task board refresh moved to round start (was mid-round between Phase A and B)
- Timing simplified: `roundTiming.agents` replaces separate `.phaseA`/`.phaseB`
- Report table: "Agent Pool" column replaces "Phase A" + "Phase B" columns (backwards compatible with old data)
- Sorting: code agents before coord agents at same priority level (tie-breaker)
- Removed standalone Phase B block entirely (unified pool handles all cases)

**Expected Benefits**:
- ~3 minutes saved per round (coordination agents overlap with code agents instead of waiting)
- Over 20 rounds: ~60 minutes saved per overnight run
- Simpler code: ~70 fewer lines in the round execution block
- One dashboard per round instead of 2-3

### Cost Budget Enforcement (v17)

**The Problem**: `maxBudgetUsd` was passed to the Claude CLI (which may limit individual runs), but the orchestrator never checked cumulative cost before launching an agent. An agent that had already spent its entire budget would still be launched, only to be limited by the CLI.

**The Solution**: Added a pre-flight check in agent selection (before the work-gating and P1 fast-path checks). Checks `costLog[agent.id].totalCost` against `agent.maxBudgetUsd`. Agents over budget are logged and skipped with a clear decision reason.

### Stale Session Invalidation (v17)

**The Problem**: v16 sessions could become stale if an agent went idle for many rounds. The agent's session context would reference old code/state, leading to confused behavior when it eventually reactivated.

**The Solution**: `invalidateStaleSessions(round, consecutiveEmptyRounds)` runs at the start of each round. Two triggers:
1. Agent has 5+ consecutive empty rounds → session invalidated
2. Session is 10+ rounds old (hasn't actively run) → session invalidated

This ensures agents that reactivate after a long idle period get fresh context.

## Key Files

| File | Purpose |
|------|---------|
| `orchestrator/orchestrator.mjs` | Multi-agent orchestrator (v17, 4176 lines) |
| `src/engine/archetypes.ts` | 6 archetype definitions |
| `src/engine/balance-config.ts` | ALL tuning constants |
| `src/engine/calculator.ts` | Core math (softCap, fatigue, impact, guard, unseat) |
| `src/engine/phase-joust.ts` | Joust pass resolution |
| `src/engine/phase-melee.ts` | Melee round resolution |
| `src/engine/match.ts` | State machine (createMatch, submitJoustPass, submitMeleeRound) |
| `src/tools/simulate.ts` | Balance simulation CLI |
| `src/tools/param-search.ts` | Parameter search framework |
| `orchestrator/backlog.json` | Dynamic task queue |
| `orchestrator/missions/*.json` | Mission configs |
| `orchestrator/roles/*.md` | 8 agent role templates |
| `CLAUDE.md` | Project reference doc |

## Potential Next Steps

1. **Run overnight autonomous session** — exercise v17 unified pool with a real multi-agent run. Use `powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1`. The session metrics and timing in the overnight report will show the performance improvements from the unified pool.

2. **Agent result streaming with early test start** — currently tests wait for ALL agents (including coord) to finish. Could add a "group completion" callback to `runAgentPool` that triggers tests as soon as all CODE agents finish, while coord agents are still running. Small additional savings (~1-2 min per round).

3. **Run archetype-tuning search** — `npx tsx src/tools/param-search.ts orchestrator/search-configs/archetype-tuning.json` to systematically optimize archetype stats further.

4. **Variant-specific balance tuning** — aggressive/defensive variants are 3-7pp spread. Could tighten them with variant-aware param search.

5. **UI polish / new game features** — the engine and orchestrator are mature; could shift focus to gameplay.

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
- Param search noise: at N=200, score noise ~ +/-0.84. Use baselineRuns>=3 and ignore deltas < noiseFloor
- **v17 unified pool**: coordination agents now run alongside code agents. Their handoff data may be from the previous round (since code agents haven't written new handoffs yet). This is acceptable — coord agents react to project state, not real-time code changes.
- **v17 cost enforcement**: uses cumulative `costLog` across all rounds, not per-round cost.
- **v17 stale sessions**: invalidated sessions increment the agent's `invalidations` counter for reporting.

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
