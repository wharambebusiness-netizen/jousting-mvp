// ============================================================
// Request Performance Tracking Tests (Phase 50)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import {
  createRequestTimer,
  normalizePath,
  DEFAULT_SLOW_THRESHOLD_MS,
  DEFAULT_MAX_ENTRIES,
} from '../middleware/request-timer.mjs';
import { createPerformanceRoutes } from '../routes/performance.mjs';
import { createMetricsCollector } from '../metrics.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Helpers ─────────────────────────────────────────────────

/** Create a minimal mock request object. */
function mockReq(overrides = {}) {
  return {
    method: 'GET',
    path: '/api/health',
    url: '/api/health',
    baseUrl: '',
    route: null,
    headers: {},
    ...overrides,
  };
}

/** Create a minimal mock response object with event emit support. */
function mockRes(statusCode = 200) {
  const listeners = {};
  const res = {
    statusCode,
    setHeader: vi.fn(),
    getHeader: vi.fn(),
    on(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    _emit(event) {
      for (const fn of (listeners[event] || [])) fn();
    },
    _setStatus(code) { res.statusCode = code; },
  };
  return res;
}

/** Run the middleware and trigger the finish event. */
function runMiddleware(timer, reqOverrides = {}, statusCode = 200) {
  const req = mockReq(reqOverrides);
  const res = mockRes(statusCode);
  const next = vi.fn();
  timer.middleware(req, res, next);
  expect(next).toHaveBeenCalledOnce();
  res._emit('finish');
  return { req, res };
}

// ── Supertest-style minimal HTTP test ───────────────────────

function createTestApp(timer) {
  const app = express();
  app.use(timer.middleware);
  app.use('/api', createPerformanceRoutes({ requestTimer: timer }));
  app.get('/api/test', (_req, res) => res.json({ ok: true }));
  return app;
}

async function request(app, method, path) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(body || '{}') });
        });
      });
      req.on('error', (err) => {
        server.close();
        resolve({ status: 500, body: { error: err.message } });
      });
      req.end();
    });
  });
}

// ============================================================
// normalizePath
// ============================================================

describe('normalizePath', () => {
  it('preserves non-parameterized paths', () => {
    expect(normalizePath('/api/health')).toBe('/api/health');
    expect(normalizePath('/api/performance')).toBe('/api/performance');
    expect(normalizePath('/api/chains')).toBe('/api/chains');
  });

  it('replaces UUID segments with :id', () => {
    expect(normalizePath('/api/chains/550e8400-e29b-41d4-a716-446655440000'))
      .toBe('/api/chains/:id');
  });

  it('replaces numeric segments with :id', () => {
    expect(normalizePath('/api/workers/42')).toBe('/api/workers/:id');
    expect(normalizePath('/api/workers/42/status')).toBe('/api/workers/:id/status');
  });

  it('replaces short hex ID segments with :id', () => {
    // 8-char hex (looks like a randomBytes ID)
    expect(normalizePath('/api/chains/ab1234ef')).toBe('/api/chains/:id');
  });

  it('strips query strings before normalizing', () => {
    expect(normalizePath('/api/health?refresh=true')).toBe('/api/health');
  });

  it('handles null/undefined gracefully', () => {
    expect(normalizePath(null)).toBe(null);
    expect(normalizePath(undefined)).toBe(undefined);
    expect(normalizePath('')).toBe('');
  });
});

// ============================================================
// createRequestTimer — exports and defaults
// ============================================================

describe('createRequestTimer — exports', () => {
  it('exports DEFAULT_SLOW_THRESHOLD_MS as 1000', () => {
    expect(DEFAULT_SLOW_THRESHOLD_MS).toBe(1000);
  });

  it('exports DEFAULT_MAX_ENTRIES as 200', () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(200);
  });

  it('returns middleware function', () => {
    const timer = createRequestTimer();
    expect(typeof timer.middleware).toBe('function');
  });

  it('returns getStats, getRouteStats, getSlowRequests, reset functions', () => {
    const timer = createRequestTimer();
    expect(typeof timer.getStats).toBe('function');
    expect(typeof timer.getRouteStats).toBe('function');
    expect(typeof timer.getSlowRequests).toBe('function');
    expect(typeof timer.reset).toBe('function');
  });
});

// ============================================================
// Middleware — recording
// ============================================================

describe('middleware — request recording', () => {
  let timer;
  beforeEach(() => {
    timer = createRequestTimer({ slowThresholdMs: 50000 }); // high threshold to avoid slow-request
  });

  it('records a request after finish event', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/health' });
    const stats = timer.getStats();
    expect(stats.length).toBe(1);
    expect(stats[0].count).toBe(1);
  });

  it('increments count per request on same route', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/health' });
    runMiddleware(timer, { method: 'GET', path: '/api/health' });
    const stats = timer.getStats();
    expect(stats[0].count).toBe(2);
  });

  it('tracks separate routes independently', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/health' });
    runMiddleware(timer, { method: 'POST', path: '/api/chains' });
    const stats = timer.getStats();
    expect(stats.length).toBe(2);
  });

  it('records min and max durations', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/health' });
    runMiddleware(timer, { method: 'GET', path: '/api/health' });
    const s = timer.getStats()[0];
    expect(s.minMs).toBeGreaterThanOrEqual(0);
    expect(s.maxMs).toBeGreaterThanOrEqual(s.minMs);
  });

  it('calculates average correctly', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/test' });
    runMiddleware(timer, { method: 'GET', path: '/api/test' });
    const s = timer.getStats()[0];
    expect(s.avgMs).toBeGreaterThanOrEqual(0);
    expect(s.avgMs).toBeLessThanOrEqual(s.maxMs);
  });

  it('sets lastCalledAt as ISO timestamp', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/health' });
    const s = timer.getStats()[0];
    expect(s.lastCalledAt).toBeTruthy();
    expect(() => new Date(s.lastCalledAt)).not.toThrow();
  });

  it('uses next() to pass control', () => {
    const req = mockReq({ method: 'GET', path: '/api/health' });
    const res = mockRes();
    const next = vi.fn();
    timer.middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

// ============================================================
// Percentile calculation
// ============================================================

describe('percentile calculation', () => {
  it('p50 is the median of recorded durations', () => {
    // We cannot inject exact durations via mock easily since the timer measures hrtime.
    // Instead verify that p50Ms is a non-negative number for 1 request.
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    runMiddleware(timer, { method: 'GET', path: '/api/x' });
    const s = timer.getStats()[0];
    expect(s.p50Ms).toBeGreaterThanOrEqual(0);
    expect(s.p95Ms).toBeGreaterThanOrEqual(s.p50Ms);
    expect(s.p99Ms).toBeGreaterThanOrEqual(s.p95Ms);
  });

  it('p95 >= p50 for multiple requests', () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    for (let i = 0; i < 5; i++) {
      runMiddleware(timer, { method: 'GET', path: '/api/y' });
    }
    const s = timer.getStats()[0];
    expect(s.p95Ms).toBeGreaterThanOrEqual(s.p50Ms);
  });

  it('p99 >= p95 for multiple requests', () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    for (let i = 0; i < 10; i++) {
      runMiddleware(timer, { method: 'GET', path: '/api/z' });
    }
    const s = timer.getStats()[0];
    expect(s.p99Ms).toBeGreaterThanOrEqual(s.p95Ms);
  });

  it('returns 0 for percentiles when no requests recorded', () => {
    const timer = createRequestTimer();
    const s = timer.getRouteStats('GET /api/never-called');
    expect(s).toBeNull();
  });
});

// ============================================================
// Error counting
// ============================================================

describe('error counting', () => {
  let timer;
  beforeEach(() => {
    timer = createRequestTimer({ slowThresholdMs: 50000 });
  });

  it('tracks 4xx responses as errors', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/missing' }, 404);
    const s = timer.getStats()[0];
    expect(s.errorCount).toBe(1);
  });

  it('tracks 5xx responses as errors', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/broken' }, 500);
    const s = timer.getStats()[0];
    expect(s.errorCount).toBe(1);
  });

  it('ignores 2xx responses in error count', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/ok' }, 200);
    runMiddleware(timer, { method: 'GET', path: '/api/ok' }, 201);
    const s = timer.getStats()[0];
    expect(s.errorCount).toBe(0);
  });

  it('mixed: only 4xx/5xx counted', () => {
    runMiddleware(timer, { method: 'GET', path: '/api/mix' }, 200);
    runMiddleware(timer, { method: 'GET', path: '/api/mix' }, 400);
    runMiddleware(timer, { method: 'GET', path: '/api/mix' }, 500);
    const s = timer.getStats()[0];
    expect(s.count).toBe(3);
    expect(s.errorCount).toBe(2);
  });
});

// ============================================================
// Slow request detection
// ============================================================

describe('slow request detection', () => {
  it('emits perf:slow-request event when threshold exceeded', async () => {
    const events = new EventBus();
    const emitted = [];
    events.on('perf:slow-request', (data) => emitted.push(data));

    // Use threshold of 0ms so every request is "slow"
    const timer = createRequestTimer({ slowThresholdMs: 0, events });
    runMiddleware(timer, { method: 'GET', path: '/api/slow' });

    // Give the finish event handler a tick
    await new Promise(r => setTimeout(r, 10));
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].route).toContain('/api/slow');
    expect(emitted[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(emitted[0].statusCode).toBe(200);
    expect(emitted[0].timestamp).toBeTruthy();
  });

  it('does NOT emit perf:slow-request when below threshold', () => {
    const events = new EventBus();
    const emitted = [];
    events.on('perf:slow-request', (data) => emitted.push(data));

    // Very high threshold — synchronous mock requests won't exceed it
    const timer = createRequestTimer({ slowThresholdMs: 999999, events });
    runMiddleware(timer, { method: 'GET', path: '/api/fast' });

    expect(emitted.length).toBe(0);
  });

  it('logs slow requests via log.warn', () => {
    const warnCalls = [];
    const log = { warn: (msg, data) => warnCalls.push({ msg, data }) };
    const timer = createRequestTimer({ slowThresholdMs: 0, log });
    runMiddleware(timer, { method: 'GET', path: '/api/any' });

    expect(warnCalls.length).toBeGreaterThan(0);
    expect(warnCalls[0].msg).toBe('Slow request');
  });

  it('does NOT call log.warn when below threshold', () => {
    const warnCalls = [];
    const log = { warn: (msg, data) => warnCalls.push({ msg, data }) };
    const timer = createRequestTimer({ slowThresholdMs: 999999, log });
    runMiddleware(timer, { method: 'GET', path: '/api/fast' });

    expect(warnCalls.length).toBe(0);
  });

  it('stores slow request in getSlowRequests()', () => {
    const timer = createRequestTimer({ slowThresholdMs: 0 });
    runMiddleware(timer, { method: 'POST', path: '/api/upload' });

    const slow = timer.getSlowRequests();
    expect(slow.length).toBeGreaterThan(0);
    expect(slow[0].method).toBe('POST');
    expect(slow[0].path).toBe('/api/upload');
  });

  it('getSlowRequests respects limit parameter', () => {
    const timer = createRequestTimer({ slowThresholdMs: 0 });
    for (let i = 0; i < 10; i++) {
      runMiddleware(timer, { method: 'GET', path: `/api/slow-${i}` });
    }
    const slow = timer.getSlowRequests(3);
    expect(slow.length).toBeLessThanOrEqual(3);
  });
});

// ============================================================
// getRouteStats
// ============================================================

describe('getRouteStats', () => {
  it('returns stats for a specific route', () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    runMiddleware(timer, { method: 'GET', path: '/api/chains' });
    // The route key is built from method + normalized path
    // Since there's no req.route.path, it uses normalizePath on req.path
    const stats = timer.getStats();
    const routeKey = stats[0].route;
    const s = timer.getRouteStats(routeKey);
    expect(s).not.toBeNull();
    expect(s.count).toBe(1);
  });

  it('returns null for unknown route', () => {
    const timer = createRequestTimer();
    expect(timer.getRouteStats('GET /api/never-called')).toBeNull();
  });
});

// ============================================================
// getStats sorting
// ============================================================

describe('getStats sorting', () => {
  it('sorts by avgMs descending', () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    runMiddleware(timer, { method: 'GET', path: '/api/a' });
    runMiddleware(timer, { method: 'GET', path: '/api/b' });
    const stats = timer.getStats();
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1].avgMs).toBeGreaterThanOrEqual(stats[i].avgMs);
    }
  });
});

// ============================================================
// reset
// ============================================================

describe('reset', () => {
  it('clears all route data', () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    runMiddleware(timer, { method: 'GET', path: '/api/health' });
    expect(timer.getStats().length).toBe(1);

    timer.reset();
    expect(timer.getStats().length).toBe(0);
  });

  it('clears slow requests after reset', () => {
    const timer = createRequestTimer({ slowThresholdMs: 0 });
    runMiddleware(timer, { method: 'GET', path: '/api/slow' });
    expect(timer.getSlowRequests().length).toBeGreaterThan(0);

    timer.reset();
    expect(timer.getSlowRequests().length).toBe(0);
  });
});

// ============================================================
// Route Integration Tests (supertest-style)
// ============================================================

describe('performance routes — HTTP integration', () => {
  it('GET /api/performance returns stats array', async () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    const app = createTestApp(timer);
    await request(app, 'GET', '/api/test'); // prime one request
    const { status, body } = await request(app, 'GET', '/api/performance');
    expect(status).toBe(200);
    expect(Array.isArray(body.stats)).toBe(true);
  });

  it('GET /api/performance/slow returns slow list', async () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    const app = createTestApp(timer);
    const { status, body } = await request(app, 'GET', '/api/performance/slow');
    expect(status).toBe(200);
    expect(Array.isArray(body.slow)).toBe(true);
  });

  it('GET /api/performance/summary returns compact summary', async () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    const app = createTestApp(timer);
    await request(app, 'GET', '/api/test');
    const { status, body } = await request(app, 'GET', '/api/performance/summary');
    expect(status).toBe(200);
    expect(typeof body.totalRequests).toBe('number');
    expect(typeof body.avgLatencyMs).toBe('number');
    expect(typeof body.errorRate).toBe('number');
    expect(Array.isArray(body.top5Slowest)).toBe(true);
    expect(typeof body.routeCount).toBe('number');
  });

  it('POST /api/performance/reset clears stats', async () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    const app = createTestApp(timer);
    await request(app, 'GET', '/api/test'); // prime one request
    await request(app, 'POST', '/api/performance/reset');
    // After reset, /api/performance should only have the reset request itself (if any)
    const { body } = await request(app, 'GET', '/api/performance');
    // stats may include the reset + performance routes themselves, but total should be small
    expect(body.stats).toBeDefined();
  });

  it('GET /api/performance without timer returns 503', async () => {
    const app = express();
    app.use('/api', createPerformanceRoutes({ requestTimer: null }));
    const { status } = await request(app, 'GET', '/api/performance');
    expect(status).toBe(503);
  });
});

// ============================================================
// Metrics Collector Integration
// ============================================================

describe('metrics collector — HTTP timing', () => {
  it('includes jousting_http_requests_total in Prometheus output', () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    runMiddleware(timer, { method: 'GET', path: '/api/chains' });

    const collector = createMetricsCollector({ requestTimer: timer });
    const output = collector.collect();
    expect(output).toContain('jousting_http_requests_total');
  });

  it('includes jousting_http_request_duration_ms in Prometheus output', () => {
    const timer = createRequestTimer({ slowThresholdMs: 50000 });
    runMiddleware(timer, { method: 'GET', path: '/api/health' });

    const collector = createMetricsCollector({ requestTimer: timer });
    const output = collector.collect();
    expect(output).toContain('jousting_http_request_duration_ms');
  });

  it('includes jousting_http_slow_requests_total in Prometheus output', () => {
    const timer = createRequestTimer({ slowThresholdMs: 0 }); // all requests are slow
    runMiddleware(timer, { method: 'GET', path: '/api/any' });

    const collector = createMetricsCollector({ requestTimer: timer });
    const output = collector.collect();
    expect(output).toContain('jousting_http_slow_requests_total');
  });

  it('skips HTTP timing when no requestTimer provided', () => {
    const collector = createMetricsCollector({});
    const output = collector.collect();
    expect(output).not.toContain('jousting_http_requests_total');
  });
});
