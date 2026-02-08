// ============================================================
// Jousting — Gigling Gear System (6-Slot Steed Gear)
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
  SteedGearSlot,
} from './types';
import { BALANCE } from './balance-config';

// --- Gear Slot → Stat Mapping ---
// Each gear piece has a fixed primary and secondary stat.

export const GEAR_SLOT_STATS: Record<SteedGearSlot, {
  primary: JoustStat;
  secondary: JoustStat;
}> = {
  chamfron:   { primary: 'guard',      secondary: 'momentum' },
  barding:    { primary: 'guard',      secondary: 'stamina' },
  saddle:     { primary: 'control',    secondary: 'initiative' },
  stirrups:   { primary: 'initiative', secondary: 'stamina' },
  reins:      { primary: 'control',    secondary: 'momentum' },
  horseshoes: { primary: 'momentum',   secondary: 'initiative' },
};

const ALL_STEED_SLOTS: SteedGearSlot[] = ['chamfron', 'barding', 'saddle', 'stirrups', 'reins', 'horseshoes'];

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
 * Sums stat bonuses from all equipped steed gear pieces (6 slots).
 */
export function sumGearStats(loadout: GiglingLoadout): StatBonuses {
  const bonuses = emptyBonuses();

  for (const slot of ALL_STEED_SLOTS) {
    const gear = loadout[slot];
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

// --- Gear Factory ---

/**
 * Creates a steed gear piece for the given slot with randomized
 * primary/secondary values within the rarity's defined range.
 * Uses Math.random() for rolls — pass a custom `rng` for deterministic tests.
 */
export function createStatGear(
  slot: SteedGearSlot,
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
 * Creates a full steed loadout with randomly rolled gear for all 6 slots.
 */
export function createFullLoadout(
  giglingRarity: GiglingRarity,
  gearRarity: GiglingRarity,
  rng: () => number = Math.random,
): GiglingLoadout {
  return {
    giglingRarity,
    chamfron:   createStatGear('chamfron', gearRarity, rng),
    barding:    createStatGear('barding', gearRarity, rng),
    saddle:     createStatGear('saddle', gearRarity, rng),
    stirrups:   createStatGear('stirrups', gearRarity, rng),
    reins:      createStatGear('reins', gearRarity, rng),
    horseshoes: createStatGear('horseshoes', gearRarity, rng),
  };
}

// --- Slot Descriptions ---

const STEED_SLOT_DESCRIPTIONS: Record<SteedGearSlot, string> = {
  chamfron:   'Head armor — protection + charge power',
  barding:    'Body armor — protection + endurance',
  saddle:     'Seat — technique + reaction time',
  stirrups:   'Balance — speed + saddle endurance',
  reins:      'Steering — precision + directing charge',
  horseshoes: 'Traction — acceleration + first-strike',
};

export function describeSteedSlot(slot: SteedGearSlot): string {
  return STEED_SLOT_DESCRIPTIONS[slot];
}

// --- Validation ---

export function validateSteedGear(gear: GiglingGear): boolean {
  const range = BALANCE.gearStatRanges[gear.rarity];
  if (gear.primaryStat) {
    if (gear.primaryStat.value < range.primary[0] || gear.primaryStat.value > range.primary[1]) {
      return false;
    }
  }
  if (gear.secondaryStat) {
    if (gear.secondaryStat.value < range.secondary[0] || gear.secondaryStat.value > range.secondary[1]) {
      return false;
    }
  }
  return true;
}

// --- Internal ---

function rollInRange(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
