// Skill Pool System Tests (Phase 5A)
import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SkillRegistry, validateManifest } from '../skills/registry.mjs';
import { resolveSkillSet, checkCompatibility, topologicalSort } from '../skills/resolver.mjs';
import { selectSkills, selectProfileSkills, AGENT_PROFILES } from '../skills/selector.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestsDir = join(__dirname, '..', 'skills', 'manifests');

let registry;

beforeAll(async () => {
  registry = new SkillRegistry(manifestsDir);
  await registry.load();
});

// ═══════════════════════════════════════════════════════════════
// Section 1: Manifest Validation
// ═══════════════════════════════════════════════════════════════

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const manifest = {
      id: 'test-skill',
      name: 'Test Skill',
      version: '1.0.0',
      description: 'A test skill for validation purposes',
      category: 'code',
      tags: ['test', 'validation'],
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing required fields', () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(6);
  });

  it('rejects invalid id format', () => {
    const result = validateManifest({
      id: 'InvalidId', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['a'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('id'))).toBe(true);
  });

  it('rejects invalid version format', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: 'abc',
      description: 'Valid description here', category: 'code', tags: ['a'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('version'))).toBe(true);
  });

  it('rejects invalid category', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'bogus', tags: ['a'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('category'))).toBe(true);
  });

  it('rejects empty tags array', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('tags'))).toBe(true);
  });

  it('rejects duplicate tags', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['a', 'a'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('unique'))).toBe(true);
  });

  it('rejects too-short description', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Short', category: 'code', tags: ['a'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('description'))).toBe(true);
  });

  it('rejects invalid model', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['a'],
      model: 'gpt-4',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('model'))).toBe(true);
  });

  it('rejects non-boolean sideEffects', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['a'],
      sideEffects: 'yes',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sideEffects'))).toBe(true);
  });

  it('rejects negative estimatedDurationMs', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['a'],
      estimatedDurationMs: -100,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('estimatedDurationMs'))).toBe(true);
  });

  it('rejects too-long shortDescription', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['a'],
      shortDescription: 'x'.repeat(81),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('shortDescription'))).toBe(true);
  });

  it('rejects invalid tag format', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['Invalid Tag'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('tag'))).toBe(true);
  });

  it('accepts valid optional fields', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['a'],
      shortDescription: 'Short desc',
      triggerExamples: ['do something'],
      requires: ['other'],
      conflicts: [],
      enhancedBy: ['helper'],
      sideEffects: true,
      idempotent: false,
      requiresConfirmation: true,
      model: 'opus',
      estimatedDurationMs: 5000,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects too many triggerExamples', () => {
    const result = validateManifest({
      id: 'test', name: 'X', version: '1.0.0',
      description: 'Valid description here', category: 'code', tags: ['a'],
      triggerExamples: Array(16).fill('example'),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('triggerExamples'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 2: Registry Loading
// ═══════════════════════════════════════════════════════════════

describe('SkillRegistry loading', () => {
  const EXPECTED_SKILLS = [
    // Core skills (8)
    'git-status', 'git-commit', 'git-push',
    'file-read', 'test-runner', 'lint',
    'web-search', 'codebase-search',
    // Migrated audit skills (9)
    'accessibility-audit', 'security-scan', 'performance-audit',
    'dependency-audit', 'test-coverage-audit', 'code-review',
    'project-detect', 'agent-report', 'orchestrator-status',
  ];

  it('loads all 17 skill manifests', () => {
    expect(registry.size).toBe(17);
  });

  it('has no loading warnings', () => {
    expect(registry.warnings).toHaveLength(0);
  });

  for (const id of EXPECTED_SKILLS) {
    it(`loads skill: ${id}`, () => {
      const skill = registry.get(id);
      expect(skill).not.toBeNull();
      expect(skill.id).toBe(id);
      expect(skill.name).toBeTruthy();
      expect(skill.version).toBe('1.0.0');
    });
  }

  it('returns null for unknown skill', () => {
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('list() returns all skills', () => {
    expect(registry.list()).toHaveLength(17);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 3: Registry Indexing
// ═══════════════════════════════════════════════════════════════

describe('SkillRegistry indexing', () => {
  it('indexes skills by category', () => {
    const byCategory = registry.listByCategory();
    expect(byCategory.git).toBeDefined();
    expect(byCategory.git.length).toBe(3);
  });

  it('listCategories returns all categories', () => {
    const cats = registry.listCategories();
    expect(cats).toContain('git');
    expect(cats).toContain('code');
    expect(cats).toContain('research');
    expect(cats).toContain('audit');
  });

  it('listTags returns all unique tags', () => {
    const tags = registry.listTags();
    expect(tags).toContain('git');
    expect(tags).toContain('test');
    expect(tags).toContain('search');
    expect(tags.length).toBeGreaterThan(10);
  });

  it('git category contains the 3 git skills', () => {
    const gitSkills = registry.listByCategory().git;
    const ids = gitSkills.map(s => s.id);
    expect(ids).toContain('git-status');
    expect(ids).toContain('git-commit');
    expect(ids).toContain('git-push');
  });

  it('testing category contains test-runner', () => {
    const testingSkills = registry.listByCategory().testing;
    expect(testingSkills.map(s => s.id)).toContain('test-runner');
  });

  it('analysis category contains agent-report and orchestrator-status', () => {
    const analysisSkills = registry.listByCategory().analysis;
    const ids = analysisSkills.map(s => s.id);
    expect(ids).toContain('agent-report');
    expect(ids).toContain('orchestrator-status');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 4: Registry Search
// ═══════════════════════════════════════════════════════════════

describe('SkillRegistry search', () => {
  it('search by category', () => {
    const results = registry.search({ category: 'git' });
    expect(results.length).toBe(3);
    expect(results.every(s => s.category === 'git')).toBe(true);
  });

  it('search by tags (union)', () => {
    const results = registry.search({ tags: ['git'] });
    expect(results.length).toBe(3);
  });

  it('search by keyword in name', () => {
    const results = registry.search({ keyword: 'git' });
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.some(s => s.id === 'git-status')).toBe(true);
  });

  it('search by keyword in description', () => {
    const results = registry.search({ keyword: 'OWASP' });
    expect(results.some(s => s.id === 'security-scan')).toBe(true);
  });

  it('search by keyword in triggerExamples', () => {
    const results = registry.search({ keyword: 'commit' });
    expect(results.some(s => s.id === 'git-commit')).toBe(true);
  });

  it('search by sideEffects flag', () => {
    const results = registry.search({ sideEffects: true });
    expect(results.every(s => s.sideEffects === true)).toBe(true);
    expect(results.some(s => s.id === 'git-commit')).toBe(true);
    expect(results.some(s => s.id === 'git-push')).toBe(true);
  });

  it('search by idempotent flag', () => {
    const results = registry.search({ idempotent: false });
    expect(results.some(s => s.id === 'git-commit')).toBe(true);
  });

  it('combined search: category + keyword', () => {
    const results = registry.search({ category: 'git', keyword: 'push' });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('git-push');
  });

  it('combined search: tags + sideEffects', () => {
    const results = registry.search({ tags: ['git'], sideEffects: false });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('git-status');
  });

  it('returns empty for non-matching category', () => {
    const results = registry.search({ category: 'deployment' });
    expect(results).toHaveLength(0);
  });

  it('returns empty for non-matching keyword', () => {
    const results = registry.search({ keyword: 'xyznonexistent' });
    expect(results).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 5: Registry Helpers
// ═══════════════════════════════════════════════════════════════

describe('SkillRegistry helper methods', () => {
  it('getWriteSkills returns skills with sideEffects', () => {
    const write = registry.getWriteSkills();
    expect(write.every(s => s.sideEffects === true)).toBe(true);
    expect(write.some(s => s.id === 'git-commit')).toBe(true);
  });

  it('getReadOnlySkills returns skills without sideEffects', () => {
    const readOnly = registry.getReadOnlySkills();
    expect(readOnly.every(s => !s.sideEffects)).toBe(true);
    expect(readOnly.some(s => s.id === 'file-read')).toBe(true);
  });

  it('getConfirmationRequired returns confirmation-needed skills', () => {
    const confirm = registry.getConfirmationRequired();
    expect(confirm.every(s => s.requiresConfirmation === true)).toBe(true);
    expect(confirm.some(s => s.id === 'git-push')).toBe(true);
  });

  it('getDependencies returns required skills', () => {
    const deps = registry.getDependencies('git-commit');
    expect(deps.length).toBe(1);
    expect(deps[0].id).toBe('git-status');
  });

  it('getDependencies returns empty for no-dep skills', () => {
    const deps = registry.getDependencies('file-read');
    expect(deps).toHaveLength(0);
  });

  it('getConflicts returns empty when no conflicts', () => {
    const conflicts = registry.getConflicts('git-status');
    expect(conflicts).toHaveLength(0);
  });

  it('getEnhancements returns enhancing skills', () => {
    const enhancements = registry.getEnhancements('git-status');
    expect(enhancements.some(s => s.id === 'git-commit')).toBe(true);
  });

  it('getEnhancements returns empty for unknown skill', () => {
    const enhancements = registry.getEnhancements('nonexistent');
    expect(enhancements).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 6: Skill Resolver
// ═══════════════════════════════════════════════════════════════

describe('resolveSkillSet', () => {
  it('resolves a single skill with no dependencies', () => {
    const result = resolveSkillSet(['file-read'], registry);
    expect(result.resolved).toContain('file-read');
    expect(result.conflicts).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  it('resolves transitive dependencies', () => {
    // git-commit requires git-status
    const result = resolveSkillSet(['git-commit'], registry);
    expect(result.resolved).toContain('git-commit');
    expect(result.resolved).toContain('git-status');
  });

  it('dependency comes before dependent in resolved order', () => {
    const result = resolveSkillSet(['git-commit'], registry);
    const statusIdx = result.resolved.indexOf('git-status');
    const commitIdx = result.resolved.indexOf('git-commit');
    expect(statusIdx).toBeLessThan(commitIdx);
  });

  it('resolves multiple skills with shared dependencies', () => {
    // Both git-commit and git-push require git-status
    const result = resolveSkillSet(['git-commit', 'git-push'], registry);
    expect(result.resolved).toContain('git-status');
    expect(result.resolved).toContain('git-commit');
    expect(result.resolved).toContain('git-push');
    // git-status should appear only once
    expect(result.resolved.filter(id => id === 'git-status')).toHaveLength(1);
  });

  it('reports missing skills', () => {
    const result = resolveSkillSet(['nonexistent-skill'], registry);
    expect(result.missing).toContain('nonexistent-skill');
    expect(result.resolved).not.toContain('nonexistent-skill');
  });

  it('reports missing dependencies', () => {
    // Create a temporary skill with a missing dep reference
    // We test via the missing array — if a required skill doesn't exist, it's missing
    const result = resolveSkillSet(['file-read', 'bogus-dep'], registry);
    expect(result.missing).toContain('bogus-dep');
    expect(result.resolved).toContain('file-read');
  });

  it('suggests enhancements', () => {
    // git-status is enhancedBy git-commit and git-push
    const result = resolveSkillSet(['git-status'], registry);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.some(s => s.skill === 'git-commit')).toBe(true);
  });

  it('does not suggest already-resolved skills', () => {
    // git-commit + git-status: git-commit enhances git-status but is already resolved
    const result = resolveSkillSet(['git-status', 'git-commit'], registry);
    const sugIds = result.suggestions.map(s => s.skill);
    expect(sugIds).not.toContain('git-commit');
    expect(sugIds).not.toContain('git-status');
  });

  it('resolves deep dependency chains', () => {
    // security-scan requires file-read + codebase-search
    const result = resolveSkillSet(['security-scan'], registry);
    expect(result.resolved).toContain('file-read');
    expect(result.resolved).toContain('codebase-search');
    expect(result.resolved).toContain('security-scan');
  });

  it('handles empty input', () => {
    const result = resolveSkillSet([], registry);
    expect(result.resolved).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 7: Compatibility Check
// ═══════════════════════════════════════════════════════════════

describe('checkCompatibility', () => {
  it('compatible skill with no conflicts', () => {
    const result = checkCompatibility('lint', ['file-read', 'codebase-search'], registry);
    expect(result.compatible).toBe(true);
    expect(result.conflicts).toHaveLength(0);
    expect(result.missingDeps).toHaveLength(0);
  });

  it('reports missing skill as incompatible', () => {
    const result = checkCompatibility('nonexistent', ['file-read'], registry);
    expect(result.compatible).toBe(false);
  });

  it('compatible even with unresolved optional deps', () => {
    // git-commit requires git-status — but checkCompatibility only checks
    // if deps exist in registry, not in current set
    const result = checkCompatibility('git-commit', ['file-read'], registry);
    // git-status exists in registry, so no missing deps
    expect(result.missingDeps).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 8: Topological Sort
// ═══════════════════════════════════════════════════════════════

describe('topologicalSort', () => {
  it('sorts independent skills in input order', () => {
    const sorted = topologicalSort(['file-read', 'web-search', 'lint'], registry);
    expect(sorted).toHaveLength(3);
    expect(sorted).toContain('file-read');
    expect(sorted).toContain('web-search');
    expect(sorted).toContain('lint');
  });

  it('puts dependencies before dependents', () => {
    const sorted = topologicalSort(['git-commit', 'git-status'], registry);
    const statusIdx = sorted.indexOf('git-status');
    const commitIdx = sorted.indexOf('git-commit');
    expect(statusIdx).toBeLessThan(commitIdx);
  });

  it('handles complex dependency graph', () => {
    const sorted = topologicalSort(['git-push', 'git-commit', 'git-status'], registry);
    expect(sorted.indexOf('git-status')).toBeLessThan(sorted.indexOf('git-commit'));
    expect(sorted.indexOf('git-status')).toBeLessThan(sorted.indexOf('git-push'));
  });

  it('handles empty input', () => {
    expect(topologicalSort([], registry)).toHaveLength(0);
  });

  it('handles single skill', () => {
    const sorted = topologicalSort(['file-read'], registry);
    expect(sorted).toEqual(['file-read']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 9: Skill Selector
// ═══════════════════════════════════════════════════════════════

describe('selectSkills', () => {
  it('returns relevant skills for git query', () => {
    const results = selectSkills('commit my changes to git', registry);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].skill.id).toBe('git-commit');
  });

  it('returns relevant skills for test query', () => {
    const results = selectSkills('run the test suite', registry);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r => r.skill.id === 'test-runner')).toBe(true);
  });

  it('returns relevant skills for security query', () => {
    const results = selectSkills('scan for security vulnerabilities', registry);
    expect(results.some(r => r.skill.id === 'security-scan')).toBe(true);
  });

  it('returns relevant skills for search query', () => {
    const results = selectSkills('search the codebase for patterns', registry);
    expect(results.some(r => r.skill.id === 'codebase-search')).toBe(true);
  });

  it('respects maxResults option', () => {
    const results = selectSkills('code file test', registry, { maxResults: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('respects minScore option', () => {
    const results = selectSkills('git', registry, { minScore: 50 });
    expect(results.every(r => r.score >= 50)).toBe(true);
  });

  it('each result has score and matchReasons', () => {
    const results = selectSkills('git commit', registry);
    for (const r of results) {
      expect(typeof r.score).toBe('number');
      expect(Array.isArray(r.matchReasons)).toBe(true);
      expect(r.skill).toBeDefined();
    }
  });

  it('returns empty for empty query', () => {
    const results = selectSkills('', registry);
    expect(results).toHaveLength(0);
  });

  it('results are sorted by score descending', () => {
    const results = selectSkills('audit security performance', registry);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('penalizes side-effect skills in readOnly mode', () => {
    const normal = selectSkills('git commit push', registry);
    const readOnly = selectSkills('git commit push', registry, { readOnly: true });

    const normalCommitScore = normal.find(r => r.skill.id === 'git-commit')?.score || 0;
    const readOnlyCommitScore = readOnly.find(r => r.skill.id === 'git-commit')?.score || 0;
    expect(readOnlyCommitScore).toBeLessThan(normalCommitScore);
  });

  it('boosts preferred category', () => {
    const results = selectSkills('status check', registry, { preferredCategory: 'git' });
    // git-status should score higher with git as preferred category
    const gitStatus = results.find(r => r.skill.id === 'git-status');
    expect(gitStatus).toBeDefined();
    expect(gitStatus.matchReasons.some(r => r.includes('preferred category'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 10: Agent Profiles
// ═══════════════════════════════════════════════════════════════

describe('AGENT_PROFILES', () => {
  it('defines 6 profiles', () => {
    expect(Object.keys(AGENT_PROFILES)).toHaveLength(6);
  });

  it('all profile core skills exist in registry', () => {
    for (const [name, profile] of Object.entries(AGENT_PROFILES)) {
      for (const skillId of profile.core) {
        expect(registry.get(skillId)).not.toBeNull();
      }
    }
  });

  it('all profile optional skills exist in registry', () => {
    for (const [name, profile] of Object.entries(AGENT_PROFILES)) {
      for (const skillId of profile.optional) {
        expect(registry.get(skillId)).not.toBeNull();
      }
    }
  });

  it('code-writer has file-read and test-runner', () => {
    expect(AGENT_PROFILES['code-writer'].core).toContain('file-read');
    expect(AGENT_PROFILES['code-writer'].core).toContain('test-runner');
  });

  it('deployer has git skills', () => {
    const deployer = AGENT_PROFILES.deployer;
    expect(deployer.core).toContain('git-status');
    expect(deployer.core).toContain('git-commit');
    expect(deployer.core).toContain('git-push');
  });
});

describe('selectProfileSkills', () => {
  it('returns core skills for code-writer', () => {
    const { core, optional } = selectProfileSkills('code-writer', registry);
    expect(core.length).toBe(3);
    expect(core.map(s => s.id)).toContain('file-read');
    expect(optional).toHaveLength(0);
  });

  it('returns core + optional when includeOptional', () => {
    const { core, optional } = selectProfileSkills('code-writer', registry, { includeOptional: true });
    expect(core.length).toBe(3);
    expect(optional.length).toBeGreaterThan(0);
  });

  it('returns empty for unknown profile', () => {
    const { core, optional } = selectProfileSkills('nonexistent', registry);
    expect(core).toHaveLength(0);
    expect(optional).toHaveLength(0);
  });

  it('returns valid skill objects', () => {
    const { core } = selectProfileSkills('reviewer', registry);
    for (const skill of core) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.version).toBeTruthy();
    }
  });

  it('auditor profile has security-scan', () => {
    const { core } = selectProfileSkills('auditor', registry);
    expect(core.map(s => s.id)).toContain('security-scan');
  });

  it('tester profile has test-runner', () => {
    const { core } = selectProfileSkills('tester', registry);
    expect(core.map(s => s.id)).toContain('test-runner');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 11: Manifest Content Validation (all 17 skills)
// ═══════════════════════════════════════════════════════════════

describe('All manifests pass schema validation', () => {
  const allSkills = [
    'git-status', 'git-commit', 'git-push',
    'file-read', 'test-runner', 'lint',
    'web-search', 'codebase-search',
    'accessibility-audit', 'security-scan', 'performance-audit',
    'dependency-audit', 'test-coverage-audit', 'code-review',
    'project-detect', 'agent-report', 'orchestrator-status',
  ];

  for (const id of allSkills) {
    it(`${id} has valid manifest`, () => {
      const skill = registry.get(id);
      expect(skill).not.toBeNull();

      // Re-validate from the loaded data (minus internal fields)
      const { _source, _category, ...manifest } = skill;
      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it(`${id} has triggerExamples`, () => {
      const skill = registry.get(id);
      expect(skill.triggerExamples).toBeDefined();
      expect(skill.triggerExamples.length).toBeGreaterThanOrEqual(1);
    });

    it(`${id} has shortDescription`, () => {
      const skill = registry.get(id);
      expect(skill.shortDescription).toBeTruthy();
      expect(skill.shortDescription.length).toBeLessThanOrEqual(80);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// Section 12: Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('registry rejects nonexistent directory', async () => {
    const badRegistry = new SkillRegistry('/nonexistent/path');
    await expect(badRegistry.load()).rejects.toThrow('not found');
  });

  it('registry handles duplicate IDs gracefully', async () => {
    // Load from the real dir — no duplicates expected
    const reg = new SkillRegistry(manifestsDir);
    await reg.load();
    expect(reg.warnings.filter(w => w.includes('Duplicate'))).toHaveLength(0);
  });

  it('search with no criteria returns all skills', () => {
    const results = registry.search({});
    expect(results.length).toBe(17);
  });

  it('resolveSkillSet handles already-resolved duplicates', () => {
    const result = resolveSkillSet(['file-read', 'file-read', 'file-read'], registry);
    expect(result.resolved.filter(id => id === 'file-read')).toHaveLength(1);
  });

  it('topologicalSort with skills not in registry', () => {
    const sorted = topologicalSort(['nonexistent', 'file-read'], registry);
    expect(sorted).toContain('nonexistent');
    expect(sorted).toContain('file-read');
  });

  it('selectSkills handles special characters in query', () => {
    const results = selectSkills('git@#$%^&*()', registry);
    // Should still match "git" token
    expect(results.some(r => r.skill.category === 'git')).toBe(true);
  });
});
