// ============================================================
// Input Validation & Sanitization (Phase 29)
// ============================================================
// Lightweight validation middleware, sanitization helpers, and
// pagination parameter extraction for the operator REST API.
// ============================================================

/**
 * Express middleware factory that validates req.body against a schema.
 * Schema shape: { field: { type, required, min, max, maxLength, pattern, enum, default } }
 *
 * Supported types: 'string', 'number', 'boolean', 'array', 'object'
 *
 * On failure: 400 with { error: 'Validation failed', field, details }
 * On success: applies defaults, then calls next()
 *
 * @param {object} schema
 * @returns {Function} Express middleware
 */
export function validateBody(schema) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({
        error: 'Validation failed',
        field: null,
        details: 'Request body must be a JSON object',
      });
    }

    for (const [field, rules] of Object.entries(schema)) {
      let value = req.body[field];

      // Apply default if missing
      if (value === undefined || value === null) {
        if (rules.required) {
          return res.status(400).json({
            error: 'Validation failed',
            field,
            details: `${field} is required`,
          });
        }
        if ('default' in rules) {
          req.body[field] = rules.default;
        }
        continue;
      }

      // Type check
      if (rules.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== rules.type) {
          return res.status(400).json({
            error: 'Validation failed',
            field,
            details: `${field} must be of type ${rules.type}, got ${actualType}`,
          });
        }
      }

      // String-specific validations
      if (rules.type === 'string' && typeof value === 'string') {
        if (rules.maxLength && value.length > rules.maxLength) {
          return res.status(400).json({
            error: 'Validation failed',
            field,
            details: `${field} exceeds maximum length of ${rules.maxLength}`,
          });
        }
        if (rules.pattern && !rules.pattern.test(value)) {
          return res.status(400).json({
            error: 'Validation failed',
            field,
            details: `${field} does not match required pattern`,
          });
        }
      }

      // Enum validation
      if (rules.enum && !rules.enum.includes(value)) {
        return res.status(400).json({
          error: 'Validation failed',
          field,
          details: `${field} must be one of: ${rules.enum.join(', ')}`,
        });
      }

      // Number min/max clamping
      if (rules.type === 'number' && typeof value === 'number') {
        if (rules.min !== undefined && value < rules.min) {
          req.body[field] = rules.min;
        }
        if (rules.max !== undefined && req.body[field] > rules.max) {
          req.body[field] = rules.max;
        }
      }
    }

    next();
  };
}

/**
 * Sanitize an ID value: strip non-alphanumeric-dash-underscore chars, max 64 chars.
 * @param {*} value
 * @returns {string} Cleaned string (empty for nullish input)
 */
export function sanitizeId(value) {
  if (value == null) return '';
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

/**
 * Sanitize a string: trim, truncate, strip control chars (keep \n and \t).
 * @param {*} value
 * @param {number} maxLen - Maximum length (default 1000)
 * @returns {string} Cleaned string (empty for nullish input)
 */
export function sanitizeString(value, maxLen = 1000) {
  if (value == null) return '';
  let str = String(value).trim();
  str = str.slice(0, maxLen);
  // Strip control chars except \n (0x0a) and \t (0x09)
  // eslint-disable-next-line no-control-regex
  str = str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return str;
}

/**
 * Extract and clamp pagination params from req.query.
 * @param {object} req - Express request
 * @param {{ limit?: number, offset?: number }} defaults
 * @returns {{ limit: number, offset: number }}
 */
export function paginationParams(req, defaults = { limit: 50, offset: 0 }) {
  let limit = parseInt(req.query.limit, 10);
  let offset = parseInt(req.query.offset, 10);

  if (isNaN(limit)) limit = defaults.limit;
  if (isNaN(offset)) offset = defaults.offset;

  // Clamp
  limit = Math.max(1, Math.min(100, limit));
  offset = Math.max(0, offset);

  return { limit, offset };
}

/**
 * Wrap a paginated result set in a standard envelope.
 * @param {{ items: any[], total: number, limit: number, offset: number }} params
 * @returns {{ items: any[], total: number, limit: number, offset: number, hasMore: boolean }}
 */
export function paginatedResponse({ items, total, limit, offset }) {
  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
}
