import { useState } from 'react';
import './App.css';
import {
  Phase,
  SpeedType,
  type MatchState,
  type Attack,
  type PassChoice,
  type Archetype,
  type PassResult,
  type MeleeRoundResult,
} from './engine/types';
import { createMatch, submitJoustPass, submitMeleeRound } from './engine/match';
import { aiPickJoustChoice, aiPickMeleeAttack } from './ai/basic-ai';
import { SetupScreen } from './ui/SetupScreen';
import { SpeedSelect } from './ui/SpeedSelect';
import { JoustAttackSelect, MeleeAttackSelect } from './ui/AttackSelect';
import { RevealScreen } from './ui/RevealScreen';
import { PassResultScreen } from './ui/PassResult';
import { MeleeResultScreen } from './ui/MeleeResult';
import { MatchSummary } from './ui/MatchSummary';
import { CombatLog } from './ui/CombatLog';
import { MeleeTransition } from './ui/MeleeTransition';

type Screen =
  | 'setup'
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
  const [playerSpeed, setPlayerSpeed] = useState<SpeedType>(SpeedType.Standard);
  const [playerAttack, setPlayerAttack] = useState<Attack | null>(null);
  const [aiChoice, setAiChoice] = useState<PassChoice | null>(null);
  const [lastPassResult, setLastPassResult] = useState<PassResult | null>(null);
  const [lastMeleeResult, setLastMeleeResult] = useState<MeleeRoundResult | null>(null);
  const [combatLog, setCombatLog] = useState<string[][]>([]);

  // --- Setup ---
  const handleStart = (p1: Archetype, p2: Archetype) => {
    const m = createMatch(p1, p2);
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
    const ai = aiPickJoustChoice(match!.player2, lastP2Attack, attack);
    setAiChoice(ai);
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
    const aiAttack = aiPickMeleeAttack(match!.player2, lastP2Attack);

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
    setAiChoice(null);
    setPlayerAttack(null);
    setLastPassResult(null);
    setLastMeleeResult(null);
    setCombatLog([]);
    setScreen('setup');
  };

  return (
    <div>
      {screen !== 'setup' && screen !== 'end' && (
        <div className="app-header">
          <h1>Joust & Melee</h1>
        </div>
      )}

      {screen === 'setup' && (
        <SetupScreen onStart={handleStart} />
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
        <PassResultScreen
          match={match}
          result={lastPassResult}
          onContinue={handlePassContinue}
        />
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
        <MeleeResultScreen
          match={match}
          result={lastMeleeResult}
          onContinue={handleMeleeContinue}
        />
      )}

      {screen === 'end' && match && (
        <MatchSummary match={match} onRematch={handleRematch} />
      )}

      {screen !== 'setup' && <CombatLog entries={combatLog} />}
    </div>
  );
}

export default App;
