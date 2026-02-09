import { useState, useMemo } from 'react';
import type { Archetype, GiglingRarity, GiglingLoadout, PlayerLoadout, SteedGearSlot, PlayerGearSlot, GearVariant } from '../engine/types';
import { createStatGear, applyGiglingLoadout } from '../engine/gigling-gear';
import { createPlayerGear, applyPlayerLoadout } from '../engine/player-gear';
import { getSteedVariantDef, getPlayerVariantDef, ALL_STEED_SLOTS, ALL_PLAYER_SLOTS, ALL_GEAR_VARIANTS } from '../engine/gear-variants';
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

const VARIANT_LABELS: Record<GearVariant, { short: string; full: string }> = {
  aggressive: { short: 'Agg', full: 'Aggressive' },
  balanced:   { short: 'Bal', full: 'Balanced' },
  defensive:  { short: 'Def', full: 'Defensive' },
};

const VARIANT_COLORS: Record<GearVariant, string> = {
  aggressive: 'var(--mom, #c44)',
  balanced:   'var(--ctl, #48a)',
  defensive:  'var(--grd, #4a8)',
};

interface Props {
  archetype: Archetype;
  opponentName: string;
  onConfirm: (steedLoadout: GiglingLoadout, playerLoadout: PlayerLoadout) => void;
}

export function LoadoutScreen({ archetype, opponentName, onConfirm }: Props) {
  // --- Independent rarity state ---
  const [gigRarity, setGigRarity] = useState<GiglingRarity>('uncommon');
  const [steedGearRarity, setSteedGearRarity] = useState<GiglingRarity>('uncommon');
  const [playerGearRarity, setPlayerGearRarity] = useState<GiglingRarity>('uncommon');
  const [seed, setSeed] = useState(0);

  // --- Per-slot variant state ---
  const [steedVariants, setSteedVariants] = useState<Record<SteedGearSlot, GearVariant>>({
    chamfron: 'balanced', barding: 'balanced', saddle: 'balanced',
    stirrups: 'balanced', reins: 'balanced', horseshoes: 'balanced',
  });
  const [playerVariants, setPlayerVariants] = useState<Record<PlayerGearSlot, GearVariant>>({
    helm: 'balanced', shield: 'balanced', lance: 'balanced',
    armor: 'balanced', gauntlets: 'balanced', melee_weapon: 'balanced',
  });

  // Create deterministic RNG from seed
  function makeRng(s: number) {
    let i = s;
    return () => {
      i = (i * 1664525 + 1013904223) & 0x7fffffff;
      return i / 0x7fffffff;
    };
  }

  // --- Generate loadouts per-slot with individual variants ---
  const steedLoadout = useMemo(() => {
    const rng = makeRng(seed);
    const loadout: GiglingLoadout = { giglingRarity: gigRarity };
    for (const slot of ALL_STEED_SLOTS) {
      loadout[slot] = createStatGear(slot, steedGearRarity, rng, steedVariants[slot]);
    }
    return loadout;
  }, [gigRarity, steedGearRarity, seed, steedVariants]);

  const playerLoadout = useMemo(() => {
    const rng = makeRng(seed + 7919);
    const loadout: PlayerLoadout = {};
    for (const slot of ALL_PLAYER_SLOTS) {
      loadout[slot] = createPlayerGear(slot, playerGearRarity, rng, playerVariants[slot]);
    }
    return loadout;
  }, [playerGearRarity, seed, playerVariants]);

  // Boosted archetype for stat preview (both gear systems applied)
  const boosted = useMemo(() => {
    const withSteed = applyGiglingLoadout(archetype, steedLoadout);
    return applyPlayerLoadout(withSteed, playerLoadout);
  }, [archetype, steedLoadout, playerLoadout]);

  const rarityBonus = BALANCE.giglingRarityBonus[gigRarity];

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

  // --- Handlers ---
  const handleReroll = () => {
    setSeed(prev => prev + 1);
  };

  const setSteedVariant = (slot: SteedGearSlot, variant: GearVariant) => {
    setSteedVariants(prev => ({ ...prev, [slot]: variant }));
  };

  const setPlayerVariant = (slot: PlayerGearSlot, variant: GearVariant) => {
    setPlayerVariants(prev => ({ ...prev, [slot]: variant }));
  };

  const setAllSteedVariants = (variant: GearVariant) => {
    setSteedVariants({
      chamfron: variant, barding: variant, saddle: variant,
      stirrups: variant, reins: variant, horseshoes: variant,
    });
  };

  const setAllPlayerVariants = (variant: GearVariant) => {
    setPlayerVariants({
      helm: variant, shield: variant, lance: variant,
      armor: variant, gauntlets: variant, melee_weapon: variant,
    });
  };

  // --- Shared rarity selector component ---
  const RaritySelector = ({ label, value, onChange }: {
    label: string;
    value: GiglingRarity;
    onChange: (r: GiglingRarity) => void;
  }) => (
    <div className="rarity-selector">
      <h4 className="rarity-selector__label">{label}</h4>
      <div className="rarity-grid rarity-grid--compact">
        {RARITIES.map(r => (
          <div
            key={r.id}
            className={`card card--selectable rarity-card rarity-card--${r.id} rarity-card--compact ${value === r.id ? 'card--selected' : ''}`}
            onClick={() => onChange(r.id)}
          >
            <div className="rarity-card__name">{r.label}</div>
          </div>
        ))}
      </div>
    </div>
  );

  // --- Variant toggle component ---
  const VariantToggle = ({ current, onSelect }: {
    current: GearVariant;
    onSelect: (v: GearVariant) => void;
  }) => (
    <span className="variant-toggle">
      {ALL_GEAR_VARIANTS.map(v => (
        <button
          key={v}
          className={`variant-toggle__btn variant-toggle__btn--${v} ${current === v ? 'variant-toggle__btn--active' : ''}`}
          onClick={() => onSelect(v)}
          title={VARIANT_LABELS[v].full}
          style={current === v ? { borderColor: VARIANT_COLORS[v], color: VARIANT_COLORS[v] } : undefined}
        >
          {VARIANT_LABELS[v].short}
        </button>
      ))}
    </span>
  );

  // --- Quick-set variant buttons ---
  const QuickSetButtons = ({ onSet }: { onSet: (v: GearVariant) => void }) => (
    <span className="quick-set-buttons">
      {ALL_GEAR_VARIANTS.map(v => (
        <button
          key={v}
          className="btn btn--small btn--outline"
          onClick={() => onSet(v)}
          title={`Set all slots to ${VARIANT_LABELS[v].full}`}
        >
          All {VARIANT_LABELS[v].full}
        </button>
      ))}
    </span>
  );

  return (
    <div className="screen">
      <h1>Equip for Battle</h1>
      <p className="subtitle">
        {archetype.name} vs {opponentName} — gear up your mount and knight
      </p>

      {/* --- Independent Rarity Selectors --- */}
      <h3 className="mb-8">Gear Tiers</h3>

      <RaritySelector
        label="Mount Rarity"
        value={gigRarity}
        onChange={r => { setGigRarity(r); setSeed(prev => prev + 1); }}
      />
      <p className="rarity-selector__note">
        +{BALANCE.giglingRarityBonus[gigRarity]} flat bonus to all stats
      </p>

      <RaritySelector
        label="Steed Gear Quality"
        value={steedGearRarity}
        onChange={r => { setSteedGearRarity(r); setSeed(prev => prev + 1); }}
      />

      <RaritySelector
        label="Player Gear Quality"
        value={playerGearRarity}
        onChange={r => { setPlayerGearRarity(r); setSeed(prev => prev + 1); }}
      />

      {/* --- Steed Gear Section --- */}
      <div className="loadout-section mt-16">
        <div className="loadout-section__header">
          <h3>Steed Gear</h3>
          <span className="loadout-section__actions">
            <QuickSetButtons onSet={setAllSteedVariants} />
            <button className="btn btn--small" onClick={handleReroll}>Re-roll All</button>
          </span>
        </div>
        <div className="gear-list">
          {STEED_SLOTS.map(slot => {
            const gear = steedLoadout[slot];
            if (!gear) return null;
            const label = STEED_SLOT_LABELS[slot];
            const variantDef = getSteedVariantDef(slot, steedVariants[slot]);
            return (
              <div key={slot} className="gear-item gear-item--steed">
                <div className="gear-item__slot">
                  <div className="gear-item__slot-name">{label.name}</div>
                  <div className="gear-item__gear-name" title={label.desc}>{variantDef.name}</div>
                </div>
                <VariantToggle
                  current={steedVariants[slot]}
                  onSelect={v => setSteedVariant(slot, v)}
                />
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

      {/* --- Player Gear Section --- */}
      <div className="loadout-section mt-16">
        <div className="loadout-section__header">
          <h3>Player Gear</h3>
          <span className="loadout-section__actions">
            <QuickSetButtons onSet={setAllPlayerVariants} />
          </span>
        </div>
        <div className="gear-list">
          {PLAYER_SLOTS.map(slot => {
            const gear = playerLoadout[slot];
            if (!gear) return null;
            const label = PLAYER_SLOT_LABELS[slot];
            const variantDef = getPlayerVariantDef(slot, playerVariants[slot]);
            return (
              <div key={slot} className="gear-item gear-item--player">
                <div className="gear-item__slot">
                  <div className="gear-item__slot-name">{label.name}</div>
                  <div className="gear-item__gear-name" title={label.desc}>{variantDef.name}</div>
                </div>
                <VariantToggle
                  current={playerVariants[slot]}
                  onSelect={v => setPlayerVariant(slot, v)}
                />
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

      {/* --- Stats Preview --- */}
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
