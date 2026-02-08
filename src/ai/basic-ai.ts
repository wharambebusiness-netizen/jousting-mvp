// ============================================================
// Jousting MVP — Basic AI Opponent (Milestone 3)
// ============================================================
// Heuristic AI: archetype-weighted speed, counter-aware attacks,
// shift evaluation. 70% optimal / 30% suboptimal for variety.
// ============================================================
import {
  SpeedType,
  Stance,
  type AIDifficulty,
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
import { BALANCE } from '../engine/balance-config';

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

/** Returns the random-choice probability for a given difficulty (1 - optimalRatio). */
function randomRatio(difficulty: AIDifficulty): number {
  return 1 - BALANCE.aiDifficulty[difficulty].optimalRatio;
}

// --- Opponent Pattern Tracking (S2) ---
// Tracks opponent's recent speed and attack choices to detect patterns.
// Only exploited on hard difficulty.

export class OpponentHistory {
  private speedHistory: SpeedType[] = [];
  private attackHistory: string[] = []; // attack IDs

  recordSpeed(speed: SpeedType): void {
    this.speedHistory.push(speed);
    if (this.speedHistory.length > BALANCE.aiPattern.historyLength) {
      this.speedHistory.shift();
    }
  }

  recordAttack(attackId: string): void {
    this.attackHistory.push(attackId);
    if (this.attackHistory.length > BALANCE.aiPattern.historyLength) {
      this.attackHistory.shift();
    }
  }

  /** Returns the most frequent speed if one dominates (>= 2/3 of history), else undefined. */
  predictedSpeed(): SpeedType | undefined {
    if (this.speedHistory.length < 2) return undefined;
    const counts = new Map<SpeedType, number>();
    for (const s of this.speedHistory) counts.set(s, (counts.get(s) ?? 0) + 1);
    for (const [speed, count] of counts) {
      if (count >= 2) return speed;
    }
    return undefined;
  }

  /** Returns the most frequent attack ID if one dominates (>= 2/3 of history), else undefined. */
  predictedAttackId(): string | undefined {
    if (this.attackHistory.length < 2) return undefined;
    const counts = new Map<string, number>();
    for (const a of this.attackHistory) counts.set(a, (counts.get(a) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count >= 2) return id;
    }
    return undefined;
  }

  reset(): void {
    this.speedHistory = [];
    this.attackHistory = [];
  }
}

// --- AI Commentary (S3) ---
// Context-sensitive flavor text based on AI decisions and game state.

const ARCHETYPE_COMMENTARY: Record<string, {
  lowStamina: string;
  highMomentum: string;
  aggressive: string;
  defensive: string;
  patternRead: string;
}> = {
  charger: {
    lowStamina: 'My steed tires... but one good charge is all I need!',
    highMomentum: 'Full gallop! Nothing stops the charge!',
    aggressive: 'Ride them down!',
    defensive: 'Even a charger must guard sometimes...',
    patternRead: 'I see your pattern — time to exploit it!',
  },
  bulwark: {
    lowStamina: 'Endurance waning... hold the line a little longer.',
    highMomentum: 'Pressing forward with the weight of iron!',
    aggressive: 'A rare opening — strike now!',
    defensive: 'Behind my shield, I am untouchable.',
    patternRead: 'Your habits betray you, challenger.',
  },
  technician: {
    lowStamina: 'Conserving energy... every move must count.',
    highMomentum: 'Perfect form — the lance finds its mark!',
    aggressive: 'A calculated risk, precisely timed.',
    defensive: 'Control the distance, control the fight.',
    patternRead: 'Your technique is predictable — adjusting.',
  },
  tactician: {
    lowStamina: 'Running low... must choose wisely now.',
    highMomentum: 'The plan comes together!',
    aggressive: 'Strike while the advantage holds!',
    defensive: 'Patience wins tourneys.',
    patternRead: 'I\'ve studied your moves — no more surprises.',
  },
  breaker: {
    lowStamina: 'Tiring... but my lance still hits hard!',
    highMomentum: 'Momentum is everything — BREAK THROUGH!',
    aggressive: 'Shatter their guard!',
    defensive: 'Biding my time for the big hit.',
    patternRead: 'Same trick twice? Not falling for it.',
  },
  duelist: {
    lowStamina: 'Stamina fading... must make every pass count.',
    highMomentum: 'On the front foot — press the advantage!',
    aggressive: 'An elegant strike to end this!',
    defensive: 'Measure, parry, wait for the opening.',
    patternRead: 'Your style is becoming familiar...',
  },
};

function getDefaultCommentary() {
  return ARCHETYPE_COMMENTARY.duelist;
}

export function generateCommentary(
  archId: string,
  staRatio: number,
  chosenStance: Stance,
  patternDetected: boolean,
): string {
  const lines = ARCHETYPE_COMMENTARY[archId] ?? getDefaultCommentary();

  if (patternDetected) return lines.patternRead;
  if (staRatio <= 0.35) return lines.lowStamina;
  if (staRatio >= 0.80 && chosenStance === Stance.Aggressive) return lines.highMomentum;
  if (chosenStance === Stance.Aggressive) return lines.aggressive;
  if (chosenStance === Stance.Defensive) return lines.defensive;
  return ''; // No commentary for neutral situations
}

// --- Archetype Personality Modifiers ---
// Each archetype has distinct AI personality beyond raw stat differences.
// speedMods: [slow, standard, fast] weight bonuses
// stancePrefs: [aggressive, balanced, defensive] score bonuses for attack selection
// shiftAffinity: bonus to shift evaluation score (higher = more likely to shift)
// meleeAggression: bonus to aggressive attacks in melee
interface ArchetypePersonality {
  speedMods: [number, number, number]; // [slow, std, fast]
  stancePrefs: [number, number, number]; // [agg, bal, def]
  shiftAffinity: number;
  meleeAggression: number;
}

const ARCHETYPE_PERSONALITY: Record<string, ArchetypePersonality> = {
  charger:    { speedMods: [-1, 0, 3], stancePrefs: [3, 0, -1], shiftAffinity: -1, meleeAggression: 2 },
  bulwark:    { speedMods: [2, 1, -2], stancePrefs: [-1, 1, 3], shiftAffinity: 0, meleeAggression: -1 },
  technician: { speedMods: [0, 2, 0], stancePrefs: [0, 2, 0], shiftAffinity: 3, meleeAggression: 0 },
  tactician:  { speedMods: [1, 1, 0], stancePrefs: [0, 2, 0], shiftAffinity: 2, meleeAggression: 0 },
  breaker:    { speedMods: [0, 0, 2], stancePrefs: [2, 0, 0], shiftAffinity: -1, meleeAggression: 3 },
  duelist:    { speedMods: [0, 1, 0], stancePrefs: [1, 1, 1], shiftAffinity: 1, meleeAggression: 0 },
};

function getPersonality(archId: string): ArchetypePersonality {
  return ARCHETYPE_PERSONALITY[archId] ?? ARCHETYPE_PERSONALITY.duelist;
}

// --- Speed Selection ---
// Weight by archetype identity:
//   High MOM → prefer Fast (exploit strength)
//   High GRD → prefer Slow (tank + conserve)
//   Balanced → Standard
//   Also factor in stamina: low STA → lean Slow

function pickSpeedWithReasoning(state: PlayerState, difficulty: AIDifficulty, history?: OpponentHistory): { speed: SpeedType; reasoning: SpeedReasoning } {
  const arch = state.archetype;
  const sta = state.currentStamina;
  const staRatio = sta / arch.stamina;

  // Determine archetype bias string
  const biases: string[] = [];
  if (arch.momentum >= 65) biases.push('High MOM → Fast');
  if (arch.guard >= 65) biases.push('High GRD → Slow');
  if (arch.control >= 65) biases.push('High CTL → Standard');
  if (arch.initiative >= 65) biases.push('High INIT → Standard');
  const archetypeBias = biases.length > 0 ? biases.join(', ') : 'Balanced';

  // Emergency: very low stamina → always Slow
  if (staRatio <= 0.25) {
    return {
      speed: SpeedType.Slow,
      reasoning: {
        weights: { slow: 1, standard: 0, fast: 0 },
        staminaRatio: staRatio,
        archetypeBias,
        chosen: SpeedType.Slow,
        wasRandom: false,
      },
    };
  }

  // Base weights
  let slowW = 1;
  let stdW = 2;
  let fastW = 1;

  // Archetype tendencies
  if (arch.momentum >= 65) fastW += 2; // Charger, Breaker
  if (arch.guard >= 65) slowW += 2;    // Bulwark
  if (arch.control >= 65) stdW += 1;   // Technician, Tactician
  if (arch.initiative >= 65) stdW += 1; // Tactician

  // Stamina pressure: lean Slow when draining (percentage-based)
  if (staRatio < 0.50) { slowW += 2; fastW = Math.max(0, fastW - 1); }
  else if (staRatio < 0.65) { slowW += 1; }

  // Archetype personality modifiers
  const personality = getPersonality(arch.id);
  slowW = Math.max(0, slowW + personality.speedMods[0]);
  stdW = Math.max(0, stdW + personality.speedMods[1]);
  fastW = Math.max(0, fastW + personality.speedMods[2]);

  // Pattern exploitation (hard difficulty only)
  if (difficulty === 'hard' && history) {
    const predicted = history.predictedSpeed();
    if (predicted) {
      const pw = BALANCE.aiPattern.patternWeight;
      // Counter the predicted speed: Fast beats Slow (initiative), Slow beats Fast (conserve+tank)
      if (predicted === SpeedType.Fast) slowW += pw;
      else if (predicted === SpeedType.Slow) fastW += pw;
      else stdW += pw; // Standard → match with Standard (stat advantage)
    }
  }

  const weights = { slow: slowW, standard: stdW, fast: fastW };

  // Difficulty-based optimal vs random
  const wasRandom = Math.random() < randomRatio(difficulty);
  const chosen = wasRandom
    ? pickRandom([SpeedType.Slow, SpeedType.Standard, SpeedType.Fast])
    : weightedRandom([SpeedType.Slow, SpeedType.Standard, SpeedType.Fast], [slowW, stdW, fastW]);

  return {
    speed: chosen,
    reasoning: { weights, staminaRatio: staRatio, archetypeBias, chosen, wasRandom },
  };
}

function pickSpeed(state: PlayerState, difficulty: AIDifficulty, history?: OpponentHistory): SpeedType {
  return pickSpeedWithReasoning(state, difficulty, history).speed;
}

// --- Attack Selection (Joust) ---
// Factors: archetype affinity, counter potential vs opponent's likely attack,
// stamina cost, stance variety

function pickJoustAttackWithReasoning(
  state: PlayerState,
  opponentLastAttack: Attack | undefined,
  chosenSpeed: SpeedType,
  difficulty: AIDifficulty,
  history?: OpponentHistory,
): { attack: Attack; reasoning: AttackReasoning } {
  const arch = state.archetype;
  const sta = state.currentStamina;
  const staRatio = sta / arch.stamina;
  const attacks = JOUST_ATTACK_LIST;

  // Score each attack and track factors
  const scoreEntries: AttackScoreEntry[] = [];
  const rawScores: number[] = [];

  let speedSynergy: string | undefined;

  for (const atk of attacks) {
    let score = 5; // base
    const factors: string[] = ['Base: 5'];

    // Stat affinity: if archetype is MOM-heavy, favor Agg attacks
    if (arch.momentum >= 65 && atk.stance === Stance.Aggressive) { score += 3; factors.push('MOM affinity +3'); }
    if (arch.guard >= 65 && atk.stance === Stance.Defensive) { score += 3; factors.push('GRD affinity +3'); }
    if (arch.control >= 65 && atk.stance === Stance.Balanced) { score += 2; factors.push('CTL affinity +2'); }

    // Speed-attack synergy: boost attacks that pair well with chosen speed
    if (chosenSpeed === SpeedType.Fast && atk.stance === Stance.Aggressive) {
      score += 2; factors.push('Fast+Aggressive synergy +2');
      speedSynergy = 'Fast + Aggressive boost';
    }
    if (chosenSpeed === SpeedType.Slow && atk.stance === Stance.Defensive) {
      score += 2; factors.push('Slow+Defensive synergy +2');
      speedSynergy = 'Slow + Defensive boost';
    }
    if (chosenSpeed === SpeedType.Standard && atk.stance === Stance.Balanced) {
      score += 1; factors.push('Standard+Balanced synergy +1');
      speedSynergy = 'Standard + Balanced boost';
    }

    // Stamina awareness: penalize expensive attacks when low (percentage-based)
    if (staRatio < 0.50 && atk.deltaStamina < -15) { score -= 3; factors.push('Low stamina penalty -3'); }
    if (staRatio < 0.35 && atk.deltaStamina < -10) { score -= 2; factors.push('Very low stamina penalty -2'); }

    // Counter potential: if we know opponent's last attack, favor counters
    if (opponentLastAttack) {
      if (atk.beats.includes(opponentLastAttack.id)) { score += 4; factors.push(`Counters ${opponentLastAttack.name} +4`); }
      if (atk.beatenBy.includes(opponentLastAttack.id)) { score -= 2; factors.push(`Countered by ${opponentLastAttack.name} -2`); }
    }

    // Stance triangle: Agg > Def > Bal > Agg
    if (opponentLastAttack) {
      const oppStance = opponentLastAttack.stance;
      if (oppStance === Stance.Defensive && atk.stance === Stance.Aggressive) { score += 2; factors.push('Stance triangle +2'); }
      if (oppStance === Stance.Aggressive && atk.stance === Stance.Balanced) { score += 2; factors.push('Stance triangle +2'); }
      if (oppStance === Stance.Balanced && atk.stance === Stance.Defensive) { score += 2; factors.push('Stance triangle +2'); }
    }

    // Pattern exploitation (hard difficulty only)
    if (difficulty === 'hard' && history) {
      const predictedId = history.predictedAttackId();
      if (predictedId) {
        if (atk.beats.includes(predictedId)) { score += BALANCE.aiPattern.patternWeight; factors.push(`Pattern exploit +${BALANCE.aiPattern.patternWeight}`); }
      }
    }

    const finalScore = Math.max(1, score);
    rawScores.push(finalScore);
    scoreEntries.push({ attackName: atk.name, attackId: atk.id, score: finalScore, factors });
  }

  // Difficulty-based optimal vs random
  const wasRandom = Math.random() < randomRatio(difficulty);
  const chosen = wasRandom ? pickRandom(attacks) : weightedRandom(attacks, rawScores);

  // Sort score entries by score descending for display
  const sortedScores = [...scoreEntries].sort((a, b) => b.score - a.score);

  return {
    attack: chosen,
    reasoning: { scores: sortedScores, chosen: chosen.name, speedSynergy, wasRandom },
  };
}

function pickJoustAttack(
  state: PlayerState,
  opponentLastAttack: Attack | undefined,
  chosenSpeed: SpeedType,
  difficulty: AIDifficulty,
  history?: OpponentHistory,
): Attack {
  return pickJoustAttackWithReasoning(state, opponentLastAttack, chosenSpeed, difficulty, history).attack;
}

// --- Shift Decision (Joust) ---
// After seeing opponent's revealed attack, consider shifting.

function evaluateShiftWithReasoning(
  state: PlayerState,
  speed: SpeedType,
  currentAttack: Attack,
  opponentAttack: Attack,
  difficulty: AIDifficulty,
): { shiftAttack: Attack | undefined; reasoning: ShiftReasoning } {
  const speedData = SPEEDS[speed];
  const sta = state.currentStamina;

  // Compute pre-shift stats for eligibility
  const staAfterSpeed = Math.max(0, sta + speedData.deltaStamina);
  const preStats = computeEffectiveStats(state.archetype, speedData, currentAttack, staAfterSpeed);

  if (!canShift(preStats.control, speedData, staAfterSpeed)) {
    return {
      shiftAttack: undefined,
      reasoning: {
        canShift: false,
        currentCounterStatus: 'N/A',
        decision: `Cannot shift (CTL ${Math.round(preStats.control)} < threshold ${speedData.shiftThreshold} or stamina too low)`,
      },
    };
  }

  // Check if current attack is already beating the opponent
  const currentCounters = resolveCounters(currentAttack, opponentAttack);
  const counterStatus = currentCounters.player1Bonus > 0
    ? `Winning (${currentAttack.name} counters ${opponentAttack.name})`
    : currentCounters.player1Bonus < 0
      ? `Losing (${opponentAttack.name} counters ${currentAttack.name})`
      : 'Neutral';

  if (currentCounters.player1Bonus > 0) {
    return {
      shiftAttack: undefined,
      reasoning: {
        canShift: true,
        currentCounterStatus: counterStatus,
        decision: 'Already winning counter matchup — staying',
      },
    };
  }

  // Look for a better attack
  const candidates = JOUST_ATTACK_LIST.filter(a => a.id !== currentAttack.id);
  let bestAttack: Attack | undefined;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    let score = 0;
    const counters = resolveCounters(candidate, opponentAttack);
    score += counters.player1Bonus * 2;
    if (candidate.stance === currentAttack.stance) score += 3;
    const shiftCost = candidate.stance === currentAttack.stance ? BALANCE.shiftSameStanceCost : BALANCE.shiftCrossStanceCost;
    if (staAfterSpeed - shiftCost < 10) score -= 10;

    if (score > bestScore) {
      bestScore = score;
      bestAttack = candidate;
    }
  }

  const bestAlt = bestAttack ? { attack: bestAttack.name, score: bestScore } : undefined;

  if (bestScore > 5 && bestAttack) {
    if (Math.random() < randomRatio(difficulty)) {
      return {
        shiftAttack: undefined,
        reasoning: {
          canShift: true,
          currentCounterStatus: counterStatus,
          bestAlternative: bestAlt,
          decision: `Could shift to ${bestAttack.name} (score ${bestScore}) but chose unpredictability`,
        },
      };
    }
    return {
      shiftAttack: bestAttack,
      reasoning: {
        canShift: true,
        currentCounterStatus: counterStatus,
        bestAlternative: bestAlt,
        decision: `Shifting to ${bestAttack.name} (score ${bestScore})`,
      },
    };
  }

  return {
    shiftAttack: undefined,
    reasoning: {
      canShift: true,
      currentCounterStatus: counterStatus,
      bestAlternative: bestAlt,
      decision: bestAlt ? `Best alternative ${bestAlt.attack} (score ${bestAlt.score}) not good enough` : 'No better alternative found',
    },
  };
}

function evaluateShift(
  state: PlayerState,
  speed: SpeedType,
  currentAttack: Attack,
  opponentAttack: Attack,
  difficulty: AIDifficulty,
): Attack | undefined {
  return evaluateShiftWithReasoning(state, speed, currentAttack, opponentAttack, difficulty).shiftAttack;
}

// --- Melee Attack Selection ---

function pickMeleeAttackWithReasoning(
  state: PlayerState,
  opponentLastAttack: Attack | undefined,
  difficulty: AIDifficulty,
  history?: OpponentHistory,
): { attack: Attack; reasoning: AttackReasoning } {
  const arch = state.archetype;
  const sta = state.currentStamina;
  const staRatio = sta / arch.stamina;
  const attacks = MELEE_ATTACK_LIST;

  const scoreEntries: AttackScoreEntry[] = [];
  const rawScores: number[] = [];

  for (const atk of attacks) {
    let score = 5;
    const factors: string[] = ['Base: 5'];

    // Archetype affinity
    if (arch.momentum >= 65 && atk.stance === Stance.Aggressive) { score += 3; factors.push('MOM affinity +3'); }
    if (arch.guard >= 65 && atk.stance === Stance.Defensive) { score += 3; factors.push('GRD affinity +3'); }
    if (arch.control >= 65 && atk.stance === Stance.Balanced) { score += 2; factors.push('CTL affinity +2'); }

    // Archetype personality: melee aggression modifier
    const personality = getPersonality(arch.id);
    if (atk.stance === Stance.Aggressive && personality.meleeAggression !== 0) {
      score += personality.meleeAggression;
      factors.push(`Melee aggression ${personality.meleeAggression > 0 ? '+' : ''}${personality.meleeAggression}`);
    }

    // Stamina awareness (percentage-based)
    if (staRatio < 0.35 && atk.deltaStamina < -12) { score -= 3; factors.push('Low stamina penalty -3'); }

    // Counter potential
    if (opponentLastAttack) {
      if (atk.beats.includes(opponentLastAttack.id)) { score += 4; factors.push(`Counters ${opponentLastAttack.name} +4`); }
      if (atk.beatenBy.includes(opponentLastAttack.id)) { score -= 2; factors.push(`Countered by ${opponentLastAttack.name} -2`); }

      const oppStance = opponentLastAttack.stance;
      if (oppStance === Stance.Defensive && atk.stance === Stance.Aggressive) { score += 2; factors.push('Stance triangle +2'); }
      if (oppStance === Stance.Aggressive && atk.stance === Stance.Balanced) { score += 2; factors.push('Stance triangle +2'); }
      if (oppStance === Stance.Balanced && atk.stance === Stance.Defensive) { score += 2; factors.push('Stance triangle +2'); }
    }

    // Pattern exploitation (hard difficulty only)
    if (difficulty === 'hard' && history) {
      const predictedId = history.predictedAttackId();
      if (predictedId) {
        if (atk.beats.includes(predictedId)) { score += BALANCE.aiPattern.patternWeight; factors.push(`Pattern exploit +${BALANCE.aiPattern.patternWeight}`); }
      }
    }

    const finalScore = Math.max(1, score);
    rawScores.push(finalScore);
    scoreEntries.push({ attackName: atk.name, attackId: atk.id, score: finalScore, factors });
  }

  // Difficulty-based optimal vs random
  const wasRandom = Math.random() < randomRatio(difficulty);
  const chosen = wasRandom ? pickRandom(attacks) : weightedRandom(attacks, rawScores);

  const sortedScores = [...scoreEntries].sort((a, b) => b.score - a.score);

  return {
    attack: chosen,
    reasoning: { scores: sortedScores, chosen: chosen.name, wasRandom },
  };
}

function pickMeleeAttack(
  state: PlayerState,
  opponentLastAttack: Attack | undefined,
  difficulty: AIDifficulty,
  history?: OpponentHistory,
): Attack {
  return pickMeleeAttackWithReasoning(state, opponentLastAttack, difficulty, history).attack;
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

// --- Reasoning Types ---

export interface SpeedReasoning {
  weights: { slow: number; standard: number; fast: number };
  staminaRatio: number;
  archetypeBias: string;
  chosen: SpeedType;
  wasRandom: boolean;
}

export interface AttackScoreEntry {
  attackName: string;
  attackId: string;
  score: number;
  factors: string[];
}

export interface AttackReasoning {
  scores: AttackScoreEntry[];
  chosen: string;
  speedSynergy?: string;
  wasRandom: boolean;
}

export interface ShiftReasoning {
  canShift: boolean;
  currentCounterStatus: string;
  bestAlternative?: { attack: string; score: number };
  decision: string;
}

export interface AIReasoning {
  speed: SpeedReasoning;
  attack: AttackReasoning;
  shift?: ShiftReasoning;
  caparison?: { id: string | undefined; reason: string };
  commentary: string;
}

// --- Public API ---

export interface AIDecision {
  speed: SpeedType;
  attack: Attack;
  shiftAttack?: Attack;
}

export interface AIJoustResult {
  choice: PassChoice;
  commentary: string;
}

export interface AIMeleeResult {
  attack: Attack;
  commentary: string;
}

export function aiPickCaparison(
  archetype: Archetype,
  difficulty: AIDifficulty = 'medium',
): { id: CaparisonEffectId | undefined; reason: string } {
  // Easy AI more likely to skip caparison (less optimal)
  if (difficulty === 'easy' && Math.random() < 0.4) {
    return { id: undefined, reason: 'AI chose no caparison' };
  }
  return pickCaparisonForArchetype(archetype);
}

export function aiPickJoustChoice(
  state: PlayerState,
  opponentLastAttack?: Attack,
  opponentRevealedAttack?: Attack,
  difficulty: AIDifficulty = 'medium',
  history?: OpponentHistory,
): PassChoice {
  const speed = pickSpeed(state, difficulty, history);
  const attack = pickJoustAttack(state, opponentLastAttack, speed, difficulty, history);

  let shiftAttack: Attack | undefined;
  if (opponentRevealedAttack) {
    shiftAttack = evaluateShift(state, speed, attack, opponentRevealedAttack, difficulty);
  }

  return { speed, attack, shiftAttack };
}

/** Extended version that also returns AI commentary. */
export function aiPickJoustChoiceWithCommentary(
  state: PlayerState,
  opponentLastAttack?: Attack,
  opponentRevealedAttack?: Attack,
  difficulty: AIDifficulty = 'medium',
  history?: OpponentHistory,
): AIJoustResult {
  const choice = aiPickJoustChoice(state, opponentLastAttack, opponentRevealedAttack, difficulty, history);
  const staRatio = state.currentStamina / state.archetype.stamina;
  const patternDetected = difficulty === 'hard' && !!history?.predictedAttackId();
  const commentary = generateCommentary(state.archetype.id, staRatio, choice.attack.stance, patternDetected);
  return { choice, commentary };
}

export function aiPickMeleeAttack(
  state: PlayerState,
  opponentLastAttack?: Attack,
  difficulty: AIDifficulty = 'medium',
  history?: OpponentHistory,
): Attack {
  return pickMeleeAttack(state, opponentLastAttack, difficulty, history);
}

/** Extended version that also returns AI commentary. */
export function aiPickMeleeAttackWithCommentary(
  state: PlayerState,
  opponentLastAttack?: Attack,
  difficulty: AIDifficulty = 'medium',
  history?: OpponentHistory,
): AIMeleeResult {
  const attack = aiPickMeleeAttack(state, opponentLastAttack, difficulty, history);
  const staRatio = state.currentStamina / state.archetype.stamina;
  const patternDetected = difficulty === 'hard' && !!history?.predictedAttackId();
  const commentary = generateCommentary(state.archetype.id, staRatio, attack.stance, patternDetected);
  return { attack, commentary };
}

// --- Reasoning-Aware Public API ---

/** Joust choice with full AI reasoning data for the thinking panel. */
export function aiPickJoustChoiceWithReasoning(
  state: PlayerState,
  opponentLastAttack?: Attack,
  opponentRevealedAttack?: Attack,
  difficulty: AIDifficulty = 'medium',
  history?: OpponentHistory,
): { choice: PassChoice; reasoning: AIReasoning } {
  const { speed, reasoning: speedReasoning } = pickSpeedWithReasoning(state, difficulty, history);
  const { attack, reasoning: attackReasoning } = pickJoustAttackWithReasoning(state, opponentLastAttack, speed, difficulty, history);

  let shiftAttack: Attack | undefined;
  let shiftReasoning: ShiftReasoning | undefined;
  if (opponentRevealedAttack) {
    const result = evaluateShiftWithReasoning(state, speed, attack, opponentRevealedAttack, difficulty);
    shiftAttack = result.shiftAttack;
    shiftReasoning = result.reasoning;
  }

  const staRatio = state.currentStamina / state.archetype.stamina;
  const patternDetected = difficulty === 'hard' && !!history?.predictedAttackId();
  const commentary = generateCommentary(state.archetype.id, staRatio, attack.stance, patternDetected);

  return {
    choice: { speed, attack, shiftAttack },
    reasoning: {
      speed: speedReasoning,
      attack: attackReasoning,
      shift: shiftReasoning,
      commentary,
    },
  };
}

/** Melee attack with full AI reasoning data for the thinking panel. */
export function aiPickMeleeAttackWithReasoning(
  state: PlayerState,
  opponentLastAttack?: Attack,
  difficulty: AIDifficulty = 'medium',
  history?: OpponentHistory,
): { attack: Attack; reasoning: AIReasoning } {
  const { attack, reasoning: attackReasoning } = pickMeleeAttackWithReasoning(state, opponentLastAttack, difficulty, history);

  const staRatio = state.currentStamina / state.archetype.stamina;
  const patternDetected = difficulty === 'hard' && !!history?.predictedAttackId();
  const commentary = generateCommentary(state.archetype.id, staRatio, attack.stance, patternDetected);

  return {
    attack,
    reasoning: {
      speed: {
        weights: { slow: 0, standard: 0, fast: 0 },
        staminaRatio: staRatio,
        archetypeBias: 'N/A (melee)',
        chosen: SpeedType.Standard,
        wasRandom: false,
      },
      attack: attackReasoning,
      commentary,
    },
  };
}
