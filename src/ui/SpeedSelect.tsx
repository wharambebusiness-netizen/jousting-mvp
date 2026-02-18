import { useRef, useCallback } from 'react';
import { SpeedType, type MatchState } from '../engine/types';
import { SPEEDS } from '../engine/attacks';
import { DeltaVal, Scoreboard } from './helpers';

const SPEED_ORDER: SpeedType[] = [SpeedType.Slow, SpeedType.Standard, SpeedType.Fast];

export function SpeedSelect({ match, onSelect }: {
  match: MatchState;
  onSelect: (speed: SpeedType) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = 3;

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
        label={`Pass ${match.passNumber}`}
      />

      <h2 className="text-center">Choose Your Speed</h2>
      <p className="subtitle">Higher speed means more momentum but less control. Pass {match.passNumber} of 5.</p>

      <div className="speed-grid" ref={gridRef} role="group" aria-label="Speed options" onKeyDown={handleGridKeyDown}>
        {SPEED_ORDER.map(type => {
          const s = SPEEDS[type];
          const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(type);
            }
          };
          return (
            <div
              key={type}
              className="card card--selectable speed-card"
              onClick={() => onSelect(type)}
              role="button"
              tabIndex={0}
              aria-label={`Select ${type} speed: momentum ${s.deltaMomentum > 0 ? '+' : ''}${s.deltaMomentum}, control ${s.deltaControl > 0 ? '+' : ''}${s.deltaControl}, initiative ${s.deltaInitiative > 0 ? '+' : ''}${s.deltaInitiative}, stamina ${s.deltaStamina}`}
              onKeyDown={handleKeyDown}
            >
              <div className="speed-card__name">{type}</div>
              <div className="speed-card__deltas">
                <DeltaVal label="MOM" value={s.deltaMomentum} />
                <DeltaVal label="CTL" value={s.deltaControl} />
                <DeltaVal label="INIT" value={s.deltaInitiative} />
                <DeltaVal label="STA" value={s.deltaStamina} />
              </div>
              <div className="speed-card__threshold tip tip--wide" data-tip={`Your Control must be ${s.shiftThreshold}+ to shift attacks mid-run`}>
                Shift req: CTL {s.shiftThreshold}+
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
