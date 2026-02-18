import { useState, useEffect, useRef, useCallback } from 'react';
import type { Attack, MatchState, SpeedType } from '../engine/types';
import { SPEEDS, JOUST_ATTACK_LIST } from '../engine/attacks';
import { computeEffectiveStats, canShift, resolveCounters } from '../engine/calculator';
import { StanceTag, Scoreboard, CounterBadge } from './helpers';
import { AttackCard } from './AttackSelect';

// Reveal phases: player shown → opponent flips → counters + actions appear
type RevealPhase = 'player' | 'opponent' | 'complete';

export function RevealScreen({ match, playerSpeed, playerAttack, aiSpeed, aiAttack, onResolve }: {
  match: MatchState;
  playerSpeed: SpeedType;
  playerAttack: Attack;
  aiSpeed: SpeedType;
  aiAttack: Attack;
  onResolve: (shiftAttack?: Attack) => void;
}) {
  const [phase, setPhase] = useState<RevealPhase>('player');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('opponent'), 800);
    const t2 = setTimeout(() => setPhase('complete'), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const speedData = SPEEDS[playerSpeed];
  const sta = match.player1.currentStamina;
  const staAfterSpeed = Math.max(0, sta + speedData.deltaStamina);
  const preStats = computeEffectiveStats(match.player1.archetype, speedData, playerAttack, staAfterSpeed);
  const playerCanShift = canShift(preStats.control, speedData, staAfterSpeed);

  const shiftOptions = JOUST_ATTACK_LIST.filter(a => a.id !== playerAttack.id);
  const sameStanceCost = 5;
  const crossStanceCost = 12;

  const shiftGridRef = useRef<HTMLDivElement>(null);
  const shiftCols = 2;

  const handleShiftGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    const grid = shiftGridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[role="button"]'));
    const idx = cards.indexOf(e.target as HTMLElement);
    if (idx < 0) return;

    let next = -1;
    switch (e.key) {
      case 'ArrowRight': next = idx + 1 < cards.length ? idx + 1 : idx; break;
      case 'ArrowLeft': next = idx - 1 >= 0 ? idx - 1 : idx; break;
      case 'ArrowDown': next = idx + shiftCols < cards.length ? idx + shiftCols : idx; break;
      case 'ArrowUp': next = idx - shiftCols >= 0 ? idx - shiftCols : idx; break;
      default: return;
    }
    e.preventDefault();
    cards[next]?.focus();
  }, []);

  const counters = resolveCounters(playerAttack, aiAttack);
  const opponentRevealed = phase === 'opponent' || phase === 'complete';
  const actionsReady = phase === 'complete';

  return (
    <div className="screen">
      <Scoreboard
        p1Name={match.player1.archetype.name}
        p2Name={match.player2.archetype.name}
        p1Score={match.cumulativeScore1}
        p2Score={match.cumulativeScore2}
        p1Sta={match.player1.currentStamina}
        p2Sta={match.player2.currentStamina}
        p1MaxSta={match.player1.archetype.stamina}
        p2MaxSta={match.player2.archetype.stamina}
        label={`Pass ${match.passNumber}`}
      />

      <h2 className="text-center mb-16">
        {actionsReady ? 'Lances Revealed!' : 'Revealing...'}
      </h2>

      <div className="reveal-sides">
        {/* Player side — always visible, slides in */}
        <div className="player-side player-side--p1 reveal-card reveal-card--enter">
          <div className="player-label player-label--p1">You</div>
          <div className="reveal-attack__speed">{playerSpeed}</div>
          <div className="reveal-attack__name">{playerAttack.name}</div>
          <StanceTag stance={playerAttack.stance} />
          {actionsReady && counters.player1Bonus !== 0 && (
            <div className="mt-8 reveal-counter-enter"><CounterBadge bonus={counters.player1Bonus} /></div>
          )}
        </div>

        {/* Opponent side — flip reveal */}
        <div className={`reveal-flip ${opponentRevealed ? 'reveal-flip--revealed' : ''}`}>
          {/* Card back (hidden) */}
          <div className="reveal-flip__back player-side player-side--p2">
            <div className="player-label player-label--p2">Opponent</div>
            <div className="reveal-attack__hidden">?</div>
          </div>
          {/* Card front (revealed) */}
          <div className="reveal-flip__front player-side player-side--p2">
            <div className="player-label player-label--p2">Opponent</div>
            <div className="reveal-attack__speed">{aiSpeed}</div>
            <div className="reveal-attack__name">{aiAttack.name}</div>
            <StanceTag stance={aiAttack.stance} />
            {actionsReady && counters.player2Bonus !== 0 && (
              <div className="mt-8 reveal-counter-enter"><CounterBadge bonus={counters.player2Bonus} /></div>
            )}
          </div>
        </div>
      </div>

      {actionsReady && (
        <div className="reveal-actions-enter">
          {playerCanShift ? (
            <div className="shift-section">
              <h3>Mid-Run Shift Available!</h3>
              <p className="shift-info">
                Your Control ({preStats.control.toFixed(0)}) meets the {playerSpeed} threshold ({speedData.shiftThreshold}).
                You may switch to a different attack. Same-stance costs {sameStanceCost} STA, cross-stance costs {crossStanceCost} STA.
              </p>
              <div className="attack-grid" ref={shiftGridRef} role="group" aria-label="Shift attack options" onKeyDown={handleShiftGridKeyDown}>
                {shiftOptions.map(atk => (
                  <AttackCard
                    key={atk.id}
                    attack={atk}
                    onClick={() => onResolve(atk)}
                  />
                ))}
              </div>
              <div className="text-center mt-16">
                <button className="btn btn--primary btn--large" onClick={() => onResolve()}>
                  Keep {playerAttack.name}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center mt-16">
              {staAfterSpeed < 10 ? (
                <p className="shift-info mb-8">No shift available (stamina too low)</p>
              ) : preStats.control < speedData.shiftThreshold ? (
                <p className="shift-info mb-8">
                  No shift available (Control {preStats.control.toFixed(0)} &lt; threshold {speedData.shiftThreshold})
                </p>
              ) : null}
              <button className="btn btn--primary btn--large" onClick={() => onResolve()}>
                Resolve Pass
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
