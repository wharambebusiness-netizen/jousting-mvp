// ============================================================
// Request ID Middleware (Phase 28)
// ============================================================
// Express middleware that generates or reads a correlation ID
// for each request, sets it on req.id and the response header,
// and logs request start/finish with duration.
// ============================================================

import { randomBytes } from 'node:crypto';

/**
 * Create request-id middleware.
 * @param {{ info: Function }} logger - Logger instance with info() method
 * @returns {Function} Express middleware
 */
export function createRequestIdMiddleware(logger) {
  return function requestIdMiddleware(req, res, next) {
    const reqId = req.headers['x-request-id'] || randomBytes(4).toString('hex');
    req.id = reqId;
    res.setHeader('X-Request-Id', reqId);

    const start = Date.now();
    logger.info('request', { method: req.method, path: req.path, reqId });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      logger.info('response', { method: req.method, path: req.path, reqId, status: res.statusCode, durationMs });
    });

    next();
  };
}
