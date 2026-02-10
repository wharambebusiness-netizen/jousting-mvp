import { useEffect, useRef } from 'react';
import type { Attack } from '../engine/types';
import { JOUST_ATTACK_LIST, MELEE_ATTACK_LIST } from '../engine/attacks';
import { Stance } from '../engine/types';
import { attackName } from './helpers';

/**
 * CounterChart Component
 *
 * Displays rock-paper-scissors counter relationships for all attacks in a modal dialog.
 * Helps new players understand "Beats / Weak to" mechanics before making attack choices.
 *
 * Design Spec: orchestrator/analysis/design-round-4.md (lines 711-1145)
 * Task: BL-068 (P3 polish, new player onboarding)
 */

interface CounterChartProps {
  /** 'joust' or 'melee' — determines which attack set to display */
  phase: 'joust' | 'melee';
  /** Callback to close the modal */
  onClose: () => void;
}

/**
 * Maps stance to emoji icon (visual cue for attack playstyle)
 */
function getStanceIcon(stance: Stance): string {
  switch (stance) {
    case Stance.Aggressive:
      return '🎯'; // Aggressive = red/orange
    case Stance.Balanced:
      return '⚔️'; // Balanced = blue/purple
    case Stance.Defensive:
      return '🛡️'; // Defensive = green/gold
    default:
      return '✦';
  }
}

/**
 * Maps stance to color class for consistent color coding
 */
function getStanceColorClass(stance: Stance): string {
  switch (stance) {
    case Stance.Aggressive:
      return 'stance-color--aggressive';
    case Stance.Balanced:
      return 'stance-color--balanced';
    case Stance.Defensive:
      return 'stance-color--defensive';
    default:
      return '';
  }
}

/**
 * AttackCounterCard Component
 *
 * Displays a single attack's counter relationships (beats, weak to).
 * Renders as a card in the counter chart modal.
 */
function AttackCounterCard({ attack }: { attack: Attack }) {
  // Build accessible label for screen readers
  const beatsText = attack.beats.length > 0
    ? attack.beats.map(attackName).join(', ')
    : 'none';
  const weakToText = attack.beatenBy.length > 0
    ? attack.beatenBy.map(attackName).join(', ')
    : 'none';

  const ariaLabel = `${attack.name}, ${attack.stance} stance. Beats: ${beatsText}. Weak to: ${weakToText}.`;

  return (
    <article
      className={`counter-card ${getStanceColorClass(attack.stance)}`}
      aria-label={ariaLabel}
    >
      <div className="counter-card__header">
        <span className="counter-card__icon" aria-hidden="true">
          {getStanceIcon(attack.stance)}
        </span>
        <div className="counter-card__title">
          <h3 className="counter-card__name">{attack.name}</h3>
          <span className="counter-card__stance">{attack.stance}</span>
        </div>
      </div>

      <div className="counter-card__relationships">
        {attack.beats.length > 0 && (
          <div className="counter-card__beats">
            <span className="counter-card__label counter-card__label--beats" aria-hidden="true">
              ✅ BEATS:
            </span>
            <span className="counter-card__list">
              {attack.beats.map(attackName).join(', ')}
            </span>
          </div>
        )}

        {attack.beatenBy.length > 0 && (
          <div className="counter-card__weak-to">
            <span className="counter-card__label counter-card__label--weak" aria-hidden="true">
              ⚠️ WEAK TO:
            </span>
            <span className="counter-card__list">
              {attack.beatenBy.map(attackName).join(', ')}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * CounterChart Component (Main)
 *
 * Modal overlay showing all attack counter relationships.
 * Keyboard accessible, screen reader friendly, responsive layouts.
 */
export function CounterChart({ phase, onClose }: CounterChartProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Get attack list based on phase
  const attacks = phase === 'joust' ? JOUST_ATTACK_LIST : MELEE_ATTACK_LIST;
  const phaseLabel = phase === 'joust' ? 'Joust Phase' : 'Melee Phase';

  // Focus trap: focus title on mount
  useEffect(() => {
    if (closeButtonRef.current) {
      closeButtonRef.current.focus();
    }
  }, []);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Handle overlay click (click outside modal closes)
  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="counter-chart-overlay"
      onClick={handleOverlayClick}
      aria-hidden="false"
    >
      <div
        ref={modalRef}
        className="counter-chart"
        role="dialog"
        aria-labelledby="counter-chart-title"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="counter-chart__header">
          <h2 id="counter-chart-title" className="counter-chart__title">
            Counter Relationships — {phaseLabel}
          </h2>
          <button
            ref={closeButtonRef}
            className="counter-chart__close"
            onClick={onClose}
            aria-label="Close counter chart"
            type="button"
          >
            ✕
          </button>
        </div>

        <p className="counter-chart__subtitle">
          What beats what? Use this chart to make strategic attack choices.
        </p>

        {/* Attack Cards Grid */}
        <div className="counter-chart__grid">
          {attacks.map(attack => (
            <AttackCounterCard key={attack.id} attack={attack} />
          ))}
        </div>

        {/* Helper Text */}
        <p className="counter-chart__hint">
          Tap outside or press <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
