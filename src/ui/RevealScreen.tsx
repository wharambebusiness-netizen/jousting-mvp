import type { Attack, MatchState, SpeedType } from '../engine/types';
import { SPEEDS, JOUST_ATTACK_LIST } from '../engine/attacks';
import { computeEffectiveStats, canShift, resolveCounters } from '../engine/calculator';
import { StanceTag, Scoreboard } from './helpers';
import { AttackCard } from './AttackSelect';

export function RevealScreen({ match, playerSpeed, playerAttack, aiSpeed, aiAttack, onResolve }: {
  match: MatchState;
  playerSpeed: SpeedType;
  playerAttack: Attack;
  aiSpeed: SpeedType;
  aiAttack: Attack;
  onResolve: (shiftAttack?: Attack) => void;
}) {
  const speedData = SPEEDS[playerSpeed];
  const sta = match.player1.currentStamina;
  const staAfterSpeed = Math.max(0, sta + speedData.deltaStamina);
  const preStats = computeEffectiveStats(match.player1.archetype, speedData, playerAttack, staAfterSpeed);
  const playerCanShift = canShift(preStats.control, speedData, staAfterSpeed);

  const shiftOptions = JOUST_ATTACK_LIST.filter(a => a.id !== playerAttack.id);
  const sameStanceCost = 5;
  const crossStanceCost = 12;

  const counters = resolveCounters(playerAttack, aiAttack);

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
        p1Cap={match.p1Caparison}
        p2Cap={match.p2Caparison}
      />

      <h2 className="text-center mb-16">Lances Revealed!</h2>

      <div className="reveal-sides">
        <div className="player-side player-side--p1">
          <div className="player-label player-label--p1">You</div>
          <div className="reveal-attack__speed">{playerSpeed}</div>
          <div className="reveal-attack__name">{playerAttack.name}</div>
          <StanceTag stance={playerAttack.stance} />
          {counters.player1Bonus > 0 && (
            <div className="mt-8"><span className="counter-badge counter-badge--win">Counters!</span></div>
          )}
          {counters.player1Bonus < 0 && (
            <div className="mt-8"><span className="counter-badge counter-badge--lose">Countered!</span></div>
          )}
        </div>
        <div className="player-side player-side--p2">
          <div className="player-label player-label--p2">Opponent</div>
          <div className="reveal-attack__speed">{aiSpeed}</div>
          <div className="reveal-attack__name">{aiAttack.name}</div>
          <StanceTag stance={aiAttack.stance} />
          {counters.player2Bonus > 0 && (
            <div className="mt-8"><span className="counter-badge counter-badge--win">Counters!</span></div>
          )}
          {counters.player2Bonus < 0 && (
            <div className="mt-8"><span className="counter-badge counter-badge--lose">Countered!</span></div>
          )}
        </div>
      </div>

      {playerCanShift ? (
        <div className="shift-section">
          <h3>Mid-Run Shift Available!</h3>
          <p className="shift-info">
            Your Control ({preStats.control.toFixed(0)}) meets the {playerSpeed} threshold ({speedData.shiftThreshold}).
            You may switch to a different attack. Same-stance costs {sameStanceCost} STA, cross-stance costs {crossStanceCost} STA.
          </p>
          <div className="attack-grid">
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
  );
}
