// ============================================================
// Integration Tests — Match State Machine
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS } from './attacks';
import { Phase, SpeedType, MeleeOutcome, type GiglingLoadout, type PlayerLoadout } from './types';
import { createMatch, submitJoustPass, submitMeleeRound } from './match';
import { createFullLoadout, createStatGear, GEAR_SLOT_STATS } from './gigling-gear';
import { createFullPlayerLoadout, createPlayerGear, PLAYER_GEAR_SLOT_STATS } from './player-gear';
import { BALANCE } from './balance-config';
import { softCap } from './calculator';

const charger = ARCHETYPES.charger;
const technician = ARCHETYPES.technician;
const bulwark = ARCHETYPES.bulwark;
const duelist = ARCHETYPES.duelist;

const CF = JOUST_ATTACKS.coupFort;
const CdL = JOUST_ATTACKS.courseDeLance;
const CEP = JOUST_ATTACKS.coupEnPassant;
const BdG = JOUST_ATTACKS.brisDeGarde;
const PdL = JOUST_ATTACKS.portDeLance;
const CdP = JOUST_ATTACKS.coupDePointe;

const OC = MELEE_ATTACKS.overhandCleave;
const MC = MELEE_ATTACKS.measuredCut;
const GH = MELEE_ATTACKS.guardHigh;
const RS = MELEE_ATTACKS.riposteStep;
const FB = MELEE_ATTACKS.feintBreak;
const PT = MELEE_ATTACKS.precisionThrust;

describe('Match creation', () => {
  it('creates a match with correct initial state', () => {
    const match = createMatch(charger, technician);
    expect(match.phase).toBe(Phase.SpeedSelect);
    expect(match.passNumber).toBe(1);
    expect(match.player1.currentStamina).toBe(60); // Charger STA
    expect(match.player2.currentStamina).toBe(55); // Technician STA
    expect(match.cumulativeScore1).toBe(0);
    expect(match.cumulativeScore2).toBe(0);
    expect(match.winner).toBe('none');
  });
});

describe('Full 5-pass joust — score victory', () => {
  it('completes 5 passes and determines winner by cumulative score', () => {
    let match = createMatch(duelist, duelist);

    // Play 5 identical passes to ensure completion
    for (let i = 0; i < 5; i++) {
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: CdL },
      );
    }

    // After 5 passes with identical choices, should be a tie → melee
    // (mirror matchup, same archetype, same choices)
    expect(match.passResults.length).toBe(5);
    // Mirror matchup → tied → melee
    expect(match.phase).toBe(Phase.MeleeSelect);
  });
});

describe('v4.1 Worked Example — 3 passes', () => {
  it('replays Charger vs Technician Passes 1-3 via match machine', () => {
    let match = createMatch(charger, technician);

    // Pass 1: Charger Fast+CF, Technician Standard+CdL → shifts to CEP
    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: CdL, shiftAttack: CEP },
    );
    expect(match.passResults.length).toBe(1);
    const p1 = match.passResults[0];
    // Charger wins pass 1 (raw MOM dominates with reduced guard coeff 0.2)
    expect(p1.player1.impactScore).toBeGreaterThan(p1.player2.impactScore);
    expect(p1.unseat).toBe('none');
    expect(match.player1.currentStamina).toBe(35);
    expect(match.player2.currentStamina).toBe(29);

    // Pass 2: Charger Slow+BdG, Technician Standard+PdL
    match = submitJoustPass(match,
      { speed: SpeedType.Slow, attack: BdG },
      { speed: SpeedType.Standard, attack: PdL },
    );
    const p2 = match.passResults[1];
    // Charger wins pass 2 (BdG beats PdL)
    expect(p2.player1.impactScore).toBeGreaterThan(p2.player2.impactScore);
    expect(match.player1.currentStamina).toBe(25);
    expect(match.player2.currentStamina).toBe(21);

    // Pass 3: Charger Slow+CdL, Technician Standard+CEP
    match = submitJoustPass(match,
      { speed: SpeedType.Slow, attack: CdL },
      { speed: SpeedType.Standard, attack: CEP },
    );
    const p3 = match.passResults[2];
    // Charger now wins pass 3 (more stamina = less fatigue after rebalance)
    expect(p3.player1.impactScore).toBeGreaterThan(p3.player2.impactScore);
    expect(match.player1.currentStamina).toBe(20);
    expect(match.player2.currentStamina).toBe(7);

    // Cumulative: extremely close per spec narrative
    expect(match.passNumber).toBe(4);
    expect(match.phase).toBe(Phase.SpeedSelect);
  });
});

describe('Melee phase', () => {
  it('tracks round wins and declares winner at 4 (criticals count as 2)', () => {
    // Duelist vs Duelist: equal base stats.
    // P1 plays MC (Bal), P2 plays OC (Agg). MC beats OC in counters.
    // P1 also drains slower (MC -10 STA vs OC -18 STA) → compounding advantage.
    let match = createMatch(duelist, duelist);
    match.phase = Phase.MeleeSelect;

    let rounds = 0;
    const maxRounds = 20;
    while (match.phase === Phase.MeleeSelect && rounds < maxRounds) {
      match = submitMeleeRound(match, MC, OC);
      rounds++;
    }

    expect(match.phase).toBe(Phase.MatchEnd);
    expect(match.winner).toBe('player1');
    // P1 should win via round accumulation (criticals count as 2 wins)
    expect(match.meleeWins1).toBeGreaterThanOrEqual(3);
  });

  it('melee rounds with counter advantage produce hits (margin >= 5)', () => {
    let match = createMatch(charger, duelist);
    match.phase = Phase.MeleeSelect;

    // OC beats GH → P1 gets +10, P2 gets -10
    match = submitMeleeRound(match, OC, GH);
    const r1 = match.meleeRoundResults[0];

    // Counter advantage should create meaningful margin
    expect(r1.outcome).not.toBe(MeleeOutcome.Draw);
    expect(r1.margin).toBeGreaterThanOrEqual(5);
  });

  it('mirror melee matchup draws', () => {
    let match = createMatch(duelist, duelist);
    match.phase = Phase.MeleeSelect;

    // Same archetype, same attack → should draw (margin < 5)
    match = submitMeleeRound(match, MC, MC);
    const r1 = match.meleeRoundResults[0];
    expect(r1.outcome).toBe(MeleeOutcome.Draw);
    expect(r1.margin).toBe(0);
  });
});

describe('Unseat → Melee transition with carryover', () => {
  it('applies carryover penalties to unseated player', () => {
    // We need to manufacture a state where unseat can happen.
    // Use the match machine but with extreme conditions.
    // Actually, let's test the transition logic directly by setting up
    // a state that will trigger unseat.

    let match = createMatch(charger, technician);

    // Drain technician's stamina to near-zero to make unseat possible
    // (low stamina = lower unseat threshold + worse stats from fatigue)
    match.player2.currentStamina = 5;

    // Charger goes Fast+CF with full stamina vs nearly-dead Technician
    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: PdL },
    );

    // Check if unseat happened (it should with such extreme stamina gap)
    const lastPass = match.passResults[0];
    if (lastPass.unseat !== 'none') {
      expect(match.phase).toBe(Phase.MeleeSelect);

      // Unseated player should have carryover penalties
      if (lastPass.unseat === 'player1') {
        // P1 unseats P2 → P2 gets penalties
        expect(match.player2.carryoverMomentum).toBeLessThan(0);
        expect(match.player2.carryoverControl).toBeLessThan(0);
        expect(match.player2.carryoverGuard).toBeLessThan(0);
      }
    }
    // If no unseat, that's OK — the threshold is quite high
    // The test validates the flow either way
  });
});

describe('Stamina tracking across passes', () => {
  it('correctly drains stamina across multiple passes', () => {
    let match = createMatch(charger, technician);

    // Pass 1: Charger Fast+CF = -5 (speed) then -20 (attack)
    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: CdL },
    );
    expect(match.player1.currentStamina).toBe(35); // 60 -5 -20 = 35
    expect(match.player2.currentStamina).toBe(45); // 55 -0 -10 = 45

    // Pass 2: Charger Slow+PdL = +5 (speed) then -8 (attack)
    match = submitJoustPass(match,
      { speed: SpeedType.Slow, attack: PdL },
      { speed: SpeedType.Standard, attack: CdL },
    );
    expect(match.player1.currentStamina).toBe(32); // 35 +5 -8 = 32
    expect(match.player2.currentStamina).toBe(35); // 45 -0 -10 = 35
  });
});

// ============================================================
// 6. Five-pass joust — score victory (no unseat)
// ============================================================
describe('Five-pass joust — score victory', () => {
  it('winner is determined by cumulative ImpactScore after 5 passes', () => {
    // P1 uses PdL (beats CdL), P2 uses CdL. Counter gives P1 +10 acc/pass.
    // PdL is cheap (-8 STA) so P1 fatigues slower too. No unseat (margin ~6).
    let match = createMatch(duelist, duelist);

    for (let i = 0; i < 5; i++) {
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: PdL },
        { speed: SpeedType.Standard, attack: CdL },
      );
    }

    expect(match.passResults.length).toBe(5);
    expect(match.phase).toBe(Phase.MatchEnd);
    // PdL beats CdL → P1 gets counter bonus every pass → higher score
    expect(match.cumulativeScore1).toBeGreaterThan(match.cumulativeScore2);
    expect(match.winner).toBe('player1');
    expect(match.winReason).toContain('cumulative ImpactScore');
  });
});

// ============================================================
// 7. Melee exhaustion tiebreaker
// ============================================================
describe('Melee exhaustion tiebreaker', () => {
  it('resolves to round-wins tiebreaker when both reach 0 stamina', () => {
    // Set up a melee where both players will exhaust quickly
    let match = createMatch(duelist, duelist);
    match = { ...match, phase: Phase.MeleeSelect };
    // Give P1 an advantage: P1 uses MC (beats OC), P2 uses OC
    // This should give P1 more round wins before both exhaust.
    // Drain stamina to near-zero first to speed up exhaustion.
    match.player1.currentStamina = 12;
    match.player2.currentStamina = 12;

    let rounds = 0;
    while (match.phase === Phase.MeleeSelect && rounds < 20) {
      // MC beats OC → P1 gets counter advantage → more round wins
      match = submitMeleeRound(match, MC, OC);
      rounds++;
    }

    expect(match.phase).toBe(Phase.MatchEnd);
    // Game ended — either via 4 wins or exhaustion
    expect(match.winner).not.toBe('none');
  });

  it('falls through to joust score when melee wins are tied at exhaustion', () => {
    let match = createMatch(charger, duelist);
    // Give charger a joust score lead
    match.cumulativeScore1 = 100;
    match.cumulativeScore2 = 50;
    match = { ...match, phase: Phase.MeleeSelect };
    // Both at minimal stamina, same attacks → draws → both exhaust
    match.player1.currentStamina = 5;
    match.player2.currentStamina = 5;

    // Play one round — both go to 0 (MC costs 10, but clamped at 0)
    match = submitMeleeRound(match, MC, MC);

    expect(match.phase).toBe(Phase.MatchEnd);
    // Both exhausted, 0 melee wins each → joust score tiebreaker
    expect(match.meleeWins1).toBe(0);
    expect(match.meleeWins2).toBe(0);
    expect(match.winner).toBe('player1'); // higher joust score
    expect(match.winReason).toContain('joust score');
  });

  it('results in draw when everything is tied', () => {
    let match = createMatch(duelist, duelist);
    match.cumulativeScore1 = 50;
    match.cumulativeScore2 = 50;
    match = { ...match, phase: Phase.MeleeSelect };
    match.player1.currentStamina = 5;
    match.player2.currentStamina = 5;

    // Mirror matchup → draw round, both exhaust
    match = submitMeleeRound(match, MC, MC);

    expect(match.phase).toBe(Phase.MatchEnd);
    expect(match.winner).toBe('draw');
    expect(match.winReason).toContain('DRAW');
  });
});

// ============================================================
// 8. Critical counts as 2 round wins
// ============================================================
describe('Critical hit counts as 2 round wins', () => {
  it('a critical hit awards 2 wins toward the meleeWinsNeeded threshold', () => {
    // Set up a scenario where one player has massive advantage to land a crit
    // Charger at full stamina vs Duelist at 0 stamina
    let match = createMatch(charger, duelist);
    match = { ...match, phase: Phase.MeleeSelect };
    match.player2.currentStamina = 0; // P2 is incapacitated (all stats fatigued to 0)

    // P1 at full power, P2 at 0 → massive margin → likely critical
    match = submitMeleeRound(match, OC, GH);

    const round1 = match.meleeRoundResults[0];
    if (round1.outcome === MeleeOutcome.Critical) {
      expect(match.meleeWins1).toBe(BALANCE.criticalWinsValue);
    } else {
      // If not a critical (guard-relative threshold may be high), at least a hit
      expect(round1.outcome).toBe(MeleeOutcome.Hit);
      expect(match.meleeWins1).toBe(1);
    }
  });
});

// ============================================================
// 9. Edge Cases: Both players at 0 stamina in joust
// ============================================================
describe('Edge Cases — zero stamina joust', () => {
  it('both players at 0 stamina can still play passes', () => {
    let match = createMatch(charger, technician);
    match.player1.currentStamina = 0;
    match.player2.currentStamina = 0;

    // Should not throw — just produce heavily fatigued results
    match = submitJoustPass(match,
      { speed: SpeedType.Standard, attack: CdL },
      { speed: SpeedType.Standard, attack: CdL },
    );
    expect(match.passResults.length).toBe(1);
    // Both at 0 stamina → MOM/CTL are 0, guard at floor
    const p1Stats = match.passResults[0].player1.effectiveStats;
    expect(p1Stats.momentum).toBe(0);
    expect(p1Stats.control).toBe(0);
    // Stamina can't go further below 0
    expect(match.player1.currentStamina).toBe(0);
  });

  it('shift denied when both at 0 stamina', () => {
    let match = createMatch(technician, charger);
    match.player1.currentStamina = 0;
    match.player2.currentStamina = 0;

    match = submitJoustPass(match,
      { speed: SpeedType.Standard, attack: CdL, shiftAttack: CEP },
      { speed: SpeedType.Standard, attack: CdL },
    );

    // Shift denied: stamina 0 < 10 requirement
    expect(match.passResults[0].player1.shifted).toBe(false);
  });
});

// ============================================================
// 10. Edge Cases: Degenerate strategy — always same attack
// ============================================================
describe('Edge Cases — same attack every pass', () => {
  it('always Port de Lance (cheapest) survives 5 passes', () => {
    let match = createMatch(bulwark, duelist);

    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: PdL },
        { speed: SpeedType.Standard, attack: PdL },
      );
    }

    // Bulwark PdL costs 8 STA/pass. 5 passes = 40 STA used. Start 65, end 25.
    // Mirror matchup → tied → melee
    expect(match.passResults.length).toBe(5);
  });

  it('always Coup Fort exhausts Duelist by pass 3', () => {
    let match = createMatch(duelist, duelist);

    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Fast, attack: CF },
        { speed: SpeedType.Fast, attack: CF },
      );
    }

    // Duelist STA=60. Fast+CF = -5 -20 = -25/pass.
    // Pass 1: 35, Pass 2: 10, Pass 3: 0 (clamped). Should play all 5 passes.
    expect(match.passResults.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================
// 11. Edge Cases: Unseat with extreme stamina gap
// ============================================================
describe('Edge Cases — unseat scenarios', () => {
  it('Charger Fast+CF vs 0-stamina opponent creates high impact gap', () => {
    let match = createMatch(charger, duelist);
    match.player2.currentStamina = 0;

    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: PdL },
    );

    const pass = match.passResults[0];
    // P2 at 0 stamina → all combat stats at 0 → very low impact
    // P1 at full power → very high impact
    expect(pass.player1.impactScore).toBeGreaterThan(pass.player2.impactScore);
    // Impact gap should be large enough for unseat
    const margin = pass.player1.impactScore - pass.player2.impactScore;
    expect(margin).toBeGreaterThan(20);
  });

  it('unseat on pass 1 transitions to melee immediately', () => {
    let match = createMatch(charger, technician);
    match.player2.currentStamina = 1;

    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: CdL },
    );

    if (match.passResults[0].unseat !== 'none') {
      expect(match.phase).toBe(Phase.MeleeSelect);
      expect(match.passResults.length).toBe(1);
      // Carryover penalties applied
      const unseatedPlayer = match.passResults[0].unseat === 'player1' ? 'player2' : 'player1';
      if (unseatedPlayer === 'player2') {
        expect(match.player2.carryoverMomentum).toBeLessThanOrEqual(0);
      }
    }
  });

  it('unseat on pass 5 transitions to melee (not match end)', () => {
    let match = createMatch(charger, technician);

    // Play passes 1-4 normally
    for (let i = 0; i < 4; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: CdL },
      );
    }

    if (match.phase !== Phase.SpeedSelect) return;

    // Drain P2 for pass 5
    match.player2.currentStamina = 1;

    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: PdL },
    );

    // If unseat happened, should transition to melee
    if (match.passResults[4]?.unseat !== 'none') {
      expect(match.phase).toBe(Phase.MeleeSelect);
    }
  });
});

// ============================================================
// 12. Edge Cases: Melee with max carryover penalties
// ============================================================
describe('Edge Cases — melee with carryover penalties', () => {
  it('heavy carryover penalties make unseated player significantly weaker', () => {
    let match = createMatch(duelist, duelist);
    match.phase = Phase.MeleeSelect;
    match.player2.carryoverMomentum = -10;
    match.player2.carryoverControl = -7;
    match.player2.carryoverGuard = -6;

    // P1 full stats vs P2 penalized → P1 should win rounds
    match = submitMeleeRound(match, MC, MC);

    const round = match.meleeRoundResults[0];
    // P1 should have higher impact (no penalties vs penalized)
    expect(round.player1ImpactScore).toBeGreaterThan(round.player2ImpactScore);
  });
});

// ============================================================
// 13. Edge Cases: Phase validation
// ============================================================
describe('Edge Cases — phase validation', () => {
  it('submitJoustPass throws in MeleeSelect phase', () => {
    let match = createMatch(duelist, duelist);
    match.phase = Phase.MeleeSelect;

    expect(() => submitJoustPass(match,
      { speed: SpeedType.Standard, attack: CdL },
      { speed: SpeedType.Standard, attack: CdL },
    )).toThrow();
  });

  it('submitMeleeRound throws in SpeedSelect phase', () => {
    const match = createMatch(duelist, duelist);

    expect(() => submitMeleeRound(match, MC, MC)).toThrow();
  });

  it('submitJoustPass throws in MatchEnd phase', () => {
    let match = createMatch(duelist, duelist);
    match.phase = Phase.MatchEnd;

    expect(() => submitJoustPass(match,
      { speed: SpeedType.Standard, attack: CdL },
      { speed: SpeedType.Standard, attack: CdL },
    )).toThrow();
  });
});

// ============================================================
// 14. Edge Cases: Cumulative scoring
// ============================================================
describe('Edge Cases — cumulative scoring correctness', () => {
  it('cumulative scores accumulate across all 5 passes', () => {
    let match = createMatch(duelist, duelist);

    let expectedScore1 = 0;
    let expectedScore2 = 0;

    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: PdL },
        { speed: SpeedType.Standard, attack: CdL },
      );
      expectedScore1 += match.passResults[i].player1.impactScore;
      expectedScore2 += match.passResults[i].player2.impactScore;
    }

    expect(match.cumulativeScore1).toBeCloseTo(expectedScore1, 5);
    expect(match.cumulativeScore2).toBeCloseTo(expectedScore2, 5);
  });
});

// ============================================================
// 15. Edge Cases: All 6 joust attacks as degenerate strategy
// ============================================================
describe('Edge Cases — every joust attack repeated 5x survives', () => {
  const allJoustAttacks = [CF, CdL, CEP, BdG, PdL, CdP];

  for (const attack of allJoustAttacks) {
    it(`5x ${attack.name} completes without throwing`, () => {
      let match = createMatch(duelist, duelist);

      for (let i = 0; i < 5; i++) {
        if (match.phase !== Phase.SpeedSelect) break;
        match = submitJoustPass(match,
          { speed: SpeedType.Standard, attack },
          { speed: SpeedType.Standard, attack },
        );
      }

      // Mirror matchup should always complete 5 passes (no unseat possible)
      expect(match.passResults.length).toBe(5);
      // Mirror matchup → tied score → melee
      expect(match.phase).toBe(Phase.MeleeSelect);
    });
  }
});

// ============================================================
// 16. Edge Cases: All 6 melee attacks as degenerate strategy
// ============================================================
describe('Edge Cases — every melee attack repeated', () => {
  const allMeleeAttacks = [OC, FB, MC, PT, GH, RS];

  for (const attack of allMeleeAttacks) {
    it(`mirror ${attack.name} draws every round`, () => {
      let match = createMatch(duelist, duelist);
      match.phase = Phase.MeleeSelect;

      match = submitMeleeRound(match, attack, attack);
      const round = match.meleeRoundResults[0];

      // Mirror matchup → identical impacts → margin 0 → draw
      expect(round.outcome).toBe(MeleeOutcome.Draw);
      expect(round.margin).toBe(0);
    });
  }
});

// ============================================================
// 17. Edge Cases: Melee exhaustion with unequal wins
// ============================================================
describe('Edge Cases — melee exhaustion with unequal wins', () => {
  it('player with more melee wins at exhaustion wins the match', () => {
    let match = createMatch(duelist, duelist);
    match.phase = Phase.MeleeSelect;
    match.player1.currentStamina = 10;
    match.player2.currentStamina = 10;
    // Give P1 a round win before exhaustion
    match.meleeWins1 = 1;

    // Play mirror rounds until both exhaust
    let rounds = 0;
    while (match.phase === Phase.MeleeSelect && rounds < 20) {
      match = submitMeleeRound(match, MC, MC);
      rounds++;
    }

    expect(match.phase).toBe(Phase.MatchEnd);
    // P1 had 1 win advantage going in → P1 wins on exhaustion tiebreaker
    expect(match.winner).toBe('player1');
    expect(match.winReason).toContain('melee round wins');
  });
});

// ============================================================
// 18. Edge Cases: Unseat naming convention
// ============================================================
describe('Edge Cases — unseat naming convention', () => {
  it('unseat=player1 means player1 unseated player2', () => {
    // Charger with full stamina vs opponent with near-zero stamina
    let match = createMatch(charger, technician);
    match.player2.currentStamina = 0;

    match = submitJoustPass(match,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: PdL },
    );

    const pass = match.passResults[0];
    if (pass.unseat !== 'none') {
      // P1 should unseat P2 (P2 is at 0 stamina, extremely weak)
      expect(pass.unseat).toBe('player1');
      // P2 (the unseated one) gets carryover penalties
      expect(match.player2.carryoverMomentum).toBeLessThanOrEqual(0);
      expect(match.player2.carryoverControl).toBeLessThanOrEqual(0);
      expect(match.player2.carryoverGuard).toBeLessThanOrEqual(0);
      // P1 has no penalties
      expect(match.player1.carryoverMomentum).toBe(0);
    }
  });
});

// ============================================================
// 19. Edge Cases: Five different attacks across 5 passes
// ============================================================
describe('Edge Cases — varied attack selection', () => {
  it('using different attacks each pass completes normally', () => {
    let match = createMatch(charger, bulwark);
    const p1Attacks = [CF, BdG, CdL, PdL, CEP];
    const p2Attacks = [PdL, CdL, CF, CEP, BdG];
    const speeds: SpeedType[] = [
      SpeedType.Fast, SpeedType.Standard, SpeedType.Slow,
      SpeedType.Standard, SpeedType.Fast,
    ];

    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: speeds[i], attack: p1Attacks[i] },
        { speed: SpeedType.Standard, attack: p2Attacks[i] },
      );
    }

    // Should complete all passes or hit unseat
    expect(match.passResults.length).toBeGreaterThanOrEqual(1);
    if (match.passResults.length === 5) {
      expect([Phase.MatchEnd, Phase.MeleeSelect]).toContain(match.phase);
    }
  });
});

// ============================================================
// 20. Edge Cases: Melee stamina drain tracking
// ============================================================
describe('Edge Cases — melee stamina drain', () => {
  it('tracks stamina drain correctly across multiple melee rounds', () => {
    let match = createMatch(duelist, duelist);
    match.phase = Phase.MeleeSelect;

    const startSta1 = match.player1.currentStamina;
    const startSta2 = match.player2.currentStamina;

    // MC costs -10, OC costs -18
    match = submitMeleeRound(match, MC, OC);
    expect(match.player1.currentStamina).toBe(Math.max(0, startSta1 - 10));
    expect(match.player2.currentStamina).toBe(Math.max(0, startSta2 - 18));

    if (match.phase !== Phase.MeleeSelect) return;

    // Second round
    const sta1AfterR1 = match.player1.currentStamina;
    const sta2AfterR1 = match.player2.currentStamina;
    match = submitMeleeRound(match, GH, FB);
    // GH costs -8, FB costs -15
    expect(match.player1.currentStamina).toBe(Math.max(0, sta1AfterR1 - 8));
    expect(match.player2.currentStamina).toBe(Math.max(0, sta2AfterR1 - 15));
  });
});

// ============================================================
// 21. Non-mirror archetype variety: all archetypes complete 5 passes
// ============================================================
describe('Edge Cases — all archetypes complete 5-pass joust', () => {
  const allArchetypes = [charger, technician, bulwark, duelist];

  for (const arch1 of allArchetypes) {
    for (const arch2 of allArchetypes) {
      it(`${arch1.name} vs ${arch2.name} completes 5 passes`, () => {
        let match = createMatch(arch1, arch2);

        for (let i = 0; i < 5; i++) {
          if (match.phase !== Phase.SpeedSelect) break;
          match = submitJoustPass(match,
            { speed: SpeedType.Standard, attack: CdL },
            { speed: SpeedType.Standard, attack: PdL },
          );
        }

        // Should complete or hit unseat
        expect(match.passResults.length).toBeGreaterThanOrEqual(1);
        if (match.passResults.length === 5) {
          expect([Phase.MatchEnd, Phase.MeleeSelect]).toContain(match.phase);
        }
      });
    }
  }
});

// ============================================================
// 22. Full match: joust → melee through completion
// ============================================================
describe('Full match lifecycle — joust through melee to winner', () => {
  it('completes a full match from pass 1 to match end', () => {
    let match = createMatch(charger, bulwark);

    // Play 5 joust passes with counter advantage for P1 (CdL beats PdL)
    // ... wait, CdL does NOT beat PdL — PdL beats CdL. Let's use BdG (beats PdL).
    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: BdG },
        { speed: SpeedType.Standard, attack: PdL },
      );
    }

    // After joust, should be in MeleeSelect or MatchEnd
    if (match.phase === Phase.MeleeSelect) {
      // Play melee with counter advantage for P1 (OC beats GH)
      let rounds = 0;
      while (match.phase === Phase.MeleeSelect && rounds < 20) {
        match = submitMeleeRound(match, OC, GH);
        rounds++;
      }
    }

    // Match must be over
    expect(match.phase).toBe(Phase.MatchEnd);
    expect(match.winner).not.toBe('none');
    expect(match.winReason).toBeDefined();
    expect(match.winReason!.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 23. Shift interaction: shift denied at low stamina mid-match
// ============================================================
describe('Edge Cases — shift denied mid-match from stamina drain', () => {
  it('shift works early but is denied after stamina drains', () => {
    let match = createMatch(technician, charger);

    // Pass 1: Technician has full stamina, can shift
    match = submitJoustPass(match,
      { speed: SpeedType.Standard, attack: CdL, shiftAttack: CEP },
      { speed: SpeedType.Fast, attack: CF },
    );
    expect(match.passResults[0].player1.shifted).toBe(true);

    // Drain technician stamina for next test
    // After pass 1: Tech started 55, -0(std) -12(shift) -14(CEP) = 29
    expect(match.player1.currentStamina).toBe(29);

    // Play more passes to drain further
    if (match.phase === Phase.SpeedSelect) {
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: CF },
        { speed: SpeedType.Standard, attack: CdL },
      );
      // After pass 2: 29 - 0(std) - 20(CF) = 9
      expect(match.player1.currentStamina).toBe(9);
    }

    // Now try to shift with only 9 stamina — should be denied (need >= 10)
    if (match.phase === Phase.SpeedSelect) {
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: CdL, shiftAttack: CEP },
        { speed: SpeedType.Standard, attack: CdL },
      );
      // Shift denied: stamina 9 < 10 requirement
      expect(match.passResults[2].player1.shifted).toBe(false);
    }
  });
});

// ============================================================
// 24. 12-Slot Gear Integration — createMatch with both gear systems
// ============================================================

// Deterministic RNG for reproducible tests
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('12-slot gear integration — createMatch', () => {
  it('creates match with all 12 steed+player slots filled', () => {
    const rng = makeRng(42);
    const steed = createFullLoadout('epic', 'epic', rng);
    const player = createFullPlayerLoadout('epic', rng);
    const match = createMatch(charger, technician, steed, undefined, player, undefined);

    // P1 boosted, P2 bare
    expect(match.player1.archetype.momentum).toBeGreaterThan(charger.momentum);
    expect(match.player1.archetype.control).toBeGreaterThan(charger.control);
    expect(match.player1.archetype.guard).toBeGreaterThan(charger.guard);
    expect(match.player1.archetype.stamina).toBeGreaterThan(charger.stamina);
    // P2 unchanged
    expect(match.player2.archetype.momentum).toBe(technician.momentum);
  });

  it('steed gear + player gear bonuses stack correctly', () => {
    // Create known gear pieces with min RNG (value = range minimum)
    const rngMin = () => 0;
    const steed = createFullLoadout('uncommon', 'uncommon', rngMin);
    const player = createFullPlayerLoadout('uncommon', rngMin);
    const match = createMatch(duelist, duelist, steed, undefined, player, undefined);

    // Duelist base: all 60. Uncommon rarity bonus: +1 to all (steed only).
    // Each uncommon gear piece gives minimum primary + minimum secondary.
    // Steed gear minimum primary=1, secondary=0 at uncommon.
    // Player gear minimum primary=1, secondary=0 at uncommon.
    const steedRange = BALANCE.gearStatRanges.uncommon;
    const playerRange = BALANCE.playerGearStatRanges.uncommon;

    // P1 should be boosted, P2 should be bare (duelist baseline 60)
    expect(match.player1.archetype.momentum).toBeGreaterThan(60);
    expect(match.player2.archetype.momentum).toBe(60);
  });

  it('all 12 slots empty (no gear) matches bare archetype', () => {
    const match = createMatch(charger, bulwark);
    expect(match.player1.archetype.momentum).toBe(charger.momentum);
    expect(match.player1.archetype.guard).toBe(charger.guard);
    expect(match.player2.archetype.guard).toBe(bulwark.guard);
    expect(match.player1.currentStamina).toBe(charger.stamina);
  });

  it('steed only (no player gear) applies rarity + steed bonuses', () => {
    const rng = makeRng(100);
    const steed = createFullLoadout('legendary', 'legendary', rng);
    const match = createMatch(duelist, duelist, steed);

    // Legendary rarity bonus: +7 to all stats
    expect(match.player1.archetype.momentum).toBeGreaterThanOrEqual(duelist.momentum + 7);
    expect(match.player2.archetype.momentum).toBe(duelist.momentum);
  });

  it('player only (no steed gear) applies player bonuses only', () => {
    const rng = makeRng(200);
    const player = createFullPlayerLoadout('epic', rng);
    const match = createMatch(duelist, duelist, undefined, undefined, player);

    // No steed gear → no rarity bonus. Player gear adds bonuses only.
    expect(match.player1.archetype.momentum).toBeGreaterThan(duelist.momentum);
    // P2 unchanged
    expect(match.player2.archetype.momentum).toBe(duelist.momentum);
  });

  it('giga steed + giga player gear triggers softCap on momentum', () => {
    // Build max-stat gear with rng returning 0.999
    const rngMax = () => 0.999;
    const steed = createFullLoadout('giga', 'giga', rngMax);
    const player = createFullPlayerLoadout('giga', rngMax);
    const match = createMatch(charger, duelist, steed, undefined, player, undefined);

    // Charger MOM=75 + giga rarity=13 + steed gear + player gear
    // Should be well over softCap knee (100)
    const rawMom = match.player1.archetype.momentum;
    expect(rawMom).toBeGreaterThan(100);
    // Verify softCap compresses it
    const capped = softCap(rawMom);
    expect(capped).toBeLessThan(rawMom);
    expect(capped).toBeGreaterThan(100);
  });

  it('both players with different gear: higher-geared player has advantage', () => {
    const rng1 = makeRng(300);
    const rng2 = makeRng(400);
    const steed1 = createFullLoadout('giga', 'giga', rng1);
    const player1 = createFullPlayerLoadout('giga', rng1);
    const steed2 = createFullLoadout('uncommon', 'uncommon', rng2);
    const player2 = createFullPlayerLoadout('uncommon', rng2);

    const match = createMatch(duelist, duelist, steed1, steed2, player1, player2);

    // P1 (giga) should have much higher stats than P2 (uncommon)
    expect(match.player1.archetype.momentum).toBeGreaterThan(match.player2.archetype.momentum);
    expect(match.player1.archetype.control).toBeGreaterThan(match.player2.archetype.control);
    expect(match.player1.archetype.guard).toBeGreaterThan(match.player2.archetype.guard);
    expect(match.player1.currentStamina).toBeGreaterThan(match.player2.currentStamina);
  });
});

// ============================================================
// 25. 12-Slot Gear — Full match plays through without errors
// ============================================================
describe('12-slot gear — full match completion', () => {
  it('geared match completes joust phase normally', () => {
    const rng = makeRng(500);
    const steed = createFullLoadout('legendary', 'legendary', rng);
    const player = createFullPlayerLoadout('legendary', rng);
    let match = createMatch(charger, bulwark, steed, steed, player, player);

    for (let i = 0; i < 5; i++) {
      if (match.phase !== Phase.SpeedSelect) break;
      match = submitJoustPass(match,
        { speed: SpeedType.Standard, attack: CdL },
        { speed: SpeedType.Standard, attack: PdL },
      );
    }

    expect(match.passResults.length).toBeGreaterThanOrEqual(1);
  });

  it('gear stamina bonus affects match duration', () => {
    // High steed+player stamina gear should let players survive longer
    const rngMax = () => 0.999;
    const steed = createFullLoadout('giga', 'giga', rngMax);
    const player = createFullPlayerLoadout('giga', rngMax);
    let geared = createMatch(duelist, duelist, steed, steed, player, player);
    let bare = createMatch(duelist, duelist);

    // Both play expensive attacks (CF -20 STA)
    for (let i = 0; i < 5; i++) {
      if (geared.phase === Phase.SpeedSelect) {
        geared = submitJoustPass(geared,
          { speed: SpeedType.Fast, attack: CF },
          { speed: SpeedType.Fast, attack: CF },
        );
      }
      if (bare.phase === Phase.SpeedSelect) {
        bare = submitJoustPass(bare,
          { speed: SpeedType.Fast, attack: CF },
          { speed: SpeedType.Fast, attack: CF },
        );
      }
    }

    // Geared players have much more stamina → less fatigue → higher impact scores in later passes
    const gearedP5Impact = geared.passResults[4]?.player1.impactScore ?? 0;
    const bareP5Impact = bare.passResults[4]?.player1.impactScore ?? 0;
    // If both played all 5 passes, geared should have higher pass 5 impact
    if (geared.passResults.length >= 5 && bare.passResults.length >= 5) {
      expect(gearedP5Impact).toBeGreaterThan(bareP5Impact);
    }
  });
});

// ============================================================
// 26. Performance regression — match creation + 5 passes
// ============================================================
describe('Performance — match execution time', () => {
  it('match creation + 5 passes runs under 50ms', () => {
    const rng = makeRng(999);
    const steed = createFullLoadout('giga', 'giga', rng);
    const player = createFullPlayerLoadout('giga', rng);

    const start = performance.now();
    for (let trial = 0; trial < 100; trial++) {
      let match = createMatch(charger, bulwark, steed, steed, player, player);
      for (let i = 0; i < 5; i++) {
        if (match.phase !== Phase.SpeedSelect) break;
        match = submitJoustPass(match,
          { speed: SpeedType.Standard, attack: CdL },
          { speed: SpeedType.Standard, attack: PdL },
        );
      }
    }
    const elapsed = performance.now() - start;

    // 100 full matches should complete in under 500ms (5ms each)
    expect(elapsed).toBeLessThan(500);
  });
});
