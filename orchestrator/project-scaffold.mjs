#!/usr/bin/env node
// ============================================================
// Project Scaffold Module (v22 — Phase 4: Ecosystem)
// ============================================================
// Template-based project scaffolding with auto-configured
// orchestrator setup. Creates new projects from templates
// with standard directory structure, config files, and
// orchestrator mission/role configurations.
//
// CLI usage:
//   node orchestrator/project-scaffold.mjs --template react-vite-ts --name my-app
//   node orchestrator/project-scaffold.mjs --list
//   node orchestrator/project-scaffold.mjs --template node-api-ts --name api --dir /projects
//
// Programmatic usage:
//   import { scaffold, TEMPLATES, getTemplate } from './project-scaffold.mjs';
//   await scaffold({ template: 'react-vite-ts', name: 'my-app', dir: '.' });
// ============================================================

import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

// ── Template Definitions ────────────────────────────────────

/**
 * Each template defines:
 *   id           — unique template key
 *   name         — human-readable label
 *   description  — one-line summary
 *   language     — primary language
 *   framework    — primary framework
 *   testRunner   — default test runner
 *   dirs         — directories to create (relative to project root)
 *   files        — map of relative path → content (string or function(ctx))
 *   packageJson  — partial package.json overrides (merged with base)
 *   orchestrator — { agents[], mission, roles[] } orchestrator config seeds
 */
const TEMPLATES = {
  'react-vite-ts': {
    id: 'react-vite-ts',
    name: 'React + Vite + TypeScript',
    description: 'Single-page React app with Vite bundler and TypeScript',
    language: 'typescript',
    framework: 'react',
    testRunner: 'vitest',
    dirs: ['src', 'src/components', 'src/hooks', 'src/utils', 'src/types', 'public', 'tests'],
    files: {
      'src/main.tsx': `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n`,
      'src/App.tsx': `import React from 'react';\n\nexport default function App() {\n  return <div className="app"><h1>Hello World</h1></div>;\n}\n`,
      'index.html': `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>{{name}}</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n`,
      'tsconfig.json': `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "jsx": "react-jsx",\n    "strict": true,\n    "esModuleInterop": true,\n    "skipLibCheck": true,\n    "outDir": "dist"\n  },\n  "include": ["src"]\n}\n`,
      'vite.config.ts': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n`,
    },
    packageJson: {
      scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview', test: 'vitest run' },
      dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
      devDependencies: { '@vitejs/plugin-react': '^4.0.0', typescript: '^5.0.0', vite: '^5.0.0', vitest: '^1.0.0', '@types/react': '^18.2.0', '@types/react-dom': '^18.2.0' },
    },
    orchestrator: {
      agents: ['engine-dev', 'ui-dev', 'qa-engineer', 'tech-lead', 'producer'],
      roles: ['engine-dev', 'ui-dev', 'qa-engineer', 'tech-lead', 'producer'],
    },
  },

  'node-api-ts': {
    id: 'node-api-ts',
    name: 'Node.js API + TypeScript',
    description: 'REST API server with Express and TypeScript',
    language: 'typescript',
    framework: 'express',
    testRunner: 'vitest',
    dirs: ['src', 'src/routes', 'src/middleware', 'src/models', 'src/utils', 'tests'],
    files: {
      'src/index.ts': `import express from 'express';\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(express.json());\n\napp.get('/health', (_, res) => res.json({ status: 'ok' }));\n\napp.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));\n\nexport default app;\n`,
      'tsconfig.json': `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "strict": true,\n    "esModuleInterop": true,\n    "skipLibCheck": true,\n    "outDir": "dist",\n    "rootDir": "src"\n  },\n  "include": ["src"]\n}\n`,
    },
    packageJson: {
      scripts: { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js', test: 'vitest run' },
      dependencies: { express: '^4.18.0' },
      devDependencies: { '@types/express': '^4.17.0', tsx: '^4.0.0', typescript: '^5.0.0', vitest: '^1.0.0' },
    },
    orchestrator: {
      agents: ['engine-dev', 'qa-engineer', 'security-auditor', 'tech-lead', 'producer'],
      roles: ['engine-dev', 'qa-engineer', 'security-auditor', 'tech-lead', 'producer'],
    },
  },

  'next-ts': {
    id: 'next-ts',
    name: 'Next.js + TypeScript',
    description: 'Full-stack Next.js app with App Router and TypeScript',
    language: 'typescript',
    framework: 'nextjs',
    testRunner: 'vitest',
    dirs: ['src', 'src/app', 'src/components', 'src/lib', 'tests'],
    files: {
      'src/app/layout.tsx': `export const metadata = { title: '{{name}}' };\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n`,
      'src/app/page.tsx': `export default function Home() {\n  return <main><h1>{{name}}</h1></main>;\n}\n`,
      'next.config.js': `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nmodule.exports = nextConfig;\n`,
      'tsconfig.json': `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "lib": ["dom", "dom.iterable", "esnext"],\n    "jsx": "preserve",\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "strict": true,\n    "esModuleInterop": true,\n    "incremental": true,\n    "paths": { "@/*": ["./src/*"] },\n    "plugins": [{ "name": "next" }]\n  },\n  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"],\n  "exclude": ["node_modules"]\n}\n`,
    },
    packageJson: {
      scripts: { dev: 'next dev', build: 'next build', start: 'next start', test: 'vitest run' },
      dependencies: { next: '^14.0.0', react: '^18.2.0', 'react-dom': '^18.2.0' },
      devDependencies: { '@types/react': '^18.2.0', '@types/react-dom': '^18.2.0', typescript: '^5.0.0', vitest: '^1.0.0' },
    },
    orchestrator: {
      agents: ['engine-dev', 'ui-dev', 'qa-engineer', 'architect', 'tech-lead', 'producer'],
      roles: ['engine-dev', 'ui-dev', 'qa-engineer', 'architect', 'tech-lead', 'producer'],
    },
  },

  'python-fastapi': {
    id: 'python-fastapi',
    name: 'Python FastAPI',
    description: 'REST API with FastAPI, async support, and Pydantic models',
    language: 'python',
    framework: 'fastapi',
    testRunner: 'pytest',
    dirs: ['src', 'src/routes', 'src/models', 'src/utils', 'tests'],
    files: {
      'src/main.py': `from fastapi import FastAPI\n\napp = FastAPI(title="{{name}}")\n\n@app.get("/health")\nasync def health():\n    return {"status": "ok"}\n`,
      'src/__init__.py': '',
      'tests/__init__.py': '',
      'tests/test_health.py': `from fastapi.testclient import TestClient\nfrom src.main import app\n\nclient = TestClient(app)\n\ndef test_health():\n    response = client.get("/health")\n    assert response.status_code == 200\n    assert response.json() == {"status": "ok"}\n`,
      'requirements.txt': 'fastapi>=0.100.0\nuvicorn[standard]>=0.23.0\npydantic>=2.0.0\npytest>=7.0.0\nhttpx>=0.24.0\n',
      'pyproject.toml': `[project]\nname = "{{name}}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`,
    },
    packageJson: null, // Python projects don't use package.json
    orchestrator: {
      agents: ['engine-dev', 'qa-engineer', 'security-auditor', 'tech-lead', 'producer'],
      roles: ['engine-dev', 'qa-engineer', 'security-auditor', 'tech-lead', 'producer'],
    },
  },

  'python-flask': {
    id: 'python-flask',
    name: 'Python Flask',
    description: 'Lightweight web app with Flask and Jinja2 templates',
    language: 'python',
    framework: 'flask',
    testRunner: 'pytest',
    dirs: ['src', 'src/routes', 'src/templates', 'src/static', 'tests'],
    files: {
      'src/app.py': `from flask import Flask\n\ndef create_app():\n    app = Flask(__name__)\n\n    @app.route("/health")\n    def health():\n        return {"status": "ok"}\n\n    return app\n\nif __name__ == "__main__":\n    create_app().run(debug=True)\n`,
      'src/__init__.py': '',
      'tests/__init__.py': '',
      'tests/test_health.py': `from src.app import create_app\n\ndef test_health():\n    app = create_app()\n    client = app.test_client()\n    response = client.get("/health")\n    assert response.status_code == 200\n    assert response.json == {"status": "ok"}\n`,
      'requirements.txt': 'flask>=3.0.0\npytest>=7.0.0\n',
      'pyproject.toml': `[project]\nname = "{{name}}"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`,
    },
    packageJson: null,
    orchestrator: {
      agents: ['engine-dev', 'ui-dev', 'qa-engineer', 'tech-lead', 'producer'],
      roles: ['engine-dev', 'ui-dev', 'qa-engineer', 'tech-lead', 'producer'],
    },
  },

  'static-site': {
    id: 'static-site',
    name: 'Static Site',
    description: 'Simple HTML/CSS/JS static site with optional build tooling',
    language: 'javascript',
    framework: 'none',
    testRunner: 'none',
    dirs: ['src', 'src/css', 'src/js', 'public', 'public/images'],
    files: {
      'src/index.html': `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>{{name}}</title><link rel="stylesheet" href="css/style.css" /></head>\n<body><h1>{{name}}</h1><script src="js/main.js"></script></body>\n</html>\n`,
      'src/css/style.css': `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: system-ui, sans-serif; line-height: 1.6; }\n`,
      'src/js/main.js': `console.log('{{name}} loaded');\n`,
    },
    packageJson: null,
    orchestrator: {
      agents: ['ui-dev', 'css-artist', 'qa-engineer', 'producer'],
      roles: ['ui-dev', 'css-artist', 'qa-engineer', 'producer'],
    },
  },

  'monorepo': {
    id: 'monorepo',
    name: 'Monorepo (TypeScript)',
    description: 'Multi-package monorepo with shared types and workspace config',
    language: 'typescript',
    framework: 'none',
    testRunner: 'vitest',
    dirs: ['packages', 'packages/shared', 'packages/shared/src', 'packages/app', 'packages/app/src', 'packages/api', 'packages/api/src'],
    files: {
      'packages/shared/src/index.ts': `export interface Config {\n  name: string;\n  version: string;\n}\n\nexport const DEFAULT_CONFIG: Config = {\n  name: '{{name}}',\n  version: '0.1.0',\n};\n`,
      'packages/shared/package.json': `{\n  "name": "@{{name}}/shared",\n  "version": "0.1.0",\n  "type": "module",\n  "main": "src/index.ts",\n  "types": "src/index.ts"\n}\n`,
      'packages/app/src/index.ts': `import { DEFAULT_CONFIG } from '@{{name}}/shared';\nconsole.log('App:', DEFAULT_CONFIG.name);\n`,
      'packages/app/package.json': `{\n  "name": "@{{name}}/app",\n  "version": "0.1.0",\n  "type": "module",\n  "dependencies": { "@{{name}}/shared": "workspace:*" }\n}\n`,
      'packages/api/src/index.ts': `import { DEFAULT_CONFIG } from '@{{name}}/shared';\nconsole.log('API:', DEFAULT_CONFIG.name);\n`,
      'packages/api/package.json': `{\n  "name": "@{{name}}/api",\n  "version": "0.1.0",\n  "type": "module",\n  "dependencies": { "@{{name}}/shared": "workspace:*" }\n}\n`,
      'tsconfig.json': `{\n  "compilerOptions": {\n    "target": "ES2020",\n    "module": "ESNext",\n    "moduleResolution": "bundler",\n    "strict": true,\n    "esModuleInterop": true,\n    "paths": { "@{{name}}/*": ["packages/*/src"] }\n  },\n  "include": ["packages/*/src"]\n}\n`,
    },
    packageJson: {
      private: true,
      workspaces: ['packages/*'],
      scripts: { test: 'vitest run', build: 'tsc -b' },
      devDependencies: { typescript: '^5.0.0', vitest: '^1.0.0' },
    },
    orchestrator: {
      agents: ['engine-dev', 'architect', 'qa-engineer', 'tech-lead', 'producer'],
      roles: ['engine-dev', 'architect', 'qa-engineer', 'tech-lead', 'producer'],
    },
  },
};

// ── Template Helpers ────────────────────────────────────────

/**
 * List available templates.
 * @returns {Array<{id: string, name: string, description: string, language: string}>}
 */
export function listTemplates() {
  return Object.values(TEMPLATES).map(t => ({
    id: t.id, name: t.name, description: t.description,
    language: t.language, framework: t.framework, testRunner: t.testRunner,
  }));
}

/**
 * Get a template by ID.
 * @param {string} id
 * @returns {Object|null}
 */
export function getTemplate(id) {
  return TEMPLATES[id] || null;
}

/**
 * Replace {{name}} placeholders in content strings.
 * @param {string} content
 * @param {Object} ctx - { name }
 * @returns {string}
 */
function interpolate(content, ctx) {
  return content.replace(/\{\{name\}\}/g, ctx.name);
}

// ── Orchestrator Config Generation ──────────────────────────

/**
 * Generate a CLAUDE.md file tailored for the scaffolded project.
 */
function generateClaudeMd(template, ctx) {
  const lines = [
    `# ${ctx.name}`,
    '',
    `${template.description}.`,
    '',
    '## Quick Reference',
    '',
    '```bash',
  ];

  if (template.testRunner === 'vitest') lines.push('npm test                    # Run all tests');
  else if (template.testRunner === 'pytest') lines.push('pytest                      # Run all tests');
  if (template.framework === 'react' || template.framework === 'nextjs') lines.push('npm run dev                 # Dev server');
  if (template.framework === 'express') lines.push('npm run dev                 # Dev server with watch');
  if (template.framework === 'fastapi') lines.push('uvicorn src.main:app --reload  # Dev server');
  if (template.framework === 'flask') lines.push('python src/app.py           # Dev server');
  lines.push('```');
  lines.push('');
  lines.push('## Architecture');
  lines.push('');
  lines.push('```');
  for (const dir of template.dirs) lines.push(`${dir}/`);
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate a basic mission config for the orchestrator.
 */
function generateMissionConfig(template, ctx) {
  const agents = template.orchestrator.agents.map(role => ({
    id: role,
    name: role.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
    role: role,
    type: ['producer', 'tech-lead'].includes(role) ? 'continuous' : 'feature',
    model: ['producer', 'tech-lead'].includes(role) ? 'haiku' : 'sonnet',
    maxTasksPerRound: ['producer', 'tech-lead'].includes(role) ? 5 : 2,
  }));

  return {
    name: `${ctx.name} Development`,
    description: `Multi-agent development mission for ${ctx.name}`,
    agents,
    designDoc: null,
    config: {
      maxRounds: 20,
      agentTimeoutMs: 15 * 60 * 1000,
    },
  };
}

/**
 * Generate a project-config.json for the orchestrator.
 */
function generateProjectConfig(template, ctx) {
  const config = {
    name: ctx.name,
    language: template.language,
    framework: template.framework,
    testRunner: template.testRunner,
    testing: {
      command: template.testRunner === 'vitest' ? 'npx vitest run' : template.testRunner === 'pytest' ? 'pytest' : null,
      sourceToTests: {},
    },
    linting: {
      enabled: template.language === 'typescript',
      command: template.language === 'typescript' ? 'npx tsc --noEmit' : null,
    },
  };

  // Default source-to-test mappings
  if (template.testRunner === 'vitest') {
    config.testing.sourceToTests['src/**/*.ts'] = ['tests/**/*.test.ts'];
    config.testing.sourceToTests['src/**/*.tsx'] = ['tests/**/*.test.tsx'];
  } else if (template.testRunner === 'pytest') {
    config.testing.sourceToTests['src/**/*.py'] = ['tests/**/test_*.py'];
  }

  return config;
}

// ── Scaffold Engine ─────────────────────────────────────────

/**
 * Scaffold a new project from a template.
 *
 * @param {Object} options
 * @param {string} options.template - Template ID
 * @param {string} options.name - Project name
 * @param {string} [options.dir='.'] - Parent directory
 * @param {boolean} [options.withOrchestrator=true] - Include orchestrator config
 * @param {boolean} [options.dryRun=false] - Print plan without writing files
 * @returns {{ projectDir: string, filesCreated: string[], dirsCreated: string[] }}
 */
export function scaffold(options) {
  const { template: templateId, name, dir = '.', withOrchestrator = true, dryRun = false } = options;

  const template = TEMPLATES[templateId];
  if (!template) {
    const available = Object.keys(TEMPLATES).join(', ');
    throw new Error(`Unknown template "${templateId}". Available: ${available}`);
  }

  if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new Error(`Invalid project name "${name}". Use alphanumeric, hyphens, dots, underscores.`);
  }

  const projectDir = resolve(dir, name);
  const ctx = { name };

  if (!dryRun && existsSync(projectDir)) {
    const contents = readdirSync(projectDir);
    if (contents.length > 0) {
      throw new Error(`Directory "${projectDir}" already exists and is not empty`);
    }
  }

  const filesCreated = [];
  const dirsCreated = [];

  // Create project root
  if (!dryRun) mkdirSync(projectDir, { recursive: true });
  dirsCreated.push(projectDir);

  // Create directories
  for (const d of template.dirs) {
    const fullDir = join(projectDir, d);
    if (!dryRun) mkdirSync(fullDir, { recursive: true });
    dirsCreated.push(fullDir);
  }

  // Create template files
  for (const [relPath, content] of Object.entries(template.files)) {
    const fullPath = join(projectDir, relPath);
    const parentDir = join(fullPath, '..');
    if (!dryRun) {
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(fullPath, interpolate(content, ctx));
    }
    filesCreated.push(relPath);
  }

  // Create package.json if applicable
  if (template.packageJson) {
    const pkg = {
      name: name,
      version: '0.1.0',
      type: 'module',
      ...template.packageJson,
    };
    const fullPath = join(projectDir, 'package.json');
    if (!dryRun) writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n');
    filesCreated.push('package.json');
  }

  // Create .gitignore
  const gitignoreContent = ['node_modules/', 'dist/', 'build/', '.env', '*.log', '.DS_Store', '__pycache__/', '*.pyc', '.venv/', 'orchestrator/logs/', 'orchestrator/.worktrees/'].join('\n') + '\n';
  if (!dryRun) writeFileSync(join(projectDir, '.gitignore'), gitignoreContent);
  filesCreated.push('.gitignore');

  // Create CLAUDE.md
  const claudeMd = generateClaudeMd(template, ctx);
  if (!dryRun) writeFileSync(join(projectDir, 'CLAUDE.md'), claudeMd);
  filesCreated.push('CLAUDE.md');

  // Create orchestrator config if requested
  if (withOrchestrator) {
    const orchDir = join(projectDir, 'orchestrator');
    const missionsDir = join(orchDir, 'missions');
    const handoffsDir = join(orchDir, 'handoffs');

    if (!dryRun) {
      mkdirSync(orchDir, { recursive: true });
      mkdirSync(missionsDir, { recursive: true });
      mkdirSync(handoffsDir, { recursive: true });
    }
    dirsCreated.push(orchDir, missionsDir, handoffsDir);

    // Mission config
    const mission = generateMissionConfig(template, ctx);
    if (!dryRun) writeFileSync(join(missionsDir, 'default.json'), JSON.stringify(mission, null, 2) + '\n');
    filesCreated.push('orchestrator/missions/default.json');

    // Project config
    const projConfig = generateProjectConfig(template, ctx);
    if (!dryRun) writeFileSync(join(orchDir, 'project-config.json'), JSON.stringify(projConfig, null, 2) + '\n');
    filesCreated.push('orchestrator/project-config.json');

    // Backlog seed
    const backlog = [];
    if (!dryRun) writeFileSync(join(orchDir, 'backlog.json'), JSON.stringify(backlog, null, 2) + '\n');
    filesCreated.push('orchestrator/backlog.json');
  }

  return { projectDir, filesCreated, dirsCreated, template: template.id, name };
}

// ── CLI ─────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Project Scaffold — Create new projects with orchestrator support

Usage:
  node orchestrator/project-scaffold.mjs --template <id> --name <name> [--dir <path>] [--dry-run] [--no-orchestrator]
  node orchestrator/project-scaffold.mjs --list

Templates:`);
  for (const t of listTemplates()) {
    console.log(`  ${t.id.padEnd(20)} ${t.description} [${t.language}/${t.framework}]`);
  }
  console.log('');
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') { args.list = true; continue; }
    if (arg === '--dry-run') { args.dryRun = true; continue; }
    if (arg === '--no-orchestrator') { args.noOrchestrator = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (arg === '--template' && i + 1 < argv.length) { args.template = argv[++i]; continue; }
    if (arg === '--name' && i + 1 < argv.length) { args.name = argv[++i]; continue; }
    if (arg === '--dir' && i + 1 < argv.length) { args.dir = argv[++i]; continue; }
  }
  return args;
}

// Run as CLI if executed directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('project-scaffold.mjs') ||
  process.argv[1].replace(/\\/g, '/').endsWith('project-scaffold.mjs')
);

if (isMainModule) {
  const args = parseCliArgs(process.argv);

  if (args.help || (!args.list && !args.template)) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  if (args.list) {
    console.log('\nAvailable templates:\n');
    const templates = listTemplates();
    const maxId = Math.max(...templates.map(t => t.id.length));
    for (const t of templates) {
      console.log(`  ${t.id.padEnd(maxId + 2)} ${t.name}`);
      console.log(`  ${''.padEnd(maxId + 2)} ${t.description}`);
      console.log(`  ${''.padEnd(maxId + 2)} Language: ${t.language}, Framework: ${t.framework}, Tests: ${t.testRunner}`);
      console.log('');
    }
    process.exit(0);
  }

  if (!args.name) {
    console.error('Error: --name is required');
    process.exit(1);
  }

  try {
    const result = scaffold({
      template: args.template,
      name: args.name,
      dir: args.dir || '.',
      withOrchestrator: !args.noOrchestrator,
      dryRun: args.dryRun,
    });

    if (args.dryRun) {
      console.log(`\nDry run — would create project "${result.name}" from template "${result.template}":\n`);
      console.log(`  Project directory: ${result.projectDir}`);
      console.log(`  Directories: ${result.dirsCreated.length}`);
      console.log(`  Files:`);
      for (const f of result.filesCreated) console.log(`    ${f}`);
    } else {
      console.log(`\nProject "${result.name}" created at: ${result.projectDir}`);
      console.log(`  Template: ${result.template}`);
      console.log(`  Files created: ${result.filesCreated.length}`);
      console.log(`\nNext steps:`);
      console.log(`  cd ${result.name}`);
      const tpl = TEMPLATES[result.template];
      if (tpl.packageJson) console.log(`  npm install`);
      else if (tpl.language === 'python') console.log(`  pip install -r requirements.txt`);
      console.log(`  node orchestrator/orchestrator.mjs orchestrator/missions/default.json`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// ── Exports ─────────────────────────────────────────────────

export { TEMPLATES };
export const __test__ = { scaffold, listTemplates, getTemplate, interpolate, generateMissionConfig, generateProjectConfig, generateClaudeMd, TEMPLATES };
