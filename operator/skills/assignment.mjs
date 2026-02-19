// ============================================================
// Skill Assignment — Role-to-Skills Mapping + Re-evaluation
// ============================================================
// Maps agent roles to skill sets using AGENT_PROFILES from the
// selector, resolves dependencies via the resolver, and supports
// per-turn re-evaluation (prune unused, add discovered).
//
// Usage:
//   import { assignSkillsToAgent, reassignSkills } from './assignment.mjs';
//   const skills = assignSkillsToAgent(agentConfig, registry);
//   const updated = reassignSkills(agentId, currentSkills, tracker, registry);
// ============================================================

import { AGENT_PROFILES, selectProfileSkills, selectSkills } from './selector.mjs';
import { resolveSkillSet } from './resolver.mjs';

// ── Role-to-Profile Mapping ─────────────────────────────────

/**
 * Map of orchestrator roles to skill profile names.
 * Roles not in this map use auto-detection based on role metadata.
 */
const ROLE_PROFILE_MAP = {
  // Code agents → code-writer profile
  'engine-dev':         'code-writer',
  'ui-dev':             'code-writer',
  'backend-dev':        'code-writer',
  'full-stack-dev':     'code-writer',
  'database-dev':       'code-writer',
  'css-artist':         'code-writer',

  // Quality agents → tester profile
  'qa-engineer':        'tester',
  'test-generator':     'tester',
  'integration-tester': 'tester',

  // Review/coordination → reviewer profile
  'tech-lead':          'reviewer',
  'self-reviewer':      'reviewer',
  'architect':          'reviewer',

  // Security → auditor profile
  'security-auditor':   'auditor',

  // Research/analysis → researcher profile
  'research-agent':     'researcher',
  'performance-analyst':'researcher',
  'balance-analyst':    'researcher',
  'game-designer':      'researcher',

  // Operations → deployer profile
  'devops':             'deployer',

  // Debugging/refactoring → code-writer (need write + test)
  'debugger':           'code-writer',
  'refactorer':         'code-writer',

  // Coordination (no code) → reviewer
  'producer':           'reviewer',
  'docs-writer':        'reviewer',
  'dependency-manager': 'researcher',
};

/**
 * Determine the best skill profile for an agent based on its role and metadata.
 * @param {object} agentConfig - Agent configuration with role, type, etc.
 * @returns {string} Profile name from AGENT_PROFILES
 */
export function detectProfile(agentConfig) {
  const role = agentConfig.role || agentConfig.id;

  // Explicit mapping first
  if (ROLE_PROFILE_MAP[role]) {
    return ROLE_PROFILE_MAP[role];
  }

  // Auto-detect from agent metadata
  if (agentConfig.canTest || agentConfig.type === 'tester') return 'tester';
  if (agentConfig.canWrite === false) return 'reviewer';
  if (agentConfig.isCodeAgent) return 'code-writer';

  // Default
  return 'code-writer';
}

/**
 * Assign skills to an agent based on its role, task context, and the skill registry.
 *
 * Strategy:
 *   1. Map role → profile → core skills
 *   2. If task text provided, use selectSkills() for task-specific additions
 *   3. Resolve all dependencies
 *   4. Return final skill set (3-8 skills, not bulk-loaded)
 *
 * @param {object} agentConfig - Agent config (role, id, tasks, etc.)
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @param {object} [options]
 * @param {string} [options.taskText] - Task description for context-aware selection
 * @param {boolean} [options.includeOptional=false] - Include optional profile skills
 * @param {number} [options.maxSkills=8] - Maximum skills to assign
 * @returns {{ skills: string[], profile: string, resolved: string[] }}
 */
export function assignSkillsToAgent(agentConfig, registry, options = {}) {
  const { taskText, includeOptional = false, maxSkills = 8 } = options;
  const profile = detectProfile(agentConfig);

  // Step 1: Get profile core skills
  const { core, optional } = selectProfileSkills(profile, registry, { includeOptional });
  const skillIds = new Set(core.map(s => s.id));

  // Add optional skills if requested
  for (const s of optional) {
    if (skillIds.size < maxSkills) skillIds.add(s.id);
  }

  // Step 2: Task-specific skill selection
  if (taskText) {
    const taskSkills = selectSkills(taskText, registry, {
      maxResults: 3,
      minScore: 10,
      readOnly: agentConfig.canWrite === false,
    });
    for (const scored of taskSkills) {
      if (skillIds.size < maxSkills) skillIds.add(scored.skill.id);
    }
  }

  // Step 3: Resolve dependencies
  const resolution = resolveSkillSet([...skillIds], registry);

  // Cap at maxSkills (deps are mandatory, so they stay)
  const finalSkills = resolution.resolved.slice(0, maxSkills);

  return {
    skills: finalSkills,
    profile,
    resolved: resolution.resolved,
    suggestions: resolution.suggestions,
    conflicts: resolution.conflicts,
    missing: resolution.missing,
  };
}

/**
 * Re-evaluate skill assignment for an agent based on usage data.
 *
 * Strategy:
 *   - Prune skills unused in the last N rounds
 *   - Add skills that were discovered (used but not assigned)
 *   - Re-resolve dependencies after changes
 *
 * @param {string[]} currentSkills - Currently assigned skill IDs
 * @param {object} tracker - Skill tracker from tracker.mjs
 * @param {string} agentId
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @param {object} [options]
 * @param {number} [options.lookback=3] - Rounds of history to consider
 * @returns {{ skills: string[], pruned: string[], promoted: string[] }}
 */
export function reassignSkills(currentSkills, tracker, agentId, registry, options = {}) {
  const { lookback = 3 } = options;

  const { prune, promote } = tracker.suggestAdjustments(agentId, { lookback });

  // Apply pruning
  let updatedSkills = currentSkills.filter(id => !prune.includes(id));

  // Apply promotions (skills discovered by the agent)
  for (const id of promote) {
    if (!updatedSkills.includes(id) && registry.get(id)) {
      updatedSkills.push(id);
    }
  }

  // Re-resolve dependencies
  const resolution = resolveSkillSet(updatedSkills, registry);

  return {
    skills: resolution.resolved,
    pruned: prune.filter(id => currentSkills.includes(id)),
    promoted: promote.filter(id => registry.get(id)),
  };
}

// Export for testing
export { ROLE_PROFILE_MAP };
