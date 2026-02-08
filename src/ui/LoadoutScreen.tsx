import { useState, useMemo } from 'react';
import type { Archetype, GiglingRarity, GiglingLoadout, CaparisonEffectId } from '../engine/types';
import { createFullLoadout, createCaparison, CAPARISON_EFFECTS, GEAR_SLOT_STATS } from '../engine/gigling-gear';
import { applyGiglingLoadout } from '../engine/gigling-gear';
import { BALANCE } from '../engine/balance-config';
import { StatBar } from './helpers';

const RARITIES: { id: GiglingRarity; label: string }[] = [
  { id: 'uncommon', label: 'Uncommon' },
  { id: 'rare', label: 'Rare' },
  { id: 'epic', label: 'Epic' },
  { id: 'legendary', label: 'Legendary' },
  { id: 'relic', label: 'Relic' },
  { id: 'giga', label: 'Giga' },
];

const CAPARISON_OPTIONS: { id: CaparisonEffectId | 'none'; label: string; desc: string; rarity?: GiglingRarity }[] = [
  { id: 'none', label: 'None', desc: 'No special effect' },
  ...Object.values(CAPARISON_EFFECTS).map(e => ({
    id: e.id as CaparisonEffectId,
    label: e.name,
    desc: e.description,
    rarity: e.rarity,
  })),
];

interface Props {
  archetype: Archetype;
  opponentName: string;
  onConfirm: (loadout: GiglingLoadout) => void;
}

export function LoadoutScreen({ archetype, opponentName, onConfirm }: Props) {
  const [rarity, setRarity] = useState<GiglingRarity>('uncommon');
  const [capChoice, setCapChoice] = useState<CaparisonEffectId | 'none'>('none');
  // Seed for gear re-rolls: changes when rarity changes
  const [seed, setSeed] = useState(0);

  // Generate loadout from current selections
  const loadout = useMemo(() => {
    // Deterministic-ish seed for visual consistency (re-rolls on rarity change)
    let i = seed;
    const rng = () => {
      i = (i * 1664525 + 1013904223) & 0x7fffffff;
      return i / 0x7fffffff;
    };
    return createFullLoadout(
      rarity,
      rarity,
      capChoice === 'none' ? undefined : capChoice,
      rng,
    );
  }, [rarity, capChoice, seed]);

  // Boosted archetype for stat preview
  const boosted = useMemo(() => applyGiglingLoadout(archetype, loadout), [archetype, loadout]);

  const rarityBonus = BALANCE.giglingRarityBonus[rarity];

  const handleRarityChange = (r: GiglingRarity) => {
    setRarity(r);
    setSeed(prev => prev + 1); // Re-roll gear stats
  };

  const handleReroll = () => {
    setSeed(prev => prev + 1);
  };

  return (
    <div className="screen">
      <h1>Equip Your Mount</h1>
      <p className="subtitle">
        {archetype.name} vs {opponentName} — choose your gigling's gear
      </p>

      {/* Rarity Tier */}
      <h3 className="mb-8">Mount & Gear Tier</h3>
      <div className="rarity-grid">
        {RARITIES.map(r => (
          <div
            key={r.id}
            className={`card card--selectable rarity-card rarity-card--${r.id} ${rarity === r.id ? 'card--selected' : ''}`}
            onClick={() => handleRarityChange(r.id)}
          >
            <div className="rarity-card__name">{r.label}</div>
            <div className="rarity-card__bonus">
              +{BALANCE.giglingRarityBonus[r.id]} all stats
            </div>
          </div>
        ))}
      </div>

      {/* Equipment — stat gear + caparison unified */}
      <div className="loadout-section mt-16">
        <div className="loadout-section__header">
          <h3>Equipment</h3>
          <button className="btn btn--small" onClick={handleReroll}>Re-roll Stats</button>
        </div>
        <div className="gear-list">
          {(['barding', 'chanfron', 'saddle'] as const).map(slot => {
            const gear = loadout[slot];
            if (!gear) return null;
            const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1);
            return (
              <div key={slot} className="gear-item">
                <span className="gear-item__slot">{slotLabel}</span>
                <span className="gear-item__stats">
                  {gear.primaryStat && (
                    <span className="gear-stat gear-stat--primary">
                      {gear.primaryStat.stat.toUpperCase()} +{gear.primaryStat.value}
                    </span>
                  )}
                  {gear.secondaryStat && (
                    <span className="gear-stat gear-stat--secondary">
                      {gear.secondaryStat.stat.toUpperCase()} +{gear.secondaryStat.value}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="caparison-label mt-12 mb-8">Caparison</div>
        <div className="caparison-grid">
          {CAPARISON_OPTIONS.map(opt => (
            <div
              key={opt.id}
              className={`card card--selectable caparison-card ${opt.rarity ? `caparison-card--${opt.rarity}` : ''} ${capChoice === opt.id ? 'card--selected' : ''}`}
              onClick={() => setCapChoice(opt.id)}
            >
              <div className="caparison-card__name">{opt.label}</div>
              {opt.rarity && (
                <span className={`rarity-badge rarity-badge--${opt.rarity}`}>
                  {opt.rarity}
                </span>
              )}
              <div className="caparison-card__desc">{opt.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats Preview */}
      <div className="loadout-section mt-16">
        <h3 className="mb-8">Stats Preview</h3>
        <div className="stats-preview">
          <div className="stats-preview__column">
            <div className="stats-preview__label">Base</div>
            <StatBar label="MOM" value={archetype.momentum} max={130} type="mom" />
            <StatBar label="CTL" value={archetype.control} max={130} type="ctl" />
            <StatBar label="GRD" value={archetype.guard} max={130} type="grd" />
            <StatBar label="INIT" value={archetype.initiative} max={130} type="init" />
            <StatBar label="STA" value={archetype.stamina} max={130} type="sta" />
          </div>
          <div className="stats-preview__arrow">{'\u2192'}</div>
          <div className="stats-preview__column">
            <div className="stats-preview__label">With Gear</div>
            <StatBar label="MOM" value={boosted.momentum} max={130} type="mom" />
            <StatBar label="CTL" value={boosted.control} max={130} type="ctl" />
            <StatBar label="GRD" value={boosted.guard} max={130} type="grd" />
            <StatBar label="INIT" value={boosted.initiative} max={130} type="init" />
            <StatBar label="STA" value={boosted.stamina} max={130} type="sta" />
          </div>
        </div>
        {rarityBonus > 0 && (
          <p className="stats-preview__note">
            Mount bonus: +{rarityBonus} all stats | Gear adds on top
          </p>
        )}
      </div>

      <div className="text-center mt-24">
        <button className="btn btn--primary btn--large" onClick={() => onConfirm(loadout)}>
          Enter the Lists!
        </button>
      </div>

      <p className="text-center mt-8" style={{ fontSize: '0.8rem', color: 'var(--ink-faint)' }}>
        Your opponent will be equipped at a similar tier.
      </p>
    </div>
  );
}
