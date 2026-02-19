// ============================================================
// Skill Usage Tracker — Analytics + Per-Turn Re-evaluation
// ============================================================
// Tracks which skills are assigned to agents, which get used,
// and builds usage statistics for optimization. Supports
// per-turn re-evaluation by identifying unused skills to prune
// and frequently-requested skills to promote.
//
// Usage:
//   import { createSkillTracker } from './tracker.mjs';
//   const tracker = createSkillTracker();
//   tracker.recordAssignment('agent-1', 'round-3', ['git-status', 'file-read']);
//   tracker.recordUsage('agent-1', 'round-3', 'git-status');
//   tracker.getUsageStats(); // aggregate stats
// ============================================================

/**
 * @typedef {object} AssignmentRecord
 * @property {string} agentId
 * @property {number} round
 * @property {string[]} skillIds - Skills assigned at start of round
 * @property {Set<string>} used - Skills actually used during the round
 * @property {number} timestamp
 */

/**
 * @typedef {object} UsageStats
 * @property {Object<string, number>} assignmentCount - How often each skill is assigned
 * @property {Object<string, number>} usageCount - How often each skill is used
 * @property {Object<string, number>} usageRate - usageCount / assignmentCount
 * @property {string[]} overAssigned - Skills assigned often but rarely used (rate < 0.2)
 * @property {string[]} highDemand - Skills used >80% of the time when assigned
 */

/**
 * Create a skill usage tracker.
 * @returns {object} Tracker API
 */
export function createSkillTracker() {
  /** @type {AssignmentRecord[]} */
  const history = [];

  /** @type {Map<string, AssignmentRecord>} agentId:round → current record */
  const current = new Map();

  /**
   * Record that skills were assigned to an agent for a round.
   * @param {string} agentId
   * @param {number} round
   * @param {string[]} skillIds
   */
  function recordAssignment(agentId, round, skillIds) {
    const key = `${agentId}:${round}`;
    const record = {
      agentId,
      round,
      skillIds: [...skillIds],
      used: new Set(),
      timestamp: Date.now(),
    };
    current.set(key, record);
    history.push(record);
  }

  /**
   * Record that a skill was actually used by an agent in a round.
   * @param {string} agentId
   * @param {number} round
   * @param {string} skillId
   */
  function recordUsage(agentId, round, skillId) {
    const key = `${agentId}:${round}`;
    const record = current.get(key);
    if (record) {
      record.used.add(skillId);
    }
  }

  /**
   * Record multiple skill usages at once.
   * @param {string} agentId
   * @param {number} round
   * @param {string[]} skillIds
   */
  function recordUsageBatch(agentId, round, skillIds) {
    for (const id of skillIds) {
      recordUsage(agentId, round, id);
    }
  }

  /**
   * Get the current assignment record for an agent/round.
   * @param {string} agentId
   * @param {number} round
   * @returns {AssignmentRecord|null}
   */
  function getAssignment(agentId, round) {
    return current.get(`${agentId}:${round}`) || null;
  }

  /**
   * Get unused skills for an agent in a round (assigned but not used).
   * @param {string} agentId
   * @param {number} round
   * @returns {string[]}
   */
  function getUnusedSkills(agentId, round) {
    const record = current.get(`${agentId}:${round}`);
    if (!record) return [];
    return record.skillIds.filter(id => !record.used.has(id));
  }

  /**
   * Get skills that were used but not originally assigned (discovered).
   * @param {string} agentId
   * @param {number} round
   * @returns {string[]}
   */
  function getDiscoveredSkills(agentId, round) {
    const record = current.get(`${agentId}:${round}`);
    if (!record) return [];
    return [...record.used].filter(id => !record.skillIds.includes(id));
  }

  /**
   * Get full history for a specific agent.
   * @param {string} agentId
   * @returns {AssignmentRecord[]}
   */
  function getAgentHistory(agentId) {
    return history.filter(r => r.agentId === agentId);
  }

  /**
   * Compute aggregate usage statistics across all history.
   * @returns {UsageStats}
   */
  function getUsageStats() {
    const assignmentCount = {};
    const usageCount = {};

    for (const record of history) {
      for (const id of record.skillIds) {
        assignmentCount[id] = (assignmentCount[id] || 0) + 1;
      }
      for (const id of record.used) {
        usageCount[id] = (usageCount[id] || 0) + 1;
      }
    }

    const usageRate = {};
    for (const [id, assigned] of Object.entries(assignmentCount)) {
      usageRate[id] = assigned > 0 ? (usageCount[id] || 0) / assigned : 0;
    }

    const overAssigned = Object.entries(usageRate)
      .filter(([, rate]) => rate < 0.2)
      .map(([id]) => id);

    const highDemand = Object.entries(usageRate)
      .filter(([, rate]) => rate > 0.8)
      .map(([id]) => id);

    return { assignmentCount, usageCount, usageRate, overAssigned, highDemand };
  }

  /**
   * Suggest skill adjustments for an agent based on recent history.
   * Skills unused in last N rounds get pruned, frequently discovered get promoted.
   * @param {string} agentId
   * @param {object} [options]
   * @param {number} [options.lookback=3] - Number of recent rounds to consider
   * @param {number} [options.pruneThreshold=0] - Max usage count to prune (0 = never used)
   * @returns {{ prune: string[], promote: string[] }}
   */
  function suggestAdjustments(agentId, options = {}) {
    const { lookback = 3, pruneThreshold = 0 } = options;
    const agentHistory = getAgentHistory(agentId);
    const recent = agentHistory.slice(-lookback);

    if (recent.length === 0) return { prune: [], promote: [] };

    // Count per-skill usage in recent rounds
    const skillUsage = {};
    const skillAssigned = {};
    const discovered = {};

    for (const record of recent) {
      for (const id of record.skillIds) {
        skillAssigned[id] = (skillAssigned[id] || 0) + 1;
      }
      for (const id of record.used) {
        skillUsage[id] = (skillUsage[id] || 0) + 1;
        if (!record.skillIds.includes(id)) {
          discovered[id] = (discovered[id] || 0) + 1;
        }
      }
    }

    // Prune: assigned but usage <= threshold across recent rounds
    const prune = Object.entries(skillAssigned)
      .filter(([id]) => (skillUsage[id] || 0) <= pruneThreshold)
      .map(([id]) => id);

    // Promote: discovered (used but not assigned) in 2+ recent rounds
    const promote = Object.entries(discovered)
      .filter(([, count]) => count >= 2)
      .map(([id]) => id);

    return { prune, promote };
  }

  /**
   * Clear all tracking data.
   */
  function clear() {
    history.length = 0;
    current.clear();
  }

  return {
    recordAssignment,
    recordUsage,
    recordUsageBatch,
    getAssignment,
    getUnusedSkills,
    getDiscoveredSkills,
    getAgentHistory,
    getUsageStats,
    suggestAdjustments,
    get size() { return history.length; },
    clear,
  };
}
