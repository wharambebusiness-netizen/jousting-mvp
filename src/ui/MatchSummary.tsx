import type { MatchState } from '../engine/types';
import { StanceTag } from './helpers';

export function MatchSummary({ match, onRematch }: {
  match: MatchState;
  onRematch: () => void;
}) {
  const winnerName = match.winner === 'player1' ? match.player1.archetype.name
    : match.winner === 'player2' ? match.player2.archetype.name
    : null;

  return (
    <div className="screen">
      <div className="winner-banner">
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

      <div className="scoreboard mb-16">
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
            Melee wins — P1: {match.meleeWins1}, P2: {match.meleeWins2} (first to 3 or 1 critical)
          </p>
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
