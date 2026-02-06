// ============================================================
// Jousting — Joust Phase Resolution (Scaling-Ready)
// ============================================================
import type {
  Attack,
  PassResult,
  PassPlayerResult,
  PlayerState,
  SpeedType,
  PassChoice,
} from './types';
import { SPEEDS } from './attacks';
import {
  fatigueFactor,
  computeEffectiveStats,
  resolveCounters,
  calcAccuracy,
  calcImpactScore,
  checkUnseat,
  applySpeedStamina,
  applyAttackStaminaCost,
  applyShiftCost,
  canShift,
} from './calculator';

/**
 * Resolves a single joust pass:
 *  1. Apply speed Stamina delta
 *  2. Compute Fatigue_Factor
 *  3. Handle shifts (eligibility, costs, priority)
 *  4. Compute effective stats with final attacks
 *  5. Compute Accuracy (with scaled counters)
 *  6. Compute ImpactScore
 *  7. Check unseat both directions
 *  8. Deduct attack stamina
 */
export function resolveJoustPass(
  passNumber: number,
  p1State: PlayerState,
  p2State: PlayerState,
  p1Choice: PassChoice,
  p2Choice: PassChoice,
): PassResult {
  const log: string[] = [];
  const speed1 = SPEEDS[p1Choice.speed];
  const speed2 = SPEEDS[p2Choice.speed];

  log.push(`=== Pass ${passNumber} ===`);
  log.push(`P1: ${p1Choice.speed} + ${p1Choice.attack.name} | P2: ${p2Choice.speed} + ${p2Choice.attack.name}`);

  // Step 1: Speed stamina
  let sta1 = applySpeedStamina(p1State.currentStamina, speed1);
  let sta2 = applySpeedStamina(p2State.currentStamina, speed2);
  log.push(`Speed STA: P1 ${p1State.currentStamina}→${sta1}, P2 ${p2State.currentStamina}→${sta2}`);

  // Step 2: Fatigue (relative to max stamina)
  const ff1 = fatigueFactor(sta1, p1State.archetype.stamina);
  const ff2 = fatigueFactor(sta2, p2State.archetype.stamina);

  // Step 3: Handle shifts
  let finalAttack1 = p1Choice.attack;
  let finalAttack2 = p2Choice.attack;
  let initPenalty1 = 0;
  let initPenalty2 = 0;
  let shifted1 = false;
  let shifted2 = false;

  // Both players may attempt to shift. If both shift, higher Initiative
  // resolves SECOND (advantage). We need pre-shift stats for eligibility.

  const preStats1 = computeEffectiveStats(p1State.archetype, speed1, p1Choice.attack, sta1);
  const preStats2 = computeEffectiveStats(p2State.archetype, speed2, p2Choice.attack, sta2);

  const p1WantsShift = p1Choice.shiftAttack && p1Choice.shiftAttack.id !== p1Choice.attack.id;
  const p2WantsShift = p2Choice.shiftAttack && p2Choice.shiftAttack.id !== p2Choice.attack.id;

  const p1CanShift = p1WantsShift && canShift(preStats1.control, speed1, sta1);
  const p2CanShift = p2WantsShift && canShift(preStats2.control, speed2, sta2);

  if (p1WantsShift && !p1CanShift) {
    log.push(`P1 shift denied (CTL ${preStats1.control.toFixed(1)} vs threshold ${speed1.shiftThreshold}, STA ${sta1})`);
  }
  if (p2WantsShift && !p2CanShift) {
    log.push(`P2 shift denied (CTL ${preStats2.control.toFixed(1)} vs threshold ${speed2.shiftThreshold}, STA ${sta2})`);
  }

  // Execute shifts. If both shift, lower Initiative goes first (sees less).
  // Higher Initiative resolves second = advantage.
  if (p1CanShift && p2CanShift) {
    // Both shift — order by Initiative
    const init1 = preStats1.initiative;
    const init2 = preStats2.initiative;

    // Lower init resolves first (disadvantage), higher resolves second (advantage)
    // On tie: simultaneous, no advantage
    if (init1 > init2) {
      // P2 goes first, P1 goes second (P1 has advantage)
      const shift2 = applyShiftCost(sta2, preStats2.initiative, p2Choice.attack, p2Choice.shiftAttack!);
      sta2 = shift2.stamina;
      initPenalty2 = shift2.initiativePenalty;
      finalAttack2 = p2Choice.shiftAttack!;
      shifted2 = true;

      const shift1 = applyShiftCost(sta1, preStats1.initiative, p1Choice.attack, p1Choice.shiftAttack!);
      sta1 = shift1.stamina;
      initPenalty1 = shift1.initiativePenalty;
      finalAttack1 = p1Choice.shiftAttack!;
      shifted1 = true;

      log.push(`Both shift — P1 has Initiative advantage (${init1} > ${init2})`);
    } else if (init2 > init1) {
      // P1 goes first, P2 goes second (P2 has advantage)
      const shift1 = applyShiftCost(sta1, preStats1.initiative, p1Choice.attack, p1Choice.shiftAttack!);
      sta1 = shift1.stamina;
      initPenalty1 = shift1.initiativePenalty;
      finalAttack1 = p1Choice.shiftAttack!;
      shifted1 = true;

      const shift2 = applyShiftCost(sta2, preStats2.initiative, p2Choice.attack, p2Choice.shiftAttack!);
      sta2 = shift2.stamina;
      initPenalty2 = shift2.initiativePenalty;
      finalAttack2 = p2Choice.shiftAttack!;
      shifted2 = true;

      log.push(`Both shift — P2 has Initiative advantage (${init2} > ${init1})`);
    } else {
      // Tie: simultaneous, no advantage
      const shift1 = applyShiftCost(sta1, preStats1.initiative, p1Choice.attack, p1Choice.shiftAttack!);
      sta1 = shift1.stamina;
      initPenalty1 = shift1.initiativePenalty;
      finalAttack1 = p1Choice.shiftAttack!;
      shifted1 = true;

      const shift2 = applyShiftCost(sta2, preStats2.initiative, p2Choice.attack, p2Choice.shiftAttack!);
      sta2 = shift2.stamina;
      initPenalty2 = shift2.initiativePenalty;
      finalAttack2 = p2Choice.shiftAttack!;
      shifted2 = true;

      log.push(`Both shift — Initiative tied (${init1}), simultaneous`);
    }
  } else if (p1CanShift) {
    const shift1 = applyShiftCost(sta1, preStats1.initiative, p1Choice.attack, p1Choice.shiftAttack!);
    sta1 = shift1.stamina;
    initPenalty1 = shift1.initiativePenalty;
    finalAttack1 = p1Choice.shiftAttack!;
    shifted1 = true;
    log.push(`P1 shifts: ${p1Choice.attack.name} → ${p1Choice.shiftAttack!.name}`);
  } else if (p2CanShift) {
    const shift2 = applyShiftCost(sta2, preStats2.initiative, p2Choice.attack, p2Choice.shiftAttack!);
    sta2 = shift2.stamina;
    initPenalty2 = shift2.initiativePenalty;
    finalAttack2 = p2Choice.shiftAttack!;
    shifted2 = true;
    log.push(`P2 shifts: ${p2Choice.attack.name} → ${p2Choice.shiftAttack!.name}`);
  }

  // Step 4: Compute final effective stats
  const stats1 = computeEffectiveStats(p1State.archetype, speed1, finalAttack1, sta1, initPenalty1);
  const stats2 = computeEffectiveStats(p2State.archetype, speed2, finalAttack2, sta2, initPenalty2);

  log.push(`P1: MOM=${stats1.momentum.toFixed(2)} CTL=${stats1.control.toFixed(2)} GRD=${stats1.guard.toFixed(2)} INIT=${stats1.initiative}`);
  log.push(`P2: MOM=${stats2.momentum.toFixed(2)} CTL=${stats2.control.toFixed(2)} GRD=${stats2.guard.toFixed(2)} INIT=${stats2.initiative}`);

  // Step 5: Counters + Accuracy (counter bonus scales with winner's CTL)
  const counters = resolveCounters(finalAttack1, finalAttack2, stats1.control, stats2.control);
  if (counters.player1Bonus !== 0 || counters.player2Bonus !== 0) {
    log.push(`Counter: ${finalAttack1.name} vs ${finalAttack2.name} → P1 ${counters.player1Bonus > 0 ? '+' : ''}${counters.player1Bonus.toFixed(2)}, P2 ${counters.player2Bonus > 0 ? '+' : ''}${counters.player2Bonus.toFixed(2)}`);
  }

  const acc1 = calcAccuracy(stats1.control, stats1.initiative, stats2.momentum, counters.player1Bonus);
  const acc2 = calcAccuracy(stats2.control, stats2.initiative, stats1.momentum, counters.player2Bonus);
  log.push(`Accuracy: P1 ${acc1.toFixed(2)}, P2 ${acc2.toFixed(2)}`);

  // Step 6: ImpactScore
  const impact1 = calcImpactScore(stats1.momentum, acc1, stats2.guard);
  const impact2 = calcImpactScore(stats2.momentum, acc2, stats1.guard);
  log.push(`ImpactScore: P1 ${impact1.toFixed(2)}, P2 ${impact2.toFixed(2)}`);

  // Step 7: Unseat check
  const unseat1on2 = checkUnseat(impact1, impact2, stats2.guard, sta2);
  const unseat2on1 = checkUnseat(impact2, impact1, stats1.guard, sta1);

  let unseat: 'none' | 'player1' | 'player2' = 'none';
  let unseatMargin = 0;

  if (unseat1on2.unseated && unseat2on1.unseated) {
    if (unseat1on2.margin > unseat2on1.margin) {
      unseat = 'player1';
      unseatMargin = unseat1on2.margin;
    } else if (unseat2on1.margin > unseat1on2.margin) {
      unseat = 'player2';
      unseatMargin = unseat2on1.margin;
    }
  } else if (unseat1on2.unseated) {
    unseat = 'player1';
    unseatMargin = unseat1on2.margin;
  } else if (unseat2on1.unseated) {
    unseat = 'player2';
    unseatMargin = unseat2on1.margin;
  }

  if (unseat !== 'none') {
    log.push(`** UNSEAT by ${unseat}! Margin: ${unseatMargin.toFixed(2)} **`);
  }

  // Step 8-9: Deduct attack stamina
  const staAfter1 = applyAttackStaminaCost(sta1, finalAttack1);
  const staAfter2 = applyAttackStaminaCost(sta2, finalAttack2);
  log.push(`End STA: P1 ${sta1}→${staAfter1}, P2 ${sta2}→${staAfter2}`);

  const ffPost1 = fatigueFactor(sta1, p1State.archetype.stamina);
  const ffPost2 = fatigueFactor(sta2, p2State.archetype.stamina);

  return {
    passNumber,
    player1: {
      speed: p1Choice.speed,
      initialAttack: p1Choice.attack,
      finalAttack: finalAttack1,
      shifted: shifted1,
      effectiveStats: stats1,
      accuracy: acc1,
      impactScore: impact1,
      staminaAfter: staAfter1,
      fatigueFactor: ffPost1,
    },
    player2: {
      speed: p2Choice.speed,
      initialAttack: p2Choice.attack,
      finalAttack: finalAttack2,
      shifted: shifted2,
      effectiveStats: stats2,
      accuracy: acc2,
      impactScore: impact2,
      staminaAfter: staAfter2,
      fatigueFactor: ffPost2,
    },
    unseat,
    unseatMargin,
    log,
  };
}
