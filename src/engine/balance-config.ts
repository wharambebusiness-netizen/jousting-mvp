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
  // No-gear max raw combat stat: ~115 (Charger Fast+CF momentum).
  // With Giga gear: Charger MOM base 98, +Fast+CF = 138 → softCap ~120.
  softCapKnee: 100,
  softCapK: 50,

  // --- Fatigue ---
  // Fatigue threshold is proportional to max stamina (archetype + gear).
  // Below threshold, Momentum and Control degrade linearly.
  // 0.8 means: Charger (STA 60) threshold = 48, Bulwark (STA 62) = 49.6.
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

  // --- Guard Coefficients ---
  // Guard contributes defensively in two places. These were previously
  // hardcoded at 0.3 and /10 respectively, causing guard to be
  // systematically overvalued (double-dip on defense).
  //
  // ImpactScore = Eff_MOM * 0.5 + Accuracy * 0.4 - Opp_Guard * guardImpactCoeff
  // Old 0.3 → 0.2 → 0.18: reduces guard's impact subtraction further to improve low-GRD archetypes.
  guardImpactCoeff: 0.18,
  // UnseatThreshold = 20 + Eff_Guard / guardUnseatDivisor + CurrentSTA / 20
  // Old 10 → 15: makes high-guard archetypes ~33% easier to unseat.
  guardUnseatDivisor: 15,

  // --- Breaker Guard Penetration ---
  // Fraction of opponent's effective guard that Breaker ignores during
  // impact calculation (both joust and melee). 0.20 = 20% guard ignored.
  // Only applies when the ATTACKER is a Breaker archetype.
  breakerGuardPenetration: 0.20,

  // --- Shift Costs ---
  // Stamina cost and initiative penalty for shifting mid-pass.
  // Same-stance shifts are cheaper than cross-stance shifts.
  shiftSameStanceCost: 5,
  shiftCrossStanceCost: 12,
  shiftSameStanceInitPenalty: 5,
  shiftCrossStanceInitPenalty: 10,

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

  // --- Gigling Rarity Bonus ---
  // Flat bonus to all 5 jousting stats based on mount rarity.
  // Flattened curve: every tier gives something, Giga peaks ~103 on
  // best stat so softCap (knee=100) stays meaningful.
  giglingRarityBonus: {
    uncommon: 1,
    rare: 3,
    epic: 5,
    legendary: 7,
    relic: 10,
    giga: 13,
  },

  // --- AI Difficulty Ratios ---
  // optimalRatio: probability of using weighted-optimal decision vs random.
  // Higher = smarter AI. Easy is forgiving, hard is punishing.
  aiDifficulty: {
    easy:   { optimalRatio: 0.4 },
    medium: { optimalRatio: 0.7 },
    hard:   { optimalRatio: 0.9 },
  },

  // --- AI Pattern Recognition ---
  // patternWeight: bonus score applied when AI detects a repeated opponent choice.
  // Only active on hard difficulty. Tracks last 3 opponent choices.
  // historyLength: how many past choices to track for pattern detection.
  aiPattern: {
    patternWeight: 3,
    historyLength: 3,
  },

  // --- Steed Gear Stat Ranges (per rarity, for stat pieces) ---
  // primary = main stat of the slot, secondary = off-stat.
  // Values are [min, max] inclusive. Rolled at craft time.
  // Reduced from 3-slot values since there are now 6 steed slots.
  gearStatRanges: {
    uncommon:  { primary: [1, 2],  secondary: [0, 1] },
    rare:      { primary: [1, 3],  secondary: [1, 2] },
    epic:      { primary: [2, 4],  secondary: [1, 3] },
    legendary: { primary: [3, 5],  secondary: [2, 3] },
    relic:     { primary: [4, 7],  secondary: [3, 5] },
    giga:      { primary: [5, 9],  secondary: [4, 6] },
  },

  // --- Player Gear Stat Ranges (per rarity, for stat pieces) ---
  // Same structure as steed gear. Can diverge after balance simulation.
  playerGearStatRanges: {
    uncommon:  { primary: [1, 2],  secondary: [0, 1] },
    rare:      { primary: [1, 3],  secondary: [1, 2] },
    epic:      { primary: [2, 4],  secondary: [1, 3] },
    legendary: { primary: [3, 5],  secondary: [2, 3] },
    relic:     { primary: [4, 7],  secondary: [3, 5] },
    giga:      { primary: [5, 9],  secondary: [4, 6] },
  },
} as const;
