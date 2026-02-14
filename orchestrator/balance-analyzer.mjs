// ============================================================
// Balance Analyzer Module — extracted from orchestrator.mjs v22
// Handles: balance sims, state tracking, experiment logging,
// regression detection, convergence, context building, backlog gen,
// parameter search integration.
// ============================================================

import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

// Module-level dependencies (set via init)
let log, CONFIG, MVP_DIR, ORCH_DIR, BALANCE_DATA_DIR;
let BACKLOG_ARCHIVE_FILE;
let loadBacklog, saveBacklog;

const BALANCE_STATE_FILE_NAME = 'balance-state.json';
const EXPERIMENT_LOG_FILE_NAME = 'experiment-log.json';
let BALANCE_STATE_FILE;
let EXPERIMENT_LOG_FILE;

// Cached parameter search results for prompt injection
let paramSearchResults = null;

/**
 * Initialize the balance analyzer with orchestrator context.
 * Must be called before any other function.
 */
export function initBalanceAnalyzer(ctx) {
  log = ctx.log;
  CONFIG = ctx.CONFIG;
  MVP_DIR = ctx.MVP_DIR;
  ORCH_DIR = ctx.ORCH_DIR;
  BALANCE_DATA_DIR = ctx.BALANCE_DATA_DIR;
  BACKLOG_ARCHIVE_FILE = ctx.BACKLOG_ARCHIVE_FILE;
  loadBacklog = ctx.loadBacklog;
  saveBacklog = ctx.saveBacklog;
  BALANCE_STATE_FILE = join(ORCH_DIR, BALANCE_STATE_FILE_NAME);
  EXPERIMENT_LOG_FILE = join(ORCH_DIR, EXPERIMENT_LOG_FILE_NAME);
}

/** Get cached parameter search results. */
export function getParamSearchResults() {
  return paramSearchResults;
}

/** Set cached parameter search results. */
export function setParamSearchResults(results) {
  paramSearchResults = results;
}

// ============================================================
// Balance Simulation Runner
// ============================================================

/**
 * Run a single balance simulation and return parsed JSON.
 */
export function runBalanceSim(tier, variant, timeoutMs = 60000) {
  return new Promise((resolvePromise) => {
    const startTime = Date.now();
    const args = ['tsx', 'src/tools/simulate.ts', tier];
    if (variant) args.push(variant);
    args.push('--json');

    const proc = spawn('npx', args, {
      cwd: MVP_DIR,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch (_) {}
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startTime;

      if (timedOut) {
        resolvePromise({ success: false, data: null, error: `Sim timed out after ${timeoutMs}ms`, elapsedMs });
        return;
      }

      if (code !== 0) {
        resolvePromise({ success: false, data: null, error: `Sim exited with code ${code}: ${stderr.slice(0, 200)}`, elapsedMs });
        return;
      }

      try {
        const data = JSON.parse(stdout);
        resolvePromise({ success: true, data, error: null, elapsedMs });
      } catch (parseErr) {
        resolvePromise({ success: false, data: null, error: `JSON parse error: ${parseErr.message}`, elapsedMs });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ success: false, data: null, error: `Spawn error: ${err.message}`, elapsedMs: Date.now() - startTime });
    });
  });
}

/**
 * Run all configured balance sims and save results.
 */
export async function runBalanceSims(round, phase) {
  const bc = CONFIG.balanceConfig;
  if (!bc || !bc.sims?.length) return { results: [], allSucceeded: true, elapsedMs: 0 };

  mkdirSync(BALANCE_DATA_DIR, { recursive: true });

  const timeoutMs = bc.simTimeoutMs || 60000;
  const results = [];
  const simStartMs = Date.now();

  log(`  Balance sims (${phase}): running ${bc.sims.length} sim(s)...`);

  for (const sim of bc.sims) {
    const tier = sim.tier || 'bare';
    const variant = sim.variant || null;
    const label = `${tier}${variant ? '/' + variant : ''}`;

    const result = await runBalanceSim(tier, variant, timeoutMs);

    if (result.success) {
      const filename = `round-${round}-${phase}-${tier}${variant ? '-' + variant : ''}.json`;
      const filepath = join(BALANCE_DATA_DIR, filename);
      writeFileSync(filepath, JSON.stringify(result.data, null, 2));

      const spread = result.data.balanceMetrics?.overallSpreadPp ?? '?';
      const top = result.data.balanceMetrics?.topArchetype?.archetype ?? '?';
      const bottom = result.data.balanceMetrics?.bottomArchetype?.archetype ?? '?';
      log(`    ${label}: spread=${spread}pp (${top} → ${bottom}) [${result.elapsedMs}ms]`);
    } else {
      log(`    ${label}: FAILED — ${result.error}`);
    }

    results.push({ tier, variant, phase, ...result });
  }

  const allSucceeded = results.every(r => r.success);
  const elapsedMs = Date.now() - simStartMs;
  return { results, allSucceeded, elapsedMs };
}

// ============================================================
// Balance State Tracker
// ============================================================

export function loadBalanceState() {
  if (!existsSync(BALANCE_STATE_FILE)) return { rounds: [] };
  try { return JSON.parse(readFileSync(BALANCE_STATE_FILE, 'utf-8')); }
  catch (_) { return { rounds: [] }; }
}

export function saveBalanceState(state) {
  writeFileSync(BALANCE_STATE_FILE, JSON.stringify(state, null, 2));
}

export function updateBalanceState(round, preResults, postResults) {
  const state = loadBalanceState();

  const simResults = postResults?.length ? postResults : preResults || [];
  if (!simResults.length) return;

  const tiers = {};
  for (const r of simResults) {
    if (!r.success || !r.data) continue;
    const key = `${r.tier}${r.variant ? '/' + r.variant : ''}`;
    const bm = r.data.balanceMetrics;
    const stats = r.data.archetypeStats;

    tiers[key] = {
      tier: r.tier,
      variant: r.variant || null,
      spreadPp: bm.overallSpreadPp,
      topArchetype: bm.topArchetype,
      bottomArchetype: bm.bottomArchetype,
      archetypeWinRates: Object.fromEntries(stats.map(s => [s.archetype, Math.round(s.overallWinRate * 1000) / 10])),
      flagCount: (r.data.balanceFlags.dominant?.length || 0) + (r.data.balanceFlags.weak?.length || 0) + (r.data.balanceFlags.matchupSkews?.length || 0),
    };
  }

  const deltas = {};
  if (preResults?.length && postResults?.length) {
    for (const post of postResults) {
      if (!post.success || !post.data) continue;
      const key = `${post.tier}${post.variant ? '/' + post.variant : ''}`;
      const pre = preResults.find(p => p.tier === post.tier && p.variant === post.variant);
      if (!pre?.success || !pre?.data) continue;

      const preSpread = pre.data.balanceMetrics.overallSpreadPp;
      const postSpread = post.data.balanceMetrics.overallSpreadPp;
      const spreadDelta = Math.round((postSpread - preSpread) * 10) / 10;

      const archDeltas = {};
      for (const postStat of post.data.archetypeStats) {
        const preStat = pre.data.archetypeStats.find(s => s.archetype === postStat.archetype);
        if (preStat) {
          archDeltas[postStat.archetype] = Math.round((postStat.overallWinRate - preStat.overallWinRate) * 1000) / 10;
        }
      }

      deltas[key] = { spreadDelta, archetypeDeltas: archDeltas };
    }
  }

  state.rounds.push({
    round,
    timestamp: new Date().toISOString(),
    tiers,
    deltas: Object.keys(deltas).length ? deltas : null,
  });

  saveBalanceState(state);

  for (const [key, t] of Object.entries(tiers)) {
    const delta = deltas[key];
    const deltaStr = delta ? ` (Δ spread: ${delta.spreadDelta > 0 ? '+' : ''}${delta.spreadDelta}pp)` : '';
    log(`  Balance state [${key}]: spread=${t.spreadPp}pp, ${t.topArchetype.archetype} ${t.topArchetype.winRate}% → ${t.bottomArchetype.archetype} ${t.bottomArchetype.winRate}%${deltaStr}`);
  }
}

// ============================================================
// Experiment Log
// ============================================================

export function loadExperimentLog() {
  if (!existsSync(EXPERIMENT_LOG_FILE)) return [];
  try { return JSON.parse(readFileSync(EXPERIMENT_LOG_FILE, 'utf-8')); }
  catch (_) { return []; }
}

export function saveExperimentLog(entries) {
  writeFileSync(EXPERIMENT_LOG_FILE, JSON.stringify(entries, null, 2));
}

export function parseBalanceConfigDiff(round) {
  const tag = `round-${round}-start`;
  try {
    const diff = execSync(`git diff ${tag} -- src/engine/balance-config.ts`, {
      cwd: MVP_DIR,
      encoding: 'utf-8',
      timeout: 5000,
    });
    if (!diff.trim()) return [];

    const changes = [];
    const lines = diff.split('\n');
    for (const line of lines) {
      if (line.startsWith('-') && !line.startsWith('---')) {
        const keyMatch = line.match(/^\-\s*(\w+)\s*:\s*([\d.]+)/);
        if (keyMatch) {
          const [, key, fromVal] = keyMatch;
          const addLine = lines.find(l =>
            l.startsWith('+') && !l.startsWith('+++') &&
            l.match(new RegExp(`^\\+\\s*${key}\\s*:\\s*[\\d.]+`))
          );
          if (addLine) {
            const toMatch = addLine.match(new RegExp(`^\\+\\s*${key}\\s*:\\s*([\\d.]+)`));
            if (toMatch && toMatch[1] !== fromVal) {
              changes.push({ key, from: parseFloat(fromVal), to: parseFloat(toMatch[1]) });
            }
          }
        }
      }
    }
    return changes;
  } catch (err) {
    log(`  Experiment log: git diff failed — ${err.message}`);
    return [];
  }
}

export function logExperiment(round, agentId, paramChanges, preSimResults, postSimResults) {
  if (!paramChanges.length) return;

  const entries = loadExperimentLog();

  const outcome = {};
  if (preSimResults?.length && postSimResults?.length) {
    outcome.tierSpreads = {};
    outcome.tierDeltas = {};
    for (const post of postSimResults) {
      if (!post.success || !post.data) continue;
      const key = `${post.tier}${post.variant ? '/' + post.variant : ''}`;
      const postSpread = post.data.balanceMetrics?.overallSpreadPp;
      outcome.tierSpreads[key] = postSpread;

      const pre = preSimResults.find(p => p.tier === post.tier && p.variant === post.variant);
      if (pre?.success && pre.data) {
        const preSpread = pre.data.balanceMetrics?.overallSpreadPp;
        outcome.tierDeltas[key] = Math.round((postSpread - preSpread) * 10) / 10;
      }
    }
  }

  const entry = {
    round,
    agentId,
    timestamp: new Date().toISOString(),
    params: paramChanges,
    outcome,
  };

  entries.push(entry);

  if (entries.length > 50) entries.splice(0, entries.length - 50);

  saveExperimentLog(entries);

  const paramStr = paramChanges.map(p => `${p.key}: ${p.from}→${p.to}`).join(', ');
  const deltaStr = Object.entries(outcome.tierDeltas || {})
    .map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}pp`)
    .join(', ');
  log(`  Experiment logged: ${paramStr} → ${deltaStr || 'no sim data'}`);
}

export function buildExperimentContext() {
  const entries = loadExperimentLog();
  if (!entries.length) return null;

  const recent = entries.slice(-10).reverse();
  const lines = [`Recent experiments (${recent.length} of ${entries.length} total):`];

  for (const e of recent) {
    const paramStr = e.params.map(p => `${p.key}: ${p.from}→${p.to}`).join(', ');
    const deltaStr = Object.entries(e.outcome?.tierDeltas || {})
      .map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}pp`)
      .join(', ');
    const improved = Object.values(e.outcome?.tierDeltas || {}).every(d => d <= 0);
    const worsened = Object.values(e.outcome?.tierDeltas || {}).some(d => d > 1);
    const verdict = worsened ? 'WORSENED' : improved ? 'IMPROVED' : 'MIXED';
    lines.push(`  Round ${e.round} (${e.agentId}): ${paramStr} → ${deltaStr || 'no data'} [${verdict}]`);
  }

  lines.push(`Avoid repeating WORSENED experiments. Build on IMPROVED ones.`);
  return lines.join('\n');
}

// ============================================================
// Balance Regression Detection
// ============================================================

export function detectBalanceRegressions(round, preResults, postResults) {
  const result = { regressions: [], spreadChanges: [], hasRegressions: false };
  if (!preResults?.length || !postResults?.length) return result;

  const bc = CONFIG.balanceConfig || {};
  const regressionThresholdPp = bc.regressionThresholdPp ?? 3.0;

  for (const post of postResults) {
    if (!post.success || !post.data) continue;
    const pre = preResults.find(p => p.tier === post.tier && p.variant === post.variant && p.success);
    if (!pre?.data) continue;

    const tierKey = `${post.tier}${post.variant ? '/' + post.variant : ''}`;
    const preSpread = pre.data.balanceMetrics.overallSpreadPp;
    const postSpread = post.data.balanceMetrics.overallSpreadPp;
    const spreadDelta = Math.round((postSpread - preSpread) * 10) / 10;

    result.spreadChanges.push({ tier: tierKey, preSpread, postSpread, delta: spreadDelta });

    const winners = [];
    const losers = [];

    for (const postStat of post.data.archetypeStats) {
      const preStat = pre.data.archetypeStats.find(s => s.archetype === postStat.archetype);
      if (!preStat) continue;

      const deltaPp = Math.round((postStat.overallWinRate - preStat.overallWinRate) * 1000) / 10;
      if (deltaPp > regressionThresholdPp) {
        winners.push({ archetype: postStat.archetype, delta: deltaPp });
      } else if (deltaPp < -regressionThresholdPp) {
        losers.push({ archetype: postStat.archetype, delta: deltaPp });
      }
    }

    if (winners.length > 0 && losers.length > 0) {
      result.regressions.push({ tier: tierKey, winners, losers, spreadDelta });
      result.hasRegressions = true;
    }

    if (spreadDelta > regressionThresholdPp) {
      result.regressions.push({
        tier: tierKey,
        type: 'spread_increase',
        spreadDelta,
        message: `Spread increased by ${spreadDelta}pp (${preSpread} -> ${postSpread})`,
      });
      result.hasRegressions = true;
    }
  }

  if (result.hasRegressions) {
    log(`  ⚠ BALANCE REGRESSIONS DETECTED (round ${round}):`);
    for (const reg of result.regressions) {
      if (reg.type === 'spread_increase') {
        log(`    [${reg.tier}] ${reg.message}`);
      } else {
        const winStr = reg.winners.map(w => `${w.archetype} +${w.delta}pp`).join(', ');
        const loseStr = reg.losers.map(l => `${l.archetype} ${l.delta}pp`).join(', ');
        log(`    [${reg.tier}] Winners: ${winStr} | Losers: ${loseStr} (spread Δ: ${reg.spreadDelta > 0 ? '+' : ''}${reg.spreadDelta}pp)`);
      }
    }
  } else if (result.spreadChanges.length) {
    for (const sc of result.spreadChanges) {
      const dir = sc.delta > 0 ? '+' : '';
      log(`  Balance [${sc.tier}]: spread ${dir}${sc.delta}pp (${sc.preSpread} → ${sc.postSpread}pp) — no regressions`);
    }
  }

  return result;
}

// ============================================================
// Balance Convergence Detection
// ============================================================

export function checkConvergence(postSimResults, round) {
  const bc = CONFIG.balanceConfig;
  const cc = bc?.convergenceCriteria;
  if (!cc || !postSimResults?.length) return { converged: false, report: 'No convergence criteria configured', tierResults: {} };

  const minRounds = cc.minRounds ?? 3;
  if (round < minRounds) return { converged: false, report: `Round ${round} < minRounds ${minRounds}`, tierResults: {} };

  const maxSpreadPp = cc.maxSpreadPp || {};
  const maxFlags = cc.maxFlags ?? Infinity;
  const requiredTiers = cc.requiredTiers || bc.sims.map(s => `${s.tier}${s.variant ? '/' + s.variant : ''}`);

  const tierResults = {};
  let allPassed = true;
  const reportLines = [];

  for (const r of postSimResults) {
    if (!r.success || !r.data) continue;
    const tierKey = `${r.tier}${r.variant ? '/' + r.variant : ''}`;
    const isRequired = requiredTiers.includes(tierKey);
    if (!isRequired) continue;

    const spread = r.data.balanceMetrics.overallSpreadPp;
    const flags = (r.data.balanceFlags.dominant?.length || 0) +
                  (r.data.balanceFlags.weak?.length || 0) +
                  (r.data.balanceFlags.matchupSkews?.length || 0);

    const tierThreshold = maxSpreadPp[r.tier] ?? maxSpreadPp['*'] ?? Infinity;
    const spreadOk = spread <= tierThreshold;
    const flagsOk = flags <= maxFlags;
    const tierPassed = spreadOk && flagsOk;

    tierResults[tierKey] = { spread, flags, tierThreshold, spreadOk, flagsOk, passed: tierPassed };

    if (!tierPassed) allPassed = false;

    const statusIcon = tierPassed ? '✓' : '✗';
    reportLines.push(`  ${statusIcon} [${tierKey}] spread=${spread}pp (max ${tierThreshold}pp), flags=${flags} (max ${maxFlags})`);
  }

  for (const reqTier of requiredTiers) {
    if (!tierResults[reqTier]) {
      allPassed = false;
      reportLines.push(`  ✗ [${reqTier}] missing sim results`);
    }
  }

  const report = reportLines.join('\n');

  if (allPassed) {
    log(`  ✓ BALANCE CONVERGED (round ${round}):`);
  } else {
    log(`  Convergence check (round ${round}):`);
  }
  for (const line of reportLines) log(line);

  return { converged: allPassed, report, tierResults };
}

// ============================================================
// Balance Context Builder
// ============================================================

export function buildBalanceContext() {
  const state = loadBalanceState();
  if (!state.rounds?.length) return null;

  const latest = state.rounds[state.rounds.length - 1];
  const lines = [`Balance data (round ${latest.round}, ${latest.timestamp}):`];

  for (const [tierKey, t] of Object.entries(latest.tiers || {})) {
    lines.push(`  [${tierKey}] spread=${t.spreadPp}pp, top=${t.topArchetype.archetype}(${t.topArchetype.winRate}%), bottom=${t.bottomArchetype.archetype}(${t.bottomArchetype.winRate}%), flags=${t.flagCount}`);

    if (t.archetypeWinRates) {
      const rateStr = Object.entries(t.archetypeWinRates)
        .sort(([, a], [, b]) => b - a)
        .map(([arch, rate]) => `${arch}=${rate}%`)
        .join(', ');
      lines.push(`    Win rates: ${rateStr}`);
    }
  }

  if (latest.deltas) {
    lines.push(`  Changes this round:`);
    for (const [tierKey, d] of Object.entries(latest.deltas)) {
      const dir = d.spreadDelta > 0 ? '+' : '';
      lines.push(`    [${tierKey}] spread ${dir}${d.spreadDelta}pp`);
      if (d.archetypeDeltas) {
        const deltaStr = Object.entries(d.archetypeDeltas)
          .filter(([, delta]) => Math.abs(delta) >= 0.5)
          .sort(([, a], [, b]) => b - a)
          .map(([arch, delta]) => `${arch} ${delta > 0 ? '+' : ''}${delta}pp`)
          .join(', ');
        if (deltaStr) lines.push(`    Archetype deltas: ${deltaStr}`);
      }
    }
  }

  if (state.rounds.length >= 2) {
    const recent = state.rounds.slice(-3);
    lines.push(`  Trend (last ${recent.length} rounds):`);
    for (const r of recent) {
      const tierSpreads = Object.entries(r.tiers || {}).map(([k, t]) => `${k}=${t.spreadPp}pp`).join(', ');
      lines.push(`    Round ${r.round}: ${tierSpreads}`);
    }
  }

  if (latest._regressions?.length) {
    lines.push(`  ⚠ Regressions detected:`);
    for (const reg of latest._regressions) {
      if (reg.type === 'spread_increase') {
        lines.push(`    [${reg.tier}] ${reg.message}`);
      } else {
        const winStr = reg.winners?.map(w => `${w.archetype} +${w.delta}pp`).join(', ') || '';
        const loseStr = reg.losers?.map(l => `${l.archetype} ${l.delta}pp`).join(', ') || '';
        lines.push(`    [${reg.tier}] Winners: ${winStr} | Losers: ${loseStr}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================
// Balance Backlog Generation
// ============================================================

export function generateBalanceBacklog(round, postSimResults, regressionResult) {
  if (!postSimResults?.length) return 0;

  const backlog = loadBacklog();
  const existingTitles = new Set(backlog.map(t => t.title));
  const newTasks = [];
  let nextId = getNextBacklogId(backlog);

  // --- 1. Outlier archetypes (>58% or <42% at any tier) ---
  for (const r of postSimResults) {
    if (!r.success || !r.data) continue;
    const tierKey = `${r.tier}/${r.variant || 'balanced'}`;

    for (const stat of r.data.archetypeStats) {
      const winPct = Math.round(stat.overallWinRate * 1000) / 10;

      if (winPct > 58) {
        const title = `${stat.archetype} too strong at ${r.tier} (${winPct}%)`;
        if (!existingTitles.has(title)) {
          newTasks.push({
            id: `BL-${String(nextId++).padStart(3, '0')}`,
            role: 'balance-analyst',
            priority: winPct > 62 ? 1 : 2,
            title,
            description: `${stat.archetype} win rate is ${winPct}% at ${tierKey} (target: 42-58%). Consider reducing a primary stat or adjusting a balance-config constant that amplifies this archetype's strength.`,
            fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
            status: 'pending',
            dependsOn: [],
            generatedBy: 'orchestrator',
            round,
          });
          existingTitles.add(title);
        }
      }

      if (winPct < 42) {
        const title = `${stat.archetype} too weak at ${r.tier} (${winPct}%)`;
        if (!existingTitles.has(title)) {
          newTasks.push({
            id: `BL-${String(nextId++).padStart(3, '0')}`,
            role: 'balance-analyst',
            priority: winPct < 38 ? 1 : 2,
            title,
            description: `${stat.archetype} win rate is ${winPct}% at ${tierKey} (target: 42-58%). Consider boosting a primary stat or adjusting a balance-config constant that would help this archetype.`,
            fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
            status: 'pending',
            dependsOn: [],
            generatedBy: 'orchestrator',
            round,
          });
          existingTitles.add(title);
        }
      }
    }
  }

  // --- 2. Matchup skews from balance flags ---
  for (const r of postSimResults) {
    if (!r.success || !r.data?.balanceFlags) continue;
    const tierKey = `${r.tier}/${r.variant || 'balanced'}`;

    for (const skew of (r.data.balanceFlags.matchupSkews || [])) {
      const title = `Matchup skew: ${skew.matchup || skew} at ${r.tier}`;
      if (!existingTitles.has(title)) {
        newTasks.push({
          id: `BL-${String(nextId++).padStart(3, '0')}`,
          role: 'balance-analyst',
          priority: 3,
          title,
          description: `Matchup skew flagged at ${tierKey}: ${typeof skew === 'string' ? skew : JSON.stringify(skew)}. Investigate if a stat or constant change can narrow this matchup.`,
          fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
          status: 'pending',
          dependsOn: [],
          generatedBy: 'orchestrator',
          round,
        });
        existingTitles.add(title);
      }
    }
  }

  // --- 3. Regression-driven tasks ---
  if (regressionResult?.hasRegressions) {
    for (const reg of regressionResult.regressions) {
      if (reg.type === 'spread_increase') {
        const title = `Spread regression at ${reg.tier} (+${reg.spreadDelta}pp)`;
        if (!existingTitles.has(title)) {
          newTasks.push({
            id: `BL-${String(nextId++).padStart(3, '0')}`,
            role: 'balance-analyst',
            priority: 1,
            title,
            description: `${reg.message}. Last round's change made balance worse at this tier. Consider reverting or trying a different approach.`,
            fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
            status: 'pending',
            dependsOn: [],
            generatedBy: 'orchestrator',
            round,
          });
          existingTitles.add(title);
        }
      } else if (reg.winners?.length && reg.losers?.length) {
        const winStr = reg.winners.map(w => `${w.archetype} +${w.delta}pp`).join(', ');
        const loseStr = reg.losers.map(l => `${l.archetype} ${l.delta}pp`).join(', ');
        const title = `Balance regression at ${reg.tier}: winners/losers`;
        if (!existingTitles.has(title)) {
          newTasks.push({
            id: `BL-${String(nextId++).padStart(3, '0')}`,
            role: 'balance-analyst',
            priority: 1,
            title,
            description: `Regression at ${reg.tier}: Winners: ${winStr} | Losers: ${loseStr}. A change helped some archetypes but hurt others. Address the losers without negating the gains.`,
            fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
            status: 'pending',
            dependsOn: [],
            generatedBy: 'orchestrator',
            round,
          });
          existingTitles.add(title);
        }
      }
    }
  }

  // --- 4. QA companion tasks for balance changes ---
  const balanceTasks = newTasks.filter(t => t.role === 'balance-analyst' && t.priority <= 2);
  if (balanceTasks.length > 0) {
    const title = `Validate round ${round} balance changes`;
    if (!existingTitles.has(title)) {
      newTasks.push({
        id: `BL-${String(nextId++).padStart(3, '0')}`,
        role: 'qa-engineer',
        priority: 2,
        title,
        description: `Write tests validating balance changes made in round ${round}. Focus on boundary conditions near changed parameter values and invariant preservation.`,
        fileOwnership: ['src/engine/*.test.ts'],
        status: 'pending',
        dependsOn: balanceTasks.map(t => t.id),
        generatedBy: 'orchestrator',
        round,
      });
      existingTitles.add(title);
    }
  }

  if (newTasks.length) {
    backlog.push(...newTasks);
    saveBacklog(backlog);
    log(`  Balance backlog: generated ${newTasks.length} task(s) from sim data`);
    for (const t of newTasks) {
      log(`    ${t.id} [P${t.priority}] ${t.role}: ${t.title}`);
    }
  }

  return newTasks.length;
}

/**
 * Get the next available backlog ID number.
 */
export function getNextBacklogId(backlog) {
  let maxNum = 0;
  for (const t of backlog) {
    const match = t.id?.match(/^BL-(\d+)$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  if (existsSync(BACKLOG_ARCHIVE_FILE)) {
    try {
      const archive = JSON.parse(readFileSync(BACKLOG_ARCHIVE_FILE, 'utf-8'));
      for (const t of archive) {
        const match = t.id?.match(/^BL-(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    } catch (_) { /* ignore */ }
  }
  return maxNum + 1;
}

// ============================================================
// Parameter Search Integration
// ============================================================

export async function runParameterSearch(configPath, timeoutMs = 600000) {
  const absConfig = resolve(MVP_DIR, configPath);
  if (!existsSync(absConfig)) {
    log(`  Parameter search: config not found: ${absConfig}`);
    return null;
  }

  log(`  Running parameter search: ${configPath}...`);
  const startTime = Date.now();

  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['tsx', 'src/tools/param-search.ts', absConfig], {
      cwd: MVP_DIR,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) log(`    [param-search] ${line}`);
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      log(`  Parameter search TIMEOUT (${timeoutMs / 1000}s). Killing process.`);
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (code !== 0) {
        log(`  Parameter search failed (exit code ${code}) after ${elapsed}s`);
        resolvePromise(null);
        return;
      }

      try {
        const report = JSON.parse(stdout);
        log(`  Parameter search complete: ${report.totalSimulations} sims in ${elapsed}s`);
        log(`    Baseline score: ${report.baseline.score.toFixed(2)}`);
        log(`    Best score: ${report.bestResult.score.toFixed(2)} (${report.bestResult.label})`);
        if (report.bestResult.score < report.baseline.score) {
          const improvement = report.baseline.score - report.bestResult.score;
          log(`    Improvement: -${improvement.toFixed(2)} (${JSON.stringify(report.bestResult.overrides)})`);
        }
        resolvePromise(report);
      } catch (err) {
        log(`  Parameter search: failed to parse JSON output (${err.message})`);
        resolvePromise(null);
      }
    });
  });
}

export function buildParamSearchContext() {
  if (!paramSearchResults) return null;

  const r = paramSearchResults;
  const lines = [];

  lines.push(`Parameter search: "${r.config.name}" (${r.config.strategy} strategy)`);
  lines.push(`  Params tested: ${r.config.params.map(p => p.label || p.key).join(', ')}`);
  lines.push(`  Simulations: ${r.totalSimulations}, Time: ${(r.totalElapsedMs / 1000 / 60).toFixed(1)} min`);
  lines.push(``);

  lines.push(`Baseline (current config): score=${r.baseline.score.toFixed(2)}`);
  if (r.noiseFloor > 0) {
    lines.push(`  Noise floor: ±${r.noiseFloor.toFixed(2)} score points (from ${r.baselineRuns?.length ?? 1} averaged baselines)`);
    lines.push(`  Results within noise floor are unreliable — marked as "within noise".`);
  }
  for (const [tierKey, tier] of Object.entries(r.baseline.tiers)) {
    lines.push(`  ${tierKey}: spread=${tier.spreadPp}pp, top=${tier.topArchetype.archetype}(${tier.topArchetype.winRate}%), bottom=${tier.bottomArchetype.archetype}(${tier.bottomArchetype.winRate}%), flags=${tier.flagCount}`);
  }
  lines.push(``);

  lines.push(`Best found: score=${r.bestResult.score.toFixed(2)} (${r.bestResult.label})`);
  lines.push(`  Overrides: ${JSON.stringify(r.bestResult.overrides)}`);
  for (const [tierKey, tier] of Object.entries(r.bestResult.tiers)) {
    const baselineTier = r.baseline.tiers[tierKey];
    const delta = baselineTier ? (tier.spreadPp - baselineTier.spreadPp).toFixed(1) : '?';
    const sign = parseFloat(delta) >= 0 ? '+' : '';
    lines.push(`  ${tierKey}: spread=${tier.spreadPp}pp (${sign}${delta}pp), flags=${tier.flagCount}`);
  }
  lines.push(``);

  if (r.improvements?.length > 0) {
    lines.push(`Parameter sensitivity (most impactful):`);
    for (const imp of r.improvements.slice(0, 5)) {
      if (imp.confirmed) {
        lines.push(`  ${imp.key}: CONFIRMED at ${imp.currentValue} (already optimal)`);
      } else if (imp.withinNoise) {
        lines.push(`  ${imp.key}: current=${imp.currentValue}, best=${imp.bestValue} (~${imp.scoreDelta.toFixed(2)}, WITHIN NOISE — not actionable)`);
      } else {
        const direction = imp.scoreDelta < 0 ? 'IMPROVES' : 'worsens';
        const spreadInfo = Object.entries(imp.spreadImprovements)
          .map(([t, d]) => `${t}:${d > 0 ? '+' : ''}${d}pp`)
          .join(', ');
        lines.push(`  ${imp.key}: current=${imp.currentValue}, best=${imp.bestValue} (${direction} by ${Math.abs(imp.scoreDelta).toFixed(2)}) [${spreadInfo}]`);
      }
    }
    lines.push(``);
  }

  if (r.rankings?.length > 1) {
    lines.push(`Top 5 configurations:`);
    for (const ranked of r.rankings.slice(0, 5)) {
      const overridesStr = Object.entries(ranked.overrides).map(([k, v]) => `${k}=${v}`).join(', ');
      lines.push(`  score=${ranked.score.toFixed(2)}: ${overridesStr || 'baseline'}`);
    }
  }

  return lines.join('\n');
}
