// ============================================================
// Jousting MVP — Balance Simulation Tool (12-Slot Gear)
// ============================================================
// Runs AI vs AI matches across all archetype matchups to gather
// win rate, unseat rate, and phase balance statistics.
// Supports bare (no gear), uniform gear, and mixed-rarity gear modes.
//
// Usage:
//   npx tsx src/tools/simulate.ts [tier] [variant]          # Text output (default)
//   npx tsx src/tools/simulate.ts [tier] [variant] --json   # Structured JSON output
//
// Exports:
//   runSimulation(config)  — programmatic access, returns SimulationReport
//   SimulationReport, MatchupResult, ArchetypeStats, etc. — types
// ============================================================
import { ARCHETYPES, ARCHETYPE_LIST } from '../engine/archetypes';
import { createMatch, submitJoustPass, submitMeleeRound } from '../engine/match';
import { aiPickJoustChoice, aiPickMeleeAttack } from '../ai/basic-ai';
import { Phase } from '../engine/types';
import type { Attack, GiglingLoadout, PlayerLoadout, GiglingRarity, GearVariant } from '../engine/types';
import { createFullLoadout } from '../engine/gigling-gear';
import { createFullPlayerLoadout } from '../engine/player-gear';
import { BALANCE } from '../engine/balance-config';

// ============================================================
// Exported Types
// ============================================================

export interface MatchupResult {
  p1Archetype: string;
  p2Archetype: string;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  total: number;
  p1WinRate: number;
  unseats: number;
  unseatRate: number;
  joustWins: number;
  meleeWins: number;
  avgPassesPlayed: number;
  avgMeleeRounds: number;
}

export interface ArchetypeStats {
  archetype: string;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  totalMatches: number;
  overallWinRate: number;
  unseatsCaused: number;
  unseatsReceived: number;
  matchupWinRates: Record<string, number>;
}

export interface BalanceFlags {
  dominant: { archetype: string; winRate: number }[];
  weak: { archetype: string; winRate: number }[];
  matchupSkews: { p1: string; p2: string; winRate: number }[];
}

export interface PhaseBalance {
  joustDecided: number;
  joustDecidedPct: number;
  meleeDecided: number;
  meleeDecidedPct: number;
  avgPassesPerMatch: number;
  avgMeleeRoundsWhenMelee: number;
}

export interface MirrorMatch {
  archetype: string;
  p1WinRate: number;
  p2WinRate: number;
  drawRate: number;
}

export interface BalanceMetrics {
  overallSpreadPp: number;
  topArchetype: { archetype: string; winRate: number };
  bottomArchetype: { archetype: string; winRate: number };
}

export interface SimulationReport {
  metadata: {
    tier: string;
    variant: string | null;
    matchesPerMatchup: number;
    totalMatches: number;
    timestamp: string;
    elapsedMs: number;
    overrides?: Record<string, number>;
  };
  archetypeStats: ArchetypeStats[];
  matchups: MatchupResult[];
  balanceMetrics: BalanceMetrics;
  balanceFlags: BalanceFlags;
  phaseBalance: PhaseBalance;
  mirrorMatches: MirrorMatch[];
}

export interface SimConfig {
  tier: string;
  variant?: string;
  matchesPerMatchup?: number;
  overrides?: Record<string, number>;
}

// ============================================================
// Balance Config Overrides
// ============================================================

/**
 * Apply overrides to the BALANCE config object in-memory.
 * Supports dot notation for nested properties (e.g. "carryoverDivisors.momentum").
 * Returns the previous values so they can be restored.
 */
export function applyBalanceOverrides(overrides: Record<string, number>): Record<string, number> {
  const previous: Record<string, number> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const parts = key.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let target: any = BALANCE;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined) throw new Error(`Invalid override path: ${key}`);
      target = target[parts[i]];
    }
    const finalKey = parts[parts.length - 1];
    if (target[finalKey] === undefined) throw new Error(`Invalid override key: ${key} (property "${finalKey}" not found)`);
    previous[key] = target[finalKey];
    target[finalKey] = value;
  }
  return previous;
}

/** Restore previous balance config values (undo overrides). */
export function restoreBalanceOverrides(previous: Record<string, number>): void {
  applyBalanceOverrides(previous);
}

// ============================================================
// Internal Constants
// ============================================================

const MAX_MELEE_ROUNDS = 30;
const DEFAULT_MATCHES_PER_MATCHUP = 200;

const GEAR_MODES = ['bare', 'uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga', 'mixed'] as const;
type GearMode = typeof GEAR_MODES[number];

const ALL_RARITIES: GiglingRarity[] = ['uncommon', 'rare', 'epic', 'legendary', 'relic', 'giga'];

// ============================================================
// Internal Helpers
// ============================================================

function makeGear(mode: GearMode, variant?: GearVariant): { steed?: GiglingLoadout; player?: PlayerLoadout } {
  if (mode === 'bare') return {};
  if (mode === 'mixed') {
    const rarity = ALL_RARITIES[Math.floor(Math.random() * ALL_RARITIES.length)];
    return {
      steed: createFullLoadout(rarity, rarity, Math.random, variant),
      player: createFullPlayerLoadout(rarity, Math.random, variant),
    };
  }
  const rarity = mode as GiglingRarity;
  return {
    steed: createFullLoadout(rarity, rarity, Math.random, variant),
    player: createFullPlayerLoadout(rarity, Math.random, variant),
  };
}

function runSingleMatch(arch1Id: string, arch2Id: string, gearMode: GearMode, gearVariant?: GearVariant): {
  winner: 'player1' | 'player2' | 'draw';
  unseated: boolean;
  passesPlayed: number;
  meleeRounds: number;
  winReason: string;
} {
  const arch1 = ARCHETYPES[arch1Id];
  const arch2 = ARCHETYPES[arch2Id];

  const gear1 = makeGear(gearMode, gearVariant);
  const gear2 = makeGear(gearMode, gearVariant);

  let state = createMatch(arch1, arch2, gear1.steed, gear2.steed, gear1.player, gear2.player);

  let lastP1Attack: Attack | undefined;
  let lastP2Attack: Attack | undefined;
  let passesPlayed = 0;
  let meleeRounds = 0;
  let unseated = false;

  let iterations = 0;
  const MAX_ITERATIONS = 100;

  while (state.phase !== Phase.MatchEnd && iterations < MAX_ITERATIONS) {
    iterations++;

    if (state.phase === Phase.SpeedSelect || state.phase === Phase.AttackSelect) {
      const p1Choice = aiPickJoustChoice(state.player1, lastP2Attack, undefined, 'medium');
      const p2Choice = aiPickJoustChoice(state.player2, lastP1Attack, undefined, 'medium');

      lastP1Attack = p1Choice.attack;
      lastP2Attack = p2Choice.attack;
      passesPlayed++;

      state = submitJoustPass(state, p1Choice, p2Choice);

      const lastPass = state.passResults[state.passResults.length - 1];
      if (lastPass && lastPass.unseat !== 'none') {
        unseated = true;
      }
    } else if (state.phase === Phase.MeleeSelect) {
      if (meleeRounds >= MAX_MELEE_ROUNDS) break;

      const lastMeleeP1 = state.meleeRoundResults.length > 0
        ? state.meleeRoundResults[state.meleeRoundResults.length - 1].player2Attack
        : undefined;
      const lastMeleeP2 = state.meleeRoundResults.length > 0
        ? state.meleeRoundResults[state.meleeRoundResults.length - 1].player1Attack
        : undefined;

      const p1MeleeAtk = aiPickMeleeAttack(state.player1, lastMeleeP1, 'medium');
      const p2MeleeAtk = aiPickMeleeAttack(state.player2, lastMeleeP2, 'medium');

      meleeRounds++;
      state = submitMeleeRound(state, p1MeleeAtk, p2MeleeAtk);
    } else {
      break;
    }
  }

  return {
    winner: state.winner === 'none' ? 'draw' : state.winner as 'player1' | 'player2' | 'draw',
    unseated,
    passesPlayed,
    meleeRounds,
    winReason: state.winReason,
  };
}

function runAllMatchups(gearMode: GearMode, gearVariant?: GearVariant, matchesPerMatchup = DEFAULT_MATCHES_PER_MATCHUP): {
  matchups: MatchupResult[];
  archetypeStats: ArchetypeStats[];
} {
  const archIds = ARCHETYPE_LIST.map(a => a.id);
  const matchups: MatchupResult[] = [];
  const statsMap: Record<string, ArchetypeStats> = {};

  for (const id of archIds) {
    statsMap[id] = {
      archetype: id,
      totalWins: 0,
      totalLosses: 0,
      totalDraws: 0,
      totalMatches: 0,
      overallWinRate: 0,
      unseatsCaused: 0,
      unseatsReceived: 0,
      matchupWinRates: {},
    };
  }

  for (const a1 of archIds) {
    for (const a2 of archIds) {
      let p1Wins = 0, p2Wins = 0, draws = 0;
      let unseats = 0, joustWins = 0, meleeWins = 0;
      let totalPasses = 0, totalMeleeRounds = 0;

      for (let i = 0; i < matchesPerMatchup; i++) {
        const result = runSingleMatch(a1, a2, gearMode, gearVariant);

        if (result.winner === 'player1') p1Wins++;
        else if (result.winner === 'player2') p2Wins++;
        else draws++;

        if (result.unseated) {
          unseats++;
          meleeWins++;
        } else if (result.meleeRounds > 0) {
          meleeWins++;
        } else {
          joustWins++;
        }

        totalPasses += result.passesPlayed;
        totalMeleeRounds += result.meleeRounds;
      }

      const total = matchesPerMatchup;
      const matchup: MatchupResult = {
        p1Archetype: a1,
        p2Archetype: a2,
        p1Wins,
        p2Wins,
        draws,
        total,
        p1WinRate: p1Wins / total,
        unseats,
        unseatRate: unseats / total,
        joustWins,
        meleeWins,
        avgPassesPlayed: totalPasses / total,
        avgMeleeRounds: totalMeleeRounds / total,
      };
      matchups.push(matchup);

      statsMap[a1].totalWins += p1Wins;
      statsMap[a1].totalLosses += p2Wins;
      statsMap[a1].totalDraws += draws;
      statsMap[a1].totalMatches += total;
      statsMap[a1].unseatsCaused += unseats;
      statsMap[a1].matchupWinRates[a2] = p1Wins / total;

      statsMap[a2].totalWins += p2Wins;
      statsMap[a2].totalLosses += p1Wins;
      statsMap[a2].totalDraws += draws;
      statsMap[a2].totalMatches += total;
      statsMap[a2].unseatsReceived += unseats;
    }
  }

  for (const id of archIds) {
    const s = statsMap[id];
    s.overallWinRate = s.totalWins / s.totalMatches;
  }

  return {
    matchups,
    archetypeStats: archIds.map(id => statsMap[id]),
  };
}

// ============================================================
// Balance Metrics Computation
// ============================================================

function computeBalanceMetrics(stats: ArchetypeStats[]): BalanceMetrics {
  const sorted = [...stats].sort((a, b) => b.overallWinRate - a.overallWinRate);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  return {
    overallSpreadPp: Math.round((top.overallWinRate - bottom.overallWinRate) * 1000) / 10,
    topArchetype: { archetype: top.archetype, winRate: Math.round(top.overallWinRate * 1000) / 10 },
    bottomArchetype: { archetype: bottom.archetype, winRate: Math.round(bottom.overallWinRate * 1000) / 10 },
  };
}

function computeBalanceFlags(stats: ArchetypeStats[], matchups: MatchupResult[]): BalanceFlags {
  const flags: BalanceFlags = { dominant: [], weak: [], matchupSkews: [] };

  for (const s of stats) {
    if (s.overallWinRate > 0.55) {
      flags.dominant.push({ archetype: s.archetype, winRate: Math.round(s.overallWinRate * 1000) / 10 });
    }
    if (s.overallWinRate < 0.45) {
      flags.weak.push({ archetype: s.archetype, winRate: Math.round(s.overallWinRate * 1000) / 10 });
    }
  }

  for (const m of matchups) {
    if (m.p1Archetype !== m.p2Archetype && m.p1WinRate > 0.65) {
      flags.matchupSkews.push({ p1: m.p1Archetype, p2: m.p2Archetype, winRate: Math.round(m.p1WinRate * 1000) / 10 });
    }
  }

  return flags;
}

function computePhaseBalance(matchups: MatchupResult[]): PhaseBalance {
  let totalJoustWins = 0, totalMeleeWins = 0;
  let totalPasses = 0, totalMeleeRounds = 0, totalMatches = 0;

  for (const m of matchups) {
    totalJoustWins += m.joustWins;
    totalMeleeWins += m.meleeWins;
    totalPasses += m.avgPassesPlayed * m.total;
    totalMeleeRounds += m.avgMeleeRounds * m.total;
    totalMatches += m.total;
  }

  return {
    joustDecided: totalJoustWins,
    joustDecidedPct: Math.round(totalJoustWins / totalMatches * 1000) / 10,
    meleeDecided: totalMeleeWins,
    meleeDecidedPct: Math.round(totalMeleeWins / totalMatches * 1000) / 10,
    avgPassesPerMatch: Math.round(totalPasses / totalMatches * 100) / 100,
    avgMeleeRoundsWhenMelee: totalMeleeWins > 0 ? Math.round(totalMeleeRounds / totalMeleeWins * 100) / 100 : 0,
  };
}

function computeMirrorMatches(matchups: MatchupResult[]): MirrorMatch[] {
  return matchups
    .filter(m => m.p1Archetype === m.p2Archetype)
    .map(m => ({
      archetype: m.p1Archetype,
      p1WinRate: Math.round(m.p1WinRate * 1000) / 10,
      p2WinRate: Math.round((m.p2Wins / m.total) * 1000) / 10,
      drawRate: Math.round((m.draws / m.total) * 1000) / 10,
    }));
}

// ============================================================
// Exported: runSimulation()
// ============================================================

export function runSimulation(config: SimConfig): SimulationReport {
  const tier = config.tier || 'bare';
  const variant = config.variant as GearVariant | undefined;
  const matchesPerMatchup = config.matchesPerMatchup || DEFAULT_MATCHES_PER_MATCHUP;
  const gearMode = (GEAR_MODES.includes(tier as GearMode) ? tier : 'bare') as GearMode;

  // Apply balance config overrides (restored after sim)
  let previous: Record<string, number> | undefined;
  if (config.overrides && Object.keys(config.overrides).length > 0) {
    previous = applyBalanceOverrides(config.overrides);
  }

  const startTime = Date.now();
  const { matchups, archetypeStats } = runAllMatchups(gearMode, variant, matchesPerMatchup);
  const elapsedMs = Date.now() - startTime;

  // Restore original config
  if (previous) {
    restoreBalanceOverrides(previous);
  }

  return {
    metadata: {
      tier: gearMode,
      variant: variant || null,
      matchesPerMatchup,
      totalMatches: matchups.length * matchesPerMatchup,
      timestamp: new Date().toISOString(),
      elapsedMs,
      ...(config.overrides && Object.keys(config.overrides).length > 0 ? { overrides: config.overrides } : {}),
    },
    archetypeStats,
    matchups,
    balanceMetrics: computeBalanceMetrics(archetypeStats),
    balanceFlags: computeBalanceFlags(archetypeStats, matchups),
    phaseBalance: computePhaseBalance(matchups),
    mirrorMatches: computeMirrorMatches(matchups),
  };
}

// ============================================================
// Text Output (backwards-compatible)
// ============================================================

function printResults(report: SimulationReport): string {
  const { matchups, archetypeStats: stats, metadata } = report;
  const lines: string[] = [];

  lines.push('='.repeat(70));
  lines.push('JOUSTING MVP — BALANCE SIMULATION REPORT');
  const variantLabel = metadata.variant ? `, variant: ${metadata.variant}` : '';
  const modeLabel = metadata.tier === 'bare' ? ' (no gear)' : metadata.tier === 'mixed' ? ' (random rarity per match)' : ` (both players at ${metadata.tier} rarity)`;
  lines.push(`Gear mode: ${metadata.tier}${modeLabel}${variantLabel}`);
  lines.push(`Matches per matchup: ${metadata.matchesPerMatchup}`);
  lines.push(`Total matches: ${metadata.totalMatches}`);
  lines.push('='.repeat(70));
  lines.push('');

  // Overall win rates
  lines.push('--- OVERALL ARCHETYPE WIN RATES ---');
  const sorted = [...stats].sort((a, b) => b.overallWinRate - a.overallWinRate);
  for (const s of sorted) {
    const pct = (s.overallWinRate * 100).toFixed(1);
    const bar = '#'.repeat(Math.round(s.overallWinRate * 50));
    lines.push(`  ${s.archetype.padEnd(12)} ${pct.padStart(5)}%  ${bar}  (W:${s.totalWins} L:${s.totalLosses} D:${s.totalDraws})`);
  }
  lines.push('');

  // Win rate matrix
  lines.push('--- WIN RATE MATRIX (P1 row vs P2 column) ---');
  const archIds = stats.map(s => s.archetype);
  const header = '             ' + archIds.map(id => id.slice(0, 6).padStart(7)).join('');
  lines.push(header);
  for (const a1 of archIds) {
    const row = archIds.map(a2 => {
      const m = matchups.find(m => m.p1Archetype === a1 && m.p2Archetype === a2);
      return m ? (m.p1WinRate * 100).toFixed(0).padStart(7) : '   N/A';
    }).join('');
    lines.push(`  ${a1.padEnd(12)}${row}`);
  }
  lines.push('  (values are P1 win % as that archetype)');
  lines.push('');

  // Unseat stats
  lines.push('--- UNSEAT STATISTICS ---');
  for (const s of sorted) {
    lines.push(`  ${s.archetype.padEnd(12)} caused: ${s.unseatsCaused.toString().padStart(4)}, received: ${s.unseatsReceived.toString().padStart(4)}`);
  }
  lines.push('');

  // Phase balance
  const pb = report.phaseBalance;
  lines.push('--- PHASE BALANCE ---');
  lines.push(`  Matches decided by joust score (no unseat): ${pb.joustDecided} (${pb.joustDecidedPct}%)`);
  lines.push(`  Matches that went to melee (unseat or tie): ${pb.meleeDecided} (${pb.meleeDecidedPct}%)`);
  lines.push(`  Average passes per match: ${pb.avgPassesPerMatch}`);
  lines.push(`  Average melee rounds (when melee occurs): ${pb.avgMeleeRoundsWhenMelee || 'N/A'}`);
  lines.push('');

  // Mirror matches
  lines.push('--- MIRROR MATCH BALANCE (should be ~50%) ---');
  for (const mm of report.mirrorMatches) {
    lines.push(`  ${mm.archetype.padEnd(12)} P1: ${mm.p1WinRate}%  P2: ${mm.p2WinRate}%  Draw: ${mm.drawRate}%`);
  }
  lines.push('');

  // Balance flags
  lines.push('--- BALANCE FLAGS ---');
  const flags = report.balanceFlags;
  let flagged = false;
  for (const d of flags.dominant) {
    lines.push(`  ⚠ DOMINANT: ${d.archetype} (${d.winRate}% win rate > 55%)`);
    flagged = true;
  }
  for (const w of flags.weak) {
    lines.push(`  ⚠ WEAK: ${w.archetype} (${w.winRate}% win rate < 45%)`);
    flagged = true;
  }
  for (const sk of flags.matchupSkews) {
    lines.push(`  ⚠ MATCHUP SKEW: ${sk.p1} vs ${sk.p2} = ${sk.winRate}% P1 win rate`);
    flagged = true;
  }
  if (!flagged) {
    lines.push('  ✓ No major balance flags detected');
  }
  lines.push('');

  // Dominant strategy check
  lines.push('--- DOMINANT STRATEGY CHECK ---');
  lines.push('  (Checked via matchup variance — high variance = healthy rock-paper-scissors)');
  for (const s of sorted) {
    const rates = Object.values(s.matchupWinRates);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const spread = max - min;
    lines.push(`  ${s.archetype.padEnd(12)} matchup spread: ${(min * 100).toFixed(0)}%-${(max * 100).toFixed(0)}% (range: ${(spread * 100).toFixed(0)}pp)`);
  }
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// CLI Entry Point
// ============================================================

const IS_CLI = process.argv[1]?.replace(/\\/g, '/').includes('simulate');

if (IS_CLI) {
  const JSON_FLAG = process.argv.includes('--json');

  // Parse gear mode (first non-flag arg after script name)
  const GEAR_VARIANTS_LIST = ['aggressive', 'balanced', 'defensive'] as const;
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const gearArg = args[0] as GearMode | undefined;
  const gearMode: GearMode = gearArg && GEAR_MODES.includes(gearArg) ? gearArg : 'bare';
  const variantArg = args[1] as GearVariant | undefined;
  const gearVariant: GearVariant | undefined = variantArg && GEAR_VARIANTS_LIST.includes(variantArg) ? variantArg : undefined;

  // Parse --override key=value flags
  const overrides: Record<string, number> = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--override' && i + 1 < process.argv.length) {
      const pair = process.argv[i + 1];
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx);
        const val = parseFloat(pair.slice(eqIdx + 1));
        if (!isNaN(val)) {
          overrides[key] = val;
        } else {
          console.error(`Warning: ignoring non-numeric override value for "${key}"`);
        }
      }
      i++; // skip value arg
    }
  }

  const hasOverrides = Object.keys(overrides).length > 0;
  if (hasOverrides) {
    console.error(`Overrides: ${Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }

  console.error(`Running simulations (gear mode: ${gearMode})...`);

  const report = runSimulation({ tier: gearMode, variant: gearVariant, overrides: hasOverrides ? overrides : undefined });

  if (JSON_FLAG) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(printResults(report));
  }

  console.error(`Completed in ${(report.metadata.elapsedMs / 1000).toFixed(1)}s`);
}
