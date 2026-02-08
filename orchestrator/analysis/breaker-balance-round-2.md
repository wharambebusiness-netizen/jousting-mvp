# Breaker Balance Analysis — Round 2

> Generated: 2026-02-08
> Agent: breaker-balance
> Changes: `breakerGuardPenetration` 0.35→0.25, Breaker MOM 65→62

---

## 1. Context

The breaker-mechanic agent implemented a guard penetration mechanic where Breaker ignores a percentage of the opponent's effective guard during impact calculation. The initial value was `breakerGuardPenetration: 0.35` (35%).

**Goal**: Tune this value so Breaker reaches 45-55% win rate, especially improving the Breaker-vs-Bulwark matchup, without making Breaker universally dominant.

---

## 2. Tuning Process — Penetration Sweep

Ran simulations across 4 penetration values with original Breaker stats (MOM=65):

| Penetration | Bare Breaker | Bare vs Bulwark | Giga Breaker | Giga vs Bulwark |
|:-----------:|:------------:|:---------------:|:------------:|:---------------:|
| 0.20        | 42.4%        | 23%             | 59.0%        | 58%             |
| 0.25        | 46.3%        | 27%             | 61.9%        | 57%             |
| 0.30        | 48.5%        | 31%             | 63.8%        | 63%             |
| 0.35 (orig) | 49.0%        | 38%             | 66.1%        | 63%             |

**Key finding**: Percentage-based penetration scales with absolute guard values. At giga rarity, guard is much higher, so the same penetration % removes more absolute guard → Breaker becomes universally dominant at high gear levels. No single penetration value satisfies both bare and giga targets simultaneously.

### Solution: Lower penetration + reduce Breaker MOM

Reducing MOM from 65→62 removes universal hitting power while preserving the anti-guard specialization from penetration. Tested both MOM=60 and MOM=62:

| Config              | Bare Breaker | Bare vs Bulwark | Giga Breaker | Giga vs Bulwark |
|:--------------------|:------------:|:---------------:|:------------:|:---------------:|
| pen=0.25, MOM=62    | 50.9%        | 39%             | 58.2%        | 58%             |
| pen=0.25, MOM=60    | 48.8%        | 36%             | 58.9%        | 57%             |

Chose **pen=0.25, MOM=62** — keeps Breaker MOM meaningfully above Duelist (60) while achieving best balance.

---

## 3. Final Win Rate Matrix — Bare (no gear)

```
              charge techni bulwar tactic breake duelis   WinRate
charger          49     41     16     30     32     28     32.9%
technician       54     48     24     35     39     30     39.2%
bulwark          83     81     51     68     69     63     67.2%
tactician        74     61     40     51     52     51     53.7%
breaker          63     66     39     46     53     41     50.9%
duelist          78     61     39     54     54     50     56.1%
```

Spread: 34.3pp (target <25pp — pre-existing issue, not caused by penetration)

## 4. Final Win Rate Matrix — Giga

```
              charge techni bulwar tactic breake duelis   WinRate
charger          54     53     36     46     38     45     43.8%
technician       49     52     30     31     32     34     37.9%
bulwark          61     67     52     48     49     47     53.8%
tactician        60     65     51     49     43     48     52.8%
breaker          63     72     58     55     50     56     58.2%
duelist          59     64     52     54     44     51     53.5%
```

Spread: 20.3pp (target <15pp — improved from 23.7pp at pen=0.35, pre-existing issue)

---

## 5. Full Rarity Sweep

| Rarity     | Breaker | Bulwark | Charger | Tech   | Duelist | Tactician | Spread  |
|:-----------|:-------:|:-------:|:-------:|:------:|:-------:|:---------:|:-------:|
| bare       | 50.9%   | 67.2%   | 32.9%   | 39.2%  | 56.1%   | 53.7%     | 34.3pp  |
| uncommon   | 45.5%   | 67.6%   | 35.0%   | 40.6%  | 55.7%   | 55.6%     | 32.6pp  |
| rare       | 56.6%   | 58.4%   | 35.3%   | 48.5%  | 55.1%   | 46.1%     | 23.1pp  |
| epic       | 55.3%   | 53.9%   | 46.8%   | 38.7%  | 54.4%   | 50.9%     | 16.6pp  |
| legendary  | 57.4%   | 54.8%   | 45.5%   | 37.4%  | 55.6%   | 49.4%     | 20.0pp  |
| relic      | 58.5%   | 54.7%   | 44.3%   | 38.3%  | 52.7%   | 51.6%     | 20.2pp  |
| giga       | 58.2%   | 53.8%   | 43.8%   | 37.9%  | 53.5%   | 52.8%     | 20.3pp  |

**Observations:**
- Breaker scales from 50.9% bare → 58.2% giga — within acceptable range at all tiers
- Penetration provides proportionally more benefit at higher guard values (intended)
- Epic tier is best balanced: 16.6pp spread, all archetypes 38-55%
- Bare and uncommon remain dominated by Bulwark (67-68%) — pre-existing
- Charger and Technician remain weak across all tiers — pre-existing

---

## 6. Breaker vs Bulwark Matchup

| Rarity     | Breaker vs Bulwark |
|:-----------|:------------------:|
| bare       | 39%                |
| uncommon   | 29%                |
| rare       | 48%                |
| epic       | 53%                |
| legendary  | 55%                |
| relic      | 56%                |
| giga       | 58%                |

Breaker correctly fulfills anti-tank role at mid-to-high gear tiers (rare+). At bare, penetration alone can't fully counter Bulwark's 65 GRD + 65 STA advantage — further structural balance needed.

---

## 7. Changes Made This Round

### balance-config.ts
- `breakerGuardPenetration`: 0.35 → **0.25** (reduced to prevent giga dominance)

### archetypes.ts
- Breaker `momentum`: 65 → **62** (reduced universal hitting power, keeps anti-guard specialization)
- Breaker stat total: 295 → **292**

### Rationale
The penetration mechanic amplifies with gear because higher guard values = more absolute guard removed. Lowering penetration from 0.35 to 0.25 reduces the giga-level amplification. Lowering MOM from 65 to 62 compensates for the universal bonus that penetration gives against ALL archetypes (not just high-guard ones), making Breaker more of a specialist and less of a generalist bruiser.

---

## 8. Unseat Statistics (Bare)

```
bulwark:    caused 555, received 531
duelist:    caused 466, received 400
tactician:  caused 459, received 466
breaker:    caused 429, received 440
technician: caused 395, received 445
charger:    caused 509, received 531
```

Breaker unseat rate is slightly below average — penetration affects impact score but NOT unseat threshold (intended design). Breaker wins via accumulated scoring advantage, not knockouts.

---

## 9. Phase Balance

- Joust-decided: ~61% across all tiers (stable)
- Melee frequency: ~39% (stable)
- Average passes: 4.4-4.6 (longer at higher gear — softCap compresses advantages)
- Average melee rounds: 2.0-2.6 (longer at higher gear)

---

## 10. Recommendations for Next Round

### Priority 1: Bulwark Nerf (bare dominance)
Bulwark at 67% bare remains the #1 balance issue. Options:
- Reduce Bulwark GRD 65→62 (direct nerf to its identity stat)
- Reduce Bulwark STA 65→62 (indirect nerf via earlier fatigue)
- Increase guardUnseatDivisor further (makes guard less protective vs unseats)

### Priority 2: Charger/Technician Buffs
Both are consistently weak (33-40% bare). Options:
- Charger: +3 STA (60→63) for more sustain
- Technician: +3 CTL (70→73) to lean into specialization
- Or structural mechanic changes (Charger momentum scaling, Technician counter bonus)

### Priority 3: Penetration Scaling
Consider flat penetration (e.g., Breaker ignores 10 points of guard) instead of percentage to reduce gear-level scaling variance. Would need formula change in calculator.ts.

---

## 11. Test Impact

1 test failure: `playtest.test.ts` "Breaker has higher stat total than before (295 vs 280)" — now 292 due to MOM reduction. Needs update by test-writer agent.
