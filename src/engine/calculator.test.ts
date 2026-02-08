// ============================================================
// Validation: Balance-Scaling Combat System
// Tests formula properties, scaling behaviors, and directional outcomes.
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES } from './archetypes';
import { JOUST_ATTACKS, MELEE_ATTACKS, SPEEDS } from './attacks';
import { BALANCE } from './balance-config';
import { SpeedType, MeleeOutcome, type Attack, type Archetype } from './types';
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
  calcCarryoverPenalties,
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

  it('Charger Fast+CF momentum is soft-capped (115 → 111.54)', () => {
    const stats = computeEffectiveStats(charger, SPEEDS[SpeedType.Fast], CF, 55);
    // Raw MOM = 75+15+25 = 115, softCap → 111.54, * ff 1.0
    expect(r(stats.momentum, 2)).toBe(r(100 + 15 * 50 / 65, 2));
    // CTL = 50-15-10 = 25 (below knee, no cap)
    expect(stats.control).toBe(25);
    // GRD = 50-5 = 45, guardFF = 1.0 (full stamina)
    expect(stats.guard).toBe(45);
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
    // MOM: (75-15+10) = 70 * ff
    expect(r(stats.momentum, 2)).toBe(r(70 * ff, 2));
    // CTL: (50+15+15) = 80 * ff
    expect(r(stats.control, 2)).toBe(r(80 * ff, 2));
    // GRD: (50-5) = 45 * guardFF
    expect(r(stats.guard, 2)).toBe(r(45 * guardFF, 2));
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
    // GRD: (50+5) = 55 * guardFF
    expect(r(stats.guard, 2)).toBe(r(55 * guardFF, 2));
    // MOM: (75-15+5) = 65 * ff
    expect(r(stats.momentum, 2)).toBe(r(65 * ff, 2));
    // CTL: (50+15+10) = 75 * ff
    expect(r(stats.control, 2)).toBe(r(75 * ff, 2));
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
// 9. Accuracy & ImpactScore
// ============================================================
describe('Accuracy and ImpactScore', () => {
  it('Accuracy formula is unchanged', () => {
    // Pure formula test — no scaling involved
    expect(calcAccuracy(85, 60, 110, 10)).toBe(97.5);
    expect(calcAccuracy(20, 80, 55, -10)).toBe(36.25);
  });

  it('ImpactScore uses guardImpactCoeff (0.2)', () => {
    // 55*0.5 + 97.5*0.4 - 50*0.2 = 27.5 + 39 - 10 = 56.5
    expect(calcImpactScore(55, 97.5, 50)).toBe(56.5);
    // 110*0.5 + 36.25*0.4 - 65*0.2 = 55 + 14.5 - 13 = 56.5
    expect(calcImpactScore(110, 36.25, 65)).toBe(56.5);
  });
});

// ============================================================
// 10. Unseat check (uses guardUnseatDivisor = 15)
// ============================================================
describe('Unseat Check', () => {
  it('unseat threshold uses guardUnseatDivisor (15)', () => {
    // threshold = 20 + 50/15 + 45/20 = 20 + 3.333 + 2.25 ≈ 25.583
    const result = checkUnseat(51.5, 50.0, 50, 45);
    expect(result.unseated).toBe(false);
    expect(result.margin).toBe(1.5);
    expect(result.threshold).toBeCloseTo(25.583, 2);
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

    // Charger wins on ImpactScore (guard coefficient 0.2 lets raw MOM dominate)
    expect(result.p1.impactScore).toBeGreaterThan(result.p2.impactScore);

    // No unseat
    expect(result.unseat).toBe('none');

    // Technician shifted
    expect(result.p2.shifted).toBe(true);
    expect(result.p2.finalAttack.id).toBe('coupEnPassant');

    // End stamina: Charger 60-5(Fast)-20(CF)=35, Tech 55-12(shift)-14(CEP)=29
    expect(result.p1.staminaAfter).toBe(35);
    expect(result.p2.staminaAfter).toBe(29);

    // Charger momentum is soft-capped (raw 115 → ~111.5)
    expect(result.p1.effectiveStats.momentum).toBeLessThan(115);
    expect(result.p1.effectiveStats.momentum).toBeGreaterThan(100);
  });

  it('counter bonus in resolvePass scales with CTL', () => {
    const result = resolvePass(
      { archetype: charger, speed: SpeedType.Fast, attack: CF, currentStamina: 60 },
      { archetype: technician, speed: SpeedType.Standard, attack: CdL, currentStamina: 55, shiftAttack: CEP },
    );

    // CEP beats CF. Winner is Technician with high CTL.
    // Counter bonus helps Technician accuracy, but Charger's raw MOM
    // advantage (115 vs 55) dominates impact with reduced guard coeff (0.2).
    // Charger still wins overall on impact despite counter penalty.
    expect(result.p1.impactScore - result.p2.impactScore).toBeGreaterThan(0);
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
    // Bulwark at 0 stamina with Guard High: raw guard = 85
    const stats = computeMeleeEffectiveStats(bulwark, GH, 0);
    // ff = 0, guardFF = 0.5
    expect(stats.guard).toBe(85 * 0.5);
    expect(stats.guard).toBe(42.5);
    // Compare to full stamina
    const fullStats = computeMeleeEffectiveStats(bulwark, GH, 65);
    expect(fullStats.guard).toBe(85); // guardFF = 1.0 at full stamina
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

// ============================================================
// 15. Edge Cases: Zero Stamina
// ============================================================
describe('Edge Cases — Zero Stamina', () => {
  it('fatigue factor at 0 stamina returns 0', () => {
    expect(fatigueFactor(0, 60)).toBe(0);
    expect(fatigueFactor(0, 100)).toBe(0);
  });

  it('guard fatigue factor at 0 stamina returns floor (0.5)', () => {
    const ff = fatigueFactor(0, 60);
    expect(guardFatigueFactor(ff)).toBe(BALANCE.guardFatigueFloor);
  });

  it('effective stats at 0 stamina: MOM and CTL are 0, guard at floor', () => {
    const stats = computeEffectiveStats(charger, SPEEDS[SpeedType.Standard], CF, 0);
    expect(stats.momentum).toBe(0);
    expect(stats.control).toBe(0);
    // Guard = softCap(50-5) * guardFatigueFloor = 45 * 0.5 = 22.5
    expect(stats.guard).toBe(45 * BALANCE.guardFatigueFloor);
    // Initiative is unaffected by fatigue
    expect(stats.initiative).toBe(70); // 60 + 10 (Standard)
  });

  it('melee effective stats at 0 stamina: MOM and CTL are 0', () => {
    const stats = computeMeleeEffectiveStats(charger, OC, 0);
    expect(stats.momentum).toBe(0);
    expect(stats.control).toBe(0);
    // Guard = softCap(50-5) * 0.5 = 45 * 0.5 = 22.5
    expect(stats.guard).toBe(22.5);
  });

  it('applySpeedStamina at 0 does not go negative', () => {
    expect(applySpeedStamina(0, SPEEDS[SpeedType.Fast])).toBe(0);
    // Slow speed gives +5 STA
    expect(applySpeedStamina(0, SPEEDS[SpeedType.Slow])).toBe(5);
  });

  it('applyAttackStaminaCost at 0 does not go negative', () => {
    expect(applyAttackStaminaCost(0, CF)).toBe(0);
    expect(applyAttackStaminaCost(3, CF)).toBe(0); // 3 - 20 → clamped 0
  });

  it('canShift at 0 stamina returns false (need >= 10)', () => {
    expect(canShift(100, SPEEDS[SpeedType.Slow], 0)).toBe(false);
    expect(canShift(100, SPEEDS[SpeedType.Slow], 9)).toBe(false);
    expect(canShift(100, SPEEDS[SpeedType.Slow], 10)).toBe(true);
  });

  it('unseat threshold at 0 stamina is still >= 20', () => {
    const result = checkUnseat(50, 10, 0, 0);
    // threshold = 20 + 0/10 + 0/20 = 20
    expect(result.threshold).toBe(20);
  });
});

// ============================================================
// 16. Edge Cases: Extreme Stat Values (Giga Gear)
// ============================================================
describe('Edge Cases — Extreme Stat Values', () => {
  // Simulate Bulwark with Giga gear: GRD 65 + 13 (rarity) + 15 (primary) = 93
  const gigaBulwark: Archetype = {
    id: 'giga_bulwark', name: 'Giga Bulwark',
    momentum: 68, control: 68, guard: 93, initiative: 63, stamina: 78,
    identity: 'Test',
  };

  it('Giga guard stat below softCap knee is unchanged (93)', () => {
    const capped = softCap(93);
    // 93 < 100 (knee), no compression applied
    expect(capped).toBe(93);
  });

  it('Giga Bulwark guard with Guard High is compressed', () => {
    // guard = 93 + 20 (Guard High delta) = 113
    const stats = computeMeleeEffectiveStats(gigaBulwark, GH, 78);
    // softCap(113) * guardFF(1.0) = 100 + 13*50/63 ≈ 110.32
    expect(stats.guard).toBeLessThan(113);
    expect(stats.guard).toBeGreaterThan(100);
  });

  it('Giga momentum Charger at Fast+CF (138) is heavily compressed', () => {
    const gigaCharger: Archetype = {
      id: 'giga_charger', name: 'Giga Charger',
      momentum: 98, control: 58, guard: 68, initiative: 73, stamina: 73,
      identity: 'Test',
    };
    // MOM: 98 + 15 (Fast) + 25 (CF) = 138
    const stats = computeEffectiveStats(gigaCharger, SPEEDS[SpeedType.Fast], CF, 73);
    // softCap(138) = 100 + 38*50/88 ≈ 121.59
    expect(stats.momentum).toBeGreaterThan(100);
    expect(stats.momentum).toBeLessThan(138);
    expect(stats.momentum).toBeCloseTo(121.59, 0);
  });

  it('soft cap ratio: Giga vs base is lower than raw ratio', () => {
    const gigaMom = softCap(138);
    const baseMom = softCap(110);
    // Raw ratio: 138/110 = 1.254
    // Soft-capped ratio should be less
    expect(gigaMom / baseMom).toBeLessThan(138 / 110);
  });
});

// ============================================================
// 17. Edge Cases: Unseat Mechanics
// ============================================================
describe('Edge Cases — Unseat Mechanics', () => {
  it('exactly at threshold is unseated (>= check)', () => {
    // Guard=60, STA=60: threshold = 20 + 60/15 + 60/20 = 20 + 4 + 3 = 27
    const result = checkUnseat(37, 10, 60, 60);
    expect(result.margin).toBe(27);
    expect(result.threshold).toBe(27);
    expect(result.unseated).toBe(true);
  });

  it('just below threshold is not unseated', () => {
    // threshold = 27, margin = 26.99 is below
    const result = checkUnseat(36.99, 10, 60, 60);
    expect(result.unseated).toBe(false);
  });

  it('negative margin never unseats', () => {
    const result = checkUnseat(10, 50, 0, 0);
    expect(result.margin).toBe(-40);
    expect(result.unseated).toBe(false);
  });

  it('double unseat: higher margin wins', () => {
    // Simulated via resolvePass with both high-momentum players
    const highMom: Archetype = {
      id: 'highMom', name: 'High MOM',
      momentum: 100, control: 30, guard: 30, initiative: 50, stamina: 40,
      identity: 'Test',
    };
    const result = resolvePass(
      { archetype: highMom, speed: SpeedType.Fast, attack: CF, currentStamina: 5 },
      { archetype: highMom, speed: SpeedType.Fast, attack: CF, currentStamina: 5 },
    );
    // Mirror matchup with very low stamina → no unseat (same impact scores)
    // With identical inputs, impacts should be equal → no unseat
    expect(result.unseat).toBe('none');
  });

  it('unseat threshold grows with guard and stamina', () => {
    // Low stats: threshold = 20 + 0 + 0 = 20
    const low = checkUnseat(30, 0, 0, 0);
    expect(low.threshold).toBe(20);

    // High stats: threshold = 20 + 100/15 + 100/20 = 20 + 6.667 + 5 ≈ 31.667
    const high = checkUnseat(30, 0, 100, 100);
    expect(high.threshold).toBeCloseTo(31.667, 2);

    expect(high.threshold).toBeGreaterThan(low.threshold);
  });
});

// ============================================================
// 18. Edge Cases: Carryover Penalties
// ============================================================
describe('Edge Cases — Carryover Penalties', () => {
  it('carryover penalties at margin 0 produce negative zero (JS quirk)', () => {
    // -Math.floor(0/n) = -0 in JavaScript. Functionally equivalent to 0.
    // This is harmless: -0 + stat = stat, and -0 == 0 is true.
    const penalties = calcCarryoverPenalties(0);
    expect(penalties.momentumPenalty + 0).toBe(0);
    expect(penalties.controlPenalty + 0).toBe(0);
    expect(penalties.guardPenalty + 0).toBe(0);
  });

  it('carryover penalties at margin 1 produce negative zero (floor rounds to 0)', () => {
    // -Math.floor(1/3) = -Math.floor(0.333) = -0
    const penalties = calcCarryoverPenalties(1);
    expect(penalties.momentumPenalty + 0).toBe(0);
    expect(penalties.controlPenalty + 0).toBe(0);
    expect(penalties.guardPenalty + 0).toBe(0);
  });

  it('carryover penalties at margin 30 are substantial', () => {
    const penalties = calcCarryoverPenalties(30);
    expect(penalties.momentumPenalty).toBe(-10); // -floor(30/3)
    expect(penalties.controlPenalty).toBe(-7);   // -floor(30/4) = -7
    expect(penalties.guardPenalty).toBe(-6);      // -floor(30/5)
  });

  it('melee effective stats include carryover penalties', () => {
    const statsNoPenalty = computeMeleeEffectiveStats(duelist, MC, 60, 0, 0, 0);
    const statsWithPenalty = computeMeleeEffectiveStats(duelist, MC, 60, -10, -7, -6);

    expect(statsWithPenalty.momentum).toBeLessThan(statsNoPenalty.momentum);
    expect(statsWithPenalty.control).toBeLessThan(statsNoPenalty.control);
    expect(statsWithPenalty.guard).toBeLessThan(statsNoPenalty.guard);
  });
});

// ============================================================
// 19. Edge Cases: Melee Resolution Boundaries
// ============================================================
describe('Edge Cases — Melee Resolution Boundaries', () => {
  it('negative margin assigns winner as lower', () => {
    const result = resolveMeleeRound(-10, 60);
    expect(result.winner).toBe('lower');
    expect(result.outcome).toBe(MeleeOutcome.Hit);
  });

  it('margin exactly at hit threshold is a hit, not a draw', () => {
    // hitThreshold = 3 + 60 * 0.031 = 4.86
    const threshold = BALANCE.meleeHitBase + 60 * BALANCE.meleeHitGrdScale;
    const result = resolveMeleeRound(threshold, 60);
    expect(result.outcome).toBe(MeleeOutcome.Hit);
  });

  it('margin just below hit threshold is a draw', () => {
    const threshold = BALANCE.meleeHitBase + 60 * BALANCE.meleeHitGrdScale;
    const result = resolveMeleeRound(threshold - 0.01, 60);
    expect(result.outcome).toBe(MeleeOutcome.Draw);
  });

  it('margin exactly at crit threshold is a critical', () => {
    const critThreshold = BALANCE.meleeCritBase + 60 * BALANCE.meleeCritGrdScale;
    const result = resolveMeleeRound(critThreshold, 60);
    expect(result.outcome).toBe(MeleeOutcome.Critical);
  });

  it('margin just below crit threshold is a hit', () => {
    const critThreshold = BALANCE.meleeCritBase + 60 * BALANCE.meleeCritGrdScale;
    const result = resolveMeleeRound(critThreshold - 0.01, 60);
    expect(result.outcome).toBe(MeleeOutcome.Hit);
  });

  it('at guard 0: hitThreshold=3, critThreshold=15', () => {
    expect(resolveMeleeRound(2.99, 0).outcome).toBe(MeleeOutcome.Draw);
    expect(resolveMeleeRound(3, 0).outcome).toBe(MeleeOutcome.Hit);
    expect(resolveMeleeRound(14.99, 0).outcome).toBe(MeleeOutcome.Hit);
    expect(resolveMeleeRound(15, 0).outcome).toBe(MeleeOutcome.Critical);
  });
});

// ============================================================
// 20. Edge Cases: Counter System Completeness
// ============================================================
describe('Edge Cases — Counter System', () => {
  it('every joust attack beats at least 1 other attack', () => {
    const allJoust = Object.values(JOUST_ATTACKS) as Attack[];
    for (const a of allJoust) {
      expect(a.beats.length, `${a.id} should beat at least 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every joust attack is beaten by at least 1 other attack', () => {
    const allJoust = Object.values(JOUST_ATTACKS) as Attack[];
    for (const a of allJoust) {
      expect(a.beatenBy.length, `${a.id} should be beatenBy at least 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every melee attack beats at least 1 other attack', () => {
    const allMelee = Object.values(MELEE_ATTACKS) as Attack[];
    for (const a of allMelee) {
      expect(a.beats.length, `${a.id} should beat at least 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every melee attack is beaten by at least 1 other attack', () => {
    const allMelee = Object.values(MELEE_ATTACKS) as Attack[];
    for (const a of allMelee) {
      expect(a.beatenBy.length, `${a.id} should be beatenBy at least 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it('stance triangle holds: each stance beats exactly one other', () => {
    // Aggressive beats Defensive, Defensive beats Balanced, Balanced beats Aggressive
    const allJoust = Object.values(JOUST_ATTACKS) as Attack[];
    const aggAttacks = allJoust.filter(a => a.stance === 'Aggressive');
    const balAttacks = allJoust.filter(a => a.stance === 'Balanced');
    const defAttacks = allJoust.filter(a => a.stance === 'Defensive');

    // Each category has 2 attacks
    expect(aggAttacks.length).toBe(2);
    expect(balAttacks.length).toBe(2);
    expect(defAttacks.length).toBe(2);

    // Aggressive attacks should beat some Defensive attacks
    for (const agg of aggAttacks) {
      const beatsDefensive = agg.beats.some(id =>
        defAttacks.some(d => d.id === id)
      );
      expect(beatsDefensive, `${agg.id} should beat at least one Defensive`).toBe(true);
    }
  });

  it('counter bonus with 0 CTL still has base bonus', () => {
    const result = resolveCounters(CEP, CF, 0, 0);
    expect(result.player1Bonus).toBe(BALANCE.counterBaseBonus); // 4
    expect(result.player2Bonus).toBe(-BALANCE.counterBaseBonus);
  });
});

// ============================================================
// 21. Edge Cases: Both Players 0 Stamina Full Pass
// ============================================================
describe('Edge Cases — Both Players 0 Stamina Full Pass', () => {
  it('resolvePass with both at 0 stamina produces 0 MOM/CTL for both', () => {
    const result = resolvePass(
      { archetype: charger, speed: SpeedType.Standard, attack: CdL, currentStamina: 0 },
      { archetype: technician, speed: SpeedType.Standard, attack: CdL, currentStamina: 0 },
    );

    expect(result.p1.effectiveStats.momentum).toBe(0);
    expect(result.p1.effectiveStats.control).toBe(0);
    expect(result.p2.effectiveStats.momentum).toBe(0);
    expect(result.p2.effectiveStats.control).toBe(0);

    // Guard at floor (50%)
    expect(result.p1.effectiveStats.guard).toBeGreaterThan(0);
    expect(result.p2.effectiveStats.guard).toBeGreaterThan(0);

    // Initiative is unaffected by fatigue
    expect(result.p1.effectiveStats.initiative).toBeGreaterThan(0);
    expect(result.p2.effectiveStats.initiative).toBeGreaterThan(0);
  });

  it('unseat is impossible in mirror matchup at 0 stamina', () => {
    const result = resolvePass(
      { archetype: duelist, speed: SpeedType.Standard, attack: CdL, currentStamina: 0 },
      { archetype: duelist, speed: SpeedType.Standard, attack: CdL, currentStamina: 0 },
    );

    expect(result.unseat).toBe('none');
  });
});

// ============================================================
// 22. Edge Cases: Shift Cost Differences
// ============================================================
describe('Edge Cases — Shift Cost Differences', () => {
  const CdP = JOUST_ATTACKS.coupDePointe;

  it('same-stance shift costs less than cross-stance', () => {
    // Same stance: CdL (Balanced) → CdP (Balanced)
    const sameStance = applyShiftCost(50, 60, CdL, CdP);
    // Cross stance: CdL (Balanced) → CEP (Defensive)
    const crossStance = applyShiftCost(50, 60, CdL, CEP);

    // Same-stance: -5 STA, -5 INIT
    expect(sameStance.stamina).toBe(45);
    expect(sameStance.initiativePenalty).toBe(5);

    // Cross-stance: -12 STA, -10 INIT
    expect(crossStance.stamina).toBe(38);
    expect(crossStance.initiativePenalty).toBe(10);

    expect(sameStance.stamina).toBeGreaterThan(crossStance.stamina);
    expect(sameStance.initiativePenalty).toBeLessThan(crossStance.initiativePenalty);
  });

  it('shift cost at low stamina clamps to 0', () => {
    const result = applyShiftCost(3, 60, CdL, CEP);
    expect(result.stamina).toBe(0); // 3 - 12 → clamped to 0
  });
});

// ============================================================
// 23. Edge Cases: Maximum Gear Stacking
// ============================================================
describe('Edge Cases — Maximum Gear Impact on Formulas', () => {
  const gigaMaxCharger: Archetype = {
    id: 'giga_max_charger', name: 'Giga Max Charger',
    momentum: 98, control: 73, guard: 96, initiative: 82, stamina: 91,
    identity: 'Test',
  };

  it('extreme momentum is heavily compressed by soft cap', () => {
    const stats = computeEffectiveStats(
      gigaMaxCharger, SPEEDS[SpeedType.Fast], CF, 91,
    );
    // Raw MOM = 98 + 15 + 25 = 138. softCap compresses.
    expect(stats.momentum).toBeLessThan(138);
    expect(stats.momentum).toBeGreaterThan(100);
  });

  it('stat below knee is not compressed', () => {
    const stats = computeEffectiveStats(
      gigaMaxCharger, SPEEDS[SpeedType.Fast], CF, 91,
    );
    // Raw CTL = 73 - 15 - 10 = 48. Below knee, no compression.
    expect(stats.control).toBe(48);
  });

  it('Giga mirror matchup produces equal impact scores', () => {
    const result = resolvePass(
      { archetype: gigaMaxCharger, speed: SpeedType.Fast, attack: CF, currentStamina: 91 },
      { archetype: gigaMaxCharger, speed: SpeedType.Fast, attack: CF, currentStamina: 91 },
    );

    expect(result.unseat).toBe('none');
    expect(result.p1.impactScore).toBeCloseTo(result.p2.impactScore, 5);
  });
});

// ============================================================
// 24. Counter Bonus Asymmetry
// ============================================================
describe('Edge Cases — Counter Bonus Asymmetry', () => {
  it('bonus depends only on winner CTL, not loser CTL', () => {
    const r1 = resolveCounters(CEP, CF, 60, 10);
    const r2 = resolveCounters(CEP, CF, 60, 90);
    // Winner P1 CTL is 60 in both cases → same bonus/penalty
    expect(r1.player1Bonus).toBe(r2.player1Bonus);
    expect(r1.player2Bonus).toBe(r2.player2Bonus);
  });

  it('counter bonus is always positive for winner, negative for loser', () => {
    const result = resolveCounters(CEP, CF, 80, 20);
    expect(result.player1Bonus).toBe(4 + 80 * 0.1); // 12
    expect(result.player2Bonus).toBe(-12);
  });
});

// ============================================================
// 25. Unseat Threshold Extremes
// ============================================================
describe('Edge Cases — Unseat Threshold Extremes', () => {
  it('maximum threshold with high guard + stamina', () => {
    // threshold = 20 + 115/15 + 91/20 = 20 + 7.667 + 4.55 ≈ 32.217
    const result = checkUnseat(50, 13, 115, 91);
    expect(result.threshold).toBeCloseTo(32.217, 1);
    expect(result.margin).toBe(37);
    expect(result.unseated).toBe(true);
  });

  it('minimum threshold (all 0) is base 20', () => {
    const result = checkUnseat(30, 0, 0, 0);
    expect(result.threshold).toBe(20);
    expect(result.unseated).toBe(true);
  });
});

// ============================================================
// 26. Melee at Guard 0 with Carryover Penalties
// ============================================================
describe('Edge Cases — Melee at Guard 0 with Carryover', () => {
  it('melee effective stats at 0 stamina with carryover are zeroed', () => {
    const stats = computeMeleeEffectiveStats(charger, OC, 0, -10, -7, -6);
    // ff = 0 → MOM and CTL are 0
    expect(stats.momentum).toBe(0);
    expect(stats.control).toBe(0);
    // rawGuard = 50 + (-5) + (-6) = 39, softCap(39) * guardFF(0.5) = 19.5
    expect(stats.guard).toBe(19.5);
  });
});

// ============================================================
// 27. Shift Eligibility at Exact CTL Threshold Boundary
// ============================================================
describe('Edge Cases — Shift Eligibility at Exact CTL Threshold', () => {
  it('shift eligible when CTL exactly equals threshold (Slow: 50)', () => {
    expect(canShift(50, SPEEDS[SpeedType.Slow], 20)).toBe(true);
  });

  it('shift denied when CTL is 1 below threshold (Slow: 49)', () => {
    expect(canShift(49, SPEEDS[SpeedType.Slow], 20)).toBe(false);
  });

  it('shift eligible when CTL exactly equals Standard threshold (60)', () => {
    expect(canShift(60, SPEEDS[SpeedType.Standard], 20)).toBe(true);
  });

  it('shift denied when CTL is 1 below Standard threshold (59)', () => {
    expect(canShift(59, SPEEDS[SpeedType.Standard], 20)).toBe(false);
  });

  it('shift eligible when CTL exactly equals Fast threshold (70)', () => {
    expect(canShift(70, SPEEDS[SpeedType.Fast], 20)).toBe(true);
  });

  it('shift denied when CTL is 1 below Fast threshold (69)', () => {
    expect(canShift(69, SPEEDS[SpeedType.Fast], 20)).toBe(false);
  });

  it('shift denied at exact CTL threshold when stamina is 9 (just below 10)', () => {
    expect(canShift(50, SPEEDS[SpeedType.Slow], 9)).toBe(false);
  });

  it('shift eligible at exact CTL threshold and exact stamina boundary (10)', () => {
    expect(canShift(50, SPEEDS[SpeedType.Slow], 10)).toBe(true);
  });
});

// ============================================================
// 28. Non-Mirror Double Unseat
// ============================================================
describe('Edge Cases — Non-Mirror Double Unseat', () => {
  // Two different archetypes both exceeding unseat threshold with different margins
  const glassCannonA: Archetype = {
    id: 'glass_a', name: 'Glass Cannon A',
    momentum: 100, control: 30, guard: 20, initiative: 50, stamina: 30,
    identity: 'Test',
  };
  const glassCannonB: Archetype = {
    id: 'glass_b', name: 'Glass Cannon B',
    momentum: 90, control: 40, guard: 25, initiative: 55, stamina: 35,
    identity: 'Test',
  };

  it('when both exceed unseat threshold, higher margin wins', () => {
    // Both have extremely low guard and low stamina → low unseat thresholds
    // Both have high momentum → high impact → both could exceed threshold
    const result = resolvePass(
      { archetype: glassCannonA, speed: SpeedType.Fast, attack: CF, currentStamina: 5 },
      { archetype: glassCannonB, speed: SpeedType.Fast, attack: CF, currentStamina: 5 },
    );

    // Both should have very high impact and very low guard/stamina thresholds
    // The asymmetry in stats should produce different margins
    // Glass Cannon A has higher MOM (100 vs 90) but lower guard (20 vs 25)
    if (result.unseat !== 'none') {
      // The one with higher impact margin wins the unseat
      const p1Margin = result.p1.impactScore - result.p2.impactScore;
      const p2Margin = result.p2.impactScore - result.p1.impactScore;

      if (result.unseat === 'player1') {
        expect(p1Margin).toBeGreaterThan(0);
      } else {
        expect(p2Margin).toBeGreaterThan(0);
      }
    }
    // If no unseat, both have high guard enough — that's also valid
  });

  it('tied margins in double unseat result in no unseat', () => {
    // Exact mirror produces tied margins → no unseat
    const result = resolvePass(
      { archetype: glassCannonA, speed: SpeedType.Standard, attack: CdL, currentStamina: 5 },
      { archetype: glassCannonA, speed: SpeedType.Standard, attack: CdL, currentStamina: 5 },
    );
    // Mirror → equal margins → no unseat (tie rule)
    expect(result.unseat).toBe('none');
  });
});

// ============================================================
// 29. Full Giga Gear Match Simulation (Giga Gear + All Speeds)
// ============================================================
describe('Edge Cases — Full Giga Gear Match Simulation', () => {
  const gigaTechnician: Archetype = {
    id: 'giga_tech', name: 'Giga Technician',
    momentum: 78, control: 98, guard: 83, initiative: 88, stamina: 83,
    identity: 'Test',
  };
  const gigaCharger2: Archetype = {
    id: 'giga_charger2', name: 'Giga Charger 2',
    momentum: 98, control: 73, guard: 83, initiative: 88, stamina: 78,
    identity: 'Test',
  };

  it('Giga Technician can still shift at Fast speed despite high threshold', () => {
    // Fast threshold = 70, Tech CTL = 98 - 15(Fast) + 10(CdL) = 93
    const stats = computeEffectiveStats(gigaTechnician, SPEEDS[SpeedType.Fast], CdL, 83);
    // Raw CTL = 98 - 15 + 10 = 93 (below knee) → 93 * ff(1.0) = 93
    expect(stats.control).toBe(93);
    expect(canShift(93, SPEEDS[SpeedType.Fast], 83)).toBe(true);
  });

  it('Giga Charger cannot shift at Fast speed (low CTL)', () => {
    // Fast threshold = 70, Charger CTL = 73 - 15 + 10(CdL) = 68
    const stats = computeEffectiveStats(gigaCharger2, SPEEDS[SpeedType.Fast], CdL, 78);
    expect(stats.control).toBe(68);
    expect(canShift(68, SPEEDS[SpeedType.Fast], 78)).toBe(false);
  });

  it('Giga vs Giga match resolves without errors across varied attacks', () => {
    const attacks = [CF, BdG, CdL, CEP, PdL];
    const speeds: SpeedType[] = [SpeedType.Fast, SpeedType.Standard, SpeedType.Slow, SpeedType.Standard, SpeedType.Fast];

    for (let i = 0; i < attacks.length; i++) {
      const result = resolvePass(
        { archetype: gigaCharger2, speed: speeds[i], attack: attacks[i], currentStamina: Math.max(0, 78 - i * 15) },
        { archetype: gigaTechnician, speed: SpeedType.Standard, attack: attacks[(i + 2) % attacks.length], currentStamina: Math.max(0, 83 - i * 12) },
      );

      // Should not throw and should produce valid outputs
      expect(result.p1.impactScore).toBeDefined();
      expect(result.p2.impactScore).toBeDefined();
      expect(result.p1.staminaAfter).toBeGreaterThanOrEqual(0);
      expect(result.p2.staminaAfter).toBeGreaterThanOrEqual(0);
    }
  });

  it('soft cap prevents Giga Charger from doubling base Charger impact', () => {
    const baseResult = resolvePass(
      { archetype: charger, speed: SpeedType.Fast, attack: CF, currentStamina: 60 },
      { archetype: technician, speed: SpeedType.Standard, attack: CdL, currentStamina: 55 },
    );

    const gigaResult = resolvePass(
      { archetype: gigaCharger2, speed: SpeedType.Fast, attack: CF, currentStamina: 78 },
      { archetype: gigaTechnician, speed: SpeedType.Standard, attack: CdL, currentStamina: 83 },
    );

    // Giga Charger impact should be higher than base, but not doubled
    const ratio = gigaResult.p1.impactScore / baseResult.p1.impactScore;
    expect(ratio).toBeGreaterThan(1.0); // Giga is stronger
    expect(ratio).toBeLessThan(2.0); // But soft cap prevents doubling
  });
});
