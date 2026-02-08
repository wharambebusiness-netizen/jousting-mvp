// ============================================================
// Phase Resolution Tests (post-caparison strip)
// Validates that joust and melee phase resolution works
// correctly without any caparison parameters.
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveJoustPass } from './phase-joust';
import { resolveMeleeRoundFn } from './phase-melee';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS } from './attacks';
import {
  SpeedType,
  type PlayerState,
  type PassChoice,
} from './types';

// --- Helpers ---

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

const CF = JOUST_ATTACKS.coupFort;       // Aggressive
const CDL = JOUST_ATTACKS.courseDeLance; // Balanced
const PDL = JOUST_ATTACKS.portDeLance;   // Defensive

const OC = MELEE_ATTACKS.overhandCleave;    // Aggressive
const MC = MELEE_ATTACKS.measuredCut;       // Balanced
const GH = MELEE_ATTACKS.guardHigh;         // Defensive

// ============================================================
// 1. Joust pass resolution — basic sanity
// ============================================================
describe('resolveJoustPass (no caparison)', () => {
  it('returns valid result with positive stats', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');
    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, p1, p2, choice, choice);

    expect(result.passNumber).toBe(1);
    expect(result.player1.effectiveStats.momentum).toBeGreaterThan(0);
    expect(result.player2.effectiveStats.momentum).toBeGreaterThan(0);
    expect(result.player1.impactScore).toBeGreaterThan(0);
    expect(result.player2.impactScore).toBeGreaterThan(0);
    expect(result.log.length).toBeGreaterThan(0);
  });

  it('no banner fields on PassResult', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');
    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, p1, p2, choice, choice);

    // PassResult should not have banner fields anymore
    expect('p1BannerConsumed' in result).toBe(false);
    expect('p2BannerConsumed' in result).toBe(false);
  });

  it('handles different archetypes correctly', () => {
    const charger = makePlayerState('charger');
    const bulwark = makePlayerState('bulwark');

    const choice1: PassChoice = { speed: SpeedType.Fast, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Slow, attack: PDL };

    const result = resolveJoustPass(1, charger, bulwark, choice1, choice2);

    // Charger with Fast+CF should have much higher momentum
    expect(result.player1.effectiveStats.momentum)
      .toBeGreaterThan(result.player2.effectiveStats.momentum);
    // Bulwark should have higher guard
    expect(result.player2.effectiveStats.guard)
      .toBeGreaterThan(result.player1.effectiveStats.guard);
  });

  it('resolves across multiple passes without error', () => {
    const p1 = makePlayerState('technician');
    const p2 = makePlayerState('tactician');

    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    // Pass 1
    const r1 = resolveJoustPass(1, p1, p2, choice, choice);
    // Pass 2 with reduced stamina
    const p1After = { ...p1, currentStamina: r1.player1.staminaAfter };
    const p2After = { ...p2, currentStamina: r1.player2.staminaAfter };
    const r2 = resolveJoustPass(2, p1After, p2After, choice, choice);

    expect(r2.passNumber).toBe(2);
    expect(r2.player1.staminaAfter).toBeLessThan(r1.player1.staminaAfter);
  });

  it('counter system works without caparison', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');

    // CF beats PDL → P1 should get counter bonus
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: PDL };

    const withCounter = resolveJoustPass(1, p1, p2, choice1, choice2);

    // No counter: same attack
    const noCounter = resolveJoustPass(1, p1, p2, choice1, choice1);

    // P1 should have higher accuracy with counter
    expect(withCounter.player1.accuracy).toBeGreaterThan(noCounter.player1.accuracy);
  });

  it('shift works without caparison', () => {
    const tech = makePlayerState('technician');
    const opp = makePlayerState('duelist');

    const choice1: PassChoice = {
      speed: SpeedType.Standard,
      attack: CDL,
      shiftAttack: PDL,
    };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, tech, opp, choice1, choice2);

    // Technician (CTL 70) should be able to shift at Standard threshold
    expect(result.player1.shifted).toBe(true);
    expect(result.player1.finalAttack.id).toBe('portDeLance');
  });
});

// ============================================================
// 2. Melee round resolution — basic sanity
// ============================================================
describe('resolveMeleeRoundFn (no caparison)', () => {
  it('returns valid result with positive stats', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');

    const result = resolveMeleeRoundFn(1, p1, p2, MC, MC);

    expect(result.roundNumber).toBe(1);
    expect(result.player1ImpactScore).toBeGreaterThan(0);
    expect(result.player2ImpactScore).toBeGreaterThan(0);
    expect(result.log.length).toBeGreaterThan(0);
  });

  it('no banner fields on MeleeRoundResult', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');

    const result = resolveMeleeRoundFn(1, p1, p2, MC, MC);

    expect('p1BannerConsumed' in result).toBe(false);
    expect('p2BannerConsumed' in result).toBe(false);
  });

  it('counter system works in melee', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');

    // OC beats GH → P1 gets counter bonus
    const withCounter = resolveMeleeRoundFn(1, p1, p2, OC, GH);
    const noCounter = resolveMeleeRoundFn(1, p1, p2, OC, OC);

    expect(withCounter.player1ImpactScore).toBeGreaterThan(noCounter.player1ImpactScore);
  });

  it('carryover penalties reduce effective stats', () => {
    const normal = makePlayerState('duelist');
    const penalized: PlayerState = {
      ...normal,
      carryoverMomentum: -5,
      carryoverControl: -4,
      carryoverGuard: -3,
    };

    const normalResult = resolveMeleeRoundFn(1, normal, normal, MC, MC);
    const penalizedResult = resolveMeleeRoundFn(1, penalized, normal, MC, MC);

    expect(penalizedResult.player1ImpactScore).toBeLessThan(normalResult.player1ImpactScore);
  });
});

// ============================================================
// 3. Double shift priority
// ============================================================
describe('Double shift priority (no caparison)', () => {
  it('higher initiative player shifts second (advantage)', () => {
    const tact = makePlayerState('tactician');  // INIT 75
    const duel = makePlayerState('duelist');     // INIT 60

    const choice1: PassChoice = {
      speed: SpeedType.Slow,
      attack: CDL,
      shiftAttack: JOUST_ATTACKS.coupEnPassant,
    };
    const choice2: PassChoice = {
      speed: SpeedType.Slow,
      attack: CDL,
      shiftAttack: PDL,
    };

    const result = resolveJoustPass(1, tact, duel, choice1, choice2);

    expect(result.player1.shifted).toBe(true);
    expect(result.player2.shifted).toBe(true);

    const priorityLog = result.log.find(l => l.includes('Initiative advantage'));
    expect(priorityLog).toBeDefined();
    expect(priorityLog).toContain('P1');
  });
});
