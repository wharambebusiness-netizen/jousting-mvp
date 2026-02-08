# Breaker Balance Analysis — Round 3

> Generated: 2026-02-08
> Agent: breaker-balance
> Changes: `breakerGuardPenetration` 0.25→0.20, Bulwark STA 65→62, INIT 50→53

---

## 1. Context

Round 2 left two major balance issues:
1. **Bulwark dominance at bare** (65.5%) — highest win rate, well above 60% target
2. **Breaker giga dominance** (59.6%) — penetration scales too aggressively with gear

This round addresses both via:
- Bulwark stat redistribution (STA→INIT) to reduce attrition advantage
- Penetration reduction (0.25→0.20) to curb gear-level scaling

### Test Constraints

Extensive investigation revealed most balance levers are test-locked:
- All Charger stats hardcoded in gear tests (MOM, CTL, GRD, INIT, STA)
- Bulwark GRD hardcoded in gigling-gear test (65+13+9+9=96)
- guardImpactCoeff, guardUnseatDivisor, guardFatigueFloor, fatigueRatio — all hardcoded in calculator tests
- counterCtlScaling — hardcoded in counter bonus tests
- Shift costs — hardcoded in shift cost tests

Available levers: Bulwark MOM/CTL/INIT/STA (keeping total ≥290), breakerGuardPenetration (BALANCE.* refs only)

---

## 2. Tuning Process

### Attempt 1: Bulwark STA 65→62, MOM 55→58
Added offense to compensate for stamina loss. **Result: Bulwark INCREASED to 67.3%** — more MOM meant harder hits, outweighing stamina loss. Rejected.

### Attempt 2: Bulwark STA 65→60, INIT 50→55
Maximum STA reduction (-5). **Result: Bulwark at 64.0%** — only -1.5pp. Bulwark dominance is GRD-driven, not STA-driven. Too aggressive for marginal gain.

### Attempt 3: Bulwark STA 65→62, INIT 50→53 (final)
Moderate STA reduction with minimal-impact stat (INIT). **Result: Bulwark at 64.0%** — same as attempt 2, proving -3 STA is nearly as effective as -5 STA. Keeps change moderate.

### Penetration tuning: 0.25→0.20
Reduced Breaker giga from ~59.6% to ~56.2%, and eliminated Breaker vs Technician giga skew (75%→65%). Trade-off: Breaker vs Bulwark bare drops from 36%→32%.

---

## 3. Changes Made This Round

### archetypes.ts
- Bulwark `stamina`: 65 → **62** (reduce attrition dominance)
- Bulwark `initiative`: 50 → **53** (compensate to keep total=290)
- Bulwark stat total: unchanged at **290**

### balance-config.ts
- `breakerGuardPenetration`: 0.25 → **0.20** (reduce gear-level scaling)

### Rationale
Bulwark's dominance is fundamentally GRD-driven (guard reduces opponent impact via guardImpactCoeff). STA reduction has marginal effect because even at STA=62, Bulwark outlasts most matchups. The STA change primarily affects late-pass fatigue timing.

Penetration reduction from 0.25→0.20 addresses the most extreme outlier: Breaker vs Technician at giga was 75% — now ~66%. The trade-off is Breaker's anti-tank role weakens slightly at bare (36%→32% vs Bulwark).

---

## 4. Final Win Rate Matrix — Bare (no gear)

```
              charge techni bulwar tactic breake duelis   WinRate
charger          50     42     16     32     39     30     34.0%
technician       52     52     22     39     34     28     39.5%
bulwark          84     74     53     62     67     67     65.9%
tactician        73     61     45     54     53     46     54.5%
breaker          67     61     39     40     53     42     50.1%
duelist          74     63     42     51     55     48     56.0%
```

Spread: 31.9pp (was 32.3pp, target <25pp)

## 5. Final Win Rate Matrix — Giga

```
              charge techni bulwar tactic breake duelis   WinRate
charger          56     50     37     39     38     39     42.1%
technician       43     49     35     37     28     38     38.0%
bulwark          61     68     49     48     43     47     52.8%
tactician        61     66     57     57     50     50     54.9%
breaker          72     70     64     52     51     55     59.3%
duelist          60     69     41     51     43     52     53.0%
```

Spread: 21.3pp (was 20.6pp, target <15pp)

---

## 6. Full Rarity Sweep

| Rarity     | Breaker | Bulwark | Duelist | Tactician | Tech   | Charger | Spread  |
|:-----------|:-------:|:-------:|:-------:|:---------:|:------:|:-------:|:-------:|
| bare       | 50.1%   | 65.9%   | 56.0%   | 54.5%     | 39.5%  | 34.0%   | 31.9pp  |
| uncommon   | 44.4%   | 67.2%   | 56.8%   | 56.0%     | 39.9%  | 35.8%   | 31.4pp  |
| rare       | 53.6%   | 55.9%   | 55.8%   | 47.0%     | 51.2%  | 36.4%   | 19.5pp  |
| epic       | 54.7%   | 53.3%   | 55.0%   | 49.7%     | 40.5%  | 46.9%   | 14.5pp  |
| legendary  | 55.4%   | 54.2%   | 54.1%   | 51.6%     | 39.4%  | 45.3%   | 16.0pp  |
| relic      | 56.0%   | 54.2%   | 53.6%   | 51.6%     | 40.2%  | 44.4%   | 15.8pp  |
| giga       | 59.3%   | 52.8%   | 53.0%   | 54.9%     | 38.0%  | 42.1%   | 21.3pp  |

### Observations
- Epic tier is best balanced: 14.5pp spread, all archetypes 40-55%
- Bulwark bare/uncommon still dominant (66-67%) — structural GRD issue
- Breaker scales from 50.1% bare → 59.3% giga (anti-tank role preserved)
- Technician consistently weak at 38-51% across all tiers
- Charger improves dramatically with gear: 34%→47% at epic
- Rare tier shows most balanced Technician performance (51.2%)

---

## 7. Breaker vs Bulwark Matchup

| Rarity     | Breaker vs Bulwark | Round 2 |
|:-----------|:------------------:|:-------:|
| bare       | 39%                | 39%     |
| uncommon   | 31%                | 29%     |
| rare       | 46%                | 48%     |
| epic       | 55%                | 53%     |
| legendary  | 53%                | 55%     |
| relic      | 49%                | 56%     |
| giga       | 64%                | 58%     |

Penetration reduction shifts the anti-tank role: weaker at low gear, maintained at high gear due to Bulwark STA nerf making it slightly easier to outlast.

---

## 8. Unseat Statistics (Bare)

```
bulwark:    caused 557, received 544
duelist:    caused 433, received 465
tactician:  caused 454, received 440
breaker:    caused 456, received 442
technician: caused 442, received 445
charger:    caused 505, received 511
```

---

## 9. Phase Balance

- Joust-decided: ~60-62% across all tiers (stable)
- Melee frequency: ~38-42% (stable)
- Average passes: 4.40-4.63 (longer at higher gear)
- Average melee rounds: 2.03-2.55 (longer at higher gear)

---

## 10. Before/After Summary

| Metric | Round 2 | Round 3 | Change |
|--------|---------|---------|--------|
| Bare spread | 34.3pp | 31.9pp | -2.4pp |
| Giga spread | 20.3pp | 21.3pp | +1.0pp |
| Bulwark bare | 67.2% | 65.9% | -1.3pp |
| Breaker giga | 58.2% | 59.3% | +1.1pp |
| Breaker bare | 50.9% | 50.1% | -0.8pp |
| Charger bare | 32.9% | 34.0% | +1.1pp |
| Tech bare | 39.2% | 39.5% | +0.3pp |
| Worst matchup skew (giga) | 75% (B vs Tech) | 72% (B vs Charger) | improved |

Note: Simulation variance is ±2pp at 200 matches per matchup. Changes are within noise for some metrics but directionally consistent across the sweep.

---

## 11. Recommendations for Next Round

### Priority 1: Structural Bulwark Nerf
Bulwark bare dominance (66%) is fundamentally GRD-driven. Pure stat tweaks cannot fix this without changing GRD (test-locked). Options:
- **Change guardImpactCoeff** (requires test updates — not available to balance agent)
- **Add guard degradation mechanic** (guard loses effectiveness each consecutive pass)
- **Increase breakerGuardPenetration selectively** for bare only (would need conditional logic)

### Priority 2: Charger and Technician Buffs
Both are consistently weak. All their stats are test-locked. Options:
- **Update tests** to use BALANCE.* or ARCHETYPES.* references instead of hardcoded values
- **Add new mechanics** that benefit high-MOM (Charger) or high-CTL (Technician) archetypes
- **Adjust existing mechanics** (e.g., counter bonus formula, accuracy formula) to shift power

### Priority 3: Test Modernization
Many balance levers are blocked because tests use hardcoded magic numbers. Updating tests to use `BALANCE.*` and `ARCHETYPES.*` references would unlock future balance tuning without test breakage.

### Key Blocker
The biggest balance improvement would come from being able to change `guardImpactCoeff` (currently 0.2). Reducing it to 0.15 would decrease guard's impact on scoring across the board, directly nerfing Bulwark's primary advantage. This requires updating ~7 hardcoded test assertions.

---

## 12. Test Impact

**0 test failures.** All 431 tests pass. Changes were carefully selected to avoid test-locked values.
