// ============================================================
// Gigling Gear System — Unit & Integration Tests
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS } from './attacks';
import { BALANCE } from './balance-config';
import { softCap } from './calculator';
import { Phase, SpeedType, type GiglingGear, type GiglingLoadout } from './types';
import {
  sumGearStats,
  applyGiglingLoadout,
  getCaparisonEffect,
  createStatGear,
  createCaparison,
  createFullLoadout,
  GEAR_SLOT_STATS,
  CAPARISON_EFFECTS,
} from './gigling-gear';
import { createMatch, submitJoustPass, submitMeleeRound } from './match';

const charger = ARCHETYPES.charger;
const bulwark = ARCHETYPES.bulwark;
const duelist = ARCHETYPES.duelist;
const technician = ARCHETYPES.technician;

const CF = JOUST_ATTACKS.coupFort;
const CdL = JOUST_ATTACKS.courseDeLance;
const PdL = JOUST_ATTACKS.portDeLance;
const MC = MELEE_ATTACKS.measuredCut;
const OC = MELEE_ATTACKS.overhandCleave;

// --- Test Helpers ---

function makeBarding(rarity: GiglingLoadout['giglingRarity'], primary: number, secondary: number): GiglingGear {
  return {
    slot: 'barding',
    rarity,
    primaryStat: { stat: 'guard', value: primary },
    secondaryStat: { stat: 'stamina', value: secondary },
  };
}

function makeChanfron(rarity: GiglingLoadout['giglingRarity'], primary: number, secondary: number): GiglingGear {
  return {
    slot: 'chanfron',
    rarity,
    primaryStat: { stat: 'momentum', value: primary },
    secondaryStat: { stat: 'stamina', value: secondary },
  };
}

function makeSaddle(rarity: GiglingLoadout['giglingRarity'], primary: number, secondary: number): GiglingGear {
  return {
    slot: 'saddle',
    rarity,
    primaryStat: { stat: 'control', value: primary },
    secondaryStat: { stat: 'initiative', value: secondary },
  };
}

function makeCaparison(effect: keyof typeof CAPARISON_EFFECTS): GiglingGear {
  const eff = CAPARISON_EFFECTS[effect];
  return {
    slot: 'caparison',
    rarity: eff.rarity,
    effect: eff,
  };
}

// ============================================================
// 1. GEAR_SLOT_STATS Mapping
// ============================================================
describe('Gear Slot → Stat Mapping', () => {
  it('barding maps to guard (primary) and stamina (secondary)', () => {
    expect(GEAR_SLOT_STATS.barding.primary).toBe('guard');
    expect(GEAR_SLOT_STATS.barding.secondary).toBe('stamina');
  });

  it('chanfron maps to momentum (primary) and stamina (secondary)', () => {
    expect(GEAR_SLOT_STATS.chanfron.primary).toBe('momentum');
    expect(GEAR_SLOT_STATS.chanfron.secondary).toBe('stamina');
  });

  it('saddle maps to control (primary) and initiative (secondary)', () => {
    expect(GEAR_SLOT_STATS.saddle.primary).toBe('control');
    expect(GEAR_SLOT_STATS.saddle.secondary).toBe('initiative');
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

  it('sums a single gear piece correctly', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'rare',
      chanfron: makeChanfron('rare', 5, 2),
    };
    const bonuses = sumGearStats(loadout);
    expect(bonuses.momentum).toBe(5);
    expect(bonuses.stamina).toBe(2);
    expect(bonuses.control).toBe(0);
    expect(bonuses.guard).toBe(0);
    expect(bonuses.initiative).toBe(0);
  });

  it('sums all three stat pieces', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'epic',
      barding: makeBarding('epic', 8, 4),   // guard +8, stamina +4
      chanfron: makeChanfron('epic', 7, 3),  // momentum +7, stamina +3
      saddle: makeSaddle('epic', 9, 5),      // control +9, initiative +5
    };
    const bonuses = sumGearStats(loadout);
    expect(bonuses.guard).toBe(8);           // barding primary only
    expect(bonuses.momentum).toBe(7);
    expect(bonuses.control).toBe(9);
    expect(bonuses.initiative).toBe(5);
    expect(bonuses.stamina).toBe(4 + 3);    // barding secondary + chanfron secondary
  });

  it('ignores caparison (no raw stats)', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'legendary',
      caparison: makeCaparison('thunderweave'),
    };
    const bonuses = sumGearStats(loadout);
    expect(bonuses).toEqual({ momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 });
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

  it('applies rarity bonus only (no gear) for uncommon → +1', () => {
    const loadout: GiglingLoadout = { giglingRarity: 'uncommon' };
    const result = applyGiglingLoadout(duelist, loadout);
    expect(result.momentum).toBe(duelist.momentum + 1);
    expect(result.control).toBe(duelist.control + 1);
    expect(result.guard).toBe(duelist.guard + 1);
    expect(result.initiative).toBe(duelist.initiative + 1);
    expect(result.stamina).toBe(duelist.stamina + 1);
  });

  it('applies rarity bonus for each tier', () => {
    const rarities: Array<{ rarity: GiglingLoadout['giglingRarity']; bonus: number }> = [
      { rarity: 'uncommon', bonus: 1 },
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

  it('applies rarity bonus + gear bonuses together', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'legendary', // +7 per stat
      barding: makeBarding('legendary', 12, 6),  // guard +12, stamina +6
      chanfron: makeChanfron('legendary', 10, 5), // momentum +10, stamina +5
      saddle: makeSaddle('legendary', 11, 7),     // control +11, initiative +7
    };
    const result = applyGiglingLoadout(charger, loadout);

    expect(result.momentum).toBe(charger.momentum + 7 + 10);       // 70 + 7 + 10 = 87
    expect(result.control).toBe(charger.control + 7 + 11);         // 45 + 7 + 11 = 63
    expect(result.guard).toBe(charger.guard + 7 + 12);             // 55 + 7 + 12 = 74
    expect(result.initiative).toBe(charger.initiative + 7 + 7);    // 60 + 7 + 7 = 74
    expect(result.stamina).toBe(charger.stamina + 7 + 6 + 5);     // 50 + 7 + 6 + 5 = 68
  });

  it('preserves archetype identity fields (id, name)', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'giga',
      chanfron: makeChanfron('giga', 20, 10),
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
      chanfron: makeChanfron('giga', 20, 10),
    };
    applyGiglingLoadout(charger, loadout);
    expect(charger.momentum).toBe(originalMom);
  });
});

// ============================================================
// 4. getCaparisonEffect
// ============================================================
describe('getCaparisonEffect', () => {
  it('returns undefined for no loadout', () => {
    expect(getCaparisonEffect(undefined)).toBeUndefined();
  });

  it('returns undefined for loadout without caparison', () => {
    const loadout: GiglingLoadout = { giglingRarity: 'rare' };
    expect(getCaparisonEffect(loadout)).toBeUndefined();
  });

  it('returns the effect from an equipped caparison', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'epic',
      caparison: makeCaparison('thunderweave'),
    };
    const effect = getCaparisonEffect(loadout);
    expect(effect).toBeDefined();
    expect(effect!.id).toBe('thunderweave');
    expect(effect!.rarity).toBe('epic');
  });
});

// ============================================================
// 5. CAPARISON_EFFECTS Data Integrity
// ============================================================
describe('Caparison Effects catalog', () => {
  it('has 6 effects (one per rarity tier)', () => {
    const effects = Object.values(CAPARISON_EFFECTS);
    expect(effects.length).toBe(6);
  });

  it('covers all 6 rarity tiers', () => {
    const rarities = new Set(Object.values(CAPARISON_EFFECTS).map(e => e.rarity));
    expect(rarities).toEqual(new Set(['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga']));
  });

  it('every effect has id, name, description, rarity', () => {
    for (const [key, effect] of Object.entries(CAPARISON_EFFECTS)) {
      expect(effect.id).toBe(key);
      expect(effect.name.length).toBeGreaterThan(0);
      expect(effect.description.length).toBeGreaterThan(0);
      expect(effect.rarity).toBeDefined();
    }
  });
});

// ============================================================
// 6. Balance — Soft Cap Interaction
// ============================================================
describe('Gear + Soft Cap interaction', () => {
  it('full Giga loadout on Charger MOM can exceed softCap knee', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'giga', // +13
      chanfron: makeChanfron('giga', 15, 9), // momentum +15 (max primary)
    };
    const result = applyGiglingLoadout(charger, loadout);
    // 70 + 13 + 15 = 98 — just under softCap
    expect(result.momentum).toBe(98);
    // No compression needed at 98
    expect(softCap(result.momentum)).toBe(98);
  });

  it('Bulwark guard at Giga with max barding just crosses softCap', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'giga', // +13
      barding: makeBarding('giga', 15, 9),   // guard +15
    };
    const result = applyGiglingLoadout(bulwark, loadout);
    // bulwark guard 75 + 13 + 15 = 103
    expect(result.guard).toBe(103);
    const capped = softCap(result.guard);
    // 100 + (3*50)/(3+50) = 100 + 2.83 = 102.83
    expect(capped).toBeCloseTo(102.83, 1);
    expect(capped).toBeLessThan(result.guard);
  });

  it('realistic Epic loadout stays well under softCap knee', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'epic', // +5
      chanfron: makeChanfron('epic', 6, 3),
    };
    const result = applyGiglingLoadout(charger, loadout);
    // 70 + 5 + 6 = 81 — well under 100
    expect(result.momentum).toBe(81);
    expect(softCap(result.momentum)).toBe(81); // no compression
  });
});

// ============================================================
// 7. Match Integration — createMatch with loadouts
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
      chanfron: makeChanfron('legendary', 10, 5),
    };
    const match = createMatch(charger, technician, loadout1);

    // P1 boosted: momentum = 70 + 7 + 10, stamina = 50 + 7 + 5 (chanfron secondary)
    expect(match.player1.archetype.momentum).toBe(charger.momentum + 7 + 10);
    expect(match.player1.currentStamina).toBe(charger.stamina + 7 + 5);
    // P2 unchanged
    expect(match.player2.archetype.momentum).toBe(technician.momentum);
    expect(match.player2.currentStamina).toBe(technician.stamina);
  });

  it('applies loadouts to both players', () => {
    const loadout1: GiglingLoadout = {
      giglingRarity: 'rare', // +3
      barding: makeBarding('rare', 4, 2),
    };
    const loadout2: GiglingLoadout = {
      giglingRarity: 'epic', // +5
      saddle: makeSaddle('epic', 8, 4),
    };
    const match = createMatch(duelist, duelist, loadout1, loadout2);

    // P1: duelist guard 60 + 3 + 4 = 67, stamina 60 + 3 + 2 = 65
    expect(match.player1.archetype.guard).toBe(67);
    expect(match.player1.currentStamina).toBe(65);

    // P2: duelist control 60 + 5 + 8 = 73, initiative 60 + 5 + 4 = 69
    expect(match.player2.archetype.control).toBe(73);
    expect(match.player2.archetype.initiative).toBe(69);
    expect(match.player2.currentStamina).toBe(65); // 60 + 5
  });

  it('geared player has higher impact than ungeared in mirror matchup', () => {
    const loadout1: GiglingLoadout = {
      giglingRarity: 'legendary', // +8
      chanfron: makeChanfron('legendary', 12, 5),
      saddle: makeSaddle('legendary', 10, 6),
    };
    // P1 geared duelist vs P2 bare duelist
    let match = createMatch(duelist, duelist, loadout1, undefined);

    match = submitJoustPass(match,
      { speed: SpeedType.Standard, attack: CdL },
      { speed: SpeedType.Standard, attack: CdL },
    );

    const pass = match.passResults[0];
    // P1 should have higher impact from boosted momentum + control
    expect(pass.player1.impactScore).toBeGreaterThan(pass.player2.impactScore);
  });

  it('gear advantage carries into melee via stamina', () => {
    const loadout1: GiglingLoadout = {
      giglingRarity: 'epic', // +5
      barding: makeBarding('epic', 8, 5), // stamina +5
    };
    // P1 gets +5 (rarity) + 5 (barding secondary) = +10 stamina
    let match = createMatch(duelist, duelist, loadout1, undefined);

    // Force to melee
    match = { ...match, phase: Phase.MeleeSelect };

    // P1 has 70 stamina vs P2 has 60 — P1 fatigues later
    expect(match.player1.currentStamina).toBe(70);
    expect(match.player2.currentStamina).toBe(60);
  });
});

// ============================================================
// 8. Edge Cases
// ============================================================
describe('Edge cases', () => {
  it('loadout with only caparison still gets rarity bonus (uncommon = +1)', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'uncommon',
      caparison: makeCaparison('pennant_of_haste'),
    };
    const result = applyGiglingLoadout(duelist, loadout);
    expect(result.momentum).toBe(duelist.momentum + 1);
    expect(result.control).toBe(duelist.control + 1);
    expect(result.guard).toBe(duelist.guard + 1);
    expect(result.initiative).toBe(duelist.initiative + 1);
    expect(result.stamina).toBe(duelist.stamina + 1);
  });

  it('partial loadout with only saddle', () => {
    const loadout: GiglingLoadout = {
      giglingRarity: 'rare', // +3
      saddle: makeSaddle('rare', 5, 2),
    };
    const result = applyGiglingLoadout(technician, loadout);
    expect(result.momentum).toBe(technician.momentum + 3);        // rarity only
    expect(result.control).toBe(technician.control + 3 + 5);      // rarity + saddle primary
    expect(result.guard).toBe(technician.guard + 3);               // rarity only
    expect(result.initiative).toBe(technician.initiative + 3 + 2); // rarity + saddle secondary
    expect(result.stamina).toBe(technician.stamina + 3);           // rarity only
  });

  it('rarity bonus values match balance-config', () => {
    const cfg = BALANCE.giglingRarityBonus;
    expect(cfg.uncommon).toBe(1);
    expect(cfg.rare).toBe(3);
    expect(cfg.epic).toBe(5);
    expect(cfg.legendary).toBe(7);
    expect(cfg.relic).toBe(10);
    expect(cfg.giga).toBe(13);
  });
});

// ============================================================
// 9. Gear Factory — createStatGear
// ============================================================
describe('createStatGear', () => {
  // Deterministic rng that always returns 0 (min values)
  const rngMin = () => 0;
  // Deterministic rng that returns 0.999... (max values)
  const rngMax = () => 0.999;
  // Mid-range rng
  const rngMid = () => 0.5;

  it('creates barding with correct slot and stats', () => {
    const gear = createStatGear('barding', 'epic', rngMid);
    expect(gear.slot).toBe('barding');
    expect(gear.rarity).toBe('epic');
    expect(gear.primaryStat?.stat).toBe('guard');
    expect(gear.secondaryStat?.stat).toBe('stamina');
  });

  it('creates chanfron with correct slot and stats', () => {
    const gear = createStatGear('chanfron', 'rare', rngMid);
    expect(gear.slot).toBe('chanfron');
    expect(gear.primaryStat?.stat).toBe('momentum');
    expect(gear.secondaryStat?.stat).toBe('stamina');
  });

  it('creates saddle with correct slot and stats', () => {
    const gear = createStatGear('saddle', 'legendary', rngMid);
    expect(gear.slot).toBe('saddle');
    expect(gear.primaryStat?.stat).toBe('control');
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
      const gear = createStatGear('chanfron', rarity, rngMax);
      const range = BALANCE.gearStatRanges[rarity];
      expect(gear.primaryStat?.value).toBe(range.primary[1]);
      expect(gear.secondaryStat?.value).toBe(range.secondary[1]);
    }
  });

  it('random values stay within range (100 rolls)', () => {
    for (let i = 0; i < 100; i++) {
      const gear = createStatGear('saddle', 'epic');
      const range = BALANCE.gearStatRanges.epic;
      expect(gear.primaryStat!.value).toBeGreaterThanOrEqual(range.primary[0]);
      expect(gear.primaryStat!.value).toBeLessThanOrEqual(range.primary[1]);
      expect(gear.secondaryStat!.value).toBeGreaterThanOrEqual(range.secondary[0]);
      expect(gear.secondaryStat!.value).toBeLessThanOrEqual(range.secondary[1]);
    }
  });

  it('does not include caparison effect on stat pieces', () => {
    const gear = createStatGear('barding', 'giga', rngMid);
    expect(gear.effect).toBeUndefined();
  });
});

// ============================================================
// 10. Gear Factory — createCaparison
// ============================================================
describe('createCaparison', () => {
  it('creates a caparison with the specified effect', () => {
    const gear = createCaparison('pennant_of_haste');
    expect(gear.slot).toBe('caparison');
    expect(gear.effect?.id).toBe('pennant_of_haste');
    expect(gear.effect?.name).toBe('Pennant of Haste');
    expect(gear.rarity).toBe('uncommon'); // pennant is uncommon
  });

  it('rarity matches the effect rarity', () => {
    const ids = Object.keys(CAPARISON_EFFECTS) as Array<keyof typeof CAPARISON_EFFECTS>;
    for (const id of ids) {
      const gear = createCaparison(id);
      expect(gear.rarity).toBe(CAPARISON_EFFECTS[id].rarity);
    }
  });

  it('has no primary or secondary stat', () => {
    const gear = createCaparison('thunderweave');
    expect(gear.primaryStat).toBeUndefined();
    expect(gear.secondaryStat).toBeUndefined();
  });
});

// ============================================================
// 11. Gear Factory — createFullLoadout
// ============================================================
describe('createFullLoadout', () => {
  it('creates a complete loadout with all slots filled', () => {
    const loadout = createFullLoadout('epic', 'rare', 'thunderweave', () => 0.5);
    expect(loadout.giglingRarity).toBe('epic');
    expect(loadout.barding).toBeDefined();
    expect(loadout.chanfron).toBeDefined();
    expect(loadout.saddle).toBeDefined();
    expect(loadout.caparison).toBeDefined();
    expect(loadout.caparison?.effect?.id).toBe('thunderweave');
  });

  it('creates loadout without caparison when no effectId given', () => {
    const loadout = createFullLoadout('rare', 'uncommon');
    expect(loadout.caparison).toBeUndefined();
    expect(loadout.barding).toBeDefined();
  });

  it('gear uses the specified gear rarity', () => {
    const loadout = createFullLoadout('giga', 'legendary', undefined, () => 0.5);
    expect(loadout.barding?.rarity).toBe('legendary');
    expect(loadout.chanfron?.rarity).toBe('legendary');
    expect(loadout.saddle?.rarity).toBe('legendary');
  });

  it('integrates with applyGiglingLoadout', () => {
    const loadout = createFullLoadout('epic', 'epic', 'stormcloak', () => 0.5);
    const boosted = applyGiglingLoadout(duelist, loadout);
    // Duelist all 60, epic rarity +5, all gear pieces add stats
    expect(boosted.momentum).toBeGreaterThan(duelist.momentum);
    expect(boosted.control).toBeGreaterThan(duelist.control);
    expect(boosted.guard).toBeGreaterThan(duelist.guard);
    expect(boosted.stamina).toBeGreaterThan(duelist.stamina);
  });

  it('integrates with createMatch', () => {
    const loadout1 = createFullLoadout('legendary', 'legendary', 'banner_of_the_giga', () => 0.5);
    const match = createMatch(duelist, duelist, loadout1);
    expect(match.p1Caparison?.id).toBe('banner_of_the_giga');
    expect(match.player1.archetype.momentum).toBeGreaterThan(duelist.momentum);
  });
});
