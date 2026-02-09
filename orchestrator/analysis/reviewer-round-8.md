# Code Review — Round 8

## Summary

Reviewed QA Round 7 changes (+12 documented tests) plus discovered +13 undocumented counter table exhaustive tests in calculator.test.ts. All 25 new tests are well-designed and pass. CLAUDE.md updated to reflect actual count of 680 tests. All hard constraints verified clean. No engine code changes this round.

## Changes Reviewed

### QA Round 7: Melee Worked Example (match.test.ts:1208-1352, +6 tests)
Full deterministic trace: Duelist vs Duelist, P1 plays Measured Cut vs P2 Overhand Cleave, 3 rounds to Critical.

**Manual math verification (Round 1)**:
- P1 melee effective: MOM=65, CTL=70, GRD=65 (MC deltas applied) ✓
- P2 melee effective: MOM=80, CTL=50, GRD=55 (OC deltas applied) ✓
- Counter: MC beats OC → P1 bonus = 4+70*0.1 = 11.0 ✓
- P1 acc = 70+30-20+11 = 91.0 ✓
- P2 acc = 50+30-16.25-11 = 52.75 ✓
- P1 impact = 32.5+36.4-9.9 = 59.0 ✓
- P2 impact = 40+21.1-11.7 = 49.4 ✓
- Stamina: 60-10=50, 60-18=42 ✓

**Manual math verification (Round 2)**:
- P1 STA=50 ≥ 48 → ff=1.0, P2 STA=42 < 48 → ff=42/48=0.875 ✓
- P2 guardFF = 0.5+0.5*0.875 = 0.9375, P2 effGRD = 55*0.9375 = 51.5625 ✓
- P1 impact = 32.5+37.4-9.28 = 60.62 ✓
- P2 impact = 35+18.6-11.7 = 41.9 ✓

**Design quality**: Good counterintuitive finding documented — P1 impact *rises* R1→R2 because opponent guard fatigues faster than P1 momentum. Tests capture this correctly.

**Verdict**: APPROVED. All math verified correct.

### QA Round 7: Gear Extreme Boundary Tests (playtest.test.ts:990-1152, +6 tests)
- Uncommon vs giga differential: good edge case
- All-min stamina non-negative invariant: important safety test
- SoftCap validity with max giga gear: confirms formula works at extremes
- Min-max differential monotonicity across rarities: clean property test
- All-rarity min>max invariant: comprehensive (all 6 rarities)
- Max giga melee completion: confirms melee terminates even with extreme stats

**Verdict**: APPROVED. Well-chosen boundaries, no redundancy with existing tests.

### Undocumented: Counter Table Exhaustive Verification (calculator.test.ts:1757-1910, +13 tests)
Found 13 tests not reported in QA's Round 7 handoff but present in the working directory:

**Joust Counter Table (5 tests)**:
1. All 36 joust attack pairs resolve without error — bonus symmetry check
2. No mutual counters in joust table (no A beats B AND B beats A)
3. beats/beatenBy bidirectional consistency
4. Mirror matchups always zero bonus
5. Winner CTL isolation (loser CTL doesn't affect bonus)

**Melee Counter Table (5 tests)**: Same 5 categories for melee attacks.

**Counter Edge Cases (3 tests)**:
1. Negative effective CTL: 4+(-10)*0.1=3 ✓
2. Very large CTL (150): 4+150*0.1=19 ✓
3. Fractional CTL: dynamic BALANCE reference ✓

**Assessment**: High-quality tests. The beats/beatenBy consistency check is particularly valuable — it's a data integrity guard that would catch any counter table typos in attacks.ts. All tests use BALANCE constants dynamically. No hardcoded values.

**Verdict**: APPROVED.

### Polish Round 7: CSS Utility Classes (App.css, index.css)
- `.difficulty-selector`, `.loadout-mini` family: component classes for inline style migration
- `.text-p1`/`.text-p2`, `.text-small`/`.text-muted`/`.text-label`: typography utilities
- `mt-2`/`mt-4`/`mt-6`/`mb-2`/`mb-4`/`mb-6`: spacing utilities
- Consolidated duplicate `.winner-banner--victory` rule

**Verdict**: APPROVED. CSS-only, zero engine impact.

## Issues Found

### BLOCK
None.

### WARN
- **QA handoff discrepancy**: QA Round 7 handoff reports 667 tests (calculator.test.ts: 171). Actual working directory shows 680 tests (calculator.test.ts: 184). The +13 counter table tests are undocumented. This is a bookkeeping error, not a code quality issue — the tests themselves are excellent.

### NOTE
- **BL-027 status in backlog.json**: Still shows "assigned" but was completed in Round 7. Producer should mark done.

## Hard Constraint Verification

| Constraint | Status |
|------------|--------|
| Engine/UI separation | ✓ Zero cross-boundary imports |
| Constants centralized | ✓ All tuning in balance-config.ts |
| Stat pipeline order | ✓ base→steed→player→softCap→effective→fatigue |
| API stability | ✓ No signature changes |
| Type safety | ✓ No `any`, no `as` casts in production engine code |
| Deprecated resolvePass() | ✓ Not extended |

## Refactors Applied

- **CLAUDE.md**: Test count 655→680. Updated per-suite counts: calculator.test.ts 171→184, match.test.ts 77→83, playtest.test.ts 122→128. Updated descriptions to reflect new test categories (counter table exhaustive, joust/melee worked examples, gear boundaries).

## Tech Debt Filed

No new tech debt this round. Previous items remain (see handoff).

## Sign-off

**APPROVED**
Tests passing: 680/680 (7 suites, 0 failures)
