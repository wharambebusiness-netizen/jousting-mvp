# Code Review — Round 3

## Summary

All 605 tests passing (7 suites). No new engine structural issues. The Round 2 BLOCK (match.test.ts:78 flipped assertion) was resolved by QA's rewrite of the worked example to account for both the Technician MOM and Charger INIT/STA changes — the assertion is now correct. Balance-tuner's Round 3 change (breakerGuardPenetration 0.20→0.25) is clean, well-documented, and safe. One stale comment fixed in balance-config.ts. LoadoutScreen.tsx inline style removal (BL-016) is clean. Codebase is in good shape.

## Changes Reviewed

### balance-tuner: breakerGuardPenetration 0.20→0.25 (balance-config.ts)
- **Change**: Single constant change in balance-config.ts, BL-003
- **Assessment**: Clean and safe. Comment on line 56 was updated to match (`0.25 = 25% guard ignored`). No hardcoded test references to `0.20` or `breakerGuardPenetration` — all tests use `BALANCE.breakerGuardPenetration`. All 605 tests pass without modification. This is exactly how balance constants *should* work — centralized and test-safe.
- **Impact**: Breaker gets 25% guard penetration (up from 20%), strengthening its anti-tank role. Analysis in `breaker-balance-round-3.md` shows Breaker vs Bulwark at giga improves. However, note that the analysis report references an *older* session's Round 3 where the change was 0.25→0.20 (the reverse). The current state has breakerGuardPenetration at 0.25, which is the balance-tuner's BL-003 assessment result.

### QA: Test maintenance (calculator.test.ts, match.test.ts, gigling-gear.test.ts, playtest.test.ts)
- **Assessment**: QA fixed all 18 test failures from Round 1-2 balance changes. The match.test.ts worked example was rewritten to be a 2-pass unseat scenario (Charger unseats Technician in Pass 2), which correctly reflects the new Charger STA=65 making it more resilient. The assertion at line 78 (`p1.player2.impactScore > p1.player1.impactScore`) is now correct because with Charger INIT=55, Technician's INIT=60 gives it enough of an accuracy edge to narrowly win Pass 1 impact. Round 2 BLOCK is **resolved**.
- 16 new tests added (6 softCap boundary + 10 exploratory). All well-structured.

### BL-016: LoadoutScreen.tsx inline style removal (uncommitted)
- **Assessment**: Clean change. Removes the `VARIANT_COLORS` constant (lines 57-61 in original) and the `style={...}` prop on variant-toggle buttons (line 199). This allows CSS stance tokens from BL-008 to control colors fully. No functional impact — purely a CSS delegation change.
- **NOTE**: This file is `src/ui/LoadoutScreen.tsx`, outside engine scope. No engine impact.

### balance-config.ts: Stale comment (fixed by reviewer)
- **Change**: Line 22 comment said "Charger (STA 60) threshold = 48" — updated to "Charger (STA 65) threshold = 52" to match the Round 2 Charger INIT/STA swap.

## Hard Constraint Checks

### Engine/UI Separation ✅
- Zero imports from `src/ui/` or `src/ai/` in any `src/engine/*.ts` file
- Confirmed via `grep import.*from.*ui|import.*from.*ai` across engine directory

### Balance Constants Centralized ✅
- `breakerGuardPenetration` change was in `balance-config.ts` (correct location)
- No new hardcoded constants introduced in resolvers
- All BALANCE constants referenced via `BALANCE.*` in engine code

### Stat Pipeline Order ✅
- No changes to pipeline code (base → steed gear → player gear → softCap → fatigue)
- `createMatch()` still applies `applyGiglingLoadout` then `applyPlayerLoadout` in correct order

### API Stability ✅
- No changes to public function signatures in match.ts, calculator.ts, phase-joust.ts, phase-melee.ts
- `resolvePass()` deprecation notice still in place, not extended

### Type Safety ✅
- Zero `any` types in engine source files
- Zero `as` casts in engine source files (only `as const` in test files — acceptable)
- All gear slot mappings remain exhaustive via `Record<>` typing

## Issues Found

### BLOCK
None.

### WARN
- **[balance-config.ts:56] Comment says `0.25` but CLAUDE.md still documents `0.20`.** The CLAUDE.md "Balance State" section references `breakerGuardPenetration 0.20` — this is now stale. Should be updated to 0.25. Not a code issue, but misleading for agents reading project docs.

### NOTE
- **[Coordination] `breaker-balance-round-3.md` describes OPPOSITE direction of current change.** The analysis report describes changing penetration from 0.25→0.20, but the current session's change went 0.20→0.25. This is confusing for future agents reading analysis history. The analysis file is from a prior orchestrator session, not this one.
- **[BUG-002] Tactician mirror P1 bias still open.** QA notes ~36% vs 64% P1 win rate in Tactician mirror. Needs higher sample size to confirm vs Monte Carlo noise. Not blocking but worth investigating.
- **[match.test.ts] Worked example now ends at Pass 2 with unseat.** The original 3-pass/5-pass joust scenario was a better integration test because it exercised more passes. The new 2-pass unseat is correct for current stats but provides less multi-pass coverage. Consider adding a separate 5-pass no-unseat worked example in a future QA round.

## Refactors Applied

- **[balance-config.ts:22]** Updated stale comment: `Charger (STA 60) threshold = 48` → `Charger (STA 65) threshold = 52`. Comment-only change, zero test impact.

## Tech Debt Filed

- **[SMALL] Update CLAUDE.md balance state section** — `breakerGuardPenetration 0.20` should be `0.25`. Other balance references may also be stale after this session's changes.
- **[MEDIUM] Test-locked archetype stats** — Still the main maintenance burden. Every balance change cascades to 10+ test assertions. Consider test helpers that reference source data. Carried forward from Round 2.
- **[SMALL] Missing multi-pass worked example** — After the match.test.ts rewrite, there's no 5-pass integration test anymore. Would be valuable for regression coverage of fatigue progression across passes.

## Sign-off

**APPROVED** — All 605 tests passing, no blocking issues, engine constraints satisfied. One WARN about stale CLAUDE.md documentation.

Tests passing: 605/605
