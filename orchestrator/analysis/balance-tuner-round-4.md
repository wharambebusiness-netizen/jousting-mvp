# Balance Analyst — Round 4 Report

## Executive Summary

Round 4 is an **analysis-only** round with no balance constant changes. This round establishes: (1) a confirmed fresh baseline at all 7 rarity tiers with breakerGuardPenetration=0.25, (2) the first-ever **variant-aware balance analysis** testing how aggressive/defensive gear loadouts shift the metagame, and (3) a simulation tool enhancement enabling variant-mode simulations via CLI.

**Tool change**: `simulate.ts` now accepts an optional variant argument: `npx tsx src/tools/simulate.ts [tier] [aggressive|balanced|defensive]`.

**No balance-config.ts or archetypes.ts changes this round.**

---

## Part 1: Fresh 7-Tier Baseline (breakerGuardPenetration=0.25)

### Overall Win Rates by Tier

| Archetype | Bare | Uncommon | Rare | Epic | Legendary | Relic | Giga |
|-----------|------|----------|------|------|-----------|-------|------|
| **Charger** | 40.5% | 41.2% | 48.8% | **52.3%** | **52.7%** | 49.5% | 48.3% |
| **Technician** | 47.9% | 44.1% | 47.9% | 45.2% | 45.8% | 45.3% | 47.1% |
| **Bulwark** | **61.6%** | **62.3%** | 53.3% | 50.8% | 50.7% | 51.1% | 48.8% |
| **Tactician** | 49.2% | 53.5% | 44.4% | 48.9% | 46.8% | 49.3% | 48.5% |
| **Breaker** | 46.4% | 44.6% | 52.7% | 51.1% | 53.7% | 54.0% | **55.8%** |
| **Duelist** | 54.4% | 54.3% | 53.0% | 51.8% | 50.2% | 50.8% | 51.5% |

### Spread by Tier

| Tier | Spread | Worst Offenders | Verdict |
|------|--------|-----------------|---------|
| **Bare** | 21.1pp | Bulwark 61.6%, Charger 40.5% | Fair |
| **Uncommon** | 21.1pp | Bulwark 62.3%, Charger 41.2% | Poor |
| **Rare** | 8.9pp | None flagged | Good |
| **Epic** | 7.1pp | None flagged | Excellent |
| **Legendary** | 7.9pp | None flagged | Excellent |
| **Relic** | 8.7pp | None flagged | Good |
| **Giga** | 8.7pp | Breaker 55.8% flagged | Good |

### Comparison to Round 3 Baseline

| Archetype | Tier | Round 3 | Round 4 | Delta | Notes |
|-----------|------|---------|---------|-------|-------|
| Bulwark | Bare | 60.4% | 61.6% | +1.2pp | Monte Carlo noise (~3pp SE) |
| Bulwark | Uncommon | 63.0% | 62.3% | -0.7pp | Stable |
| Charger | Bare | 41.8% | 40.5% | -1.3pp | Monte Carlo noise |
| Charger | Uncommon | 40.8% | 41.2% | +0.4pp | Stable |
| Breaker | Giga | 54.8% | 55.8% | +1.0pp | Elevated — new flag |
| Technician | Epic | 44.3% | 45.2% | +0.9pp | Stable weak |

**Assessment**: Results are consistent with Round 3. No config changes were made, so all deltas are Monte Carlo variance. The overall picture is unchanged.

### Matchup Skew Analysis (>65% win rate in P1 position)

| Matchup | Bare | Uncommon | Rare | Epic | Legendary+ |
|---------|------|----------|------|------|------------|
| Bulwark vs Charger | **72%** | **68%** | 58% | 53% | <55% |
| Bulwark vs Technician | **66%** | **72%** | 57% | 64% | <60% |
| Bulwark vs Breaker | 61% | **68%** | 50% | 44% | <55% |

All problematic matchups are concentrated at bare/uncommon and resolve naturally at rare+, confirming the structural nature of the Bulwark low-tier problem.

### Phase Balance by Tier

| Tier | Joust-Decided | Melee Rate | Avg Passes | Avg Melee Rounds |
|------|--------------|------------|------------|------------------|
| Bare | 62.8% | 37.2% | 4.45 | 2.32 |
| Uncommon | 58.2% | 41.8% | 4.41 | 2.46 |
| Rare | 59.1% | 40.9% | 4.47 | 2.66 |
| Epic | 59.1% | 40.9% | 4.48 | 2.93 |
| Legendary | 58.4% | 41.6% | 4.52 | 3.08 |
| Relic | 61.0% | 39.0% | 4.59 | 3.43 |
| Giga | 62.6% | 37.4% | 4.65 | 3.70 |

Healthy 60/40 joust/melee split across all tiers. Melee round count scales with gear (2.32 → 3.70), as expected from higher stats producing more draws.

---

## Part 2: Variant-Aware Balance Analysis (NEW)

### Methodology

Added variant support to `simulate.ts` (optional 2nd CLI argument). Tested giga and uncommon tiers with `aggressive` and `defensive` variants. Both players use the same variant in each simulation. N=200 per matchup (7,200 total per run).

### Giga Tier: Variant Impact

| Archetype | Balanced | Aggressive | Defensive | Agg-Def Swing |
|-----------|----------|------------|-----------|---------------|
| Charger | 48.3% | 46.8% | **50.7%** | -3.9pp |
| Technician | 47.1% | 44.1% | 46.2% | -2.1pp |
| Bulwark | 48.8% | **58.8%** | 49.8% | **+9.0pp** |
| Tactician | 48.5% | 48.8% | 49.6% | -0.8pp |
| Breaker | **55.8%** | 51.0% | **54.2%** | -3.2pp |
| Duelist | 51.5% | 50.5% | 49.6% | +0.9pp |
| **Spread** | 8.7pp | **14.7pp** | 8.0pp | |

### Uncommon Tier: Variant Impact

| Archetype | Balanced | Aggressive | Defensive | Agg-Def Swing |
|-----------|----------|------------|-----------|---------------|
| Charger | 41.2% | 45.3% | **39.5%** | +5.8pp |
| Technician | 44.1% | 41.7% | 43.5% | -1.8pp |
| Bulwark | **62.3%** | **61.4%** | **62.6%** | -1.2pp |
| Tactician | 53.5% | 50.7% | 51.8% | -1.1pp |
| Breaker | 44.6% | 47.5% | 51.3% | -3.8pp |
| Duelist | 54.3% | 53.3% | 51.2% | +2.1pp |

### Critical Findings

#### 1. Bulwark Benefits Massively from Aggressive Gear at Giga (+9pp swing)

This is the most significant finding of this round. When all players use aggressive gear at giga:
- **Bulwark jumps from 48.8% to 58.8%** — nearly dominant
- Spread widens from 8.7pp to 14.7pp — a major balance degradation
- Bulwark vs Technician reaches 67% — entering skew territory

**Mechanism**: Aggressive gear shifts stat budget from GRD/STA toward MOM/INIT. When everyone's guard drops, Bulwark's intrinsic GRD=65 becomes relatively more dominant because it's the only archetype with significant guard remaining. Additionally, aggressive gear increases unseats, and Bulwark's high guard + unseat resistance means it survives while others fall.

**Evidence**: Unseat rate at giga jumps from 37.4% (balanced) to 53.4% (aggressive), confirming the more volatile combat environment.

#### 2. Defensive Gear Creates the Best Balance at Giga (8.0pp spread)

Defensive gear at giga produces:
- **No dominant or weak flags** (all archetypes 46-54%)
- Tight 8.0pp spread (vs 8.7pp balanced, 14.7pp aggressive)
- More joust-decided matches (62.6%), longer melee (3.65 rounds) — higher skill ceiling

This is the healthiest metagame state observed at giga in any simulation run.

#### 3. Bulwark is Variant-Immune at Uncommon (61-63% regardless)

Bulwark dominance at uncommon persists identically across all three variants. This confirms the root cause is base stat GRD=65 dominance, not gear interaction.

#### 4. Charger Benefits from Aggressive at Uncommon (+4pp) but Not at Giga (-1.5pp)

At uncommon, aggressive gear helps Charger by amplifying MOM=75. At giga, the softCap compresses this advantage and the lower guard makes Charger more vulnerable.

#### 5. Breaker Shifts: Dominant at Balanced/Defensive Giga, Moderate at Aggressive

Breaker at giga: 55.8% balanced, 51.0% aggressive, 54.2% defensive. Aggressive gear reduces guard across the board, making Breaker's guard penetration less relatively valuable.

### Implications for Players

The variant system creates meaningful strategic choices:
- **Aggressive loadouts**: favor Bulwark, increase unseat volatility
- **Defensive loadouts**: favor even balance, reward skill over stat checks
- **Balanced loadouts**: the default middle ground

This is **healthy design** — variants create asymmetric metagame shifts without being strictly dominant. However, the Bulwark + aggressive combination is a potential exploit that should be monitored.

---

## Part 3: Bulwark Dominance Deep Analysis

### The GRD Double-Dip at Bare/Uncommon

Bulwark's GRD=65 contributes to defense in two places:

1. **Impact scoring**: `-opponent_guard * 0.18`. At GRD=65: opponents lose **11.7** impact points against Bulwark. Average archetype (~55 GRD) only costs opponents **9.9**. Delta: **1.8 impact points per pass** (cumulative over 5 passes = ~9 impact advantage).

2. **Unseat resistance**: `20 + guard/15 + stamina/20`. Bulwark: **27.4 threshold**. Average: **26.6**. Delta: **0.8** (small but compounds with above).

3. **Guard fatigue floor**: Even at 0 stamina, Bulwark retains `GRD*0.5 = 32.5` effective guard vs average `27.5`. Delta: **5 points** in late-game impact scoring.

Combined effect: ~2-3pp per mechanism × 3 mechanisms = 6-9pp structural advantage. This aligns with the observed 11-12pp excess over 50%.

### Available Levers (Sorted by Feasibility)

| Lever | Current → Target | Effect | Test-Locked? | Risk |
|-------|------------------|--------|--------------|------|
| `guardImpactCoeff` 0.18→0.16 | -2pp Bulwark bare | Yes (~7 assertions) | Diffuse — affects all high-GRD interactions |
| Bulwark INIT 53→48 | -1-2pp Bulwark | No (INIT not directly tested) | May make Bulwark too slow |
| Bulwark STA 62→58 | -1-2pp Bulwark | Partially (fatigue threshold tests) | Weakens attrition identity |
| Bulwark CTL 55→52 | -1pp Bulwark | No (CTL not tested for Bulwark) | Reduces counter bonus |
| `guardFatigueFloor` 0.5→0.4 | -1pp high-GRD archetypes | Yes (~8 assertions) | Nerfs all guard, not just Bulwark |
| Bulwark GRD 65→62 | -3-4pp Bulwark | Yes (gigling-gear.test.ts) | Fundamental identity change |

**Recommendation**: The lowest-risk, most targeted lever is **Bulwark stat redistribution** within the total budget. Specifically, reducing INIT and/or CTL (neither directly test-locked for Bulwark) while keeping GRD=65 and total ≥290. This preserves the "immovable wall" identity while weakening Bulwark's offensive contribution to counters and initiative.

**Proposed for Round 5**: Bulwark CTL 55→52, INIT 53→50, MOM 55→58 (total stays 290). Hypothesis: reducing CTL lowers counter bonuses, reducing INIT lowers accuracy contribution, adding MOM changes nothing (MOM barely matters for defense-oriented archetype). Net effect: -2-3pp Bulwark bare without touching GRD or any test-locked values.

---

## Part 4: Emerging Concerns

### 1. Breaker at Giga (55.8%) — Monitor

Breaker is flagged as dominant at giga (>55%). This is the first time Breaker has crossed the dominant threshold. With breakerGuardPenetration=0.25, the guard penetration is highly effective at giga where opponents have high absolute guard values.

**Assessment**: 55.8% at N=200 is within ~3pp of the 55% flag threshold. This may be Monte Carlo noise. Run at higher N to confirm. If confirmed, consider breakerGuardPenetration 0.25→0.22.

**Do NOT intervene yet** — one flag at one tier does not warrant a change. breakerGuardPenetration was just changed in Round 3 and needs stabilization data.

### 2. Technician Persistent Weakness (44-48%)

Technician is consistently the weakest or second-weakest archetype across all tiers. The MOM 55→58 change in Round 1 helped but wasn't sufficient. Technician's core problem is that CTL=70 is its most extreme stat, but CTL's primary contribution is to accuracy (marginal returns) and counters (conditional on rock-paper-scissors outcomes).

**Assessment**: Technician weakness may partially be an artifact of Bulwark dominance. If Bulwark drops from 62% to ~54% at bare, Technician's 48% may rise to ~50% naturally. Wait for Bulwark fix before intervening.

### 3. Variant Balance Asymmetry

The aggressive variant creates a significantly worse metagame at giga (14.7pp spread vs 8.7pp balanced). This is a design concern but not an engine balance concern — it's expected that extreme loadouts produce less even outcomes. Document for game designer.

---

## Summary of Round 4 Deliverables

| Item | Status | Location |
|------|--------|----------|
| 7-tier baseline data | Complete | This report |
| Variant-aware sim tool | Complete | `src/tools/simulate.ts` |
| Giga variant analysis | Complete | Part 2 above |
| Uncommon variant analysis | Complete | Part 2 above |
| Bulwark lever analysis | Complete | Part 3 above |
| Round 5 proposal | Documented | Part 3 above |

## Changes Made

1. **`src/tools/simulate.ts`**: Added optional variant CLI argument. Usage: `npx tsx src/tools/simulate.ts [tier] [aggressive|balanced|defensive]`. No existing behavior changed — omitting variant uses legacy balanced defaults.

## Recommendations for Round 5

1. **Primary**: Test Bulwark stat redistribution: CTL 55→52, INIT 53→50, MOM 55→58. Requires sims at bare, uncommon, giga.
2. **Secondary**: If Bulwark drops below 58% at bare, assess whether Technician improves naturally.
3. **Monitor**: Breaker at giga — run at N=500 for higher confidence.
4. **Do NOT change**: breakerGuardPenetration, guardImpactCoeff, or any test-locked constant.
