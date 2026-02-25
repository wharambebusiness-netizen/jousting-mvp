// Structured Logger & Request-ID Middleware Tests (Phase 28)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLogger, LOG_LEVELS } from '../logger.mjs';
import { createRequestIdMiddleware } from '../middleware/request-id.mjs';

// ── Helpers ─────────────────────────────────────────────────

/** Create a sink that captures written lines as parsed JSON. */
function createCaptureSink() {
  const lines = [];
  return {
    lines,
    write(chunk) { lines.push(JSON.parse(chunk)); },
  };
}

/** Create a minimal Express-like request mock. */
function mockReq(overrides = {}) {
  return {
    method: 'GET',
    path: '/api/health',
    headers: {},
    ...overrides,
  };
}

/** Create a minimal Express-like response mock with event emitter. */
function mockRes() {
  const headers = {};
  const listeners = {};
  return {
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    _headers: headers,
    on(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    _emit(event) {
      for (const fn of listeners[event] || []) fn();
    },
  };
}

// ── LOG_LEVELS Export ───────────────────────────────────────

describe('LOG_LEVELS', () => {
  it('exports all four level constants', () => {
    expect(LOG_LEVELS).toEqual({ debug: 0, info: 1, warn: 2, error: 3 });
  });

  it('debug is the lowest level', () => {
    expect(LOG_LEVELS.debug).toBe(0);
  });

  it('error is the highest level', () => {
    expect(LOG_LEVELS.error).toBe(3);
  });
});

// ── createLogger Factory ────────────────────────────────────

describe('createLogger', () => {
  it('returns an object with debug, info, warn, error, child, fromRequest', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
    expect(typeof logger.fromRequest).toBe('function');
  });

  it('defaults minLevel to info', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.debug('should be suppressed');
    logger.info('should appear');
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].msg).toBe('should appear');
  });
});

// ── Structured Output ───────────────────────────────────────

describe('structured output', () => {
  it('writes valid JSON with ts, level, msg fields', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.info('hello world');
    const entry = sink.lines[0];
    expect(entry.ts).toBeDefined();
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello world');
  });

  it('includes metadata in output', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.info('started', { port: 3100, host: '127.0.0.1' });
    const entry = sink.lines[0];
    expect(entry.port).toBe(3100);
    expect(entry.host).toBe('127.0.0.1');
  });

  it('ts is a valid ISO 8601 timestamp', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.info('check');
    const ts = new Date(sink.lines[0].ts);
    expect(ts.getTime()).not.toBeNaN();
  });
});

// ── Level Filtering ─────────────────────────────────────────

describe('level filtering', () => {
  it('suppresses debug at info level (default)', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.debug('suppressed');
    expect(sink.lines).toHaveLength(0);
  });

  it('shows info at info level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.info('shown');
    expect(sink.lines).toHaveLength(1);
  });

  it('shows warn at info level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.warn('shown');
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].level).toBe('warn');
  });

  it('shows error at info level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.error('shown');
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].level).toBe('error');
  });

  it('shows debug when minLevel is debug', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink, minLevel: 'debug' });
    logger.debug('visible');
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].level).toBe('debug');
  });

  it('suppresses info and warn at error level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink, minLevel: 'error' });
    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('yes');
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].level).toBe('error');
  });

  it('suppresses debug and info at warn level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink, minLevel: 'warn' });
    logger.debug('no');
    logger.info('no');
    logger.warn('yes');
    logger.error('also yes');
    expect(sink.lines).toHaveLength(2);
  });
});

// ── All Four Level Methods ──────────────────────────────────

describe('all level methods', () => {
  it('debug writes at debug level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink, minLevel: 'debug' });
    logger.debug('d');
    expect(sink.lines[0].level).toBe('debug');
  });

  it('info writes at info level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.info('i');
    expect(sink.lines[0].level).toBe('info');
  });

  it('warn writes at warn level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.warn('w');
    expect(sink.lines[0].level).toBe('warn');
  });

  it('error writes at error level', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.error('e');
    expect(sink.lines[0].level).toBe('error');
  });
});

// ── child() ─────────────────────────────────────────────────

describe('child()', () => {
  it('merges metadata into all subsequent log calls', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const child = logger.child({ terminalId: 'abc' });
    child.info('hello');
    expect(sink.lines[0].terminalId).toBe('abc');
    expect(sink.lines[0].msg).toBe('hello');
  });

  it('preserves parent minLevel in child', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink, minLevel: 'warn' });
    const child = logger.child({ component: 'pool' });
    child.info('suppressed');
    child.warn('shown');
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].component).toBe('pool');
  });

  it('child of child merges all metadata', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const child1 = logger.child({ a: 1 });
    const child2 = child1.child({ b: 2 });
    child2.info('deep');
    expect(sink.lines[0].a).toBe(1);
    expect(sink.lines[0].b).toBe(2);
  });

  it('call-site meta overrides child meta', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const child = logger.child({ x: 'base' });
    child.info('override', { x: 'override' });
    expect(sink.lines[0].x).toBe('override');
  });

  it('does not mutate parent logger', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.child({ extra: true });
    logger.info('no extra');
    expect(sink.lines[0]).not.toHaveProperty('extra');
  });
});

// ── fromRequest() ───────────────────────────────────────────

describe('fromRequest()', () => {
  it('creates child logger with reqId from req.id', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const reqLogger = logger.fromRequest({ id: 'abc12345' });
    reqLogger.info('handling');
    expect(sink.lines[0].reqId).toBe('abc12345');
  });

  it('inherits parent metadata', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const child = logger.child({ service: 'api' });
    const reqLogger = child.fromRequest({ id: 'req1' });
    reqLogger.info('test');
    expect(sink.lines[0].service).toBe('api');
    expect(sink.lines[0].reqId).toBe('req1');
  });
});

// ── Request-ID Middleware ───────────────────────────────────

describe('createRequestIdMiddleware', () => {
  it('generates 8-char hex reqId when no header present', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const mw = createRequestIdMiddleware(logger);

    const req = mockReq();
    const res = mockRes();
    mw(req, res, () => {});

    expect(req.id).toBeDefined();
    expect(req.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('reads reqId from X-Request-Id header', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const mw = createRequestIdMiddleware(logger);

    const req = mockReq({ headers: { 'x-request-id': 'custom-id-123' } });
    const res = mockRes();
    mw(req, res, () => {});

    expect(req.id).toBe('custom-id-123');
  });

  it('sets X-Request-Id response header', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const mw = createRequestIdMiddleware(logger);

    const req = mockReq();
    const res = mockRes();
    mw(req, res, () => {});

    expect(res._headers['X-Request-Id']).toBe(req.id);
  });

  it('logs request at info level with method, path, reqId', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const mw = createRequestIdMiddleware(logger);

    const req = mockReq({ method: 'POST', path: '/api/tasks' });
    const res = mockRes();
    mw(req, res, () => {});

    const requestLog = sink.lines.find(l => l.msg === 'request');
    expect(requestLog).toBeDefined();
    expect(requestLog.method).toBe('POST');
    expect(requestLog.path).toBe('/api/tasks');
    expect(requestLog.reqId).toBeDefined();
  });

  it('logs response on finish with status and durationMs', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const mw = createRequestIdMiddleware(logger);

    const req = mockReq({ method: 'GET', path: '/api/health' });
    const res = mockRes();
    res.statusCode = 200;
    mw(req, res, () => {});

    // Simulate response finish
    res._emit('finish');

    const responseLog = sink.lines.find(l => l.msg === 'response');
    expect(responseLog).toBeDefined();
    expect(responseLog.method).toBe('GET');
    expect(responseLog.path).toBe('/api/health');
    expect(responseLog.status).toBe(200);
    expect(typeof responseLog.durationMs).toBe('number');
    expect(responseLog.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls next() to continue middleware chain', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const mw = createRequestIdMiddleware(logger);

    const next = vi.fn();
    mw(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('response log includes same reqId as request log', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    const mw = createRequestIdMiddleware(logger);

    const req = mockReq();
    const res = mockRes();
    mw(req, res, () => {});
    res._emit('finish');

    const requestLog = sink.lines.find(l => l.msg === 'request');
    const responseLog = sink.lines.find(l => l.msg === 'response');
    expect(requestLog.reqId).toBe(responseLog.reqId);
  });
});

// ── Sink Override ───────────────────────────────────────────

describe('sink override', () => {
  it('captures output when custom sink is provided', () => {
    const sink = createCaptureSink();
    const logger = createLogger({ sink });
    logger.info('captured');
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0].msg).toBe('captured');
  });

  it('writes raw JSON string + newline to sink', () => {
    const raw = [];
    const sink = { write(chunk) { raw.push(chunk); } };
    const logger = createLogger({ sink });
    logger.info('raw');
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatch(/\n$/);
    expect(() => JSON.parse(raw[0])).not.toThrow();
  });
});
