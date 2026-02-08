// ============================================================
// Jousting MVP — Basic AI Opponent (Milestone 3)
// ============================================================
// Heuristic AI: archetype-weighted speed, counter-aware attacks,
// shift evaluation. 70% optimal / 30% suboptimal for variety.
// ============================================================
import {
  SpeedType,
  Stance,
  type Attack,
  type PassChoice,
  type PlayerState,
  type Archetype,
  type CaparisonEffectId,
} from '../engine/types';
import {
  SPEEDS,
  JOUST_ATTACKS,
  JOUST_ATTACK_LIST,
  MELEE_ATTACKS,
  MELEE_ATTACK_LIST,
} from '../engine/attacks';
import {
  computeEffectiveStats,
  canShift,
  fatigueFactor,
  resolveCounters,
} from '../engine/calculator';

// --- Utility ---

function weightedRandom<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// --- Speed Selection ---
// Weight by archetype identity:
//   High MOM → prefer Fast (exploit strength)
//   High GRD → prefer Slow (tank + conserve)
//   Balanced → Standard
//   Also factor in stamina: low STA → lean Slow

function pickSpeed(state: PlayerState): SpeedType {
  const arch = state.archetype;
  const sta = state.currentStamina;

  // Emergency: very low stamina → always Slow
  if (sta <= 15) return SpeedType.Slow;

  // Base weights
  let slowW = 1;
  let stdW = 2;
  let fastW = 1;

  // Archetype tendencies
  if (arch.momentum >= 65) fastW += 2; // Charger, Breaker
  if (arch.guard >= 65) slowW += 2;    // Bulwark
  if (arch.control >= 65) stdW += 1;   // Technician, Tactician
  if (arch.initiative >= 65) stdW += 1; // Tactician

  // Stamina pressure: lean Slow when draining
  if (sta < 30) { slowW += 2; fastW = Math.max(0, fastW - 1); }
  else if (sta < 40) { slowW += 1; }

  // 70/30 optimal vs random
  if (Math.random() < 0.3) {
    return pickRandom([SpeedType.Slow, SpeedType.Standard, SpeedType.Fast]);
  }

  return weightedRandom(
    [SpeedType.Slow, SpeedType.Standard, SpeedType.Fast],
    [slowW, stdW, fastW],
  );
}

// --- Attack Selection (Joust) ---
// Factors: archetype affinity, counter potential vs opponent's likely attack,
// stamina cost, stance variety

function pickJoustAttack(
  state: PlayerState,
  opponentLastAttack?: Attack,
): Attack {
  const arch = state.archetype;
  const sta = state.currentStamina;
  const attacks = JOUST_ATTACK_LIST;

  // Score each attack
  const scores = attacks.map(atk => {
    let score = 5; // base

    // Stat affinity: if archetype is MOM-heavy, favor Agg attacks
    if (arch.momentum >= 65 && atk.stance === Stance.Aggressive) score += 3;
    if (arch.guard >= 65 && atk.stance === Stance.Defensive) score += 3;
    if (arch.control >= 65 && atk.stance === Stance.Balanced) score += 2;

    // Stamina awareness: penalize expensive attacks when low
    if (sta < 30 && atk.deltaStamina < -15) score -= 3;
    if (sta < 20 && atk.deltaStamina < -10) score -= 2;

    // Counter potential: if we know opponent's last attack, favor counters
    if (opponentLastAttack) {
      if (atk.beats.includes(opponentLastAttack.id)) score += 4;
      if (atk.beatenBy.includes(opponentLastAttack.id)) score -= 2;
    }

    // Stance triangle: Agg > Def > Bal > Agg
    // Pick the stance that counters opponent's last stance
    if (opponentLastAttack) {
      const oppStance = opponentLastAttack.stance;
      if (oppStance === Stance.Defensive && atk.stance === Stance.Aggressive) score += 2;
      if (oppStance === Stance.Aggressive && atk.stance === Stance.Balanced) score += 2;
      if (oppStance === Stance.Balanced && atk.stance === Stance.Defensive) score += 2;
    }

    return Math.max(1, score);
  });

  // 70/30 mix
  if (Math.random() < 0.3) {
    return pickRandom(attacks);
  }

  return weightedRandom(attacks, scores);
}

// --- Shift Decision (Joust) ---
// After seeing opponent's revealed attack, consider shifting.

function evaluateShift(
  state: PlayerState,
  speed: SpeedType,
  currentAttack: Attack,
  opponentAttack: Attack,
): Attack | undefined {
  const speedData = SPEEDS[speed];
  const sta = state.currentStamina;

  // Compute pre-shift stats for eligibility
  const staAfterSpeed = Math.max(0, sta + speedData.deltaStamina);
  const preStats = computeEffectiveStats(state.archetype, speedData, currentAttack, staAfterSpeed);

  if (!canShift(preStats.control, speedData, staAfterSpeed)) {
    return undefined; // Can't shift
  }

  // Evaluate: should we shift?
  // Check if current attack is already beating the opponent
  const currentCounters = resolveCounters(currentAttack, opponentAttack);
  if (currentCounters.player1Bonus > 0) {
    return undefined; // Already winning counter matchup — stay
  }

  // Look for a better attack
  const candidates = JOUST_ATTACK_LIST.filter(a => a.id !== currentAttack.id);
  let bestAttack: Attack | undefined;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    let score = 0;

    // Counter advantage
    const counters = resolveCounters(candidate, opponentAttack);
    score += counters.player1Bonus * 2; // Weight counter bonus heavily

    // Prefer same-stance shift (cheaper)
    if (candidate.stance === currentAttack.stance) score += 3;

    // Stamina cost awareness
    const shiftCost = candidate.stance === currentAttack.stance ? 5 : 12;
    if (staAfterSpeed - shiftCost < 10) score -= 10; // Too expensive

    if (score > bestScore) {
      bestScore = score;
      bestAttack = candidate;
    }
  }

  // Only shift if it's clearly better (score > 5)
  if (bestScore > 5 && bestAttack) {
    // 70/30: sometimes don't shift even when it's good (unpredictability)
    if (Math.random() < 0.3) return undefined;
    return bestAttack;
  }

  return undefined;
}

// --- Melee Attack Selection ---

function pickMeleeAttack(
  state: PlayerState,
  opponentLastAttack?: Attack,
): Attack {
  const arch = state.archetype;
  const sta = state.currentStamina;
  const attacks = MELEE_ATTACK_LIST;

  const scores = attacks.map(atk => {
    let score = 5;

    // Archetype affinity
    if (arch.momentum >= 65 && atk.stance === Stance.Aggressive) score += 3;
    if (arch.guard >= 65 && atk.stance === Stance.Defensive) score += 3;
    if (arch.control >= 65 && atk.stance === Stance.Balanced) score += 2;

    // Stamina awareness
    if (sta < 20 && atk.deltaStamina < -12) score -= 3;

    // Counter potential
    if (opponentLastAttack) {
      if (atk.beats.includes(opponentLastAttack.id)) score += 4;
      if (atk.beatenBy.includes(opponentLastAttack.id)) score -= 2;

      // Stance triangle: Agg > Def > Bal > Agg
      const oppStance = opponentLastAttack.stance;
      if (oppStance === Stance.Defensive && atk.stance === Stance.Aggressive) score += 2;
      if (oppStance === Stance.Aggressive && atk.stance === Stance.Balanced) score += 2;
      if (oppStance === Stance.Balanced && atk.stance === Stance.Defensive) score += 2;
    }

    return Math.max(1, score);
  });

  if (Math.random() < 0.3) {
    return pickRandom(attacks);
  }

  return weightedRandom(attacks, scores);
}

// --- Caparison Selection (Archetype-Weighted) ---

const CAP_WEIGHTS: Record<string, Record<CaparisonEffectId, number>> = {
  charger:    { thunderweave: 5, stormcloak: 2, banner_of_the_giga: 2, pennant_of_haste: 1, woven_shieldcloth: 0, irongrip_drape: 1 },
  technician: { irongrip_drape: 5, woven_shieldcloth: 2, stormcloak: 2, banner_of_the_giga: 1, pennant_of_haste: 1, thunderweave: 0 },
  bulwark:    { woven_shieldcloth: 5, stormcloak: 3, banner_of_the_giga: 1, pennant_of_haste: 1, thunderweave: 0, irongrip_drape: 1 },
  tactician:  { pennant_of_haste: 4, irongrip_drape: 3, stormcloak: 2, banner_of_the_giga: 2, woven_shieldcloth: 1, thunderweave: 0 },
  breaker:    { stormcloak: 4, thunderweave: 3, banner_of_the_giga: 2, pennant_of_haste: 1, woven_shieldcloth: 0, irongrip_drape: 1 },
  duelist:    { banner_of_the_giga: 3, stormcloak: 2, irongrip_drape: 2, woven_shieldcloth: 2, thunderweave: 2, pennant_of_haste: 2 },
};

const CAP_REASONS: Record<CaparisonEffectId, string> = {
  pennant_of_haste: 'wants early Initiative advantage',
  woven_shieldcloth: 'plays Defensive — needs extra Guard',
  thunderweave: 'prefers Fast speed — more Momentum',
  irongrip_drape: 'high Control — leverages easier shifts',
  stormcloak: 'endurance fighter — delays fatigue',
  banner_of_the_giga: 'expects to win a counter — huge first-strike bonus',
};

function pickCaparisonForArchetype(archetype: Archetype): { id: CaparisonEffectId | undefined; reason: string } {
  // 20% chance of no caparison (budget/variety)
  if (Math.random() < 0.2) return { id: undefined, reason: 'AI chose no caparison' };

  const weights = CAP_WEIGHTS[archetype.id] ?? CAP_WEIGHTS.duelist;
  const ids = Object.keys(weights) as CaparisonEffectId[];
  const w = ids.map(id => weights[id]);

  const chosen = weightedRandom(ids, w);
  return { id: chosen, reason: `${archetype.name} ${CAP_REASONS[chosen]}` };
}

// --- Public API ---

export interface AIDecision {
  speed: SpeedType;
  attack: Attack;
  shiftAttack?: Attack;
}

export function aiPickCaparison(archetype: Archetype): { id: CaparisonEffectId | undefined; reason: string } {
  return pickCaparisonForArchetype(archetype);
}

export function aiPickJoustChoice(
  state: PlayerState,
  opponentLastAttack?: Attack,
  opponentRevealedAttack?: Attack,
): PassChoice {
  const speed = pickSpeed(state);
  const attack = pickJoustAttack(state, opponentLastAttack);

  let shiftAttack: Attack | undefined;
  if (opponentRevealedAttack) {
    shiftAttack = evaluateShift(state, speed, attack, opponentRevealedAttack);
  }

  return { speed, attack, shiftAttack };
}

export function aiPickMeleeAttack(
  state: PlayerState,
  opponentLastAttack?: Attack,
): Attack {
  return pickMeleeAttack(state, opponentLastAttack);
}
