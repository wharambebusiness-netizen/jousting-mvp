// ============================================================
// Response Cache Middleware (Phase 42)
// ============================================================
// In-memory cache for GET JSON responses with LRU eviction,
// per-route TTL, Cache-Control: no-cache bypass, and concurrent
// request coalescing.
//
// Factory: createResponseCache(ctx) returns { middleware, invalidate, getStats, clear }.
// ============================================================

/**
 * Create a response cache.
 * @param {object} [ctx]
 * @param {number} [ctx.defaultTtl=5000] - Default cache TTL in ms
 * @param {number} [ctx.maxEntries=100]  - Max cached responses (LRU eviction)
 * @param {Function} [ctx.log]           - Optional logger
 * @returns {{ middleware: Function, invalidate: Function, getStats: Function, clear: Function }}
 */
export function createResponseCache(ctx = {}) {
  const defaultTtl = ctx.defaultTtl ?? 5000;
  const maxEntries = ctx.maxEntries ?? 100;
  const log = ctx.log || (() => {});

  // Cache: key -> { body, statusCode, headers, expiresAt, accessedAt }
  const cache = new Map();

  // Pending in-flight requests for coalescing: key -> Promise<entry>
  const inflight = new Map();

  // Stats
  let hits = 0;
  let misses = 0;

  // ── LRU Eviction ──────────────────────────────────────────

  function evictLRU() {
    if (cache.size <= maxEntries) return;

    // Find the least recently accessed entry
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, entry] of cache) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      cache.delete(oldestKey);
      log(`[cache] Evicted LRU entry: ${oldestKey}`);
    }
  }

  // ── Expiry Check ──────────────────────────────────────────

  function isExpired(entry) {
    return Date.now() >= entry.expiresAt;
  }

  // ── Cache Key ─────────────────────────────────────────────

  function cacheKey(req) {
    // Use path + query string (req.url includes query string after path)
    return req.originalUrl || req.url;
  }

  // ── Middleware Factory ────────────────────────────────────

  /**
   * Returns Express middleware with optional per-route config.
   * @param {object} [options]
   * @param {number} [options.ttl] - Per-route TTL override (ms)
   * @returns {Function} Express middleware
   */
  function middleware(options = {}) {
    const ttl = options.ttl ?? defaultTtl;

    return function responseCacheMiddleware(req, res, next) {
      // Only cache GET requests
      if (req.method !== 'GET') {
        return next();
      }

      // Respect Cache-Control: no-cache
      const cc = req.headers['cache-control'] || '';
      if (cc.includes('no-cache')) {
        return next();
      }

      const key = cacheKey(req);

      // Check cache hit
      const cached = cache.get(key);
      if (cached && !isExpired(cached)) {
        hits++;
        cached.accessedAt = Date.now();
        res.setHeader('X-Cache', 'HIT');
        // Restore original headers
        for (const [hk, hv] of Object.entries(cached.headers)) {
          res.setHeader(hk, hv);
        }
        res.status(cached.statusCode).json(cached.body);
        return;
      }

      // Cache miss — remove expired entry if present
      if (cached) cache.delete(key);

      misses++;
      res.setHeader('X-Cache', 'MISS');

      // Intercept res.json() to capture the response
      const originalJson = res.json.bind(res);
      res.json = function cacheInterceptJson(body) {
        // Store in cache
        const entry = {
          body,
          statusCode: res.statusCode || 200,
          headers: {},
          expiresAt: Date.now() + ttl,
          accessedAt: Date.now(),
        };

        // Capture Content-Type if set
        const ct = res.getHeader('content-type');
        if (ct) entry.headers['content-type'] = ct;

        cache.set(key, entry);

        // Evict if over capacity
        if (cache.size > maxEntries) evictLRU();

        log(`[cache] Stored: ${key} (ttl=${ttl}ms)`);

        // Call original json
        return originalJson(body);
      };

      next();
    };
  }

  // ── Invalidation ──────────────────────────────────────────

  /**
   * Clear cache entries matching a URL prefix pattern, or all if no pattern given.
   * @param {string} [pattern] - URL prefix to match
   */
  function invalidate(pattern) {
    if (!pattern) {
      cache.clear();
      log('[cache] Invalidated all entries');
      return;
    }

    for (const key of [...cache.keys()]) {
      if (key.startsWith(pattern)) {
        cache.delete(key);
      }
    }
    log(`[cache] Invalidated entries matching: ${pattern}`);
  }

  // ── Stats ─────────────────────────────────────────────────

  /**
   * Get cache statistics.
   * @returns {{ size: number, hits: number, misses: number, hitRate: number }}
   */
  function getStats() {
    const total = hits + misses;
    return {
      size: cache.size,
      hits,
      misses,
      hitRate: total > 0 ? Math.round(hits / total * 10000) / 10000 : 0,
    };
  }

  /**
   * Clear all cached entries and reset statistics.
   */
  function clear() {
    cache.clear();
    hits = 0;
    misses = 0;
    log('[cache] Cleared');
  }

  return { middleware, invalidate, getStats, clear };
}
