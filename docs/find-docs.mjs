#!/usr/bin/env node

/**
 * find-docs.mjs — Find relevant documentation by keyword.
 * Usage: node docs/find-docs.mjs "<search terms>"
 * Example: node docs/find-docs.mjs "balance tuning"
 */

const DOCS = [
  {
    file: 'docs/orchestrator.md',
    keywords: ['orchestrator', 'agent', 'mission', 'round', 'backlog', 'worktree', 'spawn', 'session', 'revert', 'escalation', 'model', 'tiering', 'workflow', 'sdk', 'observability', 'dag', 'plugin', 'scaffold', 'template', 'overnight', 'runner', 'config', 'concurrency', 'priority', 'scheduling', 'role', 'producer', 'continuous'],
    description: 'Orchestrator architecture, modules, config, features (~220 lines)',
  },
  {
    file: 'docs/engine-guide.md',
    keywords: ['engine', 'combat', 'joust', 'melee', 'archetype', 'attack', 'speed', 'counter', 'unseat', 'fatigue', 'stat', 'pipeline', 'softcap', 'soft cap', 'shift', 'phase', 'pass', 'resolution', 'accuracy', 'impact', 'guard', 'momentum', 'control', 'initiative', 'stamina', 'carryover', 'ai', 'difficulty', 'pattern', 'reasoning'],
    description: 'Game engine, combat system, archetypes, AI (~170 lines)',
  },
  {
    file: 'docs/balance-reference.md',
    keywords: ['balance', 'win rate', 'spread', 'flag', 'coefficient', 'tuning', 'simulate', 'simulation', 'param', 'search', 'tier', 'bare', 'epic', 'giga', 'variant', 'aggressive', 'defensive', 'charger', 'technician', 'bulwark', 'tactician', 'breaker', 'duelist'],
    description: 'Current stats, win rates, balance config params (~110 lines)',
  },
  {
    file: 'docs/gear-system.md',
    keywords: ['gear', 'slot', 'loadout', 'rarity', 'uncommon', 'rare', 'legendary', 'relic', 'steed', 'player', 'chamfron', 'barding', 'saddle', 'stirrups', 'reins', 'horseshoes', 'helm', 'shield', 'lance', 'armor', 'gauntlets', 'melee_weapon', 'variant', 'bonus', 'caparison'],
    description: '12-slot gear system, variants, rarities (~80 lines)',
  },
  {
    file: 'docs/api-reference.md',
    keywords: ['api', 'signature', 'function', 'createMatch', 'submitJoustPass', 'submitMeleeRound', 'createFullLoadout', 'createFullPlayerLoadout', 'applyGiglingLoadout', 'applyPlayerLoadout', 'resolveJoustPass', 'resolveMeleeRoundFn', 'softCap', 'fatigueFactor', 'computeEffectiveStats', 'resolveCounters', 'calcAccuracy', 'calcImpactScore', 'checkUnseat', 'programmatic', 'usage', 'example'],
    description: 'Key function signatures, usage examples (~90 lines)',
  },
  {
    file: 'docs/troubleshooting.md',
    keywords: ['troubleshoot', 'bug', 'error', 'nan', 'wrong', 'unexpected', 'gotcha', 'mistake', 'fix', 'symptom', 'deprecated', 'resolvePass'],
    description: 'Common mistakes and fixes (~15 lines)',
  },
  {
    file: 'docs/session-history.md',
    keywords: ['session', 'history', 'handoff', 'previous', 'past', 'changelog', 'version'],
    description: 'All session summaries in compact table (~70 lines)',
  },
];

const query = process.argv.slice(2).join(' ').toLowerCase();

if (!query) {
  console.log('Usage: node docs/find-docs.mjs "<search terms>"');
  console.log('');
  console.log('Available docs:');
  for (const doc of DOCS) {
    console.log(`  ${doc.file} — ${doc.description}`);
  }
  process.exit(0);
}

const terms = query.split(/\s+/);

const scored = DOCS.map(doc => {
  let score = 0;
  for (const term of terms) {
    // Exact keyword match
    if (doc.keywords.some(k => k === term)) score += 3;
    // Partial keyword match
    else if (doc.keywords.some(k => k.includes(term) || term.includes(k))) score += 1;
    // Description match
    if (doc.description.toLowerCase().includes(term)) score += 1;
  }
  return { ...doc, score };
}).filter(d => d.score > 0).sort((a, b) => b.score - a.score);

if (scored.length === 0) {
  console.log(`No docs found for "${query}". Try broader terms.`);
  console.log('');
  console.log('Available docs:');
  for (const doc of DOCS) {
    console.log(`  ${doc.file} — ${doc.description}`);
  }
} else {
  console.log(`Results for "${query}":`);
  console.log('');
  for (const doc of scored) {
    const marker = doc === scored[0] ? '→' : ' ';
    console.log(`${marker} Read: ${doc.file}`);
    console.log(`  ${doc.description}`);
  }
}
