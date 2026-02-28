// Error Response Middleware tests (Phase 29)
import { describe, it, expect, vi } from 'vitest';
import { errorHandler, notFoundHandler } from '../error-response.mjs';

// ── Mock Response Helper ────────────────────────────────────
// Mimics Express res.status(code).json(body) chaining pattern.

function mockRes() {
  let captured = {};
  const res = {
    status(code) {
      captured.status = code;
      return {
        json(body) {
          captured.body = body;
        },
      };
    },
  };
  return { res, captured };
}

// ── errorHandler ────────────────────────────────────────────

describe('errorHandler', () => {
  it('returns a function with 4 args (Express error middleware signature)', () => {
    const middleware = errorHandler(null);
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(4);
  });

  it('returns 500 with generic message for unspecified errors', () => {
    const handler = errorHandler(null);
    const { res, captured } = mockRes();
    const err = new Error('some secret detail');
    const req = { path: '/api/test', id: undefined };

    handler(err, req, res, () => {});

    expect(captured.status).toBe(500);
    expect(captured.body.error).toBe('Internal server error');
  });

  it('returns err.status when set (e.g. 400)', () => {
    const handler = errorHandler(null);
    const { res, captured } = mockRes();
    const err = new Error('Bad request');
    err.status = 400;
    const req = { path: '/api/test', id: 'abc123' };

    handler(err, req, res, () => {});

    expect(captured.status).toBe(400);
  });

  it('uses err.message for 4xx errors', () => {
    const handler = errorHandler(null);
    const { res, captured } = mockRes();
    const err = new Error('Validation failed');
    err.status = 422;
    const req = { path: '/api/test', id: 'r1' };

    handler(err, req, res, () => {});

    expect(captured.status).toBe(422);
    expect(captured.body.error).toBe('Validation failed');
  });

  it('hides err.message for 5xx errors (always Internal server error)', () => {
    const handler = errorHandler(null);
    const { res, captured } = mockRes();
    const err = new Error('database connection lost');
    err.status = 502;
    const req = { path: '/api/fail', id: 'r2' };

    handler(err, req, res, () => {});

    expect(captured.status).toBe(502);
    expect(captured.body.error).toBe('Internal server error');
  });

  it('includes reqId from req.id', () => {
    const handler = errorHandler(null);
    const { res, captured } = mockRes();
    const err = new Error('oops');
    err.status = 400;
    const req = { path: '/api/x', id: 'req-abc-123' };

    handler(err, req, res, () => {});

    expect(captured.body.reqId).toBe('req-abc-123');
  });

  it('includes err.code when set', () => {
    const handler = errorHandler(null);
    const { res, captured } = mockRes();
    const err = new Error('Not allowed');
    err.status = 403;
    err.code = 'FORBIDDEN';
    const req = { path: '/api/secret', id: 'r3' };

    handler(err, req, res, () => {});

    expect(captured.body.code).toBe('FORBIDDEN');
  });

  it('defaults code to INTERNAL_ERROR', () => {
    const handler = errorHandler(null);
    const { res, captured } = mockRes();
    const err = new Error('boom');
    const req = { path: '/api/boom', id: 'r4' };

    handler(err, req, res, () => {});

    expect(captured.body.code).toBe('INTERNAL_ERROR');
  });

  it('logs via logger.error', () => {
    const logger = { error: vi.fn() };
    const handler = errorHandler(logger);
    const { res } = mockRes();
    const err = new Error('bad input');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    const req = { path: '/api/validate', id: 'r5' };

    handler(err, req, res, () => {});

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith('Unhandled error', {
      error: 'bad input',
      code: 'VALIDATION_ERROR',
      status: 400,
      path: '/api/validate',
      reqId: 'r5',
    });
  });

  it('works without logger (null logger)', () => {
    const handler = errorHandler(null);
    const { res, captured } = mockRes();
    const err = new Error('no logger');
    err.status = 418;
    const req = { path: '/api/tea', id: 'r6' };

    // Should not throw
    expect(() => handler(err, req, res, () => {})).not.toThrow();
    expect(captured.status).toBe(418);
    expect(captured.body.error).toBe('no logger');
  });
});

// ── notFoundHandler ─────────────────────────────────────────

describe('notFoundHandler', () => {
  it('returns 404', () => {
    const { res, captured } = mockRes();
    const req = { path: '/api/nonexistent' };

    notFoundHandler(req, res);

    expect(captured.status).toBe(404);
    expect(captured.body.error).toBe('Not found');
  });

  it('includes path in response', () => {
    const { res, captured } = mockRes();
    const req = { path: '/api/missing/resource' };

    notFoundHandler(req, res);

    expect(captured.body.path).toBe('/api/missing/resource');
  });
});
