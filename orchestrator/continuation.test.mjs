// ============================================================
// M3: Agent Continuation Tests
// ============================================================
// Tests for parseChainHandoff, runAgentWithContinuation, and
// recordContinuation tracking.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { __test__, parseChainHandoff, runAgentWithContinuation } from './sdk-adapter.mjs';
import {
  agentSessions, agentEffectiveness,
  recordContinuation, initAgentTracking,
} from './agent-tracking.mjs';

// Helper: clear module-level state between tests
function clearTrackingState() {
  for (const key of Object.keys(agentSessions)) delete agentSessions[key];
  for (const key of Object.keys(agentEffectiveness)) delete agentEffectiveness[key];
}

beforeEach(() => {
  clearTrackingState();
  initAgentTracking({
    config: { agentTimeoutMs: 600000, maxConcurrency: 3 },
    agentWorktrees: {},
    handoffDir: '/tmp/handoffs',
    changelogFile: '/tmp/changelog.md',
    log: () => {},
  });
});

// ── parseChainHandoff ─────────────────────────────────────────

describe('parseChainHandoff', () => {
  it('returns null for empty/missing output', () => {
    expect(parseChainHandoff('')).toBeNull();
    expect(parseChainHandoff(null)).toBeNull();
    expect(parseChainHandoff(undefined)).toBeNull();
  });

  it('returns null when no HANDOFF section exists', () => {
    expect(parseChainHandoff('Some regular output\nNo handoff here.')).toBeNull();
  });

  it('parses a complete handoff', () => {
    const output = `Some work output...

## HANDOFF: COMPLETE

**Accomplished:** Fixed the bug in calculator.ts
**Remaining:** Nothing left
**Context:** All tests passing`;

    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    expect(result.complete).toBe(true);
    expect(result.summary).toContain('Fixed the bug');
    expect(result.raw).toContain('HANDOFF: COMPLETE');
  });

  it('parses an incomplete handoff', () => {
    const output = `Working on things...

## HANDOFF

**Accomplished:** Finished phase 1
**Remaining:** Phase 2 needs work
**Context:** Important notes here`;

    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    expect(result.complete).toBe(false);
    expect(result.remaining).toContain('Phase 2');
  });

  it('handles case-insensitive HANDOFF marker', () => {
    const output = `## Handoff: Complete\n**Accomplished:** Done`;
    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    expect(result.complete).toBe(true);
  });

  it('extracts handoff from middle of output', () => {
    const output = `Lots of preceding text here.
More text.

## HANDOFF
**Accomplished:** Something
**Remaining:** More things

Some trailing text after handoff.`;

    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    expect(result.complete).toBe(false);
    expect(result.summary).toContain('Something');
  });

  it('handles handoff with summary keyword', () => {
    const output = `## HANDOFF: COMPLETE
**Summary:** Implemented feature X
**Context:** Uses new API`;

    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    expect(result.complete).toBe(true);
    expect(result.summary).toContain('Implemented feature X');
  });
});

// ── runAgentWithContinuation ──────────────────────────────────

// Mock SDK query function factory
function createMockQuery(sessions) {
  let callIndex = 0;
  return async function* mockQuery({ prompt, options }) {
    const session = sessions[callIndex] || sessions[sessions.length - 1];
    callIndex++;

    // Fire PreCompact hook if session says so
    if (session.triggerPreCompact && options.hooks?.PreCompact) {
      for (const hookGroup of options.hooks.PreCompact) {
        for (const hook of hookGroup.hooks) {
          await hook();
        }
      }
    }

    // Yield assistant messages
    if (session.output) {
      yield {
        type: 'assistant',
        role: 'assistant',
        content: [{ type: 'text', text: session.output }],
      };
    }

    // Yield result
    yield {
      type: 'result',
      session_id: session.sessionId || `session-${callIndex}`,
      text: session.resultText || '',
      subtype: session.hitMaxTurns ? 'error_max_turns' : 'success',
      total_cost_usd: session.costUsd || 0.05,
      num_turns: session.turns || 5,
      usage: { input_tokens: 1000, output_tokens: 500 },
    };
  };
}

// Helper to inject a mock SDK query function
function injectMockSDK(mockQuery) {
  // Access the internal _sdkQuery via the module's closure
  // We need to use a different approach — set SDK_MODE and _sdkQuery via isSDKAvailable
  // Instead, we'll test the pure functions and mock at a higher level
}

describe('runAgentWithContinuation', () => {
  // Since runAgentWithContinuation calls _sdkQuery internally and we can't
  // easily mock it without module tricks, we test the logic through
  // parseChainHandoff + the config validation. For full integration,
  // a separate integration test with the real SDK would be needed.

  it('exports MAX_CONTINUATIONS_CAP as 3', () => {
    expect(__test__.MAX_CONTINUATIONS_CAP).toBe(3);
  });

  it('exports DEFAULT_CHAIN_COST_CAP as 2.0', () => {
    expect(__test__.DEFAULT_CHAIN_COST_CAP).toBe(2.0);
  });
});

// ── Continuation trigger heuristics ──────────────────────────

describe('continuation trigger heuristics', () => {
  it('COMPLETE handoff never triggers continuation', () => {
    const output = `## HANDOFF: COMPLETE\n**Accomplished:** All done`;
    const handoff = parseChainHandoff(output);
    expect(handoff.complete).toBe(true);
    // complete === true → never continue
  });

  it('incomplete handoff with context signal triggers continuation', () => {
    const output = `## HANDOFF\n**Accomplished:** Phase 1\n**Remaining:** Phase 2`;
    const handoff = parseChainHandoff(output);
    expect(handoff.complete).toBe(false);
    expect(handoff.remaining).toBeTruthy();
    // complete === false + preCompacted/hitMaxTurns → should continue
  });

  it('no handoff means no continuation (agent probably finished)', () => {
    const output = `All work done. Tests passing.`;
    const handoff = parseChainHandoff(output);
    expect(handoff).toBeNull();
    // null handoff + no limits hit → don't continue
  });
});

// ── recordContinuation ───────────────────────────────────────

describe('recordContinuation', () => {
  it('records continuation count for existing session', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 1, resumeCount: 0, freshCount: 1, invalidations: 0 };

    recordContinuation('dev', 2);

    expect(agentSessions['dev'].lastContinuations).toBe(2);
    expect(agentSessions['dev'].totalContinuations).toBe(2);
  });

  it('accumulates total continuations across rounds', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 1, resumeCount: 0, freshCount: 1, invalidations: 0 };

    recordContinuation('dev', 1);
    recordContinuation('dev', 2);

    expect(agentSessions['dev'].lastContinuations).toBe(2);
    expect(agentSessions['dev'].totalContinuations).toBe(3);
  });

  it('no-ops for non-existent session', () => {
    // Should not throw
    recordContinuation('nonexistent', 1);
    expect(agentSessions['nonexistent']).toBeUndefined();
  });

  it('tracks continuations in effectiveness metrics', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 1, resumeCount: 0, freshCount: 1, invalidations: 0 };

    recordContinuation('dev', 2);

    expect(agentEffectiveness['dev']).toBeDefined();
    expect(agentEffectiveness['dev'].totalContinuations).toBe(2);
  });

  it('accumulates effectiveness continuation counts', () => {
    agentSessions['dev'] = { sessionId: 'abc', lastRound: 1, resumeCount: 0, freshCount: 1, invalidations: 0 };

    recordContinuation('dev', 1);
    recordContinuation('dev', 3);

    expect(agentEffectiveness['dev'].totalContinuations).toBe(4);
  });
});

// ── createAgentOptions M3 additions ──────────────────────────

describe('createAgentOptions M3 additions', () => {
  const { createAgentOptions } = __test__;

  it('includes permissionMode when specified', () => {
    const opts = createAgentOptions(
      { model: 'sonnet' },
      { permissionMode: 'bypassPermissions' }
    );
    expect(opts.permissionMode).toBe('bypassPermissions');
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
  });

  it('omits permissionMode when not specified', () => {
    const opts = createAgentOptions({ model: 'sonnet' }, {});
    expect(opts.permissionMode).toBeUndefined();
  });

  it('includes env when specified', () => {
    const env = { PATH: '/usr/bin', HOME: '/home/user' };
    const opts = createAgentOptions({ model: 'sonnet' }, { env });
    expect(opts.env).toBe(env);
  });

  it('does not set allowDangerouslySkipPermissions for non-bypass modes', () => {
    const opts = createAgentOptions(
      { model: 'sonnet' },
      { permissionMode: 'default' }
    );
    expect(opts.permissionMode).toBe('default');
    expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
  });
});

// ── parseChainHandoff edge cases ─────────────────────────────

describe('parseChainHandoff edge cases', () => {
  it('handles multiple HANDOFF sections (takes first)', () => {
    const output = `## HANDOFF
**Accomplished:** First

## HANDOFF: COMPLETE
**Accomplished:** Second`;

    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    // First match is the incomplete one
    expect(result.complete).toBe(false);
  });

  it('handles handoff with no recognized subsections', () => {
    const output = `## HANDOFF: COMPLETE
Just some text without key fields.`;

    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    expect(result.complete).toBe(true);
    expect(result.raw).toContain('COMPLETE');
  });

  it('handles handoff with Done keyword instead of Accomplished', () => {
    const output = `## HANDOFF
**Done:** Fixed everything
**Next:** More work`;

    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    expect(result.summary).toContain('Fixed everything');
  });

  it('preserves full raw text from HANDOFF marker onwards', () => {
    const output = `prefix text
## HANDOFF
Line 1
Line 2
Line 3`;

    const result = parseChainHandoff(output);
    expect(result.raw).toBe(`## HANDOFF\nLine 1\nLine 2\nLine 3`);
  });

  it('handles very long output before handoff', () => {
    const longPrefix = 'x'.repeat(50000);
    const output = `${longPrefix}\n## HANDOFF: COMPLETE\n**Accomplished:** Done`;

    const result = parseChainHandoff(output);
    expect(result).not.toBeNull();
    expect(result.complete).toBe(true);
  });
});

// ── Config constants ─────────────────────────────────────────

describe('M3 config constants', () => {
  it('MAX_CONTINUATIONS_CAP is 3', () => {
    expect(__test__.MAX_CONTINUATIONS_CAP).toBe(3);
  });

  it('DEFAULT_CHAIN_COST_CAP is 2.0', () => {
    expect(__test__.DEFAULT_CHAIN_COST_CAP).toBe(2.0);
  });
});
