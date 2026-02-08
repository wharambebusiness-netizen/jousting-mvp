import { SpeedType, type MatchState } from '../engine/types';
import { SPEEDS } from '../engine/attacks';
import { DeltaVal, Scoreboard } from './helpers';

const SPEED_ORDER: SpeedType[] = [SpeedType.Slow, SpeedType.Standard, SpeedType.Fast];

export function SpeedSelect({ match, onSelect }: {
  match: MatchState;
  onSelect: (speed: SpeedType) => void;
}) {
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

      <h2 className="text-center">Choose Your Speed</h2>
      <p className="subtitle">Higher speed means more momentum but less control. Pass {match.passNumber} of 5.</p>

      <div className="speed-grid">
        {SPEED_ORDER.map(type => {
          const s = SPEEDS[type];
          return (
            <div
              key={type}
              className="card card--selectable speed-card"
              onClick={() => onSelect(type)}
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
