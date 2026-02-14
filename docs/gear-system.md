# Gear System

12-slot equipment system: 6 steed slots + 6 player slots. Each slot has 3 variants (aggressive/balanced/defensive). 6 rarity tiers with increasing bonuses.

## Steed Gear (6 Slots)

| Slot | Primary | Secondary |
|------|---------|-----------|
| Chamfron | GRD | MOM |
| Barding | GRD | STA |
| Saddle | CTL | INIT |
| Stirrups | INIT | STA |
| Reins | CTL | MOM |
| Horseshoes | MOM | INIT |

Note: Legacy code uses `INIT/MOM` for stirrups — balanced variant matches legacy `GEAR_SLOT_STATS`.

## Player Gear (6 Slots)

| Slot | Primary | Secondary |
|------|---------|-----------|
| Helm | GRD | INIT |
| Shield | GRD | STA |
| Lance | MOM | CTL |
| Armor | STA | GRD |
| Gauntlets | CTL | INIT |
| Melee Weapon | MOM | STA |

Caparison is cosmetic only — zero gameplay effects.

## Gear Variants

3 variants per slot: **aggressive**, **balanced**, **defensive**.
- Same total stat budget (horizontal power), different primary/secondary allocation
- Balanced variant MUST match legacy `GEAR_SLOT_STATS` exactly
- Affinity field is informational only (no mechanical bonus)

## Rarities

| Rarity | Flat Bonus | Stat Range |
|--------|-----------|------------|
| Uncommon | +2 | Low |
| Rare | +3 | Medium |
| Epic | +5 | Medium-high |
| Legendary | +7 | High |
| Relic | +10 | Very high |
| Giga | +13 | Maximum |

**Important:** Flat rarity bonus applies to **steed gear only** (all stats). Player gear adds slot bonuses from rolls but does NOT add a flat rarity bonus.

## Key APIs

```typescript
createStatGear(slot, rarity, rng?, variant?)           // Single steed gear piece
createFullLoadout(gigRarity, gearRarity, rng?, variant?)  // Full steed loadout
createPlayerGear(slot, rarity, rng?, variant?)          // Single player gear piece
createFullPlayerLoadout(gearRarity, rng?, variant?)     // Full player loadout
applyGiglingLoadout(archetype, loadout?): Archetype     // Apply steed gear (adds rarity bonus)
applyPlayerLoadout(archetype, loadout?): Archetype      // Apply player gear (NO rarity bonus)
```

## Stat Pipeline with Gear

```
Base archetype stats
  → applyGiglingLoadout()   +slot bonuses +flat rarity bonus to ALL stats
  → applyPlayerLoadout()    +slot bonuses only (NO flat bonus)
  → softCap(knee=100, K=55) on MOM/CTL/GRD/INIT (NOT stamina)
```

At Giga rarity, only Bulwark GRD crosses the softCap knee of 100.
