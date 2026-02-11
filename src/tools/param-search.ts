// ============================================================
// Jousting MVP — Parameter Search Framework
// ============================================================
// Systematically explores balance-config.ts parameter space to
// find configurations that minimize win rate spread across tiers.
//
// Strategies:
//   sweep    — vary one param at a time, measure sensitivity
//   descent  — iterative sweep: keep best value, move to next param
//
// Usage:
//   npx tsx src/tools/param-search.ts <config.json>             # Run search
//   npx tsx src/tools/param-search.ts <config.json> --dry-run   # Show plan only
//
// Config format: see orchestrator/search-configs/README or examples.
// Output: JSON to stdout with rankings, recommendations, and raw data.
// ============================================================

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BALANCE } from '../engine/balance-config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../..');

/** Read a dot-notation key from the BALANCE config object. */
function getBalanceValue(key: string): number | undefined {
  const parts = key.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: any = BALANCE;
  for (const part of parts) {
    if (target === undefined) return undefined;
    target = target[part];
  }
  return typeof target === 'number' ? target : undefined;
}

// ============================================================
// Types
// ============================================================

interface ParamSpec {
  key: string;               // dot-notation path in BALANCE (e.g. "softCapK")
  values: number[];          // explicit values to test
  label?: string;            // human-friendly name
}

interface TierSpec {
  tier: string;              // bare, epic, giga, etc.
  variant?: string;          // balanced, aggressive, defensive
  weight: number;            // importance weight for scoring (0-1)
}

interface SearchConfig {
  name: string;
  description?: string;
  strategy: 'sweep' | 'descent';
  params: ParamSpec[];
  tiers: TierSpec[];
  matchesPerMatchup?: number;  // default 200
  simTimeoutMs?: number;       // default 90000
  descentRounds?: number;      // for descent strategy (default 3)
  baselineRuns?: number;       // default 3 — multiple baselines averaged to reduce noise
  outputDir?: string;          // where to save results
}

interface TierResult {
  tier: string;
  variant: string | null;
  spreadPp: number;
  topArchetype: { archetype: string; winRate: number };
  bottomArchetype: { archetype: string; winRate: number };
  flagCount: number;
  archetypeWinRates: Record<string, number>;
}

interface SearchPoint {
  overrides: Record<string, number>;
  label: string;
  tiers: Record<string, TierResult>;
  score: number;
  elapsedMs: number;
}

interface SearchReport {
  config: SearchConfig;
  baseline: SearchPoint;
  baselineRuns?: SearchPoint[];      // individual baseline runs (when baselineRuns > 1)
  noiseFloor: number;                // estimated ±score noise (SD of baseline runs, 0 if single run)
  results: SearchPoint[];
  rankings: SearchPoint[];          // sorted best-to-worst
  bestResult: SearchPoint;
  improvements: Improvement[];      // params that improved score vs baseline
  timestamp: string;
  totalSimulations: number;
  totalElapsedMs: number;
}

interface Improvement {
  key: string;
  bestValue: number;
  currentValue: number;
  scoreDelta: number;               // negative = better
  confirmed: boolean;               // true if bestValue === currentValue (already optimal)
  withinNoise: boolean;             // true if |scoreDelta| < noiseFloor
  spreadImprovements: Record<string, number>;  // tier → pp improvement
}

// ============================================================
// Scoring
// ============================================================

function scoreTiers(tiers: Record<string, TierResult>, tierSpecs: TierSpec[]): number {
  let totalScore = 0;
  let totalWeight = 0;

  for (const spec of tierSpecs) {
    const key = spec.variant ? `${spec.tier}/${spec.variant}` : spec.tier;
    const result = tiers[key];
    if (!result) continue;

    // Score = weighted sum of (spread + flag penalty)
    // Lower is better. Flags add 5pp each as penalty.
    const tierScore = result.spreadPp + result.flagCount * 5;
    totalScore += tierScore * spec.weight;
    totalWeight += spec.weight;
  }

  return totalWeight > 0 ? totalScore / totalWeight : Infinity;
}

// ============================================================
// Simulation Runner
// ============================================================

function runSim(
  tier: string,
  variant: string | undefined,
  overrides: Record<string, number>,
  matchesPerMatchup: number,
  timeoutMs: number,
): TierResult | null {
  const args = [tier];
  if (variant) args.push(variant);
  args.push('--json');

  for (const [key, value] of Object.entries(overrides)) {
    args.push('--override', `${key}=${value}`);
  }

  const cmd = `npx tsx src/tools/simulate.ts ${args.join(' ')}`;

  try {
    const stdout = execSync(cmd, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: PROJECT_ROOT,
    });

    const report = JSON.parse(stdout);
    const metrics = report.balanceMetrics;
    const flags = report.balanceFlags;

    const archetypeWinRates: Record<string, number> = {};
    for (const s of report.archetypeStats) {
      archetypeWinRates[s.archetype] = Math.round(s.overallWinRate * 1000) / 10;
    }

    return {
      tier,
      variant: variant || null,
      spreadPp: metrics.overallSpreadPp,
      topArchetype: metrics.topArchetype,
      bottomArchetype: metrics.bottomArchetype,
      flagCount: flags.dominant.length + flags.weak.length + flags.matchupSkews.length,
      archetypeWinRates,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Sim failed (${tier}/${variant || 'none'}): ${msg.slice(0, 100)}`);
    return null;
  }
}

function runAllTiers(
  overrides: Record<string, number>,
  tierSpecs: TierSpec[],
  matchesPerMatchup: number,
  timeoutMs: number,
): Record<string, TierResult> {
  const results: Record<string, TierResult> = {};

  for (const spec of tierSpecs) {
    const result = runSim(spec.tier, spec.variant, overrides, matchesPerMatchup, timeoutMs);
    if (result) {
      const key = spec.variant ? `${spec.tier}/${spec.variant}` : spec.tier;
      results[key] = result;
    }
  }

  return results;
}

function makeSearchPoint(
  overrides: Record<string, number>,
  label: string,
  tierSpecs: TierSpec[],
  matchesPerMatchup: number,
  timeoutMs: number,
): SearchPoint {
  const start = Date.now();
  const tiers = runAllTiers(overrides, tierSpecs, matchesPerMatchup, timeoutMs);
  const score = scoreTiers(tiers, tierSpecs);
  return {
    overrides: { ...overrides },
    label,
    tiers,
    score,
    elapsedMs: Date.now() - start,
  };
}

// ============================================================
// Strategies
// ============================================================

function runSweep(config: SearchConfig): SearchPoint[] {
  const matchesPerMatchup = config.matchesPerMatchup || 200;
  const timeoutMs = config.simTimeoutMs || 90000;
  const results: SearchPoint[] = [];

  const totalSims = config.params.reduce((sum, p) => sum + p.values.length, 0) * config.tiers.length;
  console.error(`\nSweep: ${config.params.length} params × ${config.tiers.length} tiers = ${totalSims} sims`);

  for (const param of config.params) {
    const paramLabel = param.label || param.key;
    console.error(`\n  Sweeping ${paramLabel} (${param.values.length} values)...`);

    for (const value of param.values) {
      const overrides = { [param.key]: value };
      const label = `${paramLabel}=${value}`;
      console.error(`    ${label}...`);

      const point = makeSearchPoint(overrides, label, config.tiers, matchesPerMatchup, timeoutMs);
      results.push(point);

      // Show inline progress
      const tierSummary = Object.entries(point.tiers)
        .map(([k, v]) => `${k}:${v.spreadPp}pp`)
        .join(', ');
      console.error(`    ${label} → score=${point.score.toFixed(2)} [${tierSummary}] (${(point.elapsedMs / 1000).toFixed(1)}s)`);
    }
  }

  return results;
}

function runDescent(config: SearchConfig): SearchPoint[] {
  const matchesPerMatchup = config.matchesPerMatchup || 200;
  const timeoutMs = config.simTimeoutMs || 90000;
  const rounds = config.descentRounds || 3;
  const results: SearchPoint[] = [];

  // Start with current values (empty overrides = defaults)
  let currentBest: Record<string, number> = {};

  console.error(`\nCoordinate descent: ${rounds} rounds × ${config.params.length} params × ${config.tiers.length} tiers`);

  for (let round = 1; round <= rounds; round++) {
    console.error(`\n--- Descent Round ${round}/${rounds} ---`);

    for (const param of config.params) {
      const paramLabel = param.label || param.key;
      console.error(`\n  Optimizing ${paramLabel}...`);

      let bestValue: number | undefined;
      let bestScore = Infinity;

      for (const value of param.values) {
        const overrides = { ...currentBest, [param.key]: value };
        const label = `R${round} ${paramLabel}=${value}`;
        console.error(`    ${label}...`);

        const point = makeSearchPoint(overrides, label, config.tiers, matchesPerMatchup, timeoutMs);
        results.push(point);

        const tierSummary = Object.entries(point.tiers)
          .map(([k, v]) => `${k}:${v.spreadPp}pp`)
          .join(', ');
        console.error(`    ${label} → score=${point.score.toFixed(2)} [${tierSummary}]`);

        if (point.score < bestScore) {
          bestScore = point.score;
          bestValue = value;
        }
      }

      if (bestValue !== undefined) {
        currentBest[param.key] = bestValue;
        console.error(`  → Best ${paramLabel}=${bestValue} (score=${bestScore.toFixed(2)})`);
      }
    }

    console.error(`\n  Round ${round} best config: ${JSON.stringify(currentBest)}`);
  }

  return results;
}

// ============================================================
// Analysis
// ============================================================

function analyzeImprovements(
  baseline: SearchPoint,
  results: SearchPoint[],
  params: ParamSpec[],
  noiseFloor: number,
): Improvement[] {
  const improvements: Improvement[] = [];

  for (const param of params) {
    const paramResults = results.filter(r => {
      const keys = Object.keys(r.overrides);
      return keys.length === 1 && keys[0] === param.key;
    });

    if (paramResults.length === 0) continue;

    const best = paramResults.reduce((a, b) => a.score < b.score ? a : b);
    const currentValue = getBalanceValue(param.key) ?? 0;
    const confirmed = best.overrides[param.key] === currentValue;

    // If best value IS the current value, the delta is just noise — report 0
    const scoreDelta = confirmed ? 0 : best.score - baseline.score;

    const spreadImprovements: Record<string, number> = {};
    for (const [tierKey, tierResult] of Object.entries(best.tiers)) {
      const baselineTier = baseline.tiers[tierKey];
      if (baselineTier) {
        spreadImprovements[tierKey] = confirmed
          ? 0
          : Math.round((baselineTier.spreadPp - tierResult.spreadPp) * 10) / 10;
      }
    }

    improvements.push({
      key: param.key,
      bestValue: best.overrides[param.key],
      currentValue: currentValue,
      scoreDelta: Math.round(scoreDelta * 100) / 100,
      confirmed,
      withinNoise: !confirmed && Math.abs(scoreDelta) < noiseFloor,
      spreadImprovements,
    });
  }

  // Sort: confirmed last, then by improvement (most negative delta = best)
  improvements.sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
    return a.scoreDelta - b.scoreDelta;
  });

  return improvements;
}

// ============================================================
// Baseline Averaging & Noise Estimation
// ============================================================

/** Average multiple baseline SearchPoints into a single representative baseline. */
function averageBaselines(runs: SearchPoint[], tierSpecs: TierSpec[]): SearchPoint {
  if (runs.length === 1) return runs[0];

  const n = runs.length;
  const avgTiers: Record<string, TierResult> = {};

  // Collect all tier keys
  const tierKeys = new Set<string>();
  for (const run of runs) {
    for (const k of Object.keys(run.tiers)) tierKeys.add(k);
  }

  for (const tierKey of tierKeys) {
    const tierRuns = runs.map(r => r.tiers[tierKey]).filter(Boolean);
    if (tierRuns.length === 0) continue;

    // Average spreadPp and flagCount
    const avgSpread = Math.round(tierRuns.reduce((s, t) => s + t.spreadPp, 0) / tierRuns.length * 10) / 10;
    const avgFlags = Math.round(tierRuns.reduce((s, t) => s + t.flagCount, 0) / tierRuns.length);

    // Average per-archetype win rates
    const allArchetypes = Object.keys(tierRuns[0].archetypeWinRates);
    const avgWinRates: Record<string, number> = {};
    for (const arch of allArchetypes) {
      avgWinRates[arch] = Math.round(
        tierRuns.reduce((s, t) => s + (t.archetypeWinRates[arch] ?? 50), 0) / tierRuns.length * 10
      ) / 10;
    }

    // Recalculate top/bottom from averaged win rates
    let topArch = allArchetypes[0], bottomArch = allArchetypes[0];
    for (const arch of allArchetypes) {
      if (avgWinRates[arch] > avgWinRates[topArch]) topArch = arch;
      if (avgWinRates[arch] < avgWinRates[bottomArch]) bottomArch = arch;
    }

    avgTiers[tierKey] = {
      tier: tierRuns[0].tier,
      variant: tierRuns[0].variant,
      spreadPp: avgSpread,
      topArchetype: { archetype: topArch, winRate: avgWinRates[topArch] },
      bottomArchetype: { archetype: bottomArch, winRate: avgWinRates[bottomArch] },
      flagCount: avgFlags,
      archetypeWinRates: avgWinRates,
    };
  }

  const avgScore = scoreTiers(avgTiers, tierSpecs);
  const totalElapsed = runs.reduce((s, r) => s + r.elapsedMs, 0);

  return {
    overrides: {},
    label: `baseline (avg of ${n})`,
    tiers: avgTiers,
    score: avgScore,
    elapsedMs: totalElapsed,
  };
}

/** Standard deviation of scores across multiple SearchPoints. */
function scoreStdDev(runs: SearchPoint[]): number {
  if (runs.length < 2) return 0;
  const scores = runs.map(r => r.score);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (scores.length - 1);
  return Math.sqrt(variance);
}

// ============================================================
// Main
// ============================================================

function loadConfig(path: string): SearchConfig {
  const raw = readFileSync(resolve(path), 'utf-8');
  const config = JSON.parse(raw) as SearchConfig;

  // Validate
  if (!config.name) throw new Error('Config must have a "name" field');
  if (!config.strategy) throw new Error('Config must have a "strategy" field');
  if (!config.params?.length) throw new Error('Config must have at least one param');
  if (!config.tiers?.length) throw new Error('Config must have at least one tier');

  for (const param of config.params) {
    if (!param.key) throw new Error(`Param missing "key" field`);
    if (!param.values?.length) throw new Error(`Param "${param.key}" needs at least one value`);
  }

  for (const tier of config.tiers) {
    if (!tier.tier) throw new Error('Tier spec missing "tier" field');
    if (tier.weight === undefined) tier.weight = 1;
  }

  return config;
}

function main() {
  const configPath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  // CLI --matches N override
  const matchesIdx = process.argv.indexOf('--matches');
  const matchesCli = matchesIdx !== -1 && process.argv[matchesIdx + 1]
    ? parseInt(process.argv[matchesIdx + 1], 10)
    : undefined;

  if (!configPath) {
    console.error('Usage: npx tsx src/tools/param-search.ts <config.json> [--dry-run] [--matches N]');
    console.error('');
    console.error('Config JSON format:');
    console.error('  { name, strategy: "sweep"|"descent", params: [{key, values, label?}], tiers: [{tier, variant?, weight}] }');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run    Show plan only, no simulations');
    console.error('  --matches N  Override matchesPerMatchup (default: config value or 200)');
    process.exit(1);
  }

  const config = loadConfig(configPath);
  const matchesPerMatchup = matchesCli || config.matchesPerMatchup || 200;
  const timeoutMs = config.simTimeoutMs || 90000;
  const baselineRunCount = config.baselineRuns ?? 3;

  // Estimate work
  let totalSims: number;
  if (config.strategy === 'sweep') {
    totalSims = config.params.reduce((sum, p) => sum + p.values.length, 0) * config.tiers.length;
  } else {
    const rounds = config.descentRounds || 3;
    totalSims = rounds * config.params.reduce((sum, p) => sum + p.values.length, 0) * config.tiers.length;
  }
  const baselineSims = config.tiers.length * baselineRunCount;
  totalSims += baselineSims;

  const estTimeMin = Math.round(totalSims * 0.5) / 60; // ~0.5s per sim at N=200
  const estTimeMax = Math.round(totalSims * 1.5) / 60;

  console.error(`\n${'='.repeat(60)}`);
  console.error(`PARAMETER SEARCH: ${config.name}`);
  console.error(`${'='.repeat(60)}`);
  console.error(`Strategy: ${config.strategy}`);
  console.error(`Parameters: ${config.params.length} (${config.params.map(p => p.label || p.key).join(', ')})`);
  console.error(`Tiers: ${config.tiers.map(t => `${t.tier}/${t.variant || 'none'} (w=${t.weight})`).join(', ')}`);
  console.error(`Baseline runs: ${baselineRunCount} (averaged for noise reduction)`);
  console.error(`Total simulations: ${totalSims} (incl. ${baselineRunCount} baseline)`);
  console.error(`Estimated time: ${estTimeMin.toFixed(1)}-${estTimeMax.toFixed(1)} minutes`);
  console.error(`Matches per matchup: ${matchesPerMatchup}`);

  if (dryRun) {
    console.error('\n[DRY RUN] Would test these parameter values:');
    for (const param of config.params) {
      console.error(`  ${param.label || param.key}: [${param.values.join(', ')}]`);
    }
    process.exit(0);
  }

  const searchStart = Date.now();

  // Run baseline(s) — multiple runs averaged to reduce Monte Carlo noise
  console.error(`\nRunning baseline (${baselineRunCount} run${baselineRunCount > 1 ? 's' : ''}, current config)...`);
  const baselineRuns: SearchPoint[] = [];
  for (let i = 0; i < baselineRunCount; i++) {
    if (baselineRunCount > 1) console.error(`  Baseline run ${i + 1}/${baselineRunCount}...`);
    const run = makeSearchPoint({}, `baseline-${i + 1}`, config.tiers, matchesPerMatchup, timeoutMs);
    baselineRuns.push(run);
    const summary = Object.entries(run.tiers).map(([k, v]) => `${k}:${v.spreadPp}pp`).join(', ');
    console.error(`  Run ${i + 1}: score=${run.score.toFixed(2)} [${summary}] (${(run.elapsedMs / 1000).toFixed(1)}s)`);
  }

  // Average baselines
  const baseline = averageBaselines(baselineRuns, config.tiers);
  const noiseFloor = baselineRunCount > 1 ? scoreStdDev(baselineRuns) : 0;
  const baselineSummary = Object.entries(baseline.tiers).map(([k, v]) => `${k}:${v.spreadPp}pp`).join(', ');
  console.error(`  Averaged baseline: score=${baseline.score.toFixed(2)} [${baselineSummary}]`);
  if (noiseFloor > 0) console.error(`  Noise floor: ±${noiseFloor.toFixed(2)} (1 SD of ${baselineRunCount} runs)`);

  // Run strategy
  let results: SearchPoint[];
  if (config.strategy === 'sweep') {
    results = runSweep(config);
  } else if (config.strategy === 'descent') {
    results = runDescent(config);
  } else {
    console.error(`Unknown strategy: ${config.strategy}`);
    process.exit(1);
  }

  // Analyze
  const rankings = [...results].sort((a, b) => a.score - b.score);
  const bestResult = rankings[0];
  const improvements = config.strategy === 'sweep'
    ? analyzeImprovements(baseline, results, config.params, noiseFloor)
    : [];

  const totalElapsedMs = Date.now() - searchStart;

  const report: SearchReport = {
    config,
    baseline,
    baselineRuns: baselineRunCount > 1 ? baselineRuns : undefined,
    noiseFloor,
    results,
    rankings: rankings.slice(0, 20), // top 20
    bestResult,
    improvements,
    timestamp: new Date().toISOString(),
    totalSimulations: totalSims,
    totalElapsedMs,
  };

  // Output JSON to stdout
  console.log(JSON.stringify(report, null, 2));

  // Summary to stderr
  console.error(`\n${'='.repeat(60)}`);
  console.error(`SEARCH COMPLETE`);
  console.error(`${'='.repeat(60)}`);
  console.error(`Total time: ${(totalElapsedMs / 1000 / 60).toFixed(1)} minutes`);
  console.error(`Simulations run: ${totalSims}`);
  console.error(`\nBaseline score: ${baseline.score.toFixed(2)}`);
  console.error(`Best score: ${bestResult.score.toFixed(2)} (${bestResult.label})`);

  if (bestResult.score < baseline.score) {
    const improvement = baseline.score - bestResult.score;
    console.error(`\nImprovement: -${improvement.toFixed(2)} score points`);
    console.error(`Best overrides: ${JSON.stringify(bestResult.overrides)}`);

    console.error('\nPer-tier comparison:');
    for (const [tierKey, tierResult] of Object.entries(bestResult.tiers)) {
      const baselineTier = baseline.tiers[tierKey];
      if (baselineTier) {
        const delta = tierResult.spreadPp - baselineTier.spreadPp;
        const sign = delta >= 0 ? '+' : '';
        console.error(`  ${tierKey}: ${baselineTier.spreadPp}pp → ${tierResult.spreadPp}pp (${sign}${delta.toFixed(1)}pp)`);
      }
    }
  } else {
    console.error('\nNo improvement found — current config may already be near-optimal for these params.');
  }

  if (noiseFloor > 0) {
    console.error(`Noise floor: ±${noiseFloor.toFixed(2)} score points (from ${baselineRunCount} baseline runs)`);
  }

  if (improvements.length > 0 && config.strategy === 'sweep') {
    console.error('\nParameter sensitivity (most impactful first):');
    for (const imp of improvements.slice(0, 5)) {
      if (imp.confirmed) {
        console.error(`  ${imp.key}=${imp.bestValue}: CONFIRMED (already optimal)`);
      } else if (imp.withinNoise) {
        console.error(`  ${imp.key}=${imp.bestValue}: ~${imp.scoreDelta.toFixed(2)} (within noise ±${noiseFloor.toFixed(2)})`);
      } else {
        const direction = imp.scoreDelta < 0 ? 'IMPROVES' : 'worsens';
        console.error(`  ${imp.key}=${imp.bestValue}: ${direction} score by ${Math.abs(imp.scoreDelta).toFixed(2)}`);
      }
    }
  }

  // Save to output dir if configured
  if (config.outputDir) {
    const outDir = resolve(config.outputDir);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    const filename = `search-${config.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    const outPath = join(outDir, filename);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.error(`\nResults saved to: ${outPath}`);
  }
}

main();
