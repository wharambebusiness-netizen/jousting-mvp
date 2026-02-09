# QA Round 1 — Quality Assessment Report

## Summary

- **Tests before**: 477 (7 suites, all passing at baseline)
- **Tests after**: 589 (7 suites) — 156 in gear-variants.test.ts (up from 44)
- **New tests written**: 112 tests covering BL-004 (gear variant x archetype interactions)
- **Pre-existing failures found**: 7 tests in calculator.test.ts and match.test.ts

## BL-004: Gear Variant x Archetype Matchup Tests

### Part 1: All-aggressive vs all-defensive matchups (72 tests)
- Tested all 36 archetype pairs (6x6) with P1 using aggressive gear and P2 using defensive gear
- Tested at both **epic** and **giga** rarity tiers
- **Result**: All 72 matchups complete without error at both rarity levels

### Part 2: Degenerate strategy detection (26 tests)
- Verified **horizontal power**: all variants produce identical total stat budgets at every rarity tier
- Tested per-slot, full steed loadout, and full player loadout totals
- Verified stat profiles differ meaningfully between aggressive and defensive for all 6 archetypes
- Verified stat differences between aggressive/defensive are bounded (no single stat differs >60)
- Tested all 18 combinations (6 archetypes x 3 variants) against all opponents — all complete
- **Result**: No variant creates vertical power advantage. Stat budgets are identical. No degenerate strategies detected.

### Part 3: Mixed variant loadouts (7 tests)
- Tested mixed steed loadout (different variant per slot) — gear correctly uses per-slot routing
- Tested mixed player loadout (different variant per slot) — gear correctly uses per-slot routing
- Tested full match completion with mixed variants for all 6 archetypes
- Verified stat accumulation correctness: manual sum matches `sumGearStats()` and `sumPlayerGearStats()` output
- **Result**: Mixed variant loadouts work correctly. No issues found.

### Part 4: Mechanical meaningfulness (3 tests)
- Aggressive steed loadout produces higher momentum bonus than defensive
- Defensive steed loadout produces higher guard bonus than aggressive
- Player aggressive vs defensive produces meaningfully different stat distributions

### Part 5: Stress test (3 tests)
- 108 matches (36 pairs x 3 variants) at epic with full gear — all complete
- Mixed-variant geared matches at uncommon, epic, giga — all complete
- 50 variant matches complete in <500ms — performance verified

## Bug Reports

### BUG-001: Stale test assertions after S22 Technician MOM +5 balance pass
- **Severity**: High (7 failing tests)
- **Affected files**: `calculator.test.ts`, `match.test.ts`
- **Root cause**: Commit `ba3f489` (S22 balance pass) changed Technician MOM from 50 to 55, but did not update the worked example test assertions that hardcode Technician stats
- **Failing tests**:
  1. `calculator.test.ts` — "Technician pre-shift stats are below knee (unchanged)" — expects MOM=50, actual=55
  2. `calculator.test.ts` — "Technician post-shift has slight fatigue (sta 43 < threshold 44)" — cascading from MOM change
  3. `calculator.test.ts` — "Technician stats use correct fatigue" — `MOM: 50 * ff` should be `55 * ff`
  4. `calculator.test.ts` — "Technician stats at deeper fatigue" — `MOM: 60 * ff` should be `65 * ff` (55+CEP.delta=5)
  5. `calculator.test.ts` — "resolves Pass 1 with correct directional outcome" — Charger no longer wins impact
  6. `calculator.test.ts` — "counter bonus in resolvePass scales with CTL" — impact delta sign flipped
  7. `match.test.ts` — "replays Charger vs Technician Passes 1-3 via match machine" — pass 1 impact direction wrong
- **Assign to**: engine-dev or balance-tuner agent
- **Fix**: Update the 7 test assertions to use Technician MOM=55 instead of 50, recalculate expected values
- **Note**: The Charger CTL was also changed from 50 to 55 in the same balance pass, affecting the worked example. The test at line 318 uses `CTL: (55+15+15) = 85 * ff` — this was 50+15+15=80 before. Need full recalculation of Pass 1-3 worked example.

### BUG-002: Tactician mirror match P1 bias (bare mode)
- **Severity**: Medium (balance concern, not crash)
- **Observation**: Tactician mirror match shows P1: 36.0%, P2: 64.0% in bare run 2 (28pp skew)
- **Root cause hypothesis**: Deterministic attack cycling interacts with Tactician's high INIT (75) to create first-mover advantage asymmetry specific to how the sim tool assigns attacks
- **Assign to**: balance-analyst or engine-dev
- **Note**: This may be a simulation tool artifact rather than a real game balance issue, since real players choose attacks. But worth investigating whether INIT asymmetry creates a systematic P1/P2 bias.

### BUG-003: Technician win rate variance across simulation runs
- **Severity**: Low
- **Observation**: Technician bare win rate: 44.8% (run 1) vs 50.1% (run 2) = 5.3pp variance
- **Root cause**: Expected variance from 200-match-per-matchup sample size + RNG interactions
- **Note**: All other archetypes are within 3pp variance. Technician's higher variance may indicate matchup sensitivity to RNG.

## Simulation Variance Analysis

### Bare mode (2 runs, 200 matches/matchup)
```
              Run1    Run2    Delta
bulwark       62.7%   60.4%   2.3pp
duelist       55.1%   55.2%   0.1pp
tactician     52.3%   50.9%   1.4pp
technician    44.8%   50.1%   5.3pp  <-- above 3pp threshold
breaker       46.9%   46.0%   0.9pp
charger       38.2%   37.5%   0.7pp
```

### Giga mode
```
breaker       53.6%
duelist       51.9%
bulwark       51.7%
tactician     51.2%
technician    46.0%
charger       45.7%
```
Balance is tighter at giga — all within 45-54% range.

### Mixed mode
```
bulwark       52.0%
duelist       51.9%
breaker       50.0%
tactician     49.7%
technician    48.3%
charger       48.2%
```
Near-perfect balance at mixed rarity — all within 48-52%.

## Coverage Assessment

### Covered this round:
- [x] All 36 archetype matchups with aggressive vs defensive gear (epic + giga)
- [x] All 3 gear variants for each archetype against all opponents
- [x] Mixed variant loadouts (different variants per slot)
- [x] Horizontal power invariant (same total stat budget)
- [x] Stat routing correctness (mixed loadout stat sums)
- [x] Performance regression (50 variant matches < 500ms)

### Still uncovered (future rounds):
- [ ] SoftCap boundary (stats at 99, 100, 101)
- [ ] Zero stamina joust/melee resolution edge cases
- [ ] Guard at fatigue floor (guardFatigueFloor = 0.5)
- [ ] Unseated impact boost (1.25x) verification
- [ ] Counter resolution with equal CTL values
- [ ] Melee with both players at minimum stamina
- [ ] Uncommon rarity bonus = 2 verification
- [ ] Player gear NO rarity bonus verification
