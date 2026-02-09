import { useState } from 'react';
import type { Archetype, AIDifficulty } from '../engine/types';
import { ARCHETYPE_LIST } from '../engine/archetypes';
import { StatBar } from './helpers';

const DIFFICULTIES: { value: AIDifficulty; label: string; desc: string }[] = [
  { value: 'easy',   label: 'Easy',   desc: '40% optimal' },
  { value: 'medium', label: 'Medium', desc: '70% optimal' },
  { value: 'hard',   label: 'Hard',   desc: '90% optimal' },
];

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
      <div className="difficulty-selector" style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        {DIFFICULTIES.map(d => (
          <button
            key={d.value}
            className={`btn ${difficulty === d.value ? 'btn--active' : ''}`}
            onClick={() => setDifficulty(d.value)}
            title={d.desc}
            style={{
              padding: '0.4rem 1rem',
              border: difficulty === d.value ? '2px solid var(--ink)' : '1px solid var(--ink-faint)',
              background: difficulty === d.value ? 'var(--ink)' : 'transparent',
              color: difficulty === d.value ? 'var(--parchment)' : 'var(--ink)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: difficulty === d.value ? 'bold' : 'normal',
            }}
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
              </div>
            ))}
          </div>
          <p className="text-center mt-16" style={{ fontSize: '0.8rem', color: 'var(--ink-faint)' }}>
            Pick your archetype, then choose your opponent.
          </p>
        </>
      )}

      {/* Step 2: Pick opponent archetype */}
      {selectedP1 && (
        <>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <p className="subtitle" style={{ marginBottom: '0.25rem' }}>
              You chose <strong>{selectedP1.name}</strong> — now pick your opponent
            </p>
            <button
              onClick={handleBack}
              style={{
                background: 'transparent',
                border: '1px solid var(--ink-faint)',
                color: 'var(--ink)',
                padding: '0.3rem 0.8rem',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              &larr; Change archetype
            </button>
          </div>

          <div className="archetype-grid">
            {/* Random option card */}
            <div
              className="card card--selectable archetype-card"
              onClick={handleRandomP2}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}
            >
              <div className="archetype-card__name">Random</div>
              <div className="archetype-card__identity">A mystery opponent</div>
              <div style={{ fontSize: '2rem', margin: '0.5rem 0' }}>?</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-faint)' }}>
                Randomly selected from the remaining archetypes
              </div>
            </div>

            {/* All 6 archetypes (mirror matches allowed) */}
            {ARCHETYPE_LIST.map(arch => (
              <div
                key={arch.id}
                className="card card--selectable archetype-card"
                onClick={() => handlePickP2(arch)}
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
              </div>
            ))}
          </div>

          <p className="text-center mt-16" style={{ fontSize: '0.8rem', color: 'var(--ink-faint)' }}>
            Pick an opponent or choose Random for a surprise.
          </p>
        </>
      )}
    </div>
  );
}
