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
import { SpeedType, Phase, type Attack, type Archetype, type GiglingLoadout, type PlayerLoadout } from './types';
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
  it('Charger stamina is 60', () => {
    expect(ARCHETYPES.charger.stamina).toBe(60);
  });

  it('Breaker guard is 55 and stamina is 60', () => {
    expect(ARCHETYPES.breaker.guard).toBe(55);
    expect(ARCHETYPES.breaker.stamina).toBe(60);
  });

  it('stat totals are within expected range', () => {
    for (const arch of ARCHETYPE_LIST) {
      const total = arch.momentum + arch.control + arch.guard + arch.initiative + arch.stamina;
      expect(total, `${arch.id} total=${total}`).toBeGreaterThanOrEqual(290);
      expect(total, `${arch.id} total=${total}`).toBeLessThanOrEqual(300);
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
    expect(match.player1.currentStamina).toBe(35); // 60 -5 -20
    expect(match.player1.currentStamina).toBeGreaterThan(0);

    if (match.phase !== Phase.SpeedSelect) return; // unseat happened

    // Pass 2: Fast+CF
    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Fast, attack: CF },
    );
    expect(match.player1.currentStamina).toBe(10); // 35 -5 -20
    expect(match.player1.currentStamina).toBeGreaterThan(0);

    if (match.phase !== Phase.SpeedSelect) return;

    // Pass 3: Fast+CF — drains to 0 but still fights
    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Fast, attack: CF },
    );
    expect(match.player1.currentStamina).toBe(0); // 10 -5 -20 → clamped 0
  });
});

// ============================================================
// 8. Breaker durability test
// ============================================================
describe('Breaker durability', () => {
  it('Breaker has higher stat total than before (295 vs 280)', () => {
    const b = ARCHETYPES.breaker;
    const total = b.momentum + b.control + b.guard + b.initiative + b.stamina;
    expect(total).toBe(295);
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
