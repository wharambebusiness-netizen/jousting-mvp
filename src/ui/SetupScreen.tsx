import { useState } from 'react';
import type { Archetype, AIDifficulty } from '../engine/types';
import { ARCHETYPE_LIST } from '../engine/archetypes';
import { StatBar } from './helpers';

const DIFFICULTIES: { value: AIDifficulty; label: string; desc: string }[] = [
  { value: 'easy',   label: 'Easy',   desc: '40% optimal' },
  { value: 'medium', label: 'Medium', desc: '70% optimal' },
  { value: 'hard',   label: 'Hard',   desc: '90% optimal' },
];

const ARCHETYPE_HINTS: Record<string, { strengths: string; tip: string }> = {
  charger:    { strengths: 'Highest Momentum. Devastating early passes.', tip: 'Win fast — your power fades with fatigue.' },
  technician: { strengths: 'Top Control. Best at shifting attacks.', tip: 'React to your opponent and shift for counters.' },
  bulwark:    { strengths: 'Best Guard. Hard to unseat or damage.', tip: 'Outlast opponents — your armor never fatigues.' },
  tactician:  { strengths: 'Highest Initiative. Acts first every pass.', tip: 'Use speed advantage to set the tempo.' },
  breaker:    { strengths: 'Guard penetration. Ignores 25% of armor.', tip: 'Target defensive opponents — their guard is weaker against you.' },
  duelist:    { strengths: 'Even stats. No weaknesses.', tip: 'Adapt your strategy to each opponent.' },
};

export function SetupScreen({ onStart }: {
  onStart: (p1: Archetype, p2: Archetype, difficulty: AIDifficulty) => void;
}) {
  const [difficulty, setDifficulty] = useState<AIDifficulty>('medium');
  const [selectedP1, setSelectedP1] = useState<Archetype | null>(null);

  const handlePickP1 = (arch: Archetype) => {
    setSelectedP1(arch);
  };

  const handlePickP2 = (arch: Archetype) => {
    if (!selectedP1) return;
    onStart(selectedP1, arch, difficulty);
  };

  const handleRandomP2 = () => {
    if (!selectedP1) return;
    const opponent = ARCHETYPE_LIST[Math.floor(Math.random() * ARCHETYPE_LIST.length)];
    onStart(selectedP1, opponent, difficulty);
  };

  const handleBack = () => {
    setSelectedP1(null);
  };

  return (
    <div className="screen">
      <h1>Joust & Melee</h1>

      {/* Difficulty selector */}
      <div className="difficulty-selector">
        {DIFFICULTIES.map(d => (
          <button
            key={d.value}
            className={`difficulty-btn ${difficulty === d.value ? 'difficulty-btn--active' : ''}`}
            onClick={() => setDifficulty(d.value)}
            title={d.desc}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Step 1: Pick your archetype */}
      {!selectedP1 && (
        <>
          <p className="subtitle">Choose your knight's archetype</p>
          <div className="archetype-grid">
            {ARCHETYPE_LIST.map(arch => (
              <div
                key={arch.id}
                className="card card--selectable archetype-card"
                onClick={() => handlePickP1(arch)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePickP1(arch); }}}
                role="button"
                tabIndex={0}
                aria-label={`Select ${arch.name} archetype`}
              >
                <div className="archetype-card__name">{arch.name}</div>
                <div className="archetype-card__identity">{arch.identity}</div>
                <div className="archetype-card__stats">
                  <StatBar label="MOM" value={arch.momentum} max={100} type="mom" />
                  <StatBar label="CTL" value={arch.control} max={100} type="ctl" />
                  <StatBar label="GRD" value={arch.guard} max={100} type="grd" />
                  <StatBar label="INIT" value={arch.initiative} max={100} type="init" />
                  <StatBar label="STA" value={arch.stamina} max={100} type="sta" />
                </div>
                {ARCHETYPE_HINTS[arch.id] && (
                  <div className="archetype-card__hints">
                    <div className="archetype-card__strength">{ARCHETYPE_HINTS[arch.id].strengths}</div>
                    <div className="archetype-card__tip">{ARCHETYPE_HINTS[arch.id].tip}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-center mt-16 hint-text">
            Pick your archetype, then choose your opponent.
          </p>
        </>
      )}

      {/* Step 2: Pick opponent archetype */}
      {selectedP1 && (
        <>
          <div className="setup-opponent-header">
            <p className="subtitle mb-4">
              You chose <strong>{selectedP1.name}</strong> — now pick your opponent
            </p>
            <button
              onClick={handleBack}
              className="btn--back"
            >
              &larr; Change archetype
            </button>
          </div>

          <div className="archetype-grid">
            {/* Random option card */}
            <div
              className="card card--selectable archetype-card archetype-card--random"
              onClick={handleRandomP2}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRandomP2(); }}}
              role="button"
              tabIndex={0}
              aria-label="Select random opponent archetype"
            >
              <div className="archetype-card__name">Random</div>
              <div className="archetype-card__identity">A mystery opponent</div>
              <div className="archetype-card--random-icon">?</div>
              <div className="hint-text-sm">
                Randomly selected from the remaining archetypes
              </div>
            </div>

            {/* All 6 archetypes (mirror matches allowed) */}
            {ARCHETYPE_LIST.map(arch => (
              <div
                key={arch.id}
                className="card card--selectable archetype-card"
                onClick={() => handlePickP2(arch)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePickP2(arch); }}}
                role="button"
                tabIndex={0}
                aria-label={`Select ${arch.name} as opponent`}
              >
                <div className="archetype-card__name">{arch.name}</div>
                <div className="archetype-card__identity">{arch.identity}</div>
                <div className="archetype-card__stats">
                  <StatBar label="MOM" value={arch.momentum} max={100} type="mom" />
                  <StatBar label="CTL" value={arch.control} max={100} type="ctl" />
                  <StatBar label="GRD" value={arch.guard} max={100} type="grd" />
                  <StatBar label="INIT" value={arch.initiative} max={100} type="init" />
                  <StatBar label="STA" value={arch.stamina} max={100} type="sta" />
                </div>
                {ARCHETYPE_HINTS[arch.id] && (
                  <div className="archetype-card__hints">
                    <div className="archetype-card__strength">{ARCHETYPE_HINTS[arch.id].strengths}</div>
                    <div className="archetype-card__tip">{ARCHETYPE_HINTS[arch.id].tip}</div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <p className="text-center mt-16 hint-text">
            Pick an opponent or choose Random for a surprise.
          </p>
        </>
      )}
    </div>
  );
}
