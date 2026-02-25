// ============================================================
// Request Timer Middleware (Phase 50)
// ============================================================
// Express middleware that tracks per-endpoint latency with
// p50/p95/p99 percentile calculations, slow request detection,
// and per-route timing aggregation.
//
// Factory: createRequestTimer(ctx) returns { middleware, ...API }
// ============================================================

// ── Constants ───────────────────────────────────────────────

export const DEFAULT_SLOW_THRESHOLD_MS = 1000;
export const DEFAULT_MAX_ENTRIES = 200;
const SAMPLE_BUFFER_SIZE = 100; // Per-route sample buffer for percentile calc

// ── Path Normalization ───────────────────────────────────────

// UUID pattern: 8-4-4-4-12 hex characters
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Pure numeric segment
const NUMERIC_RE = /\/\d+(?=\/|$)/g;
// Short hex ID (alphanumeric, 6-32 chars) that looks like a generated ID
const HEX_ID_RE = /\/[0-9a-f]{6,32}(?=\/|$)/g;

/**
 * Normalize a URL path by replacing dynamic segments with :id.
 * E.g. /api/chains/abc-123-def → /api/chains/:id
 */
export function normalizePath(path) {
  if (!path) return path;

  let normalized = path;

  // Strip query string
  const qIdx = normalized.indexOf('?');
  if (qIdx !== -1) normalized = normalized.slice(0, qIdx);

  // Replace UUIDs first (most specific)
  normalized = normalized.replace(UUID_RE, ':id');

  // Replace purely numeric segments
  normalized = normalized.replace(NUMERIC_RE, '/:id');

  // Replace remaining lowercase hex IDs (short generated IDs like randomBytes hex)
  normalized = normalized.replace(HEX_ID_RE, '/:id');

  return normalized;
}

// ── Percentile Calculation ───────────────────────────────────

/**
 * Calculate a percentile from a sorted array of numbers.
 * @param {number[]} sorted - Sorted ascending array
 * @param {number} p - Percentile (0-100)
 * @returns {number}
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a request timer middleware with per-route latency tracking.
 *
 * @param {object} [ctx]
 * @param {object}   [ctx.log]              - Logger with warn() method
 * @param {object}   [ctx.events]           - EventBus for perf:slow-request
 * @param {number}   [ctx.slowThresholdMs]  - Slow request threshold (default 1000ms)
 * @param {number}   [ctx.maxEntries]       - Max slow request entries (default 200)
 * @returns {{ middleware: Function, getStats, getRouteStats, getSlowRequests, reset }}
 */
export function createRequestTimer(ctx = {}) {
  const log = ctx.log || null;
  const events = ctx.events || null;
  const slowThresholdMs = ctx.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
  const maxEntries = ctx.maxEntries ?? DEFAULT_MAX_ENTRIES;

  // Per-route timing data
  // routeKey → { route, count, totalMs, minMs, maxMs, errorCount, lastCalledAt, _samples: [] }
  const routeData = new Map();

  // Ring buffer of recent slow requests
  const slowRequests = [];

  // ── Helpers ────────────────────────────────────────────────

  function getOrCreateRoute(routeKey) {
    if (!routeData.has(routeKey)) {
      routeData.set(routeKey, {
        route: routeKey,
        count: 0,
        totalMs: 0,
        minMs: Infinity,
        maxMs: 0,
        errorCount: 0,
        lastCalledAt: null,
        _samples: [],       // sorted ascending for percentile calc
      });
    }
    return routeData.get(routeKey);
  }

  /**
   * Insert a duration into the sorted sample buffer (fixed size).
   */
  function insertSample(entry, durationMs) {
    const samples = entry._samples;

    // Binary search insertion to keep sorted
    let lo = 0;
    let hi = samples.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (samples[mid] < durationMs) lo = mid + 1;
      else hi = mid;
    }
    samples.splice(lo, 0, durationMs);

    // Evict oldest if over capacity — remove from start (smallest values if full, which is
    // fine since we want a recent window). Actually evict based on position to keep representative
    // sample: remove the first element when at capacity.
    if (samples.length > SAMPLE_BUFFER_SIZE) {
      samples.shift();
    }
  }

  function computePercentiles(entry) {
    const s = entry._samples;
    if (s.length === 0) return { p50Ms: 0, p95Ms: 0, p99Ms: 0 };
    return {
      p50Ms: percentile(s, 50),
      p95Ms: percentile(s, 95),
      p99Ms: percentile(s, 99),
    };
  }

  function recordRequest(routeKey, durationMs, statusCode) {
    const entry = getOrCreateRoute(routeKey);

    entry.count += 1;
    entry.totalMs += durationMs;
    if (durationMs < entry.minMs) entry.minMs = durationMs;
    if (durationMs > entry.maxMs) entry.maxMs = durationMs;
    entry.lastCalledAt = new Date().toISOString();

    if (statusCode >= 400) {
      entry.errorCount += 1;
    }

    insertSample(entry, durationMs);
  }

  // ── Middleware ─────────────────────────────────────────────

  function middleware(req, res, next) {
    const startNs = process.hrtime.bigint();

    res.on('finish', () => {
      try {
        const endNs = process.hrtime.bigint();
        const durationMs = Number(endNs - startNs) / 1_000_000;

        // Normalize path: prefer req.route.path (Express resolved route) if available
        const rawPath = (req.route && req.route.path)
          ? `${req.baseUrl || ''}${req.route.path}`
          : normalizePath(req.path || req.url || '');

        const routeKey = `${req.method} ${rawPath}`;

        recordRequest(routeKey, durationMs, res.statusCode);

        // Slow request detection
        if (durationMs > slowThresholdMs) {
          if (log && log.warn) {
            log.warn('Slow request', { route: routeKey, durationMs, method: req.method, path: req.path });
          }

          const slowEntry = {
            route: routeKey,
            durationMs,
            method: req.method,
            path: req.path || req.url || '',
            statusCode: res.statusCode,
            timestamp: new Date().toISOString(),
          };

          slowRequests.push(slowEntry);
          if (slowRequests.length > maxEntries) {
            slowRequests.shift();
          }

          if (events && events.emit) {
            events.emit('perf:slow-request', slowEntry);
          }
        }
      } catch { /* noop — never crash on monitoring */ }
    });

    next();
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Returns all route timing summaries sorted by avgMs descending.
   */
  function getStats() {
    const result = [];
    for (const entry of routeData.values()) {
      const avgMs = entry.count > 0 ? entry.totalMs / entry.count : 0;
      const { p50Ms, p95Ms, p99Ms } = computePercentiles(entry);
      result.push({
        route: entry.route,
        count: entry.count,
        totalMs: entry.totalMs,
        avgMs: Math.round(avgMs * 100) / 100,
        minMs: entry.minMs === Infinity ? 0 : Math.round(entry.minMs * 100) / 100,
        maxMs: Math.round(entry.maxMs * 100) / 100,
        p50Ms: Math.round(p50Ms * 100) / 100,
        p95Ms: Math.round(p95Ms * 100) / 100,
        p99Ms: Math.round(p99Ms * 100) / 100,
        errorCount: entry.errorCount,
        lastCalledAt: entry.lastCalledAt,
      });
    }
    result.sort((a, b) => b.avgMs - a.avgMs);
    return result;
  }

  /**
   * Returns stats for a specific route key, or null if not found.
   */
  function getRouteStats(route) {
    const entry = routeData.get(route);
    if (!entry) return null;
    const avgMs = entry.count > 0 ? entry.totalMs / entry.count : 0;
    const { p50Ms, p95Ms, p99Ms } = computePercentiles(entry);
    return {
      route: entry.route,
      count: entry.count,
      totalMs: entry.totalMs,
      avgMs: Math.round(avgMs * 100) / 100,
      minMs: entry.minMs === Infinity ? 0 : Math.round(entry.minMs * 100) / 100,
      maxMs: Math.round(entry.maxMs * 100) / 100,
      p50Ms: Math.round(p50Ms * 100) / 100,
      p95Ms: Math.round(p95Ms * 100) / 100,
      p99Ms: Math.round(p99Ms * 100) / 100,
      errorCount: entry.errorCount,
      lastCalledAt: entry.lastCalledAt,
    };
  }

  /**
   * Returns the N most recent slow requests.
   * @param {number} [limit=20]
   */
  function getSlowRequests(limit = 20) {
    return slowRequests.slice(-limit).reverse();
  }

  /**
   * Clears all timing data and slow request history.
   */
  function reset() {
    routeData.clear();
    slowRequests.length = 0;
  }

  return {
    middleware,
    getStats,
    getRouteStats,
    getSlowRequests,
    reset,
  };
}
