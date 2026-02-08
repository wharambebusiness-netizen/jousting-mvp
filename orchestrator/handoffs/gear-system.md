# Gear System Agent — Handoff

## META
- status: not-started
- files-modified:
- tests-passing: true
- notes-for-others: Will implement expanded 6-slot steed gear + new 6-slot player gear system, and integrate both into match creation. Depends on engine-refactor completing type changes first.

## Overview
You are responsible for implementing the expanded steed gear system (6 slots) and the entirely new player gear system (6 slots), then integrating both into match creation.

## File Ownership
You own these files (only you should edit them):
- `src/engine/gigling-gear.ts` (steed gear — expand from 3→6 slots)
- `src/engine/match.ts` (integrate player loadout)
- `src/engine/player-gear.ts` (NEW — create this file)
- `src/engine/gigling-gear.test.ts` (rewrite tests for 6-slot system)
- `src/engine/player-gear.test.ts` (NEW — create this file)

## Dependencies
- **WAIT for engine-refactor** to complete (status: complete or all-done) before starting
- Read their handoff for notes on type changes
- Check task-board.md for current status

## Primary Tasks

### Task 1: Expand Steed Gear to 6 Slots (gigling-gear.ts)

**Update `GEAR_SLOT_STATS`** to include all 6 steed slots with these stat mappings:

| Slot | Primary Stat | Secondary Stat | Thematic |
|---|---|---|---|
| chamfron | guard | momentum | Head armor — protection + charge |
| barding | guard | stamina | Body armor — protection + endurance |
| saddle | control | initiative | Seat — technique + reactions |
| stirrups | initiative | stamina | Balance — speed + endurance |
| reins | control | momentum | Steering — precision + direction |
| horseshoes | momentum | initiative | Traction — power + acceleration |

NOTE: The old slot was `chanfron` — the engine-refactor agent is renaming it to `chamfron` in types.ts. Make sure your code uses `chamfron`.

**Update `sumGearStats()`** to iterate over all 6 slots: chamfron, barding, saddle, stirrups, reins, horseshoes.

**Update `applyGiglingLoadout()`** — should work as before but now summing 6 slots.

**Update `createStatGear()`** — the `slot` parameter type expands to accept all 6 steed slots.

**Update `createFullLoadout()`** — creates all 6 steed gear pieces (was 3).

**Remove all caparison-related code**:
- Delete `CAPARISON_EFFECTS` record
- Delete `createCaparison()` function
- Delete `getCaparisonEffect()` function
- Remove caparison from `createFullLoadout()` — no more caparisonEffectId parameter

**Update function signatures** to use the new SteedGearSlot type from types.ts.

### Task 2: Create Player Gear System (NEW player-gear.ts)

Create `src/engine/player-gear.ts` with:

1. **`PLAYER_GEAR_SLOT_STATS`** — stat mappings for 6 player gear slots:

| Slot | Primary Stat | Secondary Stat | Thematic |
|---|---|---|---|
| helm | guard | initiative | Head protection + awareness |
| shield | guard | stamina | Impact absorption + endurance |
| lance | momentum | control | Weapon power + technique |
| armor | stamina | guard | Body protection + toughness |
| gauntlets | control | initiative | Grip/stability + reflexes |
| melee_weapon | momentum | stamina | Attack power + staying power |

2. **`createPlayerGear(slot, rarity, rng?)`** — creates a single player gear piece with randomized stats within rarity range. Uses `BALANCE.playerGearStatRanges`.

3. **`sumPlayerGearStats(loadout)`** — sums all 6 player gear piece bonuses.

4. **`applyPlayerLoadout(archetype, loadout?)`** — applies player gear bonuses to archetype stats (same pattern as applyGiglingLoadout but for player gear).

5. **`createFullPlayerLoadout(gearRarity, rng?)`** — creates all 6 player gear pieces at given rarity.

### Task 3: Integrate into Match Creation (match.ts)

Update `createMatch()` to accept player loadouts:

```typescript
export function createMatch(
  archetype1: Archetype,
  archetype2: Archetype,
  steedLoadout1?: GiglingLoadout,
  steedLoadout2?: GiglingLoadout,
  playerLoadout1?: PlayerLoadout,
  playerLoadout2?: PlayerLoadout,
): MatchState {
  // Apply steed gear (existing)
  let boosted1 = applyGiglingLoadout(archetype1, steedLoadout1);
  let boosted2 = applyGiglingLoadout(archetype2, steedLoadout2);
  // Apply player gear (new)
  boosted1 = applyPlayerLoadout(boosted1, playerLoadout1);
  boosted2 = applyPlayerLoadout(boosted2, playerLoadout2);
  // ... rest unchanged
}
```

Also:
- **Remove** all caparison tracking from match state creation (p1Caparison, p2Caparison, p1BannerUsed, p2BannerUsed)
- **Remove** `capInput()` helper function
- **Remove** caparison parameters from `submitJoustPass()` and `submitMeleeRound()` calls to phase resolution functions
- **Remove** Banner consumption tracking after phase resolution
- Import `applyPlayerLoadout` from player-gear.ts

### Task 4: Rewrite gigling-gear.test.ts

Rewrite tests for the new 6-slot steed gear system:
- Test all 6 slot→stat mappings (chamfron, barding, saddle, stirrups, reins, horseshoes)
- Test `sumGearStats()` with various slot combinations
- Test `applyGiglingLoadout()` with all 6 slots populated
- Test `createStatGear()` for all 6 slot types
- Test `createFullLoadout()` creates all 6 pieces
- Test rarity bonus still works correctly
- Test softCap interaction with expanded gear
- Verify NO caparison-related exports remain

### Task 5: Write player-gear.test.ts

Comprehensive tests for the new player gear system:
- Test all 6 slot→stat mappings
- Test `sumPlayerGearStats()` with various combinations
- Test `applyPlayerLoadout()` with all 6 slots and edge cases
- Test `createPlayerGear()` for all slot types at various rarities
- Test `createFullPlayerLoadout()` integration
- Test match creation with both steed AND player loadouts
- Test softCap interaction with combined steed + player gear
- Edge case: no loadout (should return archetype unchanged)
- Edge case: partial loadout (some slots empty)

### Task 6: Run Tests
Run `npx vitest run` and ensure all tests pass.

## Coordination Notes
- Engine-refactor agent is removing caparison types and updating GiglingLoadout in types.ts
- The `chanfron` slot is being renamed to `chamfron` — use the new spelling
- If match.ts has compile errors from engine-refactor's type changes, fix them here
- DO NOT modify types.ts unless absolutely necessary (engine-refactor owns it) — if you must, note it clearly
- If you need new types, ADD them at the end of types.ts with a clear comment, don't reorganize existing types

## Reference
- Read `gear-overhaul-milestones.md` for full design context
- Current gigling-gear.ts has the 3-slot system you're expanding
- Current match.ts shows how loadouts are integrated
- Balance ranges are in balance-config.ts (engine-refactor may have updated these)

## Stretch Goals
1. Add a `getStatSummary(steedLoadout, playerLoadout)` utility that returns a combined view of all gear bonuses
2. Validate gear: reject gear pieces where rarity doesn't match expected range
