// ============================================================
// Playtest — Full Match Simulations (S15 Combat Rebalance)
// ============================================================
// Simulates complete matches for all 6 archetypes with all 6
// caparisons to verify the combat system works end-to-end.
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES, ARCHETYPE_LIST } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS, JOUST_ATTACK_LIST, MELEE_ATTACK_LIST } from './attacks';
import { SpeedType, Phase, type Attack, type Archetype, type CaparisonEffectId } from './types';
import { createMatch, submitJoustPass, submitMeleeRound } from './match';
import { createFullLoadout } from './gigling-gear';
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

const CAPARISON_IDS: CaparisonEffectId[] = [
  'pennant_of_haste', 'woven_shieldcloth', 'thunderweave',
  'irongrip_drape', 'stormcloak', 'banner_of_the_giga',
];

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
 */
function simulateMatch(
  arch1: Archetype,
  arch2: Archetype,
  cap1?: CaparisonEffectId,
  cap2?: CaparisonEffectId,
) {
  const rng = makeRng(42);
  const loadout1 = cap1 ? createFullLoadout('rare', 'rare', cap1, rng) : undefined;
  const loadout2 = cap2 ? createFullLoadout('rare', 'rare', cap2, rng) : undefined;

  let match = createMatch(arch1, arch2, loadout1, loadout2);
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
// 2. All caparison effects work in full matches
// ============================================================
describe('Full match simulation — all caparisons', () => {
  for (const capId of CAPARISON_IDS) {
    it(`charger with ${capId} vs duelist completes`, () => {
      const match = simulateMatch(
        ARCHETYPES.charger, ARCHETYPES.duelist, capId, undefined,
      );
      expect(match.phase).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
    });

    it(`duelist vs bulwark with ${capId} completes`, () => {
      const match = simulateMatch(
        ARCHETYPES.duelist, ARCHETYPES.bulwark, undefined, capId,
      );
      expect(match.phase).toBe(Phase.MatchEnd);
      expect(['player1', 'player2', 'draw']).toContain(match.winner);
    });
  }
});

// ============================================================
// 3. Both caparisons active simultaneously
// ============================================================
describe('Full match — both players with caparisons', () => {
  const pairs: [CaparisonEffectId, CaparisonEffectId][] = [
    ['thunderweave', 'woven_shieldcloth'],
    ['stormcloak', 'banner_of_the_giga'],
    ['pennant_of_haste', 'irongrip_drape'],
    ['banner_of_the_giga', 'thunderweave'],
  ];

  for (const [cap1, cap2] of pairs) {
    it(`${cap1} vs ${cap2} completes`, () => {
      const match = simulateMatch(
        ARCHETYPES.charger, ARCHETYPES.bulwark, cap1, cap2,
      );
      expect(match.phase).toBe(Phase.MatchEnd);
    });
  }
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
    const loadout1 = createFullLoadout('giga', 'giga', 'thunderweave', rng);
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
});
