# Balance & Simulation Report — Round 3

## Changes Applied

### Archetype Stat Changes
| Archetype | Stat | Before | After | Reason |
|-----------|------|--------|-------|--------|
| Charger | CTL | 45 | 50 | Improve accuracy (was catastrophically low) |
| Charger | MOM | 70 | 75 | Lean into glass-cannon identity |
| Charger | GRD | 55 | 50 | Trade defense for offense (identity fit) |
| Bulwark | GRD | 75 | 65 | Reduce defensive dominance |
| Bulwark | INIT | 45 | 50 | Compensate for GRD loss, keep total ≥ 290 |

### Stat Totals (All within [290, 300])
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   50   50    60   60  = 295
technician:   50   70   55    60   55  = 290
bulwark:      55   55   65    50   65  = 290
tactician:    55   65   50    75   55  = 300
breaker:      65   60   55    55   60  = 295
duelist:      60   60   60    60   60  = 300
```

### Test Updates
Updated ~20 test assertions across calculator.test.ts, caparison.test.ts, and gigling-gear.test.ts to match new archetype stat values. All 327 tests passing.

Key test changes:
- Charger momentum soft-cap test: 110→115 (new MOM 75+15+25)
- Charger guard tests: GRD 55→50 cascading through fatigue calculations
- Bulwark guard tests: GRD 75→65 cascading through soft-cap and fatigue calcs
- Giga Bulwark test: now stays under softCap knee (93 < 100)
- Irongrip Drape test: switched from Charger+CDL to Tactician+CEP at Fast speed (CTL 50+10=60 now passes Standard threshold=60 without irongrip, breaking the old test)

## Simulation Results

### Win Rates (7,200 matches, 200 per matchup, medium AI)
```
Before (Round 2):                After (Round 3):
  bulwark      76.4%  DOMINANT     bulwark      71.9%  STILL DOMINANT
  duelist      60.5%  HIGH         duelist      61.0%  HIGH
  tactician    54.5%  OK           tactician    54.3%  OK
  technician   44.0%  LOW          technician   43.2%  LOW
  breaker      36.4%  WEAK         breaker      36.5%  WEAK
  charger      28.2%  CRITICAL     charger      33.1%  WEAK
```

### Matchup Matrix (P1 win %)
```
              charge techni bulwar tactic breake duelis
  charger       48     39     16     30     47     20
  technician    63     49     19     34     56     32
  bulwark       86     79     44     66     83     65
  tactician     76     55     32     51     71     33
  breaker       52     43     16     32     43     26
  duelist       79     69     33     54     74     57
```

### Analysis

**What improved:**
- Charger win rate up from 28.2% to 33.1% (+5pp)
- Bulwark win rate down from 76.4% to 71.9% (-4.5pp)
- Bulwark vs Charger: 93% → 86% (-7pp)
- Charger vs Technician: improved from 35% to 39%

**What didn't improve enough:**
- Bulwark is STILL dominant at 72% — beats everything including its counter (Breaker at 83%)
- Charger is STILL the weakest at 33%
- Breaker's "anti-Bulwark" identity is non-functional (16% vs Bulwark)
- Duelist is too strong for a "balanced generalist" (61%)

**Diminishing returns on stat changes:**
- GRD change from 75→70: Bulwark dropped ~3.5pp
- GRD change from 70→65: Bulwark dropped only ~1pp more
- The issue is formula-level, not stat-level

## Root Cause Analysis

Guard is systematically overvalued because it contributes defensively in **two** places:

1. **Impact Score**: `ImpactScore = MOM*0.5 + Accuracy*0.4 - OppGuard*0.3`
   - Guard directly reduces opponent's impact score

2. **Unseat Threshold**: `Threshold = 20 + Guard/10 + Stamina/20`
   - Guard raises the bar for unseating

This means 10 points of Guard provides:
- `-3.0` to opponent's impact score (via 0.3 coefficient)
- `+1.0` to unseat threshold (via /10)
- Total defensive value: **4.0 units**

While 10 points of Momentum provides:
- `+5.0` to own impact score (via 0.5 coefficient)
- No defensive contribution
- Total offensive value: **5.0 units**

But guard's value is amplified because it applies **against** the opponent, effectively doubling its impact in the score differential. A +10 GRD swing is worth +3 impact differential (your opponent scores 3 less) PLUS +1 threshold protection = **4.0 differential units**. Momentum's +5 only contributes +5 to the same differential.

The key insight: **Guard's coefficient of 0.3 in the impact formula should be lower, or the unseat threshold's guard term should be reduced.** These formulas are in `calculator.ts` which is not owned by this agent.

## Recommended Next Steps (Formula Changes)

### Option A: Reduce guard coefficient in impact score
Change `ImpactScore = MOM*0.5 + ACC*0.4 - OppGuard*0.3` to `OppGuard*0.2`
- Reduces guard's impact on score differential by 33%
- File: calculator.ts (not my file)

### Option B: Reduce guard term in unseat threshold
Change `Threshold = 20 + Guard/10 + Stamina/20` to `Guard/15`
- Makes it easier to unseat high-guard archetypes
- File: calculator.ts (not my file)

### Option C: Add guard-penetration mechanic for Breaker
Give Breaker a unique passive that ignores a % of opponent's guard in the impact formula.
- Would require new code in phase-joust.ts
- Thematically fits "Guard shatter" identity

### Option D (if no formula changes): Further stat redistribution
- Bulwark GRD 65→60 (but total drops to 285, need +5 elsewhere)
- Give Breaker a stat boost (MOM 65→70)
- Risk: stat-only changes have shown diminishing returns

## Files Modified
- src/engine/archetypes.ts (archetype stat values)
- src/engine/balance-config.ts (comments only)
- src/engine/calculator.test.ts (test expectations)
- src/engine/caparison.test.ts (Irongrip Drape test scenario)
- src/engine/gigling-gear.test.ts (test expectations)
