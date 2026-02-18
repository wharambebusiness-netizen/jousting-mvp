// Error recovery tests (M2b/M2c/M2d)
import { describe, it, expect } from 'vitest';
import {
  classifyError, classifyAssistantError, classifyResultError,
  getRetryDelay, withRetry, shouldTripCircuitBreaker,
  generateSyntheticHandoff, validateHandoff,
  BACKOFF_DELAYS, MAX_RETRIES, CIRCUIT_BREAKER_THRESHOLD,
  MIN_SUMMARY_LENGTH, MAX_HANDOFF_LENGTH,
} from '../errors.mjs';

// ── Error Classification ─────────────────────────────────────

describe('classifyError — thrown errors', () => {
  it('classifies rate limit errors as transient', () => {
    expect(classifyError(new Error('rate limit exceeded'))).toBe('transient');
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('transient');
  });

  it('classifies network errors as transient', () => {
    expect(classifyError({ message: 'ECONNRESET' })).toBe('transient');
    expect(classifyError({ message: 'ECONNREFUSED' })).toBe('transient');
    expect(classifyError({ message: 'ETIMEDOUT' })).toBe('transient');
    expect(classifyError({ message: 'socket hang up' })).toBe('transient');
    expect(classifyError({ message: 'fetch failed' })).toBe('transient');
  });

  it('classifies server errors as transient', () => {
    expect(classifyError(new Error('502 Bad Gateway'))).toBe('transient');
    expect(classifyError(new Error('503 Service Unavailable'))).toBe('transient');
    expect(classifyError(new Error('504 Gateway Timeout'))).toBe('transient');
    expect(classifyError(new Error('internal server error'))).toBe('transient');
  });

  it('classifies process exit code 1-2 as transient', () => {
    expect(classifyError(new Error('Claude Code process exited with code 1'))).toBe('transient');
    expect(classifyError(new Error('exited with code 2'))).toBe('transient');
  });

  it('classifies auth errors as fatal', () => {
    expect(classifyError(new Error('authentication failed'))).toBe('fatal');
    expect(classifyError(new Error('unauthorized'))).toBe('fatal');
    expect(classifyError(new Error('invalid api key'))).toBe('fatal');
  });

  it('classifies billing errors as fatal', () => {
    expect(classifyError(new Error('billing error'))).toBe('fatal');
    expect(classifyError(new Error('quota exceeded'))).toBe('fatal');
  });

  it('classifies spawn/binary errors as fatal', () => {
    expect(classifyError(new Error('executable not found at /usr/bin/claude'))).toBe('fatal');
    expect(classifyError(new Error('Failed to spawn Claude Code process'))).toBe('fatal');
    expect(classifyError(new Error('Cannot write to terminated process'))).toBe('fatal');
  });

  it('classifies user abort as fatal', () => {
    expect(classifyError(new Error('Claude Code process aborted by user'))).toBe('fatal');
    expect(classifyError(new Error('Operation aborted'))).toBe('fatal');
  });

  it('defaults to transient for unknown errors', () => {
    expect(classifyError(new Error('something weird happened'))).toBe('transient');
    expect(classifyError(new Error(''))).toBe('transient');
    expect(classifyError(null)).toBe('transient');
  });
});

describe('classifyAssistantError — in-band errors', () => {
  it('classifies transient assistant errors', () => {
    expect(classifyAssistantError('rate_limit')).toBe('transient');
    expect(classifyAssistantError('server_error')).toBe('transient');
    expect(classifyAssistantError('unknown')).toBe('transient');
    expect(classifyAssistantError('max_output_tokens')).toBe('transient');
  });

  it('classifies fatal assistant errors', () => {
    expect(classifyAssistantError('authentication_failed')).toBe('fatal');
    expect(classifyAssistantError('billing_error')).toBe('fatal');
    expect(classifyAssistantError('invalid_request')).toBe('fatal');
  });

  it('returns null for unknown error types', () => {
    expect(classifyAssistantError('something_new')).toBeNull();
    expect(classifyAssistantError(null)).toBeNull();
  });
});

describe('classifyResultError — result subtypes', () => {
  it('classifies max_turns as limit (not error)', () => {
    expect(classifyResultError('error_max_turns')).toBe('limit');
  });

  it('classifies execution error as transient', () => {
    expect(classifyResultError('error_during_execution')).toBe('transient');
  });

  it('classifies budget error as fatal', () => {
    expect(classifyResultError('error_max_budget_usd')).toBe('fatal');
  });

  it('classifies structured output error as fatal', () => {
    expect(classifyResultError('error_max_structured_output_retries')).toBe('fatal');
  });

  it('returns null for unknown subtypes', () => {
    expect(classifyResultError('something_else')).toBeNull();
  });
});

// ── Retry Logic ──────────────────────────────────────────────

describe('getRetryDelay', () => {
  it('returns correct backoff delays', () => {
    expect(getRetryDelay(0)).toBe(BACKOFF_DELAYS[0]);
    expect(getRetryDelay(1)).toBe(BACKOFF_DELAYS[1]);
    expect(getRetryDelay(2)).toBe(BACKOFF_DELAYS[2]);
  });

  it('caps at max delay for high attempts', () => {
    expect(getRetryDelay(10)).toBe(BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1]);
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const { result, attempts } = await withRetry(async () => 'ok');
    expect(result).toBe('ok');
    expect(attempts).toBe(1);
  });

  it('retries on transient error then succeeds', async () => {
    let callCount = 0;
    const { result, attempts } = await withRetry(async () => {
      callCount++;
      if (callCount < 2) throw new Error('timeout');
      return 'ok';
    }, { maxRetries: 2 });

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  }, 10000);

  it('aborts immediately on fatal error', async () => {
    let callCount = 0;
    const { error, attempts, classification } = await withRetry(async () => {
      callCount++;
      throw new Error('authentication failed');
    }, { maxRetries: 3 });

    expect(callCount).toBe(1);
    expect(attempts).toBe(1);
    expect(classification).toBe('fatal');
    expect(error.message).toContain('authentication');
  });

  it('returns error after exhausting retries', async () => {
    const { error, attempts, classification } = await withRetry(async () => {
      throw new Error('ECONNRESET');
    }, { maxRetries: 1 });

    expect(attempts).toBe(2);
    expect(classification).toBe('transient');
    expect(error.message).toBe('ECONNRESET');
  });

  it('calls onRetry callback', async () => {
    const retries = [];
    await withRetry(async (attempt) => {
      if (attempt < 1) throw new Error('timeout');
      return 'ok';
    }, {
      maxRetries: 2,
      onRetry: (attempt, delay, err) => retries.push({ attempt, delay }),
    });

    expect(retries.length).toBe(1);
    expect(retries[0].attempt).toBe(0);
    expect(retries[0].delay).toBe(BACKOFF_DELAYS[0]);
  });
});

// ── Circuit Breaker ──────────────────────────────────────────

describe('shouldTripCircuitBreaker', () => {
  it('does not trip below threshold', () => {
    expect(shouldTripCircuitBreaker(0)).toBe(false);
    expect(shouldTripCircuitBreaker(1)).toBe(false);
    expect(shouldTripCircuitBreaker(CIRCUIT_BREAKER_THRESHOLD - 1)).toBe(false);
  });

  it('trips at threshold', () => {
    expect(shouldTripCircuitBreaker(CIRCUIT_BREAKER_THRESHOLD)).toBe(true);
  });

  it('trips above threshold', () => {
    expect(shouldTripCircuitBreaker(CIRCUIT_BREAKER_THRESHOLD + 5)).toBe(true);
  });
});

// ── Synthetic Handoff ────────────────────────────────────────

describe('generateSyntheticHandoff', () => {
  it('generates handoff with error context', () => {
    const handoff = generateSyntheticHandoff({
      output: 'Partial work done here\nSome file edited',
      error: new Error('ECONNRESET'),
      sessionIndex: 2,
    });

    expect(handoff).toContain('## HANDOFF');
    expect(handoff).toContain('Session 3 crashed');
    expect(handoff).toContain('ECONNRESET');
    expect(handoff).toContain('Partial work done here');
  });

  it('handles empty output', () => {
    const handoff = generateSyntheticHandoff({
      output: '',
      error: 'timeout',
      sessionIndex: 0,
    });

    expect(handoff).toContain('no output captured');
    expect(handoff).toContain('Session 1 crashed');
  });

  it('truncates long output to 3000 chars', () => {
    const longOutput = 'x'.repeat(5000);
    const handoff = generateSyntheticHandoff({
      output: longOutput,
      error: 'err',
      sessionIndex: 0,
    });

    // The tail should be at most 3000 chars
    const contextMatch = handoff.match(/```\n([\s\S]*)\n```/);
    expect(contextMatch[1].length).toBeLessThanOrEqual(3000);
  });
});

// ── Handoff Validation (M2d) ─────────────────────────────────

describe('validateHandoff', () => {
  it('rejects null handoff', () => {
    const result = validateHandoff(null);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('no handoff');
  });

  it('rejects handoff with short summary', () => {
    const result = validateHandoff({ summary: 'short', remaining: 'stuff', raw: 'x' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('summary too short');
  });

  it('rejects incomplete handoff without remaining', () => {
    const result = validateHandoff({
      complete: false,
      summary: 'A summary that is definitely long enough to pass',
      remaining: '',
      raw: 'x',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('remaining');
  });

  it('rejects handoff that is too long', () => {
    const result = validateHandoff({
      summary: 'A summary that is definitely long enough',
      remaining: 'stuff to do',
      raw: 'x'.repeat(MAX_HANDOFF_LENGTH + 1),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('too long');
  });

  it('accepts valid incomplete handoff', () => {
    const result = validateHandoff({
      complete: false,
      summary: 'Did things A, B, and C across multiple files',
      remaining: 'Still need to do D and E',
      raw: '## HANDOFF\n**Accomplished:** stuff\n**Remaining:** more stuff',
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid complete handoff (no remaining needed)', () => {
    const result = validateHandoff({
      complete: true,
      summary: 'Completed the entire task successfully',
      remaining: '',
      raw: '## HANDOFF: COMPLETE\n**Accomplished:** everything',
    });
    expect(result.valid).toBe(true);
  });

  it('handles undefined summary field gracefully', () => {
    const result = validateHandoff({
      complete: false,
      remaining: 'stuff to do',
      raw: '## HANDOFF\n**Remaining:** stuff',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('summary');
  });
});

// ── Edge Cases (S82 review) ──────────────────────────────────

describe('classifyError edge cases', () => {
  it('classifies mixed fatal+transient message as fatal (fatal checked first)', () => {
    // Both "authentication" (fatal) and "timeout" (transient) patterns present
    expect(classifyError(new Error('authentication timeout occurred'))).toBe('fatal');
  });

  it('classifies TypeError as transient (default behavior)', () => {
    expect(classifyError(new TypeError('Cannot read properties of undefined'))).toBe('transient');
  });

  it('handles error-like objects without message property', () => {
    expect(classifyError({ code: 'ECONNRESET' })).toBe('transient');
  });

  it('withRetry with maxRetries 0 executes once and returns error', async () => {
    let callCount = 0;
    const { error, attempts } = await withRetry(
      async () => { callCount++; throw new Error('fail'); },
      { maxRetries: 0 }
    );
    expect(callCount).toBe(1);
    expect(attempts).toBe(1);
    expect(error.message).toBe('fail');
  });

  it('shouldTripCircuitBreaker returns false for negative numbers', () => {
    expect(shouldTripCircuitBreaker(-1)).toBe(false);
  });

  it('generateSyntheticHandoff handles null output', () => {
    const handoff = generateSyntheticHandoff({
      output: null,
      error: new Error('boom'),
      sessionIndex: 0,
    });
    expect(handoff).toContain('boom');
    expect(handoff).toContain('no output captured');
  });
});
