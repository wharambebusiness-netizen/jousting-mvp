// ============================================================
// Gigling Gear System — Unit & Integration Tests (6-Slot)
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS } from './attacks';
import { BALANCE } from './balance-config';
import { softCap } from './calculator';
import { SpeedType, type GiglingGear, type GiglingLoadout } from './types';
import {
  sumGearStats,
  applyGiglingLoadout,
  createStatGear,
  createFullLoadout,
  GEAR_SLOT_STATS,
  describeSteedSlot,
  validateSteedGear,
} from './gigling-gear';
import { createMatch, submitJoustPass } from './match';

const charger = ARCHETYPES.charger;
const bulwark = ARCHETYPES.bulwark;
const duelist = ARCHETYPES.duelist;
const technician = ARCHETYPES.technician;

const CdL = JOUST_ATTACKS.courseDeLance;

// --- Test Helpers ---

function makeGear(
  slot: GiglingGear['slot'],
  rarity: GiglingLoadout['giglingRarity'],
  primary: number,
  secondary: number,
): GiglingGear {
  const stats = GEAR_SLOT_STATS[slot];
  return {
    slot,
    rarity,
    primaryStat: { stat: stats.primary, value: primary },
    secondaryStat: { stat: stats.secondary, value: secondary },
  };
}

// ============================================================
// 1. GEAR_SLOT_STATS Mapping — All 6 Slots
// ============================================================
describe('Gear Slot → Stat Mapping', () => {
  it('chamfron maps to guard (primary) and momentum (secondary)', () => {
    expect(GEAR_SLOT_STATS.chamfron.primary).toBe('guard');
    expect(GEAR_SLOT_STATS.chamfron.secondary).toBe('momentum');
  });

  it('barding maps to guard (primary) and stamina (secondary)', () => {
    expect(GEAR_SLOT_STATS.barding.primary).toBe('guard');
    expect(GEAR_SLOT_STATS.barding.secondary).toBe('stamina');
  });

  it('saddle maps to control (primary) and initiative (secondary)', () => {
    expect(GEAR_SLOT_STATS.saddle.primary).toBe('control');
    expect(GEAR_SLOT_STATS.saddle.secondary).toBe('initiative');
  });

  it('stirrups maps to initiative (primary) and stamina (secondary)', () => {
    expect(GEAR_SLOT_STATS.stirrups.primary).toBe('initiative');
    expect(GEAR_SLOT_STATS.stirrups.secondary).toBe('stamina');
  });

  it('reins maps to control (primary) and momentum (secondary)', () => {
    expect(GEAR_SLOT_STATS.reins.primary).toBe('control');
    expect(GEAR_SLOT_STATS.reins.secondary).toBe('momentum');
  });

  it('horseshoes maps to momentum (primary) and initiative (secondary)', () => {
    expect(GEAR_SLOT_STATS.horseshoes.primary).toBe('momentum');
    expect(GEAR_SLOT_STATS.horseshoes.secondary).toBe('initiative');
  });

  it('has exactly 6 slots', () => {
    expect(Object.keys(GEAR_SLOT_STATS).length).toBe(6);
  });
});

// ============================================================
// 2. sumGearStats
// ============================================================
describe('sumGearStats', () => {
  it('returns zeroes for empty loadout (no gear pieces)', () => {
    const loadout: GiglingLoadout = { giglingRarity: 'uncommon' };
    const bonuses = sumGearStats(loadout);
    expect(bonuses).toEqual({ momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 });
  });

  it('sums a single gear piece correctly (chamfron)', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'rare',
      chamfron: makeGear('chamfron', 'rare', 5, 2),
    };
    const bonuses = sumGearStats(loadout);
    expect(bonuses.guard).toBe(5);     // chamfron primary
    expect(bonuses.momentum).toBe(2);  // chamfron secondary
    expect(bonuses.control).toBe(0);
    expect(bonuses.initiative).toBe(0);
    expect(bonuses.stamina).toBe(0);
  });

  it('sums multiple gear pieces', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'epic',
      chamfron: makeGear('chamfron', 'epic', 4, 2), // guard +4, momentum +2
      barding: makeGear('barding', 'epic', 3, 2),   // guard +3, stamina +2
      saddle: makeGear('saddle', 'epic', 4, 3),     // control +4, initiative +3
    };
    const bonuses = sumGearStats(loadout);
    expect(bonuses.guard).toBe(7);       // chamfron + barding
    expect(bonuses.momentum).toBe(2);    // chamfron secondary
    expect(bonuses.control).toBe(4);     // saddle primary
    expect(bonuses.initiative).toBe(3);  // saddle secondary
    expect(bonuses.stamina).toBe(2);     // barding secondary
  });

  it('sums all 6 gear pieces', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'legendary',
      chamfron: makeGear('chamfron', 'legendary', 4, 3),     // guard +4, momentum +3
      barding: makeGear('barding', 'legendary', 5, 2),       // guard +5, stamina +2
      saddle: makeGear('saddle', 'legendary', 4, 3),         // control +4, initiative +3
      stirrups: makeGear('stirrups', 'legendary', 3, 2),     // initiative +3, stamina +2
      reins: makeGear('reins', 'legendary', 5, 3),           // control +5, momentum +3
      horseshoes: makeGear('horseshoes', 'legendary', 4, 2), // momentum +4, initiative +2
    };
    const bonuses = sumGearStats(loadout);
    expect(bonuses.guard).toBe(4 + 5);         // chamfron + barding
    expect(bonuses.momentum).toBe(3 + 3 + 4);  // chamfron sec + reins sec + horseshoes pri
    expect(bonuses.control).toBe(4 + 5);        // saddle + reins
    expect(bonuses.initiative).toBe(3 + 3 + 2); // saddle sec + stirrups pri + horseshoes sec
    expect(bonuses.stamina).toBe(2 + 2);        // barding sec + stirrups sec
  });

  it('handles gear with only primaryStat (no secondary)', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'uncommon',
      barding: {
        slot: 'barding',
        rarity: 'uncommon',
        primaryStat: { stat: 'guard', value: 2 },
      },
    };
    const bonuses = sumGearStats(loadout);
    expect(bonuses.guard).toBe(2);
    expect(bonuses.stamina).toBe(0);
  });
});

// ============================================================
// 3. applyGiglingLoadout
// ============================================================
describe('applyGiglingLoadout', () => {
  it('returns archetype unchanged when loadout is undefined', () => {
    const result = applyGiglingLoadout(duelist, undefined);
    expect(result).toBe(duelist); // same reference
  });

  it('applies rarity bonus only (no gear) for uncommon → +2', () => {
    const loadout: GiglingLoadout = { giglingRarity: 'uncommon' };
    const result = applyGiglingLoadout(duelist, loadout);
    expect(result.momentum).toBe(duelist.momentum + 2);
    expect(result.control).toBe(duelist.control + 2);
    expect(result.guard).toBe(duelist.guard + 2);
    expect(result.initiative).toBe(duelist.initiative + 2);
    expect(result.stamina).toBe(duelist.stamina + 2);
  });

  it('applies rarity bonus for each tier', () => {
    const rarities: Array<{ rarity: GiglingLoadout['giglingRarity']; bonus: number }> = [
      { rarity: 'uncommon', bonus: 2 },
      { rarity: 'rare', bonus: 3 },
      { rarity: 'epic', bonus: 5 },
      { rarity: 'legendary', bonus: 7 },
      { rarity: 'relic', bonus: 10 },
      { rarity: 'giga', bonus: 13 },
    ];

    for (const { rarity, bonus } of rarities) {
      const loadout: GiglingLoadout = { giglingRarity: rarity };
      const result = applyGiglingLoadout(duelist, loadout);
      expect(result.momentum).toBe(duelist.momentum + bonus);
      expect(result.control).toBe(duelist.control + bonus);
      expect(result.guard).toBe(duelist.guard + bonus);
      expect(result.initiative).toBe(duelist.initiative + bonus);
      expect(result.stamina).toBe(duelist.stamina + bonus);
    }
  });

  it('applies rarity bonus + gear bonuses together (all 6 slots)', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'legendary', // +7 per stat
      chamfron: makeGear('chamfron', 'legendary', 5, 3),     // guard +5, momentum +3
      barding: makeGear('barding', 'legendary', 4, 2),       // guard +4, stamina +2
      saddle: makeGear('saddle', 'legendary', 5, 3),         // control +5, initiative +3
      stirrups: makeGear('stirrups', 'legendary', 4, 3),     // initiative +4, stamina +3
      reins: makeGear('reins', 'legendary', 5, 2),           // control +5, momentum +2
      horseshoes: makeGear('horseshoes', 'legendary', 4, 3), // momentum +4, initiative +3
    };
    const result = applyGiglingLoadout(charger, loadout);

    // charger: MOM=75, CTL=55, GRD=50, INIT=60, STA=60
    expect(result.momentum).toBe(75 + 7 + 3 + 2 + 4);         // 91
    expect(result.control).toBe(55 + 7 + 5 + 5);               // 72
    expect(result.guard).toBe(50 + 7 + 5 + 4);                 // 66
    expect(result.initiative).toBe(60 + 7 + 3 + 4 + 3);        // 77
    expect(result.stamina).toBe(60 + 7 + 2 + 3);               // 72
  });

  it('preserves archetype identity fields (id, name, identity)', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'giga',
      chamfron: makeGear('chamfron', 'giga', 9, 6),
    };
    const result = applyGiglingLoadout(charger, loadout);
    expect(result.id).toBe(charger.id);
    expect(result.name).toBe(charger.name);
    expect(result.identity).toBe(charger.identity);
  });

  it('does not mutate the original archetype', () => {
    const originalMom = charger.momentum;
    const loadout: GiglingLoadout = {
      giglingRarity: 'giga',
      chamfron: makeGear('chamfron', 'giga', 9, 6),
    };
    applyGiglingLoadout(charger, loadout);
    expect(charger.momentum).toBe(originalMom);
  });

  it('partial loadout with only saddle', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'rare', // +3
      saddle: makeGear('saddle', 'rare', 3, 2),
    };
    const result = applyGiglingLoadout(technician, loadout);
    expect(result.momentum).toBe(technician.momentum + 3);        // rarity only
    expect(result.control).toBe(technician.control + 3 + 3);      // rarity + saddle primary
    expect(result.guard).toBe(technician.guard + 3);               // rarity only
    expect(result.initiative).toBe(technician.initiative + 3 + 2); // rarity + saddle secondary
    expect(result.stamina).toBe(technician.stamina + 3);           // rarity only
  });
});

// ============================================================
// 4. Soft Cap Interaction
// ============================================================
describe('Gear + Soft Cap interaction', () => {
  it('Giga loadout on Charger MOM can exceed softCap knee', () => {
    // Max chamfron secondary (momentum) + max horseshoes primary (momentum) + max reins secondary (momentum)
    const loadout: GiglingLoadout = {
      giglingRarity: 'giga', // +13
      chamfron: makeGear('chamfron', 'giga', 5, 6),     // momentum +6 (secondary)
      horseshoes: makeGear('horseshoes', 'giga', 9, 4), // momentum +9 (primary)
      reins: makeGear('reins', 'giga', 5, 6),           // momentum +6 (secondary)
    };
    const result = applyGiglingLoadout(charger, loadout);
    // 75 + 13 + 6 + 9 + 6 = 109 — well over softCap knee
    expect(result.momentum).toBe(109);
    // softCap(109) = 100 + 9*50/59 ≈ 107.63
    expect(softCap(result.momentum)).toBeCloseTo(107.63, 1);
  });

  it('Bulwark guard at Giga with chamfron + barding', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'giga', // +13
      chamfron: makeGear('chamfron', 'giga', 9, 4), // guard +9
      barding: makeGear('barding', 'giga', 9, 4),   // guard +9
    };
    const result = applyGiglingLoadout(bulwark, loadout);
    // bulwark guard 65 + 13 + 9 + 9 = 96 — under knee
    expect(result.guard).toBe(96);
    expect(softCap(result.guard)).toBe(96);
  });

  it('realistic Epic loadout stays well under softCap knee', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'epic', // +5
      chamfron: makeGear('chamfron', 'epic', 3, 2),
      horseshoes: makeGear('horseshoes', 'epic', 4, 2),
    };
    const result = applyGiglingLoadout(charger, loadout);
    // 75 + 5 + 2(chamfron sec) + 4(horseshoes pri) = 86 — well under 100
    expect(result.momentum).toBe(86);
    expect(softCap(result.momentum)).toBe(86);
  });
});

// ============================================================
// 5. createStatGear Factory
// ============================================================
describe('createStatGear', () => {
  const rngMin = () => 0;
  const rngMax = () => 0.999;
  const rngMid = () => 0.5;

  it('creates chamfron with correct slot and stats', () => {
    const gear = createStatGear('chamfron', 'epic', rngMid);
    expect(gear.slot).toBe('chamfron');
    expect(gear.rarity).toBe('epic');
    expect(gear.primaryStat?.stat).toBe('guard');
    expect(gear.secondaryStat?.stat).toBe('momentum');
  });

  it('creates barding with correct slot and stats', () => {
    const gear = createStatGear('barding', 'rare', rngMid);
    expect(gear.slot).toBe('barding');
    expect(gear.primaryStat?.stat).toBe('guard');
    expect(gear.secondaryStat?.stat).toBe('stamina');
  });

  it('creates saddle with correct slot and stats', () => {
    const gear = createStatGear('saddle', 'legendary', rngMid);
    expect(gear.slot).toBe('saddle');
    expect(gear.primaryStat?.stat).toBe('control');
    expect(gear.secondaryStat?.stat).toBe('initiative');
  });

  it('creates stirrups with correct slot and stats', () => {
    const gear = createStatGear('stirrups', 'epic', rngMid);
    expect(gear.slot).toBe('stirrups');
    expect(gear.primaryStat?.stat).toBe('initiative');
    expect(gear.secondaryStat?.stat).toBe('stamina');
  });

  it('creates reins with correct slot and stats', () => {
    const gear = createStatGear('reins', 'giga', rngMid);
    expect(gear.slot).toBe('reins');
    expect(gear.primaryStat?.stat).toBe('control');
    expect(gear.secondaryStat?.stat).toBe('momentum');
  });

  it('creates horseshoes with correct slot and stats', () => {
    const gear = createStatGear('horseshoes', 'relic', rngMid);
    expect(gear.slot).toBe('horseshoes');
    expect(gear.primaryStat?.stat).toBe('momentum');
    expect(gear.secondaryStat?.stat).toBe('initiative');
  });

  it('min rng produces minimum stat values', () => {
    const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;
    for (const rarity of rarities) {
      const gear = createStatGear('barding', rarity, rngMin);
      const range = BALANCE.gearStatRanges[rarity];
      expect(gear.primaryStat?.value).toBe(range.primary[0]);
      expect(gear.secondaryStat?.value).toBe(range.secondary[0]);
    }
  });

  it('max rng produces maximum stat values', () => {
    const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;
    for (const rarity of rarities) {
      const gear = createStatGear('horseshoes', rarity, rngMax);
      const range = BALANCE.gearStatRanges[rarity];
      expect(gear.primaryStat?.value).toBe(range.primary[1]);
      expect(gear.secondaryStat?.value).toBe(range.secondary[1]);
    }
  });

  it('random values stay within range (100 rolls)', () => {
    const slots = ['chamfron', 'barding', 'saddle', 'stirrups', 'reins', 'horseshoes'] as const;
    for (let i = 0; i < 100; i++) {
      const slot = slots[i % slots.length];
      const gear = createStatGear(slot, 'epic');
      const range = BALANCE.gearStatRanges.epic;
      expect(gear.primaryStat!.value).toBeGreaterThanOrEqual(range.primary[0]);
      expect(gear.primaryStat!.value).toBeLessThanOrEqual(range.primary[1]);
      expect(gear.secondaryStat!.value).toBeGreaterThanOrEqual(range.secondary[0]);
      expect(gear.secondaryStat!.value).toBeLessThanOrEqual(range.secondary[1]);
    }
  });
});

// ============================================================
// 6. createFullLoadout Factory
// ============================================================
describe('createFullLoadout', () => {
  it('creates a complete loadout with all 6 slots filled', () => {
    const loadout = createFullLoadout('epic', 'rare', () => 0.5);
    expect(loadout.giglingRarity).toBe('epic');
    expect(loadout.chamfron).toBeDefined();
    expect(loadout.barding).toBeDefined();
    expect(loadout.saddle).toBeDefined();
    expect(loadout.stirrups).toBeDefined();
    expect(loadout.reins).toBeDefined();
    expect(loadout.horseshoes).toBeDefined();
  });

  it('gear uses the specified gear rarity', () => {
    const loadout = createFullLoadout('giga', 'legendary', () => 0.5);
    expect(loadout.chamfron?.rarity).toBe('legendary');
    expect(loadout.barding?.rarity).toBe('legendary');
    expect(loadout.saddle?.rarity).toBe('legendary');
    expect(loadout.stirrups?.rarity).toBe('legendary');
    expect(loadout.reins?.rarity).toBe('legendary');
    expect(loadout.horseshoes?.rarity).toBe('legendary');
  });

  it('each slot has correct stat mapping', () => {
    const loadout = createFullLoadout('rare', 'rare', () => 0.5);
    expect(loadout.chamfron?.primaryStat?.stat).toBe('guard');
    expect(loadout.chamfron?.secondaryStat?.stat).toBe('momentum');
    expect(loadout.barding?.primaryStat?.stat).toBe('guard');
    expect(loadout.barding?.secondaryStat?.stat).toBe('stamina');
    expect(loadout.saddle?.primaryStat?.stat).toBe('control');
    expect(loadout.saddle?.secondaryStat?.stat).toBe('initiative');
    expect(loadout.stirrups?.primaryStat?.stat).toBe('initiative');
    expect(loadout.stirrups?.secondaryStat?.stat).toBe('stamina');
    expect(loadout.reins?.primaryStat?.stat).toBe('control');
    expect(loadout.reins?.secondaryStat?.stat).toBe('momentum');
    expect(loadout.horseshoes?.primaryStat?.stat).toBe('momentum');
    expect(loadout.horseshoes?.secondaryStat?.stat).toBe('initiative');
  });

  it('integrates with applyGiglingLoadout', () => {
    const loadout = createFullLoadout('epic', 'epic', () => 0.5);
    const boosted = applyGiglingLoadout(duelist, loadout);
    // Duelist all 60, epic rarity +5, plus all gear pieces
    expect(boosted.momentum).toBeGreaterThan(duelist.momentum);
    expect(boosted.control).toBeGreaterThan(duelist.control);
    expect(boosted.guard).toBeGreaterThan(duelist.guard);
    expect(boosted.initiative).toBeGreaterThan(duelist.initiative);
    expect(boosted.stamina).toBeGreaterThan(duelist.stamina);
  });
});

// ============================================================
// 7. Match Integration
// ============================================================
describe('createMatch with GiglingLoadout', () => {
  it('creates a match without loadouts (backwards compatible)', () => {
    const match = createMatch(charger, technician);
    expect(match.player1.archetype.momentum).toBe(charger.momentum);
    expect(match.player2.archetype.control).toBe(technician.control);
    expect(match.player1.currentStamina).toBe(charger.stamina);
  });

  it('applies loadout to player 1 only', () => {
    const loadout1: GiglingLoadout = {
      giglingRarity: 'legendary', // +7
      chamfron: makeGear('chamfron', 'legendary', 5, 3), // guard +5, momentum +3
    };
    const match = createMatch(charger, technician, loadout1);

    // P1 boosted: momentum = 75 + 7 + 3 (chamfron sec), guard = 50 + 7 + 5 (chamfron pri)
    expect(match.player1.archetype.momentum).toBe(75 + 7 + 3);
    expect(match.player1.archetype.guard).toBe(50 + 7 + 5);
    expect(match.player1.currentStamina).toBe(60 + 7); // rarity only
    // P2 unchanged
    expect(match.player2.archetype.momentum).toBe(technician.momentum);
    expect(match.player2.currentStamina).toBe(technician.stamina);
  });

  it('applies loadouts to both players', () => {
    const loadout1: GiglingLoadout = {
      giglingRarity: 'rare', // +3
      barding: makeGear('barding', 'rare', 3, 2), // guard +3, stamina +2
    };
    const loadout2: GiglingLoadout = {
      giglingRarity: 'epic', // +5
      saddle: makeGear('saddle', 'epic', 4, 3), // control +4, initiative +3
    };
    const match = createMatch(duelist, duelist, loadout1, loadout2);

    // P1: duelist guard 60 + 3 + 3 = 66, stamina 60 + 3 + 2 = 65
    expect(match.player1.archetype.guard).toBe(66);
    expect(match.player1.currentStamina).toBe(65);

    // P2: duelist control 60 + 5 + 4 = 69, initiative 60 + 5 + 3 = 68
    expect(match.player2.archetype.control).toBe(69);
    expect(match.player2.archetype.initiative).toBe(68);
    expect(match.player2.currentStamina).toBe(65); // 60 + 5
  });

  it('geared player has higher impact than ungeared in mirror matchup', () => {
    const loadout1: GiglingLoadout = {
      giglingRarity: 'legendary', // +7
      horseshoes: makeGear('horseshoes', 'legendary', 5, 3), // momentum +5
      reins: makeGear('reins', 'legendary', 5, 3),           // control +5, momentum +3
      saddle: makeGear('saddle', 'legendary', 5, 3),         // control +5
    };
    let match = createMatch(duelist, duelist, loadout1, undefined);

    match = submitJoustPass(match,
      { speed: SpeedType.Standard, attack: CdL },
      { speed: SpeedType.Standard, attack: CdL },
    );

    const pass = match.passResults[0];
    expect(pass.player1.impactScore).toBeGreaterThan(pass.player2.impactScore);
  });
});

// ============================================================
// 8. Edge Cases
// ============================================================
describe('Edge cases', () => {
  it('rarity bonus values match balance-config', () => {
    const cfg = BALANCE.giglingRarityBonus;
    expect(cfg.uncommon).toBe(2);
    expect(cfg.rare).toBe(3);
    expect(cfg.epic).toBe(5);
    expect(cfg.legendary).toBe(7);
    expect(cfg.relic).toBe(10);
    expect(cfg.giga).toBe(13);
  });

  it('no caparison exports exist in gigling-gear module', async () => {
    // Verify the old caparison functions are no longer exported
    const mod = await import('./gigling-gear') as Record<string, unknown>;
    expect(mod['CAPARISON_EFFECTS']).toBeUndefined();
    expect(mod['createCaparison']).toBeUndefined();
    expect(mod['getCaparisonEffect']).toBeUndefined();
  });
});

// ============================================================
// 9. describeSteedSlot
// ============================================================
describe('describeSteedSlot', () => {
  it('returns description for each slot', () => {
    const slots = ['chamfron', 'barding', 'saddle', 'stirrups', 'reins', 'horseshoes'] as const;
    for (const slot of slots) {
      const desc = describeSteedSlot(slot);
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it('chamfron description mentions protection', () => {
    expect(describeSteedSlot('chamfron')).toContain('armor');
  });
});

// ============================================================
// 10. validateSteedGear
// ============================================================
describe('validateSteedGear', () => {
  it('accepts gear within range', () => {
    const gear = createStatGear('barding', 'epic', () => 0.5);
    expect(validateSteedGear(gear)).toBe(true);
  });

  it('rejects gear with primary stat above max', () => {
    const gear = makeGear('barding', 'uncommon', 99, 0);
    expect(validateSteedGear(gear)).toBe(false);
  });

  it('rejects gear with secondary stat above max', () => {
    const gear = makeGear('barding', 'uncommon', 1, 99);
    expect(validateSteedGear(gear)).toBe(false);
  });

  it('rejects gear with primary stat below min', () => {
    const gear = makeGear('barding', 'epic', 0, 1);
    expect(validateSteedGear(gear)).toBe(false);
  });

  it('accepts all factory-created gear', () => {
    const loadout = createFullLoadout('giga', 'giga', () => 0.5);
    const slots = ['chamfron', 'barding', 'saddle', 'stirrups', 'reins', 'horseshoes'] as const;
    for (const slot of slots) {
      expect(validateSteedGear(loadout[slot]!)).toBe(true);
    }
  });
});
