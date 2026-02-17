// Registry tests (M2a)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  initRegistry, loadRegistry, saveRegistry,
  createChain, recordSession, updateChainStatus,
  findIncompleteChains, findChainById, getChainSummary,
  REGISTRY_VERSION, MAX_CHAINS,
  _createEmptyRegistry,
} from '../registry.mjs';

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_registry');

function setup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  initRegistry({ operatorDir: TEST_DIR });
}

function teardown() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

describe('Registry — Load/Save', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates empty registry when none exists', () => {
    const reg = loadRegistry();
    expect(reg.version).toBe(REGISTRY_VERSION);
    expect(reg.chains).toEqual([]);
    expect(reg.createdAt).toBeTruthy();
  });

  it('round-trips save and load', () => {
    const reg = loadRegistry();
    createChain(reg, { task: 'test task', config: { model: 'sonnet' } });
    saveRegistry(reg);

    const loaded = loadRegistry();
    expect(loaded.chains.length).toBe(1);
    expect(loaded.chains[0].task).toBe('test task');
  });

  it('atomic write creates valid JSON', () => {
    const reg = loadRegistry();
    createChain(reg, { task: 'test', config: {} });
    saveRegistry(reg);

    const raw = readFileSync(join(TEST_DIR, 'registry.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(REGISTRY_VERSION);
  });

  it('recovers from .tmp file when main is missing', () => {
    const reg = _createEmptyRegistry();
    reg.chains = [{ id: 'tmp-test', task: 'from tmp' }];
    writeFileSync(join(TEST_DIR, 'registry.json.tmp'), JSON.stringify(reg));

    const loaded = loadRegistry();
    expect(loaded.chains[0].id).toBe('tmp-test');
  });

  it('sets updatedAt on save', () => {
    const reg = loadRegistry();
    const before = reg.updatedAt;
    saveRegistry(reg);
    const loaded = loadRegistry();
    expect(loaded.updatedAt).toBeTruthy();
  });
});

describe('Registry — Chain CRUD', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('creates chain with UUID', () => {
    const reg = loadRegistry();
    const chain = createChain(reg, {
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
    expect(reg.chains.length).toBe(1);
  });

  it('creates chain with default budget', () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'test', config: {} });
    expect(chain.config.maxBudgetUsd).toBe(5.0);
  });

  it('records session and accumulates totals', () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'test', config: {} });

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
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'test', config: {} });

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
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'test', config: {} });

    updateChainStatus(chain, 'complete');
    expect(chain.status).toBe('complete');
    expect(chain.updatedAt).toBeTruthy();
  });
});

describe('Registry — Query', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('finds incomplete chains', () => {
    const reg = loadRegistry();
    createChain(reg, { task: 'task A', config: {} });
    const chainB = createChain(reg, { task: 'task B', config: {} });
    updateChainStatus(chainB, 'complete');
    createChain(reg, { task: 'task C', config: {} });

    const incomplete = findIncompleteChains(reg);
    expect(incomplete.length).toBe(2);
    expect(incomplete.map(c => c.task)).toContain('task A');
    expect(incomplete.map(c => c.task)).toContain('task C');
  });

  it('returns empty array when no incomplete chains', () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'done', config: {} });
    updateChainStatus(chain, 'complete');
    expect(findIncompleteChains(reg)).toEqual([]);
  });

  it('finds chain by ID', () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'find me', config: {} });
    expect(findChainById(reg, chain.id)).toBe(chain);
    expect(findChainById(reg, 'nonexistent')).toBeNull();
  });

  it('generates chain summary', () => {
    const reg = loadRegistry();
    const chain = createChain(reg, { task: 'my task', config: {}, projectDir: '/proj' });
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
    const reg = loadRegistry();

    // Create MAX_CHAINS + 5 chains
    for (let i = 0; i < MAX_CHAINS + 5; i++) {
      const chain = createChain(reg, { task: `task ${i}`, config: {} });
      // Give them sequential timestamps
      chain.updatedAt = new Date(Date.now() + i * 1000).toISOString();
    }

    expect(reg.chains.length).toBe(MAX_CHAINS + 5);
    saveRegistry(reg);

    const loaded = loadRegistry();
    expect(loaded.chains.length).toBe(MAX_CHAINS);

    // Archive file should exist
    const archivePath = join(TEST_DIR, 'registry-archive.json');
    expect(existsSync(archivePath)).toBe(true);
    const archive = JSON.parse(readFileSync(archivePath, 'utf-8'));
    expect(archive.chains.length).toBe(5);
  });
});
