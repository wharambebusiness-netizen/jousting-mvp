# API Reference

Key function signatures for the jousting engine. See source files for full documentation.

## Match Creation & Flow

```typescript
// Create a match — ALL 6 args positional (use undefined for empty gear slots)
createMatch(arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?): MatchState

// Submit joust pass (speed + attack for each player)
submitJoustPass(state, p1Choice, p2Choice): MatchState

// Submit melee round (attack for each player)
submitMeleeRound(state, p1Attack, p2Attack): MatchState
```

## Gear Creation

```typescript
// Steed gear
createStatGear(slot, rarity, rng?, variant?): StatGear
createFullLoadout(gigRarity, gearRarity, rng?, variant?): GiglingLoadout

// Player gear
createPlayerGear(slot, rarity, rng?, variant?): PlayerGear
createFullPlayerLoadout(gearRarity, rng?, variant?): PlayerLoadout
```

## Gear Application

```typescript
applyGiglingLoadout(archetype, loadout?): Archetype    // Adds flat rarity bonus to ALL stats
applyPlayerLoadout(archetype, loadout?): Archetype      // NO rarity bonus (slot bonuses only)
```

## Phase Resolution

```typescript
// Joust — use this, NOT resolvePass() from calculator.ts (deprecated)
resolveJoustPass(passNum, p1State, p2State, p1Choice, p2Choice): PassResult

// Melee
resolveMeleeRoundFn(roundNum, p1State, p2State, p1Attack, p2Attack): MeleeRoundResult
```

## Combat Math

```typescript
softCap(value): number                           // Diminishing returns above knee=100
fatigueFactor(currentStamina, maxStamina): number // REQUIRES both args
computeEffectiveStats(archetype, speed, attack, currentStamina, ...): EffectiveStats
resolveCounters(attack1, attack2, eff1Ctl?, eff2Ctl?): CounterResult  // bonus = 4 + winnerCTL*0.1
calcAccuracy(effControl, effInitiative, oppMomentum, counterBonus): number
calcImpactScore(effMomentum, accuracy, oppGuard, guardPenetration?): number
checkUnseat(atkImpact, defImpact, defGuard, defStamina): { unseated, margin, threshold }
```

## AI

```typescript
aiPickJoustChoiceWithReasoning(player, lastAtk?, oppAtk?, difficulty?): { choice, reasoning }
aiPickMeleeAttackWithReasoning(player, lastAtk?, difficulty?): { attack, reasoning }
```

Originals without reasoning: `aiPickJoustChoice()`, `aiPickMeleeAttack()`.

## Programmatic Usage Example

```typescript
import { ARCHETYPES } from './engine/archetypes';
import { createMatch, submitJoustPass, submitMeleeRound } from './engine/match';
import { createFullLoadout } from './engine/gigling-gear';
import { createFullPlayerLoadout } from './engine/player-gear';
import { JOUST_ATTACKS, MELEE_ATTACKS, SPEEDS } from './engine/attacks';

const steed1 = createFullLoadout('epic', 'epic');
const steed2 = createFullLoadout('epic', 'epic');
const player1 = createFullPlayerLoadout('epic');
const player2 = createFullPlayerLoadout('epic');

let state = createMatch(
  ARCHETYPES.charger, ARCHETYPES.bulwark,
  steed1, steed2, player1, player2
);

while (state.phase === 'SpeedSelect' || state.phase === 'AttackSelect') {
  state = submitJoustPass(state,
    { speed: SPEEDS.fast, attack: JOUST_ATTACKS.coupFort },
    { speed: SPEEDS.standard, attack: JOUST_ATTACKS.portDeLance }
  );
}

while (state.phase === 'MeleeSelect') {
  state = submitMeleeRound(state, MELEE_ATTACKS.overhandCleave, MELEE_ATTACKS.guardHigh);
}

console.log(`Winner: Player ${state.winner}, Reason: ${state.winReason}`);
```
