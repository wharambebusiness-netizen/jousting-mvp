import { describe, it, expect } from 'vitest';
import { validateCheckpoint, collectCheckpointState } from './checkpoint.mjs';

// ── validateCheckpoint ──────────────────────────────────────

describe('validateCheckpoint', () => {
  it('returns invalid for null checkpoint', () => {
    const result = validateCheckpoint(null, 'abc123');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no checkpoint');
  });

  it('returns invalid for checkpoint missing headSha', () => {
    const result = validateCheckpoint({ round: 1 }, 'abc123');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('missing headSha');
  });

  it('returns invalid on SHA mismatch', () => {
    const result = validateCheckpoint({ headSha: 'aaa11111' }, 'bbb22222');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('HEAD mismatch');
    expect(result.reason).toContain('aaa11111');
    expect(result.reason).toContain('bbb22222');
  });

  it('returns valid when SHAs match', () => {
    const result = validateCheckpoint({ headSha: 'abc123' }, 'abc123');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('handles undefined currentHeadSha', () => {
    const result = validateCheckpoint({ headSha: 'abc' }, undefined);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('HEAD mismatch');
  });
});

// ── collectCheckpointState ──────────────────────────────────

describe('collectCheckpointState', () => {
  function makeState() {
    return {
      round: 3,
      globalElapsedMs: 120000,
      consecutiveTestFailures: 0,
      lastTestStatus: 'pass',
      stopReason: null,
      lastRunRound: { agent1: 2, agent2: 3 },
      consecutiveAgentFailures: { agent1: 0 },
      escalationCounts: {},
      consecutiveEmptyRounds: {},
      lastFailedRound: {},
      lastEscalatedRound: {},
      successesAfterEscalation: {},
      lastFailureDetails: { agent1: { round: 1, error: 'timeout' } },
      costLog: { agent1: { totalCost: 1.5, rounds: 2 } },
      roundLog: [{ round: 1, agents: ['agent1'] }],
      roundDecisions: [{ round: 1, decision: 'continue' }],
      agentSessions: { agent1: 'session-xyz' },
      agentRuntimeHistory: { agent1: [{ round: 1, elapsedMs: 5000 }] },
      agentEffectiveness: { agent1: { successRate: 0.8 } },
      missionState: { currentMission: 0 },
      headSha: 'abc123',
      agentModels: [{ id: 'agent1', model: 'sonnet' }],
    };
  }

  it('returns all expected keys', () => {
    const result = collectCheckpointState(makeState());
    const expectedKeys = [
      'round', 'globalElapsedMs', 'consecutiveTestFailures', 'lastTestStatus',
      'stopReason', 'lastRunRound', 'consecutiveAgentFailures', 'escalationCounts',
      'consecutiveEmptyRounds', 'lastFailedRound', 'lastEscalatedRound',
      'successesAfterEscalation', 'lastFailureDetails', 'costLog', 'roundLog',
      'roundDecisions', 'agentSessions', 'agentRuntimeHistory', 'agentEffectiveness',
      'missionState', 'headSha', 'agentModels',
    ];
    for (const key of expectedKeys) {
      expect(result).toHaveProperty(key);
    }
  });

  it('deep clones nested objects (no shared references)', () => {
    const state = makeState();
    const result = collectCheckpointState(state);

    // Mutate originals
    state.costLog.agent1.totalCost = 999;
    state.lastFailureDetails.agent1.error = 'changed';
    state.roundLog.push({ round: 99 });
    state.agentModels[0].model = 'opus';

    // Checkpoint should be unaffected
    expect(result.costLog.agent1.totalCost).toBe(1.5);
    expect(result.lastFailureDetails.agent1.error).toBe('timeout');
    expect(result.roundLog).toHaveLength(1);
    expect(result.agentModels[0].model).toBe('sonnet');
  });

  it('shallow copies flat objects', () => {
    const state = makeState();
    const result = collectCheckpointState(state);

    state.lastRunRound.agent1 = 999;
    // lastRunRound uses spread, so checkpoint should be independent
    expect(result.lastRunRound.agent1).toBe(2);
  });

  it('handles null agentModels', () => {
    const state = makeState();
    state.agentModels = null;
    const result = collectCheckpointState(state);
    expect(result.agentModels).toBeNull();
  });

  it('preserves scalar values exactly', () => {
    const state = makeState();
    const result = collectCheckpointState(state);
    expect(result.round).toBe(3);
    expect(result.globalElapsedMs).toBe(120000);
    expect(result.consecutiveTestFailures).toBe(0);
    expect(result.lastTestStatus).toBe('pass');
    expect(result.stopReason).toBeNull();
    expect(result.headSha).toBe('abc123');
  });
});
