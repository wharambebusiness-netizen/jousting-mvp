// Role Registry Tests (Phase 4)
import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { RoleRegistry } from './role-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rolesDir = join(__dirname, 'roles');

let registry;

beforeAll(async () => {
  registry = new RoleRegistry(rolesDir);
  await registry.load();
});

// ── Template Loading ─────────────────────────────────────────

describe('RoleRegistry template loading', () => {
  const EXPECTED_ROLES = [
    // Original roles (15)
    'architect', 'balance-analyst', 'css-artist', 'devops', 'engine-dev',
    'game-designer', 'performance-analyst', 'producer', 'qa-engineer',
    'research-agent', 'security-auditor', 'self-reviewer', 'tech-lead',
    'test-generator', 'ui-dev',
    // Phase 4 new roles (8)
    'backend-dev', 'full-stack-dev', 'database-dev', 'docs-writer',
    'debugger', 'refactorer', 'integration-tester', 'dependency-manager',
  ];

  it('loads all 23 role templates', () => {
    const roles = registry.list();
    expect(roles.length).toBeGreaterThanOrEqual(23);
  });

  for (const roleName of EXPECTED_ROLES) {
    it(`loads role template: ${roleName}`, () => {
      const role = registry.get(roleName);
      expect(role).toBeDefined();
      expect(role.name).toBe(roleName);
      expect(role.title).toBeTruthy();
      expect(role.description).toBeTruthy();
    });
  }
});

// ── Phase 4 Role ROLE_DEFAULTS Metadata ──────────────────────

describe('Phase 4 role ROLE_DEFAULTS metadata', () => {
  it('backend-dev has correct defaults', () => {
    const role = registry.get('backend-dev');
    expect(role.category).toBe('backend');
    expect(role.defaultModel).toBe('sonnet');
    expect(role.canWrite).toBe(true);
    expect(role.canTest).toBe(false);
  });

  it('full-stack-dev has correct defaults', () => {
    const role = registry.get('full-stack-dev');
    expect(role.category).toBe('backend');
    expect(role.defaultModel).toBe('sonnet');
    expect(role.canWrite).toBe(true);
    expect(role.canTest).toBe(true);
  });

  it('database-dev has correct defaults', () => {
    const role = registry.get('database-dev');
    expect(role.category).toBe('backend');
    expect(role.defaultModel).toBe('sonnet');
    expect(role.canWrite).toBe(true);
    expect(role.canTest).toBe(false);
  });

  it('docs-writer has correct defaults', () => {
    const role = registry.get('docs-writer');
    expect(role.category).toBe('coordination');
    expect(role.defaultModel).toBe('haiku');
    expect(role.canWrite).toBe(false);
    expect(role.canTest).toBe(false);
  });

  it('debugger has correct defaults', () => {
    const role = registry.get('debugger');
    expect(role.category).toBe('backend');
    expect(role.defaultModel).toBe('opus');
    expect(role.canWrite).toBe(true);
    expect(role.canTest).toBe(true);
  });

  it('refactorer has correct defaults', () => {
    const role = registry.get('refactorer');
    expect(role.category).toBe('backend');
    expect(role.defaultModel).toBe('opus');
    expect(role.canWrite).toBe(true);
    expect(role.canTest).toBe(true);
  });

  it('integration-tester has correct defaults', () => {
    const role = registry.get('integration-tester');
    expect(role.category).toBe('quality');
    expect(role.defaultModel).toBe('sonnet');
    expect(role.canWrite).toBe(true);
    expect(role.canTest).toBe(true);
  });

  it('dependency-manager has correct defaults', () => {
    const role = registry.get('dependency-manager');
    expect(role.category).toBe('infrastructure');
    expect(role.defaultModel).toBe('haiku');
    expect(role.canWrite).toBe(false);
    expect(role.canTest).toBe(false);
  });
});

// ── Category Grouping ────────────────────────────────────────

describe('Category grouping', () => {
  it('backend category includes new backend roles', () => {
    const byCategory = registry.listByCategory();
    const backendNames = byCategory.backend.roles.map(r => r.name);
    expect(backendNames).toContain('backend-dev');
    expect(backendNames).toContain('full-stack-dev');
    expect(backendNames).toContain('database-dev');
    expect(backendNames).toContain('debugger');
    expect(backendNames).toContain('refactorer');
  });

  it('quality category includes integration-tester', () => {
    const byCategory = registry.listByCategory();
    const qualityNames = byCategory.quality.roles.map(r => r.name);
    expect(qualityNames).toContain('integration-tester');
  });

  it('coordination category includes docs-writer', () => {
    const byCategory = registry.listByCategory();
    const coordNames = byCategory.coordination.roles.map(r => r.name);
    expect(coordNames).toContain('docs-writer');
  });

  it('infrastructure category includes dependency-manager', () => {
    const byCategory = registry.listByCategory();
    const infraNames = byCategory.infrastructure.roles.map(r => r.name);
    expect(infraNames).toContain('dependency-manager');
  });
});

// ── Heuristic Classification ─────────────────────────────────
// extractRoleInfo uses content heuristics for isCodeAgent/isCoordination.
// These tests verify the heuristic output matches actual template content.

describe('Heuristic code/coordination classification', () => {
  it('code-writing roles have isCodeAgent true', () => {
    // These templates contain "implement", "modify", or "Edit" → isCodeAgent
    for (const name of ['backend-dev', 'full-stack-dev', 'database-dev', 'debugger', 'refactorer']) {
      const role = registry.get(name);
      expect(role.isCodeAgent).toBe(true);
    }
  });

  it('integration-tester has isCodeAgent true (writes test code)', () => {
    const role = registry.get('integration-tester');
    expect(role.isCodeAgent).toBe(true);
  });
});

// ── buildAgentConfig ─────────────────────────────────────────

describe('buildAgentConfig for new roles', () => {
  it('builds config for backend-dev with code agent timeouts', () => {
    const config = registry.buildAgentConfig('backend-dev');
    expect(config.role).toBe('backend-dev');
    expect(config.model).toBe('sonnet');
    expect(config.maxModel).toBe('opus');
    expect(config.timeoutMs).toBe(1200000);
    expect(config.maxTasksPerRound).toBe(2);
  });

  it('builds config for debugger with opus model', () => {
    const config = registry.buildAgentConfig('debugger');
    expect(config.role).toBe('debugger');
    expect(config.model).toBe('opus');
    expect(config.maxModel).toBe('opus');
    expect(config.maxBudgetUsd).toBe(5);
  });

  it('builds config for docs-writer with haiku model', () => {
    const config = registry.buildAgentConfig('docs-writer');
    expect(config.role).toBe('docs-writer');
    expect(config.model).toBe('haiku');
    expect(config.maxModel).toBe('haiku');
  });

  it('builds config for dependency-manager with haiku model', () => {
    const config = registry.buildAgentConfig('dependency-manager');
    expect(config.role).toBe('dependency-manager');
    expect(config.model).toBe('haiku');
    expect(config.maxModel).toBe('haiku');
  });

  it('respects overrides for new roles', () => {
    const config = registry.buildAgentConfig('refactorer', {
      id: 'custom-refactorer',
      model: 'sonnet',
      maxBudgetUsd: 10,
    });
    expect(config.id).toBe('custom-refactorer');
    expect(config.role).toBe('refactorer');
    expect(config.model).toBe('sonnet');
    expect(config.maxBudgetUsd).toBe(10);
  });
});

// ── Template Content Validation ──────────────────────────────

describe('Role template content validation', () => {
  const NEW_ROLES = [
    'backend-dev', 'full-stack-dev', 'database-dev', 'docs-writer',
    'debugger', 'refactorer', 'integration-tester', 'dependency-manager',
  ];

  for (const roleName of NEW_ROLES) {
    it(`${roleName} has restrictions defined`, () => {
      const role = registry.get(roleName);
      expect(role.restrictions).toBeDefined();
      expect(role.restrictions.length).toBeGreaterThan(0);
    });

    it(`${roleName} has capabilities detected`, () => {
      const role = registry.get(roleName);
      expect(role.capabilities).toBeDefined();
      expect(Array.isArray(role.capabilities)).toBe(true);
      expect(role.capabilities.length).toBeGreaterThan(0);
    });

    it(`${roleName} has a non-empty template`, () => {
      const role = registry.get(roleName);
      expect(role.template).toBeTruthy();
      expect(role.template.length).toBeGreaterThan(100);
    });
  }
});
