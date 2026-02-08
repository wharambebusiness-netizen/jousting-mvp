import { useState } from 'react';
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
import { MeleeTransition } from './ui/MeleeTransition';
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

function App() {
  const [match, setMatch] = useState<MatchState | null>(null);
  const [screen, setScreen] = useState<Screen>('setup');
  const [p1Archetype, setP1Archetype] = useState<Archetype | null>(null);
  const [p2Archetype, setP2Archetype] = useState<Archetype | null>(null);
  const [playerSpeed, setPlayerSpeed] = useState<SpeedType>(SpeedType.Standard);
  const [playerAttack, setPlayerAttack] = useState<Attack | null>(null);
  const [aiChoice, setAiChoice] = useState<PassChoice | null>(null);
  const [lastPassResult, setLastPassResult] = useState<PassResult | null>(null);
  const [lastMeleeResult, setLastMeleeResult] = useState<MeleeRoundResult | null>(null);
  const [combatLog, setCombatLog] = useState<string[][]>([]);
  const [p1Loadout, setP1Loadout] = useState<GiglingLoadout | null>(null);
  const [p2Loadout, setP2Loadout] = useState<GiglingLoadout | null>(null);
  const [p1PlayerLoadout, setP1PlayerLoadout] = useState<PlayerLoadout | null>(null);
  const [p2PlayerLoadout, setP2PlayerLoadout] = useState<PlayerLoadout | null>(null);
  const [difficulty, setDifficulty] = useState<AIDifficulty>('medium');
  const [aiReasoning, setAiReasoning] = useState<AIReasoning | null>(null);
  const [reasoningHistory, setReasoningHistory] = useState<AIReasoning[]>([]);

  // --- Setup ---
  const handleStart = (p1: Archetype, p2: Archetype, diff: AIDifficulty) => {
    setP1Archetype(p1);
    setP2Archetype(p2);
    setDifficulty(diff);
    setCombatLog([]);
    setScreen('loadout');
  };

  // --- Loadout confirm ---
  const handleLoadoutConfirm = (steedLoadout: GiglingLoadout, playerLoadout: PlayerLoadout) => {
    if (!p1Archetype || !p2Archetype) return;
    // AI gets random loadouts at the same rarity tier
    const aiRarity = steedLoadout.giglingRarity;
    const aiSteedLoadout = createFullLoadout(aiRarity, aiRarity);
    const aiPlayerLoadout = createFullPlayerLoadout(aiRarity);
    setP1Loadout(steedLoadout);
    setP2Loadout(aiSteedLoadout);
    setP1PlayerLoadout(playerLoadout);
    setP2PlayerLoadout(aiPlayerLoadout);
    const m = createMatch(p1Archetype, p2Archetype, steedLoadout, aiSteedLoadout, playerLoadout, aiPlayerLoadout);
    setMatch(m);
    setCombatLog([]);
    setScreen('speed');
  };

  // --- Speed select ---
  const handleSpeedSelect = (speed: SpeedType) => {
    setPlayerSpeed(speed);
    setScreen('attack');
  };

  // --- Joust attack select ---
  const handleAttackSelect = (attack: Attack) => {
    setPlayerAttack(attack);

    // AI picks its full choice now (blind speed+attack, shift sees player's attack)
    const lastP2Attack = match!.passResults.length > 0
      ? match!.passResults[match!.passResults.length - 1].player2.finalAttack
      : undefined;
    const { choice: ai, reasoning } = aiPickJoustChoiceWithReasoning(match!.player2, lastP2Attack, attack, difficulty);
    setAiChoice(ai);
    setAiReasoning(reasoning);
    setReasoningHistory(prev => [...prev, reasoning]);
    setScreen('reveal');
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

    setMatch(newMatch);
    setLastPassResult(passResult);
    setCombatLog(prev => [...prev, passResult.log]);
    setScreen('pass-result');
  };

  // --- Pass result continue ---
  const handlePassContinue = () => {
    if (!match) return;
    if (match.phase === Phase.MeleeSelect) {
      setScreen('melee-transition');
    } else if (match.phase === Phase.MatchEnd) {
      setScreen('end');
    } else {
      // Next joust pass
      setScreen('speed');
    }
  };

  // --- Melee attack select ---
  const handleMeleeAttack = (attack: Attack) => {
    const lastP2Attack = match!.meleeRoundResults.length > 0
      ? match!.meleeRoundResults[match!.meleeRoundResults.length - 1].player2Attack
      : undefined;
    const { attack: aiAttack, reasoning } = aiPickMeleeAttackWithReasoning(match!.player2, lastP2Attack, difficulty);
    setAiReasoning(reasoning);
    setReasoningHistory(prev => [...prev, reasoning]);

    const newMatch = submitMeleeRound(match!, attack, aiAttack);
    const roundResult = newMatch.meleeRoundResults[newMatch.meleeRoundResults.length - 1];

    setMatch(newMatch);
    setLastMeleeResult(roundResult);
    setCombatLog(prev => [...prev, roundResult.log]);
    setScreen('melee-result');
  };

  // --- Melee result continue ---
  const handleMeleeContinue = () => {
    if (!match) return;
    if (match.phase === Phase.MatchEnd) {
      setScreen('end');
    } else {
      setScreen('melee');
    }
  };

  // --- Rematch ---
  const handleRematch = () => {
    setMatch(null);
    setP1Archetype(null);
    setP2Archetype(null);
    setAiChoice(null);
    setPlayerAttack(null);
    setLastPassResult(null);
    setLastMeleeResult(null);
    setP1Loadout(null);
    setP2Loadout(null);
    setP1PlayerLoadout(null);
    setP2PlayerLoadout(null);
    setAiReasoning(null);
    setReasoningHistory([]);
    setCombatLog([]);
    setScreen('setup');
  };

  return (
    <div>
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
        <MeleeTransition
          match={match}
          lastPassResult={lastPassResult}
          onContinue={() => setScreen('melee')}
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
