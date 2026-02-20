// ============================================================
// Adaptive Rate Limiter — Automatic 429 Backoff & Recovery
// ============================================================
// Wraps an existing rate limiter and detects 429 (rate limit)
// errors from workers. When errors exceed a threshold in a
// sliding window, automatically reduces rate limits using
// exponential backoff. Gradually recovers limits over time.
//
// States: normal → backing-off → recovering → normal
//   normal:      Limits at baseline (no recent errors)
//   backing-off: Limits reduced after 429 errors detected
//   recovering:  Gradually restoring limits toward baseline
//
// Factory: createAdaptiveLimiter(options) returns limiter methods.
// ============================================================

// ── Constants ───────────────────────────────────────────────

const STATES = Object.freeze({
  NORMAL: 'normal',
  BACKING_OFF: 'backing-off',
  RECOVERING: 'recovering',
});

// ── Factory ─────────────────────────────────────────────────

/**
 * Create an adaptive rate limiter that wraps an existing rate limiter.
 * @param {object} options
 * @param {object} options.rateLimiter - Existing rate limiter to wrap
 * @param {object} [options.events] - EventBus for emitting events
 * @param {number} [options.errorThreshold=3] - Errors in window before backoff
 * @param {number} [options.windowMs=60000] - Sliding window for error counting (1 min)
 * @param {number} [options.backoffFactor=0.5] - Multiply limits by this factor on backoff
 * @param {number} [options.maxBackoffLevel=4] - Maximum backoff depth (limits floor = factor^level)
 * @param {number} [options.recoveryIntervalMs=30000] - Interval between recovery steps
 * @param {number} [options.recoveryFactor=1.5] - Multiply limits by this on each recovery step
 * @param {Function} [options.log] - Logger
 * @param {Function} [options.now] - Clock function (for testing)
 * @returns {object} Adaptive limiter methods
 */
export function createAdaptiveLimiter(options = {}) {
  const { rateLimiter } = options;
  if (!rateLimiter) throw new Error('Adaptive limiter requires a rateLimiter');

  const events = options.events || null;
  const log = options.log || (() => {});
  const now = options.now || (() => Date.now());

  // Config
  const errorThreshold = options.errorThreshold ?? 3;
  const windowMs = options.windowMs ?? 60_000;
  const backoffFactor = options.backoffFactor ?? 0.5;
  const maxBackoffLevel = options.maxBackoffLevel ?? 4;
  const recoveryIntervalMs = options.recoveryIntervalMs ?? 30_000;
  const recoveryFactor = options.recoveryFactor ?? 1.5;

  // State
  let state = STATES.NORMAL;
  let backoffLevel = 0;
  let recoveryTimer = null;
  const errors = []; // { timestamp, workerId, detail }

  // Baseline: snapshot the original limits from the rate limiter
  const rlStatus = rateLimiter.getStatus();
  let baselineRequests = rlStatus.maxRequestsPerMinute;
  let baselineTokens = rlStatus.maxTokensPerMinute;

  // Current effective limits
  let currentRequests = baselineRequests;
  let currentTokens = baselineTokens;

  // ── Error Tracking ─────────────────────────────────────────

  function pruneErrors() {
    const cutoff = now() - windowMs;
    while (errors.length > 0 && errors[0].timestamp < cutoff) {
      errors.shift();
    }
  }

  /**
   * Record a 429 rate limit error from a worker.
   * @param {string} workerId - Worker that received the error
   * @param {string} [detail] - Optional error detail
   * @returns {{ triggered: boolean, errorsInWindow: number, backoffLevel: number, state: string }}
   */
  function recordError(workerId, detail) {
    pruneErrors();
    errors.push({ timestamp: now(), workerId, detail });

    log(`[adaptive] 429 error from ${workerId} (${errors.length} in window)`);

    let triggered = false;

    // Check if we should trigger backoff
    if (errors.length >= errorThreshold) {
      triggered = triggerBackoff();
    }

    return {
      triggered,
      errorsInWindow: errors.length,
      backoffLevel,
      state,
    };
  }

  // ── Backoff ────────────────────────────────────────────────

  function triggerBackoff() {
    if (backoffLevel >= maxBackoffLevel) {
      log(`[adaptive] Already at max backoff level ${maxBackoffLevel}`);
      return false;
    }

    // Stop any recovery in progress
    stopRecovery();

    backoffLevel++;
    state = STATES.BACKING_OFF;

    // Calculate new limits
    const factor = Math.pow(backoffFactor, backoffLevel);
    currentRequests = Math.max(1, Math.round(baselineRequests * factor));
    currentTokens = Math.max(1000, Math.round(baselineTokens * factor));

    // Apply to rate limiter
    rateLimiter.updateLimits({
      maxRequestsPerMinute: currentRequests,
      maxTokensPerMinute: currentTokens,
    });

    log(`[adaptive] Backoff level ${backoffLevel}: limits reduced to ${currentRequests} req/min, ${currentTokens} tok/min (${(factor * 100).toFixed(0)}% of baseline)`);

    const eventData = {
      state,
      backoffLevel,
      currentRequests,
      currentTokens,
      baselineRequests,
      baselineTokens,
      factor,
      errorsInWindow: errors.length,
    };

    if (events) events.emit('coord:rate-adjusted', eventData);

    // Start recovery after the window clears
    startRecovery();

    // Clear error window to prevent immediate re-triggering
    errors.length = 0;

    return true;
  }

  // ── Recovery ───────────────────────────────────────────────

  function startRecovery() {
    stopRecovery();

    recoveryTimer = setInterval(() => {
      pruneErrors();

      // If new errors appeared in the window, don't recover yet
      if (errors.length >= errorThreshold) {
        log('[adaptive] Recovery paused — errors still in window');
        triggerBackoff();
        return;
      }

      attemptRecovery();
    }, recoveryIntervalMs);

    if (recoveryTimer.unref) recoveryTimer.unref();
  }

  function stopRecovery() {
    if (recoveryTimer) {
      clearInterval(recoveryTimer);
      recoveryTimer = null;
    }
  }

  function attemptRecovery() {
    state = STATES.RECOVERING;

    // Step toward baseline
    currentRequests = Math.min(baselineRequests, Math.round(currentRequests * recoveryFactor));
    currentTokens = Math.min(baselineTokens, Math.round(currentTokens * recoveryFactor));

    // Check if we've reached baseline
    if (currentRequests >= baselineRequests && currentTokens >= baselineTokens) {
      // Fully recovered
      currentRequests = baselineRequests;
      currentTokens = baselineTokens;
      backoffLevel = 0;
      state = STATES.NORMAL;
    } else {
      // Decrease backoff level (but keep recovering)
      backoffLevel = Math.max(1, backoffLevel - 1);
    }

    rateLimiter.updateLimits({
      maxRequestsPerMinute: currentRequests,
      maxTokensPerMinute: currentTokens,
    });

    const factor = baselineRequests > 0 ? currentRequests / baselineRequests : 1;
    log(`[adaptive] Recovery step: limits now ${currentRequests} req/min, ${currentTokens} tok/min (${(factor * 100).toFixed(0)}% of baseline, level=${backoffLevel})`);

    if (events) events.emit('coord:rate-adjusted', {
      state,
      backoffLevel,
      currentRequests,
      currentTokens,
      baselineRequests,
      baselineTokens,
      factor,
      errorsInWindow: errors.length,
    });

    // If fully recovered, clean up
    if (state === STATES.NORMAL) {
      log(`[adaptive] Fully recovered — limits restored to baseline (${baselineRequests} req/min, ${baselineTokens} tok/min)`);
      stopRecovery();
    }
  }

  // ── Baseline Update ────────────────────────────────────────

  /**
   * Update the baseline limits (e.g., after user changes config).
   * If currently in normal state, also updates active limits.
   * @param {object} updates
   * @param {number} [updates.maxRequestsPerMinute]
   * @param {number} [updates.maxTokensPerMinute]
   */
  function updateBaseline(updates) {
    if (updates.maxRequestsPerMinute != null && updates.maxRequestsPerMinute > 0) {
      baselineRequests = updates.maxRequestsPerMinute;
    }
    if (updates.maxTokensPerMinute != null && updates.maxTokensPerMinute > 0) {
      baselineTokens = updates.maxTokensPerMinute;
    }

    // If normal, sync active limits to new baseline
    if (state === STATES.NORMAL) {
      currentRequests = baselineRequests;
      currentTokens = baselineTokens;
    }

    log(`[adaptive] Baseline updated: ${baselineRequests} req/min, ${baselineTokens} tok/min`);
  }

  // ── Status ─────────────────────────────────────────────────

  /**
   * Get adaptive limiter status.
   * @returns {object}
   */
  function getStatus() {
    pruneErrors();
    const factor = baselineRequests > 0 ? currentRequests / baselineRequests : 1;

    return {
      state,
      backoffLevel,
      maxBackoffLevel,
      errorsInWindow: errors.length,
      errorThreshold,
      windowMs,
      currentRequests,
      currentTokens,
      baselineRequests,
      baselineTokens,
      factor: Math.round(factor * 100) / 100,
      recoveryIntervalMs,
      isRecovering: recoveryTimer !== null,
    };
  }

  /**
   * Reset the adaptive limiter to normal state.
   */
  function reset() {
    stopRecovery();
    errors.length = 0;
    backoffLevel = 0;
    state = STATES.NORMAL;
    currentRequests = baselineRequests;
    currentTokens = baselineTokens;
    rateLimiter.updateLimits({
      maxRequestsPerMinute: baselineRequests,
      maxTokensPerMinute: baselineTokens,
    });
  }

  /**
   * Clean up timers.
   */
  function destroy() {
    stopRecovery();
  }

  return {
    recordError,
    updateBaseline,
    getStatus,
    reset,
    destroy,
  };
}

export { STATES as ADAPTIVE_STATES };
