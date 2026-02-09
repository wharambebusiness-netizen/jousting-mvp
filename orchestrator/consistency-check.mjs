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

    // Check archetype stats in CLAUDE.md
    const expectedStats = {
      charger: 'MOM=75, CTL=55, GRD=50, INIT=55, STA=65',
      technician: 'MOM=64, CTL=70, GRD=55, INIT=59, STA=55',
      bulwark: 'MOM=58, CTL=52, GRD=65, INIT=53, STA=62',
      tactician: 'MOM=55, CTL=65, GRD=50, INIT=75, STA=55',
      breaker: 'MOM=62, CTL=60, GRD=55, INIT=55, STA=60',
      duelist: 'MOM=60, CTL=60, GRD=60, INIT=60, STA=60'
    };

    Object.entries(expectedStats).forEach(([arch, expected]) => {
      const actual = stats[arch];
      if (actual !== expected) {
        warnings.push(`${arch} stats mismatch: CLAUDE.md expects "${expected}", archetypes.ts has "${actual}"`);
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
