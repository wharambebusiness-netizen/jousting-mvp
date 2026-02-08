# Jousting MVP — Session 12 Handoff

## Working Style
- User wants full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Generate handoff at session end

## Session 12 Summary
**Focus:** Implemented all 6 caparison effect hooks into the combat pipeline + gear factory functions for random gear generation. Wrote 53 new tests (38 caparison + 15 factory).

### What Was Done

#### 1. Balance Config — Caparison Constants + Gear Stat Ranges
**File:** `balance-config.ts`

Added two new sections to the BALANCE const:
- `caparison` — tunable values for all 6 effects:
  - `hasteInitBonus: 2` (Pennant of Haste)
  - `shieldclothGuardBonus: 3` (Woven Shieldcloth)
  - `thunderweaveMomBonus: 4` (Thunderweave)
  - `irongripShiftReduction: 5` (Irongrip Drape)
  - `stormcloakFatigueReduction: 0.05` (Stormcloak)
  - `gigaBannerCounterMultiplier: 1.5` (Banner of the Giga)
- `gearStatRanges` — per-rarity [min, max] ranges for primary/secondary stat rolls

#### 2. Types — Caparison Pipeline Types
**File:** `types.ts`

- Added `CaparisonInput` interface (effect + bannerUsed flag)
- Added to `MatchState`: `p1Caparison`, `p2Caparison`, `p1BannerUsed`, `p2BannerUsed`
- Added to `PassResult` and `MeleeRoundResult`: `p1BannerConsumed`, `p2BannerConsumed`

#### 3. Caparison Effect Hooks — phase-joust.ts
**Complete rewrite** (same logic, added caparison layer)

Key design: **Option B from S11 handoff** — effects applied at orchestration layer, calculator stays pure.

- `adjustArchetypeForCaparison()` — creates temporary archetype with stat bonuses:
  - Pennant of Haste: +INIT when passNumber === 1
  - Thunderweave: +MOM when speed === Fast
  - Woven Shieldcloth: +GRD when finalAttack.stance === Defensive (only with finalAttack param)
  - Stormcloak: adjusts `archetype.stamina` to simulate lower fatigue ratio
- Pre-shift archetype: applies pennant/thunderweave/stormcloak (no attack-dependent effects)
- Final archetype: applies all effects including shieldcloth based on final attack
- Irongrip Drape: creates adjusted SpeedData with reduced `shiftThreshold`
- Banner of the Giga: post-processes counter bonuses, multiplies by 1.5 on first win
- Function signature: `resolveJoustPass(..., p1Cap?: CaparisonInput, p2Cap?: CaparisonInput)`

#### 4. Caparison Effect Hooks — phase-melee.ts
Same pattern, simpler (fewer applicable effects):
- `adjustArchetypeForMelee()` — only Shieldcloth and Stormcloak
- Banner of the Giga: same counter boost logic
- Pennant/Thunderweave/Irongrip: joust-only (no speed/shifts/passes in melee)

#### 5. Match State Machine — match.ts
- `createMatch()` now extracts caparison effects from loadouts via `getCaparisonEffect()`
- `capInput()` helper builds `CaparisonInput` from match state
- `submitJoustPass()` passes caparison inputs to `resolveJoustPass()`, tracks banner consumption
- `submitMeleeRound()` same pattern for melee

#### 6. Gear Factory — gigling-gear.ts
Three new exported functions:
- `createStatGear(slot, rarity, rng?)` — creates barding/chanfron/saddle with randomized stats within rarity ranges
- `createCaparison(effectId)` — creates caparison gear with specified effect
- `createFullLoadout(giglingRarity, gearRarity, capEffectId?, rng?)` — creates complete loadout

The `rng` parameter defaults to `Math.random()` but accepts custom function for deterministic tests.

#### 7. Tests — 53 New Tests

**New file:** `caparison.test.ts` (38 tests)

| Test Group | Count | What It Covers |
|---|---|---|
| Pennant of Haste | 4 | +INIT pass 1, no effect pass 2, P2 unaffected, accuracy delta |
| Woven Shieldcloth | 5 | +GRD defensive, no effect aggressive/balanced, melee defensive, melee aggressive |
| Thunderweave | 4 | +MOM fast, no effect standard/slow, no melee effect |
| Irongrip Drape | 2 | Threshold in logs, enables otherwise-denied shift |
| Stormcloak | 3 | Higher FF at low stamina, no effect at full, applies in melee |
| Banner of the Giga | 6 | Boosts winning counter, no boost on loss/neutral, once-only, melee, full match tracking |
| Backwards compat | 3 | Joust/melee/match without caparison args |
| Match integration | 5 | Pennant pass 1 only, shieldcloth visible, thunderweave visible, P2 works, both-player different caps |
| Balance config values | 6 | All 6 constants match expected values |

**Added to:** `gigling-gear.test.ts` (15 new tests, 46 total)

| Test Group | Count | What It Covers |
|---|---|---|
| createStatGear | 7 | Correct slots/stats for all 3 types, min/max rng, 100-roll range check, no effect on stat pieces |
| createCaparison | 3 | Correct effect, rarity matching, no stats |
| createFullLoadout | 5 | All slots, no-cap option, gear rarity, applyGiglingLoadout integration, createMatch integration |

**Total: 149 tests passing** (57 calculator + 8 match + 46 gigling gear + 38 caparison)

## Current Engine Architecture

```
src/engine/
├── types.ts              — All types (enums, interfaces, gigling gear, CaparisonInput)
├── balance-config.ts     — BALANCE const (tuning + gigling rarity + caparison values + gear ranges)
├── archetypes.ts         — 6 archetypes
├── attacks.ts            — Speed data + Joust attacks (6) + Melee attacks (6)
├── calculator.ts         — Pure math functions (softCap, fatigue, accuracy, impact, unseat, melee)
├── phase-joust.ts        — resolveJoustPass() with caparison hooks
├── phase-melee.ts        — resolveMeleeRoundFn() with caparison hooks
├── match.ts              — State machine with caparison tracking + banner state
├── gigling-gear.ts       — Gear stat calc + caparison catalog + gear factory
├── calculator.test.ts    — 57 tests
├── match.test.ts         — 8 tests
├── gigling-gear.test.ts  — 46 tests (31 original + 15 factory)
└── caparison.test.ts     — 38 tests
```

### Caparison Data Flow
```
createMatch(arch1, arch2, loadout1?, loadout2?)
  ├── applyGiglingLoadout() → boosted Archetype (stat pieces + rarity)
  ├── getCaparisonEffect() → CaparisonEffect stored in MatchState
  └── p1BannerUsed/p2BannerUsed = false

submitJoustPass(state, p1Choice, p2Choice)
  ├── capInput(state, 'player1') → { effect, bannerUsed }
  ├── resolveJoustPass(..., p1Cap, p2Cap)
  │   ├── adjustArchetypeForCaparison(arch, cap, passNum, speed)  [pre-shift]
  │   ├── canShift() with adjusted threshold (Irongrip)
  │   ├── adjustArchetypeForCaparison(arch, cap, passNum, speed, finalAttack) [post-shift]
  │   ├── computeEffectiveStats(adjustedArch, ...)
  │   ├── resolveCounters() → banner boost if applicable
  │   └── return { ...result, p1BannerConsumed, p2BannerConsumed }
  └── state.p1BannerUsed ||= result.p1BannerConsumed
```

## What Needs to Be Done Next

### Priority 1: Gear UI
- Loadout selection screen before match start
- Player picks gigling rarity, equips gear from inventory
- Show stat bonuses from gear on character sheet
- Display caparison effect name/description

### Priority 2: AI Opponent
- Simple bot for single-player mode
- Random or heuristic-based speed/attack selection
- Could weight choices by archetype strengths

### Priority 3: Caparison UI Display
- Show active caparison effects in match UI
- Highlight when effects trigger (flash "Thunderweave +4 MOM!" when activating)
- Show opponent's caparison so player can strategize against it

### Lower Priority
- Gear durability/repair system
- Gear crafting integration with Gigaverse economy
- Bearer token auth for live API probing
- Matchmaking / ELO system

## Key Design Decisions Made This Session

### Stormcloak Implementation
Instead of modifying `fatigueFactor()`, the Stormcloak effect adjusts `archetype.stamina` to simulate a lower fatigue ratio:
```
adjustedStamina = maxStamina * (fatigueRatio - reduction) / fatigueRatio
```
This means `fatigueFactor(currentSta, adjustedStamina)` produces the same result as using a lower fatigue ratio. The calculator stays pure — no optional parameters needed.

### Shieldcloth Timing
Shieldcloth applies based on the **final** attack stance (after shift), not the initial choice. This is correct because:
- Pre-shift checks shouldn't include attack-dependent bonuses
- If you shift TO a defensive attack, you should get the bonus
- If you shift AWAY from a defensive attack, you should lose it

### Banner State Tracking
Banner of the Giga is tracked per-match in MatchState (`p1BannerUsed`/`p2BannerUsed`). The phase functions report `p1BannerConsumed`/`p2BannerConsumed` per pass/round, and match.ts accumulates the state with `||=`.

### Caparison in Melee
Effects that reference joust-specific mechanics (pass number, speed, shifts) are joust-only:
- **Joust only**: Pennant of Haste, Thunderweave, Irongrip Drape
- **Both phases**: Woven Shieldcloth (stance exists in both), Stormcloak (fatigue), Banner (counters)

## Gotchas for Next Session
- `resolveJoustPass()` and `resolveMeleeRoundFn()` have new optional params — all existing callers still work
- `MatchState` now has 4 new fields — createMatch() initializes them all
- The `adjustArchetypeForCaparison()` helper is local to phase-joust.ts (not exported) — if you need it elsewhere, extract to gigling-gear.ts
- `adjustArchetypeForMelee()` is a separate function in phase-melee.ts (subset of joust effects)
- Gear factory uses `Math.random()` by default — inject `rng` for reproducible tests
- `rollInRange(min, max, rng)` uses `Math.floor(rng() * (max - min + 1))` — rng returning exactly 1.0 would overflow, but Math.random() never returns 1.0
- The `calcCarryoverPenalties` import was removed from phase-melee.ts (unused there, only used in match.ts)
