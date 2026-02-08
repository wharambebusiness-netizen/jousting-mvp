// ============================================================
// Jousting MVP — Balance Simulation Tool
// ============================================================
// Runs AI vs AI matches across all archetype matchups to gather
// win rate, unseat rate, and phase balance statistics.
// Usage: npx tsx src/tools/simulate.ts
// ============================================================
import { ARCHETYPES, ARCHETYPE_LIST } from '../engine/archetypes';
import { createMatch, submitJoustPass, submitMeleeRound } from '../engine/match';
import { aiPickJoustChoice, aiPickMeleeAttack } from '../ai/basic-ai';
import { JOUST_ATTACK_LIST, MELEE_ATTACK_LIST } from '../engine/attacks';
import { Phase } from '../engine/types';
import type { Attack, MatchState, PassChoice } from '../engine/types';

// --- Configuration ---
const MATCHES_PER_MATCHUP = 200;
const MAX_MELEE_ROUNDS = 30; // safety cap to prevent infinite loops

// --- Types ---
interface MatchupResult {
  p1Archetype: string;
  p2Archetype: string;
  p1Wins: number;
  p2Wins: number;
  draws: number;
  total: number;
  p1WinRate: number;
  unseats: number;
  unseatRate: number;
  joustWins: number;   // matches decided by joust score (no unseat, 5 passes)
  meleeWins: number;   // matches that went to melee
  avgPassesPlayed: number;
  avgMeleeRounds: number;
}

interface ArchetypeStats {
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

// --- Run a single match (AI vs AI, medium difficulty) ---
function runSingleMatch(arch1Id: string, arch2Id: string): {
  winner: 'player1' | 'player2' | 'draw';
  unseated: boolean;
  passesPlayed: number;
  meleeRounds: number;
  winReason: string;
} {
  const arch1 = ARCHETYPES[arch1Id];
  const arch2 = ARCHETYPES[arch2Id];
  let state = createMatch(arch1, arch2);

  let lastP1Attack: Attack | undefined;
  let lastP2Attack: Attack | undefined;
  let passesPlayed = 0;
  let meleeRounds = 0;
  let unseated = false;

  // Safety counter
  let iterations = 0;
  const MAX_ITERATIONS = 100;

  while (state.phase !== Phase.MatchEnd && iterations < MAX_ITERATIONS) {
    iterations++;

    if (state.phase === Phase.SpeedSelect || state.phase === Phase.AttackSelect) {
      // Joust pass
      const p1Choice = aiPickJoustChoice(state.player1, lastP2Attack, undefined, 'medium');
      const p2Choice = aiPickJoustChoice(state.player2, lastP1Attack, undefined, 'medium');

      lastP1Attack = p1Choice.attack;
      lastP2Attack = p2Choice.attack;
      passesPlayed++;

      state = submitJoustPass(state, p1Choice, p2Choice);

      // Check if unseat happened
      const lastPass = state.passResults[state.passResults.length - 1];
      if (lastPass && lastPass.unseat !== 'none') {
        unseated = true;
      }
    } else if (state.phase === Phase.MeleeSelect) {
      // Melee round
      if (meleeRounds >= MAX_MELEE_ROUNDS) {
        // Force end - shouldn't happen but safety
        break;
      }

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
      // Unknown phase, break
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

// --- Run all matchups ---
function runAllMatchups(): { matchups: MatchupResult[]; archetypeStats: ArchetypeStats[] } {
  const archIds = ARCHETYPE_LIST.map(a => a.id);
  const matchups: MatchupResult[] = [];
  const statsMap: Record<string, ArchetypeStats> = {};

  // Initialize archetype stats
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

      for (let i = 0; i < MATCHES_PER_MATCHUP; i++) {
        const result = runSingleMatch(a1, a2);

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

      const total = MATCHES_PER_MATCHUP;
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

      // Update archetype stats
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
      // Note: p2 matchup win rate against a1 recorded when a2 is in p1 position
    }
  }

  // Compute overall win rates
  for (const id of archIds) {
    const s = statsMap[id];
    s.overallWinRate = s.totalWins / s.totalMatches;
  }

  return {
    matchups,
    archetypeStats: archIds.map(id => statsMap[id]),
  };
}

// --- Format and print results ---
function printResults(matchups: MatchupResult[], stats: ArchetypeStats[]): string {
  const lines: string[] = [];

  lines.push('='.repeat(70));
  lines.push('JOUSTING MVP — BALANCE SIMULATION REPORT');
  lines.push(`Matches per matchup: ${MATCHES_PER_MATCHUP}`);
  lines.push(`Total matches: ${matchups.length * MATCHES_PER_MATCHUP}`);
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

  // Win rate matrix (P1 as row, P2 as column)
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

  // Unseat rates
  lines.push('--- UNSEAT STATISTICS ---');
  for (const s of sorted) {
    lines.push(`  ${s.archetype.padEnd(12)} caused: ${s.unseatsCaused.toString().padStart(4)}, received: ${s.unseatsReceived.toString().padStart(4)}`);
  }
  lines.push('');

  // Phase balance
  let totalJoustWins = 0, totalMeleeWins = 0;
  let totalPasses = 0, totalMeleeRounds = 0, totalMatches = 0;
  for (const m of matchups) {
    totalJoustWins += m.joustWins;
    totalMeleeWins += m.meleeWins;
    totalPasses += m.avgPassesPlayed * m.total;
    totalMeleeRounds += m.avgMeleeRounds * m.total;
    totalMatches += m.total;
  }
  lines.push('--- PHASE BALANCE ---');
  lines.push(`  Matches decided by joust score (no unseat): ${totalJoustWins} (${(totalJoustWins / totalMatches * 100).toFixed(1)}%)`);
  lines.push(`  Matches that went to melee (unseat or tie): ${totalMeleeWins} (${(totalMeleeWins / totalMatches * 100).toFixed(1)}%)`);
  lines.push(`  Average passes per match: ${(totalPasses / totalMatches).toFixed(2)}`);
  lines.push(`  Average melee rounds (when melee occurs): ${totalMeleeWins > 0 ? (totalMeleeRounds / totalMeleeWins).toFixed(2) : 'N/A'}`);
  lines.push('');

  // Mirror match analysis
  lines.push('--- MIRROR MATCH BALANCE (should be ~50%) ---');
  for (const id of archIds) {
    const m = matchups.find(m => m.p1Archetype === id && m.p2Archetype === id);
    if (m) {
      lines.push(`  ${id.padEnd(12)} P1: ${(m.p1WinRate * 100).toFixed(1)}%  P2: ${((m.p2Wins / m.total) * 100).toFixed(1)}%  Draw: ${((m.draws / m.total) * 100).toFixed(1)}%`);
    }
  }
  lines.push('');

  // Dominant/weak detection
  lines.push('--- BALANCE FLAGS ---');
  let flagged = false;
  for (const s of sorted) {
    if (s.overallWinRate > 0.55) {
      lines.push(`  ⚠ DOMINANT: ${s.archetype} (${(s.overallWinRate * 100).toFixed(1)}% win rate > 55%)`);
      flagged = true;
    }
    if (s.overallWinRate < 0.45) {
      lines.push(`  ⚠ WEAK: ${s.archetype} (${(s.overallWinRate * 100).toFixed(1)}% win rate < 45%)`);
      flagged = true;
    }
  }

  // Check for specific matchup imbalances (> 65% win rate in non-mirror)
  for (const m of matchups) {
    if (m.p1Archetype !== m.p2Archetype && m.p1WinRate > 0.65) {
      lines.push(`  ⚠ MATCHUP SKEW: ${m.p1Archetype} vs ${m.p2Archetype} = ${(m.p1WinRate * 100).toFixed(1)}% P1 win rate`);
      flagged = true;
    }
  }

  if (!flagged) {
    lines.push('  ✓ No major balance flags detected');
  }
  lines.push('');

  // Speed/attack usage analysis
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

// --- Main ---
console.log('Running simulations...');
const startTime = Date.now();
const { matchups, archetypeStats } = runAllMatchups();
const elapsed = Date.now() - startTime;
const report = printResults(matchups, archetypeStats);
console.log(report);
console.log(`Completed in ${(elapsed / 1000).toFixed(1)}s`);
