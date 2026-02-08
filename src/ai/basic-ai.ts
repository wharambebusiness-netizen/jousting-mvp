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

function pickSpeed(state: PlayerState, difficulty: AIDifficulty, history?: OpponentHistory): SpeedType {
  const arch = state.archetype;
  const sta = state.currentStamina;
  const staRatio = sta / arch.stamina;

  // Emergency: very low stamina → always Slow
  if (staRatio <= 0.25) return SpeedType.Slow;

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

  // Difficulty-based optimal vs random
  if (Math.random() < randomRatio(difficulty)) {
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
  opponentLastAttack: Attack | undefined,
  chosenSpeed: SpeedType,
  difficulty: AIDifficulty,
  history?: OpponentHistory,
): Attack {
  const arch = state.archetype;
  const sta = state.currentStamina;
  const staRatio = sta / arch.stamina;
  const attacks = JOUST_ATTACK_LIST;

  // Score each attack
  const scores = attacks.map(atk => {
    let score = 5; // base

    // Stat affinity: if archetype is MOM-heavy, favor Agg attacks
    if (arch.momentum >= 65 && atk.stance === Stance.Aggressive) score += 3;
    if (arch.guard >= 65 && atk.stance === Stance.Defensive) score += 3;
    if (arch.control >= 65 && atk.stance === Stance.Balanced) score += 2;

    // Speed-attack synergy: boost attacks that pair well with chosen speed
    if (chosenSpeed === SpeedType.Fast && atk.stance === Stance.Aggressive) score += 2;
    if (chosenSpeed === SpeedType.Slow && atk.stance === Stance.Defensive) score += 2;
    if (chosenSpeed === SpeedType.Standard && atk.stance === Stance.Balanced) score += 1;

    // Stamina awareness: penalize expensive attacks when low (percentage-based)
    if (staRatio < 0.50 && atk.deltaStamina < -15) score -= 3;
    if (staRatio < 0.35 && atk.deltaStamina < -10) score -= 2;

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

    // Pattern exploitation (hard difficulty only)
    if (difficulty === 'hard' && history) {
      const predictedId = history.predictedAttackId();
      if (predictedId) {
        // Boost attacks that counter the predicted attack
        if (atk.beats.includes(predictedId)) score += BALANCE.aiPattern.patternWeight;
      }
    }

    return Math.max(1, score);
  });

  // Difficulty-based optimal vs random
  if (Math.random() < randomRatio(difficulty)) {
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
  difficulty: AIDifficulty,
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
    // Difficulty-based: sometimes don't shift even when it's good (unpredictability)
    if (Math.random() < randomRatio(difficulty)) return undefined;
    return bestAttack;
  }

  return undefined;
}

// --- Melee Attack Selection ---

function pickMeleeAttack(
  state: PlayerState,
  opponentLastAttack: Attack | undefined,
  difficulty: AIDifficulty,
  history?: OpponentHistory,
): Attack {
  const arch = state.archetype;
  const sta = state.currentStamina;
  const staRatio = sta / arch.stamina;
  const attacks = MELEE_ATTACK_LIST;

  const scores = attacks.map(atk => {
    let score = 5;

    // Archetype affinity
    if (arch.momentum >= 65 && atk.stance === Stance.Aggressive) score += 3;
    if (arch.guard >= 65 && atk.stance === Stance.Defensive) score += 3;
    if (arch.control >= 65 && atk.stance === Stance.Balanced) score += 2;

    // Archetype personality: melee aggression modifier
    const personality = getPersonality(arch.id);
    if (atk.stance === Stance.Aggressive) score += personality.meleeAggression;

    // Stamina awareness (percentage-based)
    if (staRatio < 0.35 && atk.deltaStamina < -12) score -= 3;

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

    // Pattern exploitation (hard difficulty only)
    if (difficulty === 'hard' && history) {
      const predictedId = history.predictedAttackId();
      if (predictedId) {
        if (atk.beats.includes(predictedId)) score += BALANCE.aiPattern.patternWeight;
      }
    }

    return Math.max(1, score);
  });

  // Difficulty-based optimal vs random
  if (Math.random() < randomRatio(difficulty)) {
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
