#!/usr/bin/env node
// ============================================================
// Multi-Agent Orchestrator v25 (modular)
// ============================================================
// See docs/orchestrator.md for architecture.
// Extracted modules (S63): balance-analyzer, git-ops, reporter
// Extracted modules (S65): backlog-system, cost-tracker, test-filter, handoff-parser, spawn-system
// Extracted modules (S66): agent-tracking, mission-sequencer, progress-dashboard, agent-pool
// Extracted modules (S67): agent-runner, task-board, hot-reload (into mission-sequencer)


import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runConsistencyCheck } from './consistency-check.mjs';
import { RoleRegistry } from './role-registry.mjs';
import { QualityGateChain, createGateChainFromDetection } from './quality-gates.mjs';
import { detectProject, generateProjectConfig } from './project-detect.mjs';
import { executeWorkflow } from './workflow-engine.mjs';
// v22: Ecosystem modules
import { isSDKAvailable, getRunAgent, SDK_MODE, runAgentViaSDK, createAgentOptions, extractCostFromMessages } from './sdk-adapter.mjs';
import { createObservability } from './observability.mjs';
import { DAGScheduler, createDAGFromWorkflow, createDAGFromConfig } from './dag-scheduler.mjs';
import { PluginManager } from './plugin-system.mjs';
// Extracted modules (S63)
import { initBalanceAnalyzer, getParamSearchResults, setParamSearchResults, runBalanceSim, runBalanceSims, loadBalanceState, saveBalanceState, updateBalanceState, loadExperimentLog, saveExperimentLog, parseBalanceConfigDiff, logExperiment, buildExperimentContext, detectBalanceRegressions, checkConvergence, buildBalanceContext, generateBalanceBacklog, getNextBacklogId, runParameterSearch, buildParamSearchContext } from './balance-analyzer.mjs';
import { initGitOps, gitBackup, tagRoundStart, gitRevertToTag, gitRevertFiles, smartRevert, invalidateRevertedSessions, gitExec, createWorktree, mergeWorktreeBranch, removeWorktree, cleanupAllWorktrees, getHeadSha, smartRevertWorktrees, verifyAgentOutput } from './git-ops.mjs';
import { initReporter, generateOvernightReport } from './reporter.mjs';
// Extracted modules (S65)
import { initBacklogSystem, loadBacklog, saveBacklog, getNextTask, getNextTasks, taskMatchesAgent, completeBacklogTask, getNextSubtask, completeSubtask, getAgentTaskPriority, agentHasCriticalTask, resetStaleAssignments, archiveCompletedTasks } from './backlog-system.mjs';
import { MODEL_PRICING, parseCostFromStderr, estimateCostFromTokens, ensureCostLogEntry, accumulateAgentCost } from './cost-tracker.mjs';
import { initTestFilter, setProjectConfig as setTestFilterProjectConfig, getTestFilter, getTestFilterFlag, getSourceToTests, getAiSourcePattern, getAiTestFile, getFullSuiteTriggers } from './test-filter.mjs';
import { initHandoffParser, parseHandoffMeta, validateFileOwnership, validateAgentOutput } from './handoff-parser.mjs';
import { initSpawnSystem, SPAWN_CONSTRAINTS, detectSpawnRequests, validateSpawnRequest, archiveSpawnRequest, detectAndSpawnAgents, getSpawnNotifications } from './spawn-system.mjs';
// Extracted modules (S66)
import { initAgentTracking, agentRuntimeHistory, agentEffectiveness, agentSessions, recordAgentRuntime, getAdaptiveTimeout, recordAgentEffectiveness, getDynamicConcurrency, readHandoffContent, getChangelogSinceRound, invalidateAgentSession, invalidateStaleSessions } from './agent-tracking.mjs';
import { initMissionSequencer, missionState, loadMissionOrSequence, tryTransitionMission, hotReloadMissionConfig } from './mission-sequencer.mjs';
import { ProgressDashboard } from './progress-dashboard.mjs';
import { initAgentPool, runAgentPool } from './agent-pool.mjs';
import { initLessons, loadLessons, recordLesson, queryLessons, formatLessonsForPrompt } from './lessons.mjs';
import { initCheckpoint, loadCheckpoint, writeCheckpoint, clearCheckpoint, validateCheckpoint, collectCheckpointState, restoreCheckpointState } from './checkpoint.mjs';
// Extracted modules (S67)
import { initAgentRunner, runAgent, processAgentResult, loadCommonRules, sanitizeEnv } from './agent-runner.mjs';
import { initTaskBoard, generateTaskBoard, isDepSatisfied } from './task-board.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ORCH_DIR = __dirname;
const MVP_DIR = resolve(ORCH_DIR, '..'); // jousting-mvp/ (orchestrator lives inside it)
const HANDOFF_DIR = join(ORCH_DIR, 'handoffs');
const LOG_DIR = join(ORCH_DIR, 'logs');
const ANALYSIS_DIR = join(ORCH_DIR, 'analysis');
const ROLES_DIR = join(ORCH_DIR, 'roles');
const BALANCE_DATA_DIR = join(ORCH_DIR, 'balance-data');
const TASK_BOARD = join(ORCH_DIR, 'task-board.md');

// v20: Module-scope quality gate chain (populated in main(), used by runTests())
let qualityGateChain = null;

// v22: Module-scope observability (logger, metrics, events) — populated in main()
let obs = null; // { logger, metrics, events }

// v22: Module-scope plugin manager — populated in main()
let pluginManager = null;

// v21: Git worktree isolation — each code agent gets its own worktree/branch
const WORKTREE_DIR = join(ORCH_DIR, '.worktrees');
const agentWorktrees = {}; // agentId → { path, branch, round }

// v21: Dynamic agent spawning — managed by spawn-system.mjs (SPAWNS_DIR, SPAWN_CONSTRAINTS)
const SPAWNS_DIR = join(ORCH_DIR, 'spawns');

// ============================================================
// Active Process Tracking & Graceful Shutdown (Windows)
// ============================================================
const activeProcs = new Set();

function killProcessTree(pid) {
  // Windows: taskkill /T kills the entire process tree (cmd.exe + child claude.exe)
  // Without /T, only the shell dies and claude.exe becomes an orphan
  try {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
  } catch (_) { /* best-effort */ }
}

process.on('SIGINT', () => {
  console.log(`\n[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] SIGINT received — killing all agents...`);
  for (const pid of activeProcs) {
    killProcessTree(pid);
  }
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log(`\n[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] SIGTERM received — killing all agents...`);
  for (const pid of activeProcs) {
    killProcessTree(pid);
  }
  process.exit(1);
});

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
  maxRounds: 30,
  agentTimeoutMs: 20 * 60 * 1000,     // 20 min per agent
  maxRuntimeMs: 10 * 60 * 60 * 1000,  // 10 hours total (overnight)
  circuitBreakerThreshold: 3,           // stop after 3 consecutive test failures
  testTimeoutMs: 3 * 60 * 1000,        // 3 min for test suite
  allowedTools: 'Edit,Read,Write,Glob,Grep,Bash',
  maxConcurrency: 0,                     // 0 = unlimited; >0 = max parallel agents per phase
  reportFile: join(ORCH_DIR, 'overnight-report.md'),
  // v21: Git worktree isolation — each code agent runs in its own worktree/branch.
  // Prevents cross-agent file conflicts during parallel execution.
  // Set to false to disable (agents edit main working tree directly, legacy behavior).
  useWorktrees: true,
  // v22: SDK adapter — use Agent SDK for programmatic agent execution when available.
  // When true and SDK is installed, agents run via SDK instead of CLI spawn.
  useSDK: false,
  // v22: Observability — structured logging, metrics, event bus.
  enableObservability: true,
  // v22: Plugin system — discover and load plugins from orchestrator/plugins/.
  enablePlugins: true,
  // v22: DAG scheduler — allow mission configs to define arbitrary dependency DAGs.
  enableDAG: true,
  // Balance sim config (enabled via mission balanceConfig or set here)
  // When null, no automated sims are run. Set to an object to enable.
  balanceConfig: null,
  // balanceConfig example:
  // {
  //   sims: [
  //     { tier: 'bare', variant: 'balanced' },
  //     { tier: 'epic', variant: 'balanced' },
  //     { tier: 'giga', variant: 'balanced' },
  //   ],
  //   matchesPerMatchup: 200,    // default 200
  //   simTimeoutMs: 60000,       // default 60s
  //   runPreSim: true,           // sim before code agents (baseline)
  //   runPostSim: true,          // sim after code agents (validate)
  //   regressionThresholdPp: 3,  // flag archetype if win rate shifts > this (default 3pp)
  //   convergenceCriteria: {     // auto-stop when all criteria met (null = disabled)
  //     maxSpreadPp: { bare: 15, epic: 5, giga: 7, '*': 10 },  // per-tier or '*' default
  //     maxFlags: 0,             // max total balance flags
  //     requiredTiers: ['epic', 'giga'],  // tiers that must pass (default: all sim tiers)
  //     minRounds: 3,            // minimum rounds before convergence can trigger
  //   },
  // }
};

// v8 bugfix: Snapshot CONFIG defaults for mission-sequencer module
const CONFIG_DEFAULTS = { ...CONFIG };

// ============================================================
// Project Config (v20 — auto-detect or load from file)
// ============================================================
let projectConfig = null;

function loadProjectConfig(projectDir) {
  const configPath = join(projectDir, 'orchestrator', 'project-config.json');

  // Try loading existing config
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      projectConfig = JSON.parse(raw);
      setTestFilterProjectConfig(projectConfig);
      log(`Project config loaded from: ${configPath}`);
      return projectConfig;
    } catch (err) {
      log(`WARNING: Failed to parse project-config.json: ${err.message}`);
    }
  }

  // Fall back to auto-detection
  log('No project-config.json found — auto-detecting...');
  return null;  // Will be populated from detection in main()
}

function getTestCommand() {
  return projectConfig?.testing?.command || 'npx vitest run';
}

// ============================================================
// Model Tier Ordering (for escalation/de-escalation)
// ============================================================
const MODEL_TIER = { haiku: 0, sonnet: 1, opus: 2 };

// Backlog System — managed by backlog-system.mjs

// ============================================================
// Agent Definitions (default — overridden by mission config)
// ============================================================
let AGENTS = [
  {
    id: 'engine-refactor',
    name: 'Engine Refactor Agent',
    type: 'feature',          // finite — completes and stops
    dependsOn: [],
    role: 'engine-dev',
    handoff: join(HANDOFF_DIR, 'engine-refactor.md'),
  },
  {
    id: 'gear-system',
    name: 'Gear System Agent',
    type: 'feature',
    dependsOn: ['engine-refactor'],
    role: 'engine-dev',
    handoff: join(HANDOFF_DIR, 'gear-system.md'),
  },
  {
    id: 'ui-loadout',
    name: 'UI & Loadout Agent',
    type: 'feature',
    dependsOn: ['gear-system'],
    role: 'ui-dev',
    handoff: join(HANDOFF_DIR, 'ui-loadout.md'),
  },
  {
    id: 'quality-review',
    name: 'Quality & Review Agent',
    type: 'continuous',       // runs every round
    dependsOn: [],
    role: 'test-writer',
    handoff: join(HANDOFF_DIR, 'quality-review.md'),
  },
];

// ============================================================
// Mission Config Loading
// ============================================================
// Load agents + config from a JSON mission file.
// Usage: node orchestrator.mjs missions/breaker-mechanic.json
//
// Mission format:
// {
//   "name": "Mission Name",
//   "config": { "maxRounds": 10 },  // overrides CONFIG
//   "designDoc": "some-file.md",     // optional reference doc
//   "agents": [{ "id", "name", "type", "dependsOn", "role", "fileOwnership", "tasks": { "primary", "stretch" } }]
// }
//
function loadMission(missionPath) {
  const absPath = resolve(missionPath);
  if (!existsSync(absPath)) {
    console.error(`Mission file not found: ${absPath}`);
    process.exit(1);
  }

  const mission = JSON.parse(readFileSync(absPath, 'utf-8'));
  log(`Loading mission: ${mission.name}`);
  if (mission.description) log(`  ${mission.description}`);

  // Apply config overrides
  if (mission.config) {
    Object.assign(CONFIG, mission.config);
    log(`  Config overrides: ${JSON.stringify(mission.config)}`);
  }

  // Convert mission agents to orchestrator format (v5: include model, timeout, task batching, frequency)
  const agents = mission.agents.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type || 'feature',
    dependsOn: a.dependsOn || [],
    role: a.role || null,
    handoff: join(HANDOFF_DIR, `${a.id}.md`),
    fileOwnership: a.fileOwnership || [],
    model: a.model || null,                        // v5: per-agent model (sonnet, haiku, etc.)
    maxModel: a.maxModel || null,                  // v6: max model tier for escalation (haiku/sonnet/opus)
    timeoutMs: a.timeoutMs || null,                // v5: per-agent timeout override
    maxTasksPerRound: a.maxTasksPerRound ?? 1,     // v6: batch task injection (0 = no backlog tasks)
    minFrequencyRounds: a.minFrequencyRounds || 0, // v5: periodic run frequency (0 = work-gated only)
    maxBudgetUsd: a.maxBudgetUsd || null,          // v6: per-agent cost cap
  }));

  // v20: Dynamic file ownership from project config
  for (let i = 0; i < mission.agents.length; i++) {
    const agentDef = mission.agents[i];
    const agent = agents[i];
    if (agentDef.fileOwnership === 'auto' && projectConfig?.ownershipPatterns) {
      const rolePatterns = projectConfig.ownershipPatterns[agentDef.role];
      if (rolePatterns) {
        agent.fileOwnership = rolePatterns;
        log(`  ${agent.id}: auto file ownership from project config (${rolePatterns.length} patterns)`);
      } else {
        agent.fileOwnership = [];
        log(`  ${agent.id}: no auto ownership patterns for role "${agentDef.role}"`);
      }
    }
  }

  // Generate initial handoff files for agents that don't have one yet
  for (const agent of mission.agents) {
    const handoffPath = join(HANDOFF_DIR, `${agent.id}.md`);
    if (!existsSync(handoffPath)) {
      const lines = [
        `# ${agent.name} — Handoff`,
        '',
        '## META',
        '- status: not-started',
        '- files-modified: (none yet)',
        '- tests-passing: true',
        '- notes-for-others: (none)',
        '',
        '## Your Mission',
        '',
        agent.tasks?.primary || 'See mission config for task details.',
        '',
        '## File Ownership',
        '',
        ...(agent.fileOwnership || []).map(f => `- \`${f}\``),
        '',
      ];

      if (agent.tasks?.stretch?.length) {
        lines.push('## Stretch Goals', '');
        agent.tasks.stretch.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
        lines.push('');
      }

      lines.push(
        '## IMPORTANT Rules',
        '- Only edit files in your File Ownership list',
        '- Do NOT run git commands (orchestrator handles commits)',
        '- Do NOT edit orchestrator/task-board.md (auto-generated)',
        `- Run tests (\`${getTestCommand()}\`) before writing your final handoff`,
        '- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"',
        '',
      );

      writeFileSync(handoffPath, lines.join('\n'));
      log(`  Generated initial handoff: handoffs/${agent.id}.md`);
    } else {
      log(`  Handoff exists: handoffs/${agent.id}.md`);
    }
  }

  // Load balance config if present in mission
  if (mission.balanceConfig) {
    CONFIG.balanceConfig = mission.balanceConfig;
    log(`  Balance config: ${mission.balanceConfig.sims?.length || 0} sim configs, pre=${mission.balanceConfig.runPreSim ?? true}, post=${mission.balanceConfig.runPostSim ?? true}`);
  }

  // v19: Load quality gates config if present in mission
  if (mission.qualityGates) {
    CONFIG.qualityGates = mission.qualityGates;
    log(`  Quality gates: ${mission.qualityGates.length} gates configured`);
  }

  return { agents, missionName: mission.name, designDoc: mission.designDoc || null };
}

// Role Template Loading — managed by agent-runner.mjs

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
  for (const dir of [HANDOFF_DIR, LOG_DIR, ANALYSIS_DIR, BALANCE_DATA_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}

// Handoff META Parsing & Validation — managed by handoff-parser.mjs

// ============================================================
// Session Changelog (auto-generated each round)
// ============================================================
const CHANGELOG_FILE = join(ORCH_DIR, 'session-changelog.md');

function resetSessionChangelog() {
  writeFileSync(CHANGELOG_FILE, '# Session Changelog (auto-generated)\n\n');
}

function appendSessionChangelog(round, agentResults) {
  const entries = [];
  for (const result of agentResults) {
    const meta = parseHandoffMeta(result.agentId);
    const status = result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'OK' : `ERROR(${result.code})`;
    const files = meta.filesModified.length ? meta.filesModified.join(', ') : 'none';
    const tests = meta.testsPassing === true ? 'PASS' : meta.testsPassing === false ? 'FAIL' : '?';
    entries.push(`- **${result.agentId}** (${status}): files=[${files}], tests=${tests}${meta.notes ? `. ${meta.notes}` : ''}`);
  }
  if (entries.length) {
    const section = `## Round ${round} [${timestamp()}]\n${entries.join('\n')}\n\n`;
    appendFileSync(CHANGELOG_FILE, section);
  }
}

// Task Board Generation — managed by task-board.mjs

// Run Agent + Dynamic Agent Spawning — managed by agent-runner.mjs + spawn-system.mjs

// ============================================================
// Analysis File Rotation (v5 Phase 5F)
// ============================================================
function rotateAnalysisFiles(keepRounds = 5) {
  if (!existsSync(ANALYSIS_DIR)) return;

  const archiveDir = join(ANALYSIS_DIR, 'archive');
  mkdirSync(archiveDir, { recursive: true });

  const files = [];
  for (const f of readdirSync(ANALYSIS_DIR)) {
    const match = f.match(/-round-(\d+)\./);
    if (match) {
      files.push({ name: f, round: parseInt(match[1]) });
    }
  }

  if (!files.length) return;

  const maxRound = Math.max(...files.map(f => f.round));
  const threshold = maxRound - keepRounds;
  let archived = 0;

  for (const f of files) {
    if (f.round <= threshold) {
      try {
        renameSync(join(ANALYSIS_DIR, f.name), join(archiveDir, f.name));
        archived++;
      } catch (err) {
        log(`  WARNING: Failed to archive ${f.name}: ${err.message}`);
      }
    }
  }

  if (archived > 0) {
    log(`Analysis rotation: archived ${archived} old report(s) (keeping last ${keepRounds} rounds)`);
  }
}


// Cost Tracking — managed by cost-tracker.mjs

// Agent Tracking — managed by agent-tracking.mjs
// Progress Dashboard — managed by progress-dashboard.mjs
// Agent Pool — managed by agent-pool.mjs

// Process Agent Result — managed by agent-runner.mjs

// Incremental Testing — managed by test-filter.mjs

// ============================================================
// Run Tests (v20: quality gate chain with legacy fallback)
// ============================================================
// testFilter: null → full suite, '' → skip, string → filtered
async function runTests(testFilter = null) {
  // v10: Skip tests if no source files were modified
  if (testFilter === '') {
    log('Running test suite... SKIPPED (no source files modified)');
    return { passed: true, count: 'skipped', failCount: '0', output: 'skipped — no source changes', skipped: true };
  }

  const isIncremental = testFilter !== null;
  if (isIncremental) {
    log(`Running tests (incremental: ${testFilter.split('|').length} suite(s))...`);
  } else {
    log('Running test suite (full)...');
  }

  // v20: Use quality gate chain if available
  if (qualityGateChain) {
    try {
      const filterArg = isIncremental ? `${getTestFilterFlag()} ${testFilter}` : null;
      const results = await qualityGateChain.runTests(filterArg);

      // Extract test metrics from results
      const testResult = results.passed[0] || results.blocking[0];
      const passed = results.blockingPassed;
      const count = testResult?.metrics?.testCount?.toString() || '?';
      const failCount = testResult?.metrics?.failCount?.toString() || '0';
      const details = testResult?.details || '';

      log(`Tests: ${passed ? 'PASSED' : 'FAILED'} — ${count} passed, ${failCount} failed`);
      appendFileSync(join(LOG_DIR, 'test-results.log'),
        `[${timestamp()}] ${passed ? 'PASS' : 'FAIL'} — ${count} passed, ${failCount} failed\n`);

      return { passed, count, failCount, output: details };
    } catch (err) {
      log(`Quality gate chain error: ${err.message} — falling back to direct test run`);
    }
  }

  // Legacy fallback: direct vitest spawn
  return new Promise((resolvePromise) => {
    const testCommand = getTestCommand();
    const parts = testCommand.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    if (isIncremental) args.push(getTestFilterFlag(), testFilter);

    const proc = spawn(cmd, args, {
      cwd: MVP_DIR,
      shell: true,
      stdio: 'pipe',
      env: sanitizeEnv(),
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
      // v6.1: Match "Tests  N passed" (individual tests), not "Test Files  N passed" (file count)
      const testLineMatch = output.match(/Tests\s+(\d+)\s+passed/);
      const passMatch = testLineMatch || output.match(/(\d+)\s+passed/);
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

// Mission Sequence — managed by mission-sequencer.mjs

/**
 * Handle mission transition: delegates to mission-sequencer, applies result to orchestrator state.
 * @param {string} reason - Why the current mission ended
 * @returns {boolean} True if transitioned to a new mission
 */
function handleMissionTransition(reason) {
  const result = tryTransitionMission(reason);
  if (!result.transitioned) return false;
  const mission = result.mission;
  AGENTS = mission.agents.map(a => ({
    ...a,
    handoff: a.handoff || join(HANDOFF_DIR, `${a.id}.md`),
  }));
  missionDesignDoc = mission.designDoc;
  missionWorkflow = mission.workflow || null;
  if (CONFIG.enableDAG && mission.dag) {
    try { missionDAG = createDAGFromConfig(mission); }
    catch (_) { missionDAG = null; }
  } else {
    missionDAG = null;
  }
  missionConfigPath = missionState.configPath;
  return true;
}

// ============================================================
// Main Orchestration Loop
// ============================================================
// Module-level variables set by loadMission, used by runAgent and report generation
let missionDesignDoc = null;
let missionConfigPath = null;
let missionWorkflow = null;  // v21: Composable workflow definition from mission config
let missionDAG = null;       // v22: DAG definition from mission config (alternative to workflow)

async function main() {
  ensureDirs();
  let globalStart = Date.now();

  // v28: Declare tracking maps here (before initAgentRunner) to avoid TDZ errors.
  // These were previously declared ~200 lines below, after initAgentRunner referenced them.
  const consecutiveEmptyRounds = {};    // agentId → consecutive empty-work count
  const lastFailureDetails = {};        // agentId → { code, timedOut, stderrSummary, round, isEmptyWork }

  // Initialize extracted modules (S63-S67)
  initBacklogSystem({ orchDir: ORCH_DIR, log });
  initHandoffParser({ handoffDir: HANDOFF_DIR, logDir: LOG_DIR, agentWorktrees, log, timestamp });
  initTestFilter({ projectConfig });
  initAgentRunner({
    log, logDir: LOG_DIR, mvpDir: MVP_DIR, rolesDir: ROLES_DIR,
    config: CONFIG, getAgents: () => AGENTS, activeProcs, agentWorktrees,
    agentSessions, agentRuntimeHistory, lastFailureDetails, consecutiveEmptyRounds,
    getObs: () => obs, getMissionDesignDoc: () => missionDesignDoc,
    killProcessTree,
    getChangelogSinceRound, readHandoffContent, getAdaptiveTimeout,
    invalidateAgentSession, recordAgentRuntime, recordAgentEffectiveness,
    getNextTasks, getNextSubtask, loadBacklog,
    buildBalanceContext, getParamSearchResults, buildParamSearchContext, buildExperimentContext,
    getSpawnNotifications, accumulateAgentCost,
    validateAgentOutput, parseHandoffMeta,
    queryLessons, formatLessonsForPrompt,
  });
  initTaskBoard({
    getAgents: () => AGENTS, config: CONFIG, taskBoardPath: TASK_BOARD,
    timestamp, getTestCommand, parseHandoffMeta,
  });
  initSpawnSystem({ spawnsDir: SPAWNS_DIR, config: CONFIG, agentWorktrees, log, runAgent, createWorktree });
  initBalanceAnalyzer({
    log, CONFIG, MVP_DIR, ORCH_DIR, BALANCE_DATA_DIR,
    BACKLOG_ARCHIVE_FILE: join(ORCH_DIR, 'backlog-archive.json'),
    loadBacklog, saveBacklog,
  });
  initGitOps({
    log, MVP_DIR, WORKTREE_DIR, agentWorktrees,
    parseHandoffMeta, invalidateAgentSession, runTests,
  });
  initReporter({
    log, ANALYSIS_DIR, CONFIG, parseHandoffMeta, getTestCommand,
    agentEffectiveness, agentSessions,
  });
  initAgentTracking({
    config: CONFIG, agentWorktrees, handoffDir: HANDOFF_DIR,
    changelogFile: CHANGELOG_FILE, log,
  });
  initMissionSequencer({
    config: CONFIG, configDefaults: CONFIG_DEFAULTS, orchDir: ORCH_DIR,
    log, loadMission,
  });
  initAgentPool({ runAgent });
  initLessons({ orchDir: ORCH_DIR, log });
  const lessonsData = loadLessons();
  if (lessonsData.lessons.length) {
    log(`Lessons loaded: ${lessonsData.lessons.length} cross-session lesson(s)`);
  }
  initCheckpoint({ orchDir: ORCH_DIR, log });

  // --- Load mission config if provided as CLI argument ---
  missionConfigPath = process.argv[2] || null;
  if (missionConfigPath) {
    const mission = loadMissionOrSequence(missionConfigPath);
    AGENTS = mission.agents.map(a => ({
      ...a,
      handoff: a.handoff || join(HANDOFF_DIR, `${a.id}.md`),
    }));
    missionDesignDoc = mission.designDoc;
    missionWorkflow = mission.workflow || null;  // v21: Composable workflow
    // v22: DAG config (takes precedence over workflow if both defined)
    if (CONFIG.enableDAG && mission.dag) {
      try {
        missionDAG = createDAGFromConfig(mission);
        log(`DAG loaded: ${missionDAG.nodes.size} tasks, max concurrency ${missionDAG.maxConcurrency}`);
        log(missionDAG.getExecutionPlan());
      } catch (err) {
        log(`DAG config invalid — falling back to workflow/standard: ${err.message}`);
        missionDAG = null;
      }
    }
  }

  // Reset any backlog tasks stuck in "assigned" from a previous crash
  resetStaleAssignments();

  // Archive completed tasks to keep backlog lean
  archiveCompletedTasks();

  // v28: Defer session changelog reset — checkpoint resume needs the existing changelog.
  // Moved to after checkpoint detection block; reset is skipped when resuming.
  let shouldResetChangelog = true;

  // Load shared rules for agent prompts
  loadCommonRules();

  // Run consistency check
  try { runConsistencyCheck(); }
  catch (err) { log(`Consistency check error: ${err.message}`); }

  // Rotate old analysis files
  try { rotateAnalysisFiles(5); }
  catch (err) { log(`Analysis rotation error: ${err.message}`); }

  // v20: Load project config (from file or auto-detect)
  loadProjectConfig(MVP_DIR);
  let projectDetection = null;
  try {
    projectDetection = await detectProject(MVP_DIR);
    log(`Project detected: ${projectDetection.language}/${projectDetection.frameworks.map(f => f.name).join('+') || 'no-framework'} (${projectDetection.testRunner?.name || 'no-test-runner'})`);

    // If no project config was loaded from file, populate from detection
    if (!projectConfig) {
      projectConfig = generateProjectConfig(projectDetection, MVP_DIR);
      setTestFilterProjectConfig(projectConfig);
      log(`Project config generated from auto-detection (${Object.keys(projectConfig.testing.sourceToTests).length} test mappings)`);
    }
  } catch (err) { log(`Project detection skipped: ${err.message}`); }

  // v19: Role registry — validate agent roles at startup
  let roleRegistry = null;
  try {
    roleRegistry = new RoleRegistry(ROLES_DIR);
    await roleRegistry.load();
    const knownRoles = new Set(roleRegistry.list().map(r => r.name));
    for (const agent of AGENTS) {
      if (agent.role && !knownRoles.has(agent.role)) {
        log(`  WARNING: Agent ${agent.id} has role "${agent.role}" but no template found in roles/`);
      }
    }
    log(`Role registry: ${roleRegistry.roles.size} roles loaded (${roleRegistry.getCodeAgents().length} code, ${roleRegistry.getCoordinationAgents().length} coordination)`);
  } catch (err) { log(`Role registry skipped: ${err.message}`); }

  // v20: Quality gate chain (auto-populated from detection if not in mission config)
  if (!CONFIG.qualityGates && projectDetection) {
    const autoGates = createGateChainFromDetection(projectDetection);
    if (autoGates.length > 0) {
      CONFIG.qualityGates = autoGates;
      log(`Quality gates auto-populated from detection: ${autoGates.map(g => g.name).join(', ')}`);
    }
  }
  qualityGateChain = null;
  if (CONFIG.qualityGates && CONFIG.qualityGates.length > 0) {
    try {
      qualityGateChain = new QualityGateChain(CONFIG.qualityGates, { cwd: MVP_DIR, verbose: true });
      log(`Quality gates: ${CONFIG.qualityGates.length} gates configured (${CONFIG.qualityGates.map(g => g.preset || g.name).join(', ')})`);
    } catch (err) { log(`Quality gate setup failed: ${err.message}`); }
  }

  // v22: Initialize observability (structured logging, metrics, events)
  if (CONFIG.enableObservability) {
    try {
      obs = createObservability({
        logDir: join(ORCH_DIR, 'logs'),
        logLevel: 'info',
        enableConsole: false, // Don't duplicate console output (orchestrator already logs)
        enableFile: true,
        metricsFile: join(ORCH_DIR, 'metrics.json'),
      });
      log(`Observability: structured logging + metrics enabled (logs → orchestrator/logs/)`);
    } catch (err) { log(`Observability setup failed: ${err.message}`); }
  }

  // v22: Check SDK availability (non-blocking — falls back to CLI)
  let sdkAvailable = false;
  if (CONFIG.useSDK) {
    try {
      sdkAvailable = await isSDKAvailable();
      log(`SDK adapter: ${sdkAvailable ? 'Agent SDK detected — will use programmatic execution' : 'SDK not installed — using CLI runner'}`);
    } catch (err) { log(`SDK check failed: ${err.message}`); }
  }

  // v22: Initialize plugin system
  if (CONFIG.enablePlugins) {
    try {
      pluginManager = new PluginManager({
        pluginDir: join(ORCH_DIR, 'plugins'),
        orchestratorCtx: { log, events: obs?.events, config: CONFIG },
        log,
      });
      const discovered = pluginManager.discover();
      if (discovered.length > 0) {
        const loadResult = await pluginManager.loadAll();
        log(`Plugins: ${loadResult.loaded} loaded, ${loadResult.failed} failed (${discovered.length} discovered)`);
        if (loadResult.errors.length > 0) {
          for (const err of loadResult.errors) log(`  Plugin error: ${err}`);
        }
      } else {
        log(`Plugins: no plugins found in orchestrator/plugins/`);
      }
    } catch (err) { log(`Plugin system setup failed: ${err.message}`); }
  }

  log('');
  log('='.repeat(60));
  log('  MULTI-AGENT ORCHESTRATOR v22');
  log('='.repeat(60));
  if (missionConfigPath) log(`Mission: ${missionConfigPath}`);
  log(`Agents: ${AGENTS.map(a => `${a.id} (${a.type}${a.role ? `, ${a.role}` : ''})`).join(', ')}`);
  log(`Config: ${CONFIG.maxRounds} max rounds, ${CONFIG.agentTimeoutMs / 60000}min/agent, ${CONFIG.maxRuntimeMs / 3600000}hr max runtime`);
  log(`Circuit breaker: stop after ${CONFIG.circuitBreakerThreshold} consecutive test failures`);
  const features = [];
  if (sdkAvailable) features.push('SDK');
  if (obs) features.push('Observability');
  if (pluginManager?.plugins.size > 0) features.push(`Plugins(${pluginManager.plugins.size})`);
  if (CONFIG.enableDAG) features.push('DAG');
  if (CONFIG.useWorktrees) features.push('Worktrees');
  if (features.length) log(`Features: ${features.join(', ')}`);
  log('');

  let consecutiveTestFailures = 0;
  let lastTestStatus = null;
  let stopReason = 'max rounds reached';

  // v5: Track per-agent state for work-gating, frequency, and model escalation
  const lastRunRound = {};              // agentId → last round number agent ran
  const consecutiveAgentFailures = {};  // agentId → consecutive failure count
  const escalationCounts = {};          // agentId → total escalation count (for reporting)

  // v5B/v28: consecutiveEmptyRounds and lastFailureDetails declared at top of main() (before initAgentRunner)

  // v9: Context object for processAgentResult (passes main-scoped tracking by reference)
  const trackingCtx = { lastRunRound, consecutiveEmptyRounds, consecutiveAgentFailures, lastFailureDetails };

  // v5C: Track per-agent failure cooldown
  const lastFailedRound = {};           // agentId → round number of last failure
  const lastEscalatedRound = {};        // agentId → round number of last escalation

  // v6.1: Track consecutive successes after escalation (require 2 before de-escalating)
  const successesAfterEscalation = {};  // agentId → consecutive success count since escalation

  // v6: Cost tracking accumulator — per-agent cost data across rounds
  const costLog = {};  // agentId → { totalCost, inputTokens, outputTokens, rounds, escalations }

  // v8: Reset agent-specific tracking when transitioning between missions in a sequence.
  // Global state (costLog, roundLog, escalationCounts) is preserved across missions.
  function resetAgentTracking() {
    for (const key of Object.keys(lastRunRound)) delete lastRunRound[key];
    for (const key of Object.keys(consecutiveAgentFailures)) delete consecutiveAgentFailures[key];
    for (const key of Object.keys(consecutiveEmptyRounds)) delete consecutiveEmptyRounds[key];
    for (const key of Object.keys(lastFailedRound)) delete lastFailedRound[key];
    for (const key of Object.keys(lastEscalatedRound)) delete lastEscalatedRound[key];
    for (const key of Object.keys(successesAfterEscalation)) delete successesAfterEscalation[key];
    for (const key of Object.keys(lastFailureDetails)) delete lastFailureDetails[key];
    // v8 bugfix: Reset test state so mission 2 doesn't inherit mission 1's failure count
    consecutiveTestFailures = 0;
    lastTestStatus = null;
    // v16: Clear all sessions on mission transition (new agents, different context)
    for (const key of Object.keys(agentSessions)) delete agentSessions[key];
    log(`  Agent tracking state reset for new mission (sessions cleared)`);
  }

  // v5/v6: Classify agent roles for two-phase rounds
  const CODE_AGENT_ROLES = new Set([
    'balance-analyst', 'qa-engineer', 'test-writer', 'engine-dev', 'ui-dev', 'css-artist'
  ]);
  const COORD_AGENT_ROLES = new Set(['producer', 'tech-lead', 'game-designer']);

  // Round-level tracking for the overnight report
  const roundLog = []; // { round, agents: [{id, status, elapsed}], testsPassed, testCount, failCount }

  // v5F: Round-level decision log — tracks WHY each agent was included/skipped/blocked each round
  const roundDecisions = [];

  // v7 Phase 4: Run parameter search before round 1 if configured
  if (CONFIG.balanceConfig?.parameterSearch?.configPath) {
    const searchConfig = CONFIG.balanceConfig.parameterSearch;
    log(`\nParameter Search (pre-round discovery phase):`);
    const timeoutMs = searchConfig.timeoutMs || 600000; // 10 min default
    setParamSearchResults(await runParameterSearch(searchConfig.configPath, timeoutMs));
    if (getParamSearchResults()) {
      // Save results to balance-data for reference
      const outPath = join(BALANCE_DATA_DIR, `param-search-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      try {
        writeFileSync(outPath, JSON.stringify(getParamSearchResults(), null, 2));
        log(`  Results saved to: ${outPath}`);
      } catch (err) {
        log(`  Warning: could not save search results (${err.message})`);
      }
    }
  }

  // v8: Generate initial task board before round 1 (one-time; per-round refresh is post-Phase-A only)
  generateTaskBoard(0, null, 0);

  // v26/M8: Checkpoint resume — detect and restore from previous crash
  let startRound = 1;
  const checkpoint = loadCheckpoint();
  if (checkpoint) {
    const currentHead = (await getHeadSha()) || '';
    const validation = validateCheckpoint(checkpoint, currentHead);
    if (validation.valid) {
      log(`\n--- RESUMING FROM CHECKPOINT (round ${checkpoint.round}) ---`);
      log(`  Checkpoint from: ${checkpoint.timestamp}`);
      startRound = checkpoint.round + 1;
      // Restore serializable state
      consecutiveTestFailures = checkpoint.consecutiveTestFailures ?? 0;
      lastTestStatus = checkpoint.lastTestStatus ?? null;
      stopReason = checkpoint.stopReason ?? 'max rounds reached';
      // Restore elapsed time so max-runtime check accounts for pre-crash time
      if (checkpoint.globalElapsedMs) {
        globalStart = Date.now() - checkpoint.globalElapsedMs;
      }
      restoreCheckpointState(checkpoint, {
        lastRunRound, consecutiveAgentFailures, escalationCounts,
        consecutiveEmptyRounds, lastFailedRound, lastEscalatedRound,
        successesAfterEscalation, lastFailureDetails,
        costLog, roundLog, roundDecisions,
        agentSessions, agentRuntimeHistory, agentEffectiveness,
        missionState, agents: AGENTS,
      });
      // Cleanup stale state from crash
      resetStaleAssignments();
      await cleanupAllWorktrees();
      invalidateStaleSessions(startRound, consecutiveEmptyRounds);
      log(`  Resuming from round ${startRound}`);
      log('');
      shouldResetChangelog = false; // v28: Preserve changelog for resumed agents
    } else {
      log(`\nCheckpoint found but invalid: ${validation.reason} — starting fresh`);
      clearCheckpoint();
    }
  }

  // v28: Reset session changelog only if not resuming from checkpoint
  if (shouldResetChangelog) {
    resetSessionChangelog();
  } else {
    log(`  Preserving session changelog for resumed agents`);
  }

  for (let round = startRound; round <= CONFIG.maxRounds; round++) {
    // --- Check max runtime ---
    const elapsed = Date.now() - globalStart;
    if (elapsed >= CONFIG.maxRuntimeMs) {
      stopReason = `max runtime reached (${CONFIG.maxRuntimeMs / 3600000} hours)`;
      log(`\nMAX RUNTIME REACHED (${CONFIG.maxRuntimeMs / 3600000} hours). Stopping.`);
      break;
    }
    const remainingHrs = ((CONFIG.maxRuntimeMs - elapsed) / 3600000).toFixed(1);

    // --- Feature 5E: Hot-reload mission config each round (managed by mission-sequencer.mjs) ---
    if (missionConfigPath) {
      hotReloadMissionConfig(missionConfigPath, AGENTS);
    }

    log(`\n${'━'.repeat(50)}`);
    log(`  ROUND ${round} of ${CONFIG.maxRounds}  (${remainingHrs}hr remaining)`);
    log(`${'━'.repeat(50)}`);

    // v22: Emit round start event + execute plugin pre-round hooks
    if (obs) obs.events.emit('round:start', { round, remainingHrs: parseFloat(remainingHrs) });
    if (pluginManager) {
      try { await pluginManager.executeHook('pre-round', { round }); }
      catch (_) { /* non-fatal */ }
    }

    // --- v7: Pre-round git tag ---
    await tagRoundStart(round);

    // --- Task board refresh moved to just before unified agent pool launch (v17) ---
    // All agents (code + coord) now see the same refreshed task board at round start.

    // v17: Invalidate stale sessions at round start (before agent selection)
    invalidateStaleSessions(round, consecutiveEmptyRounds);

    // --- Determine which agents run this round (v5: work-gated + min frequency) ---
    // v5F: Track per-agent decisions this round
    const thisRoundDecisions = []; // populated during selection, updated after execution

    // v8: Cache backlog and handoff metadata once per round to avoid repeated disk reads.
    // Previously loadBacklog() was called ~4x per agent and parseHandoffMeta() ~3x per agent.
    const backlogCache = loadBacklog();
    const handoffCache = {};
    for (const agent of AGENTS) {
      handoffCache[agent.id] = parseHandoffMeta(agent.id);
    }
    const agentHasBacklogTask = (role, agentId) => backlogCache.some(t => t.status === 'pending' && taskMatchesAgent(t, role, agentId));

    // v11: Producer overflow guard — skip producer when backlog already has enough pending tasks.
    // Prevents producer from flooding backlog faster than code agents can drain it.
    const PRODUCER_BACKLOG_LIMIT = 5;

    const activeAgents = AGENTS.filter(agent => {
      const meta = handoffCache[agent.id];

      // v11: Skip producer if backlog already has enough pending tasks
      if (agent.role === 'producer' && backlogCache.filter(t => t.status === 'pending').length >= PRODUCER_BACKLOG_LIMIT) {
        log(`  ${agent.id}: PRODUCER OVERFLOW (${backlogCache.filter(t => t.status === 'pending').length} pending tasks >= ${PRODUCER_BACKLOG_LIMIT}, skipping)`);
        thisRoundDecisions.push({
          round, agentId: agent.id, decision: 'skipped',
          reason: `producer overflow: ${backlogCache.filter(t => t.status === 'pending').length} pending tasks`,
          model: agent.model || 'default',
          escalated: false, succeeded: null, elapsed: null,
        });
        return false;
      }

      // v17: Cost budget enforcement — skip agents that have exceeded their budget
      if (agent.maxBudgetUsd) {
        const agentCost = costLog[agent.id]?.totalCost || 0;
        if (agentCost >= agent.maxBudgetUsd) {
          log(`  ${agent.id}: OVER BUDGET ($${agentCost.toFixed(4)} >= $${agent.maxBudgetUsd} limit, skipping)`);
          thisRoundDecisions.push({
            round, agentId: agent.id, decision: 'skipped',
            reason: `cost budget exceeded: $${agentCost.toFixed(4)} >= $${agent.maxBudgetUsd}`,
            model: agent.model || 'default',
            escalated: false, succeeded: null, elapsed: null,
          });
          return false;
        }
      }

      // Skip agents that have exhausted all tasks (primary + stretch)
      if (meta.status === 'all-done') {
        if (agent.type !== 'continuous') {
          log(`  ${agent.id}: ALL DONE (skipping)`);
          thisRoundDecisions.push({
            round, agentId: agent.id, decision: 'skipped',
            reason: 'all-done (non-continuous)', model: agent.model || 'default',
            escalated: false, succeeded: null, elapsed: null,
          });
          return false;
        }

        // v5: Work-gated launching for continuous agents
        const hasBacklogTask = agentHasBacklogTask(agent.role, agent.id);
        const hasLeftoverWork = meta.status === 'in-progress';
        const roundsSinceLastRun = round - (lastRunRound[agent.id] || 0);
        const minFreq = agent.minFrequencyRounds || Infinity;
        const dueForPeriodicRun = roundsSinceLastRun >= minFreq;

        if (!hasBacklogTask && !hasLeftoverWork && !dueForPeriodicRun) {
          log(`  ${agent.id}: IDLE (no pending tasks, skipping)`);
          const freqInfo = minFreq < Infinity ? ` (min ${minFreq}, last ran ${roundsSinceLastRun} ago)` : '';
          thisRoundDecisions.push({
            round, agentId: agent.id, decision: 'skipped',
            reason: `work-gated: no tasks${freqInfo}`, model: agent.model || 'default',
            escalated: false, succeeded: null, elapsed: null,
          });
          return false;
        }
        log(`  ${agent.id}: CONTINUOUS — has work or due for periodic run`);
      }

      // v15: Critical task fast-path — agents with P1 tasks bypass all pre-flight checks.
      // This ensures regressions, test fixes, and other critical work is never delayed.
      if (agentHasCriticalTask(agent.role, backlogCache, agent.id)) {
        log(`  ${agent.id}: CRITICAL TASK (P1) — bypassing pre-flight checks`);
        const phase = meta.status === 'complete' ? 'stretch goals' : agent.type;
        thisRoundDecisions.push({
          round, agentId: agent.id, decision: 'included',
          reason: 'critical P1 task — fast-path', model: agent.model || 'default',
          escalated: false, succeeded: null, elapsed: null,
        });
        return true;
      }

      // v8: Pre-flight check — skip agents that likely won't produce useful work
      // 1. Coordination agents with no new changes to react to
      if (COORD_AGENT_ROLES.has(agent.role) && round > 1) {
        const hasBacklogTask = agentHasBacklogTask(agent.role, agent.id);
        const roundsSinceLastRun = round - (lastRunRound[agent.id] || 0);
        const minFreq = agent.minFrequencyRounds || Infinity;
        const dueForPeriodicRun = roundsSinceLastRun >= minFreq;

        if (!hasBacklogTask && !dueForPeriodicRun) {
          // Check if any other agent produced new work since this agent last ran
          const otherAgentsProducedWork = AGENTS.some(other => {
            if (other.id === agent.id) return false;
            const otherLastRun = lastRunRound[other.id] || 0;
            const myLastRun = lastRunRound[agent.id] || 0;
            return otherLastRun > myLastRun;
          });

          if (!otherAgentsProducedWork) {
            log(`  ${agent.id}: PRE-FLIGHT SKIP (no new work from other agents, no backlog tasks)`);
            thisRoundDecisions.push({
              round, agentId: agent.id, decision: 'skipped',
              reason: 'pre-flight: no new work to react to', model: agent.model || 'default',
              escalated: false, succeeded: null, elapsed: null,
            });
            return false;
          }

          // v14: Enhanced backlog depth guard — even if other agents ran, skip coordination
          // agents when backlog is completely empty and no handoff files were actually modified.
          const backlogEmpty = backlogCache.filter(t => t.status === 'pending').length === 0;
          const otherHandoffsChanged = AGENTS.some(other => {
            if (other.id === agent.id || COORD_AGENT_ROLES.has(other.role)) return false;
            const otherMeta = handoffCache[other.id];
            return otherMeta?.filesModified?.length > 0;
          });
          if (backlogEmpty && !otherHandoffsChanged) {
            log(`  ${agent.id}: PRE-FLIGHT SKIP (backlog empty + no code agent output)`);
            thisRoundDecisions.push({
              round, agentId: agent.id, decision: 'skipped',
              reason: 'pre-flight: backlog empty + no handoff changes', model: agent.model || 'default',
              escalated: false, succeeded: null, elapsed: null,
            });
            return false;
          }
        }
      }

      // 2. Agents with 2+ consecutive empty rounds AND no new backlog tasks
      if ((consecutiveEmptyRounds[agent.id] || 0) >= 2) {
        if (!agentHasBacklogTask(agent.role, agent.id)) {
          log(`  ${agent.id}: PRE-FLIGHT SKIP (${consecutiveEmptyRounds[agent.id]} consecutive empty rounds, no new tasks)`);
          thisRoundDecisions.push({
            round, agentId: agent.id, decision: 'skipped',
            reason: `pre-flight: ${consecutiveEmptyRounds[agent.id]} empty rounds + no tasks`, model: agent.model || 'default',
            escalated: false, succeeded: null, elapsed: null,
          });
          return false;
        }
      }

      // v5C: Failure cooldown — skip agent for 1 round after failure (unless escalated since)
      if (lastFailedRound[agent.id] && lastFailedRound[agent.id] === round - 1) {
        const escalatedSinceFailure = lastEscalatedRound[agent.id] && lastEscalatedRound[agent.id] >= lastFailedRound[agent.id];
        if (!escalatedSinceFailure) {
          log(`  ${agent.id}: Cooling down (failed round ${lastFailedRound[agent.id]}, skipping round ${round})`);
          thisRoundDecisions.push({
            round, agentId: agent.id, decision: 'skipped',
            reason: `cooldown: failed round ${lastFailedRound[agent.id]}`, model: agent.model || 'default',
            escalated: false, succeeded: null, elapsed: null,
          });
          return false;
        }
        log(`  ${agent.id}: Would cooldown but was escalated since failure — allowing`);
      }

      // Check dependencies — "complete" and "all-done" both satisfy (using cached metadata)
      const depsMet = agent.dependsOn.every(depId => {
        const depMeta = handoffCache[depId] || parseHandoffMeta(depId);
        return isDepSatisfied(depMeta.status);
      });
      if (!depsMet) {
        const blockingDeps = agent.dependsOn.filter(depId => {
          const depMeta = handoffCache[depId] || parseHandoffMeta(depId);
          return !isDepSatisfied(depMeta.status);
        });
        log(`  ${agent.id}: BLOCKED (needs ${agent.dependsOn.join(', ')})`);
        thisRoundDecisions.push({
          round, agentId: agent.id, decision: 'blocked',
          reason: `dependency blocked by ${blockingDeps.join(', ')}`, model: agent.model || 'default',
          escalated: false, succeeded: null, elapsed: null,
        });
        return false;
      }

      // v26/M3: File-existence pre-flight — skip if ALL literal fileOwnership files are missing
      if (agent.fileOwnership?.length) {
        const literalFiles = agent.fileOwnership.filter(f => !/[*?{]/.test(f));
        if (literalFiles.length > 0) {
          const existingCount = literalFiles.filter(f => existsSync(join(MVP_DIR, f))).length;
          if (existingCount === 0) {
            log(`  ${agent.id}: PRE-FLIGHT SKIP (all ${literalFiles.length} fileOwnership files missing from disk)`);
            thisRoundDecisions.push({
              round, agentId: agent.id, decision: 'skipped',
              reason: `pre-flight: all ${literalFiles.length} fileOwnership files missing`,
              model: agent.model || 'default',
              escalated: false, succeeded: null, elapsed: null,
            });
            return false;
          }
        }
      }

      const phase = meta.status === 'complete' ? 'stretch goals' : agent.type;
      log(`  ${agent.id}: ACTIVE (${phase})`);
      // Record as included — succeeded/elapsed will be updated after execution
      thisRoundDecisions.push({
        round, agentId: agent.id, decision: 'included',
        reason: meta.status === 'all-done' ? 'has pending tasks' : `active (${phase})`,
        model: agent.model || 'default',
        escalated: false, succeeded: null, elapsed: null,
      });
      return true;
    });

    if (activeAgents.length === 0) {
      const allRetired = AGENTS.every(a => handoffCache[a.id]?.status === 'all-done');
      if (allRetired) {
        // v8: Try transitioning to next mission in sequence before stopping
        if (handleMissionTransition('all agents retired')) {
          resetAgentTracking();
          roundDecisions.push(...thisRoundDecisions);
          missionState.roundsUsed = 0;
          continue; // Start next mission's first round
        }
        stopReason = 'all agents exhausted their task lists';
        log('\nAll agents have exhausted their task lists. Done!');
        roundDecisions.push(...thisRoundDecisions);
        break;
      }
      // v10: Multi-round lookahead — skip ahead to next scheduled activation
      // instead of iterating empty rounds one at a time.
      let nextActivation = round + 1; // default: just try next round
      const agentsWithFreq = AGENTS.filter(a => {
        const freq = a.minFrequencyRounds;
        if (!freq || freq <= 0) return false;
        const meta = handoffCache[a.id];
        // Only consider agents that aren't permanently retired (or are continuous)
        return meta?.status !== 'all-done' || a.type === 'continuous';
      });
      if (agentsWithFreq.length) {
        const candidateRounds = agentsWithFreq.map(a => {
          const lastRan = lastRunRound[a.id] || 0;
          return lastRan + (a.minFrequencyRounds || 1);
        });
        nextActivation = Math.min(...candidateRounds);
        if (nextActivation <= round) nextActivation = round + 1; // safety: never go backwards
      }

      const skippedCount = nextActivation - round;
      if (skippedCount > 1) {
        log(`\nNo agents can run. Skipping ${skippedCount - 1} empty round(s) → jumping to round ${nextActivation}.`);
        // Record skipped rounds in roundLog for visibility
        for (let s = round; s < nextActivation; s++) {
          roundLog.push({ round: s, agents: [], testsPassed: null, testCount: '-', failCount: '-', note: `skipped (lookahead → ${nextActivation})` });
        }
        roundDecisions.push(...thisRoundDecisions);
        round = nextActivation - 1; // loop increment will make it nextActivation
        continue;
      }

      log('\nNo agents can run this round (all blocked or all-done). Waiting...');
      roundDecisions.push(...thisRoundDecisions);
      roundLog.push({ round, agents: [], testsPassed: null, testCount: '-', failCount: '-', note: 'skipped (all blocked)' });
      continue;
    }

    // --- v17: Unified agent pool (replaces v6 two-phase rounds) ---
    // All agents (code + coordination) run in a single pool, eliminating the Phase A→B barrier.
    // Coordination agents overlap with code agents instead of waiting for them to finish.
    // Tests only run after code agents complete. Coord results discarded on revert.
    const codeAgentIds = new Set(activeAgents.filter(a => CODE_AGENT_ROLES.has(a.role)).map(a => a.id));
    const hasCodeAgents = codeAgentIds.size > 0;

    // v15: Priority-based scheduling — sort by task priority (P1 first)
    // Tie-break: code agents before coord (they take longer, should start first)
    activeAgents.sort((a, b) => {
      const pA = getAgentTaskPriority(a.role, backlogCache, a.id);
      const pB = getAgentTaskPriority(b.role, backlogCache, b.id);
      if (pA !== pB) return pA - pB;
      const aCode = CODE_AGENT_ROLES.has(a.role) ? 0 : 1;
      const bCode = CODE_AGENT_ROLES.has(b.role) ? 0 : 1;
      return aCode - bCode;
    });

    const roundAgents = [];
    let testResult = null;
    let didRevert = false;
    let preSimResults = null;
    let postSimResults = null;
    let regressionResult = null;
    let convergenceResult = null;

    // v17: Simplified timing — "agents" replaces separate phaseA/phaseB
    const roundTiming = { roundStart: Date.now(), agents: 0, tests: 0, preSim: 0, postSim: 0, overhead: 0 };
    const roundConcurrency = getDynamicConcurrency(AGENTS.length);
    const roundModifiedFiles = [];
    let balanceChangeAgent = null;
    const codeResults = [];
    const coordResults = [];
    let worktreesActive = false;
    let preMergeHead = null;

    // v17: Refresh task board at round start so all agents see latest state
    generateTaskBoard(round, lastTestStatus || 'pending', consecutiveTestFailures);

    // v22: DAG execution branch — if mission defines a dag section, use the DAG scheduler.
    // DAG scheduler handles arbitrary dependency graphs with bounded concurrency.
    // Takes precedence over workflow engine when both are defined.
    let usedDAG = false;
    if (missionDAG && activeAgents.length) {
      const agentsStart = Date.now();
      log(`\nDAG mode: ${missionDAG.nodes.size} tasks, max concurrency ${missionDAG.maxConcurrency}`);
      missionDAG.reset();

      const dagResult = await missionDAG.execute(async (node) => {
        const agent = AGENTS.find(a => a.id === node.agentId);
        if (!agent) throw new Error(`Agent "${node.agentId}" not found for DAG node "${node.id}"`);
        const result = await runAgent(agent, round);
        processAgentResult(result, round, roundAgents, costLog, trackingCtx);
        if (result.code !== 0 && !result.timedOut) throw new Error(`Agent ${node.agentId} failed`);
        return result;
      });

      roundTiming.agents = Date.now() - agentsStart;
      const progress = missionDAG.getProgress();
      log(`  DAG complete: ${progress.completed} done, ${progress.failed} failed, ${progress.skipped} skipped`);

      if (progress.failed === 0) {
        const testStart = Date.now();
        testResult = await runTests();
        roundTiming.tests = Date.now() - testStart;
      }

      usedDAG = true;
    }

    // v21: Workflow execution branch — if mission defines a workflow, use the workflow engine.
    // Workflow engine manages its own worktree lifecycle, agent execution, and test boundaries.
    // After workflow completes, skip the standard pool and jump to round tracking/cleanup.
    if (!usedDAG && missionWorkflow && activeAgents.length) {
      const agentsStart = Date.now();
      log(`\nWorkflow mode: ${missionWorkflow.type} (${activeAgents.length} agents available)`);

      const workflowCtx = {
        runAgent, runAgentPool, runTests, processResult: (result, r) => {
          return processAgentResult(result, r, roundAgents, costLog, trackingCtx);
        },
        smartRevert: (r, results) => smartRevert(r, results),
        createWorktree, mergeWorktree: mergeWorktreeBranch,
        gitExec, getWorktree: (id) => agentWorktrees[id],
        parseHandoffMeta,
        log, allAgents: AGENTS, round,
        maxConcurrency: getDynamicConcurrency(AGENTS.length),
        useWorktrees: !!CONFIG.useWorktrees,
      };

      const workflowResult = await executeWorkflow(missionWorkflow, workflowCtx);
      roundTiming.agents = Date.now() - agentsStart;

      testResult = workflowResult.testResult || null;
      if (workflowResult.reverted) didRevert = true;

      await cleanupAllWorktrees();

      // Skip the standard pool block — jump to round tracking below
    }

    // --- Standard round-based execution (when no workflow or DAG is defined) ---
    if (!missionWorkflow && !usedDAG) {

    // v21: Create worktrees for code agents (isolation for parallel editing)
    if (CONFIG.useWorktrees && hasCodeAgents) {
      const codeAgentsToWorktree = activeAgents.filter(a => codeAgentIds.has(a.id));
      let worktreeCount = 0;
      for (const agent of codeAgentsToWorktree) {
        const ok = await createWorktree(agent.id, round);
        if (ok) worktreeCount++;
      }
      if (worktreeCount > 0) {
        worktreesActive = true;
        preMergeHead = await getHeadSha();
        log(`  Worktrees created: ${worktreeCount}/${codeAgentsToWorktree.length} code agents isolated (checkpoint: ${preMergeHead?.slice(0, 8)})`);
      } else {
        log(`  ⚠ Worktree creation failed for all agents — falling back to shared working tree`);
      }
    }

    // v17: Unified agent pool — all agents in one pool
    if (activeAgents.length) {
      const agentsStart = Date.now();
      const priorities = activeAgents.map(a => {
        const tag = codeAgentIds.has(a.id) ? 'code' : 'coord';
        return `${a.id}(P${getAgentTaskPriority(a.role, backlogCache, a.id)},${tag})`;
      });
      log(`\nLaunching ${activeAgents.length} agent(s)... [${priorities.join(', ')}]`);

      // Pre-sims run concurrently with agent pool
      const preSimPromise = (CONFIG.balanceConfig?.runPreSim !== false && CONFIG.balanceConfig?.sims?.length)
        ? (() => { log(`  (pre-sim running concurrently with agents)`); return runBalanceSims(round, 'pre'); })()
        : Promise.resolve(null);

      // v15: Live progress dashboard
      const dashboard = new ProgressDashboard(activeAgents, `Round ${round}`);
      dashboard.start();

      // v18: Single pool with early test start — tests begin when code agents finish,
      // while coord agents may still be running
      const pool = runAgentPool(activeAgents, round, roundConcurrency, (result) => {
        const { filesModified, balanceConfigChanged } = processAgentResult(result, round, roundAgents, costLog, trackingCtx);
        if (codeAgentIds.has(result.agentId)) {
          codeResults.push(result);
          roundModifiedFiles.push(...filesModified);
          if (balanceConfigChanged && !balanceChangeAgent) {
            balanceChangeAgent = result.agentId;
          }
        } else {
          coordResults.push(result);
        }
      }, dashboard, {
        groupIds: hasCodeAgents ? codeAgentIds : undefined,
      });

      // Phase 1: Wait for pre-sims + code agents (NOT full pool)
      const [preSimRes] = await Promise.all([preSimPromise, pool.groupDone]);
      if (preSimRes) {
        preSimResults = preSimRes;
        roundTiming.preSim = preSimRes.elapsedMs || 0;
      }

      // Process code agent results immediately (coord agents may still be running)
      if (codeResults.length) {
        appendSessionChangelog(round, codeResults);
        handleCompletedTasks(codeResults);
        handleFailedTasks(codeResults);
        validateFileOwnership(codeResults, AGENTS);
        handleModelEscalation(codeResults, round);
      }

      // v21: Detect and run spawned agents (before merge — spawns get their own worktrees)
      if (codeResults.length) {
        const spawnedResults = await detectAndSpawnAgents(round, codeResults, costLog, trackingCtx);
        if (spawnedResults.length) {
          // Treat spawned agents as additional code results (they get merged too)
          codeResults.push(...spawnedResults);
          roundAgents.push(...spawnedResults.map(r => ({
            id: r.agentId, status: r.code === 0 ? 'OK' : `ERROR(${r.code})`, elapsed: r.elapsed,
          })));
          const spawnedFiles = spawnedResults.flatMap(r => {
            const meta = parseHandoffMeta(r.agentId);
            return meta.filesModified || [];
          });
          roundModifiedFiles.push(...spawnedFiles);
        }
      }

      // v26/M2: Cross-verify agent output before merging (worktrees still alive)
      if (worktreesActive && codeResults.length) {
        for (const result of codeResults) {
          const wt = agentWorktrees[result.agentId];
          if (!wt) continue;
          const meta = parseHandoffMeta(result.agentId);
          const verification = await verifyAgentOutput(result.agentId, meta.filesModified, wt.path);
          for (const w of verification.warnings) log(`  ⚠ ${w}`);
        }
      }

      // v21: Merge worktree branches into main before testing.
      // Each code agent's branch is merged sequentially (priority order).
      // Failed merges (conflicts) are skipped — the agent's changes are lost for this round.
      const mergeResults = [];
      if (worktreesActive && codeResults.length) {
        log(`  Merging ${codeResults.length} worktree branch(es) into main...`);
        for (const result of codeResults) {
          if (!agentWorktrees[result.agentId]) continue;
          // Stage the worktree changes (agents may have created untracked files)
          await gitExec('git add -A', agentWorktrees[result.agentId].path);
          await gitExec(
            `git -C "${agentWorktrees[result.agentId].path}" commit -m "agent work: ${result.agentId} round ${round}" --allow-empty`,
            agentWorktrees[result.agentId].path,
          );
          const mergeResult = await mergeWorktreeBranch(result.agentId);
          mergeResults.push({ agentId: result.agentId, ...mergeResult });
          if (!mergeResult.ok) {
            log(`  ⚠ ${result.agentId}: merge ${mergeResult.conflicted ? 'CONFLICT' : 'FAILED'} — changes lost this round`);
            invalidateAgentSession(result.agentId, `merge ${mergeResult.conflicted ? 'conflict' : 'failure'}`);
          }
        }
        const merged = mergeResults.filter(m => m.ok).length;
        const failed = mergeResults.filter(m => !m.ok).length;
        log(`  Merge complete: ${merged} merged, ${failed} failed`);
      }

      // Phase 2: Start tests + post-sims (overlapping with coord agents still in pool)
      let testAndSimPromise = Promise.resolve(null);
      if (hasCodeAgents) {
        const testStart = Date.now();
        const postSimShouldRun = CONFIG.balanceConfig?.runPostSim !== false && CONFIG.balanceConfig?.sims?.length;

        // v10: Incremental testing — only run affected suites after round 1
        const testFilter = round === 1 ? null : getTestFilter(roundModifiedFiles);
        if (testFilter !== null && testFilter !== '') {
          log(`  Incremental test filter: ${testFilter.split('|').length} suite(s) of 8`);
        }

        const testPromise = runTests(testFilter);
        const postSimPromise = postSimShouldRun
          ? (() => { log(`  (post-sim running concurrently with tests)`); return runBalanceSims(round, 'post'); })()
          : Promise.resolve(null);

        testAndSimPromise = Promise.all([testPromise, postSimPromise]).then(([testRes, postSimOpt]) => {
          roundTiming.tests = Date.now() - testStart;
          if (postSimOpt) roundTiming.postSim = postSimOpt.elapsedMs || 0;
          return { testRes, postSimOpt };
        });
      }

      // Phase 3: Wait for full pool + tests to complete
      const [, testSimResult] = await Promise.all([pool.allDone, testAndSimPromise]);
      dashboard.stop();
      roundTiming.agents = Date.now() - agentsStart;

      // Handle test regression + revert
      if (testSimResult && hasCodeAgents) {
        testResult = testSimResult.testRes;
        const postSimOptimistic = testSimResult.postSimOpt;

        // v8/v21: Smart per-agent revert on test regression
        if (!testResult.passed && lastTestStatus?.includes('PASSING')) {
          log(`  ⚠ Tests regressed this round! Attempting smart revert...`);
          let revertResult;
          if (worktreesActive && preMergeHead && mergeResults.length) {
            // v21: Worktree-based revert — reset to pre-merge, re-merge selectively
            revertResult = await smartRevertWorktrees(round, codeResults, preMergeHead, mergeResults);
          } else {
            // Legacy: file-level revert using git tags
            revertResult = await smartRevert(round, codeResults);
          }
          if (revertResult.reverted) {
            log(`  Revert strategy: ${revertResult.strategy}, agents reverted: [${revertResult.revertedAgents.join(', ')}]`);
            invalidateRevertedSessions(revertResult.revertedAgents);
            // v26/M4: Record lesson from revert for cross-session learning
            recordLesson({
              round, strategy: revertResult.strategy,
              revertedAgents: revertResult.revertedAgents,
              agents: AGENTS, codeResults, parseHandoffMeta,
            });
            testResult = await runTests();
          }
          didRevert = true;
        }

        // Accept or discard optimistic post-sim results
        if (testResult.passed && !didRevert && postSimOptimistic) {
          postSimResults = postSimOptimistic;
        } else if (didRevert && postSimOptimistic) {
          log(`  Post-sim results discarded (revert happened — sim data reflects reverted code)`);
          postSimResults = null;
        }
      }

      // Process coordination agent results (discard on revert)
      if (coordResults.length) {
        if (didRevert) {
          log(`  Coordination results discarded (revert happened — handoffs reference reverted code)`);
        } else {
          appendSessionChangelog(round, coordResults);
          handleCompletedTasks(coordResults);
          handleFailedTasks(coordResults);
          validateFileOwnership(coordResults, AGENTS);
          handleModelEscalation(coordResults, round);
        }
      }

      // Balance state, experiment logging, regression detection, convergence, backlog generation
      if (preSimResults?.results?.length || postSimResults?.results?.length) {
        updateBalanceState(round, preSimResults?.results, postSimResults?.results);
      }

      if (balanceChangeAgent && !didRevert) {
        const paramChanges = parseBalanceConfigDiff(round);
        if (paramChanges.length) {
          logExperiment(round, balanceChangeAgent, paramChanges,
            preSimResults?.results, postSimResults?.results);
        }
      }

      if (preSimResults?.results?.length && postSimResults?.results?.length) {
        regressionResult = detectBalanceRegressions(round, preSimResults.results, postSimResults.results);
        if (regressionResult.hasRegressions) {
          const state = loadBalanceState();
          if (state.rounds.length) {
            state.rounds[state.rounds.length - 1]._regressions = regressionResult.regressions;
            saveBalanceState(state);
          }
        }
      }

      if (postSimResults?.results?.length && CONFIG.balanceConfig?.convergenceCriteria) {
        convergenceResult = checkConvergence(postSimResults.results, round);
        if (convergenceResult.converged) {
          stopReason = `balance converged — all tiers within thresholds at round ${round}`;
          log(`\n✓ BALANCE CONVERGED. Stopping orchestration.`);
        }
      }

      if (postSimResults?.results?.length) {
        generateBalanceBacklog(round, postSimResults.results, regressionResult);
      }
    }

    } // end if (!missionWorkflow && !usedDAG) — standard round-based execution

    // v17: Compute overhead = total - agents - tests (sims are concurrent, subsumed)
    const roundTotal = Date.now() - roundTiming.roundStart;
    roundTiming.overhead = roundTotal - roundTiming.agents - roundTiming.tests;

    // --- Update test status ---
    if (!testResult) {
      // No code agents ran — carry forward last test status
      log('  Skipping tests (no code-modifying agents ran this round)');
    }
    if (testResult) {
      // v22: Emit test completion event
      if (obs) {
        obs.events.emit('test:complete', { round, passed: testResult.passed, count: testResult.count, failCount: testResult.failCount || 0 });
        obs.metrics.recordTestRun({ passed: testResult.passed, testsRun: testResult.count, testsFailed: testResult.failCount || 0, round });
      }
      if (testResult.passed) {
        consecutiveTestFailures = 0;
        lastTestStatus = `PASSING (${testResult.count} tests)`;
      } else {
        consecutiveTestFailures++;
        lastTestStatus = `FAILING (${testResult.count} passed, ${testResult.failCount} failed)`;
        log(`\n⚠ Tests failing! Consecutive failures: ${consecutiveTestFailures}/${CONFIG.circuitBreakerThreshold}`);
      }
    }

    // v5F: Update decision entries with execution results
    for (const ra of roundAgents) {
      const decision = thisRoundDecisions.find(d => d.agentId === ra.id);
      if (decision) {
        decision.succeeded = ra.status === 'OK';
        decision.elapsed = ra.elapsed * 1000; // convert seconds to ms
        // Check if model was escalated this round
        const agent = AGENTS.find(a => a.id === ra.id);
        if (agent) decision.model = agent.model || 'default';
        decision.escalated = !!(agent?._originalModel && agent.model !== agent._originalModel);
      }
    }
    roundDecisions.push(...thisRoundDecisions);

    // v8: Backlog velocity snapshot
    const postBacklog = loadBacklog();
    const backlogPending = postBacklog.filter(t => t.status === 'pending').length;
    const backlogCompleted = postBacklog.filter(t => t.status === 'completed').length;

    // v14: Round quality metrics — track productivity per round
    const roundSuccessful = roundAgents.filter(a => a.status === 'OK').length;
    const roundFailed = roundAgents.filter(a => a.status !== 'OK').length;
    const roundFilesModified = roundModifiedFiles.length;
    const roundTokensSpent = roundAgents.reduce((sum, ra) => {
      const c = costLog[ra.id];
      return sum + (c?.inputTokens || 0) + (c?.outputTokens || 0);
    }, 0);
    const roundCost = roundAgents.reduce((sum, ra) => {
      const c = costLog[ra.id];
      return sum + (c?.totalCost || 0);
    }, 0);
    const agentsActive = roundAgents.length;
    const agentsIdle = thisRoundDecisions.filter(d => d.decision === 'skipped' || d.decision === 'blocked').length;
    const utilization = (agentsActive + agentsIdle) > 0
      ? Math.round((agentsActive / (agentsActive + agentsIdle)) * 100)
      : 0;
    const roundQuality = {
      successful: roundSuccessful,
      failed: roundFailed,
      filesModified: roundFilesModified,
      agentsActive,
      agentsIdle,
      utilization,
    };

    // Log round quality summary
    log(`  Round quality: ${roundSuccessful} OK, ${roundFailed} failed, ${roundFilesModified} files, ${utilization}% utilization`);

    // v22: Record round metrics + emit round complete event + plugin post-round hook
    if (obs) {
      obs.metrics.recordRound({ round, agentsRun: agentsActive, agentsFailed: roundFailed, testsPassed: testResult?.passed ?? null, elapsedMs: Date.now() - roundTiming.roundStart, cost: roundCost });
      obs.events.emit('round:complete', { round, agentsRun: agentsActive, testsPassed: testResult?.passed ?? null, elapsedMs: Date.now() - roundTiming.roundStart });
    }
    if (pluginManager) {
      try { await pluginManager.executeHook('post-round', { round, testsPassed: testResult?.passed ?? null }); }
      catch (_) { /* non-fatal */ }
    }

    roundLog.push({
      round,
      agents: roundAgents,
      testsPassed: testResult?.passed ?? null,
      testCount: testResult?.count ?? '-',
      failCount: testResult?.failCount || '0',
      balanceSims: {
        pre: preSimResults?.results?.map(r => ({ tier: r.tier, variant: r.variant, success: r.success, spread: r.data?.balanceMetrics?.overallSpreadPp ?? null })) || null,
        post: postSimResults?.results?.map(r => ({ tier: r.tier, variant: r.variant, success: r.success, spread: r.data?.balanceMetrics?.overallSpreadPp ?? null })) || null,
      },
      // v7 Phase 2: regression + convergence data
      regressions: regressionResult?.hasRegressions ? regressionResult.regressions : null,
      convergence: convergenceResult?.converged ? convergenceResult.tierResults : null,
      // v8: Time breakdown (ms) and backlog velocity
      timing: roundTiming,
      backlog: { pending: backlogPending, completed: backlogCompleted },
      // v14: Round quality metrics
      quality: roundQuality,
    });

    // --- Circuit breaker ---
    if (consecutiveTestFailures >= CONFIG.circuitBreakerThreshold) {
      stopReason = `circuit breaker (${consecutiveTestFailures} consecutive test failures)`;
      log(`\n🛑 CIRCUIT BREAKER: Tests failed ${consecutiveTestFailures} rounds in a row. STOPPING.`);
      log(`Check logs at: ${LOG_DIR}`);
      log(`Last test output saved in test-results.log`);
      break;
    }

    // --- v7 Phase 2: Convergence stop (after all agents have run) ---
    if (convergenceResult?.converged) {
      // v8: Try transitioning to next mission before stopping
      if (!handleMissionTransition('balance converged')) {
        break; // stopReason already set above
      }
      resetAgentTracking();
      // Transitioned — continue to next mission's rounds
    }

    // --- v21: Worktree cleanup (remove worktrees + branches after merges/reverts) ---
    if (worktreesActive) {
      await cleanupAllWorktrees();
    }

    // --- v5: Smart git backup (skip when only orchestrator internals changed) ---
    const sourceChanged = roundAgents.some(a => {
      const meta = parseHandoffMeta(a.id);
      return meta.filesModified.some(f =>
        f.startsWith('src/') || f === 'CLAUDE.md' || f.endsWith('.json')
      );
    });
    if (sourceChanged) {
      await gitBackup(round);
    } else {
      log('  Skipping git backup (only internal orchestrator files changed)');
    }

    // --- v8: Check sub-mission round budget ---
    if (missionState.sequence) {
      missionState.roundsUsed++;
      if (missionState.roundsUsed >= missionState.maxRounds) {
        if (!handleMissionTransition(`round budget exhausted (${missionState.maxRounds} rounds)`)) {
          stopReason = 'all missions in sequence completed';
          log('\nAll missions in sequence completed.');
          break;
        }
        resetAgentTracking();
        // Transitioned — continue to next mission's rounds
      }
    }

    // --- Check if all agents are retired ---
    const allRetired = AGENTS.every(a => parseHandoffMeta(a.id).status === 'all-done');
    if (allRetired) {
      // v8: Try transitioning to next mission before stopping
      if (!handleMissionTransition('all agents retired')) {
        stopReason = 'all agents exhausted their task lists';
        log('\nAll agents have exhausted their task lists. Orchestration finished.');
        break;
      }
      resetAgentTracking();
    }

    // v26/M8: Write checkpoint at end of each round (crash recovery)
    try {
      const headSha = (await getHeadSha()) || '';
      const agentModels = AGENTS.map(a => ({ id: a.id, model: a.model, _originalModel: a._originalModel || null }));
      writeCheckpoint(collectCheckpointState({
        round, globalElapsedMs: Date.now() - globalStart,
        consecutiveTestFailures, lastTestStatus, stopReason,
        lastRunRound, consecutiveAgentFailures, escalationCounts, consecutiveEmptyRounds,
        lastFailedRound, lastEscalatedRound, successesAfterEscalation, lastFailureDetails,
        costLog, roundLog, roundDecisions,
        agentSessions, agentRuntimeHistory, agentEffectiveness,
        missionState, headSha, agentModels,
      }));
    } catch (err) {
      log(`  WARNING: Checkpoint write failed: ${err.message}`);
    }
  }

  // --- v5: Helper for failed task reassignment ---
  function handleFailedTasks(results) {
    for (const result of results) {
      if (result.timedOut || result.code !== 0) {
        const backlog = loadBacklog();
        const agentRole = AGENTS.find(a => a.id === result.agentId)?.role;
        const stuckTasks = backlog.filter(t => t.status === 'assigned' && t.role === agentRole);
        for (const task of stuckTasks) {
          task.status = 'pending';
          log(`  Resetting task ${task.id} to pending (agent ${result.agentId} failed)`);
        }
        if (stuckTasks.length) saveBacklog(backlog);
      }
    }
  }

  // v15: Process completed tasks/subtasks from agent handoffs
  function handleCompletedTasks(results) {
    for (const result of results) {
      if (result.timedOut || result.code !== 0) continue;
      const meta = parseHandoffMeta(result.agentId);
      if (!meta.completedTasks?.length) continue;

      for (const taskId of meta.completedTasks) {
        // Check if it's a subtask ID (contains a hyphen after BL-XXX pattern, e.g., BL-077-1)
        const subtaskMatch = taskId.match(/^(BL-\d+)-(\d+)$/);
        if (subtaskMatch) {
          const [, parentId, subNum] = subtaskMatch;
          completeSubtask(parentId, taskId);
          log(`  Subtask ${taskId} completed by ${result.agentId}`);
        } else {
          completeBacklogTask(taskId);
          log(`  Task ${taskId} completed by ${result.agentId}`);
        }
      }
    }
  }

  // --- v6: Model escalation (haiku→sonnet→opus after 2 consecutive failures, with maxModel cap + de-escalation) ---
  // Also tracks lastFailedRound for v5C cooldown and lastEscalatedRound for cooldown bypass
  function handleModelEscalation(results, round) {
    for (const result of results) {
      const meta = parseHandoffMeta(result.agentId);
      const agent = AGENTS.find(a => a.id === result.agentId);
      if (!agent) continue;

      const failed = result.timedOut || result.code !== 0 || meta.status === 'not-started';

      if (failed) {
        // v5C: Track last failed round for cooldown
        lastFailedRound[result.agentId] = round;

        consecutiveAgentFailures[result.agentId] = (consecutiveAgentFailures[result.agentId] || 0) + 1;

        if (consecutiveAgentFailures[result.agentId] >= 2) {
          // Determine next model in the escalation chain
          const currentModel = agent.model || 'sonnet';
          const currentTier = MODEL_TIER[currentModel] ?? 1;
          const nextTier = currentTier + 1;
          const nextModel = Object.keys(MODEL_TIER).find(m => MODEL_TIER[m] === nextTier);

          if (!nextModel) {
            // Already at max tier (opus) — nothing to escalate to
            log(`  ${result.agentId}: Already at highest model (${currentModel}), cannot escalate further`);
            continue;
          }

          // Check maxModel cap
          const maxModel = agent.maxModel || null;
          if (maxModel && (MODEL_TIER[nextModel] > MODEL_TIER[maxModel])) {
            log(`  ${result.agentId}: Would escalate ${currentModel}->${nextModel} but maxModel=${maxModel} prevents it`);
            continue;
          }

          // Save original model on first escalation (for de-escalation later)
          if (!agent._originalModel) {
            agent._originalModel = currentModel;
          }

          log(`  ${result.agentId}: Escalating ${currentModel}->${nextModel} (${consecutiveAgentFailures[result.agentId]} consecutive failures)`);
          agent.model = nextModel;
          consecutiveAgentFailures[result.agentId] = 0;
          successesAfterEscalation[result.agentId] = 0;  // v6.1: Reset success counter on escalation
          escalationCounts[result.agentId] = (escalationCounts[result.agentId] || 0) + 1;
          // v5C: Track escalation round so cooldown is bypassed
          lastEscalatedRound[result.agentId] = round;
          // Track escalations in costLog for reporting
          ensureCostLogEntry(costLog, result.agentId).escalations++;
        }
      } else {
        // Success — de-escalate if agent was previously escalated (v6.1: require 2 consecutive successes)
        if (agent._originalModel && agent.model !== agent._originalModel) {
          successesAfterEscalation[result.agentId] = (successesAfterEscalation[result.agentId] || 0) + 1;
          if (successesAfterEscalation[result.agentId] >= 2) {
            log(`  ${result.agentId}: De-escalating ${agent.model}->${agent._originalModel} (${successesAfterEscalation[result.agentId]} consecutive successes after escalation)`);
            agent.model = agent._originalModel;
            delete agent._originalModel;
            successesAfterEscalation[result.agentId] = 0;
          } else {
            log(`  ${result.agentId}: Success on escalated model (${successesAfterEscalation[result.agentId]}/2 before de-escalation)`);
          }
        }
        consecutiveAgentFailures[result.agentId] = 0;
      }
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

  // v26/M8: Clear checkpoint on successful completion (no crash recovery needed)
  clearCheckpoint();

  // ============================================================
  // v5F: Write round-decisions.json
  // ============================================================
  try {
    mkdirSync(join(ORCH_DIR, 'logs'), { recursive: true });
    writeFileSync(
      join(LOG_DIR, 'round-decisions.json'),
      JSON.stringify(roundDecisions, null, 2)
    );
    log(`Round decisions log written to: ${join(LOG_DIR, 'round-decisions.json')} (${roundDecisions.length} entries)`);
  } catch (err) {
    log(`WARNING: Could not write round-decisions.json: ${err.message}`);
  }

  // v22: Export observability metrics + unload plugins
  if (obs) {
    try {
      obs.metrics.exportMetrics(join(ORCH_DIR, 'metrics.json'));
      log(`Observability metrics exported to: orchestrator/metrics.json`);
    } catch (err) { log(`Metrics export failed: ${err.message}`); }
  }
  if (pluginManager) {
    try { await pluginManager.unloadAll(); }
    catch (_) { /* best-effort */ }
  }

  // ============================================================
  // Generate Overnight Report
  // ============================================================
  generateOvernightReport(AGENTS, missionConfigPath, globalStart, roundLog, stopReason, finalTests, escalationCounts, costLog, roundDecisions);

  // v18: Signal to overnight runner — exit code 42 means "all work complete, no restart needed"
  const doneReasons = [
    'all agents exhausted their task lists',
    'all missions in sequence completed',
  ];
  // v26/M5: Fire orchestration-complete hook before exit
  if (pluginManager) {
    try {
      await pluginManager.executeHook('orchestration-complete', {
        stopReason,
        totalRounds: round - 1,
        elapsedMs: Date.now() - globalStart,
      });
    } catch (_) { /* non-fatal */ }
  }

  if (doneReasons.includes(stopReason) || stopReason.startsWith('balance converged') || stopReason.startsWith('circuit breaker')) {
    log(`\nExit code 42: orchestration complete (${stopReason}) — no restart needed.`);
    process.exit(42);
  }
}


main().catch(err => {
  log(`FATAL ERROR: ${err.message}\n${err.stack}`);
  if (pluginManager) {
    pluginManager.executeHook('orchestration-complete', {
      stopReason: 'fatal-error',
      error: err.message,
    }).catch(() => {});
  }
  process.exit(1);
});
