# Balance Analyst — Handoff

## META
- status: in-progress
- files-modified: src/engine/archetypes.ts, orchestrator/analysis/balance-sim-round-5.md, orchestrator/analysis/balance-tuner-round-1.md, orchestrator/analysis/balance-tuner-round-2.md
- tests-passing: false
- completed-tasks: BL-001, BL-002
- notes-for-others: [BALANCE CHANGE] Technician MOM 55→58 (Round 1). [BALANCE CHANGE] Charger INIT 60→55, STA 60→65 (Round 2). Total ~11 test failures from both changes — test-writer needs to update calculator.test.ts, gigling-gear.test.ts, match.test.ts, playtest.test.ts, and gear-variants.test.ts. See analysis reports for specifics.

## What Was Done

### BL-001: Fix Technician weakness at Epic/Giga tiers (Round 1)

**Change**: Technician momentum 55 → 58 (+3) in `src/engine/archetypes.ts`

**Result**: Technician win rate improved at all tiers (+3.1pp bare, +0.9pp epic, +2.1pp giga)

### BL-002: Investigate Charger weakness at bare tier (Round 2)

**Change**: Charger INIT 60→55, STA 60→65 (budget-neutral redistribution, total stays 300)

**Hypothesis**: Charger's "fades" weakness is caused by STA=60 giving a fatigue threshold of only 48. With Fast speed (-5/pass) and heavy attacks (-10 to -20), Charger hits fatigue degradation by Pass 2-3, losing its MOM=75 advantage too quickly.

**Approaches tested**:
1. INIT→GRD swap (INIT 60→55, GRD 50→55): +1.3pp bare. Rejected — insufficient.
2. MOM→STA swap (MOM 75→70, STA 60→65): +2.8pp bare. Rejected — weakens Charger identity.
3. guardImpactCoeff 0.18→0.16: +2.0pp bare. Rejected — diffuse effect, creates Duelist dominance.
4. **INIT→STA swap (INIT 60→55, STA 60→65): +5.1pp bare. Selected — most effective, identity-preserving.**

**Results across tiers:**
| Tier | Before | After | Δ |
|------|--------|-------|---|
| Bare | 35.9% | 41.0-42.0% | **+5-6pp (target met: ≥40%)** |
| Uncommon | 39.5% | 41.7% | +2.2pp |
| Giga | 47.0% | 46.5% | -0.5pp (noise) |

**Side effects**: Bulwark bare dropped from 62.4% to 60-61%. Spread tightened from 26.5pp to 18-20pp. No new problematic matchups.

## Current Archetype Stats (Post Round 2)

```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   58   70   55    60   55  = 298
bulwark:      55   55   65    53   62  = 290
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   60  = 292
duelist:      60   60   60    60   60  = 300
```

## Test Failures (for test-writer agent)

### From Round 1 (Technician MOM 55→58)
1. **calculator.test.ts**: ~6 tests — effective MOM computations (55+5=60 → now 58+5=63), fatigue calculations
2. **match.test.ts**: 1 test — Charger vs Technician worked example impact score ordering
3. **gear-variants.test.ts**: ~8 tests — BL-004 deterministic cycling tests (N=30, fragile to stat changes)

### From Round 2 (Charger INIT 60→55, STA 60→65)
4. **gigling-gear.test.ts** line 211: INIT assertion `60 + 7 + 3 + 4 + 3 = 77` → should be `55 + 7 + 3 + 4 + 3 = 72`
5. **gigling-gear.test.ts** line 212: STA assertion `60 + 7 + 2 + 3 = 72` → should be `65 + 7 + 2 + 3 = 77`
6. **calculator.test.ts**: Charger initiative assertions (60→55, 60+20=80→75) and fatigue threshold (48→52)
7. **match.test.ts** line 38: `currentStamina).toBe(60)` → should be 65
8. **match.test.ts** lines 81/252: stamina tracking `60-5-20=35` → `65-5-20=40`
9. **playtest.test.ts** line 267: `charger.stamina).toBe(60)` → should be 65
10. **playtest.test.ts** line 309: stamina endurance `60-5-20=35` → `65-5-20=40`

**Total**: ~11 test failures (some overlap between Technician and Charger assertions in calculator.test.ts)

## What's Left

### Future Balance Work
1. **Bulwark bare dominance** (60-62%): Still above 60% target. Consider guardImpactCoeff 0.18→0.16 in a future round.
2. **Charger vs Bulwark** (25-35%): Worst matchup, likely structural. May need Charger-specific mechanic (engine-dev territory).
3. **Technician at uncommon** (45.3%): Borderline, monitor after test stabilization.

### Do NOT Change
- Charger stats — current values achieve the target. Further changes risk oscillation.
- guardImpactCoeff — investigate in a future round as a Bulwark nerf, not now.

## Issues

- gear-variants.test.ts BL-004 tests (N=30, deterministic cycling) are inherently fragile to any balance change. Recommend increasing N or widening thresholds.
- Uncommon tier shows high variance across runs for several archetypes. 200 matches per matchup may be insufficient for stable uncommon readings.

## File Ownership

- `src/engine/balance-config.ts` (shared)
- `src/engine/archetypes.ts` (shared)
- `src/tools/simulate.ts` (primary)
- `orchestrator/analysis/balance-sim-round-*.md` (primary)
- `orchestrator/analysis/balance-tuner-round-*.md` (primary)
