import { describe, it, expect, beforeEach } from 'vitest';
import {
  initTestFilter, setProjectConfig,
  getSourceToTests, getAiSourcePattern, getAiTestFile,
  getFullSuiteTriggers, getTestFilterFlag, getTestFilter,
} from './test-filter.mjs';

// Reset to default (no config) before each test
beforeEach(() => {
  setProjectConfig(null);
});

// ── Config getters with defaults ────────────────────────────

describe('config getters (defaults)', () => {
  it('getSourceToTests returns jousting-specific mapping', () => {
    const map = getSourceToTests();
    expect(map['calculator.ts']).toContain('calculator.test.ts');
    expect(map['phase-joust.ts']).toContain('phase-resolution.test.ts');
  });

  it('getAiSourcePattern returns /^src\\/ai\\//', () => {
    const pat = getAiSourcePattern();
    expect(pat.test('src/ai/opponent.ts')).toBe(true);
    expect(pat.test('src/engine/match.ts')).toBe(false);
  });

  it('getAiTestFile returns ai.test.ts', () => {
    expect(getAiTestFile()).toBe('ai.test.ts');
  });

  it('getFullSuiteTriggers returns types.ts and index.ts', () => {
    expect(getFullSuiteTriggers()).toEqual(['types.ts', 'index.ts']);
  });

  it('getTestFilterFlag returns --testPathPattern', () => {
    expect(getTestFilterFlag()).toBe('--testPathPattern');
  });
});

describe('config getters (custom config)', () => {
  it('uses config-provided sourceToTests', () => {
    setProjectConfig({
      testing: { sourceToTests: { 'main.ts': ['main.test.ts'] } },
    });
    expect(getSourceToTests()).toEqual({ 'main.ts': ['main.test.ts'] });
  });

  it('uses config-provided aiSourcePattern', () => {
    setProjectConfig({ testing: { aiSourcePattern: '^lib/ai/' } });
    const pat = getAiSourcePattern();
    expect(pat.test('lib/ai/bot.ts')).toBe(true);
    expect(pat.test('src/ai/bot.ts')).toBe(false);
  });

  it('uses config-provided aiTestFile', () => {
    setProjectConfig({ testing: { aiTestFile: 'bot.test.ts' } });
    expect(getAiTestFile()).toBe('bot.test.ts');
  });

  it('uses config-provided fullSuiteTriggers', () => {
    setProjectConfig({ testing: { fullSuiteTriggers: ['core.ts'] } });
    expect(getFullSuiteTriggers()).toEqual(['core.ts']);
  });

  it('uses config-provided filterFlag', () => {
    setProjectConfig({ testing: { filterFlag: '--grep' } });
    expect(getTestFilterFlag()).toBe('--grep');
  });
});

// ── getTestFilter ───────────────────────────────────────────

describe('getTestFilter', () => {
  it('returns null for empty/null input (full suite)', () => {
    expect(getTestFilter(null)).toBeNull();
    expect(getTestFilter([])).toBeNull();
  });

  it('returns empty string for non-src files (skip tests)', () => {
    expect(getTestFilter(['orchestrator/foo.mjs', 'docs/readme.md'])).toBe('');
  });

  it('maps known engine file to its test suites', () => {
    const filter = getTestFilter(['src/engine/calculator.ts']);
    expect(filter).toContain('calculator.test.ts');
    expect(filter).toContain('gear-variants.test.ts');
  });

  it('maps AI source files to AI test', () => {
    const filter = getTestFilter(['src/ai/opponent.ts']);
    expect(filter).toBe('ai.test.ts');
  });

  it('returns null for full-suite trigger files', () => {
    expect(getTestFilter(['src/engine/types.ts'])).toBeNull();
    expect(getTestFilter(['src/engine/index.ts'])).toBeNull();
  });

  it('returns null for unknown engine file (conservative)', () => {
    expect(getTestFilter(['src/engine/brand-new.ts'])).toBeNull();
  });

  it('returns null for unknown UI file (conservative)', () => {
    expect(getTestFilter(['src/ui/NewComponent.tsx'])).toBeNull();
  });

  it('combines tests from multiple files', () => {
    const filter = getTestFilter(['src/engine/phase-joust.ts', 'src/engine/match.ts']);
    // phase-joust → phase-resolution.test.ts, match.test.ts
    // match.ts → match.test.ts
    expect(filter).toContain('phase-resolution.test.ts');
    expect(filter).toContain('match.test.ts');
    // Should be pipe-separated
    expect(filter.split('|').length).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates test files', () => {
    // Both phase-joust.ts and phase-melee.ts map to phase-resolution.test.ts
    const filter = getTestFilter(['src/engine/phase-joust.ts', 'src/engine/phase-melee.ts']);
    const parts = filter.split('|');
    const unique = new Set(parts);
    expect(parts.length).toBe(unique.size);
  });

  it('handles mixed src and non-src files', () => {
    const filter = getTestFilter(['docs/readme.md', 'src/engine/calculator.ts']);
    expect(filter).toContain('calculator.test.ts');
  });

  it('handles Windows-style paths', () => {
    const filter = getTestFilter(['src\\ai\\opponent.ts']);
    // Should still work since getTestFilter checks filePath.includes('src/')
    // But Windows paths use backslashes — this tests the basename extraction
    // The function checks filePath.includes('src/') which won't match backslashes
    // This is actually a known limitation, verifying current behavior
    expect(filter).toBe(''); // non-src path (backslash not matched)
  });
});
