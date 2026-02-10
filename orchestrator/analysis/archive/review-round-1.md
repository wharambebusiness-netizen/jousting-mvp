# Code Review — Round 1

## Summary

Full engine audit for BL-009 (magic number centralization). The codebase is in excellent shape — all tuning constants are properly centralized in `balance-config.ts`. Found 5 formula coefficients in `calculator.ts` and 2 structural constants in `match.ts`/`calculator.ts` that are inline numbers but are **formula-structural**, not balance-tuning values. No blockers. One medium-priority item worth discussing.

## BL-009 Audit: Magic Numbers in Engine Code

### Files Audited
- `src/engine/balance-config.ts` — 30+ tuning constants, all well-documented
- `src/engine/calculator.ts` — core math (429 lines)
- `src/engine/phase-joust.ts` — joust resolution (241 lines)
- `src/engine/phase-melee.ts` — melee resolution (123 lines)
- `src/engine/match.ts` — state machine (323 lines)
- `src/engine/attacks.ts` — attack/speed data tables (176 lines)
- `src/engine/archetypes.ts` — archetype definitions (70 lines)
- `src/engine/gigling-gear.ts` — steed gear (173 lines)
- `src/engine/player-gear.ts` — player gear (187 lines)
- `src/engine/gear-utils.ts` — shared gear utilities (20 lines)
- `src/engine/gear-variants.ts` — 36 variant definitions (124 lines)
- `src/engine/types.ts` — type definitions (247 lines)

### Constants Already Centralized (BALANCE object)
All of these are in `balance-config.ts` and referenced via `BALANCE.*`:
- softCapKnee, softCapK
- fatigueRatio, guardFatigueFloor
- counterBaseBonus, counterCtlScaling
- guardImpactCoeff, guardUnseatDivisor
- breakerGuardPenetration
- shiftSameStanceCost, shiftCrossStanceCost, shiftSameStanceInitPenalty, shiftCrossStanceInitPenalty
- meleeHitBase, meleeHitGrdScale, meleeCritBase, meleeCritGrdScale
- carryoverDivisors (momentum, control, guard)
- unseatedImpactBoost, unseatedStaminaRecovery
- meleeWinsNeeded, criticalWinsValue
- giglingRarityBonus (6 tiers)
- aiDifficulty (3 tiers), aiPattern
- gearStatRanges (6 tiers), playerGearStatRanges (6 tiers)

### Inline Numbers Found (Not in balance-config.ts)

#### calculator.ts — Formula Coefficients
1. **Line 138**: `effInitiative / 2` — Accuracy formula: INIT contribution divisor
2. **Line 138**: `opponentEffMomentum / 4` — Accuracy formula: opponent MOM divisor
3. **Line 153**: `effMomentum * 0.5` — ImpactScore: MOM weight
4. **Line 153**: `accuracy * 0.4` — ImpactScore: accuracy weight
5. **Line 161**: `defenderCurrentStamina / 20` — Unseat threshold: STA contribution divisor
6. **Line 161**: `20 +` — Unseat threshold: base value

#### match.ts — Structural Constants
7. **Line 24**: `MAX_PASSES = 5` — max joust passes per match

#### calculator.ts — Shift Eligibility
8. **Line 209**: `currentStamina >= 10` — minimum stamina to shift

## Issues Found

### WARN
- **[calculator.ts:138] Accuracy formula coefficients (INIT/2, oppMOM/4) are inline.** These are weight constants (`0.5` and `0.25` effectively) that control how much initiative and opponent momentum matter relative to control. They're not in `balance-config.ts`. **Assessment**: These are deep formula coefficients that have never been tuned and rarely need changing. Moving them would add complexity for no current benefit. If the balance analyst ever needs to tune accuracy weighting, they should be extracted then. **Verdict**: Leave as-is for now, note for future.

- **[calculator.ts:153] Impact formula weights (MOM*0.5, ACC*0.4) are inline.** Same reasoning — deep formula weights. The `guardImpactCoeff` (0.18) was already extracted because it was actively tuned. The MOM and ACC weights have been stable since v1. **Verdict**: Leave as-is, extract only if tuning is needed.

- **[calculator.ts:161] Unseat threshold base (20) and STA divisor (/20) are inline.** The base `20` and STA contribution `/20` have never been tuned (only `guardUnseatDivisor` was extracted when it was changed from 10→15). **Verdict**: Leave as-is, extract if needed.

- **[calculator.ts:209] Shift stamina minimum (10) is inline.** This is a game-design constant controlling when a shift can happen. It's referenced in exactly one place. **Verdict**: Could be extracted to `BALANCE.shiftMinStamina` for consistency, but low priority since it's never been tuned.

- **[match.ts:24] MAX_PASSES (5) is a local constant, not in BALANCE.** This is a structural game rule (5 joust passes), not a balance-tuning knob. It's already a named constant. **Verdict**: Leave as-is — it's structural, not a balance lever.

### NOTE
- **[types.ts:178] CounterResult comment says "+10, -10, or 0"** — this is outdated since counter bonuses now scale with CTL (4 + CTL*0.1, not flat 10). The comment is misleading but the code is correct. **Suggestion**: Update comment to reflect scaled bonus.

## Refactors Applied

None this round. No changes were needed — the codebase is clean.

## General Quality Assessment

### Engine/UI Separation
Verified: all engine files (`src/engine/`) import exclusively from within `src/engine/`. Zero imports from `src/ui/` or `src/ai/`. Clean separation maintained.

### Type Safety
- No `any` types in engine code
- No `as` type assertions in engine code
- Proper use of discriminated unions (Phase, MeleeOutcome, Stance, SpeedType)
- `satisfies` not used but not needed — `as const` on BALANCE is appropriate

### API Stability
- All public signatures in match.ts, calculator.ts, phase-joust.ts, phase-melee.ts are stable
- `resolvePass()` properly marked `@deprecated`
- No breaking changes detected

### Stat Pipeline
Verified correct order: base → applyGiglingLoadout (rarity + gear) → applyPlayerLoadout (gear only, no rarity) → softCap in combat → fatigue in combat. Pipeline is intact.

### Duplicated Logic
- Breaker detection (`archetype.id === 'breaker'`) appears in 3 places: calculator.ts:355-356, phase-joust.ts:164-165, phase-melee.ts:71-72. This is acceptable — each is in its own resolution function. Extracting would over-abstract.
- Unseat resolution logic (double-unseat tiebreaker) is duplicated between calculator.ts:374-390 and phase-joust.ts:183-197. This is expected since `resolvePass()` is deprecated and `resolveJoustPass()` is the active path. No action needed.

## Tech Debt Filed

- **[LOW] Extract accuracy/impact formula weights to balance-config.ts** — Only if the balance analyst needs to tune MOM/ACC/INIT weights in the accuracy or impact formulas. Currently stable, not worth the churn. Estimated effort: S
- **[LOW] Extract unseat threshold base (20) and STA divisor (20)** — Same rationale. Estimated effort: S
- **[LOW] Update CounterResult comment in types.ts** — Stale comment referencing flat ±10 instead of scaled bonus. Estimated effort: XS

## Sign-off

**APPROVED** — Codebase is clean. All tuning constants that have ever been tuned are in `balance-config.ts`. The remaining inline numbers are formula-structural coefficients that have been stable since v1 and don't need extraction yet.

Tests passing: 477/477
