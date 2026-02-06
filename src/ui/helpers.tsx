import { Stance, type Attack } from '../engine/types';
import { JOUST_ATTACKS, MELEE_ATTACKS } from '../engine/attacks';

// All known attacks for name lookup
const ALL_ATTACKS: Record<string, Attack> = { ...JOUST_ATTACKS, ...MELEE_ATTACKS };

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

export function Scoreboard({ p1Name, p2Name, p1Score, p2Score, p1Sta, p2Sta, p1MaxSta, p2MaxSta, label }: {
  p1Name: string;
  p2Name: string;
  p1Score: number;
  p2Score: number;
  p1Sta: number;
  p2Sta: number;
  p1MaxSta: number;
  p2MaxSta: number;
  label: string;
}) {
  return (
    <div className="scoreboard">
      <div className="scoreboard__player">
        <div className="scoreboard__name">{p1Name}</div>
        <div className="scoreboard__score">{p1Score.toFixed(1)}</div>
        <StaminaBar current={p1Sta} max={p1MaxSta} />
      </div>
      <div className="scoreboard__center">
        <div className="scoreboard__pass">{label}</div>
      </div>
      <div className="scoreboard__player">
        <div className="scoreboard__name">{p2Name}</div>
        <div className="scoreboard__score">{p2Score.toFixed(1)}</div>
        <StaminaBar current={p2Sta} max={p2MaxSta} />
      </div>
    </div>
  );
}
