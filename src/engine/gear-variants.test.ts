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
import { createMatch, submitJoustPass, submitMeleeRound } from './match';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS } from './attacks';
import { SpeedType, Phase } from './types';
import type { GearVariant, SteedGearSlot, PlayerGearSlot, JoustStat, Archetype, GiglingLoadout, PlayerLoadout, Attack } from './types';

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

// ============================================================
// BL-004: Gear Variant × Archetype Matchup Interaction Tests
// ============================================================

// Deterministic RNG for reproducible tests
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Joust attacks
const CF = JOUST_ATTACKS.coupFort;
const BdG = JOUST_ATTACKS.brisDeGarde;
const CdL = JOUST_ATTACKS.courseDeLance;
const CdP = JOUST_ATTACKS.coupDePointe;
const PdL = JOUST_ATTACKS.portDeLance;
const CEP = JOUST_ATTACKS.coupEnPassant;

// Melee attacks
const OC = MELEE_ATTACKS.overhandCleave;
const FB = MELEE_ATTACKS.feintBreak;
const MC = MELEE_ATTACKS.measuredCut;
const PT = MELEE_ATTACKS.precisionThrust;
const GH = MELEE_ATTACKS.guardHigh;
const RS = MELEE_ATTACKS.riposteStep;

function cycleJoustAttack(pass: number): Attack {
  const attacks = [CF, BdG, CdL, CdP, PdL, CEP];
  return attacks[pass % attacks.length];
}
function cycleMeleeAttack(round: number): Attack {
  const attacks = [OC, FB, MC, PT, GH, RS];
  return attacks[round % attacks.length];
}
function cycleSpeed(pass: number): SpeedType {
  const speeds = [SpeedType.Slow, SpeedType.Standard, SpeedType.Fast];
  return speeds[pass % speeds.length];
}

/**
 * Run a full match with deterministic cycling — same as playtest.test.ts
 */
function simulateMatch(
  arch1: Archetype,
  arch2: Archetype,
  steedLoadout1?: GiglingLoadout,
  steedLoadout2?: GiglingLoadout,
  playerLoadout1?: PlayerLoadout,
  playerLoadout2?: PlayerLoadout,
) {
  let match = createMatch(arch1, arch2, steedLoadout1, steedLoadout2, playerLoadout1, playerLoadout2);
  let safety = 0;

  while (match.phase === Phase.SpeedSelect && safety < 10) {
    const pass = match.passNumber;
    match = submitJoustPass(match,
      { speed: cycleSpeed(pass), attack: cycleJoustAttack(pass) },
      { speed: cycleSpeed(pass + 1), attack: cycleJoustAttack(pass + 2) },
    );
    safety++;
  }

  let meleeRounds = 0;
  while (match.phase === Phase.MeleeSelect && meleeRounds < 30) {
    match = submitMeleeRound(match,
      cycleMeleeAttack(meleeRounds),
      cycleMeleeAttack(meleeRounds + 3),
    );
    meleeRounds++;
  }

  return match;
}

// ===== BL-004 Part 1: All-aggressive vs all-defensive for each archetype pair =====

describe('BL-004: All-aggressive vs all-defensive variant matchups', () => {
  const archetypeIds = Object.keys(ARCHETYPES);
  const rarities = ['epic', 'giga'] as const;

  for (const rarity of rarities) {
    describe(`at ${rarity} rarity`, () => {
      for (const id1 of archetypeIds) {
        for (const id2 of archetypeIds) {
          it(`${id1}(aggressive) vs ${id2}(defensive) at ${rarity} completes without error`, () => {
            const rng1 = makeRng(42);
            const rng2 = makeRng(99);
            const aggSteed = createFullLoadout(rarity, rarity, rng1, 'aggressive');
            const aggPlayer = createFullPlayerLoadout(rarity, rng1, 'aggressive');
            const defSteed = createFullLoadout(rarity, rarity, rng2, 'defensive');
            const defPlayer = createFullPlayerLoadout(rarity, rng2, 'defensive');

            const match = simulateMatch(
              ARCHETYPES[id1], ARCHETYPES[id2],
              aggSteed, defSteed, aggPlayer, defPlayer,
            );
            expect(match.phase).toBe(Phase.MatchEnd);
            expect(['player1', 'player2', 'draw']).toContain(match.winner);
            expect(match.winReason.length).toBeGreaterThan(0);
          });
        }
      }
    });
  }
});

// ===== BL-004 Part 2: No variant creates degenerate strategies =====

describe('BL-004: Variant strategies — horizontal power verified', () => {
  const archetypeIds = Object.keys(ARCHETYPES);
  const variants: GearVariant[] = ['aggressive', 'balanced', 'defensive'];

  // Core invariant: all variants have same total stat budget (no vertical power gain)
  it('all steed variants at giga have identical stat total across all slots', () => {
    for (const slot of ALL_STEED_SLOTS) {
      const totals: number[] = [];
      for (const variant of variants) {
        const rng = makeRng(42);
        const gear = createStatGear(slot, 'giga', rng, variant);
        totals.push(gear.primaryStat!.value + gear.secondaryStat!.value);
      }
      expect(totals[0], `${slot}: agg total = balanced total`).toBe(totals[1]);
      expect(totals[1], `${slot}: balanced total = def total`).toBe(totals[2]);
    }
  });

  it('all player variants at giga have identical stat total across all slots', () => {
    for (const slot of ALL_PLAYER_SLOTS) {
      const totals: number[] = [];
      for (const variant of variants) {
        const rng = makeRng(42);
        const gear = createPlayerGear(slot, 'giga', rng, variant);
        totals.push(gear.primaryStat!.value + gear.secondaryStat!.value);
      }
      expect(totals[0], `${slot}: agg total = balanced total`).toBe(totals[1]);
      expect(totals[1], `${slot}: balanced total = def total`).toBe(totals[2]);
    }
  });

  // Full loadout totals are identical across variants (no vertical advantage)
  it('full steed loadout total stats are identical across variants at giga', () => {
    const sums: number[] = [];
    for (const variant of variants) {
      const rng = makeRng(42);
      const loadout = createFullLoadout('giga', 'giga', rng, variant);
      const bonuses = sumGearStats(loadout);
      const total = bonuses.momentum + bonuses.control + bonuses.guard + bonuses.initiative + bonuses.stamina;
      sums.push(total);
    }
    expect(sums[0], 'aggressive total = balanced total').toBe(sums[1]);
    expect(sums[1], 'balanced total = defensive total').toBe(sums[2]);
  });

  it('full player loadout total stats are identical across variants at giga', () => {
    const sums: number[] = [];
    for (const variant of variants) {
      const rng = makeRng(42);
      const loadout = createFullPlayerLoadout('giga', rng, variant);
      const bonuses = sumPlayerGearStats(loadout);
      const total = bonuses.momentum + bonuses.control + bonuses.guard + bonuses.initiative + bonuses.stamina;
      sums.push(total);
    }
    expect(sums[0], 'aggressive total = balanced total').toBe(sums[1]);
    expect(sums[1], 'balanced total = defensive total').toBe(sums[2]);
  });

  // Variants produce meaningfully different stat distributions (not just a rename)
  for (const archId of archetypeIds) {
    it(`${archId}: aggressive vs defensive gear produces different boosted stats`, () => {
      const rng1 = makeRng(100);
      const rng2 = makeRng(100); // same seed for fair comparison
      const aggSteed = createFullLoadout('giga', 'giga', rng1, 'aggressive');
      const aggPlayer = createFullPlayerLoadout('giga', rng1, 'aggressive');
      const defSteed = createFullLoadout('giga', 'giga', rng2, 'defensive');
      const defPlayer = createFullPlayerLoadout('giga', rng2, 'defensive');

      const aggMatch = createMatch(ARCHETYPES[archId], ARCHETYPES.duelist, aggSteed, undefined, aggPlayer);
      const defMatch = createMatch(ARCHETYPES[archId], ARCHETYPES.duelist, defSteed, undefined, defPlayer);

      const aggStats = aggMatch.player1.archetype;
      const defStats = defMatch.player1.archetype;

      // At least one stat should differ
      const allSame = aggStats.momentum === defStats.momentum
        && aggStats.control === defStats.control
        && aggStats.guard === defStats.guard
        && aggStats.initiative === defStats.initiative
        && aggStats.stamina === defStats.stamina;
      expect(allSame, `${archId}: agg and def should produce different stat profiles`).toBe(false);
    });
  }

  // Variant stat differences are bounded (no variant creates runaway advantage)
  it('maximum stat difference between aggressive and defensive full loadout is bounded', () => {
    const rng1 = makeRng(42);
    const rng2 = makeRng(42);
    const aggSteed = createFullLoadout('giga', 'giga', rng1, 'aggressive');
    const defSteed = createFullLoadout('giga', 'giga', rng2, 'defensive');

    const aggBonuses = sumGearStats(aggSteed);
    const defBonuses = sumGearStats(defSteed);

    const stats = ['momentum', 'control', 'guard', 'initiative', 'stamina'] as const;
    for (const stat of stats) {
      const diff = Math.abs(aggBonuses[stat] - defBonuses[stat]);
      // No single stat should differ by more than the total budget (sanity check)
      // At giga: primary [5,9], secondary [4,6] → max per piece = 15, 6 slots = 90
      // Realistic max diff for a single stat ≈ 40-50 (if all slots route to that stat)
      expect(diff, `${stat} diff between agg and def < 60`).toBeLessThan(60);
    }
  });

  // All variant matches complete (no crashes from extreme stat profiles)
  for (const variant of variants) {
    for (const archId of archetypeIds) {
      it(`${archId} with all-${variant} gear completes against all archetypes`, () => {
        const rng = makeRng(42);
        const steed = createFullLoadout('giga', 'giga', rng, variant);
        const player = createFullPlayerLoadout('giga', rng, variant);

        for (const oppId of archetypeIds) {
          const match = simulateMatch(
            ARCHETYPES[archId], ARCHETYPES[oppId],
            steed, undefined, player, undefined,
          );
          expect(match.phase).toBe(Phase.MatchEnd);
          expect(['player1', 'player2', 'draw']).toContain(match.winner);
        }
      });
    }
  }
});

// ===== BL-004 Part 3: Mixed variant loadouts work correctly =====

describe('BL-004: Mixed variant loadouts — correctness', () => {
  it('mixed steed variant loadout (different variant per slot) creates valid gear', () => {
    const rng = makeRng(500);
    const steedLoadout: GiglingLoadout = {
      giglingRarity: 'epic',
      chamfron: createStatGear('chamfron', 'epic', rng, 'aggressive'),
      barding: createStatGear('barding', 'epic', rng, 'defensive'),
      saddle: createStatGear('saddle', 'epic', rng, 'balanced'),
      stirrups: createStatGear('stirrups', 'epic', rng, 'aggressive'),
      reins: createStatGear('reins', 'epic', rng, 'defensive'),
      horseshoes: createStatGear('horseshoes', 'epic', rng, 'balanced'),
    };

    // Verify each piece has the correct variant
    expect(steedLoadout.chamfron!.variant).toBe('aggressive');
    expect(steedLoadout.barding!.variant).toBe('defensive');
    expect(steedLoadout.saddle!.variant).toBe('balanced');
    expect(steedLoadout.stirrups!.variant).toBe('aggressive');
    expect(steedLoadout.reins!.variant).toBe('defensive');
    expect(steedLoadout.horseshoes!.variant).toBe('balanced');

    // Verify stat routing differs between slots with different variants
    // Aggressive chamfron primary = momentum, defensive barding primary = guard
    expect(steedLoadout.chamfron!.primaryStat!.stat).toBe('momentum');
    expect(steedLoadout.barding!.primaryStat!.stat).toBe('guard');
  });

  it('mixed player variant loadout (different variant per slot) creates valid gear', () => {
    const rng = makeRng(600);
    const playerLoadout: PlayerLoadout = {
      helm: createPlayerGear('helm', 'legendary', rng, 'defensive'),
      shield: createPlayerGear('shield', 'legendary', rng, 'aggressive'),
      lance: createPlayerGear('lance', 'legendary', rng, 'balanced'),
      armor: createPlayerGear('armor', 'legendary', rng, 'defensive'),
      gauntlets: createPlayerGear('gauntlets', 'legendary', rng, 'aggressive'),
      melee_weapon: createPlayerGear('melee_weapon', 'legendary', rng, 'balanced'),
    };

    expect(playerLoadout.helm!.variant).toBe('defensive');
    expect(playerLoadout.shield!.variant).toBe('aggressive');
    expect(playerLoadout.lance!.variant).toBe('balanced');
    expect(playerLoadout.armor!.variant).toBe('defensive');
    expect(playerLoadout.gauntlets!.variant).toBe('aggressive');
    expect(playerLoadout.melee_weapon!.variant).toBe('balanced');
  });

  it('mixed variant loadout match completes for all archetypes', () => {
    const archetypeIds = Object.keys(ARCHETYPES);
    for (const archId of archetypeIds) {
      const rng1 = makeRng(700 + archetypeIds.indexOf(archId));
      const rng2 = makeRng(800 + archetypeIds.indexOf(archId));

      // P1: aggressive steed + defensive player
      const steed1: GiglingLoadout = {
        giglingRarity: 'epic',
        chamfron: createStatGear('chamfron', 'epic', rng1, 'aggressive'),
        barding: createStatGear('barding', 'epic', rng1, 'aggressive'),
        saddle: createStatGear('saddle', 'epic', rng1, 'aggressive'),
        stirrups: createStatGear('stirrups', 'epic', rng1, 'aggressive'),
        reins: createStatGear('reins', 'epic', rng1, 'aggressive'),
        horseshoes: createStatGear('horseshoes', 'epic', rng1, 'aggressive'),
      };
      const player1: PlayerLoadout = {
        helm: createPlayerGear('helm', 'epic', rng1, 'defensive'),
        shield: createPlayerGear('shield', 'epic', rng1, 'defensive'),
        lance: createPlayerGear('lance', 'epic', rng1, 'defensive'),
        armor: createPlayerGear('armor', 'epic', rng1, 'defensive'),
        gauntlets: createPlayerGear('gauntlets', 'epic', rng1, 'defensive'),
        melee_weapon: createPlayerGear('melee_weapon', 'epic', rng1, 'defensive'),
      };

      // P2: mixed variants
      const steed2: GiglingLoadout = {
        giglingRarity: 'epic',
        chamfron: createStatGear('chamfron', 'epic', rng2, 'defensive'),
        barding: createStatGear('barding', 'epic', rng2, 'balanced'),
        saddle: createStatGear('saddle', 'epic', rng2, 'aggressive'),
        stirrups: createStatGear('stirrups', 'epic', rng2, 'defensive'),
        reins: createStatGear('reins', 'epic', rng2, 'balanced'),
        horseshoes: createStatGear('horseshoes', 'epic', rng2, 'aggressive'),
      };
      const player2: PlayerLoadout = {
        helm: createPlayerGear('helm', 'epic', rng2, 'aggressive'),
        shield: createPlayerGear('shield', 'epic', rng2, 'defensive'),
        lance: createPlayerGear('lance', 'epic', rng2, 'aggressive'),
        armor: createPlayerGear('armor', 'epic', rng2, 'balanced'),
        gauntlets: createPlayerGear('gauntlets', 'epic', rng2, 'defensive'),
        melee_weapon: createPlayerGear('melee_weapon', 'epic', rng2, 'aggressive'),
      };

      const match = simulateMatch(
        ARCHETYPES[archId], ARCHETYPES[archId],
        steed1, steed2, player1, player2,
      );
      expect(match.phase, `${archId} mixed variant match completes`).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
    }
  });

  it('mixed variant stat sums are correct (manual verification)', () => {
    const rng = makeRng(999);
    const loadout: GiglingLoadout = {
      giglingRarity: 'epic',
      chamfron: createStatGear('chamfron', 'epic', rng, 'aggressive'),
      barding: createStatGear('barding', 'epic', rng, 'defensive'),
      saddle: createStatGear('saddle', 'epic', rng, 'balanced'),
      stirrups: createStatGear('stirrups', 'epic', rng, 'aggressive'),
      reins: createStatGear('reins', 'epic', rng, 'defensive'),
      horseshoes: createStatGear('horseshoes', 'epic', rng, 'balanced'),
    };

    const bonuses = sumGearStats(loadout);
    // Manually add up what each piece contributes
    let expectedMom = 0, expectedCtl = 0, expectedGrd = 0, expectedInit = 0, expectedSta = 0;
    for (const slot of ALL_STEED_SLOTS) {
      const gear = loadout[slot]!;
      const primary = gear.primaryStat!;
      const secondary = gear.secondaryStat!;
      if (primary.stat === 'momentum') expectedMom += primary.value;
      if (primary.stat === 'control') expectedCtl += primary.value;
      if (primary.stat === 'guard') expectedGrd += primary.value;
      if (primary.stat === 'initiative') expectedInit += primary.value;
      if (primary.stat === 'stamina') expectedSta += primary.value;
      if (secondary.stat === 'momentum') expectedMom += secondary.value;
      if (secondary.stat === 'control') expectedCtl += secondary.value;
      if (secondary.stat === 'guard') expectedGrd += secondary.value;
      if (secondary.stat === 'initiative') expectedInit += secondary.value;
      if (secondary.stat === 'stamina') expectedSta += secondary.value;
    }

    expect(bonuses.momentum).toBe(expectedMom);
    expect(bonuses.control).toBe(expectedCtl);
    expect(bonuses.guard).toBe(expectedGrd);
    expect(bonuses.initiative).toBe(expectedInit);
    expect(bonuses.stamina).toBe(expectedSta);
  });

  it('mixed variant player gear stat sums are correct', () => {
    const rng = makeRng(1234);
    const loadout: PlayerLoadout = {
      helm: createPlayerGear('helm', 'rare', rng, 'aggressive'),
      shield: createPlayerGear('shield', 'rare', rng, 'balanced'),
      lance: createPlayerGear('lance', 'rare', rng, 'defensive'),
      armor: createPlayerGear('armor', 'rare', rng, 'aggressive'),
      gauntlets: createPlayerGear('gauntlets', 'rare', rng, 'balanced'),
      melee_weapon: createPlayerGear('melee_weapon', 'rare', rng, 'defensive'),
    };

    const bonuses = sumPlayerGearStats(loadout);
    let expectedMom = 0, expectedCtl = 0, expectedGrd = 0, expectedInit = 0, expectedSta = 0;
    for (const slot of ALL_PLAYER_SLOTS) {
      const gear = loadout[slot]!;
      const primary = gear.primaryStat!;
      const secondary = gear.secondaryStat!;
      if (primary.stat === 'momentum') expectedMom += primary.value;
      if (primary.stat === 'control') expectedCtl += primary.value;
      if (primary.stat === 'guard') expectedGrd += primary.value;
      if (primary.stat === 'initiative') expectedInit += primary.value;
      if (primary.stat === 'stamina') expectedSta += primary.value;
      if (secondary.stat === 'momentum') expectedMom += secondary.value;
      if (secondary.stat === 'control') expectedCtl += secondary.value;
      if (secondary.stat === 'guard') expectedGrd += secondary.value;
      if (secondary.stat === 'initiative') expectedInit += secondary.value;
      if (secondary.stat === 'stamina') expectedSta += secondary.value;
    }

    expect(bonuses.momentum).toBe(expectedMom);
    expect(bonuses.control).toBe(expectedCtl);
    expect(bonuses.guard).toBe(expectedGrd);
    expect(bonuses.initiative).toBe(expectedInit);
    expect(bonuses.stamina).toBe(expectedSta);
  });
});

// ===== Variant effect on match stats =====

describe('BL-004: Variant effects are mechanically meaningful', () => {
  it('aggressive steed loadout produces higher momentum bonus than defensive', () => {
    const rng1 = makeRng(10);
    const rng2 = makeRng(10); // same seed for fair comparison
    const aggSteed = createFullLoadout('giga', 'giga', rng1, 'aggressive');
    const defSteed = createFullLoadout('giga', 'giga', rng2, 'defensive');

    const aggBonuses = sumGearStats(aggSteed);
    const defBonuses = sumGearStats(defSteed);

    expect(aggBonuses.momentum).toBeGreaterThan(defBonuses.momentum);
  });

  it('defensive steed loadout produces higher guard bonus than aggressive', () => {
    const rng1 = makeRng(10);
    const rng2 = makeRng(10);
    const aggSteed = createFullLoadout('giga', 'giga', rng1, 'aggressive');
    const defSteed = createFullLoadout('giga', 'giga', rng2, 'defensive');

    const aggBonuses = sumGearStats(aggSteed);
    const defBonuses = sumGearStats(defSteed);

    expect(defBonuses.guard).toBeGreaterThan(aggBonuses.guard);
  });

  it('aggressive player loadout produces different stat spread than defensive', () => {
    const rng1 = makeRng(20);
    const rng2 = makeRng(20);
    const aggPlayer = createFullPlayerLoadout('giga', rng1, 'aggressive');
    const defPlayer = createFullPlayerLoadout('giga', rng2, 'defensive');

    const aggBonuses = sumPlayerGearStats(aggPlayer);
    const defBonuses = sumPlayerGearStats(defPlayer);

    // Stat distributions should differ — at least one stat is not equal
    const statsMatch = aggBonuses.momentum === defBonuses.momentum
      && aggBonuses.control === defBonuses.control
      && aggBonuses.guard === defBonuses.guard
      && aggBonuses.initiative === defBonuses.initiative
      && aggBonuses.stamina === defBonuses.stamina;

    expect(statsMatch, 'aggressive and defensive player gear should produce different stat spreads').toBe(false);
  });
});

// ===== All-variant stress test =====

describe('BL-004: All variant × rarity × archetype stress test', () => {
  const rarities = ['uncommon', 'epic', 'giga'] as const;
  const variants: GearVariant[] = ['aggressive', 'balanced', 'defensive'];

  it('36 archetype matchups × 3 variants at epic complete without error', () => {
    const archetypeIds = Object.keys(ARCHETYPES);
    for (const variant of variants) {
      for (const id1 of archetypeIds) {
        for (const id2 of archetypeIds) {
          const rng1 = makeRng(42);
          const rng2 = makeRng(99);
          const steed1 = createFullLoadout('epic', 'epic', rng1, variant);
          const player1 = createFullPlayerLoadout('epic', rng1, variant);
          const steed2 = createFullLoadout('epic', 'epic', rng2, variant);
          const player2 = createFullPlayerLoadout('epic', rng2, variant);

          const match = simulateMatch(
            ARCHETYPES[id1], ARCHETYPES[id2],
            steed1, steed2, player1, player2,
          );
          expect(match.phase).toBe(Phase.MatchEnd);
          expect(['player1', 'player2', 'draw']).toContain(match.winner);
        }
      }
    }
  });

  it('mixed-variant fully geared matches at all 3 rarity tiers complete', () => {
    for (const rarity of rarities) {
      const rng = makeRng(55);
      // P1: aggressive steed + balanced player
      const steed1 = createFullLoadout(rarity, rarity, rng, 'aggressive');
      const player1 = createFullPlayerLoadout(rarity, rng, 'balanced');
      // P2: defensive steed + aggressive player
      const steed2 = createFullLoadout(rarity, rarity, rng, 'defensive');
      const player2 = createFullPlayerLoadout(rarity, rng, 'aggressive');

      const match = simulateMatch(
        ARCHETYPES.charger, ARCHETYPES.bulwark,
        steed1, steed2, player1, player2,
      );
      expect(match.phase, `mixed variant at ${rarity} completes`).toBe(Phase.MatchEnd);
    }
  });

  it('performance: 50 variant matches complete in <500ms', () => {
    const archetypeIds = Object.keys(ARCHETYPES);
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      const rng = makeRng(i * 13);
      const variant = variants[i % 3];
      const a1 = ARCHETYPES[archetypeIds[i % archetypeIds.length]];
      const a2 = ARCHETYPES[archetypeIds[(i + 1) % archetypeIds.length]];
      const steed1 = createFullLoadout('giga', 'giga', rng, variant);
      const player1 = createFullPlayerLoadout('giga', rng, variant);

      simulateMatch(a1, a2, steed1, undefined, player1, undefined);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
