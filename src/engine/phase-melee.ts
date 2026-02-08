// ============================================================
// Jousting — Melee Phase Resolution
// ============================================================
import {
  type Archetype,
  type Attack,
  type MeleeRoundResult,
  type PlayerState,
} from './types';
import { BALANCE } from './balance-config';
import {
  fatigueFactor,
  computeMeleeEffectiveStats,
  resolveCounters,
  calcAccuracy,
  calcImpactScore,
  applyAttackStaminaCost,
  resolveMeleeRound,
} from './calculator';

/**
 * Resolves a single melee round:
 *  - Both players select attack simultaneously
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
): MeleeRoundResult {
  const log: string[] = [];

  log.push(`=== Melee Round ${roundNumber} ===`);
  log.push(`P1: ${p1Attack.name} | P2: ${p2Attack.name}`);

  // Fatigue
  const ff1 = fatigueFactor(p1State.currentStamina, p1State.archetype.stamina);
  const ff2 = fatigueFactor(p2State.currentStamina, p2State.archetype.stamina);
  log.push(`STA: P1 ${p1State.currentStamina} (FF ${ff1.toFixed(3)}), P2 ${p2State.currentStamina} (FF ${ff2.toFixed(3)})`);

  // Effective stats (melee — no speed)
  const stats1 = computeMeleeEffectiveStats(
    p1State.archetype, p1Attack, p1State.currentStamina,
    p1State.carryoverMomentum, p1State.carryoverControl, p1State.carryoverGuard,
  );
  const stats2 = computeMeleeEffectiveStats(
    p2State.archetype, p2Attack, p2State.currentStamina,
    p2State.carryoverMomentum, p2State.carryoverControl, p2State.carryoverGuard,
  );

  log.push(`P1: MOM=${stats1.momentum.toFixed(2)} CTL=${stats1.control.toFixed(2)} GRD=${stats1.guard.toFixed(2)} INIT=${stats1.initiative}`);
  log.push(`P2: MOM=${stats2.momentum.toFixed(2)} CTL=${stats2.control.toFixed(2)} GRD=${stats2.guard.toFixed(2)} INIT=${stats2.initiative}`);

  // Counters (scaled by winner's CTL)
  const counters = resolveCounters(p1Attack, p2Attack, stats1.control, stats2.control);

  if (counters.player1Bonus !== 0 || counters.player2Bonus !== 0) {
    log.push(`Counter: ${p1Attack.name} vs ${p2Attack.name} → P1 ${counters.player1Bonus > 0 ? '+' : ''}${counters.player1Bonus.toFixed(2)}, P2 ${counters.player2Bonus > 0 ? '+' : ''}${counters.player2Bonus.toFixed(2)}`);
  }

  // Accuracy
  const acc1 = calcAccuracy(stats1.control, stats1.initiative, stats2.momentum, counters.player1Bonus);
  const acc2 = calcAccuracy(stats2.control, stats2.initiative, stats1.momentum, counters.player2Bonus);
  log.push(`Accuracy: P1 ${acc1.toFixed(2)}, P2 ${acc2.toFixed(2)}`);

  // ImpactScore (Breaker ignores a fraction of opponent guard)
  const pen1 = p1State.archetype.id === 'breaker' ? BALANCE.breakerGuardPenetration : 0;
  const pen2 = p2State.archetype.id === 'breaker' ? BALANCE.breakerGuardPenetration : 0;
  if (pen1 > 0) {
    log.push(`Breaker P1: guard penetration ${(pen1 * 100).toFixed(0)}% — opponent effective guard ${stats2.guard.toFixed(2)} → ${(stats2.guard * (1 - pen1)).toFixed(2)}`);
  }
  if (pen2 > 0) {
    log.push(`Breaker P2: guard penetration ${(pen2 * 100).toFixed(0)}% — opponent effective guard ${stats1.guard.toFixed(2)} → ${(stats1.guard * (1 - pen2)).toFixed(2)}`);
  }
  const impact1 = calcImpactScore(stats1.momentum, acc1, stats2.guard, pen1);
  const impact2 = calcImpactScore(stats2.momentum, acc2, stats1.guard, pen2);
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
  };
}
