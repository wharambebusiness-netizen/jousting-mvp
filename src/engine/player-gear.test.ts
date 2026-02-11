// ============================================================
// Player Gear System — Unit & Integration Tests (6-Slot)
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { BALANCE } from './balance-config';
import { softCap } from './calculator';
import { type PlayerGear, type PlayerLoadout } from './types';
import {
  sumPlayerGearStats,
  applyPlayerLoadout,
  createPlayerGear,
  createFullPlayerLoadout,
  PLAYER_GEAR_SLOT_STATS,
  describePlayerSlot,
  validatePlayerGear,
  getGearSummary,
} from './player-gear';
import { applyGiglingLoadout, createFullLoadout } from './gigling-gear';
import { createMatch } from './match';

const charger = ARCHETYPES.charger;
const bulwark = ARCHETYPES.bulwark;
const duelist = ARCHETYPES.duelist;
const technician = ARCHETYPES.technician;

// --- Test Helpers ---

function makePlayerGear(
  slot: PlayerGear['slot'],
  rarity: PlayerGear['rarity'],
  primary: number,
  secondary: number,
): PlayerGear {
  const stats = PLAYER_GEAR_SLOT_STATS[slot];
  return {
    slot,
    rarity,
    primaryStat: { stat: stats.primary, value: primary },
    secondaryStat: { stat: stats.secondary, value: secondary },
  };
}

// ============================================================
// 1. PLAYER_GEAR_SLOT_STATS Mapping — All 6 Slots
// ============================================================
describe('Player Gear Slot → Stat Mapping', () => {
  it('helm maps to guard (primary) and initiative (secondary)', () => {
    expect(PLAYER_GEAR_SLOT_STATS.helm.primary).toBe('guard');
    expect(PLAYER_GEAR_SLOT_STATS.helm.secondary).toBe('initiative');
  });

  it('shield maps to guard (primary) and stamina (secondary)', () => {
    expect(PLAYER_GEAR_SLOT_STATS.shield.primary).toBe('guard');
    expect(PLAYER_GEAR_SLOT_STATS.shield.secondary).toBe('stamina');
  });

  it('lance maps to momentum (primary) and control (secondary)', () => {
    expect(PLAYER_GEAR_SLOT_STATS.lance.primary).toBe('momentum');
    expect(PLAYER_GEAR_SLOT_STATS.lance.secondary).toBe('control');
  });

  it('armor maps to stamina (primary) and guard (secondary)', () => {
    expect(PLAYER_GEAR_SLOT_STATS.armor.primary).toBe('stamina');
    expect(PLAYER_GEAR_SLOT_STATS.armor.secondary).toBe('guard');
  });

  it('gauntlets maps to control (primary) and initiative (secondary)', () => {
    expect(PLAYER_GEAR_SLOT_STATS.gauntlets.primary).toBe('control');
    expect(PLAYER_GEAR_SLOT_STATS.gauntlets.secondary).toBe('initiative');
  });

  it('melee_weapon maps to momentum (primary) and stamina (secondary)', () => {
    expect(PLAYER_GEAR_SLOT_STATS.melee_weapon.primary).toBe('momentum');
    expect(PLAYER_GEAR_SLOT_STATS.melee_weapon.secondary).toBe('stamina');
  });

  it('has exactly 6 slots', () => {
    expect(Object.keys(PLAYER_GEAR_SLOT_STATS).length).toBe(6);
  });
});

// ============================================================
// 2. sumPlayerGearStats
// ============================================================
describe('sumPlayerGearStats', () => {
  it('returns zeroes for empty loadout (no gear pieces)', () => {
    const loadout: PlayerLoadout = {};
    const bonuses = sumPlayerGearStats(loadout);
    expect(bonuses).toEqual({ momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 });
  });

  it('sums a single gear piece correctly (lance)', () => {
    const loadout: PlayerLoadout = {
      lance: makePlayerGear('lance', 'rare', 3, 2),
    };
    const bonuses = sumPlayerGearStats(loadout);
    expect(bonuses.momentum).toBe(3);  // lance primary
    expect(bonuses.control).toBe(2);   // lance secondary
    expect(bonuses.guard).toBe(0);
    expect(bonuses.initiative).toBe(0);
    expect(bonuses.stamina).toBe(0);
  });

  it('sums multiple gear pieces', () => {
    const loadout: PlayerLoadout = {
      helm: makePlayerGear('helm', 'epic', 4, 2),           // guard +4, initiative +2
      lance: makePlayerGear('lance', 'epic', 3, 2),         // momentum +3, control +2
      gauntlets: makePlayerGear('gauntlets', 'epic', 4, 3), // control +4, initiative +3
    };
    const bonuses = sumPlayerGearStats(loadout);
    expect(bonuses.guard).toBe(4);       // helm primary
    expect(bonuses.momentum).toBe(3);    // lance primary
    expect(bonuses.control).toBe(2 + 4); // lance sec + gauntlets pri
    expect(bonuses.initiative).toBe(2 + 3); // helm sec + gauntlets sec
    expect(bonuses.stamina).toBe(0);
  });

  it('sums all 6 gear pieces', () => {
    const loadout: PlayerLoadout = {
      helm: makePlayerGear('helm', 'legendary', 5, 3),              // guard +5, initiative +3
      shield: makePlayerGear('shield', 'legendary', 4, 2),          // guard +4, stamina +2
      lance: makePlayerGear('lance', 'legendary', 5, 3),            // momentum +5, control +3
      armor: makePlayerGear('armor', 'legendary', 4, 2),            // stamina +4, guard +2
      gauntlets: makePlayerGear('gauntlets', 'legendary', 5, 3),    // control +5, initiative +3
      melee_weapon: makePlayerGear('melee_weapon', 'legendary', 4, 2), // momentum +4, stamina +2
    };
    const bonuses = sumPlayerGearStats(loadout);
    expect(bonuses.guard).toBe(5 + 4 + 2);      // helm + shield + armor sec
    expect(bonuses.momentum).toBe(5 + 4);        // lance + melee_weapon
    expect(bonuses.control).toBe(3 + 5);          // lance sec + gauntlets
    expect(bonuses.initiative).toBe(3 + 3);       // helm sec + gauntlets sec
    expect(bonuses.stamina).toBe(2 + 4 + 2);     // shield sec + armor + melee_weapon sec
  });

  it('handles gear with only primaryStat (no secondary)', () => {
    const loadout: PlayerLoadout = {
      helm: {
        slot: 'helm',
        rarity: 'uncommon',
        primaryStat: { stat: 'guard', value: 2 },
      },
    };
    const bonuses = sumPlayerGearStats(loadout);
    expect(bonuses.guard).toBe(2);
    expect(bonuses.initiative).toBe(0);
  });
});

// ============================================================
// 3. applyPlayerLoadout
// ============================================================
describe('applyPlayerLoadout', () => {
  it('returns archetype unchanged when loadout is undefined', () => {
    const result = applyPlayerLoadout(duelist, undefined);
    expect(result).toBe(duelist); // same reference
  });

  it('returns archetype unchanged for empty loadout', () => {
    const loadout: PlayerLoadout = {};
    const result = applyPlayerLoadout(duelist, loadout);
    expect(result.momentum).toBe(duelist.momentum);
    expect(result.control).toBe(duelist.control);
    expect(result.guard).toBe(duelist.guard);
    expect(result.initiative).toBe(duelist.initiative);
    expect(result.stamina).toBe(duelist.stamina);
  });

  it('applies gear bonuses (no rarity bonus — player gear only)', () => {
    const loadout: PlayerLoadout = {
      lance: makePlayerGear('lance', 'legendary', 5, 3), // momentum +5, control +3
    };
    const result = applyPlayerLoadout(charger, loadout);
    // Player gear does NOT add rarity bonus (mount-only feature)
    expect(result.momentum).toBe(charger.momentum + 5);
    expect(result.control).toBe(charger.control + 3);
    expect(result.guard).toBe(charger.guard);
    expect(result.initiative).toBe(charger.initiative);
    expect(result.stamina).toBe(charger.stamina);
  });

  it('applies all 6 slots together', () => {
    const loadout: PlayerLoadout = {
      helm: makePlayerGear('helm', 'epic', 3, 2),              // guard +3, initiative +2
      shield: makePlayerGear('shield', 'epic', 4, 2),          // guard +4, stamina +2
      lance: makePlayerGear('lance', 'epic', 4, 3),            // momentum +4, control +3
      armor: makePlayerGear('armor', 'epic', 3, 2),            // stamina +3, guard +2
      gauntlets: makePlayerGear('gauntlets', 'epic', 3, 2),    // control +3, initiative +2
      melee_weapon: makePlayerGear('melee_weapon', 'epic', 3, 2), // momentum +3, stamina +2
    };
    const result = applyPlayerLoadout(duelist, loadout);

    // duelist: all 60
    expect(result.momentum).toBe(60 + 4 + 3);     // 67
    expect(result.control).toBe(60 + 3 + 3);       // 66
    expect(result.guard).toBe(60 + 3 + 4 + 2);     // 69
    expect(result.initiative).toBe(60 + 2 + 2);     // 64
    expect(result.stamina).toBe(60 + 2 + 3 + 2);    // 67
  });

  it('preserves archetype identity fields', () => {
    const loadout: PlayerLoadout = {
      lance: makePlayerGear('lance', 'giga', 9, 6),
    };
    const result = applyPlayerLoadout(charger, loadout);
    expect(result.id).toBe(charger.id);
    expect(result.name).toBe(charger.name);
    expect(result.identity).toBe(charger.identity);
  });

  it('does not mutate the original archetype', () => {
    const originalMom = charger.momentum;
    const loadout: PlayerLoadout = {
      lance: makePlayerGear('lance', 'giga', 9, 6),
    };
    applyPlayerLoadout(charger, loadout);
    expect(charger.momentum).toBe(originalMom);
  });
});

// ============================================================
// 4. Combined Steed + Player Gear Stacking
// ============================================================
describe('Steed + Player gear stacking', () => {
  it('both gear systems stack on archetype', () => {
    const steedLoadout = createFullLoadout('epic', 'epic', () => 0.5);
    const playerLoadout = createFullPlayerLoadout('epic', () => 0.5);

    let boosted = applyGiglingLoadout(duelist, steedLoadout);
    boosted = applyPlayerLoadout(boosted, playerLoadout);

    // Should be higher than either system alone
    const steedOnly = applyGiglingLoadout(duelist, steedLoadout);
    const playerOnly = applyPlayerLoadout(duelist, playerLoadout);

    expect(boosted.momentum).toBeGreaterThan(steedOnly.momentum);
    expect(boosted.momentum).toBeGreaterThan(playerOnly.momentum);
  });

  it('match.ts applies both gear systems via createMatch', () => {
    const steedLoadout = createFullLoadout('epic', 'epic', () => 0.5);
    const playerLoadout = createFullPlayerLoadout('epic', () => 0.5);

    const match = createMatch(duelist, duelist, steedLoadout, undefined, playerLoadout, undefined);

    // P1 should have higher stats than P2 (P2 has no gear)
    expect(match.player1.archetype.momentum).toBeGreaterThan(match.player2.archetype.momentum);
    expect(match.player1.archetype.control).toBeGreaterThan(match.player2.archetype.control);
    expect(match.player1.archetype.guard).toBeGreaterThan(match.player2.archetype.guard);
    expect(match.player1.currentStamina).toBeGreaterThan(match.player2.currentStamina);
  });
});

// ============================================================
// 5. SoftCap with Combined Gear
// ============================================================
describe('SoftCap with combined steed + player gear', () => {
  it('max steed + max player gear triggers softCap on best stat', () => {
    // Charger MOM = 75, Giga rarity = +13
    // Steed gear momentum sources: chamfron sec, reins sec, horseshoes pri
    // Player gear momentum sources: lance pri, melee_weapon pri
    const steedLoadout = {
      giglingRarity: 'giga' as const,
      chamfron: { slot: 'chamfron' as const, rarity: 'giga' as const, primaryStat: { stat: 'guard' as const, value: 5 }, secondaryStat: { stat: 'momentum' as const, value: 6 } },
      horseshoes: { slot: 'horseshoes' as const, rarity: 'giga' as const, primaryStat: { stat: 'momentum' as const, value: 9 }, secondaryStat: { stat: 'initiative' as const, value: 4 } },
      reins: { slot: 'reins' as const, rarity: 'giga' as const, primaryStat: { stat: 'control' as const, value: 5 }, secondaryStat: { stat: 'momentum' as const, value: 6 } },
    };
    const playerLoadout: PlayerLoadout = {
      lance: makePlayerGear('lance', 'giga', 9, 6),         // momentum +9
      melee_weapon: makePlayerGear('melee_weapon', 'giga', 9, 6), // momentum +9
    };

    let boosted = applyGiglingLoadout(charger, steedLoadout);
    boosted = applyPlayerLoadout(boosted, playerLoadout);

    // 75 + 13 + 6 + 9 + 6 + 9 + 9 = 127
    expect(boosted.momentum).toBe(127);
    // softCap(127) = 100 + 27*55/82 ≈ 118.11
    expect(softCap(boosted.momentum)).toBeCloseTo(118.11, 1);
  });

  it('moderate gear stays under softCap knee', () => {
    const playerLoadout: PlayerLoadout = {
      lance: makePlayerGear('lance', 'rare', 2, 1),
      gauntlets: makePlayerGear('gauntlets', 'rare', 2, 1),
    };
    const result = applyPlayerLoadout(technician, playerLoadout);
    // technician CTL 70, + lance sec 1 + gauntlets pri 2 = 73, under 100
    expect(result.control).toBe(73);
    expect(softCap(result.control)).toBe(73);
  });
});

// ============================================================
// 6. createPlayerGear Factory
// ============================================================
describe('createPlayerGear', () => {
  const rngMin = () => 0;
  const rngMax = () => 0.999;
  const rngMid = () => 0.5;

  it('creates helm with correct slot and stats', () => {
    const gear = createPlayerGear('helm', 'epic', rngMid);
    expect(gear.slot).toBe('helm');
    expect(gear.rarity).toBe('epic');
    expect(gear.primaryStat?.stat).toBe('guard');
    expect(gear.secondaryStat?.stat).toBe('initiative');
  });

  it('creates shield with correct slot and stats', () => {
    const gear = createPlayerGear('shield', 'rare', rngMid);
    expect(gear.slot).toBe('shield');
    expect(gear.primaryStat?.stat).toBe('guard');
    expect(gear.secondaryStat?.stat).toBe('stamina');
  });

  it('creates lance with correct slot and stats', () => {
    const gear = createPlayerGear('lance', 'legendary', rngMid);
    expect(gear.slot).toBe('lance');
    expect(gear.primaryStat?.stat).toBe('momentum');
    expect(gear.secondaryStat?.stat).toBe('control');
  });

  it('creates armor with correct slot and stats', () => {
    const gear = createPlayerGear('armor', 'epic', rngMid);
    expect(gear.slot).toBe('armor');
    expect(gear.primaryStat?.stat).toBe('stamina');
    expect(gear.secondaryStat?.stat).toBe('guard');
  });

  it('creates gauntlets with correct slot and stats', () => {
    const gear = createPlayerGear('gauntlets', 'giga', rngMid);
    expect(gear.slot).toBe('gauntlets');
    expect(gear.primaryStat?.stat).toBe('control');
    expect(gear.secondaryStat?.stat).toBe('initiative');
  });

  it('creates melee_weapon with correct slot and stats', () => {
    const gear = createPlayerGear('melee_weapon', 'relic', rngMid);
    expect(gear.slot).toBe('melee_weapon');
    expect(gear.primaryStat?.stat).toBe('momentum');
    expect(gear.secondaryStat?.stat).toBe('stamina');
  });

  it('min rng produces minimum stat values', () => {
    const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;
    for (const rarity of rarities) {
      const gear = createPlayerGear('helm', rarity, rngMin);
      const range = BALANCE.playerGearStatRanges[rarity];
      expect(gear.primaryStat?.value).toBe(range.primary[0]);
      expect(gear.secondaryStat?.value).toBe(range.secondary[0]);
    }
  });

  it('max rng produces maximum stat values', () => {
    const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;
    for (const rarity of rarities) {
      const gear = createPlayerGear('lance', rarity, rngMax);
      const range = BALANCE.playerGearStatRanges[rarity];
      expect(gear.primaryStat?.value).toBe(range.primary[1]);
      expect(gear.secondaryStat?.value).toBe(range.secondary[1]);
    }
  });

  it('random values stay within range (100 rolls)', () => {
    const slots = ['helm', 'shield', 'lance', 'armor', 'gauntlets', 'melee_weapon'] as const;
    for (let i = 0; i < 100; i++) {
      const slot = slots[i % slots.length];
      const gear = createPlayerGear(slot, 'epic');
      const range = BALANCE.playerGearStatRanges.epic;
      expect(gear.primaryStat!.value).toBeGreaterThanOrEqual(range.primary[0]);
      expect(gear.primaryStat!.value).toBeLessThanOrEqual(range.primary[1]);
      expect(gear.secondaryStat!.value).toBeGreaterThanOrEqual(range.secondary[0]);
      expect(gear.secondaryStat!.value).toBeLessThanOrEqual(range.secondary[1]);
    }
  });
});

// ============================================================
// 7. createFullPlayerLoadout Factory
// ============================================================
describe('createFullPlayerLoadout', () => {
  it('creates a complete loadout with all 6 slots filled', () => {
    const loadout = createFullPlayerLoadout('rare', () => 0.5);
    expect(loadout.helm).toBeDefined();
    expect(loadout.shield).toBeDefined();
    expect(loadout.lance).toBeDefined();
    expect(loadout.armor).toBeDefined();
    expect(loadout.gauntlets).toBeDefined();
    expect(loadout.melee_weapon).toBeDefined();
  });

  it('gear uses the specified rarity', () => {
    const loadout = createFullPlayerLoadout('legendary', () => 0.5);
    expect(loadout.helm?.rarity).toBe('legendary');
    expect(loadout.shield?.rarity).toBe('legendary');
    expect(loadout.lance?.rarity).toBe('legendary');
    expect(loadout.armor?.rarity).toBe('legendary');
    expect(loadout.gauntlets?.rarity).toBe('legendary');
    expect(loadout.melee_weapon?.rarity).toBe('legendary');
  });

  it('each slot has correct stat mapping', () => {
    const loadout = createFullPlayerLoadout('rare', () => 0.5);
    expect(loadout.helm?.primaryStat?.stat).toBe('guard');
    expect(loadout.helm?.secondaryStat?.stat).toBe('initiative');
    expect(loadout.shield?.primaryStat?.stat).toBe('guard');
    expect(loadout.shield?.secondaryStat?.stat).toBe('stamina');
    expect(loadout.lance?.primaryStat?.stat).toBe('momentum');
    expect(loadout.lance?.secondaryStat?.stat).toBe('control');
    expect(loadout.armor?.primaryStat?.stat).toBe('stamina');
    expect(loadout.armor?.secondaryStat?.stat).toBe('guard');
    expect(loadout.gauntlets?.primaryStat?.stat).toBe('control');
    expect(loadout.gauntlets?.secondaryStat?.stat).toBe('initiative');
    expect(loadout.melee_weapon?.primaryStat?.stat).toBe('momentum');
    expect(loadout.melee_weapon?.secondaryStat?.stat).toBe('stamina');
  });

  it('integrates with applyPlayerLoadout', () => {
    const loadout = createFullPlayerLoadout('epic', () => 0.5);
    const boosted = applyPlayerLoadout(duelist, loadout);
    // Duelist all 60, all gear pieces add stats
    expect(boosted.momentum).toBeGreaterThan(duelist.momentum);
    expect(boosted.control).toBeGreaterThan(duelist.control);
    expect(boosted.guard).toBeGreaterThan(duelist.guard);
    expect(boosted.initiative).toBeGreaterThan(duelist.initiative);
    expect(boosted.stamina).toBeGreaterThan(duelist.stamina);
  });
});

// ============================================================
// 8. describePlayerSlot
// ============================================================
describe('describePlayerSlot', () => {
  it('returns description for each slot', () => {
    const slots = ['helm', 'shield', 'lance', 'armor', 'gauntlets', 'melee_weapon'] as const;
    for (const slot of slots) {
      const desc = describePlayerSlot(slot);
      expect(desc.length).toBeGreaterThan(0);
    }
  });

  it('lance description mentions weapon', () => {
    expect(describePlayerSlot('lance')).toContain('Weapon');
  });
});

// ============================================================
// 9. validatePlayerGear
// ============================================================
describe('validatePlayerGear', () => {
  it('accepts gear within range', () => {
    const gear = createPlayerGear('helm', 'epic', () => 0.5);
    expect(validatePlayerGear(gear)).toBe(true);
  });

  it('rejects gear with primary stat above max', () => {
    const gear = makePlayerGear('helm', 'uncommon', 99, 0);
    expect(validatePlayerGear(gear)).toBe(false);
  });

  it('rejects gear with secondary stat above max', () => {
    const gear = makePlayerGear('helm', 'uncommon', 1, 99);
    expect(validatePlayerGear(gear)).toBe(false);
  });

  it('rejects gear with primary stat below min', () => {
    const gear = makePlayerGear('lance', 'epic', 0, 1);
    expect(validatePlayerGear(gear)).toBe(false);
  });

  it('accepts all factory-created gear', () => {
    const loadout = createFullPlayerLoadout('giga', () => 0.5);
    const slots = ['helm', 'shield', 'lance', 'armor', 'gauntlets', 'melee_weapon'] as const;
    for (const slot of slots) {
      expect(validatePlayerGear(loadout[slot]!)).toBe(true);
    }
  });
});

// ============================================================
// 10. getGearSummary
// ============================================================
describe('getGearSummary', () => {
  it('returns zeroes when both loadouts are undefined', () => {
    const summary = getGearSummary(undefined, undefined);
    expect(summary).toEqual({ momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 });
  });

  it('returns steed-only bonuses when player loadout is undefined', () => {
    const steedLoadout = createFullLoadout('epic', 'epic', () => 0.5);
    const summary = getGearSummary(steedLoadout, undefined);
    expect(summary.momentum).toBeGreaterThan(0);
    expect(summary.guard).toBeGreaterThan(0);
  });

  it('returns player-only bonuses when steed loadout is undefined', () => {
    const playerLoadout = createFullPlayerLoadout('epic', () => 0.5);
    const summary = getGearSummary(undefined, playerLoadout);
    expect(summary.momentum).toBeGreaterThan(0);
    expect(summary.guard).toBeGreaterThan(0);
  });

  it('combines both loadouts correctly', () => {
    const steedLoadout = createFullLoadout('epic', 'epic', () => 0.5);
    const playerLoadout = createFullPlayerLoadout('epic', () => 0.5);

    const steedOnly = getGearSummary(steedLoadout, undefined);
    const playerOnly = getGearSummary(undefined, playerLoadout);
    const combined = getGearSummary(steedLoadout, playerLoadout);

    expect(combined.momentum).toBe(steedOnly.momentum + playerOnly.momentum);
    expect(combined.control).toBe(steedOnly.control + playerOnly.control);
    expect(combined.guard).toBe(steedOnly.guard + playerOnly.guard);
    expect(combined.initiative).toBe(steedOnly.initiative + playerOnly.initiative);
    expect(combined.stamina).toBe(steedOnly.stamina + playerOnly.stamina);
  });
});
