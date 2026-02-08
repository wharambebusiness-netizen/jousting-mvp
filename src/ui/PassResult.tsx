import type { PassResult as PassResultType, MatchState } from '../engine/types';
import { resolveCounters } from '../engine/calculator';
import { Scoreboard, StanceTag, CaparisonBadge, joustCapTriggered } from './helpers';

export function PassResultScreen({ match, result, onContinue }: {
  match: MatchState;
  result: PassResultType;
  onContinue: () => void;
}) {
  const p1 = result.player1;
  const p2 = result.player2;
  const scoreDiff = p1.impactScore - p2.impactScore;
  const counters = resolveCounters(p1.finalAttack, p2.finalAttack);

  const p1Trig = joustCapTriggered(match.p1Caparison, result.passNumber, p1.speed, p1.finalAttack.stance, result.p1BannerConsumed);
  const p2Trig = joustCapTriggered(match.p2Caparison, result.passNumber, p2.speed, p2.finalAttack.stance, result.p2BannerConsumed);

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
        p1Cap={match.p1Caparison}
        p2Cap={match.p2Caparison}
        passNumber={result.passNumber}
        totalPasses={5}
      />

      {result.unseat !== 'none' && (
        <div className="pass-result__unseat">
          {result.unseat === 'player1' ? match.player1.archetype.name : match.player2.archetype.name} UNSEATS their opponent!
          <div style={{ fontSize: '0.8rem', fontWeight: 400, marginTop: 4 }}>
            Margin: {result.unseatMargin.toFixed(1)} — Transitioning to Melee
          </div>
        </div>
      )}

      {(p1Trig || p2Trig) && (
        <div className="cap-triggers">
          {p1Trig && match.p1Caparison && (
            <div className={`cap-trigger cap-trigger--p1 cap-trigger--${match.p1Caparison.rarity}`}>
              <CaparisonBadge effect={match.p1Caparison} triggered />
              <span className="cap-trigger__text">{match.p1Caparison.description}</span>
            </div>
          )}
          {p2Trig && match.p2Caparison && (
            <div className={`cap-trigger cap-trigger--p2 cap-trigger--${match.p2Caparison.rarity}`}>
              <CaparisonBadge effect={match.p2Caparison} triggered />
              <span className="cap-trigger__text">{match.p2Caparison.description}</span>
            </div>
          )}
        </div>
      )}

      <div className="pass-result__breakdown">
        {/* Attacks used */}
        <div className="reveal-sides" style={{ marginBottom: 12 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="player-label player-label--p1">You</div>
            <div style={{ fontWeight: 700 }}>{p1.finalAttack.name}</div>
            <StanceTag stance={p1.finalAttack.stance} />
            <div style={{ fontSize: '0.75rem', color: 'var(--ink-faint)', marginTop: 2 }}>
              {p1.speed}{p1.shifted ? ' (shifted!)' : ''}
            </div>
            {counters.player1Bonus > 0 && (
              <span className="counter-badge counter-badge--win" style={{ marginTop: 4 }}>Counters!</span>
            )}
            {counters.player1Bonus < 0 && (
              <span className="counter-badge counter-badge--lose" style={{ marginTop: 4 }}>Countered!</span>
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="player-label player-label--p2">Opponent</div>
            <div style={{ fontWeight: 700 }}>{p2.finalAttack.name}</div>
            <StanceTag stance={p2.finalAttack.stance} />
            <div style={{ fontSize: '0.75rem', color: 'var(--ink-faint)', marginTop: 2 }}>
              {p2.speed}{p2.shifted ? ' (shifted!)' : ''}
            </div>
            {counters.player2Bonus > 0 && (
              <span className="counter-badge counter-badge--win" style={{ marginTop: 4 }}>Counters!</span>
            )}
            {counters.player2Bonus < 0 && (
              <span className="counter-badge counter-badge--lose" style={{ marginTop: 4 }}>Countered!</span>
            )}
          </div>
        </div>

        <hr className="divider" />

        {/* Stats breakdown */}
        <Row label="Momentum" v1={p1.effectiveStats.momentum} v2={p2.effectiveStats.momentum} />
        <Row label="Control" v1={p1.effectiveStats.control} v2={p2.effectiveStats.control} />
        <Row label="Guard" v1={p1.effectiveStats.guard} v2={p2.effectiveStats.guard} />
        <Row label="Initiative" v1={p1.effectiveStats.initiative} v2={p2.effectiveStats.initiative} />
        <Row label="Fatigue" v1={p1.fatigueFactor} v2={p2.fatigueFactor} fmt={2} />

        {(counters.player1Bonus !== 0 || counters.player2Bonus !== 0) && (
          <div className="impact-row">
            <span className="impact-row__label">Counter Bonus</span>
            <div className="impact-row__values">
              <span className="impact-row__p1" style={{
                color: counters.player1Bonus > 0 ? 'var(--green)' : counters.player1Bonus < 0 ? 'var(--red)' : undefined,
              }}>
                {counters.player1Bonus > 0 ? '+10' : counters.player1Bonus < 0 ? '-10' : '0'}
              </span>
              <span className="impact-row__p2" style={{
                color: counters.player2Bonus > 0 ? 'var(--green)' : counters.player2Bonus < 0 ? 'var(--red)' : undefined,
              }}>
                {counters.player2Bonus > 0 ? '+10' : counters.player2Bonus < 0 ? '-10' : '0'}
              </span>
            </div>
          </div>
        )}

        <hr className="divider" />

        <Row label="Accuracy" v1={p1.accuracy} v2={p2.accuracy} />
        <Row label="Impact Score" v1={p1.impactScore} v2={p2.impactScore} bold />

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
        <span className="impact-row__p1" style={bold ? { fontSize: '1.05rem' } : undefined}>
          {v1.toFixed(fmt)}
        </span>
        <span className="impact-row__p2" style={bold ? { fontSize: '1.05rem' } : undefined}>
          {v2.toFixed(fmt)}
        </span>
      </div>
    </div>
  );
}
