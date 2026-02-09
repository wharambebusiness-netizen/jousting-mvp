# Code Review — Round 4

## Summary

Clean round. All Round 3 changes are sound: QA's 42 new tests are well-designed with good edge case coverage, balance-tuner's `breakerGuardPenetration` 0.25 change is correct and safe, and polish's inline style removal + new CSS animations are non-invasive. No blocking issues. All 647 tests pass.

## Issues Found

### BLOCK
- None.

### WARN
- **[calculator.test.ts:1616] Stale comment references old penetration value.** Comment says `opponent_guard * 0.20 * 0.18` but `BALANCE.breakerGuardPenetration` is now `0.25`. The test logic on line 1618 correctly uses `BALANCE.breakerGuardPenetration` (not hardcoded), so the test is functionally correct. Only the comment is stale. Fix: update comment to `opponent_guard * 0.25 * 0.18` or just `opponent_guard * breakerGuardPenetration * guardImpactCoeff`.
- **[calculator.test.ts:1643] Stale test name references old value.** Test is named "Breaker penetration 0.20 removes exactly 20%" but the config value is now 0.25. The test itself (lines 1650-1655) intentionally uses a hardcoded 0.2 to test the `calcImpactScore` formula with a specific input — this is valid unit test design. But the test name is misleading. Fix: rename to "Breaker penetration formula: 20% input removes exactly 20% of guard".

### NOTE
- **[playtest.test.ts:806-828] Unseated recovery test is conditional.** The test plays 5 joust passes hoping for an unseat but wraps the verification in `if (match.phase === Phase.MeleeSelect)`. If no unseat occurs, the test passes vacuously. This is acceptable for a smoke test but provides no guarantee. A stronger test would construct a scenario that deterministically unseats (e.g., Charger Fast+CF vs Duelist Standard+PdL for several passes, which reliably unseats at current stats). QA could strengthen this in a future round.
- **[playtest.test.ts:834-850] Balance config verification tests are tautological.** Tests like `expect(BALANCE.carryoverDivisors.momentum).toBe(6)` just assert config values match hardcoded expectations. These are snapshot tests — they'll catch accidental changes but provide no correctness verification. They also become maintenance burden when values are intentionally changed. Consider using a schema validation approach instead. Low priority.
- **[LoadoutScreen.tsx:374, MeleeTransition.tsx:41] Remaining inline styles.** CSS artist noted two remaining inline styles. These are minor cosmetic issues for a future UI dev round.

## Agents Reviewed

### Balance Analyst (Round 3)
- **breakerGuardPenetration 0.20→0.25**: APPROVED. Clean single-constant change in `balance-config.ts`. Comment on line 56 updated correctly. No test-locked references. 605→647 tests all pass. The 7-tier sweep data in `balance-tuner-round-3.md` is thorough and well-documented.
- Balance analysis quality is excellent — proper methodology, multiple tier comparisons, clear reasoning for 0.25 over 0.30.

### QA Engineer (Round 3)
- **BL-006 (10 tests)**: Well-designed boundary tests. Fatigue threshold, negative stamina, guard fatigue interpolation monotonicity, stamina clamping at speed/attack boundaries — all correct.
- **BL-012 (9 tests including existing 5)**: Penetration tests cover all defenders, melee phase, non-breaker zero-pen, breaker mirror symmetry. One stale comment (see WARN above). The formula verification test at line 1643 correctly tests `calcImpactScore` with a specific input value (0.2), independent of config — this is sound.
- **Exploratory tests (23 tests)**: Good breadth — zero-stamina melee (36 combos), all 9 speed combos, variant loadout stress, player gear no-rarity-bonus, unseated mechanics, melee attack combos. The all-36-melee-attack test at line 730 is a thorough brute-force correctness check.
- Test count: 605 → 647 (+42). All passing.

### CSS Artist (Round 3)
- **BL-016 inline style removal**: Clean change. `VARIANT_COLORS` constant removed from LoadoutScreen.tsx. CSS stance tokens now control all variant toggle colors. No engine impact.
- **Melee transition animation**: CSS-only, no engine coupling.
- **Winner banner polish + btn--outline**: CSS-only changes. prefers-reduced-motion support included.
- No issues.

## Hard Constraint Verification

| Constraint | Status |
|------------|--------|
| Engine/UI separation (zero cross-boundary imports) | PASS |
| All tuning constants in `balance-config.ts` | PASS |
| Stat pipeline order preserved | PASS |
| Public API signatures stable | PASS |
| `resolvePass()` not extended | PASS (still deprecated, used only for unit tests) |
| No `any` or `as` casts in engine | PASS |
| Type safety (discriminated unions, narrowing) | PASS |

## Refactors Applied

None this round. No changes needed.

## Tech Debt Filed

- **Stale BL-012 test comments** — references to `0.20` should be `0.25` or use `BALANCE.breakerGuardPenetration`. Estimated effort: S (5 min). QA should fix.
- **Conditional unseated recovery test** — could be made deterministic. Estimated effort: S.
- **CLAUDE.md balance state outdated** — `breakerGuardPenetration` listed as `0.20` should be `0.25`. `Charger INIT=55/STA=65` not reflected. Flagged in Round 3, still not updated. Estimated effort: S.
- **gear-variants BL-004 fragility** (from producer Round 3): deterministic cycling tests at N=30 will break on any future stat change. Estimated effort: M (redesign test approach).

## Sign-off

**APPROVED WITH NOTES**

Minor issues only — two stale comments in BL-012 tests, one conditional test, CLAUDE.md still outdated. No blocking problems. Engine integrity is solid across all hard constraints.

Tests passing: 647/647 (7 suites, 0 failures)
