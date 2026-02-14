# Session 56 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (4226 lines)
```

Read these files first:
1. `CLAUDE.md` — project reference (234 lines), architecture, API, gotchas
2. This handoff — current state and next steps

## Current State

### Codebase
- **Branch**: master, working tree has uncommitted S56 changes
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

### Orchestrator v18 (4226 lines)
Fully featured multi-agent development system. All known bottlenecks addressed.

Key features (cumulative):
- **v18: Early test start** — tests begin as soon as code agents finish, while coord agents still run (~1-2min/round savings)
- **v18: All-done exit code (42)** — orchestrator exits with code 42 when all work complete; overnight runner stops gracefully
- **v18: runAgentPool groupIds/groupDone** — fires when a subset of agents (code group) completes
- **v17: Unified agent pool** — code + coordination agents run in a single pool (eliminates Phase A/B barrier)
- **v17: Cost budget enforcement** — agents exceeding `maxBudgetUsd` skipped in pre-flight
- **v17: Stale session invalidation** — proactive cleanup after 5+ empty rounds or 10+ round session age
- **v17: Backlog role matching fix** — `taskMatchesAgent()` accepts agent ID OR role name
- Session continuity (--session-id / --resume), delta prompts, inline handoff injection
- Streaming agent pool with adaptive timeouts, priority-based scheduling (P1 fast-path)
- Task decomposition with subtask support, live progress dashboard
- Pipelined sims, incremental testing, smart per-agent revert
- Model escalation, experiment logging, dynamic concurrency, agent effectiveness tracking

### Simulation Tools
- **simulate.ts** (837 lines): Balance sim CLI with `--json`, `--matches N`, `--override`, `--summary`, `--tiers`
- **param-search.ts** (686 lines): Parameter optimization with sweep/descent strategies, noise floor estimation

## What Was Done in S56

### 1. Early Test Start (v18)
Previously, tests waited until ALL agents (code + coord) finished. Now tests begin as soon as code agents complete:

- Added `groupIds` / `groupDone` to `runAgentPool()` — resolves when all agents in a specified subset finish
- Round execution restructured into 3 phases:
  - **Phase 1**: Await pre-sims + code agent group completion (not full pool)
  - **Phase 2**: Start tests + post-sims immediately (coord agents may still be running)
  - **Phase 3**: Await full pool + tests, then handle revert + coord results
- Savings: ~1-2 minutes per round (test runtime overlaps with coordination agent runtime)

### 2. All-Done Exit Code (42)
At end of `main()`, orchestrator checks `stopReason` for completion cases:
- `'all agents exhausted their task lists'`
- `'all missions in sequence completed'`
- `stopReason.startsWith('balance converged')`
- `stopReason.startsWith('circuit breaker')`

If matched, exits with `process.exit(42)` instead of default 0.

### 3. Overnight Runner v8
- Detects exit code 42: logs "all work complete" and breaks out of restart loop
- Previously would restart every 10 seconds in a tight loop when all agents were done

## Uncommitted Changes

The S56 changes have NOT been committed yet. Files modified:
- `orchestrator/orchestrator.mjs` (v17→v18, 4183→4226 lines)
- `orchestrator/run-overnight.ps1` (v7→v8)
- `CLAUDE.md` (v17→v18 references)
- `jousting-handoff-s55.md` (minor edits from previous session)
- `orchestrator/overnight-report.md` (auto-generated, from S55 overnight run)
- `orchestrator/task-board.md` (auto-generated)

## Backlog (4 pending tasks)
```
BL-077 (P2, qa): Manual QA Testing — requires human tester, not AI-actionable
BL-079 (P1, balance-tuner): Variant-Specific Balance Sweep — run sims for aggressive/defensive variants
BL-080 (P2, qa): Variant Interaction Unit Tests — depends on BL-079
BL-083 (P3, balance-tuner): Legendary/Relic Tier Deep Dive — N=500 ultra-high tier analysis
```

## Potential Next Steps

1. **Commit S56 changes and run overnight** — `powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1`. The backlog role matching fix (S55) + early test start (S56) + all-done exit (S56) should make the overnight run much more productive. BL-079 (P1 variant balance sweep) should finally get picked up.

2. **Run archetype-tuning search** — `npx tsx src/tools/param-search.ts orchestrator/search-configs/archetype-tuning.json`

3. **UI polish / new game features** — engine and orchestrator are mature; could shift focus to gameplay.

4. **Gigaverse integration** — currently tabled, but engine is ready.

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
- **v18 early test start**: tests overlap with coord agents. Revert logic still works correctly — it awaits both pool and tests before checking.
- **v18 exit code 42**: overnight runner v8 detects this and stops. Other exit codes (0 = restart, non-zero = crash + backoff).
- Param search noise: at N=200, score noise ~ +/-0.84. Use baselineRuns>=3 and ignore deltas < noiseFloor

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
