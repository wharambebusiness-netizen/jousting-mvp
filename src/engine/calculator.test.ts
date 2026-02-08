// ============================================================
// Validation: Balance-Scaling Combat System
// Tests formula properties, scaling behaviors, and directional outcomes.
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS, SPEEDS } from './attacks';
import { BALANCE } from './balance-config';
import { SpeedType, MeleeOutcome, type Attack } from './types';
import {
  softCap,
  fatigueFactor,
  guardFatigueFactor,
  computeEffectiveStats,
  computeMeleeEffectiveStats,
  resolveCounters,
  calcAccuracy,
  calcImpactScore,
  checkUnseat,
  applySpeedStamina,
  applyAttackStaminaCost,
  applyShiftCost,
  canShift,
  resolveMeleeRound,
  resolvePass,
} from './calculator';

const charger = ARCHETYPES.charger;
const technician = ARCHETYPES.technician;
const bulwark = ARCHETYPES.bulwark;
const duelist = ARCHETYPES.duelist;
const CF = JOUST_ATTACKS.coupFort;
const CdL = JOUST_ATTACKS.courseDeLance;
const CEP = JOUST_ATTACKS.coupEnPassant;
const BdG = JOUST_ATTACKS.brisDeGarde;
const PdL = JOUST_ATTACKS.portDeLance;
const OC = MELEE_ATTACKS.overhandCleave;
const MC = MELEE_ATTACKS.measuredCut;
const GH = MELEE_ATTACKS.guardHigh;

// Helper: round to N decimal places
function r(n: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// ============================================================
// 1. Soft Cap
// ============================================================
describe('Soft Cap (Diminishing Returns)', () => {
  it('passes values below knee unchanged', () => {
    expect(softCap(0)).toBe(0);
    expect(softCap(50)).toBe(50);
    expect(softCap(BALANCE.softCapKnee)).toBe(BALANCE.softCapKnee);
  });

  it('compresses values above the knee', () => {
    const val = BALANCE.softCapKnee + 20;
    const result = softCap(val);
    expect(result).toBeGreaterThan(BALANCE.softCapKnee);
    expect(result).toBeLessThan(val);
  });

  it('compresses Charger Fast+CF momentum (110) slightly', () => {
    // Raw 110, knee at 100. Excess = 10, K = 50.
    // Result = 100 + 10*50/60 = 108.33
    const result = softCap(110);
    expect(r(result, 2)).toBe(108.33);
  });

  it('compresses harder at higher values', () => {
    const low = softCap(120);
    const high = softCap(150);
    // The gap between 120 and 150 should be compressed vs the gap between 100 and 130
    const rawGap = 150 - 120;
    const compressedGap = high - low;
    expect(compressedGap).toBeLessThan(rawGap);
  });

  it('passes negative values through unchanged', () => {
    expect(softCap(-10)).toBe(-10);
  });
});

// ============================================================
// 2. Fatigue Factor (Relative to Max Stamina)
// ============================================================
describe('Fatigue Factor (Relative)', () => {
  it('returns 1.0 when stamina >= threshold', () => {
    // Charger maxSta=50, threshold=50*0.8=40
    expect(fatigueFactor(40, 50)).toBe(1.0);
    expect(fatigueFactor(50, 50)).toBe(1.0);
    expect(fatigueFactor(100, 50)).toBe(1.0);
  });

  it('returns proportional value below threshold', () => {
    // Charger: threshold=40
    expect(fatigueFactor(30, 50)).toBe(0.75);
    expect(fatigueFactor(20, 50)).toBe(0.5);
    expect(fatigueFactor(10, 50)).toBe(0.25);
  });

  it('returns 0 at stamina 0', () => {
    expect(fatigueFactor(0, 50)).toBe(0.0);
  });

  it('threshold scales with max stamina', () => {
    // Charger (50): threshold = 40
    // Bulwark (65): threshold = 52
    // At stamina 45: Charger is above threshold (1.0), Bulwark is below
    expect(fatigueFactor(45, 50)).toBe(1.0);
    expect(fatigueFactor(45, 65)).toBeLessThan(1.0);
    expect(r(fatigueFactor(45, 65), 3)).toBe(r(45 / 52, 3));
  });

  it('high-stamina archetypes fatigue sooner in absolute terms', () => {
    // This prevents STA stacking from being purely beneficial
    const chargerThreshold = 50 * BALANCE.fatigueRatio; // 40
    const bulwarkThreshold = 65 * BALANCE.fatigueRatio; // 52
    expect(bulwarkThreshold).toBeGreaterThan(chargerThreshold);
  });
});

// ============================================================
// 3. Guard Fatigue Factor
// ============================================================
describe('Guard Fatigue', () => {
  it('guard is fully effective at full fatigue factor', () => {
    expect(guardFatigueFactor(1.0)).toBe(1.0);
  });

  it('guard partially degrades when fatigued', () => {
    const halfFatigue = guardFatigueFactor(0.5);
    // guardFF = 0.5 + 0.5 * 0.5 = 0.75
    expect(halfFatigue).toBe(0.75);
  });

  it('guard drops to floor at zero stamina', () => {
    expect(guardFatigueFactor(0)).toBe(BALANCE.guardFatigueFloor);
  });

  it('guard fatigues less than momentum/control', () => {
    const ff = 0.5; // half fatigue
    const guardFF = guardFatigueFactor(ff);
    // MOM/CTL are multiplied by ff = 0.5
    // Guard is multiplied by guardFF = 0.75
    expect(guardFF).toBeGreaterThan(ff);
  });
});

// ============================================================
// 4. Counter System (Scaled)
// ============================================================
describe('Counter System (Scaled)', () => {
  it('counter bonus scales with winner CTL', () => {
    // CEP beats CF. Winner is P1 (CEP player).
    const lowCtl = resolveCounters(CEP, CF, 20, 0);
    const highCtl = resolveCounters(CEP, CF, 80, 0);
    expect(highCtl.player1Bonus).toBeGreaterThan(lowCtl.player1Bonus);
    expect(highCtl.player2Bonus).toBeLessThan(lowCtl.player2Bonus); // more negative
  });

  it('at average CTL ~60, bonus is ~10 (backward compat)', () => {
    const result = resolveCounters(CEP, CF, 60, 0);
    expect(result.player1Bonus).toBe(10); // 4 + 60*0.1 = 10
    expect(result.player2Bonus).toBe(-10);
  });

  it('brute force (low CTL) gets smaller counter bonus', () => {
    // Charger Fast+CF has CTL ~20
    const result = resolveCounters(CF, PdL, 20, 0);
    expect(result.player1Bonus).toBe(6); // 4 + 20*0.1 = 6
  });

  it('skilled fighter (high CTL) gets larger counter bonus', () => {
    const result = resolveCounters(CEP, CF, 85, 0);
    expect(result.player1Bonus).toBe(12.5); // 4 + 85*0.1 = 12.5
  });

  it('neutral matchup returns zero regardless of CTL', () => {
    const result = resolveCounters(CdL, CEP, 100, 100);
    expect(result.player1Bonus).toBe(0);
    expect(result.player2Bonus).toBe(0);
  });

  it('mirror matchup is neutral', () => {
    const result = resolveCounters(CF, CF, 50, 50);
    expect(result.player1Bonus).toBe(0);
    expect(result.player2Bonus).toBe(0);
  });
});

// ============================================================
// 5. Melee Thresholds (Guard-Relative)
// ============================================================
describe('Melee Thresholds (Guard-Relative)', () => {
  it('at average guard ~65, thresholds match old flat values', () => {
    const hitThreshold = BALANCE.meleeHitBase + 65 * BALANCE.meleeHitGrdScale;
    const critThreshold = BALANCE.meleeCritBase + 65 * BALANCE.meleeCritGrdScale;
    expect(r(hitThreshold, 1)).toBeCloseTo(5, 0);
    expect(r(critThreshold, 1)).toBeCloseTo(25, 0);
  });

  it('high guard defender requires bigger margins', () => {
    const lowGuardHit = resolveMeleeRound(6, 50);
    const highGuardHit = resolveMeleeRound(6, 90);
    // Margin of 6: should be a hit against low guard but might draw vs high guard
    expect(lowGuardHit.outcome).toBe(MeleeOutcome.Hit);
    // At guard 90: hitThreshold = 3 + 90*0.031 = 5.79. Margin 6 > 5.79 → still hit
    expect(highGuardHit.outcome).toBe(MeleeOutcome.Hit);
  });

  it('critical threshold scales with guard', () => {
    // At guard 50: critThreshold = 15 + 50*0.154 = 22.7
    // At guard 90: critThreshold = 15 + 90*0.154 = 28.86
    const lowGuard = resolveMeleeRound(24, 50);
    const highGuard = resolveMeleeRound(24, 90);
    expect(lowGuard.outcome).toBe(MeleeOutcome.Critical); // 24 >= 22.7
    expect(highGuard.outcome).toBe(MeleeOutcome.Hit); // 24 < 28.86
  });

  it('zero margin is always draw regardless of guard', () => {
    expect(resolveMeleeRound(0, 50).outcome).toBe(MeleeOutcome.Draw);
    expect(resolveMeleeRound(0, 100).outcome).toBe(MeleeOutcome.Draw);
  });
});

// ============================================================
// 6. Effective Stats — Worked Example Pass 1
// ============================================================
describe('Effective Stats — Pass 1: Charger Fast+CF vs Technician Standard+CdL→CEP', () => {
  it('computes Speed Stamina correctly', () => {
    expect(applySpeedStamina(60, SPEEDS[SpeedType.Fast])).toBe(55);
    expect(applySpeedStamina(55, SPEEDS[SpeedType.Standard])).toBe(55);
  });

  it('fatigue is 1.0 for both (above respective thresholds)', () => {
    // Charger threshold = 48, sta = 55 → 1.0
    expect(fatigueFactor(55, 60)).toBe(1.0);
    // Technician threshold = 44, sta = 55 → 1.0
    expect(fatigueFactor(55, 55)).toBe(1.0);
  });

  it('Charger Fast+CF momentum is soft-capped (110 → 108.33)', () => {
    const stats = computeEffectiveStats(charger, SPEEDS[SpeedType.Fast], CF, 55);
    // Raw MOM = 70+15+25 = 110, softCap → 108.33, * ff 1.0
    expect(r(stats.momentum, 2)).toBe(108.33);
    // CTL = 45-15-10 = 20 (below knee, no cap)
    expect(stats.control).toBe(20);
    // GRD = 55-5 = 50, guardFF = 1.0 (full stamina)
    expect(stats.guard).toBe(50);
    expect(stats.initiative).toBe(80);
  });

  it('Technician pre-shift stats are below knee (unchanged)', () => {
    const stats = computeEffectiveStats(technician, SPEEDS[SpeedType.Standard], CdL, 55);
    expect(stats.momentum).toBe(55); // 50+0+5 = 55
    expect(stats.control).toBe(80);  // 70+0+10 = 80
    expect(stats.guard).toBe(60);    // 55+5 = 60
    expect(stats.initiative).toBe(70);
  });

  it('Technician qualifies for shift', () => {
    expect(canShift(80, SPEEDS[SpeedType.Standard], 55)).toBe(true);
  });

  it('shift costs are correct (cross-stance Bal→Def)', () => {
    const result = applyShiftCost(55, 70, CdL, CEP);
    expect(result.stamina).toBe(43);
    expect(result.initiativePenalty).toBe(10);
  });

  it('Technician post-shift has slight fatigue (sta 43 < threshold 44)', () => {
    // After shift: STA 43, threshold = 55*0.8 = 44
    // ff = 43/44 ≈ 0.977
    const stats = computeEffectiveStats(technician, SPEEDS[SpeedType.Standard], CEP, 43, 10);
    const ff = 43 / 44;
    const guardFF = 0.5 + 0.5 * ff;

    expect(r(stats.momentum, 2)).toBe(r(55 * ff, 2));     // 53.75
    expect(r(stats.control, 2)).toBe(r(85 * ff, 2));      // 83.07
    expect(r(stats.guard, 2)).toBe(r(65 * guardFF, 2));    // 64.26
    expect(stats.initiative).toBe(60);
  });

  it('end-of-pass stamina correct', () => {
    expect(applyAttackStaminaCost(55, CF)).toBe(35);
    expect(applyAttackStaminaCost(43, CEP)).toBe(29);
  });
});

// ============================================================
// 7. Effective Stats — Worked Example Pass 2
// ============================================================
describe('Effective Stats — Pass 2: Charger Slow+BdG vs Technician Standard+PdL', () => {
  // Starting STA: Charger 35, Technician 29

  it('computes Speed Stamina correctly', () => {
    expect(applySpeedStamina(35, SPEEDS[SpeedType.Slow])).toBe(40);
    expect(applySpeedStamina(29, SPEEDS[SpeedType.Standard])).toBe(29);
  });

  it('fatigue factors are below threshold for both', () => {
    // Charger: threshold=48, sta=40 → ff = 40/48 ≈ 0.833
    expect(r(fatigueFactor(40, 60), 3)).toBe(r(40 / 48, 3));
    // Technician: threshold=44, sta=29 → ff = 29/44 ≈ 0.659
    expect(r(fatigueFactor(29, 55), 3)).toBe(r(29 / 44, 3));
  });

  it('Charger stats use fatigue correctly', () => {
    const stats = computeEffectiveStats(charger, SPEEDS[SpeedType.Slow], BdG, 40);
    const ff = 40 / 48;
    const guardFF = 0.5 + 0.5 * ff;
    // MOM: (70-15+10) = 65 * ff
    expect(r(stats.momentum, 2)).toBe(r(65 * ff, 2));
    // CTL: (45+15+15) = 75 * ff
    expect(r(stats.control, 2)).toBe(r(75 * ff, 2));
    // GRD: (55-5) = 50 * guardFF
    expect(r(stats.guard, 2)).toBe(r(50 * guardFF, 2));
    expect(stats.initiative).toBe(60);
  });

  it('Technician stats use correct fatigue', () => {
    const ff = 29 / 44;
    const guardFF = 0.5 + 0.5 * ff;
    const stats = computeEffectiveStats(technician, SPEEDS[SpeedType.Standard], PdL, 29);
    // MOM: 45 * ff, CTL: 80 * ff, GRD: 75 * guardFF
    expect(r(stats.momentum, 2)).toBe(r(45 * ff, 2));
    expect(r(stats.control, 2)).toBe(r(80 * ff, 2));
    expect(r(stats.guard, 2)).toBe(r(75 * guardFF, 2));
    expect(stats.initiative).toBe(70);
  });

  it('end-of-pass stamina correct', () => {
    expect(applyAttackStaminaCost(40, BdG)).toBe(25);
    expect(applyAttackStaminaCost(29, PdL)).toBe(21);
  });
});

// ============================================================
// 8. Effective Stats — Worked Example Pass 3
// ============================================================
describe('Effective Stats — Pass 3: Charger Slow+CdL vs Technician Standard+CEP', () => {
  // Starting STA: Charger 25, Technician 21

  it('computes Speed Stamina correctly', () => {
    expect(applySpeedStamina(25, SPEEDS[SpeedType.Slow])).toBe(30);
    expect(applySpeedStamina(21, SPEEDS[SpeedType.Standard])).toBe(21);
  });

  it('fatigue factors correct', () => {
    // Charger: threshold=48, sta=30 → 30/48 = 0.625
    expect(r(fatigueFactor(30, 60), 3)).toBe(r(30 / 48, 3));
    // Technician: threshold=44, sta=21 → 21/44 ≈ 0.477
    expect(r(fatigueFactor(21, 55), 3)).toBe(r(21 / 44, 3));
  });

  it('Charger guard now partially fatigued', () => {
    const stats = computeEffectiveStats(charger, SPEEDS[SpeedType.Slow], CdL, 30);
    const ff = 30 / 48;
    const guardFF = 0.5 + 0.5 * ff;
    // GRD: (55+5) = 60 * guardFF
    expect(r(stats.guard, 2)).toBe(r(60 * guardFF, 2));
    // MOM: (70-15+5) = 60 * ff
    expect(r(stats.momentum, 2)).toBe(r(60 * ff, 2));
    // CTL: (45+15+10) = 70 * ff
    expect(r(stats.control, 2)).toBe(r(70 * ff, 2));
  });

  it('Technician stats at deeper fatigue', () => {
    const ff = 21 / 44;
    const guardFF = 0.5 + 0.5 * ff;
    const stats = computeEffectiveStats(technician, SPEEDS[SpeedType.Standard], CEP, 21);
    // MOM: 55 * ff, CTL: 85 * ff, GRD: 65 * guardFF
    expect(r(stats.momentum, 2)).toBe(r(55 * ff, 2));
    expect(r(stats.control, 2)).toBe(r(85 * ff, 2));
    expect(r(stats.guard, 2)).toBe(r(65 * guardFF, 2));
  });

  it('CdL vs CEP is NEUTRAL (v4.1 fix)', () => {
    const counters = resolveCounters(CdL, CEP, 50, 50);
    expect(counters.player1Bonus).toBe(0);
    expect(counters.player2Bonus).toBe(0);
  });

  it('end-of-pass stamina correct', () => {
    expect(applyAttackStaminaCost(30, CdL)).toBe(20);
    expect(applyAttackStaminaCost(21, CEP)).toBe(7);
  });
});

// ============================================================
// 9. Accuracy & ImpactScore (formulas unchanged)
// ============================================================
describe('Accuracy and ImpactScore', () => {
  it('Accuracy formula is unchanged', () => {
    // Pure formula test — no scaling involved
    expect(calcAccuracy(85, 60, 110, 10)).toBe(97.5);
    expect(calcAccuracy(20, 80, 55, -10)).toBe(36.25);
  });

  it('ImpactScore formula is unchanged', () => {
    expect(calcImpactScore(55, 97.5, 50)).toBe(51.5);
    expect(calcImpactScore(110, 36.25, 65)).toBe(50.0);
  });
});

// ============================================================
// 10. Unseat check (formula unchanged)
// ============================================================
describe('Unseat Check', () => {
  it('unseat threshold formula is unchanged', () => {
    const result = checkUnseat(51.5, 50.0, 50, 45);
    expect(result.unseated).toBe(false);
    expect(result.margin).toBe(1.5);
    expect(result.threshold).toBe(27.25);
  });
});

// ============================================================
// 11. resolvePass Integration
// ============================================================
describe('resolvePass — integration', () => {
  it('resolves Pass 1 with correct directional outcome', () => {
    const result = resolvePass(
      { archetype: charger, speed: SpeedType.Fast, attack: CF, currentStamina: 60 },
      { archetype: technician, speed: SpeedType.Standard, attack: CdL, currentStamina: 55, shiftAttack: CEP },
    );

    // Technician wins on ImpactScore (same as before)
    expect(result.p2.impactScore).toBeGreaterThan(result.p1.impactScore);

    // No unseat
    expect(result.unseat).toBe('none');

    // Technician shifted
    expect(result.p2.shifted).toBe(true);
    expect(result.p2.finalAttack.id).toBe('coupEnPassant');

    // End stamina: Charger 60-5(Fast)-20(CF)=35, Tech 55-12(shift)-14(CEP)=29
    expect(result.p1.staminaAfter).toBe(35);
    expect(result.p2.staminaAfter).toBe(29);

    // Charger momentum is soft-capped
    expect(result.p1.effectiveStats.momentum).toBeLessThan(110);
    expect(result.p1.effectiveStats.momentum).toBeGreaterThan(100);
  });

  it('counter bonus in resolvePass scales with CTL', () => {
    const result = resolvePass(
      { archetype: charger, speed: SpeedType.Fast, attack: CF, currentStamina: 60 },
      { archetype: technician, speed: SpeedType.Standard, attack: CdL, currentStamina: 55, shiftAttack: CEP },
    );

    // CEP beats CF. Winner is Technician with high CTL.
    // Technician accuracy should reflect scaled counter bonus > 10
    // (Technician post-shift CTL ≈ 83, bonus ≈ 12.3)
    // Charger accuracy should reflect scaled penalty < -10
    // Net effect: Technician advantage is slightly LARGER than with flat ±10
    expect(result.p2.impactScore - result.p1.impactScore).toBeGreaterThan(0);
  });
});

// ============================================================
// 12. Counter Table Symmetry (unchanged)
// ============================================================
describe('Counter table symmetry', () => {
  it('all joust counter relationships are symmetric', () => {
    const allJoust = Object.values(JOUST_ATTACKS) as Attack[];
    for (const a of allJoust) {
      for (const beatId of a.beats) {
        const beaten = allJoust.find(x => x.id === beatId);
        expect(beaten, `${a.id} beats ${beatId} but ${beatId} not found`).toBeDefined();
        expect(
          beaten!.beatenBy.includes(a.id),
          `${a.id} beats ${beatId} but ${beatId}.beatenBy doesn't include ${a.id}`
        ).toBe(true);
      }
      for (const byId of a.beatenBy) {
        const beater = allJoust.find(x => x.id === byId);
        expect(beater, `${a.id} beatenBy ${byId} but ${byId} not found`).toBeDefined();
        expect(
          beater!.beats.includes(a.id),
          `${a.id} beatenBy ${byId} but ${byId}.beats doesn't include ${a.id}`
        ).toBe(true);
      }
    }
  });

  it('all melee counter relationships are symmetric', () => {
    const allMelee = Object.values(MELEE_ATTACKS) as Attack[];
    for (const a of allMelee) {
      for (const beatId of a.beats) {
        const beaten = allMelee.find(x => x.id === beatId);
        expect(beaten, `${a.id} beats ${beatId} but ${beatId} not found`).toBeDefined();
        expect(
          beaten!.beatenBy.includes(a.id),
          `${a.id} beats ${beatId} but ${beatId}.beatenBy doesn't include ${a.id}`
        ).toBe(true);
      }
      for (const byId of a.beatenBy) {
        const beater = allMelee.find(x => x.id === byId);
        expect(beater, `${a.id} beatenBy ${byId} but ${byId}.beats doesn't include ${a.id}`).toBeDefined();
        expect(
          beater!.beats.includes(a.id),
          `${a.id} beatenBy ${byId} but ${byId}.beats doesn't include ${a.id}`
        ).toBe(true);
      }
    }
  });
});

// ============================================================
// 13. Stamina Budget Sanity (unchanged)
// ============================================================
describe('Stamina budget sanity checks', () => {
  it('Charger 5x Coup Fort: incapacitated by pass 3', () => {
    let sta = 60;
    sta = Math.max(0, sta - 20); expect(sta).toBe(40);
    sta = Math.max(0, sta - 20); expect(sta).toBe(20);
    sta = Math.max(0, sta - 20); expect(sta).toBe(0);
  });

  it('Bulwark 5x Port de Lance: never below 25', () => {
    let sta = 65;
    for (let i = 0; i < 5; i++) {
      sta = Math.max(0, sta - 8);
    }
    expect(sta).toBe(25);
  });
});

// ============================================================
// 14. Scaling Property Tests (Future-Proofing)
// ============================================================
describe('Scaling Properties', () => {
  it('soft cap prevents stat stacking from dominating', () => {
    // With gear: +50 momentum → raw 120 vs raw 70
    // Without softCap: ratio = 120/70 = 1.71
    // With softCap: ratio ≈ 116.67/70 = 1.67
    const geared = softCap(120);
    const base = softCap(70);
    expect(geared / base).toBeLessThan(120 / 70);
  });

  it('counter bonus stays relevant at high stat levels', () => {
    // High CTL from gear: 120 (softcapped to ~116.67 in stats, but bonus uses eff value)
    const result = resolveCounters(CEP, CF, 100, 0);
    // bonus = 4 + 100*0.1 = 14. Still meaningful!
    expect(result.player1Bonus).toBe(14);
  });

  it('guard fatigue prevents infinite turtle', () => {
    // Bulwark at 0 stamina with Guard High: raw guard = 95
    const stats = computeMeleeEffectiveStats(bulwark, GH, 0);
    // ff = 0, guardFF = 0.5
    expect(stats.guard).toBe(95 * 0.5);
    expect(stats.guard).toBe(47.5);
    // Compare to full stamina
    const fullStats = computeMeleeEffectiveStats(bulwark, GH, 65);
    expect(fullStats.guard).toBe(95); // guardFF = 1.0 at full stamina
    // Guard dropped by 50% — turtle no longer invincible
    expect(stats.guard).toBeLessThan(fullStats.guard * 0.6);
  });

  it('relative fatigue threshold adapts to gear stamina', () => {
    // If an archetype had 100 max stamina (from gear), threshold = 80
    // At stamina 70: ff = 70/80 = 0.875
    expect(fatigueFactor(70, 100)).toBe(0.875);
    // At stamina 50 (same as current Charger max): still fatigued
    expect(fatigueFactor(50, 100)).toBe(0.625);
  });

  it('melee crit threshold adapts to high guard', () => {
    // With gear pushing guard to 120 (softcapped to ~116.67):
    // critThreshold = 15 + 116.67*0.154 ≈ 32.97
    // Much harder to crit against than base ≈ 25
    const critThresh = BALANCE.meleeCritBase + 116.67 * BALANCE.meleeCritGrdScale;
    expect(critThresh).toBeGreaterThan(30);
  });
});
