// ============================================================
// Jousting — Gear Utilities (Shared between steed & player gear)
// ============================================================

export interface StatBonuses {
  momentum: number;
  control: number;
  guard: number;
  initiative: number;
  stamina: number;
}

export function emptyBonuses(): StatBonuses {
  return { momentum: 0, control: 0, guard: 0, initiative: 0, stamina: 0 };
}

export function rollInRange(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
