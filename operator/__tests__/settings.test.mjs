// Settings Persistence Tests (Phase 16.1)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createSettings, DEFAULTS, VALID_MODELS, VALID_THEMES } from '../settings.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_settings');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── Exports ─────────────────────────────────────────────────

describe('exports', () => {
  it('exports DEFAULTS with all expected keys', () => {
    expect(DEFAULTS).toEqual({
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
    });
  });

  it('exports VALID_MODELS', () => {
    expect(VALID_MODELS).toEqual(['haiku', 'sonnet', 'opus']);
  });

  it('exports VALID_THEMES', () => {
    expect(VALID_THEMES).toEqual(['nebula', 'aurora', 'solar', 'mars', 'pulsar', 'quasar', 'comet', 'stellar']);
  });
});

// ── Factory ─────────────────────────────────────────────────

describe('createSettings', () => {
  it('returns object with load and save functions', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    expect(typeof s.load).toBe('function');
    expect(typeof s.save).toBe('function');
  });
});

// ── Load ────────────────────────────────────────────────────

describe('load', () => {
  it('returns defaults when no settings file exists', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    const result = s.load();
    expect(result).toEqual(DEFAULTS);
  });

  it('returns defaults when file is corrupt JSON', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), 'NOT{VALID JSON!!!');
    const s = createSettings({ operatorDir: TEST_DIR });
    const result = s.load();
    expect(result).toEqual(DEFAULTS);
  });

  it('returns defaults when file is empty', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), '');
    const s = createSettings({ operatorDir: TEST_DIR });
    const result = s.load();
    expect(result).toEqual(DEFAULTS);
  });

  it('returns defaults when file contains empty object', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), '{}');
    const s = createSettings({ operatorDir: TEST_DIR });
    const result = s.load();
    // Empty object → all defaults via clamping / fallback
    expect(result.model).toBe(DEFAULTS.model);
    expect(result.maxTurns).toBe(DEFAULTS.maxTurns);
    expect(result.autoPush).toBe(false);
    expect(result.particlesEnabled).toBe(true);
  });

  it('loads valid saved settings', () => {
    const custom = {
      model: 'opus',
      maxTurns: 100,
      maxContinuations: 10,
      maxBudgetUsd: 25.5,
      autoPush: true,
      particlesEnabled: false,
      defaultTerminalTheme: 'aurora',
      coordMaxRequestsPerMinute: 120,
      coordMaxTokensPerMinute: 200000,
      coordGlobalBudgetUsd: 100,
      coordPerWorkerBudgetUsd: 20,
    };
    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify(custom));
    const s = createSettings({ operatorDir: TEST_DIR });
    const result = s.load();
    expect(result).toEqual(custom);
  });

  it('returns fresh object each call (no shared references)', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    const a = s.load();
    const b = s.load();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ── Load Validation ─────────────────────────────────────────

describe('load — validation & clamping', () => {
  it('clamps model to default when invalid', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ model: 'gpt4' }));
    const s = createSettings({ operatorDir: TEST_DIR });
    expect(s.load().model).toBe('sonnet');
  });

  it('accepts all valid models', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    for (const model of VALID_MODELS) {
      writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ model }));
      expect(s.load().model).toBe(model);
    }
  });

  it('clamps defaultTerminalTheme to default when invalid', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ defaultTerminalTheme: 'invalid' }));
    const s = createSettings({ operatorDir: TEST_DIR });
    expect(s.load().defaultTerminalTheme).toBe('nebula');
  });

  it('accepts all valid themes', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    for (const theme of VALID_THEMES) {
      writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ defaultTerminalTheme: theme }));
      expect(s.load().defaultTerminalTheme).toBe(theme);
    }
  });

  it('clamps maxTurns to range [1, 200]', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxTurns: 0 }));
    expect(s.load().maxTurns).toBe(1);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxTurns: -5 }));
    expect(s.load().maxTurns).toBe(1);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxTurns: 300 }));
    expect(s.load().maxTurns).toBe(200);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxTurns: 50 }));
    expect(s.load().maxTurns).toBe(50);
  });

  it('clamps maxContinuations to range [1, 20]', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxContinuations: 0 }));
    expect(s.load().maxContinuations).toBe(1);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxContinuations: 50 }));
    expect(s.load().maxContinuations).toBe(20);
  });

  it('clamps maxBudgetUsd to range [0, 100]', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxBudgetUsd: -1 }));
    expect(s.load().maxBudgetUsd).toBe(0);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxBudgetUsd: 200 }));
    expect(s.load().maxBudgetUsd).toBe(100);
  });

  it('uses fallback for non-numeric values', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({
      maxTurns: 'abc',
      maxContinuations: null,
      maxBudgetUsd: undefined,
    }));
    const s = createSettings({ operatorDir: TEST_DIR });
    const result = s.load();
    expect(result.maxTurns).toBe(DEFAULTS.maxTurns);
    expect(result.maxContinuations).toBe(DEFAULTS.maxContinuations);
    expect(result.maxBudgetUsd).toBe(DEFAULTS.maxBudgetUsd);
  });

  it('coerces autoPush to boolean', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ autoPush: 1 }));
    expect(s.load().autoPush).toBe(true);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ autoPush: 0 }));
    expect(s.load().autoPush).toBe(false);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ autoPush: 'yes' }));
    expect(s.load().autoPush).toBe(true);
  });

  it('treats particlesEnabled as true unless explicitly false', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ particlesEnabled: false }));
    expect(s.load().particlesEnabled).toBe(false);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ particlesEnabled: true }));
    expect(s.load().particlesEnabled).toBe(true);

    // Truthy non-false values → true
    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ particlesEnabled: 0 }));
    expect(s.load().particlesEnabled).toBe(true); // 0 !== false
  });

  it('clamps coordMaxRequestsPerMinute to [1, 1000]', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ coordMaxRequestsPerMinute: 0 }));
    expect(s.load().coordMaxRequestsPerMinute).toBe(1);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ coordMaxRequestsPerMinute: 5000 }));
    expect(s.load().coordMaxRequestsPerMinute).toBe(1000);
  });

  it('clamps coordMaxTokensPerMinute to [1000, 10000000]', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ coordMaxTokensPerMinute: 500 }));
    expect(s.load().coordMaxTokensPerMinute).toBe(1000);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ coordMaxTokensPerMinute: 99999999 }));
    expect(s.load().coordMaxTokensPerMinute).toBe(10000000);
  });

  it('clamps coordGlobalBudgetUsd to [0, 1000]', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ coordGlobalBudgetUsd: -10 }));
    expect(s.load().coordGlobalBudgetUsd).toBe(0);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ coordGlobalBudgetUsd: 9999 }));
    expect(s.load().coordGlobalBudgetUsd).toBe(1000);
  });

  it('clamps coordPerWorkerBudgetUsd to [0, 100]', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ coordPerWorkerBudgetUsd: -1 }));
    expect(s.load().coordPerWorkerBudgetUsd).toBe(0);

    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ coordPerWorkerBudgetUsd: 500 }));
    expect(s.load().coordPerWorkerBudgetUsd).toBe(100);
  });
});

// ── Save ────────────────────────────────────────────────────

describe('save', () => {
  it('saves and loads roundtrip correctly', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    const custom = {
      model: 'haiku',
      maxTurns: 50,
      maxContinuations: 8,
      maxBudgetUsd: 15.0,
      autoPush: true,
      particlesEnabled: false,
      defaultTerminalTheme: 'solar',
      coordMaxRequestsPerMinute: 90,
      coordMaxTokensPerMinute: 50000,
      coordGlobalBudgetUsd: 25,
      coordPerWorkerBudgetUsd: 5,
    };
    const saved = s.save(custom);
    expect(saved).toEqual(custom);

    const loaded = s.load();
    expect(loaded).toEqual(custom);
  });

  it('returns validated settings (not raw input)', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    const bad = {
      model: 'gpt4',
      maxTurns: 999,
      maxContinuations: -5,
      maxBudgetUsd: 'abc',
      autoPush: 'truthy',
      defaultTerminalTheme: 'nonexistent',
      coordMaxRequestsPerMinute: 0,
    };
    const result = s.save(bad);
    expect(result.model).toBe('sonnet'); // fallback
    expect(result.maxTurns).toBe(200); // clamped
    expect(result.maxContinuations).toBe(1); // clamped
    expect(result.maxBudgetUsd).toBe(DEFAULTS.maxBudgetUsd); // fallback for NaN
    expect(result.autoPush).toBe(true); // coerced
    expect(result.defaultTerminalTheme).toBe('nebula'); // fallback
    expect(result.coordMaxRequestsPerMinute).toBe(1); // clamped
  });

  it('creates directory if it does not exist', () => {
    const nestedDir = join(TEST_DIR, 'nested', 'deep');
    const s = createSettings({ operatorDir: nestedDir });
    s.save(DEFAULTS);
    expect(existsSync(join(nestedDir, 'settings.json'))).toBe(true);
  });

  it('writes valid JSON to disk', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    s.save(DEFAULTS);
    const raw = readFileSync(join(TEST_DIR, 'settings.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(DEFAULTS);
  });

  it('overwrites existing settings', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    s.save({ ...DEFAULTS, model: 'opus' });
    expect(s.load().model).toBe('opus');

    s.save({ ...DEFAULTS, model: 'haiku' });
    expect(s.load().model).toBe('haiku');
  });

  it('persists all coordination fields', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    const coordSettings = {
      ...DEFAULTS,
      coordMaxRequestsPerMinute: 200,
      coordMaxTokensPerMinute: 500000,
      coordGlobalBudgetUsd: 75,
      coordPerWorkerBudgetUsd: 15,
    };
    s.save(coordSettings);
    const loaded = s.load();
    expect(loaded.coordMaxRequestsPerMinute).toBe(200);
    expect(loaded.coordMaxTokensPerMinute).toBe(500000);
    expect(loaded.coordGlobalBudgetUsd).toBe(75);
    expect(loaded.coordPerWorkerBudgetUsd).toBe(15);
  });
});

// ── Edge Cases ──────────────────────────────────────────────

describe('edge cases', () => {
  it('handles numeric strings for integer fields', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxTurns: '50' }));
    const s = createSettings({ operatorDir: TEST_DIR });
    expect(s.load().maxTurns).toBe(50);
  });

  it('handles numeric strings for float fields', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({ maxBudgetUsd: '25.5' }));
    const s = createSettings({ operatorDir: TEST_DIR });
    expect(s.load().maxBudgetUsd).toBe(25.5);
  });

  it('handles extra unknown fields in JSON (ignores them)', () => {
    writeFileSync(join(TEST_DIR, 'settings.json'), JSON.stringify({
      model: 'opus',
      unknownField: 'hello',
      anotherOne: 42,
    }));
    const s = createSettings({ operatorDir: TEST_DIR });
    const result = s.load();
    expect(result.model).toBe('opus');
    expect(result).not.toHaveProperty('unknownField');
    expect(result).not.toHaveProperty('anotherOne');
  });

  it('strips extra fields on save', () => {
    const s = createSettings({ operatorDir: TEST_DIR });
    s.save({ ...DEFAULTS, extraField: 'should not persist' });
    const raw = readFileSync(join(TEST_DIR, 'settings.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).not.toHaveProperty('extraField');
  });

  it('handles boolean-like values for particlesEnabled', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    // Save with particlesEnabled=false, load it back
    s.save({ ...DEFAULTS, particlesEnabled: false });
    expect(s.load().particlesEnabled).toBe(false);

    // Save with particlesEnabled=true, load it back
    s.save({ ...DEFAULTS, particlesEnabled: true });
    expect(s.load().particlesEnabled).toBe(true);
  });

  it('handles boundary values for integer clamping', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    // Exact min
    const saved1 = s.save({ ...DEFAULTS, maxTurns: 1 });
    expect(saved1.maxTurns).toBe(1);

    // Exact max
    const saved2 = s.save({ ...DEFAULTS, maxTurns: 200 });
    expect(saved2.maxTurns).toBe(200);
  });

  it('handles boundary values for float clamping', () => {
    const s = createSettings({ operatorDir: TEST_DIR });

    // Exact min
    const saved1 = s.save({ ...DEFAULTS, maxBudgetUsd: 0 });
    expect(saved1.maxBudgetUsd).toBe(0);

    // Exact max
    const saved2 = s.save({ ...DEFAULTS, maxBudgetUsd: 100 });
    expect(saved2.maxBudgetUsd).toBe(100);
  });
});
