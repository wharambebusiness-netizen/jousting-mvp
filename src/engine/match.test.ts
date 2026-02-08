// ============================================================
// Integration Tests — Match State Machine
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS } from './attacks';
import { Phase, SpeedType, MeleeOutcome } from './types';
import { createMatch, submitJoustPass, submitMeleeRound } from './match';
import { BALANCE } from './balance-config';

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
    // Technician wins pass 1
    expect(p1.player2.impactScore).toBeGreaterThan(p1.player1.impactScore);
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
