// ============================================================
// CSRF Protection Middleware (Phase 58)
// ============================================================
// Double-submit cookie pattern (stateless, no sessions needed).
// On GET/HEAD/OPTIONS: sets a _csrf cookie with a random token.
// On POST/PUT/DELETE/PATCH: validates the X-CSRF-Token header
// matches the _csrf cookie value.
//
// Bypasses:
//  - Requests with valid Authorization: Bearer header (API clients)
//  - WebSocket upgrade requests
//  - Configurable skip paths (health, metrics, etc.)
// ============================================================

import { randomBytes } from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_LENGTH = 32; // 32 random bytes → 64 hex chars

/**
 * Create CSRF protection middleware.
 * @param {object} [options]
 * @param {string[]} [options.skipPaths]   - Path prefixes to skip (default: health/metrics/openapi)
 * @param {boolean}  [options.secure]      - Set Secure flag on cookie (default: false for localhost)
 * @param {Function} [options.isAuthenticated] - Custom check for bearer-auth bypass
 * @returns {{ middleware: Function, generateToken: Function }}
 */
export function createCsrfProtection(options = {}) {
  const skipPaths = options.skipPaths || [
    '/api/health',
    '/api/metrics',
    '/api/openapi.json',
    '/api/docs',
  ];
  const secure = options.secure || false;

  /**
   * Generate a random CSRF token.
   */
  function generateToken() {
    return randomBytes(TOKEN_LENGTH).toString('hex');
  }

  /**
   * Parse cookies from a request header string.
   */
  function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    for (const pair of cookieHeader.split(';')) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      cookies[key] = val;
    }
    return cookies;
  }

  function middleware(req, res, next) {
    // Skip WebSocket upgrade requests
    if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
      return next();
    }

    // Skip configured paths
    for (const prefix of skipPaths) {
      if (req.path === prefix || req.path.startsWith(prefix + '/')) {
        return next();
      }
    }

    // Skip if request has Bearer authentication (API clients)
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ') && authHeader.length > 10) {
      return next();
    }

    // For safe methods: ensure a CSRF cookie exists
    if (SAFE_METHODS.has(req.method)) {
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies._csrf) {
        const token = generateToken();
        const cookieFlags = [
          `_csrf=${token}`,
          'Path=/',
          'SameSite=Strict',
        ];
        if (secure) cookieFlags.push('Secure');
        res.setHeader('Set-Cookie', cookieFlags.join('; '));
      }
      return next();
    }

    // For state-changing methods: validate token
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies._csrf;
    const headerToken = req.headers['x-csrf-token'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return res.status(403).json({ error: 'CSRF token mismatch' });
    }

    next();
  }

  return { middleware, generateToken };
}
