# Gear System Overhaul — Milestones

## Overview

Replace the current 3-slot steed gear + 6 caparison effects system with:
- **6 Steed Gear slots** (mount equipment affecting jousting stats)
- **6 Player Gear slots** (knight equipment affecting jousting + melee stats)
- **Caparison = cosmetic only** (no gameplay effects)

This aligns with the Gigaverse vision: Mount → jousting, Character → melee.

---

## Milestone 1: Engine Strip & Steed Gear Expansion

**Goal**: Remove all caparison gameplay effects and expand steed gear from 3→6 slots.

### Tasks
1. **Remove caparison gameplay effects** from phase-joust.ts, phase-melee.ts, match.ts
   - Delete `adjustArchetypeForCaparison()` and `adjustArchetypeForMelee()` caparison functions
   - Remove CaparisonInput pipeline from resolveJoustPass/resolveMeleeRoundFn
   - Remove Banner tracking (p1BannerUsed/p2BannerUsed) from MatchState
   - Keep CaparisonEffect type but mark as cosmetic-only (name, visual, rarity)
   - Remove caparison balance constants from balance-config.ts
2. **Expand steed gear from 3→6 slots**:
   - Chamfron (head armor) → Guard / Momentum
   - Barding (body armor) → Guard / Stamina
   - Saddle (seat stability) → Control / Initiative
   - Stirrups (rider balance) → Initiative / Stamina
   - Reins (steering precision) → Control / Momentum
   - Horseshoes (traction/acceleration) → Momentum / Initiative
3. **Update types.ts**: New `SteedGearSlot` type, update `GiglingLoadout`
4. **Rebalance stat ranges**: 6 slots → reduce per-slot values so total remains similar
5. **Fix all existing tests** to work without caparison effects

### Stat Coverage (Steed Gear)
| Stat | Primary Sources | Secondary Sources | Total |
|---|---|---|---|
| Momentum | Horseshoes | Chamfron, Reins | 3 |
| Control | Saddle, Reins | — | 2 |
| Guard | Chamfron, Barding | — | 2 |
| Initiative | Stirrups | Saddle, Horseshoes | 3 |
| Stamina | — | Barding, Stirrups | 2 |

### Files Modified
- types.ts, gigling-gear.ts, balance-config.ts
- phase-joust.ts, phase-melee.ts, match.ts, calculator.ts
- All test files (caparison.test.ts gutted/rewritten, gigling-gear.test.ts rewritten)

---

## Milestone 2: Player Gear System

**Goal**: Add a 6-slot player gear system representing the knight's personal equipment.

### Tasks
1. **Design player gear types**: PlayerGearSlot, PlayerGear, PlayerLoadout
2. **Define stat mappings**:
   - Helm (head protection) → Guard / Initiative
   - Shield (impact absorption) → Guard / Stamina
   - Lance (primary weapon) → Momentum / Control
   - Armor (torso protection) → Stamina / Guard
   - Gauntlets/Greaves (grip & stability) → Control / Initiative
   - Melee Weapon (ground fights) → Momentum / Stamina
3. **Implement player-gear.ts**: Factory functions, stat accumulation, applyPlayerLoadout
4. **Integrate into match.ts**: createMatch accepts player loadouts, applies both steed + player bonuses
5. **Write comprehensive tests**

### Stat Coverage (Player Gear)
| Stat | Primary Sources | Secondary Sources | Total |
|---|---|---|---|
| Momentum | Lance, Melee Weapon | — | 2 |
| Control | Gauntlets | Lance | 2 |
| Guard | Helm, Shield | Armor | 3 |
| Initiative | — | Helm, Gauntlets | 2 |
| Stamina | Armor | Shield, Melee Weapon | 3 |

### Combined Coverage (12 slots total)
| Stat | Total Sources |
|---|---|
| Momentum | 5 |
| Control | 4 |
| Guard | 5 |
| Initiative | 5 |
| Stamina | 5 |

### Files Created/Modified
- NEW: player-gear.ts, player-gear.test.ts
- Modified: types.ts (add player types), match.ts (integrate player loadout)
- Modified: balance-config.ts (player gear stat ranges)

---

## Milestone 3: UI, AI & Balance

**Goal**: Redesign the loadout screen for 12 gear slots, make caparison cosmetic, update AI, rebalance.

### Tasks
1. **Redesign LoadoutScreen**: Two sections (Steed Gear / Player Gear), 6 slots each
2. **Caparison cosmetic selector**: Visual-only, no gameplay description needed
3. **Update AI gear selection**: aiPickSteedGear + aiPickPlayerGear (replace aiPickCaparison)
4. **Update result screens**: Show gear bonuses in PassResult/MeleeResult if relevant
5. **Balance simulation**: Run simulate.ts with new 12-slot system, tune stat ranges
6. **Test all UI flows end-to-end**

### Files Modified
- LoadoutScreen.tsx, helpers.tsx, PassResult.tsx, MeleeResult.tsx, MatchSummary.tsx
- basic-ai.ts (gear selection logic)
- App.tsx (loadout flow changes)
- App.css (new gear grid styles)

---

## Agent Assignment

| Agent | Milestone | Dependencies | Files Owned |
|---|---|---|---|
| **engine-refactor** | M1 | None | types.ts, balance-config.ts, phase-joust.ts, phase-melee.ts, calculator.ts, caparison.test.ts |
| **gear-system** | M1+M2 | engine-refactor | gigling-gear.ts, match.ts, NEW player-gear.ts, gigling-gear.test.ts, NEW player-gear.test.ts |
| **ui-loadout** | M3 | gear-system | LoadoutScreen.tsx, helpers.tsx, PassResult.tsx, MeleeResult.tsx, MatchSummary.tsx, basic-ai.ts, App.css |
| **quality-review** | All | None (continuous) | playtest.test.ts, match.test.ts (test-only changes) |

---

## Balance Notes

### Stat Ranges (6-slot groups, starting point — needs simulation tuning)

**Steed Gear Ranges** (per piece):
| Rarity | Primary | Secondary |
|---|---|---|
| uncommon | [1, 2] | [0, 1] |
| rare | [1, 3] | [1, 2] |
| epic | [2, 4] | [1, 3] |
| legendary | [3, 5] | [2, 3] |
| relic | [4, 7] | [3, 5] |
| giga | [5, 9] | [4, 6] |

**Player Gear Ranges** (per piece — same as steed initially):
Same table as steed. Both can diverge after simulation.

**Giga max theoretical (all 12 slots @ max)**:
- 12 × 9 primary + 12 × 6 secondary = 108 + 72 = 180 total from gear
- Compare: current 3-slot system gives max 45 + 27 = 72
- This rewards deeper gear investment but softCap keeps it in check
- Realistic scenario (all Legendary): 12 × 5 + 12 × 3 = 60 + 36 = 96 — comparable to current Giga
