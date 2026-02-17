import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initMockRunner, mockRunAgent, mockRunTests, mockRunTestsRegression,
  setMockBehavior, setMockScenario, clearMockBehaviors,
  dryRunGitOps, applyPreset, PRESET_NAMES,
} from './mock-runner.mjs';

const TEST_DIR = join(tmpdir(), 'mock-runner-test-' + Date.now());
const HANDOFF_DIR = join(TEST_DIR, 'handoffs');

beforeEach(() => {
  mkdirSync(HANDOFF_DIR, { recursive: true });
  initMockRunner({ handoffDir: HANDOFF_DIR, log: () => {} });
  clearMockBehaviors();
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
});

// ── mockRunAgent ──────────────────────────────────────────

describe('mockRunAgent', () => {
  const agent = {
    id: 'dev',
    name: 'Developer',
    type: 'feature',
    role: 'engine-dev',
    fileOwnership: ['src/engine/foo.ts', 'src/engine/bar.ts'],
  };

  it('returns success result by default', async () => {
    const result = await mockRunAgent(agent, 1);
    expect(result.agentId).toBe('dev');
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.wasResumed).toBe(false);
    expect(typeof result.elapsed).toBe('number');
    expect(result.stderr).toContain('Total cost:');
  });

  it('writes handoff file on success', async () => {
    await mockRunAgent(agent, 1);
    const handoffPath = join(HANDOFF_DIR, 'dev.md');
    expect(existsSync(handoffPath)).toBe(true);
    const content = readFileSync(handoffPath, 'utf-8');
    expect(content).toContain('## META');
    expect(content).toContain('status: all-done');
    expect(content).toContain('src/engine/foo.ts');
    expect(content).toContain('tests-passing: true');
  });

  it('uses first fileOwnership file as modified', async () => {
    await mockRunAgent(agent, 1);
    const content = readFileSync(join(HANDOFF_DIR, 'dev.md'), 'utf-8');
    expect(content).toContain('files-modified: src/engine/foo.ts');
  });

  it('writes in-progress for continuous agents', async () => {
    const contAgent = { ...agent, id: 'qa', type: 'continuous' };
    await mockRunAgent(contAgent, 1);
    const content = readFileSync(join(HANDOFF_DIR, 'qa.md'), 'utf-8');
    expect(content).toContain('status: in-progress');
  });

  it('returns failure result when configured', async () => {
    setMockBehavior('dev', { outcome: 'failure' });
    const result = await mockRunAgent(agent, 1);
    expect(result.code).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain('mock agent failure');
  });

  it('returns timeout result when configured', async () => {
    setMockBehavior('dev', { outcome: 'timeout' });
    const result = await mockRunAgent(agent, 1);
    expect(result.timedOut).toBe(true);
  });

  it('returns empty work when configured', async () => {
    setMockBehavior('dev', { outcome: 'empty' });
    const result = await mockRunAgent(agent, 1);
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
    // Empty work — handoff not updated
    expect(existsSync(join(HANDOFF_DIR, 'dev.md'))).toBe(false);
  });

  it('uses custom filesModified from behavior', async () => {
    setMockBehavior('dev', { filesModified: ['custom.ts', 'other.ts'] });
    await mockRunAgent(agent, 1);
    const content = readFileSync(join(HANDOFF_DIR, 'dev.md'), 'utf-8');
    expect(content).toContain('files-modified: custom.ts, other.ts');
  });
});

// ── setMockScenario ────────────────────────────────────────

describe('setMockScenario', () => {
  it('configures multiple agents at once', async () => {
    setMockScenario({
      'dev': { outcome: 'success' },
      'qa': { outcome: 'failure' },
    });
    const devResult = await mockRunAgent({ id: 'dev', fileOwnership: [] }, 1);
    const qaResult = await mockRunAgent({ id: 'qa', fileOwnership: [] }, 1);
    expect(devResult.code).toBe(0);
    expect(qaResult.code).toBe(1);
  });
});

// ── clearMockBehaviors ─────────────────────────────────────

describe('clearMockBehaviors', () => {
  it('resets to default success behavior', async () => {
    setMockBehavior('dev', { outcome: 'failure' });
    clearMockBehaviors();
    const result = await mockRunAgent({ id: 'dev', fileOwnership: [] }, 1);
    expect(result.code).toBe(0);
  });
});

// ── mockRunTests ───────────────────────────────────────────

describe('mockRunTests', () => {
  it('returns passing result for full suite', async () => {
    const result = await mockRunTests();
    expect(result.passed).toBe(true);
    expect(result.count).toBe('1123');
    expect(result.failCount).toBe('0');
  });

  it('returns passing result for filtered suite', async () => {
    const result = await mockRunTests('calculator|match');
    expect(result.passed).toBe(true);
  });

  it('returns skipped result for empty filter', async () => {
    const result = await mockRunTests('');
    expect(result.passed).toBe(true);
    expect(result.count).toBe('skipped');
    expect(result.skipped).toBe(true);
  });
});

// ── mockRunTestsRegression ────────────────────────────────

describe('mockRunTestsRegression', () => {
  it('returns failing result for full suite', async () => {
    const result = await mockRunTestsRegression();
    expect(result.passed).toBe(false);
    expect(result.failCount).toBe('3');
  });

  it('returns skipped for empty filter', async () => {
    const result = await mockRunTestsRegression('');
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

// ── applyPreset ──────────────────────────────────────────

describe('applyPreset', () => {
  const agents = [
    { id: 'dev', fileOwnership: ['src/dev.ts'] },
    { id: 'qa', fileOwnership: ['src/qa.ts'] },
  ];

  it('chaos preset sets behaviors for all agents', async () => {
    applyPreset('chaos', agents);
    // Both agents should now have configured behaviors (any outcome)
    const result1 = await mockRunAgent(agents[0], 1);
    const result2 = await mockRunAgent(agents[1], 1);
    expect(result1.agentId).toBe('dev');
    expect(result2.agentId).toBe('qa');
  });

  it('regression preset: first agent succeeds, rest fail', async () => {
    applyPreset('regression', agents);
    const result1 = await mockRunAgent(agents[0], 1);
    const result2 = await mockRunAgent(agents[1], 1);
    expect(result1.code).toBe(0); // first succeeds
    expect(result2.code).toBe(1); // second fails
  });
});

// ── PRESET_NAMES ─────────────────────────────────────────

describe('PRESET_NAMES', () => {
  it('contains chaos and regression', () => {
    expect(PRESET_NAMES.has('chaos')).toBe(true);
    expect(PRESET_NAMES.has('regression')).toBe(true);
  });

  it('does not contain unknown presets', () => {
    expect(PRESET_NAMES.has('unknown')).toBe(false);
  });
});

// ── dryRunGitOps ───────────────────────────────────────────

describe('dryRunGitOps', () => {
  it('tagRoundStart is a no-op', async () => {
    await expect(dryRunGitOps.tagRoundStart(1)).resolves.toBeUndefined();
  });

  it('gitBackup is a no-op', async () => {
    await expect(dryRunGitOps.gitBackup('final')).resolves.toBeUndefined();
  });

  it('createWorktree returns false', async () => {
    const result = await dryRunGitOps.createWorktree('dev', 1);
    expect(result).toBe(false);
  });

  it('mergeWorktreeBranch returns ok', async () => {
    const result = await dryRunGitOps.mergeWorktreeBranch('dev');
    expect(result.ok).toBe(true);
  });

  it('getHeadSha returns mock SHA', async () => {
    const sha = await dryRunGitOps.getHeadSha();
    expect(sha).toContain('dry-run');
  });

  it('smartRevert returns no-op result', async () => {
    const result = await dryRunGitOps.smartRevert(1, []);
    expect(result.reverted).toBe(false);
    expect(result.strategy).toBe('dry-run-noop');
  });

  it('verifyAgentOutput returns empty warnings', async () => {
    const result = await dryRunGitOps.verifyAgentOutput('dev', [], '/tmp');
    expect(result.warnings).toEqual([]);
  });
});
