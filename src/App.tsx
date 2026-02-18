import { useReducer, useRef } from 'react';
import './App.css';
import {
  Phase,
  SpeedType,
  type MatchState,
  type Attack,
  type PassChoice,
  type Archetype,
  type AIDifficulty,
  type PassResult,
  type MeleeRoundResult,
  type GiglingLoadout,
  type PlayerLoadout,
} from './engine/types';
import { createMatch, submitJoustPass, submitMeleeRound } from './engine/match';
import { createFullLoadout } from './engine/gigling-gear';
import { createFullPlayerLoadout } from './engine/player-gear';
import { aiPickJoustChoiceWithReasoning, aiPickMeleeAttackWithReasoning } from './ai/basic-ai';
import type { AIReasoning } from './ai/basic-ai';
import { SetupScreen } from './ui/SetupScreen';
import { LoadoutScreen } from './ui/LoadoutScreen';
import { SpeedSelect } from './ui/SpeedSelect';
import { JoustAttackSelect, MeleeAttackSelect } from './ui/AttackSelect';
import { RevealScreen } from './ui/RevealScreen';
import { PassResultScreen } from './ui/PassResult';
import { MeleeResultScreen } from './ui/MeleeResult';
import { MatchSummary } from './ui/MatchSummary';
import { CombatLog } from './ui/CombatLog';
import { MeleeTransitionScreen } from './ui/MeleeTransitionScreen';
import { AIThinkingPanel } from './ui/AIThinkingPanel';
import { DifficultyFeedback, StrategyTips, MatchReplay } from './ui/AIEndScreenPanels';

type Screen =
  | 'setup'
  | 'loadout'
  | 'speed'
  | 'attack'
  | 'reveal'
  | 'pass-result'
  | 'melee-transition'
  | 'melee'
  | 'melee-result'
  | 'end';

interface GameState {
  screen: Screen;
  transitioning: boolean;
  match: MatchState | null;
  p1Archetype: Archetype | null;
  p2Archetype: Archetype | null;
  playerSpeed: SpeedType;
  playerAttack: Attack | null;
  aiChoice: PassChoice | null;
  lastPassResult: PassResult | null;
  lastMeleeResult: MeleeRoundResult | null;
  combatLog: string[][];
  p1Loadout: GiglingLoadout | null;
  p2Loadout: GiglingLoadout | null;
  p1PlayerLoadout: PlayerLoadout | null;
  p2PlayerLoadout: PlayerLoadout | null;
  difficulty: AIDifficulty;
  aiReasoning: AIReasoning | null;
  reasoningHistory: AIReasoning[];
}

const initialState: GameState = {
  screen: 'setup',
  transitioning: false,
  match: null,
  p1Archetype: null,
  p2Archetype: null,
  playerSpeed: SpeedType.Standard,
  playerAttack: null,
  aiChoice: null,
  lastPassResult: null,
  lastMeleeResult: null,
  combatLog: [],
  p1Loadout: null,
  p2Loadout: null,
  p1PlayerLoadout: null,
  p2PlayerLoadout: null,
  difficulty: 'medium',
  aiReasoning: null,
  reasoningHistory: [],
};

type Action =
  | { type: 'START'; p1: Archetype; p2: Archetype; difficulty: AIDifficulty }
  | { type: 'CONFIRM_LOADOUT'; p1Loadout: GiglingLoadout; p2Loadout: GiglingLoadout; p1PlayerLoadout: PlayerLoadout; p2PlayerLoadout: PlayerLoadout; match: MatchState }
  | { type: 'SELECT_SPEED'; speed: SpeedType }
  | { type: 'SELECT_ATTACK'; attack: Attack; aiChoice: PassChoice; reasoning: AIReasoning }
  | { type: 'RESOLVE_PASS'; match: MatchState; passResult: PassResult }
  | { type: 'PASS_CONTINUE'; nextScreen: Screen }
  | { type: 'MELEE_ATTACK'; match: MatchState; roundResult: MeleeRoundResult; reasoning: AIReasoning }
  | { type: 'MELEE_CONTINUE'; nextScreen: Screen }
  | { type: 'REMATCH' }
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'START_TRANSITION' }
  | { type: 'END_TRANSITION'; screen: Screen };

function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'START':
      return {
        ...state,
        p1Archetype: action.p1,
        p2Archetype: action.p2,
        difficulty: action.difficulty,
        combatLog: [],
      };
    case 'CONFIRM_LOADOUT':
      return {
        ...state,
        p1Loadout: action.p1Loadout,
        p2Loadout: action.p2Loadout,
        p1PlayerLoadout: action.p1PlayerLoadout,
        p2PlayerLoadout: action.p2PlayerLoadout,
        match: action.match,
        combatLog: [],
      };
    case 'SELECT_SPEED':
      return { ...state, playerSpeed: action.speed };
    case 'SELECT_ATTACK':
      return {
        ...state,
        playerAttack: action.attack,
        aiChoice: action.aiChoice,
        aiReasoning: action.reasoning,
        reasoningHistory: [...state.reasoningHistory, action.reasoning],
      };
    case 'RESOLVE_PASS':
      return {
        ...state,
        match: action.match,
        lastPassResult: action.passResult,
        combatLog: [...state.combatLog, action.passResult.log],
      };
    case 'PASS_CONTINUE':
      return state;
    case 'MELEE_ATTACK':
      return {
        ...state,
        match: action.match,
        lastMeleeResult: action.roundResult,
        aiReasoning: action.reasoning,
        reasoningHistory: [...state.reasoningHistory, action.reasoning],
        combatLog: [...state.combatLog, action.roundResult.log],
      };
    case 'MELEE_CONTINUE':
      return state;
    case 'REMATCH':
      return { ...initialState };
    case 'SET_SCREEN':
      return { ...state, screen: action.screen };
    case 'START_TRANSITION':
      return { ...state, transitioning: true };
    case 'END_TRANSITION':
      return { ...state, transitioning: false, screen: action.screen };
    default:
      return state;
  }
}

function App() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const transitionTimer = useRef<ReturnType<typeof setTimeout>>();

  const {
    screen, transitioning, match, p1Archetype, p2Archetype,
    playerSpeed, playerAttack, aiChoice, lastPassResult, lastMeleeResult,
    combatLog, p1Loadout, p2Loadout, p1PlayerLoadout, p2PlayerLoadout,
    difficulty, aiReasoning, reasoningHistory,
  } = state;

  /** Fade out current screen, then switch to next */
  const transitionTo = (next: Screen) => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
    dispatch({ type: 'START_TRANSITION' });
    transitionTimer.current = setTimeout(() => {
      dispatch({ type: 'END_TRANSITION', screen: next });
    }, 150);
  };

  // --- Setup ---
  const handleStart = (p1: Archetype, p2: Archetype, diff: AIDifficulty) => {
    dispatch({ type: 'START', p1, p2, difficulty: diff });
    transitionTo('loadout');
  };

  // --- Loadout confirm ---
  const handleLoadoutConfirm = (steedLoadout: GiglingLoadout, playerLoadout: PlayerLoadout) => {
    if (!p1Archetype || !p2Archetype) return;
    const aiRarity = steedLoadout.giglingRarity;
    const aiSteedLoadout = createFullLoadout(aiRarity, aiRarity);
    const aiPlayerLoadout = createFullPlayerLoadout(aiRarity);
    const m = createMatch(p1Archetype, p2Archetype, steedLoadout, aiSteedLoadout, playerLoadout, aiPlayerLoadout);
    dispatch({
      type: 'CONFIRM_LOADOUT',
      p1Loadout: steedLoadout,
      p2Loadout: aiSteedLoadout,
      p1PlayerLoadout: playerLoadout,
      p2PlayerLoadout: aiPlayerLoadout,
      match: m,
    });
    transitionTo('speed');
  };

  // --- Speed select ---
  const handleSpeedSelect = (speed: SpeedType) => {
    dispatch({ type: 'SELECT_SPEED', speed });
    transitionTo('attack');
  };

  // --- Joust attack select ---
  const handleAttackSelect = (attack: Attack) => {
    const lastP2Attack = match!.passResults.length > 0
      ? match!.passResults[match!.passResults.length - 1].player2.finalAttack
      : undefined;
    const { choice: ai, reasoning } = aiPickJoustChoiceWithReasoning(match!.player2, lastP2Attack, attack, difficulty);
    dispatch({ type: 'SELECT_ATTACK', attack, aiChoice: ai, reasoning });
    transitionTo('reveal');
  };

  // --- Reveal + shift decision ---
  const handleResolve = (shiftAttack?: Attack) => {
    const p1Choice: PassChoice = {
      speed: playerSpeed,
      attack: playerAttack!,
      shiftAttack,
    };
    const newMatch = submitJoustPass(match!, p1Choice, aiChoice!);
    const passResult = newMatch.passResults[newMatch.passResults.length - 1];
    dispatch({ type: 'RESOLVE_PASS', match: newMatch, passResult });
    transitionTo('pass-result');
  };

  // --- Pass result continue ---
  const handlePassContinue = () => {
    if (!match) return;
    if (match.phase === Phase.MeleeSelect) {
      transitionTo('melee-transition');
    } else if (match.phase === Phase.MatchEnd) {
      transitionTo('end');
    } else {
      transitionTo('speed');
    }
  };

  // --- Melee attack select ---
  const handleMeleeAttack = (attack: Attack) => {
    const lastP2Attack = match!.meleeRoundResults.length > 0
      ? match!.meleeRoundResults[match!.meleeRoundResults.length - 1].player2Attack
      : undefined;
    const { attack: aiAttack, reasoning } = aiPickMeleeAttackWithReasoning(match!.player2, lastP2Attack, difficulty);
    const newMatch = submitMeleeRound(match!, attack, aiAttack);
    const roundResult = newMatch.meleeRoundResults[newMatch.meleeRoundResults.length - 1];
    dispatch({ type: 'MELEE_ATTACK', match: newMatch, roundResult, reasoning });
    transitionTo('melee-result');
  };

  // --- Melee result continue ---
  const handleMeleeContinue = () => {
    if (!match) return;
    if (match.phase === Phase.MatchEnd) {
      transitionTo('end');
    } else {
      transitionTo('melee');
    }
  };

  // --- Rematch ---
  const handleRematch = () => {
    dispatch({ type: 'REMATCH' });
    transitionTo('setup');
  };

  return (
    <div className={transitioning ? 'screen-exit' : 'screen-enter'}>
      {screen !== 'setup' && screen !== 'loadout' && screen !== 'end' && (
        <div className="app-header">
          <h1>Joust & Melee</h1>
        </div>
      )}

      {screen === 'setup' && (
        <SetupScreen onStart={handleStart} />
      )}

      {screen === 'loadout' && p1Archetype && p2Archetype && (
        <LoadoutScreen
          archetype={p1Archetype}
          opponentName={p2Archetype.name}
          onConfirm={handleLoadoutConfirm}
        />
      )}

      {screen === 'speed' && match && (
        <SpeedSelect match={match} onSelect={handleSpeedSelect} />
      )}

      {screen === 'attack' && match && (
        <JoustAttackSelect match={match} speed={playerSpeed} onSelect={handleAttackSelect} />
      )}

      {screen === 'reveal' && match && playerAttack && aiChoice && (
        <RevealScreen
          match={match}
          playerSpeed={playerSpeed}
          playerAttack={playerAttack}
          aiSpeed={aiChoice.speed}
          aiAttack={aiChoice.attack}
          onResolve={handleResolve}
        />
      )}

      {screen === 'pass-result' && match && lastPassResult && (
        <>
          <PassResultScreen
            match={match}
            result={lastPassResult}
            onContinue={handlePassContinue}
          />
          {aiReasoning && <AIThinkingPanel reasoning={aiReasoning} />}
        </>
      )}

      {screen === 'melee-transition' && match && lastPassResult && (
        <MeleeTransitionScreen
          match={match}
          lastPassResult={lastPassResult}
          onContinue={() => transitionTo('melee')}
        />
      )}

      {screen === 'melee' && match && (
        <MeleeAttackSelect match={match} onSelect={handleMeleeAttack} />
      )}

      {screen === 'melee-result' && match && lastMeleeResult && (
        <>
          <MeleeResultScreen
            match={match}
            result={lastMeleeResult}
            onContinue={handleMeleeContinue}
          />
          {aiReasoning && <AIThinkingPanel reasoning={aiReasoning} isMelee />}
        </>
      )}

      {screen === 'end' && match && (
        <>
          <MatchSummary
            match={match}
            p1Loadout={p1Loadout}
            p2Loadout={p2Loadout}
            p1PlayerLoadout={p1PlayerLoadout}
            p2PlayerLoadout={p2PlayerLoadout}
            onRematch={handleRematch}
          />
          <DifficultyFeedback match={match} />
          <StrategyTips match={match} />
          <MatchReplay match={match} reasoningHistory={reasoningHistory} />
        </>
      )}

      {screen !== 'setup' && <CombatLog entries={combatLog} />}
    </div>
  );
}

export default App;
