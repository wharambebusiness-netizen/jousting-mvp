// Input Validation & API Hardening Tests (Phase 29)
import { describe, it, expect, vi } from 'vitest';
import { validateBody, sanitizeId, sanitizeString, paginationParams } from '../validation.mjs';
import { errorHandler, notFoundHandler } from '../error-response.mjs';

// ── Helpers ────────────────────────────────────────────────

/** Create a mock Express res object */
function mockRes() {
  const res = {
    _status: null,
    _json: null,
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; },
  };
  return res;
}

/** Create a mock Express req with body */
function mockReq(body, query = {}) {
  return { body, query, path: '/test', id: 'req-123' };
}

// ============================================================
// validateBody
// ============================================================

describe('validateBody', () => {
  it('rejects missing required string field with 400', () => {
    const mw = validateBody({ name: { type: 'string', required: true } });
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._status).toBe(400);
    expect(res._json.error).toBe('Validation failed');
    expect(res._json.field).toBe('name');
    expect(res._json.details).toContain('required');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects wrong type (string where number expected)', () => {
    const mw = validateBody({ count: { type: 'number' } });
    const req = mockReq({ count: 'hello' });
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._status).toBe(400);
    expect(res._json.field).toBe('count');
    expect(res._json.details).toContain('number');
    expect(next).not.toHaveBeenCalled();
  });

  it('clamps numbers to min/max', () => {
    const mw = validateBody({ priority: { type: 'number', min: 1, max: 10 } });
    const req = mockReq({ priority: 0 });
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.priority).toBe(1);

    // Test max clamping
    const req2 = mockReq({ priority: 20 });
    const res2 = mockRes();
    const next2 = vi.fn();
    mw(req2, res2, next2);
    expect(next2).toHaveBeenCalled();
    expect(req2.body.priority).toBe(10);
  });

  it('validates against enum', () => {
    const mw = validateBody({ status: { type: 'string', enum: ['active', 'inactive'] } });
    const req = mockReq({ status: 'deleted' });
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._status).toBe(400);
    expect(res._json.field).toBe('status');
    expect(res._json.details).toContain('active');
    expect(next).not.toHaveBeenCalled();
  });

  it('validates against pattern regex', () => {
    const mw = validateBody({ id: { type: 'string', pattern: /^[a-zA-Z0-9_-]+$/ } });
    const req = mockReq({ id: 'has spaces!' });
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._status).toBe(400);
    expect(res._json.field).toBe('id');
    expect(res._json.details).toContain('pattern');
    expect(next).not.toHaveBeenCalled();
  });

  it('validates maxLength for strings', () => {
    const mw = validateBody({ name: { type: 'string', maxLength: 5 } });
    const req = mockReq({ name: 'toolong' });
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._status).toBe(400);
    expect(res._json.field).toBe('name');
    expect(res._json.details).toContain('maximum length');
    expect(next).not.toHaveBeenCalled();
  });

  it('applies defaults for missing optional fields', () => {
    const mw = validateBody({ priority: { type: 'number', default: 5 } });
    const req = mockReq({});
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.priority).toBe(5);
  });

  it('passes valid body through', () => {
    const mw = validateBody({
      name: { type: 'string', required: true },
      count: { type: 'number', min: 0, max: 100 },
    });
    const req = mockReq({ name: 'test', count: 42 });
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._status).toBeNull();
  });

  it('rejects non-object body', () => {
    const mw = validateBody({ name: { type: 'string' } });
    const req = mockReq('not an object');
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._status).toBe(400);
    expect(res._json.details).toContain('JSON object');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects array body', () => {
    const mw = validateBody({ name: { type: 'string' } });
    const req = mockReq([1, 2, 3]);
    const res = mockRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res._status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('validates array type correctly', () => {
    const mw = validateBody({ items: { type: 'array', required: true } });

    // Array should pass
    const req1 = mockReq({ items: [1, 2, 3] });
    const res1 = mockRes();
    const next1 = vi.fn();
    mw(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    // Object should fail
    const req2 = mockReq({ items: { a: 1 } });
    const res2 = mockRes();
    const next2 = vi.fn();
    mw(req2, res2, next2);
    expect(res2._status).toBe(400);
    expect(res2._json.details).toContain('array');
  });
});

// ============================================================
// sanitizeId
// ============================================================

describe('sanitizeId', () => {
  it('strips invalid chars', () => {
    expect(sanitizeId('hello world!@#$%')).toBe('helloworld');
    expect(sanitizeId('my-id_123')).toBe('my-id_123');
  });

  it('truncates at 64 chars', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeId(long)).toHaveLength(64);
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeId(null)).toBe('');
    expect(sanitizeId(undefined)).toBe('');
  });
});

// ============================================================
// sanitizeString
// ============================================================

describe('sanitizeString', () => {
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('truncates at maxLen', () => {
    expect(sanitizeString('abcdef', 3)).toBe('abc');
  });

  it('strips control chars but keeps \\n and \\t', () => {
    const input = 'hello\tworld\nfoo\x00\x01\x1fbar';
    const result = sanitizeString(input);
    expect(result).toContain('\t');
    expect(result).toContain('\n');
    expect(result).not.toContain('\x00');
    expect(result).not.toContain('\x01');
    expect(result).not.toContain('\x1f');
    expect(result).toBe('hello\tworld\nfoobar');
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeString(null)).toBe('');
    expect(sanitizeString(undefined)).toBe('');
  });
});

// ============================================================
// paginationParams
// ============================================================

describe('paginationParams', () => {
  it('returns defaults when no query', () => {
    const req = mockReq(null, {});
    const { limit, offset } = paginationParams(req);
    expect(limit).toBe(50);
    expect(offset).toBe(0);
  });

  it('clamps limit to 1-100', () => {
    const req1 = mockReq(null, { limit: '0', offset: '0' });
    expect(paginationParams(req1).limit).toBe(1);

    const req2 = mockReq(null, { limit: '200', offset: '0' });
    expect(paginationParams(req2).limit).toBe(100);

    const req3 = mockReq(null, { limit: '-5', offset: '0' });
    expect(paginationParams(req3).limit).toBe(1);
  });

  it('clamps offset to 0+', () => {
    const req = mockReq(null, { limit: '10', offset: '-5' });
    expect(paginationParams(req).offset).toBe(0);
  });

  it('handles NaN values', () => {
    const req = mockReq(null, { limit: 'abc', offset: 'xyz' });
    const { limit, offset } = paginationParams(req);
    expect(limit).toBe(50);
    expect(offset).toBe(0);
  });

  it('respects custom defaults', () => {
    const req = mockReq(null, {});
    const { limit, offset } = paginationParams(req, { limit: 25, offset: 10 });
    expect(limit).toBe(25);
    expect(offset).toBe(10);
  });
});

// ============================================================
// errorHandler
// ============================================================

describe('errorHandler', () => {
  it('logs error and returns consistent shape', () => {
    const logger = { error: vi.fn() };
    const mw = errorHandler(logger);

    const err = new Error('Something broke');
    const req = { path: '/api/test', id: 'req-456' };
    const res = mockRes();
    const next = vi.fn();

    mw(err, req, res, next);

    expect(res._status).toBe(500);
    expect(res._json.error).toBe('Something broke');
    expect(res._json.code).toBe('INTERNAL_ERROR');
    expect(res._json.reqId).toBe('req-456');
    expect(logger.error).toHaveBeenCalled();
  });

  it('uses err.status and err.code when available', () => {
    const logger = { error: vi.fn() };
    const mw = errorHandler(logger);

    const err = new Error('Not allowed');
    err.status = 403;
    err.code = 'FORBIDDEN';
    const req = { path: '/api/secret', id: 'req-789' };
    const res = mockRes();
    const next = vi.fn();

    mw(err, req, res, next);

    expect(res._status).toBe(403);
    expect(res._json.code).toBe('FORBIDDEN');
    expect(res._json.error).toBe('Not allowed');
  });

  it('includes reqId from request', () => {
    const logger = { error: vi.fn() };
    const mw = errorHandler(logger);

    const err = new Error('fail');
    const req = { path: '/api/x', id: 'unique-id-99' };
    const res = mockRes();

    mw(err, req, res, vi.fn());

    expect(res._json.reqId).toBe('unique-id-99');
  });

  it('handles missing logger gracefully', () => {
    const mw = errorHandler(null);
    const err = new Error('fail');
    const req = { path: '/api/x', id: 'req-1' };
    const res = mockRes();

    mw(err, req, res, vi.fn());

    expect(res._status).toBe(500);
    expect(res._json.error).toBe('fail');
  });
});

// ============================================================
// notFoundHandler
// ============================================================

describe('notFoundHandler', () => {
  it('returns 404 with path', () => {
    const req = { path: '/api/nonexistent' };
    const res = mockRes();

    notFoundHandler(req, res);

    expect(res._status).toBe(404);
    expect(res._json.error).toBe('Not found');
    expect(res._json.path).toBe('/api/nonexistent');
  });
});
