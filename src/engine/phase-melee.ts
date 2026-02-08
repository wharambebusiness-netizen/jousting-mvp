// ============================================================
// Jousting — Melee Phase Resolution (Scaling-Ready + Caparison)
// ============================================================
import {
  Stance,
  type Archetype,
  type Attack,
  type CaparisonEffect,
  type CaparisonInput,
  type MeleeRoundResult,
  type PlayerState,
} from './types';
import {
  fatigueFactor,
  computeMeleeEffectiveStats,
  resolveCounters,
  calcAccuracy,
  calcImpactScore,
  applyAttackStaminaCost,
  resolveMeleeRound,
} from './calculator';
import { BALANCE } from './balance-config';

// --- Caparison Archetype Adjustment (Melee) ---
// Only Shieldcloth and Stormcloak apply in melee.
// Pennant (pass-based), Thunderweave (speed-based), Irongrip (shift-based) are joust-only.

function adjustArchetypeForMelee(
  archetype: Archetype,
  cap: CaparisonEffect | undefined,
  attack: Attack,
): Archetype {
  if (!cap) return archetype;

  let adj = { ...archetype };

  // Woven Shieldcloth: +GRD when Defensive stance
  if (cap.id === 'woven_shieldcloth' && attack.stance === Stance.Defensive) {
    adj.guard += BALANCE.caparison.shieldclothGuardBonus;
  }

  // Stormcloak: reduce effective maxStamina for fatigue calculation
  if (cap.id === 'stormcloak') {
    adj.stamina = adj.stamina *
      (BALANCE.fatigueRatio - BALANCE.caparison.stormcloakFatigueReduction) / BALANCE.fatigueRatio;
  }

  return adj;
}

/**
 * Resolves a single melee round:
 *  - Both players select attack simultaneously
 *  - Apply relevant caparison effects (Shieldcloth, Stormcloak, Banner)
 *  - Compute ImpactScore for both (same formula as joust)
 *  - Differential scoring with thresholds relative to defender's guard
 *  - No speed selection, no shifts in melee
 */
export function resolveMeleeRoundFn(
  roundNumber: number,
  p1State: PlayerState,
  p2State: PlayerState,
  p1Attack: Attack,
  p2Attack: Attack,
  p1Cap?: CaparisonInput,
  p2Cap?: CaparisonInput,
): MeleeRoundResult {
  const log: string[] = [];
  const p1Effect = p1Cap?.effect;
  const p2Effect = p2Cap?.effect;

  log.push(`=== Melee Round ${roundNumber} ===`);
  log.push(`P1: ${p1Attack.name} | P2: ${p2Attack.name}`);

  // Adjust archetypes for caparison effects
  const adj1 = adjustArchetypeForMelee(p1State.archetype, p1Effect, p1Attack);
  const adj2 = adjustArchetypeForMelee(p2State.archetype, p2Effect, p2Attack);

  // Fatigue (uses adjusted archetype for Stormcloak)
  const ff1 = fatigueFactor(p1State.currentStamina, adj1.stamina);
  const ff2 = fatigueFactor(p2State.currentStamina, adj2.stamina);
  log.push(`STA: P1 ${p1State.currentStamina} (FF ${ff1.toFixed(3)}), P2 ${p2State.currentStamina} (FF ${ff2.toFixed(3)})`);

  // Effective stats (melee — no speed)
  const stats1 = computeMeleeEffectiveStats(
    adj1, p1Attack, p1State.currentStamina,
    p1State.carryoverMomentum, p1State.carryoverControl, p1State.carryoverGuard,
  );
  const stats2 = computeMeleeEffectiveStats(
    adj2, p2Attack, p2State.currentStamina,
    p2State.carryoverMomentum, p2State.carryoverControl, p2State.carryoverGuard,
  );

  log.push(`P1: MOM=${stats1.momentum.toFixed(2)} CTL=${stats1.control.toFixed(2)} GRD=${stats1.guard.toFixed(2)} INIT=${stats1.initiative}`);
  log.push(`P2: MOM=${stats2.momentum.toFixed(2)} CTL=${stats2.control.toFixed(2)} GRD=${stats2.guard.toFixed(2)} INIT=${stats2.initiative}`);

  // Counters (scaled by winner's CTL)
  const counters = resolveCounters(p1Attack, p2Attack, stats1.control, stats2.control);

  // Banner of the Giga: boost first successful counter
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
    log.push(`Counter: ${p1Attack.name} vs ${p2Attack.name} → P1 ${counterBonus1 > 0 ? '+' : ''}${counterBonus1.toFixed(2)}, P2 ${counterBonus2 > 0 ? '+' : ''}${counterBonus2.toFixed(2)}`);
  }

  // Accuracy
  const acc1 = calcAccuracy(stats1.control, stats1.initiative, stats2.momentum, counterBonus1);
  const acc2 = calcAccuracy(stats2.control, stats2.initiative, stats1.momentum, counterBonus2);
  log.push(`Accuracy: P1 ${acc1.toFixed(2)}, P2 ${acc2.toFixed(2)}`);

  // ImpactScore
  const impact1 = calcImpactScore(stats1.momentum, acc1, stats2.guard);
  const impact2 = calcImpactScore(stats2.momentum, acc2, stats1.guard);
  log.push(`ImpactScore: P1 ${impact1.toFixed(2)}, P2 ${impact2.toFixed(2)}`);

  // Differential resolution with guard-relative thresholds
  const margin = impact1 - impact2;
  const defenderGuard = margin >= 0 ? stats2.guard : stats1.guard;
  const result = resolveMeleeRound(margin, defenderGuard);

  let winner: 'none' | 'player1' | 'player2' = 'none';
  if (result.winner === 'higher') winner = 'player1';
  else if (result.winner === 'lower') winner = 'player2';

  log.push(`Margin: ${Math.abs(margin).toFixed(2)} → ${result.outcome}${winner !== 'none' ? ` (${winner} wins round)` : ''}`);

  // Stamina drain
  const staAfter1 = applyAttackStaminaCost(p1State.currentStamina, p1Attack);
  const staAfter2 = applyAttackStaminaCost(p2State.currentStamina, p2Attack);
  log.push(`End STA: P1 ${p1State.currentStamina}→${staAfter1}, P2 ${p2State.currentStamina}→${staAfter2}`);

  return {
    roundNumber,
    player1Attack: p1Attack,
    player2Attack: p2Attack,
    player1ImpactScore: impact1,
    player2ImpactScore: impact2,
    margin: Math.abs(margin),
    outcome: result.outcome,
    winner,
    player1StaminaAfter: staAfter1,
    player2StaminaAfter: staAfter2,
    log,
    p1BannerConsumed,
    p2BannerConsumed,
  };
}
