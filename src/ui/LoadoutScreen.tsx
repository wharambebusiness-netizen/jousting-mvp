import { useState, useMemo } from 'react';
import type { Archetype, GiglingRarity, GiglingLoadout, PlayerLoadout, SteedGearSlot, PlayerGearSlot, GearVariant } from '../engine/types';
import { createStatGear, applyGiglingLoadout } from '../engine/gigling-gear';
import { createPlayerGear, applyPlayerLoadout } from '../engine/player-gear';
import { getSteedVariantDef, getPlayerVariantDef, ALL_STEED_SLOTS, ALL_PLAYER_SLOTS, ALL_GEAR_VARIANTS } from '../engine/gear-variants';
import { BALANCE } from '../engine/balance-config';
import { StatBar, STAT_ABBR, STAT_TIPS } from './helpers';

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

const VARIANT_LABELS: Record<GearVariant, { short: string; full: string }> = {
  aggressive: { short: 'Agg', full: 'Aggressive' },
  balanced:   { short: 'Bal', full: 'Balanced' },
  defensive:  { short: 'Def', full: 'Defensive' },
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

  const setAllGearToVariant = (variant: GearVariant) => {
    setAllSteedVariants(variant);
    setAllPlayerVariants(variant);
  };

  // --- Matchup hint heuristics ---
  // Based on balance findings from memory: bare tier patterns
  const getMatchupHint = (): { estimate: string; confidence: string; notes: string } => {
    // Check if most slots use the same variant (quick build applied)
    const steedVarCounts = { aggressive: 0, balanced: 0, defensive: 0 };
    const playerVarCounts = { aggressive: 0, balanced: 0, defensive: 0 };
    STEED_SLOTS.forEach(s => steedVarCounts[steedVariants[s]]++);
    PLAYER_SLOTS.forEach(s => playerVarCounts[playerVariants[s]]++);

    const dominantSteed = steedVarCounts.aggressive >= 4 ? 'aggressive' :
                          steedVarCounts.defensive >= 4 ? 'defensive' : 'balanced';
    const dominantPlayer = playerVarCounts.aggressive >= 4 ? 'aggressive' :
                           playerVarCounts.defensive >= 4 ? 'defensive' : 'balanced';
    const overallVariant = dominantSteed === dominantPlayer ? dominantSteed : 'mixed';

    // Base win rates from memory (bare tier, balanced gear)
    const baseWinRates: Record<string, number> = {
      charger: 39.0, technician: 52.4, bulwark: 61.4,
      tactician: 49.6, breaker: 46.5, duelist: 51.1,
    };

    const baseRate = baseWinRates[archetype.id] || 50;

    // Variant modifiers (heuristic from design analysis)
    let variantMod = 0;
    if (overallVariant === 'aggressive') {
      // Aggressive gear amplifies momentum-based archetypes
      if (archetype.id === 'charger') variantMod = +3;
      else if (archetype.id === 'tactician') variantMod = +2;
      else if (archetype.id === 'bulwark') variantMod = -5; // hurts defensive archetypes
      else variantMod = +1;
    } else if (overallVariant === 'defensive') {
      // Defensive gear helps guard-based archetypes
      if (archetype.id === 'bulwark') variantMod = +4;
      else if (archetype.id === 'breaker') variantMod = +2;
      else if (archetype.id === 'charger') variantMod = -2; // reduces momentum effectiveness
      else variantMod = 0;
    }

    // Rarity modifier (higher tiers compress balance)
    let rarityMod = 0;
    if (gigRarity === 'giga') {
      // Giga tier compresses win rates toward 50% (memory: 7.2pp spread at giga)
      rarityMod = Math.sign(50 - baseRate) * 2;
    }

    const estimatedRate = Math.max(30, Math.min(70, baseRate + variantMod + rarityMod));
    const roundedRate = Math.round(estimatedRate);

    let confidence = 'Medium';
    if (overallVariant === 'mixed') confidence = 'Low';
    if (gigRarity === 'giga' || gigRarity === 'relic') confidence = 'Medium-High';

    let notes = '';
    if (archetype.id === 'bulwark' && gigRarity === 'uncommon') {
      notes = 'Bulwark dominates at uncommon tier (~63% win rate).';
    } else if (archetype.id === 'charger' && gigRarity === 'epic') {
      notes = 'Charger peaks at epic tier (~56% win rate).';
    } else if (overallVariant === 'aggressive' && archetype.id === 'bulwark') {
      notes = 'Aggressive gear weakens Bulwark\'s defensive identity.';
    } else if (overallVariant === 'defensive' && archetype.id === 'charger') {
      notes = 'Defensive gear reduces Charger\'s momentum advantage.';
    }

    return {
      estimate: `~${roundedRate}%`,
      confidence,
      notes,
    };
  };

  const matchupHint = useMemo(
    () => getMatchupHint(),
    [archetype.id, steedVariants, playerVariants, gigRarity]
  );

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
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(r.id); }}}
            role="button"
            tabIndex={0}
            aria-label={`Select ${r.label} rarity`}
            aria-pressed={value === r.id}
          >
            <div className="rarity-card__name">{r.label}</div>
          </div>
        ))}
      </div>
    </div>
  );

  // --- Variant toggle component with affinity ---
  const VariantToggle = ({ current, onSelect, slot, isSteed }: {
    current: GearVariant;
    onSelect: (v: GearVariant) => void;
    slot: SteedGearSlot | PlayerGearSlot;
    isSteed: boolean;
  }) => (
    <span className="variant-toggle">
      {ALL_GEAR_VARIANTS.map(v => {
        const def = isSteed
          ? getSteedVariantDef(slot as SteedGearSlot, v)
          : getPlayerVariantDef(slot as PlayerGearSlot, v);
        const affinityLabel = def.affinity ? `Favors: ${def.affinity.charAt(0).toUpperCase() + def.affinity.slice(1)}` : '';
        const fullTitle = `${VARIANT_LABELS[v].full}${affinityLabel ? ` — ${affinityLabel}` : ''}`;

        return (
          <button
            key={v}
            className={`variant-toggle__btn variant-toggle__btn--${v} ${current === v ? 'variant-toggle__btn--active' : ''}`}
            onClick={() => onSelect(v)}
            title={fullTitle}
            aria-label={`Select ${VARIANT_LABELS[v].full} variant${affinityLabel ? `, ${affinityLabel}` : ''}`}
            aria-pressed={current === v}
          >
            {VARIANT_LABELS[v].short}
          </button>
        );
      })}
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
          aria-label={`Set all gear slots to ${VARIANT_LABELS[v].full} variant`}
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

      {/* --- Quick Builds Section --- */}
      <div className="quick-builds-section">
        <h3 className="quick-builds-section__title">Quick Builds</h3>
        <p className="quick-builds-section__subtitle">
          Choose a build style to automatically configure all gear slots
        </p>
        <div className="quick-builds-grid">
          <button
            className="quick-build-card quick-build-card--aggressive"
            onClick={() => setAllGearToVariant('aggressive')}
            aria-label="Aggressive Build: Higher offense, lower defense. Favors quick unseats and melee strategies."
          >
            <div className="quick-build-card__header">
              <span className="quick-build-card__icon">⚔️</span>
              <span className="quick-build-card__name">Aggressive Build</span>
            </div>
            <div className="quick-build-card__desc">
              High damage, fast strikes. Favors Charger, Tactician.
            </div>
            <div className="variant-tooltip">
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">⚡ Strategy:</span>
                <span className="variant-tooltip__text">Pressure early. Win before fatigue sets in.</span>
              </div>
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">⚠️ Risk:</span>
                <span className="variant-tooltip__text">Stamina cliff — vulnerable if match extends past turn 3.</span>
              </div>
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">📊 Impact:</span>
                <span className="variant-tooltip__text">Favors melee-heavy matches (+16% melee rate).</span>
              </div>
            </div>
          </button>
          <button
            className="quick-build-card quick-build-card--balanced"
            onClick={() => setAllGearToVariant('balanced')}
            aria-label="Balanced Build: Equal offense and defense. Reliable for all playstyles."
          >
            <div className="quick-build-card__header">
              <span className="quick-build-card__icon">⚖️</span>
              <span className="quick-build-card__name">Balanced Build</span>
            </div>
            <div className="quick-build-card__desc">
              Versatile, adaptable. Works well for Duelist.
            </div>
            <div className="variant-tooltip">
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">✓ Strategy:</span>
                <span className="variant-tooltip__text">Adapt to opponent. Works everywhere.</span>
              </div>
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">✓ Advantage:</span>
                <span className="variant-tooltip__text">No hard counters. Beginner-friendly.</span>
              </div>
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">📊 Impact:</span>
                <span className="variant-tooltip__text">Neutral baseline. Predictable outcomes.</span>
              </div>
            </div>
          </button>
          <button
            className="quick-build-card quick-build-card--defensive"
            onClick={() => setAllGearToVariant('defensive')}
            aria-label="Defensive Build: Higher defense, lower offense. Favors long jousts and stamina endurance."
          >
            <div className="quick-build-card__header">
              <span className="quick-build-card__icon">🛡️</span>
              <span className="quick-build-card__name">Defensive Build</span>
            </div>
            <div className="quick-build-card__desc">
              Tank damage, outlast opponents. Favors Bulwark, Breaker.
            </div>
            <div className="variant-tooltip">
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">⛑️ Strategy:</span>
                <span className="variant-tooltip__text">Outlast opponents. Win late-game.</span>
              </div>
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">✓ Advantage:</span>
                <span className="variant-tooltip__text">Better guard → fewer unseats. Charger +3% win rate at giga.</span>
              </div>
              <div className="variant-tooltip__row">
                <span className="variant-tooltip__label">📊 Impact:</span>
                <span className="variant-tooltip__text">Best overall balance (6.6pp spread at giga tier).</span>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* --- Matchup Hint --- */}
      <div className="matchup-hint">
        <div className="matchup-hint__header">
          <span className="matchup-hint__icon">📊</span>
          <span className="matchup-hint__title">Estimated Win Rate</span>
        </div>
        <div className="matchup-hint__body">
          <div className="matchup-hint__rate">{matchupHint.estimate}</div>
          <div className="matchup-hint__confidence">Confidence: {matchupHint.confidence}</div>
          {matchupHint.notes && (
            <div className="matchup-hint__notes">{matchupHint.notes}</div>
          )}
        </div>
        <div className="matchup-hint__disclaimer">
          Based on {archetype.name} stats, gear variant, and rarity. Actual results may vary.
        </div>
      </div>

      {/* --- Independent Rarity Selectors --- */}
      <h3 className="mb-8 mt-16">Gear Tiers</h3>

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
              <div key={slot} className={`gear-item gear-item--steed gear-item--${gear.rarity}`}>
                <div className="gear-item__slot">
                  <div className="gear-item__slot-name">{label.name}</div>
                  <div className="gear-item__gear-name" title={label.desc}>{variantDef.name}</div>
                </div>
                <VariantToggle
                  current={steedVariants[slot]}
                  onSelect={v => setSteedVariant(slot, v)}
                  slot={slot}
                  isSteed={true}
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
              <div key={slot} className={`gear-item gear-item--player gear-item--${gear.rarity}`}>
                <div className="gear-item__slot">
                  <div className="gear-item__slot-name">{label.name}</div>
                  <div className="gear-item__gear-name" title={label.desc}>{variantDef.name}</div>
                </div>
                <VariantToggle
                  current={playerVariants[slot]}
                  onSelect={v => setPlayerVariant(slot, v)}
                  slot={slot}
                  isSteed={false}
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

      <p className="text-center mt-8 hint-text">
        Your opponent will be equipped at a similar tier.
      </p>
    </div>
  );
}
