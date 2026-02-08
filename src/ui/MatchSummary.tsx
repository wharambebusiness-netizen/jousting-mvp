import type { MatchState, GiglingLoadout } from '../engine/types';
import { CaparisonBadge } from './helpers';

export function MatchSummary({ match, p1Loadout, p2Loadout, onRematch }: {
  match: MatchState;
  p1Loadout?: GiglingLoadout | null;
  p2Loadout?: GiglingLoadout | null;
  onRematch: () => void;
}) {
  const winnerName = match.winner === 'player1' ? match.player1.archetype.name
    : match.winner === 'player2' ? match.player2.archetype.name
    : null;

  return (
    <div className="screen">
      <div className={`winner-banner ${
        match.winner === 'draw' ? 'winner-banner--draw'
          : match.winner === 'player1' ? 'winner-banner--victory'
          : 'winner-banner--defeat'
      }`}>
        {match.winner === 'draw' ? (
          <>
            <h2>Match Drawn!</h2>
            <p>{match.winReason}</p>
          </>
        ) : (
          <>
            <h2>{winnerName} Wins!</h2>
            <p>{match.winReason}</p>
          </>
        )}
      </div>

      <div className="scoreboard final-score--reveal mb-16">
        <div className="scoreboard__player">
          <div className="scoreboard__name">{match.player1.archetype.name}</div>
          <div className="scoreboard__score">{match.cumulativeScore1.toFixed(1)}</div>
        </div>
        <div className="scoreboard__center">
          <div>vs</div>
        </div>
        <div className="scoreboard__player">
          <div className="scoreboard__name">{match.player2.archetype.name}</div>
          <div className="scoreboard__score">{match.cumulativeScore2.toFixed(1)}</div>
        </div>
      </div>

      {/* Mini match timeline */}
      <MatchTimeline match={match} />

      {/* Joust passes table */}
      {match.passResults.length > 0 && (
        <>
          <h3>Joust Passes</h3>
          <table className="summary-table mb-16">
            <thead>
              <tr>
                <th>Pass</th>
                <th>P1 Attack</th>
                <th>P1 Impact</th>
                <th>P2 Attack</th>
                <th>P2 Impact</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {match.passResults.map(pr => {
                const diff = pr.player1.impactScore - pr.player2.impactScore;
                return (
                  <tr key={pr.passNumber}>
                    <td>{pr.passNumber}</td>
                    <td>
                      {pr.player1.finalAttack.name}
                      {pr.player1.shifted && ' *'}
                    </td>
                    <td style={{ color: 'var(--p1)' }}>{pr.player1.impactScore.toFixed(1)}</td>
                    <td>
                      {pr.player2.finalAttack.name}
                      {pr.player2.shifted && ' *'}
                    </td>
                    <td style={{ color: 'var(--p2)' }}>{pr.player2.impactScore.toFixed(1)}</td>
                    <td style={{
                      fontWeight: 600,
                      color: pr.unseat !== 'none' ? 'var(--red)'
                        : diff > 0 ? 'var(--p1)'
                        : diff < 0 ? 'var(--p2)'
                        : 'var(--ink-faint)',
                    }}>
                      {pr.unseat !== 'none'
                        ? `Unseat!`
                        : diff > 0 ? 'P1' : diff < 0 ? 'P2' : 'Tie'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {/* Melee rounds table */}
      {match.meleeRoundResults.length > 0 && (
        <>
          <h3>Melee Rounds</h3>
          <table className="summary-table mb-16">
            <thead>
              <tr>
                <th>Rnd</th>
                <th>P1 Attack</th>
                <th>P1 Impact</th>
                <th>P2 Attack</th>
                <th>P2 Impact</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {match.meleeRoundResults.map(mr => (
                <tr key={mr.roundNumber}>
                  <td>{mr.roundNumber}</td>
                  <td>{mr.player1Attack.name}</td>
                  <td style={{ color: 'var(--p1)' }}>{mr.player1ImpactScore.toFixed(1)}</td>
                  <td>{mr.player2Attack.name}</td>
                  <td style={{ color: 'var(--p2)' }}>{mr.player2ImpactScore.toFixed(1)}</td>
                  <td style={{
                    fontWeight: 600,
                    color: mr.outcome === 'Critical' ? 'var(--red)'
                      : mr.winner === 'player1' ? 'var(--p1)'
                      : mr.winner === 'player2' ? 'var(--p2)'
                      : 'var(--ink-faint)',
                  }}>
                    {mr.outcome === 'Critical' ? 'CRIT!' : mr.outcome === 'Hit'
                      ? (mr.winner === 'player1' ? 'P1' : 'P2')
                      : 'Draw'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-faint)', marginBottom: 16 }}>
            Melee wins — P1: {match.meleeWins1}, P2: {match.meleeWins2} (first to 4, criticals count as 2)
          </p>
        </>
      )}

      {/* Loadout summary */}
      {(p1Loadout || p2Loadout) && (
        <>
          <h3>Loadouts</h3>
          <div className="reveal-sides mb-16">
            <LoadoutMini label="You" loadout={p1Loadout} caparison={match.p1Caparison} />
            <LoadoutMini label="Opponent" loadout={p2Loadout} caparison={match.p2Caparison} />
          </div>
        </>
      )}

      {/* Caparison trigger summary */}
      {(match.p1Caparison || match.p2Caparison) && (
        <>
          <h3>Caparison Triggers</h3>
          <div className="cap-summary mb-16">
            {match.p1Caparison && (
              <div className="cap-summary__row">
                <CaparisonBadge effect={match.p1Caparison} />
                <span>P1: {match.p1Caparison.description}</span>
                {match.p1Caparison.id === 'banner_of_the_giga' && (
                  <span className="cap-summary__used">{match.p1BannerUsed ? 'Used' : 'Not used'}</span>
                )}
              </div>
            )}
            {match.p2Caparison && (
              <div className="cap-summary__row">
                <CaparisonBadge effect={match.p2Caparison} />
                <span>P2: {match.p2Caparison.description}</span>
                {match.p2Caparison.id === 'banner_of_the_giga' && (
                  <span className="cap-summary__used">{match.p2BannerUsed ? 'Used' : 'Not used'}</span>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="text-center">
        <button className="btn btn--primary btn--large" onClick={onRematch}>
          New Match
        </button>
      </div>
    </div>
  );
}

function MatchTimeline({ match }: { match: MatchState }) {
  const hasMelee = match.meleeRoundResults.length > 0;
  return (
    <div className="match-timeline">
      {match.passResults.map((pr, i) => {
        const diff = pr.player1.impactScore - pr.player2.impactScore;
        const isUnseat = pr.unseat !== 'none';
        const cls = isUnseat ? 'timeline-pip--unseat'
          : diff > 0 ? 'timeline-pip--p1'
          : diff < 0 ? 'timeline-pip--p2'
          : '';
        return (
          <span
            key={`p${i}`}
            className={`timeline-pip ${cls}`}
            title={`Pass ${pr.passNumber}: ${isUnseat ? 'Unseat!' : diff > 0 ? 'P1 wins' : diff < 0 ? 'P2 wins' : 'Tie'}`}
            style={{ animationDelay: `${i * 0.1}s` }}
          >
            {isUnseat ? '\u2694' : `P${pr.passNumber}`}
          </span>
        );
      })}
      {hasMelee && <span className="timeline-separator" />}
      {match.meleeRoundResults.map((mr, i) => {
        const isCrit = mr.outcome === 'Critical';
        const cls = isCrit ? 'timeline-pip--crit'
          : mr.winner === 'player1' ? 'timeline-pip--p1'
          : mr.winner === 'player2' ? 'timeline-pip--p2'
          : '';
        return (
          <span
            key={`m${i}`}
            className={`timeline-pip ${cls}`}
            title={`Melee R${mr.roundNumber}: ${isCrit ? 'Critical!' : mr.winner === 'player1' ? 'P1' : mr.winner === 'player2' ? 'P2' : 'Draw'}`}
            style={{ animationDelay: `${(match.passResults.length + i) * 0.1}s` }}
          >
            {isCrit ? '!!' : `M${mr.roundNumber}`}
          </span>
        );
      })}
    </div>
  );
}

function LoadoutMini({ label, loadout, caparison }: {
  label: string;
  loadout?: GiglingLoadout | null;
  caparison?: MatchState['p1Caparison'];
}) {
  if (!loadout) return <div style={{ textAlign: 'center', color: 'var(--ink-faint)' }}>No gear</div>;
  const statSlots = (['barding', 'chanfron', 'saddle'] as const).filter(s => loadout[s]);
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="player-label" style={{ marginBottom: 4 }}>{label}</div>
      <div className={`rarity-badge rarity-badge--${loadout.giglingRarity}`} style={{ marginBottom: 6 }}>
        {loadout.giglingRarity}
      </div>
      {statSlots.map(slot => {
        const gear = loadout[slot]!;
        return (
          <div key={slot} style={{ fontSize: '0.75rem', color: 'var(--ink-light)' }}>
            {slot}: {gear.primaryStat ? `+${gear.primaryStat.value} ${gear.primaryStat.stat.slice(0, 3).toUpperCase()}` : ''}
            {gear.secondaryStat ? ` +${gear.secondaryStat.value} ${gear.secondaryStat.stat.slice(0, 3).toUpperCase()}` : ''}
          </div>
        );
      })}
      {caparison && (
        <div style={{ marginTop: 4 }}>
          <CaparisonBadge effect={caparison} />
        </div>
      )}
    </div>
  );
}
