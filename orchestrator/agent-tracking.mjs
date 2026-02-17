// Agent Tracking Module (extracted from orchestrator.mjs in S66)
// Runtime history, effectiveness tracking, session continuity

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Module-level dependencies (set via init)
let logFn = () => {};
let CONFIG = null;
let agentWorktrees = null;
let HANDOFF_DIR = null;
let CHANGELOG_FILE = null;

// ============================================================
// Adaptive Timeouts (v10 — track per-agent runtime history)
// ============================================================
const RUNTIME_HISTORY_SIZE = 5;
const agentRuntimeHistory = {};  // agentId → number[] (elapsed seconds, last N runs)

// ============================================================
// Agent Effectiveness Tracking (v14 — per-agent productivity metrics)
// ============================================================
const agentEffectiveness = {};  // agentId → { tasksCompleted, totalFiles, totalTokens, totalCost, totalSeconds, rounds }

// ============================================================
// Agent Session Continuity (v16 — persist sessions across rounds)
// ============================================================
const agentSessions = {};  // agentId → { sessionId, lastRound, resumeCount, freshCount, invalidations }

/**
 * Initialize agent tracking with orchestrator context.
 * @param {{ config: object, agentWorktrees: object, handoffDir: string, changelogFile: string, log: Function }} ctx
 */
export function initAgentTracking(ctx) {
  logFn = ctx.log || (() => {});
  CONFIG = ctx.config;
  agentWorktrees = ctx.agentWorktrees;
  HANDOFF_DIR = ctx.handoffDir;
  CHANGELOG_FILE = ctx.changelogFile;
}

// Expose state objects for reporter and other modules
export { agentRuntimeHistory, agentEffectiveness, agentSessions };

export function recordAgentRuntime(agentId, elapsedSeconds) {
  if (!agentRuntimeHistory[agentId]) agentRuntimeHistory[agentId] = [];
  agentRuntimeHistory[agentId].push(elapsedSeconds);
  if (agentRuntimeHistory[agentId].length > RUNTIME_HISTORY_SIZE) {
    agentRuntimeHistory[agentId].shift();
  }
}

export function getAdaptiveTimeout(agent) {
  const configTimeout = agent.timeoutMs || CONFIG.agentTimeoutMs;
  const history = agentRuntimeHistory[agent.id];
  if (!history || history.length === 0) return configTimeout; // first run — use configured

  const avgSeconds = history.reduce((a, b) => a + b, 0) / history.length;
  const avgMs = avgSeconds * 1000;
  const adaptedMs = Math.max(2 * avgMs, configTimeout * 0.25, 120000);
  return Math.min(adaptedMs, configTimeout); // never exceed configured max
}

export function recordAgentEffectiveness(agentId, { filesModified, costEntry, elapsedSeconds, isEmptyWork }) {
  if (!agentEffectiveness[agentId]) {
    agentEffectiveness[agentId] = { tasksCompleted: 0, totalFiles: 0, totalTokens: 0, totalCost: 0, totalSeconds: 0, rounds: 0 };
  }
  const eff = agentEffectiveness[agentId];
  eff.rounds++;
  eff.totalSeconds += elapsedSeconds || 0;
  eff.totalFiles += (filesModified?.length || 0);
  if (costEntry) {
    eff.totalTokens += (costEntry.inputTokens || 0) + (costEntry.outputTokens || 0);
    eff.totalCost += costEntry.totalCost || 0;
  }
  if (!isEmptyWork && filesModified?.length > 0) {
    eff.tasksCompleted++;
  }
}

// v14: Dynamic concurrency — adjust pool size based on agent speed mix
export function getDynamicConcurrency(agentCount) {
  const configured = CONFIG.maxConcurrency;
  if (!configured || configured <= 0) return 0; // unlimited

  const histories = Object.values(agentRuntimeHistory);
  if (histories.length < 2) return configured; // not enough data yet

  const allAvgs = histories.map(h => h.reduce((a, b) => a + b, 0) / h.length);
  const fastest = Math.min(...allAvgs);
  const slowest = Math.max(...allAvgs);

  // If slowest agent is 3x+ slower than fastest, increase concurrency by 1
  // so fast agents aren't bottlenecked waiting for slow ones in the pool
  if (slowest > fastest * 3 && fastest > 0) {
    const bumped = Math.max(Math.min(configured + 1, agentCount), configured);
    if (bumped > configured) {
      logFn(`  Dynamic concurrency: ${configured} → ${bumped} (speed ratio ${(slowest/fastest).toFixed(1)}x)`);
    }
    return bumped;
  }
  return configured;
}

/**
 * Read an agent's handoff file content for inline injection into prompts.
 * Returns the full file content or null if unavailable.
 */
export function readHandoffContent(agentId) {
  // v21: Check worktree path first (agent may have updated handoff there)
  const wt = agentWorktrees[agentId];
  const wtPath = wt ? join(wt.path, 'orchestrator', 'handoffs', `${agentId}.md`) : null;
  const mainPath = join(HANDOFF_DIR, `${agentId}.md`);
  const handoffPath = (wtPath && existsSync(wtPath)) ? wtPath : mainPath;
  if (!existsSync(handoffPath)) return null;
  try {
    const content = readFileSync(handoffPath, 'utf-8');
    return content.trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Extract session changelog entries since a given round.
 * Parses the changelog file looking for "## Round N" headers and returns
 * only entries from rounds > sinceRound.
 */
export function getChangelogSinceRound(sinceRound) {
  if (!existsSync(CHANGELOG_FILE)) return null;
  try {
    const content = readFileSync(CHANGELOG_FILE, 'utf-8');
    const lines = content.split('\n');
    const relevantLines = [];
    let capturing = false;
    for (const line of lines) {
      const roundMatch = line.match(/^## Round (\d+)/);
      if (roundMatch) {
        capturing = parseInt(roundMatch[1]) > sinceRound;
      }
      if (capturing) {
        relevantLines.push(line);
      }
    }
    return relevantLines.length > 0 ? relevantLines.join('\n').trim() : null;
  } catch (_) {
    return null;
  }
}

/**
 * M3: Record a continuation event for an agent.
 * Tracks how often agents chain internally — signals if tasks need to be
 * broken into smaller pieces.
 * @param {string} agentId
 * @param {number} chainLength - Number of continuations (1 = one extra session)
 */
export function recordContinuation(agentId, chainLength) {
  if (agentSessions[agentId]) {
    agentSessions[agentId].lastContinuations = chainLength;
    agentSessions[agentId].totalContinuations = (agentSessions[agentId].totalContinuations || 0) + chainLength;
  }
  // Log as effectiveness signal
  if (!agentEffectiveness[agentId]) {
    agentEffectiveness[agentId] = { tasksCompleted: 0, totalFiles: 0, totalTokens: 0, totalCost: 0, totalSeconds: 0, rounds: 0 };
  }
  agentEffectiveness[agentId].totalContinuations = (agentEffectiveness[agentId].totalContinuations || 0) + chainLength;
}

/**
 * Invalidate an agent's session (e.g., after revert or mission transition).
 * The agent will start a fresh session on its next run.
 */
export function invalidateAgentSession(agentId, reason) {
  if (agentSessions[agentId]) {
    agentSessions[agentId].invalidations = (agentSessions[agentId].invalidations || 0) + 1;
    logFn(`  Session invalidated for ${agentId} (${reason})`);
    delete agentSessions[agentId];
  }
}

/**
 * v17: Invalidate stale sessions — agents that haven't been productive for too long
 * get a fresh session to avoid accumulated context drift.
 * @param {number} round - Current round
 * @param {Object} consecutiveEmptyRounds - Map of agentId → consecutive empty round count
 */
export function invalidateStaleSessions(round, consecutiveEmptyRounds) {
  const STALE_EMPTY_THRESHOLD = 5;  // Invalidate after 5 consecutive empty rounds
  const STALE_AGE_THRESHOLD = 10;   // Invalidate if session is 10+ rounds old without productive run

  for (const [agentId, session] of Object.entries(agentSessions)) {
    // Check consecutive empty rounds
    if ((consecutiveEmptyRounds[agentId] || 0) >= STALE_EMPTY_THRESHOLD) {
      invalidateAgentSession(agentId, `stale: ${consecutiveEmptyRounds[agentId]} consecutive empty rounds`);
      continue;
    }
    // Check session age vs productivity
    const sessionAge = round - (session.lastRound || 0);
    if (sessionAge >= STALE_AGE_THRESHOLD) {
      invalidateAgentSession(agentId, `stale: session ${sessionAge} rounds old (last active round ${session.lastRound})`);
    }
  }
}
