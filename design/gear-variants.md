# Gear Variant System Design

## Core Design: Fixed 3 per slot (Aggressive / Balanced / Defensive)

Each slot gets exactly 3 variants with the **same total stat budget**, just different primary/secondary allocation.
Maps to counter system: Agg > Def > Bal > Agg.

## Steed Gear Variants (6 slots)

### Chamfron (Head Armor)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Spiked Chamfron | MOM | GRD | Charger |
| Balanced | War Chamfron | GRD | MOM | Duelist |
| Defensive | Great Helm | GRD | STA | Bulwark |

### Barding (Body Armor)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Scale Barding | MOM | GRD | Charger |
| Balanced | Plate Barding | GRD | STA | Duelist |
| Defensive | Leather Barding | GRD | CTL | Bulwark |

### Saddle (Seat)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Racing Saddle | INIT | MOM | Tactician |
| Balanced | War Saddle | CTL | INIT | Duelist |
| Defensive | Siege Saddle | CTL | STA | Bulwark |

### Stirrups (Balance)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Sprint Stirrups | INIT | MOM | Tactician |
| Balanced | Standard Stirrups | INIT | STA | Duelist |
| Defensive | Shock Stirrups | MOM | GRD | Breaker |

### Reins (Steering)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | War Reins | CTL | MOM | Charger |
| Balanced | Messenger Reins | CTL | INIT | Technician |
| Defensive | Chain Reins | CTL | GRD | Bulwark |

### Horseshoes (Traction)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Standard Horseshoes | MOM | INIT | Charger |
| Balanced | Aerodynamic Shoes | INIT | MOM | Tactician |
| Defensive | Calkins | MOM | GRD | Bulwark |

## Player Gear Variants (6 slots)

### Helm (Head Protection)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Open Helm | INIT | GRD | Tactician |
| Balanced | Arming Helm | GRD | INIT | Duelist |
| Defensive | Visor Helm | GRD | CTL | Breaker |

### Shield (Impact Absorption)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Buckler | GRD | CTL | Technician |
| Balanced | Heater Shield | GRD | STA | Duelist |
| Defensive | Kite Shield | GRD | INIT | Bulwark |

### Lance (Weapon)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Jousting Lance | MOM | INIT | Charger |
| Balanced | War Lance | MOM | CTL | Duelist |
| Defensive | Cavalry Lance | MOM | STA | Bulwark |

### Armor (Body Protection)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Hardened Leather | STA | CTL | Technician |
| Balanced | Chain Mail | GRD | STA | Duelist |
| Defensive | Plate Armor | STA | GRD | Bulwark |

### Gauntlets (Grip/Stability)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Dexterous Gloves | INIT | CTL | Technician |
| Balanced | Steel Gauntlets | CTL | INIT | Duelist |
| Defensive | Reinforced Gauntlets | CTL | STA | Breaker |

### Melee Weapon (Close Combat)
| Variant | Name | Primary | Secondary | Affinity |
|---------|------|---------|-----------|----------|
| Aggressive | Greatsword | MOM | CTL | Charger |
| Balanced | Longsword | MOM | STA | Duelist |
| Defensive | Battle Axe | MOM | GRD | Breaker |

## Implementation Notes

- All variants use **same stat ranges** from balance-config.ts per rarity
- Variant field is **optional** on GiglingGear/PlayerGear (defaults to "balanced" = current behavior)
- `gear-variants.ts` (NEW file) contains the registry
- gigling-gear.ts and player-gear.ts get `getGearSlotStats(slot, variant)` function
- SoftCap (knee=100, K=50) handles stat stacking naturally
- **Horizontal power**: same total stat budget per variant, different allocation
- Affinity is informational only (no mechanical bonus)

## Stat Budget Rule
Each variant in a slot must have the same total primary+secondary range.
Example at Epic: primary [2,4] + secondary [1,3] = total [3,7] for ALL three variants.
