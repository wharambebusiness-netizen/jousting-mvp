#!/usr/bin/env node
// ============================================================
// Role Registry — Discoverable, Composable Agent Roles
// ============================================================
// Scans orchestrator/roles/*.md and builds a registry of
// available roles with metadata extracted from frontmatter-style
// headers and content analysis.
//
// Usage:
//   import { RoleRegistry } from './role-registry.mjs';
//   const registry = new RoleRegistry(rolesDir);
//   await registry.load();
//   const role = registry.get('architect');
//   const allRoles = registry.list();
//   const team = registry.suggestTeam(projectConfig);
// ============================================================

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

// ── Role Metadata ───────────────────────────────────────────

// Default metadata for roles (overridden by file analysis)
const ROLE_DEFAULTS = {
  'architect':          { category: 'design',       defaultModel: 'sonnet', canWrite: false, canTest: false, frequency: 3 },
  'balance-analyst':    { category: 'analysis',     defaultModel: 'sonnet', canWrite: true,  canTest: false, frequency: 0 },
  'css-artist':         { category: 'frontend',     defaultModel: 'haiku',  canWrite: true,  canTest: false, frequency: 0 },
  'devops':             { category: 'infrastructure',defaultModel: 'sonnet', canWrite: true,  canTest: true,  frequency: 5 },
  'engine-dev':         { category: 'backend',      defaultModel: 'sonnet', canWrite: true,  canTest: true,  frequency: 0 },
  'game-designer':      { category: 'design',       defaultModel: 'haiku',  canWrite: false, canTest: false, frequency: 5 },
  'performance-analyst':{ category: 'analysis',     defaultModel: 'haiku',  canWrite: false, canTest: false, frequency: 3 },
  'producer':           { category: 'coordination', defaultModel: 'haiku',  canWrite: true,  canTest: false, frequency: 3 },
  'qa-engineer':        { category: 'quality',      defaultModel: 'sonnet', canWrite: true,  canTest: true,  frequency: 0 },
  'research-agent':     { category: 'analysis',     defaultModel: 'sonnet', canWrite: false, canTest: false, frequency: 0 },
  'security-auditor':   { category: 'quality',      defaultModel: 'sonnet', canWrite: false, canTest: false, frequency: 3 },
  'tech-lead':          { category: 'coordination', defaultModel: 'sonnet', canWrite: true,  canTest: false, frequency: 2 },
  'test-generator':     { category: 'quality',      defaultModel: 'sonnet', canWrite: true,  canTest: true,  frequency: 0 },
  'ui-dev':             { category: 'frontend',     defaultModel: 'sonnet', canWrite: true,  canTest: true,  frequency: 0 },
};

// Category descriptions
const CATEGORIES = {
  design:         'System design, architecture, and game design roles',
  analysis:       'Data analysis, research, and performance monitoring roles',
  frontend:       'UI development and visual design roles',
  backend:        'Engine and backend development roles',
  quality:        'Testing, security, and quality assurance roles',
  coordination:   'Project management and code review roles',
  infrastructure: 'CI/CD, deployment, and DevOps roles',
};

// ── Role Analysis ───────────────────────────────────────────

function extractRoleInfo(content, filename) {
  const name = basename(filename, '.md');
  if (name === '_common-rules') return null; // Skip shared rules

  const lines = content.split('\n');
  const info = {
    name,
    title: '',
    description: '',
    responsibilities: [],
    restrictions: [],
    outputFiles: [],
    isCodeAgent: false,
    isCoordination: false,
    capabilities: [],
  };

  // Extract title from first header
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) info.title = titleMatch[1].trim();

  // Extract first paragraph as description
  const descMatch = content.match(/^#\s+.+\n\n(.+?)(?:\n\n|\n#)/s);
  if (descMatch) info.description = descMatch[1].replace(/\*\*/g, '').trim();

  // Extract responsibilities
  const respSection = content.match(/## Responsibilities\n([\s\S]*?)(?=\n##|\n$)/);
  if (respSection) {
    const items = respSection[1].match(/^\d+\.\s+\*\*(.+?)\*\*/gm);
    if (items) {
      info.responsibilities = items.map(i => i.replace(/^\d+\.\s+\*\*/, '').replace(/\*\*$/, ''));
    }
  }

  // Extract restrictions
  const restrictSection = content.match(/## Restrictions\n([\s\S]*?)(?=\n##|\n$)/);
  if (restrictSection) {
    const items = restrictSection[1].match(/^- .+$/gm);
    if (items) {
      info.restrictions = items.map(i => i.replace(/^- /, ''));
    }
  }

  // Detect capabilities from content
  if (content.includes('Edit') || content.includes('modify') || content.includes('implement')) {
    info.capabilities.push('code-write');
    info.isCodeAgent = true;
  }
  if (content.includes('test') || content.includes('vitest') || content.includes('pytest')) {
    info.capabilities.push('testing');
  }
  if (content.includes('review') || content.includes('BLOCK') || content.includes('WARN')) {
    info.capabilities.push('code-review');
  }
  if (content.includes('analysis') || content.includes('report') || content.includes('analyze')) {
    info.capabilities.push('analysis');
    info.isCoordination = true;
  }
  if (content.includes('proposal') || content.includes('design') || content.includes('spec')) {
    info.capabilities.push('design');
    info.isCoordination = true;
  }
  if (content.includes('security') || content.includes('OWASP') || content.includes('vulnerability')) {
    info.capabilities.push('security');
  }
  if (content.includes('performance') || content.includes('benchmark') || content.includes('profil')) {
    info.capabilities.push('performance');
  }
  if (content.includes('deploy') || content.includes('CI/CD') || content.includes('pipeline')) {
    info.capabilities.push('devops');
  }
  if (content.includes('research') || content.includes('web search') || content.includes('documentation lookup')) {
    info.capabilities.push('research');
  }

  // Extract output file patterns
  const filePatterns = content.match(/orchestrator\/analysis\/[\w-]+\*?\.md/g);
  if (filePatterns) info.outputFiles = [...new Set(filePatterns)];

  return info;
}

// ── Role Registry Class ─────────────────────────────────────

export class RoleRegistry {
  constructor(rolesDir) {
    this.rolesDir = rolesDir;
    this.roles = new Map();
    this.commonRules = '';
  }

  async load() {
    if (!existsSync(this.rolesDir)) {
      throw new Error(`Roles directory not found: ${this.rolesDir}`);
    }

    const files = readdirSync(this.rolesDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const content = readFileSync(join(this.rolesDir, file), 'utf-8');

      if (file === '_common-rules.md') {
        this.commonRules = content;
        continue;
      }

      const info = extractRoleInfo(content, file);
      if (!info) continue;

      // Merge with defaults
      const defaults = ROLE_DEFAULTS[info.name] || {
        category: 'other',
        defaultModel: 'sonnet',
        canWrite: false,
        canTest: false,
        frequency: 0,
      };

      this.roles.set(info.name, {
        ...info,
        ...defaults,
        template: content,
      });
    }

    return this;
  }

  get(name) {
    return this.roles.get(name) || null;
  }

  list() {
    return Array.from(this.roles.values());
  }

  listByCategory() {
    const byCategory = {};
    for (const role of this.roles.values()) {
      if (!byCategory[role.category]) {
        byCategory[role.category] = {
          description: CATEGORIES[role.category] || 'Other roles',
          roles: [],
        };
      }
      byCategory[role.category].roles.push(role);
    }
    return byCategory;
  }

  getCodeAgents() {
    return this.list().filter(r => r.isCodeAgent);
  }

  getCoordinationAgents() {
    return this.list().filter(r => r.isCoordination);
  }

  getCapableOf(capability) {
    return this.list().filter(r => r.capabilities.includes(capability));
  }

  // Suggest a team based on project needs
  suggestTeam(projectConfig = {}) {
    const team = [];
    const hasTests = !!projectConfig.testRunner;
    const hasFrontend = (projectConfig.frameworks || []).some(f => f.type === 'frontend' || f.type === 'fullstack');
    const hasBackend = (projectConfig.frameworks || []).some(f => f.type === 'backend' || f.type === 'fullstack');

    // Always: producer + tech-lead
    team.push({ role: 'producer', priority: 'core', reason: 'Task generation and pipeline management' });
    team.push({ role: 'tech-lead', priority: 'core', reason: 'Code review and architectural oversight' });

    // Always: QA (if project has tests)
    if (hasTests) {
      team.push({ role: 'qa-engineer', priority: 'core', reason: 'Test maintenance and regression prevention' });
    }

    // Frontend
    if (hasFrontend) {
      team.push({ role: 'ui-dev', priority: 'core', reason: 'Frontend development' });
      team.push({ role: 'css-artist', priority: 'optional', reason: 'Visual polish' });
    }

    // Backend
    if (hasBackend || (!hasFrontend && !hasBackend)) {
      team.push({ role: 'engine-dev', priority: 'core', reason: 'Backend/engine development' });
    }

    // Security (recommended for any project)
    team.push({ role: 'security-auditor', priority: 'recommended', reason: 'Security vulnerability detection' });

    // Optional specialists
    team.push({ role: 'test-generator', priority: 'optional', reason: 'Systematic test coverage expansion' });
    team.push({ role: 'architect', priority: 'optional', reason: 'System design and architecture' });
    team.push({ role: 'performance-analyst', priority: 'optional', reason: 'Performance monitoring' });

    // Filter to only roles we actually have templates for
    return team.filter(t => this.roles.has(t.role));
  }

  // Build an agent config from a role name + overrides
  buildAgentConfig(roleId, overrides = {}) {
    const role = this.get(roleId);
    if (!role) throw new Error(`Unknown role: ${roleId}`);

    return {
      id: overrides.id || roleId,
      name: overrides.name || role.title,
      type: overrides.type || 'continuous',
      role: roleId,
      model: overrides.model || role.defaultModel,
      maxModel: overrides.maxModel || (role.defaultModel === 'haiku' ? 'haiku' : 'opus'),
      timeoutMs: overrides.timeoutMs || (role.isCodeAgent ? 1200000 : 600000),
      maxTasksPerRound: overrides.maxTasksPerRound || (role.isCodeAgent ? 2 : 1),
      minFrequencyRounds: overrides.minFrequencyRounds ?? role.frequency,
      maxBudgetUsd: overrides.maxBudgetUsd || (role.defaultModel === 'haiku' ? 2 : 5),
      fileOwnership: overrides.fileOwnership || [],
      claudeMdPath: overrides.claudeMdPath || (role.isCodeAgent ? undefined : 'CLAUDE-lite.md'),
      tasks: overrides.tasks || { primary: role.description },
    };
  }

  // Generate a complete mission config from a team suggestion
  generateMission(name, description, team, projectConfig = {}, overrides = {}) {
    const agents = team.map(t => {
      const agentOverrides = overrides[t.role] || {};
      return this.buildAgentConfig(t.role, agentOverrides);
    });

    return {
      name,
      description,
      config: {
        maxRounds: overrides.maxRounds || 50,
        agentTimeoutMs: overrides.agentTimeoutMs || 1200000,
        maxRuntimeMs: overrides.maxRuntimeMs || 36000000,
        maxConcurrency: overrides.maxConcurrency || Math.min(4, agents.length),
      },
      agents,
      qualityGates: projectConfig.qualityGates || [],
      projectConfig: {
        language: projectConfig.language,
        framework: projectConfig.frameworks?.[0]?.name,
        testCommand: projectConfig.testRunner?.command,
      },
    };
  }
}

// ── CLI Entry Point ─────────────────────────────────────────
// Only runs when this file is executed directly (not when imported)

const __roleRegistryFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === __roleRegistryFile) {
  const args = process.argv.slice(2);
  const rolesDir = args.find(a => !a.startsWith('-')) || join(process.cwd(), 'orchestrator', 'roles');

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Role Registry
=============
Usage: node orchestrator/role-registry.mjs [roles-dir] [options]

Options:
  --list          List all available roles
  --categories    List roles grouped by category
  --capabilities  List capabilities and which roles provide them
  --json          Output as JSON
  --suggest       Suggest a team for the current project
  --help          Show this help
`);
    process.exit(0);
  }

  const registry = new RoleRegistry(rolesDir);
  await registry.load();

  if (args.includes('--json')) {
    console.log(JSON.stringify(registry.list(), null, 2));
  } else if (args.includes('--categories')) {
    const byCategory = registry.listByCategory();
    for (const [cat, info] of Object.entries(byCategory)) {
      console.log(`\n${cat.toUpperCase()}: ${info.description}`);
      for (const role of info.roles) {
        console.log(`  ${role.name.padEnd(22)} ${role.title}`);
        console.log(`    ${role.description.substring(0, 80)}${role.description.length > 80 ? '...' : ''}`);
        console.log(`    Capabilities: ${role.capabilities.join(', ') || 'none detected'}`);
        console.log(`    Model: ${role.defaultModel} | Writes code: ${role.canWrite} | Runs tests: ${role.canTest}`);
      }
    }
  } else if (args.includes('--capabilities')) {
    const caps = new Map();
    for (const role of registry.list()) {
      for (const cap of role.capabilities) {
        if (!caps.has(cap)) caps.set(cap, []);
        caps.get(cap).push(role.name);
      }
    }
    console.log('\nCapability Matrix:');
    for (const [cap, roles] of [...caps.entries()].sort()) {
      console.log(`  ${cap.padEnd(20)} ${roles.join(', ')}`);
    }
  } else if (args.includes('--suggest')) {
    const team = registry.suggestTeam({});
    console.log('\nSuggested Team:');
    for (const t of team) {
      console.log(`  [${t.priority.padEnd(11)}] ${t.role.padEnd(22)} — ${t.reason}`);
    }
  } else {
    // Default: list all roles
    console.log(`\nRole Registry (${registry.roles.size} roles):`);
    console.log('='.repeat(60));
    for (const role of registry.list()) {
      console.log(`\n  ${role.name} — ${role.title}`);
      console.log(`    Category:       ${role.category}`);
      console.log(`    Model:          ${role.defaultModel}`);
      console.log(`    Capabilities:   ${role.capabilities.join(', ') || 'none'}`);
      console.log(`    Code agent:     ${role.isCodeAgent}`);
      console.log(`    Responsibilities: ${role.responsibilities.length}`);
      console.log(`    Restrictions:     ${role.restrictions.length}`);
    }
  }
}
