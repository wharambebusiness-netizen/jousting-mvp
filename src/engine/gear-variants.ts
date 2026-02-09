// ============================================================
// Jousting — Gear Variant System (36 Definitions)
// ============================================================
// Each of the 12 gear slots has 3 variants: aggressive, balanced, defensive.
// Variants have the same total stat budget (horizontal power) but different
// primary/secondary stat allocation. Affinity is informational only.
// ============================================================
import type {
  GearVariant,
  GearVariantDefinition,
  SteedGearSlot,
  PlayerGearSlot,
  JoustStat,
} from './types';

// --- Steed Gear Variant Definitions ---

export const STEED_GEAR_VARIANTS: Record<SteedGearSlot, Record<GearVariant, GearVariantDefinition>> = {
  chamfron: {
    aggressive: { variant: 'aggressive', name: 'Spiked Chamfron', primaryStat: 'momentum', secondaryStat: 'guard', affinity: 'charger' },
    balanced:   { variant: 'balanced',   name: 'War Chamfron',    primaryStat: 'guard',    secondaryStat: 'momentum', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Great Helm',      primaryStat: 'guard',    secondaryStat: 'stamina', affinity: 'bulwark' },
  },
  barding: {
    aggressive: { variant: 'aggressive', name: 'Scale Barding',   primaryStat: 'momentum', secondaryStat: 'guard', affinity: 'charger' },
    balanced:   { variant: 'balanced',   name: 'Plate Barding',   primaryStat: 'guard',    secondaryStat: 'stamina', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Leather Barding', primaryStat: 'guard',    secondaryStat: 'control', affinity: 'bulwark' },
  },
  saddle: {
    aggressive: { variant: 'aggressive', name: 'Racing Saddle', primaryStat: 'initiative', secondaryStat: 'momentum', affinity: 'tactician' },
    balanced:   { variant: 'balanced',   name: 'War Saddle',    primaryStat: 'control',    secondaryStat: 'initiative', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Siege Saddle',  primaryStat: 'control',    secondaryStat: 'stamina', affinity: 'bulwark' },
  },
  stirrups: {
    aggressive: { variant: 'aggressive', name: 'Sprint Stirrups',   primaryStat: 'initiative', secondaryStat: 'momentum', affinity: 'tactician' },
    balanced:   { variant: 'balanced',   name: 'Standard Stirrups', primaryStat: 'initiative', secondaryStat: 'stamina', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Shock Stirrups',    primaryStat: 'momentum',   secondaryStat: 'guard', affinity: 'breaker' },
  },
  reins: {
    aggressive: { variant: 'aggressive', name: 'Messenger Reins', primaryStat: 'control', secondaryStat: 'initiative', affinity: 'technician' },
    balanced:   { variant: 'balanced',   name: 'War Reins',       primaryStat: 'control', secondaryStat: 'momentum', affinity: 'charger' },
    defensive:  { variant: 'defensive',  name: 'Chain Reins',     primaryStat: 'control', secondaryStat: 'guard', affinity: 'bulwark' },
  },
  horseshoes: {
    aggressive: { variant: 'aggressive', name: 'Aerodynamic Shoes',   primaryStat: 'initiative', secondaryStat: 'momentum', affinity: 'tactician' },
    balanced:   { variant: 'balanced',   name: 'Standard Horseshoes', primaryStat: 'momentum',   secondaryStat: 'initiative', affinity: 'charger' },
    defensive:  { variant: 'defensive',  name: 'Calkins',             primaryStat: 'momentum',   secondaryStat: 'guard', affinity: 'bulwark' },
  },
};

// --- Player Gear Variant Definitions ---

export const PLAYER_GEAR_VARIANTS: Record<PlayerGearSlot, Record<GearVariant, GearVariantDefinition>> = {
  helm: {
    aggressive: { variant: 'aggressive', name: 'Open Helm',   primaryStat: 'initiative', secondaryStat: 'guard', affinity: 'tactician' },
    balanced:   { variant: 'balanced',   name: 'Arming Helm', primaryStat: 'guard',      secondaryStat: 'initiative', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Visor Helm',  primaryStat: 'guard',      secondaryStat: 'control', affinity: 'breaker' },
  },
  shield: {
    aggressive: { variant: 'aggressive', name: 'Buckler',       primaryStat: 'guard', secondaryStat: 'control', affinity: 'technician' },
    balanced:   { variant: 'balanced',   name: 'Heater Shield', primaryStat: 'guard', secondaryStat: 'stamina', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Kite Shield',   primaryStat: 'guard', secondaryStat: 'initiative', affinity: 'bulwark' },
  },
  lance: {
    aggressive: { variant: 'aggressive', name: 'Jousting Lance', primaryStat: 'momentum', secondaryStat: 'initiative', affinity: 'charger' },
    balanced:   { variant: 'balanced',   name: 'War Lance',      primaryStat: 'momentum', secondaryStat: 'control', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Cavalry Lance',  primaryStat: 'momentum', secondaryStat: 'stamina', affinity: 'bulwark' },
  },
  armor: {
    aggressive: { variant: 'aggressive', name: 'Hardened Leather', primaryStat: 'stamina', secondaryStat: 'control', affinity: 'technician' },
    balanced:   { variant: 'balanced',   name: 'Chain Mail',      primaryStat: 'stamina', secondaryStat: 'guard', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Plate Armor',     primaryStat: 'guard',   secondaryStat: 'stamina', affinity: 'bulwark' },
  },
  gauntlets: {
    aggressive: { variant: 'aggressive', name: 'Dexterous Gloves',      primaryStat: 'initiative', secondaryStat: 'control', affinity: 'technician' },
    balanced:   { variant: 'balanced',   name: 'Steel Gauntlets',       primaryStat: 'control',    secondaryStat: 'initiative', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Reinforced Gauntlets',  primaryStat: 'control',    secondaryStat: 'stamina', affinity: 'breaker' },
  },
  melee_weapon: {
    aggressive: { variant: 'aggressive', name: 'Greatsword',  primaryStat: 'momentum', secondaryStat: 'control', affinity: 'charger' },
    balanced:   { variant: 'balanced',   name: 'Longsword',   primaryStat: 'momentum', secondaryStat: 'stamina', affinity: 'duelist' },
    defensive:  { variant: 'defensive',  name: 'Battle Axe',  primaryStat: 'momentum', secondaryStat: 'guard', affinity: 'breaker' },
  },
};

// --- Lookup helpers ---

export function getSteedSlotStats(
  slot: SteedGearSlot,
  variant: GearVariant = 'balanced',
): { primary: JoustStat; secondary: JoustStat } {
  const def = STEED_GEAR_VARIANTS[slot][variant];
  return { primary: def.primaryStat, secondary: def.secondaryStat };
}

export function getPlayerSlotStats(
  slot: PlayerGearSlot,
  variant: GearVariant = 'balanced',
): { primary: JoustStat; secondary: JoustStat } {
  const def = PLAYER_GEAR_VARIANTS[slot][variant];
  return { primary: def.primaryStat, secondary: def.secondaryStat };
}

export function getSteedVariantDef(
  slot: SteedGearSlot,
  variant: GearVariant,
): GearVariantDefinition {
  return STEED_GEAR_VARIANTS[slot][variant];
}

export function getPlayerVariantDef(
  slot: PlayerGearSlot,
  variant: GearVariant,
): GearVariantDefinition {
  return PLAYER_GEAR_VARIANTS[slot][variant];
}

// --- All variants list (for UI enumeration) ---

export const ALL_GEAR_VARIANTS: GearVariant[] = ['aggressive', 'balanced', 'defensive'];

export const ALL_STEED_SLOTS: SteedGearSlot[] = ['chamfron', 'barding', 'saddle', 'stirrups', 'reins', 'horseshoes'];
export const ALL_PLAYER_SLOTS: PlayerGearSlot[] = ['helm', 'shield', 'lance', 'armor', 'gauntlets', 'melee_weapon'];
