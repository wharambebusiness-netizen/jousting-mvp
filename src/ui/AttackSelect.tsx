import { useState, useRef, useCallback } from 'react';
import type { Attack, MatchState, SpeedType } from '../engine/types';
import { JOUST_ATTACK_LIST, MELEE_ATTACK_LIST } from '../engine/attacks';
import { StanceTag, DeltaVal, Scoreboard, Stars, attackName, MeleeWinsTracker } from './helpers';
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
            <div className="attack-card__beats">Beats: {attack.beats.map(attackName).join(', ')}</div>
          )}
          {attack.beatenBy.length > 0 && (
            <div className="attack-card__weak">Weak to: {attack.beatenBy.map(attackName).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}

function AttackSelectScreen({ match, phase, attacks, label, title, subtitle, onSelect }: {
  match: MatchState;
  phase: 'joust' | 'melee';
  attacks: Attack[];
  label: string;
  title: string;
  subtitle: string;
  onSelect: (attack: Attack) => void;
}) {
  const [showCounterChart, setShowCounterChart] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = 2;

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[role="button"]'));
    const idx = cards.indexOf(e.target as HTMLElement);
    if (idx < 0) return;

    let next = -1;
    switch (e.key) {
      case 'ArrowRight': next = idx + 1 < cards.length ? idx + 1 : idx; break;
      case 'ArrowLeft': next = idx - 1 >= 0 ? idx - 1 : idx; break;
      case 'ArrowDown': next = idx + cols < cards.length ? idx + cols : idx; break;
      case 'ArrowUp': next = idx - cols >= 0 ? idx - cols : idx; break;
      default: return;
    }
    e.preventDefault();
    cards[next]?.focus();
  }, []);

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
        label={label}
      />

      {phase === 'melee' && (
        <MeleeWinsTracker
          wins1={match.meleeWins1}
          wins2={match.meleeWins2}
          p1Label="You"
          p2Label="Opponent"
        />
      )}

      <div className="attack-select-header">
        <h2 className="text-center">{title}</h2>
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
      <p className="subtitle">{subtitle}</p>

      <div className="attack-grid" ref={gridRef} role="group" aria-label="Attack options" onKeyDown={handleGridKeyDown}>
        {attacks.map(atk => (
          <AttackCard
            key={atk.id}
            attack={atk}
            onClick={() => onSelect(atk)}
          />
        ))}
      </div>

      {showCounterChart && (
        <CounterChart
          phase={phase}
          onClose={() => setShowCounterChart(false)}
        />
      )}
    </div>
  );
}

export function JoustAttackSelect({ match, speed, onSelect }: {
  match: MatchState;
  speed: SpeedType;
  onSelect: (attack: Attack) => void;
}) {
  return (
    <AttackSelectScreen
      match={match}
      phase="joust"
      attacks={JOUST_ATTACK_LIST}
      label={`Pass ${match.passNumber}`}
      title="Choose Your Attack"
      subtitle={`Speed: ${speed} — Pick your lance technique`}
      onSelect={onSelect}
    />
  );
}

export function MeleeAttackSelect({ match, onSelect }: {
  match: MatchState;
  onSelect: (attack: Attack) => void;
}) {
  return (
    <AttackSelectScreen
      match={match}
      phase="melee"
      attacks={MELEE_ATTACK_LIST}
      label={`Melee R${match.meleeRoundResults.length + 1}`}
      title="Choose Your Melee Attack"
      subtitle="Dismounted combat — no speed selection"
      onSelect={onSelect}
    />
  );
}

// Re-export the single card for shift UI
export { AttackCard };
