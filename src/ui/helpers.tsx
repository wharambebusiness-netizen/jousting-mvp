import { Stance, type Attack } from '../engine/types';
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

// --- Stat descriptions for tooltips ---
export const STAT_ABBR: Record<string, string> = {
  momentum: 'MOM', control: 'CTL', guard: 'GRD', initiative: 'INIT', stamina: 'STA',
};

const STAT_TIPS: Record<string, string> = {
  mom: 'Momentum — Attack speed and power. Determines how much damage you deal. High Momentum lets you hit first, but leaves you more vulnerable to counters.',
  ctl: 'Control — Defense and precision. Determines your attack accuracy and when you can shift attacks mid-speed. High Control keeps you resilient.',
  grd: 'Guard — Armor strength. Reduces damage from opponent attacks. The only stat that doesn\'t get reduced by fatigue—your armor stays effective.',
  init: 'Initiative — Speed and reflexes. Helps you act first and improves attack accuracy. Higher Initiative means you\'ll react before your opponent in the speed selection phase.',
  sta: 'Stamina — Endurance and fatigue resistance. When it drops below 40, your Momentum and Control are reduced. Choose attacks carefully late in combat.',
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
  const fullLabel = `${label}: ${tip}`;
  return (
    <div className={`stat-bar stat-bar--${type}`}>
      <abbr
        className="stat-bar__label tip"
        title={tip}
        tabIndex={0}
        aria-label={fullLabel}
      >
        {label}
      </abbr>
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
      <span className="text-faint">{label}</span>{' '}
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
      <span className="stamina-display__value">{current}</span>
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

export function Scoreboard({ p1Name, p2Name, p1Score, p2Score, p1Sta, p2Sta, p1MaxSta, p2MaxSta, label, passNumber, totalPasses }: {
  p1Name: string;
  p2Name: string;
  p1Score: number;
  p2Score: number;
  p1Sta: number;
  p2Sta: number;
  p1MaxSta: number;
  p2MaxSta: number;
  label: string;
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
        <div className="scoreboard__score scoreboard__score--anim">{p2Score.toFixed(1)}</div>
        <StaminaBar current={p2Sta} max={p2MaxSta} />
      </div>
    </div>
  );
}
