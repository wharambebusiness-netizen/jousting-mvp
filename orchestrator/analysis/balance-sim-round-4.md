# Balance & Simulation Report — Round 4

## Changes Applied

### Formula-Level Guard Nerf (calculator.ts + balance-config.ts)

Extracted hardcoded guard coefficients into `balance-config.ts` and reduced both:

| Formula | Old Value | New Value | Effect |
|---------|-----------|-----------|--------|
| Impact Score: `- OppGuard * coeff` | 0.3 | 0.2 (`guardImpactCoeff`) | Guard subtracts 33% less from opponent's impact |
| Unseat Threshold: `+ Guard / divisor` | / 10 | / 15 (`guardUnseatDivisor`) | Guard contributes 33% less to unseat protection |

**Why both:** Guard was double-dipping — reducing opponent's score AND raising the unseat bar. Both channels needed reduction.

**Key architectural improvement:** Guard coefficients are now in `balance-config.ts` as tunable constants. Future rebalancing only requires config changes, not formula edits.

### Test Updates
Updated 7 test assertions across calculator.test.ts and match.test.ts:
- ImpactScore formula test: 51.5→56.5 (less guard subtraction = higher scores)
- Unseat threshold tests: 27.5→27 (using clean divisor-friendly values)
- Unseat threshold extremes: 36.05→32.217
- Unseat "grows with guard" test: 35→31.667
- resolvePass integration: Charger now wins Pass 1 impact vs Technician (was Technician winning)
- match.test.ts worked example: same direction flip
- caparison.test.ts: comment update

### Behavioral Change: Charger Wins Pass 1
With the old 0.3 coefficient, Technician's high guard (65) gave a large impact advantage over Charger. With 0.2, Charger's massive momentum (115 raw, ~112 soft-capped) now dominates the impact calculation despite the counter penalty from CEP beating CF. This is intentional — glass cannons should hit hard early.

## Simulation Results

### Win Rates (7,200 matches, 200 per matchup, medium AI)
```
Round 3 (stat changes only):     Round 4 (formula fix):
  bulwark      71.9%  DOMINANT     bulwark      69.1%  DOMINANT
  duelist      61.0%  HIGH         duelist      58.5%  HIGH
  tactician    54.3%  OK           tactician    56.6%  HIGH
  technician   43.2%  LOW          technician   41.1%  LOW
  breaker      36.5%  WEAK         breaker      39.0%  WEAK
  charger      33.1%  WEAK         charger      35.7%  WEAK
```

### Matchup Matrix (P1 win %)
```
              charge techni bulwar tactic breake duelis
  charger       55     45     17     26     47     24
  technician    61     50     24     34     49     33
  bulwark       85     75     52     63     80     62
  tactician     65     70     35     49     70     50
  breaker       53     50     24     31     48     30
  duelist       67     67     36     56     75     56
```

### Phase Balance
```
  Joust-decided (no unseat): 59.4%
  Melee matches (unseat/tie): 40.6%  (up from previous rounds — more unseats!)
  Avg passes: 4.38
  Avg melee rounds: 2.05
```

### Unseat Statistics
```
  charger      caused: 525, received: 482  (positive ratio — glass cannon lands hits)
  bulwark      caused: 558, received: 602  (no longer unseat-immune)
  tactician    caused: 463, received: 446
  duelist      caused: 447, received: 461
  breaker      caused: 474, received: 492
  technician   caused: 454, received: 438
```

## Analysis

### What improved:
- Bulwark dropped 71.9% → 69.1% (-2.8pp) — cumulative drop from 76.4% baseline
- Charger improved 33.1% → 35.7% (+2.6pp) — cumulative rise from 28.2% baseline
- Bulwark now RECEIVES more unseats than it causes (602 vs 558) — guard reduction working
- Charger now CAUSES more unseats than it receives (525 vs 482) — glass cannon landing
- Unseat/melee rate increased to 40.6% — game is more decisive, fewer 5-pass grinds
- Guard coefficients are now configurable — future tuning is trivial

### What still needs work:
- Bulwark at 69% is still dominant (target: 50-55%)
- Breaker "anti-Bulwark" identity remains broken (24% vs Bulwark)
- Charger/Breaker/Technician cluster below 45% (target: 45-55%)
- Duelist overperforming at 58.5% for a "balanced generalist"

### Why stat+formula changes have diminishing returns:
The remaining imbalance comes from **structural advantages** in how guard interacts with the entire combat system:
1. Guard reduces impact in BOTH directions (your guard helps defend AND hurts opponent's score)
2. Stamina naturally favors defensive play (high-STA + high-GRD archetypes)
3. The AI's "optimal" play rewards defensive strategies disproportionately
4. Breaker has no guard-penetration mechanic — its "anti-Bulwark" identity is flavor text only

### Cumulative Balance Progress
```
Round 2 (baseline):     Round 3 (stats):     Round 4 (formula):
  bulwark   76.4%         71.9% (-4.5pp)       69.1% (-7.3pp total)
  charger   28.2%         33.1% (+4.9pp)       35.7% (+7.5pp total)
  spread    48.2pp        38.8pp               33.4pp
```

The spread between strongest and weakest has narrowed from 48.2pp to 33.4pp — a 31% reduction.

## Remaining Stretch Goals

- [ ] **Breaker guard-penetration mechanic** (phase-joust.ts): Breaker ignores X% of opponent guard in impact formula. This is the key missing piece for archetype identity balance.
- [ ] More aggressive guard coefficient tuning (guardImpactCoeff 0.15? guardUnseatDivisor 20?)
- [ ] Per-difficulty simulation (easy/medium/hard AI)
- [ ] Speed/attack usage frequency tracking
- [ ] Gear/caparison simulation mode

## Files Modified This Round
- src/engine/balance-config.ts (added guardImpactCoeff, guardUnseatDivisor)
- src/engine/calculator.ts (use BALANCE config for guard coefficients)
- src/engine/calculator.test.ts (7 test assertion updates)
- src/engine/match.test.ts (1 directional assertion update)
- src/engine/caparison.test.ts (1 comment update)
