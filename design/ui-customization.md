# UI Customization Design

## Three-Path Progressive Disclosure

```
Setup Screen (pick archetype + game mode)
  ├─ Quick Play → LoadoutScreen (defaults) → Combat     [2 screens]
  ├─ Preset    → PresetScreen → LoadoutScreen → Combat   [3 screens]
  └─ Custom    → CustomSetup → LoadoutScreen → Combat    [4 screens]
```

## New Screens

### PresetMatchScreen.tsx (~350 lines)
Cards for: Mirror Match, Bare Knuckle, Full Giga, Random
Each card has Start (skip to loadout) and Edit (go to custom setup) buttons.

### SetupCustomScreen.tsx (~450 lines)
- Opponent archetype picker (6 cards + Random)
- Difficulty selector
- 4 independent rarity dropdowns:
  - Your Steed Gear tier
  - Your Player Gear tier
  - Opponent Steed Gear tier
  - Opponent Player Gear tier

### LoadoutScreen.tsx Updates
- Tab bar: Mount Gear | Knight Gear | Stats Preview
- Accordion per slot (expand to show 3 variant radio buttons)
- Independent rarity dropdowns at top (carried from CustomSetup or defaults)
- Opponent gear tiers shown read-only

## App.tsx State Changes
```typescript
type Screen = 'setup' | 'preset-match' | 'setup-custom' | 'loadout' | 'speed' | ...

// New state
gameMode: 'quick' | 'preset' | 'custom'
p2ArchetypeCustom: Archetype | null
p1SteedRarity, p2SteedRarity: GiglingRarity
p1PlayerRarity, p2PlayerRarity: GiglingRarity
selectedVariants: Record<string, GearVariant>
```

## Engine Support
Already exists — no engine changes needed for UI customization:
- createMatch(arch1, arch2, steedLoadout1, steedLoadout2, playerLoadout1, playerLoadout2)
- createFullLoadout(giglingRarity, gearRarity)
- createFullPlayerLoadout(gearRarity)

## Estimated Effort
~3,700 new lines + 500 modified. ~35-45 hours total.
