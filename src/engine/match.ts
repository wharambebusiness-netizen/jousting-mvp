// ============================================================
// Jousting MVP — Match State Machine (v4.1 spec + Caparison)
// ============================================================
import {
  MeleeOutcome,
  Phase,
  type Archetype,
  type Attack,
  type CaparisonInput,
  type GiglingLoadout,
  type MatchState,
  type MeleeRoundResult,
  type PassChoice,
  type PassResult,
  type PlayerState,
} from './types';
import { resolveJoustPass } from './phase-joust';
import { resolveMeleeRoundFn } from './phase-melee';
import { calcCarryoverPenalties } from './calculator';
import { BALANCE } from './balance-config';
import { applyGiglingLoadout, getCaparisonEffect } from './gigling-gear';

const MAX_PASSES = 5;

// --- Create initial match state ---

export function createMatch(
  archetype1: Archetype,
  archetype2: Archetype,
  loadout1?: GiglingLoadout,
  loadout2?: GiglingLoadout,
): MatchState {
  const boosted1 = applyGiglingLoadout(archetype1, loadout1);
  const boosted2 = applyGiglingLoadout(archetype2, loadout2);

  return {
    phase: Phase.SpeedSelect,
    passNumber: 1,
    player1: {
      archetype: boosted1,
      currentStamina: boosted1.stamina,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    },
    player2: {
      archetype: boosted2,
      currentStamina: boosted2.stamina,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    },
    passResults: [],
    cumulativeScore1: 0,
    cumulativeScore2: 0,
    meleeRoundResults: [],
    meleeWins1: 0,
    meleeWins2: 0,
    winner: 'none',
    winReason: '',
    // Caparison tracking
    p1Caparison: getCaparisonEffect(loadout1),
    p2Caparison: getCaparisonEffect(loadout2),
    p1BannerUsed: false,
    p2BannerUsed: false,
  };
}

// --- Build CaparisonInput for a player ---

function capInput(state: MatchState, player: 'player1' | 'player2'): CaparisonInput | undefined {
  const effect = player === 'player1' ? state.p1Caparison : state.p2Caparison;
  if (!effect) return undefined;
  return {
    effect,
    bannerUsed: player === 'player1' ? state.p1BannerUsed : state.p2BannerUsed,
  };
}

// --- Submit a joust pass ---

export function submitJoustPass(
  state: MatchState,
  p1Choice: PassChoice,
  p2Choice: PassChoice,
): MatchState {
  if (state.phase !== Phase.SpeedSelect && state.phase !== Phase.AttackSelect) {
    throw new Error(`Cannot submit joust pass in phase ${state.phase}`);
  }

  const result = resolveJoustPass(
    state.passNumber,
    state.player1,
    state.player2,
    p1Choice,
    p2Choice,
    capInput(state, 'player1'),
    capInput(state, 'player2'),
  );

  // Update state
  const newState: MatchState = {
    ...state,
    passResults: [...state.passResults, result],
    cumulativeScore1: state.cumulativeScore1 + result.player1.impactScore,
    cumulativeScore2: state.cumulativeScore2 + result.player2.impactScore,
    player1: {
      ...state.player1,
      currentStamina: result.player1.staminaAfter,
    },
    player2: {
      ...state.player2,
      currentStamina: result.player2.staminaAfter,
    },
    passNumber: state.passNumber + 1,
    // Track banner consumption
    p1BannerUsed: state.p1BannerUsed || !!result.p1BannerConsumed,
    p2BannerUsed: state.p2BannerUsed || !!result.p2BannerConsumed,
  };

  // Check unseat → transition to melee
  if (result.unseat !== 'none') {
    return transitionToMelee(newState, result);
  }

  // Check if 5 passes complete
  if (newState.passNumber > MAX_PASSES) {
    return resolveJoustEnd(newState);
  }

  // Continue jousting
  newState.phase = Phase.SpeedSelect;
  return newState;
}

// --- Transition to melee after unseat ---

function transitionToMelee(state: MatchState, lastPass: PassResult): MatchState {
  const unseatMargin = lastPass.unseatMargin;
  const penalties = calcCarryoverPenalties(unseatMargin);

  // The unseated player gets penalties.
  // If player1 unseats player2 → player2 was unseated → player2 gets penalties
  const unseatedPlayer = lastPass.unseat === 'player1' ? 'player2' : 'player1';

  const newState = { ...state };

  if (unseatedPlayer === 'player1') {
    newState.player1 = {
      ...state.player1,
      carryoverMomentum: penalties.momentumPenalty,
      carryoverControl: penalties.controlPenalty,
      carryoverGuard: penalties.guardPenalty,
    };
  } else {
    newState.player2 = {
      ...state.player2,
      carryoverMomentum: penalties.momentumPenalty,
      carryoverControl: penalties.controlPenalty,
      carryoverGuard: penalties.guardPenalty,
    };
  }

  newState.phase = Phase.MeleeSelect;
  return newState;
}

// --- Resolve joust end (5 passes, no unseat) ---

function resolveJoustEnd(state: MatchState): MatchState {
  if (state.cumulativeScore1 > state.cumulativeScore2) {
    return {
      ...state,
      phase: Phase.MatchEnd,
      winner: 'player1',
      winReason: `P1 wins on cumulative ImpactScore (${state.cumulativeScore1.toFixed(2)} vs ${state.cumulativeScore2.toFixed(2)})`,
    };
  } else if (state.cumulativeScore2 > state.cumulativeScore1) {
    return {
      ...state,
      phase: Phase.MatchEnd,
      winner: 'player2',
      winReason: `P2 wins on cumulative ImpactScore (${state.cumulativeScore2.toFixed(2)} vs ${state.cumulativeScore1.toFixed(2)})`,
    };
  } else {
    // Tied → melee with no carryover penalties
    return {
      ...state,
      phase: Phase.MeleeSelect,
    };
  }
}

// --- Submit a melee round ---

export function submitMeleeRound(
  state: MatchState,
  p1Attack: Attack,
  p2Attack: Attack,
): MatchState {
  if (state.phase !== Phase.MeleeSelect) {
    throw new Error(`Cannot submit melee round in phase ${state.phase}`);
  }

  const roundNumber = state.meleeRoundResults.length + 1;
  const result = resolveMeleeRoundFn(
    roundNumber,
    state.player1,
    state.player2,
    p1Attack,
    p2Attack,
    capInput(state, 'player1'),
    capInput(state, 'player2'),
  );

  const isCrit = result.outcome === MeleeOutcome.Critical;
  const winsGained = isCrit ? BALANCE.criticalWinsValue : 1;

  let newWins1 = state.meleeWins1;
  let newWins2 = state.meleeWins2;

  if (result.winner === 'player1') newWins1 += winsGained;
  if (result.winner === 'player2') newWins2 += winsGained;

  const newState: MatchState = {
    ...state,
    meleeRoundResults: [...state.meleeRoundResults, result],
    meleeWins1: newWins1,
    meleeWins2: newWins2,
    player1: {
      ...state.player1,
      currentStamina: result.player1StaminaAfter,
    },
    player2: {
      ...state.player2,
      currentStamina: result.player2StaminaAfter,
    },
    // Track banner consumption in melee too
    p1BannerUsed: state.p1BannerUsed || !!result.p1BannerConsumed,
    p2BannerUsed: state.p2BannerUsed || !!result.p2BannerConsumed,
  };

  // Check round wins (criticals count for 2 via winsGained)
  if (newWins1 >= BALANCE.meleeWinsNeeded) {
    return {
      ...newState,
      phase: Phase.MatchEnd,
      winner: 'player1',
      winReason: isCrit && result.winner === 'player1'
        ? `P1 wins melee by CRITICAL (${newWins1} round wins, margin ${result.margin.toFixed(2)})`
        : `P1 wins melee (${newWins1} round wins)`,
    };
  }
  if (newWins2 >= BALANCE.meleeWinsNeeded) {
    return {
      ...newState,
      phase: Phase.MatchEnd,
      winner: 'player2',
      winReason: isCrit && result.winner === 'player2'
        ? `P2 wins melee by CRITICAL (${newWins2} round wins, margin ${result.margin.toFixed(2)})`
        : `P2 wins melee (${newWins2} round wins)`,
    };
  }

  // Check both at stamina 0 → tiebreaker (Section 7.4)
  if (newState.player1.currentStamina <= 0 && newState.player2.currentStamina <= 0) {
    return resolveMeleeExhaustion(newState);
  }

  // Continue melee
  newState.phase = Phase.MeleeSelect;
  return newState;
}

// --- Melee exhaustion tiebreaker (Section 7.4) ---

function resolveMeleeExhaustion(state: MatchState): MatchState {
  // More round wins wins
  if (state.meleeWins1 > state.meleeWins2) {
    return {
      ...state,
      phase: Phase.MatchEnd,
      winner: 'player1',
      winReason: `Both exhausted — P1 wins on melee round wins (${state.meleeWins1} vs ${state.meleeWins2})`,
    };
  }
  if (state.meleeWins2 > state.meleeWins1) {
    return {
      ...state,
      phase: Phase.MatchEnd,
      winner: 'player2',
      winReason: `Both exhausted — P2 wins on melee round wins (${state.meleeWins2} vs ${state.meleeWins1})`,
    };
  }

  // Tied on round wins → joust score tiebreaker
  if (state.cumulativeScore1 > state.cumulativeScore2) {
    return {
      ...state,
      phase: Phase.MatchEnd,
      winner: 'player1',
      winReason: `Both exhausted, melee tied — P1 wins on joust score (${state.cumulativeScore1.toFixed(2)} vs ${state.cumulativeScore2.toFixed(2)})`,
    };
  }
  if (state.cumulativeScore2 > state.cumulativeScore1) {
    return {
      ...state,
      phase: Phase.MatchEnd,
      winner: 'player2',
      winReason: `Both exhausted, melee tied — P2 wins on joust score (${state.cumulativeScore2.toFixed(2)} vs ${state.cumulativeScore1.toFixed(2)})`,
    };
  }

  // Everything tied = draw
  return {
    ...state,
    phase: Phase.MatchEnd,
    winner: 'draw',
    winReason: 'Both exhausted, melee tied, joust tied — DRAW',
  };
}
