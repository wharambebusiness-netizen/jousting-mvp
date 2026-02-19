// ============================================================
// Skill Resolver — Dependency Resolution + Conflict Detection
// ============================================================
// Given a set of requested skill IDs, resolve all transitive
// dependencies, detect conflicts, and suggest enhancements.
//
// Usage:
//   import { resolveSkillSet } from './resolver.mjs';
//   const result = resolveSkillSet(['git-commit', 'lint'], registry);
//   // result.resolved = ['git-status', 'git-commit', 'lint', 'file-read']
//   // result.conflicts = []
//   // result.suggestions = ['git-push']
// ============================================================

/**
 * @typedef {object} ResolveResult
 * @property {string[]} resolved - All skill IDs needed (requested + dependencies), topologically sorted
 * @property {Array<{skill: string, conflictsWith: string}>} conflicts - Detected conflict pairs
 * @property {Array<{skill: string, enhances: string}>} suggestions - Optional enhancement suggestions
 * @property {string[]} missing - Skill IDs that were requested or required but not found in registry
 */

/**
 * Resolve a set of skill IDs: expand dependencies, detect conflicts, suggest enhancements.
 * @param {string[]} requestedIds - Skill IDs the agent wants
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @returns {ResolveResult}
 */
export function resolveSkillSet(requestedIds, registry) {
  const resolved = new Set();
  const missing = new Set();
  const visiting = new Set(); // cycle detection

  // Recursive dependency walk
  function walk(id) {
    if (resolved.has(id)) return;
    if (visiting.has(id)) return; // cycle — skip silently

    const skill = registry.get(id);
    if (!skill) {
      missing.add(id);
      return;
    }

    visiting.add(id);

    // Resolve dependencies first (depth-first)
    if (skill.requires && skill.requires.length > 0) {
      for (const depId of skill.requires) {
        walk(depId);
      }
    }

    visiting.delete(id);
    resolved.add(id);
  }

  // Walk all requested skills
  for (const id of requestedIds) {
    walk(id);
  }

  // Detect conflicts between resolved skills
  const conflicts = [];
  const resolvedArray = [...resolved];

  for (const id of resolvedArray) {
    const skill = registry.get(id);
    if (!skill || !skill.conflicts) continue;

    for (const conflictId of skill.conflicts) {
      if (resolved.has(conflictId)) {
        // Avoid duplicate pair reports (A conflicts B == B conflicts A)
        const existing = conflicts.find(
          c => (c.skill === conflictId && c.conflictsWith === id),
        );
        if (!existing) {
          conflicts.push({ skill: id, conflictsWith: conflictId });
        }
      }
    }
  }

  // Suggest enhancements (skills in enhancedBy that aren't already resolved)
  const suggestions = [];
  const suggestedIds = new Set();

  for (const id of resolvedArray) {
    const skill = registry.get(id);
    if (!skill || !skill.enhancedBy) continue;

    for (const enhId of skill.enhancedBy) {
      if (!resolved.has(enhId) && !suggestedIds.has(enhId) && registry.get(enhId)) {
        suggestions.push({ skill: enhId, enhances: id });
        suggestedIds.add(enhId);
      }
    }
  }

  return {
    resolved: resolvedArray,
    conflicts,
    suggestions,
    missing: [...missing],
  };
}

/**
 * Check if a new skill can be added to an existing resolved set without conflicts.
 * @param {string} skillId - Skill to check
 * @param {string[]} currentSet - Currently resolved skill IDs
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @returns {{ compatible: boolean, conflicts: string[], missingDeps: string[] }}
 */
export function checkCompatibility(skillId, currentSet, registry) {
  const skill = registry.get(skillId);
  if (!skill) return { compatible: false, conflicts: [], missingDeps: [skillId] };

  const currentSetLookup = new Set(currentSet);
  const conflicts = [];
  const missingDeps = [];

  // Check if this skill conflicts with any in the current set
  if (skill.conflicts) {
    for (const conflictId of skill.conflicts) {
      if (currentSetLookup.has(conflictId)) {
        conflicts.push(conflictId);
      }
    }
  }

  // Check if any skill in current set declares a conflict with this one
  for (const existingId of currentSet) {
    const existing = registry.get(existingId);
    if (existing && existing.conflicts && existing.conflicts.includes(skillId)) {
      if (!conflicts.includes(existingId)) {
        conflicts.push(existingId);
      }
    }
  }

  // Check if all dependencies are available
  if (skill.requires) {
    for (const depId of skill.requires) {
      if (!currentSetLookup.has(depId) && !registry.get(depId)) {
        missingDeps.push(depId);
      }
    }
  }

  return {
    compatible: conflicts.length === 0 && missingDeps.length === 0,
    conflicts,
    missingDeps,
  };
}

/**
 * Topologically sort skills by their dependency order.
 * Skills with no dependencies come first, dependent skills come after.
 * @param {string[]} skillIds
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @returns {string[]}
 */
export function topologicalSort(skillIds, registry) {
  const idSet = new Set(skillIds);
  const sorted = [];
  const visited = new Set();
  const visiting = new Set();

  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // cycle — break it

    visiting.add(id);
    const skill = registry.get(id);
    if (skill && skill.requires) {
      for (const dep of skill.requires) {
        if (idSet.has(dep)) visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const id of skillIds) {
    visit(id);
  }

  return sorted;
}
