// ============================================================
// Error Recovery Module (M2b)
// ============================================================
// Classifies SDK errors as transient vs fatal, manages retry
// with exponential backoff, generates synthetic handoffs from
// partial output, and implements circuit breaker logic.
//
// Handles TWO error surfaces:
// 1. Thrown errors (AbortError, Error from process exit/spawn)
// 2. In-band errors (message.error on assistant, subtype on result)
// ============================================================

// ── Thrown Error Classification ──────────────────────────────

const TRANSIENT_THROW_PATTERNS = [
  /rate.?limit/i,
  /429/,
  /overloaded/i,
  /timeout/i,
  /timed?\s*out/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
  /socket hang up/i,
  /network/i,
  /502/,
  /503/,
  /504/,
  /fetch failed/i,
  /server error/i,
  /internal server error/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /exited with code [12]\b/i,  // exit code 1-2 often transient
];

const FATAL_THROW_PATTERNS = [
  /authentication/i,
  /unauthorized/i,
  /invalid.?api.?key/i,
  /invalid.?model/i,
  /model.?not.?found/i,
  /billing/i,
  /quota.?exceeded/i,
  /executable not found/i,
  /Failed to spawn/i,
  /Cannot write to terminated/i,
  /aborted by user/i,
  /Operation aborted/i,
];

// ── In-Band Error Classification ─────────────────────────────

// SDKAssistantMessage.error field values
const ASSISTANT_ERROR_MAP = {
  'rate_limit':            'transient',
  'server_error':          'transient',
  'unknown':               'transient',
  'max_output_tokens':     'transient',
  'authentication_failed': 'fatal',
  'billing_error':         'fatal',
  'invalid_request':       'fatal',
};

// SDKResultError.subtype values
const RESULT_ERROR_MAP = {
  'error_max_turns':                      'limit',     // not really an error — continuation signal
  'error_during_execution':               'transient',
  'error_max_budget_usd':                 'fatal',     // budget exhausted
  'error_max_structured_output_retries':  'fatal',
};

// ── Unified Classification ───────────────────────────────────

/**
 * Classify a thrown error as 'transient' or 'fatal'.
 * Default: transient (retry is safer than abort).
 *
 * @param {Error|object} err - The thrown error
 * @returns {'transient'|'fatal'}
 */
export function classifyError(err) {
  const message = err?.message || String(err);

  // Check fatal patterns first (more specific)
  for (const pattern of FATAL_THROW_PATTERNS) {
    if (pattern.test(message)) return 'fatal';
  }

  // Check transient patterns
  for (const pattern of TRANSIENT_THROW_PATTERNS) {
    if (pattern.test(message)) return 'transient';
  }

  // Default: treat as transient (retry is safer than abort)
  return 'transient';
}

/**
 * Classify an in-band assistant message error.
 * @param {string} errorType - The message.error value (e.g. 'rate_limit')
 * @returns {'transient'|'fatal'|null} null if not a known error type
 */
export function classifyAssistantError(errorType) {
  return ASSISTANT_ERROR_MAP[errorType] || null;
}

/**
 * Classify a result message error by subtype.
 * @param {string} subtype - The result.subtype (e.g. 'error_max_turns')
 * @returns {'transient'|'fatal'|'limit'|null}
 */
export function classifyResultError(subtype) {
  return RESULT_ERROR_MAP[subtype] || null;
}

// ── Retry Logic ──────────────────────────────────────────────

const BACKOFF_DELAYS = [1000, 4000, 16000]; // 1s, 4s, 16s
const MAX_RETRIES = 3;

/**
 * Get the delay for a given retry attempt (0-indexed).
 * @param {number} attempt - Retry attempt (0, 1, 2)
 * @returns {number} Delay in milliseconds
 */
export function getRetryDelay(attempt) {
  return BACKOFF_DELAYS[Math.min(attempt, BACKOFF_DELAYS.length - 1)];
}

/**
 * Sleep for the specified duration.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry on transient errors.
 * @param {Function} fn - Async function to execute
 * @param {{ maxRetries?: number, log?: Function, onRetry?: Function }} opts
 * @returns {Promise<{ result?: any, error?: Error, attempts: number, classification?: string }>}
 */
export async function withRetry(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const log = opts.log || (() => {});

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn(attempt);
      return { result, attempts: attempt + 1 };
    } catch (err) {
      const classification = classifyError(err);

      if (classification === 'fatal') {
        log(`  Fatal error (attempt ${attempt + 1}): ${err.message}`);
        return { error: err, attempts: attempt + 1, classification: 'fatal' };
      }

      if (attempt < maxRetries) {
        const delay = getRetryDelay(attempt);
        log(`  Transient error (attempt ${attempt + 1}/${maxRetries + 1}): ${err.message}`);
        log(`  Retrying in ${delay / 1000}s...`);
        if (opts.onRetry) opts.onRetry(attempt, delay, err);
        await sleep(delay);
      } else {
        log(`  All ${maxRetries + 1} attempts exhausted: ${err.message}`);
        return { error: err, attempts: attempt + 1, classification: 'transient' };
      }
    }
  }
}

// ── Circuit Breaker ──────────────────────────────────────────

const CIRCUIT_BREAKER_THRESHOLD = 3;

/**
 * Check if the circuit breaker should trip.
 * @param {number} consecutiveErrors - Number of consecutive session errors
 * @returns {boolean} True if chain should be aborted
 */
export function shouldTripCircuitBreaker(consecutiveErrors) {
  return consecutiveErrors >= CIRCUIT_BREAKER_THRESHOLD;
}

// ── Synthetic Handoff ────────────────────────────────────────

/**
 * Generate a synthetic handoff from partial output and error info.
 * Used when a session crashes so the next session has context.
 *
 * @param {{ output: string, error: Error|string, sessionIndex: number }} ctx
 * @returns {string} Synthetic handoff text
 */
export function generateSyntheticHandoff({ output, error, sessionIndex }) {
  const errorMsg = error?.message || String(error);
  const outputTail = output ? output.slice(-3000) : '(no output captured)';

  return [
    `## HANDOFF`,
    ``,
    `**Accomplished:** Session ${sessionIndex + 1} crashed before completing. Partial work may exist.`,
    ``,
    `**Error:** ${errorMsg}`,
    ``,
    `**Remaining:** The previous session failed. Review the partial output below and continue the task. Check git status for any partial changes that were made.`,
    ``,
    `**Context (partial output tail):**`,
    '```',
    outputTail,
    '```',
  ].join('\n');
}

// ── Handoff Validation (M2d) ─────────────────────────────────

const MIN_SUMMARY_LENGTH = 20;
const MAX_HANDOFF_LENGTH = 10000;

/**
 * Validate a parsed handoff object.
 * @param {object|null} handoff - Parsed handoff from parseHandoff()
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateHandoff(handoff) {
  if (!handoff) {
    return { valid: false, reason: 'no handoff found' };
  }

  if (!handoff.summary || handoff.summary.length < MIN_SUMMARY_LENGTH) {
    return { valid: false, reason: `summary too short (${handoff.summary?.length || 0} chars, need ${MIN_SUMMARY_LENGTH})` };
  }

  if (!handoff.complete && (!handoff.remaining || handoff.remaining.length === 0)) {
    return { valid: false, reason: 'incomplete handoff missing remaining field' };
  }

  if (handoff.raw && handoff.raw.length > MAX_HANDOFF_LENGTH) {
    return { valid: false, reason: `handoff too long (${handoff.raw.length} chars, max ${MAX_HANDOFF_LENGTH})` };
  }

  return { valid: true };
}

// ── Exports for testing ──────────────────────────────────────

export {
  TRANSIENT_THROW_PATTERNS, FATAL_THROW_PATTERNS,
  ASSISTANT_ERROR_MAP, RESULT_ERROR_MAP,
  BACKOFF_DELAYS, MAX_RETRIES, CIRCUIT_BREAKER_THRESHOLD,
  MIN_SUMMARY_LENGTH, MAX_HANDOFF_LENGTH,
};
