# Code Review — Round 6

## Summary

Quiet round — QA and polish are `all-done`, balance-tuner and producer completed stretch goals (analysis only). No engine code changes this round. QA's Round 5 stale comment fixes and BL-019 mirror tests verified clean. CLAUDE.md test counts updated (647→649). All 649 tests passing. BL-025 (Bulwark stat redistribution) still pending — not yet applied.

## Changes Reviewed

### QA: Stale Comment Fixes (calculator.test.ts) — APPROVED
- **Line 1616**: Comment updated from `0.20 * 0.18` to dynamic `breakerGuardPenetration * guardImpactCoeff`. Correct — references BALANCE constants by name.
- **Line 1643**: Test name updated from `0.20` to `guardPenetration%`. Correct — generic, won't go stale on future changes.
- **Lines 1646-1651**: Manual verification comments updated to use dynamic BALANCE references. Clean.
- All three stale comments flagged in Round 5 review now fixed.

### QA: BL-019 Mirror Bias Tests (playtest.test.ts:911-988) — APPROVED
- `runMirrorBatch()` helper: well-designed, uses seeded RNG per match, deterministic overall. Safety limits on both joust (10 passes) and melee (30 rounds) loops.
- Tactician mirror N=500 test: 40-60% P1 win rate band is appropriate for this sample size.
- All 6 archetype mirrors N=500 test: 35-65% band is wider to accommodate attack-order sensitivity. Good reasoning in comments.
- Uses existing `makeRng()` pattern from the file. Consistent style.
- **NOTE**: The `rng2` in the melee loop (line 945) creates a new RNG per round, which means attack selection isn't correlated across rounds. This is intentional — avoids deterministic cycling artifacts.
- BUG-002 properly closed.

### Phase-resolution.test.ts:424 — VERIFIED
- Comment now reads "guardImpactCoeff (from BALANCE)" — generic, correct. Was fixed in a prior round, confirmed still clean.

## Issues Found

### BLOCK
- None.

### WARN
- [CLAUDE.md] Test counts were stale (647 vs actual 649). **Fixed this round** — updated both the quick reference and test suite section. Per-file: calculator.test.ts 169→171.
- [BL-025 not applied] Bulwark stat redistribution (CTL 55→52, MOM 55→58) is still pending. Balance-tuner completed analysis in Round 5 but did not apply the change. Producer assigned BL-025 but no agent has executed it. This is the primary remaining balance concern (Bulwark 60-63% at bare/uncommon).

### NOTE
- [calculator.test.ts:1649] The `0.2` hardcoded in `calcImpactScore(60, 50, 65, 0.2)` is a test input (penetration fraction for this specific test case), not a stale reference to the old breakerGuardPenetration value. This is correct — the test verifies the formula with an arbitrary 20% penetration input, and the assertion uses `BALANCE.guardImpactCoeff` dynamically.
- [playtest.test.ts:975] The seed calculation `1000 + name.length * 100` means some archetypes share seeds (e.g., "charger" and "breaker" both have length 7). Not a problem for correctness (different archetype stats produce different outcomes) but worth noting for reproducibility.
- [balance-config.ts] The `unseatStaminaDivisor` (`/20` in calculator.ts:161) remains inline. This is a known structural constant, but if it ever becomes a tuning lever, it should be extracted to balance-config.ts. Filed as tech debt in prior rounds.

## Refactors Applied

- [CLAUDE.md] Updated test counts: 647→649 total, calculator.test.ts 169→171.

## Tech Debt Filed

- BL-025 not applied: Bulwark stat redistribution still pending — estimated effort: S (change 2 values in archetypes.ts, fix 1 test in calculator.test.ts, run sims)
- Missing multi-pass worked example (BL-023) — estimated effort: M
- gear-variants BL-004 deterministic cycling tests fragile to stat changes — estimated effort: M
- unseatStaminaDivisor inline in calculator.ts — estimated effort: S (extract to balance-config.ts if tuning needed)

## Sign-off

**APPROVED** — No new code changes to review from other agents this round. QA's Round 5 test additions (stale comment fixes + BL-019 mirror tests) are clean. CLAUDE.md updated. Working directory is clean (no unauthorized engine changes, Round 5 corruption resolved).

Tests passing: 649/649 (7 suites, 0 failures)
