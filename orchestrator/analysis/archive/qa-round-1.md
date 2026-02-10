# QA Round 1 — Analysis Report

**Date**: 2026-02-09
**Test Baseline**: 794 tests passing
**Test Count After**: 822 tests passing (+28 new tests)
**Status**: All tests passing ✓

---

## Summary

Added 28 new tests across two backlog tasks:
- **BL-050**: 17 edge case tests for phase-resolution
- **BL-051**: 11 integration tests for match gear pipeline

All tests pass. No regressions detected. No engine bugs found.

---

## BL-050: Phase-Resolution Edge Cases (17 tests)

### Coverage Added

**1. Unseat Timing (4 tests)**
- Unseat on pass 1 (earliest possible)
- Unseat on pass 5 (last joust pass)
- Both players unseated — higher margin wins
- Both players unseated — tied margins results in no unseat

**2. Extreme Fatigue Scenarios (6 tests)**
- Stamina=0 joust pass: stats fully fatigued
- Stamina=1 joust pass: minimal but non-zero fatigue factor
- Stamina=0 melee round: stats fully fatigued
- Stamina=1 melee round: minimal fatigue factor
- Both players at stamina=0 in joust
- Both players at stamina=1 in melee

**3. Shift Eligibility at Exact Threshold (4 tests)**
- Shift at exact CTL threshold (Standard speed)
- Shift fails just below CTL threshold via fatigue
- Shift at exact stamina threshold (stamina=10)
- Shift fails when stamina is below cost threshold

**4. Breaker Penetration vs High-Guard in Melee (3 tests)**
- Breaker vs Bulwark using Guard High: penetration mitigates high guard
- Breaker vs Bulwark+Guard High at low stamina: penetration + fatigue interaction
- Breaker vs Bulwark: penetration scales with guard stat

### Key Findings

1. **Shift eligibility is more complex than expected**:
   - Requires BOTH: effective CTL >= threshold AND currentStamina >= 10
   - Effective CTL is computed AFTER fatigue, so low stamina can prevent shift even with high base CTL
   - Carryover penalties do NOT affect shift eligibility in joust phase (only in melee)

2. **Guard fatigue floor (0.5) protects defensive stats at zero stamina**:
   - At stamina=0, MOM and CTL drop to 0 but guard remains > 0
   - This prevents divide-by-zero and ensures defensive players have minimal protection

3. **All edge cases handled gracefully**:
   - No crashes at extreme stamina values
   - No divide-by-zero errors
   - Mirror matchups at low stamina correctly tie

---

## BL-051: Match Gear Integration Tests (11 tests)

### Coverage Added

**1. Full Stat Pipeline (4 tests)**
- Uncommon steed + player gear: full stat pipeline from base to softCap
- Giga steed gear: verify softCap activates on high stats
- Mixed variants: aggressive steed + defensive player gear
- Bare vs giga: giga produces higher impact scores

**2. createMatch() Argument Combinations (5 tests)**
- createMatch() with 0 loadout args: bare match
- createMatch() with 2 loadout args: steed only
- createMatch() with 4 loadout args: steed + player gear
- createMatch() with 6 loadout args: asymmetric gear
- applyPlayerLoadout does NOT add rarity bonus (regression guard)

**3. Full Match Integration (2 tests)**
- Full match with uncommon gear: stat pipeline verified
- Full match comparing bare vs giga outcomes: verify stat advantage translates to match advantage

### Key Findings

1. **applyPlayerLoadout correctly excludes rarity bonus**:
   - Rarity bonus is mount-only (steed gear)
   - Player gear adds only slot bonuses, no flat rarity bonus
   - Regression test verifies this critical distinction

2. **Gear variants work correctly in mixed configurations**:
   - Aggressive steed + defensive player gear produces expected hybrid stats
   - No conflicts or edge cases when mixing variants

3. **Giga gear produces significantly higher impact**:
   - Giga gear yields 1.5x+ impact compared to bare archetype
   - Stats correctly flow through: base → steed → player → softCap → fatigue → combat

4. **SoftCap activates correctly at giga tier**:
   - Stats exceeding 100 (knee) are correctly capped
   - No overflow or incorrect calculations

---

## Test Suite Health

**Current Coverage**:
- 822 tests across 8 suites
- **calculator**: 194 tests (core math + guard penetration + fatigue)
- **phase-resolution**: 55 tests (+17 edge cases)
- **match**: 100 tests (+11 gear integration)
- **gigling-gear**: 48 tests
- **player-gear**: 46 tests
- **gear-variants**: 156 tests
- **playtest**: 128 tests (property-based + stress)
- **ai**: 95 tests

**No Regressions**: All 794 baseline tests continue to pass.

**Performance**: Match creation + 5 passes runs under 50ms (well within acceptable range).

---

## Bugs Found

**None**. All edge cases handled correctly. No engine defects discovered.

---

## Test Development Notes

**Test Authoring Challenges**:
1. Initial misunderstanding of shift eligibility rules (carryover vs fatigue)
2. Field name confusion (`cumulativeScore1` not `cumulativeImpactPlayer1`)
3. Gear rarity names (`uncommon` not `common` for lowest tier)

**Solutions Applied**:
- Verified shift logic in `phase-joust.ts` and `calculator.ts`
- Used existing test patterns for field access
- Checked gear factory function signatures

---

## Recommendations

1. **Continue edge case expansion**: Consider adding tests for:
   - Shift eligibility at Fast and Slow thresholds (70 and 50)
   - Negative carryover values exceeding base stats
   - All 6 archetypes at stamina=0/1 (currently only tested a few)

2. **Gear pipeline stress testing**: Add tests for:
   - All rarity tiers (bare, uncommon, rare, epic, legendary, relic, giga)
   - All 3 variants (aggressive, balanced, defensive) at each tier
   - Edge case: one player with max gear, opponent with zero gear

3. **Performance regression guards**: Add explicit performance tests for:
   - Full 5-pass joust completion time
   - 10-round melee completion time
   - Match creation overhead with giga gear

---

## Next Steps

Both assigned tasks (BL-050 and BL-051) are **complete**. Ready for next assignment.
