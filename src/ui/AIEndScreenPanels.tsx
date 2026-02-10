import { useState } from 'react';
import type { MatchState } from '../engine/types';
import type { AIReasoning } from '../ai/basic-ai';

// --- S3: Difficulty Feedback ---

export function DifficultyFeedback({ match }: { match: MatchState }) {
  const scoreDiff = match.cumulativeScore1 - match.cumulativeScore2;
  const totalPasses = match.passResults.length;
  const totalMelee = match.meleeRoundResults.length;
  const totalRounds = totalPasses + totalMelee;

  // Determine how decisive the match was
  const playerWon = match.winner === 'player1';
  const playerLost = match.winner === 'player2';
  const isDraw = match.winner === 'draw';
  const wasUnseat = match.passResults.some(p => p.unseat !== 'none');
  const dominance = Math.abs(scoreDiff);

  let message: string;
  let suggestion: string;

  if (isDraw) {
    message = 'A closely matched bout!';
    suggestion = 'The current difficulty seems about right.';
  } else if (playerWon && (dominance > 40 || (wasUnseat && match.passResults.some(p => p.unseat === 'player1')))) {
    message = 'A commanding victory!';
    suggestion = 'Try Hard difficulty for a greater challenge.';
  } else if (playerWon && dominance > 20) {
    message = 'A solid win.';
    suggestion = 'You\'re getting the hang of it. Consider upping the difficulty!';
  } else if (playerWon) {
    message = 'A narrow victory!';
    suggestion = 'Well fought! This difficulty level suits you well.';
  } else if (playerLost && (dominance > 40 || (wasUnseat && match.passResults.some(p => p.unseat === 'player2')))) {
    message = 'A tough defeat.';
    suggestion = 'Try Easy difficulty to learn the ropes.';
  } else if (playerLost && dominance > 20) {
    message = 'The opponent had the edge.';
    suggestion = 'Study the AI\'s patterns and try again, or try an easier difficulty.';
  } else if (playerLost && totalRounds <= 3) {
    message = 'A quick match!';
    suggestion = 'Unseats happen fast. Try mixing up your speed and attack choices.';
  } else {
    message = 'A close fight!';
    suggestion = 'Almost had it! Keep experimenting with different strategies.';
  }

  return (
    <div className="ai-feedback">
      <h4 className="ai-feedback__title">AI Coach</h4>
      <div className="ai-feedback__message">{message}</div>
      <div className="ai-feedback__suggestion">{suggestion}</div>
    </div>
  );
}

// --- S2: Strategy Tips ---

export function StrategyTips({ match }: { match: MatchState }) {
  const tips: string[] = [];

  // Analyze player speed patterns
  const playerSpeeds = match.passResults.map(p => p.player1.speed);
  if (playerSpeeds.length >= 3) {
    const speedCounts = new Map<string, number>();
    for (const s of playerSpeeds) speedCounts.set(s, (speedCounts.get(s) ?? 0) + 1);
    for (const [speed, count] of speedCounts) {
      if (count >= Math.ceil(playerSpeeds.length * 0.7)) {
        tips.push(`You picked ${speed} speed ${count} out of ${playerSpeeds.length} passes. Try mixing it up to be less predictable!`);
      }
    }
  }

  // Analyze player attack stance patterns
  const playerStances = match.passResults.map(p => p.player1.finalAttack.stance);
  if (playerStances.length >= 3) {
    const stanceCounts = new Map<string, number>();
    for (const s of playerStances) stanceCounts.set(s, (stanceCounts.get(s) ?? 0) + 1);
    for (const [stance, count] of stanceCounts) {
      if (count >= Math.ceil(playerStances.length * 0.7)) {
        tips.push(`You lean heavily on ${stance} attacks (${count}/${playerStances.length}). The AI may exploit this pattern on Hard difficulty.`);
      }
    }
  }

  // Speed-attack synergy tips
  const fastAggCount = match.passResults.filter(
    p => p.player1.speed === 'Fast' && p.player1.finalAttack.stance === 'Aggressive'
  ).length;
  const slowDefCount = match.passResults.filter(
    p => p.player1.speed === 'Slow' && p.player1.finalAttack.stance === 'Defensive'
  ).length;
  if (fastAggCount === 0 && match.passResults.length >= 3) {
    tips.push('Try pairing Fast speed with Aggressive attacks for a Momentum boost!');
  }
  if (slowDefCount === 0 && match.passResults.length >= 3) {
    tips.push('Slow speed with Defensive attacks gives bonus Guard — useful when low on stamina.');
  }

  // Stamina management tips
  const finalStamina = match.player1.currentStamina;
  const maxStamina = match.player1.archetype.stamina;
  if (finalStamina < maxStamina * 0.2 && match.passResults.length >= 4) {
    tips.push('You ran very low on stamina. Try using Slow speed or cheaper attacks to conserve energy.');
  }

  // Shift tips
  const playerShifts = match.passResults.filter(p => p.player1.shifted).length;
  if (playerShifts === 0 && match.passResults.length >= 3) {
    tips.push('You never shifted! Shifting mid-pass can counter the opponent\'s revealed attack — try it when your Control is high enough.');
  }

  // Counter tips
  if (match.passResults.length >= 3) {
    const counterWins = match.passResults.filter(p => {
      const a1 = p.player1.finalAttack;
      const a2 = p.player2.finalAttack;
      return a1.beats.includes(a2.id);
    }).length;
    if (counterWins === 0) {
      tips.push('You didn\'t land any counters this match. Study the attack counter relationships to gain big score bonuses!');
    }
  }

  if (tips.length === 0) {
    tips.push('Well played! Your strategy was well-rounded this match.');
  }

  return (
    <div className="ai-tips">
      <h4 className="ai-tips__title">Strategy Tips</h4>
      <ul className="ai-tips__list">
        {tips.map((tip, i) => (
          <li key={i} className="ai-tips__item">{tip}</li>
        ))}
      </ul>
    </div>
  );
}

// --- S1: Match Replay / Decision History ---

export function MatchReplay({ match, reasoningHistory }: {
  match: MatchState;
  reasoningHistory: AIReasoning[];
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (reasoningHistory.length === 0) return null;

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <div className="match-replay">
      <h4 className="match-replay__title">AI Decision History</h4>
      <div className="match-replay__list">
        {reasoningHistory.map((reasoning, idx) => {
          const isJoust = idx < match.passResults.length;
          const label = isJoust
            ? `Pass ${idx + 1}`
            : `Melee R${idx - match.passResults.length + 1}`;
          const isOpen = openIndex === idx;

          return (
            <div key={idx} className="match-replay__item">
              <button
                className="match-replay__header"
                onClick={() => toggle(idx)}
                aria-expanded={isOpen}
                aria-controls={`match-replay-details-${idx}`}
              >
                <span className="match-replay__label">{label}</span>
                <span className="match-replay__summary">
                  {!isJoust ? '' : `${reasoning.speed.chosen} speed, `}
                  {reasoning.attack.chosen}
                  {reasoning.attack.wasRandom || reasoning.speed.wasRandom ? ' (random)' : ''}
                </span>
                <span>{isOpen ? '\u25B2' : '\u25BC'}</span>
              </button>
              {isOpen && (
                <div className="match-replay__details" id={`match-replay-details-${idx}`}>
                  {reasoning.commentary && (
                    <div className="ai-thinking__commentary">
                      &ldquo;{reasoning.commentary}&rdquo;
                    </div>
                  )}
                  {isJoust && (
                    <div className="match-replay__speed">
                      <strong>Speed weights:</strong>{' '}
                      Slow {Math.round((reasoning.speed.weights.slow / (reasoning.speed.weights.slow + reasoning.speed.weights.standard + reasoning.speed.weights.fast || 1)) * 100)}%,{' '}
                      Std {Math.round((reasoning.speed.weights.standard / (reasoning.speed.weights.slow + reasoning.speed.weights.standard + reasoning.speed.weights.fast || 1)) * 100)}%,{' '}
                      Fast {Math.round((reasoning.speed.weights.fast / (reasoning.speed.weights.slow + reasoning.speed.weights.standard + reasoning.speed.weights.fast || 1)) * 100)}%
                      {reasoning.speed.wasRandom && <span className="ai-thinking__random"> (Random!)</span>}
                    </div>
                  )}
                  <div className="match-replay__attacks">
                    <strong>Top attacks:</strong>{' '}
                    {reasoning.attack.scores.slice(0, 3).map((s, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        <span className={s.attackName === reasoning.attack.chosen ? 'match-replay__chosen' : ''}>
                          {s.attackName} ({s.score})
                        </span>
                      </span>
                    ))}
                  </div>
                  {reasoning.shift && (
                    <div className="match-replay__shift">
                      <strong>Shift:</strong> {reasoning.shift.decision}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
