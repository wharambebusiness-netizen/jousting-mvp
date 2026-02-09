# Code Review — Round 7

## Summary

BL-025 (Bulwark MOM 55→58, CTL 55→52) confirmed applied and clean. BL-023 multi-pass worked example adds 6 well-designed tests to match.test.ts. BL-026 stale comment fixes verified complete. All 655 tests passing. CLAUDE.md updated with post-redistribution balance state, test counts, and per-archetype win rates. No new issues found.

## Changes Reviewed

### Balance-Tuner: BL-025 Bulwark Stat Redistribution (archetypes.ts) — APPROVED
- **archetypes.ts:30-31**: Bulwark `momentum: 58, control: 52` (was 55/55). Total remains 290 (58+52+65+53+62=290). Correct.
- **calculator.test.ts:805**: Giga Bulwark test archetype updated `momentum: 71, control: 65` (was 68/68). Math: 58+13=71, 52+13=65. Correct.
- **Balance impact**: Uncommon Bulwark 63.7%→58.5% (-5.2pp). Bare remains ~62% (structural, GRD=65-driven). Giga neutral. Strong improvement at the key tier.
- **Test impact**: Zero cascade — Bulwark MOM/CTL confirmed not test-locked. Only the Giga Bulwark test construct needed updating (cosmetic).

### QA: BL-023 Multi-Pass Worked Example (match.test.ts:1049-1206) — APPROVED
- **6 new tests**: Tactician vs Duelist, 5 passes, Standard+CdL, no unseat. Well-chosen matchup — goes full 5 passes, fatigue kicks in at Pass 3, Duelist wins on cumulative.
- **Math verified manually**:
  - Effective stats: Tactician (60/75/55/85), Duelist (65/70/65/70) with CdL deltas. Correct.
  - Accuracy: P1=101.25 (75+42.5-16.25), P2=90 (70+35-15). Correct.
  - Impact: P1=58.80 (30+40.5-11.7), P2=58.60 (32.5+36-9.9). Correct.
  - Fatigue thresholds: Tactician=44, Duelist=48. Pass 2 stamina (45/50) above thresholds. Pass 3 stamina (35/40) below. Correct.
- **Design quality**: Good test structure — each pass verifies specific mechanics (no fatigue, identical passes, fatigue onset, deepening fatigue, monotonic decrease). Comments include derivation.

### QA: BL-026 Stale Comment Fixes — VERIFIED
- **phase-resolution.test.ts:424**: Generic reference to "guardImpactCoeff (from BALANCE)". Clean. No remaining `0.35` or `0.2` stale references.
- **calculator.test.ts:805**: Giga Bulwark values updated (covered above).
- **calculator.test.ts:1616, 1643**: Already fixed in Round 5. Confirmed still clean. The `0.2` at lines 1376/1649 are test inputs (function args), not stale constant references.

### Balance-Tuner: Round 6 Analysis Report — APPROVED
- Thorough: 5 tiers, 2 confirmation runs at bare/uncommon for noise assessment, ~50K matches total.
- Correctly identifies bare Bulwark as structural/accepted and uncommon as the actionable improvement.
- Correctly flags new borderline items (Duelist uncommon 55.1%, Breaker giga 56.1%) without over-reacting.

### CLAUDE.md Updates (This Round)
- Test counts: 649→655 total, match.test.ts 71→77.
- Balance state: Added Bulwark MOM/CTL change to archetype changes line. Added full per-archetype win rates at bare/uncommon/giga. Documented uncommon improvement (63%→58%).

## Issues Found

### BLOCK
- None.

### WARN
- None.

### NOTE
- **[match.test.ts:1083-1093] Effective stat comments say "raw" but include CdL deltas**. Comment says "Tactician raw: MOM=60" but 60 = base 55 + CdL delta +5. This is "effective after attack deltas", not "raw". Cosmetic — the assertions are correct. Low priority.
- **[QA Round 6 report] Claims test count 649→655** but prior round handoffs said 649. The delta is correct (+6 from BL-023), but the report should have noted this was the first increase since Round 5 (647→649 was from stale comment fix tests).
- **Technician persistent weakness**: 44-47% across all tiers. Balance-tuner flagged MOM 58→61 as future priority. No action needed this round.

## Hard Constraint Verification

- **Engine/UI separation**: PASS. Zero cross-boundary imports in engine code.
- **Constants centralized**: PASS. All balance constants in balance-config.ts. No new hardcoded constants.
- **Stat pipeline order**: PASS. base → steed → player → softCap → effective → fatigue. No shortcuts.
- **API stability**: PASS. No breaking changes to public function signatures.
- **Type safety**: PASS. No `any` or `as` casts in engine code (except `as const` on BALANCE config).
- **Deprecated resolvePass()**: PASS. Not extended or modified.

## Refactors Applied

- **CLAUDE.md**: Updated test counts (649→655), match.test.ts count (71→77), added per-archetype win rates to balance state, documented Bulwark MOM/CTL change.

## Tech Debt Filed

- **Technician weakness (44-47%)**: Balance-tuner suggested MOM 58→61 in future session. Need test-impact assessment first. Estimated effort: M.
- **match.test.ts:1083 "raw" comment**: Minor — says "raw" but means "effective after attack deltas". Estimated effort: S.
- **gear-variants BL-004 deterministic cycling tests**: Still fragile to stat changes (N=30). Carried from prior rounds. Estimated effort: M.

## Sign-off

**APPROVED**

All Round 6 changes are clean. BL-025 (Bulwark stat redistribution) is the highest-value balance change available within test-safe constraints, and it's been applied correctly with zero test breakage. BL-023 multi-pass worked example fills the previously identified coverage gap with well-verified math. CLAUDE.md is now current.

Tests passing: 655/655 (7 suites, 0 failures)
