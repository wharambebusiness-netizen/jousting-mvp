import { useState, useMemo } from 'react';
import type { Archetype, GiglingRarity, GiglingLoadout, PlayerLoadout, SteedGearSlot, PlayerGearSlot } from '../engine/types';
import { createFullLoadout, applyGiglingLoadout } from '../engine/gigling-gear';
import { createFullPlayerLoadout, applyPlayerLoadout } from '../engine/player-gear';
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

const STEED_SLOTS: SteedGearSlot[] = ['chamfron', 'barding', 'saddle', 'stirrups', 'reins', 'horseshoes'];
const PLAYER_SLOTS: PlayerGearSlot[] = ['helm', 'shield', 'lance', 'armor', 'gauntlets', 'melee_weapon'];

const STEED_SLOT_LABELS: Record<SteedGearSlot, { name: string; desc: string }> = {
  chamfron:   { name: 'Chamfron',   desc: 'Head Armor' },
  barding:    { name: 'Barding',    desc: 'Body Armor' },
  saddle:     { name: 'Saddle',     desc: 'Seat' },
  stirrups:   { name: 'Stirrups',   desc: 'Balance' },
  reins:      { name: 'Reins',      desc: 'Steering' },
  horseshoes: { name: 'Horseshoes', desc: 'Traction' },
};

const PLAYER_SLOT_LABELS: Record<PlayerGearSlot, { name: string; desc: string }> = {
  helm:         { name: 'Helm',       desc: 'Head Protection' },
  shield:       { name: 'Shield',     desc: 'Impact Absorption' },
  lance:        { name: 'Lance',      desc: 'Primary Weapon' },
  armor:        { name: 'Armor',      desc: 'Body Protection' },
  gauntlets:    { name: 'Gauntlets',  desc: 'Grip & Stability' },
  melee_weapon: { name: 'Melee Wpn',  desc: 'Ground Weapon' },
};

const STAT_ABBR: Record<string, string> = {
  momentum: 'MOM', control: 'CTL', guard: 'GRD', initiative: 'INIT', stamina: 'STA',
};

const STAT_TIPS: Record<string, string> = {
  momentum: 'Momentum — raw hitting power. Drives Impact Score.',
  control: 'Control — precision. Drives Accuracy and shift eligibility.',
  guard: 'Guard — defense. Reduces opponent Impact Score.',
  initiative: 'Initiative — speed advantage. Adds to Accuracy, decides shift priority.',
  stamina: 'Stamina — endurance. Below 40, Momentum and Control are reduced.',
};

interface Props {
  archetype: Archetype;
  opponentName: string;
  onConfirm: (steedLoadout: GiglingLoadout, playerLoadout: PlayerLoadout) => void;
}

export function LoadoutScreen({ archetype, opponentName, onConfirm }: Props) {
  const [rarity, setRarity] = useState<GiglingRarity>('uncommon');
  const [seed, setSeed] = useState(0);

  // Create deterministic RNG from seed
  function makeRng(s: number) {
    let i = s;
    return () => {
      i = (i * 1664525 + 1013904223) & 0x7fffffff;
      return i / 0x7fffffff;
    };
  }

  // Generate both loadouts from current selections
  const steedLoadout = useMemo(() => {
    return createFullLoadout(rarity, rarity, makeRng(seed));
  }, [rarity, seed]);

  const playerLoadout = useMemo(() => {
    return createFullPlayerLoadout(rarity, makeRng(seed + 7919));
  }, [rarity, seed]);

  // Boosted archetype for stat preview (both gear systems applied)
  const boosted = useMemo(() => {
    const withSteed = applyGiglingLoadout(archetype, steedLoadout);
    return applyPlayerLoadout(withSteed, playerLoadout);
  }, [archetype, steedLoadout, playerLoadout]);

  const rarityBonus = BALANCE.giglingRarityBonus[rarity];

  // Calculate total stat bonuses from all gear
  const totalBonuses = useMemo(() => {
    const totals: Record<string, number> = { momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 };
    for (const slot of STEED_SLOTS) {
      const gear = steedLoadout[slot];
      if (gear?.primaryStat) totals[gear.primaryStat.stat] += gear.primaryStat.value;
      if (gear?.secondaryStat) totals[gear.secondaryStat.stat] += gear.secondaryStat.value;
    }
    for (const slot of PLAYER_SLOTS) {
      const gear = playerLoadout[slot];
      if (gear?.primaryStat) totals[gear.primaryStat.stat] += gear.primaryStat.value;
      if (gear?.secondaryStat) totals[gear.secondaryStat.stat] += gear.secondaryStat.value;
    }
    return totals;
  }, [steedLoadout, playerLoadout]);

  const handleRarityChange = (r: GiglingRarity) => {
    setRarity(r);
    setSeed(prev => prev + 1);
  };

  const handleReroll = () => {
    setSeed(prev => prev + 1);
  };

  return (
    <div className="screen">
      <h1>Equip for Battle</h1>
      <p className="subtitle">
        {archetype.name} vs {opponentName} — gear up your mount and knight
      </p>

      {/* Rarity Tier */}
      <h3 className="mb-8">Gear Tier</h3>
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

      {/* Steed Gear Section */}
      <div className="loadout-section mt-16">
        <div className="loadout-section__header">
          <h3>Steed Gear</h3>
          <button className="btn btn--small" onClick={handleReroll}>Re-roll All</button>
        </div>
        <div className="gear-list">
          {STEED_SLOTS.map(slot => {
            const gear = steedLoadout[slot];
            if (!gear) return null;
            const label = STEED_SLOT_LABELS[slot];
            return (
              <div key={slot} className="gear-item gear-item--steed">
                <div className="gear-item__slot">
                  <div>{label.name}</div>
                  <div className="gear-item__desc">{label.desc}</div>
                </div>
                <span className="gear-item__stats">
                  {gear.primaryStat && (
                    <span className="gear-stat gear-stat--primary" title={STAT_TIPS[gear.primaryStat.stat]}>
                      {STAT_ABBR[gear.primaryStat.stat]} +{gear.primaryStat.value}
                    </span>
                  )}
                  {gear.secondaryStat && (
                    <span className="gear-stat gear-stat--secondary" title={STAT_TIPS[gear.secondaryStat.stat]}>
                      {STAT_ABBR[gear.secondaryStat.stat]} +{gear.secondaryStat.value}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Player Gear Section */}
      <div className="loadout-section mt-16">
        <h3>Player Gear</h3>
        <div className="gear-list">
          {PLAYER_SLOTS.map(slot => {
            const gear = playerLoadout[slot];
            if (!gear) return null;
            const label = PLAYER_SLOT_LABELS[slot];
            return (
              <div key={slot} className="gear-item gear-item--player">
                <div className="gear-item__slot">
                  <div>{label.name}</div>
                  <div className="gear-item__desc">{label.desc}</div>
                </div>
                <span className="gear-item__stats">
                  {gear.primaryStat && (
                    <span className="gear-stat gear-stat--primary" title={STAT_TIPS[gear.primaryStat.stat]}>
                      {STAT_ABBR[gear.primaryStat.stat]} +{gear.primaryStat.value}
                    </span>
                  )}
                  {gear.secondaryStat && (
                    <span className="gear-stat gear-stat--secondary" title={STAT_TIPS[gear.secondaryStat.stat]}>
                      {STAT_ABBR[gear.secondaryStat.stat]} +{gear.secondaryStat.value}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats Preview */}
      <div className="loadout-section mt-16">
        <h3 className="mb-8">Stats Preview</h3>
        <div className="stats-preview">
          <div className="stats-preview__column">
            <div className="stats-preview__label">Base</div>
            <StatBar label="MOM" value={archetype.momentum} max={160} type="mom" />
            <StatBar label="CTL" value={archetype.control} max={160} type="ctl" />
            <StatBar label="GRD" value={archetype.guard} max={160} type="grd" />
            <StatBar label="INIT" value={archetype.initiative} max={160} type="init" />
            <StatBar label="STA" value={archetype.stamina} max={160} type="sta" />
          </div>
          <div className="stats-preview__arrow">{'\u2192'}</div>
          <div className="stats-preview__column">
            <div className="stats-preview__label">With Gear</div>
            <StatBar label="MOM" value={boosted.momentum} max={160} type="mom" />
            <StatBar label="CTL" value={boosted.control} max={160} type="ctl" />
            <StatBar label="GRD" value={boosted.guard} max={160} type="grd" />
            <StatBar label="INIT" value={boosted.initiative} max={160} type="init" />
            <StatBar label="STA" value={boosted.stamina} max={160} type="sta" />
          </div>
        </div>
        {rarityBonus > 0 && (
          <p className="stats-preview__note">
            Mount bonus: +{rarityBonus} all stats | Steed + Player gear adds on top
          </p>
        )}
        <div className="gear-bonus-summary">
          <span className="gear-bonus-summary__title">Total Gear Bonus</span>
          {Object.entries(totalBonuses).map(([stat, val]) => (
            <span key={stat} className="gear-bonus-summary__stat" title={STAT_TIPS[stat]}>
              {STAT_ABBR[stat]} <strong>+{val}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="text-center mt-24">
        <button className="btn btn--primary btn--large" onClick={() => onConfirm(steedLoadout, playerLoadout)}>
          Enter the Lists!
        </button>
      </div>

      <p className="text-center mt-8" style={{ fontSize: '0.8rem', color: 'var(--ink-faint)' }}>
        Your opponent will be equipped at a similar tier.
      </p>
    </div>
  );
}
