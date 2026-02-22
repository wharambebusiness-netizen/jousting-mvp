// ============================================================
// Settings Persistence (P3)
// ============================================================
// Stores operator defaults in a JSON file. Settings are loaded
// on demand. Atomic writes via temp+rename.
//
// Factory pattern: createSettings(ctx) returns { load, save }
// with path state enclosed in closure.
// ============================================================

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
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
 * @param {{ operatorDir: string }} ctx
 * @returns {{ load: Function, save: Function }}
 */
export function createSettings(ctx) {
  const settingsPath = join(ctx.operatorDir, 'settings.json');

  /**
   * Load settings from disk. Returns defaults if file missing or corrupt.
   */
  function load() {
    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, 'utf-8');
        const data = JSON.parse(raw);
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
      } catch (_) {
        return { ...DEFAULTS };
      }
    }

    return { ...DEFAULTS };
  }

  /**
   * Save settings to disk (atomic write).
   * Validates and clamps all values before saving.
   * @param {object} settings
   * @returns {object} The validated settings that were saved
   */
  function save(settings) {
    const validated = {
      model: VALID_MODELS.includes(settings.model) ? settings.model : DEFAULTS.model,
      maxTurns: clampInt(settings.maxTurns, 1, 200, DEFAULTS.maxTurns),
      maxContinuations: clampInt(settings.maxContinuations, 1, 20, DEFAULTS.maxContinuations),
      maxBudgetUsd: clampFloat(settings.maxBudgetUsd, 0, 100, DEFAULTS.maxBudgetUsd),
      autoPush: !!settings.autoPush,
      particlesEnabled: settings.particlesEnabled !== false,
      defaultTerminalTheme: VALID_THEMES.includes(settings.defaultTerminalTheme) ? settings.defaultTerminalTheme : DEFAULTS.defaultTerminalTheme,
      coordMaxRequestsPerMinute: clampInt(settings.coordMaxRequestsPerMinute, 1, 1000, DEFAULTS.coordMaxRequestsPerMinute),
      coordMaxTokensPerMinute: clampInt(settings.coordMaxTokensPerMinute, 1000, 10000000, DEFAULTS.coordMaxTokensPerMinute),
      coordGlobalBudgetUsd: clampFloat(settings.coordGlobalBudgetUsd, 0, 1000, DEFAULTS.coordGlobalBudgetUsd),
      coordPerWorkerBudgetUsd: clampFloat(settings.coordPerWorkerBudgetUsd, 0, 100, DEFAULTS.coordPerWorkerBudgetUsd),
    };

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

    return validated;
  }

  return { load, save };
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
