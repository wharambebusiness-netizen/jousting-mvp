#!/usr/bin/env node
// ============================================================
// Jousting MVP — Multi-Agent Orchestrator v8
// ============================================================
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

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runConsistencyCheck } from './consistency-check.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ORCH_DIR = __dirname;
const MVP_DIR = resolve(ORCH_DIR, '..'); // jousting-mvp/ (orchestrator lives inside it)
const HANDOFF_DIR = join(ORCH_DIR, 'handoffs');
const LOG_DIR = join(ORCH_DIR, 'logs');
const ANALYSIS_DIR = join(ORCH_DIR, 'analysis');
const ROLES_DIR = join(ORCH_DIR, 'roles');
const BALANCE_DATA_DIR = join(ORCH_DIR, 'balance-data');
const TASK_BOARD = join(ORCH_DIR, 'task-board.md');

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

function getNextTask(role) {
  return getNextTasks(role, 1)[0] || null;
}

function getNextTasks(role, maxTasks = 1) {
  const backlog = loadBacklog();
  const tasks = backlog
    .filter(t =>
      t.status === 'pending' && t.role === role &&
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
        '- Run tests (`npx vitest run`) before writing your final handoff',
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

function loadRoleTemplate(roleName) {
  if (!roleName) return '';
  const rolePath = join(ROLES_DIR, `${roleName}.md`);
  if (!existsSync(rolePath)) return '';
  return readFileSync(rolePath, 'utf-8');
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
  const path = join(HANDOFF_DIR, `${agentId}.md`);
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
5. Run \`npx vitest run\` before writing your final handoff to confirm tests pass
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

    // Build prompt — CLAUDE.md provides project context (auto-loaded by Claude Code)
    // so we only need coordination info + role guidelines + task reference
    const promptParts = [
      `You are "${agent.name}", part of a multi-agent team. Round ${round}.`,
      `Project context is in CLAUDE.md (auto-loaded).`,
      ``,
      `READ FIRST:`,
      `1. orchestrator/session-changelog.md (what changed this session so far)`,
      `2. orchestrator/task-board.md (coordination status — DO NOT edit)`,
      `3. orchestrator/handoffs/${agent.id}.md (your tasks and progress)`,
    ];

    // Add design doc reference if mission specifies one
    if (missionDesignDoc) {
      promptParts.push(`3. ${missionDesignDoc} (design reference)`);
    }

    promptParts.push(
      ``,
      `Then do your work. When done, write updated handoff to orchestrator/handoffs/${agent.id}.md.`,
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
        ? `You are CONTINUOUS — write analysis to orchestrator/analysis/${agent.id}-round-${round}.md`
        : `You are FEATURE — mark "complete" when primary milestone done, "all-done" when stretch goals done too.`,
    );

    // v5/v6: Inject batch backlog tasks if available
    const backlogTasks = getNextTasks(agent.role, agent.maxTasksPerRound || 1);
    if (backlogTasks.length) {
      promptParts.push(``, `--- BACKLOG TASKS (from producer) ---`);
      for (let i = 0; i < backlogTasks.length; i++) {
        const bt = backlogTasks[i];
        promptParts.push(
          `Task ${i + 1} of ${backlogTasks.length}: ${bt.id} (P${bt.priority}) — ${bt.title}`,
          `Description: ${bt.description}`,
          `Files: ${(bt.fileOwnership || []).join(', ')}`,
        );
      }
      promptParts.push(`Work through these in order. Note completed task IDs in handoff META under completed-tasks.`);
    }

    // v7 Phase 2: Inject balance context (only to balance-aware roles, not css-artist/ui-dev)
    const BALANCE_AWARE_ROLES = ['balance-analyst', 'tech-lead', 'qa-engineer', 'producer', 'engine-dev', 'game-designer'];
    if (CONFIG.balanceConfig && BALANCE_AWARE_ROLES.includes(agent.role)) {
      const balanceCtx = buildBalanceContext();
      if (balanceCtx) {
        promptParts.push(
          ``,
          `--- BALANCE CONTEXT (auto-generated from orchestrator sims — DO NOT run your own sims) ---`,
          balanceCtx,
          `Use this data for analysis. The orchestrator runs sims before/after each round automatically.`,
        );
      }
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

    // Append shared rules (common to all agents)
    if (commonRulesContent) {
      promptParts.push(``, `--- SHARED RULES ---`, commonRulesContent);
    }

    // Append role template if available (provides domain-specific guidelines)
    if (roleTemplate) {
      promptParts.push(``, `--- ROLE GUIDELINES ---`, roleTemplate);
    }

    const prompt = promptParts.join('\n');

    // v6.1: Log estimated prompt tokens for Phase 4 cost analysis
    const estimatedTokens = Math.ceil(prompt.length / 4);
    log(`  Starting ${agent.id}... (~${estimatedTokens} prompt tokens, model=${agent.model || 'default'})`);
    const startTime = Date.now();

    // v5/v6: Build CLI args with optional per-agent model + budget
    const cliArgs = ['-p', '--allowedTools', CONFIG.allowedTools, '--output-format', 'text'];
    if (agent.model) cliArgs.push('--model', agent.model);
    if (agent.maxBudgetUsd) cliArgs.push('--max-budget-usd', String(agent.maxBudgetUsd));

    // Spawn claude with prompt piped via stdin (avoids Windows cmd length limit)
    const proc = spawn('claude', cliArgs, {
      cwd: MVP_DIR,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    activeProcs.add(proc.pid);

    // v5: Per-agent timeout override or global default
    const timeout = agent.timeoutMs || CONFIG.agentTimeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      log(`  ${agent.id} TIMED OUT after ${timeout / 60000} minutes — killing process tree (PID ${proc.pid})`);
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

    proc.on('close', (code) => {
      clearTimeout(timer);
      activeProcs.delete(proc.pid);
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const elapsedMin = (elapsed / 60).toFixed(1);
      const status = timedOut ? 'TIMEOUT' : code === 0 ? 'OK' : `EXIT-${code}`;
      log(`  ${agent.id} finished: ${status} (${elapsedMin} min)`);
      resolvePromise({ agentId: agent.id, code, timedOut, elapsed, stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      activeProcs.delete(proc.pid);
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
  if (!bc || !bc.sims?.length) return { results: [], allSucceeded: true };

  mkdirSync(BALANCE_DATA_DIR, { recursive: true });

  const timeoutMs = bc.simTimeoutMs || 60000;
  const results = [];

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
  return { results, allSucceeded };
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
// Concurrency Limiter (v5 Phase 6D)
// ============================================================
async function runAgentsWithConcurrency(agents, round, maxConcurrency) {
  if (!maxConcurrency || maxConcurrency >= agents.length) {
    return Promise.all(agents.map(a => runAgent(a, round)));
  }

  const results = [];
  for (let i = 0; i < agents.length; i += maxConcurrency) {
    const batch = agents.slice(i, i + maxConcurrency);
    log(`  Concurrency batch ${Math.floor(i / maxConcurrency) + 1}: ${batch.map(a => a.id).join(', ')}`);
    const batchResults = await Promise.all(batch.map(a => runAgent(a, round)));
    results.push(...batchResults);
  }
  return results;
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

  // Reset agent-specific tracking for the new team
  return true;
}

// ============================================================
// Main Orchestration Loop
// ============================================================
// Module-level variables set by loadMission, used by runAgent and report generation
let missionDesignDoc = null;
let missionConfigPath = null;

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

  log('');
  log('='.repeat(60));
  log('  JOUSTING MVP — MULTI-AGENT ORCHESTRATOR v8');
  log('='.repeat(60));
  if (missionConfigPath) log(`Mission: ${missionConfigPath}`);
  log(`Agents: ${AGENTS.map(a => `${a.id} (${a.type}${a.role ? `, ${a.role}` : ''})`).join(', ')}`);
  log(`Config: ${CONFIG.maxRounds} max rounds, ${CONFIG.agentTimeoutMs / 60000}min/agent, ${CONFIG.maxRuntimeMs / 3600000}hr max runtime`);
  log(`Circuit breaker: stop after ${CONFIG.circuitBreakerThreshold} consecutive test failures`);
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
    log(`  Agent tracking state reset for new mission`);
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
      } catch (err) {
        log(`Hot-reload WARNING: Could not re-read mission config (${err.message}). Keeping existing config.`);
      }
    }

    log(`\n${'━'.repeat(50)}`);
    log(`  ROUND ${round} of ${CONFIG.maxRounds}  (${remainingHrs}hr remaining)`);
    log(`${'━'.repeat(50)}`);

    // --- v7: Pre-round git tag ---
    await tagRoundStart(round);

    // --- Generate task board (orchestrator-owned) ---
    // v8: Single generation per round, moved to post-Phase-A (line ~2500) so Phase B
    // agents see updated test status. Phase A agents still see the board from last round.
    // generateTaskBoard() removed here — was a redundant duplicate.

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
    const agentHasBacklogTask = (role) => backlogCache.some(t => t.status === 'pending' && t.role === role);

    const activeAgents = AGENTS.filter(agent => {
      const meta = handoffCache[agent.id];

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
        const hasBacklogTask = agentHasBacklogTask(agent.role);
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

      // v8: Pre-flight check — skip agents that likely won't produce useful work
      // 1. Coordination agents (Phase B) with no new changes to react to
      if (COORD_AGENT_ROLES.has(agent.role) && round > 1) {
        const hasBacklogTask = agentHasBacklogTask(agent.role);
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
        }
      }

      // 2. Agents with 2+ consecutive empty rounds AND no new backlog tasks
      if ((consecutiveEmptyRounds[agent.id] || 0) >= 2) {
        if (!agentHasBacklogTask(agent.role)) {
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
      log('\nNo agents can run this round (all blocked or all-done). Waiting...');
      roundDecisions.push(...thisRoundDecisions);
      roundLog.push({ round, agents: [], testsPassed: null, testCount: '-', failCount: '-', note: 'skipped (all blocked)' });
      continue;
    }

    // --- v6: Two-phase rounds (code agents first, then coordination) ---
    const codeAgents = activeAgents.filter(a => CODE_AGENT_ROLES.has(a.role));
    const coordAgents = activeAgents.filter(a => COORD_AGENT_ROLES.has(a.role));
    const roundAgents = [];
    let testResult = null;
    let didRevert = false;  // v6.1: Track if auto-revert happened (skip Phase B if so)
    let preSimResults = null;  // v7: Balance sim baseline
    let postSimResults = null; // v7: Balance sim after changes
    let regressionResult = null;   // v7 Phase 2: Regression detection results
    let convergenceResult = null;  // v7 Phase 2: Convergence check results

    // v8: Round time breakdown tracking
    const roundTiming = { roundStart: Date.now(), phaseA: 0, phaseB: 0, tests: 0, sims: 0, overhead: 0 };

    // v7: Pre-sim — capture balance baseline before code agents make changes
    if (CONFIG.balanceConfig?.runPreSim !== false && CONFIG.balanceConfig?.sims?.length && codeAgents.length) {
      const simStart = Date.now();
      log(`\nBalance Pre-Sim (baseline):`);
      preSimResults = await runBalanceSims(round, 'pre');
      roundTiming.sims += Date.now() - simStart;
    }

    // Phase A: Code agents
    if (codeAgents.length) {
      const phaseAStart = Date.now();
      log(`\nPhase A: Launching ${codeAgents.length} code agent(s)...`);
      const codeResults = await runAgentsWithConcurrency(codeAgents, round, CONFIG.maxConcurrency);

      for (const r of codeResults) {
        const status = r.timedOut ? 'TIMEOUT' : r.code === 0 ? 'OK' : `ERROR(${r.code})`;
        log(`  ${r.agentId}: ${status} in ${(r.elapsed / 60).toFixed(1)}min`);
        roundAgents.push({ id: r.agentId, status, elapsed: r.elapsed });
        lastRunRound[r.agentId] = round;
      }

      // Post-Phase A: changelog, failed task reassignment, validation, cost tracking
      appendSessionChangelog(round, codeResults);
      handleFailedTasks(codeResults);
      for (const r of codeResults) {
        accumulateAgentCost(costLog, r, AGENTS);
        const { warnings, isEmptyWork } = validateAgentOutput(r.agentId, round, r);
        for (const w of warnings) log(`  ⚠ ${w}`);

        // v5B: Track consecutive empty rounds per agent
        if (isEmptyWork) {
          consecutiveEmptyRounds[r.agentId] = (consecutiveEmptyRounds[r.agentId] || 0) + 1;
          if (consecutiveEmptyRounds[r.agentId] >= 3) {
            log(`  ⚠ ${r.agentId}: ${consecutiveEmptyRounds[r.agentId]} consecutive empty rounds — auto-escalating model`);
            // v6.1: Auto-escalate after 3 empty rounds (agent may need smarter model)
            const agent = AGENTS.find(a => a.id === r.agentId);
            if (agent) {
              consecutiveAgentFailures[r.agentId] = 2; // trigger escalation in handleModelEscalation
            }
          }
        } else if (r.code === 0 && !r.timedOut) {
          // Reset on successful non-empty work
          consecutiveEmptyRounds[r.agentId] = 0;
        }
      }
      validateFileOwnership(codeResults, AGENTS);

      // v6: Model escalation check
      handleModelEscalation(codeResults, round);
      roundTiming.phaseA = Date.now() - phaseAStart;

      // Run tests after code agents
      const testStart = Date.now();
      testResult = await runTests();
      roundTiming.tests += Date.now() - testStart;

      // v8: Smart per-agent revert on test regression
      // Instead of reverting ALL of src/, identify which agent(s) broke tests
      // and only revert their files — preserving good work from other agents.
      if (!testResult.passed && lastTestStatus?.includes('PASSING')) {
        log(`  ⚠ Tests regressed this round! Attempting smart per-agent revert...`);
        const revertResult = await smartRevert(round, codeResults);
        if (revertResult.reverted) {
          log(`  Revert strategy: ${revertResult.strategy}, agents reverted: [${revertResult.revertedAgents.join(', ')}]`);
          // Re-run tests to confirm revert worked
          testResult = await runTests();
        }
        didRevert = true;
      }

      // Refresh task-board so Phase B agents see updated state
      generateTaskBoard(round, testResult.passed ? `PASSING (${testResult.count} tests)` : lastTestStatus, consecutiveTestFailures);

      // v7: Post-sim — measure balance after code agent changes (only if tests passed and no revert)
      if (CONFIG.balanceConfig?.runPostSim !== false && CONFIG.balanceConfig?.sims?.length && testResult.passed && !didRevert) {
        const simStart = Date.now();
        log(`\nBalance Post-Sim (after changes):`);
        postSimResults = await runBalanceSims(round, 'post');
        roundTiming.sims += Date.now() - simStart;
      }

      // v7: Update balance state tracker with pre/post sim results
      if (preSimResults?.results?.length || postSimResults?.results?.length) {
        updateBalanceState(round, preSimResults?.results, postSimResults?.results);
      }

      // v7 Phase 2: Regression detection — flag when changes help one archetype but hurt another
      if (preSimResults?.results?.length && postSimResults?.results?.length) {
        regressionResult = detectBalanceRegressions(round, preSimResults.results, postSimResults.results);

        // Store regressions in balance state for agent context
        if (regressionResult.hasRegressions) {
          const state = loadBalanceState();
          if (state.rounds.length) {
            state.rounds[state.rounds.length - 1]._regressions = regressionResult.regressions;
            saveBalanceState(state);
          }
        }
      }

      // v7 Phase 2: Convergence check — auto-stop if balance meets criteria
      if (postSimResults?.results?.length && CONFIG.balanceConfig?.convergenceCriteria) {
        convergenceResult = checkConvergence(postSimResults.results, round);
        if (convergenceResult.converged) {
          stopReason = `balance converged — all tiers within thresholds at round ${round}`;
          log(`\n✓ BALANCE CONVERGED. Stopping orchestration.`);
          // Still run Phase B so coordination agents can see final state
        }
      }

      // v7 Phase 3: Auto-generate backlog tasks from sim data
      if (postSimResults?.results?.length) {
        generateBalanceBacklog(round, postSimResults.results, regressionResult);
      }
    }

    // Phase B: Coordination agents (see fresh handoffs from Phase A)
    // v6.1: Skip Phase B if auto-revert happened — handoffs reference reverted work
    if (didRevert && coordAgents.length) {
      log(`\nPhase B: SKIPPED (auto-revert happened — coordination agents would see stale state)`);
    }
    if (coordAgents.length && !didRevert) {
      const phaseBStart = Date.now();
      log(`\nPhase B: Launching ${coordAgents.length} coordination agent(s)...`);
      const coordResults = await runAgentsWithConcurrency(coordAgents, round, CONFIG.maxConcurrency);

      for (const r of coordResults) {
        const status = r.timedOut ? 'TIMEOUT' : r.code === 0 ? 'OK' : `ERROR(${r.code})`;
        log(`  ${r.agentId}: ${status} in ${(r.elapsed / 60).toFixed(1)}min`);
        roundAgents.push({ id: r.agentId, status, elapsed: r.elapsed });
        lastRunRound[r.agentId] = round;
      }

      appendSessionChangelog(round, coordResults);
      handleFailedTasks(coordResults);
      for (const r of coordResults) {
        accumulateAgentCost(costLog, r, AGENTS);
        const { warnings, isEmptyWork } = validateAgentOutput(r.agentId, round, r);
        for (const w of warnings) log(`  ⚠ ${w}`);

        // v5B: Track consecutive empty rounds per agent
        if (isEmptyWork) {
          consecutiveEmptyRounds[r.agentId] = (consecutiveEmptyRounds[r.agentId] || 0) + 1;
          if (consecutiveEmptyRounds[r.agentId] >= 3) {
            log(`  ⚠ ${r.agentId}: ${consecutiveEmptyRounds[r.agentId]} consecutive empty rounds — auto-escalating model`);
            const agent = AGENTS.find(a => a.id === r.agentId);
            if (agent) {
              consecutiveAgentFailures[r.agentId] = 2;
            }
          }
        } else if (r.code === 0 && !r.timedOut) {
          consecutiveEmptyRounds[r.agentId] = 0;
        }
      }
      validateFileOwnership(coordResults, AGENTS);
      handleModelEscalation(coordResults, round);
      roundTiming.phaseB = Date.now() - phaseBStart;
    }

    // v8: Compute overhead (everything not in phases, tests, or sims)
    const roundTotal = Date.now() - roundTiming.roundStart;
    roundTiming.overhead = roundTotal - roundTiming.phaseA - roundTiming.phaseB - roundTiming.tests - roundTiming.sims;

    // --- Update test status ---
    if (!testResult) {
      // No code agents ran — carry forward last test status
      log('  Skipping tests (no code-modifying agents ran this round)');
    }
    if (testResult) {
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
    });

    // --- Circuit breaker ---
    if (consecutiveTestFailures >= CONFIG.circuitBreakerThreshold) {
      stopReason = `circuit breaker (${consecutiveTestFailures} consecutive test failures)`;
      log(`\n🛑 CIRCUIT BREAKER: Tests failed ${consecutiveTestFailures} rounds in a row. STOPPING.`);
      log(`Check logs at: ${LOG_DIR}`);
      log(`Last test output saved in test-results.log`);
      break;
    }

    // --- v7 Phase 2: Convergence stop (after Phase B has run) ---
    if (convergenceResult?.converged) {
      // v8: Try transitioning to next mission before stopping
      if (!tryTransitionMission('balance converged')) {
        break; // stopReason already set above
      }
      resetAgentTracking();
      // Transitioned — continue to next mission's rounds
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

  // ============================================================
  // Generate Overnight Report
  // ============================================================
  generateOvernightReport(globalStart, roundLog, stopReason, finalTests, escalationCounts, costLog, roundDecisions);
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
> Orchestrator: v8

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

| Round | Agents | Test Result | Phase A | Phase B | Tests | Sims | Overhead | Total |
|-------|--------|-------------|---------|---------|-------|------|----------|-------|
${roundLog.map(r => {
  if (r.note) return `| ${r.round} | — | — | — | — | — | — | — | ${r.note} |`;
  const agents = r.agents.map(a => `${a.id}(${a.status}, ${(a.elapsed/60).toFixed(0)}m)`).join(', ');
  const tests = r.testsPassed ? `PASS (${r.testCount})` : `FAIL (${r.testCount}p, ${r.failCount}f)`;
  const t = r.timing || {};
  const fmt = (ms) => ms ? `${(ms/1000).toFixed(0)}s` : '—';
  const total = (t.phaseA || 0) + (t.phaseB || 0) + (t.tests || 0) + (t.sims || 0) + (t.overhead || 0);
  return `| ${r.round} | ${agents} | ${tests} | ${fmt(t.phaseA)} | ${fmt(t.phaseB)} | ${fmt(t.tests)} | ${fmt(t.sims)} | ${fmt(t.overhead)} | ${fmt(total)} |`;
}).join('\n')}

## All Files Modified
${allFiles.length ? allFiles.map(f => `- ${f}`).join('\n') : '(none)'}

## Test Trajectory
${testTrajectory.length ? testTrajectory.map(t => `- ${t}`).join('\n') : '(no test data)'}

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
5. Run tests: \`npx vitest run\`
`;

  writeFileSync(CONFIG.reportFile, report);
  log(`\nOvernight report written to: ${CONFIG.reportFile}`);
}

main().catch(err => {
  log(`FATAL ERROR: ${err.message}\n${err.stack}`);
  process.exit(1);
});
