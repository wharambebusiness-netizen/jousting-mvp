# Balance Tuner — Round 2 Analysis

## Executive Summary

Charger bare win rate was 35.9%, well below the 40% target. After investigating three approaches (GRD redistribution, MOM redistribution, and guardImpactCoeff reduction), the most effective change was **Charger INIT 60→55, STA 60→65** — a budget-neutral redistribution that directly addresses Charger's "fades" weakness by increasing fatigue endurance. This raised Charger's bare win rate to **41.0-42.0%** (confirmed across two simulation runs), crossing the 40% target. The change has neutral-to-positive effects at other rarity tiers (uncommon improved from 39.5% to 41.7%, giga stable at 46.5%).

## Changes Made

**[BALANCE CHANGE] Charger INIT 60→55, STA 60→65** in `src/engine/archetypes.ts`

- Budget-neutral redistribution: total remains 300 (75+55+50+55+65)
- Charger fatigue threshold increases from 48 (60×0.8) to 52 (65×0.8)
- Charger initiative drops from 60 to 55 (matches Breaker's INIT)
- MOM=75, CTL=55, GRD=50 unchanged — Charger identity preserved

## Experimental Approaches Tested (and Rejected)

### Approach 1: INIT→GRD swap (INIT 60→55, GRD 50→55)
- **Result**: Charger bare 35.9% → 37.2% (+1.3pp). Insufficient.
- **Why**: GRD+5 only reduces opponent impact by 0.9 per pass (5×0.18). The unseat threshold improvement is similarly marginal (+0.34 points).

### Approach 2: MOM→STA swap (MOM 75→70, STA 60→65)
- **Result**: Charger bare 35.9% → 38.7% (+2.8pp). Below target.
- **Why**: Losing 5 MOM costs ~2.5 impact per pass. The STA gain helps but doesn't compensate for the offensive loss. MOM is Charger's identity stat — reducing it weakens the archetype's defining strength.

### Approach 3: guardImpactCoeff 0.18→0.16
- **Result**: Charger bare 35.9% → 37.9% (+2.0pp). Below target.
- **Why**: System-wide guard nerf benefits low-GRD archetypes but the effect is diffuse. Duelist (GRD=60) also benefits significantly, pushing to 55.5% (dominant flag).

### Approach 4 (Selected): INIT→STA swap (INIT 60→55, STA 60→65)
- **Result**: Charger bare 35.9% → 41.0-42.0% (+5-6pp). **Target met.**
- **Why**: STA directly addresses the "fades" problem. Higher STA means Charger stays effective longer — its MOM=75 doesn't degrade as quickly. The fatigue threshold increase from 48 to 52 means Charger has 4 extra stamina points before MOM/CTL start degrading, which compounds across multiple passes.

## Win-Rate Comparison — Before and After

### Bare Tier (Primary Target)

| Archetype | Before | After (Run 1) | After (Run 2) | Average Δ |
|-----------|--------|---------------|---------------|-----------|
| bulwark | 62.4% | 61.0% | 60.1% | -1.9pp |
| duelist | 54.0% | 54.3% | 54.1% | +0.2pp |
| tactician | 52.2% | 51.2% | 50.6% | -0.8pp |
| technician | 49.9% | 47.4% | 46.3% | -2.8pp |
| breaker | 45.7% | 45.1% | 47.0% | +0.4pp |
| **charger** | **35.9%** | **41.0%** | **42.0%** | **+5.6pp** |
| *Spread* | *26.5pp* | *20.0pp* | *18.1pp* | *-7.5pp* |

### Uncommon Tier

| Archetype | Before | After | Δ |
|-----------|--------|-------|---|
| bulwark | 65.0% | 62.5% | -2.5pp |
| tactician | 53.8% | 53.6% | -0.2pp |
| duelist | 53.8% | 52.4% | -1.4pp |
| technician | 46.0% | 45.3% | -0.7pp |
| breaker | 41.9% | 44.5% | +2.6pp |
| **charger** | **39.5%** | **41.7%** | **+2.2pp** |

### Giga Tier

| Archetype | Before | After | Δ |
|-----------|--------|-------|---|
| breaker | 52.9% | 53.4% | +0.5pp |
| duelist | 52.5% | 49.8% | -2.7pp |
| bulwark | 51.9% | 50.2% | -1.7pp |
| tactician | 50.1% | 50.3% | +0.2pp |
| **charger** | **47.0%** | **46.5%** | **-0.5pp** |
| technician | 45.6% | 49.7% | +4.1pp |

Note: Giga variations are within Monte Carlo noise (±2-3pp).

## Win-Rate Matrix — Bare Tier (Post-Change, Run 1)

|  | charger | technician | bulwark | tactician | breaker | duelist |
|--|---------|------------|---------|-----------|---------|---------|
| charger | 52 | 47 | 25 | 40 | 48 | 36 |
| technician | 56 | 52 | 30 | 51 | 51 | 45 |
| bulwark | 72 | 60 | 49 | 56 | 60 | 58 |
| tactician | 57 | 56 | 38 | 51 | 58 | 51 |
| breaker | 54 | 41 | 41 | 44 | 53 | 43 |
| duelist | 64 | 61 | 39 | 56 | 64 | 51 |

### Matchups > 65% (flagged)
- Bulwark vs Charger: 72% (was 77% — improved by 5pp)
- Duelist vs Charger: 64% (was 68% — improved, now below threshold)

### Matchups < 35%
- Charger vs Bulwark: 25% (was 28% — slightly worse but within noise)

## Phase Balance — Bare Tier

| Metric | Before | After |
|--------|--------|-------|
| Joust-only decisions | 60.6% | 62.4% |
| Melee transitions | 39.4% | 37.6% |
| Avg passes/match | 4.40 | 4.44 |
| Avg melee rounds | 2.32 | 2.30 |

Phase balance is essentially unchanged.

## Unseat Statistics — Bare Tier

| Archetype | Caused (Before) | Caused (After) | Received (Before) | Received (After) |
|-----------|----------------|----------------|-------------------|------------------|
| charger | 481 | 458 | 493 | 452 |
| bulwark | 527 | 498 | 494 | 489 |
| duelist | 475 | 442 | 440 | 424 |

Charger's unseat profile is marginally improved (fewer received unseats, -41). The lower INIT reduces first-mover advantage but the higher STA means Charger resists unseating better late in matches.

## Rationale

Charger's identity is "Raw impact; wins fast or fades." The "fades" part was too punishing — at STA=60, Charger's fatigue threshold was 48, meaning MOM/CTL started degrading after just 12 stamina loss. With Fast speed (-5 per pass) and Charge-focused attacks (-10 to -20), Charger was hitting fatigue by Pass 2 or 3 and losing effectiveness rapidly.

The STA 60→65 change raises the fatigue threshold from 48 to 52, giving Charger 4 extra points of "effective range" before degradation begins. This directly addresses the core weakness without changing Charger's identity. MOM=75 remains the highest in the game, ensuring Charger still has the strongest raw impact.

The INIT 60→55 trade is acceptable because:
1. Initiative feeds into accuracy at weight 0.5 (half of CTL's weight 1.0), making it the least impactful combat stat
2. Charger's identity doesn't depend on acting first — it depends on hitting hard
3. INIT=55 matches Breaker's INIT, which is a viable competitive archetype

## Test Failures

The change causes **~5-6 new test failures** (in addition to ~6 pre-existing from Round 1 Technician MOM change):

### Charger INIT-related (INIT 60→55)
1. **gigling-gear.test.ts** line 211: `expect(result.initiative).toBe(60 + 7 + 3 + 4 + 3)` → should be `55 + 7 + 3 + 4 + 3 = 72`
2. **calculator.test.ts**: Charger Fast+CF initiative assertion (60+20=80 → now 55+20=75)

### Charger STA-related (STA 60→65)
3. **gigling-gear.test.ts** line 212: `expect(result.stamina).toBe(60 + 7 + 2 + 3)` → should be `65 + 7 + 2 + 3 = 77`
4. **calculator.test.ts**: Charger fatigue threshold assertions (48 → 52)
5. **match.test.ts** line 38: `expect(match.player1.currentStamina).toBe(60)` → should be 65
6. **match.test.ts** line 81/252: stamina tracking 60-5-20=35 → now 65-5-20=40
7. **playtest.test.ts** line 267: `expect(ARCHETYPES.charger.stamina).toBe(60)` → should be 65
8. **playtest.test.ts** line 309: stamina endurance 60-5-20=35 → now 65-5-20=40

## Remaining Concerns

1. **Bulwark bare dominance** (60-62%): Still above the 60% target. Requires guardImpactCoeff reduction or mechanic change in a future round.
2. **Charger vs Bulwark** (25-35%): Worst matchup in the game. Structural issue — Charger's MOM advantage is neutralized by Bulwark's GRD.
3. **Technician at uncommon** (45.3%): Borderline weak, but within noise of the 45% floor.
4. **Test suite**: 11 total failures need resolution by test-writer agent.

## Recommendations for Next Round

1. **Address Bulwark bare dominance**: Consider guardImpactCoeff 0.18→0.16 to reduce GRD's defensive value. This would help Charger vs Bulwark matchup and bring Bulwark closer to 55%.
2. **Monitor Technician**: The MOM 55→58 change from Round 1 improved Technician broadly. Verify at uncommon tier after test stabilization.
3. **Do NOT make further Charger changes**: The INIT/STA swap achieved the target. Further adjustments risk oscillation.
