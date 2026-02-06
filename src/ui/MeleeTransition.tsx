import type { MatchState, PassResult } from '../engine/types';
import { calcCarryoverPenalties } from '../engine/calculator';
import { Scoreboard } from './helpers';

export function MeleeTransition({ match, lastPassResult, onContinue }: {
  match: MatchState;
  lastPassResult: PassResult;
  onContinue: () => void;
}) {
  const unseater = lastPassResult.unseat === 'player1'
    ? match.player1.archetype.name
    : match.player2.archetype.name;
  const unseated = lastPassResult.unseat === 'player1'
    ? match.player2.archetype.name
    : match.player1.archetype.name;
  const isPlayerUnseated = lastPassResult.unseat === 'player1'; // player1 unseats = player2 was unseated... wait

  // "unseat === 'player1'" means player1 performed the unseat (player2 fell)
  const penalties = calcCarryoverPenalties(lastPassResult.unseatMargin);

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
        label="Melee"
      />

      <div className="melee-transition">
        <div className="melee-transition__icon">&#x2694;</div>
        <h2>DISMOUNTED!</h2>
        <p className="melee-transition__subtitle">
          {unseater} unseats {unseated} with a margin of {lastPassResult.unseatMargin.toFixed(1)}!
        </p>
        <p className="melee-transition__subtitle" style={{ marginTop: 8 }}>
          The knights draw swords for melee combat.
        </p>
      </div>

      <div className="melee-transition__penalties">
        <h3>Carryover Penalties for {unseated}</h3>
        <div className="melee-transition__penalty-grid">
          <div className="melee-transition__penalty">
            <span className="melee-transition__penalty-label">MOM</span>
            <span className="delta delta--neg">{penalties.momentumPenalty}</span>
          </div>
          <div className="melee-transition__penalty">
            <span className="melee-transition__penalty-label">CTL</span>
            <span className="delta delta--neg">{penalties.controlPenalty}</span>
          </div>
          <div className="melee-transition__penalty">
            <span className="melee-transition__penalty-label">GRD</span>
            <span className="delta delta--neg">{penalties.guardPenalty}</span>
          </div>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--ink-faint)', marginTop: 8, textAlign: 'center' }}>
          First to 3 round wins, or 1 critical hit (margin &ge; 25)
        </p>
      </div>

      <div className="text-center mt-16">
        <button className="btn btn--primary btn--large" onClick={onContinue}>
          Draw Swords!
        </button>
      </div>
    </div>
  );
}
