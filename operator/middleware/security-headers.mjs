// ============================================================
// Security Headers Middleware (Phase 58)
// ============================================================
// Sets standard security headers on all HTTP responses:
// X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
// Content-Security-Policy, Permissions-Policy.
// ============================================================

/**
 * CDN origins used by the operator UI (Pico CSS, HTMX, xterm.js).
 */
const CDN_ORIGINS = [
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
];

/**
 * Create security-headers middleware.
 * @param {object} [options]
 * @param {string[]} [options.extraScriptSrc]  - Additional script-src origins
 * @param {string[]} [options.extraStyleSrc]   - Additional style-src origins
 * @param {string[]} [options.extraConnectSrc]  - Additional connect-src origins
 * @returns {Function} Express middleware
 */
export function createSecurityHeaders(options = {}) {
  const scriptSrc = ["'self'", ...CDN_ORIGINS, ...(options.extraScriptSrc || [])].join(' ');
  const styleSrc = ["'self'", "'unsafe-inline'", ...CDN_ORIGINS, ...(options.extraStyleSrc || [])].join(' ');
  const connectSrc = ["'self'", 'ws:', 'wss:', ...(options.extraConnectSrc || [])].join(' ');

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `connect-src ${connectSrc}`,
    `img-src 'self' data:`,
    `font-src 'self' ${CDN_ORIGINS.join(' ')}`,
    `frame-ancestors 'none'`,
  ].join('; ');

  return function securityHeaders(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  };
}
