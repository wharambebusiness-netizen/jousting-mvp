import { describe, it, expect, beforeEach } from 'vitest';
import {
  agentRuntimeHistory, agentEffectiveness, agentSessions,
  recordAgentRuntime, getAdaptiveTimeout,
  recordAgentEffectiveness, getDynamicConcurrency,
  invalidateAgentSession, invalidateStaleSessions,
  initAgentTracking,
} from './agent-tracking.mjs';

// Helper: clear module-level state between tests
function clearState() {
  for (const key of Object.keys(agentRuntimeHistory)) delete agentRuntimeHistory[key];
  for (const key of Object.keys(agentEffectiveness)) delete agentEffectiveness[key];
  for (const key of Object.keys(agentSessions)) delete agentSessions[key];
}

// Initialize with a mock config
beforeEach(() => {
  clearState();
  initAgentTracking({
    config: { agentTimeoutMs: 600000, maxConcurrency: 3 },
    agentWorktrees: {},
    handoffDir: '/tmp/handoffs',
    changelogFile: '/tmp/changelog.md',
    log: () => {},
  });
});

// ── recordAgentRuntime ──────────────────────────────────────

describe('recordAgentRuntime', () => {
  it('records runtime for new agent', () => {
    recordAgentRuntime('dev', 120);
    expect(agentRuntimeHistory.dev).toEqual([120]);
  });

  it('accumulates multiple runtimes', () => {
    recordAgentRuntime('dev', 100);
    recordAgentRuntime('dev', 200);
    recordAgentRuntime('dev', 300);
    expect(agentRuntimeHistory.dev).toEqual([100, 200, 300]);
  });

  it('caps at RUNTIME_HISTORY_SIZE (5) entries', () => {
    for (let i = 1; i <= 7; i++) recordAgentRuntime('dev', i * 10);
    expect(agentRuntimeHistory.dev).toHaveLength(5);
    expect(agentRuntimeHistory.dev).toEqual([30, 40, 50, 60, 70]);
  });
});

// ── getAdaptiveTimeout ──────────────────────────────────────

describe('getAdaptiveTimeout', () => {
  it('returns configured timeout for first run (no history)', () => {
    expect(getAdaptiveTimeout({ id: 'dev' })).toBe(600000);
  });

  it('returns agent-specific timeout when no history', () => {
    expect(getAdaptiveTimeout({ id: 'dev', timeoutMs: 300000 })).toBe(300000);
  });

  it('adapts to 2x average runtime (clamped by 25% config floor)', () => {
    // Average 60s → 2x = 120000ms, but 25% of config (600000) = 150000ms
    // Max(120000, 150000, 120000) = 150000
    recordAgentRuntime('dev', 60);
    recordAgentRuntime('dev', 60);
    const timeout = getAdaptiveTimeout({ id: 'dev' });
    expect(timeout).toBe(150000);
  });

  it('never exceeds configured max', () => {
    // Average 400s → 2x = 800000ms, but config max = 600000
    recordAgentRuntime('dev', 400);
    expect(getAdaptiveTimeout({ id: 'dev' })).toBe(600000);
  });

  it('enforces floor of max(25% config, 120000ms)', () => {
    // Average 10s → 2x = 20000ms, 25% of config (600000) = 150000ms
    // Max(20000, 150000, 120000) = 150000
    recordAgentRuntime('dev', 10);
    expect(getAdaptiveTimeout({ id: 'dev' })).toBe(150000);
  });

  it('enforces minimum of 25% config timeout', () => {
    // Agent with 800000 config timeout → 25% = 200000
    // Average 50s → 2x = 100000, min(200000, 120000) = 200000
    recordAgentRuntime('dev', 50);
    const timeout = getAdaptiveTimeout({ id: 'dev', timeoutMs: 800000 });
    expect(timeout).toBe(200000);
  });
});

// ── recordAgentEffectiveness ────────────────────────────────

describe('recordAgentEffectiveness', () => {
  it('creates entry for new agent', () => {
    recordAgentEffectiveness('dev', {
      filesModified: ['a.ts', 'b.ts'],
      costEntry: { inputTokens: 5000, outputTokens: 2000, totalCost: 0.50 },
      elapsedSeconds: 120,
      isEmptyWork: false,
    });
    expect(agentEffectiveness.dev).toEqual({
      tasksCompleted: 1, totalFiles: 2, totalTokens: 7000,
      totalCost: 0.50, totalSeconds: 120, rounds: 1,
    });
  });

  it('accumulates across rounds', () => {
    recordAgentEffectiveness('dev', {
      filesModified: ['a.ts'], costEntry: { totalCost: 1.00, inputTokens: 0, outputTokens: 0 },
      elapsedSeconds: 60, isEmptyWork: false,
    });
    recordAgentEffectiveness('dev', {
      filesModified: ['b.ts', 'c.ts'], costEntry: { totalCost: 0.50, inputTokens: 0, outputTokens: 0 },
      elapsedSeconds: 90, isEmptyWork: false,
    });
    expect(agentEffectiveness.dev.rounds).toBe(2);
    expect(agentEffectiveness.dev.totalFiles).toBe(3);
    expect(agentEffectiveness.dev.totalCost).toBe(1.50);
    expect(agentEffectiveness.dev.totalSeconds).toBe(150);
    expect(agentEffectiveness.dev.tasksCompleted).toBe(2);
  });

  it('does not count empty work as task completed', () => {
    recordAgentEffectiveness('dev', {
      filesModified: [], costEntry: null, elapsedSeconds: 30, isEmptyWork: true,
    });
    expect(agentEffectiveness.dev.tasksCompleted).toBe(0);
    expect(agentEffectiveness.dev.rounds).toBe(1);
  });

  it('does not count zero files as task completed (even if not isEmptyWork)', () => {
    recordAgentEffectiveness('dev', {
      filesModified: [], costEntry: null, elapsedSeconds: 30, isEmptyWork: false,
    });
    expect(agentEffectiveness.dev.tasksCompleted).toBe(0);
  });

  it('handles null costEntry', () => {
    recordAgentEffectiveness('dev', {
      filesModified: ['a.ts'], costEntry: null, elapsedSeconds: 60, isEmptyWork: false,
    });
    expect(agentEffectiveness.dev.totalTokens).toBe(0);
    expect(agentEffectiveness.dev.totalCost).toBe(0);
  });
});

// ── getDynamicConcurrency ───────────────────────────────────

describe('getDynamicConcurrency', () => {
  it('returns configured value with no history', () => {
    expect(getDynamicConcurrency(5)).toBe(3);
  });

  it('returns configured value with only one agent history', () => {
    recordAgentRuntime('dev', 60);
    expect(getDynamicConcurrency(5)).toBe(3);
  });

  it('returns configured value when agents have similar speeds', () => {
    recordAgentRuntime('dev', 60);
    recordAgentRuntime('qa', 80);
    expect(getDynamicConcurrency(5)).toBe(3);
  });

  it('bumps concurrency when slowest is 3x+ faster', () => {
    recordAgentRuntime('fast', 30);
    recordAgentRuntime('slow', 120); // 4x ratio
    expect(getDynamicConcurrency(5)).toBe(4);
  });

  it('does not exceed agent count', () => {
    recordAgentRuntime('fast', 10);
    recordAgentRuntime('slow', 100); // 10x ratio
    // agentCount=3, configured=3, bumped would be 4 but capped at agentCount
    expect(getDynamicConcurrency(3)).toBe(3);
  });

  it('returns capped value when agentCount < configured', () => {
    recordAgentRuntime('fast', 10);
    recordAgentRuntime('slow', 100);
    // agentCount=2, configured=3 → bumped=min(4,2)=2
    // Function returns bumped (2) even though < configured
    expect(getDynamicConcurrency(2)).toBe(2);
  });
});

// ── invalidateAgentSession ──────────────────────────────────

describe('invalidateAgentSession', () => {
  it('removes session for agent', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 3 };
    invalidateAgentSession('dev', 'test reason');
    expect(agentSessions.dev).toBeUndefined();
  });

  it('no-ops for unknown agent', () => {
    expect(() => invalidateAgentSession('unknown', 'test')).not.toThrow();
  });
});

// ── invalidateStaleSessions ─────────────────────────────────

describe('invalidateStaleSessions', () => {
  it('invalidates agent with 5+ consecutive empty rounds', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 5 };
    invalidateStaleSessions(10, { dev: 5 });
    expect(agentSessions.dev).toBeUndefined();
  });

  it('does not invalidate agent with <5 empty rounds', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 8 };
    invalidateStaleSessions(10, { dev: 4 });
    expect(agentSessions.dev).toBeDefined();
  });

  it('invalidates session older than 10 rounds', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 1 };
    invalidateStaleSessions(12, {});
    expect(agentSessions.dev).toBeUndefined();
  });

  it('does not invalidate recent session', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 5 };
    invalidateStaleSessions(10, {});
    expect(agentSessions.dev).toBeDefined();
  });
});
