// ============================================================
// User Preferences Persistence (Phase 39)
// ============================================================
// Per-user preferences that extend the settings system.
// Stores preferences keyed by user ID (from auth token).
// Falls back to 'default' user when no auth is present.
//
// Factory pattern: createPreferences(ctx) returns { get, set, reset, getAll }
// ============================================================

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULTS = {
  layout: 'grid',
  terminalTheme: 'nebula',
  autoRefreshInterval: 5000,
  sidebarCollapsed: false,
  notificationsEnabled: true,
  pageSize: 50,
  taskboardView: 'kanban',
};

const VALID_LAYOUTS = ['grid', 'tabs'];
const VALID_TERMINAL_THEMES = ['nebula', 'aurora', 'solar', 'mars', 'pulsar', 'quasar', 'comet', 'stellar'];
const VALID_TASKBOARD_VIEWS = ['kanban', 'list', 'dag'];

/**
 * Create a preferences instance.
 * @param {{ persistPath: string, log?: Function, defaults?: object }} ctx
 * @returns {{ get, set, reset, getAll }}
 */
export function createPreferences(ctx) {
  const persistPath = ctx.persistPath;
  const log = ctx.log || (() => {});
  const defaults = ctx.defaults ? { ...DEFAULTS, ...ctx.defaults } : { ...DEFAULTS };

  // In-memory store: { [userId]: { ...prefs } }
  let store = {};

  // ── Persistence ─────────────────────────────────────────

  function _load() {
    if (!existsSync(persistPath)) return;
    try {
      const raw = readFileSync(persistPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        store = data;
      }
    } catch (err) {
      log('preferences: failed to load', err?.message);
    }
  }

  function _save() {
    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = persistPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(store, null, 2));
      renameSync(tmpFile, persistPath);
    } catch {
      // Fallback: direct write
      try {
        writeFileSync(persistPath, JSON.stringify(store, null, 2));
      } catch { /* swallow */ }
    }
  }

  // Load on creation
  _load();

  // ── Validation ──────────────────────────────────────────

  function _validate(prefs) {
    const result = {};

    if (prefs.layout !== undefined) {
      if (VALID_LAYOUTS.includes(prefs.layout)) {
        result.layout = prefs.layout;
      }
    }

    if (prefs.terminalTheme !== undefined) {
      if (VALID_TERMINAL_THEMES.includes(prefs.terminalTheme)) {
        result.terminalTheme = prefs.terminalTheme;
      }
    }

    if (prefs.autoRefreshInterval !== undefined) {
      const n = parseInt(prefs.autoRefreshInterval, 10);
      if (!isNaN(n) && n >= 1000) {
        result.autoRefreshInterval = n;
      }
    }

    if (prefs.sidebarCollapsed !== undefined) {
      result.sidebarCollapsed = !!prefs.sidebarCollapsed;
    }

    if (prefs.notificationsEnabled !== undefined) {
      result.notificationsEnabled = !!prefs.notificationsEnabled;
    }

    if (prefs.pageSize !== undefined) {
      const n = parseInt(prefs.pageSize, 10);
      if (!isNaN(n) && n >= 10 && n <= 100) {
        result.pageSize = n;
      }
    }

    if (prefs.taskboardView !== undefined) {
      if (VALID_TASKBOARD_VIEWS.includes(prefs.taskboardView)) {
        result.taskboardView = prefs.taskboardView;
      }
    }

    return result;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Get preferences for a user, merged with defaults.
   * @param {string} userId
   * @returns {object}
   */
  function get(userId) {
    const stored = store[userId] || {};
    return { ...defaults, ...stored };
  }

  /**
   * Set (partial update) preferences for a user.
   * Validates and merges into stored prefs.
   * @param {string} userId
   * @param {object} prefs
   * @returns {object} Updated merged preferences
   */
  function set(userId, prefs) {
    const validated = _validate(prefs || {});
    const current = store[userId] || {};
    store[userId] = { ...current, ...validated };
    _save();
    return get(userId);
  }

  /**
   * Reset preferences for a user (removes stored prefs).
   * @param {string} userId
   * @returns {object} Defaults
   */
  function reset(userId) {
    delete store[userId];
    _save();
    return { ...defaults };
  }

  /**
   * Get all stored user preferences (admin view).
   * @returns {object} { [userId]: { ...prefs } }
   */
  function getAll() {
    return { ...store };
  }

  return { get, set, reset, getAll };
}

export { DEFAULTS, VALID_LAYOUTS, VALID_TERMINAL_THEMES, VALID_TASKBOARD_VIEWS };
