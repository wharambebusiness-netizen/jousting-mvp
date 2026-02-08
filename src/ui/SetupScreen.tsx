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

  return (
    <div className="screen">
      <h1>Joust & Melee</h1>
      <p className="subtitle">Choose your knight's archetype</p>

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

      <div className="archetype-grid">
        {ARCHETYPE_LIST.map(arch => (
          <div
            key={arch.id}
            className="card card--selectable archetype-card"
            onClick={() => {
              // Pick a random opponent that isn't the same
              const others = ARCHETYPE_LIST.filter(a => a.id !== arch.id);
              const opponent = others[Math.floor(Math.random() * others.length)];
              onStart(arch, opponent, difficulty);
            }}
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
        Your opponent will be a random AI-controlled archetype.
      </p>
    </div>
  );
}
