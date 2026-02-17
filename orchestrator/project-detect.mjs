#!/usr/bin/env node
// ============================================================
// Project Auto-Detection Module
// ============================================================
// Scans a project directory and auto-detects:
//   - Language, framework, build tool, package manager
//   - Test runner, linter, type checker commands
//   - Source/test directory structure
//   - Entry points and project layout
//
// Usage:
//   import { detectProject } from './project-detect.mjs';
//   const config = await detectProject('/path/to/project');
//
// Or standalone:
//   node orchestrator/project-detect.mjs [path]
// ============================================================

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';

// ── Detection Signatures ────────────────────────────────────

const PACKAGE_MANAGER_FILES = {
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
};

const LANGUAGE_MARKERS = {
  'package.json':       { language: 'javascript', ecosystem: 'node' },
  'tsconfig.json':      { language: 'typescript', ecosystem: 'node' },
  'Cargo.toml':         { language: 'rust',       ecosystem: 'cargo' },
  'pyproject.toml':     { language: 'python',     ecosystem: 'python' },
  'setup.py':           { language: 'python',     ecosystem: 'python' },
  'requirements.txt':   { language: 'python',     ecosystem: 'python' },
  'go.mod':             { language: 'go',         ecosystem: 'go' },
  'pom.xml':            { language: 'java',       ecosystem: 'maven' },
  'build.gradle':       { language: 'java',       ecosystem: 'gradle' },
  'build.gradle.kts':   { language: 'kotlin',     ecosystem: 'gradle' },
  'Gemfile':            { language: 'ruby',        ecosystem: 'bundler' },
  'composer.json':      { language: 'php',         ecosystem: 'composer' },
};

const FRAMEWORK_SIGNATURES = {
  // Node.js frameworks (detected from package.json dependencies)
  'react':           { name: 'React',     type: 'frontend' },
  'vue':             { name: 'Vue',       type: 'frontend' },
  '@angular/core':   { name: 'Angular',   type: 'frontend' },
  'svelte':          { name: 'Svelte',    type: 'frontend' },
  'next':            { name: 'Next.js',   type: 'fullstack' },
  'nuxt':            { name: 'Nuxt',      type: 'fullstack' },
  'express':         { name: 'Express',   type: 'backend' },
  'fastify':         { name: 'Fastify',   type: 'backend' },
  'koa':             { name: 'Koa',       type: 'backend' },
  'hono':            { name: 'Hono',      type: 'backend' },
  'electron':        { name: 'Electron',  type: 'desktop' },
  'react-native':    { name: 'React Native', type: 'mobile' },
};

const BUILD_TOOL_SIGNATURES = {
  // Detected from devDependencies or config files
  'vite':      { name: 'Vite',     configFile: 'vite.config.*' },
  'webpack':   { name: 'Webpack',  configFile: 'webpack.config.*' },
  'esbuild':   { name: 'esbuild',  configFile: null },
  'rollup':    { name: 'Rollup',   configFile: 'rollup.config.*' },
  'turbopack': { name: 'Turbopack', configFile: 'turbo.json' },
  'parcel':    { name: 'Parcel',   configFile: null },
};

const TEST_RUNNER_SIGNATURES = {
  'vitest':    { command: 'npx vitest run',   configFile: 'vitest.config.*' },
  'jest':      { command: 'npx jest',         configFile: 'jest.config.*' },
  'mocha':     { command: 'npx mocha',        configFile: '.mocharc.*' },
  'ava':       { command: 'npx ava',          configFile: null },
  'tap':       { command: 'npx tap',          configFile: null },
  'playwright':{ command: 'npx playwright test', configFile: 'playwright.config.*' },
  'cypress':   { command: 'npx cypress run',  configFile: 'cypress.config.*' },
};

const LINTER_SIGNATURES = {
  'eslint':    { command: 'npx eslint .', configFiles: ['.eslintrc*', 'eslint.config.*'] },
  'biome':     { command: 'npx biome check .', configFiles: ['biome.json'] },
  'prettier':  { command: 'npx prettier --check .', configFiles: ['.prettierrc*'] },
};

// ── Helper Functions ────────────────────────────────────────

function fileExists(dir, filename) {
  return existsSync(join(dir, filename));
}

function readJSON(dir, filename) {
  const path = join(dir, filename);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function findDirs(dir, maxDepth = 2) {
  const dirs = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          dirs.push(join(current, entry.name));
          walk(join(current, entry.name), depth + 1);
        }
      }
    } catch { /* permission denied, etc. */ }
  }
  walk(dir, 0);
  return dirs;
}

function findFiles(dir, pattern, maxDepth = 3) {
  const files = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    try {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (typeof pattern === 'string') {
            if (entry.name === pattern || entry.name.match(pattern)) {
              files.push(fullPath);
            }
          } else if (pattern instanceof RegExp) {
            if (pattern.test(entry.name)) {
              files.push(fullPath);
            }
          }
        }
      }
    } catch { /* ignore */ }
  }
  walk(dir, 0);
  return files;
}

// ── Core Detection Functions ────────────────────────────────

function detectLanguage(dir) {
  // Check for TypeScript first (more specific)
  if (fileExists(dir, 'tsconfig.json')) {
    return { language: 'typescript', ecosystem: 'node' };
  }

  for (const [file, info] of Object.entries(LANGUAGE_MARKERS)) {
    if (fileExists(dir, file)) {
      return info;
    }
  }

  // Fallback: count file extensions
  const extCounts = {};
  const files = findFiles(dir, /\.(ts|js|py|rs|go|java|rb|php|cs)$/);
  for (const f of files) {
    const ext = extname(f);
    extCounts[ext] = (extCounts[ext] || 0) + 1;
  }

  const extToLang = { '.ts': 'typescript', '.js': 'javascript', '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java', '.rb': 'ruby', '.php': 'php', '.cs': 'csharp' };
  const topExt = Object.entries(extCounts).sort((a, b) => b[1] - a[1])[0];
  if (topExt) {
    return { language: extToLang[topExt[0]] || 'unknown', ecosystem: 'unknown' };
  }

  return { language: 'unknown', ecosystem: 'unknown' };
}

function detectPackageManager(dir) {
  for (const [file, manager] of Object.entries(PACKAGE_MANAGER_FILES)) {
    if (fileExists(dir, file)) return manager;
  }
  if (fileExists(dir, 'package.json')) return 'npm';
  return null;
}

function detectFrameworks(dir) {
  const pkg = readJSON(dir, 'package.json');
  if (!pkg) return [];

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const frameworks = [];

  for (const [dep, info] of Object.entries(FRAMEWORK_SIGNATURES)) {
    if (allDeps[dep]) {
      frameworks.push({ ...info, version: allDeps[dep] });
    }
  }

  // Python frameworks
  if (fileExists(dir, 'requirements.txt')) {
    try {
      const reqs = readFileSync(join(dir, 'requirements.txt'), 'utf-8');
      if (reqs.includes('fastapi')) frameworks.push({ name: 'FastAPI', type: 'backend' });
      if (reqs.includes('django')) frameworks.push({ name: 'Django', type: 'fullstack' });
      if (reqs.includes('flask')) frameworks.push({ name: 'Flask', type: 'backend' });
    } catch { /* ignore */ }
  }

  return frameworks;
}

function detectBuildTool(dir) {
  const pkg = readJSON(dir, 'package.json');
  if (!pkg) {
    // Non-Node projects
    if (fileExists(dir, 'Cargo.toml')) return { name: 'cargo', command: 'cargo build' };
    if (fileExists(dir, 'go.mod')) return { name: 'go', command: 'go build ./...' };
    if (fileExists(dir, 'Makefile')) return { name: 'make', command: 'make' };
    return null;
  }

  const devDeps = pkg.devDependencies || {};
  for (const [dep, info] of Object.entries(BUILD_TOOL_SIGNATURES)) {
    if (devDeps[dep]) {
      const buildScript = pkg.scripts?.build;
      return { name: info.name, command: buildScript ? `npm run build` : `npx ${dep} build` };
    }
  }

  if (pkg.scripts?.build) return { name: 'npm-script', command: 'npm run build' };
  return null;
}

function detectTestRunner(dir) {
  const pkg = readJSON(dir, 'package.json');

  // Non-Node projects
  if (fileExists(dir, 'Cargo.toml')) return { name: 'cargo-test', command: 'cargo test' };
  if (fileExists(dir, 'go.mod')) return { name: 'go-test', command: 'go test ./...' };

  if (pkg) {
    const devDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [dep, info] of Object.entries(TEST_RUNNER_SIGNATURES)) {
      if (devDeps[dep]) {
        const testScript = pkg.scripts?.test;
        return {
          name: dep,
          command: testScript && !testScript.includes('no test specified') ? 'npm test' : info.command,
        };
      }
    }
    if (pkg.scripts?.test && !pkg.scripts.test.includes('no test specified')) {
      return { name: 'npm-script', command: 'npm test' };
    }
  }

  // Python
  if (fileExists(dir, 'pytest.ini') || fileExists(dir, 'pyproject.toml')) {
    const pyproj = readJSON(dir, 'pyproject.toml');
    // Simple check - pyproject.toml isn't JSON but often has pytest
    if (existsSync(join(dir, 'pytest.ini'))) return { name: 'pytest', command: 'pytest' };
  }

  return null;
}

function detectLinter(dir) {
  const linters = [];
  const pkg = readJSON(dir, 'package.json');

  if (pkg) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [dep, info] of Object.entries(LINTER_SIGNATURES)) {
      if (allDeps[dep]) {
        linters.push({ name: dep, command: info.command });
      }
    }
  }

  // TypeScript type checking
  if (fileExists(dir, 'tsconfig.json')) {
    linters.push({ name: 'typescript', command: 'npx tsc --noEmit', type: 'typecheck' });
  }

  // Rust
  if (fileExists(dir, 'Cargo.toml')) {
    linters.push({ name: 'clippy', command: 'cargo clippy', type: 'lint' });
  }

  // Python
  if (fileExists(dir, 'pyproject.toml') || fileExists(dir, 'ruff.toml')) {
    linters.push({ name: 'ruff', command: 'ruff check .', type: 'lint' });
  }

  return linters;
}

function detectProjectStructure(dir) {
  const structure = {
    sourceDir: null,
    testDir: null,
    testPattern: null,
    configDir: null,
    docsDir: null,
    entryPoints: [],
    directories: {},
  };

  // Common source directories
  const sourceDirs = ['src', 'lib', 'app', 'packages', 'modules'];
  for (const d of sourceDirs) {
    if (existsSync(join(dir, d)) && statSync(join(dir, d)).isDirectory()) {
      structure.sourceDir = d;
      break;
    }
  }

  // Common test directories
  const testDirs = ['test', 'tests', '__tests__', 'spec', 'specs'];
  for (const d of testDirs) {
    if (existsSync(join(dir, d)) && statSync(join(dir, d)).isDirectory()) {
      structure.testDir = d;
      break;
    }
  }

  // If tests are colocated with source
  if (!structure.testDir && structure.sourceDir) {
    const testFiles = findFiles(join(dir, structure.sourceDir), /\.(test|spec)\.(ts|js|tsx|jsx|py|rs)$/);
    if (testFiles.length > 0) {
      structure.testDir = structure.sourceDir;
      structure.testPattern = '*.test.*';
    }
  }

  // Detect test patterns
  if (!structure.testPattern) {
    const testFiles = findFiles(dir, /\.(test|spec)\.(ts|js|tsx|jsx|py|rs)$/);
    if (testFiles.length > 0) {
      const hasTest = testFiles.some(f => f.includes('.test.'));
      const hasSpec = testFiles.some(f => f.includes('.spec.'));
      structure.testPattern = hasTest ? '*.test.*' : hasSpec ? '*.spec.*' : null;
    }
  }

  // Config and docs
  if (existsSync(join(dir, 'docs'))) structure.docsDir = 'docs';
  if (existsSync(join(dir, 'config'))) structure.configDir = 'config';

  // Entry points
  const entryFiles = ['src/main.ts', 'src/main.tsx', 'src/index.ts', 'src/index.tsx', 'src/index.js',
                      'src/App.tsx', 'src/App.ts', 'app/main.ts', 'lib/index.ts',
                      'main.py', 'app.py', 'src/main.rs', 'main.go', 'cmd/main.go'];
  for (const f of entryFiles) {
    if (fileExists(dir, f)) structure.entryPoints.push(f);
  }

  // Map source subdirectories
  if (structure.sourceDir && existsSync(join(dir, structure.sourceDir))) {
    try {
      for (const entry of readdirSync(join(dir, structure.sourceDir), { withFileTypes: true })) {
        if (entry.isDirectory()) {
          structure.directories[entry.name] = `${structure.sourceDir}/${entry.name}/`;
        }
      }
    } catch { /* ignore */ }
  }

  return structure;
}

function detectMonorepo(dir) {
  const pkg = readJSON(dir, 'package.json');
  if (pkg?.workspaces) return { type: 'npm-workspaces', config: pkg.workspaces };
  if (fileExists(dir, 'pnpm-workspace.yaml')) return { type: 'pnpm-workspaces', config: null };
  if (fileExists(dir, 'lerna.json')) return { type: 'lerna', config: null };
  if (fileExists(dir, 'nx.json')) return { type: 'nx', config: null };
  if (fileExists(dir, 'turbo.json')) return { type: 'turborepo', config: null };
  return null;
}

// ── Quality Gate Suggestions ────────────────────────────────

function suggestQualityGates(detection) {
  const gates = [];

  // Lint gate
  for (const linter of detection.linters) {
    if (linter.type === 'lint' || !linter.type) {
      gates.push({
        name: `lint-${linter.name}`,
        command: linter.command,
        severity: 'warning',
        description: `Run ${linter.name} linter`,
      });
    }
  }

  // Type check gate
  const typeChecker = detection.linters.find(l => l.type === 'typecheck');
  if (typeChecker) {
    gates.push({
      name: 'typecheck',
      command: typeChecker.command,
      severity: 'blocking',
      description: 'Type checking',
    });
  }

  // Test gate
  if (detection.testRunner) {
    gates.push({
      name: 'test',
      command: detection.testRunner.command,
      severity: 'blocking',
      description: `Run ${detection.testRunner.name} test suite`,
    });
  }

  // Build gate
  if (detection.buildTool) {
    gates.push({
      name: 'build',
      command: detection.buildTool.command,
      severity: 'blocking',
      description: `Build with ${detection.buildTool.name}`,
    });
  }

  return gates;
}

// ── Agent Team Suggestions ──────────────────────────────────

function suggestAgentTeam(detection) {
  const agents = [];
  const frameworks = detection.frameworks;
  const hasFrontend = frameworks.some(f => f.type === 'frontend' || f.type === 'fullstack');
  const hasBackend = frameworks.some(f => f.type === 'backend' || f.type === 'fullstack');

  // Always include these core agents
  agents.push({
    role: 'architect',
    model: 'sonnet',
    reason: 'System design and structural oversight',
    priority: 'core',
  });

  agents.push({
    role: 'qa-engineer',
    model: 'sonnet',
    reason: 'Test coverage and regression prevention',
    priority: 'core',
  });

  agents.push({
    role: 'tech-lead',
    model: 'sonnet',
    reason: 'Code review and quality enforcement',
    priority: 'core',
  });

  // Frontend agents
  if (hasFrontend) {
    agents.push({
      role: 'ui-dev',
      model: 'sonnet',
      reason: `${frameworks.find(f => f.type === 'frontend')?.name || 'Frontend'} development`,
      priority: 'core',
    });
    agents.push({
      role: 'css-artist',
      model: 'haiku',
      reason: 'Visual polish and responsive design',
      priority: 'optional',
    });
  }

  // Backend agents
  if (hasBackend) {
    agents.push({
      role: 'engine-dev',
      model: 'sonnet',
      reason: 'Backend/engine implementation',
      priority: 'core',
    });
  }

  // Always useful
  agents.push({
    role: 'security-auditor',
    model: 'sonnet',
    reason: 'Security vulnerability detection',
    priority: 'recommended',
  });

  agents.push({
    role: 'producer',
    model: 'haiku',
    reason: 'Task generation and pipeline management',
    priority: 'recommended',
  });

  // Optional specialists
  agents.push({
    role: 'test-generator',
    model: 'sonnet',
    reason: 'Systematic test coverage expansion',
    priority: 'optional',
  });

  agents.push({
    role: 'performance-analyst',
    model: 'haiku',
    reason: 'Performance monitoring and optimization',
    priority: 'optional',
  });

  return agents;
}

// ── Main Detection Function ─────────────────────────────────

export async function detectProject(dir) {
  const langInfo = detectLanguage(dir);
  const packageManager = detectPackageManager(dir);
  const frameworks = detectFrameworks(dir);
  const buildTool = detectBuildTool(dir);
  const testRunner = detectTestRunner(dir);
  const linters = detectLinter(dir);
  const structure = detectProjectStructure(dir);
  const monorepo = detectMonorepo(dir);

  const detection = {
    projectDir: dir,
    projectName: basename(dir),
    language: langInfo.language,
    ecosystem: langInfo.ecosystem,
    packageManager,
    frameworks,
    buildTool,
    testRunner,
    linters,
    structure,
    monorepo,
  };

  // Add derived suggestions
  detection.qualityGates = suggestQualityGates(detection);
  detection.suggestedAgents = suggestAgentTeam(detection);
  detection.testMapping = suggestTestMapping(detection, dir);
  detection.ownershipPatterns = suggestFileOwnership(detection);

  return detection;
}

// ── Test Mapping Suggestions ────────────────────────────────

function suggestTestMapping(detection, dir) {
  const mapping = {
    sourceToTests: {},
    fullSuiteTriggers: ['types.ts', 'index.ts'],
    aiSourcePattern: null,
    aiTestFile: null,
    filterFlag: null,
  };

  // Determine filter flag based on test runner
  const filterFlags = {
    vitest: '--testPathPattern',
    jest: '--testPathPattern',
    mocha: '--grep',
    pytest: '-k',
    'cargo-test': '--test',
    'go-test': '-run',
  };
  mapping.filterFlag = filterFlags[detection.testRunner?.name] || null;

  const sourceDir = detection.structure.sourceDir;
  if (!sourceDir) return mapping;

  try {
    const testFiles = findFiles(join(dir, sourceDir), /\.(test|spec)\.(ts|js|tsx|jsx|py|rs)$/);
    const sourceFiles = findFiles(join(dir, sourceDir), /\.(ts|js|tsx|jsx|py|rs)$/)
      .filter(f => !f.match(/\.(test|spec)\./));

    // Build mapping: for each source file, find matching test files by name convention
    for (const srcFile of sourceFiles) {
      const srcBasename = srcFile.split('/').pop().split('\\').pop();
      const srcName = srcBasename.replace(/\.(ts|js|tsx|jsx|py|rs)$/, '');

      const matchedTests = testFiles.filter(tf => {
        const testBasename = tf.split('/').pop().split('\\').pop();
        return testBasename.startsWith(srcName + '.test.') || testBasename.startsWith(srcName + '.spec.');
      }).map(tf => tf.split('/').pop().split('\\').pop());

      if (matchedTests.length > 0) {
        mapping.sourceToTests[srcBasename] = matchedTests;
      }
    }

    // Detect AI source pattern (if src/ai/ directory exists)
    if (detection.structure.directories['ai']) {
      mapping.aiSourcePattern = `^${sourceDir}/ai/`;
      const aiTests = testFiles.filter(f => f.includes('/ai/') || f.includes('\\ai\\'));
      if (aiTests.length > 0) {
        mapping.aiTestFile = aiTests[0].split('/').pop().split('\\').pop();
      }
    }
  } catch { /* ignore scan errors */ }

  return mapping;
}

// ── File Ownership Suggestions ──────────────────────────────

function suggestFileOwnership(detection) {
  const patterns = {};
  const srcDir = detection.structure.sourceDir || 'src';
  const dirs = detection.structure.directories;

  // engine-dev: owns engine/backend source (not tests)
  if (dirs.engine) patterns['engine-dev'] = [`${dirs.engine}*.ts`, `!${dirs.engine}*.test.*`];

  // ui-dev: owns UI components
  if (dirs.ui) patterns['ui-dev'] = [`${dirs.ui}*.tsx`, `${srcDir}/App.tsx`, `${srcDir}/App.css`];
  if (dirs.components) patterns['ui-dev'] = [`${dirs.components}*.tsx`, `${srcDir}/App.tsx`];

  // qa-engineer: owns test files
  const testGlobs = [];
  for (const [, path] of Object.entries(dirs)) {
    testGlobs.push(`${path}*.test.*`);
  }
  if (testGlobs.length > 0) patterns['qa-engineer'] = testGlobs;

  // Coordination roles — analysis/config files
  patterns['architect'] = ['orchestrator/analysis/architecture-*.md'];
  patterns['security-auditor'] = ['orchestrator/analysis/security-*.md'];
  patterns['producer'] = ['orchestrator/backlog.json', 'orchestrator/analysis/producer-status.md'];
  patterns['tech-lead'] = [`${srcDir}/engine/types.ts`, 'CLAUDE.md'];

  // test-generator: same as qa (test files)
  if (testGlobs.length > 0) patterns['test-generator'] = [...testGlobs];

  // css-artist: CSS/SCSS files
  if (dirs.ui) patterns['css-artist'] = [`${dirs.ui}*.css`, `${srcDir}/App.css`, `${srcDir}/index.css`];

  // research-agent: AI source files
  if (dirs.ai) patterns['research-agent'] = [`${dirs.ai}*`];

  // devops: tools/scripts
  if (dirs.tools) patterns['devops'] = [`${dirs.tools}*`];

  return patterns;
}

// ── Generate Project Config ─────────────────────────────────

/**
 * Generate a project-config.json-compatible object from detection results.
 * Used when no project-config.json file exists — auto-populates config from detection.
 */
export function generateProjectConfig(detection, dir) {
  const testMapping = suggestTestMapping(detection, dir);
  const ownershipPatterns = suggestFileOwnership(detection);

  return {
    // Metadata
    projectName: detection.projectName,
    generatedAt: new Date().toISOString(),
    generatedBy: 'project-detect.mjs',

    // Stack
    language: detection.language,
    ecosystem: detection.ecosystem,
    packageManager: detection.packageManager,
    framework: detection.frameworks[0]?.name || null,

    // Testing
    testing: {
      runner: detection.testRunner?.name || null,
      command: detection.testRunner?.command || null,
      filterFlag: testMapping.filterFlag,
      sourceToTests: testMapping.sourceToTests,
      fullSuiteTriggers: testMapping.fullSuiteTriggers,
      aiSourcePattern: testMapping.aiSourcePattern,
      aiTestFile: testMapping.aiTestFile,
      timeoutMs: 180000,
    },

    // Quality gates (from detection)
    qualityGates: detection.qualityGates.map(g => ({
      name: g.name,
      command: g.command,
      severity: g.severity,
    })),

    // Project structure
    structure: detection.structure,

    // File ownership patterns per role
    ownershipPatterns,
  };
}

// ── CLI Entry Point ─────────────────────────────────────────
// Only runs when this file is executed directly (not when imported)

const __projectDetectFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === __projectDetectFile) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Project Auto-Detection Tool
============================
Usage: node orchestrator/project-detect.mjs [path]

Scans a project directory and detects:
  - Language, framework, build tool, package manager
  - Test runner, linter, type checker
  - Source/test directory structure
  - Suggested quality gates and agent team

Options:
  --json          Output as JSON (default: human-readable)
  --emit-config   Generate orchestrator/project-config.json
  --help          Show this help
`);
    process.exit(0);
  }

  if (args.includes('--emit-config')) {
    const emitDirRaw = args.find(a => !a.startsWith('-')) || process.cwd();
    const emitDir = join(process.cwd(), emitDirRaw);  // resolve relative paths
    const emitResult = await detectProject(emitDir);
    const config = generateProjectConfig(emitResult, emitDir);

    const outputPath = join(emitDir, 'orchestrator', 'project-config.json');
    writeFileSync(outputPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`Project config written to: ${outputPath}`);
    console.log(`  Language: ${config.language}`);
    console.log(`  Test runner: ${config.testing.runner}`);
    console.log(`  Quality gates: ${config.qualityGates.length}`);
    console.log(`  Ownership roles: ${Object.keys(config.ownershipPatterns).length}`);
    console.log(`  Source-to-test mappings: ${Object.keys(config.testing.sourceToTests).length}`);
    process.exit(0);
  }

  const isJSON = args.includes('--json');
  const targetDir = args.find(a => !a.startsWith('-')) || process.cwd();

  const result = await detectProject(targetDir);

  if (isJSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\nProject Detection: ${result.projectName}`);
    console.log('='.repeat(40));
    console.log(`Language:         ${result.language}`);
    console.log(`Ecosystem:        ${result.ecosystem}`);
    console.log(`Package Manager:  ${result.packageManager || 'none detected'}`);
    console.log(`Build Tool:       ${result.buildTool?.name || 'none detected'}`);
    console.log(`Test Runner:      ${result.testRunner?.name || 'none detected'}`);
    console.log(`Monorepo:         ${result.monorepo?.type || 'no'}`);

    if (result.frameworks.length) {
      console.log(`\nFrameworks:`);
      for (const f of result.frameworks) {
        console.log(`  - ${f.name} (${f.type}) ${f.version || ''}`);
      }
    }

    if (result.linters.length) {
      console.log(`\nLinters/Checkers:`);
      for (const l of result.linters) {
        console.log(`  - ${l.name}: ${l.command}`);
      }
    }

    console.log(`\nProject Structure:`);
    console.log(`  Source:     ${result.structure.sourceDir || 'root'}`);
    console.log(`  Tests:      ${result.structure.testDir || 'not found'}`);
    console.log(`  Test Pattern: ${result.structure.testPattern || 'not detected'}`);
    if (result.structure.entryPoints.length) {
      console.log(`  Entry Points: ${result.structure.entryPoints.join(', ')}`);
    }
    if (Object.keys(result.structure.directories).length) {
      console.log(`  Subdirs:    ${Object.keys(result.structure.directories).join(', ')}`);
    }

    if (result.qualityGates.length) {
      console.log(`\nSuggested Quality Gates:`);
      for (const g of result.qualityGates) {
        console.log(`  [${g.severity}] ${g.name}: ${g.command}`);
      }
    }

    console.log(`\nSuggested Agent Team:`);
    for (const a of result.suggestedAgents) {
      console.log(`  [${a.priority}] ${a.role} (${a.model}) — ${a.reason}`);
    }
  }
}
