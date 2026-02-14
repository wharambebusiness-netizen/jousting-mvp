// ============================================================
// Incremental Test Filter Module (extracted from orchestrator.mjs in S65)
// ============================================================
// Config-driven test mapping for incremental testing.
// Maps modified source files to affected test suites.

let projectConfig = null;

/**
 * Initialize with project config reference.
 * @param {{ projectConfig: object }} ctx
 */
export function initTestFilter(ctx) {
  projectConfig = ctx.projectConfig;
}

/** Update projectConfig reference (e.g., after detection in main). */
export function setProjectConfig(cfg) {
  projectConfig = cfg;
}

export function getSourceToTests() {
  if (projectConfig?.testing?.sourceToTests) {
    return projectConfig.testing.sourceToTests;
  }
  // Legacy fallback (jousting-specific)
  return {
    'calculator.ts':       ['calculator.test.ts', 'gear-variants.test.ts'],
    'balance-config.ts':   ['calculator.test.ts', 'playtest.test.ts', 'gear-variants.test.ts'],
    'phase-joust.ts':      ['phase-resolution.test.ts', 'match.test.ts'],
    'phase-melee.ts':      ['phase-resolution.test.ts', 'match.test.ts'],
    'match.ts':            ['match.test.ts'],
    'gigling-gear.ts':     ['gigling-gear.test.ts', 'gear-variants.test.ts'],
    'player-gear.ts':      ['player-gear.test.ts', 'gear-variants.test.ts'],
    'archetypes.ts':       ['playtest.test.ts', 'match.test.ts', 'gear-variants.test.ts'],
    'attacks.ts':          ['calculator.test.ts', 'phase-resolution.test.ts', 'match.test.ts'],
  };
}

export function getAiSourcePattern() {
  if (projectConfig?.testing?.aiSourcePattern) {
    return new RegExp(projectConfig.testing.aiSourcePattern);
  }
  return /^src\/ai\//;  // Legacy fallback
}

export function getAiTestFile() {
  return projectConfig?.testing?.aiTestFile || 'ai.test.ts';
}

export function getFullSuiteTriggers() {
  return projectConfig?.testing?.fullSuiteTriggers || ['types.ts', 'index.ts'];
}

export function getTestFilterFlag() {
  return projectConfig?.testing?.filterFlag || '--testPathPattern';
}

/**
 * Given a list of modified file paths (from agent handoffs), return
 * the test filter string, or null for full suite.
 * Uses config-driven mappings instead of hardcoded constants.
 */
export function getTestFilter(modifiedFiles) {
  if (!modifiedFiles || !modifiedFiles.length) return null; // no info → full suite

  const SOURCE_TO_TESTS = getSourceToTests();
  const AI_SOURCE_PATTERN = getAiSourcePattern();
  const FULL_SUITE_TRIGGERS = getFullSuiteTriggers();
  const aiTestFile = getAiTestFile();

  const affectedTests = new Set();
  let needFullSuite = false;

  for (const filePath of modifiedFiles) {
    const basename = filePath.split('/').pop().split('\\').pop();

    // Non-source files (CSS, MD, JSON, orchestrator, etc.) — no tests needed
    if (!filePath.includes('src/')) continue;

    // Full suite triggers
    if (FULL_SUITE_TRIGGERS.includes(basename)) {
      needFullSuite = true;
      break;
    }

    // AI files
    if (AI_SOURCE_PATTERN.test(filePath)) {
      affectedTests.add(aiTestFile);
      continue;
    }

    // Check the mapping
    const mapped = SOURCE_TO_TESTS[basename];
    if (mapped) {
      for (const t of mapped) affectedTests.add(t);
    } else if (filePath.includes('src/engine/') || filePath.includes('src/ui/')) {
      // Unknown engine/ui file — be conservative
      needFullSuite = true;
      break;
    }
    // Other files (non-src) are ignored — no tests needed
  }

  if (needFullSuite) return null;
  if (affectedTests.size === 0) return ''; // empty string → skip tests entirely (no src changes)
  // Build regex: match any of the test file names
  return [...affectedTests].join('|');
}
