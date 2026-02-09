# Balance Analyst — Round 5 Report

## Executive Summary

Round 5 investigated **BL-020: Bulwark bare/uncommon dominance** by testing `guardImpactCoeff` reductions (0.18→0.17→0.16) and Bulwark stat redistribution (MOM 55→58, CTL 55→52) across 5 rarity tiers. **Key finding: guardImpactCoeff changes are ineffective** — reducing from 0.18 to 0.16 produces <1pp change in Bulwark win rate at bare/uncommon, within Monte Carlo noise. The coefficient is not the right lever for this problem.

**Bulwark stat redistribution (MOM +3, CTL -3)** shows a meaningful **-4.8pp improvement at uncommon** (63.5%→58.7%) but no effect at bare (59.9%→60.4%). The bare tier problem is structural to GRD=65 and cannot be solved by redistributing non-GRD stats.

**Recommendation**: Apply Bulwark stat redistribution (MOM 55→58, CTL 55→52) as a low-risk, test-safe change that fixes uncommon tier. Accept bare ~60% as structural until a guardUnseatDivisor or GRD change is considered. Do NOT change guardImpactCoeff — it's test-locked with no benefit.

---

## Experimental Design

### Variables Tested

| Experiment | guardImpactCoeff | Bulwark MOM | Bulwark CTL | Other |
|------------|-----------------|-------------|-------------|-------|
| **Baseline** | 0.18 | 55 | 55 | Current production |
| **Exp 1**: guardImpactCoeff 0.16 | **0.16** | 55 | 55 | Isolated coefficient change |
| **Exp 2**: guardImpactCoeff 0.17 | **0.17** | 55 | 55 | Intermediate value |
| **Exp 3**: Bulwark stat redistribution | 0.18 | **58** | **52** | Isolated stat change |
| **Exp 4**: Combined | **0.16** | **58** | **52** | Both changes |

Each experiment: 5 tiers × 36 matchups × 200 matches = 36,000 matches. Total: 180,000 matches across 5 experiments.

---

## Part 1: guardImpactCoeff 0.18 → 0.16 (BL-020 Primary Task)

### Bulwark Win Rates Across Tiers

| Tier | Baseline (0.18) | At 0.17 | At 0.16 | Delta (0.18→0.16) |
|------|----------------|---------|---------|-------------------|
| **Bare** | 59.9% | 59.8% | 60.1% | **+0.2pp** (noise) |
| **Uncommon** | 63.5% | 62.1% | 62.7% | **-0.8pp** (noise) |
| **Rare** | 54.4% | — | 54.0% | **-0.4pp** (noise) |
| **Epic** | 48.6% | — | 52.0% | **+3.4pp** (noise/regression) |
| **Giga** | 49.8% | 50.8% | 48.2% | **-1.6pp** (noise) |

### Analysis

**guardImpactCoeff has virtually no effect on Bulwark dominance.** All deltas are within Monte Carlo variance (±3pp at N=200). The theory was that reducing guard's contribution to impact scoring would disproportionately hurt Bulwark (GRD=65), but the data shows this is not the case.

**Why it doesn't work**: The impact formula is `EffMOM * 0.5 + Accuracy * 0.4 - OppGuard * guardImpactCoeff`. Changing guardImpactCoeff from 0.18 to 0.16 reduces Bulwark's defensive advantage by `65 * 0.02 = 1.3` impact points per pass. But this same change also reduces ALL archetypes' guard contribution (average ~55 GRD → loss of `55 * 0.02 = 1.1` for opponents). Net Bulwark-specific delta: only **0.2 impact points per pass**. This is far too small to move win rates meaningfully.

### Duelist Dominance Risk Check (Flagged in Round 2)

| Tier | Baseline Duelist | At 0.16 Duelist | Delta |
|------|-----------------|-----------------|-------|
| Bare | 52.5% | 52.0% | -0.5pp |
| Uncommon | 54.3% | 51.6% | -2.7pp |
| Giga | 51.0% | 51.3% | +0.3pp |

**Duelist does NOT become dominant at 0.16.** The Round 2 concern was unfounded. Duelist is stable across all guardImpactCoeff values.

### Charger Bare Check

| guardImpactCoeff | Charger Bare |
|-----------------|-------------|
| 0.18 | 41.3% |
| 0.17 | 41.2% |
| 0.16 | 40.9% |

Charger bare stays above 40% at all tested values. No regression.

### Conclusion for guardImpactCoeff

**DO NOT CHANGE guardImpactCoeff.** The change:
- Does not fix Bulwark dominance (< 1pp effect)
- Requires updating ~7 test assertions
- Creates zero benefit for significant QA effort
- The test-update work planned in BL-021 is unnecessary

---

## Part 2: Bulwark Stat Redistribution (MOM 55→58, CTL 55→52)

### Hypothesis

Reducing CTL from 55→52 lowers Bulwark's counter bonus (4 + CTL*0.1: 9.5→9.2) and accuracy contribution. Adding MOM 55→58 compensates total budget (stays 290) but MOM is less impactful for a defensive archetype. Net effect: slight offensive weakening without touching GRD (identity) or STA (test-locked).

### Results

| Tier | Baseline | With Redistribution | Delta | Assessment |
|------|----------|-------------------|-------|------------|
| **Bare** | 59.9% | 60.4% | +0.5pp | No change (noise) |
| **Uncommon** | 63.5% | **58.7%** | **-4.8pp** | Significant improvement |
| **Rare** | 54.4% | 54.5% | +0.1pp | No change |
| **Epic** | 48.6% | 51.0% | +2.4pp | No change (noise) |
| **Giga** | 49.8% | 51.8% | +2.0pp | No change (noise) |

### Impact on Other Archetypes (Uncommon Tier)

| Archetype | Baseline | With Redistribution | Delta |
|-----------|----------|-------------------|-------|
| Bulwark | 63.5% | **58.7%** | **-4.8pp** |
| Duelist | 54.3% | 54.9% | +0.6pp |
| Tactician | 52.9% | 54.1% | +1.2pp |
| Charger | 40.6% | 45.7% | **+5.1pp** |
| Breaker | 45.6% | 44.3% | -1.3pp |
| Technician | 43.1% | 42.3% | -0.8pp |
| **Spread** | 22.9pp | **16.4pp** | **-6.5pp improvement** |

### Critical Matchup Improvements (Uncommon)

| Matchup | Baseline | With Redistribution | Delta |
|---------|----------|-------------------|-------|
| Bulwark vs Charger | 76% | **68%** | **-8pp** |
| Bulwark vs Technician | 69% | 68.5% | -0.5pp |
| Bulwark vs Breaker | 67% | 59% | **-8pp** |

### Analysis

The stat redistribution is partially effective:
- **Uncommon: Strong improvement.** Spread drops from 22.9pp to 16.4pp. Bulwark drops from 63.5% to 58.7% — still above 55% target but a meaningful step. Charger recovers from 40.6% to 45.7%.
- **Bare: No improvement.** 60.4% vs 59.9% — within noise. At bare, gear scaling doesn't amplify the stat change, and GRD=65 structural advantage persists.
- **Rare+: Neutral.** No regressions at higher tiers.

### Test Safety

Confirmed: Bulwark MOM and CTL are **NOT test-locked**. Only GRD=65 and STA=62 are hardcoded in test assertions. This change would pass all 647 tests without modification.

---

## Part 3: Combined Approach (Stat Redistribution + guardImpactCoeff 0.16)

### Results

| Tier | Baseline | Combined | Delta |
|------|----------|----------|-------|
| **Bare** | 59.9% | 60.5% | +0.6pp (noise) |
| **Uncommon** | 63.5% | 59.5% | **-4.0pp** |
| **Giga** | 49.8% | 51.0% | +1.2pp (noise) |

### Analysis

The combined approach performs identically to stat redistribution alone at bare (guardImpactCoeff contributes nothing). At uncommon, the combined result (59.5%) is actually slightly worse than stat redistribution alone (58.7%), though within noise. **There is no additive benefit from combining these changes.**

Additionally, the combined approach creates a **new Duelist flag** at uncommon (55.3%), suggesting the coefficient change has unpredictable secondary effects.

**Verdict**: The combined approach adds complexity and test risk with no additional benefit. Reject.

---

## Part 4: Win Rate Comparison Summary

### All Experiments — Bulwark Win Rates

| Tier | Baseline | coeff=0.17 | coeff=0.16 | Stat Redist | Combined |
|------|----------|------------|------------|-------------|----------|
| Bare | 59.9% | 59.8% | 60.1% | 60.4% | 60.5% |
| Uncommon | 63.5% | 62.1% | 62.7% | **58.7%** | 59.5% |
| Rare | 54.4% | — | 54.0% | 54.5% | — |
| Epic | 48.6% | — | 52.0% | 51.0% | — |
| Giga | 49.8% | 50.8% | 48.2% | 51.8% | 51.0% |

### Overall Archetype Rankings — Baseline vs Best Option (Stat Redistribution)

**Bare Tier:**
| Rank | Baseline | Stat Redistribution |
|------|----------|-------------------|
| 1 | Bulwark 59.9% | Bulwark 60.4% |
| 2 | Duelist 52.5% | Duelist 53.7% |
| 3 | Tactician 51.2% | Tactician 51.1% |
| 4 | Technician 49.1% | Technician 48.3% |
| 5 | Breaker 46.0% | Breaker 46.5% |
| 6 | Charger 41.3% | Charger 40.0% |
| Spread | 18.6pp | 20.4pp |

**Uncommon Tier:**
| Rank | Baseline | Stat Redistribution |
|------|----------|-------------------|
| 1 | Bulwark 63.5% | Bulwark 58.7% |
| 2 | Duelist 54.3% | Duelist 54.9% |
| 3 | Tactician 52.9% | Tactician 54.1% |
| 4 | Breaker 45.6% | Charger 45.7% |
| 5 | Technician 43.1% | Breaker 44.3% |
| 6 | Charger 40.6% | Technician 42.3% |
| Spread | 22.9pp | **16.4pp** |
| Flags | Bulwark DOM, Tech/Charger WEAK | Bulwark DOM, Tech WEAK |

---

## Part 5: Structural Analysis — Why Bare Is Intractable

Bulwark's bare dominance (~60%) is driven by three GRD=65 mechanisms:

1. **Impact subtraction**: -guard × 0.18. Delta vs average (55): 1.8 impact/pass × 5 passes = ~9 cumulative
2. **Unseat resistance**: guard/15. Bulwark: 4.33, Average: 3.67. Delta: 0.67 threshold
3. **Guard fatigue floor**: guard × 0.5 at zero stamina. Bulwark: 32.5, Average: 27.5. Delta: 5

These mechanisms are multiplicative across the match. Reducing guardImpactCoeff from 0.18→0.16 only affects mechanism #1 by `65*0.02 = 1.3` impact points — but ALL opponents also lose `~55*0.02 = 1.1`, so Bulwark's net advantage only drops by 0.2 points per pass. This is negligible.

To fix bare, you need to either:
- **Reduce GRD=65** directly (test-locked, identity change)
- **Change guardUnseatDivisor** (15→18 or 20, test-locked, affects all high-GRD archetypes)
- **Add a Bulwark-specific mechanic** (e.g., GRD decay per pass, conditional guard cap)
- **Accept bare ~60% as structural** and focus on uncommon+ where gear enables counterplay

---

## Part 6: Recommendations

### Immediate (This Session)

1. **Apply Bulwark stat redistribution**: MOM 55→58, CTL 55→52, total stays 290
   - Fixes uncommon from 63.5% → 58.7% (-4.8pp)
   - Zero test breakage (confirmed: MOM and CTL not test-locked)
   - Low risk: preserves GRD=65 identity, keeps total ≥290
   - Does NOT fix bare tier (accept as structural limitation)

### Cancel

2. **Do NOT change guardImpactCoeff** — data proves it's ineffective (<1pp impact)
   - BL-021 (QA test mapping for guardImpactCoeff) can be deprioritized
   - Save QA effort for higher-value changes

### Future Rounds

3. **Bare tier fix requires formula/mechanic change**:
   - Option A: `guardUnseatDivisor` 15→18 (reduces guard's unseat protection by 20%). Test-locked (~3 assertions). Most targeted.
   - Option B: Guard decay per pass (new mechanic: guard loses 1-2 effective points per pass, penalizing high-GRD more). Engine change, needs engine-dev.
   - Option C: Accept bare ~60% as "strong archetype" and focus balance effort on uncommon+ tiers where most gameplay occurs (gear is always present in production).

4. **Monitor Technician** at uncommon (42.3% with stat redistribution). If Bulwark drops further, Technician may recover. If not, Technician MOM 58→61 is a candidate for Round 6.

---

## Changes Made This Round

**None.** This round was analysis-only per BL-020 instructions ("Do NOT apply the change to balance-config.ts yet"). All experimental modifications were reverted. Tests confirmed passing at 647/647.

## Files Modified

- `src/engine/balance-config.ts` — temporarily modified for experiments, **reverted to original**
- `src/engine/archetypes.ts` — temporarily modified for experiments, **reverted to original**
- `orchestrator/analysis/balance-tuner-round-5.md` — this report (new file)
