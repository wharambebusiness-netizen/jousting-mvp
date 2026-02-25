// ============================================================
// Settings Persistence (P3 + Phase 52: Hot-Reload)
// ============================================================
// Stores operator defaults in a JSON file. Settings are loaded
// on demand. Atomic writes via temp+rename.
//
// Phase 52: Event-driven change propagation. Emits
// 'settings:changed' via EventBus when values change on save
// or external file edits detected by watch().
//
// Factory pattern: createSettings(ctx) returns
// { load, save, get, onChange, watch, stopWatch }
// with path state enclosed in closure.
// ============================================================

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

const DEFAULTS = {
  model: 'sonnet',
  maxTurns: 30,
  maxContinuations: 5,
  maxBudgetUsd: 5.0,
  autoPush: false,
  particlesEnabled: true,
  defaultTerminalTheme: 'nebula',
  coordMaxRequestsPerMinute: 60,
  coordMaxTokensPerMinute: 100000,
  coordGlobalBudgetUsd: 50,
  coordPerWorkerBudgetUsd: 10,
};

const VALID_MODELS = ['haiku', 'sonnet', 'opus'];
const VALID_THEMES = ['nebula', 'aurora', 'solar', 'mars', 'pulsar', 'quasar', 'comet', 'stellar'];

/**
 * Create a settings instance with its own path state.
 * @param {{ operatorDir: string, events?: object }} ctx
 * @returns {{ load: Function, save: Function, get: Function, onChange: Function, watch: Function, stopWatch: Function }}
 */
export function createSettings(ctx) {
  const settingsPath = join(ctx.operatorDir, 'settings.json');
  const events = ctx.events || null;

  // Change detection state
  let _previousSettings = null;
  let _watchInterval = null;
  let _lastMtime = null;

  /**
   * Parse and validate raw settings data into a validated settings object.
   */
  function validate(data) {
    return {
      model: VALID_MODELS.includes(data.model) ? data.model : DEFAULTS.model,
      maxTurns: clampInt(data.maxTurns, 1, 200, DEFAULTS.maxTurns),
      maxContinuations: clampInt(data.maxContinuations, 1, 20, DEFAULTS.maxContinuations),
      maxBudgetUsd: clampFloat(data.maxBudgetUsd, 0, 100, DEFAULTS.maxBudgetUsd),
      autoPush: !!data.autoPush,
      particlesEnabled: data.particlesEnabled !== false,
      defaultTerminalTheme: VALID_THEMES.includes(data.defaultTerminalTheme) ? data.defaultTerminalTheme : DEFAULTS.defaultTerminalTheme,
      coordMaxRequestsPerMinute: clampInt(data.coordMaxRequestsPerMinute, 1, 1000, DEFAULTS.coordMaxRequestsPerMinute),
      coordMaxTokensPerMinute: clampInt(data.coordMaxTokensPerMinute, 1000, 10000000, DEFAULTS.coordMaxTokensPerMinute),
      coordGlobalBudgetUsd: clampFloat(data.coordGlobalBudgetUsd, 0, 1000, DEFAULTS.coordGlobalBudgetUsd),
      coordPerWorkerBudgetUsd: clampFloat(data.coordPerWorkerBudgetUsd, 0, 100, DEFAULTS.coordPerWorkerBudgetUsd),
    };
  }

  /**
   * Compute diff between old and new settings.
   * Returns null if nothing changed, otherwise { field: { from, to } }.
   */
  function computeChanges(oldSettings, newSettings) {
    if (!oldSettings) return null;
    const changes = {};
    for (const key of Object.keys(DEFAULTS)) {
      if (oldSettings[key] !== newSettings[key]) {
        changes[key] = { from: oldSettings[key], to: newSettings[key] };
      }
    }
    return Object.keys(changes).length > 0 ? changes : null;
  }

  /**
   * Load settings from disk. Returns defaults if file missing or corrupt.
   */
  function load() {
    let result;
    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, 'utf-8');
        const data = JSON.parse(raw);
        result = validate(data);
      } catch (_) {
        result = { ...DEFAULTS };
      }
    } else {
      result = { ...DEFAULTS };
    }

    // Populate _previousSettings on first load
    if (_previousSettings === null) {
      _previousSettings = { ...result };
    }

    return result;
  }

  /**
   * Save settings to disk (atomic write).
   * Validates and clamps all values before saving.
   * Emits 'settings:changed' via events when values actually change.
   * @param {object} settings
   * @returns {object} The validated settings that were saved
   */
  function save(settings) {
    const validated = validate(settings);

    const dir = dirname(settingsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = settingsPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(validated, null, 2));
      renameSync(tmpFile, settingsPath);
    } catch (err) {
      // Fallback: direct write
      try {
        writeFileSync(settingsPath, JSON.stringify(validated, null, 2));
      } catch (_) { /* swallow */ }
    }

    // Emit change event if values actually changed
    if (events && _previousSettings) {
      const changes = computeChanges(_previousSettings, validated);
      if (changes) {
        events.emit('settings:changed', { changes, settings: { ...validated } });
      }
    }

    _previousSettings = { ...validated };
    return validated;
  }

  /**
   * Get a single setting value from the last loaded/saved state.
   * Falls back to loading from disk if no previous state exists.
   * @param {string} key - Setting key
   * @returns {*} Setting value, or undefined if unknown key
   */
  function get(key) {
    const current = _previousSettings || load();
    return current[key];
  }

  /**
   * Register a callback for settings changes.
   * Convenience wrapper around EventBus.on('settings:changed', cb).
   * @param {Function} callback - Called with { changes, settings }
   * @returns {Function} Unsubscribe function
   */
  function onChange(callback) {
    if (!events) return () => {};
    events.on('settings:changed', callback);
    return () => events.off('settings:changed', callback);
  }

  /**
   * Start polling the settings file for external modifications.
   * Emits 'settings:changed' if the file mtime has changed since last check.
   * @param {number} [interval=5000] - Polling interval in ms
   */
  function watch(interval = 5000) {
    if (_watchInterval) return; // Already watching

    // Initialize last mtime
    try {
      if (existsSync(settingsPath)) {
        _lastMtime = statSync(settingsPath).mtimeMs;
      }
    } catch (_) { /* ignore */ }

    _watchInterval = setInterval(() => {
      try {
        if (!existsSync(settingsPath)) return;
        const currentMtime = statSync(settingsPath).mtimeMs;
        if (_lastMtime !== null && currentMtime !== _lastMtime) {
          _lastMtime = currentMtime;
          // File was modified externally — reload and emit changes
          const newSettings = load();
          if (events && _previousSettings) {
            const changes = computeChanges(_previousSettings, newSettings);
            if (changes) {
              events.emit('settings:changed', { changes, settings: { ...newSettings } });
            }
          }
          _previousSettings = { ...newSettings };
        } else if (_lastMtime === null) {
          _lastMtime = currentMtime;
        }
      } catch (_) { /* handle missing/unreadable file gracefully */ }
    }, interval);

    if (_watchInterval.unref) _watchInterval.unref();
  }

  /**
   * Stop the file watcher polling interval.
   */
  function stopWatch() {
    if (_watchInterval) {
      clearInterval(_watchInterval);
      _watchInterval = null;
    }
  }

  return { load, save, get, onChange, watch, stopWatch };
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(value, min, max, fallback) {
  const n = parseFloat(value);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export { DEFAULTS, VALID_MODELS, VALID_THEMES };
