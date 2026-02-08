// ============================================================
// Jousting — Player Gear System (6-Slot Knight Equipment)
// ============================================================
// Computes stat bonuses from the knight's personal equipment,
// producing a boosted Archetype that feeds into the existing
// calculator pipeline with zero changes to combat resolution.
// ============================================================
import type {
  Archetype,
  GiglingLoadout,
  PlayerGear,
  PlayerGearSlot,
  PlayerLoadout,
  GiglingRarity,
  JoustStat,
} from './types';
import { BALANCE } from './balance-config';
import { sumGearStats } from './gigling-gear';

// --- Player Gear Slot → Stat Mapping ---

export const PLAYER_GEAR_SLOT_STATS: Record<PlayerGearSlot, {
  primary: JoustStat;
  secondary: JoustStat;
}> = {
  helm:         { primary: 'guard',    secondary: 'initiative' },
  shield:       { primary: 'guard',    secondary: 'stamina' },
  lance:        { primary: 'momentum', secondary: 'control' },
  armor:        { primary: 'stamina',  secondary: 'guard' },
  gauntlets:    { primary: 'control',  secondary: 'initiative' },
  melee_weapon: { primary: 'momentum', secondary: 'stamina' },
};

const ALL_PLAYER_SLOTS: PlayerGearSlot[] = ['helm', 'shield', 'lance', 'armor', 'gauntlets', 'melee_weapon'];

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
 * Sums stat bonuses from all equipped player gear pieces (6 slots).
 */
export function sumPlayerGearStats(loadout: PlayerLoadout): StatBonuses {
  const bonuses = emptyBonuses();

  for (const slot of ALL_PLAYER_SLOTS) {
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
 * Applies player loadout to an archetype (or already-boosted archetype),
 * producing a further boosted Archetype.
 *
 * Designed to be chained after applyGiglingLoadout:
 *   let boosted = applyGiglingLoadout(archetype, steedLoadout);
 *   boosted = applyPlayerLoadout(boosted, playerLoadout);
 */
export function applyPlayerLoadout(
  archetype: Archetype,
  loadout?: PlayerLoadout,
): Archetype {
  if (!loadout) return archetype;

  const gearBonus = sumPlayerGearStats(loadout);

  return {
    ...archetype,
    momentum:   archetype.momentum   + gearBonus.momentum,
    control:    archetype.control    + gearBonus.control,
    guard:      archetype.guard      + gearBonus.guard,
    initiative: archetype.initiative + gearBonus.initiative,
    stamina:    archetype.stamina    + gearBonus.stamina,
  };
}

// --- Gear Factory ---

/**
 * Creates a player gear piece for the given slot with randomized
 * primary/secondary values within the rarity's defined range.
 * Uses Math.random() for rolls — pass a custom `rng` for deterministic tests.
 */
export function createPlayerGear(
  slot: PlayerGearSlot,
  rarity: GiglingRarity,
  rng: () => number = Math.random,
): PlayerGear {
  const range = BALANCE.playerGearStatRanges[rarity];
  const slotStats = PLAYER_GEAR_SLOT_STATS[slot];

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
 * Creates a full player loadout with randomly rolled gear for all 6 slots.
 */
export function createFullPlayerLoadout(
  gearRarity: GiglingRarity,
  rng: () => number = Math.random,
): PlayerLoadout {
  return {
    helm:         createPlayerGear('helm', gearRarity, rng),
    shield:       createPlayerGear('shield', gearRarity, rng),
    lance:        createPlayerGear('lance', gearRarity, rng),
    armor:        createPlayerGear('armor', gearRarity, rng),
    gauntlets:    createPlayerGear('gauntlets', gearRarity, rng),
    melee_weapon: createPlayerGear('melee_weapon', gearRarity, rng),
  };
}

// --- Slot Descriptions ---

const PLAYER_SLOT_DESCRIPTIONS: Record<PlayerGearSlot, string> = {
  helm:         'Head protection + battlefield awareness',
  shield:       'Impact absorption + endurance in combat',
  lance:        'Weapon power + precision technique',
  armor:        'Body protection + toughness',
  gauntlets:    'Grip/stability + quick reflexes',
  melee_weapon: 'Attack power + staying power',
};

export function describePlayerSlot(slot: PlayerGearSlot): string {
  return PLAYER_SLOT_DESCRIPTIONS[slot];
}

// --- Validation ---

export function validatePlayerGear(gear: PlayerGear): boolean {
  const range = BALANCE.playerGearStatRanges[gear.rarity];
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

// --- Combined Gear Summary ---

interface GearSummary {
  momentum: number;
  control: number;
  guard: number;
  initiative: number;
  stamina: number;
}

export function getGearSummary(
  steedLoadout?: GiglingLoadout,
  playerLoadout?: PlayerLoadout,
): GearSummary {
  const steed = steedLoadout ? sumGearStats(steedLoadout) : { momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 };
  const player = playerLoadout ? sumPlayerGearStats(playerLoadout) : { momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 };

  return {
    momentum:   steed.momentum   + player.momentum,
    control:    steed.control    + player.control,
    guard:      steed.guard      + player.guard,
    initiative: steed.initiative + player.initiative,
    stamina:    steed.stamina    + player.stamina,
  };
}

// --- Internal ---

function rollInRange(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
