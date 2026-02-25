// ============================================================
// Rate Limit Headers & Response Cache Tests (Phase 42)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRateHeadersMiddleware } from '../middleware/rate-headers.mjs';
import { createResponseCache } from '../middleware/response-cache.mjs';

// ── Helpers ─────────────────────────────────────────────────

/** Create a minimal Express-like request mock. */
function mockReq(overrides = {}) {
  return {
    method: 'GET',
    path: '/api/health',
    url: '/api/health',
    originalUrl: '/api/health',
    headers: {},
    ...overrides,
  };
}

/** Create a minimal Express-like response mock with headers, status, and json. */
function mockRes() {
  const headers = {};
  const listeners = {};
  let statusCode = 200;
  let sentBody = null;
  const res = {
    get statusCode() { return statusCode; },
    set statusCode(v) { statusCode = v; },
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    _headers: headers,
    _sentBody: null,
    status(code) { statusCode = code; return res; },
    json(body) {
      res._sentBody = body;
      return res;
    },
    on(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    _emit(event) {
      for (const fn of listeners[event] || []) fn();
    },
  };
  return res;
}

/** Create a mock rate limiter that returns predictable status. */
function mockRateLimiter(overrides = {}) {
  return {
    getStatus() {
      return {
        requestBucket: overrides.requestBucket ?? 45,
        tokenBucket: overrides.tokenBucket ?? 800000,
        maxRequestsPerMinute: overrides.maxRequestsPerMinute ?? 60,
        maxTokensPerMinute: overrides.maxTokensPerMinute ?? 1000000,
        pendingWaiters: overrides.pendingWaiters ?? 0,
        workerUsage: {},
      };
    },
  };
}

// ============================================================
// Rate Limit Headers Middleware
// ============================================================

describe('createRateHeadersMiddleware', () => {
  it('adds X-RateLimit-Limit header when limiter present', () => {
    const mw = createRateHeadersMiddleware({ rateLimiter: mockRateLimiter() });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._headers['X-RateLimit-Limit']).toBe(60);
    expect(next).toHaveBeenCalled();
  });

  it('adds X-RateLimit-Remaining header', () => {
    const mw = createRateHeadersMiddleware({ rateLimiter: mockRateLimiter({ requestBucket: 33 }) });
    const req = mockReq();
    const res = mockRes();

    mw(req, res, () => {});

    expect(res._headers['X-RateLimit-Remaining']).toBe(33);
  });

  it('adds X-RateLimit-Reset header', () => {
    // deficit = 60 - 30 = 30, resetSeconds = ceil(30/60 * 60) = 30
    const mw = createRateHeadersMiddleware({ rateLimiter: mockRateLimiter({ requestBucket: 30 }) });
    const req = mockReq();
    const res = mockRes();

    mw(req, res, () => {});

    expect(res._headers['X-RateLimit-Reset']).toBe(30);
  });

  it('no headers when limiter is null (passthrough)', () => {
    const mw = createRateHeadersMiddleware({ rateLimiter: null });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._headers['X-RateLimit-Limit']).toBeUndefined();
    expect(res._headers['X-RateLimit-Remaining']).toBeUndefined();
    expect(res._headers['X-RateLimit-Reset']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('no headers when no context provided', () => {
    const mw = createRateHeadersMiddleware();
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._headers['X-RateLimit-Limit']).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('headers are numbers (not NaN)', () => {
    const mw = createRateHeadersMiddleware({ rateLimiter: mockRateLimiter() });
    const req = mockReq();
    const res = mockRes();

    mw(req, res, () => {});

    expect(typeof res._headers['X-RateLimit-Limit']).toBe('number');
    expect(typeof res._headers['X-RateLimit-Remaining']).toBe('number');
    expect(typeof res._headers['X-RateLimit-Reset']).toBe('number');
    expect(Number.isNaN(res._headers['X-RateLimit-Limit'])).toBe(false);
    expect(Number.isNaN(res._headers['X-RateLimit-Remaining'])).toBe(false);
    expect(Number.isNaN(res._headers['X-RateLimit-Reset'])).toBe(false);
  });

  it('Remaining is 0 when bucket is empty', () => {
    const mw = createRateHeadersMiddleware({ rateLimiter: mockRateLimiter({ requestBucket: 0 }) });
    const req = mockReq();
    const res = mockRes();

    mw(req, res, () => {});

    expect(res._headers['X-RateLimit-Remaining']).toBe(0);
  });

  it('Reset is 0 when bucket is full', () => {
    const mw = createRateHeadersMiddleware({ rateLimiter: mockRateLimiter({ requestBucket: 60 }) });
    const req = mockReq();
    const res = mockRes();

    mw(req, res, () => {});

    expect(res._headers['X-RateLimit-Reset']).toBe(0);
  });

  it('works with real rate limiter', async () => {
    // Dynamic import to verify compatibility
    const { createRateLimiter } = await import('../coordination/rate-limiter.mjs');
    const limiter = createRateLimiter({ maxRequestsPerMinute: 120 });
    const mw = createRateHeadersMiddleware({ rateLimiter: limiter });

    const req = mockReq();
    const res = mockRes();
    mw(req, res, () => {});

    expect(res._headers['X-RateLimit-Limit']).toBe(120);
    expect(res._headers['X-RateLimit-Remaining']).toBeGreaterThanOrEqual(0);
    expect(typeof res._headers['X-RateLimit-Reset']).toBe('number');
  });
});

// ============================================================
// Response Cache Middleware
// ============================================================

describe('createResponseCache', () => {
  let responseCache;

  beforeEach(() => {
    responseCache = createResponseCache({ defaultTtl: 5000, maxEntries: 100 });
  });

  it('GET request is cached (second call returns from cache)', () => {
    const mw = responseCache.middleware();
    const req1 = mockReq();
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ ok: true }); });
    expect(res1._sentBody).toEqual({ ok: true });

    // Second request should hit cache
    const req2 = mockReq();
    const res2 = mockRes();
    mw(req2, res2, () => { throw new Error('should not reach next()'); });
    expect(res2._sentBody).toEqual({ ok: true });
  });

  it('cache hit sets X-Cache: HIT header', () => {
    const mw = responseCache.middleware();
    // Miss first
    const req1 = mockReq();
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ v: 1 }); });

    // Hit
    const req2 = mockReq();
    const res2 = mockRes();
    mw(req2, res2, () => {});
    expect(res2._headers['X-Cache']).toBe('HIT');
  });

  it('cache miss sets X-Cache: MISS header', () => {
    const mw = responseCache.middleware();
    const req = mockReq();
    const res = mockRes();
    mw(req, res, () => { res.json({ v: 1 }); });
    expect(res._headers['X-Cache']).toBe('MISS');
  });

  it('POST requests are not cached', () => {
    const mw = responseCache.middleware();
    const req = mockReq({ method: 'POST' });
    const res = mockRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._headers['X-Cache']).toBeUndefined();
  });

  it('different URLs cached separately', () => {
    const mw = responseCache.middleware();

    const req1 = mockReq({ url: '/api/a', originalUrl: '/api/a' });
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ route: 'a' }); });

    const req2 = mockReq({ url: '/api/b', originalUrl: '/api/b' });
    const res2 = mockRes();
    mw(req2, res2, () => { res2.json({ route: 'b' }); });

    // Verify both are cached separately
    const req3 = mockReq({ url: '/api/a', originalUrl: '/api/a' });
    const res3 = mockRes();
    mw(req3, res3, () => {});
    expect(res3._sentBody).toEqual({ route: 'a' });

    const req4 = mockReq({ url: '/api/b', originalUrl: '/api/b' });
    const res4 = mockRes();
    mw(req4, res4, () => {});
    expect(res4._sentBody).toEqual({ route: 'b' });
  });

  it('same URL with different query params cached separately', () => {
    const mw = responseCache.middleware();

    const req1 = mockReq({ url: '/api/x?page=1', originalUrl: '/api/x?page=1' });
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ page: 1 }); });

    const req2 = mockReq({ url: '/api/x?page=2', originalUrl: '/api/x?page=2' });
    const res2 = mockRes();
    mw(req2, res2, () => { res2.json({ page: 2 }); });

    // Verify each cached with its own params
    const req3 = mockReq({ url: '/api/x?page=1', originalUrl: '/api/x?page=1' });
    const res3 = mockRes();
    mw(req3, res3, () => {});
    expect(res3._sentBody).toEqual({ page: 1 });
  });

  it('cache entry expires after TTL', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const shortCache = createResponseCache({ defaultTtl: 100 });
      const mw = shortCache.middleware();

      const req1 = mockReq();
      const res1 = mockRes();
      mw(req1, res1, () => { res1.json({ v: 'old' }); });

      // Advance past TTL
      vi.advanceTimersByTime(150);

      // Should be a miss now
      const req2 = mockReq();
      const res2 = mockRes();
      const next2 = vi.fn(() => { res2.json({ v: 'new' }); });
      mw(req2, res2, next2);
      expect(next2).toHaveBeenCalled();
      expect(res2._sentBody).toEqual({ v: 'new' });
      expect(res2._headers['X-Cache']).toBe('MISS');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Cache-Control: no-cache bypasses cache', () => {
    const mw = responseCache.middleware();

    // Populate cache
    const req1 = mockReq();
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ cached: true }); });

    // Bypass with no-cache
    const req2 = mockReq({ headers: { 'cache-control': 'no-cache' } });
    const res2 = mockRes();
    const next2 = vi.fn();
    mw(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
    expect(res2._headers['X-Cache']).toBeUndefined();
  });

  it('invalidate() clears matching entries', () => {
    const mw = responseCache.middleware();

    // Populate two entries
    const req1 = mockReq({ url: '/api/health', originalUrl: '/api/health' });
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ a: 1 }); });

    const req2 = mockReq({ url: '/api/metrics', originalUrl: '/api/metrics' });
    const res2 = mockRes();
    mw(req2, res2, () => { res2.json({ b: 2 }); });

    expect(responseCache.getStats().size).toBe(2);

    // Invalidate only /api/health
    responseCache.invalidate('/api/health');
    expect(responseCache.getStats().size).toBe(1);

    // /api/metrics should still be cached
    const req3 = mockReq({ url: '/api/metrics', originalUrl: '/api/metrics' });
    const res3 = mockRes();
    mw(req3, res3, () => {});
    expect(res3._sentBody).toEqual({ b: 2 });
    expect(res3._headers['X-Cache']).toBe('HIT');
  });

  it('invalidate() without pattern clears all', () => {
    const mw = responseCache.middleware();

    const req1 = mockReq({ url: '/api/a', originalUrl: '/api/a' });
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ a: 1 }); });

    const req2 = mockReq({ url: '/api/b', originalUrl: '/api/b' });
    const res2 = mockRes();
    mw(req2, res2, () => { res2.json({ b: 2 }); });

    expect(responseCache.getStats().size).toBe(2);
    responseCache.invalidate();
    expect(responseCache.getStats().size).toBe(0);
  });

  it('clear() resets everything', () => {
    const mw = responseCache.middleware();

    // Generate some hits and misses
    const req1 = mockReq();
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ v: 1 }); });

    const req2 = mockReq();
    const res2 = mockRes();
    mw(req2, res2, () => {});

    expect(responseCache.getStats().hits).toBe(1);
    expect(responseCache.getStats().misses).toBe(1);
    expect(responseCache.getStats().size).toBe(1);

    responseCache.clear();

    expect(responseCache.getStats().hits).toBe(0);
    expect(responseCache.getStats().misses).toBe(0);
    expect(responseCache.getStats().size).toBe(0);
    expect(responseCache.getStats().hitRate).toBe(0);
  });

  it('getStats() returns correct hit/miss counts and hitRate', () => {
    const mw = responseCache.middleware();

    // 1 miss (populate)
    const req1 = mockReq({ url: '/api/a', originalUrl: '/api/a' });
    const res1 = mockRes();
    mw(req1, res1, () => { res1.json({ v: 1 }); });

    // 3 hits
    for (let i = 0; i < 3; i++) {
      const req = mockReq({ url: '/api/a', originalUrl: '/api/a' });
      const res = mockRes();
      mw(req, res, () => {});
    }

    const stats = responseCache.getStats();
    expect(stats.hits).toBe(3);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.75);
    expect(stats.size).toBe(1);
  });

  it('maxEntries eviction (LRU)', () => {
    const tinyCache = createResponseCache({ maxEntries: 2 });
    const mw = tinyCache.middleware();

    // Insert 3 entries — first should be evicted
    const urls = ['/api/a', '/api/b', '/api/c'];
    for (const url of urls) {
      const req = mockReq({ url, originalUrl: url });
      const res = mockRes();
      mw(req, res, () => { res.json({ url }); });
    }

    expect(tinyCache.getStats().size).toBe(2);

    // /api/a should have been evicted (LRU)
    const reqA = mockReq({ url: '/api/a', originalUrl: '/api/a' });
    const resA = mockRes();
    const nextA = vi.fn(() => { resA.json({ fresh: true }); });
    mw(reqA, resA, nextA);
    expect(nextA).toHaveBeenCalled(); // cache miss
    expect(resA._headers['X-Cache']).toBe('MISS');
  });

  it('per-route TTL override works', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const mw1 = responseCache.middleware({ ttl: 100 });
      const mw2 = responseCache.middleware({ ttl: 10000 });

      // Short TTL route
      const req1 = mockReq({ url: '/api/short', originalUrl: '/api/short' });
      const res1 = mockRes();
      mw1(req1, res1, () => { res1.json({ v: 'short' }); });

      // Long TTL route
      const req2 = mockReq({ url: '/api/long', originalUrl: '/api/long' });
      const res2 = mockRes();
      mw2(req2, res2, () => { res2.json({ v: 'long' }); });

      // Advance past short TTL but not long
      vi.advanceTimersByTime(200);

      // Short should miss
      const req3 = mockReq({ url: '/api/short', originalUrl: '/api/short' });
      const res3 = mockRes();
      const next3 = vi.fn(() => { res3.json({ v: 'refreshed' }); });
      mw1(req3, res3, next3);
      expect(next3).toHaveBeenCalled();

      // Long should still hit
      const req4 = mockReq({ url: '/api/long', originalUrl: '/api/long' });
      const res4 = mockRes();
      mw2(req4, res4, () => {});
      expect(res4._sentBody).toEqual({ v: 'long' });
      expect(res4._headers['X-Cache']).toBe('HIT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cache returns same status code', () => {
    const mw = responseCache.middleware();

    // Store a 201 response
    const req1 = mockReq({ url: '/api/created', originalUrl: '/api/created' });
    const res1 = mockRes();
    mw(req1, res1, () => { res1.status(201).json({ id: 'abc' }); });
    expect(res1.statusCode).toBe(201);

    // Cache hit should restore 201
    const req2 = mockReq({ url: '/api/created', originalUrl: '/api/created' });
    const res2 = mockRes();
    mw(req2, res2, () => {});
    expect(res2.statusCode).toBe(201);
    expect(res2._sentBody).toEqual({ id: 'abc' });
  });

  it('cache returns same Content-Type header', () => {
    const mw = responseCache.middleware();

    const req1 = mockReq({ url: '/api/typed', originalUrl: '/api/typed' });
    const res1 = mockRes();
    res1.setHeader('content-type', 'application/json; charset=utf-8');
    mw(req1, res1, () => { res1.json({ typed: true }); });

    // Cache hit should restore content-type
    const req2 = mockReq({ url: '/api/typed', originalUrl: '/api/typed' });
    const res2 = mockRes();
    mw(req2, res2, () => {});
    expect(res2._headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('DELETE/PUT/PATCH requests are not cached', () => {
    const mw = responseCache.middleware();

    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      const req = mockReq({ method });
      const res = mockRes();
      const next = vi.fn();
      mw(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res._headers['X-Cache']).toBeUndefined();
    }
  });

  it('default TTL is 5000ms', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      const defaultCache = createResponseCache(); // no explicit TTL
      const mw = defaultCache.middleware();

      const req1 = mockReq();
      const res1 = mockRes();
      mw(req1, res1, () => { res1.json({ v: 1 }); });

      // Advance 4s — should still be cached
      vi.advanceTimersByTime(4000);
      const req2 = mockReq();
      const res2 = mockRes();
      mw(req2, res2, () => {});
      expect(res2._headers['X-Cache']).toBe('HIT');

      // Advance past 5s total — should expire
      vi.advanceTimersByTime(2000);
      const req3 = mockReq();
      const res3 = mockRes();
      const next3 = vi.fn(() => { res3.json({ v: 2 }); });
      mw(req3, res3, next3);
      expect(next3).toHaveBeenCalled();
      expect(res3._headers['X-Cache']).toBe('MISS');
    } finally {
      vi.useRealTimers();
    }
  });
});
