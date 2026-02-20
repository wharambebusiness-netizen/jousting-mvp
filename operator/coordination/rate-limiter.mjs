// ============================================================
// Rate Limiter — Shared Token Bucket
// ============================================================
// Shared rate limiter for API calls across all workers.
// Uses token bucket algorithm with per-minute refill.
// Workers request tokens before API calls; coordinator
// grants or denies based on available budget.
//
// Factory: createRateLimiter(options) returns limiter methods.
// ============================================================

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a shared rate limiter.
 * @param {object} [options]
 * @param {number} [options.maxRequestsPerMinute=60] - Max API requests per minute
 * @param {number} [options.maxTokensPerMinute=1000000] - Max API tokens per minute
 * @param {Function} [options.log] - Logger
 * @param {Function} [options.now] - Clock function (for testing)
 * @returns {object} Limiter methods
 */
export function createRateLimiter(options = {}) {
  let maxRequestsPerMinute = options.maxRequestsPerMinute || 60;
  let maxTokensPerMinute = options.maxTokensPerMinute || 1_000_000;
  const log = options.log || (() => {});
  const now = options.now || (() => Date.now());

  // Token buckets
  let requestBucket = maxRequestsPerMinute;
  let tokenBucket = maxTokensPerMinute;
  let lastRefill = now();

  // Per-worker tracking
  const workerUsage = new Map(); // workerId -> { requests, tokens, denied }

  // Waiters queue
  const waiters = []; // { resolve, workerId, tokens, requestedAt }

  // ── Bucket Refill ─────────────────────────────────────

  function refill() {
    const elapsed = now() - lastRefill;
    if (elapsed <= 0) return;

    // Refill proportionally based on elapsed time
    const minutes = elapsed / 60_000;
    requestBucket = Math.min(maxRequestsPerMinute, requestBucket + maxRequestsPerMinute * minutes);
    tokenBucket = Math.min(maxTokensPerMinute, tokenBucket + maxTokensPerMinute * minutes);
    lastRefill = now();
  }

  // ── Request Handling ──────────────────────────────────

  function getWorkerUsage(workerId) {
    if (!workerUsage.has(workerId)) {
      workerUsage.set(workerId, { requests: 0, tokens: 0, denied: 0, lastRequest: null });
    }
    return workerUsage.get(workerId);
  }

  /**
   * Try to acquire rate limit budget.
   * @param {string} workerId - Requesting worker
   * @param {number} [tokens=0] - Estimated tokens for this request
   * @returns {{ granted: boolean, waitMs?: number, remaining: { requests: number, tokens: number } }}
   */
  function tryAcquire(workerId, tokens = 0) {
    refill();

    const usage = getWorkerUsage(workerId);
    usage.lastRequest = now();

    // Check request budget
    if (requestBucket < 1) {
      usage.denied++;
      const waitMs = Math.ceil((1 - requestBucket) / maxRequestsPerMinute * 60_000);
      log(`[rate] Denied request from ${workerId} — rate limit (wait ${waitMs}ms)`);
      return { granted: false, waitMs, remaining: { requests: Math.floor(requestBucket), tokens: Math.floor(tokenBucket) } };
    }

    // Check token budget
    if (tokens > 0 && tokenBucket < tokens) {
      usage.denied++;
      const waitMs = Math.ceil((tokens - tokenBucket) / maxTokensPerMinute * 60_000);
      log(`[rate] Denied token request from ${workerId} — ${tokens} requested, ${Math.floor(tokenBucket)} available (wait ${waitMs}ms)`);
      return { granted: false, waitMs, remaining: { requests: Math.floor(requestBucket), tokens: Math.floor(tokenBucket) } };
    }

    // Grant
    requestBucket -= 1;
    if (tokens > 0) tokenBucket -= tokens;
    usage.requests++;
    usage.tokens += tokens;
    log(`[rate] Granted request to ${workerId} (${tokens} tokens)`);

    return {
      granted: true,
      remaining: { requests: Math.floor(requestBucket), tokens: Math.floor(tokenBucket) },
    };
  }

  /**
   * Acquire with waiting — returns a promise that resolves when budget is available.
   * @param {string} workerId
   * @param {number} [tokens=0]
   * @param {number} [timeoutMs=30000] - Max wait time
   * @returns {Promise<{ granted: boolean, waitedMs: number }>}
   */
  function acquire(workerId, tokens = 0, timeoutMs = 30_000) {
    const result = tryAcquire(workerId, tokens);
    if (result.granted) return Promise.resolve({ granted: true, waitedMs: 0 });

    return new Promise((resolve) => {
      const requestedAt = now();
      const waiter = { resolve, workerId, tokens, requestedAt };
      waiters.push(waiter);

      const timer = setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx !== -1) waiters.splice(idx, 1);
        resolve({ granted: false, waitedMs: now() - requestedAt });
      }, timeoutMs);

      // Use unref to not hold event loop open
      if (timer.unref) timer.unref();
    });
  }

  /**
   * Process waiting requests (call periodically or after refill).
   * @returns {number} Number of waiters granted
   */
  function processWaiters() {
    refill();
    let granted = 0;

    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      const result = tryAcquire(waiter.workerId, waiter.tokens);
      if (result.granted) {
        waiters.splice(i, 1);
        waiter.resolve({ granted: true, waitedMs: now() - waiter.requestedAt });
        granted++;
      }
    }

    return granted;
  }

  // ── Status ────────────────────────────────────────────

  /**
   * Get current rate limiter status.
   * @returns {object}
   */
  function getStatus() {
    refill();
    return {
      requestBucket: Math.floor(requestBucket),
      tokenBucket: Math.floor(tokenBucket),
      maxRequestsPerMinute,
      maxTokensPerMinute,
      pendingWaiters: waiters.length,
      workerUsage: Object.fromEntries(
        [...workerUsage.entries()].map(([id, u]) => [id, { ...u }])
      ),
    };
  }

  /**
   * Get usage stats for a specific worker.
   * @param {string} workerId
   * @returns {object}
   */
  function getWorkerStats(workerId) {
    const usage = workerUsage.get(workerId);
    return usage ? { ...usage } : { requests: 0, tokens: 0, denied: 0, lastRequest: null };
  }

  /**
   * Reset the limiter (for testing or reconfiguration).
   */
  function reset() {
    requestBucket = maxRequestsPerMinute;
    tokenBucket = maxTokensPerMinute;
    lastRefill = now();
    workerUsage.clear();
    while (waiters.length > 0) {
      const waiter = waiters.pop();
      waiter.resolve({ granted: false, waitedMs: 0 });
    }
  }

  /**
   * Update rate limits at runtime.
   * @param {object} updates
   * @param {number} [updates.maxRequestsPerMinute]
   * @param {number} [updates.maxTokensPerMinute]
   */
  function updateLimits(updates) {
    if (updates.maxRequestsPerMinute != null && updates.maxRequestsPerMinute > 0) {
      maxRequestsPerMinute = updates.maxRequestsPerMinute;
      // Scale bucket proportionally
      requestBucket = Math.min(requestBucket, maxRequestsPerMinute);
    }
    if (updates.maxTokensPerMinute != null && updates.maxTokensPerMinute > 0) {
      maxTokensPerMinute = updates.maxTokensPerMinute;
      tokenBucket = Math.min(tokenBucket, maxTokensPerMinute);
    }
    log(`[rate] Limits updated: ${maxRequestsPerMinute} req/min, ${maxTokensPerMinute} tok/min`);
  }

  return {
    tryAcquire,
    acquire,
    processWaiters,
    getStatus,
    getWorkerStats,
    updateLimits,
    reset,
  };
}
