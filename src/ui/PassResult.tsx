import type { PassResult as PassResultType, MatchState } from '../engine/types';
import { resolveCounters } from '../engine/calculator';
import { Scoreboard, StanceTag } from './helpers';

export function PassResultScreen({ match, result, onContinue }: {
  match: MatchState;
  result: PassResultType;
  onContinue: () => void;
}) {
  const p1 = result.player1;
  const p2 = result.player2;
  const scoreDiff = p1.impactScore - p2.impactScore;
  const absDiff = Math.abs(scoreDiff);
  const counters = resolveCounters(p1.finalAttack, p2.finalAttack);
  const hasCounter = counters.player1Bonus !== 0 || counters.player2Bonus !== 0;

  // Determine winner label and CSS modifier
  const winnerLabel = scoreDiff > 0 ? 'You win this pass!' : scoreDiff < 0 ? 'Opponent wins this pass!' : 'This pass is a draw!';
  const winnerMod = scoreDiff > 0 ? 'p1' : scoreDiff < 0 ? 'p2' : 'draw';

  return (
    <div className="screen">
      <Scoreboard
        p1Name={match.player1.archetype.name}
        p2Name={match.player2.archetype.name}
        p1Score={match.cumulativeScore1}
        p2Score={match.cumulativeScore2}
        p1Sta={p1.staminaAfter}
        p2Sta={p2.staminaAfter}
        p1MaxSta={match.player1.archetype.stamina}
        p2MaxSta={match.player2.archetype.stamina}
        label={`Pass ${result.passNumber} Result`}
        passNumber={result.passNumber}
        totalPasses={5}
      />

      {result.unseat !== 'none' && (
        <div className="pass-result__unseat">
          {result.unseat === 'player1' ? match.player1.archetype.name : match.player2.archetype.name} UNSEATS their opponent!
          <div className="pass-result__unseat-margin">
            Margin: {result.unseatMargin.toFixed(1)} — Transitioning to Melee
          </div>
        </div>
      )}

      {/* Winner banner */}
      <div className={`pass-winner-banner pass-winner-banner--${winnerMod}`}>
        <div className="pass-winner-banner__label">{winnerLabel}</div>
        {scoreDiff !== 0 && (
          <div className="pass-winner-banner__advantage">
            +{absDiff.toFixed(1)} advantage
          </div>
        )}
      </div>

      <div className="pass-result__breakdown">
        {/* Attacks used */}
        <div className="reveal-sides mb-12">
          <div className={`reveal-sides__cell${counters.player1Bonus > 0 ? ' reveal-sides__cell--counter-win' : ''}`}>
            <div className="player-label player-label--p1">You</div>
            <div className="reveal-sides__attack-name">{p1.finalAttack.name}</div>
            <StanceTag stance={p1.finalAttack.stance} />
            <div className="reveal-sides__speed">
              {p1.speed}{p1.shifted ? ' (shifted!)' : ''}
            </div>
            {counters.player1Bonus > 0 && (
              <span className="counter-badge counter-badge--win counter-badge--prominent reveal-sides__counter">Counters!</span>
            )}
            {counters.player1Bonus < 0 && (
              <span className="counter-badge counter-badge--lose counter-badge--prominent reveal-sides__counter">Countered!</span>
            )}
          </div>
          <div className={`reveal-sides__cell${counters.player2Bonus > 0 ? ' reveal-sides__cell--counter-win' : ''}`}>
            <div className="player-label player-label--p2">Opponent</div>
            <div className="reveal-sides__attack-name">{p2.finalAttack.name}</div>
            <StanceTag stance={p2.finalAttack.stance} />
            <div className="reveal-sides__speed">
              {p2.speed}{p2.shifted ? ' (shifted!)' : ''}
            </div>
            {counters.player2Bonus > 0 && (
              <span className="counter-badge counter-badge--win counter-badge--prominent reveal-sides__counter">Counters!</span>
            )}
            {counters.player2Bonus < 0 && (
              <span className="counter-badge counter-badge--lose counter-badge--prominent reveal-sides__counter">Countered!</span>
            )}
          </div>
        </div>

        {hasCounter && (
          <div className="pass-counter-callout">
            Counter triggered! Stance advantage shifts the balance.
          </div>
        )}

        <hr className="divider" />

        {/* Stats breakdown */}
        <Row label="Momentum" v1={p1.effectiveStats.momentum} v2={p2.effectiveStats.momentum} />
        <Row label="Control" v1={p1.effectiveStats.control} v2={p2.effectiveStats.control} />
        <Row label="Guard" v1={p1.effectiveStats.guard} v2={p2.effectiveStats.guard} />
        <Row label="Initiative" v1={p1.effectiveStats.initiative} v2={p2.effectiveStats.initiative} />
        <Row label="Fatigue" v1={p1.fatigueFactor} v2={p2.fatigueFactor} fmt={2} />

        {hasCounter && (
          <div className="impact-row">
            <span className="impact-row__label">Counter Bonus</span>
            <div className="impact-row__values">
              <span className="impact-row__p1" style={{
                color: counters.player1Bonus > 0 ? 'var(--green)' : counters.player1Bonus < 0 ? 'var(--red)' : undefined,
              }}>
                {counters.player1Bonus > 0 ? `+${counters.player1Bonus.toFixed(1)}` : counters.player1Bonus < 0 ? counters.player1Bonus.toFixed(1) : '0'}
              </span>
              <span className="impact-row__p2" style={{
                color: counters.player2Bonus > 0 ? 'var(--green)' : counters.player2Bonus < 0 ? 'var(--red)' : undefined,
              }}>
                {counters.player2Bonus > 0 ? `+${counters.player2Bonus.toFixed(1)}` : counters.player2Bonus < 0 ? counters.player2Bonus.toFixed(1) : '0'}
              </span>
            </div>
          </div>
        )}

        <hr className="divider" />

        <Row label="Accuracy" v1={p1.accuracy} v2={p2.accuracy} />
        <ImpactScoreRow v1={p1.impactScore} v2={p2.impactScore} />

        <hr className="divider" />

        <div className="impact-row">
          <span className="impact-row__label">Pass Winner</span>
          <span style={{
            fontWeight: 700,
            color: scoreDiff > 0 ? 'var(--p1)' : scoreDiff < 0 ? 'var(--p2)' : 'var(--ink-faint)',
          }}>
            {scoreDiff > 0 ? 'You' : scoreDiff < 0 ? 'Opponent' : 'Tied'}
            {' '}({scoreDiff > 0 ? '+' : ''}{scoreDiff.toFixed(1)})
          </span>
        </div>
      </div>

      <div className="text-center">
        <button className="btn btn--primary btn--large" onClick={onContinue}>
          {result.unseat !== 'none' ? 'To Melee Combat!' :
           match.phase === 'MatchEnd' ? 'See Final Result' :
           `Continue to Pass ${match.passNumber} of 5`}
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
        <span className={`impact-row__p1${bold ? ' impact-row__p1--bold' : ''}`}>
          {v1.toFixed(fmt)}
        </span>
        <span className={`impact-row__p2${bold ? ' impact-row__p2--bold' : ''}`}>
          {v2.toFixed(fmt)}
        </span>
      </div>
    </div>
  );
}

/** Impact Score row with the winning side highlighted */
function ImpactScoreRow({ v1, v2 }: { v1: number; v2: number }) {
  const p1Wins = v1 > v2;
  const p2Wins = v2 > v1;
  return (
    <div className="impact-row impact-row--impact-score">
      <span className="impact-row__label" style={{ fontWeight: 700 }}>Impact Score</span>
      <div className="impact-row__values">
        <span className={`impact-row__p1 impact-row__p1--bold${p1Wins ? ' impact-score--winner' : ''}`}>
          {v1.toFixed(1)}
        </span>
        <span className={`impact-row__p2 impact-row__p2--bold${p2Wins ? ' impact-score--winner' : ''}`}>
          {v2.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
