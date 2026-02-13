#!/usr/bin/env node
// ============================================================
// Pluggable Quality Gate Chain
// ============================================================
// Replaces hardcoded test-only regression detection with a
// configurable pipeline of quality checks.
//
// Usage:
//   import { QualityGateChain } from './quality-gates.mjs';
//   const chain = new QualityGateChain(gates, { cwd: projectDir });
//   const results = await chain.run();
//   if (results.blocking.length > 0) { /* revert */ }
//
// Gate Definition:
//   {
//     name: 'test',
//     command: 'npx vitest run',
//     severity: 'blocking' | 'warning' | 'info',
//     timeout: 120000,
//     parseOutput: (stdout, stderr, code) => ({ passed, details }),
//     condition: (context) => boolean,  // skip gate if false
//   }
// ============================================================

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// ── Built-in Gate Parsers ───────────────────────────────────

// Strip ANSI escape codes for reliable regex matching
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

const PARSERS = {
  vitest(stdout, stderr, code) {
    const clean = stripAnsi(stdout);
    // Match "Tests  908 passed" (not "Test Files  8 passed")
    const testLineMatch = clean.match(/Tests\s+(\d+)\s+passed/);
    const passMatch = testLineMatch || clean.match(/(\d+)\s+passed/);
    const failMatch = clean.match(/(\d+)\s+failed/);
    const passed = code === 0;
    const testCount = passMatch ? parseInt(passMatch[1]) : 0;
    const failCount = failMatch ? parseInt(failMatch[1]) : 0;
    return {
      passed,
      details: passed
        ? `${testCount} tests passed`
        : `${failCount} failed, ${testCount} passed`,
      metrics: { testCount, failCount },
    };
  },

  jest(stdout, stderr, code) {
    const passMatch = stdout.match(/Tests:\s+(\d+)\s+passed/);
    const failMatch = stdout.match(/Tests:\s+(\d+)\s+failed/);
    const passed = code === 0;
    return {
      passed,
      details: passed
        ? `${passMatch?.[1] || '?'} tests passed`
        : `${failMatch?.[1] || '?'} failed`,
      metrics: {},
    };
  },

  pytest(stdout, stderr, code) {
    const match = stdout.match(/(\d+)\s+passed/);
    const failMatch = stdout.match(/(\d+)\s+failed/);
    return {
      passed: code === 0,
      details: code === 0
        ? `${match?.[1] || '?'} tests passed`
        : `${failMatch?.[1] || '?'} failed`,
      metrics: {},
    };
  },

  typescript(stdout, stderr, code) {
    const errorMatch = stderr.match(/Found (\d+) error/);
    const errors = errorMatch ? parseInt(errorMatch[1]) : (code !== 0 ? 1 : 0);
    return {
      passed: code === 0,
      details: code === 0 ? 'No type errors' : `${errors} type error(s)`,
      metrics: { errors },
    };
  },

  eslint(stdout, stderr, code) {
    const errorMatch = stdout.match(/(\d+)\s+error/);
    const warnMatch = stdout.match(/(\d+)\s+warning/);
    const errors = errorMatch ? parseInt(errorMatch[1]) : 0;
    const warnings = warnMatch ? parseInt(warnMatch[1]) : 0;
    return {
      passed: code === 0,
      details: code === 0 ? 'No lint errors' : `${errors} errors, ${warnings} warnings`,
      metrics: { errors, warnings },
    };
  },

  generic(stdout, stderr, code) {
    return {
      passed: code === 0,
      details: code === 0 ? 'Passed' : `Exit code ${code}`,
      metrics: {},
    };
  },
};

// ── Preset Gate Definitions ─────────────────────────────────

export const PRESET_GATES = {
  'vitest': {
    name: 'test-vitest',
    command: 'npx vitest run',
    severity: 'blocking',
    timeout: 120000,
    parser: 'vitest',
    description: 'Run Vitest test suite',
  },
  'jest': {
    name: 'test-jest',
    command: 'npx jest',
    severity: 'blocking',
    timeout: 120000,
    parser: 'jest',
    description: 'Run Jest test suite',
  },
  'pytest': {
    name: 'test-pytest',
    command: 'pytest',
    severity: 'blocking',
    timeout: 120000,
    parser: 'pytest',
    description: 'Run pytest test suite',
  },
  'cargo-test': {
    name: 'test-cargo',
    command: 'cargo test',
    severity: 'blocking',
    timeout: 120000,
    parser: 'generic',
    description: 'Run cargo test suite',
  },
  'typescript': {
    name: 'typecheck',
    command: 'npx tsc --noEmit',
    severity: 'blocking',
    timeout: 60000,
    parser: 'typescript',
    description: 'TypeScript type checking',
  },
  'eslint': {
    name: 'lint-eslint',
    command: 'npx eslint .',
    severity: 'warning',
    timeout: 60000,
    parser: 'eslint',
    description: 'ESLint code linting',
  },
  'prettier-check': {
    name: 'format-prettier',
    command: 'npx prettier --check .',
    severity: 'warning',
    timeout: 30000,
    parser: 'generic',
    description: 'Prettier format check',
  },
  'build': {
    name: 'build',
    command: 'npm run build',
    severity: 'blocking',
    timeout: 120000,
    parser: 'generic',
    description: 'Production build',
  },
  'npm-audit': {
    name: 'security-audit',
    command: 'npm audit --audit-level=high',
    severity: 'warning',
    timeout: 30000,
    parser: 'generic',
    description: 'npm dependency security audit',
  },
};

// ── Gate Runner ─────────────────────────────────────────────

function runCommand(command, opts = {}) {
  return new Promise((resolve) => {
    const timeout = opts.timeout || 120000;
    const cwd = opts.cwd || process.cwd();

    const proc = spawn(command, {
      cwd,
      shell: true,
      stdio: 'pipe',
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? -1 : code,
        stdout,
        stderr,
        timedOut,
        elapsedMs: 0, // Would need timer for precise measurement
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout,
        stderr: stderr + '\n' + err.message,
        timedOut: false,
        error: err.message,
      });
    });
  });
}

// ── Quality Gate Chain ──────────────────────────────────────

export class QualityGateChain {
  constructor(gates = [], options = {}) {
    this.gates = gates.map(g => this._resolveGate(g));
    this.cwd = options.cwd || process.cwd();
    this.verbose = options.verbose || false;
    this.stopOnBlocking = options.stopOnBlocking !== false; // default true
    this.context = options.context || {};
  }

  _resolveGate(gate) {
    // If string, look up preset
    if (typeof gate === 'string') {
      const preset = PRESET_GATES[gate];
      if (!preset) throw new Error(`Unknown gate preset: ${gate}`);
      return { ...preset };
    }
    // If object with preset field, merge with preset
    if (gate.preset) {
      const preset = PRESET_GATES[gate.preset];
      if (!preset) throw new Error(`Unknown gate preset: ${gate.preset}`);
      return { ...preset, ...gate };
    }
    // Custom gate
    return {
      severity: 'blocking',
      timeout: 120000,
      parser: 'generic',
      ...gate,
    };
  }

  async run(context = {}) {
    const mergedContext = { ...this.context, ...context };
    const results = {
      blocking: [],
      warnings: [],
      info: [],
      passed: [],
      skipped: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, warnings: 0 },
      allPassed: true,
      blockingPassed: true,
    };

    for (const gate of this.gates) {
      results.summary.total++;

      // Check condition
      if (gate.condition && !gate.condition(mergedContext)) {
        results.skipped.push({ gate: gate.name, reason: 'condition not met' });
        results.summary.skipped++;
        continue;
      }

      if (this.verbose) {
        console.log(`  Running gate: ${gate.name} (${gate.severity})...`);
      }

      // Run the command
      const startMs = Date.now();
      const cmdResult = await runCommand(gate.command, {
        timeout: gate.timeout,
        cwd: this.cwd,
      });
      const elapsedMs = Date.now() - startMs;

      // Parse output
      const parser = PARSERS[gate.parser] || PARSERS.generic;
      const parsed = parser(cmdResult.stdout, cmdResult.stderr, cmdResult.code);

      const gateResult = {
        gate: gate.name,
        severity: gate.severity,
        command: gate.command,
        passed: parsed.passed && !cmdResult.timedOut,
        details: cmdResult.timedOut ? `Timed out after ${gate.timeout}ms` : parsed.details,
        metrics: parsed.metrics || {},
        elapsedMs,
        timedOut: cmdResult.timedOut,
      };

      if (gateResult.passed) {
        results.passed.push(gateResult);
        results.summary.passed++;
      } else {
        results.allPassed = false;

        if (gate.severity === 'blocking') {
          results.blocking.push(gateResult);
          results.blockingPassed = false;
          results.summary.failed++;

          if (this.stopOnBlocking) {
            if (this.verbose) {
              console.log(`  BLOCKED: ${gate.name} — ${gateResult.details}`);
            }
            break; // Stop the chain
          }
        } else if (gate.severity === 'warning') {
          results.warnings.push(gateResult);
          results.summary.warnings++;
        } else {
          results.info.push(gateResult);
        }
      }

      if (this.verbose) {
        const icon = gateResult.passed ? '✓' : gate.severity === 'blocking' ? '✗' : '⚠';
        console.log(`  ${icon} ${gate.name}: ${gateResult.details} [${elapsedMs}ms]`);
      }
    }

    return results;
  }

  // Run only test gates (for incremental testing)
  async runTests(testFilter = null) {
    const testGates = this.gates.filter(g => g.name.startsWith('test-'));
    if (testGates.length === 0) return { passed: [], blocking: [], blockingPassed: true, allPassed: true };

    const chain = new QualityGateChain(
      testGates.map(g => testFilter ? { ...g, command: `${g.command} ${testFilter}` } : g),
      { cwd: this.cwd, verbose: this.verbose }
    );
    return chain.run();
  }

  // Run everything except tests (for quick feedback)
  async runStaticChecks() {
    const staticGates = this.gates.filter(g => !g.name.startsWith('test-'));
    const chain = new QualityGateChain(staticGates, { cwd: this.cwd, verbose: this.verbose });
    return chain.run();
  }

  // Format results for display
  static formatResults(results) {
    const lines = [];
    lines.push(`Quality Gates: ${results.summary.passed}/${results.summary.total} passed`);

    if (results.blocking.length > 0) {
      lines.push(`\nBLOCKING FAILURES:`);
      for (const r of results.blocking) {
        lines.push(`  ✗ ${r.gate}: ${r.details} [${r.elapsedMs}ms]`);
      }
    }

    if (results.warnings.length > 0) {
      lines.push(`\nWARNINGS:`);
      for (const r of results.warnings) {
        lines.push(`  ⚠ ${r.gate}: ${r.details} [${r.elapsedMs}ms]`);
      }
    }

    if (results.passed.length > 0) {
      lines.push(`\nPASSED:`);
      for (const r of results.passed) {
        lines.push(`  ✓ ${r.gate}: ${r.details} [${r.elapsedMs}ms]`);
      }
    }

    if (results.skipped.length > 0) {
      lines.push(`\nSKIPPED:`);
      for (const r of results.skipped) {
        lines.push(`  ○ ${r.gate}: ${r.reason}`);
      }
    }

    return lines.join('\n');
  }
}

// ── Factory: Create Chain from Project Detection ────────────

export function createGateChainFromDetection(detection, overrides = {}) {
  const gates = [];

  // Lint gates (warnings by default)
  for (const linter of detection.linters || []) {
    if (linter.type === 'typecheck') {
      gates.push({
        name: 'typecheck',
        command: linter.command,
        severity: 'blocking',
        timeout: 60000,
        parser: linter.name === 'typescript' ? 'typescript' : 'generic',
      });
    } else {
      gates.push({
        name: `lint-${linter.name}`,
        command: linter.command,
        severity: 'warning',
        timeout: 60000,
        parser: linter.name === 'eslint' ? 'eslint' : 'generic',
      });
    }
  }

  // Test gate (always blocking)
  if (detection.testRunner) {
    const parserName = detection.testRunner.name in PARSERS ? detection.testRunner.name : 'generic';
    gates.push({
      name: `test-${detection.testRunner.name}`,
      command: detection.testRunner.command,
      severity: 'blocking',
      timeout: 120000,
      parser: parserName,
    });
  }

  // Apply overrides
  for (const gate of gates) {
    if (overrides[gate.name]) {
      Object.assign(gate, overrides[gate.name]);
    }
  }

  return gates;
}

// ── CLI Entry Point ─────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--run')) {
  // Run gates from a config file or with presets
  const presets = args.filter(a => !a.startsWith('-'));
  const gates = presets.length > 0 ? presets : ['typescript', 'vitest'];

  console.log('Running quality gates...\n');
  const chain = new QualityGateChain(gates, { verbose: true });
  const results = await chain.run();
  console.log('\n' + QualityGateChain.formatResults(results));

  process.exit(results.blockingPassed ? 0 : 1);
}

if (args.includes('--list')) {
  console.log('Available gate presets:');
  for (const [name, gate] of Object.entries(PRESET_GATES)) {
    console.log(`  ${name.padEnd(20)} [${gate.severity}] ${gate.description}`);
  }
}

if (args.includes('--help') || args.length === 0) {
  console.log(`
Quality Gate Chain
==================
Usage:
  node orchestrator/quality-gates.mjs --run [presets...]
  node orchestrator/quality-gates.mjs --list
  node orchestrator/quality-gates.mjs --help

Examples:
  node orchestrator/quality-gates.mjs --run typescript vitest
  node orchestrator/quality-gates.mjs --run eslint typescript vitest build
  node orchestrator/quality-gates.mjs --list
`);
}
