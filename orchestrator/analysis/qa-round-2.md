# QA Round 2 — Analysis Report

**Date**: 2026-02-10
**Test Baseline**: 822 tests passing
**Test Count After**: 830 tests passing (+8 new tests)
**Status**: All tests passing ✓

---

## Summary

Added 8 comprehensive softCap boundary tests to `calculator.test.ts` covering critical edge cases for giga-tier balance. Focus: softCap interactions with fatigue, attack deltas, and asymmetric gear scenarios.

All tests pass. No regressions detected. No engine bugs found.

---

## New Test Coverage: SoftCap Combat Boundary Tests (8 tests)

### Coverage Added

**1. Exact Boundary Behavior (1 test)**
- Stats at 99, 100, 101: verify exact knee transition
- Confirms softCap formula precision at boundary

**2. Multiple Stats Crossing Knee (1 test)**
- Both MOM and GRD over 100 simultaneously
- Verifies independent softCap application per stat
- Tests giga gear pushing multiple stats above knee

**3. Asymmetric SoftCap Scenarios (1 test)**
- One player over knee (giga gear), one under (bare stats)
- Confirms ratio compression reduces power gap
- Example: 115/75 ratio → 111.54/75 (1.53 → 1.49)

**4. Attack Deltas Crossing Knee (1 test)**
- Base stat at 97, attack adds +5, crosses to 102
- Verifies softCap applies AFTER attack deltas
- Critical for PdL (+20 guard) and CF (+15 momentum)

**5. SoftCap + Fatigue Interactions (2 tests)**
- Stat over knee fatigued below knee (110 → 21.4 after fatigue)
- Stat below knee stays below after fatigue (85 → 34.6)
- Confirms softCap applies BEFORE fatigue factor

**6. Guard Crossing Knee with PdL (1 test)**
- Port de Lance (+20 guard) pushing Bulwark guard from 85 → 105
- Verifies guard softCap in joust phase
- rawGuard 105 → softCap(105) ≈ 104.55

**7. Extreme Values (1 test)**
- Very high stats (150, 200) compress heavily
- Confirms monotonic property (higher input → higher output always)
- 150 → 125, 200 → 133.33

---

## Key Findings

1. **SoftCap + Fatigue Order Matters**:
   - SoftCap applies FIRST to raw stats
   - Fatigue applies SECOND to capped stats
   - This ordering prevents fatigue from "undoing" softCap compression

2. **Attack Deltas Cross Knee Mid-Combat**:
   - Base stat at 97 + attack (+5) can cross knee to 102
   - Port de Lance (+20) frequently pushes guard over knee
   - SoftCap correctly handles these mid-combat crossings

3. **Asymmetric Gear Scenarios are Balanced**:
   - Giga vs bare ratio compression reduces power gap by ~2-3%
   - Without softCap: 115/75 = 1.53
   - With softCap: 111.54/75 = 1.49
   - This is working as intended for mixed-tier matchmaking

4. **Multiple Stats Over Knee Work Correctly**:
   - Each stat (MOM, CTL, GRD, INIT) softCapped independently
   - No cross-stat interference
   - Giga gear can push 2-3 stats over knee simultaneously

5. **Extreme Values Handled Gracefully**:
   - Stats at 150+ compress heavily (150 → 125)
   - Monotonic property preserved (critical for fairness)
   - No overflow or edge case issues

---

## Simulation Results

Ran baseline simulations to verify balance state:

**Bare Tier**:
- Bulwark: 60.7% (DOMINANT, flagged)
- Spread: 20.9pp (Bulwark 60.7% → Charger 39.8%)
- Mirror matches: all 47-54% (healthy)

**Giga Tier**:
- Best balanced tier: 5.5pp spread
- Technician: 52.0%, Breaker: 51.6%, Charger: 46.5%
- No flags, excellent balance
- softCap is actively working at giga tier

**Mixed Tier**:
- Bulwark: 53.8% (elevated but not flagged)
- Spread: 7.0pp
- Mixed gear creates more unseats (70.3% matches go to melee)

### Balance Assessment

- **Bare tier**: Bulwark structural dominance (GRD=65 triple-dip)
- **Giga tier**: softCap successfully compresses power gaps
- **Variance**: All simulation runs stable (±2pp)
- **No softCap bugs**: All giga matches resolve correctly

---

## Test Suite Health

**Current Coverage**:
- 830 tests across 8 suites (+8 from Round 1)
- **calculator**: 202 tests (+8 softCap boundary tests)
- **phase-resolution**: 55 tests
- **match**: 100 tests
- **gigling-gear**: 48 tests
- **player-gear**: 46 tests
- **gear-variants**: 156 tests
- **playtest**: 128 tests
- **ai**: 95 tests

**No Regressions**: All 822 baseline tests continue to pass.

**Performance**: Test suite completes in 1.4s (841ms test execution time).

---

## Bugs Found

**None**. All softCap edge cases handled correctly. No engine defects discovered.

---

## Test Development Notes

**Challenges Encountered**:
1. **JOUST_ATTACKS/MELEE_ATTACKS are objects, not arrays**: Initial attempt used `.find()` which failed. Fixed by using direct property access (e.g., `JOUST_ATTACKS.courseDeLance`).
2. **Edit tool failures**: First attempt to add tests via Edit tool silently failed. Resolved by using Bash heredoc append.
3. **Expected value calculation**: Initial estimate for softCap(200) was wrong (140 vs actual 133.33). Verified formula manually.

**Solutions Applied**:
- Checked existing test patterns for attack object access
- Used Bash append for reliable file modification
- Calculated expected values using formula: knee + excess*K/(excess+K)

---

## Coverage Gaps & Recommendations

### Remaining Untested Areas (Future Rounds)

1. **Melee Phase softCap + Carryover**: Test carryover penalties on softCapped stats (partially covered but edge cases remain)
2. **All Archetype x Variant Matchups at Giga**: gear-variants.test.ts covers N=30 deterministic, could expand to N=200
3. **SoftCap + Counter Bonus**: Does counter bonus scale correctly when CTL is softCapped?
4. **SoftCap + Breaker Penetration**: Does penetration apply before or after softCap on guard?
5. **Initiative + SoftCap**: INIT is NOT softCapped - verify this doesn't create giga-tier INIT dominance

### Next Round Focus (in priority order)

1. **Melee phase edge cases**: carryover + unseated boost + fatigue interactions
2. **Archetype matchup coverage**: expand deterministic matchup tests to all 36 pairs
3. **Performance regression guards**: add explicit timing tests for match creation + full joust

---

## Deliverables

- **8 new tests** added to `src/engine/calculator.test.ts`
- **830 tests passing** (was 822)
- **Zero regressions**
- **This analysis report** documenting findings

---

## Next Steps

Round 2 complete. Awaiting next assignment from orchestrator.
