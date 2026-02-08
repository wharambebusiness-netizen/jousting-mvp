# Jousting MVP — Session 11 Handoff

## Working Style
- User wants full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Generate handoff at session end

## Session 11 Summary
**Focus:** Recorded gigling hatch rate probability tables (user-provided), designed the gigling gear system, implemented gear types + stat calculation in engine, wrote 31 tests.

### What Was Done

#### 1. Hatch Rate Table — Complete (Q0-100)
User provided the full quality→rarity probability table. Saved as `gigling-hatch-rates.csv` in the memory directory. Key findings:

- **6 rarity tiers** (not 7): Uncommon, Rare, Epic, Legendary, Relic, Giga. No "Common" tier.
- **CID mapping confirmed**: CID 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary, 5=Relic, 6=Giga
- **Giga first appears at Q26** (0.03%), caps at 5% at Q100
- **Uncommon drops to 0% at Q60** — guaranteed Rare+
- **Rare drops to 0% at Q85** — guaranteed Epic+
- **Q90 symmetry**: Epic = Legendary = 43% each
- **Eggspeditor impact**: Item 589 (Q90 floor) → 4% Giga, 43% Legendary

Full analysis written into `gigaverse-giglings.md` with breakpoint table, eggspeditor value comparison, and piecewise segment descriptions.

#### 2. Gigling Gear Design — `gigling-gear-design.md`
Complete design document created in memory directory:

**4 gear slots:**
| Slot | Type | Primary Stat | Secondary Stat |
|---|---|---|---|
| Barding (body armor) | Stat piece | Guard | Stamina |
| Chanfron (head armor) | Stat piece | Momentum | Stamina |
| Saddle (rider seat) | Stat piece | Control | Initiative |
| Caparison (heraldic cloth) | Special effect | — | — |

**Stat stack formula:**
```
finalStat = archetype.stat + giglingRarityBonus + gearBonus → softCap()
```

**Gigling rarity bonuses (flat per stat):**
Uncommon +1, Rare +3, Epic +5, Legendary +7, Relic +10, Giga +13

**Gear stat ranges (primary / secondary):**
| Rarity | Primary | Secondary |
|---|---|---|
| Uncommon | +1-3 | +0-1 |
| Rare | +2-5 | +1-2 |
| Epic | +4-7 | +2-4 |
| Legendary | +6-10 | +3-5 |
| Relic | +8-12 | +4-7 |
| Giga | +10-15 | +6-9 |

**Caparison** = special effect slot (mirrors Gigaverse Charm). 6 example effects defined, one per rarity tier. Effects are conditional/situational, not raw stat bonuses.

**Guard and Stamina are double-sourced** (Barding + Chanfron secondaries). Momentum and Control each have exactly one primary source.

#### 3. Engine Implementation — Gigling Gear System

**Files changed:**
- `types.ts` — Added: `GiglingRarity`, `GearSlot`, `JoustStat`, `CaparisonEffectId`, `CaparisonEffect`, `GiglingGear`, `GiglingLoadout`
- `balance-config.ts` — Added: `giglingRarityBonus` table in BALANCE const
- `match.ts` — `createMatch()` now accepts optional `loadout1?: GiglingLoadout, loadout2?: GiglingLoadout`; imports and calls `applyGiglingLoadout()`

**New file:**
- `gigling-gear.ts` — Core gear logic:
  - `GEAR_SLOT_STATS` — maps barding/chanfron/saddle to primary/secondary stat names
  - `CAPARISON_EFFECTS` — catalog of 6 effects (one per rarity tier)
  - `sumGearStats(loadout)` — sums stat bonuses from all equipped stat pieces
  - `applyGiglingLoadout(archetype, loadout?)` — produces boosted Archetype; returns original if no loadout
  - `getCaparisonEffect(loadout?)` — extracts caparison effect for use in combat hooks

**Files NOT changed (zero touch):**
- `calculator.ts` — softCap handles boosted stats naturally
- `phase-joust.ts` — sees boosted Archetype, works unchanged
- `phase-melee.ts` — same
- `attacks.ts`, `archetypes.ts` — unchanged

**Design principle:** The gear system produces a boosted `Archetype` (same interface) so the entire combat pipeline is oblivious to gear. This is the minimal-surface-area integration — one function call in `createMatch()` and everything downstream just works.

#### 4. Tests — 31 New Tests

**New file:** `gigling-gear.test.ts`

| Test Group | Count | What It Covers |
|---|---|---|
| Gear Slot Mapping | 3 | GEAR_SLOT_STATS primary/secondary correctness |
| sumGearStats | 5 | Empty, single piece, all three, caparison ignored, primary-only |
| applyGiglingLoadout | 5 | Undefined passthrough, uncommon +0, all 6 rarities, combined bonuses, identity preservation |
| getCaparisonEffect | 3 | Undefined, no caparison, with caparison |
| Caparison catalog | 3 | 6 effects, all rarities covered, data integrity |
| Soft Cap interaction | 3 | Giga Charger MOM, double-stacked Guard 125→117, realistic Epic under knee |
| Match integration | 5 | Backwards compat, P1-only, both players, geared > ungeared, stamina advantage |
| Edge cases | 4 | Caparison-only, partial loadout, rarity config values |

**Total: 96 tests passing** (57 calculator + 8 match + 31 gigling gear)

## Current Engine Architecture

```
src/engine/
├── types.ts              — All type definitions (enums, interfaces, gigling gear types)
├── balance-config.ts     — BALANCE const (all tuning numbers + gigling rarity bonus table)
├── archetypes.ts         — 6 archetypes (Charger, Technician, Bulwark, Tactician, Breaker, Duelist)
├── attacks.ts            — Speed data + Joust attacks (6) + Melee attacks (6)
├── calculator.ts         — Pure math functions (softCap, fatigue, accuracy, impact, unseat, melee)
├── phase-joust.ts        — resolveJoustPass() — full pass resolution
├── phase-melee.ts        — resolveMeleeRoundFn() — single melee round
├── match.ts              — State machine (createMatch, submitJoustPass, submitMeleeRound)
├── gigling-gear.ts       — NEW: gear stat calculation + caparison effect catalog
├── calculator.test.ts    — 57 tests
├── match.test.ts         — 8 tests
└── gigling-gear.test.ts  — NEW: 31 tests
```

### Data Flow
```
Archetype (base stats 45-75)
  ↓ applyGiglingLoadout() [gigling-gear.ts]
Boosted Archetype (base + rarity bonus + gear bonuses)
  ↓ createMatch() [match.ts]
PlayerState (archetype = boosted, currentStamina = boosted.stamina)
  ↓ computeEffectiveStats() [calculator.ts]
EffectiveStats (raw → softCap → fatigue)
  ↓ calcAccuracy() → calcImpactScore() [calculator.ts]
Combat resolution (unchanged pipeline)
```

## What Needs to Be Done Next

### Priority 1: Caparison Effect Hooks
The 6 Caparison effects are **defined** (types + catalog) but **not wired** into combat resolution. Each needs a hook:

| Effect | Hook Point | Implementation |
|---|---|---|
| Pennant of Haste (+2 INIT Pass 1) | `resolveJoustPass()` before stats | Check passNumber === 1, add +2 to initiative |
| Woven Shieldcloth (+3 GRD Defensive) | `computeEffectiveStats()` | Check stance === Defensive, add +3 to guard |
| Thunderweave (+4 MOM Fast speed) | `computeEffectiveStats()` | Check speed === Fast, add +4 to momentum |
| Irongrip Drape (-5 shift threshold) | `canShift()` | Reduce speed.shiftThreshold by 5 |
| Stormcloak (-0.05 fatigue ratio) | `fatigueFactor()` | Reduce fatigueRatio by 0.05 |
| Banner of the Giga (+50% first counter) | `resolveCounters()` | Track counter state, boost first bonus by 50% |

**Challenge:** The calculator functions are currently pure (no state). Caparison effects need either:
- Option A: Pass caparison effect as optional param to affected functions
- Option B: Pre/post-process stats in phase-joust.ts before calling calculator
- Option B is cleaner — keeps calculator pure, effects applied at the orchestration layer

### Priority 2: Gear Factory / Generation
Need functions to create gear with randomized stats within rarity ranges:
```typescript
function createStatGear(slot: 'barding' | 'chanfron' | 'saddle', rarity: GiglingRarity): GiglingGear
function createCaparison(effectId: CaparisonEffectId): GiglingGear
```
The stat ranges per rarity are defined in `gigling-gear-design.md` but not yet codified as constants.

### Priority 3: Gear UI
- Loadout selection screen (pick gigling rarity + equip gear pieces)
- Gear display in match UI (show equipped items + stats)
- Caparison effect display (what your opponent has equipped)

### Lower Priority
- Gear durability/repair system
- Gear crafting integration with Gigaverse economy
- Bearer token auth for live API probing

## Key Files in Memory Directory

| File | Contents |
|---|---|
| `MEMORY.md` | Master index (loaded into system prompt) |
| `gigling-gear-design.md` | Full gear system design doc |
| `gigling-hatch-rates.csv` | Complete Q0-100 probability table |
| `gigaverse-giglings.md` | Gigling deep reference + hatch analysis |
| `gigaverse-api.md` | 42-endpoint API map |
| `gigaverse-combat-gear.md` | Character gear system reference |
| `gigaverse-integration-notes.md` | Stat mapping + architecture decisions |
| `gigaverse-overview.md` | Gigaverse ecosystem overview |
| `gigaverse-play-repo.md` | Official play repo analysis |

## Gotchas for Next Session
- `applyGiglingLoadout()` returns the **same reference** when loadout is undefined (intentional — test relies on this)
- Stamina is **NOT soft-capped** — it's a resource pool. Only momentum/control/guard/initiative go through softCap during combat.
- `createMatch()` signature is now `(arch1, arch2, loadout1?, loadout2?)` — all existing callers still work (optional params)
- Caparison effects are defined in `CAPARISON_EFFECTS` but have **zero runtime effect** currently — they're just data
- Guard can be double-stacked from Barding (primary) + Chanfron (secondary) — this is by design
- Max theoretical raw stat is ~125 (Bulwark GRD 75 + Giga +15 + Barding +22 + Chanfron secondary +13) → softCap compresses to ~117
