// ============================================================
// Jousting — Joust Phase Resolution (Scaling-Ready + Caparison)
// ============================================================
import {
  SpeedType,
  Stance,
  type Archetype,
  type Attack,
  type CaparisonEffect,
  type CaparisonInput,
  type PassResult,
  type PassPlayerResult,
  type PlayerState,
  type PassChoice,
  type SpeedData,
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
import { BALANCE } from './balance-config';

// --- Caparison Archetype Adjustment ---
// Creates a temporary archetype with caparison stat bonuses applied.
// When `finalAttack` is provided, attack-dependent effects (Shieldcloth) are included.
// When omitted, only pass/speed/passive effects are applied (for pre-shift checks).

function adjustArchetypeForCaparison(
  archetype: Archetype,
  cap: CaparisonEffect | undefined,
  passNumber: number,
  speedType: SpeedType,
  finalAttack?: Attack,
): Archetype {
  if (!cap) return archetype;

  let adj = { ...archetype };

  // Pennant of Haste: +INIT on pass 1 only
  if (cap.id === 'pennant_of_haste' && passNumber === 1) {
    adj.initiative += BALANCE.caparison.hasteInitBonus;
  }

  // Thunderweave: +MOM when Fast
  if (cap.id === 'thunderweave' && speedType === SpeedType.Fast) {
    adj.momentum += BALANCE.caparison.thunderweaveMomBonus;
  }

  // Woven Shieldcloth: +GRD when final attack is Defensive (only with finalAttack)
  if (finalAttack && cap.id === 'woven_shieldcloth' && finalAttack.stance === Stance.Defensive) {
    adj.guard += BALANCE.caparison.shieldclothGuardBonus;
  }

  // Stormcloak: reduce effective maxStamina for fatigue calculation
  // fatigueFactor threshold = maxStamina * fatigueRatio
  // We want threshold = maxStamina * (fatigueRatio - reduction)
  // Equivalent: use adjustedStamina = maxStamina * (ratio - reduction) / ratio
  if (cap.id === 'stormcloak') {
    adj.stamina = adj.stamina *
      (BALANCE.fatigueRatio - BALANCE.caparison.stormcloakFatigueReduction) / BALANCE.fatigueRatio;
  }

  return adj;
}

/**
 * Resolves a single joust pass:
 *  1. Apply speed Stamina delta
 *  2. Handle shifts (eligibility, costs, priority)
 *  3. Apply caparison effects to archetypes
 *  4. Compute effective stats with final attacks
 *  5. Compute Accuracy (with scaled counters + banner boost)
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
  p1Cap?: CaparisonInput,
  p2Cap?: CaparisonInput,
): PassResult {
  const log: string[] = [];
  const speed1 = SPEEDS[p1Choice.speed];
  const speed2 = SPEEDS[p2Choice.speed];
  const p1Effect = p1Cap?.effect;
  const p2Effect = p2Cap?.effect;

  log.push(`=== Pass ${passNumber} ===`);
  log.push(`P1: ${p1Choice.speed} + ${p1Choice.attack.name} | P2: ${p2Choice.speed} + ${p2Choice.attack.name}`);

  // Log active caparison effects
  if (p1Effect) log.push(`P1 Caparison: ${p1Effect.name}`);
  if (p2Effect) log.push(`P2 Caparison: ${p2Effect.name}`);

  // Step 1: Speed stamina
  let sta1 = applySpeedStamina(p1State.currentStamina, speed1);
  let sta2 = applySpeedStamina(p2State.currentStamina, speed2);
  log.push(`Speed STA: P1 ${p1State.currentStamina}→${sta1}, P2 ${p2State.currentStamina}→${sta2}`);

  // Step 2: Pre-shift archetypes (no attack-dependent effects yet)
  const preArch1 = adjustArchetypeForCaparison(p1State.archetype, p1Effect, passNumber, p1Choice.speed);
  const preArch2 = adjustArchetypeForCaparison(p2State.archetype, p2Effect, passNumber, p2Choice.speed);

  // Step 3: Handle shifts
  let finalAttack1 = p1Choice.attack;
  let finalAttack2 = p2Choice.attack;
  let initPenalty1 = 0;
  let initPenalty2 = 0;
  let shifted1 = false;
  let shifted2 = false;

  const preStats1 = computeEffectiveStats(preArch1, speed1, p1Choice.attack, sta1);
  const preStats2 = computeEffectiveStats(preArch2, speed2, p2Choice.attack, sta2);

  const p1WantsShift = p1Choice.shiftAttack && p1Choice.shiftAttack.id !== p1Choice.attack.id;
  const p2WantsShift = p2Choice.shiftAttack && p2Choice.shiftAttack.id !== p2Choice.attack.id;

  // Irongrip Drape: reduce shift threshold by creating adjusted speed data
  let shiftSpeed1 = speed1;
  let shiftSpeed2 = speed2;
  if (p1Effect?.id === 'irongrip_drape') {
    shiftSpeed1 = { ...speed1, shiftThreshold: speed1.shiftThreshold - BALANCE.caparison.irongripShiftReduction };
    log.push(`P1 Irongrip Drape: shift threshold ${speed1.shiftThreshold}→${shiftSpeed1.shiftThreshold}`);
  }
  if (p2Effect?.id === 'irongrip_drape') {
    shiftSpeed2 = { ...speed2, shiftThreshold: speed2.shiftThreshold - BALANCE.caparison.irongripShiftReduction };
    log.push(`P2 Irongrip Drape: shift threshold ${speed2.shiftThreshold}→${shiftSpeed2.shiftThreshold}`);
  }

  const p1CanShift = p1WantsShift && canShift(preStats1.control, shiftSpeed1, sta1);
  const p2CanShift = p2WantsShift && canShift(preStats2.control, shiftSpeed2, sta2);

  if (p1WantsShift && !p1CanShift) {
    log.push(`P1 shift denied (CTL ${preStats1.control.toFixed(1)} vs threshold ${shiftSpeed1.shiftThreshold}, STA ${sta1})`);
  }
  if (p2WantsShift && !p2CanShift) {
    log.push(`P2 shift denied (CTL ${preStats2.control.toFixed(1)} vs threshold ${shiftSpeed2.shiftThreshold}, STA ${sta2})`);
  }

  // Execute shifts. Lower Initiative goes first (disadvantage), higher goes second (advantage).
  if (p1CanShift && p2CanShift) {
    const init1 = preStats1.initiative;
    const init2 = preStats2.initiative;

    if (init1 > init2) {
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

  // Step 4: Final archetypes (including attack-dependent effects like Shieldcloth)
  const finalArch1 = adjustArchetypeForCaparison(p1State.archetype, p1Effect, passNumber, p1Choice.speed, finalAttack1);
  const finalArch2 = adjustArchetypeForCaparison(p2State.archetype, p2Effect, passNumber, p2Choice.speed, finalAttack2);

  const stats1 = computeEffectiveStats(finalArch1, speed1, finalAttack1, sta1, initPenalty1);
  const stats2 = computeEffectiveStats(finalArch2, speed2, finalAttack2, sta2, initPenalty2);

  log.push(`P1: MOM=${stats1.momentum.toFixed(2)} CTL=${stats1.control.toFixed(2)} GRD=${stats1.guard.toFixed(2)} INIT=${stats1.initiative}`);
  log.push(`P2: MOM=${stats2.momentum.toFixed(2)} CTL=${stats2.control.toFixed(2)} GRD=${stats2.guard.toFixed(2)} INIT=${stats2.initiative}`);

  // Step 5: Counters + Accuracy (counter bonus scales with winner's CTL)
  const counters = resolveCounters(finalAttack1, finalAttack2, stats1.control, stats2.control);

  // Banner of the Giga: boost first successful counter by 50%
  let counterBonus1 = counters.player1Bonus;
  let counterBonus2 = counters.player2Bonus;
  let p1BannerConsumed = false;
  let p2BannerConsumed = false;

  if (p1Effect?.id === 'banner_of_the_giga' && !p1Cap?.bannerUsed && counterBonus1 > 0) {
    counterBonus1 *= BALANCE.caparison.gigaBannerCounterMultiplier;
    p1BannerConsumed = true;
    log.push(`P1 Banner of the Giga: counter bonus ${counters.player1Bonus.toFixed(2)}→${counterBonus1.toFixed(2)}`);
  }
  if (p2Effect?.id === 'banner_of_the_giga' && !p2Cap?.bannerUsed && counterBonus2 > 0) {
    counterBonus2 *= BALANCE.caparison.gigaBannerCounterMultiplier;
    p2BannerConsumed = true;
    log.push(`P2 Banner of the Giga: counter bonus ${counters.player2Bonus.toFixed(2)}→${counterBonus2.toFixed(2)}`);
  }

  if (counterBonus1 !== 0 || counterBonus2 !== 0) {
    log.push(`Counter: ${finalAttack1.name} vs ${finalAttack2.name} → P1 ${counterBonus1 > 0 ? '+' : ''}${counterBonus1.toFixed(2)}, P2 ${counterBonus2 > 0 ? '+' : ''}${counterBonus2.toFixed(2)}`);
  }

  const acc1 = calcAccuracy(stats1.control, stats1.initiative, stats2.momentum, counterBonus1);
  const acc2 = calcAccuracy(stats2.control, stats2.initiative, stats1.momentum, counterBonus2);
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

  // Step 8: Deduct attack stamina
  const staAfter1 = applyAttackStaminaCost(sta1, finalAttack1);
  const staAfter2 = applyAttackStaminaCost(sta2, finalAttack2);
  log.push(`End STA: P1 ${sta1}→${staAfter1}, P2 ${sta2}→${staAfter2}`);

  // Post-attack fatigue (uses adjusted archetype for Stormcloak consistency)
  const ffPost1 = fatigueFactor(sta1, finalArch1.stamina);
  const ffPost2 = fatigueFactor(sta2, finalArch2.stamina);

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
    p1BannerConsumed,
    p2BannerConsumed,
  };
}
