// ============================================================
// Skill Selector — Two-Stage Selection Pipeline
// ============================================================
// Stage 1: Category-based coarse filter (keyword, tag intersection)
// Stage 2: Scoring/ranking for fine selection
//
// Usage:
//   import { selectSkills } from './selector.mjs';
//   const ranked = selectSkills('commit my changes and push', registry);
//   // Returns top skills ranked by relevance score
// ============================================================

/**
 * @typedef {object} ScoredSkill
 * @property {object} skill - The skill manifest
 * @property {number} score - Relevance score (0-100)
 * @property {string[]} matchReasons - Why this skill matched
 */

/**
 * Tokenize a query string into lowercase words for matching.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9-]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Score a skill against a set of query tokens.
 * @param {object} skill - Skill manifest
 * @param {string[]} queryTokens - Tokenized query
 * @param {object} options
 * @returns {ScoredSkill}
 */
function scoreSkill(skill, queryTokens, options = {}) {
  let score = 0;
  const matchReasons = [];

  // --- Name match (high weight) ---
  const nameTokens = tokenize(skill.name);
  const nameOverlap = queryTokens.filter(t => nameTokens.some(nt => nt.includes(t) || t.includes(nt)));
  if (nameOverlap.length > 0) {
    score += 30 * (nameOverlap.length / Math.max(nameTokens.length, 1));
    matchReasons.push(`name match: ${nameOverlap.join(', ')}`);
  }

  // --- Tag match (high weight) ---
  const tagOverlap = queryTokens.filter(t => skill.tags.some(tag => tag === t || tag.includes(t) || t.includes(tag)));
  if (tagOverlap.length > 0) {
    score += 25 * (tagOverlap.length / Math.max(skill.tags.length, 1));
    matchReasons.push(`tag match: ${tagOverlap.join(', ')}`);
  }

  // --- Trigger example match (medium weight) ---
  if (skill.triggerExamples) {
    const queryLower = queryTokens.join(' ');
    let bestExampleScore = 0;
    for (const example of skill.triggerExamples) {
      const exTokens = tokenize(example);
      const overlap = queryTokens.filter(t => exTokens.some(et => et === t));
      const exScore = overlap.length / Math.max(exTokens.length, 1);
      if (exScore > bestExampleScore) bestExampleScore = exScore;
    }
    if (bestExampleScore > 0) {
      score += 20 * bestExampleScore;
      matchReasons.push('trigger example match');
    }
  }

  // --- Description match (lower weight) ---
  const descTokens = tokenize(skill.description);
  const descOverlap = queryTokens.filter(t => descTokens.some(dt => dt === t));
  if (descOverlap.length > 0) {
    score += 10 * Math.min(descOverlap.length / queryTokens.length, 1);
    matchReasons.push(`description match: ${descOverlap.length} words`);
  }

  // --- Short description match ---
  if (skill.shortDescription) {
    const shortTokens = tokenize(skill.shortDescription);
    const shortOverlap = queryTokens.filter(t => shortTokens.some(st => st === t));
    if (shortOverlap.length > 0) {
      score += 5 * Math.min(shortOverlap.length / queryTokens.length, 1);
    }
  }

  // --- Category bonus (if query mentions category-like words) ---
  if (options.preferredCategory && skill.category === options.preferredCategory) {
    score += 10;
    matchReasons.push(`preferred category: ${skill.category}`);
  }

  // --- Side-effects penalty for read-only contexts ---
  if (options.readOnly && skill.sideEffects) {
    score -= 15;
    matchReasons.push('penalized: has side effects in read-only context');
  }

  // --- Model cost bonus (prefer cheaper models) ---
  if (options.preferCheap) {
    const modelBonus = { haiku: 5, sonnet: 2, opus: 0 };
    score += modelBonus[skill.model] || 0;
  }

  return { skill, score: Math.max(0, Math.round(score * 10) / 10), matchReasons };
}

/**
 * Detect likely category from query keywords.
 * @param {string[]} tokens
 * @returns {string|null}
 */
function detectCategory(tokens) {
  const categoryKeywords = {
    git: ['git', 'commit', 'push', 'pull', 'branch', 'merge', 'status', 'diff', 'stash'],
    code: ['file', 'read', 'write', 'edit', 'lint', 'format', 'refactor'],
    research: ['search', 'find', 'lookup', 'documentation', 'api', 'reference', 'detect', 'scan'],
    audit: ['audit', 'review', 'security', 'vulnerability', 'coverage', 'accessibility', 'performance'],
    testing: ['test', 'tests', 'vitest', 'jest', 'pytest', 'runner', 'suite'],
    analysis: ['analyze', 'report', 'status', 'health', 'dashboard', 'metrics', 'agent'],
  };

  let bestCategory = null;
  let bestCount = 0;

  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    const count = tokens.filter(t => keywords.some(kw => kw === t || kw.includes(t))).length;
    if (count > bestCount) {
      bestCount = count;
      bestCategory = cat;
    }
  }

  return bestCount > 0 ? bestCategory : null;
}

/**
 * Select skills matching a natural-language query using two-stage pipeline.
 *
 * Stage 1: Coarse filter by category detection and tag intersection.
 * Stage 2: Score and rank all candidates, return top results.
 *
 * @param {string} query - Natural language description of what the agent needs
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @param {object} [options]
 * @param {number} [options.maxResults=8] - Maximum skills to return
 * @param {number} [options.minScore=5] - Minimum relevance score to include
 * @param {boolean} [options.readOnly=false] - Penalize skills with side effects
 * @param {boolean} [options.preferCheap=false] - Prefer cheaper model skills
 * @param {string} [options.preferredCategory] - Boost skills in this category
 * @returns {ScoredSkill[]}
 */
export function selectSkills(query, registry, options = {}) {
  const {
    maxResults = 8,
    minScore = 5,
    readOnly = false,
    preferCheap = false,
    preferredCategory: explicitCategory,
  } = options;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Stage 1: Coarse filter
  const detectedCategory = explicitCategory || detectCategory(queryTokens);
  let candidates;

  if (detectedCategory) {
    // Get category skills + tag-matching skills from other categories
    const categorySkills = registry.search({ category: detectedCategory });
    const tagSkills = registry.search({ tags: queryTokens });
    const seen = new Set();
    candidates = [];

    for (const skill of [...categorySkills, ...tagSkills]) {
      if (!seen.has(skill.id)) {
        candidates.push(skill);
        seen.add(skill.id);
      }
    }

    // If too few candidates, fall back to all skills
    if (candidates.length < 3) {
      candidates = registry.list();
    }
  } else {
    // No category detected — search all skills
    candidates = registry.list();
  }

  // Stage 2: Score and rank
  const scored = candidates.map(skill =>
    scoreSkill(skill, queryTokens, {
      preferredCategory: detectedCategory,
      readOnly,
      preferCheap,
    }),
  );

  // Sort by score descending, filter by minimum score
  return scored
    .filter(s => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Select skills for an agent profile (preset skill sets for common roles).
 * @param {string} profileName - Agent profile name
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @returns {object[]} Matching skills
 */
export const AGENT_PROFILES = {
  'code-writer':  { core: ['file-read', 'test-runner', 'codebase-search'], optional: ['lint', 'git-status'] },
  'reviewer':     { core: ['file-read', 'codebase-search', 'lint'], optional: ['git-status', 'code-review'] },
  'deployer':     { core: ['git-status', 'git-commit', 'git-push'], optional: ['test-runner'] },
  'researcher':   { core: ['web-search', 'codebase-search', 'file-read'], optional: ['project-detect'] },
  'auditor':      { core: ['file-read', 'codebase-search', 'security-scan'], optional: ['accessibility-audit', 'performance-audit', 'dependency-audit'] },
  'tester':       { core: ['test-runner', 'file-read', 'codebase-search'], optional: ['lint', 'test-coverage-audit'] },
};

/**
 * Get skills for an agent profile.
 * @param {string} profileName
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @param {object} [options]
 * @param {boolean} [options.includeOptional=false] - Include optional skills
 * @returns {{ core: object[], optional: object[] }}
 */
export function selectProfileSkills(profileName, registry, options = {}) {
  const profile = AGENT_PROFILES[profileName];
  if (!profile) return { core: [], optional: [] };

  const core = profile.core.map(id => registry.get(id)).filter(Boolean);
  const optional = options.includeOptional
    ? profile.optional.map(id => registry.get(id)).filter(Boolean)
    : [];

  return { core, optional };
}
