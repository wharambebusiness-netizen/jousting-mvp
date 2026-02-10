import { MeleeOutcome, type MeleeRoundResult, type MatchState } from '../engine/types';
import { Scoreboard, StanceTag } from './helpers';

export function MeleeResultScreen({ match, result, onContinue }: {
  match: MatchState;
  result: MeleeRoundResult;
  onContinue: () => void;
}) {
  const outcomeClass = result.outcome === MeleeOutcome.Critical ? 'outcome-badge--critical'
    : result.outcome === MeleeOutcome.Hit ? 'outcome-badge--hit'
    : 'outcome-badge--draw';

  const winnerText = result.winner === 'player1' ? 'You win this round!'
    : result.winner === 'player2' ? 'Opponent wins this round!'
    : 'Draw — no winner';

  return (
    <div className="screen">
      <Scoreboard
        p1Name={match.player1.archetype.name}
        p2Name={match.player2.archetype.name}
        p1Score={match.cumulativeScore1}
        p2Score={match.cumulativeScore2}
        p1Sta={result.player1StaminaAfter}
        p2Sta={result.player2StaminaAfter}
        p1MaxSta={match.player1.archetype.stamina}
        p2MaxSta={match.player2.archetype.stamina}
        label={`Melee R${result.roundNumber}`}
      />

      <div className="melee-wins">
        <div>
          <span className="player-label player-label--p1">P1 Wins</span>
          <div className="melee-wins__dots">
            {[0, 1, 2].map(i => (
              <div key={i} className={`melee-wins__dot${i < match.meleeWins1 ? ' melee-wins__dot--filled-p1' : ''}`} />
            ))}
          </div>
        </div>
        <div>
          <span className="player-label player-label--p2">P2 Wins</span>
          <div className="melee-wins__dots">
            {[0, 1, 2].map(i => (
              <div key={i} className={`melee-wins__dot${i < match.meleeWins2 ? ' melee-wins__dot--filled-p2' : ''}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="text-center mb-16">
        <span className={`outcome-badge ${outcomeClass}`}>{result.outcome}</span>
        <p className="melee-result__winner-text">{winnerText}</p>
        {result.outcome !== MeleeOutcome.Draw && (
          <p className="melee-result__margin">
            Margin: {result.margin.toFixed(1)}
          </p>
        )}
      </div>

      <div className="pass-result__breakdown">
        <div className="reveal-sides mb-12">
          <div className="text-center">
            <div className="player-label player-label--p1">You</div>
            <div className="melee-result__attack-name">{result.player1Attack.name}</div>
            <StanceTag stance={result.player1Attack.stance} />
          </div>
          <div className="text-center">
            <div className="player-label player-label--p2">Opponent</div>
            <div className="melee-result__attack-name">{result.player2Attack.name}</div>
            <StanceTag stance={result.player2Attack.stance} />
          </div>
        </div>

        <hr className="divider" />

        <Row label="Impact Score" v1={result.player1ImpactScore} v2={result.player2ImpactScore} bold />
        <Row label="Stamina After" v1={result.player1StaminaAfter} v2={result.player2StaminaAfter} fmt={0} />
      </div>

      <div className="text-center">
        <button className="btn btn--primary btn--large" onClick={onContinue}>
          {match.phase === 'MatchEnd' ? 'See Final Result' : `Continue to Round ${match.meleeRoundResults.length + 1}`}
        </button>
      </div>
    </div>
  );
}

function Row({ label, v1, v2, fmt = 1, bold }: {
  label: string;
  v1: number;
  v2: number;
  fmt?: number;
  bold?: boolean;
}) {
  return (
    <div className="impact-row">
      <span className="impact-row__label">{label}</span>
      <div className="impact-row__values">
        <span className={`impact-row__p1${bold ? ' impact-row__p1--large' : ''}`}>
          {v1.toFixed(fmt)}
        </span>
        <span className={`impact-row__p2${bold ? ' impact-row__p2--large' : ''}`}>
          {v2.toFixed(fmt)}
        </span>
      </div>
    </div>
  );
}
