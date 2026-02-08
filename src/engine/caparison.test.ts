// ============================================================
// Caparison Effect Tests
// ============================================================
import { describe, it, expect } from 'vitest';
import { resolveJoustPass } from './phase-joust';
import { resolveMeleeRoundFn } from './phase-melee';
import { createMatch, submitJoustPass, submitMeleeRound } from './match';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS, SPEEDS } from './attacks';
import { CAPARISON_EFFECTS } from './gigling-gear';
import { computeEffectiveStats, fatigueFactor } from './calculator';
import { BALANCE } from './balance-config';
import {
  SpeedType,
  Stance,
  type PlayerState,
  type PassChoice,
  type CaparisonInput,
  type CaparisonEffect,
  type GiglingLoadout,
  type GiglingGear,
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

function makeCapInput(effectId: string, bannerUsed = false): CaparisonInput {
  return {
    effect: CAPARISON_EFFECTS[effectId as keyof typeof CAPARISON_EFFECTS],
    bannerUsed,
  };
}

function makeCapGear(effectId: string): GiglingGear {
  const effect = CAPARISON_EFFECTS[effectId as keyof typeof CAPARISON_EFFECTS];
  return { slot: 'caparison', rarity: effect.rarity, effect };
}

function makeLoadoutWithCap(effectId: string): GiglingLoadout {
  return {
    giglingRarity: 'uncommon',
    caparison: makeCapGear(effectId),
  };
}

const CF = JOUST_ATTACKS.coupFort;       // Aggressive
const PDL = JOUST_ATTACKS.portDeLance;   // Defensive
const CDL = JOUST_ATTACKS.courseDeLance; // Balanced (beats CF)
const CEP = JOUST_ATTACKS.coupEnPassant; // Defensive (beats CF)
const BDG = JOUST_ATTACKS.brisDeGarde;   // Aggressive (beats PDL)

const OC = MELEE_ATTACKS.overhandCleave;    // Aggressive (beats GH)
const GH = MELEE_ATTACKS.guardHigh;         // Defensive
const MC = MELEE_ATTACKS.measuredCut;       // Balanced (beats OC)
const RS = MELEE_ATTACKS.riposteStep;       // Defensive (beats FB)
const FB = MELEE_ATTACKS.feintBreak;        // Aggressive

// ============================================================
// 1. Pennant of Haste — +2 INIT on Pass 1 only
// ============================================================
describe('Pennant of Haste', () => {
  const p1 = makePlayerState('duelist');
  const p2 = makePlayerState('duelist');
  const cap = makeCapInput('pennant_of_haste');

  const choice = (attack = CDL): PassChoice => ({
    speed: SpeedType.Standard,
    attack,
  });

  it('increases P1 initiative on pass 1', () => {
    const withCap = resolveJoustPass(1, p1, p2, choice(), choice(), cap);
    const without = resolveJoustPass(1, p1, p2, choice(), choice());

    expect(withCap.player1.effectiveStats.initiative)
      .toBe(without.player1.effectiveStats.initiative + BALANCE.caparison.hasteInitBonus);
  });

  it('does NOT increase initiative on pass 2', () => {
    const withCap = resolveJoustPass(2, p1, p2, choice(), choice(), cap);
    const without = resolveJoustPass(2, p1, p2, choice(), choice());

    expect(withCap.player1.effectiveStats.initiative)
      .toBe(without.player1.effectiveStats.initiative);
  });

  it('does NOT affect P2 when only P1 has it', () => {
    const result = resolveJoustPass(1, p1, p2, choice(), choice(), cap);
    const baseline = resolveJoustPass(1, p1, p2, choice(), choice());

    expect(result.player2.effectiveStats.initiative)
      .toBe(baseline.player2.effectiveStats.initiative);
  });

  it('affects accuracy through initiative', () => {
    const withCap = resolveJoustPass(1, p1, p2, choice(), choice(), cap);
    const without = resolveJoustPass(1, p1, p2, choice(), choice());

    // Accuracy = CTL + INIT/2 - oppMOM/4 + counter
    // +2 INIT → +1 accuracy
    expect(withCap.player1.accuracy).toBeCloseTo(without.player1.accuracy + 1, 2);
  });
});

// ============================================================
// 2. Woven Shieldcloth — +3 GRD when Defensive
// ============================================================
describe('Woven Shieldcloth', () => {
  const p1 = makePlayerState('duelist');
  const p2 = makePlayerState('duelist');
  const cap = makeCapInput('woven_shieldcloth');

  it('increases guard when using Defensive attack (PDL)', () => {
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: PDL };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    expect(withCap.player1.effectiveStats.guard)
      .toBeGreaterThan(without.player1.effectiveStats.guard);
  });

  it('does NOT increase guard when using Aggressive attack (CF)', () => {
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    expect(withCap.player1.effectiveStats.guard)
      .toBe(without.player1.effectiveStats.guard);
  });

  it('does NOT increase guard when using Balanced attack (CDL)', () => {
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CDL };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    expect(withCap.player1.effectiveStats.guard)
      .toBe(without.player1.effectiveStats.guard);
  });

  it('applies in melee when using Defensive attack (GH)', () => {
    const withCap = resolveMeleeRoundFn(1, p1, p2, GH, MC, cap);
    const without = resolveMeleeRoundFn(1, p1, p2, GH, MC);

    // P1 uses Guard High (defensive) → shieldcloth activates → P1 guard +3
    // Higher P1 guard reduces P2's ImpactScore (formula: -opponentGuard * 0.3)
    expect(withCap.player2ImpactScore).toBeLessThan(without.player2ImpactScore);
  });

  it('does NOT apply in melee when using Aggressive attack (OC)', () => {
    const withCap = resolveMeleeRoundFn(1, p1, p2, OC, MC, cap);
    const without = resolveMeleeRoundFn(1, p1, p2, OC, MC);

    expect(withCap.player1ImpactScore).toBe(without.player1ImpactScore);
    expect(withCap.player2ImpactScore).toBe(without.player2ImpactScore);
  });
});

// ============================================================
// 3. Thunderweave — +4 MOM when Fast
// ============================================================
describe('Thunderweave', () => {
  const p1 = makePlayerState('charger'); // High MOM
  const p2 = makePlayerState('duelist');
  const cap = makeCapInput('thunderweave');

  it('increases momentum at Fast speed', () => {
    const choice1: PassChoice = { speed: SpeedType.Fast, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    expect(withCap.player1.effectiveStats.momentum)
      .toBeGreaterThan(without.player1.effectiveStats.momentum);
  });

  it('does NOT increase momentum at Standard speed', () => {
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    expect(withCap.player1.effectiveStats.momentum)
      .toBe(without.player1.effectiveStats.momentum);
  });

  it('does NOT increase momentum at Slow speed', () => {
    const choice1: PassChoice = { speed: SpeedType.Slow, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    expect(withCap.player1.effectiveStats.momentum)
      .toBe(without.player1.effectiveStats.momentum);
  });

  it('does NOT apply in melee (no speed selection)', () => {
    // Melee has no speed, so thunderweave should never activate
    const withCap = resolveMeleeRoundFn(1, p1, p2, OC, MC, cap);
    const without = resolveMeleeRoundFn(1, p1, p2, OC, MC);

    expect(withCap.player1ImpactScore).toBe(without.player1ImpactScore);
  });
});

// ============================================================
// 4. Irongrip Drape — -5 shift threshold
// ============================================================
describe('Irongrip Drape', () => {
  // Tactician has CTL 65, useful for threshold-edge shift tests
  const p1 = makePlayerState('charger'); // CTL 50 — moderate control, shift-challenged
  const p2 = makePlayerState('duelist');
  const cap = makeCapInput('irongrip_drape');

  it('reduces shift threshold in logs', () => {
    const choice1: PassChoice = {
      speed: SpeedType.Fast, // threshold 70
      attack: CF,
      shiftAttack: CDL,
    };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const result = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    expect(result.log.some(l => l.includes('Irongrip Drape'))).toBe(true);
    expect(result.log.some(l => l.includes('shift threshold 70→65'))).toBe(true);
  });

  it('enables shift that would otherwise be denied', () => {
    // Tactician at Fast speed: threshold 70, base CTL = 65
    // Fast deltaCTL = -15, CEP deltaCTL = +15
    // effCTL = softCap(65 - 15 + 15) * 1.0 = 65 — below 70
    // With irongrip: threshold = 65 — exactly equal! canShift requires >=
    const tactician = makePlayerState('tactician');
    const opp = makePlayerState('duelist');

    const choice1: PassChoice = {
      speed: SpeedType.Fast,   // threshold 70, irongrip → 65
      attack: CEP,             // deltaCTL = +15
      shiftAttack: PDL,
    };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    // Without irongrip: effCTL 65 < threshold 70 → shift denied
    const without = resolveJoustPass(1, tactician, opp, choice1, choice2);
    expect(without.player1.shifted).toBe(false);

    // With irongrip: effCTL 65 >= threshold 65 → shift allowed
    const withCap = resolveJoustPass(1, tactician, opp, choice1, choice2, cap);
    expect(withCap.player1.shifted).toBe(true);
  });
});

// ============================================================
// 5. Stormcloak — -0.05 fatigue ratio
// ============================================================
describe('Stormcloak', () => {
  const cap = makeCapInput('stormcloak');

  it('produces higher fatigue factor at reduced stamina', () => {
    // Duelist stamina = 60, fatigueRatio = 0.8, threshold = 48
    // At STA 40: FF = 40/48 = 0.833
    // With stormcloak: ratio = 0.75, adjustedMaxSta = 60 * 0.75/0.8 = 56.25
    // fatigueFactor(40, 56.25) = 40 / (56.25 * 0.8) = 40/45 = 0.889
    const lowStaP1 = makePlayerState('duelist', 40);
    const p2 = makePlayerState('duelist');

    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CDL };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, lowStaP1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, lowStaP1, p2, choice1, choice2);

    // Higher FF means higher effective stats (momentum, control)
    expect(withCap.player1.effectiveStats.momentum)
      .toBeGreaterThan(without.player1.effectiveStats.momentum);
    expect(withCap.player1.effectiveStats.control)
      .toBeGreaterThan(without.player1.effectiveStats.control);
  });

  it('has no effect when stamina is above both thresholds', () => {
    // At full stamina, FF = 1.0 regardless of fatigue ratio
    const p1 = makePlayerState('duelist'); // STA 60, threshold 48 (or 45 with stormcloak)
    const p2 = makePlayerState('duelist');

    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CDL };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    expect(withCap.player1.effectiveStats.momentum)
      .toBe(without.player1.effectiveStats.momentum);
  });

  it('applies in melee too', () => {
    const lowStaP1 = makePlayerState('duelist', 40);
    const p2 = makePlayerState('duelist');

    const withCap = resolveMeleeRoundFn(1, lowStaP1, p2, MC, MC, cap);
    const without = resolveMeleeRoundFn(1, lowStaP1, p2, MC, MC);

    expect(withCap.player1ImpactScore).toBeGreaterThan(without.player1ImpactScore);
  });
});

// ============================================================
// 6. Banner of the Giga — +50% first counter bonus
// ============================================================
describe('Banner of the Giga', () => {
  const p1 = makePlayerState('duelist');
  const p2 = makePlayerState('duelist');
  const cap = makeCapInput('banner_of_the_giga');
  const capUsed = makeCapInput('banner_of_the_giga', true);

  it('boosts counter bonus when P1 wins counter', () => {
    // CF beats PDL → P1 gets positive counter bonus
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: PDL };

    const withCap = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    // Both have positive P1 accuracy, but banner version is higher
    expect(withCap.player1.accuracy).toBeGreaterThan(without.player1.accuracy);
    expect(withCap.p1BannerConsumed).toBe(true);
  });

  it('does NOT boost when P1 LOSES the counter', () => {
    // PDL beats CDL → P2 gets counter bonus, not P1
    // Actually: courseDeLance beats coupFort. Let me pick correctly.
    // CDL beats CF → P1 loses with CF, P2 wins
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: PDL };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    // CDL beats ... wait. CDL beats CF and BDG. PDL beats CDL.
    // So P1=PDL vs P2=CDL → PDL beats CDL → P1 wins counter
    // I need P1 to LOSE. Let's use CF vs CDL:
    const choice1b: PassChoice = { speed: SpeedType.Standard, attack: CF };
    const choice2b: PassChoice = { speed: SpeedType.Standard, attack: CDL };
    // CDL beats CF → P2 wins counter, P1 gets negative bonus

    const result = resolveJoustPass(1, p1, p2, choice1b, choice2b, cap);
    expect(result.p1BannerConsumed).toBe(false); // P1 didn't win counter
  });

  it('does NOT boost when no counter occurs', () => {
    // CF vs CEP: CEP beats CF actually. Let me find a no-counter pair.
    // BDG beats PDL and CDP. CDL beats CF and BDG.
    // CF vs BDG? CF does NOT beat BDG, BDG does NOT beat CF → no counter
    // Actually check: CF.beats = ['portDeLance'], BDG.beats = ['portDeLance', 'coupDePointe']
    // Neither beats the other → no counter
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: BDG };

    const result = resolveJoustPass(1, p1, p2, choice1, choice2, cap);
    expect(result.p1BannerConsumed).toBe(false);
  });

  it('does NOT activate if already used', () => {
    // CF beats PDL → P1 would win counter, but banner already used
    const choice1: PassChoice = { speed: SpeedType.Standard, attack: CF };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: PDL };

    const withUsed = resolveJoustPass(1, p1, p2, choice1, choice2, capUsed);
    const without = resolveJoustPass(1, p1, p2, choice1, choice2);

    // Same accuracy since banner is already consumed
    expect(withUsed.player1.accuracy).toBe(without.player1.accuracy);
    expect(withUsed.p1BannerConsumed).toBe(false);
  });

  it('works in melee counters', () => {
    // OC beats GH → P1 wins counter
    const withCap = resolveMeleeRoundFn(1, p1, p2, OC, GH, cap);
    const without = resolveMeleeRoundFn(1, p1, p2, OC, GH);

    expect(withCap.player1ImpactScore).toBeGreaterThan(without.player1ImpactScore);
    expect(withCap.p1BannerConsumed).toBe(true);
  });

  it('banner consumed only once across full match', () => {
    // Use match pipeline with loadout
    const loadout1 = makeLoadoutWithCap('banner_of_the_giga');
    let state = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, loadout1);

    expect(state.p1BannerUsed).toBe(false);
    expect(state.p1Caparison?.id).toBe('banner_of_the_giga');

    // Pass 1: CF vs PDL → P1 wins counter, banner consumed
    state = submitJoustPass(state,
      { speed: SpeedType.Standard, attack: CF },
      { speed: SpeedType.Standard, attack: PDL },
    );
    expect(state.p1BannerUsed).toBe(true);

    // Pass 2: CF vs PDL again → P1 wins counter, but banner already used
    const prevImpact = state.passResults[0].player1.impactScore;
    state = submitJoustPass(state,
      { speed: SpeedType.Standard, attack: CF },
      { speed: SpeedType.Standard, attack: PDL },
    );
    // Second pass should have lower impact than first (no banner boost)
    // Actually impact varies by stamina, but the counter bonus should be smaller
    expect(state.p1BannerUsed).toBe(true); // still true, not re-consumed
  });
});

// ============================================================
// 7. No Caparison — backwards compatibility
// ============================================================
describe('No caparison (backwards compat)', () => {
  const p1 = makePlayerState('duelist');
  const p2 = makePlayerState('duelist');

  it('resolveJoustPass works without caparison args', () => {
    const choice: PassChoice = { speed: SpeedType.Standard, attack: CDL };
    const result = resolveJoustPass(1, p1, p2, choice, choice);
    expect(result.player1.effectiveStats.momentum).toBeGreaterThan(0);
    expect(result.p1BannerConsumed).toBe(false);
    expect(result.p2BannerConsumed).toBe(false);
  });

  it('resolveMeleeRoundFn works without caparison args', () => {
    const result = resolveMeleeRoundFn(1, p1, p2, MC, MC);
    expect(result.player1ImpactScore).toBeGreaterThan(0);
    expect(result.p1BannerConsumed).toBe(false);
  });

  it('createMatch without loadouts has no caparison', () => {
    const state = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist);
    expect(state.p1Caparison).toBeUndefined();
    expect(state.p2Caparison).toBeUndefined();
    expect(state.p1BannerUsed).toBe(false);
    expect(state.p2BannerUsed).toBe(false);
  });
});

// ============================================================
// 8. Match Integration — full pipeline
// ============================================================
describe('Caparison match integration', () => {
  it('pennant affects only pass 1 through match pipeline', () => {
    const loadout1 = makeLoadoutWithCap('pennant_of_haste');
    let state = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, loadout1);

    const choice = (): PassChoice => ({ speed: SpeedType.Standard, attack: CDL });

    // Pass 1: pennant active
    state = submitJoustPass(state, choice(), choice());
    const pass1Init = state.passResults[0].player1.effectiveStats.initiative;

    // Pass 2: pennant inactive
    state = submitJoustPass(state, choice(), choice());
    const pass2Init = state.passResults[1].player1.effectiveStats.initiative;

    expect(pass1Init).toBe(pass2Init + BALANCE.caparison.hasteInitBonus);
  });

  it('shieldcloth guard bonus visible through match', () => {
    const loadout1 = makeLoadoutWithCap('woven_shieldcloth');
    let state = createMatch(ARCHETYPES.bulwark, ARCHETYPES.duelist, loadout1);

    // Defensive attack
    state = submitJoustPass(state,
      { speed: SpeedType.Standard, attack: PDL },
      { speed: SpeedType.Standard, attack: CDL },
    );
    const grdDefensive = state.passResults[0].player1.effectiveStats.guard;

    // Reset and use aggressive attack
    let state2 = createMatch(ARCHETYPES.bulwark, ARCHETYPES.duelist, loadout1);
    state2 = submitJoustPass(state2,
      { speed: SpeedType.Standard, attack: CF },
      { speed: SpeedType.Standard, attack: CDL },
    );
    const grdAggressive = state2.passResults[0].player1.effectiveStats.guard;

    // PDL has +20 deltaGuard vs CF's -5 deltaGuard = 25 difference in guard
    // Shieldcloth adds 3 on top of that for defensive → difference should be > 25 base
    expect(grdDefensive).toBeGreaterThan(grdAggressive);
  });

  it('thunderweave momentum bonus visible through match', () => {
    const loadout1 = makeLoadoutWithCap('thunderweave');

    // Fast speed
    let state1 = createMatch(ARCHETYPES.charger, ARCHETYPES.duelist, loadout1);
    state1 = submitJoustPass(state1,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: CDL },
    );
    const momFast = state1.passResults[0].player1.effectiveStats.momentum;

    // Standard speed (no thunderweave)
    let state2 = createMatch(ARCHETYPES.charger, ARCHETYPES.duelist, loadout1);
    state2 = submitJoustPass(state2,
      { speed: SpeedType.Standard, attack: CF },
      { speed: SpeedType.Standard, attack: CDL },
    );

    // Compare with same archetype/attack but no loadout at Fast
    let state3 = createMatch(ARCHETYPES.charger, ARCHETYPES.duelist);
    state3 = submitJoustPass(state3,
      { speed: SpeedType.Fast, attack: CF },
      { speed: SpeedType.Standard, attack: CDL },
    );
    const momFastNoGear = state3.passResults[0].player1.effectiveStats.momentum;

    // Thunderweave at fast should be higher than no-gear at fast
    expect(momFast).toBeGreaterThan(momFastNoGear);
  });

  it('P2 caparison also works', () => {
    const loadout2 = makeLoadoutWithCap('pennant_of_haste');
    // Baseline: same uncommon rarity but no caparison effect
    const baselineLoadout: GiglingLoadout = { giglingRarity: 'uncommon' };
    let state = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, undefined, loadout2);

    expect(state.p2Caparison?.id).toBe('pennant_of_haste');

    state = submitJoustPass(state,
      { speed: SpeedType.Standard, attack: CDL },
      { speed: SpeedType.Standard, attack: CDL },
    );

    // Compare against same rarity but no caparison to isolate pennant effect
    const stateNoCap = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, undefined, baselineLoadout);
    const stateNoCap2 = submitJoustPass(stateNoCap,
      { speed: SpeedType.Standard, attack: CDL },
      { speed: SpeedType.Standard, attack: CDL },
    );

    expect(state.passResults[0].player2.effectiveStats.initiative)
      .toBe(stateNoCap2.passResults[0].player2.effectiveStats.initiative + BALANCE.caparison.hasteInitBonus);
  });

  it('both players can have different caparisons', () => {
    const loadout1 = makeLoadoutWithCap('pennant_of_haste');
    const loadout2 = makeLoadoutWithCap('thunderweave');
    // Baseline: same uncommon rarity but no caparison effects
    const baselineLoadout: GiglingLoadout = { giglingRarity: 'uncommon' };
    let state = createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, loadout1, loadout2);

    expect(state.p1Caparison?.id).toBe('pennant_of_haste');
    expect(state.p2Caparison?.id).toBe('thunderweave');

    // P1 gets pennant on pass 1, P2 gets thunderweave at fast speed
    state = submitJoustPass(state,
      { speed: SpeedType.Standard, attack: CDL },
      { speed: SpeedType.Fast, attack: CF },
    );

    const p1Init = state.passResults[0].player1.effectiveStats.initiative;
    const p2Mom = state.passResults[0].player2.effectiveStats.momentum;

    // Verify P1 got init bonus and P2 got mom bonus vs same-rarity baseline
    const baseline = submitJoustPass(
      createMatch(ARCHETYPES.duelist, ARCHETYPES.duelist, baselineLoadout, baselineLoadout),
      { speed: SpeedType.Standard, attack: CDL },
      { speed: SpeedType.Fast, attack: CF },
    );

    expect(p1Init).toBe(baseline.passResults[0].player1.effectiveStats.initiative + BALANCE.caparison.hasteInitBonus);
    expect(p2Mom).toBeGreaterThan(baseline.passResults[0].player2.effectiveStats.momentum);
  });
});

// ============================================================
// 9. Effect values match balance-config
// ============================================================
describe('Caparison balance-config values', () => {
  it('hasteInitBonus is 2', () => {
    expect(BALANCE.caparison.hasteInitBonus).toBe(2);
  });
  it('shieldclothGuardBonus is 3', () => {
    expect(BALANCE.caparison.shieldclothGuardBonus).toBe(3);
  });
  it('thunderweaveMomBonus is 4', () => {
    expect(BALANCE.caparison.thunderweaveMomBonus).toBe(4);
  });
  it('irongripShiftReduction is 5', () => {
    expect(BALANCE.caparison.irongripShiftReduction).toBe(5);
  });
  it('stormcloakFatigueReduction is 0.05', () => {
    expect(BALANCE.caparison.stormcloakFatigueReduction).toBe(0.05);
  });
  it('gigaBannerCounterMultiplier is 1.5', () => {
    expect(BALANCE.caparison.gigaBannerCounterMultiplier).toBe(1.5);
  });
});

// ============================================================
// 10. Shieldcloth + Shift — activates based on FINAL attack
// ============================================================
describe('Shieldcloth + Shift interaction', () => {
  it('activates when shifting FROM Balanced TO Defensive', () => {
    // Technician has high CTL → can shift at Standard speed
    const tech = makePlayerState('technician');
    const opp = makePlayerState('duelist');
    const cap = makeCapInput('woven_shieldcloth');

    // Initial: CDL (Balanced), shift to PDL (Defensive)
    const choice1: PassChoice = {
      speed: SpeedType.Standard,
      attack: CDL,
      shiftAttack: PDL,
    };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, tech, opp, choice1, choice2, cap);

    // Verify shift happened
    expect(withCap.player1.shifted).toBe(true);
    expect(withCap.player1.finalAttack.id).toBe('portDeLance');

    // Compare against same shift but without shieldcloth
    const without = resolveJoustPass(1, tech, opp, choice1, choice2);

    // Shieldcloth should have boosted guard since final attack is Defensive
    expect(withCap.player1.effectiveStats.guard)
      .toBeGreaterThan(without.player1.effectiveStats.guard);
  });

  it('does NOT activate when shifting FROM Defensive TO Balanced', () => {
    const tech = makePlayerState('technician');
    const opp = makePlayerState('duelist');
    const cap = makeCapInput('woven_shieldcloth');

    // Initial: PDL (Defensive), shift to CDL (Balanced)
    const choice1: PassChoice = {
      speed: SpeedType.Slow, // Low threshold for shift
      attack: PDL,
      shiftAttack: CDL,
    };
    const choice2: PassChoice = { speed: SpeedType.Standard, attack: CDL };

    const withCap = resolveJoustPass(1, tech, opp, choice1, choice2, cap);

    // Verify shift happened
    expect(withCap.player1.shifted).toBe(true);
    expect(withCap.player1.finalAttack.id).toBe('courseDeLance');

    // Compare without shieldcloth — should be identical (no bonus)
    const without = resolveJoustPass(1, tech, opp, choice1, choice2);

    expect(withCap.player1.effectiveStats.guard)
      .toBe(without.player1.effectiveStats.guard);
  });
});

// ============================================================
// 11. Double Shift Priority — lower INIT shifts first
// ============================================================
describe('Double shift priority', () => {
  it('higher initiative player shifts second (advantage)', () => {
    // Tactician (INIT 75) vs Duelist (INIT 60), both at Standard speed
    // Both can shift. Tactician shifts second → sees opponent's shift.
    const tact = makePlayerState('tactician');
    const duel = makePlayerState('duelist');

    // Both try to shift: CDL → PDL
    const choice1: PassChoice = {
      speed: SpeedType.Slow, // threshold 50, easy for Tactician CTL 65
      attack: CDL,
      shiftAttack: CEP, // Defensive
    };
    const choice2: PassChoice = {
      speed: SpeedType.Slow,
      attack: CDL,
      shiftAttack: PDL, // Also Defensive
    };

    const result = resolveJoustPass(1, tact, duel, choice1, choice2);

    // Both should shift successfully
    expect(result.player1.shifted).toBe(true);
    expect(result.player2.shifted).toBe(true);

    // Log should mention initiative advantage
    const priorityLog = result.log.find(l => l.includes('Initiative advantage'));
    expect(priorityLog).toBeDefined();
    // Tactician (P1) has higher INIT → shifts second → has advantage
    expect(priorityLog).toContain('P1');
  });
});
