// ============================================================
// Jousting — Combat Calculator (Scaling-Ready)
// ============================================================
import {
  SpeedType,
  Stance,
  MeleeOutcome,
  type Attack,
  type Archetype,
  type EffectiveStats,
  type CounterResult,
  type PlayerState,
  type SpeedData,
} from './types';
import { SPEEDS } from './attacks';
import { BALANCE } from './balance-config';

// --- Soft Cap (Diminishing Returns) ---
// Stats below the knee pass through unchanged.
// Stats above the knee have the excess compressed.

export function softCap(value: number): number {
  if (value <= BALANCE.softCapKnee) return value;
  const excess = value - BALANCE.softCapKnee;
  return BALANCE.softCapKnee + excess * BALANCE.softCapK / (excess + BALANCE.softCapK);
}

// --- 1.1 Fatigue Factor ---
// Proportional to max stamina (scales with gear).
// fatigueFactor = min(1.0, currentStamina / (maxStamina * fatigueRatio))

export function fatigueFactor(currentStamina: number, maxStamina: number): number {
  const threshold = maxStamina * BALANCE.fatigueRatio;
  if (currentStamina >= threshold) return 1.0;
  if (currentStamina <= 0) return 0.0;
  return currentStamina / threshold;
}

// --- Guard Fatigue Factor ---
// Guard fatigues partially: guardFF = floor + (1 - floor) * ff

export function guardFatigueFactor(ff: number): number {
  return BALANCE.guardFatigueFloor + (1 - BALANCE.guardFatigueFloor) * ff;
}

// --- 1.1 Effective Stats (Joust) ---
// Momentum & Control: soft-capped then fatigued.
// Guard: soft-capped then partially fatigued.
// Initiative: raw (no cap, no fatigue).

export function computeEffectiveStats(
  archetype: Archetype,
  speed: SpeedData,
  attack: Attack,
  currentStamina: number,
  initiativePenalty: number = 0,
  carryoverMom: number = 0,
  carryoverCtl: number = 0,
  carryoverGrd: number = 0,
): EffectiveStats {
  const ff = fatigueFactor(currentStamina, archetype.stamina);
  const guardFF = guardFatigueFactor(ff);

  const rawMomentum = archetype.momentum + speed.deltaMomentum + attack.deltaMomentum + carryoverMom;
  const rawControl = archetype.control + speed.deltaControl + attack.deltaControl + carryoverCtl;
  const rawGuard = archetype.guard + attack.deltaGuard + carryoverGrd;
  const rawInitiative = archetype.initiative + speed.deltaInitiative - initiativePenalty;

  return {
    momentum: softCap(rawMomentum) * ff,
    control: softCap(rawControl) * ff,
    guard: softCap(rawGuard) * guardFF,
    initiative: rawInitiative,
  };
}

// --- Effective Stats (Melee) ---
// Melee has no speed selection. Uses a "neutral" speed equivalent.

export function computeMeleeEffectiveStats(
  archetype: Archetype,
  attack: Attack,
  currentStamina: number,
  carryoverMom: number = 0,
  carryoverCtl: number = 0,
  carryoverGrd: number = 0,
): EffectiveStats {
  const ff = fatigueFactor(currentStamina, archetype.stamina);
  const guardFF = guardFatigueFactor(ff);

  const rawMomentum = archetype.momentum + attack.deltaMomentum + carryoverMom;
  const rawControl = archetype.control + attack.deltaControl + carryoverCtl;
  const rawGuard = archetype.guard + attack.deltaGuard + carryoverGrd;
  const rawInitiative = archetype.initiative;

  return {
    momentum: softCap(rawMomentum) * ff,
    control: softCap(rawControl) * ff,
    guard: softCap(rawGuard) * guardFF,
    initiative: rawInitiative,
  };
}

// --- 2.1 Counter System ---
// Counter bonus scales with the winner's effective Control.
// bonus = counterBaseBonus + winnerEffCtl * counterCtlScaling

export function resolveCounters(
  attack1: Attack,
  attack2: Attack,
  eff1Ctl: number = 0,
  eff2Ctl: number = 0,
): CounterResult {
  const a1BeatsA2 = attack1.beats.includes(attack2.id);
  const a2BeatsA1 = attack2.beats.includes(attack1.id);

  if (a1BeatsA2) {
    const bonus = BALANCE.counterBaseBonus + eff1Ctl * BALANCE.counterCtlScaling;
    return { player1Bonus: bonus, player2Bonus: -bonus };
  }
  if (a2BeatsA1) {
    const bonus = BALANCE.counterBaseBonus + eff2Ctl * BALANCE.counterCtlScaling;
    return { player1Bonus: -bonus, player2Bonus: bonus };
  }

  return { player1Bonus: 0, player2Bonus: 0 };
}

// --- 1.2 Accuracy ---
// Accuracy = Eff_Control + (Eff_Initiative / 2) - (Opponent_Eff_Momentum / 4) + Counter_Bonus

export function calcAccuracy(
  effControl: number,
  effInitiative: number,
  opponentEffMomentum: number,
  counterBonus: number,
): number {
  return effControl + (effInitiative / 2) - (opponentEffMomentum / 4) + counterBonus;
}

// --- 1.3 Impact Score ---
// ImpactScore = (Eff_Momentum x 0.5) + (Accuracy x 0.4) - (Opponent_Eff_Guard x guardImpactCoeff)

export function calcImpactScore(
  effMomentum: number,
  accuracy: number,
  opponentEffGuard: number,
): number {
  return (effMomentum * 0.5) + (accuracy * 0.4) - (opponentEffGuard * BALANCE.guardImpactCoeff);
}

// --- 1.4 Unseat (Deterministic) ---
// Threshold = 20 + (Defender_Eff_Guard / guardUnseatDivisor) + (Defender_Current_Stamina / 20)
// Unseat when: attacker ImpactScore - defender ImpactScore >= threshold

export function calcUnseatThreshold(defenderEffGuard: number, defenderCurrentStamina: number): number {
  return 20 + (defenderEffGuard / BALANCE.guardUnseatDivisor) + (defenderCurrentStamina / 20);
}

export function checkUnseat(
  attackerImpact: number,
  defenderImpact: number,
  defenderEffGuard: number,
  defenderCurrentStamina: number,
): { unseated: boolean; margin: number; threshold: number } {
  const margin = attackerImpact - defenderImpact;
  const threshold = calcUnseatThreshold(defenderEffGuard, defenderCurrentStamina);
  return {
    unseated: margin >= threshold,
    margin,
    threshold,
  };
}

// --- 1.5 Stamina ---

export function applySpeedStamina(currentStamina: number, speed: SpeedData): number {
  return Math.max(0, currentStamina + speed.deltaStamina);
}

export function applyAttackStaminaCost(currentStamina: number, attack: Attack): number {
  return Math.max(0, currentStamina + attack.deltaStamina); // deltaStamina is negative
}

export function applyShiftCost(
  currentStamina: number,
  currentInitiative: number,
  fromAttack: Attack,
  toAttack: Attack,
): { stamina: number; initiativePenalty: number } {
  const sameStance = fromAttack.stance === toAttack.stance;
  const staminaCost = sameStance ? BALANCE.shiftSameStanceCost : BALANCE.shiftCrossStanceCost;
  const initPenalty = sameStance ? BALANCE.shiftSameStanceInitPenalty : BALANCE.shiftCrossStanceInitPenalty;

  return {
    stamina: Math.max(0, currentStamina - staminaCost),
    initiativePenalty: initPenalty,
  };
}

// --- Shift Eligibility ---
// Pre-shift Effective_Control >= Shift_Threshold AND Current_Stamina >= 10

export function canShift(effectiveControl: number, speed: SpeedData, currentStamina: number): boolean {
  return effectiveControl >= speed.shiftThreshold && currentStamina >= 10;
}

// --- 7.3 Melee Resolution ---
// Thresholds scale with defender's effective guard.

export function resolveMeleeRound(
  margin: number,
  defenderEffGuard: number,
): { outcome: MeleeOutcome; winner: 'higher' | 'lower' | 'none' } {
  const absMargin = Math.abs(margin);
  const hitThreshold = BALANCE.meleeHitBase + defenderEffGuard * BALANCE.meleeHitGrdScale;
  const critThreshold = BALANCE.meleeCritBase + defenderEffGuard * BALANCE.meleeCritGrdScale;

  if (absMargin < hitThreshold) {
    return { outcome: MeleeOutcome.Draw, winner: 'none' };
  }
  if (absMargin >= critThreshold) {
    return { outcome: MeleeOutcome.Critical, winner: margin > 0 ? 'higher' : 'lower' };
  }
  return { outcome: MeleeOutcome.Hit, winner: margin > 0 ? 'higher' : 'lower' };
}

// --- 7.1 Melee Carryover Penalties ---
// Momentum penalty: -floor(Unseat_Margin / 3)
// Control penalty:  -floor(Unseat_Margin / 4)
// Guard penalty:    -floor(Unseat_Margin / 5)

export function calcCarryoverPenalties(unseatMargin: number): {
  momentumPenalty: number;
  controlPenalty: number;
  guardPenalty: number;
} {
  return {
    momentumPenalty: -Math.floor(unseatMargin / 3),
    controlPenalty: -Math.floor(unseatMargin / 4),
    guardPenalty: -Math.floor(unseatMargin / 5),
  };
}

/**
 * @deprecated Use {@link resolveJoustPass} from phase-joust.ts instead.
 * This legacy function lacks initiative-priority shift ordering.
 * Kept only for base-formula validation in calculator.test.ts.
 */

export interface PassInput {
  archetype: Archetype;
  speed: SpeedType;
  attack: Attack;
  currentStamina: number;
  shiftAttack?: Attack;
}

export interface PassOutput {
  effectiveStats: EffectiveStats;
  accuracy: number;
  impactScore: number;
  staminaAfter: number;
  fatigue: number;
  finalAttack: Attack;
  shifted: boolean;
  initiativePenalty: number;
}

export function resolvePass(
  p1Input: PassInput,
  p2Input: PassInput,
): {
  p1: PassOutput;
  p2: PassOutput;
  unseat: 'none' | 'player1' | 'player2';
  unseatMargin: number;
  log: string[];
} {
  const log: string[] = [];
  const speed1 = SPEEDS[p1Input.speed];
  const speed2 = SPEEDS[p2Input.speed];

  // Step 1: Apply speed stamina
  let sta1 = applySpeedStamina(p1Input.currentStamina, speed1);
  let sta2 = applySpeedStamina(p2Input.currentStamina, speed2);
  log.push(`Speed STA: P1 ${p1Input.currentStamina}→${sta1}, P2 ${p2Input.currentStamina}→${sta2}`);

  // Step 2: Compute fatigue
  const ff1 = fatigueFactor(sta1, p1Input.archetype.stamina);
  const ff2 = fatigueFactor(sta2, p2Input.archetype.stamina);
  log.push(`Fatigue: P1 ${ff1.toFixed(3)}, P2 ${ff2.toFixed(3)}`);

  // Determine final attacks (handle shifts)
  let finalAttack1 = p1Input.attack;
  let finalAttack2 = p2Input.attack;
  let initPenalty1 = 0;
  let initPenalty2 = 0;
  let shifted1 = false;
  let shifted2 = false;

  // Check shift eligibility using pre-shift stats
  if (p1Input.shiftAttack) {
    const preShiftStats1 = computeEffectiveStats(p1Input.archetype, speed1, p1Input.attack, sta1);
    if (canShift(preShiftStats1.control, speed1, sta1)) {
      const shiftResult = applyShiftCost(sta1, preShiftStats1.initiative, p1Input.attack, p1Input.shiftAttack);
      sta1 = shiftResult.stamina;
      initPenalty1 = shiftResult.initiativePenalty;
      finalAttack1 = p1Input.shiftAttack;
      shifted1 = true;
      log.push(`P1 shifts: ${p1Input.attack.name} → ${p1Input.shiftAttack.name} (STA cost, INIT -${initPenalty1})`);
    } else {
      log.push(`P1 shift denied (Control or Stamina too low)`);
    }
  }

  if (p2Input.shiftAttack) {
    const preShiftStats2 = computeEffectiveStats(p2Input.archetype, speed2, p2Input.attack, sta2);
    if (canShift(preShiftStats2.control, speed2, sta2)) {
      const shiftResult = applyShiftCost(sta2, preShiftStats2.initiative, p2Input.attack, p2Input.shiftAttack);
      sta2 = shiftResult.stamina;
      initPenalty2 = shiftResult.initiativePenalty;
      finalAttack2 = p2Input.shiftAttack;
      shifted2 = true;
      log.push(`P2 shifts: ${p2Input.attack.name} → ${p2Input.shiftAttack.name} (STA cost, INIT -${initPenalty2})`);
    } else {
      log.push(`P2 shift denied (Control or Stamina too low)`);
    }
  }

  // Recompute fatigue after shift costs
  const ff1Post = fatigueFactor(sta1, p1Input.archetype.stamina);
  const ff2Post = fatigueFactor(sta2, p2Input.archetype.stamina);

  // Step 3-4: Compute effective stats with final attacks
  const stats1 = computeEffectiveStats(p1Input.archetype, speed1, finalAttack1, sta1, initPenalty1);
  const stats2 = computeEffectiveStats(p2Input.archetype, speed2, finalAttack2, sta2, initPenalty2);

  log.push(`P1 stats: MOM=${stats1.momentum.toFixed(2)}, CTL=${stats1.control.toFixed(2)}, GRD=${stats1.guard.toFixed(2)}, INIT=${stats1.initiative}`);
  log.push(`P2 stats: MOM=${stats2.momentum.toFixed(2)}, CTL=${stats2.control.toFixed(2)}, GRD=${stats2.guard.toFixed(2)}, INIT=${stats2.initiative}`);

  // Step 5: Counter bonuses (scaled by winner's CTL)
  const counters = resolveCounters(finalAttack1, finalAttack2, stats1.control, stats2.control);
  log.push(`Counters: P1 ${counters.player1Bonus >= 0 ? '+' : ''}${counters.player1Bonus.toFixed(2)}, P2 ${counters.player2Bonus >= 0 ? '+' : ''}${counters.player2Bonus.toFixed(2)}`);

  // Step 6: Accuracy & ImpactScore
  const acc1 = calcAccuracy(stats1.control, stats1.initiative, stats2.momentum, counters.player1Bonus);
  const acc2 = calcAccuracy(stats2.control, stats2.initiative, stats1.momentum, counters.player2Bonus);
  log.push(`Accuracy: P1 ${acc1.toFixed(2)}, P2 ${acc2.toFixed(2)}`);

  const impact1 = calcImpactScore(stats1.momentum, acc1, stats2.guard);
  const impact2 = calcImpactScore(stats2.momentum, acc2, stats1.guard);
  log.push(`ImpactScore: P1 ${impact1.toFixed(2)}, P2 ${impact2.toFixed(2)}`);

  // Step 7: Unseat check both directions
  const unseat1on2 = checkUnseat(impact1, impact2, stats2.guard, sta2);
  const unseat2on1 = checkUnseat(impact2, impact1, stats1.guard, sta1);

  let unseat: 'none' | 'player1' | 'player2' = 'none';
  let unseatMargin = 0;

  if (unseat1on2.unseated && unseat2on1.unseated) {
    // Both exceed threshold — higher margin wins, tie = no unseat
    if (unseat1on2.margin > unseat2on1.margin) {
      unseat = 'player1';
      unseatMargin = unseat1on2.margin;
    } else if (unseat2on1.margin > unseat1on2.margin) {
      unseat = 'player2';
      unseatMargin = unseat2on1.margin;
    }
    // tie = no unseat
  } else if (unseat1on2.unseated) {
    unseat = 'player1';
    unseatMargin = unseat1on2.margin;
  } else if (unseat2on1.unseated) {
    unseat = 'player2';
    unseatMargin = unseat2on1.margin;
  }

  if (unseat !== 'none') {
    log.push(`UNSEAT! ${unseat} unseats opponent (margin ${unseatMargin.toFixed(2)})`);
  } else {
    log.push(`No unseat. Margins: P1→P2 ${unseat1on2.margin.toFixed(2)} vs threshold ${unseat1on2.threshold.toFixed(2)}, P2→P1 ${unseat2on1.margin.toFixed(2)} vs threshold ${unseat2on1.threshold.toFixed(2)}`);
  }

  // Step 8-9: Deduct attack stamina cost
  const staAfter1 = applyAttackStaminaCost(sta1, finalAttack1);
  const staAfter2 = applyAttackStaminaCost(sta2, finalAttack2);
  log.push(`End STA: P1 ${sta1}→${staAfter1}, P2 ${sta2}→${staAfter2}`);

  return {
    p1: {
      effectiveStats: stats1,
      accuracy: acc1,
      impactScore: impact1,
      staminaAfter: staAfter1,
      fatigue: ff1Post,
      finalAttack: finalAttack1,
      shifted: shifted1,
      initiativePenalty: initPenalty1,
    },
    p2: {
      effectiveStats: stats2,
      accuracy: acc2,
      impactScore: impact2,
      staminaAfter: staAfter2,
      fatigue: ff2Post,
      finalAttack: finalAttack2,
      shifted: shifted2,
      initiativePenalty: initPenalty2,
    },
    unseat,
    unseatMargin,
    log,
  };
}
