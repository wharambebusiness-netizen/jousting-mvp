import { useEffect, useRef } from 'react';
import type { MatchState, PassResult } from '../engine/types';
import { calcCarryoverPenalties } from '../engine/calculator';

interface MeleeTransitionScreenProps {
  match?: MatchState;
  lastPassResult?: PassResult;
  onContinue: () => void;
}

export function MeleeTransitionScreen({ match, lastPassResult, onContinue }: MeleeTransitionScreenProps) {
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  // Focus Continue button when modal opens
  useEffect(() => {
    continueButtonRef.current?.focus();
  }, []);

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onContinue();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onContinue]);

  // Handle overlay click (click outside modal)
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onContinue();
    }
  };

  // Check if there was an unseat (optional details)
  const hasUnseat = lastPassResult?.unseat !== undefined;
  const unseater = hasUnseat && match && lastPassResult
    ? (lastPassResult.unseat === 'player1' ? match.player1.archetype.name : match.player2.archetype.name)
    : null;
  const unseated = hasUnseat && match && lastPassResult
    ? (lastPassResult.unseat === 'player1' ? match.player2.archetype.name : match.player1.archetype.name)
    : null;
  const penalties = hasUnseat && lastPassResult
    ? calcCarryoverPenalties(lastPassResult.unseatMargin)
    : null;

  return (
    <div
      className="melee-transition-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="melee-transition-title"
    >
      <div className="melee-transition-modal">
        {/* Title */}
        <h2 id="melee-transition-title" className="transition-title">
          Transition to Melee Phase
        </h2>

        {/* Weapon Diagram */}
        <figure className="weapon-diagram" aria-label="Weapon transition: Lance and shield in joust phase transforms to sword and shield in melee phase">
          <div className="weapon-set joust-weapons">
            <span className="weapon-icon" aria-hidden="true">🛡️</span>
            <span className="weapon-icon" aria-hidden="true">🗡️</span>
            <span className="weapon-label">Joust Phase</span>
          </div>

          <div className="arrow-icon" aria-hidden="true">
            →
          </div>

          <div className="weapon-set melee-weapons">
            <span className="weapon-icon" aria-hidden="true">🛡️</span>
            <span className="weapon-icon" aria-hidden="true">⚔️</span>
            <span className="weapon-label">Melee Phase</span>
          </div>
        </figure>

        {/* Explanatory Text */}
        <div className="transition-text">
          <p>A new attack set is available in melee combat.</p>
          <p>Learn the new matchups — Guard High works differently, and new attacks give you fresh tactical options.</p>
          <p>Take your time to study the counter chart before engaging.</p>
        </div>

        {/* Optional: Unseat Details (if there was an unseat) */}
        {hasUnseat && unseater && unseated && penalties && lastPassResult && (
          <div className="unseat-details">
            <div className="unseat-summary">
              <strong>{unseater}</strong> unseats <strong>{unseated}</strong> with a margin of{' '}
              <strong>{lastPassResult.unseatMargin.toFixed(1)}</strong>!
            </div>
            <div className="unseat-explanation">
              Impact margin exceeded the unseat threshold — the decisive blow knocked {unseated} from the saddle.
            </div>
            <div className="unseat-penalties">
              <div className="penalty-label">Carryover Penalties for {unseated}:</div>
              <div className="penalty-grid">
                <span className="penalty-item">MOM <span className="penalty-value">-{penalties.momentumPenalty}</span></span>
                <span className="penalty-item">CTL <span className="penalty-value">-{penalties.controlPenalty}</span></span>
                <span className="penalty-item">GRD <span className="penalty-value">-{penalties.guardPenalty}</span></span>
              </div>
            </div>
          </div>
        )}

        {/* Continue Button */}
        <button
          ref={continueButtonRef}
          className="continue-button"
          onClick={onContinue}
          aria-label="Continue to Melee Phase"
        >
          Continue to Melee Phase
        </button>
      </div>
    </div>
  );
}
