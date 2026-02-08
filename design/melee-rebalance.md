# Melee Rebalancing Design

## Problem
Being unseated = guaranteed loss (~5-10% win rate). Three compounding penalties:

1. **Carryover stat penalties** (at margin 26): -8 MOM, -6 CTL, -5 GRD
2. **Stamina deficit**: Often 20-30 points behind → fatigue multiplier 0.6-0.8 vs 0.95-1.0
3. **Multiplicative collapse**: penalties × fatigue = ~35% total impact disadvantage

## Root Cause
`calcCarryoverPenalties()` in calculator.ts (lines 237-247):
```typescript
momentumPenalty: -Math.floor(unseatMargin / 3),  // too harsh
controlPenalty: -Math.floor(unseatMargin / 4),
guardPenalty: -Math.floor(unseatMargin / 5),
```

## Proposed Fix

### 1. Reduce carryover divisors by ~40%
```typescript
momentumPenalty: -Math.floor(unseatMargin / 5),  // was /3
controlPenalty: -Math.floor(unseatMargin / 6),   // was /4
guardPenalty: -Math.floor(unseatMargin / 8),      // was /5
```

At margin 26: penalties become (-5, -4, -3) instead of (-8, -6, -5).

### 2. Add unseated counter bonus (15% impact boost)
- Add `wasUnseated?: boolean` to PlayerState in types.ts
- Set flag in match.ts `transitionToMelee()`
- In phase-melee.ts `resolveMeleeRoundFn()`: multiply unseated player's impact by 1.15

### Target
- Unseated win rate: ~5-10% → ~15-20%
- Unseater should still win ~60-65% of melee
- Unseating should matter, just not be automatic

## Files to Modify
1. `types.ts` — add wasUnseated flag
2. `calculator.ts` — change divisors in calcCarryoverPenalties()
3. `match.ts` — set wasUnseated flag in transitionToMelee()
4. `phase-melee.ts` — apply 15% boost in resolveMeleeRoundFn()

## Tests to Update
- calculator.test.ts: ~20 carryover assertion updates + 10 new unseated bonus tests
- match.test.ts: ~15 melee carryover updates + 5 new wasUnseated flag tests
- playtest.test.ts: ~10 win rate range updates

## Cross-System Notes
- Gear variants (CTL-heavy weapons) amplify counter bonus slightly (+0.2 per round) — synergistic
- Higher gear tiers reduce fatigue gap by ~50% (Bare→Giga) — carryover is primary lever
- Consider making the 1.15 boost configurable in balance-config.ts
