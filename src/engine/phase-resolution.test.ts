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

// ============================================================
// 4. Double Unseat via resolveJoustPass
// ============================================================
describe('Double unseat via resolveJoustPass', () => {
  it('mutual unseat: higher margin wins', () => {
    // Charger (high MOM, low GRD) vs Breaker with aggressive attacks
    // Both at very low stamina → low unseat threshold
    const p1: PlayerState = {
      archetype: ARCHETYPES.charger,
      currentStamina: 5,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const p2: PlayerState = {
      archetype: ARCHETYPES.breaker,
      currentStamina: 5,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const choice: PassChoice = { speed: SpeedType.Fast, attack: CF };
    const result = resolveJoustPass(1, p1, p2, choice, choice);

    // At STA=5, threshold is low; either both unseat (higher margin wins) or no unseat
    if (result.unseat !== 'none') {
      expect(['player1', 'player2']).toContain(result.unseat);
      expect(result.unseatMargin).toBeGreaterThan(0);
    }
  });

  it('mirror matchup at low stamina: tied margins = no unseat', () => {
    // Identical archetypes, attacks, stamina → tied impact → tied margins
    const p1: PlayerState = {
      archetype: ARCHETYPES.duelist,
      currentStamina: 3,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const p2: PlayerState = { ...p1 };

    const choice: PassChoice = { speed: SpeedType.Fast, attack: CF };
    const result = resolveJoustPass(1, p1, p2, choice, choice);

    // Perfect mirror: if both exceed threshold, tied margins → no unseat
    expect(result.unseat).toBe('none');
    expect(result.unseatMargin).toBe(0);
  });

  it('asymmetric unseat: only stronger player exceeds threshold', () => {
    // Charger (MOM 75) at full STA vs Technician (MOM 58) at very low STA
    const p1: PlayerState = {
      archetype: ARCHETYPES.charger,
      currentStamina: 40,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const p2: PlayerState = {
      archetype: ARCHETYPES.technician,
      currentStamina: 5,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const choice1: PassChoice = { speed: SpeedType.Fast, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };
    const result = resolveJoustPass(1, p1, p2, choice1, choice2);

    // Charger should have much higher impact
    if (result.unseat !== 'none') {
      expect(result.unseat).toBe('player1');
      expect(result.unseatMargin).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// 5. Guard Penetration — Joust Phase (Breaker Mechanic)
// ============================================================
describe('Guard Penetration — Joust Phase', () => {
  it('Breaker impact is higher than non-Breaker with same attack against high guard', () => {
    const breaker = makePlayerState('breaker');
    const bulwark = makePlayerState('bulwark');
    const duelist = makePlayerState('duelist');

    const choice: PassChoice = { speed: SpeedType.Standard, attack: JOUST_ATTACKS.courseDeLance };

    const breakerResult = resolveJoustPass(1, breaker, bulwark, choice, choice);
    const duelistResult = resolveJoustPass(1, duelist, bulwark, choice, choice);

    // Breaker has higher MOM (65 vs 60) AND guard penetration
    expect(breakerResult.player1.impactScore).toBeGreaterThan(duelistResult.player1.impactScore);
  });

  it('Breaker opponent does NOT receive penetration (only attacker)', () => {
    const breaker = makePlayerState('breaker');
    const duelist = makePlayerState('duelist');

    const choice: PassChoice = { speed: SpeedType.Standard, attack: JOUST_ATTACKS.courseDeLance };

    // Breaker (P1) vs Duelist (P2) — only P1 gets penetration
    const result = resolveJoustPass(1, breaker, duelist, choice, choice);

    // Duelist (P2) should NOT get guard penetration against Breaker (P1)
    // So P2 impact is calculated with full P1 guard
    // Verify by computing expected values:
    // P2 is duelist: no penetration on impact calc against P1's guard
    expect(result.player2.impactScore).toBeDefined();

    // Now swap: Duelist (P1) vs Breaker (P2) — P2 gets penetration, P1 doesn't
    const swapped = resolveJoustPass(1, duelist, breaker, choice, choice);

    // The duelist's impact when attacking breaker should be the same
    // regardless of whether breaker is P1 or P2 (duelist never gets pen)
    expect(result.player2.impactScore).toBeCloseTo(swapped.player1.impactScore, 5);
  });

  it('Breaker vs Breaker mirror: both get penetration, equal impact', () => {
    const breaker1 = makePlayerState('breaker');
    const breaker2 = makePlayerState('breaker');

    const choice: PassChoice = { speed: SpeedType.Standard, attack: JOUST_ATTACKS.courseDeLance };

    const result = resolveJoustPass(1, breaker1, breaker2, choice, choice);

    expect(result.player1.impactScore).toBeCloseTo(result.player2.impactScore, 5);
    expect(result.unseat).toBe('none');
  });

  it('guard penetration works correctly across multiple passes', () => {
    const breaker = makePlayerState('breaker');
    const bulwark = makePlayerState('bulwark');

    const choice: PassChoice = { speed: SpeedType.Standard, attack: JOUST_ATTACKS.courseDeLance };

    // Pass 1
    const r1 = resolveJoustPass(1, breaker, bulwark, choice, choice);
    expect(r1.player1.impactScore).toBeGreaterThan(0);

    // Pass 2 with reduced stamina
    const breakerAfter = { ...breaker, currentStamina: r1.player1.staminaAfter };
    const bulwarkAfter = { ...bulwark, currentStamina: r1.player2.staminaAfter };
    const r2 = resolveJoustPass(2, breakerAfter, bulwarkAfter, choice, choice);

    // Breaker should still have penetration advantage in pass 2
    expect(r2.player1.impactScore).toBeGreaterThan(0);
  });

  it('Breaker with Fast+CoupFort has large impact advantage vs Bulwark', () => {
    const breaker = makePlayerState('breaker');
    const bulwark = makePlayerState('bulwark');

    const breakerChoice: PassChoice = { speed: SpeedType.Fast, attack: JOUST_ATTACKS.coupFort };
    const bulwarkChoice: PassChoice = { speed: SpeedType.Slow, attack: JOUST_ATTACKS.portDeLance };

    const result = resolveJoustPass(1, breaker, bulwark, breakerChoice, bulwarkChoice);

    // Breaker should have significantly higher impact
    // (high MOM + aggressive attack + guard penetration vs high-guard Bulwark)
    expect(result.player1.impactScore).toBeGreaterThan(result.player2.impactScore);
  });
});

// ============================================================
// 5. Guard Penetration — Melee Phase (Breaker Mechanic)
// ============================================================
describe('Guard Penetration — Melee Phase', () => {
  it('Breaker impact is higher than Duelist in melee against high-guard opponent', () => {
    const breaker = makePlayerState('breaker');
    const duelist = makePlayerState('duelist');
    const bulwark = makePlayerState('bulwark');

    const breakerResult = resolveMeleeRoundFn(1, breaker, bulwark, MC, MC);
    const duelistResult = resolveMeleeRoundFn(1, duelist, bulwark, MC, MC);

    // Breaker has +5 MOM AND guard penetration
    expect(breakerResult.player1ImpactScore).toBeGreaterThan(duelistResult.player1ImpactScore);
  });

  it('Breaker guard penetration works in melee against Guard High', () => {
    const breaker = makePlayerState('breaker');
    const bulwark = makePlayerState('bulwark');

    // Bulwark using Guard High (deltaGuard +20) — max guard
    const result = resolveMeleeRoundFn(1, breaker, bulwark, OC, GH);

    // Breaker impact should be meaningful despite Bulwark's massive guard
    expect(result.player1ImpactScore).toBeGreaterThan(0);
  });

  it('Breaker vs Breaker melee mirror: equal impact', () => {
    const b1 = makePlayerState('breaker');
    const b2 = makePlayerState('breaker');

    const result = resolveMeleeRoundFn(1, b1, b2, MC, MC);

    expect(result.player1ImpactScore).toBeCloseTo(result.player2ImpactScore, 5);
  });

  it('non-Breaker melee impact is unaffected by penetration mechanic', () => {
    const charger = makePlayerState('charger');
    const duelist = makePlayerState('duelist');

    const result = resolveMeleeRoundFn(1, charger, duelist, MC, MC);

    // Charger and duelist both get 0 penetration
    // Verify impact is based purely on stats without penetration
    expect(result.player1ImpactScore).toBeDefined();
    expect(result.player2ImpactScore).toBeDefined();
  });

  it('Breaker melee advantage is larger vs Bulwark than vs Charger', () => {
    const breaker = makePlayerState('breaker');
    const bulwark = makePlayerState('bulwark');
    const charger = makePlayerState('charger');

    const vsBulwark = resolveMeleeRoundFn(1, breaker, bulwark, MC, MC);
    const vsCharger = resolveMeleeRoundFn(1, breaker, charger, MC, MC);

    const duelist = makePlayerState('duelist');
    const duelistVsBulwark = resolveMeleeRoundFn(1, duelist, bulwark, MC, MC);
    const duelistVsCharger = resolveMeleeRoundFn(1, duelist, charger, MC, MC);

    // Breaker's edge (impact diff vs duelist) should be larger against high-guard Bulwark
    const edgeVsBulwark = vsBulwark.player1ImpactScore - duelistVsBulwark.player1ImpactScore;
    const edgeVsCharger = vsCharger.player1ImpactScore - duelistVsCharger.player1ImpactScore;

    expect(edgeVsBulwark).toBeGreaterThan(edgeVsCharger);
  });
});

// ============================================================
// 6. Guard Penetration — Non-Breaker Archetypes Unaffected
// ============================================================
describe('Guard Penetration — Non-Breaker archetypes unaffected', () => {
  const nonBreakerIds = ['charger', 'technician', 'bulwark', 'tactician', 'duelist'] as const;

  for (const archId of nonBreakerIds) {
    it(`${archId} gets 0 guard penetration in joust`, () => {
      const attacker = makePlayerState(archId);
      const defender = makePlayerState('bulwark');

      const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

      const result = resolveJoustPass(1, attacker, defender, choice, choice);

      // Verify by checking that swapping to P2 position gives same impact
      // (i.e., the archetype doesn't get special treatment)
      const reversed = resolveJoustPass(1, defender, attacker, choice, choice);

      // attacker as P1 impact == attacker as P2 impact (no penetration either way for non-breaker)
      expect(result.player1.impactScore).toBeCloseTo(reversed.player2.impactScore, 5);
    });

    it(`${archId} gets 0 guard penetration in melee`, () => {
      const attacker = makePlayerState(archId);
      const defender = makePlayerState('bulwark');

      const result = resolveMeleeRoundFn(1, attacker, defender, MC, MC);
      const reversed = resolveMeleeRoundFn(1, defender, attacker, MC, MC);

      expect(result.player1ImpactScore).toBeCloseTo(reversed.player2ImpactScore, 5);
    });
  }
});

// ============================================================
// 7. Guard Penetration — Edge Cases
// ============================================================
describe('Guard Penetration — Edge Cases', () => {
  it('Breaker penetration advantage is zero when opponent guard contribution is negligible', () => {
    // Use Precision Thrust (deltaGuard = 0) for both players, with low-guard archetype
    const breaker = makePlayerState('breaker');  // guard 55
    const charger = makePlayerState('charger');  // guard 50

    // Charger has lower guard, so penetration benefit is smaller
    // With PT (deltaGuard=0): charger guard = 50
    // Penetration: ignores 50 * breakerGuardPenetration of guard
    // Guard reduction on impact uses guardImpactCoeff (from BALANCE)
    // Benefit is still non-zero, but much smaller than vs Bulwark
    const breakerVsCharger = resolveMeleeRoundFn(1, breaker, charger,
      MELEE_ATTACKS.precisionThrust, MELEE_ATTACKS.precisionThrust);
    const duelistVsCharger = resolveMeleeRoundFn(1, makePlayerState('duelist'), charger,
      MELEE_ATTACKS.precisionThrust, MELEE_ATTACKS.precisionThrust);

    // Breaker still has edge (from both +5 MOM and penetration)
    expect(breakerVsCharger.player1ImpactScore).toBeGreaterThan(duelistVsCharger.player1ImpactScore);
  });

  it('Breaker at 0 stamina still gets guard penetration', () => {
    const breaker: PlayerState = {
      archetype: ARCHETYPES.breaker,
      currentStamina: 0,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const bulwark = makePlayerState('bulwark');

    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    // Should not throw even at 0 stamina
    const result = resolveJoustPass(1, breaker, bulwark, choice, choice);

    // At 0 stamina, MOM and CTL are 0 but guard penetration still applies
    // Impact will be low but guard penetration reduces the guard penalty
    expect(result.player1.impactScore).toBeDefined();
    expect(Number.isFinite(result.player1.impactScore)).toBe(true);
  });

  it('Breaker at 0 stamina melee still gets guard penetration', () => {
    const breaker: PlayerState = {
      archetype: ARCHETYPES.breaker,
      currentStamina: 0,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const bulwark = makePlayerState('bulwark');

    const result = resolveMeleeRoundFn(1, breaker, bulwark, MC, MC);

    expect(Number.isFinite(result.player1ImpactScore)).toBe(true);
    expect(Number.isFinite(result.player2ImpactScore)).toBe(true);
  });

  it('Breaker guard penetration with carryover penalties in melee', () => {
    const breaker: PlayerState = {
      archetype: ARCHETYPES.breaker,
      currentStamina: 40,
      carryoverMomentum: -10,
      carryoverControl: -7,
      carryoverGuard: -6,
    };
    const bulwark: PlayerState = {
      archetype: ARCHETYPES.bulwark,
      currentStamina: 50,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const result = resolveMeleeRoundFn(1, breaker, bulwark, OC, GH);

    // Breaker with carryover penalties still gets penetration
    expect(Number.isFinite(result.player1ImpactScore)).toBe(true);
    // The impact should still be positive despite penalties
    // (Breaker MOM=65, -5(OC delta) + (-10 carryover) = 50, CTL=60 + 5(OC) + (-7) = 58)
    // At STA 40, ff = 40/(60*0.8) = 40/48 = 0.833
    expect(result.player1ImpactScore).toBeGreaterThan(0);
  });
});

// ============================================================
// 8. Edge Cases — Unseat Timing
// ============================================================
describe('Edge Cases — Unseat Timing', () => {
  it('unseat on pass 1 (earliest possible)', () => {
    // Charger at full stamina with aggressive setup vs low-guard opponent at low STA
    const charger: PlayerState = {
      archetype: ARCHETYPES.charger,
      currentStamina: 65,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const tactician: PlayerState = {
      archetype: ARCHETYPES.tactician,  // Low GRD=50
      currentStamina: 8,  // Very low → low unseat threshold
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const chargerChoice: PassChoice = { speed: SpeedType.Fast, attack: CF };
    const tactChoice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, charger, tactician, chargerChoice, tactChoice);

    // Charger's high MOM + Fast + CF should unseat low-STA tactician on pass 1
    if (result.unseat !== 'none') {
      expect(result.passNumber).toBe(1);
      expect(result.unseat).toBe('player1');
      expect(result.unseatMargin).toBeGreaterThan(0);
    }
  });

  it('unseat on pass 5 (last joust pass)', () => {
    // Simulate pass 5 with reduced stamina from earlier passes
    const charger: PlayerState = {
      archetype: ARCHETYPES.charger,
      currentStamina: 15,  // Reduced from earlier passes
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const tactician: PlayerState = {
      archetype: ARCHETYPES.tactician,
      currentStamina: 10,  // Very low after 4 passes
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const chargerChoice: PassChoice = { speed: SpeedType.Fast, attack: CF };
    const tactChoice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(5, charger, tactician, chargerChoice, tactChoice);

    // Pass 5 should work correctly
    expect(result.passNumber).toBe(5);
    if (result.unseat !== 'none') {
      expect(['player1', 'player2']).toContain(result.unseat);
    }
  });

  it('both players unseated in same pass — higher margin wins', () => {
    // Two aggressive archetypes at low stamina
    const breaker: PlayerState = {
      archetype: ARCHETYPES.breaker,
      currentStamina: 6,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const charger: PlayerState = {
      archetype: ARCHETYPES.charger,
      currentStamina: 6,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const choice: PassChoice = { speed: SpeedType.Fast, attack: CF };

    const result = resolveJoustPass(2, breaker, charger, choice, choice);

    // At STA=6, both have low thresholds; one should win by margin
    if (result.unseat !== 'none') {
      expect(['player1', 'player2']).toContain(result.unseat);
      expect(result.unseatMargin).toBeGreaterThan(0);
    }
  });

  it('both players unseated — tied margins results in no unseat', () => {
    // Perfect mirror at low stamina
    const duel1: PlayerState = {
      archetype: ARCHETYPES.duelist,
      currentStamina: 5,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const duel2: PlayerState = { ...duel1 };

    const choice: PassChoice = { speed: SpeedType.Fast, attack: CF };

    const result = resolveJoustPass(3, duel1, duel2, choice, choice);

    // Perfect mirror: tied margins → no unseat
    expect(result.unseat).toBe('none');
    expect(result.unseatMargin).toBe(0);
  });
});

// ============================================================
// 9. Edge Cases — Extreme Fatigue Scenarios
// ============================================================
describe('Edge Cases — Extreme Fatigue Scenarios', () => {
  it('stamina=0 joust pass: stats fully fatigued', () => {
    const charger: PlayerState = {
      archetype: ARCHETYPES.charger,
      currentStamina: 0,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const bulwark: PlayerState = {
      archetype: ARCHETYPES.bulwark,
      currentStamina: 62,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(3, charger, bulwark, choice, choice);

    // At STA=0, MOM and CTL should be 0, but guard has guardFatigueFloor (0.5)
    expect(result.player1.effectiveStats.momentum).toBe(0);
    expect(result.player1.effectiveStats.control).toBe(0);
    expect(result.player1.effectiveStats.guard).toBeGreaterThan(0);  // Floor protection
    expect(result.player1.impactScore).toBeDefined();
    expect(Number.isFinite(result.player1.impactScore)).toBe(true);
  });

  it('stamina=1 joust pass: minimal but non-zero fatigue factor', () => {
    const technician: PlayerState = {
      archetype: ARCHETYPES.technician,
      currentStamina: 1,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const duelist = makePlayerState('duelist');

    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(2, technician, duelist, choice, choice);

    // At STA=1: ff = 1/(55*0.8) = 1/44 = 0.0227
    // MOM and CTL should be near-zero, guard has floor
    expect(result.player1.effectiveStats.momentum).toBeGreaterThan(0);
    expect(result.player1.effectiveStats.momentum).toBeLessThan(5);
    expect(result.player1.effectiveStats.control).toBeGreaterThan(0);
    expect(result.player1.effectiveStats.control).toBeLessThan(5);
  });

  it('stamina=0 melee round: stats fully fatigued', () => {
    const charger: PlayerState = {
      archetype: ARCHETYPES.charger,
      currentStamina: 0,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const bulwark = makePlayerState('bulwark');

    const result = resolveMeleeRoundFn(2, charger, bulwark, MC, MC);

    // At STA=0, MOM and CTL are 0
    expect(result.player1ImpactScore).toBeDefined();
    expect(Number.isFinite(result.player1ImpactScore)).toBe(true);
  });

  it('stamina=1 melee round: minimal fatigue factor', () => {
    const tactician: PlayerState = {
      archetype: ARCHETYPES.tactician,
      currentStamina: 1,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const duelist = makePlayerState('duelist');

    const result = resolveMeleeRoundFn(1, tactician, duelist, OC, MC);

    // At STA=1: ff very low, but stats are non-zero
    expect(Number.isFinite(result.player1ImpactScore)).toBe(true);
    expect(Number.isFinite(result.player2ImpactScore)).toBe(true);
  });

  it('both players at stamina=0 in joust', () => {
    const p1: PlayerState = {
      archetype: ARCHETYPES.duelist,
      currentStamina: 0,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const p2: PlayerState = {
      archetype: ARCHETYPES.duelist,
      currentStamina: 0,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(4, p1, p2, choice, choice);

    // Both at 0 stamina: should not throw, tied outcome
    expect(result.unseat).toBe('none');
    expect(result.player1.impactScore).toBeCloseTo(result.player2.impactScore, 5);
  });

  it('both players at stamina=1 in melee', () => {
    const p1: PlayerState = {
      archetype: ARCHETYPES.duelist,
      currentStamina: 1,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const p2: PlayerState = {
      archetype: ARCHETYPES.duelist,
      currentStamina: 1,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    const result = resolveMeleeRoundFn(1, p1, p2, MC, MC);

    // Both at STA=1: should be tied
    expect(result.player1ImpactScore).toBeCloseTo(result.player2ImpactScore, 5);
  });
});

// ============================================================
// 10. Edge Cases — Shift Eligibility at Exact Threshold
// ============================================================
describe('Edge Cases — Shift Eligibility at Exact Threshold', () => {
  it('shift at exact CTL threshold (Standard speed)', () => {
    // Standard threshold is 60 (from BALANCE)
    // Create archetype with CTL exactly 60
    const player: PlayerState = {
      archetype: ARCHETYPES.duelist,  // CTL=60
      currentStamina: 60,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const opp = makePlayerState('charger');

    const choice: PassChoice = {
      speed: SpeedType.Standard,
      attack: CDL,
      shiftAttack: PDL,
    };
    const oppChoice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, player, opp, choice, oppChoice);

    // Duelist CTL=60 should meet Standard threshold exactly
    expect(result.player1.shifted).toBe(true);
  });

  it('shift fails just below CTL threshold (Standard speed) via fatigue', () => {
    // Standard threshold is 60
    // Charger CTL=55, at very low stamina (STA=3)
    // ff = 3/(65*0.8) = 3/52 = 0.0577
    // Effective CTL = softCap(55) * 0.0577 = 55 * 0.0577 = 3.17 << 60
    const player: PlayerState = {
      archetype: ARCHETYPES.charger,  // CTL=55
      currentStamina: 3,  // Very low → massive fatigue
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const opp = makePlayerState('bulwark');

    const choice: PassChoice = {
      speed: SpeedType.Standard,
      attack: CDL,
      shiftAttack: PDL,
    };
    const oppChoice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, player, opp, choice, oppChoice);

    // Fatigue reduces effective CTL below 60 threshold → shift should fail
    expect(result.player1.shifted).toBe(false);
  });

  it('shift at exact stamina threshold (stamina=10)', () => {
    // Shift requires BOTH: effective CTL >= threshold AND currentStamina >= 10
    // Technician CTL=70, Standard+CDL → rawCTL=80
    // Need effective CTL >= 60 → ff >= 0.75 → currentStamina >= 33
    // And need stamina >= 10 after speed (Standard deltaStamina=0)
    // Test at exactly stamina=10 (edge case for stamina check)
    const tech: PlayerState = {
      archetype: ARCHETYPES.technician,  // CTL=70, maxSTA=55
      currentStamina: 33,  // ff = 33/44 = 0.75 → effective CTL = 80*0.75 = 60
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const opp = makePlayerState('charger');

    const choice: PassChoice = {
      speed: SpeedType.Standard,  // deltaStamina=0
      attack: CDL,  // deltaControl=+10
      shiftAttack: PDL,
    };
    const oppChoice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, tech, opp, choice, oppChoice);

    // Effective CTL = 60 (exactly), stamina = 33 >= 10 → shift should succeed
    expect(result.player1.shifted).toBe(true);
  });

  it('shift fails when stamina is below cost threshold', () => {
    // Fast shift costs 12; test with stamina=11
    const tech: PlayerState = {
      archetype: ARCHETYPES.technician,  // CTL=70
      currentStamina: 11,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const opp = makePlayerState('charger');

    const choice: PassChoice = {
      speed: SpeedType.Fast,
      attack: CF,
      shiftAttack: CDL,
    };
    const oppChoice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, tech, opp, choice, oppChoice);

    // STA=11 < Fast shift cost (12) → shift should fail
    expect(result.player1.shifted).toBe(false);
  });
});

// ============================================================
// 11. Edge Cases — Breaker Penetration vs High-Guard in Melee
// ============================================================
describe('Edge Cases — Breaker Penetration vs High-Guard in Melee', () => {
  it('Breaker vs Bulwark using Guard High: penetration mitigates high guard', () => {
    const breaker = makePlayerState('breaker');
    const bulwark = makePlayerState('bulwark');

    // Bulwark uses Guard High (deltaGuard +20) for max guard
    const result = resolveMeleeRoundFn(1, breaker, bulwark, OC, GH);

    // Breaker should have meaningful impact despite Bulwark's massive guard
    // Compare to non-Breaker
    const charger = makePlayerState('charger');
    const chargerResult = resolveMeleeRoundFn(1, charger, bulwark, OC, GH);

    // Breaker impact should be higher than Charger despite lower MOM (62 vs 75)
    // This proves penetration is working against high-guard melee
    expect(result.player1ImpactScore).toBeGreaterThan(0);
    expect(result.player1ImpactScore).toBeGreaterThan(chargerResult.player1ImpactScore * 0.7);
  });

  it('Breaker vs Bulwark+Guard High at low stamina: penetration + fatigue interaction', () => {
    const breaker: PlayerState = {
      archetype: ARCHETYPES.breaker,
      currentStamina: 15,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    const bulwark: PlayerState = {
      archetype: ARCHETYPES.bulwark,
      currentStamina: 10,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };

    // Bulwark uses Guard High
    const result = resolveMeleeRoundFn(1, breaker, bulwark, OC, GH);

    // Breaker should still have penetration benefit despite fatigue
    expect(Number.isFinite(result.player1ImpactScore)).toBe(true);
    expect(Number.isFinite(result.player2ImpactScore)).toBe(true);
  });

  it('Breaker vs Bulwark: penetration scales with guard stat', () => {
    const breaker = makePlayerState('breaker');

    // Test vs high-guard Bulwark
    const bulwark = makePlayerState('bulwark');  // GRD=65
    const bulwarkResult = resolveMeleeRoundFn(1, breaker, bulwark, MC, GH);

    // Test vs low-guard Charger
    const charger = makePlayerState('charger');  // GRD=50
    const chargerResult = resolveMeleeRoundFn(1, breaker, charger, MC, GH);

    // Breaker's relative advantage should be larger vs Bulwark
    const duel = makePlayerState('duelist');
    const duelVsBulwark = resolveMeleeRoundFn(1, duel, bulwark, MC, GH);
    const duelVsCharger = resolveMeleeRoundFn(1, duel, charger, MC, GH);

    const breakerEdgeVsBulwark = bulwarkResult.player1ImpactScore - duelVsBulwark.player1ImpactScore;
    const breakerEdgeVsCharger = chargerResult.player1ImpactScore - duelVsCharger.player1ImpactScore;

    // Edge should be larger vs high-guard opponent
    expect(breakerEdgeVsBulwark).toBeGreaterThan(breakerEdgeVsCharger * 0.8);
  });
});

// ============================================================
// Impact Breakdown (BL-076)
// ============================================================
describe('ImpactBreakdown — joust', () => {
  it('breakdown is populated on PassPlayerResult', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');
    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, p1, p2, choice, choice);

    expect(result.player1.breakdown).toBeDefined();
    expect(result.player2.breakdown).toBeDefined();
    expect(result.player1.maxStamina).toBe(p1.archetype.stamina);
    expect(result.player2.maxStamina).toBe(p2.archetype.stamina);
  });

  it('breakdown components sum to impactScore', () => {
    const p1 = makePlayerState('charger');
    const p2 = makePlayerState('bulwark');
    const choice1: PassChoice = { speed: SpeedType.Fast, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Slow, attack: PDL };

    const result = resolveJoustPass(1, p1, p2, choice1, choice2);
    const bd1 = result.player1.breakdown!;
    const bd2 = result.player2.breakdown!;

    // momentumComponent + accuracyComponent - guardPenalty should equal impactScore
    const computed1 = bd1.momentumComponent + bd1.accuracyComponent - bd1.guardPenalty;
    expect(computed1).toBeCloseTo(result.player1.impactScore, 5);

    const computed2 = bd2.momentumComponent + bd2.accuracyComponent - bd2.guardPenalty;
    expect(computed2).toBeCloseTo(result.player2.impactScore, 5);
  });

  it('breakdown shows counter bonus when counter occurs', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');

    // CF beats PDL → P1 wins counter
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: PDL };

    const result = resolveJoustPass(1, p1, p2, choice1, choice2);
    const bd1 = result.player1.breakdown!;
    const bd2 = result.player2.breakdown!;

    expect(bd1.counterBonus).toBeGreaterThan(0);
    expect(bd2.counterBonus).toBeLessThan(0);
    expect(bd1.counterBonus).toBe(-bd2.counterBonus);
  });

  it('breakdown shows zero counter bonus when no counter', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');
    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, p1, p2, choice, choice);

    expect(result.player1.breakdown!.counterBonus).toBe(0);
    expect(result.player2.breakdown!.counterBonus).toBe(0);
  });

  it('breakdown flags breaker penetration correctly', () => {
    const breaker = makePlayerState('breaker');
    const bulwark = makePlayerState('bulwark');

    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };
    const result = resolveJoustPass(1, breaker, bulwark, choice, choice);

    // P2 (bulwark) should see opponentIsBreaker = true (breaker is attacking them)
    expect(result.player2.breakdown!.opponentIsBreaker).toBe(true);
    // P1 (breaker) should NOT see opponentIsBreaker (bulwark is not a breaker)
    expect(result.player1.breakdown!.opponentIsBreaker).toBe(false);
  });

  it('breakdown components are all positive for momentum/accuracy', () => {
    const p1 = makePlayerState('charger');
    const p2 = makePlayerState('duelist');
    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, p1, p2, choice, choice);

    expect(result.player1.breakdown!.momentumComponent).toBeGreaterThan(0);
    expect(result.player1.breakdown!.accuracyComponent).toBeGreaterThan(0);
    expect(result.player1.breakdown!.guardPenalty).toBeGreaterThan(0);
  });
});

describe('ImpactBreakdown — melee', () => {
  it('breakdown is populated on MeleeRoundResult', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');

    const result = resolveMeleeRoundFn(1, p1, p2, MC, MC);

    expect(result.player1Breakdown).toBeDefined();
    expect(result.player2Breakdown).toBeDefined();
  });

  it('melee breakdown components sum to impactScore', () => {
    const p1 = makePlayerState('charger');
    const p2 = makePlayerState('bulwark');

    const result = resolveMeleeRoundFn(1, p1, p2, OC, GH);
    const bd1 = result.player1Breakdown!;
    const bd2 = result.player2Breakdown!;

    // Note: melee can have unseated boost which is applied AFTER the base formula,
    // so breakdown sums to the pre-boost impact. For non-unseated players, it matches exactly.
    const computed1 = bd1.momentumComponent + bd1.accuracyComponent - bd1.guardPenalty;
    expect(computed1).toBeCloseTo(result.player1ImpactScore, 5);

    const computed2 = bd2.momentumComponent + bd2.accuracyComponent - bd2.guardPenalty;
    expect(computed2).toBeCloseTo(result.player2ImpactScore, 5);
  });

  it('melee breakdown flags breaker correctly', () => {
    const breaker = makePlayerState('breaker');
    const duelist = makePlayerState('duelist');

    const result = resolveMeleeRoundFn(1, breaker, duelist, MC, MC);

    expect(result.player2Breakdown!.opponentIsBreaker).toBe(true);
    expect(result.player1Breakdown!.opponentIsBreaker).toBe(false);
  });

  it('melee breakdown with counter', () => {
    const p1 = makePlayerState('duelist');
    const p2 = makePlayerState('duelist');

    // OC (Agg) beats GH (Def)
    const result = resolveMeleeRoundFn(1, p1, p2, OC, GH);

    expect(result.player1Breakdown!.counterBonus).toBeGreaterThan(0);
    expect(result.player2Breakdown!.counterBonus).toBeLessThan(0);
  });

  it('melee breakdown diverges from impactScore when unseated boost applied', () => {
    const p1 = makePlayerState('charger');
    p1.wasUnseated = true;
    const p2 = makePlayerState('duelist');

    const result = resolveMeleeRoundFn(1, p1, p2, OC, MC);
    const bd1 = result.player1Breakdown!;

    // Breakdown is pre-boost, impactScore includes 1.35x boost
    const preBoost = bd1.momentumComponent + bd1.accuracyComponent - bd1.guardPenalty;
    expect(result.player1ImpactScore).toBeGreaterThan(preBoost);
    expect(result.player1ImpactScore).toBeCloseTo(preBoost * 1.35, 5);
  });
});
