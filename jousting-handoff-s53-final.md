# Session 53 Final Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (3987 lines)
```

Read these files first:
1. `CLAUDE.md` — project reference (226 lines), architecture, API, gotchas
2. This handoff — current state and next steps

## Current State

### Codebase
- **Branch**: master, clean working tree (only `orchestrator/overnight-report.md` modified — ignore it)
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

Tier progression intact: 5.8 → 4.5 → 3.8 (balance improves with gear rarity).

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

### Orchestrator v15 (3987 lines)
Fully featured multi-agent development system. Efficiency roadmap 100% complete (12/12 items).

Key features:
- Streaming agent pool with adaptive timeouts
- Priority-based scheduling (P1 fast-path)
- Task decomposition with subtask support
- Live progress dashboard (ANSI terminal)
- Pipelined sims, parallel Phase B, incremental testing
- Smart per-agent revert, model escalation, experiment logging
- Dynamic concurrency, agent effectiveness tracking, quality reports

### Simulation Tools
- **simulate.ts** (837 lines): Balance sim CLI with `--json`, `--matches N`, `--override`, `--summary`, `--tiers`
- **param-search.ts** (686 lines): Parameter optimization with sweep/descent strategies, noise floor estimation
- Both support archetype stat overrides (`--override archetype.breaker.stamina=65`)

## Key Files

| File | Purpose |
|------|---------|
| `src/engine/archetypes.ts` | 6 archetype definitions |
| `src/engine/balance-config.ts` | ALL tuning constants |
| `src/engine/calculator.ts` | Core math (softCap, fatigue, impact, guard, unseat) |
| `src/engine/phase-joust.ts` | Joust pass resolution |
| `src/engine/phase-melee.ts` | Melee round resolution |
| `src/engine/match.ts` | State machine (createMatch, submitJoustPass, submitMeleeRound) |
| `src/tools/simulate.ts` | Balance simulation CLI |
| `src/tools/param-search.ts` | Parameter search framework |
| `orchestrator/orchestrator.mjs` | Multi-agent orchestrator (v15) |
| `orchestrator/backlog.json` | Dynamic task queue |
| `orchestrator/missions/*.json` | Mission configs |
| `orchestrator/roles/*.md` | 8 agent role templates |
| `orchestrator/search-configs/*.json` | 6 param search configs |
| `CLAUDE.md` | Project reference doc |

## What Was Done in S52-S53

### S52: Orchestrator v15 + Balance Tuning
- **Orchestrator v14→v15** (+216 lines): priority scheduling, task decomposition, live dashboard
- **Balance tuning**: breaker STA 60→62, bulwark GRD 65→64 → ALL ZERO FLAGS
- 5 test value updates for changed stats

### S53: Simulation Tool Enhancements
- **simulate.ts** (+209 lines): archetype stat overrides, `--summary` mode, `--tiers` custom selection
- **param-search.ts** (+42 lines): archetype param support, `--with-summary` flag
- **CLAUDE.md**: fixed stale softCap K=50→K=55, added new CLI examples
- **archetype-tuning.json**: new search config for stat sweeps
- High-precision N=500 validation confirming all zero flags

## Potential Next Steps

1. **Run overnight autonomous session** — exercise v15 features with a real multi-agent run. Use `powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1`
2. **Run archetype-tuning search** — `npx tsx src/tools/param-search.ts orchestrator/search-configs/archetype-tuning.json` to systematically optimize stats further
3. **Agent context persistence** — the last remaining bottleneck: each agent is a fresh CLI process every round, re-reads everything from scratch. Caching agent state between rounds could significantly reduce overhead.
4. **Full cross-phase agent pool** — eliminate the Phase A/B barrier entirely (advanced optimization)
5. **UI polish / new game features** — the engine and orchestrator are mature; could shift focus to gameplay
6. **Variant-specific balance tuning** — aggressive/defensive variants could be tightened (currently 3-7pp spread)
7. **Gigaverse integration** — currently tabled, but engine is ready

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg; Port de Lance beats Coup en Passant
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg
- `createMatch()` takes 6 args: arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?
- `applyPlayerLoadout` does NOT add rarity bonus (mount-only feature)
- Breaker detection via `archetype.id` in phase-joust.ts and phase-melee.ts
- Balanced gear variant must match legacy GEAR_SLOT_STATS exactly
- softCap knee=100, K=55 (was 50 before S45); at Giga only Bulwark GRD crosses knee
- Uncommon rarity bonus = 2 (not 1)
- Param search noise: at N=200, score noise ≈ ±0.84. Use baselineRuns≥3 and ignore deltas < noiseFloor

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
