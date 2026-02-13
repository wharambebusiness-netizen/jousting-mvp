#!/usr/bin/env node
// ============================================================
// Multi-Agent Orchestrator v22
// ============================================================
// v22 additions (Phase 4 Ecosystem — modular architecture):
// - SDK adapter: programmatic agent execution via @anthropic-ai/claude-agent-sdk (CLI fallback)
// - Observability: structured logging (JSONL), metrics collector, event bus
// - DAG scheduler: arbitrary dependency graphs beyond 5 fixed workflow patterns
// - Plugin system: 6 plugin types (tool, gate, role, workflow, hook, transform), manifest-based
// - Project scaffold: 7 templates (react-vite-ts, node-api-ts, next-ts, python-fastapi, python-flask, static-site, monorepo)
// - CONFIG flags: useSDK, enableObservability, enablePlugins, enableDAG
// - Observability events emitted at agent start/complete/error, round boundaries, test runs
// - Metrics exported at process exit (orchestrator/metrics.json)
// - Plugin hooks: pre-round, post-round, pre-agent, post-agent
// - DAG execution as alternative to workflow engine (mission.dag config)
//
// v21 additions (Phase 3 Scale — worktree isolation + dynamic agent spawning):
// - Git worktree isolation: each code agent runs in its own worktree/branch
// - Zero cross-agent file conflicts during parallel execution
// - createWorktree/mergeWorktreeBranch/removeWorktree/cleanupAllWorktrees lifecycle
// - gitExec() helper centralizes git command spawning
// - smartRevertWorktrees(): merge-based revert (reset to pre-merge, selective re-merge)
// - parseHandoffMeta/readHandoffContent: check worktree path before main tree
// - CONFIG.useWorktrees: feature flag (default: true, set false for legacy behavior)
// - Dynamic agent spawning: agents write spawn requests to orchestrator/spawns/
// - detectAndSpawnAgents(): scans worktrees + main for spawn requests, runs helpers
// - Spawn constraints: max 3/round, 1/agent, budget cap, role allowlist
// - Spawn notifications: parent agents see child results in next round prompt
// - Spawned agents are one-shot (run once, merge, retire) with own worktrees
// - archiveSpawnRequest(): processed requests moved to spawns/archive/
//
// v20 additions (config-driven testing & quality gates):
// - Project config: load from project-config.json or auto-generate from detection
// - Config-driven test mapping: SOURCE_TO_TESTS, AI patterns, filter flags from config
// - Quality gate chain auto-populated from project detection when not in mission config
// - getTestCommand(): replaces hardcoded 'npx vitest run' everywhere
// - runTests() uses quality gate chain with legacy fallback
// - Dynamic file ownership: agents with fileOwnership='auto' get patterns from project config
// - generateProjectConfig(): new export from project-detect.mjs
//
// v19 additions (S57 — general-purpose expansion):
// - Project auto-detection: auto-detect language, framework, test runner at startup
// - Role registry: discoverable, composable agent roles from roles/*.md templates
// - Quality gate chain: pluggable lint → typecheck → test → security pipeline
// - Per-agent allowedTools: override tool restrictions per agent in mission config
// - 6 new role templates: architect, security-auditor, performance-analyst, research-agent, devops, test-generator
// - 5 custom skills: orchestrator-status, code-review, security-scan, project-detect, agent-report
// - General-purpose mission template (general-dev.json): 8-agent team for any project
// - Removed "Jousting MVP" branding — orchestrator is now project-agnostic
//
// v18 additions (S56 — early test start, all-done exit code):
// - Early test start: tests begin as soon as code agents finish, while coord agents still run
// - runAgentPool groupIds/groupDone: fires when a subset of agents (code group) completes
// - Tests + post-sims now overlap with coordination agent runtime (~1-2min savings per round)
// - All-done exit code (42): orchestrator exits with code 42 when all work is complete
// - Overnight runner (v8): detects exit code 42 and stops gracefully (no more restart loop)
// - Version strings updated to v18
//
// v17 additions (S55 — unified agent pool, cost enforcement, session health):
// - Unified agent pool: code + coordination agents run in a single pool (eliminates Phase A→B barrier)
// - Coordination agents now overlap with code agents (~3min savings per round)
// - Three execution paths (Phase A pool, Phase B concurrent, Phase B standalone) consolidated to one
// - Cost budget enforcement: agents exceeding maxBudgetUsd are skipped in pre-flight checks
// - Stale session invalidation: proactive cleanup after 5+ empty rounds or 10+ round session age
// - Simplified timing: "agents" column replaces "Phase A" + "Phase B" in overnight report
// - Task board refresh moved to round start (all agents see same state)
// - Version strings updated to v17
//
// v16 additions (S54 — agent session continuity + inline context):
// - Agent session continuity: --session-id on first run, --resume on subsequent rounds
// - Delta prompts: returning agents get compact "what changed" prompt (skip role template, shared rules)
// - Inline handoff injection: pre-read handoff content into prompt (eliminates tool calls)
// - Session invalidation: auto-invalidate on revert, mission transition, or resume failure
// - getChangelogSinceRound(): extracts changelog entries since a given round
// - readHandoffContent(): reads agent handoff file for inline injection
// - agentSessions map: tracks sessionId, lastRound, resumeCount per agent
// - Session Continuity section in overnight report with resume/fresh/invalidation stats
// - Version strings updated to v16
//
// v15 additions (S52 — priority scheduling, task decomposition, live dashboard):
// - Priority-based scheduling: agents with P1 tasks launch first in pool, bypass pre-flight checks
// - getAgentPriority(): scores agents by pending task priority for pool ordering
// - Task decomposition: subtask support in backlog (subtasks array, incremental assignment)
// - getNextSubtask()/completeSubtask(): subtask lifecycle management
// - Live progress dashboard: real-time agent status during pool execution
// - ProgressDashboard class: in-place terminal updates with ANSI codes
// - Version strings updated to v15
//
// v14 additions (S51 — quality & observability):
// - Agent effectiveness tracking: per-agent tasks-completed, tokens/file, success rate across rounds
// - Dynamic concurrency: adjusts maxConcurrency based on fast/slow agent mix from runtime history
// - Enhanced backlog depth guard: skip coordination agents when backlog empty + no handoff changes
// - Round Quality table in overnight report: utilization, files modified, cost per round
// - Agent Effectiveness table in overnight report: tokens/file, cost/task, productivity score
// - Version strings updated to v14
//
// v13 additions (S50 — experiment log + agent memory):
// - Experiment log: persistent JSON log of balance-config.ts changes and their outcomes
// - parseBalanceConfigDiff(): git diff parsing to auto-detect parameter changes
// - logExperiment(): records round, agent, params, pre/post sim spreads
// - buildExperimentContext(): last 10 experiments with IMPROVED/WORSENED/MIXED verdict
// - Injected into balance-analyst prompt as EXPERIMENT HISTORY section
// - processAgentResult returns balanceConfigChanged flag for experiment tracking
//
// v12 additions (S50 — prompt trimming + agent context optimization):
// - Balance context injection narrowed: full context only for balance-analyst + qa-engineer
// - claudeMdPath: per-agent CLAUDE.md override via temp-dir (non-engine agents get CLAUDE-lite.md)
// - Backlog description compression: first sentence only in prompt, "see backlog.json for details"
// - Agent runtime stats injection: continuous agents see their avg runtime + timeout
// - Path helper p(): auto-converts relative paths to absolute when using claudeMdPath temp dir
//
// v11 additions (S50 — parallel Phase B, quick wins):
// - Parallel Phase B: coordination agents run concurrently with tests + post-sims (20-25% throughput gain)
// - Producer overflow guard: skip producer when backlog has 5+ pending tasks
// - Smarter escalation guard: don't escalate when agent has no pending backlog tasks
// - Role template caching: loadRoleTemplate() reads from disk once, reuses across rounds
//
// v10 additions (S49 — adaptive timeouts, lookahead, incremental tests):
// - Adaptive timeouts: per-agent runtime history (last 5 runs), timeout = max(2*avg, 25%*config, 2min)
// - Multi-round lookahead: skip empty rounds when all agents idle, jump to next minFrequencyRounds activation
// - Incremental testing: source→test mapping, only run affected suites (full suite on round 1 + after revert)
//
// v9 additions (S48 — streaming pipeline):
// - Streaming agent pool (runAgentPool): queue-drain pattern, completion-order callbacks
// - Pipelined sims: pre-sims concurrent with Phase A, post-sims concurrent with tests
// - Extracted processAgentResult from duplicated Phase A/B blocks
// - Split timing: preSim/postSim tracked separately for pipeline visibility
//
// v8 additions (S47 — throughput & efficiency):
// - Backlog priority sorting (P1 tasks assigned first)
// - Smart per-agent revert (only revert failing agent's files, preserve others' work)
// - Multi-mission sequencing (chain missions: balance → polish → etc.)
// - Pre-flight checks (skip agents with no new work to react to)
// - Improved role templates (_common-rules scope limits, producer QA triggers)
//
// v7 Phase 4 additions (S43):
// - Parameter search framework: runParameterSearch(), buildParamSearchContext()
// - simulate.ts --override key=value support (in-memory balance config patching)
// - Pre-round parameter discovery phase (configurable via mission.balanceConfig.parameterSearch)
// - Search results injected into balance-analyst prompts as PARAMETER SEARCH RESULTS
// - Search configs: orchestrator/search-configs/*.json (quick-sweep, sensitivity-sweep, guard-tuning, unseated-tuning)
//
// v7 Phase 3 additions (S42):
// - generateBalanceBacklog() — auto-generates backlog tasks from sim data
// - getNextBacklogId() — collision-free BL-xxx ID generation
// - Auto-creates tasks for: outlier archetypes, matchup skews, regressions, QA companion
// - Updated role templates: balance-analyst, tech-lead, qa-engineer (balance-aware)
//
// v5 additions:
// - archiveCompletedTasks() at startup (keeps backlog lean)
// - dependsOn enforcement in getNextTask()
// - deferred backlog status (skipped by automation, awaiting human approval)
// - Session changelog generation
// - File ownership validation (post-round)
// - Agent output validation (catches silent failures)
// - Failed task reassignment (immediate on crash/timeout)
// - Consistency check at startup
//
// v6.1 additions (S35):
// - Prompt token estimation logging (Phase 4 cost analysis)
// - Smarter de-escalation (require 2 consecutive successes, not 1)
// - Empty work auto-escalation (3 consecutive empty rounds → trigger escalation)
// - Skip Phase B after auto-revert (prevent stale coordination)
// - Idle/wasted round metrics in efficiency report (from decision log)
// - Analysis rotation error logging (fix silent catch)
//
// v3 additions:
// - Mission config files (orchestrator/missions/*.json)
// - Role templates (orchestrator/roles/*.md)
// - Auto-generated initial handoffs from mission tasks
// - CLAUDE.md-aware prompts (shorter, less token waste)
//
// v2 features (retained):
// - Prompts piped via stdin (no Windows command line limit)
// - Orchestrator owns task board (no agent race conditions)
// - Orchestrator owns git commits (no parallel commit races)
// - Per-agent timeout (configurable, default 20 min)
// - Circuit breaker (stop after N consecutive test failures)
// - Max runtime (default 6 hours)
// - Recurring agents for continuous balance/quality work
// - Structured handoff META parsing
//
// Usage:
//   node orchestrator.mjs                              # Use default agents
//   node orchestrator.mjs missions/breaker-mechanic.json  # Load mission config
// ============================================================

import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, renameSync, mkdtempSync, rmSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
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

// v21: Dynamic agent spawning — agents request helpers via spawn request files
const SPAWNS_DIR = join(ORCH_DIR, 'spawns');
const SPAWN_CONSTRAINTS = {
  maxSpawnsPerRound: 3,
  maxSpawnsPerAgent: 1,
  maxConcurrentSpawns: 2,
  maxBudgetPerSpawn: 2.0,
  defaultModel: 'haiku',
  defaultTimeoutMs: 10 * 60 * 1000, // 10 min
  blockedRoles: new Set(['producer', 'tech-lead', 'game-designer']),
};

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
  enablePlugins: false,
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

// v8 bugfix: Snapshot CONFIG defaults so we can restore between sub-missions.
// Object.assign(CONFIG, mission.config) is additive — without this, mission 1's
// config properties would leak into mission 2 if not explicitly overridden.
const CONFIG_DEFAULTS = { ...CONFIG };

/**
 * Reset CONFIG to defaults, then apply overrides.
 * Used when transitioning between sub-missions in a sequence.
 */
function resetConfigToDefaults() {
  for (const key of Object.keys(CONFIG)) {
    CONFIG[key] = CONFIG_DEFAULTS[key];
  }
}

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

// ============================================================
// Backlog System (v4)
// ============================================================
const BACKLOG_FILE = join(ORCH_DIR, 'backlog.json');
const BACKLOG_ARCHIVE_FILE = join(ORCH_DIR, 'backlog-archive.json');

function loadBacklog() {
  if (!existsSync(BACKLOG_FILE)) return [];
  try { return JSON.parse(readFileSync(BACKLOG_FILE, 'utf-8')); }
  catch (_) { return []; }
}

function saveBacklog(tasks) {
  writeFileSync(BACKLOG_FILE, JSON.stringify(tasks, null, 2));
}

function getNextTask(role, agentId = null) {
  return getNextTasks(role, 1, agentId)[0] || null;
}

// v17: Match backlog task role against agent role OR agent id.
// Producer agents sometimes write agent IDs (e.g., "balance-tuner") instead of role names
// (e.g., "balance-analyst"). Matching both prevents tasks from stalling.
function taskMatchesAgent(task, role, agentId) {
  return task.role === role || (agentId && task.role === agentId);
}

function getNextTasks(role, maxTasks = 1, agentId = null) {
  const backlog = loadBacklog();
  const tasks = backlog
    .filter(t =>
      t.status === 'pending' && taskMatchesAgent(t, role, agentId) &&
      (!t.dependsOn?.length || t.dependsOn.every(depId => {
        const dep = backlog.find(d => d.id === depId);
        // If dep not found in active backlog, treat as satisfied (already archived)
        return !dep || dep.status === 'completed' || dep.status === 'done';
      }))
    )
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .slice(0, maxTasks);

  for (const task of tasks) { task.status = 'assigned'; }
  if (tasks.length) saveBacklog(backlog);
  return tasks;
}

function completeBacklogTask(taskId) {
  const backlog = loadBacklog();
  const task = backlog.find(t => t.id === taskId);
  if (task) {
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    saveBacklog(backlog);
  }
}

// v15: Subtask support — break large tasks into focused units of work.
// Tasks with a `subtasks` array get assigned one subtask at a time.
// Format: { id: "BL-077-1", title: "...", status: "pending"|"completed" }
function getNextSubtask(taskId) {
  const backlog = loadBacklog();
  const task = backlog.find(t => t.id === taskId);
  if (!task?.subtasks?.length) return null;
  return task.subtasks.find(st => st.status === 'pending') || null;
}

function completeSubtask(taskId, subtaskId) {
  const backlog = loadBacklog();
  const task = backlog.find(t => t.id === taskId);
  if (!task?.subtasks) return;
  const sub = task.subtasks.find(st => st.id === subtaskId);
  if (sub) {
    sub.status = 'completed';
    sub.completedAt = new Date().toISOString();
    // Auto-complete parent when all subtasks done
    const allDone = task.subtasks.every(st => st.status === 'completed');
    if (allDone) {
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      log(`  Backlog: ${taskId} auto-completed (all ${task.subtasks.length} subtasks done)`);
    }
    saveBacklog(backlog);
  }
}

// v15: Get highest-priority pending task priority for an agent's role (from cache).
// Returns numeric priority (1=P1, 2=P2, ... 99=none). Used to sort agents for pool launch order.
function getAgentTaskPriority(role, backlogCache, agentId = null) {
  const pending = backlogCache.filter(t => t.status === 'pending' && taskMatchesAgent(t, role, agentId));
  if (!pending.length) return 99;
  return Math.min(...pending.map(t => t.priority ?? 99));
}

// v15: Check if agent has a critical (P1) task waiting
function agentHasCriticalTask(role, backlogCache, agentId = null) {
  return backlogCache.some(t => t.status === 'pending' && taskMatchesAgent(t, role, agentId) && (t.priority ?? 99) <= 1);
}

function resetStaleAssignments() {
  const backlog = loadBacklog();
  let resetCount = 0;
  for (const task of backlog) {
    if (task.status === 'assigned') {
      task.status = 'pending';
      resetCount++;
    }
  }
  if (resetCount > 0) {
    saveBacklog(backlog);
    log(`Backlog: reset ${resetCount} stale "assigned" task(s) to "pending"`);
  }
}

function archiveCompletedTasks() {
  const backlog = loadBacklog();
  const completed = backlog.filter(t => t.status === 'completed' || t.status === 'done');
  if (!completed.length) return;

  // Load existing archive or create new
  let archive = [];
  if (existsSync(BACKLOG_ARCHIVE_FILE)) {
    try { archive = JSON.parse(readFileSync(BACKLOG_ARCHIVE_FILE, 'utf-8')); }
    catch (_) { archive = []; }
  }

  // Move completed tasks to archive
  archive.push(...completed);
  writeFileSync(BACKLOG_ARCHIVE_FILE, JSON.stringify(archive, null, 2));

  // Remove from active backlog
  const active = backlog.filter(t => t.status !== 'completed' && t.status !== 'done');
  saveBacklog(active);
  log(`Backlog: archived ${completed.length} completed task(s) (${active.length} remaining)`);
}

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
    maxTasksPerRound: a.maxTasksPerRound || 1,     // v6: batch task injection
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

// ============================================================
// Role Template Loading
// ============================================================
let commonRulesContent = '';

function loadCommonRules() {
  const rulesPath = join(ROLES_DIR, '_common-rules.md');
  if (existsSync(rulesPath)) {
    commonRulesContent = readFileSync(rulesPath, 'utf-8');
    log(`Loaded shared rules: ${commonRulesContent.split('\n').length} lines`);
  }
}

// v11: Role template cache — avoids re-reading the same template from disk every agent spawn
const roleTemplateCache = {};

function loadRoleTemplate(roleName) {
  if (!roleName) return '';
  if (roleTemplateCache[roleName] !== undefined) return roleTemplateCache[roleName];
  const rolePath = join(ROLES_DIR, `${roleName}.md`);
  if (!existsSync(rolePath)) {
    roleTemplateCache[roleName] = '';
    return '';
  }
  roleTemplateCache[roleName] = readFileSync(rolePath, 'utf-8');
  return roleTemplateCache[roleName];
}

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

// ============================================================
// Handoff META Parsing
// ============================================================
// Agents write structured META at the top of their handoff:
//   ## META
//   - status: all-done | complete | in-progress | blocked
//   - files-modified: file1.ts, file2.ts
//   - tests-passing: true | false | true (794 all) | 794
//   - notes-for-others: free text
//
// Status meanings:
//   in-progress — working on primary milestone
//   complete    — primary milestone done, satisfies dependencies, agent moves to stretch goals
//   all-done    — all tasks exhausted (primary + stretch), agent is retired
//   blocked     — waiting on dependency
//
// Parser is tolerant of:
//   - Case variations (e.g., "Files-Modified", "STATUS", "Tests-Passing")
//   - Extra whitespace and formatting variations
//   - Missing fields (sensible defaults returned)
//   - Non-standard values (logged as warnings, never crashes)
//
// Returns: { status, filesModified, testsPassing, notes,
//            testCount, notesForOthers, testsHealthy, fileCount }
//
function parseHandoffMeta(agentId) {
  const defaults = {
    status: 'not-started', filesModified: [], testsPassing: null, notes: '',
    testCount: null, notesForOthers: '', testsHealthy: null, fileCount: 0,
  };
  // v21: Check worktree path first (agent may have written handoff there, not yet merged to main)
  const wt = agentWorktrees[agentId];
  const wtHandoffPath = wt ? join(wt.path, 'orchestrator', 'handoffs', `${agentId}.md`) : null;
  const mainHandoffPath = join(HANDOFF_DIR, `${agentId}.md`);
  const path = (wtHandoffPath && existsSync(wtHandoffPath)) ? wtHandoffPath : mainHandoffPath;
  if (!existsSync(path)) return { ...defaults };

  let content;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (err) {
    log(`  WARNING: Could not read handoff for ${agentId}: ${err.message}`);
    return { ...defaults };
  }

  const meta = { ...defaults };

  try {
    // Case-insensitive matching with flexible whitespace (handles "Files-Modified", "files-modified", etc.)
    const statusMatch = content.match(/^-\s*status\s*:\s*(.+)$/im);
    if (statusMatch) meta.status = statusMatch[1].trim();

    const filesMatch = content.match(/^-\s*files[\s-]*modified\s*:\s*(.+)$/im);
    if (filesMatch) {
      meta.filesModified = filesMatch[1].split(',').map(f => f.trim()).filter(Boolean);
    }

    // tests-passing: handle "true", "false", "true (685 tests, 7 suites)", "true (667/667)", "794"
    const testsMatch = content.match(/^-\s*tests[\s-]*passing\s*:\s*(.+)$/im);
    if (testsMatch) {
      const raw = testsMatch[1].trim();
      // Determine boolean: starts with "true" → true, starts with "false" → false
      if (/^true\b/i.test(raw)) {
        meta.testsPassing = true;
      } else if (/^false\b/i.test(raw)) {
        meta.testsPassing = false;
      } else if (/^\d+$/.test(raw)) {
        // Bare number like "794" — assume passing
        meta.testsPassing = true;
      }
      // Extract numeric test count from patterns like "true (685 tests...)" or "true (667/667)" or bare "794"
      const countMatch = raw.match(/(\d+)/);
      if (countMatch) {
        meta.testCount = parseInt(countMatch[1], 10);
      }
    }

    const notesMatch = content.match(/^-\s*notes[\s-]*for[\s-]*others\s*:\s*(.+)$/im);
    if (notesMatch) {
      meta.notes = notesMatch[1].trim();
      meta.notesForOthers = meta.notes;
    }

    // v15: Parse completed-tasks from META for subtask completion tracking
    const completedMatch = content.match(/^-\s*completed[\s-]*tasks\s*:\s*(.+)$/im);
    if (completedMatch) {
      meta.completedTasks = completedMatch[1].split(',').map(t => t.trim()).filter(Boolean);
    } else {
      meta.completedTasks = [];
    }

    // --- Quality signals ---
    // testsHealthy: scan full handoff text for health indicators
    const lowerContent = content.toLowerCase();
    if (meta.testsPassing === true) {
      meta.testsHealthy = true;
    } else if (meta.testsPassing === false) {
      meta.testsHealthy = false;
    } else if (lowerContent.includes('all tests passing') || lowerContent.includes('all passing')) {
      meta.testsHealthy = true;
    } else if (lowerContent.includes('tests failing') || lowerContent.includes('test failure')) {
      meta.testsHealthy = false;
    }
    // else testsHealthy stays null (unknown)

    // fileCount: derived from filesModified
    meta.fileCount = meta.filesModified.length;

  } catch (err) {
    log(`  WARNING: Malformed META in handoff for ${agentId}: ${err.message}`);
    // Return what we have so far — meta has defaults for any unparsed fields
  }

  return meta;
}

// ============================================================
// Validation Functions
// ============================================================
function validateFileOwnership(agentResults, agents) {
  const violationLog = join(LOG_DIR, 'ownership-violations.log');
  for (const result of agentResults) {
    const agent = agents.find(a => a.id === result.agentId);
    if (!agent?.fileOwnership?.length) continue;
    const meta = parseHandoffMeta(result.agentId);
    for (const file of meta.filesModified) {
      // v6.1: Allow agents to write their own analysis/handoff files
      const isOwnAnalysis = file.startsWith(`orchestrator/analysis/${result.agentId}-`);
      const isOwnHandoff = file === `orchestrator/handoffs/${result.agentId}.md`;
      if (isOwnAnalysis || isOwnHandoff) continue;

      const owned = agent.fileOwnership.some(pattern => {
        if (pattern.includes('*')) {
          const prefix = pattern.split('*')[0];
          return file.startsWith(prefix);
        }
        return file === pattern;
      });
      if (!owned) {
        const msg = `[${timestamp()}] OWNERSHIP VIOLATION: ${result.agentId} modified ${file} (not in fileOwnership)`;
        log(`  ⚠ ${msg}`);
        appendFileSync(violationLog, msg + '\n');
      }
    }
  }
}

function validateAgentOutput(agentId, round, result = null) {
  const meta = parseHandoffMeta(agentId);
  const warnings = [];

  if (meta.status === 'not-started') {
    warnings.push(`${agentId}: Handoff not updated (still "not-started")`);
  }
  if (!meta.filesModified.length && meta.status === 'in-progress') {
    warnings.push(`${agentId}: Claims in-progress but no files modified`);
  }
  if (meta.testsPassing === false) {
    warnings.push(`${agentId}: Reports tests FAILING`);
  }

  // v5B: Detect empty work — agent exited OK but modified zero files and didn't update handoff
  let isEmptyWork = false;
  if (result && result.code === 0 && !result.timedOut) {
    const noFilesModified = !meta.filesModified.length || (meta.filesModified.length === 1 && meta.filesModified[0] === '(none yet)');
    const handoffNotUpdated = meta.status === 'not-started';
    if (noFilesModified && handoffNotUpdated) {
      isEmptyWork = true;
      warnings.push(`${agentId}: EMPTY WORK — exited OK but modified zero files and didn't update handoff (round ${round})`);
    }
  }

  return { warnings, isEmptyWork };
}

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

// ============================================================
// Task Board Generation (orchestrator-owned, agents only READ)
// ============================================================
function isDepSatisfied(status) {
  return status === 'complete' || status === 'all-done';
}

function generateTaskBoard(round, testStatus, consecutiveFailures) {
  const agentStatuses = AGENTS.map(agent => {
    const meta = parseHandoffMeta(agent.id);
    const depsMet = agent.dependsOn.every(depId => {
      const depMeta = parseHandoffMeta(depId);
      return isDepSatisfied(depMeta.status);
    });
    const effectiveStatus = meta.status === 'all-done' ? 'all-done'
      : meta.status === 'complete' ? 'complete (stretch goals)'
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
5. Run \`${getTestCommand()}\` before writing your final handoff to confirm tests pass
6. Write your updated handoff with the ## META section at the top

## Reference
See CLAUDE.md for file locations and architecture.
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

    // Load role template if available
    const roleTemplate = loadRoleTemplate(agent.role);

    // v21: Worktree lookup — used for cwd, prompt paths, and handoff reads
    const worktree = agentWorktrees[agent.id];

    // Build prompt — CLAUDE.md provides project context (auto-loaded by Claude Code)
    // so we only need coordination info + role guidelines + task reference
    // v12/v21: When using claudeMdPath (temp cwd), prefix paths with absolute project dir (or worktree)
    const projectBase = worktree ? worktree.path : MVP_DIR;
    const p = (relPath) => agent.claudeMdPath ? join(projectBase, relPath).replace(/\\/g, '/') : relPath;

    // v16: Session continuity — determine if this agent can resume a previous session
    const existingSession = agentSessions[agent.id];
    const isResuming = !!existingSession;

    let promptParts;
    if (isResuming) {
      // --- RESUME PROMPT: compact delta for returning agents ---
      // Agent retains full context from prior rounds (CLAUDE.md, role template, codebase understanding).
      // We only inject what's NEW: round number, changelog delta, current handoff, new tasks.
      promptParts = [
        `--- ROUND ${round} (resumed session) ---`,
        `You are "${agent.name}". Round ${round} (last ran round ${existingSession.lastRound}).`,
        `You have full context from your prior session — do NOT re-read CLAUDE.md or role guidelines.`,
        ``,
      ];

      // Inject changes by other agents since this agent's last round
      const changesSince = getChangelogSinceRound(existingSession.lastRound);
      if (changesSince) {
        promptParts.push(`--- CHANGES SINCE ROUND ${existingSession.lastRound} ---`, changesSince, ``);
      } else {
        promptParts.push(`No other agents made changes since your last round.`, ``);
      }

      // Inline current handoff (may have been updated by orchestrator since agent's last write)
      const handoffContent = readHandoffContent(agent.id);
      if (handoffContent) {
        promptParts.push(`--- YOUR CURRENT HANDOFF ---`, handoffContent, ``);
      }

      promptParts.push(
        `Do your work. Update handoff: ${p(`orchestrator/handoffs/${agent.id}.md`)}`,
        `RULES: No git. No editing task-board.md. No editing other agents' files. Run tests before handoff.`,
        agent.type === 'continuous'
          ? `Write analysis to ${p(`orchestrator/analysis/${agent.id}-round-${round}.md`)}`
          : `Mark "complete" when primary milestone done, "all-done" when stretch goals done too.`,
      );

    } else {
      // --- FRESH PROMPT: full context for first-run agents ---
      promptParts = [
        `You are "${agent.name}", part of a multi-agent team. Round ${round}.`,
        `Project context is in CLAUDE.md (auto-loaded).`,
        agent.claudeMdPath ? `Project files are at: ${MVP_DIR.replace(/\\/g, '/')}` : null,
        ``,
        `READ FIRST:`,
        `1. ${p('orchestrator/session-changelog.md')} (what changed this session so far)`,
        `2. ${p('orchestrator/task-board.md')} (coordination status — DO NOT edit)`,
      ].filter(Boolean);

      // Add design doc reference if mission specifies one
      if (missionDesignDoc) {
        promptParts.push(`3. ${p(missionDesignDoc)} (design reference)`);
      }

      // v16: Inline handoff content (saves a Read tool call on agent startup)
      const handoffContent = readHandoffContent(agent.id);
      if (handoffContent) {
        promptParts.push(``, `--- YOUR CURRENT HANDOFF (${p(`orchestrator/handoffs/${agent.id}.md`)}) ---`, handoffContent);
      } else {
        promptParts.push(`3. ${p(`orchestrator/handoffs/${agent.id}.md`)} (your tasks and progress)`);
      }

      promptParts.push(
        ``,
        `Then do your work. When done, write updated handoff to ${p(`orchestrator/handoffs/${agent.id}.md`)}.`,
        ``,
        `HANDOFF FORMAT (top of file):`,
        `## META`,
        `- status: in-progress | complete | all-done`,
        `- files-modified: comma-separated list`,
        `- tests-passing: true | false`,
        `- notes-for-others: messages for other agents`,
        ``,
        `Status: in-progress (working) → complete (primary done, unblocks others, do stretch goals) → all-done (everything done, retired)`,
        `Include: ## What Was Done, ## What's Left, ## Issues`,
        ``,
        `RULES: No git. No editing task-board.md. No editing other agents' files. Run tests before handoff.`,
        agent.type === 'continuous'
          ? `You are CONTINUOUS — write analysis to ${p(`orchestrator/analysis/${agent.id}-round-${round}.md`)}`
          : `You are FEATURE — mark "complete" when primary milestone done, "all-done" when stretch goals done too.`,
      );
    }

    // v12: Inject runtime stats for continuous agents (helps agents self-regulate pacing)
    if (agent.type === 'continuous') {
      const history = agentRuntimeHistory[agent.id];
      if (history?.length) {
        const avgSec = history.reduce((a, b) => a + b, 0) / history.length;
        const timeoutMs = getAdaptiveTimeout(agent);
        promptParts.push(
          `Your recent performance: avg ${(avgSec / 60).toFixed(1)}min over ${history.length} run(s), timeout ${(timeoutMs / 60000).toFixed(1)}min. Stay focused to finish within budget.`,
        );
      }
    }

    // v5/v6: Inject batch backlog tasks if available
    // v12: Truncate descriptions to first sentence to reduce prompt bloat
    // v15: Subtask support — when a task has subtasks, assign only the next incomplete one
    const backlogTasks = getNextTasks(agent.role, agent.maxTasksPerRound || 1, agent.id);
    if (backlogTasks.length) {
      promptParts.push(``, `--- BACKLOG TASKS (from producer) ---`);
      for (let i = 0; i < backlogTasks.length; i++) {
        const bt = backlogTasks[i];
        // v15: Check for subtasks — assign only the next incomplete subtask
        const nextSub = getNextSubtask(bt.id);
        if (nextSub) {
          const totalSubs = bt.subtasks.length;
          const completedSubs = bt.subtasks.filter(s => s.status === 'completed').length;
          promptParts.push(
            `Task ${i + 1} of ${backlogTasks.length}: ${bt.id} (P${bt.priority}) — ${bt.title}`,
            `  SUBTASK ${completedSubs + 1}/${totalSubs}: ${nextSub.id} — ${nextSub.title}`,
            `  Description: ${nextSub.description || ''}`,
            `  Focus ONLY on this subtask. Note subtask ID ${nextSub.id} in handoff META under completed-tasks.`,
            `Files: ${(bt.fileOwnership || []).join(', ')}`,
          );
        } else {
          // v12: First sentence only (up to first period+space or newline)
          const shortDesc = bt.description
            ? bt.description.split(/(?<=\.)\s|\n/)[0]
            : '';
          promptParts.push(
            `Task ${i + 1} of ${backlogTasks.length}: ${bt.id} (P${bt.priority}) — ${bt.title}`,
            `Description: ${shortDesc}`,
            `Files: ${(bt.fileOwnership || []).join(', ')}`,
          );
        }
      }
      promptParts.push(`Work through these in order. See ${p('orchestrator/backlog.json')} for full task details. Note completed task IDs in handoff META under completed-tasks.`);
    }

    // v12: Balance context — full injection only for balance-analyst and qa-engineer.
    // Other roles get a 1-line pointer to avoid prompt bloat.
    const BALANCE_FULL_ROLES = ['balance-analyst', 'qa-engineer'];
    if (CONFIG.balanceConfig && BALANCE_FULL_ROLES.includes(agent.role)) {
      const balanceCtx = buildBalanceContext();
      if (balanceCtx) {
        promptParts.push(
          ``,
          `--- BALANCE CONTEXT (auto-generated from orchestrator sims — DO NOT run your own sims) ---`,
          balanceCtx,
          `Use this data for analysis. The orchestrator runs sims before/after each round automatically.`,
        );
      }
    } else if (CONFIG.balanceConfig) {
      promptParts.push(
        ``,
        `Balance data available in ${p('orchestrator/balance-state.json')} if needed (run \`cat ${p('orchestrator/balance-state.json')}\` to read).`,
      );
    }

    // v7 Phase 4: Inject parameter search results (if available)
    if (paramSearchResults && agent.role === 'balance-analyst') {
      const searchCtx = buildParamSearchContext();
      if (searchCtx) {
        promptParts.push(
          ``,
          `--- PARAMETER SEARCH RESULTS (auto-generated — use for informed parameter changes) ---`,
          searchCtx,
          `Use these results to prioritize which parameters to adjust. Prefer changes the search identifies as improvements.`,
        );
      }
    }

    // v13: Inject experiment history (what has been tried and outcomes)
    if (agent.role === 'balance-analyst') {
      const experimentCtx = buildExperimentContext();
      if (experimentCtx) {
        promptParts.push(
          ``,
          `--- EXPERIMENT HISTORY (auto-generated — what previous rounds tried and the outcomes) ---`,
          experimentCtx,
        );
      }
    }

    // v21: Spawn notifications (previous round's spawned agent results)
    if (round > 1) {
      const spawnNotif = getSpawnNotifications(agent.id, round - 1);
      if (spawnNotif) {
        promptParts.push(``, `--- SPAWNED AGENT RESULTS (from previous round) ---`, spawnNotif);
      }
    }

    // v21: Spawn instructions for code agents (not spawned agents themselves)
    if (agent.type !== 'spawned' && !isResuming) {
      promptParts.push(
        ``,
        `--- AGENT SPAWNING (optional) ---`,
        `Need a helper for a complex subtask? Write a JSON file to orchestrator/spawns/:`,
        `  File: orchestrator/spawns/spawn-${agent.id}-{any-unique-suffix}.json`,
        `  Format: { "parentId": "${agent.id}", "role": "<role>", "name": "<name>",`,
        `    "task": "<detailed description>", "fileOwnership": ["<files>"],`,
        `    "model": "haiku", "maxBudgetUsd": 1.0 }`,
        `  Roles: qa-engineer, engine-dev, ui-dev, css-artist, test-generator, security-auditor.`,
        `  Helper runs this round only. Max 1 spawn per agent per round.`,
      );
    }

    // v21: Spawned agent gets its task as the primary prompt directive
    if (agent._spawnTask) {
      promptParts.push(
        ``,
        `--- YOUR TASK (spawned by ${agent._spawnedBy}) ---`,
        agent._spawnTask,
        agent._spawnContext ? `Context: ${JSON.stringify(agent._spawnContext)}` : '',
        `You are a one-shot helper agent. Complete this task, run tests, and write your handoff.`,
      );
    }

    // v16: Shared rules and role template — skip for resumed sessions.
    // Returning agents already have these from their initial session.
    if (!isResuming) {
      if (commonRulesContent) {
        promptParts.push(``, `--- SHARED RULES ---`, commonRulesContent);
      }
      if (roleTemplate) {
        promptParts.push(``, `--- ROLE GUIDELINES ---`, roleTemplate);
      }
    }

    const prompt = promptParts.join('\n');

    // v6.1: Log estimated prompt tokens for Phase 4 cost analysis
    const estimatedTokens = Math.ceil(prompt.length / 4);
    const sessionMode = isResuming ? 'resume' : 'fresh';
    log(`  Starting ${agent.id}... (~${estimatedTokens} prompt tokens, model=${agent.model || 'default'}, session=${sessionMode})`);
    // v22: Emit agent start event
    if (obs) obs.events.emit('agent:start', { agentId: agent.id, round, model: agent.model || 'default', sessionMode, estimatedTokens });
    const startTime = Date.now();

    // v21: worktreeBase = worktree path (for code agents) or MVP_DIR (for coord agents / no worktree)
    const worktreeBase = worktree ? worktree.path : MVP_DIR;

    // v12: Per-agent CLAUDE.md override — create temp dir with trimmed CLAUDE.md
    // so the CLI auto-loads the lite version. Use --add-dir for project file access.
    let agentCwd = worktreeBase;
    let tempDir = null;
    if (agent.claudeMdPath) {
      const litePath = join(worktreeBase, agent.claudeMdPath);
      if (existsSync(litePath)) {
        tempDir = mkdtempSync(join(tmpdir(), `orch-${agent.id}-`));
        copyFileSync(litePath, join(tempDir, 'CLAUDE.md'));
        agentCwd = tempDir;
        log(`    using ${agent.claudeMdPath} (temp dir: ${tempDir})`);
      }
    }

    if (worktree) {
      log(`    worktree: ${worktree.branch} → ${worktree.path}`);
    }

    // v5/v6: Build CLI args with optional per-agent model + budget
    // v19: Per-agent allowedTools override (falls back to CONFIG.allowedTools)
    const agentTools = agent.allowedTools || CONFIG.allowedTools;
    const cliArgs = ['-p', '--allowedTools', agentTools, '--output-format', 'text'];
    if (agent.model) cliArgs.push('--model', agent.model);
    if (agent.maxBudgetUsd) cliArgs.push('--max-budget-usd', String(agent.maxBudgetUsd));
    // v12/v21: When using temp dir, grant access to actual project (worktree or MVP_DIR)
    if (tempDir) cliArgs.push('--add-dir', worktreeBase);

    // v16: Session continuity — resume existing session or establish new one
    if (isResuming) {
      cliArgs.push('--resume', existingSession.sessionId);
    } else {
      const sessionId = randomUUID();
      agentSessions[agent.id] = { sessionId, lastRound: round, resumeCount: 0, freshCount: 1, invalidations: 0 };
      cliArgs.push('--session-id', sessionId);
    }

    // Spawn claude with prompt piped via stdin (avoids Windows cmd length limit)
    const proc = spawn('claude', cliArgs, {
      cwd: agentCwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    activeProcs.add(proc.pid);

    // v10: Adaptive timeout — 2x average runtime, capped at configured max
    const timeout = getAdaptiveTimeout(agent);
    const configTimeout = agent.timeoutMs || CONFIG.agentTimeoutMs;
    const isAdapted = timeout < configTimeout;
    if (isAdapted) {
      const history = agentRuntimeHistory[agent.id] || [];
      const avgMin = history.length ? ((history.reduce((a, b) => a + b, 0) / history.length) / 60).toFixed(1) : '?';
      log(`    adaptive timeout: ${(timeout / 60000).toFixed(1)}min (avg ${avgMin}min, max ${(configTimeout / 60000).toFixed(0)}min)`);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      log(`  ${agent.id} TIMED OUT after ${(timeout / 60000).toFixed(1)} minutes — killing process tree (PID ${proc.pid})`);
      killProcessTree(proc.pid);
    }, timeout);

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

    // v12: Helper to clean up temp dir after agent finishes
    const cleanupTempDir = () => {
      if (tempDir) {
        try { rmSync(tempDir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
      }
    };

    proc.on('close', (code) => {
      clearTimeout(timer);
      activeProcs.delete(proc.pid);
      cleanupTempDir();
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const elapsedMin = (elapsed / 60).toFixed(1);
      const status = timedOut ? 'TIMEOUT' : code === 0 ? 'OK' : `EXIT-${code}`;
      log(`  ${agent.id} finished: ${status} (${elapsedMin} min, session=${sessionMode})`);
      // v22: Emit agent completion event + record metrics
      if (obs) {
        const eventName = (code === 0 && !timedOut) ? 'agent:complete' : 'agent:error';
        obs.events.emit(eventName, { agentId: agent.id, round, status, elapsedMs: elapsed * 1000, sessionMode });
        obs.metrics.recordAgentRun(agent.id, { elapsedMs: elapsed * 1000, model: agent.model || 'default', success: code === 0 && !timedOut, round });
      }

      // v16: Update session tracking after agent completes
      if (code === 0 && !timedOut && agentSessions[agent.id]) {
        // Success — update last round for next resume
        agentSessions[agent.id].lastRound = round;
        if (isResuming) agentSessions[agent.id].resumeCount++;
      } else if (isResuming && elapsed < 30 && code !== 0) {
        // Very short failure during resume — likely session issue (expired, corrupted)
        invalidateAgentSession(agent.id, `resume failure (${elapsed}s, code=${code})`);
      }

      resolvePromise({ agentId: agent.id, code, timedOut, elapsed, stdout, stderr, wasResumed: isResuming });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      activeProcs.delete(proc.pid);
      cleanupTempDir();
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
// Git Tagging & Revert (v5 Phase 7)
// ============================================================
function tagRoundStart(round) {
  return new Promise((resolvePromise) => {
    const tag = `round-${round}-start`;
    const cmd = `git tag -f ${tag}`;
    const proc = spawn('cmd', ['/c', cmd], {
      cwd: MVP_DIR,
      shell: true,
      stdio: 'pipe',
    });
    proc.on('close', (code) => {
      if (code === 0) log(`  Git tag created: ${tag}`);
      else log(`  Git tag failed (code ${code}) — continuing without tag`);
      resolvePromise();
    });
    proc.on('error', () => resolvePromise());
  });
}

function gitRevertToTag(round) {
  return gitRevertFiles(round, ['src/']);
}

/**
 * Revert specific files to a round's start tag.
 * @param {number} round - Round number (used to find the git tag)
 * @param {string[]} files - File paths or directories to revert
 * @returns {Promise<boolean>} Whether the revert succeeded
 */
function gitRevertFiles(round, files) {
  return new Promise((resolvePromise) => {
    const tag = `round-${round}-start`;
    const escaped = files.map(f => `"${f}"`).join(' ');
    const cmd = `git checkout ${tag} -- ${escaped}`;
    const proc = spawn('cmd', ['/c', cmd], {
      cwd: MVP_DIR,
      shell: true,
      stdio: 'pipe',
    });
    let stderr = '';
    proc.stderr?.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        log(`  Reverted ${files.length} path(s) to tag ${tag}`);
      } else {
        log(`  Revert to tag ${tag} failed (code ${code}): ${stderr.slice(0, 200)}`);
      }
      resolvePromise(code === 0);
    });
    proc.on('error', () => resolvePromise(false));
  });
}

/**
 * Smart revert: try per-agent revert first, fall back to full src/ revert.
 * Identifies which agents' files broke tests and reverts only those.
 * @param {number} round
 * @param {Array} codeResults - Results from Phase A agent runs
 * @returns {Promise<{reverted: boolean, strategy: string, revertedAgents: string[]}>}
 */
async function smartRevert(round, codeResults) {
  // Collect files modified by each agent this round
  const agentFiles = {};
  for (const r of codeResults) {
    const meta = parseHandoffMeta(r.agentId);
    const files = meta.filesModified.filter(f => f && f !== '(none yet)');
    if (files.length) agentFiles[r.agentId] = files;
  }

  const agentIds = Object.keys(agentFiles);

  // v8 bugfix: If no agents claimed modified files, skip per-agent logic and do full revert
  if (agentIds.length === 0) {
    log(`  Smart revert: no agents reported modified files — full src/ revert`);
    const ok = await gitRevertFiles(round, ['src/']);
    return { reverted: ok, strategy: 'full', revertedAgents: [] };
  }

  if (agentIds.length === 1) {
    // Only one agent modified files — full revert is the same as per-agent
    log(`  Smart revert: only 1 agent modified files — full src/ revert`);
    const ok = await gitRevertFiles(round, ['src/']);
    return { reverted: ok, strategy: 'full', revertedAgents: agentIds };
  }

  // Multiple agents: try reverting each agent's files individually,
  // test after each to find the culprit.
  // v8: Cap at 2 per-agent test runs to avoid O(N) test suite runs. After 2 attempts,
  // fall back to full src/ revert (each test suite run adds ~2s but could be more).
  const MAX_PER_AGENT_TESTS = 2;
  log(`  Smart revert: ${agentIds.length} agents modified files — testing individually (max ${MAX_PER_AGENT_TESTS})...`);
  const revertedAgents = [];

  for (const agentId of agentIds) {
    // v8: Cap per-agent test runs to avoid expensive O(N) test suite invocations
    if (revertedAgents.length >= MAX_PER_AGENT_TESTS) {
      log(`  Smart revert: hit cap (${MAX_PER_AGENT_TESTS} per-agent tests) — falling back to full revert`);
      await gitRevertFiles(round, ['src/']);
      return { reverted: true, strategy: 'full-capped', revertedAgents: agentIds };
    }

    const files = agentFiles[agentId];
    log(`    Reverting ${agentId}'s files: ${files.join(', ')}`);
    const ok = await gitRevertFiles(round, files);
    if (!ok) {
      log(`    Failed to revert ${agentId}'s files — falling back to full revert`);
      await gitRevertFiles(round, ['src/']);
      return { reverted: true, strategy: 'full-fallback', revertedAgents: agentIds };
    }
    revertedAgents.push(agentId);

    // Test after this agent's revert
    const testResult = await runTests();
    if (testResult.passed) {
      log(`  Smart revert: tests pass after reverting ${revertedAgents.join(', ')} — keeping other agents' work`);
      return { reverted: true, strategy: 'per-agent', revertedAgents };
    }
  }

  // All agents reverted individually but tests still fail — shouldn't happen, but full revert as safety
  log(`  Smart revert: all agents reverted individually but tests still fail — full src/ revert`);
  await gitRevertFiles(round, ['src/']);
  return { reverted: true, strategy: 'full-safety', revertedAgents: agentIds };
}

// v16: Invalidate sessions for all reverted agents (their context references reverted code)
function invalidateRevertedSessions(revertedAgents) {
  for (const agentId of revertedAgents) {
    invalidateAgentSession(agentId, 'files reverted');
  }
}

// ============================================================
// Git Worktree Isolation (v21 — Phase 3: Scale)
// ============================================================
// Each code agent gets its own git worktree + branch, preventing cross-agent
// file conflicts during parallel execution. After the pool completes, worktree
// branches are merged back into main sequentially before testing.
// Coordination agents stay in MVP_DIR (they only edit orchestrator/ files).

/**
 * Execute a git command and return { ok, stdout, stderr }.
 * Centralizes the spawn('cmd', ['/c', ...]) pattern used throughout.
 */
function gitExec(cmd, cwd = MVP_DIR) {
  return new Promise((resolve) => {
    const proc = spawn('cmd', ['/c', cmd], { cwd, shell: true, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() }));
    proc.on('error', (err) => resolve({ ok: false, code: -1, stdout: '', stderr: err.message }));
  });
}

/**
 * Create a git worktree for an agent.
 * Branch: agent-{agentId}-r{round}, path: orchestrator/.worktrees/{agentId}
 * @returns {Promise<boolean>} Whether the worktree was created successfully
 */
async function createWorktree(agentId, round) {
  const branch = `agent-${agentId}-r${round}`;
  const wtPath = join(WORKTREE_DIR, agentId);

  // Clean up any leftover worktree from a previous round
  if (agentWorktrees[agentId]) {
    await removeWorktree(agentId);
  }

  // Ensure worktree parent dir exists
  mkdirSync(WORKTREE_DIR, { recursive: true });

  // Remove stale worktree directory if it exists (e.g. from a crash)
  if (existsSync(wtPath)) {
    await gitExec(`git worktree remove "${wtPath}" --force`);
    // Fallback: if git worktree remove fails, force-delete the directory
    if (existsSync(wtPath)) {
      try { rmSync(wtPath, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
    }
  }

  // Delete branch if leftover from previous round
  await gitExec(`git branch -D "${branch}" 2>nul`);

  // Create worktree with new branch from current HEAD
  const result = await gitExec(`git worktree add "${wtPath}" -b "${branch}"`);
  if (!result.ok) {
    log(`  ⚠ Worktree creation failed for ${agentId}: ${result.stderr.slice(0, 200)}`);
    return false;
  }

  agentWorktrees[agentId] = { path: wtPath, branch, round };
  log(`  Worktree created: ${agentId} → ${branch}`);
  return true;
}

/**
 * Merge an agent's worktree branch back into the main branch.
 * Must be called from the main working tree (MVP_DIR).
 * @returns {Promise<{ok: boolean, conflicted: boolean, mergeCommit?: string}>}
 */
async function mergeWorktreeBranch(agentId) {
  const wt = agentWorktrees[agentId];
  if (!wt) return { ok: false, conflicted: false };

  const result = await gitExec(`git merge "${wt.branch}" --no-edit -m "worktree merge: ${agentId} (round ${wt.round})"`);
  if (result.ok) {
    // Get the merge commit SHA
    const head = await gitExec('git rev-parse HEAD');
    return { ok: true, conflicted: false, mergeCommit: head.stdout };
  }

  // Merge conflict — abort and report
  if (result.stderr.includes('CONFLICT') || result.stderr.includes('Merge conflict')) {
    log(`  ⚠ Merge conflict for ${agentId} — aborting merge`);
    await gitExec('git merge --abort');
    return { ok: false, conflicted: true };
  }

  // Other merge failure
  log(`  ⚠ Merge failed for ${agentId}: ${result.stderr.slice(0, 200)}`);
  await gitExec('git merge --abort');
  return { ok: false, conflicted: false };
}

/**
 * Remove a single agent's worktree and delete its branch.
 */
async function removeWorktree(agentId) {
  const wt = agentWorktrees[agentId];
  if (!wt) return;

  await gitExec(`git worktree remove "${wt.path}" --force`);
  // Fallback cleanup if git worktree remove doesn't fully clean up
  if (existsSync(wt.path)) {
    try { rmSync(wt.path, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
  await gitExec(`git branch -D "${wt.branch}" 2>nul`);
  delete agentWorktrees[agentId];
}

/**
 * Remove all active worktrees (round-end cleanup).
 */
async function cleanupAllWorktrees() {
  const ids = Object.keys(agentWorktrees);
  if (!ids.length) return;

  log(`  Cleaning up ${ids.length} worktree(s)...`);
  for (const agentId of ids) {
    await removeWorktree(agentId);
  }

  // Prune stale worktree references
  await gitExec('git worktree prune');
}

/**
 * Get the current HEAD commit SHA (used as checkpoint before merges).
 */
async function getHeadSha() {
  const result = await gitExec('git rev-parse HEAD');
  return result.ok ? result.stdout : null;
}

/**
 * Smart revert for worktree-based rounds.
 * After merging all agent branches, if tests fail:
 * 1. Reset to preMergeHead (undo all merges)
 * 2. Re-merge agents one at a time, testing after each (up to cap)
 * 3. Agents whose merges break tests are excluded (reverted)
 *
 * @param {number} round
 * @param {Array} codeResults - Agent results with merge tracking
 * @param {string} preMergeHead - Commit SHA before any merges
 * @param {Array<{agentId: string, ok: boolean}>} mergeResults - Which agents were merged
 * @returns {Promise<{reverted: boolean, strategy: string, revertedAgents: string[]}>}
 */
async function smartRevertWorktrees(round, codeResults, preMergeHead, mergeResults) {
  const mergedAgents = mergeResults.filter(m => m.ok).map(m => m.agentId);

  if (mergedAgents.length === 0) {
    log(`  Worktree revert: no agents were merged — nothing to revert`);
    return { reverted: false, strategy: 'none', revertedAgents: [] };
  }

  // Reset to pre-merge state
  log(`  Worktree revert: resetting to pre-merge HEAD (${preMergeHead.slice(0, 8)})`);
  const resetResult = await gitExec(`git reset --hard "${preMergeHead}"`);
  if (!resetResult.ok) {
    log(`  ⚠ Reset failed: ${resetResult.stderr.slice(0, 200)} — falling back to tag revert`);
    await gitRevertFiles(round, ['src/']);
    return { reverted: true, strategy: 'full-tag-fallback', revertedAgents: mergedAgents };
  }

  if (mergedAgents.length === 1) {
    // Only one agent — already reset, done
    log(`  Worktree revert: single agent (${mergedAgents[0]}) — reset complete`);
    return { reverted: true, strategy: 'full-reset', revertedAgents: mergedAgents };
  }

  // Multiple agents: re-merge one at a time, test after each to find the culprit
  const MAX_REMERGE_TESTS = 2;
  const revertedAgents = [];
  const keptAgents = [];

  log(`  Worktree revert: ${mergedAgents.length} agents — re-merging individually (max ${MAX_REMERGE_TESTS} tests)...`);

  for (const agentId of mergedAgents) {
    if (keptAgents.length >= MAX_REMERGE_TESTS) {
      // Hit the cap — skip remaining agents (treat as reverted)
      log(`  Worktree revert: hit re-merge cap (${MAX_REMERGE_TESTS}) — skipping remaining agents`);
      revertedAgents.push(agentId);
      continue;
    }

    const wt = agentWorktrees[agentId];
    if (!wt) {
      revertedAgents.push(agentId);
      continue;
    }

    // Try merging this agent
    const mergeResult = await mergeWorktreeBranch(agentId);
    if (!mergeResult.ok) {
      log(`    ${agentId}: merge failed on re-merge — skipping`);
      revertedAgents.push(agentId);
      continue;
    }

    // Test after this merge
    const testResult = await runTests();
    if (testResult.passed) {
      log(`    ${agentId}: tests pass after re-merge — keeping`);
      keptAgents.push(agentId);
    } else {
      // This agent's code broke tests — undo its merge
      log(`    ${agentId}: tests fail after re-merge — reverting`);
      const currentHead = await getHeadSha();
      // Reset to before this merge (one commit back)
      await gitExec(`git reset --hard HEAD~1`);
      revertedAgents.push(agentId);
    }
  }

  const strategy = revertedAgents.length === mergedAgents.length ? 'full-reset' : 'selective-remerge';
  log(`  Worktree revert: kept ${keptAgents.length}, reverted ${revertedAgents.length} (strategy: ${strategy})`);
  return { reverted: true, strategy, revertedAgents };
}

// ============================================================
// Dynamic Agent Spawning (v21 — Phase 3: Scale)
// ============================================================
// Agents can request helper sub-agents by writing spawn request files.
// Spawn requests are detected after the code agent pool completes,
// spawned agents run (with worktrees), then all get merged before testing.

/**
 * Scan for spawn requests — checks worktrees first (agents write there),
 * then the main spawns directory.
 * @returns {Array} Array of parsed spawn request objects
 */
function detectSpawnRequests() {
  const requests = [];
  const seen = new Set();

  // Check agent worktrees for spawn requests (pre-merge)
  for (const [agentId, wt] of Object.entries(agentWorktrees)) {
    const wtSpawns = join(wt.path, 'orchestrator', 'spawns');
    if (!existsSync(wtSpawns)) continue;
    for (const file of readdirSync(wtSpawns)) {
      if (!file.startsWith('spawn-') || !file.endsWith('.json') || seen.has(file)) continue;
      try {
        const content = readFileSync(join(wtSpawns, file), 'utf-8');
        const req = JSON.parse(content);
        req._filename = file;
        req._sourcePath = join(wtSpawns, file);
        requests.push(req);
        seen.add(file);
      } catch (err) {
        log(`  ⚠ Invalid spawn request ${file} in ${agentId} worktree: ${err.message}`);
      }
    }
  }

  // Check main spawns dir (fallback for non-worktree agents)
  if (existsSync(SPAWNS_DIR)) {
    for (const file of readdirSync(SPAWNS_DIR)) {
      if (!file.startsWith('spawn-') || !file.endsWith('.json') || seen.has(file)) continue;
      // Skip archive directory
      if (file === 'archive') continue;
      try {
        const content = readFileSync(join(SPAWNS_DIR, file), 'utf-8');
        const req = JSON.parse(content);
        req._filename = file;
        req._sourcePath = join(SPAWNS_DIR, file);
        requests.push(req);
        seen.add(file);
      } catch (err) {
        log(`  ⚠ Invalid spawn request ${file}: ${err.message}`);
      }
    }
  }

  return requests;
}

/**
 * Validate a spawn request against constraints.
 * @returns {{valid: boolean, reason?: string}}
 */
function validateSpawnRequest(request, spawnCountThisRound, parentSpawnCount) {
  if (spawnCountThisRound >= SPAWN_CONSTRAINTS.maxSpawnsPerRound) {
    return { valid: false, reason: `round limit (${SPAWN_CONSTRAINTS.maxSpawnsPerRound})` };
  }
  if (parentSpawnCount >= SPAWN_CONSTRAINTS.maxSpawnsPerAgent) {
    return { valid: false, reason: `per-agent limit (${SPAWN_CONSTRAINTS.maxSpawnsPerAgent})` };
  }
  if (SPAWN_CONSTRAINTS.blockedRoles.has(request.role)) {
    return { valid: false, reason: `role '${request.role}' blocked` };
  }
  if (!request.parentId || !request.role || !request.task) {
    return { valid: false, reason: 'missing required fields (parentId, role, task)' };
  }
  if ((request.maxBudgetUsd || 0) > SPAWN_CONSTRAINTS.maxBudgetPerSpawn) {
    return { valid: false, reason: `budget $${request.maxBudgetUsd} > max $${SPAWN_CONSTRAINTS.maxBudgetPerSpawn}` };
  }
  return { valid: true };
}

/**
 * Archive a processed spawn request (move to spawns/archive/).
 */
function archiveSpawnRequest(sourcePath, filename) {
  const archiveDir = join(SPAWNS_DIR, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  try {
    // Copy to archive (source may be in worktree that gets cleaned up)
    const content = readFileSync(sourcePath, 'utf-8');
    writeFileSync(join(archiveDir, filename), content);
    // Remove original if in main tree
    if (sourcePath.startsWith(SPAWNS_DIR)) {
      try { rmSync(sourcePath); } catch (_) { /* ok */ }
    }
  } catch (_) { /* best-effort */ }
}

/**
 * Detect spawn requests and execute spawned agents.
 * Called after code agents complete, before worktree merge.
 * Spawned agents get their own worktrees and run inline.
 *
 * @param {number} round
 * @param {Array} codeResults - Parent agent results
 * @param {Object} costLog - Cost tracking
 * @param {Object} trackingCtx - Tracking context
 * @returns {Promise<Array>} Results from spawned agents
 */
async function detectAndSpawnAgents(round, codeResults, costLog, trackingCtx) {
  const requests = detectSpawnRequests();
  if (!requests.length) return [];

  log(`\n  Spawn requests: ${requests.length} detected`);

  // Validate and filter
  const validRequests = [];
  const parentCounts = {};

  for (const req of requests) {
    parentCounts[req.parentId] = (parentCounts[req.parentId] || 0);
    const validation = validateSpawnRequest(req, validRequests.length, parentCounts[req.parentId]);
    if (!validation.valid) {
      log(`    ✗ ${req.parentId} → ${req.name || req.role}: ${validation.reason}`);
      archiveSpawnRequest(req._sourcePath, req._filename);
      continue;
    }
    parentCounts[req.parentId]++;
    validRequests.push(req);
  }

  if (!validRequests.length) return [];

  // Build and run spawned agents
  const spawnedResults = [];
  const limit = SPAWN_CONSTRAINTS.maxConcurrentSpawns;

  for (let i = 0; i < validRequests.length; i += limit) {
    const batch = validRequests.slice(i, i + limit);
    const names = batch.map(r => `${r.name || r.role}(by:${r.parentId})`);
    log(`  Spawning ${batch.length} agent(s): [${names.join(', ')}]`);

    const promises = batch.map(async (req) => {
      const spawnId = `spawn-${randomUUID().slice(0, 8)}`;
      const agent = {
        id: spawnId,
        name: req.name || `${req.role} helper`,
        role: req.role,
        type: 'spawned',
        model: req.model || SPAWN_CONSTRAINTS.defaultModel,
        timeoutMs: Math.min(req.timeoutMs || SPAWN_CONSTRAINTS.defaultTimeoutMs, SPAWN_CONSTRAINTS.defaultTimeoutMs),
        maxBudgetUsd: Math.min(req.maxBudgetUsd || SPAWN_CONSTRAINTS.maxBudgetPerSpawn, SPAWN_CONSTRAINTS.maxBudgetPerSpawn),
        fileOwnership: req.fileOwnership || [],
        dependsOn: [],
        _spawnedBy: req.parentId,
        _spawnedRound: round,
        // Override the task prompt
        _spawnTask: req.task,
        _spawnContext: req.context,
      };

      // Create worktree for spawned agent
      if (CONFIG.useWorktrees) {
        await createWorktree(agent.id, round);
      }

      const result = await runAgent(agent, round);
      archiveSpawnRequest(req._sourcePath, req._filename);
      return { agent, result };
    });

    const results = await Promise.all(promises);
    for (const { agent, result } of results) {
      const status = result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'OK' : `ERROR(${result.code})`;
      log(`    ${agent.id} (${agent.name}): ${status} in ${(result.elapsed / 60).toFixed(1)}min`);
      spawnedResults.push(result);
    }
  }

  return spawnedResults;
}

/**
 * Get spawn result notifications for a parent agent (injected into next round prompt).
 * @param {string} parentId - Parent agent ID
 * @param {number} prevRound - Previous round number
 * @returns {string|null}
 */
function getSpawnNotifications(parentId, prevRound) {
  const archiveDir = join(SPAWNS_DIR, 'archive');
  if (!existsSync(archiveDir)) return null;

  const notifications = [];
  for (const file of readdirSync(archiveDir)) {
    if (!file.startsWith('spawn-') || !file.endsWith('.json')) continue;
    try {
      const req = JSON.parse(readFileSync(join(archiveDir, file), 'utf-8'));
      if (req.parentId !== parentId) continue;
      // Check if from recent round (within 2 rounds)
      if (req.round && req.round < prevRound - 1) continue;

      notifications.push(
        `Your spawned agent "${req.name || req.role}" completed (round ${req.round || '?'}).`,
        `Task: ${(req.task || '').slice(0, 120)}`,
      );
    } catch (_) { /* skip */ }
  }

  return notifications.length ? notifications.join('\n') : null;
}

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

// ============================================================
// Balance Simulation Runner (v7 — Phase 1)
// ============================================================
// Runs balance sims via `npx tsx src/tools/simulate.ts --json`
// and saves structured results to orchestrator/balance-data/.
// Enabled when CONFIG.balanceConfig is set (via mission config).

/**
 * Run a single balance simulation and return parsed JSON.
 * @param {string} tier - Gear tier (bare, uncommon, epic, giga, etc.)
 * @param {string|null} variant - Gear variant (aggressive, balanced, defensive) or null
 * @param {number} timeoutMs - Timeout for the sim process
 * @returns {Promise<{success: boolean, data: object|null, error: string|null, elapsedMs: number}>}
 */
function runBalanceSim(tier, variant, timeoutMs = 60000) {
  return new Promise((resolvePromise) => {
    const startTime = Date.now();
    const args = ['tsx', 'src/tools/simulate.ts', tier];
    if (variant) args.push(variant);
    args.push('--json');

    const proc = spawn('npx', args, {
      cwd: MVP_DIR,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch (_) {}
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startTime;

      if (timedOut) {
        resolvePromise({ success: false, data: null, error: `Sim timed out after ${timeoutMs}ms`, elapsedMs });
        return;
      }

      if (code !== 0) {
        resolvePromise({ success: false, data: null, error: `Sim exited with code ${code}: ${stderr.slice(0, 200)}`, elapsedMs });
        return;
      }

      try {
        const data = JSON.parse(stdout);
        resolvePromise({ success: true, data, error: null, elapsedMs });
      } catch (parseErr) {
        resolvePromise({ success: false, data: null, error: `JSON parse error: ${parseErr.message}`, elapsedMs });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ success: false, data: null, error: `Spawn error: ${err.message}`, elapsedMs: Date.now() - startTime });
    });
  });
}

/**
 * Run all configured balance sims and save results.
 * @param {number} round - Current orchestrator round
 * @param {string} phase - 'pre' (before code agents) or 'post' (after code agents)
 * @returns {Promise<{results: Array, allSucceeded: boolean}>}
 */
async function runBalanceSims(round, phase) {
  const bc = CONFIG.balanceConfig;
  if (!bc || !bc.sims?.length) return { results: [], allSucceeded: true, elapsedMs: 0 };

  mkdirSync(BALANCE_DATA_DIR, { recursive: true });

  const timeoutMs = bc.simTimeoutMs || 60000;
  const results = [];
  const simStartMs = Date.now();

  log(`  Balance sims (${phase}): running ${bc.sims.length} sim(s)...`);

  for (const sim of bc.sims) {
    const tier = sim.tier || 'bare';
    const variant = sim.variant || null;
    const label = `${tier}${variant ? '/' + variant : ''}`;

    const result = await runBalanceSim(tier, variant, timeoutMs);

    if (result.success) {
      // Save to balance-data directory
      const filename = `round-${round}-${phase}-${tier}${variant ? '-' + variant : ''}.json`;
      const filepath = join(BALANCE_DATA_DIR, filename);
      writeFileSync(filepath, JSON.stringify(result.data, null, 2));

      const spread = result.data.balanceMetrics?.overallSpreadPp ?? '?';
      const top = result.data.balanceMetrics?.topArchetype?.archetype ?? '?';
      const bottom = result.data.balanceMetrics?.bottomArchetype?.archetype ?? '?';
      log(`    ${label}: spread=${spread}pp (${top} → ${bottom}) [${result.elapsedMs}ms]`);
    } else {
      log(`    ${label}: FAILED — ${result.error}`);
    }

    results.push({ tier, variant, phase, ...result });
  }

  const allSucceeded = results.every(r => r.success);
  const elapsedMs = Date.now() - simStartMs;
  return { results, allSucceeded, elapsedMs };
}

// ============================================================
// Balance State Tracker (v7 — Phase 1)
// ============================================================
// Persists balance metrics across rounds in balance-state.json.
// Each entry is a round snapshot with per-tier balance data.
// Used for: trend analysis, regression detection, convergence.

const BALANCE_STATE_FILE = join(ORCH_DIR, 'balance-state.json');

function loadBalanceState() {
  if (!existsSync(BALANCE_STATE_FILE)) return { rounds: [] };
  try { return JSON.parse(readFileSync(BALANCE_STATE_FILE, 'utf-8')); }
  catch (_) { return { rounds: [] }; }
}

function saveBalanceState(state) {
  writeFileSync(BALANCE_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Update balance state with sim results from a completed round.
 * @param {number} round
 * @param {Array} preResults - Pre-sim results array (from runBalanceSims)
 * @param {Array} postResults - Post-sim results array (from runBalanceSims)
 */
function updateBalanceState(round, preResults, postResults) {
  const state = loadBalanceState();

  // Build tier snapshots from post-sim results (or pre if no post)
  const simResults = postResults?.length ? postResults : preResults || [];
  if (!simResults.length) return;

  const tiers = {};
  for (const r of simResults) {
    if (!r.success || !r.data) continue;
    const key = `${r.tier}${r.variant ? '/' + r.variant : ''}`;
    const bm = r.data.balanceMetrics;
    const stats = r.data.archetypeStats;

    tiers[key] = {
      tier: r.tier,
      variant: r.variant || null,
      spreadPp: bm.overallSpreadPp,
      topArchetype: bm.topArchetype,
      bottomArchetype: bm.bottomArchetype,
      archetypeWinRates: Object.fromEntries(stats.map(s => [s.archetype, Math.round(s.overallWinRate * 1000) / 10])),
      flagCount: (r.data.balanceFlags.dominant?.length || 0) + (r.data.balanceFlags.weak?.length || 0) + (r.data.balanceFlags.matchupSkews?.length || 0),
    };
  }

  // Compute deltas if we have both pre and post
  const deltas = {};
  if (preResults?.length && postResults?.length) {
    for (const post of postResults) {
      if (!post.success || !post.data) continue;
      const key = `${post.tier}${post.variant ? '/' + post.variant : ''}`;
      const pre = preResults.find(p => p.tier === post.tier && p.variant === post.variant);
      if (!pre?.success || !pre?.data) continue;

      const preSpread = pre.data.balanceMetrics.overallSpreadPp;
      const postSpread = post.data.balanceMetrics.overallSpreadPp;
      const spreadDelta = Math.round((postSpread - preSpread) * 10) / 10;

      // Per-archetype deltas
      const archDeltas = {};
      for (const postStat of post.data.archetypeStats) {
        const preStat = pre.data.archetypeStats.find(s => s.archetype === postStat.archetype);
        if (preStat) {
          archDeltas[postStat.archetype] = Math.round((postStat.overallWinRate - preStat.overallWinRate) * 1000) / 10;
        }
      }

      deltas[key] = { spreadDelta, archetypeDeltas: archDeltas };
    }
  }

  state.rounds.push({
    round,
    timestamp: new Date().toISOString(),
    tiers,
    deltas: Object.keys(deltas).length ? deltas : null,
  });

  saveBalanceState(state);

  // Log summary
  for (const [key, t] of Object.entries(tiers)) {
    const delta = deltas[key];
    const deltaStr = delta ? ` (Δ spread: ${delta.spreadDelta > 0 ? '+' : ''}${delta.spreadDelta}pp)` : '';
    log(`  Balance state [${key}]: spread=${t.spreadPp}pp, ${t.topArchetype.archetype} ${t.topArchetype.winRate}% → ${t.bottomArchetype.archetype} ${t.bottomArchetype.winRate}%${deltaStr}`);
  }
}

// ============================================================
// Experiment Log (v13 — persistent memory of what agents tried)
// ============================================================
// Tracks parameter changes and their outcomes so balance-analyst
// can avoid repeating failed approaches and build on successes.
//
// Each entry: { round, agentId, timestamp, params: [{key, from, to}], outcome: {tierSpreads, deltaStr}, metrics }
// Auto-detected from git diff of balance-config.ts after agent modifies it.

const EXPERIMENT_LOG_FILE = join(ORCH_DIR, 'experiment-log.json');

function loadExperimentLog() {
  if (!existsSync(EXPERIMENT_LOG_FILE)) return [];
  try { return JSON.parse(readFileSync(EXPERIMENT_LOG_FILE, 'utf-8')); }
  catch (_) { return []; }
}

function saveExperimentLog(entries) {
  writeFileSync(EXPERIMENT_LOG_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Parse git diff of balance-config.ts to extract parameter changes.
 * Returns array of { key, from, to } for numeric value changes.
 * Uses the round-start tag as the base for comparison.
 */
function parseBalanceConfigDiff(round) {
  const tag = `round-${round}-start`;
  try {
    const diff = execSync(`git diff ${tag} -- src/engine/balance-config.ts`, {
      cwd: MVP_DIR,
      encoding: 'utf-8',
      timeout: 5000,
    });
    if (!diff.trim()) return [];

    const changes = [];
    const lines = diff.split('\n');
    for (const line of lines) {
      // Match lines like "-  softCapK: 50," → "+  softCapK: 55,"
      // We look for removed (-) and added (+) pairs with the same key
      if (line.startsWith('-') && !line.startsWith('---')) {
        const keyMatch = line.match(/^\-\s*(\w+)\s*:\s*([\d.]+)/);
        if (keyMatch) {
          const [, key, fromVal] = keyMatch;
          // Find corresponding + line with same key
          const addLine = lines.find(l =>
            l.startsWith('+') && !l.startsWith('+++') &&
            l.match(new RegExp(`^\\+\\s*${key}\\s*:\\s*[\\d.]+`))
          );
          if (addLine) {
            const toMatch = addLine.match(new RegExp(`^\\+\\s*${key}\\s*:\\s*([\\d.]+)`));
            if (toMatch && toMatch[1] !== fromVal) {
              changes.push({ key, from: parseFloat(fromVal), to: parseFloat(toMatch[1]) });
            }
          }
        }
      }
    }
    return changes;
  } catch (err) {
    log(`  Experiment log: git diff failed — ${err.message}`);
    return [];
  }
}

/**
 * Log an experiment entry after a balance-config.ts change is detected.
 * Called after post-sims so we can record the outcome.
 */
function logExperiment(round, agentId, paramChanges, preSimResults, postSimResults) {
  if (!paramChanges.length) return;

  const entries = loadExperimentLog();

  // Build outcome from pre/post sim spreads
  const outcome = {};
  if (preSimResults?.length && postSimResults?.length) {
    outcome.tierSpreads = {};
    outcome.tierDeltas = {};
    for (const post of postSimResults) {
      if (!post.success || !post.data) continue;
      const key = `${post.tier}${post.variant ? '/' + post.variant : ''}`;
      const postSpread = post.data.balanceMetrics?.overallSpreadPp;
      outcome.tierSpreads[key] = postSpread;

      // Find matching pre-sim
      const pre = preSimResults.find(p => p.tier === post.tier && p.variant === post.variant);
      if (pre?.success && pre.data) {
        const preSpread = pre.data.balanceMetrics?.overallSpreadPp;
        outcome.tierDeltas[key] = Math.round((postSpread - preSpread) * 10) / 10;
      }
    }
  }

  const entry = {
    round,
    agentId,
    timestamp: new Date().toISOString(),
    params: paramChanges,
    outcome,
  };

  entries.push(entry);

  // Keep last 50 entries to prevent unbounded growth
  if (entries.length > 50) entries.splice(0, entries.length - 50);

  saveExperimentLog(entries);

  // Log summary
  const paramStr = paramChanges.map(p => `${p.key}: ${p.from}→${p.to}`).join(', ');
  const deltaStr = Object.entries(outcome.tierDeltas || {})
    .map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}pp`)
    .join(', ');
  log(`  Experiment logged: ${paramStr} → ${deltaStr || 'no sim data'}`);
}

/**
 * Build experiment context for injection into balance-analyst prompt.
 * Returns formatted string of recent experiments, or null if none.
 */
function buildExperimentContext() {
  const entries = loadExperimentLog();
  if (!entries.length) return null;

  // Last 10 entries (most recent first)
  const recent = entries.slice(-10).reverse();
  const lines = [`Recent experiments (${recent.length} of ${entries.length} total):`];

  for (const e of recent) {
    const paramStr = e.params.map(p => `${p.key}: ${p.from}→${p.to}`).join(', ');
    const deltaStr = Object.entries(e.outcome?.tierDeltas || {})
      .map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}pp`)
      .join(', ');
    const improved = Object.values(e.outcome?.tierDeltas || {}).every(d => d <= 0);
    const worsened = Object.values(e.outcome?.tierDeltas || {}).some(d => d > 1);
    const verdict = worsened ? 'WORSENED' : improved ? 'IMPROVED' : 'MIXED';
    lines.push(`  Round ${e.round} (${e.agentId}): ${paramStr} → ${deltaStr || 'no data'} [${verdict}]`);
  }

  lines.push(`Avoid repeating WORSENED experiments. Build on IMPROVED ones.`);
  return lines.join('\n');
}

// ============================================================
// Balance Regression Detection (v7 — Phase 2)
// ============================================================
// Compares pre/post sim data to detect regressions: when a change
// helps one archetype but hurts another, or increases overall spread.

/**
 * Detect balance regressions by comparing pre/post sim results.
 * @param {number} round
 * @param {Array} preResults - Pre-sim results from runBalanceSims
 * @param {Array} postResults - Post-sim results from runBalanceSims
 * @returns {{ regressions: Array, spreadChanges: Array, hasRegressions: boolean }}
 */
function detectBalanceRegressions(round, preResults, postResults) {
  const result = { regressions: [], spreadChanges: [], hasRegressions: false };
  if (!preResults?.length || !postResults?.length) return result;

  const bc = CONFIG.balanceConfig || {};
  const regressionThresholdPp = bc.regressionThresholdPp ?? 3.0; // flag if an archetype drops > 3pp

  for (const post of postResults) {
    if (!post.success || !post.data) continue;
    const pre = preResults.find(p => p.tier === post.tier && p.variant === post.variant && p.success);
    if (!pre?.data) continue;

    const tierKey = `${post.tier}${post.variant ? '/' + post.variant : ''}`;
    const preSpread = pre.data.balanceMetrics.overallSpreadPp;
    const postSpread = post.data.balanceMetrics.overallSpreadPp;
    const spreadDelta = Math.round((postSpread - preSpread) * 10) / 10;

    result.spreadChanges.push({ tier: tierKey, preSpread, postSpread, delta: spreadDelta });

    // Per-archetype win rate deltas
    const winners = [];  // archetypes that improved
    const losers = [];   // archetypes that got worse

    for (const postStat of post.data.archetypeStats) {
      const preStat = pre.data.archetypeStats.find(s => s.archetype === postStat.archetype);
      if (!preStat) continue;

      const deltaPp = Math.round((postStat.overallWinRate - preStat.overallWinRate) * 1000) / 10;
      if (deltaPp > regressionThresholdPp) {
        winners.push({ archetype: postStat.archetype, delta: deltaPp });
      } else if (deltaPp < -regressionThresholdPp) {
        losers.push({ archetype: postStat.archetype, delta: deltaPp });
      }
    }

    // Regression = someone gained significantly AND someone lost significantly
    if (winners.length > 0 && losers.length > 0) {
      result.regressions.push({
        tier: tierKey,
        winners,
        losers,
        spreadDelta,
      });
      result.hasRegressions = true;
    }

    // Also flag if spread increased significantly (balance got worse)
    if (spreadDelta > regressionThresholdPp) {
      result.regressions.push({
        tier: tierKey,
        type: 'spread_increase',
        spreadDelta,
        message: `Spread increased by ${spreadDelta}pp (${preSpread} -> ${postSpread})`,
      });
      result.hasRegressions = true;
    }
  }

  // Log results
  if (result.hasRegressions) {
    log(`  ⚠ BALANCE REGRESSIONS DETECTED (round ${round}):`);
    for (const reg of result.regressions) {
      if (reg.type === 'spread_increase') {
        log(`    [${reg.tier}] ${reg.message}`);
      } else {
        const winStr = reg.winners.map(w => `${w.archetype} +${w.delta}pp`).join(', ');
        const loseStr = reg.losers.map(l => `${l.archetype} ${l.delta}pp`).join(', ');
        log(`    [${reg.tier}] Winners: ${winStr} | Losers: ${loseStr} (spread Δ: ${reg.spreadDelta > 0 ? '+' : ''}${reg.spreadDelta}pp)`);
      }
    }
  } else if (result.spreadChanges.length) {
    for (const sc of result.spreadChanges) {
      const dir = sc.delta > 0 ? '+' : '';
      log(`  Balance [${sc.tier}]: spread ${dir}${sc.delta}pp (${sc.preSpread} → ${sc.postSpread}pp) — no regressions`);
    }
  }

  return result;
}

// ============================================================
// Balance Convergence Detection (v7 — Phase 2)
// ============================================================
// Checks if balance metrics meet convergence criteria.
// When converged, orchestrator can auto-stop.
//
// convergenceCriteria config (in balanceConfig):
// {
//   maxSpreadPp: { bare: 15, epic: 5, giga: 7 },  // per-tier max spread
//   maxFlags: 0,       // max total balance flags (dominant + weak + skew)
//   requiredTiers: ['epic', 'giga'],  // which tiers must pass (default: all sim tiers)
//   minRounds: 3,      // minimum rounds before convergence can trigger
// }

/**
 * Check if balance has converged based on configured criteria.
 * @param {Array} postSimResults - Post-sim results from runBalanceSims
 * @param {number} round - Current round number
 * @returns {{ converged: boolean, report: string, tierResults: object }}
 */
function checkConvergence(postSimResults, round) {
  const bc = CONFIG.balanceConfig;
  const cc = bc?.convergenceCriteria;
  if (!cc || !postSimResults?.length) return { converged: false, report: 'No convergence criteria configured', tierResults: {} };

  const minRounds = cc.minRounds ?? 3;
  if (round < minRounds) return { converged: false, report: `Round ${round} < minRounds ${minRounds}`, tierResults: {} };

  const maxSpreadPp = cc.maxSpreadPp || {};
  const maxFlags = cc.maxFlags ?? Infinity;
  const requiredTiers = cc.requiredTiers || bc.sims.map(s => `${s.tier}${s.variant ? '/' + s.variant : ''}`);

  const tierResults = {};
  let allPassed = true;
  const reportLines = [];

  for (const r of postSimResults) {
    if (!r.success || !r.data) continue;
    const tierKey = `${r.tier}${r.variant ? '/' + r.variant : ''}`;
    const isRequired = requiredTiers.includes(tierKey);
    if (!isRequired) continue;

    const spread = r.data.balanceMetrics.overallSpreadPp;
    const flags = (r.data.balanceFlags.dominant?.length || 0) +
                  (r.data.balanceFlags.weak?.length || 0) +
                  (r.data.balanceFlags.matchupSkews?.length || 0);

    const tierThreshold = maxSpreadPp[r.tier] ?? maxSpreadPp['*'] ?? Infinity;
    const spreadOk = spread <= tierThreshold;
    const flagsOk = flags <= maxFlags;
    const tierPassed = spreadOk && flagsOk;

    tierResults[tierKey] = { spread, flags, tierThreshold, spreadOk, flagsOk, passed: tierPassed };

    if (!tierPassed) allPassed = false;

    const statusIcon = tierPassed ? '✓' : '✗';
    reportLines.push(`  ${statusIcon} [${tierKey}] spread=${spread}pp (max ${tierThreshold}pp), flags=${flags} (max ${maxFlags})`);
  }

  // Check that all required tiers had results
  for (const reqTier of requiredTiers) {
    if (!tierResults[reqTier]) {
      allPassed = false;
      reportLines.push(`  ✗ [${reqTier}] missing sim results`);
    }
  }

  const report = reportLines.join('\n');

  if (allPassed) {
    log(`  ✓ BALANCE CONVERGED (round ${round}):`);
  } else {
    log(`  Convergence check (round ${round}):`);
  }
  for (const line of reportLines) log(line);

  return { converged: allPassed, report, tierResults };
}

// ============================================================
// Balance Context Builder (v7 — Phase 2)
// ============================================================
// Builds structured balance context for agent prompts.
// Agents receive current metrics instead of running their own sims.

/**
 * Build a concise balance context string for agent prompts.
 * @returns {string|null} Formatted balance context, or null if no data
 */
function buildBalanceContext() {
  const state = loadBalanceState();
  if (!state.rounds?.length) return null;

  const latest = state.rounds[state.rounds.length - 1];
  const lines = [`Balance data (round ${latest.round}, ${latest.timestamp}):`];

  // Per-tier summary
  for (const [tierKey, t] of Object.entries(latest.tiers || {})) {
    lines.push(`  [${tierKey}] spread=${t.spreadPp}pp, top=${t.topArchetype.archetype}(${t.topArchetype.winRate}%), bottom=${t.bottomArchetype.archetype}(${t.bottomArchetype.winRate}%), flags=${t.flagCount}`);

    // Include per-archetype win rates
    if (t.archetypeWinRates) {
      const rateStr = Object.entries(t.archetypeWinRates)
        .sort(([, a], [, b]) => b - a)
        .map(([arch, rate]) => `${arch}=${rate}%`)
        .join(', ');
      lines.push(`    Win rates: ${rateStr}`);
    }
  }

  // Include deltas if available
  if (latest.deltas) {
    lines.push(`  Changes this round:`);
    for (const [tierKey, d] of Object.entries(latest.deltas)) {
      const dir = d.spreadDelta > 0 ? '+' : '';
      lines.push(`    [${tierKey}] spread ${dir}${d.spreadDelta}pp`);
      if (d.archetypeDeltas) {
        const deltaStr = Object.entries(d.archetypeDeltas)
          .filter(([, delta]) => Math.abs(delta) >= 0.5)
          .sort(([, a], [, b]) => b - a)
          .map(([arch, delta]) => `${arch} ${delta > 0 ? '+' : ''}${delta}pp`)
          .join(', ');
        if (deltaStr) lines.push(`    Archetype deltas: ${deltaStr}`);
      }
    }
  }

  // Include trend (last 3 rounds of spread data)
  if (state.rounds.length >= 2) {
    const recent = state.rounds.slice(-3);
    lines.push(`  Trend (last ${recent.length} rounds):`);
    for (const r of recent) {
      const tierSpreads = Object.entries(r.tiers || {}).map(([k, t]) => `${k}=${t.spreadPp}pp`).join(', ');
      lines.push(`    Round ${r.round}: ${tierSpreads}`);
    }
  }

  // Include regressions from balance state if available
  if (latest._regressions?.length) {
    lines.push(`  ⚠ Regressions detected:`);
    for (const reg of latest._regressions) {
      if (reg.type === 'spread_increase') {
        lines.push(`    [${reg.tier}] ${reg.message}`);
      } else {
        const winStr = reg.winners?.map(w => `${w.archetype} +${w.delta}pp`).join(', ') || '';
        const loseStr = reg.losers?.map(l => `${l.archetype} ${l.delta}pp`).join(', ') || '';
        lines.push(`    [${reg.tier}] Winners: ${winStr} | Losers: ${loseStr}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================
// Balance Backlog Generation (v7 — Phase 3)
// ============================================================
// Auto-generates targeted backlog tasks from sim data.
// Called after post-sim + regression detection, before Phase B.
// Tasks go into backlog.json for balance-analyst to pick up.

/**
 * Generate backlog tasks from post-sim results.
 * Identifies outlier archetypes, flagged matchups, and regressions
 * that need balance-analyst attention.
 * @param {number} round
 * @param {Array} postSimResults - Post-sim results from runBalanceSims
 * @param {{ regressions: Array, hasRegressions: boolean }} regressionResult
 * @returns {number} Number of tasks generated
 */
function generateBalanceBacklog(round, postSimResults, regressionResult) {
  if (!postSimResults?.length) return 0;

  const backlog = loadBacklog();
  const existingTitles = new Set(backlog.map(t => t.title));
  const newTasks = [];
  let nextId = getNextBacklogId(backlog);

  // --- 1. Outlier archetypes (>58% or <42% at any tier) ---
  for (const r of postSimResults) {
    if (!r.success || !r.data) continue;
    const tierKey = `${r.tier}/${r.variant || 'balanced'}`;

    for (const stat of r.data.archetypeStats) {
      const winPct = Math.round(stat.overallWinRate * 1000) / 10;

      if (winPct > 58) {
        const title = `${stat.archetype} too strong at ${r.tier} (${winPct}%)`;
        if (!existingTitles.has(title)) {
          newTasks.push({
            id: `BL-${String(nextId++).padStart(3, '0')}`,
            role: 'balance-analyst',
            priority: winPct > 62 ? 1 : 2,
            title,
            description: `${stat.archetype} win rate is ${winPct}% at ${tierKey} (target: 42-58%). Consider reducing a primary stat or adjusting a balance-config constant that amplifies this archetype's strength.`,
            fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
            status: 'pending',
            dependsOn: [],
            generatedBy: 'orchestrator',
            round,
          });
          existingTitles.add(title);
        }
      }

      if (winPct < 42) {
        const title = `${stat.archetype} too weak at ${r.tier} (${winPct}%)`;
        if (!existingTitles.has(title)) {
          newTasks.push({
            id: `BL-${String(nextId++).padStart(3, '0')}`,
            role: 'balance-analyst',
            priority: winPct < 38 ? 1 : 2,
            title,
            description: `${stat.archetype} win rate is ${winPct}% at ${tierKey} (target: 42-58%). Consider boosting a primary stat or adjusting a balance-config constant that would help this archetype.`,
            fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
            status: 'pending',
            dependsOn: [],
            generatedBy: 'orchestrator',
            round,
          });
          existingTitles.add(title);
        }
      }
    }
  }

  // --- 2. Matchup skews from balance flags ---
  for (const r of postSimResults) {
    if (!r.success || !r.data?.balanceFlags) continue;
    const tierKey = `${r.tier}/${r.variant || 'balanced'}`;

    for (const skew of (r.data.balanceFlags.matchupSkews || [])) {
      const title = `Matchup skew: ${skew.matchup || skew} at ${r.tier}`;
      if (!existingTitles.has(title)) {
        newTasks.push({
          id: `BL-${String(nextId++).padStart(3, '0')}`,
          role: 'balance-analyst',
          priority: 3,
          title,
          description: `Matchup skew flagged at ${tierKey}: ${typeof skew === 'string' ? skew : JSON.stringify(skew)}. Investigate if a stat or constant change can narrow this matchup.`,
          fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
          status: 'pending',
          dependsOn: [],
          generatedBy: 'orchestrator',
          round,
        });
        existingTitles.add(title);
      }
    }
  }

  // --- 3. Regression-driven tasks ---
  if (regressionResult?.hasRegressions) {
    for (const reg of regressionResult.regressions) {
      if (reg.type === 'spread_increase') {
        const title = `Spread regression at ${reg.tier} (+${reg.spreadDelta}pp)`;
        if (!existingTitles.has(title)) {
          newTasks.push({
            id: `BL-${String(nextId++).padStart(3, '0')}`,
            role: 'balance-analyst',
            priority: 1,
            title,
            description: `${reg.message}. Last round's change made balance worse at this tier. Consider reverting or trying a different approach.`,
            fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
            status: 'pending',
            dependsOn: [],
            generatedBy: 'orchestrator',
            round,
          });
          existingTitles.add(title);
        }
      } else if (reg.winners?.length && reg.losers?.length) {
        const winStr = reg.winners.map(w => `${w.archetype} +${w.delta}pp`).join(', ');
        const loseStr = reg.losers.map(l => `${l.archetype} ${l.delta}pp`).join(', ');
        const title = `Balance regression at ${reg.tier}: winners/losers`;
        if (!existingTitles.has(title)) {
          newTasks.push({
            id: `BL-${String(nextId++).padStart(3, '0')}`,
            role: 'balance-analyst',
            priority: 1,
            title,
            description: `Regression at ${reg.tier}: Winners: ${winStr} | Losers: ${loseStr}. A change helped some archetypes but hurt others. Address the losers without negating the gains.`,
            fileOwnership: ['src/engine/balance-config.ts', 'src/engine/archetypes.ts'],
            status: 'pending',
            dependsOn: [],
            generatedBy: 'orchestrator',
            round,
          });
          existingTitles.add(title);
        }
      }
    }
  }

  // --- 4. QA companion tasks for balance changes ---
  const balanceTasks = newTasks.filter(t => t.role === 'balance-analyst' && t.priority <= 2);
  if (balanceTasks.length > 0) {
    const title = `Validate round ${round} balance changes`;
    if (!existingTitles.has(title)) {
      newTasks.push({
        id: `BL-${String(nextId++).padStart(3, '0')}`,
        role: 'qa-engineer',
        priority: 2,
        title,
        description: `Write tests validating balance changes made in round ${round}. Focus on boundary conditions near changed parameter values and invariant preservation.`,
        fileOwnership: ['src/engine/*.test.ts'],
        status: 'pending',
        dependsOn: balanceTasks.map(t => t.id),
        generatedBy: 'orchestrator',
        round,
      });
      existingTitles.add(title);
    }
  }

  if (newTasks.length) {
    backlog.push(...newTasks);
    saveBacklog(backlog);
    log(`  Balance backlog: generated ${newTasks.length} task(s) from sim data`);
    for (const t of newTasks) {
      log(`    ${t.id} [P${t.priority}] ${t.role}: ${t.title}`);
    }
  }

  return newTasks.length;
}

/**
 * Get the next available backlog ID number.
 * Scans existing backlog + archive to avoid collisions.
 */
function getNextBacklogId(backlog) {
  let maxNum = 0;
  for (const t of backlog) {
    const match = t.id?.match(/^BL-(\d+)$/);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  // Also check archive
  if (existsSync(BACKLOG_ARCHIVE_FILE)) {
    try {
      const archive = JSON.parse(readFileSync(BACKLOG_ARCHIVE_FILE, 'utf-8'));
      for (const t of archive) {
        const match = t.id?.match(/^BL-(\d+)$/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
      }
    } catch (_) { /* ignore */ }
  }
  return maxNum + 1;
}

// ============================================================
// Parameter Search Integration (v7 — Phase 4)
// ============================================================
// Runs param-search.ts as a subprocess and captures structured results.
// Triggered before round 1 if CONFIG.balanceConfig.parameterSearch is configured.
// Results are cached and injected into balance-analyst prompts.

let paramSearchResults = null; // Cached search results for prompt injection

/**
 * Run parameter search using a search config file.
 * Returns parsed SearchReport or null on failure.
 */
async function runParameterSearch(configPath, timeoutMs = 600000) {
  const absConfig = resolve(MVP_DIR, configPath);
  if (!existsSync(absConfig)) {
    log(`  Parameter search: config not found: ${absConfig}`);
    return null;
  }

  log(`  Running parameter search: ${configPath}...`);
  const startTime = Date.now();

  return new Promise((resolvePromise) => {
    const child = spawn('npx', ['tsx', 'src/tools/param-search.ts', absConfig], {
      cwd: MVP_DIR,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) log(`    [param-search] ${line}`);
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      log(`  Parameter search TIMEOUT (${timeoutMs / 1000}s). Killing process.`);
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (code !== 0) {
        log(`  Parameter search failed (exit code ${code}) after ${elapsed}s`);
        resolvePromise(null);
        return;
      }

      try {
        const report = JSON.parse(stdout);
        log(`  Parameter search complete: ${report.totalSimulations} sims in ${elapsed}s`);
        log(`    Baseline score: ${report.baseline.score.toFixed(2)}`);
        log(`    Best score: ${report.bestResult.score.toFixed(2)} (${report.bestResult.label})`);
        if (report.bestResult.score < report.baseline.score) {
          const improvement = report.baseline.score - report.bestResult.score;
          log(`    Improvement: -${improvement.toFixed(2)} (${JSON.stringify(report.bestResult.overrides)})`);
        }
        resolvePromise(report);
      } catch (err) {
        log(`  Parameter search: failed to parse JSON output (${err.message})`);
        resolvePromise(null);
      }
    });
  });
}

/**
 * Build a formatted string summarizing parameter search results for agent prompts.
 * Returns null if no results available.
 */
function buildParamSearchContext() {
  if (!paramSearchResults) return null;

  const r = paramSearchResults;
  const lines = [];

  lines.push(`Parameter search: "${r.config.name}" (${r.config.strategy} strategy)`);
  lines.push(`  Params tested: ${r.config.params.map(p => p.label || p.key).join(', ')}`);
  lines.push(`  Simulations: ${r.totalSimulations}, Time: ${(r.totalElapsedMs / 1000 / 60).toFixed(1)} min`);
  lines.push(``);

  // Baseline
  lines.push(`Baseline (current config): score=${r.baseline.score.toFixed(2)}`);
  if (r.noiseFloor > 0) {
    lines.push(`  Noise floor: ±${r.noiseFloor.toFixed(2)} score points (from ${r.baselineRuns?.length ?? 1} averaged baselines)`);
    lines.push(`  Results within noise floor are unreliable — marked as "within noise".`);
  }
  for (const [tierKey, tier] of Object.entries(r.baseline.tiers)) {
    lines.push(`  ${tierKey}: spread=${tier.spreadPp}pp, top=${tier.topArchetype.archetype}(${tier.topArchetype.winRate}%), bottom=${tier.bottomArchetype.archetype}(${tier.bottomArchetype.winRate}%), flags=${tier.flagCount}`);
  }
  lines.push(``);

  // Best result
  lines.push(`Best found: score=${r.bestResult.score.toFixed(2)} (${r.bestResult.label})`);
  lines.push(`  Overrides: ${JSON.stringify(r.bestResult.overrides)}`);
  for (const [tierKey, tier] of Object.entries(r.bestResult.tiers)) {
    const baselineTier = r.baseline.tiers[tierKey];
    const delta = baselineTier ? (tier.spreadPp - baselineTier.spreadPp).toFixed(1) : '?';
    const sign = parseFloat(delta) >= 0 ? '+' : '';
    lines.push(`  ${tierKey}: spread=${tier.spreadPp}pp (${sign}${delta}pp), flags=${tier.flagCount}`);
  }
  lines.push(``);

  // Top improvements (sweep only)
  if (r.improvements?.length > 0) {
    lines.push(`Parameter sensitivity (most impactful):`);
    for (const imp of r.improvements.slice(0, 5)) {
      if (imp.confirmed) {
        lines.push(`  ${imp.key}: CONFIRMED at ${imp.currentValue} (already optimal)`);
      } else if (imp.withinNoise) {
        lines.push(`  ${imp.key}: current=${imp.currentValue}, best=${imp.bestValue} (~${imp.scoreDelta.toFixed(2)}, WITHIN NOISE — not actionable)`);
      } else {
        const direction = imp.scoreDelta < 0 ? 'IMPROVES' : 'worsens';
        const spreadInfo = Object.entries(imp.spreadImprovements)
          .map(([t, d]) => `${t}:${d > 0 ? '+' : ''}${d}pp`)
          .join(', ');
        lines.push(`  ${imp.key}: current=${imp.currentValue}, best=${imp.bestValue} (${direction} by ${Math.abs(imp.scoreDelta).toFixed(2)}) [${spreadInfo}]`);
      }
    }
    lines.push(``);
  }

  // Top 5 rankings
  if (r.rankings?.length > 1) {
    lines.push(`Top 5 configurations:`);
    for (const ranked of r.rankings.slice(0, 5)) {
      const overridesStr = Object.entries(ranked.overrides).map(([k, v]) => `${k}=${v}`).join(', ');
      lines.push(`  score=${ranked.score.toFixed(2)}: ${overridesStr || 'baseline'}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Cost Tracking (v6 — Action 1.3)
// ============================================================
// Approximate pricing per 1M tokens (USD)
const MODEL_PRICING = {
  haiku:   { input: 0.25,  output: 1.25 },
  sonnet:  { input: 3.00,  output: 15.00 },
  opus:    { input: 15.00, output: 75.00 },
  default: { input: 3.00,  output: 15.00 },  // assume sonnet if unknown
};

/**
 * Parse Claude CLI stderr output for cost/token information.
 * Claude Code CLI may output lines like:
 *   "Total cost: $X.XX"
 *   "Total tokens: input=N, output=N"
 *   or token/cost info in other formats
 * Returns { cost, inputTokens, outputTokens } with nulls for unparsed fields.
 */
function parseCostFromStderr(stderr) {
  const result = { cost: null, inputTokens: null, outputTokens: null };
  if (!stderr) return result;

  // Try to match "Total cost: $X.XX" or "cost: $X.XX"
  const costMatch = stderr.match(/(?:total\s+)?cost:\s*\$?([\d.]+)/i);
  if (costMatch) result.cost = parseFloat(costMatch[1]);

  // Try to match "Total tokens: input=N, output=N"
  const tokensMatch = stderr.match(/tokens?:?\s*input\s*=?\s*([\d,]+)\s*,?\s*output\s*=?\s*([\d,]+)/i);
  if (tokensMatch) {
    result.inputTokens = parseInt(tokensMatch[1].replace(/,/g, ''));
    result.outputTokens = parseInt(tokensMatch[2].replace(/,/g, ''));
  }

  // Alternative: match individual token lines
  if (result.inputTokens === null) {
    const inputMatch = stderr.match(/input[\s_]tokens?:?\s*([\d,]+)/i);
    if (inputMatch) result.inputTokens = parseInt(inputMatch[1].replace(/,/g, ''));
  }
  if (result.outputTokens === null) {
    const outputMatch = stderr.match(/output[\s_]tokens?:?\s*([\d,]+)/i);
    if (outputMatch) result.outputTokens = parseInt(outputMatch[1].replace(/,/g, ''));
  }

  return result;
}

/**
 * Estimate cost from token counts using model pricing.
 * Returns estimated USD cost.
 */
function estimateCostFromTokens(inputTokens, outputTokens, model) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Initialize or return existing cost log entry for an agent.
 */
function ensureCostLogEntry(costLog, agentId) {
  if (!costLog[agentId]) {
    costLog[agentId] = {
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      rounds: 0,
      escalations: 0,
    };
  }
  return costLog[agentId];
}

/**
 * Accumulate cost data from an agent run result into the costLog.
 */
function accumulateAgentCost(costLog, result, agents) {
  const agent = agents.find(a => a.id === result.agentId);
  const entry = ensureCostLogEntry(costLog, result.agentId);
  entry.rounds++;

  const parsed = parseCostFromStderr(result.stderr);

  if (parsed.cost !== null) {
    // Direct cost from CLI output
    entry.totalCost += parsed.cost;
  }

  if (parsed.inputTokens !== null) {
    entry.inputTokens += parsed.inputTokens;
  }
  if (parsed.outputTokens !== null) {
    entry.outputTokens += parsed.outputTokens;
  }

  // If we got tokens but no direct cost, estimate from pricing
  if (parsed.cost === null && parsed.inputTokens !== null && parsed.outputTokens !== null) {
    const model = agent?.model || 'default';
    entry.totalCost += estimateCostFromTokens(parsed.inputTokens, parsed.outputTokens, model);
  }
}

// ============================================================
// Adaptive Timeouts (v10 — track per-agent runtime history)
// ============================================================
// Tracks the last N runtimes per agent (in seconds). Used to compute
// a timeout of max(2 * avg, configTimeout * 0.25, 120000ms).
// Capped at agent.timeoutMs. Falls back to configured timeout on first run.
const RUNTIME_HISTORY_SIZE = 5;
const agentRuntimeHistory = {};  // agentId → number[] (elapsed seconds, last N runs)

function recordAgentRuntime(agentId, elapsedSeconds) {
  if (!agentRuntimeHistory[agentId]) agentRuntimeHistory[agentId] = [];
  agentRuntimeHistory[agentId].push(elapsedSeconds);
  if (agentRuntimeHistory[agentId].length > RUNTIME_HISTORY_SIZE) {
    agentRuntimeHistory[agentId].shift();
  }
}

function getAdaptiveTimeout(agent) {
  const configTimeout = agent.timeoutMs || CONFIG.agentTimeoutMs;
  const history = agentRuntimeHistory[agent.id];
  if (!history || history.length === 0) return configTimeout; // first run — use configured

  const avgSeconds = history.reduce((a, b) => a + b, 0) / history.length;
  const avgMs = avgSeconds * 1000;
  const adaptedMs = Math.max(2 * avgMs, configTimeout * 0.25, 120000);
  return Math.min(adaptedMs, configTimeout); // never exceed configured max
}

// ============================================================
// Agent Effectiveness Tracking (v14 — per-agent productivity metrics)
// ============================================================
// Tracks cumulative per-agent metrics across rounds for the overnight report.
// Updated from processAgentResult() after each agent completes.
const agentEffectiveness = {};  // agentId → { tasksCompleted, totalFiles, totalTokens, totalCost, totalSeconds, rounds }

function recordAgentEffectiveness(agentId, { filesModified, costEntry, elapsedSeconds, isEmptyWork }) {
  if (!agentEffectiveness[agentId]) {
    agentEffectiveness[agentId] = { tasksCompleted: 0, totalFiles: 0, totalTokens: 0, totalCost: 0, totalSeconds: 0, rounds: 0 };
  }
  const eff = agentEffectiveness[agentId];
  eff.rounds++;
  eff.totalSeconds += elapsedSeconds || 0;
  eff.totalFiles += (filesModified?.length || 0);
  if (costEntry) {
    eff.totalTokens += (costEntry.inputTokens || 0) + (costEntry.outputTokens || 0);
    eff.totalCost += costEntry.totalCost || 0;
  }
  if (!isEmptyWork && filesModified?.length > 0) {
    eff.tasksCompleted++;
  }
}

// v14: Dynamic concurrency — adjust pool size based on agent speed mix
function getDynamicConcurrency() {
  const configured = CONFIG.maxConcurrency;
  if (!configured || configured <= 0) return 0; // unlimited

  const histories = Object.values(agentRuntimeHistory);
  if (histories.length < 2) return configured; // not enough data yet

  const allAvgs = histories.map(h => h.reduce((a, b) => a + b, 0) / h.length);
  const fastest = Math.min(...allAvgs);
  const slowest = Math.max(...allAvgs);

  // If slowest agent is 3x+ slower than fastest, increase concurrency by 1
  // so fast agents aren't bottlenecked waiting for slow ones in the pool
  if (slowest > fastest * 3 && fastest > 0) {
    const bumped = Math.min(configured + 1, AGENTS.length);
    if (bumped > configured) {
      log(`  Dynamic concurrency: ${configured} → ${bumped} (speed ratio ${(slowest/fastest).toFixed(1)}x)`);
    }
    return bumped;
  }
  return configured;
}

// ============================================================
// Agent Session Continuity (v16 — persist sessions across rounds)
// ============================================================
// Tracks Claude CLI session IDs per agent so subsequent rounds can --resume
// the conversation instead of starting fresh. Returning agents keep their full
// context from prior rounds (file reads, codebase understanding, decisions)
// and receive a compact delta prompt instead of the full initial prompt.
const agentSessions = {};  // agentId → { sessionId, lastRound, resumeCount, freshCount, invalidations }

/**
 * Read an agent's handoff file content for inline injection into prompts.
 * Returns the full file content or null if unavailable.
 */
function readHandoffContent(agentId) {
  // v21: Check worktree path first (agent may have updated handoff there)
  const wt = agentWorktrees[agentId];
  const wtPath = wt ? join(wt.path, 'orchestrator', 'handoffs', `${agentId}.md`) : null;
  const mainPath = join(HANDOFF_DIR, `${agentId}.md`);
  const handoffPath = (wtPath && existsSync(wtPath)) ? wtPath : mainPath;
  if (!existsSync(handoffPath)) return null;
  try {
    const content = readFileSync(handoffPath, 'utf-8');
    return content.trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Extract session changelog entries since a given round.
 * Parses the changelog file looking for "## Round N" headers and returns
 * only entries from rounds > sinceRound.
 */
function getChangelogSinceRound(sinceRound) {
  if (!existsSync(CHANGELOG_FILE)) return null;
  try {
    const content = readFileSync(CHANGELOG_FILE, 'utf-8');
    const lines = content.split('\n');
    const relevantLines = [];
    let capturing = false;
    for (const line of lines) {
      const roundMatch = line.match(/^## Round (\d+)/);
      if (roundMatch) {
        capturing = parseInt(roundMatch[1]) > sinceRound;
      }
      if (capturing) {
        relevantLines.push(line);
      }
    }
    return relevantLines.length > 0 ? relevantLines.join('\n').trim() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Invalidate an agent's session (e.g., after revert or mission transition).
 * The agent will start a fresh session on its next run.
 */
function invalidateAgentSession(agentId, reason) {
  if (agentSessions[agentId]) {
    agentSessions[agentId].invalidations = (agentSessions[agentId].invalidations || 0) + 1;
    log(`  Session invalidated for ${agentId} (${reason})`);
    delete agentSessions[agentId];
  }
}

/**
 * v17: Invalidate stale sessions — agents that haven't been productive for too long
 * get a fresh session to avoid accumulated context drift.
 * @param {number} round - Current round
 * @param {Object} consecutiveEmptyRounds - Map of agentId → consecutive empty round count
 */
function invalidateStaleSessions(round, consecutiveEmptyRounds) {
  const STALE_EMPTY_THRESHOLD = 5;  // Invalidate after 5 consecutive empty rounds
  const STALE_AGE_THRESHOLD = 10;   // Invalidate if session is 10+ rounds old without productive run

  for (const [agentId, session] of Object.entries(agentSessions)) {
    // Check consecutive empty rounds
    if ((consecutiveEmptyRounds[agentId] || 0) >= STALE_EMPTY_THRESHOLD) {
      invalidateAgentSession(agentId, `stale: ${consecutiveEmptyRounds[agentId]} consecutive empty rounds`);
      continue;
    }
    // Check session age vs productivity
    const sessionAge = round - (session.lastRound || 0);
    if (sessionAge >= STALE_AGE_THRESHOLD) {
      invalidateAgentSession(agentId, `stale: session ${sessionAge} rounds old (last active round ${session.lastRound})`);
    }
  }
}

// ============================================================
// Live Progress Dashboard (v15 — real-time agent status)
// ============================================================
// Shows running/queued/done/failed status for each agent with elapsed time.
// Updates in-place using ANSI cursor control. Falls back to simple logging
// when output is not a TTY (e.g., piped to file).
class ProgressDashboard {
  constructor(agents, phase) {
    this.agents = agents.map(a => ({
      id: a.id, status: 'queued', elapsed: 0, startTime: null, task: null
    }));
    this.phase = phase || 'Agents';
    this.isTTY = process.stdout.isTTY || false;
    this.lineCount = 0;
    this.interval = null;
    this.stopped = false;
  }

  start() {
    if (!this.isTTY || this.agents.length === 0) return;
    this.render();
    // Refresh elapsed times every 5 seconds
    this.interval = setInterval(() => {
      if (!this.stopped) this.render();
    }, 5000);
  }

  updateAgent(agentId, status, extra) {
    const agent = this.agents.find(a => a.id === agentId);
    if (!agent) return;
    agent.status = status;
    if (status === 'running' && !agent.startTime) {
      agent.startTime = Date.now();
    }
    if (extra?.elapsed) agent.elapsed = extra.elapsed;
    if (extra?.task) agent.task = extra.task;
    if (this.isTTY && !this.stopped) this.render();
  }

  render() {
    // Clear previous output
    if (this.lineCount > 0) {
      process.stdout.write(`\x1b[${this.lineCount}A\x1b[J`);
    }
    const lines = [];
    lines.push(`  ┌─ ${this.phase} Dashboard ─────────────────────────────┐`);
    for (const agent of this.agents) {
      const elapsed = agent.status === 'running' && agent.startTime
        ? ((Date.now() - agent.startTime) / 60000).toFixed(1)
        : agent.elapsed ? (agent.elapsed / 60).toFixed(1) : '0.0';
      const icon = agent.status === 'running' ? '▶' :
                   agent.status === 'done' ? '✓' :
                   agent.status === 'failed' ? '✗' :
                   agent.status === 'timeout' ? '⏱' : '·';
      const statusStr = agent.status.toUpperCase().padEnd(7);
      const taskStr = agent.task ? ` [${agent.task}]` : '';
      lines.push(`  │ ${icon} ${agent.id.padEnd(20)} ${statusStr} ${elapsed}min${taskStr}`);
    }
    lines.push(`  └───────────────────────────────────────────────────┘`);
    process.stdout.write(lines.join('\n') + '\n');
    this.lineCount = lines.length;
  }

  stop() {
    this.stopped = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Final render to show completed state
    if (this.isTTY) this.render();
  }
}

// ============================================================
// Agent Pool (v9 — streaming pipeline, replaces batch concurrency)
// ============================================================
// Queue-drain pool: launches up to maxConcurrency agents. As each finishes,
// fires onAgentComplete callback immediately and launches the next queued agent.
// Results are in completion order (not submission order).
// v15: accepts optional dashboard for live progress updates.
async function runAgentPool(agents, round, maxConcurrency, onAgentComplete, dashboard, opts = {}) {
  if (!agents.length) return { allDone: Promise.resolve(), groupDone: Promise.resolve(), results: Promise.resolve([]) };
  const limit = (!maxConcurrency || maxConcurrency >= agents.length)
    ? agents.length : maxConcurrency;

  // v18: Group completion tracking — fires when all agents in groupIds have finished
  const groupIds = opts.groupIds;  // Set<string> of agent IDs
  let groupRemaining = groupIds ? agents.filter(a => groupIds.has(a.id)).length : 0;
  let resolveGroup;
  const groupDone = groupIds && groupRemaining > 0
    ? new Promise(r => { resolveGroup = r; })
    : Promise.resolve();

  const results = [];
  const queue = [...agents];
  let active = 0;
  let resolveAll;
  const allDone = new Promise(r => { resolveAll = r; });

  function tryLaunch() {
    while (active < limit && queue.length > 0) {
      const agent = queue.shift();
      active++;
      // v15: Notify dashboard of agent launch
      if (dashboard) dashboard.updateAgent(agent.id, 'running');
      runAgent(agent, round).then(result => {
        active--;
        results.push(result);
        // v15: Notify dashboard of agent completion
        if (dashboard) {
          const dStatus = result.timedOut ? 'timeout' : result.code === 0 ? 'done' : 'failed';
          dashboard.updateAgent(result.agentId, dStatus, { elapsed: result.elapsed });
        }
        if (onAgentComplete) onAgentComplete(result);
        // v18: Check group completion
        if (groupIds && groupIds.has(result.agentId)) {
          groupRemaining--;
          if (groupRemaining === 0 && resolveGroup) resolveGroup();
        }
        if (active === 0 && queue.length === 0) resolveAll();
        else tryLaunch();
      });
    }
    if (active === 0 && queue.length === 0) resolveAll();
  }

  tryLaunch();
  return { allDone, groupDone, results: allDone.then(() => results) };
}

// ============================================================
// Process Agent Result (v9 — extracted from Phase A/B duplicated blocks)
// ============================================================
// ctx = { lastRunRound, consecutiveEmptyRounds, consecutiveAgentFailures }
// These are main()-scoped tracking objects passed by reference.
function processAgentResult(result, round, roundAgents, costLog, ctx) {
  const status = result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'OK' : `ERROR(${result.code})`;
  log(`  ${result.agentId}: ${status} in ${(result.elapsed / 60).toFixed(1)}min`);
  roundAgents.push({ id: result.agentId, status, elapsed: result.elapsed });
  ctx.lastRunRound[result.agentId] = round;
  accumulateAgentCost(costLog, result, AGENTS);

  // v10: Record runtime for adaptive timeout (only successful non-timeout runs)
  if (!result.timedOut && result.elapsed > 0) {
    recordAgentRuntime(result.agentId, result.elapsed);
  }

  const { warnings, isEmptyWork } = validateAgentOutput(result.agentId, round, result);
  for (const w of warnings) log(`  ⚠ ${w}`);

  if (isEmptyWork) {
    ctx.consecutiveEmptyRounds[result.agentId] = (ctx.consecutiveEmptyRounds[result.agentId] || 0) + 1;
    if (ctx.consecutiveEmptyRounds[result.agentId] >= 3) {
      // v11: Smarter escalation guard — don't escalate if agent has no backlog tasks.
      // Empty work from "nothing to do" shouldn't burn cost on a bigger model.
      const agent = AGENTS.find(a => a.id === result.agentId);
      const backlog = loadBacklog();
      const hasBacklogTask = agent && backlog.some(t => t.status === 'pending' && t.role === agent.role);
      if (!hasBacklogTask) {
        log(`  ${result.agentId}: ${ctx.consecutiveEmptyRounds[result.agentId]} consecutive empty rounds but no pending tasks — skipping escalation`);
      } else {
        log(`  ⚠ ${result.agentId}: ${ctx.consecutiveEmptyRounds[result.agentId]} consecutive empty rounds — auto-escalating model`);
        if (agent) ctx.consecutiveAgentFailures[result.agentId] = 2;
      }
    }
  } else if (result.code === 0 && !result.timedOut) {
    ctx.consecutiveEmptyRounds[result.agentId] = 0;
  }
  // v10: Collect modified files from handoff for incremental testing
  const meta = parseHandoffMeta(result.agentId);
  // v13: Flag if balance-config.ts was modified (for experiment logging)
  const filesModified = meta.filesModified || [];
  const balanceConfigChanged = filesModified.some(f =>
    f.includes('balance-config') || f.includes('archetypes')
  );

  // v14: Record agent effectiveness metrics
  const costEntry = costLog[result.agentId];
  recordAgentEffectiveness(result.agentId, {
    filesModified,
    costEntry,
    elapsedSeconds: result.elapsed,
    isEmptyWork,
  });

  return { status, isEmptyWork, filesModified, balanceConfigChanged };
}

// Incremental Testing (v10→v20: config-driven test mapping)
// ============================================================
// v10: Maps source files to the test suites that exercise them.
// v20: Loaded from project-config.json if available, falls back to hardcoded defaults.
// Any file not in the map triggers a full test run (conservative fallback).

function getSourceToTests() {
  if (projectConfig?.testing?.sourceToTests) {
    return projectConfig.testing.sourceToTests;
  }
  // Legacy fallback (jousting-specific)
  return {
    'calculator.ts':       ['calculator.test.ts', 'gear-variants.test.ts'],
    'balance-config.ts':   ['calculator.test.ts', 'playtest.test.ts', 'gear-variants.test.ts'],
    'phase-joust.ts':      ['phase-resolution.test.ts', 'match.test.ts'],
    'phase-melee.ts':      ['phase-resolution.test.ts', 'match.test.ts'],
    'match.ts':            ['match.test.ts'],
    'gigling-gear.ts':     ['gigling-gear.test.ts', 'gear-variants.test.ts'],
    'player-gear.ts':      ['player-gear.test.ts', 'gear-variants.test.ts'],
    'archetypes.ts':       ['playtest.test.ts', 'match.test.ts', 'gear-variants.test.ts'],
    'attacks.ts':          ['calculator.test.ts', 'phase-resolution.test.ts', 'match.test.ts'],
  };
}

function getAiSourcePattern() {
  if (projectConfig?.testing?.aiSourcePattern) {
    return new RegExp(projectConfig.testing.aiSourcePattern);
  }
  return /^src\/ai\//;  // Legacy fallback
}

function getAiTestFile() {
  return projectConfig?.testing?.aiTestFile || 'ai.test.ts';
}

function getFullSuiteTriggers() {
  return projectConfig?.testing?.fullSuiteTriggers || ['types.ts', 'index.ts'];
}

function getTestFilterFlag() {
  return projectConfig?.testing?.filterFlag || '--testPathPattern';
}

/**
 * Given a list of modified file paths (from agent handoffs), return
 * the test filter string, or null for full suite.
 * v20: Uses config-driven mappings instead of hardcoded constants.
 */
function getTestFilter(modifiedFiles) {
  if (!modifiedFiles || !modifiedFiles.length) return null; // no info → full suite

  const SOURCE_TO_TESTS = getSourceToTests();
  const AI_SOURCE_PATTERN = getAiSourcePattern();
  const FULL_SUITE_TRIGGERS = getFullSuiteTriggers();
  const aiTestFile = getAiTestFile();

  const affectedTests = new Set();
  let needFullSuite = false;

  for (const filePath of modifiedFiles) {
    const basename = filePath.split('/').pop().split('\\').pop();

    // Non-source files (CSS, MD, JSON, orchestrator, etc.) — no tests needed
    if (!filePath.includes('src/')) continue;

    // Full suite triggers
    if (FULL_SUITE_TRIGGERS.includes(basename)) {
      needFullSuite = true;
      break;
    }

    // AI files
    if (AI_SOURCE_PATTERN.test(filePath)) {
      affectedTests.add(aiTestFile);
      continue;
    }

    // Check the mapping
    const mapped = SOURCE_TO_TESTS[basename];
    if (mapped) {
      for (const t of mapped) affectedTests.add(t);
    } else if (filePath.includes('src/engine/') || filePath.includes('src/ui/')) {
      // Unknown engine/ui file — be conservative
      needFullSuite = true;
      break;
    }
    // Other files (non-src) are ignored — no tests needed
  }

  if (needFullSuite) return null;
  if (affectedTests.size === 0) return ''; // empty string → skip tests entirely (no src changes)
  // Build regex: match any of the test file names
  return [...affectedTests].join('|');
}

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

// ============================================================
// Mission Sequence Support (v8)
// ============================================================
// A sequence mission chains multiple sub-missions in order.
// Format: { "type": "sequence", "missions": [{ "path": "...", "maxRounds": N }, ...] }
// When a sub-mission completes (agents retired, rounds exhausted, convergence),
// the orchestrator loads the next sub-mission and continues.

let missionSequence = null;     // Array of { path, maxRounds } or null
let currentMissionIndex = 0;    // Index into missionSequence
let currentMissionRoundsUsed = 0; // Rounds consumed by current sub-mission
let currentMissionMaxRounds = Infinity; // Round budget for current sub-mission

/**
 * Load a mission, detecting sequence missions and expanding them.
 * Returns the first (or only) mission's data.
 */
function loadMissionOrSequence(missionPath) {
  const absPath = resolve(missionPath);
  if (!existsSync(absPath)) {
    console.error(`Mission file not found: ${absPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(absPath, 'utf-8'));

  if (raw.type === 'sequence') {
    log(`Detected mission sequence: ${raw.name} (${raw.missions.length} sub-missions)`);

    // Apply top-level config (global overrides like maxRuntimeMs)
    if (raw.config) {
      Object.assign(CONFIG, raw.config);
      log(`  Sequence config: ${JSON.stringify(raw.config)}`);
    }

    missionSequence = raw.missions;
    currentMissionIndex = 0;

    // Load the first sub-mission
    return loadSubMission(0);
  }

  // Regular mission — no sequence
  missionSequence = null;
  return loadMission(missionPath);
}

/**
 * Load a sub-mission from the sequence by index.
 * Resets agent-specific state but preserves global state (tests, costs, round log).
 */
function loadSubMission(index) {
  const entry = missionSequence[index];
  const subPath = resolve(ORCH_DIR, '..', entry.path);
  currentMissionMaxRounds = entry.maxRounds || Infinity;
  currentMissionRoundsUsed = 0;

  log(`\n${'═'.repeat(50)}`);
  log(`  MISSION ${index + 1}/${missionSequence.length}: ${entry.path} (max ${currentMissionMaxRounds} rounds)`);
  log(`${'═'.repeat(50)}`);

  // v8 bugfix: Reset CONFIG to defaults before loading sub-mission.
  // Without this, mission 1's config properties leak into mission 2.
  resetConfigToDefaults();

  // v8 bugfix: Update missionConfigPath so hot-reload reads the correct sub-mission file.
  missionConfigPath = subPath;

  const mission = loadMission(subPath);

  return mission;
}

/**
 * Check if current sub-mission is done and transition to next if available.
 * @param {string} reason - Why the current mission ended
 * @returns {boolean} True if transitioned to a new mission, false if no more missions
 */
function tryTransitionMission(reason) {
  if (!missionSequence) return false;

  log(`  Mission ${currentMissionIndex + 1} complete: ${reason}`);

  currentMissionIndex++;
  if (currentMissionIndex >= missionSequence.length) {
    log(`  All ${missionSequence.length} missions in sequence completed.`);
    return false;
  }

  const mission = loadSubMission(currentMissionIndex);
  AGENTS = mission.agents.map(a => ({
    ...a,
    handoff: a.handoff || join(HANDOFF_DIR, `${a.id}.md`),
  }));
  missionDesignDoc = mission.designDoc;
  missionWorkflow = mission.workflow || null;
  // v22: DAG config for mission transitions
  if (CONFIG.enableDAG && mission.dag) {
    try { missionDAG = createDAGFromConfig(mission); }
    catch (_) { missionDAG = null; }
  } else {
    missionDAG = null;
  }

  // Reset agent-specific tracking for the new team
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
  const globalStart = Date.now();

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

  // Reset session changelog
  resetSessionChangelog();

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

  // v5B: Track per-agent empty rounds (ran OK but modified zero files)
  const consecutiveEmptyRounds = {};    // agentId → consecutive empty-work count

  // v9: Context object for processAgentResult (passes main-scoped tracking by reference)
  const trackingCtx = { lastRunRound, consecutiveEmptyRounds, consecutiveAgentFailures };

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
    paramSearchResults = await runParameterSearch(searchConfig.configPath, timeoutMs);
    if (paramSearchResults) {
      // Save results to balance-data for reference
      const outPath = join(BALANCE_DATA_DIR, `param-search-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      try {
        writeFileSync(outPath, JSON.stringify(paramSearchResults, null, 2));
        log(`  Results saved to: ${outPath}`);
      } catch (err) {
        log(`  Warning: could not save search results (${err.message})`);
      }
    }
  }

  // v8: Generate initial task board before round 1 (one-time; per-round refresh is post-Phase-A only)
  generateTaskBoard(0, null, 0);

  for (let round = 1; round <= CONFIG.maxRounds; round++) {
    // --- Check max runtime ---
    const elapsed = Date.now() - globalStart;
    if (elapsed >= CONFIG.maxRuntimeMs) {
      stopReason = `max runtime reached (${CONFIG.maxRuntimeMs / 3600000} hours)`;
      log(`\nMAX RUNTIME REACHED (${CONFIG.maxRuntimeMs / 3600000} hours). Stopping.`);
      break;
    }
    const remainingHrs = ((CONFIG.maxRuntimeMs - elapsed) / 3600000).toFixed(1);

    // --- Feature 5E: Hot-reload mission config each round ---
    if (missionConfigPath) {
      try {
        const absPath = resolve(missionConfigPath);
        const freshMission = JSON.parse(readFileSync(absPath, 'utf-8'));
        for (const freshAgent of (freshMission.agents || [])) {
          const existing = AGENTS.find(a => a.id === freshAgent.id);
          if (!existing) continue;
          // Only update live-tunable fields; preserve runtime state (_originalModel, etc.)
          const TUNABLE_FIELDS = ['model', 'timeoutMs', 'maxBudgetUsd', 'maxModel', 'minFrequencyRounds', 'maxTasksPerRound'];
          for (const field of TUNABLE_FIELDS) {
            const newVal = freshAgent[field] ?? (field === 'maxTasksPerRound' ? 1 : field === 'minFrequencyRounds' ? 0 : null);
            const oldVal = existing[field];
            if (newVal !== oldVal) {
              log(`Hot-reload: ${existing.id} ${field} changed ${oldVal}->${newVal}`);
              existing[field] = newVal;
            }
          }
        }
        // v7 Phase 2: Hot-reload balanceConfig (convergence criteria, thresholds)
        if (freshMission.balanceConfig) {
          const oldCC = JSON.stringify(CONFIG.balanceConfig?.convergenceCriteria || null);
          const newCC = JSON.stringify(freshMission.balanceConfig.convergenceCriteria || null);
          if (oldCC !== newCC) {
            log(`Hot-reload: convergenceCriteria changed`);
          }
          const oldThreshold = CONFIG.balanceConfig?.regressionThresholdPp;
          const newThreshold = freshMission.balanceConfig.regressionThresholdPp;
          if (oldThreshold !== newThreshold && newThreshold !== undefined) {
            log(`Hot-reload: regressionThresholdPp changed ${oldThreshold}->${newThreshold}`);
          }
          CONFIG.balanceConfig = freshMission.balanceConfig;
        }
        // v19: Hot-reload quality gates
        if (freshMission.qualityGates) {
          CONFIG.qualityGates = freshMission.qualityGates;
        }
      } catch (err) {
        log(`Hot-reload WARNING: Could not re-read mission config (${err.message}). Keeping existing config.`);
      }
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
        if (tryTransitionMission('all agents retired')) {
          resetAgentTracking();
          roundDecisions.push(...thisRoundDecisions);
          currentMissionRoundsUsed = 0;
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
    const roundConcurrency = getDynamicConcurrency();
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
        maxConcurrency: getDynamicConcurrency(),
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
      if (!tryTransitionMission('balance converged')) {
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
    if (missionSequence) {
      currentMissionRoundsUsed++;
      if (currentMissionRoundsUsed >= currentMissionMaxRounds) {
        if (!tryTransitionMission(`round budget exhausted (${currentMissionMaxRounds} rounds)`)) {
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
      if (!tryTransitionMission('all agents retired')) {
        stopReason = 'all agents exhausted their task lists';
        log('\nAll agents have exhausted their task lists. Orchestration finished.');
        break;
      }
      resetAgentTracking();
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
  generateOvernightReport(globalStart, roundLog, stopReason, finalTests, escalationCounts, costLog, roundDecisions);

  // v18: Signal to overnight runner — exit code 42 means "all work complete, no restart needed"
  const doneReasons = [
    'all agents exhausted their task lists',
    'all missions in sequence completed',
  ];
  if (doneReasons.includes(stopReason) || stopReason.startsWith('balance converged') || stopReason.startsWith('circuit breaker')) {
    log(`\nExit code 42: orchestration complete (${stopReason}) — no restart needed.`);
    process.exit(42);
  }
}

// ============================================================
// Overnight Report Generation
// ============================================================
function generateOvernightReport(globalStart, roundLog, stopReason, finalTests, escalationCounts = {}, costLog = {}, roundDecisions = []) {
  const totalMin = ((Date.now() - globalStart) / 60000).toFixed(1);
  const totalHrs = (totalMin / 60).toFixed(1);
  const totalRounds = roundLog.length;
  const startTime = new Date(globalStart).toISOString().replace('T', ' ').slice(0, 19);
  const endTime = timestamp();

  // Collect final agent states
  const agentSummaries = AGENTS.map(agent => {
    const meta = parseHandoffMeta(agent.id);
    const roundsActive = roundLog.filter(r => r.agents.some(a => a.id === agent.id)).length;
    const timeouts = roundLog.flatMap(r => r.agents).filter(a => a.id === agent.id && a.status === 'TIMEOUT').length;
    const errors = roundLog.flatMap(r => r.agents).filter(a => a.id === agent.id && a.status.startsWith('ERROR')).length;
    return { ...agent, meta, roundsActive, timeouts, errors, role: agent.role || 'none' };
  });

  // Collect all files modified across all agents
  const allFiles = [...new Set(agentSummaries.flatMap(a => a.meta.filesModified))].sort();

  // Test trajectory
  const testTrajectory = roundLog
    .filter(r => r.testsPassed !== null)
    .map(r => `Round ${r.round}: ${r.testsPassed ? 'PASS' : 'FAIL'} (${r.testCount} passed${r.testsPassed ? '' : `, ${r.failCount} failed`})`);

  // Read analysis reports if they exist
  const analysisFiles = [];
  try {
    for (const f of readdirSync(ANALYSIS_DIR)) {
      if (f.endsWith('.md') && f.includes('-round-')) {
        const match = f.match(/^(.+)-round-(\d+)\.md$/);
        if (match) {
          analysisFiles.push({ agent: match[1], round: parseInt(match[2]), path: join(ANALYSIS_DIR, f) });
        }
      }
    }
    analysisFiles.sort((a, b) => a.round - b.round);
  } catch (_) {}

  // v6E: Agent efficiency metrics (v6.1: enriched with idle/skipped data from decisions)
  const efficiencyMetrics = agentSummaries.map(a => {
    const totalTime = roundLog.flatMap(r => r.agents)
      .filter(ra => ra.id === a.id)
      .reduce((sum, ra) => sum + ra.elapsed, 0);
    const avgTime = a.roundsActive > 0 ? (totalTime / a.roundsActive / 60).toFixed(1) : '0';
    const successRate = a.roundsActive > 0
      ? Math.round(((a.roundsActive - a.timeouts - a.errors) / a.roundsActive) * 100)
      : 0;
    const filesPerRound = a.roundsActive > 0
      ? (a.meta.filesModified.length / a.roundsActive).toFixed(1)
      : '0';

    // v6.1: Calculate idle/skipped/blocked from decision log
    const agentDecisions = roundDecisions.filter(d => d.agentId === a.id);
    const roundsSkipped = agentDecisions.filter(d => d.decision === 'skipped').length;
    const roundsBlocked = agentDecisions.filter(d => d.decision === 'blocked').length;
    const roundsIdle = roundsSkipped + roundsBlocked;
    const idlePct = totalRounds > 0 ? Math.round((roundsIdle / totalRounds) * 100) : 0;

    return { id: a.id, model: a.model || 'default', avgTime, successRate, filesPerRound, roundsActive: a.roundsActive, totalRounds, roundsSkipped, roundsBlocked, idlePct };
  });

  // Build report
  let report = `# Overnight Orchestrator Report
> Generated: ${endTime}
> Orchestrator: v22

## Summary
- **Started**: ${startTime}
- **Ended**: ${endTime}
- **Total runtime**: ${totalMin} minutes (${totalHrs} hours)
- **Rounds completed**: ${totalRounds}
- **Stop reason**: ${stopReason}
${missionConfigPath ? `- **Mission**: ${missionConfigPath}` : '- **Mission**: default agents'}
- **Final test status**: ${finalTests.passed ? `ALL PASSING (${finalTests.count} tests)` : `FAILING (${finalTests.count} passed, ${finalTests.failCount} failed)`}

## Agent Results

| Agent | Type | Role | Final Status | Rounds Active | Timeouts | Errors | Files Modified |
|-------|------|------|-------------|---------------|----------|--------|----------------|
${agentSummaries.map(a =>
  `| ${a.id} | ${a.type} | ${a.role} | ${a.meta.status} | ${a.roundsActive} | ${a.timeouts} | ${a.errors} | ${a.meta.filesModified.length || 0} |`
).join('\n')}

### Agent Details
${agentSummaries.map(a => {
  let s = `\n#### ${a.name} (${a.id})\n- **Status**: ${a.meta.status}\n- **Rounds active**: ${a.roundsActive}`;
  if (a.meta.filesModified.length) s += `\n- **Files modified**: ${a.meta.filesModified.join(', ')}`;
  if (a.meta.notes) s += `\n- **Notes**: ${a.meta.notes}`;
  if (a.timeouts) s += `\n- **Timeouts**: ${a.timeouts}`;
  if (a.errors) s += `\n- **Errors**: ${a.errors}`;
  if (escalationCounts[a.id]) s += `\n- **Escalations**: ${escalationCounts[a.id]}`;
  if (a.maxModel) s += `\n- **Max model**: ${a.maxModel}`;
  return s;
}).join('\n')}

## Round-by-Round Timeline

| Round | Agents | Test Result | Agent Pool | Tests | Pre-Sim | Post-Sim | Overhead | Total |
|-------|--------|-------------|------------|-------|---------|----------|----------|-------|
${roundLog.map(r => {
  if (r.note) return `| ${r.round} | — | — | — | — | — | — | — | ${r.note} |`;
  const agents = r.agents.map(a => `${a.id}(${a.status}, ${(a.elapsed/60).toFixed(0)}m)`).join(', ');
  const tests = r.testsPassed ? `PASS (${r.testCount})` : `FAIL (${r.testCount}p, ${r.failCount}f)`;
  const t = r.timing || {};
  const fmt = (ms) => ms ? `${(ms/1000).toFixed(0)}s` : '—';
  // v17: "agents" field (unified pool) or legacy "phaseA"+"phaseB" for old round data
  const preSim = t.preSim || 0;
  const postSim = t.postSim || 0;
  const simsCompat = t.sims || 0;
  const agentPoolMs = t.agents || ((t.phaseA || 0) + (t.phaseB || 0)); // v17 or legacy sum
  const total = agentPoolMs + (t.tests || 0) + simsCompat + (t.overhead || 0);
  return `| ${r.round} | ${agents} | ${tests} | ${fmt(agentPoolMs)} | ${fmt(t.tests)} | ${fmt(preSim || simsCompat)} | ${fmt(postSim)} | ${fmt(t.overhead)} | ${fmt(total)} |`;
}).join('\n')}

## All Files Modified
${allFiles.length ? allFiles.map(f => `- ${f}`).join('\n') : '(none)'}

## Test Trajectory
${testTrajectory.length ? testTrajectory.map(t => `- ${t}`).join('\n') : '(no test data)'}

## Round Quality (v14)

| Round | Active | Idle | Util% | Files | OK | Failed |
|-------|--------|------|-------|-------|----|--------|
${roundLog.map(r => {
  if (r.note) return `| ${r.round} | — | — | — | — | — | ${r.note} |`;
  const q = r.quality || {};
  return `| ${r.round} | ${q.agentsActive ?? '—'} | ${q.agentsIdle ?? '—'} | ${q.utilization ?? '—'}% | ${q.filesModified ?? '—'} | ${q.successful ?? '—'} | ${q.failed ?? '—'} |`;
}).join('\n')}

## Agent Effectiveness (v14)

${(() => {
  const ids = Object.keys(agentEffectiveness);
  if (!ids.length) return '> No effectiveness data captured yet.\n';

  const rows = ids.map(id => {
    const e = agentEffectiveness[id];
    const tokensPerFile = e.totalFiles > 0 ? Math.round(e.totalTokens / e.totalFiles) : '—';
    const costPerTask = e.tasksCompleted > 0 ? '$' + (e.totalCost / e.tasksCompleted).toFixed(4) : '—';
    const avgMin = e.rounds > 0 ? (e.totalSeconds / e.rounds / 60).toFixed(1) : '0';
    const successRate = e.rounds > 0 ? Math.round((e.tasksCompleted / e.rounds) * 100) : 0;
    return `| ${id} | ${e.rounds} | ${e.tasksCompleted} | ${e.totalFiles} | ${tokensPerFile} | ${costPerTask} | ${avgMin}m | ${successRate}% |`;
  });

  return `| Agent | Rounds | Tasks Done | Files | Tokens/File | Cost/Task | Avg Time | Prod% |
|-------|--------|------------|-------|-------------|-----------|----------|-------|
${rows.join('\n')}

> **Prod%** = rounds with meaningful file output / total rounds run. **Tokens/File** = total tokens consumed / files modified.
`;
})()}

## Session Continuity (v16)

${(() => {
  const sessionIds = Object.keys(agentSessions);
  if (!sessionIds.length) return '> No session data captured (all agents ran fresh only).\n';

  const totalResumes = sessionIds.reduce((sum, id) => sum + (agentSessions[id]?.resumeCount || 0), 0);
  const totalFresh = sessionIds.reduce((sum, id) => sum + (agentSessions[id]?.freshCount || 0), 0);
  const totalInvalidations = sessionIds.reduce((sum, id) => sum + (agentSessions[id]?.invalidations || 0), 0);
  const resumePct = (totalResumes + totalFresh) > 0
    ? Math.round((totalResumes / (totalResumes + totalFresh)) * 100) : 0;

  const rows = sessionIds.map(id => {
    const s = agentSessions[id];
    return `| ${id} | ${s.freshCount || 1} | ${s.resumeCount || 0} | ${s.invalidations || 0} | ${s.sessionId?.slice(0, 8) ?? '—'}... |`;
  });

  return `- **Resumed sessions**: ${totalResumes} (${resumePct}% of agent-rounds used session continuity)
- **Fresh sessions**: ${totalFresh}
- **Session invalidations**: ${totalInvalidations}

| Agent | Fresh | Resumes | Invalidations | Session ID |
|-------|-------|---------|---------------|------------|
${rows.join('\n')}

> Resumed agents skip role template + shared rules loading and receive a compact delta prompt.
`;
})()}

## Agent Efficiency (v6.1 Metrics)

| Agent | Model | Avg Time | Success | Files/Rnd | Active | Skipped | Blocked | Idle% |
|-------|-------|----------|---------|-----------|--------|---------|---------|-------|
${efficiencyMetrics.map(m =>
  `| ${m.id} | ${m.model} | ${m.avgTime}m | ${m.successRate}% | ${m.filesPerRound} | ${m.roundsActive}/${m.totalRounds} | ${m.roundsSkipped} | ${m.roundsBlocked} | ${m.idlePct}% |`
).join('\n')}

## Backlog Velocity (v8)

| Round | Pending | Completed | Notes |
|-------|---------|-----------|-------|
${roundLog.map(r => {
  if (r.note) return `| ${r.round} | — | — | ${r.note} |`;
  const bl = r.backlog || {};
  return `| ${r.round} | ${bl.pending ?? '—'} | ${bl.completed ?? '—'} | |`;
}).join('\n')}

## Cost Summary

${(() => {
  const agentIds = Object.keys(costLog);
  if (!agentIds.length) return '> No cost data captured. Claude CLI may not have emitted token/cost info to stderr.\n> Once cost data is available, this section will populate automatically.\n';

  // Build per-agent cost rows
  const rows = agentSummaries.map(a => {
    const c = costLog[a.id] || { totalCost: 0, inputTokens: 0, outputTokens: 0, rounds: 0, escalations: 0 };
    const model = a.model || 'default';
    const estCost = c.totalCost > 0 ? `$${c.totalCost.toFixed(4)}` : '—';
    const avgCost = c.rounds > 0 && c.totalCost > 0 ? `$${(c.totalCost / c.rounds).toFixed(4)}` : '—';
    const inputK = c.inputTokens > 0 ? `${(c.inputTokens / 1000).toFixed(1)}k` : '—';
    const outputK = c.outputTokens > 0 ? `${(c.outputTokens / 1000).toFixed(1)}k` : '—';
    return `| ${a.id} | ${model} | ${c.rounds} | ${inputK} | ${outputK} | ${estCost} | ${avgCost} | ${c.escalations} |`;
  });

  // Totals
  const totals = agentSummaries.reduce((acc, a) => {
    const c = costLog[a.id] || { totalCost: 0, inputTokens: 0, outputTokens: 0, rounds: 0, escalations: 0 };
    acc.cost += c.totalCost;
    acc.input += c.inputTokens;
    acc.output += c.outputTokens;
    acc.rounds += c.rounds;
    acc.escalations += c.escalations;
    return acc;
  }, { cost: 0, input: 0, output: 0, rounds: 0, escalations: 0 });

  const totalInputK = totals.input > 0 ? `${(totals.input / 1000).toFixed(1)}k` : '—';
  const totalOutputK = totals.output > 0 ? `${(totals.output / 1000).toFixed(1)}k` : '—';
  const totalCostStr = totals.cost > 0 ? `$${totals.cost.toFixed(4)}` : '—';
  const avgCostStr = totals.rounds > 0 && totals.cost > 0 ? `$${(totals.cost / totals.rounds).toFixed(4)}` : '—';

  // Successful task count for cost-per-task metric
  const successfulRounds = agentSummaries.reduce((sum, a) => sum + a.roundsActive - a.timeouts - a.errors, 0);
  const costPerSuccess = successfulRounds > 0 && totals.cost > 0 ? `$${(totals.cost / successfulRounds).toFixed(4)}` : '—';

  return `| Agent | Model | Rounds | Input Tokens | Output Tokens | Est. Cost | Avg Cost/Round | Escalations |
|-------|-------|--------|-------------|---------------|-----------|----------------|-------------|
${rows.join('\n')}
| **TOTAL** | | **${totals.rounds}** | **${totalInputK}** | **${totalOutputK}** | **${totalCostStr}** | **${avgCostStr}** | **${totals.escalations}** |

- **Cost per successful agent-round**: ${costPerSuccess}
- **Pricing basis**: haiku ($0.25/$1.25 per M in/out), sonnet ($3/$15), opus ($15/$75)
- **Note**: Costs are estimates from token counts if CLI did not report direct cost`;
})()}

## Model Escalation Summary

| Agent | Base Model | Max Model | Final Model | Escalations |
|-------|-----------|-----------|-------------|-------------|
${agentSummaries.map(a => {
  const baseModel = a._originalModel || a.model || 'default';
  const maxModel = a.maxModel || 'none';
  const finalModel = a.model || 'default';
  const escCount = escalationCounts[a.id] || 0;
  return `| ${a.id} | ${baseModel} | ${maxModel} | ${finalModel} | ${escCount} |`;
}).join('\n')}

## Decision Log Summary

${(() => {
  if (!roundDecisions.length) return '(no decisions recorded)\n';

  // Aggregate per-agent stats from decision log
  const agentDecisionStats = {};
  for (const d of roundDecisions) {
    if (!agentDecisionStats[d.agentId]) {
      agentDecisionStats[d.agentId] = { included: 0, skipped: 0, blocked: 0, succeeded: 0, failed: 0 };
    }
    const s = agentDecisionStats[d.agentId];
    if (d.decision === 'included') {
      s.included++;
      if (d.succeeded === true) s.succeeded++;
      else if (d.succeeded === false) s.failed++;
    } else if (d.decision === 'skipped') {
      s.skipped++;
    } else if (d.decision === 'blocked') {
      s.blocked++;
    }
  }

  const rows = Object.entries(agentDecisionStats).map(([id, s]) => {
    const successRate = s.included > 0 ? Math.round((s.succeeded / s.included) * 100) + '%' : '—';
    return `| ${id} | ${s.included} | ${s.skipped} | ${s.blocked} | ${successRate} |`;
  });

  return `| Agent | Included | Skipped | Blocked | Success Rate |
|-------|----------|---------|---------|-------------|
${rows.join('\n')}

> Full decision log: \`orchestrator/logs/round-decisions.json\`
`;
})()}
## Analysis Reports Generated
${analysisFiles.length
  ? analysisFiles.map(a => `- ${a.agent} round ${a.round}: \`${a.path}\``).join('\n')
  : '(none)'}

## How to Review
1. Read each agent's handoff for detailed work log: \`orchestrator/handoffs/<agent>.md\`
2. Read analysis reports: \`orchestrator/analysis/\`
3. Check git log for per-round commits: \`git log --oneline\`
4. To revert to before the run: \`git log --oneline\` and find the pre-orchestrator commit
5. Run tests: \`${getTestCommand()}\`
`;

  writeFileSync(CONFIG.reportFile, report);
  log(`\nOvernight report written to: ${CONFIG.reportFile}`);
}

main().catch(err => {
  log(`FATAL ERROR: ${err.message}\n${err.stack}`);
  process.exit(1);
});
