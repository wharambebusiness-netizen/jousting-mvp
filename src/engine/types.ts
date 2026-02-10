// ============================================================
// Jousting MVP — Core Type Definitions (v4.1 spec)
// ============================================================

// --- Enums ---

export enum Stance {
  Aggressive = 'Aggressive',
  Balanced = 'Balanced',
  Defensive = 'Defensive',
}

export enum SpeedType {
  Slow = 'Slow',
  Standard = 'Standard',
  Fast = 'Fast',
}

export enum Phase {
  Setup = 'Setup',
  SpeedSelect = 'SpeedSelect',
  AttackSelect = 'AttackSelect',
  Reveal = 'Reveal',
  ShiftDecision = 'ShiftDecision',
  PassResolve = 'PassResolve',
  MeleeSelect = 'MeleeSelect',
  MeleeResolve = 'MeleeResolve',
  MatchEnd = 'MatchEnd',
}

export enum MeleeOutcome {
  Draw = 'Draw',
  Hit = 'Hit',
  Critical = 'Critical',
}

// --- Stat Deltas ---

export interface StatDeltas {
  momentum: number;
  control: number;
  guard: number;
  stamina: number;
}

// --- Speed ---

export interface SpeedData {
  type: SpeedType;
  deltaMomentum: number;
  deltaControl: number;
  deltaInitiative: number;
  deltaStamina: number;
  shiftThreshold: number; // Effective Control must be >= this to shift
}

// --- Attack ---

export interface Attack {
  id: string;
  name: string;
  stance: Stance;
  power: number;
  control: number;
  defense: number;
  risk: number;
  deltaMomentum: number;
  deltaControl: number;
  deltaGuard: number;
  deltaStamina: number;
  beats: string[];    // IDs of attacks this one counters
  beatenBy: string[]; // IDs of attacks that counter this one
  phase: 'joust' | 'melee';
}

// --- Archetype ---

export interface Archetype {
  id: string;
  name: string;
  momentum: number;
  control: number;
  guard: number;
  initiative: number;
  stamina: number;
  identity: string;
}

// --- Effective Stats (computed per pass/round) ---

export interface EffectiveStats {
  momentum: number;
  control: number;
  guard: number;
  initiative: number;
}

// --- Player State ---

export interface PlayerState {
  archetype: Archetype;
  currentStamina: number;
  // Cumulative melee carryover penalties (applied at melee start)
  carryoverMomentum: number;
  carryoverControl: number;
  carryoverGuard: number;
  /** Set true when this player was unseated during jousting (used for melee rebalance) */
  wasUnseated?: boolean;
}

// --- Pass Choice ---

export interface PassChoice {
  speed: SpeedType;
  attack: Attack;
  shiftAttack?: Attack; // If player shifts mid-run
}

// --- Impact Breakdown (shared by joust + melee) ---

export interface ImpactBreakdown {
  /** Momentum's contribution to impact: effMOM * 0.5 */
  momentumComponent: number;
  /** Accuracy's contribution to impact: accuracy * 0.4 */
  accuracyComponent: number;
  /** How much opponent's guard subtracted from impact (positive = damage absorbed) */
  guardPenalty: number;
  /** Counter bonus applied to this player's accuracy (+won, -lost, 0=none) */
  counterBonus: number;
  /** Whether opponent has breaker guard penetration against this player */
  opponentIsBreaker: boolean;
  /** Opponent's effective guard after breaker penetration */
  opponentEffectiveGuard: number;
}

// --- Pass Result ---

export interface PassResult {
  passNumber: number;
  player1: PassPlayerResult;
  player2: PassPlayerResult;
  unseat: 'none' | 'player1' | 'player2';
  unseatMargin: number;
  log: string[];
}

export interface PassPlayerResult {
  speed: SpeedType;
  initialAttack: Attack;
  finalAttack: Attack;
  shifted: boolean;
  effectiveStats: EffectiveStats;
  accuracy: number;
  impactScore: number;
  staminaAfter: number;
  fatigueFactor: number;
  /** Impact formula breakdown for UI display */
  breakdown?: ImpactBreakdown;
  /** Max stamina (archetype base) for fatigue context */
  maxStamina?: number;
}

// --- Melee Round Result ---

export interface MeleeRoundResult {
  roundNumber: number;
  player1Attack: Attack;
  player2Attack: Attack;
  player1ImpactScore: number;
  player2ImpactScore: number;
  margin: number;
  outcome: MeleeOutcome;
  winner: 'none' | 'player1' | 'player2';
  player1StaminaAfter: number;
  player2StaminaAfter: number;
  log: string[];
  /** Impact formula breakdown for player 1 */
  player1Breakdown?: ImpactBreakdown;
  /** Impact formula breakdown for player 2 */
  player2Breakdown?: ImpactBreakdown;
}

// --- Match State ---

export interface MatchState {
  phase: Phase;
  passNumber: number;
  player1: PlayerState;
  player2: PlayerState;
  passResults: PassResult[];
  cumulativeScore1: number;
  cumulativeScore2: number;
  meleeRoundResults: MeleeRoundResult[];
  meleeWins1: number;
  meleeWins2: number;
  winner: 'none' | 'player1' | 'player2' | 'draw';
  winReason: string;
}

// --- Counter Result ---

export type CounterResult = {
  player1Bonus: number; // Scaled: +(counterBaseBonus + CTL*0.1), negated, or 0
  player2Bonus: number; // Scaled: +(counterBaseBonus + CTL*0.1), negated, or 0
};

// --- Gear Variant System ---

export type GearVariant = 'aggressive' | 'balanced' | 'defensive';

export interface GearVariantDefinition {
  variant: GearVariant;
  name: string;
  primaryStat: JoustStat;
  secondaryStat: JoustStat;
  affinity: string; // archetype id (informational only, no mechanical bonus)
}

// --- Gigling Gear System ---

export type GiglingRarity = 'uncommon' | 'rare' | 'epic' | 'legendary' | 'relic' | 'giga';

/** 6 steed gear slots — mount equipment affecting jousting stats */
export type SteedGearSlot = 'chamfron' | 'barding' | 'saddle' | 'stirrups' | 'reins' | 'horseshoes';

/** 6 player gear slots — knight equipment affecting jousting + melee stats */
export type PlayerGearSlot = 'helm' | 'shield' | 'lance' | 'armor' | 'gauntlets' | 'melee_weapon';

export type JoustStat = 'momentum' | 'control' | 'guard' | 'initiative' | 'stamina';

export interface GiglingGear {
  slot: SteedGearSlot;
  rarity: GiglingRarity;
  variant?: GearVariant;
  primaryStat?: { stat: JoustStat; value: number };
  secondaryStat?: { stat: JoustStat; value: number };
}

/** Player gear — knight's personal equipment */
export interface PlayerGear {
  slot: PlayerGearSlot;
  rarity: GiglingRarity;
  variant?: GearVariant;
  primaryStat?: { stat: JoustStat; value: number };
  secondaryStat?: { stat: JoustStat; value: number };
}

/** Steed loadout — 6 gear slots for the mount */
export interface GiglingLoadout {
  giglingRarity: GiglingRarity;
  chamfron?: GiglingGear;
  barding?: GiglingGear;
  saddle?: GiglingGear;
  stirrups?: GiglingGear;
  reins?: GiglingGear;
  horseshoes?: GiglingGear;
}

/** Player loadout — 6 gear slots for the knight */
export interface PlayerLoadout {
  helm?: PlayerGear;
  shield?: PlayerGear;
  lance?: PlayerGear;
  armor?: PlayerGear;
  gauntlets?: PlayerGear;
  melee_weapon?: PlayerGear;
}

// --- AI Difficulty ---

export type AIDifficulty = 'easy' | 'medium' | 'hard';
