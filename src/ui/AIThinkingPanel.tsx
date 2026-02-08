import { useState } from 'react';
import type { AIReasoning } from '../ai/basic-ai';

export function AIThinkingPanel({ reasoning, isMelee }: {
  reasoning: AIReasoning;
  isMelee?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="ai-thinking">
      <button className="ai-thinking__toggle" onClick={() => setOpen(!open)}>
        <span>AI Thinking</span>
        <span>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="ai-thinking__content">
          {/* Commentary */}
          {reasoning.commentary && (
            <div className="ai-thinking__commentary">
              &ldquo;{reasoning.commentary}&rdquo;
            </div>
          )}

          {/* Speed weights (joust only) */}
          {!isMelee && (
            <div className="ai-thinking__section">
              <h4 className="ai-thinking__heading">Speed Selection</h4>
              <SpeedWeights reasoning={reasoning.speed} />
            </div>
          )}

          {/* Attack scores */}
          <div className="ai-thinking__section">
            <h4 className="ai-thinking__heading">Attack Evaluation</h4>
            <AttackScores reasoning={reasoning.attack} />
          </div>

          {/* Shift reasoning (joust only) */}
          {reasoning.shift && (
            <div className="ai-thinking__section">
              <h4 className="ai-thinking__heading">Shift Decision</h4>
              <ShiftInfo reasoning={reasoning.shift} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SpeedWeights({ reasoning }: { reasoning: AIReasoning['speed'] }) {
  const { weights, staminaRatio, archetypeBias, chosen, wasRandom } = reasoning;
  const total = weights.slow + weights.standard + weights.fast;
  const pct = (v: number) => total > 0 ? Math.round((v / total) * 100) : 0;

  return (
    <div className="ai-thinking__speed">
      <div className="ai-thinking__bar-row">
        <span className="ai-thinking__bar-label">Slow</span>
        <div className="ai-thinking__bar-track">
          <div
            className={`ai-thinking__bar-fill ai-thinking__bar-fill--slow${chosen === 'Slow' ? ' ai-thinking__bar-fill--chosen' : ''}`}
            style={{ width: `${pct(weights.slow)}%` }}
          />
        </div>
        <span className="ai-thinking__bar-val">{pct(weights.slow)}%</span>
      </div>
      <div className="ai-thinking__bar-row">
        <span className="ai-thinking__bar-label">Standard</span>
        <div className="ai-thinking__bar-track">
          <div
            className={`ai-thinking__bar-fill ai-thinking__bar-fill--std${chosen === 'Standard' ? ' ai-thinking__bar-fill--chosen' : ''}`}
            style={{ width: `${pct(weights.standard)}%` }}
          />
        </div>
        <span className="ai-thinking__bar-val">{pct(weights.standard)}%</span>
      </div>
      <div className="ai-thinking__bar-row">
        <span className="ai-thinking__bar-label">Fast</span>
        <div className="ai-thinking__bar-track">
          <div
            className={`ai-thinking__bar-fill ai-thinking__bar-fill--fast${chosen === 'Fast' ? ' ai-thinking__bar-fill--chosen' : ''}`}
            style={{ width: `${pct(weights.fast)}%` }}
          />
        </div>
        <span className="ai-thinking__bar-val">{pct(weights.fast)}%</span>
      </div>
      <div className="ai-thinking__meta">
        <span>Stamina: {Math.round(staminaRatio * 100)}%</span>
        <span>{archetypeBias}</span>
        {wasRandom && <span className="ai-thinking__random">Random pick!</span>}
      </div>
    </div>
  );
}

function AttackScores({ reasoning }: { reasoning: AIReasoning['attack'] }) {
  const { scores, chosen, speedSynergy, wasRandom } = reasoning;

  return (
    <div className="ai-thinking__attacks">
      {speedSynergy && (
        <div className="ai-thinking__synergy">{speedSynergy}</div>
      )}
      <div className="ai-thinking__atk-list">
        {scores.map((entry) => (
          <div
            key={entry.attackId}
            className={`ai-thinking__atk-row${entry.attackName === chosen ? ' ai-thinking__atk-row--chosen' : ''}`}
          >
            <span className="ai-thinking__atk-name">{entry.attackName}</span>
            <span className="ai-thinking__atk-score">{entry.score}</span>
            <span className="ai-thinking__atk-factors">
              {entry.factors.filter(f => f !== 'Base: 5').join(', ') || 'base only'}
            </span>
          </div>
        ))}
      </div>
      {wasRandom && <div className="ai-thinking__random">Random pick!</div>}
    </div>
  );
}

function ShiftInfo({ reasoning }: { reasoning: NonNullable<AIReasoning['shift']> }) {
  return (
    <div className="ai-thinking__shift">
      <div className="ai-thinking__detail">
        <strong>Can shift:</strong> {reasoning.canShift ? 'Yes' : 'No'}
      </div>
      <div className="ai-thinking__detail">
        <strong>Counter status:</strong> {reasoning.currentCounterStatus}
      </div>
      {reasoning.bestAlternative && (
        <div className="ai-thinking__detail">
          <strong>Best alternative:</strong> {reasoning.bestAlternative.attack} (score {reasoning.bestAlternative.score})
        </div>
      )}
      <div className="ai-thinking__detail">
        <strong>Decision:</strong> {reasoning.decision}
      </div>
    </div>
  );
}
