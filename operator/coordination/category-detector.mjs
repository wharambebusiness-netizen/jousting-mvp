// ============================================================
// Category Detector — Keyword-Based Task Category Auto-Detection
// ============================================================
// Scans task description text for keywords and assigns the best-
// matching category. Custom rules (regex patterns) take priority
// over built-in keyword mapping.
//
// Factory: createCategoryDetector(ctx) returns detector methods.
// ============================================================

// ── Built-in keyword → category mapping ─────────────────────
// Declaration order matters for tie-breaking (first wins).

const BUILT_IN_CATEGORIES = [
  {
    name: 'planning',
    keywords: ['plan', 'design', 'architect', 'requirements', 'spec', 'analyze', 'research'],
  },
  {
    name: 'development',
    keywords: ['implement', 'code', 'build', 'create', 'add', 'develop', 'refactor', 'write'],
  },
  {
    name: 'testing',
    keywords: ['test', 'verify', 'validate', 'check', 'assert', 'spec', 'coverage', 'regression'],
  },
  {
    name: 'debugging',
    keywords: ['debug', 'fix', 'bug', 'issue', 'error', 'crash', 'investigate', 'diagnose'],
  },
  {
    name: 'review',
    keywords: ['review', 'audit', 'inspect', 'examine', 'approve', 'feedback'],
  },
  {
    name: 'deployment',
    keywords: ['deploy', 'release', 'publish', 'ship', 'rollout', 'migrate'],
  },
  {
    name: 'documentation',
    keywords: ['document', 'readme', 'docs', 'comment', 'explain', 'describe'],
  },
];

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a category detector for auto-assigning task categories.
 * @param {object} [ctx]
 * @param {Array<{pattern: RegExp, category: string}>} [ctx.customRules] - Custom rules checked first
 * @returns {object} Detector methods
 */
export function createCategoryDetector(ctx = {}) {
  const customRules = [...(ctx.customRules || [])];

  // Pre-compile word-boundary regexes for each keyword
  const builtInRegexes = BUILT_IN_CATEGORIES.map(cat => ({
    name: cat.name,
    patterns: cat.keywords.map(kw => new RegExp(`\\b${kw}`, 'i')),
  }));

  /**
   * Detect the best-matching category for a task text.
   * Custom rules are checked first (first match wins).
   * Then built-in keywords are scored — highest count wins, ties broken by declaration order.
   *
   * @param {string} taskText - The task description to analyze
   * @returns {string|null} Best-match category or null
   */
  function detect(taskText) {
    if (!taskText || typeof taskText !== 'string') return null;
    const text = taskText.trim();
    if (!text) return null;

    // 1. Check custom rules first (first match wins)
    for (const rule of customRules) {
      if (rule.pattern instanceof RegExp) {
        if (rule.pattern.test(text)) return rule.category;
      }
    }

    // 2. Score built-in categories by keyword hit count
    let bestCategory = null;
    let bestScore = 0;

    for (const cat of builtInRegexes) {
      let score = 0;
      for (const pattern of cat.patterns) {
        if (pattern.test(text)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = cat.name;
      }
      // Ties: declaration order wins (first category to reach bestScore keeps it)
    }

    return bestCategory;
  }

  /**
   * Get list of all known category names.
   * @returns {string[]}
   */
  function getCategories() {
    const names = BUILT_IN_CATEGORIES.map(c => c.name);
    // Add any custom categories not already in the list
    for (const rule of customRules) {
      if (!names.includes(rule.category)) {
        names.push(rule.category);
      }
    }
    return names;
  }

  /**
   * Add a custom detection rule (checked before built-in rules).
   * @param {{pattern: RegExp, category: string}} rule
   */
  function addRule(rule) {
    if (!rule || !rule.pattern || !rule.category) {
      throw new Error('Rule must have pattern and category');
    }
    customRules.push(rule);
  }

  return { detect, getCategories, addRule };
}
