// ============================================================
// Authentication & Session Tokens (Phase 27)
// ============================================================
// Lightweight token-based auth layer for the operator HTTP API
// and WebSocket connections. Tokens use a jst_ prefix with
// 64 hex chars (32 random bytes). Only SHA-256 hashes are
// stored on disk — raw tokens are shown once at creation.
//
// Factory pattern: createAuth(ctx) returns auth methods.
// ============================================================

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const TOKEN_PREFIX = 'jst_';
const TOKEN_BYTE_LENGTH = 32; // 32 bytes = 64 hex chars
const TOKEN_ID_LENGTH = 8;    // 8 hex chars for short IDs

/**
 * Create an auth instance with its own path state.
 * @param {{ operatorDir: string }} ctx
 * @returns {{ generateToken, validateToken, revokeToken, listTokens, authMiddleware }}
 */
export function createAuth(ctx) {
  const tokensPath = join(ctx.operatorDir, '.data', 'auth-tokens.json');

  // ── Persistence ─────────────────────────────────────────

  function loadTokens() {
    if (!existsSync(tokensPath)) return {};
    try {
      const raw = readFileSync(tokensPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function saveTokens(tokens) {
    const dir = dirname(tokensPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = tokensPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(tokens, null, 2));
      renameSync(tmpFile, tokensPath);
    } catch {
      // Fallback: direct write
      try {
        writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
      } catch { /* swallow */ }
    }
  }

  // ── Token Operations ────────────────────────────────────

  function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generate a new token with optional label.
   * @param {string} [label] - Human-readable label
   * @returns {{ id: string, token: string, label: string, createdAt: string }}
   */
  function generateToken(label) {
    const id = randomBytes(TOKEN_ID_LENGTH / 2).toString('hex'); // 4 bytes = 8 hex chars
    const rawHex = randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
    const token = TOKEN_PREFIX + rawHex;
    const hash = hashToken(token);

    const tokens = loadTokens();
    tokens[id] = {
      hash,
      label: label || '',
      createdAt: new Date().toISOString(),
    };
    saveTokens(tokens);

    return { id, token, label: label || '', createdAt: tokens[id].createdAt };
  }

  /**
   * Validate a token string.
   * Uses constant-time comparison to prevent timing attacks.
   * @param {string} token - The raw token (jst_...)
   * @returns {{ valid: boolean, id?: string, label?: string }}
   */
  function validateToken(token) {
    if (!token || typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) {
      return { valid: false };
    }

    const hash = hashToken(token);
    const hashBuf = Buffer.from(hash, 'hex');
    const tokens = loadTokens();

    for (const [id, entry] of Object.entries(tokens)) {
      try {
        const storedBuf = Buffer.from(entry.hash, 'hex');
        if (hashBuf.length === storedBuf.length && timingSafeEqual(hashBuf, storedBuf)) {
          return { valid: true, id, label: entry.label };
        }
      } catch {
        // Skip malformed entries
      }
    }

    return { valid: false };
  }

  /**
   * Revoke a token by its short ID.
   * @param {string} id - Token ID (8 hex chars)
   * @returns {boolean} True if token was found and revoked
   */
  function revokeToken(id) {
    const tokens = loadTokens();
    if (!tokens[id]) return false;
    delete tokens[id];
    saveTokens(tokens);
    return true;
  }

  /**
   * List all tokens (no raw tokens or hashes).
   * @returns {Array<{ id: string, label: string, createdAt: string }>}
   */
  function listTokens() {
    const tokens = loadTokens();
    return Object.entries(tokens).map(([id, entry]) => ({
      id,
      label: entry.label,
      createdAt: entry.createdAt,
    }));
  }

  // ── Express Middleware ──────────────────────────────────

  /**
   * Express middleware that validates Bearer token or ?token= query param.
   * Skips /api/health and non-API paths (static files).
   */
  function authMiddleware(req, res, next) {
    const path = req.path;

    // Skip non-API paths (static files, page routes)
    if (!path.startsWith('/api/')) {
      return next();
    }

    // Skip health check, metrics, and docs endpoints
    if (path === '/api/health' || path.startsWith('/api/health/') || path === '/api/metrics' ||
        path === '/api/openapi.json' || path === '/api/docs') {
      return next();
    }

    // Extract token from Authorization header or query param
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.query.token) {
      token = req.query.token;
    }

    const result = validateToken(token);
    if (!result.valid) {
      return res.status(401).json({ error: 'Unauthorized: invalid or missing token' });
    }

    // Attach auth info to request for downstream use
    req.auth = { id: result.id, label: result.label };
    next();
  }

  return { generateToken, validateToken, revokeToken, listTokens, authMiddleware };
}

export { TOKEN_PREFIX, TOKEN_BYTE_LENGTH, TOKEN_ID_LENGTH };
