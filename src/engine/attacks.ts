// ============================================================
// Jousting MVP — Attack Data Tables (v4.1 spec)
// ============================================================
import { Stance, SpeedType, type Attack, type SpeedData } from './types';

// --- Speed Data ---

export const SPEEDS: Record<SpeedType, SpeedData> = {
  [SpeedType.Slow]: {
    type: SpeedType.Slow,
    deltaMomentum: -15,
    deltaControl: +15,
    deltaInitiative: 0,
    deltaStamina: +5,
    shiftThreshold: 50,
  },
  [SpeedType.Standard]: {
    type: SpeedType.Standard,
    deltaMomentum: 0,
    deltaControl: 0,
    deltaInitiative: +10,
    deltaStamina: 0,
    shiftThreshold: 60,
  },
  [SpeedType.Fast]: {
    type: SpeedType.Fast,
    deltaMomentum: +15,
    deltaControl: -15,
    deltaInitiative: +20,
    deltaStamina: -5,
    shiftThreshold: 70,
  },
};

// --- Joust Attacks (v4.1 Section 5.2 + Counter Table 2.3) ---

export const JOUST_ATTACKS: Record<string, Attack> = {
  coupFort: {
    id: 'coupFort',
    name: 'Coup Fort',
    stance: Stance.Aggressive,
    power: 5, control: 2, defense: 1, risk: 5,
    deltaMomentum: +25, deltaControl: -10, deltaGuard: -5, deltaStamina: -20,
    beats: ['portDeLance'],
    beatenBy: ['coupEnPassant', 'courseDeLance'],
    phase: 'joust',
  },
  brisDeGarde: {
    id: 'brisDeGarde',
    name: 'Bris de Garde',
    stance: Stance.Aggressive,
    power: 4, control: 4, defense: 2, risk: 4,
    deltaMomentum: +10, deltaControl: +15, deltaGuard: -5, deltaStamina: -15,
    beats: ['portDeLance', 'coupDePointe'],
    beatenBy: ['courseDeLance'],
    phase: 'joust',
  },
  courseDeLance: {
    id: 'courseDeLance',
    name: 'Course de Lance',
    stance: Stance.Balanced,
    power: 3, control: 3, defense: 3, risk: 2,
    deltaMomentum: +5, deltaControl: +10, deltaGuard: +5, deltaStamina: -10,
    beats: ['coupFort', 'brisDeGarde'],
    beatenBy: ['portDeLance'],
    phase: 'joust',
  },
  coupDePointe: {
    id: 'coupDePointe',
    name: 'Coup de Pointe',
    stance: Stance.Balanced,
    power: 3, control: 5, defense: 2, risk: 3,
    deltaMomentum: 0, deltaControl: +20, deltaGuard: 0, deltaStamina: -12,
    beats: ['portDeLance'],
    beatenBy: ['brisDeGarde', 'coupEnPassant'],
    phase: 'joust',
  },
  portDeLance: {
    id: 'portDeLance',
    name: 'Port de Lance',
    stance: Stance.Defensive,
    power: 2, control: 4, defense: 5, risk: 2,
    deltaMomentum: -5, deltaControl: +10, deltaGuard: +20, deltaStamina: -8,
    beats: ['courseDeLance', 'coupEnPassant'],
    beatenBy: ['coupFort', 'brisDeGarde', 'coupDePointe'],
    phase: 'joust',
  },
  coupEnPassant: {
    id: 'coupEnPassant',
    name: 'Coup en Passant',
    stance: Stance.Defensive,
    power: 3, control: 5, defense: 4, risk: 4,
    deltaMomentum: +5, deltaControl: +15, deltaGuard: +10, deltaStamina: -14,
    beats: ['coupFort', 'coupDePointe'],
    beatenBy: ['portDeLance'],
    phase: 'joust',
  },
};

// --- Melee Attacks (v4.1 Section 7.2 + Counter Table 2.4) ---

export const MELEE_ATTACKS: Record<string, Attack> = {
  overhandCleave: {
    id: 'overhandCleave',
    name: 'Overhand Cleave',
    stance: Stance.Aggressive,
    power: 5, control: 2, defense: 1, risk: 5,
    deltaMomentum: +20, deltaControl: -10, deltaGuard: -5, deltaStamina: -18,
    beats: ['guardHigh', 'riposteStep'],
    beatenBy: ['measuredCut', 'precisionThrust'],
    phase: 'melee',
  },
  feintBreak: {
    id: 'feintBreak',
    name: 'Feint Break',
    stance: Stance.Aggressive,
    power: 4, control: 4, defense: 2, risk: 4,
    deltaMomentum: +10, deltaControl: +10, deltaGuard: -5, deltaStamina: -15,
    beats: ['precisionThrust'],
    beatenBy: ['riposteStep'],
    phase: 'melee',
  },
  measuredCut: {
    id: 'measuredCut',
    name: 'Measured Cut',
    stance: Stance.Balanced,
    power: 3, control: 3, defense: 3, risk: 2,
    deltaMomentum: +5, deltaControl: +10, deltaGuard: +5, deltaStamina: -10,
    beats: ['overhandCleave', 'riposteStep'],
    beatenBy: ['guardHigh'],
    phase: 'melee',
  },
  precisionThrust: {
    id: 'precisionThrust',
    name: 'Precision Thrust',
    stance: Stance.Balanced,
    power: 3, control: 5, defense: 2, risk: 3,
    deltaMomentum: +5, deltaControl: +15, deltaGuard: 0, deltaStamina: -12,
    beats: ['overhandCleave'],
    beatenBy: ['feintBreak', 'riposteStep'],
    phase: 'melee',
  },
  guardHigh: {
    id: 'guardHigh',
    name: 'Guard High',
    stance: Stance.Defensive,
    power: 2, control: 3, defense: 5, risk: 2,
    deltaMomentum: -5, deltaControl: +5, deltaGuard: +20, deltaStamina: -8,
    beats: ['measuredCut'],
    beatenBy: ['overhandCleave'],
    phase: 'melee',
  },
  riposteStep: {
    id: 'riposteStep',
    name: 'Riposte Step',
    stance: Stance.Defensive,
    power: 3, control: 5, defense: 4, risk: 4,
    deltaMomentum: +5, deltaControl: +15, deltaGuard: +10, deltaStamina: -12,
    beats: ['feintBreak', 'precisionThrust'],
    beatenBy: ['overhandCleave', 'measuredCut'],
    phase: 'melee',
  },
};

// Convenience arrays
export const JOUST_ATTACK_LIST: Attack[] = Object.values(JOUST_ATTACKS);
export const MELEE_ATTACK_LIST: Attack[] = Object.values(MELEE_ATTACKS);

export function getJoustAttacksByStance(stance: Stance): Attack[] {
  return JOUST_ATTACK_LIST.filter(a => a.stance === stance);
}

export function getMeleeAttacksByStance(stance: Stance): Attack[] {
  return MELEE_ATTACK_LIST.filter(a => a.stance === stance);
}
