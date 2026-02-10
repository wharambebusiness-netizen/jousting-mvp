import { useState } from 'react';
import type { Attack, MatchState, SpeedType } from '../engine/types';
import { JOUST_ATTACK_LIST, MELEE_ATTACK_LIST } from '../engine/attacks';
import { StanceTag, DeltaVal, Scoreboard, Stars, attackName } from './helpers';
import { CounterChart } from './CounterChart';

function AttackCard({ attack, onClick, selected }: {
  attack: Attack;
  onClick: () => void;
  selected?: boolean;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  // Build accessible label
  const counterText = attack.beats.length > 0
    ? `Beats ${attack.beats.map(attackName).join(', ')}.`
    : '';
  const weakText = attack.beatenBy.length > 0
    ? `Weak to ${attack.beatenBy.map(attackName).join(', ')}.`
    : '';
  const ariaLabel = `Select ${attack.name} attack, ${attack.stance} stance. Power ${attack.power}, control ${attack.control}, defense ${attack.defense}. ${counterText} ${weakText}`.trim();

  return (
    <div
      className={`card card--selectable attack-card${selected ? ' card--selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onKeyDown={handleKeyDown}
    >
      <div className="attack-card__header">
        <span className="attack-card__name">{attack.name}</span>
        <StanceTag stance={attack.stance} />
      </div>
      <div className="attack-card__ratings">
        <span>PWR <Stars filled={attack.power} /></span>
        <span>CTL <Stars filled={attack.control} /></span>
        <span>DEF <Stars filled={attack.defense} /></span>
      </div>
      <div className="attack-card__deltas">
        <DeltaVal label="MOM" value={attack.deltaMomentum} />
        <DeltaVal label="CTL" value={attack.deltaControl} />
        <DeltaVal label="GRD" value={attack.deltaGuard} />
        <DeltaVal label="STA" value={attack.deltaStamina} />
      </div>
      {(attack.beats.length > 0 || attack.beatenBy.length > 0) && (
        <div className="attack-card__counters">
          {attack.beats.length > 0 && (
            <div>Beats: {attack.beats.map(attackName).join(', ')}</div>
          )}
          {attack.beatenBy.length > 0 && (
            <div>Weak to: {attack.beatenBy.map(attackName).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function JoustAttackSelect({ match, speed, onSelect }: {
  match: MatchState;
  speed: SpeedType;
  onSelect: (attack: Attack) => void;
}) {
  const [showCounterChart, setShowCounterChart] = useState(false);

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

      <div className="attack-select-header">
        <h2 className="text-center">Choose Your Attack</h2>
        <button
          className="counter-chart-icon"
          onClick={() => setShowCounterChart(true)}
          aria-label="View counter chart — see what beats what"
          title="View counter chart"
          type="button"
        >
          ?
        </button>
      </div>
      <p className="subtitle">Speed: {speed} — Pick your lance technique</p>

      <div className="attack-grid">
        {JOUST_ATTACK_LIST.map(atk => (
          <AttackCard
            key={atk.id}
            attack={atk}
            onClick={() => onSelect(atk)}
          />
        ))}
      </div>

      {showCounterChart && (
        <CounterChart
          phase="joust"
          onClose={() => setShowCounterChart(false)}
        />
      )}
    </div>
  );
}

export function MeleeAttackSelect({ match, onSelect }: {
  match: MatchState;
  onSelect: (attack: Attack) => void;
}) {
  const [showCounterChart, setShowCounterChart] = useState(false);

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
        label={`Melee R${match.meleeRoundResults.length + 1}`}
      />

      <div className="melee-wins">
        <div>
          <span className="player-label player-label--p1">P1 Wins</span>
          <div className="melee-wins__dots" aria-label={`Player 1: ${match.meleeWins1} of 3 wins`}>
            {[0, 1, 2].map(i => (
              <div key={i} className={`melee-wins__dot${i < match.meleeWins1 ? ' melee-wins__dot--filled-p1' : ''}`} aria-hidden="true" />
            ))}
          </div>
        </div>
        <div>
          <span className="player-label player-label--p2">P2 Wins</span>
          <div className="melee-wins__dots" aria-label={`Player 2: ${match.meleeWins2} of 3 wins`}>
            {[0, 1, 2].map(i => (
              <div key={i} className={`melee-wins__dot${i < match.meleeWins2 ? ' melee-wins__dot--filled-p2' : ''}`} aria-hidden="true" />
            ))}
          </div>
        </div>
      </div>

      <div className="attack-select-header">
        <h2 className="text-center">Choose Your Melee Attack</h2>
        <button
          className="counter-chart-icon"
          onClick={() => setShowCounterChart(true)}
          aria-label="View counter chart — see what beats what"
          title="View counter chart"
          type="button"
        >
          ?
        </button>
      </div>
      <p className="subtitle">Dismounted combat — no speed selection</p>

      <div className="attack-grid">
        {MELEE_ATTACK_LIST.map(atk => (
          <AttackCard
            key={atk.id}
            attack={atk}
            onClick={() => onSelect(atk)}
          />
        ))}
      </div>

      {showCounterChart && (
        <CounterChart
          phase="melee"
          onClose={() => setShowCounterChart(false)}
        />
      )}
    </div>
  );
}

// Re-export the single card for shift UI
export { AttackCard };
