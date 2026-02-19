// ============================================================
// Skill Discovery Protocol — Mid-Task Skill Requests
// ============================================================
// File-based protocol for agents to request additional skills
// during a task. Similar to spawn-system.mjs's spawn request
// protocol: agents write JSON files, orchestrator picks them up.
//
// Protocol:
//   1. Agent writes: orchestrator/skill-requests/discover-{agentId}-{suffix}.json
//   2. Orchestrator detects files between rounds
//   3. Orchestrator evaluates via selectSkills() or direct ID lookup
//   4. Approved skills added to agent's active set
//
// Usage:
//   import { detectSkillRequests, processSkillRequest, generateDiscoveryPrompt } from './discovery.mjs';
//   const requests = detectSkillRequests(requestsDir);
//   for (const req of requests) {
//     const result = processSkillRequest(req, registry, currentSkills);
//     if (result.approved.length > 0) { ... }
//   }
// ============================================================

import { readFileSync, readdirSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

/**
 * @typedef {object} SkillRequest
 * @property {string} agentId - Requesting agent
 * @property {string} reason - Why the skill is needed
 * @property {string[]} [skillIds] - Specific skill IDs requested
 * @property {string} [query] - Natural language query for skill discovery
 * @property {string} [context] - Additional context about the task
 * @property {string} _filename - Source filename
 * @property {string} _sourcePath - Full source path
 */

/**
 * @typedef {object} SkillRequestResult
 * @property {string[]} approved - Skills approved and added
 * @property {string[]} denied - Skills denied (conflicts, missing, etc.)
 * @property {string[]} suggestions - Additional skills the system recommends
 * @property {string} [reason] - Explanation of decisions
 */

/**
 * Validate a skill request object.
 * @param {object} request
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSkillRequest(request) {
  const errors = [];

  if (!request.agentId || typeof request.agentId !== 'string') {
    errors.push('Missing or invalid agentId');
  }
  if (!request.reason || typeof request.reason !== 'string') {
    errors.push('Missing or invalid reason');
  }
  if (!request.skillIds && !request.query) {
    errors.push('Must provide either skillIds (array) or query (string)');
  }
  if (request.skillIds && !Array.isArray(request.skillIds)) {
    errors.push('skillIds must be an array');
  }
  if (request.query && typeof request.query !== 'string') {
    errors.push('query must be a string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Detect pending skill request files in the requests directory.
 * @param {string} requestsDir - Directory to scan
 * @returns {SkillRequest[]}
 */
export function detectSkillRequests(requestsDir) {
  if (!existsSync(requestsDir)) return [];

  const requests = [];
  const files = readdirSync(requestsDir);

  for (const file of files) {
    if (!file.startsWith('discover-') || !file.endsWith('.json')) continue;

    const filePath = join(requestsDir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const req = JSON.parse(content);
      req._filename = file;
      req._sourcePath = filePath;

      const { valid, errors } = validateSkillRequest(req);
      if (valid) {
        requests.push(req);
      }
      // Invalid requests are silently skipped (archived below)
    } catch (_) {
      // Malformed JSON — skip
    }
  }

  return requests;
}

/**
 * Process a skill request: resolve requested skills, check compatibility,
 * return approved/denied lists.
 *
 * @param {SkillRequest} request
 * @param {import('./registry.mjs').SkillRegistry} registry
 * @param {string[]} currentSkills - Agent's current skill set
 * @param {object} [options]
 * @param {number} [options.maxNewSkills=3] - Max skills to add per request
 * @param {Function} [options.selectFn] - Custom selection function for query-based requests
 * @returns {SkillRequestResult}
 */
export function processSkillRequest(request, registry, currentSkills = [], options = {}) {
  const { maxNewSkills = 3, selectFn } = options;
  const currentSet = new Set(currentSkills);
  const approved = [];
  const denied = [];
  const suggestions = [];

  let candidateIds = [];

  if (request.skillIds && request.skillIds.length > 0) {
    // Direct skill ID requests
    candidateIds = request.skillIds;
  } else if (request.query && selectFn) {
    // Query-based discovery via selector
    const results = selectFn(request.query);
    candidateIds = results.map(r => r.skill ? r.skill.id : r.id).filter(Boolean);
  }

  // Evaluate each candidate
  for (const id of candidateIds) {
    if (approved.length >= maxNewSkills) break;

    // Already assigned
    if (currentSet.has(id)) continue;

    const skill = registry.get(id);
    if (!skill) {
      denied.push(id);
      continue;
    }

    // Check for conflicts with current set + approved so far
    const activeSet = [...currentSkills, ...approved];
    let hasConflict = false;

    if (skill.conflicts) {
      for (const conflictId of skill.conflicts) {
        if (activeSet.includes(conflictId)) {
          hasConflict = true;
          break;
        }
      }
    }

    // Check reverse conflicts
    if (!hasConflict) {
      for (const existingId of activeSet) {
        const existing = registry.get(existingId);
        if (existing && existing.conflicts && existing.conflicts.includes(id)) {
          hasConflict = true;
          break;
        }
      }
    }

    if (hasConflict) {
      denied.push(id);
      continue;
    }

    approved.push(id);

    // Check if this skill brings enhancement suggestions
    if (skill.enhancedBy) {
      for (const enhId of skill.enhancedBy) {
        if (!currentSet.has(enhId) && !approved.includes(enhId) && registry.get(enhId)) {
          if (!suggestions.includes(enhId)) suggestions.push(enhId);
        }
      }
    }
  }

  return { approved, denied, suggestions };
}

/**
 * Archive a processed skill request file.
 * @param {SkillRequest} request
 * @param {string} archiveDir
 */
export function archiveSkillRequest(request, archiveDir) {
  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }
  const dest = join(archiveDir, request._filename);
  try {
    renameSync(request._sourcePath, dest);
  } catch (_) {
    // Best-effort archive
  }
}

/**
 * Generate the prompt snippet that tells agents how to request skills.
 * Injected into agent prompts by the agent runner.
 * @param {string} agentId
 * @param {string[]} currentSkills - Currently assigned skill IDs
 * @param {string} requestsDir - Relative path to the requests directory
 * @returns {string}
 */
export function generateDiscoveryPrompt(agentId, currentSkills, requestsDir) {
  const skillList = currentSkills.length > 0
    ? currentSkills.join(', ')
    : '(none assigned)';

  return [
    `--- SKILL DISCOVERY (optional) ---`,
    `Your current skills: ${skillList}`,
    `Need additional capabilities? Write a JSON file to ${requestsDir}:`,
    `  File: ${requestsDir}/discover-${agentId}-{any-suffix}.json`,
    `  Format: { "agentId": "${agentId}", "reason": "<why you need this>",`,
    `    "skillIds": ["<skill-id>"] }   OR`,
    `    "query": "<what capability you need>" }`,
    `  Available categories: git, code, research, audit, testing, analysis`,
    `  The orchestrator will evaluate and add approved skills next round.`,
  ].join('\n');
}
