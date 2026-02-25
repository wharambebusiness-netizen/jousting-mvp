// ============================================================
// Data Export — CSV, JSON, JSONL Utilities (Phase 36)
// ============================================================
// Pure stateless utility functions for exporting data in
// multiple formats. RFC 4180 compliant CSV, pretty JSON,
// and JSONL (one JSON object per line).
//
// Named exports — no factory needed.
// ============================================================

// ── CSV Export ──────────────────────────────────────────────

/**
 * Convert an array of objects to CSV string (RFC 4180).
 *
 * @param {object[]} rows - Array of objects to convert
 * @param {Array<{key: string, label: string}>} [columns] - Optional column definitions.
 *   If omitted, auto-detects from first row keys.
 * @returns {string} CSV string with header row
 */
export function toCSV(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0) {
    // If columns provided, return headers only
    if (columns && columns.length > 0) {
      return columns.map(c => escapeCSVField(c.label)).join(',');
    }
    return '';
  }

  // Determine columns
  const cols = columns && columns.length > 0
    ? columns
    : Object.keys(rows[0]).map(k => ({ key: k, label: k }));

  // Header row
  const header = cols.map(c => escapeCSVField(c.label)).join(',');

  // Data rows
  const dataRows = rows.map(row => {
    return cols.map(c => {
      const val = row[c.key];
      return escapeCSVField(formatCSVValue(val));
    }).join(',');
  });

  return [header, ...dataRows].join('\n');
}

/**
 * Format a value for CSV: convert non-string types to string.
 */
function formatCSVValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Escape a CSV field per RFC 4180.
 * Wraps in double quotes if the value contains comma, double quote, or newline.
 * Escapes internal double quotes by doubling them.
 */
function escapeCSVField(val) {
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ── JSON Export ─────────────────────────────────────────────

/**
 * Convert an array of objects to pretty-printed JSON.
 * @param {object[]} rows
 * @returns {string} Formatted JSON string
 */
export function toJSON(rows) {
  return JSON.stringify(rows, null, 2);
}

// ── JSONL Export ─────────────────────────────────────────────

/**
 * Convert an array of objects to JSONL (JSON Lines) format.
 * One JSON.stringify(row) per line.
 * @param {object[]} rows
 * @returns {string} JSONL string
 */
export function toJSONLines(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows.map(row => JSON.stringify(row)).join('\n');
}

// ── Object Flattening ───────────────────────────────────────

/**
 * Flatten a nested object using a separator.
 * Arrays are JSON-stringified. Null/undefined become empty string.
 *
 * @param {object} obj - Object to flatten
 * @param {string} [prefix=''] - Key prefix for recursion
 * @param {string} [sep='_'] - Separator between levels
 * @returns {object} Flat object
 */
export function flattenObject(obj, prefix = '', sep = '_') {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? prefix + sep + key : key;

    if (value === null || value === undefined) {
      result[newKey] = '';
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      Object.assign(result, flattenObject(value, newKey, sep));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

// ── Response Headers ────────────────────────────────────────

/**
 * Set download headers on an Express response.
 *
 * @param {object} res - Express response object
 * @param {string} filename - Download filename (without extension)
 * @param {string} format - 'csv', 'json', or 'jsonl'
 */
export function setExportHeaders(res, filename, format) {
  const ext = format === 'csv' ? 'csv' : format === 'jsonl' ? 'jsonl' : 'json';
  const contentType = format === 'csv' ? 'text/csv' : 'application/json';

  res.set('Content-Disposition', `attachment; filename="${filename}.${ext}"`);
  res.set('Content-Type', contentType);
}

// ── Timestamp Helper ────────────────────────────────────────

/**
 * Generate a filename-safe timestamp: YYYYMMDD-HHmmss
 * @returns {string}
 */
export function fileTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}
