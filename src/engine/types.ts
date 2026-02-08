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
}

// --- Pass Choice ---

export interface PassChoice {
  speed: SpeedType;
  attack: Attack;
  shiftAttack?: Attack; // If player shifts mid-run
}

// --- Pass Result ---

export interface PassResult {
  passNumber: number;
  player1: PassPlayerResult;
  player2: PassPlayerResult;
  unseat: 'none' | 'player1' | 'player2';
  unseatMargin: number;
  log: string[];
  p1BannerConsumed?: boolean;
  p2BannerConsumed?: boolean;
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
  p1BannerConsumed?: boolean;
  p2BannerConsumed?: boolean;
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
  // Caparison tracking
  p1Caparison?: CaparisonEffect;
  p2Caparison?: CaparisonEffect;
  p1BannerUsed: boolean;
  p2BannerUsed: boolean;
}

// --- Counter Result ---

export type CounterResult = {
  player1Bonus: number; // +10, -10, or 0
  player2Bonus: number; // +10, -10, or 0
};

// --- Gigling Gear System ---

export type GiglingRarity = 'uncommon' | 'rare' | 'epic' | 'legendary' | 'relic' | 'giga';

export type GearSlot = 'barding' | 'chanfron' | 'saddle' | 'caparison';

export type JoustStat = 'momentum' | 'control' | 'guard' | 'initiative' | 'stamina';

export type CaparisonEffectId =
  | 'pennant_of_haste'
  | 'woven_shieldcloth'
  | 'thunderweave'
  | 'irongrip_drape'
  | 'stormcloak'
  | 'banner_of_the_giga';

export interface CaparisonEffect {
  id: CaparisonEffectId;
  name: string;
  description: string;
  rarity: GiglingRarity;
}

export interface GiglingGear {
  slot: GearSlot;
  rarity: GiglingRarity;
  primaryStat?: { stat: JoustStat; value: number };
  secondaryStat?: { stat: JoustStat; value: number };
  effect?: CaparisonEffect; // caparison only
}

export interface GiglingLoadout {
  giglingRarity: GiglingRarity;
  barding?: GiglingGear;
  chanfron?: GiglingGear;
  saddle?: GiglingGear;
  caparison?: GiglingGear;
}

// --- Caparison Pipeline Types ---

export interface CaparisonInput {
  effect?: CaparisonEffect;
  bannerUsed?: boolean; // only relevant for banner_of_the_giga
}
