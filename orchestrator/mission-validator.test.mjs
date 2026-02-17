import { describe, it, expect } from 'vitest';
import { validateMissionConfig } from './mission-sequencer.mjs';

// ── Valid configs ──────────────────────────────────────────

describe('validateMissionConfig — valid configs', () => {
  it('accepts minimal valid mission', () => {
    const result = validateMissionConfig({
      name: 'Test Mission',
      agents: [{ id: 'dev', name: 'Developer' }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts full mission config', () => {
    const result = validateMissionConfig({
      name: 'Full Mission',
      description: 'A test mission',
      config: { maxRounds: 10, maxConcurrency: 4, agentTimeoutMs: 600000, maxRuntimeMs: 3600000 },
      designDoc: 'design.md',
      agents: [
        {
          id: 'engine',
          name: 'Engine Dev',
          type: 'feature',
          role: 'engine-dev',
          model: 'sonnet',
          maxModel: 'opus',
          dependsOn: [],
          fileOwnership: ['src/engine/*.ts'],
          timeoutMs: 1200000,
          maxBudgetUsd: 5.0,
          maxTasksPerRound: 2,
          minFrequencyRounds: 0,
        },
        {
          id: 'qa',
          name: 'QA Engineer',
          type: 'continuous',
          role: 'qa-engineer',
          model: 'haiku',
          dependsOn: ['engine'],
          fileOwnership: 'auto',
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts agents with null model/maxModel/timeoutMs', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [{ id: 'dev', name: 'Dev', model: null, maxModel: null, timeoutMs: null, maxBudgetUsd: null }],
    });
    expect(result.valid).toBe(true);
  });
});

// ── Missing/invalid required fields ───────────────────────

describe('validateMissionConfig — required fields', () => {
  it('rejects null config', () => {
    const result = validateMissionConfig(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('non-null object');
  });

  it('rejects non-object config', () => {
    const result = validateMissionConfig('string');
    expect(result.valid).toBe(false);
  });

  it('rejects missing name', () => {
    const result = validateMissionConfig({ agents: [{ id: 'dev', name: 'Dev' }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"name"'))).toBe(true);
  });

  it('rejects empty name', () => {
    const result = validateMissionConfig({ name: '', agents: [{ id: 'dev', name: 'Dev' }] });
    expect(result.valid).toBe(false);
  });

  it('rejects missing agents', () => {
    const result = validateMissionConfig({ name: 'Test' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"agents"'))).toBe(true);
  });

  it('rejects empty agents array', () => {
    const result = validateMissionConfig({ name: 'Test', agents: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects agents as non-array', () => {
    const result = validateMissionConfig({ name: 'Test', agents: 'not-array' });
    expect(result.valid).toBe(false);
  });
});

// ── Config overrides validation ───────────────────────────

describe('validateMissionConfig — config overrides', () => {
  const base = (config) => ({ name: 'Test', agents: [{ id: 'dev', name: 'Dev' }], config });

  it('rejects config as array', () => {
    const result = validateMissionConfig(base([]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"config"'))).toBe(true);
  });

  it('rejects negative maxRounds', () => {
    const result = validateMissionConfig(base({ maxRounds: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maxRounds'))).toBe(true);
  });

  it('rejects zero maxRounds', () => {
    const result = validateMissionConfig(base({ maxRounds: 0 }));
    expect(result.valid).toBe(false);
  });

  it('rejects negative maxConcurrency', () => {
    const result = validateMissionConfig(base({ maxConcurrency: -1 }));
    expect(result.valid).toBe(false);
  });

  it('accepts zero maxConcurrency (unlimited)', () => {
    const result = validateMissionConfig(base({ maxConcurrency: 0 }));
    expect(result.valid).toBe(true);
  });

  it('rejects too-small agentTimeoutMs', () => {
    const result = validateMissionConfig(base({ agentTimeoutMs: 500 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('agentTimeoutMs'))).toBe(true);
  });

  it('rejects too-small maxRuntimeMs', () => {
    const result = validateMissionConfig(base({ maxRuntimeMs: 100 }));
    expect(result.valid).toBe(false);
  });
});

// ── Agent validation ──────────────────────────────────────

describe('validateMissionConfig — agent validation', () => {
  const mission = (agents) => ({ name: 'Test', agents });

  it('rejects agent without id', () => {
    const result = validateMissionConfig(mission([{ name: 'Dev' }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"id"'))).toBe(true);
  });

  it('rejects agent without name', () => {
    const result = validateMissionConfig(mission([{ id: 'dev' }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"name"'))).toBe(true);
  });

  it('rejects duplicate agent ids', () => {
    const result = validateMissionConfig(mission([
      { id: 'dev', name: 'Dev 1' },
      { id: 'dev', name: 'Dev 2' },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('duplicate'))).toBe(true);
  });

  it('rejects invalid agent type', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', type: 'invalid' }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"type"'))).toBe(true);
  });

  it('rejects invalid model', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', model: 'gpt-4' }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"model"'))).toBe(true);
  });

  it('rejects invalid maxModel', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', maxModel: 'turbo' }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"maxModel"'))).toBe(true);
  });

  it('rejects non-array dependsOn', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', dependsOn: 'other' }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('dependsOn'))).toBe(true);
  });

  it('rejects non-array fileOwnership (except "auto")', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', fileOwnership: 123 }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('fileOwnership'))).toBe(true);
  });

  it('accepts fileOwnership as "auto"', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', fileOwnership: 'auto' }]));
    expect(result.valid).toBe(true);
  });

  it('rejects too-small timeoutMs', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', timeoutMs: 100 }]));
    expect(result.valid).toBe(false);
  });

  it('rejects non-positive maxBudgetUsd', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', maxBudgetUsd: 0 }]));
    expect(result.valid).toBe(false);
  });

  it('rejects negative maxTasksPerRound', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', maxTasksPerRound: -1 }]));
    expect(result.valid).toBe(false);
  });

  it('rejects negative minFrequencyRounds', () => {
    const result = validateMissionConfig(mission([{ id: 'dev', name: 'Dev', minFrequencyRounds: -1 }]));
    expect(result.valid).toBe(false);
  });

  it('rejects null agent in array', () => {
    const result = validateMissionConfig(mission([null]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('non-null object'))).toBe(true);
  });
});

// ── Cross-agent validation ────────────────────────────────

describe('validateMissionConfig — cross-agent validation', () => {
  it('rejects dependsOn referencing non-existent agent', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [
        { id: 'dev', name: 'Dev', dependsOn: ['ghost'] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('non-existent'))).toBe(true);
  });

  it('rejects self-referencing dependsOn', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [
        { id: 'dev', name: 'Dev', dependsOn: ['dev'] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('self'))).toBe(true);
  });

  it('accepts valid dependsOn chain', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [
        { id: 'engine', name: 'Engine', dependsOn: [] },
        { id: 'qa', name: 'QA', dependsOn: ['engine'] },
        { id: 'ui', name: 'UI', dependsOn: ['engine', 'qa'] },
      ],
    });
    expect(result.valid).toBe(true);
  });
});

// ── Sequence mission validation ───────────────────────────

describe('validateMissionConfig — sequence missions', () => {
  it('accepts valid sequence config', () => {
    const result = validateMissionConfig({
      type: 'sequence',
      name: 'Test Sequence',
      missions: [
        { path: 'missions/a.json', maxRounds: 5 },
        { path: 'missions/b.json' },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects sequence with missing name', () => {
    const result = validateMissionConfig({
      type: 'sequence',
      missions: [{ path: 'a.json' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"name"'))).toBe(true);
  });

  it('rejects sequence with missing missions', () => {
    const result = validateMissionConfig({
      type: 'sequence',
      name: 'Test',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"missions"'))).toBe(true);
  });

  it('rejects sequence with empty missions', () => {
    const result = validateMissionConfig({
      type: 'sequence',
      name: 'Test',
      missions: [],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects sequence entry without path', () => {
    const result = validateMissionConfig({
      type: 'sequence',
      name: 'Test',
      missions: [{ maxRounds: 5 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"path"'))).toBe(true);
  });

  it('rejects sequence entry with invalid maxRounds', () => {
    const result = validateMissionConfig({
      type: 'sequence',
      name: 'Test',
      missions: [{ path: 'a.json', maxRounds: 0 }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects sequence with non-object config', () => {
    const result = validateMissionConfig({
      type: 'sequence',
      name: 'Test',
      config: 'bad',
      missions: [{ path: 'a.json' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects null entry in missions array', () => {
    const result = validateMissionConfig({
      type: 'sequence',
      name: 'Test',
      missions: [null],
    });
    expect(result.valid).toBe(false);
  });
});

// ── Multi-hop cycle detection (v29) ──────────────────────

describe('validateMissionConfig — cycle detection', () => {
  it('detects 2-hop cycle (A→B→A)', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [
        { id: 'a', name: 'A', dependsOn: ['b'] },
        { id: 'b', name: 'B', dependsOn: ['a'] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cycle') || e.includes('Cycle'))).toBe(true);
  });

  it('detects 3-hop cycle (A→B→C→A)', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [
        { id: 'a', name: 'A', dependsOn: ['c'] },
        { id: 'b', name: 'B', dependsOn: ['a'] },
        { id: 'c', name: 'C', dependsOn: ['b'] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cycle') || e.includes('Cycle'))).toBe(true);
    expect(result.errors.some(e => e.includes('a') && e.includes('b') && e.includes('c'))).toBe(true);
  });

  it('detects cycle in subset (A→B→C→B with D independent)', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [
        { id: 'a', name: 'A', dependsOn: ['b'] },
        { id: 'b', name: 'B', dependsOn: ['c'] },
        { id: 'c', name: 'C', dependsOn: ['b'] },
        { id: 'd', name: 'D', dependsOn: [] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('cycle') || e.includes('Cycle'))).toBe(true);
  });

  it('accepts valid DAG (no cycles)', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [
        { id: 'a', name: 'A', dependsOn: [] },
        { id: 'b', name: 'B', dependsOn: ['a'] },
        { id: 'c', name: 'C', dependsOn: ['a'] },
        { id: 'd', name: 'D', dependsOn: ['b', 'c'] },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts linear chain (A→B→C→D)', () => {
    const result = validateMissionConfig({
      name: 'Test',
      agents: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B', dependsOn: ['a'] },
        { id: 'c', name: 'C', dependsOn: ['b'] },
        { id: 'd', name: 'D', dependsOn: ['c'] },
      ],
    });
    expect(result.valid).toBe(true);
  });
});

// ── Balance config validation (v29) ─────────────────────

describe('validateMissionConfig — balanceConfig', () => {
  const withBalance = (bc) => ({
    name: 'Test', agents: [{ id: 'dev', name: 'Dev' }], balanceConfig: bc,
  });

  it('accepts valid balanceConfig', () => {
    const result = validateMissionConfig(withBalance({
      sims: [{ tier: 'bare', variant: 'balanced' }, { tier: 'epic', variant: 'balanced' }],
      matchesPerMatchup: 200,
      simTimeoutMs: 60000,
      runPreSim: true,
      runPostSim: true,
      regressionThresholdPp: 3,
      convergenceCriteria: {
        maxSpreadPp: { bare: 15, epic: 5 },
        maxFlags: 0,
        requiredTiers: ['epic/balanced'],
        minRounds: 3,
      },
      parameterSearch: {
        configPath: 'search-configs/quick.json',
        timeoutMs: 300000,
      },
    }));
    expect(result.valid).toBe(true);
  });

  it('accepts mission without balanceConfig', () => {
    const result = validateMissionConfig({
      name: 'Test', agents: [{ id: 'dev', name: 'Dev' }],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects non-object balanceConfig', () => {
    expect(validateMissionConfig(withBalance('bad')).valid).toBe(false);
    expect(validateMissionConfig(withBalance([])).valid).toBe(false);
    expect(validateMissionConfig(withBalance(null)).valid).toBe(false);
  });

  it('rejects non-array sims', () => {
    const result = validateMissionConfig(withBalance({ sims: 'not-array' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sims'))).toBe(true);
  });

  it('rejects sim entry without tier', () => {
    const result = validateMissionConfig(withBalance({ sims: [{ variant: 'balanced' }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('tier'))).toBe(true);
  });

  it('rejects sim entry without variant', () => {
    const result = validateMissionConfig(withBalance({ sims: [{ tier: 'bare' }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('variant'))).toBe(true);
  });

  it('rejects null sim entry', () => {
    const result = validateMissionConfig(withBalance({ sims: [null] }));
    expect(result.valid).toBe(false);
  });

  it('rejects invalid matchesPerMatchup', () => {
    expect(validateMissionConfig(withBalance({ matchesPerMatchup: 0 })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ matchesPerMatchup: -1 })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ matchesPerMatchup: 'bad' })).valid).toBe(false);
  });

  it('rejects invalid simTimeoutMs', () => {
    expect(validateMissionConfig(withBalance({ simTimeoutMs: 500 })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ simTimeoutMs: 'bad' })).valid).toBe(false);
  });

  it('rejects invalid regressionThresholdPp', () => {
    expect(validateMissionConfig(withBalance({ regressionThresholdPp: -1 })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ regressionThresholdPp: 'bad' })).valid).toBe(false);
  });

  it('rejects non-boolean runPreSim/runPostSim', () => {
    expect(validateMissionConfig(withBalance({ runPreSim: 1 })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ runPostSim: 'yes' })).valid).toBe(false);
  });

  it('rejects non-object convergenceCriteria', () => {
    expect(validateMissionConfig(withBalance({ convergenceCriteria: 'bad' })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ convergenceCriteria: [] })).valid).toBe(false);
  });

  it('rejects invalid convergenceCriteria fields', () => {
    expect(validateMissionConfig(withBalance({ convergenceCriteria: { maxSpreadPp: 'bad' } })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ convergenceCriteria: { maxFlags: -1 } })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ convergenceCriteria: { requiredTiers: 'bad' } })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ convergenceCriteria: { minRounds: 0 } })).valid).toBe(false);
  });

  it('rejects non-object parameterSearch', () => {
    expect(validateMissionConfig(withBalance({ parameterSearch: 'bad' })).valid).toBe(false);
  });

  it('rejects parameterSearch without configPath', () => {
    expect(validateMissionConfig(withBalance({ parameterSearch: {} })).valid).toBe(false);
    expect(validateMissionConfig(withBalance({ parameterSearch: { configPath: '' } })).valid).toBe(false);
  });

  it('rejects parameterSearch with invalid timeoutMs', () => {
    expect(validateMissionConfig(withBalance({ parameterSearch: { configPath: 'x.json', timeoutMs: 100 } })).valid).toBe(false);
  });
});

// ── Multiple errors ───────────────────────────────────────

describe('validateMissionConfig — multiple errors', () => {
  it('collects all errors at once', () => {
    const result = validateMissionConfig({
      agents: [
        { type: 'invalid', model: 'gpt-4' },
        { id: 'dev', name: 'Dev', dependsOn: ['ghost'] },
      ],
    });
    expect(result.valid).toBe(false);
    // Should have errors for: missing name, agent[0] missing id, agent[0] missing name,
    // agent[0] invalid type, agent[0] invalid model, dependsOn ghost
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
