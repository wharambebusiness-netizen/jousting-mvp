import { Stance, SpeedType, type Attack, type CaparisonEffect } from '../engine/types';
import { JOUST_ATTACKS, MELEE_ATTACKS } from '../engine/attacks';

// --- Archetype icons for scoreboard ---
const ARCHETYPE_ICON: Record<string, string> = {
  Charger: '\uD83C\uDFC7',    // horse racing
  Technician: '\u2699\uFE0F',  // gear
  Bulwark: '\uD83D\uDEE1\uFE0F', // shield
  Tactician: '\u265F\uFE0F',   // chess pawn
  Breaker: '\uD83D\uDD28',    // hammer
  Duelist: '\u2694\uFE0F',     // crossed swords
};

// All known attacks for name lookup
const ALL_ATTACKS: Record<string, Attack> = { ...JOUST_ATTACKS, ...MELEE_ATTACKS };

// --- Caparison short names for badges ---
const CAP_SHORT: Record<string, string> = {
  pennant_of_haste: 'Haste',
  woven_shieldcloth: 'Shieldcloth',
  thunderweave: 'Thunderweave',
  irongrip_drape: 'Irongrip',
  stormcloak: 'Stormcloak',
  banner_of_the_giga: 'Banner',
};

// --- Caparison icons ---
const CAP_ICON: Record<string, string> = {
  pennant_of_haste: '\u26A1',    // lightning bolt
  woven_shieldcloth: '\uD83D\uDEE1\uFE0F', // shield
  thunderweave: '\u{1F329}\uFE0F',  // cloud with lightning
  irongrip_drape: '\u270A',      // raised fist
  stormcloak: '\uD83C\uDF00',   // cyclone
  banner_of_the_giga: '\uD83C\uDFF4', // black flag
};

// --- Stat descriptions for tooltips ---
const STAT_TIPS: Record<string, string> = {
  mom: 'Momentum — raw hitting power. Drives Impact Score.',
  ctl: 'Control — precision. Drives Accuracy and shift eligibility.',
  grd: 'Guard — defense. Reduces opponent Impact Score. Not affected by fatigue.',
  init: 'Initiative — speed advantage. Adds to Accuracy, decides shift priority.',
  sta: 'Stamina — endurance. Below 40, Momentum and Control are reduced.',
};

export function stanceClass(stance: Stance): string {
  if (stance === Stance.Aggressive) return 'stance-tag--agg';
  if (stance === Stance.Balanced) return 'stance-tag--bal';
  return 'stance-tag--def';
}

export function stanceAbbr(stance: Stance): string {
  if (stance === Stance.Aggressive) return 'AGG';
  if (stance === Stance.Balanced) return 'BAL';
  return 'DEF';
}

export function deltaStr(val: number): string {
  if (val > 0) return `+${val}`;
  if (val < 0) return `${val}`;
  return '0';
}

export function deltaClass(val: number): string {
  if (val > 0) return 'delta delta--pos';
  if (val < 0) return 'delta delta--neg';
  return 'delta delta--zero';
}

export function attackName(id: string): string {
  return ALL_ATTACKS[id]?.name ?? id;
}

// --- Caparison Badge ---
export function CaparisonBadge({ effect, triggered }: {
  effect?: CaparisonEffect;
  triggered?: boolean;
}) {
  if (!effect) return null;
  const short = CAP_SHORT[effect.id] ?? effect.name;
  const icon = CAP_ICON[effect.id];
  return (
    <span
      className={`cap-badge cap-badge--${effect.rarity}${triggered ? ' cap-badge--triggered' : ''}`}
      title={`${effect.name}: ${effect.description}`}
    >
      {icon && <span className="cap-badge__icon">{icon}</span>}
      {short}
    </span>
  );
}

/**
 * Determines which caparison effects triggered this joust pass for a given player.
 */
export function joustCapTriggered(
  effect: CaparisonEffect | undefined,
  passNumber: number,
  speed: SpeedType,
  finalAttackStance: Stance,
  bannerConsumed?: boolean,
): boolean {
  if (!effect) return false;
  switch (effect.id) {
    case 'pennant_of_haste': return passNumber === 1;
    case 'woven_shieldcloth': return finalAttackStance === Stance.Defensive;
    case 'thunderweave': return speed === SpeedType.Fast;
    case 'irongrip_drape': return true; // passive, always active during joust
    case 'stormcloak': return true; // passive, always active
    case 'banner_of_the_giga': return !!bannerConsumed;
    default: return false;
  }
}

/**
 * Determines if a caparison triggered this melee round for a given player.
 */
export function meleeCapTriggered(
  effect: CaparisonEffect | undefined,
  attackStance: Stance,
  bannerConsumed?: boolean,
): boolean {
  if (!effect) return false;
  switch (effect.id) {
    case 'woven_shieldcloth': return attackStance === Stance.Defensive;
    case 'stormcloak': return true;
    case 'banner_of_the_giga': return !!bannerConsumed;
    default: return false; // Pennant, Thunderweave, Irongrip don't apply in melee
  }
}

export function Stars({ filled, max = 5 }: { filled: number; max?: number }) {
  return (
    <span className="stars">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`star ${i < filled ? 'star--filled' : 'star--empty'}`}>
          {i < filled ? '\u2605' : '\u2606'}
        </span>
      ))}
    </span>
  );
}

export function StatBar({ label, value, max, type }: {
  label: string;
  value: number;
  max: number;
  type: 'mom' | 'ctl' | 'grd' | 'init' | 'sta';
}) {
  const pct = Math.min(100, (value / max) * 100);
  const tip = STAT_TIPS[type];
  return (
    <div className={`stat-bar stat-bar--${type}`}>
      <span className="stat-bar__label tip" data-tip={tip}>{label}</span>
      <div className="stat-bar__track">
        <div className="stat-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="stat-bar__value">{value}</span>
    </div>
  );
}

export function StanceTag({ stance }: { stance: Stance }) {
  const tip = stance === Stance.Aggressive ? 'Aggressive beats Defensive'
    : stance === Stance.Balanced ? 'Balanced beats Aggressive'
    : 'Defensive beats Balanced';
  return (
    <span className={`stance-tag ${stanceClass(stance)} tip`} data-tip={tip}>
      {stanceAbbr(stance)}
    </span>
  );
}

export function DeltaVal({ label, value }: { label: string; value: number }) {
  return (
    <span className="attack-card__delta">
      <span style={{ color: 'var(--ink-faint)' }}>{label}</span>{' '}
      <span className={deltaClass(value)}>{deltaStr(value)}</span>
    </span>
  );
}

export function StaminaBar({ current, max }: { current: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (current / max) * 100));
  const fillClass = current < 20 ? 'stamina-bar__fill stamina-bar__fill--critical'
    : current < 40 ? 'stamina-bar__fill stamina-bar__fill--mid'
    : 'stamina-bar__fill';
  return (
    <div className="stamina-display tip" data-tip={current < 40 ? `Fatigued! Stats reduced to ${Math.round(current / 40 * 100)}%` : `Stamina: ${current}/${max}`}>
      <span style={{ fontWeight: 600, minWidth: 24 }}>{current}</span>
      <div className="stamina-bar">
        <div className={fillClass} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function PassPips({ current, total }: { current: number; total: number }) {
  return (
    <div className="pass-pips">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`pass-pip${i < current ? ' pass-pip--done' : i === current ? ' pass-pip--current' : ''}`}
        />
      ))}
    </div>
  );
}

export function Scoreboard({ p1Name, p2Name, p1Score, p2Score, p1Sta, p2Sta, p1MaxSta, p2MaxSta, label, p1Cap, p2Cap, passNumber, totalPasses }: {
  p1Name: string;
  p2Name: string;
  p1Score: number;
  p2Score: number;
  p1Sta: number;
  p2Sta: number;
  p1MaxSta: number;
  p2MaxSta: number;
  label: string;
  p1Cap?: CaparisonEffect;
  p2Cap?: CaparisonEffect;
  passNumber?: number;
  totalPasses?: number;
}) {
  const p1Icon = ARCHETYPE_ICON[p1Name];
  const p2Icon = ARCHETYPE_ICON[p2Name];
  return (
    <div className="scoreboard">
      <div className="scoreboard__player">
        <div className="scoreboard__name">
          {p1Icon && <span className="scoreboard__icon">{p1Icon}</span>}
          {p1Name}
        </div>
        {p1Cap && <CaparisonBadge effect={p1Cap} />}
        <div className="scoreboard__score scoreboard__score--anim">{p1Score.toFixed(1)}</div>
        <StaminaBar current={p1Sta} max={p1MaxSta} />
      </div>
      <div className="scoreboard__center">
        <div className="scoreboard__pass">{label}</div>
        {passNumber != null && totalPasses != null && (
          <PassPips current={passNumber - 1} total={totalPasses} />
        )}
      </div>
      <div className="scoreboard__player">
        <div className="scoreboard__name">
          {p2Icon && <span className="scoreboard__icon">{p2Icon}</span>}
          {p2Name}
        </div>
        {p2Cap && <CaparisonBadge effect={p2Cap} />}
        <div className="scoreboard__score scoreboard__score--anim">{p2Score.toFixed(1)}</div>
        <StaminaBar current={p2Sta} max={p2MaxSta} />
      </div>
    </div>
  );
}
