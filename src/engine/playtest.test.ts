// ============================================================
// Playtest — Full Match Simulations (Gear Overhaul)
// ============================================================
// Simulates complete matches for all 6 archetypes with the new
// 12-slot gear system (6 steed + 6 player) to verify the combat
// system works end-to-end.
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES, ARCHETYPE_LIST } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS, JOUST_ATTACK_LIST, MELEE_ATTACK_LIST } from './attacks';
import { SpeedType, Phase, type Attack, type Archetype, type GiglingLoadout, type PlayerLoadout, type PlayerState, type PassChoice } from './types';
import { resolveJoustPass } from './phase-joust';
import { resolveMeleeRoundFn } from './phase-melee';
import { calcImpactScore } from './calculator';
import { createMatch, submitJoustPass, submitMeleeRound } from './match';
import { createFullLoadout } from './gigling-gear';
import { createFullPlayerLoadout } from './player-gear';
import { BALANCE } from './balance-config';

const CF = JOUST_ATTACKS.coupFort;
const BdG = JOUST_ATTACKS.brisDeGarde;
const CdL = JOUST_ATTACKS.courseDeLance;
const CdP = JOUST_ATTACKS.coupDePointe;
const PdL = JOUST_ATTACKS.portDeLance;
const CEP = JOUST_ATTACKS.coupEnPassant;

const OC = MELEE_ATTACKS.overhandCleave;
const FB = MELEE_ATTACKS.feintBreak;
const MC = MELEE_ATTACKS.measuredCut;
const PT = MELEE_ATTACKS.precisionThrust;
const GH = MELEE_ATTACKS.guardHigh;
const RS = MELEE_ATTACKS.riposteStep;

// Deterministic RNG for reproducible tests
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Simple AI: cycle through attacks by pass/round number
function cycleJoustAttack(pass: number): Attack {
  const attacks = [CF, BdG, CdL, CdP, PdL, CEP];
  return attacks[pass % attacks.length];
}
function cycleMeleeAttack(round: number): Attack {
  const attacks = [OC, FB, MC, PT, GH, RS];
  return attacks[round % attacks.length];
}

// Speed cycling
function cycleSpeed(pass: number): SpeedType {
  const speeds = [SpeedType.Slow, SpeedType.Standard, SpeedType.Fast];
  return speeds[pass % speeds.length];
}

/**
 * Runs a full match between two archetypes, returns the final state.
 * Uses deterministic attack cycling to ensure coverage of all attacks.
 * Optionally accepts steed and player gear loadouts (12-slot system).
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

  // Joust phase (up to 5 passes)
  while (match.phase === Phase.SpeedSelect && safety < 10) {
    const pass = match.passNumber;
    match = submitJoustPass(match,
      { speed: cycleSpeed(pass), attack: cycleJoustAttack(pass) },
      { speed: cycleSpeed(pass + 1), attack: cycleJoustAttack(pass + 2) },
    );
    safety++;
  }

  // Melee phase (if entered)
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

// ============================================================
// 1. All archetype matchups complete without errors
// ============================================================
describe('Full match simulation — all archetype pairs', () => {
  const archetypeIds = Object.keys(ARCHETYPES);

  for (const id1 of archetypeIds) {
    for (const id2 of archetypeIds) {
      it(`${id1} vs ${id2} completes to MatchEnd`, () => {
        const match = simulateMatch(ARCHETYPES[id1], ARCHETYPES[id2]);
        expect(match.phase).toBe(Phase.MatchEnd);
        expect(['player1', 'player2', 'draw']).toContain(match.winner);
        expect(match.winReason.length).toBeGreaterThan(0);
      });
    }
  }
});

// ============================================================
// 2. Full matches with steed gear (6-slot system)
// ============================================================
describe('Full match simulation — steed gear loadouts', () => {
  const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;

  for (const rarity of rarities) {
    it(`charger with ${rarity} steed gear vs duelist completes`, () => {
      const rng = makeRng(42);
      const loadout = createFullLoadout(rarity, rarity, rng);
      const match = simulateMatch(
        ARCHETYPES.charger, ARCHETYPES.duelist, loadout, undefined,
      );
      expect(match.phase).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
    });
  }

  it('both players with steed gear completes', () => {
    const rng1 = makeRng(100);
    const rng2 = makeRng(200);
    const loadout1 = createFullLoadout('epic', 'epic', rng1);
    const loadout2 = createFullLoadout('legendary', 'legendary', rng2);
    const match = simulateMatch(
      ARCHETYPES.charger, ARCHETYPES.bulwark, loadout1, loadout2,
    );
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });
});

// ============================================================
// 3. Full matches with player gear (6-slot system)
// ============================================================
describe('Full match simulation — player gear loadouts', () => {
  const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;

  for (const rarity of rarities) {
    it(`technician with ${rarity} player gear vs bulwark completes`, () => {
      const rng = makeRng(77);
      const playerLoadout = createFullPlayerLoadout(rarity, rng);
      const match = simulateMatch(
        ARCHETYPES.technician, ARCHETYPES.bulwark, undefined, undefined, playerLoadout, undefined,
      );
      expect(match.phase).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
    });
  }

  it('both players with player gear completes', () => {
    const rng1 = makeRng(300);
    const rng2 = makeRng(400);
    const pLoadout1 = createFullPlayerLoadout('epic', rng1);
    const pLoadout2 = createFullPlayerLoadout('rare', rng2);
    const match = simulateMatch(
      ARCHETYPES.breaker, ARCHETYPES.tactician, undefined, undefined, pLoadout1, pLoadout2,
    );
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });
});

// ============================================================
// 3b. Full 12-slot gear matches (steed + player combined)
// ============================================================
describe('Full match simulation — 12-slot gear (steed + player)', () => {
  it('all 12 slots filled at epic completes', () => {
    const rng = makeRng(500);
    const steedLoadout = createFullLoadout('epic', 'epic', rng);
    const playerLoadout = createFullPlayerLoadout('epic', rng);
    const match = simulateMatch(
      ARCHETYPES.duelist, ARCHETYPES.duelist, steedLoadout, undefined, playerLoadout, undefined,
    );
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });

  it('both players fully geared at giga completes', () => {
    const rng1 = makeRng(600);
    const rng2 = makeRng(700);
    const match = simulateMatch(
      ARCHETYPES.charger, ARCHETYPES.bulwark,
      createFullLoadout('giga', 'giga', rng1), createFullLoadout('giga', 'giga', rng2),
      createFullPlayerLoadout('giga', rng1), createFullPlayerLoadout('giga', rng2),
    );
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });

  it('asymmetric gear: p1 full giga vs p2 no gear', () => {
    const rng = makeRng(800);
    const match = simulateMatch(
      ARCHETYPES.duelist, ARCHETYPES.duelist,
      createFullLoadout('giga', 'giga', rng), undefined,
      createFullPlayerLoadout('giga', rng), undefined,
    );
    expect(match.phase).toBe(Phase.MatchEnd);
    // With full giga gear, P1 should be heavily favored
    expect(match.winner).toBe('player1');
  });

  it('mixed rarities across steed/player slots completes', () => {
    const rng = makeRng(900);
    const match = simulateMatch(
      ARCHETYPES.tactician, ARCHETYPES.breaker,
      createFullLoadout('legendary', 'rare', rng), createFullLoadout('epic', 'epic', rng),
      createFullPlayerLoadout('uncommon', rng), createFullPlayerLoadout('legendary', rng),
    );
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });
});

// ============================================================
// 4. Counter table verification — new PdL beats CEP
// ============================================================
describe('Counter table — S15 changes', () => {
  it('Port de Lance now beats Coup en Passant', () => {
    expect(PdL.beats).toContain('coupEnPassant');
    expect(CEP.beatenBy).toContain('portDeLance');
  });

  it('Coup en Passant still beats Coup Fort and Coup de Pointe', () => {
    expect(CEP.beats).toContain('coupFort');
    expect(CEP.beats).toContain('coupDePointe');
  });

  it('all joust counter relationships remain symmetric', () => {
    for (const atk of JOUST_ATTACK_LIST) {
      for (const beatId of atk.beats) {
        const beaten = JOUST_ATTACK_LIST.find(a => a.id === beatId)!;
        expect(beaten.beatenBy, `${atk.id} beats ${beatId}`).toContain(atk.id);
      }
    }
  });

  it('all melee counter relationships remain symmetric', () => {
    for (const atk of MELEE_ATTACK_LIST) {
      for (const beatId of atk.beats) {
        const beaten = MELEE_ATTACK_LIST.find(a => a.id === beatId)!;
        expect(beaten.beatenBy, `${atk.id} beats ${beatId}`).toContain(atk.id);
      }
    }
  });
});

// ============================================================
// 5. Archetype stat verification — S15 rebalance
// ============================================================
describe('Archetype stats — S15 rebalance', () => {
  it('Charger stamina is 65', () => {
    expect(ARCHETYPES.charger.stamina).toBe(65);
  });

  it('Breaker guard is 55 and stamina is 60', () => {
    expect(ARCHETYPES.breaker.guard).toBe(55);
    expect(ARCHETYPES.breaker.stamina).toBe(60);
  });

  it('stat totals are within expected range', () => {
    for (const arch of ARCHETYPE_LIST) {
      const total = arch.momentum + arch.control + arch.guard + arch.initiative + arch.stamina;
      expect(total, `${arch.id} total=${total}`).toBeGreaterThanOrEqual(290);
      expect(total, `${arch.id} total=${total}`).toBeLessThanOrEqual(305);
    }
  });
});

// ============================================================
// 6. Precision Thrust stat fix verification
// ============================================================
describe('Precision Thrust — S15 fix', () => {
  it('deltaGuard is 0 (was -5)', () => {
    expect(PT.deltaGuard).toBe(0);
  });

  it('still has higher CTL than Measured Cut', () => {
    expect(PT.deltaControl).toBeGreaterThan(MC.deltaControl);
  });
});

// ============================================================
// 7. Stamina endurance test — Charger survives 3 aggressive passes
// ============================================================
describe('Charger stamina endurance', () => {
  it('Charger can sustain 3 Fast+CoupFort passes before exhaustion', () => {
    let match = createMatch(ARCHETYPES.charger, ARCHETYPES.duelist);

    // Pass 1: Fast+CF — use mirror attacks to avoid unseat from counter swings
    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Fast, attack: CF },
    );
    expect(match.player1.currentStamina).toBe(40); // 65 -5 -20
    expect(match.player1.currentStamina).toBeGreaterThan(0);

    if (match.phase !== Phase.SpeedSelect) return; // unseat happened

    // Pass 2: Fast+CF
    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Fast, attack: CF },
    );
    expect(match.player1.currentStamina).toBe(15); // 40 -5 -20
    expect(match.player1.currentStamina).toBeGreaterThan(0);

    if (match.phase !== Phase.SpeedSelect) return;

    // Pass 3: Fast+CF — drains to 0 but still fights
    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Fast, attack: CF },
    );
    expect(match.player1.currentStamina).toBe(0); // 15 -5 -20 → clamped 0
  });
});

// ============================================================
// 8. Breaker durability test
// ============================================================
describe('Breaker durability', () => {
  it('Breaker has stat total within expected range', () => {
    const b = ARCHETYPES.breaker;
    const total = b.momentum + b.control + b.guard + b.initiative + b.stamina;
    expect(total).toBeGreaterThanOrEqual(290);
    expect(total).toBeLessThanOrEqual(300);
  });

  it('Breaker survives 5 standard passes or unseats opponent', () => {
    let match = createMatch(ARCHETYPES.breaker, ARCHETYPES.bulwark);
    let passes = 0;
    while (match.phase === Phase.SpeedSelect && passes < 5) {
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: BdG },
        { speed: SpeedType.Slow, attack: PdL },
      );
      passes++;
    }
    // BdG costs -15 STA per pass, Standard speed costs 0
    // Either completes 5 passes or triggers unseat/melee
    expect(match.passResults.length).toBe(passes);
    expect(match.passResults.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// 9. Melee with gear — all archetypes
// ============================================================
describe('Full geared matches — melee entry via unseat', () => {
  it('geared charger can unseat low-stamina opponent', () => {
    const rng = makeRng(99);
    const loadout1 = createFullLoadout('giga', 'giga', rng);
    let match = createMatch(ARCHETYPES.charger, ARCHETYPES.technician, loadout1);

    // Drain opponent stamina to force unseat
    match.player2.currentStamina = 3;

    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: PdL },
    );

    const lastPass = match.passResults[0];
    if (lastPass.unseat !== 'none') {
      expect(match.phase).toBe(Phase.MeleeSelect);

      // Play melee rounds
      let rounds = 0;
      while (match.phase === Phase.MeleeSelect && rounds < 20) {
        match = submitMeleeRound(match, OC, GH);
        rounds++;
      }
      expect(match.phase).toBe(Phase.MatchEnd);
    }
  });

  it('fully geared match transitions through all phases', () => {
    const rng = makeRng(42);
    const steedLoadout = createFullLoadout('legendary', 'legendary', rng);
    const playerLoadout = createFullPlayerLoadout('legendary', rng);
    let match = createMatch(ARCHETYPES.breaker, ARCHETYPES.technician, steedLoadout, undefined, playerLoadout);

    // Force low stamina to trigger unseat
    match.player2.currentStamina = 5;

    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: PdL },
    );

    if (match.phase === Phase.MeleeSelect) {
      let rounds = 0;
      while (match.phase === Phase.MeleeSelect && rounds < 20) {
        match = submitMeleeRound(match, OC, GH);
        rounds++;
      }
      expect(match.phase).toBe(Phase.MatchEnd);
    }
  });
});

// ============================================================
// 10. Property-based tests — random gear at all rarities, no crashes
// ============================================================
describe('Property-based — random gear at all rarities, all archetypes', () => {
  const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;
  const archetypeIds = Object.keys(ARCHETYPES);

  for (const rarity of rarities) {
    it(`all archetypes with random ${rarity} 12-slot gear complete without error`, () => {
      for (const archId of archetypeIds) {
        // 5 random seeds per archetype per rarity
        for (let seed = 1; seed <= 5; seed++) {
          const rng = makeRng(seed * 1000 + rarities.indexOf(rarity) * 100);
          const steed = createFullLoadout(rarity, rarity, rng);
          const player = createFullPlayerLoadout(rarity, rng);
          const match = simulateMatch(
            ARCHETYPES[archId], ARCHETYPES.duelist,
            steed, undefined, player, undefined,
          );
          expect(match.phase).toBe(Phase.MatchEnd);
          expect(['player1', 'player2', 'draw']).toContain(match.winner);
        }
      }
    });
  }
});

// ============================================================
// 11. Property-based — gear stat invariants hold after createMatch
// ============================================================
describe('Property-based — gear stat invariants', () => {
  const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;
  const statKeys = ['momentum', 'control', 'guard', 'initiative', 'stamina'] as const;

  it('geared archetype stats are always >= bare archetype stats', () => {
    for (const rarity of rarities) {
      for (let seed = 1; seed <= 10; seed++) {
        const rng = makeRng(seed * 7 + rarities.indexOf(rarity) * 31);
        const steed = createFullLoadout(rarity, rarity, rng);
        const player = createFullPlayerLoadout(rarity, rng);

        for (const archId of Object.keys(ARCHETYPES)) {
          const bare = ARCHETYPES[archId];
          const geared = createMatch(bare, ARCHETYPES.duelist, steed, undefined, player, undefined);
          for (const stat of statKeys) {
            expect(
              geared.player1.archetype[stat],
              `${archId} ${rarity} seed=${seed}: ${stat} should be >= bare`,
            ).toBeGreaterThanOrEqual(bare[stat]);
          }
        }
      }
    }
  });

  it('rarity bonus monotonically increases with rarity tier', () => {
    const bonuses = rarities.map(r => BALANCE.giglingRarityBonus[r]);
    for (let i = 1; i < bonuses.length; i++) {
      expect(bonuses[i], `${rarities[i]} bonus > ${rarities[i-1]} bonus`).toBeGreaterThan(bonuses[i-1]);
    }
  });

  it('gear stat ranges monotonically increase with rarity tier', () => {
    for (let i = 1; i < rarities.length; i++) {
      const prev = BALANCE.gearStatRanges[rarities[i-1]];
      const curr = BALANCE.gearStatRanges[rarities[i]];
      expect(curr.primary[1], `${rarities[i]} primary max >= ${rarities[i-1]}`).toBeGreaterThanOrEqual(prev.primary[1]);
      expect(curr.secondary[1], `${rarities[i]} secondary max >= ${rarities[i-1]}`).toBeGreaterThanOrEqual(prev.secondary[1]);
    }
  });

  it('player gear stat ranges monotonically increase with rarity tier', () => {
    for (let i = 1; i < rarities.length; i++) {
      const prev = BALANCE.playerGearStatRanges[rarities[i-1]];
      const curr = BALANCE.playerGearStatRanges[rarities[i]];
      expect(curr.primary[1], `${rarities[i]} primary max >= ${rarities[i-1]}`).toBeGreaterThanOrEqual(prev.primary[1]);
      expect(curr.secondary[1], `${rarities[i]} secondary max >= ${rarities[i-1]}`).toBeGreaterThanOrEqual(prev.secondary[1]);
    }
  });

  it('no NaN or Infinity in match stats after gear application', () => {
    for (const rarity of rarities) {
      const rng = makeRng(42 + rarities.indexOf(rarity));
      const steed = createFullLoadout(rarity, rarity, rng);
      const player = createFullPlayerLoadout(rarity, rng);
      const match = createMatch(ARCHETYPES.charger, ARCHETYPES.bulwark, steed, steed, player, player);

      for (const stat of statKeys) {
        expect(Number.isFinite(match.player1.archetype[stat]), `P1 ${stat} finite`).toBe(true);
        expect(Number.isFinite(match.player2.archetype[stat]), `P2 ${stat} finite`).toBe(true);
      }
      expect(Number.isFinite(match.player1.currentStamina)).toBe(true);
      expect(Number.isFinite(match.player2.currentStamina)).toBe(true);
    }
  });
});

// ============================================================
// 12. Stress test — 50 random matches with 12-slot gear, no crashes
// ============================================================
describe('Stress — 50 random matches with random gear and archetypes', () => {
  it('all 50 matches complete without errors', () => {
    const archetypeIds = Object.keys(ARCHETYPES);
    const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;

    for (let i = 0; i < 50; i++) {
      const rng = makeRng(i * 13 + 7);
      const pick = () => Math.floor(rng() * archetypeIds.length);
      const pickRarity = () => rarities[Math.floor(rng() * rarities.length)];

      const a1 = ARCHETYPES[archetypeIds[pick()]];
      const a2 = ARCHETYPES[archetypeIds[pick()]];
      const r1 = pickRarity();
      const r2 = pickRarity();

      const steed1 = createFullLoadout(r1, r1, rng);
      const steed2 = createFullLoadout(r2, r2, rng);
      const player1 = createFullPlayerLoadout(r1, rng);
      const player2 = createFullPlayerLoadout(r2, rng);

      const match = simulateMatch(a1, a2, steed1, steed2, player1, player2);
      expect(match.phase).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
      expect(match.winReason.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// 13. Property-based — Breaker guard penetration invariants
// ============================================================
describe('Property-based — Breaker guard penetration', () => {
  function makePlayerState(archId: string, stamina?: number): PlayerState {
    const arch = ARCHETYPES[archId];
    return {
      archetype: arch,
      currentStamina: stamina ?? arch.stamina,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
  }

  it('calcImpactScore with penetration >= without penetration (all guard values)', () => {
    const pen = BALANCE.breakerGuardPenetration;
    for (let guard = 0; guard <= 120; guard += 5) {
      const withoutPen = calcImpactScore(60, 50, guard, 0);
      const withPen = calcImpactScore(60, 50, guard, pen);
      expect(withPen).toBeGreaterThanOrEqual(withoutPen);
    }
  });

  it('Breaker impact >= same-stat non-Breaker impact against all archetypes in joust', () => {
    const breaker = makePlayerState('breaker');
    const choice: PassChoice = { speed: SpeedType.Standard, attack: CdL };

    for (const defId of Object.keys(ARCHETYPES)) {
      const defender = makePlayerState(defId);

      const breakerResult = resolveJoustPass(1, breaker, defender, choice, choice);

      // Build a "non-breaker" with same stats as breaker but different id
      const fakeNonBreaker: PlayerState = {
        archetype: { ...ARCHETYPES.breaker, id: 'fake_nonbreaker' },
        currentStamina: breaker.currentStamina,
        carryoverMomentum: 0,
        carryoverControl: 0,
        carryoverGuard: 0,
      };
      const nonBreakerResult = resolveJoustPass(1, fakeNonBreaker, defender, choice, choice);

      // Breaker should always have >= impact than the same archetype without penetration
      expect(
        breakerResult.player1.impactScore,
        `Breaker impact >= non-Breaker impact vs ${defId}`,
      ).toBeGreaterThanOrEqual(nonBreakerResult.player1.impactScore);
    }
  });

  it('Breaker impact >= same-stat non-Breaker impact against all archetypes in melee', () => {
    const breaker = makePlayerState('breaker');

    for (const defId of Object.keys(ARCHETYPES)) {
      const defender = makePlayerState(defId);

      const breakerResult = resolveMeleeRoundFn(1, breaker, defender, MC, MC);

      const fakeNonBreaker: PlayerState = {
        archetype: { ...ARCHETYPES.breaker, id: 'fake_nonbreaker' },
        currentStamina: breaker.currentStamina,
        carryoverMomentum: 0,
        carryoverControl: 0,
        carryoverGuard: 0,
      };
      const nonBreakerResult = resolveMeleeRoundFn(1, fakeNonBreaker, defender, MC, MC);

      expect(
        breakerResult.player1ImpactScore,
        `Breaker melee impact >= non-Breaker melee impact vs ${defId}`,
      ).toBeGreaterThanOrEqual(nonBreakerResult.player1ImpactScore);
    }
  });

  it('guard penetration benefit monotonically increases with opponent guard', () => {
    const pen = BALANCE.breakerGuardPenetration;
    let lastBenefit = 0;
    for (let guard = 0; guard <= 100; guard += 10) {
      const benefit = calcImpactScore(60, 50, guard, pen) - calcImpactScore(60, 50, guard, 0);
      expect(benefit).toBeGreaterThanOrEqual(lastBenefit);
      lastBenefit = benefit;
    }
  });

  it('breakerGuardPenetration is between 0 and 1 exclusive', () => {
    expect(BALANCE.breakerGuardPenetration).toBeGreaterThan(0);
    expect(BALANCE.breakerGuardPenetration).toBeLessThan(1);
  });
});

// ============================================================
// 14. Breaker full match simulations — completes without errors
// ============================================================
describe('Breaker full match — all matchups with guard penetration', () => {
  const archetypeIds = Object.keys(ARCHETYPES);

  for (const oppId of archetypeIds) {
    it(`breaker vs ${oppId} completes with guard penetration active`, () => {
      const match = simulateMatch(ARCHETYPES.breaker, ARCHETYPES[oppId]);
      expect(match.phase).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
    });
  }

  for (const oppId of archetypeIds) {
    it(`${oppId} vs breaker completes with guard penetration active`, () => {
      const match = simulateMatch(ARCHETYPES[oppId], ARCHETYPES.breaker);
      expect(match.phase).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
    });
  }
});

// ============================================================
// 15. Breaker with gear — guard penetration + gear stacking
// ============================================================
describe('Breaker with gear — guard penetration + gear', () => {
  const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;

  for (const rarity of rarities) {
    it(`Breaker with ${rarity} gear vs Bulwark completes`, () => {
      const rng = makeRng(42 + rarities.indexOf(rarity));
      const steed = createFullLoadout(rarity, rarity, rng);
      const player = createFullPlayerLoadout(rarity, rng);

      const match = simulateMatch(
        ARCHETYPES.breaker, ARCHETYPES.bulwark,
        steed, undefined, player, undefined,
      );
      expect(match.phase).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
    });
  }

  it('Breaker vs Bulwark both with giga gear completes', () => {
    const rng1 = makeRng(1000);
    const rng2 = makeRng(2000);
    const match = simulateMatch(
      ARCHETYPES.breaker, ARCHETYPES.bulwark,
      createFullLoadout('giga', 'giga', rng1), createFullLoadout('giga', 'giga', rng2),
      createFullPlayerLoadout('giga', rng1), createFullPlayerLoadout('giga', rng2),
    );
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });
});

// ============================================================
// 16. Performance regression — with guard penetration
// ============================================================
describe('Performance — guard penetration overhead', () => {
  it('100 Breaker vs Bulwark matches complete in <500ms', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      simulateMatch(ARCHETYPES.breaker, ARCHETYPES.bulwark);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('100 mixed matches (all archetypes) complete in <1000ms', () => {
    const archetypeIds = Object.keys(ARCHETYPES);
    const start = performance.now();
    let count = 0;
    for (let i = 0; i < archetypeIds.length && count < 100; i++) {
      for (let j = 0; j < archetypeIds.length && count < 100; j++) {
        simulateMatch(ARCHETYPES[archetypeIds[i]], ARCHETYPES[archetypeIds[j]]);
        count++;
      }
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

// ============================================================
// 17. Mixed Variant Loadout Stress Tests
// ============================================================
describe('Mixed variant loadout matches', () => {
  const variants: Array<'aggressive' | 'balanced' | 'defensive'> = ['aggressive', 'balanced', 'defensive'];

  it('aggressive steed + defensive player gear completes without error', () => {
    const rng = makeRng(42);
    const steed = createFullLoadout('giga', 'giga', rng, 'aggressive');
    const player = createFullPlayerLoadout('giga', rng, 'defensive');
    const match = simulateMatch(ARCHETYPES.charger, ARCHETYPES.bulwark, steed, steed, player, player);
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });

  it('defensive steed + aggressive player gear completes without error', () => {
    const rng = makeRng(43);
    const steed = createFullLoadout('epic', 'epic', rng, 'defensive');
    const player = createFullPlayerLoadout('epic', rng, 'aggressive');
    const match = simulateMatch(ARCHETYPES.technician, ARCHETYPES.tactician, steed, steed, player, player);
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });

  it('P1 aggressive vs P2 defensive gear — both complete', () => {
    const rng1 = makeRng(100);
    const rng2 = makeRng(200);
    const match = simulateMatch(
      ARCHETYPES.breaker, ARCHETYPES.bulwark,
      createFullLoadout('giga', 'giga', rng1, 'aggressive'),
      createFullLoadout('giga', 'giga', rng2, 'defensive'),
      createFullPlayerLoadout('giga', rng1, 'aggressive'),
      createFullPlayerLoadout('giga', rng2, 'defensive'),
    );
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(['player1', 'player2', 'draw']).toContain(match.winner);
  });

  it('all 9 variant combinations (steed x player) complete for Duelist mirror', () => {
    for (const sv of variants) {
      for (const pv of variants) {
        const rng = makeRng(sv.length * 100 + pv.length);
        const steed = createFullLoadout('rare', 'rare', rng, sv);
        const player = createFullPlayerLoadout('rare', rng, pv);
        const match = simulateMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, steed, steed, player, player);
        expect(match.phase).toBe(Phase.MatchEnd);
      }
    }
  });
});

// ============================================================
// 18. Player Gear — No Rarity Bonus Verification
// ============================================================
describe('Player gear applies NO rarity bonus', () => {
  it('player-only loadout does not add rarity bonus to stats', () => {
    const rng = makeRng(555);
    const duel = ARCHETYPES.duelist;
    const playerLoadout = createFullPlayerLoadout('giga', rng);

    // With both steed + player gear: steed adds rarity bonus
    const rng2 = makeRng(555);
    const steedLoadout = createFullLoadout('giga', 'giga', rng2);

    // Player-only match
    const playerOnly = createMatch(duel, duel, undefined, undefined, playerLoadout, playerLoadout);
    // Both gear match
    const bothGear = createMatch(duel, duel, steedLoadout, steedLoadout, playerLoadout, playerLoadout);

    // Player-only should NOT have rarity bonus (60 base + gear stats)
    // Both-gear should have rarity bonus (+13 for giga)
    const playerOnlySta = playerOnly.player1.currentStamina;
    const bothGearSta = bothGear.player1.currentStamina;

    // bothGear has steed rarity bonus (13) + steed gear stats that playerOnly doesn't have
    expect(bothGearSta).toBeGreaterThan(playerOnlySta);
    // The minimum difference is the rarity bonus (13)
    expect(bothGearSta - playerOnlySta).toBeGreaterThanOrEqual(BALANCE.giglingRarityBonus.giga);
  });
});

// ============================================================
// 19. Unseated Impact Boost and Stamina Recovery
// ============================================================
describe('Unseated mechanics — boost and recovery', () => {
  it('unseated player starts melee with stamina recovery applied', () => {
    // Force an unseat scenario: Charger Fast+CF vs Duelist Standard+PdL
    let match = createMatch(ARCHETYPES.charger, ARCHETYPES.duelist);

    // Play aggressive to try to trigger unseat
    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Fast, attack: CF },
        { speed: SpeedType.Standard, attack: PdL },
      );
    }

    // If unseat occurred, check the recovery
    if (match.phase === Phase.MeleeSelect) {
      const unseatedPlayer = match.player1.wasUnseated ? match.player1 : match.player2;

      if (match.player1.wasUnseated || match.player2.wasUnseated) {
        // Unseated player should have received stamina recovery
        expect(unseatedPlayer.currentStamina).toBeGreaterThanOrEqual(BALANCE.unseatedStaminaRecovery);
      }
    }
  });
});

// ============================================================
// 20. Carryover Divisors Match Balance Config
// ============================================================
describe('Carryover divisors are from balance-config', () => {
  it('momentum divisor matches config', () => {
    expect(BALANCE.carryoverDivisors.momentum).toBe(6);
  });
  it('control divisor matches config', () => {
    expect(BALANCE.carryoverDivisors.control).toBe(7);
  });
  it('guard divisor matches config', () => {
    expect(BALANCE.carryoverDivisors.guard).toBe(9);
  });
  it('unseated impact boost matches config', () => {
    expect(BALANCE.unseatedImpactBoost).toBe(1.35);
  });
  it('unseated stamina recovery matches config', () => {
    expect(BALANCE.unseatedStaminaRecovery).toBe(12);
  });
});

// ============================================================
// 21. All Melee Attack Speed Combinations
// ============================================================
describe('All melee attack combinations resolve without error', () => {
  const meleeAttacks = Object.values(MELEE_ATTACKS);

  it('all 36 melee attack matchups produce valid outcomes', () => {
    for (const atk1 of meleeAttacks) {
      for (const atk2 of meleeAttacks) {
        const p1: PlayerState = {
          archetype: ARCHETYPES.charger,
          currentStamina: 40,
          wasUnseated: false,
          carryoverMomentum: 0,
          carryoverControl: 0,
          carryoverGuard: 0,
        };
        const p2: PlayerState = {
          archetype: ARCHETYPES.technician,
          currentStamina: 35,
          wasUnseated: false,
          carryoverMomentum: 0,
          carryoverControl: 0,
          carryoverGuard: 0,
        };
        const result = resolveMeleeRoundFn(1, p1, p2, atk1, atk2);

        expect(['Draw', 'Hit', 'Critical']).toContain(result.outcome);
        expect(['none', 'player1', 'player2']).toContain(result.winner);
        expect(result.player1StaminaAfter).toBeGreaterThanOrEqual(0);
        expect(result.player2StaminaAfter).toBeGreaterThanOrEqual(0);
        expect(result.margin).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ============================================================
// 22. Uncommon Rarity Bonus = 2 (not 1)
// ============================================================
describe('Uncommon rarity bonus is 2', () => {
  it('uncommon rarity bonus matches config value of 2', () => {
    expect(BALANCE.giglingRarityBonus.uncommon).toBe(2);
  });

  it('uncommon gear adds +2 to all stats via rarity bonus', () => {
    const rng = makeRng(777);
    const duel = ARCHETYPES.duelist; // all 60s
    const steed = createFullLoadout('uncommon', 'uncommon', rng);
    const geared = createMatch(duel, duel, steed);

    // Base stamina 60 + rarity bonus 2 + gear stamina bonuses
    expect(geared.player1.currentStamina).toBeGreaterThanOrEqual(62);
  });
});

// ============================================================
// 23. BL-019: Tactician mirror P1 bias investigation
// ============================================================
describe('BL-019: Tactician mirror P1 bias', () => {
  /**
   * Runs N mirror matches with seeded-random attack cycling.
   * Uses different seed per match for variety, but deterministic overall.
   */
  function runMirrorBatch(archetype: Archetype, n: number, baseSeed: number) {
    let p1Wins = 0;
    let p2Wins = 0;
    let draws = 0;

    for (let i = 0; i < n; i++) {
      const rng = makeRng(baseSeed + i);
      let match = createMatch(archetype, archetype);
      let safety = 0;

      // Joust phase — pick attacks using seeded RNG for variety
      while (match.phase === Phase.SpeedSelect && safety < 10) {
        const joustAtks = JOUST_ATTACK_LIST;
        const speeds = [SpeedType.Slow, SpeedType.Standard, SpeedType.Fast];
        const p1Atk = joustAtks[Math.floor(rng() * joustAtks.length)];
        const p2Atk = joustAtks[Math.floor(rng() * joustAtks.length)];
        const p1Spd = speeds[Math.floor(rng() * speeds.length)];
        const p2Spd = speeds[Math.floor(rng() * speeds.length)];
        match = submitJoustPass(match,
          { speed: p1Spd, attack: p1Atk },
          { speed: p2Spd, attack: p2Atk },
        );
        safety++;
      }

      // Melee phase
      let meleeRounds = 0;
      while (match.phase === Phase.MeleeSelect && meleeRounds < 30) {
        const meleeAtks = MELEE_ATTACK_LIST;
        const rng2 = makeRng(baseSeed + i + 10000 + meleeRounds);
        const p1Atk = meleeAtks[Math.floor(rng2() * meleeAtks.length)];
        const p2Atk = meleeAtks[Math.floor(rng2() * meleeAtks.length)];
        match = submitMeleeRound(match, p1Atk, p2Atk);
        meleeRounds++;
      }

      if (match.winner === 'player1') p1Wins++;
      else if (match.winner === 'player2') p2Wins++;
      else draws++;
    }

    return { p1Wins, p2Wins, draws, total: n };
  }

  it('Tactician mirror N=500: P1 win rate within 40-60%', () => {
    const tactician = ARCHETYPES.tactician;
    const result = runMirrorBatch(tactician, 500, 42);
    const p1Rate = result.p1Wins / (result.p1Wins + result.p2Wins) * 100;

    // Mirror matchups should have no inherent P1 advantage
    // BUG-002 reported ~36% P1 at N=200 — likely Monte Carlo noise
    // At N=500 with deterministic seeding, we expect 40-60% P1
    expect(p1Rate).toBeGreaterThanOrEqual(40);
    expect(p1Rate).toBeLessThanOrEqual(60);
  });

  it('all 6 archetype mirrors N=500: P1 win rate within 35-65%', () => {
    for (const name of Object.keys(ARCHETYPES)) {
      const arch = ARCHETYPES[name];
      const result = runMirrorBatch(arch, 500, 1000 + name.length * 100);
      const decisive = result.p1Wins + result.p2Wins;
      if (decisive === 0) continue; // all draws — acceptable for mirrors
      const p1Rate = result.p1Wins / decisive * 100;

      // Wider band for all archetypes (35-65%) since some may have
      // attack-order sensitivity in their stat profile
      expect(p1Rate, `${name} mirror P1 rate ${p1Rate.toFixed(1)}%`)
        .toBeGreaterThanOrEqual(35);
      expect(p1Rate, `${name} mirror P1 rate ${p1Rate.toFixed(1)}%`)
        .toBeLessThanOrEqual(65);
    }
  });
});

// ============================================================
// 20. Gear Extreme Boundary Tests — Min vs Max Stat Rolls
// ============================================================
describe('Gear Extreme Boundaries — min/max stat rolls', () => {
  const rngMin = () => 0;
  const rngMax = () => 0.999;

  it('lowest uncommon vs highest giga: match completes without errors', () => {
    const weakSteed = createFullLoadout('uncommon', 'uncommon', rngMin);
    const weakPlayer = createFullPlayerLoadout('uncommon', rngMin);
    const strongSteed = createFullLoadout('giga', 'giga', rngMax);
    const strongPlayer = createFullPlayerLoadout('giga', rngMax);

    let match = createMatch(
      ARCHETYPES.duelist, ARCHETYPES.duelist,
      weakSteed, strongSteed, weakPlayer, strongPlayer,
    );

    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: CdL },
      );
    }

    // Giga player (P2) should dominate
    expect(match.passResults.length).toBeGreaterThanOrEqual(1);
    if (match.phase === Phase.MatchEnd) {
      expect(match.winner).toBe('player2');
    }
  });

  it('all-min gear: stamina never goes negative across 5 passes', () => {
    const steed = createFullLoadout('uncommon', 'uncommon', rngMin);
    const player = createFullPlayerLoadout('uncommon', rngMin);

    let match = createMatch(
      ARCHETYPES.charger, ARCHETYPES.technician,
      steed, steed, player, player,
    );

    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Fast, attack: CF },
        { speed: SpeedType.Fast, attack: CF },
      );
    }

    // Stamina should never be negative
    for (const pr of match.passResults) {
      expect(pr.player1.staminaAfter).toBeGreaterThanOrEqual(0);
      expect(pr.player2.staminaAfter).toBeGreaterThanOrEqual(0);
    }
  });

  it('all-max giga gear: stats above softCap knee still produce valid combat', () => {
    const steed = createFullLoadout('giga', 'giga', rngMax);
    const player = createFullPlayerLoadout('giga', rngMax);

    let match = createMatch(
      ARCHETYPES.charger, ARCHETYPES.bulwark,
      steed, steed, player, player,
    );

    // Both players have max gear → stats well above softCap knee
    expect(match.player1.archetype.momentum).toBeGreaterThan(BALANCE.softCapKnee);

    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: PdL },
      );
    }

    // Match must complete
    expect(match.passResults.length).toBeGreaterThanOrEqual(1);
    // Impact scores should be positive (softCap shouldn't break scoring)
    for (const pr of match.passResults) {
      expect(pr.player1.impactScore).toBeGreaterThan(0);
      expect(pr.player2.impactScore).toBeGreaterThan(0);
    }
  });

  it('min vs max gear: giga differential exceeds uncommon differential', () => {
    const rarities = ['uncommon', 'giga'] as const;
    const differentials: number[] = [];

    for (const rarity of rarities) {
      const minSteed = createFullLoadout(rarity, rarity, rngMin);
      const maxSteed = createFullLoadout(rarity, rarity, rngMax);

      let minMatch = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, minSteed);
      let maxMatch = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, maxSteed);

      minMatch = submitJoustPass(minMatch,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: CdL },
      );
      maxMatch = submitJoustPass(maxMatch,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: CdL },
      );

      const minImpact = minMatch.passResults[0].player1.impactScore;
      const maxImpact = maxMatch.passResults[0].player1.impactScore;
      differentials.push(maxImpact - minImpact);
    }

    // Giga min-max differential must exceed uncommon (wider stat ranges)
    expect(differentials[1]).toBeGreaterThan(differentials[0]);
    // Both differentials should be positive (max gear always stronger than min)
    expect(differentials[0]).toBeGreaterThan(0);
    expect(differentials[1]).toBeGreaterThan(0);
  });

  it('all 6 rarities: max-roll gear always produces higher impact than min-roll', () => {
    const rarities = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'] as const;

    for (const rarity of rarities) {
      const minSteed = createFullLoadout(rarity, rarity, rngMin);
      const maxSteed = createFullLoadout(rarity, rarity, rngMax);

      let minMatch = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, minSteed);
      let maxMatch = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, maxSteed);

      minMatch = submitJoustPass(minMatch,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: CdL },
      );
      maxMatch = submitJoustPass(maxMatch,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: CdL },
      );

      expect(maxMatch.passResults[0].player1.impactScore,
        `${rarity}: max gear impact should exceed min gear impact`)
        .toBeGreaterThan(minMatch.passResults[0].player1.impactScore);
    }
  });

  it('max giga gear melee: match completes within 20 rounds', () => {
    const steed = createFullLoadout('giga', 'giga', rngMax);
    const player = createFullPlayerLoadout('giga', rngMax);

    let match = createMatch(
      ARCHETYPES.breaker, ARCHETYPES.bulwark,
      steed, steed, player, player,
    );
    match = { ...match, phase: Phase.MeleeSelect };

    let rounds = 0;
    while (match.phase === Phase.MeleeSelect && rounds < 20) {
      match = submitMeleeRound(match, MC, OC);
      rounds++;
    }

    expect(match.phase).toBe(Phase.MatchEnd);
    expect(match.winner).not.toBe('none');
  });
});
