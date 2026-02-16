import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function runConsistencyCheck() {
  const warnings = [];
  const timestamp = new Date().toISOString();

  console.log('\n=== Consistency Check ===');

  try {
    // Read source files
    const archetypesPath = '../src/engine/archetypes.ts';
    const balanceConfigPath = '../src/engine/balance-config.ts';
    const claudeMdPath = '../CLAUDE.md';

    const archetypes = readFileSync(new URL(archetypesPath, import.meta.url), 'utf-8');
    const balanceConfig = readFileSync(new URL(balanceConfigPath, import.meta.url), 'utf-8');
    const claudeMd = readFileSync(new URL(claudeMdPath, import.meta.url), 'utf-8');

    // Extract archetype stats
    const stats = {
      charger: extractStats(archetypes, 'charger'),
      technician: extractStats(archetypes, 'technician'),
      bulwark: extractStats(archetypes, 'bulwark'),
      tactician: extractStats(archetypes, 'tactician'),
      breaker: extractStats(archetypes, 'breaker'),
      duelist: extractStats(archetypes, 'duelist')
    };

    // Extract balance constants
    const constants = {
      guardImpactCoeff: extractConstant(balanceConfig, 'guardImpactCoeff'),
      guardUnseatDivisor: extractConstant(balanceConfig, 'guardUnseatDivisor'),
      breakerGuardPenetration: extractConstant(balanceConfig, 'breakerGuardPenetration'),
      softCapKnee: extractConstant(balanceConfig, 'knee'),
      softCapK: extractConstant(balanceConfig, /softCap:.*?K:\s*([\d.]+)/s)
    };

    // v28: Parse expected stats dynamically from CLAUDE.md instead of hardcoding
    const expectedStats = {};
    const claudeStatMatches = claudeMd.matchAll(/(\w+):\s*MOM=(\d+),\s*CTL=(\d+),\s*GRD=(\d+),\s*INIT=(\d+),\s*STA=(\d+)/g);
    for (const m of claudeStatMatches) {
      expectedStats[m[1]] = `MOM=${m[2]}, CTL=${m[3]}, GRD=${m[4]}, INIT=${m[5]}, STA=${m[6]}`;
    }

    Object.entries(expectedStats).forEach(([arch, expected]) => {
      const actual = stats[arch];
      if (!actual) {
        warnings.push(`${arch} in CLAUDE.md but not found in archetypes.ts`);
      } else if (actual !== expected) {
        warnings.push(`${arch} stats mismatch: CLAUDE.md expects "${expected}", archetypes.ts has "${actual}"`);
      }
    });

    // Also check for archetypes in code but missing from CLAUDE.md
    Object.entries(stats).forEach(([arch, actual]) => {
      if (actual !== 'NOT FOUND' && !expectedStats[arch]) {
        warnings.push(`${arch} found in archetypes.ts but missing from CLAUDE.md stats`);
      }
    });

    // Output results
    if (warnings.length === 0) {
      console.log('✓ All checks passed');
    } else {
      console.log(`\n⚠ ${warnings.length} warning(s):`);
      warnings.forEach(w => console.log(`  - ${w}`));
    }

    // Write log
    const logDir = new URL('./logs', import.meta.url);
    mkdirSync(logDir, { recursive: true });
    const logPath = new URL('./logs/consistency.log', import.meta.url);
    const logEntry = `\n[${timestamp}] ${warnings.length} warning(s)\n${warnings.map(w => `  ${w}`).join('\n')}\n`;
    appendFileSync(logPath, logEntry);

  } catch (err) {
    console.error('Consistency check failed:', err.message);
    warnings.push(`Check failed: ${err.message}`);
  }

  return warnings;
}

function extractStats(content, archetype) {
  const regex = new RegExp(`id:\\s*['"]${archetype}['"].*?momentum:\\s*(\\d+).*?control:\\s*(\\d+).*?guard:\\s*(\\d+).*?initiative:\\s*(\\d+).*?stamina:\\s*(\\d+)`, 's');
  const match = content.match(regex);
  if (!match) return 'NOT FOUND';
  const [, mom, ctl, grd, init, sta] = match;
  return `MOM=${mom}, CTL=${ctl}, GRD=${grd}, INIT=${init}, STA=${sta}`;
}

function extractConstant(content, key) {
  if (key instanceof RegExp) {
    const match = content.match(key);
    return match ? match[1] : 'NOT FOUND';
  }
  const regex = new RegExp(`${key}:\\s*([\\d.]+)`);
  const match = content.match(regex);
  return match ? match[1] : 'NOT FOUND';
}
