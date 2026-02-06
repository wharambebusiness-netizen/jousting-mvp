// ============================================================
// Jousting — Balance Configuration (Scaling-Ready)
// ============================================================
// All tuning constants live here. These values are calibrated so
// that current (no-gear) gameplay is minimally affected while
// providing diminishing returns and relative scaling for when
// gear, levels, or new archetypes push stats higher.
// ============================================================

export const BALANCE = {
  // --- Diminishing Returns (Soft Cap) ---
  // Stats below the knee are linear (unchanged).
  // Stats above the knee are compressed: excess * K / (excess + K).
  // Current max raw stat is ~110 (Charger Fast+CF momentum).
  softCapKnee: 100,
  softCapK: 50,

  // --- Fatigue ---
  // Fatigue threshold is proportional to max stamina (archetype + gear).
  // Below threshold, Momentum and Control degrade linearly.
  // 0.8 means: Charger (STA 50) threshold = 40, Bulwark (STA 65) = 52.
  fatigueRatio: 0.8,

  // --- Guard Fatigue ---
  // Guard now partially fatigues. guardFatigueFloor is the minimum
  // multiplier applied to guard at 0 stamina. At full stamina, guard
  // is unaffected (multiplier = 1.0). Formula:
  //   guardFF = floor + (1 - floor) * fatigueFactor
  // 0.5 means guard drops to 50% at complete exhaustion.
  guardFatigueFloor: 0.5,

  // --- Counter Bonus Scaling ---
  // Counter bonus scales with the winner's effective Control.
  // Formula: bonus = counterBaseBonus + winnerEffCtl * counterCtlScaling
  // At CTL 60 (average): 4 + 60*0.1 = 10 (matches old flat ±10).
  // At CTL 20 (Charger brute): 4 + 2 = 6 (less exploitable).
  // At CTL 85 (Technician): 4 + 8.5 = 12.5 (rewards skill).
  counterBaseBonus: 4,
  counterCtlScaling: 0.1,

  // --- Melee Thresholds (Relative to Defender Guard) ---
  // Hit and Critical thresholds scale with the defender's effective guard.
  // At average GRD ~65: hitThreshold ≈ 5, critThreshold ≈ 25 (old values).
  // Tanky defenders (high GRD) require bigger margins to score against.
  //   hitThreshold  = meleeHitBase  + defenderEffGuard * meleeHitGrdScale
  //   critThreshold = meleeCritBase + defenderEffGuard * meleeCritGrdScale
  meleeHitBase: 3,
  meleeHitGrdScale: 0.031,
  meleeCritBase: 15,
  meleeCritGrdScale: 0.154,

  // --- Melee Win Conditions ---
  // meleeWinsNeeded: round wins required to take the melee.
  // criticalWinsValue: how many round wins a Critical hit counts for.
  // At 4 needed / 2 per crit: a crit is a massive swing but not instant-win.
  // A player at 2 wins who lands a crit reaches 4 and closes it out.
  // A player at 0 who lands a crit goes to 2 — momentum, not match over.
  meleeWinsNeeded: 4,
  criticalWinsValue: 2,
} as const;
