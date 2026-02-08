#!/usr/bin/env node
// ============================================================
// Jousting MVP — Multi-Agent Orchestrator v2
// ============================================================
// Improvements over v1:
// - Prompts piped via stdin (no Windows command line limit)
// - Orchestrator owns task board (no agent race conditions)
// - Orchestrator owns git commits (no parallel commit races)
// - Per-agent timeout (configurable, default 20 min)
// - Circuit breaker (stop after N consecutive test failures)
// - Max runtime (default 6 hours)
// - Recurring agents for continuous balance/quality work
// - Structured handoff META parsing
// ============================================================

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ORCH_DIR = __dirname;
const MVP_DIR = resolve(ORCH_DIR, '..'); // jousting-mvp/ (orchestrator lives inside it)
const HANDOFF_DIR = join(ORCH_DIR, 'handoffs');
const LOG_DIR = join(ORCH_DIR, 'logs');
const ANALYSIS_DIR = join(ORCH_DIR, 'analysis');
const TASK_BOARD = join(ORCH_DIR, 'task-board.md');

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
  maxRounds: 12,
  agentTimeoutMs: 20 * 60 * 1000,     // 20 min per agent
  maxRuntimeMs: 6 * 60 * 60 * 1000,   // 6 hours total
  circuitBreakerThreshold: 3,           // stop after 3 consecutive test failures
  testTimeoutMs: 3 * 60 * 1000,        // 3 min for test suite
  allowedTools: 'Edit,Read,Write,Glob,Grep,Bash',
};

// ============================================================
// Agent Definitions
// ============================================================
const AGENTS = [
  {
    id: 'ui-polish',
    name: 'UI Polish Agent',
    type: 'feature',          // finite — completes and stops
    dependsOn: [],
    handoff: join(HANDOFF_DIR, 'ui-polish.md'),
  },
  {
    id: 'ai-engine',
    name: 'AI Engine Agent',
    type: 'feature',
    dependsOn: [],
    handoff: join(HANDOFF_DIR, 'ai-engine.md'),
  },
  {
    id: 'ai-reasoning',
    name: 'AI Reasoning Agent',
    type: 'feature',
    dependsOn: ['ai-engine'],
    handoff: join(HANDOFF_DIR, 'ai-reasoning.md'),
  },
  {
    id: 'balance-sim',
    name: 'Balance & Simulation Agent',
    type: 'continuous',       // runs every round, never "complete"
    dependsOn: ['ai-engine'], // needs stable AI before tuning balance
    handoff: join(HANDOFF_DIR, 'balance-sim.md'),
  },
  {
    id: 'quality-review',
    name: 'Quality & Format Review Agent',
    type: 'continuous',
    dependsOn: [],
    handoff: join(HANDOFF_DIR, 'quality-review.md'),
  },
];

// ============================================================
// Utilities
// ============================================================
function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(msg) {
  const line = `[${timestamp()}] ${msg}`;
  console.log(line);
  appendFileSync(join(LOG_DIR, 'orchestrator.log'), line + '\n');
}

function ensureDirs() {
  for (const dir of [HANDOFF_DIR, LOG_DIR, ANALYSIS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================
// Handoff META Parsing
// ============================================================
// Agents write structured META at the top of their handoff:
//   ## META
//   - status: complete | in-progress | blocked
//   - files-modified: file1.ts, file2.ts
//   - tests-passing: true | false
//   - notes-for-others: free text
//
function parseHandoffMeta(agentId) {
  const path = join(HANDOFF_DIR, `${agentId}.md`);
  if (!existsSync(path)) return { status: 'not-started', filesModified: [], testsPassing: null, notes: '' };

  const content = readFileSync(path, 'utf-8');
  const meta = { status: 'not-started', filesModified: [], testsPassing: null, notes: '' };

  const statusMatch = content.match(/^-\s*status:\s*(.+)$/m);
  if (statusMatch) meta.status = statusMatch[1].trim();

  const filesMatch = content.match(/^-\s*files-modified:\s*(.+)$/m);
  if (filesMatch) meta.filesModified = filesMatch[1].split(',').map(f => f.trim()).filter(Boolean);

  const testsMatch = content.match(/^-\s*tests-passing:\s*(.+)$/m);
  if (testsMatch) meta.testsPassing = testsMatch[1].trim() === 'true';

  const notesMatch = content.match(/^-\s*notes-for-others:\s*(.+)$/m);
  if (notesMatch) meta.notes = notesMatch[1].trim();

  return meta;
}

// ============================================================
// Task Board Generation (orchestrator-owned, agents only READ)
// ============================================================
function generateTaskBoard(round, testStatus, consecutiveFailures) {
  const agentStatuses = AGENTS.map(agent => {
    const meta = parseHandoffMeta(agent.id);
    const depsMet = agent.dependsOn.every(depId => {
      const depMeta = parseHandoffMeta(depId);
      return depMeta.status === 'complete';
    });
    const effectiveStatus = meta.status === 'complete' ? 'complete'
      : !depsMet ? `blocked (waiting for ${agent.dependsOn.join(', ')})`
      : meta.status;

    return { ...agent, meta, effectiveStatus, depsMet };
  });

  const allFilesModified = agentStatuses.flatMap(a =>
    a.meta.filesModified.map(f => `${f} (${a.id})`)
  );

  let board = `# Jousting MVP — Shared Task Board
> Generated by orchestrator. Round ${round}. Agents: READ ONLY (do not edit this file).
> Last updated: ${timestamp()}

## System Status
- **Round**: ${round} of ${CONFIG.maxRounds}
- **Tests**: ${testStatus ?? 'not yet run'}
- **Consecutive test failures**: ${consecutiveFailures}
${consecutiveFailures >= 2 ? '- **WARNING**: Tests have been failing. Focus on fixing test failures before new features!' : ''}

## Agent Status
| Agent | Type | Status | Dependencies |
|-------|------|--------|-------------|
${agentStatuses.map(a =>
  `| ${a.id} | ${a.type} | ${a.effectiveStatus} | ${a.dependsOn.length ? a.dependsOn.join(', ') : 'none'} |`
).join('\n')}

## Files Modified This Session
${allFilesModified.length ? allFilesModified.map(f => `- ${f}`).join('\n') : '(none yet)'}

## Messages Between Agents
${agentStatuses.filter(a => a.meta.notes).map(a => `- **${a.id}**: ${a.meta.notes}`).join('\n') || '(none)'}

## Coordination Rules
1. Only edit files assigned to you (see your handoff for file ownership)
2. If you need to edit App.tsx (shared), note the change in your handoff under "Deferred App.tsx Changes" — the orchestrator will coordinate
3. Do NOT run git commands — the orchestrator handles all commits
4. Do NOT edit this task board — it is auto-generated
5. Run \`npx vitest run\` before writing your final handoff to confirm tests pass
6. Write your updated handoff with the ## META section at the top

## Reference Files
- Full project architecture: jousting-handoff-s17.md (in project root)
- Balance config: src/engine/balance-config.ts
- All types: src/engine/types.ts
- AI logic: src/ai/basic-ai.ts
`;

  writeFileSync(TASK_BOARD, board);
  return board;
}

// ============================================================
// Run a Single Agent
// ============================================================
function runAgent(agent, round) {
  return new Promise((resolvePromise) => {
    const logFile = join(LOG_DIR, `${agent.id}-round-${round}.log`);

    // Short prompt — details are in the handoff files (agent reads them)
    const prompt = [
      `You are "${agent.name}", part of a multi-agent team on the Jousting MVP project.`,
      `This is round ${round}.`,
      ``,
      `FIRST — Read these files in order:`,
      `1. orchestrator/task-board.md (coordination status — DO NOT edit this file)`,
      `2. orchestrator/handoffs/${agent.id}.md (your task details and previous progress)`,
      `3. jousting-handoff-s17.md (full project architecture reference — skim if first round)`,
      ``,
      `Then follow the instructions in your handoff file.`,
      ``,
      `WHEN DONE — Write your updated handoff to orchestrator/handoffs/${agent.id}.md with this format at the top:`,
      ``,
      `## META`,
      `- status: complete | in-progress`,
      `- files-modified: comma-separated list of files you changed`,
      `- tests-passing: true | false`,
      `- notes-for-others: any messages for other agents`,
      ``,
      `Then include sections: ## What Was Done, ## What's Left, ## Issues`,
      ``,
      `RULES:`,
      `- Do NOT run any git commands (orchestrator handles commits)`,
      `- Do NOT edit orchestrator/task-board.md (it's auto-generated)`,
      `- Do NOT edit files owned by other agents (check task board)`,
      `- Do NOT delete test files or remove existing features`,
      `- Run tests (npx vitest run) before writing your final handoff`,
      `- For App.tsx changes: note them in your handoff under "Deferred App.tsx Changes"`,
      `- Keep changes incremental and focused`,
      agent.type === 'continuous'
        ? `- You are a CONTINUOUS agent — write analysis to orchestrator/analysis/${agent.id}-round-${round}.md`
        : `- You are a FEATURE agent — mark status as "complete" when your task is fully done`,
    ].join('\n');

    log(`  Starting ${agent.id}...`);
    const startTime = Date.now();

    // Spawn claude with prompt piped via stdin (avoids Windows cmd length limit)
    const proc = spawn('claude', [
      '-p',
      '--allowedTools', CONFIG.allowedTools,
      '--output-format', 'text',
    ], {
      cwd: MVP_DIR,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Timeout handler
    const timer = setTimeout(() => {
      timedOut = true;
      log(`  ${agent.id} TIMED OUT after ${CONFIG.agentTimeoutMs / 60000} minutes — killing`);
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000); // force kill after 5s
    }, CONFIG.agentTimeoutMs);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      appendFileSync(logFile, text);
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      appendFileSync(logFile, `[STDERR] ${text}`);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const elapsedMin = (elapsed / 60).toFixed(1);
      const status = timedOut ? 'TIMEOUT' : code === 0 ? 'OK' : `EXIT-${code}`;
      log(`  ${agent.id} finished: ${status} (${elapsedMin} min)`);
      resolvePromise({ agentId: agent.id, code, timedOut, elapsed, stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      log(`  ${agent.id} SPAWN ERROR: ${err.message}`);
      resolvePromise({ agentId: agent.id, code: -1, timedOut: false, elapsed: 0, stdout: '', stderr: err.message });
    });

    // Pipe prompt via stdin (bypasses Windows command line length limit)
    proc.stdin.write(prompt, 'utf-8');
    proc.stdin.end();
  });
}

// ============================================================
// Git Backup (orchestrator-only — agents never commit)
// ============================================================
function gitBackup(round) {
  return new Promise((resolvePromise) => {
    const msg = `orchestrator: round ${round} auto-backup [${timestamp()}]`;
    const cmd = `git add -A && git diff --cached --quiet || git commit -m "${msg}"`;

    const proc = spawn('cmd', ['/c', cmd], {
      cwd: MVP_DIR,
      shell: true,
      stdio: 'pipe',
    });

    let output = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        log(`Git backup committed (round ${round})`);
      } else {
        log(`Git backup: nothing new to commit (round ${round})`);
      }
      resolvePromise();
    });
  });
}

// ============================================================
// Run Tests
// ============================================================
function runTests() {
  return new Promise((resolvePromise) => {
    log('Running test suite...');
    const proc = spawn('npx', ['vitest', 'run'], {
      cwd: MVP_DIR,
      shell: true,
      stdio: 'pipe',
    });

    let output = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      log('Test suite TIMED OUT');
      resolvePromise({ passed: false, count: '?', output: 'TIMEOUT' });
    }, CONFIG.testTimeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const passMatch = output.match(/(\d+)\s+passed/);
      const failMatch = output.match(/(\d+)\s+failed/);
      const passCount = passMatch ? passMatch[1] : '?';
      const failCount = failMatch ? failMatch[1] : '0';
      const passed = code === 0;
      log(`Tests: ${passed ? 'PASSED' : 'FAILED'} — ${passCount} passed, ${failCount} failed`);
      appendFileSync(join(LOG_DIR, 'test-results.log'),
        `[${timestamp()}] ${passed ? 'PASS' : 'FAIL'} — ${passCount} passed, ${failCount} failed\n`);
      resolvePromise({ passed, count: passCount, failCount, output });
    });
  });
}

// ============================================================
// Main Orchestration Loop
// ============================================================
async function main() {
  ensureDirs();
  const globalStart = Date.now();

  log('');
  log('='.repeat(60));
  log('  JOUSTING MVP — MULTI-AGENT ORCHESTRATOR v2');
  log('='.repeat(60));
  log(`Agents: ${AGENTS.map(a => `${a.id} (${a.type})`).join(', ')}`);
  log(`Config: ${CONFIG.maxRounds} max rounds, ${CONFIG.agentTimeoutMs / 60000}min/agent, ${CONFIG.maxRuntimeMs / 3600000}hr max runtime`);
  log(`Circuit breaker: stop after ${CONFIG.circuitBreakerThreshold} consecutive test failures`);
  log('');

  let consecutiveTestFailures = 0;
  let lastTestStatus = null;

  for (let round = 1; round <= CONFIG.maxRounds; round++) {
    // --- Check max runtime ---
    const elapsed = Date.now() - globalStart;
    if (elapsed >= CONFIG.maxRuntimeMs) {
      log(`\nMAX RUNTIME REACHED (${CONFIG.maxRuntimeMs / 3600000} hours). Stopping.`);
      break;
    }
    const remainingHrs = ((CONFIG.maxRuntimeMs - elapsed) / 3600000).toFixed(1);

    log(`\n${'━'.repeat(50)}`);
    log(`  ROUND ${round} of ${CONFIG.maxRounds}  (${remainingHrs}hr remaining)`);
    log(`${'━'.repeat(50)}`);

    // --- Generate task board (orchestrator-owned) ---
    generateTaskBoard(round, lastTestStatus, consecutiveTestFailures);

    // --- Determine which agents run this round ---
    const activeAgents = AGENTS.filter(agent => {
      const meta = parseHandoffMeta(agent.id);

      // Feature agents: skip if complete
      if (agent.type === 'feature' && meta.status === 'complete') {
        log(`  ${agent.id}: COMPLETE (skipping)`);
        return false;
      }

      // Check dependencies
      const depsMet = agent.dependsOn.every(depId => {
        const depMeta = parseHandoffMeta(depId);
        return depMeta.status === 'complete';
      });
      if (!depsMet) {
        log(`  ${agent.id}: BLOCKED (needs ${agent.dependsOn.join(', ')})`);
        return false;
      }

      log(`  ${agent.id}: ACTIVE (${agent.type})`);
      return true;
    });

    if (activeAgents.length === 0) {
      // Check if any feature agents are left
      const pendingFeatures = AGENTS.filter(a =>
        a.type === 'feature' && parseHandoffMeta(a.id).status !== 'complete'
      );
      if (pendingFeatures.length === 0 && !AGENTS.some(a => a.type === 'continuous')) {
        log('\nAll feature agents complete, no continuous agents. Done!');
        break;
      }
      log('\nNo agents can run this round (all blocked or complete). Waiting...');
      continue;
    }

    // --- Launch agents in parallel ---
    log(`\nLaunching ${activeAgents.length} agent(s)...`);
    const results = await Promise.all(activeAgents.map(a => runAgent(a, round)));

    // --- Round summary ---
    log('\nRound results:');
    for (const r of results) {
      const status = r.timedOut ? 'TIMEOUT' : r.code === 0 ? 'OK' : `ERROR(${r.code})`;
      log(`  ${r.agentId}: ${status} in ${(r.elapsed / 60).toFixed(1)}min`);
    }

    // --- Run tests ---
    const testResult = await runTests();
    if (testResult.passed) {
      consecutiveTestFailures = 0;
      lastTestStatus = `PASSING (${testResult.count} tests)`;
    } else {
      consecutiveTestFailures++;
      lastTestStatus = `FAILING (${testResult.count} passed, ${testResult.failCount} failed)`;
      log(`\n⚠ Tests failing! Consecutive failures: ${consecutiveTestFailures}/${CONFIG.circuitBreakerThreshold}`);
    }

    // --- Circuit breaker ---
    if (consecutiveTestFailures >= CONFIG.circuitBreakerThreshold) {
      log(`\n🛑 CIRCUIT BREAKER: Tests failed ${consecutiveTestFailures} rounds in a row. STOPPING.`);
      log(`Check logs at: ${LOG_DIR}`);
      log(`Last test output saved in test-results.log`);
      break;
    }

    // --- Git backup ---
    await gitBackup(round);

    // --- Check all features complete ---
    const allFeaturesComplete = AGENTS
      .filter(a => a.type === 'feature')
      .every(a => parseHandoffMeta(a.id).status === 'complete');

    if (allFeaturesComplete) {
      log('\nAll feature agents complete!');
      // If no continuous agents remain, stop
      const hasContinuous = AGENTS.some(a => a.type === 'continuous');
      if (!hasContinuous) {
        log('No continuous agents. Orchestration finished.');
        break;
      }
      log('Continuous agents will keep iterating...');
    }
  }

  // ============================================================
  // Final Summary
  // ============================================================
  log('\n' + '='.repeat(60));
  log('  ORCHESTRATION COMPLETE');
  log('='.repeat(60));

  for (const agent of AGENTS) {
    const meta = parseHandoffMeta(agent.id);
    log(`  ${agent.id} (${agent.type}): ${meta.status}`);
    if (meta.filesModified.length) log(`    files: ${meta.filesModified.join(', ')}`);
    if (meta.notes) log(`    notes: ${meta.notes}`);
  }

  const finalTests = await runTests();
  log(`\nFinal tests: ${finalTests.passed ? 'ALL PASSING' : 'SOME FAILING'} (${finalTests.count} passed)`);

  await gitBackup('final');

  const totalMin = ((Date.now() - globalStart) / 60000).toFixed(1);
  log(`\nTotal runtime: ${totalMin} minutes`);
  log(`Logs: ${LOG_DIR}`);
  log(`Analysis: ${ANALYSIS_DIR}`);
  log(`Task board: ${TASK_BOARD}`);
}

main().catch(err => {
  log(`FATAL ERROR: ${err.message}\n${err.stack}`);
  process.exit(1);
});
