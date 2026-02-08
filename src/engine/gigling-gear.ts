// ============================================================
// Jousting — Gigling Gear System
// ============================================================
// Computes stat bonuses from gigling rarity + equipped gear,
// producing a boosted Archetype that feeds into the existing
// calculator pipeline with zero changes to combat resolution.
// ============================================================
import type {
  Archetype,
  GiglingGear,
  GiglingLoadout,
  GiglingRarity,
  JoustStat,
  CaparisonEffect,
  CaparisonEffectId,
} from './types';
import { BALANCE } from './balance-config';

// --- Gear Slot → Stat Mapping ---
// Each stat piece has a fixed primary and secondary stat.

export const GEAR_SLOT_STATS: Record<'barding' | 'chanfron' | 'saddle', {
  primary: JoustStat;
  secondary: JoustStat;
}> = {
  barding:  { primary: 'guard',    secondary: 'stamina' },
  chanfron: { primary: 'momentum', secondary: 'stamina' },
  saddle:   { primary: 'control',  secondary: 'initiative' },
};

// --- Caparison Effects ---

export const CAPARISON_EFFECTS: Record<CaparisonEffectId, CaparisonEffect> = {
  pennant_of_haste: {
    id: 'pennant_of_haste',
    name: 'Pennant of Haste',
    description: '+2 Initiative on Pass 1 only',
    rarity: 'uncommon',
  },
  woven_shieldcloth: {
    id: 'woven_shieldcloth',
    name: 'Woven Shieldcloth',
    description: '+3 Guard when choosing Defensive stance',
    rarity: 'rare',
  },
  thunderweave: {
    id: 'thunderweave',
    name: 'Thunderweave',
    description: '+4 Momentum when choosing Fast speed',
    rarity: 'epic',
  },
  irongrip_drape: {
    id: 'irongrip_drape',
    name: 'Irongrip Drape',
    description: 'Shift threshold reduced by 5 (easier shifts)',
    rarity: 'legendary',
  },
  stormcloak: {
    id: 'stormcloak',
    name: 'Stormcloak',
    description: 'Fatigue ratio reduced by 0.05 (fatigue kicks in later)',
    rarity: 'relic',
  },
  banner_of_the_giga: {
    id: 'banner_of_the_giga',
    name: 'Banner of the Giga',
    description: 'First successful counter per match deals +50% bonus',
    rarity: 'giga',
  },
};

// --- Stat Bonus Accumulator ---

interface StatBonuses {
  momentum: number;
  control: number;
  guard: number;
  initiative: number;
  stamina: number;
}

function emptyBonuses(): StatBonuses {
  return { momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 };
}

/**
 * Sums stat bonuses from all equipped stat pieces (barding, chanfron, saddle).
 * Caparison is excluded — it provides effects, not raw stats.
 */
export function sumGearStats(loadout: GiglingLoadout): StatBonuses {
  const bonuses = emptyBonuses();
  const statPieces = [loadout.barding, loadout.chanfron, loadout.saddle];

  for (const gear of statPieces) {
    if (!gear) continue;
    if (gear.primaryStat) {
      bonuses[gear.primaryStat.stat] += gear.primaryStat.value;
    }
    if (gear.secondaryStat) {
      bonuses[gear.secondaryStat.stat] += gear.secondaryStat.value;
    }
  }

  return bonuses;
}

/**
 * Applies gigling loadout to a base archetype, producing a boosted Archetype.
 * - Gigling rarity → flat bonus to all stats
 * - Gear pieces → primary/secondary stat bonuses
 * - Stamina is NOT soft-capped (resource pool, not scaling stat)
 * - All other stats pass through softCap during combat resolution
 *
 * Returns a new Archetype with boosted base stats. The existing calculator
 * pipeline applies softCap and fatigue as normal — no changes needed.
 */
export function applyGiglingLoadout(
  archetype: Archetype,
  loadout?: GiglingLoadout,
): Archetype {
  if (!loadout) return archetype;

  const rarityBonus = BALANCE.giglingRarityBonus[loadout.giglingRarity];
  const gearBonus = sumGearStats(loadout);

  return {
    ...archetype,
    momentum:   archetype.momentum   + rarityBonus + gearBonus.momentum,
    control:    archetype.control    + rarityBonus + gearBonus.control,
    guard:      archetype.guard      + rarityBonus + gearBonus.guard,
    initiative: archetype.initiative + rarityBonus + gearBonus.initiative,
    stamina:    archetype.stamina    + rarityBonus + gearBonus.stamina,
  };
}

/**
 * Returns the Caparison effect from a loadout, if any.
 * Used by phase resolution to apply conditional modifiers.
 */
export function getCaparisonEffect(loadout?: GiglingLoadout): CaparisonEffect | undefined {
  return loadout?.caparison?.effect;
}

// --- Gear Factory ---

type StatSlot = 'barding' | 'chanfron' | 'saddle';

/**
 * Creates a stat gear piece (barding, chanfron, or saddle) with randomized
 * primary/secondary values within the rarity's defined range.
 * Uses Math.random() for rolls — pass a custom `rng` for deterministic tests.
 */
export function createStatGear(
  slot: StatSlot,
  rarity: GiglingRarity,
  rng: () => number = Math.random,
): GiglingGear {
  const range = BALANCE.gearStatRanges[rarity];
  const slotStats = GEAR_SLOT_STATS[slot];

  const primaryValue = rollInRange(range.primary[0], range.primary[1], rng);
  const secondaryValue = rollInRange(range.secondary[0], range.secondary[1], rng);

  return {
    slot,
    rarity,
    primaryStat: { stat: slotStats.primary, value: primaryValue },
    secondaryStat: { stat: slotStats.secondary, value: secondaryValue },
  };
}

/**
 * Creates a caparison gear piece with the specified effect.
 * The caparison's rarity is determined by the effect's rarity.
 */
export function createCaparison(effectId: CaparisonEffectId): GiglingGear {
  const effect = CAPARISON_EFFECTS[effectId];
  return {
    slot: 'caparison',
    rarity: effect.rarity,
    effect,
  };
}

/**
 * Creates a full loadout with randomly rolled gear for all stat slots.
 * Optionally include a caparison effect.
 */
export function createFullLoadout(
  giglingRarity: GiglingRarity,
  gearRarity: GiglingRarity,
  caparisonEffectId?: CaparisonEffectId,
  rng: () => number = Math.random,
): GiglingLoadout {
  return {
    giglingRarity,
    barding: createStatGear('barding', gearRarity, rng),
    chanfron: createStatGear('chanfron', gearRarity, rng),
    saddle: createStatGear('saddle', gearRarity, rng),
    caparison: caparisonEffectId ? createCaparison(caparisonEffectId) : undefined,
  };
}

// --- Internal ---

function rollInRange(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
