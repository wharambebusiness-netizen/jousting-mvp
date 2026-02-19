// Skill Pool System Tests — Phase 5B (Tracker, Discovery, Assignment)
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { SkillRegistry } from '../skills/registry.mjs';
import { createSkillTracker } from '../skills/tracker.mjs';
import { validateSkillRequest, detectSkillRequests, processSkillRequest, archiveSkillRequest, generateDiscoveryPrompt } from '../skills/discovery.mjs';
import { assignSkillsToAgent, reassignSkills, detectProfile, ROLE_PROFILE_MAP } from '../skills/assignment.mjs';
import { selectSkills } from '../skills/selector.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestsDir = join(__dirname, '..', 'skills', 'manifests');

let registry;

beforeAll(async () => {
  registry = new SkillRegistry(manifestsDir);
  await registry.load();
});

// ═══════════════════════════════════════════════════════════════
// Section 1: Skill Tracker
// ═══════════════════════════════════════════════════════════════

describe('createSkillTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = createSkillTracker();
  });

  it('starts empty', () => {
    expect(tracker.size).toBe(0);
  });

  it('records an assignment', () => {
    tracker.recordAssignment('agent-1', 1, ['git-status', 'file-read']);
    expect(tracker.size).toBe(1);
    const record = tracker.getAssignment('agent-1', 1);
    expect(record).not.toBeNull();
    expect(record.skillIds).toEqual(['git-status', 'file-read']);
    expect(record.agentId).toBe('agent-1');
    expect(record.round).toBe(1);
  });

  it('records usage', () => {
    tracker.recordAssignment('agent-1', 1, ['git-status', 'file-read']);
    tracker.recordUsage('agent-1', 1, 'git-status');
    const record = tracker.getAssignment('agent-1', 1);
    expect(record.used.has('git-status')).toBe(true);
    expect(record.used.has('file-read')).toBe(false);
  });

  it('records batch usage', () => {
    tracker.recordAssignment('agent-1', 1, ['git-status', 'file-read', 'lint']);
    tracker.recordUsageBatch('agent-1', 1, ['git-status', 'lint']);
    const record = tracker.getAssignment('agent-1', 1);
    expect(record.used.has('git-status')).toBe(true);
    expect(record.used.has('lint')).toBe(true);
    expect(record.used.has('file-read')).toBe(false);
  });

  it('getUnusedSkills returns skills assigned but not used', () => {
    tracker.recordAssignment('agent-1', 1, ['git-status', 'file-read', 'lint']);
    tracker.recordUsage('agent-1', 1, 'git-status');
    const unused = tracker.getUnusedSkills('agent-1', 1);
    expect(unused).toContain('file-read');
    expect(unused).toContain('lint');
    expect(unused).not.toContain('git-status');
  });

  it('getDiscoveredSkills returns skills used but not assigned', () => {
    tracker.recordAssignment('agent-1', 1, ['git-status']);
    tracker.recordUsage('agent-1', 1, 'git-status');
    tracker.recordUsage('agent-1', 1, 'lint'); // not assigned
    const discovered = tracker.getDiscoveredSkills('agent-1', 1);
    expect(discovered).toContain('lint');
    expect(discovered).not.toContain('git-status');
  });

  it('getAgentHistory returns all records for an agent', () => {
    tracker.recordAssignment('agent-1', 1, ['git-status']);
    tracker.recordAssignment('agent-1', 2, ['file-read']);
    tracker.recordAssignment('agent-2', 1, ['lint']);
    const history = tracker.getAgentHistory('agent-1');
    expect(history).toHaveLength(2);
    expect(history[0].round).toBe(1);
    expect(history[1].round).toBe(2);
  });

  it('getAssignment returns null for unknown', () => {
    expect(tracker.getAssignment('nope', 1)).toBeNull();
  });

  it('getUnusedSkills returns empty for unknown', () => {
    expect(tracker.getUnusedSkills('nope', 1)).toEqual([]);
  });

  it('clear resets all data', () => {
    tracker.recordAssignment('agent-1', 1, ['git-status']);
    tracker.clear();
    expect(tracker.size).toBe(0);
    expect(tracker.getAssignment('agent-1', 1)).toBeNull();
  });
});

describe('Skill tracker usage stats', () => {
  let tracker;

  beforeEach(() => {
    tracker = createSkillTracker();
    // Agent-1: round 1 (assigns 3, uses 2), round 2 (assigns 3, uses 1)
    tracker.recordAssignment('agent-1', 1, ['git-status', 'file-read', 'lint']);
    tracker.recordUsageBatch('agent-1', 1, ['git-status', 'file-read']);
    tracker.recordAssignment('agent-1', 2, ['git-status', 'file-read', 'lint']);
    tracker.recordUsage('agent-1', 2, 'git-status');
    // Agent-2: round 1 (assigns 2, uses 2)
    tracker.recordAssignment('agent-2', 1, ['git-status', 'lint']);
    tracker.recordUsageBatch('agent-2', 1, ['git-status', 'lint']);
  });

  it('computes assignment counts', () => {
    const stats = tracker.getUsageStats();
    expect(stats.assignmentCount['git-status']).toBe(3);
    expect(stats.assignmentCount['file-read']).toBe(2);
    expect(stats.assignmentCount['lint']).toBe(3);
  });

  it('computes usage counts', () => {
    const stats = tracker.getUsageStats();
    expect(stats.usageCount['git-status']).toBe(3);
    expect(stats.usageCount['file-read']).toBe(1);
    expect(stats.usageCount['lint']).toBe(1);
  });

  it('computes usage rates', () => {
    const stats = tracker.getUsageStats();
    expect(stats.usageRate['git-status']).toBe(1); // 3/3
    expect(stats.usageRate['file-read']).toBe(0.5); // 1/2
    expect(stats.usageRate['lint']).toBeCloseTo(0.333, 2); // 1/3
  });

  it('identifies high demand skills', () => {
    const stats = tracker.getUsageStats();
    expect(stats.highDemand).toContain('git-status');
  });

  it('identifies over-assigned skills', () => {
    // Add an agent that assigns but never uses a skill
    tracker.recordAssignment('agent-3', 1, ['web-search']);
    tracker.recordAssignment('agent-3', 2, ['web-search']);
    tracker.recordAssignment('agent-3', 3, ['web-search']);
    tracker.recordAssignment('agent-3', 4, ['web-search']);
    tracker.recordAssignment('agent-3', 5, ['web-search']);
    // Never used → rate = 0 < 0.2
    const stats = tracker.getUsageStats();
    expect(stats.overAssigned).toContain('web-search');
  });
});

describe('Skill tracker suggestAdjustments', () => {
  let tracker;

  beforeEach(() => {
    tracker = createSkillTracker();
  });

  it('suggests pruning unused skills', () => {
    // 3 rounds where lint is assigned but never used
    tracker.recordAssignment('agent-1', 1, ['git-status', 'lint']);
    tracker.recordUsage('agent-1', 1, 'git-status');
    tracker.recordAssignment('agent-1', 2, ['git-status', 'lint']);
    tracker.recordUsage('agent-1', 2, 'git-status');
    tracker.recordAssignment('agent-1', 3, ['git-status', 'lint']);
    tracker.recordUsage('agent-1', 3, 'git-status');

    const { prune } = tracker.suggestAdjustments('agent-1', { lookback: 3 });
    expect(prune).toContain('lint');
    expect(prune).not.toContain('git-status');
  });

  it('suggests promoting discovered skills', () => {
    // Agent discovers 'lint' (uses it but it wasn't assigned) in 2+ rounds
    tracker.recordAssignment('agent-1', 1, ['git-status']);
    tracker.recordUsageBatch('agent-1', 1, ['git-status', 'lint']);
    tracker.recordAssignment('agent-1', 2, ['git-status']);
    tracker.recordUsageBatch('agent-1', 2, ['git-status', 'lint']);
    tracker.recordAssignment('agent-1', 3, ['git-status']);
    tracker.recordUsageBatch('agent-1', 3, ['git-status', 'lint']);

    const { promote } = tracker.suggestAdjustments('agent-1', { lookback: 3 });
    expect(promote).toContain('lint');
  });

  it('returns empty for unknown agent', () => {
    const { prune, promote } = tracker.suggestAdjustments('unknown');
    expect(prune).toEqual([]);
    expect(promote).toEqual([]);
  });

  it('respects lookback window', () => {
    // Lint used in round 1, not in rounds 2-4
    tracker.recordAssignment('agent-1', 1, ['git-status', 'lint']);
    tracker.recordUsageBatch('agent-1', 1, ['git-status', 'lint']);
    tracker.recordAssignment('agent-1', 2, ['git-status', 'lint']);
    tracker.recordUsage('agent-1', 2, 'git-status');
    tracker.recordAssignment('agent-1', 3, ['git-status', 'lint']);
    tracker.recordUsage('agent-1', 3, 'git-status');
    tracker.recordAssignment('agent-1', 4, ['git-status', 'lint']);
    tracker.recordUsage('agent-1', 4, 'git-status');

    // lookback=2: only checks rounds 3-4 where lint was unused
    const { prune } = tracker.suggestAdjustments('agent-1', { lookback: 2 });
    expect(prune).toContain('lint');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 2: Skill Discovery Protocol
// ═══════════════════════════════════════════════════════════════

describe('validateSkillRequest', () => {
  it('accepts a valid request with skillIds', () => {
    const { valid } = validateSkillRequest({
      agentId: 'agent-1',
      reason: 'Need git operations',
      skillIds: ['git-status', 'git-commit'],
    });
    expect(valid).toBe(true);
  });

  it('accepts a valid request with query', () => {
    const { valid } = validateSkillRequest({
      agentId: 'agent-1',
      reason: 'Need to search code',
      query: 'search the codebase',
    });
    expect(valid).toBe(true);
  });

  it('rejects missing agentId', () => {
    const { valid, errors } = validateSkillRequest({
      reason: 'test',
      skillIds: ['git-status'],
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('agentId'))).toBe(true);
  });

  it('rejects missing reason', () => {
    const { valid, errors } = validateSkillRequest({
      agentId: 'a',
      skillIds: ['git-status'],
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('reason'))).toBe(true);
  });

  it('rejects missing both skillIds and query', () => {
    const { valid, errors } = validateSkillRequest({
      agentId: 'a',
      reason: 'test',
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('skillIds'))).toBe(true);
  });

  it('rejects non-array skillIds', () => {
    const { valid, errors } = validateSkillRequest({
      agentId: 'a',
      reason: 'test',
      skillIds: 'git-status',
    });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('array'))).toBe(true);
  });
});

describe('detectSkillRequests', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skill-discovery-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('returns empty for nonexistent directory', () => {
    expect(detectSkillRequests('/nonexistent/path')).toEqual([]);
  });

  it('returns empty for empty directory', () => {
    expect(detectSkillRequests(tempDir)).toEqual([]);
  });

  it('detects valid skill request files', () => {
    writeFileSync(join(tempDir, 'discover-agent1-abc.json'), JSON.stringify({
      agentId: 'agent-1',
      reason: 'need git',
      skillIds: ['git-status'],
    }));
    const requests = detectSkillRequests(tempDir);
    expect(requests).toHaveLength(1);
    expect(requests[0].agentId).toBe('agent-1');
    expect(requests[0]._filename).toBe('discover-agent1-abc.json');
  });

  it('ignores non-discover files', () => {
    writeFileSync(join(tempDir, 'other-file.json'), '{}');
    writeFileSync(join(tempDir, 'discover-agent1-abc.json'), JSON.stringify({
      agentId: 'agent-1',
      reason: 'need git',
      skillIds: ['git-status'],
    }));
    const requests = detectSkillRequests(tempDir);
    expect(requests).toHaveLength(1);
  });

  it('ignores malformed JSON', () => {
    writeFileSync(join(tempDir, 'discover-bad-123.json'), 'not json');
    const requests = detectSkillRequests(tempDir);
    expect(requests).toHaveLength(0);
  });

  it('ignores invalid requests', () => {
    // Missing agentId — invalid
    writeFileSync(join(tempDir, 'discover-bad-456.json'), JSON.stringify({
      reason: 'test',
      skillIds: ['git-status'],
    }));
    const requests = detectSkillRequests(tempDir);
    expect(requests).toHaveLength(0);
  });
});

describe('processSkillRequest', () => {
  it('approves valid skill IDs', () => {
    const result = processSkillRequest(
      { agentId: 'a', reason: 'test', skillIds: ['git-status', 'file-read'] },
      registry,
      ['lint'],
    );
    expect(result.approved).toContain('git-status');
    expect(result.approved).toContain('file-read');
    expect(result.denied).toHaveLength(0);
  });

  it('skips already-assigned skills', () => {
    const result = processSkillRequest(
      { agentId: 'a', reason: 'test', skillIds: ['git-status', 'file-read'] },
      registry,
      ['git-status'], // already have git-status
    );
    expect(result.approved).toContain('file-read');
    expect(result.approved).not.toContain('git-status');
  });

  it('denies unknown skill IDs', () => {
    const result = processSkillRequest(
      { agentId: 'a', reason: 'test', skillIds: ['nonexistent'] },
      registry,
      [],
    );
    expect(result.denied).toContain('nonexistent');
    expect(result.approved).toHaveLength(0);
  });

  it('respects maxNewSkills limit', () => {
    const result = processSkillRequest(
      { agentId: 'a', reason: 'test', skillIds: ['git-status', 'file-read', 'lint', 'web-search', 'test-runner'] },
      registry,
      [],
      { maxNewSkills: 2 },
    );
    expect(result.approved).toHaveLength(2);
  });

  it('handles query-based requests with selectFn', () => {
    const result = processSkillRequest(
      { agentId: 'a', reason: 'test', query: 'git commit push' },
      registry,
      [],
      { selectFn: (q) => selectSkills(q, registry, { maxResults: 3 }) },
    );
    expect(result.approved.length).toBeGreaterThan(0);
  });

  it('suggests enhancements', () => {
    const result = processSkillRequest(
      { agentId: 'a', reason: 'test', skillIds: ['git-status'] },
      registry,
      [],
    );
    // git-status is enhancedBy git-commit and git-push
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});

describe('archiveSkillRequest', () => {
  let tempDir;
  let archiveDir;

  beforeEach(() => {
    tempDir = join(tmpdir(), `skill-archive-test-${Date.now()}`);
    archiveDir = join(tempDir, 'archive');
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  });

  it('moves request file to archive directory', () => {
    const filePath = join(tempDir, 'discover-agent1-test.json');
    writeFileSync(filePath, '{}');
    archiveSkillRequest(
      { _filename: 'discover-agent1-test.json', _sourcePath: filePath },
      archiveDir,
    );
    expect(existsSync(filePath)).toBe(false);
    expect(existsSync(join(archiveDir, 'discover-agent1-test.json'))).toBe(true);
  });

  it('creates archive directory if needed', () => {
    const filePath = join(tempDir, 'discover-agent2-test.json');
    writeFileSync(filePath, '{}');
    archiveSkillRequest(
      { _filename: 'discover-agent2-test.json', _sourcePath: filePath },
      archiveDir,
    );
    expect(existsSync(archiveDir)).toBe(true);
  });
});

describe('generateDiscoveryPrompt', () => {
  it('generates prompt with current skills', () => {
    const prompt = generateDiscoveryPrompt('agent-1', ['git-status', 'file-read'], 'orchestrator/skill-requests');
    expect(prompt).toContain('agent-1');
    expect(prompt).toContain('git-status, file-read');
    expect(prompt).toContain('orchestrator/skill-requests');
    expect(prompt).toContain('SKILL DISCOVERY');
  });

  it('handles empty skills list', () => {
    const prompt = generateDiscoveryPrompt('agent-1', [], 'orchestrator/skill-requests');
    expect(prompt).toContain('(none assigned)');
  });

  it('includes JSON format instructions', () => {
    const prompt = generateDiscoveryPrompt('agent-1', [], 'dir');
    expect(prompt).toContain('agentId');
    expect(prompt).toContain('reason');
    expect(prompt).toContain('skillIds');
    expect(prompt).toContain('query');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 3: Skill Assignment
// ═══════════════════════════════════════════════════════════════

describe('ROLE_PROFILE_MAP', () => {
  it('maps all major roles', () => {
    expect(Object.keys(ROLE_PROFILE_MAP).length).toBeGreaterThanOrEqual(20);
  });

  it('maps code agents to code-writer', () => {
    for (const role of ['engine-dev', 'ui-dev', 'backend-dev', 'full-stack-dev', 'database-dev', 'css-artist']) {
      expect(ROLE_PROFILE_MAP[role]).toBe('code-writer');
    }
  });

  it('maps QA agents to tester', () => {
    for (const role of ['qa-engineer', 'test-generator', 'integration-tester']) {
      expect(ROLE_PROFILE_MAP[role]).toBe('tester');
    }
  });

  it('maps review agents to reviewer', () => {
    for (const role of ['tech-lead', 'self-reviewer', 'architect']) {
      expect(ROLE_PROFILE_MAP[role]).toBe('reviewer');
    }
  });

  it('maps security-auditor to auditor', () => {
    expect(ROLE_PROFILE_MAP['security-auditor']).toBe('auditor');
  });

  it('maps devops to deployer', () => {
    expect(ROLE_PROFILE_MAP['devops']).toBe('deployer');
  });
});

describe('detectProfile', () => {
  it('returns mapped profile for known roles', () => {
    expect(detectProfile({ role: 'engine-dev' })).toBe('code-writer');
    expect(detectProfile({ role: 'qa-engineer' })).toBe('tester');
    expect(detectProfile({ role: 'tech-lead' })).toBe('reviewer');
    expect(detectProfile({ role: 'security-auditor' })).toBe('auditor');
  });

  it('auto-detects tester from canTest', () => {
    expect(detectProfile({ role: 'custom-role', canTest: true })).toBe('tester');
  });

  it('auto-detects reviewer from canWrite=false', () => {
    expect(detectProfile({ role: 'custom-role', canWrite: false })).toBe('reviewer');
  });

  it('auto-detects code-writer from isCodeAgent', () => {
    expect(detectProfile({ role: 'custom-role', isCodeAgent: true })).toBe('code-writer');
  });

  it('defaults to code-writer for unknown roles', () => {
    expect(detectProfile({ role: 'totally-unknown' })).toBe('code-writer');
  });
});

describe('assignSkillsToAgent', () => {
  it('assigns skills based on role profile', () => {
    const result = assignSkillsToAgent({ role: 'engine-dev' }, registry);
    expect(result.profile).toBe('code-writer');
    expect(result.skills.length).toBeGreaterThan(0);
    expect(result.skills).toContain('file-read');
    expect(result.skills).toContain('test-runner');
  });

  it('includes task-specific skills when taskText provided', () => {
    const result = assignSkillsToAgent(
      { role: 'engine-dev' },
      registry,
      { taskText: 'commit the changes and push to remote' },
    );
    // Should pick up git skills from task text
    expect(result.skills.some(id => id.startsWith('git-'))).toBe(true);
  });

  it('respects maxSkills limit', () => {
    const result = assignSkillsToAgent(
      { role: 'engine-dev' },
      registry,
      { taskText: 'audit security, test coverage, check accessibility, lint code', maxSkills: 4 },
    );
    expect(result.skills.length).toBeLessThanOrEqual(4);
  });

  it('resolves dependencies', () => {
    // If git-commit is selected, git-status should be resolved as dep
    const result = assignSkillsToAgent(
      { role: 'devops' },
      registry,
    );
    // deployer profile has git-status, git-commit, git-push
    if (result.skills.includes('git-commit')) {
      expect(result.skills).toContain('git-status');
    }
  });

  it('returns profile name', () => {
    const result = assignSkillsToAgent({ role: 'qa-engineer' }, registry);
    expect(result.profile).toBe('tester');
  });

  it('assigns correct skills for reviewer profile', () => {
    const result = assignSkillsToAgent({ role: 'tech-lead' }, registry);
    expect(result.profile).toBe('reviewer');
    expect(result.skills).toContain('file-read');
    expect(result.skills).toContain('codebase-search');
  });

  it('assigns correct skills for auditor profile', () => {
    const result = assignSkillsToAgent({ role: 'security-auditor' }, registry);
    expect(result.profile).toBe('auditor');
    expect(result.skills).toContain('security-scan');
  });

  it('assigns correct skills for tester profile', () => {
    const result = assignSkillsToAgent({ role: 'qa-engineer' }, registry);
    expect(result.skills).toContain('test-runner');
    expect(result.skills).toContain('file-read');
  });

  it('assigns correct skills for deployer profile', () => {
    const result = assignSkillsToAgent({ role: 'devops' }, registry);
    expect(result.skills).toContain('git-status');
    expect(result.skills).toContain('git-commit');
    expect(result.skills).toContain('git-push');
  });

  it('assigns correct skills for researcher profile', () => {
    const result = assignSkillsToAgent({ role: 'research-agent' }, registry);
    expect(result.skills).toContain('web-search');
    expect(result.skills).toContain('codebase-search');
  });

  it('includes optional skills when requested', () => {
    const withOptional = assignSkillsToAgent(
      { role: 'engine-dev' },
      registry,
      { includeOptional: true },
    );
    const without = assignSkillsToAgent(
      { role: 'engine-dev' },
      registry,
      { includeOptional: false },
    );
    expect(withOptional.skills.length).toBeGreaterThanOrEqual(without.skills.length);
  });
});

describe('reassignSkills', () => {
  it('prunes unused skills', () => {
    const tracker = createSkillTracker();
    // 3 rounds where lint is assigned but never used
    tracker.recordAssignment('agent-1', 1, ['git-status', 'file-read', 'lint']);
    tracker.recordUsageBatch('agent-1', 1, ['git-status', 'file-read']);
    tracker.recordAssignment('agent-1', 2, ['git-status', 'file-read', 'lint']);
    tracker.recordUsageBatch('agent-1', 2, ['git-status', 'file-read']);
    tracker.recordAssignment('agent-1', 3, ['git-status', 'file-read', 'lint']);
    tracker.recordUsageBatch('agent-1', 3, ['git-status', 'file-read']);

    const result = reassignSkills(
      ['git-status', 'file-read', 'lint'],
      tracker,
      'agent-1',
      registry,
    );
    expect(result.pruned).toContain('lint');
    expect(result.skills).not.toContain('lint');
    expect(result.skills).toContain('git-status');
    expect(result.skills).toContain('file-read');
  });

  it('promotes discovered skills', () => {
    const tracker = createSkillTracker();
    // Agent discovers 'lint' in 3 rounds
    tracker.recordAssignment('agent-1', 1, ['file-read']);
    tracker.recordUsageBatch('agent-1', 1, ['file-read', 'lint']);
    tracker.recordAssignment('agent-1', 2, ['file-read']);
    tracker.recordUsageBatch('agent-1', 2, ['file-read', 'lint']);
    tracker.recordAssignment('agent-1', 3, ['file-read']);
    tracker.recordUsageBatch('agent-1', 3, ['file-read', 'lint']);

    const result = reassignSkills(
      ['file-read'],
      tracker,
      'agent-1',
      registry,
    );
    expect(result.promoted).toContain('lint');
    expect(result.skills).toContain('lint');
    expect(result.skills).toContain('file-read');
  });

  it('handles empty tracker history', () => {
    const tracker = createSkillTracker();
    const result = reassignSkills(
      ['file-read', 'lint'],
      tracker,
      'agent-1',
      registry,
    );
    // No data → no changes, but deps resolved
    expect(result.skills).toContain('file-read');
    expect(result.skills).toContain('lint');
    expect(result.pruned).toEqual([]);
    expect(result.promoted).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 4: End-to-End Flow
// ═══════════════════════════════════════════════════════════════

describe('End-to-end: role → profile → skills → tracking → reassignment', () => {
  it('full lifecycle for a code agent', () => {
    // 1. Assign skills based on role
    const assignment = assignSkillsToAgent(
      { role: 'engine-dev', id: 'engine-dev' },
      registry,
    );
    expect(assignment.profile).toBe('code-writer');
    expect(assignment.skills.length).toBeGreaterThanOrEqual(3);

    // 2. Track usage over 3 rounds
    const tracker = createSkillTracker();
    for (let round = 1; round <= 3; round++) {
      tracker.recordAssignment('engine-dev', round, assignment.skills);
      // Simulate: file-read and test-runner always used, others not
      tracker.recordUsageBatch('engine-dev', round, ['file-read', 'test-runner']);
    }

    // 3. Check usage stats
    const stats = tracker.getUsageStats();
    expect(stats.usageRate['file-read']).toBe(1);
    expect(stats.usageRate['test-runner']).toBe(1);

    // 4. Reassign based on usage
    const reassigned = reassignSkills(
      assignment.skills,
      tracker,
      'engine-dev',
      registry,
    );
    // Core skills should remain
    expect(reassigned.skills).toContain('file-read');
    expect(reassigned.skills).toContain('test-runner');
  });

  it('full lifecycle for a deployer agent', () => {
    const assignment = assignSkillsToAgent(
      { role: 'devops', id: 'devops' },
      registry,
    );
    expect(assignment.profile).toBe('deployer');
    expect(assignment.skills).toContain('git-status');
    expect(assignment.skills).toContain('git-commit');
    expect(assignment.skills).toContain('git-push');

    // Track: git-push rarely used
    const tracker = createSkillTracker();
    for (let round = 1; round <= 3; round++) {
      tracker.recordAssignment('devops', round, assignment.skills);
      tracker.recordUsageBatch('devops', round, ['git-status', 'git-commit']);
      // git-push never used
    }

    const reassigned = reassignSkills(
      assignment.skills,
      tracker,
      'devops',
      registry,
    );
    // git-push should be pruned (unused in all 3 rounds)
    expect(reassigned.pruned).toContain('git-push');
  });

  it('skill discovery mid-task', () => {
    // 1. Start with basic skills
    const initialSkills = ['file-read', 'codebase-search'];

    // 2. Agent discovers it needs git operations
    const request = {
      agentId: 'agent-1',
      reason: 'Need to commit changes I made',
      skillIds: ['git-commit', 'git-push'],
    };
    const { valid } = validateSkillRequest(request);
    expect(valid).toBe(true);

    // 3. Process the request
    const result = processSkillRequest(request, registry, initialSkills);
    expect(result.approved).toContain('git-commit');
    expect(result.approved).toContain('git-push');

    // 4. New skill set includes original + approved + resolved deps
    const newSkills = [...initialSkills, ...result.approved];
    expect(newSkills).toContain('file-read');
    expect(newSkills).toContain('git-commit');
    expect(newSkills).toContain('git-push');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 5: Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('assignSkillsToAgent with unknown role defaults to code-writer', () => {
    const result = assignSkillsToAgent({ role: 'completely-unknown-role' }, registry);
    expect(result.profile).toBe('code-writer');
    expect(result.skills.length).toBeGreaterThan(0);
  });

  it('processSkillRequest with empty current skills', () => {
    const result = processSkillRequest(
      { agentId: 'a', reason: 'test', skillIds: ['git-status'] },
      registry,
      [],
    );
    expect(result.approved).toContain('git-status');
  });

  it('processSkillRequest with all skills already assigned', () => {
    const allIds = registry.list().map(s => s.id);
    const result = processSkillRequest(
      { agentId: 'a', reason: 'test', skillIds: ['git-status'] },
      registry,
      allIds,
    );
    expect(result.approved).toHaveLength(0);
  });

  it('tracker handles rapid assignment/usage cycles', () => {
    const tracker = createSkillTracker();
    for (let i = 0; i < 100; i++) {
      tracker.recordAssignment('agent', i, ['a', 'b']);
      tracker.recordUsage('agent', i, 'a');
    }
    expect(tracker.size).toBe(100);
    const stats = tracker.getUsageStats();
    expect(stats.usageRate['a']).toBe(1);
    expect(stats.usageRate['b']).toBe(0);
  });

  it('detectProfile falls through auto-detection chain', () => {
    // No role match, no canTest, no canWrite=false, no isCodeAgent → defaults
    expect(detectProfile({ role: 'mystery', canWrite: true })).toBe('code-writer');
  });
});
