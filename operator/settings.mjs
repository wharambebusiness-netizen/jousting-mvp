// ============================================================
// Settings Persistence (P3)
// ============================================================
// Stores operator defaults in a JSON file. Settings are loaded
// on demand and cached in memory. Atomic writes via temp+rename.
// ============================================================

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const DEFAULTS = {
  model: 'sonnet',
  maxTurns: 30,
  maxContinuations: 5,
  maxBudgetUsd: 5.0,
  autoPush: false,
};

const VALID_MODELS = ['haiku', 'sonnet', 'opus'];

let settingsPath = '';

/**
 * Initialize settings with the operator directory path.
 * @param {{ operatorDir: string }} ctx
 */
export function initSettings(ctx) {
  settingsPath = join(ctx.operatorDir, 'settings.json');
}

/**
 * Load settings from disk. Returns defaults if file missing or corrupt.
 */
export function loadSettings() {
  if (!settingsPath) return { ...DEFAULTS };

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
export function saveSettings(settings) {
  const validated = {
    model: VALID_MODELS.includes(settings.model) ? settings.model : DEFAULTS.model,
    maxTurns: clampInt(settings.maxTurns, 1, 200, DEFAULTS.maxTurns),
    maxContinuations: clampInt(settings.maxContinuations, 1, 20, DEFAULTS.maxContinuations),
    maxBudgetUsd: clampFloat(settings.maxBudgetUsd, 0, 100, DEFAULTS.maxBudgetUsd),
    autoPush: !!settings.autoPush,
  };

  if (!settingsPath) return validated;

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

export { DEFAULTS, VALID_MODELS };
