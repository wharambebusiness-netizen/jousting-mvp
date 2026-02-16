import { describe, it, expect } from 'vitest';
import {
  parseCostFromStderr,
  estimateCostFromTokens,
  ensureCostLogEntry,
  accumulateAgentCost,
  MODEL_PRICING,
} from './cost-tracker.mjs';

// ── parseCostFromStderr ─────────────────────────────────────

describe('parseCostFromStderr', () => {
  it('returns nulls for empty input', () => {
    expect(parseCostFromStderr('')).toEqual({ cost: null, inputTokens: null, outputTokens: null });
  });

  it('returns nulls for null/undefined', () => {
    expect(parseCostFromStderr(null)).toEqual({ cost: null, inputTokens: null, outputTokens: null });
    expect(parseCostFromStderr(undefined)).toEqual({ cost: null, inputTokens: null, outputTokens: null });
  });

  it('parses "Total cost: $X.XX"', () => {
    const { cost } = parseCostFromStderr('Some output\nTotal cost: $1.23\nDone');
    expect(cost).toBe(1.23);
  });

  it('parses "cost: $X.XX" (lowercase, no Total)', () => {
    const { cost } = parseCostFromStderr('cost: $0.45');
    expect(cost).toBe(0.45);
  });

  it('parses cost without dollar sign', () => {
    const { cost } = parseCostFromStderr('Total cost: 2.50');
    expect(cost).toBe(2.50);
  });

  it('parses "Total tokens: input=N, output=N"', () => {
    const result = parseCostFromStderr('Total tokens: input=1000, output=2000');
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(2000);
  });

  it('parses tokens with commas (thousands separators)', () => {
    const result = parseCostFromStderr('tokens: input=1,234,567, output=890,123');
    expect(result.inputTokens).toBe(1234567);
    expect(result.outputTokens).toBe(890123);
  });

  it('parses individual token lines', () => {
    const result = parseCostFromStderr('input_tokens: 500\noutput_tokens: 300');
    expect(result.inputTokens).toBe(500);
    expect(result.outputTokens).toBe(300);
  });

  it('parses cost and tokens together', () => {
    const result = parseCostFromStderr('Total cost: $1.50\nTotal tokens: input=10000, output=5000');
    expect(result.cost).toBe(1.50);
    expect(result.inputTokens).toBe(10000);
    expect(result.outputTokens).toBe(5000);
  });

  it('returns null for unrecognized text', () => {
    const result = parseCostFromStderr('Hello world, no cost info here');
    expect(result.cost).toBeNull();
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });
});

// ── estimateCostFromTokens ──────────────────────────────────

describe('estimateCostFromTokens', () => {
  it('calculates sonnet pricing correctly', () => {
    // 1M input tokens × $3/M + 1M output tokens × $15/M = $18
    const cost = estimateCostFromTokens(1_000_000, 1_000_000, 'sonnet');
    expect(cost).toBe(18);
  });

  it('calculates haiku pricing correctly', () => {
    // 1M input × $0.25/M + 1M output × $1.25/M = $1.50
    const cost = estimateCostFromTokens(1_000_000, 1_000_000, 'haiku');
    expect(cost).toBe(1.50);
  });

  it('calculates opus pricing correctly', () => {
    // 1M input × $15/M + 1M output × $75/M = $90
    const cost = estimateCostFromTokens(1_000_000, 1_000_000, 'opus');
    expect(cost).toBe(90);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const cost = estimateCostFromTokens(1_000_000, 1_000_000, 'future-model');
    expect(cost).toBe(18); // same as sonnet
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCostFromTokens(0, 0, 'sonnet')).toBe(0);
  });

  it('scales linearly with token count', () => {
    const base = estimateCostFromTokens(100_000, 50_000, 'sonnet');
    const doubled = estimateCostFromTokens(200_000, 100_000, 'sonnet');
    expect(doubled).toBeCloseTo(base * 2, 10);
  });
});

// ── ensureCostLogEntry ──────────────────────────────────────

describe('ensureCostLogEntry', () => {
  it('creates new entry for unknown agent', () => {
    const log = {};
    const entry = ensureCostLogEntry(log, 'agent-1');
    expect(entry).toEqual({ totalCost: 0, inputTokens: 0, outputTokens: 0, rounds: 0, escalations: 0 });
    expect(log['agent-1']).toBe(entry);
  });

  it('returns existing entry without modifying', () => {
    const existing = { totalCost: 5, inputTokens: 100, outputTokens: 200, rounds: 3, escalations: 1 };
    const log = { 'agent-1': existing };
    const entry = ensureCostLogEntry(log, 'agent-1');
    expect(entry).toBe(existing);
    expect(entry.totalCost).toBe(5);
  });
});

// ── accumulateAgentCost ─────────────────────────────────────

describe('accumulateAgentCost', () => {
  const agents = [
    { id: 'dev', model: 'sonnet' },
    { id: 'qa', model: 'haiku' },
  ];

  it('accumulates direct cost from stderr', () => {
    const costLog = {};
    accumulateAgentCost(costLog, {
      agentId: 'dev',
      stderr: 'Total cost: $1.50\nTotal tokens: input=10000, output=5000',
    }, agents);
    expect(costLog.dev.totalCost).toBe(1.50);
    expect(costLog.dev.inputTokens).toBe(10000);
    expect(costLog.dev.outputTokens).toBe(5000);
    expect(costLog.dev.rounds).toBe(1);
  });

  it('estimates cost when only tokens are available', () => {
    const costLog = {};
    accumulateAgentCost(costLog, {
      agentId: 'dev',
      stderr: 'tokens: input=1000000, output=500000',
    }, agents);
    // No direct cost → estimate: 1M×$3/M + 0.5M×$15/M = $3 + $7.5 = $10.5
    expect(costLog.dev.totalCost).toBeCloseTo(10.5, 5);
  });

  it('uses correct model pricing for estimation', () => {
    const costLog = {};
    accumulateAgentCost(costLog, {
      agentId: 'qa',
      stderr: 'tokens: input=1000000, output=1000000',
    }, agents);
    // haiku: 1M×$0.25/M + 1M×$1.25/M = $1.50
    expect(costLog.qa.totalCost).toBeCloseTo(1.50, 5);
  });

  it('accumulates across multiple rounds', () => {
    const costLog = {};
    accumulateAgentCost(costLog, { agentId: 'dev', stderr: 'Total cost: $1.00' }, agents);
    accumulateAgentCost(costLog, { agentId: 'dev', stderr: 'Total cost: $2.00' }, agents);
    expect(costLog.dev.totalCost).toBe(3.00);
    expect(costLog.dev.rounds).toBe(2);
  });

  it('handles unparseable stderr gracefully', () => {
    const costLog = {};
    accumulateAgentCost(costLog, { agentId: 'dev', stderr: 'no cost info' }, agents);
    expect(costLog.dev.totalCost).toBe(0);
    expect(costLog.dev.rounds).toBe(1);
  });

  it('handles unknown agent gracefully (default pricing)', () => {
    const costLog = {};
    accumulateAgentCost(costLog, {
      agentId: 'unknown',
      stderr: 'tokens: input=1000000, output=1000000',
    }, agents);
    // Unknown agent → default (sonnet) pricing: $3 + $15 = $18
    expect(costLog.unknown.totalCost).toBeCloseTo(18, 5);
  });
});

// ── MODEL_PRICING ───────────────────────────────────────────

describe('MODEL_PRICING', () => {
  it('has entries for haiku, sonnet, opus, and default', () => {
    expect(MODEL_PRICING).toHaveProperty('haiku');
    expect(MODEL_PRICING).toHaveProperty('sonnet');
    expect(MODEL_PRICING).toHaveProperty('opus');
    expect(MODEL_PRICING).toHaveProperty('default');
  });

  it('output is more expensive than input for all models', () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.output).toBeGreaterThan(pricing.input);
    }
  });

  it('opus > sonnet > haiku for input pricing', () => {
    expect(MODEL_PRICING.opus.input).toBeGreaterThan(MODEL_PRICING.sonnet.input);
    expect(MODEL_PRICING.sonnet.input).toBeGreaterThan(MODEL_PRICING.haiku.input);
  });
});
