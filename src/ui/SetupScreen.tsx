import type { Archetype } from '../engine/types';
import { ARCHETYPE_LIST } from '../engine/archetypes';
import { StatBar } from './helpers';

export function SetupScreen({ onStart }: {
  onStart: (p1: Archetype, p2: Archetype) => void;
}) {
  return (
    <div className="screen">
      <h1>Joust & Melee</h1>
      <p className="subtitle">Choose your knight's archetype</p>

      <div className="archetype-grid">
        {ARCHETYPE_LIST.map(arch => (
          <div
            key={arch.id}
            className="card card--selectable archetype-card"
            onClick={() => {
              // Pick a random opponent that isn't the same
              const others = ARCHETYPE_LIST.filter(a => a.id !== arch.id);
              const opponent = others[Math.floor(Math.random() * others.length)];
              onStart(arch, opponent);
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
