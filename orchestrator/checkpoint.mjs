// Checkpoint/Resume Module (M8)
// Serializes orchestrator state at round boundaries for crash recovery.
// On startup, detects and resumes from checkpoint if available.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const CHECKPOINT_VERSION = 1;

let CHECKPOINT_FILE = '';
let logFn = () => {};

export function initCheckpoint(ctx) {
  CHECKPOINT_FILE = join(ctx.orchDir, 'checkpoint.json');
  logFn = ctx.log;
}

/**
 * Write checkpoint to disk (atomic: temp + rename).
 * Called at the end of each round after all state mutations.
 */
export function writeCheckpoint(state) {
  const payload = {
    version: CHECKPOINT_VERSION,
    timestamp: new Date().toISOString(),
    ...state,
  };

  const tmpFile = CHECKPOINT_FILE + '.tmp';
  try {
    writeFileSync(tmpFile, JSON.stringify(payload, null, 2));
    renameSync(tmpFile, CHECKPOINT_FILE);
  } catch (err) {
    // Fallback: direct write if rename fails (cross-device, etc.)
    logFn(`  Checkpoint atomic write failed, trying direct: ${err.message}`);
    try {
      writeFileSync(CHECKPOINT_FILE, JSON.stringify(payload, null, 2));
    } catch (err2) {
      logFn(`  WARNING: Checkpoint write failed: ${err2.message}`);
    }
  }
}

/**
 * Load checkpoint from disk. Returns null if no checkpoint, invalid, or version mismatch.
 */
export function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return null;

  try {
    const data = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'));
    if (!data || data.version !== CHECKPOINT_VERSION) {
      logFn(`  Checkpoint version mismatch (expected ${CHECKPOINT_VERSION}, got ${data?.version}) — ignoring`);
      return null;
    }
    return data;
  } catch (err) {
    logFn(`  WARNING: Checkpoint parse failed: ${err.message} — ignoring`);
    return null;
  }
}

/**
 * Remove checkpoint file (called on successful completion).
 */
export function clearCheckpoint() {
  try {
    if (existsSync(CHECKPOINT_FILE)) {
      unlinkSync(CHECKPOINT_FILE);
    }
  } catch (_) { /* best-effort */ }
}

/**
 * Validate checkpoint against current git state.
 * Returns { valid, reason } — invalid if HEAD SHA doesn't match.
 */
export function validateCheckpoint(checkpoint, currentHeadSha) {
  if (!checkpoint) return { valid: false, reason: 'no checkpoint' };
  if (!checkpoint.headSha) return { valid: false, reason: 'checkpoint missing headSha' };
  if (checkpoint.headSha !== currentHeadSha) {
    return {
      valid: false,
      reason: `HEAD mismatch: checkpoint=${checkpoint.headSha.slice(0, 8)}, current=${currentHeadSha.slice(0, 8)}`,
    };
  }
  return { valid: true, reason: null };
}

/**
 * Collect all serializable state from orchestrator main() scope.
 * Called at end of each round.
 */
export function collectCheckpointState({
  round, globalElapsedMs, consecutiveTestFailures, lastTestStatus, stopReason,
  lastRunRound, consecutiveAgentFailures, escalationCounts, consecutiveEmptyRounds,
  lastFailedRound, lastEscalatedRound, successesAfterEscalation, lastFailureDetails,
  costLog, roundLog, roundDecisions,
  agentSessions, agentRuntimeHistory, agentEffectiveness,
  missionState, headSha,
  agentModels,
}) {
  return {
    round,
    globalElapsedMs,
    consecutiveTestFailures,
    lastTestStatus,
    stopReason,
    lastRunRound: { ...lastRunRound },
    consecutiveAgentFailures: { ...consecutiveAgentFailures },
    escalationCounts: { ...escalationCounts },
    consecutiveEmptyRounds: { ...consecutiveEmptyRounds },
    lastFailedRound: { ...lastFailedRound },
    lastEscalatedRound: { ...lastEscalatedRound },
    successesAfterEscalation: { ...successesAfterEscalation },
    lastFailureDetails: JSON.parse(JSON.stringify(lastFailureDetails)),
    costLog: JSON.parse(JSON.stringify(costLog)),
    roundLog: JSON.parse(JSON.stringify(roundLog)),
    roundDecisions: JSON.parse(JSON.stringify(roundDecisions)),
    agentSessions: JSON.parse(JSON.stringify(agentSessions)),
    agentRuntimeHistory: JSON.parse(JSON.stringify(agentRuntimeHistory)),
    agentEffectiveness: JSON.parse(JSON.stringify(agentEffectiveness)),
    missionState: JSON.parse(JSON.stringify(missionState)),
    headSha,
    agentModels,
  };
}

/**
 * Restore checkpoint state into mutable objects (by-reference mutation).
 * Shallow-copies checkpoint values into the live objects.
 */
export function restoreCheckpointState(checkpoint, targets) {
  const maps = [
    'lastRunRound', 'consecutiveAgentFailures', 'escalationCounts',
    'consecutiveEmptyRounds', 'lastFailedRound', 'lastEscalatedRound',
    'successesAfterEscalation', 'lastFailureDetails',
    'costLog', 'agentSessions', 'agentRuntimeHistory', 'agentEffectiveness',
  ];

  for (const key of maps) {
    if (checkpoint[key] && targets[key]) {
      // Clear existing keys
      for (const k of Object.keys(targets[key])) delete targets[key][k];
      // Copy from checkpoint
      Object.assign(targets[key], checkpoint[key]);
    }
  }

  // Restore arrays (roundLog, roundDecisions) — push checkpoint entries
  if (checkpoint.roundLog && targets.roundLog) {
    targets.roundLog.length = 0;
    targets.roundLog.push(...checkpoint.roundLog);
  }
  if (checkpoint.roundDecisions && targets.roundDecisions) {
    targets.roundDecisions.length = 0;
    targets.roundDecisions.push(...checkpoint.roundDecisions);
  }

  // Restore missionState
  if (checkpoint.missionState && targets.missionState) {
    Object.assign(targets.missionState, checkpoint.missionState);
  }

  // Restore agent model states (escalation may have changed agent.model)
  if (checkpoint.agentModels && targets.agents) {
    for (const am of checkpoint.agentModels) {
      const agent = targets.agents.find(a => a.id === am.id);
      if (agent) {
        agent.model = am.model;
        if (am._originalModel) agent._originalModel = am._originalModel;
      }
    }
  }

  logFn(`  Checkpoint state restored (round ${checkpoint.round}, ${Object.keys(checkpoint.costLog || {}).length} agents tracked)`);
}
