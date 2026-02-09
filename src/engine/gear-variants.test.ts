// ============================================================
// Gear Variant System Tests
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  STEED_GEAR_VARIANTS,
  PLAYER_GEAR_VARIANTS,
  getSteedSlotStats,
  getPlayerSlotStats,
  getSteedVariantDef,
  getPlayerVariantDef,
  ALL_GEAR_VARIANTS,
  ALL_STEED_SLOTS,
  ALL_PLAYER_SLOTS,
} from './gear-variants';
import { createStatGear, createFullLoadout, sumGearStats, GEAR_SLOT_STATS } from './gigling-gear';
import { createPlayerGear, createFullPlayerLoadout, sumPlayerGearStats, PLAYER_GEAR_SLOT_STATS } from './player-gear';
import type { GearVariant, SteedGearSlot, PlayerGearSlot, JoustStat } from './types';

const VALID_STATS: JoustStat[] = ['momentum', 'control', 'guard', 'initiative', 'stamina'];
const fixedRng = () => 0.5;

// ===== Registry completeness =====

describe('Variant registry completeness', () => {
  it('has 6 steed slots × 3 variants = 18 steed definitions', () => {
    let count = 0;
    for (const slot of ALL_STEED_SLOTS) {
      for (const variant of ALL_GEAR_VARIANTS) {
        expect(STEED_GEAR_VARIANTS[slot][variant]).toBeDefined();
        count++;
      }
    }
    expect(count).toBe(18);
  });

  it('has 6 player slots × 3 variants = 18 player definitions', () => {
    let count = 0;
    for (const slot of ALL_PLAYER_SLOTS) {
      for (const variant of ALL_GEAR_VARIANTS) {
        expect(PLAYER_GEAR_VARIANTS[slot][variant]).toBeDefined();
        count++;
      }
    }
    expect(count).toBe(18);
  });

  it('all 36 definitions have valid JoustStat values', () => {
    for (const slot of ALL_STEED_SLOTS) {
      for (const variant of ALL_GEAR_VARIANTS) {
        const def = STEED_GEAR_VARIANTS[slot][variant];
        expect(VALID_STATS).toContain(def.primaryStat);
        expect(VALID_STATS).toContain(def.secondaryStat);
        expect(def.primaryStat).not.toBe(def.secondaryStat);
      }
    }
    for (const slot of ALL_PLAYER_SLOTS) {
      for (const variant of ALL_GEAR_VARIANTS) {
        const def = PLAYER_GEAR_VARIANTS[slot][variant];
        expect(VALID_STATS).toContain(def.primaryStat);
        expect(VALID_STATS).toContain(def.secondaryStat);
        expect(def.primaryStat).not.toBe(def.secondaryStat);
      }
    }
  });

  it('all definitions have non-empty names and affinities', () => {
    for (const slot of ALL_STEED_SLOTS) {
      for (const variant of ALL_GEAR_VARIANTS) {
        const def = STEED_GEAR_VARIANTS[slot][variant];
        expect(def.name.length).toBeGreaterThan(0);
        expect(def.affinity.length).toBeGreaterThan(0);
        expect(def.variant).toBe(variant);
      }
    }
    for (const slot of ALL_PLAYER_SLOTS) {
      for (const variant of ALL_GEAR_VARIANTS) {
        const def = PLAYER_GEAR_VARIANTS[slot][variant];
        expect(def.name.length).toBeGreaterThan(0);
        expect(def.affinity.length).toBeGreaterThan(0);
        expect(def.variant).toBe(variant);
      }
    }
  });
});

// ===== Balanced variant matches legacy defaults =====

describe('Balanced variant matches legacy slot stats', () => {
  for (const slot of ALL_STEED_SLOTS) {
    it(`steed ${slot}: balanced variant matches GEAR_SLOT_STATS`, () => {
      const variantStats = getSteedSlotStats(slot, 'balanced');
      const legacyStats = GEAR_SLOT_STATS[slot];
      expect(variantStats.primary).toBe(legacyStats.primary);
      expect(variantStats.secondary).toBe(legacyStats.secondary);
    });
  }

  for (const slot of ALL_PLAYER_SLOTS) {
    it(`player ${slot}: balanced variant matches PLAYER_GEAR_SLOT_STATS`, () => {
      const variantStats = getPlayerSlotStats(slot, 'balanced');
      const legacyStats = PLAYER_GEAR_SLOT_STATS[slot];
      expect(variantStats.primary).toBe(legacyStats.primary);
      expect(variantStats.secondary).toBe(legacyStats.secondary);
    });
  }
});

// ===== Variant-aware factory functions =====

describe('Variant-aware steed gear creation', () => {
  it('createStatGear without variant produces legacy stats', () => {
    const gear = createStatGear('chamfron', 'epic', fixedRng);
    expect(gear.variant).toBeUndefined();
    expect(gear.primaryStat!.stat).toBe('guard');
    expect(gear.secondaryStat!.stat).toBe('momentum');
  });

  it('createStatGear with balanced variant matches legacy', () => {
    const gear = createStatGear('chamfron', 'epic', fixedRng, 'balanced');
    expect(gear.variant).toBe('balanced');
    expect(gear.primaryStat!.stat).toBe('guard');
    expect(gear.secondaryStat!.stat).toBe('momentum');
  });

  it('createStatGear with aggressive variant changes stat allocation', () => {
    const gear = createStatGear('chamfron', 'epic', fixedRng, 'aggressive');
    expect(gear.variant).toBe('aggressive');
    expect(gear.primaryStat!.stat).toBe('momentum');
    expect(gear.secondaryStat!.stat).toBe('guard');
  });

  it('createStatGear with defensive variant changes stat allocation', () => {
    const gear = createStatGear('chamfron', 'epic', fixedRng, 'defensive');
    expect(gear.variant).toBe('defensive');
    expect(gear.primaryStat!.stat).toBe('guard');
    expect(gear.secondaryStat!.stat).toBe('stamina');
  });

  it('createStatGear preserves rarity ranges regardless of variant', () => {
    for (const variant of ALL_GEAR_VARIANTS) {
      const gear = createStatGear('saddle', 'epic', fixedRng, variant);
      // epic primary [2,4], secondary [1,3]
      expect(gear.primaryStat!.value).toBeGreaterThanOrEqual(2);
      expect(gear.primaryStat!.value).toBeLessThanOrEqual(4);
      expect(gear.secondaryStat!.value).toBeGreaterThanOrEqual(1);
      expect(gear.secondaryStat!.value).toBeLessThanOrEqual(3);
    }
  });

  it('createFullLoadout with variant sets variant on all pieces', () => {
    const loadout = createFullLoadout('epic', 'epic', fixedRng, 'aggressive');
    for (const slot of ALL_STEED_SLOTS) {
      expect(loadout[slot]!.variant).toBe('aggressive');
    }
  });

  it('createFullLoadout without variant leaves variant undefined', () => {
    const loadout = createFullLoadout('epic', 'epic', fixedRng);
    for (const slot of ALL_STEED_SLOTS) {
      expect(loadout[slot]!.variant).toBeUndefined();
    }
  });
});

describe('Variant-aware player gear creation', () => {
  it('createPlayerGear without variant produces legacy stats', () => {
    const gear = createPlayerGear('lance', 'epic', fixedRng);
    expect(gear.variant).toBeUndefined();
    expect(gear.primaryStat!.stat).toBe('momentum');
    expect(gear.secondaryStat!.stat).toBe('control');
  });

  it('createPlayerGear with aggressive variant changes allocation', () => {
    const gear = createPlayerGear('lance', 'epic', fixedRng, 'aggressive');
    expect(gear.variant).toBe('aggressive');
    expect(gear.primaryStat!.stat).toBe('momentum');
    expect(gear.secondaryStat!.stat).toBe('initiative');
  });

  it('createPlayerGear with defensive variant changes allocation', () => {
    const gear = createPlayerGear('lance', 'epic', fixedRng, 'defensive');
    expect(gear.variant).toBe('defensive');
    expect(gear.primaryStat!.stat).toBe('momentum');
    expect(gear.secondaryStat!.stat).toBe('stamina');
  });

  it('createFullPlayerLoadout with variant sets variant on all pieces', () => {
    const loadout = createFullPlayerLoadout('epic', fixedRng, 'defensive');
    for (const slot of ALL_PLAYER_SLOTS) {
      expect(loadout[slot]!.variant).toBe('defensive');
    }
  });
});

// ===== Horizontal power — same total stat budget =====

describe('Horizontal power — same stat budget across variants', () => {
  it('all steed slot variants at epic produce same value totals', () => {
    for (const slot of ALL_STEED_SLOTS) {
      const totals: number[] = [];
      for (const variant of ALL_GEAR_VARIANTS) {
        const gear = createStatGear(slot, 'epic', fixedRng, variant);
        totals.push(gear.primaryStat!.value + gear.secondaryStat!.value);
      }
      // All variants use the same rarity ranges → same total with fixed rng
      expect(totals[0]).toBe(totals[1]);
      expect(totals[1]).toBe(totals[2]);
    }
  });

  it('all player slot variants at epic produce same value totals', () => {
    for (const slot of ALL_PLAYER_SLOTS) {
      const totals: number[] = [];
      for (const variant of ALL_GEAR_VARIANTS) {
        const gear = createPlayerGear(slot, 'epic', fixedRng, variant);
        totals.push(gear.primaryStat!.value + gear.secondaryStat!.value);
      }
      expect(totals[0]).toBe(totals[1]);
      expect(totals[1]).toBe(totals[2]);
    }
  });
});

// ===== Stat routing — variants change which stats get bonuses =====

describe('Stat routing — variants produce different stat distributions', () => {
  it('aggressive chamfron routes primary to MOM, defensive routes secondary to STA', () => {
    const agg = createStatGear('chamfron', 'giga', fixedRng, 'aggressive');
    const def = createStatGear('chamfron', 'giga', fixedRng, 'defensive');

    // Aggressive: MOM gets primary value (higher), GRD gets secondary (lower)
    expect(agg.primaryStat!.stat).toBe('momentum');
    // Defensive: GRD gets primary (higher), STA gets secondary (lower)
    expect(def.secondaryStat!.stat).toBe('stamina');
  });

  it('aggressive loadout pumps different stats than defensive loadout', () => {
    const aggLoadout = createFullLoadout('giga', 'giga', fixedRng, 'aggressive');
    const defLoadout = createFullLoadout('giga', 'giga', fixedRng, 'defensive');

    const aggBonuses = sumGearStats(aggLoadout);
    const defBonuses = sumGearStats(defLoadout);

    // Aggressive should have more momentum than defensive
    expect(aggBonuses.momentum).toBeGreaterThan(defBonuses.momentum);
    // Defensive should have more guard than aggressive
    expect(defBonuses.guard).toBeGreaterThan(aggBonuses.guard);
  });

  it('player aggressive loadout has more momentum than defensive', () => {
    const aggLoadout = createFullPlayerLoadout('giga', fixedRng, 'aggressive');
    const defLoadout = createFullPlayerLoadout('giga', fixedRng, 'defensive');

    const aggBonuses = sumPlayerGearStats(aggLoadout);
    const defBonuses = sumPlayerGearStats(defLoadout);

    expect(aggBonuses.momentum).toBeGreaterThanOrEqual(defBonuses.momentum);
  });
});

// ===== Lookup helper functions =====

describe('Lookup helpers', () => {
  it('getSteedSlotStats defaults to balanced', () => {
    const stats = getSteedSlotStats('chamfron');
    expect(stats.primary).toBe('guard');
    expect(stats.secondary).toBe('momentum');
  });

  it('getPlayerSlotStats defaults to balanced', () => {
    const stats = getPlayerSlotStats('helm');
    expect(stats.primary).toBe('guard');
    expect(stats.secondary).toBe('initiative');
  });

  it('getSteedVariantDef returns correct definition', () => {
    const def = getSteedVariantDef('saddle', 'aggressive');
    expect(def.name).toBe('Racing Saddle');
    expect(def.primaryStat).toBe('initiative');
    expect(def.affinity).toBe('tactician');
  });

  it('getPlayerVariantDef returns correct definition', () => {
    const def = getPlayerVariantDef('melee_weapon', 'defensive');
    expect(def.name).toBe('Battle Axe');
    expect(def.primaryStat).toBe('momentum');
    expect(def.secondaryStat).toBe('guard');
    expect(def.affinity).toBe('breaker');
  });
});

// ===== Design doc verification =====

describe('Design doc — specific variant definitions', () => {
  // Spot-check key variants from gear-variants.md

  it('Spiked Chamfron is aggressive, MOM/GRD, charger affinity', () => {
    const def = getSteedVariantDef('chamfron', 'aggressive');
    expect(def.name).toBe('Spiked Chamfron');
    expect(def.primaryStat).toBe('momentum');
    expect(def.secondaryStat).toBe('guard');
    expect(def.affinity).toBe('charger');
  });

  it('Shock Stirrups is defensive, MOM/GRD, breaker affinity', () => {
    const def = getSteedVariantDef('stirrups', 'defensive');
    expect(def.name).toBe('Shock Stirrups');
    expect(def.primaryStat).toBe('momentum');
    expect(def.secondaryStat).toBe('guard');
    expect(def.affinity).toBe('breaker');
  });

  it('Buckler is aggressive shield, GRD/CTL, technician affinity', () => {
    const def = getPlayerVariantDef('shield', 'aggressive');
    expect(def.name).toBe('Buckler');
    expect(def.primaryStat).toBe('guard');
    expect(def.secondaryStat).toBe('control');
    expect(def.affinity).toBe('technician');
  });

  it('Greatsword is aggressive melee_weapon, MOM/CTL, charger affinity', () => {
    const def = getPlayerVariantDef('melee_weapon', 'aggressive');
    expect(def.name).toBe('Greatsword');
    expect(def.primaryStat).toBe('momentum');
    expect(def.secondaryStat).toBe('control');
    expect(def.affinity).toBe('charger');
  });

  it('Dexterous Gloves is aggressive gauntlets, INIT/CTL, technician affinity', () => {
    const def = getPlayerVariantDef('gauntlets', 'aggressive');
    expect(def.name).toBe('Dexterous Gloves');
    expect(def.primaryStat).toBe('initiative');
    expect(def.secondaryStat).toBe('control');
    expect(def.affinity).toBe('technician');
  });
});

// ===== ALL_GEAR_VARIANTS / ALL_*_SLOTS =====

describe('Enum arrays', () => {
  it('ALL_GEAR_VARIANTS has 3 entries', () => {
    expect(ALL_GEAR_VARIANTS).toHaveLength(3);
    expect(ALL_GEAR_VARIANTS).toEqual(['aggressive', 'balanced', 'defensive']);
  });

  it('ALL_STEED_SLOTS has 6 entries', () => {
    expect(ALL_STEED_SLOTS).toHaveLength(6);
  });

  it('ALL_PLAYER_SLOTS has 6 entries', () => {
    expect(ALL_PLAYER_SLOTS).toHaveLength(6);
  });
});
