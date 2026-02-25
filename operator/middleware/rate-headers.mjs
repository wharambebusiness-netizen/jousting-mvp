// ============================================================
// Rate Limit Headers Middleware (Phase 42)
// ============================================================
// Express middleware that adds standard X-RateLimit-* headers
// to every API response when a rate limiter is available.
//
// Headers:
//   X-RateLimit-Limit     — max requests per minute
//   X-RateLimit-Remaining — remaining requests in current window
//   X-RateLimit-Reset     — seconds until the rate limit window resets
//
// Factory: createRateHeadersMiddleware(ctx) returns Express middleware.
// ============================================================

/**
 * Create rate-limit headers middleware.
 * The rateLimiter is read from ctx on each request (supports deferred/lazy binding).
 * @param {object} ctx
 * @param {object|null} ctx.rateLimiter - Rate limiter instance (from coordinator). Null = no-op.
 * @returns {Function} Express middleware
 */
export function createRateHeadersMiddleware(ctx = {}) {
  return function rateHeadersMiddleware(_req, res, next) {
    const rateLimiter = ctx.rateLimiter;

    // No-op when no limiter is available
    if (!rateLimiter) {
      return next();
    }

    const status = rateLimiter.getStatus();

    res.setHeader('X-RateLimit-Limit', status.maxRequestsPerMinute);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, status.requestBucket));
    // Reset = seconds until the bucket fully refills from its current level.
    // With per-minute proportional refill the full refill time is:
    //   (maxRequestsPerMinute - requestBucket) / maxRequestsPerMinute * 60
    const deficit = status.maxRequestsPerMinute - status.requestBucket;
    const resetSeconds = deficit > 0
      ? Math.ceil(deficit / status.maxRequestsPerMinute * 60)
      : 0;
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    next();
  };
}
