// ============================================================
// Error Response Middleware (Phase 29)
// ============================================================
// Standardized error handler and 404 catch-all for the operator
// REST API. Wire these AFTER all routes in server.mjs.
// ============================================================

/**
 * Express error-handling middleware (4 args required by Express).
 * Logs the error and returns a consistent JSON shape.
 * @param {object} logger - Logger with .error() method
 * @returns {Function} Express error middleware (err, req, res, next)
 */
export function errorHandler(logger) {
  return (err, req, res, _next) => {
    const status = err.status || 500;
    const code = err.code || 'INTERNAL_ERROR';
    const message = err.message || 'Internal server error';

    if (logger && typeof logger.error === 'function') {
      logger.error('Unhandled error', { error: message, code, status, path: req.path, reqId: req.id });
    }

    res.status(status).json({
      error: message,
      code,
      reqId: req.id,
    });
  };
}

/**
 * Catch-all 404 handler for unmatched routes.
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
}
