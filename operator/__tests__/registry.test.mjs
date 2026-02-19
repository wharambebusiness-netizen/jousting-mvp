// Registry tests (M2a)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  createRegistry,
  createChain, recordSession, updateChainStatus,
  findIncompleteChains, findChainById, getChainSummary,
  REGISTRY_VERSION, MAX_CHAINS,
  _createEmptyRegistry,
} from '../registry.mjs';

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_registry');

let reg; // registry store instance

function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  reg = createRegistry({ operatorDir: TEST_DIR });
}

function teardown() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

// Convenience aliases matching old API names
const loadRegistry = () => reg.load();
const saveRegistry = (r) => reg.save(r);

describe('Registry — Load/Save', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates empty registry when none exists', () => {
    const data = loadRegistry();
    expect(data.version).toBe(REGISTRY_VERSION);
    expect(data.chains).toEqual([]);
    expect(data.createdAt).toBeTruthy();
  });

  it('round-trips save and load', () => {
    const data = loadRegistry();
    createChain(data, { task: 'test task', config: { model: 'sonnet' } });
    saveRegistry(data);

    const loaded = loadRegistry();
    expect(loaded.chains.length).toBe(1);
    expect(loaded.chains[0].task).toBe('test task');
  });

  it('atomic write creates valid JSON', () => {
    const data = loadRegistry();
    createChain(data, { task: 'test', config: {} });
    saveRegistry(data);

    const raw = readFileSync(join(TEST_DIR, 'registry.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(REGISTRY_VERSION);
  });

  it('recovers from .tmp file when main is missing', () => {
    const data = _createEmptyRegistry();
    data.chains = [{ id: 'tmp-test', task: 'from tmp' }];
    writeFileSync(join(TEST_DIR, 'registry.json.tmp'), JSON.stringify(data));

    const loaded = loadRegistry();
    expect(loaded.chains[0].id).toBe('tmp-test');
  });

  it('sets updatedAt on save', () => {
    const data = loadRegistry();
    const before = data.updatedAt;
    saveRegistry(data);
    const loaded = loadRegistry();
    expect(loaded.updatedAt).toBeTruthy();
  });
});

describe('Registry — Chain CRUD', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates chain with UUID', () => {
    const data = loadRegistry();
    const chain = createChain(data, {
      task: 'build feature X',
      config: { model: 'sonnet', maxTurns: 20, maxContinuations: 3, maxBudgetUsd: 2.0 },
      projectDir: '/path/to/project',
    });

    expect(chain.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(chain.task).toBe('build feature X');
    expect(chain.status).toBe('running');
    expect(chain.config.model).toBe('sonnet');
    expect(chain.config.maxBudgetUsd).toBe(2.0);
    expect(chain.projectDir).toBe('/path/to/project');
    expect(chain.sessions).toEqual([]);
    expect(chain.totalCostUsd).toBe(0);
    expect(data.chains.length).toBe(1);
  });

  it('creates chain with default budget', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'test', config: {} });
    expect(chain.config.maxBudgetUsd).toBe(5.0);
  });

  it('records session and accumulates totals', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'test', config: {} });

    recordSession(chain, {
      sessionId: 'sid-1',
      turns: 5,
      costUsd: 0.12,
      durationMs: 10000,
      hitMaxTurns: false,
      preCompacted: false,
      handoffComplete: false,
      handoffFile: '/tmp/h0.md',
    });

    expect(chain.sessions.length).toBe(1);
    expect(chain.sessions[0].index).toBe(0);
    expect(chain.sessions[0].status).toBe('complete');
    expect(chain.totalCostUsd).toBeCloseTo(0.12);
    expect(chain.totalTurns).toBe(5);
    expect(chain.totalDurationMs).toBe(10000);
  });

  it('records error session and increments consecutiveErrors', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'test', config: {} });

    recordSession(chain, { error: 'timeout', turns: 2, costUsd: 0.05, durationMs: 5000 });
    expect(chain.consecutiveErrors).toBe(1);
    expect(chain.sessions[0].status).toBe('error');

    recordSession(chain, { error: 'network down', turns: 0, costUsd: 0, durationMs: 1000 });
    expect(chain.consecutiveErrors).toBe(2);

    // Successful session resets counter
    recordSession(chain, { turns: 5, costUsd: 0.10, durationMs: 8000 });
    expect(chain.consecutiveErrors).toBe(0);
  });

  it('updates chain status', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'test', config: {} });

    updateChainStatus(chain, 'complete');
    expect(chain.status).toBe('complete');
    expect(chain.updatedAt).toBeTruthy();
  });
});

describe('Registry — Query', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('finds incomplete chains', () => {
    const data = loadRegistry();
    createChain(data, { task: 'task A', config: {} });
    const chainB = createChain(data, { task: 'task B', config: {} });
    updateChainStatus(chainB, 'complete');
    createChain(data, { task: 'task C', config: {} });

    const incomplete = findIncompleteChains(data);
    expect(incomplete.length).toBe(2);
    expect(incomplete.map(c => c.task)).toContain('task A');
    expect(incomplete.map(c => c.task)).toContain('task C');
  });

  it('returns empty array when no incomplete chains', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'done', config: {} });
    updateChainStatus(chain, 'complete');
    expect(findIncompleteChains(data)).toEqual([]);
  });

  it('finds chain by ID', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'find me', config: {} });
    expect(findChainById(data, chain.id)).toBe(chain);
    expect(findChainById(data, 'nonexistent')).toBeNull();
  });

  it('generates chain summary', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'my task', config: {}, projectDir: '/proj' });
    recordSession(chain, { turns: 3, costUsd: 0.05, durationMs: 5000 });
    updateChainStatus(chain, 'complete');

    const summary = getChainSummary(chain);
    expect(summary.id).toBe(chain.id);
    expect(summary.task).toBe('my task');
    expect(summary.status).toBe('complete');
    expect(summary.sessions).toBe(1);
    expect(summary.totalCostUsd).toBeCloseTo(0.05);
    expect(summary.projectDir).toBe('/proj');
  });
});

describe('Registry — Archival', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('archives chains beyond MAX_CHAINS on save', () => {
    const data = loadRegistry();

    // Create MAX_CHAINS + 5 chains
    for (let i = 0; i < MAX_CHAINS + 5; i++) {
      const chain = createChain(data, { task: `task ${i}`, config: {} });
      // Give them sequential timestamps
      chain.updatedAt = new Date(Date.now() + i * 1000).toISOString();
    }

    expect(data.chains.length).toBe(MAX_CHAINS + 5);
    saveRegistry(data);

    const loaded = loadRegistry();
    expect(loaded.chains.length).toBe(MAX_CHAINS);

    // Archive file should exist
    const archivePath = join(TEST_DIR, 'registry-archive.json');
    expect(existsSync(archivePath)).toBe(true);
    const archive = JSON.parse(readFileSync(archivePath, 'utf-8'));
    expect(archive.chains.length).toBe(5);
  });
});

// ── Edge Cases (S82 review) ──────────────────────────────────

describe('Registry — Edge Cases', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('handles corrupt JSON in main registry gracefully', () => {
    writeFileSync(join(TEST_DIR, 'registry.json'), '{ broken json!!');
    const data = loadRegistry();
    expect(data.version).toBe(1);
    expect(data.chains).toEqual([]);
  });

  it('handles version mismatch by returning empty registry', () => {
    writeFileSync(join(TEST_DIR, 'registry.json'), JSON.stringify({ version: 999, chains: [{ id: 'old' }] }));
    const data = loadRegistry();
    expect(data.version).toBe(1);
    expect(data.chains).toEqual([]);
  });

  it('createChain preserves explicit maxBudgetUsd of 0 via ??', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'test', config: { maxBudgetUsd: 0 } });
    // 0 is falsy but ?? should preserve it (vs || which would use default)
    expect(chain.config.maxBudgetUsd).toBe(0);
  });

  it('recordSession correctly accumulates floating-point costs', () => {
    const data = loadRegistry();
    const chain = createChain(data, { task: 'float test', config: {} });

    for (let i = 0; i < 10; i++) {
      recordSession(chain, { turns: 1, costUsd: 0.1, durationMs: 100 });
    }

    // Should be close to 1.0 (floating point)
    expect(chain.totalCostUsd).toBeCloseTo(1.0, 6);
    expect(chain.sessions.length).toBe(10);
  });

  it('findIncompleteChains excludes completed/failed/aborted statuses', () => {
    const data = loadRegistry();

    const c1 = createChain(data, { task: 'complete', config: {} });
    updateChainStatus(c1, 'complete');

    const c2 = createChain(data, { task: 'failed', config: {} });
    updateChainStatus(c2, 'failed');

    const c3 = createChain(data, { task: 'aborted', config: {} });
    updateChainStatus(c3, 'aborted');

    const c4 = createChain(data, { task: 'max-cont', config: {} });
    updateChainStatus(c4, 'max-continuations');

    const incomplete = findIncompleteChains(data);
    expect(incomplete).toEqual([]);
  });

  it('exactly MAX_CHAINS chains does not trigger archival', () => {
    const data = loadRegistry();
    for (let i = 0; i < MAX_CHAINS; i++) {
      createChain(data, { task: `task ${i}`, config: {} });
    }
    saveRegistry(data);
    const loaded = loadRegistry();
    expect(loaded.chains.length).toBe(MAX_CHAINS);

    const archivePath = join(TEST_DIR, 'registry-archive.json');
    expect(existsSync(archivePath)).toBe(false);
  });
});
