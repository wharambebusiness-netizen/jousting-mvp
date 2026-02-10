import type { MatchState, GiglingLoadout, PlayerLoadout, SteedGearSlot, PlayerGearSlot } from '../engine/types';

const STEED_SLOTS: SteedGearSlot[] = ['chamfron', 'barding', 'saddle', 'stirrups', 'reins', 'horseshoes'];
const PLAYER_SLOTS: PlayerGearSlot[] = ['helm', 'shield', 'lance', 'armor', 'gauntlets', 'melee_weapon'];

const SLOT_LABELS: Record<string, string> = {
  chamfron: 'Chamfron', barding: 'Barding', saddle: 'Saddle',
  stirrups: 'Stirrups', reins: 'Reins', horseshoes: 'Horseshoes',
  helm: 'Helm', shield: 'Shield', lance: 'Lance',
  armor: 'Armor', gauntlets: 'Gauntlets', melee_weapon: 'Melee Wpn',
};

export function MatchSummary({ match, p1Loadout, p2Loadout, p1PlayerLoadout, p2PlayerLoadout, onRematch }: {
  match: MatchState;
  p1Loadout?: GiglingLoadout | null;
  p2Loadout?: GiglingLoadout | null;
  p1PlayerLoadout?: PlayerLoadout | null;
  p2PlayerLoadout?: PlayerLoadout | null;
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
                <th scope="col">Pass</th>
                <th scope="col">P1 Attack</th>
                <th scope="col">P1 Impact</th>
                <th scope="col">P2 Attack</th>
                <th scope="col">P2 Impact</th>
                <th scope="col">Result</th>
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
                    <td className="text-p1">{pr.player1.impactScore.toFixed(1)}</td>
                    <td>
                      {pr.player2.finalAttack.name}
                      {pr.player2.shifted && ' *'}
                    </td>
                    <td className="text-p2">{pr.player2.impactScore.toFixed(1)}</td>
                    <td className={
                      pr.unseat !== 'none' ? 'summary-table__result--unseat'
                        : diff > 0 ? 'summary-table__result--p1'
                        : diff < 0 ? 'summary-table__result--p2'
                        : 'summary-table__result--tie'
                    }>
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
                <th scope="col">Rnd</th>
                <th scope="col">P1 Attack</th>
                <th scope="col">P1 Impact</th>
                <th scope="col">P2 Attack</th>
                <th scope="col">P2 Impact</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {match.meleeRoundResults.map(mr => (
                <tr key={mr.roundNumber}>
                  <td>{mr.roundNumber}</td>
                  <td>{mr.player1Attack.name}</td>
                  <td className="text-p1">{mr.player1ImpactScore.toFixed(1)}</td>
                  <td>{mr.player2Attack.name}</td>
                  <td className="text-p2">{mr.player2ImpactScore.toFixed(1)}</td>
                  <td className={
                    mr.outcome === 'Critical' ? 'summary-table__result--crit'
                      : mr.winner === 'player1' ? 'summary-table__result--p1'
                      : mr.winner === 'player2' ? 'summary-table__result--p2'
                      : 'summary-table__result--tie'
                  }>
                    {mr.outcome === 'Critical' ? 'CRIT!' : mr.outcome === 'Hit'
                      ? (mr.winner === 'player1' ? 'P1' : 'P2')
                      : 'Draw'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="melee-legend mb-16">
            Melee wins — P1: {match.meleeWins1}, P2: {match.meleeWins2} (first to 4, criticals count as 2)
          </p>
        </>
      )}

      {/* Loadout summary */}
      {(p1Loadout || p2Loadout) && (
        <>
          <h3>Loadouts</h3>
          <div className="reveal-sides mb-16">
            <LoadoutMini label="You" steedLoadout={p1Loadout} playerLoadout={p1PlayerLoadout} />
            <LoadoutMini label="Opponent" steedLoadout={p2Loadout} playerLoadout={p2PlayerLoadout} />
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
            aria-label={`Pass ${pr.passNumber}: ${isUnseat ? 'Unseat!' : diff > 0 ? 'Player 1 wins' : diff < 0 ? 'Player 2 wins' : 'Tie'}`}
            style={{ '--anim-delay': `${i * 0.1}s` } as React.CSSProperties}
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
            aria-label={`Melee Round ${mr.roundNumber}: ${isCrit ? 'Critical hit!' : mr.winner === 'player1' ? 'Player 1 wins' : mr.winner === 'player2' ? 'Player 2 wins' : 'Draw'}`}
            style={{ '--anim-delay': `${(match.passResults.length + i) * 0.1}s` } as React.CSSProperties}
          >
            {isCrit ? '!!' : `M${mr.roundNumber}`}
          </span>
        );
      })}
    </div>
  );
}

function LoadoutMini({ label, steedLoadout, playerLoadout }: {
  label: string;
  steedLoadout?: GiglingLoadout | null;
  playerLoadout?: PlayerLoadout | null;
}) {
  if (!steedLoadout && !playerLoadout) {
    return <div className="loadout-mini__no-gear">No gear</div>;
  }
  return (
    <div className="loadout-mini">
      <div className="player-label mb-4">{label}</div>
      {steedLoadout && (
        <>
          <div className={`rarity-badge rarity-badge--${steedLoadout.giglingRarity} mb-6`}>
            {steedLoadout.giglingRarity}
          </div>
          <div className="loadout-mini__section-label">Steed</div>
          {STEED_SLOTS.map(slot => {
            const gear = steedLoadout[slot];
            if (!gear) return null;
            return (
              <div key={slot} className="loadout-mini__gear-line">
                {SLOT_LABELS[slot]}: {gear.primaryStat ? `+${gear.primaryStat.value} ${gear.primaryStat.stat.slice(0, 3).toUpperCase()}` : ''}
                {gear.secondaryStat ? ` +${gear.secondaryStat.value} ${gear.secondaryStat.stat.slice(0, 3).toUpperCase()}` : ''}
              </div>
            );
          })}
        </>
      )}
      {playerLoadout && (
        <>
          <div className="loadout-mini__section-label mt-6">Knight</div>
          {PLAYER_SLOTS.map(slot => {
            const gear = playerLoadout[slot];
            if (!gear) return null;
            return (
              <div key={slot} className="loadout-mini__gear-line">
                {SLOT_LABELS[slot]}: {gear.primaryStat ? `+${gear.primaryStat.value} ${gear.primaryStat.stat.slice(0, 3).toUpperCase()}` : ''}
                {gear.secondaryStat ? ` +${gear.secondaryStat.value} ${gear.secondaryStat.stat.slice(0, 3).toUpperCase()}` : ''}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
