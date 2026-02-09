#!/usr/bin/env node
// ============================================================
// Jousting MVP — Multi-Agent Orchestrator v4
// ============================================================
// v4 additions:
// - Backlog system (orchestrator/backlog.json) for dynamic task injection
// - Continuous agents never retire — always find more work
// - Producer role integration — generates tasks for other agents
// - Better overnight sustainability
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
};

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
  for (const dir of [HANDOFF_DIR, LOG_DIR, ANALYSIS_DIR]) {
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
//   - tests-passing: true | false
//   - notes-for-others: free text
//
// Status meanings:
//   in-progress — working on primary milestone
//   complete    — primary milestone done, satisfies dependencies, agent moves to stretch goals
//   all-done    — all tasks exhausted (primary + stretch), agent is retired
//   blocked     — waiting on dependency
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
// Validation Functions
// ============================================================
function validateFileOwnership(agentResults, agents) {
  const violationLog = join(LOG_DIR, 'ownership-violations.log');
  for (const result of agentResults) {
    const agent = agents.find(a => a.id === result.agentId);
    if (!agent?.fileOwnership?.length) continue;
    const meta = parseHandoffMeta(result.agentId);
    for (const file of meta.filesModified) {
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

function validateAgentOutput(agentId, round) {
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
  return warnings;
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

    // Append shared rules (common to all agents)
    if (commonRulesContent) {
      promptParts.push(``, `--- SHARED RULES ---`, commonRulesContent);
    }

    // Append role template if available (provides domain-specific guidelines)
    if (roleTemplate) {
      promptParts.push(``, `--- ROLE GUIDELINES ---`, roleTemplate);
    }

    const prompt = promptParts.join('\n');

    log(`  Starting ${agent.id}...`);
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
  return new Promise((resolvePromise) => {
    const tag = `round-${round}-start`;
    const cmd = `git checkout ${tag} -- src/`;
    const proc = spawn('cmd', ['/c', cmd], {
      cwd: MVP_DIR,
      shell: true,
      stdio: 'pipe',
    });
    proc.on('close', (code) => {
      if (code === 0) log(`  Reverted src/ to tag ${tag}`);
      else log(`  Revert to tag ${tag} failed (code ${code})`);
      resolvePromise();
    });
    proc.on('error', () => resolvePromise());
  });
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
      } catch (_) {}
    }
  }

  if (archived > 0) {
    log(`Analysis rotation: archived ${archived} old report(s) (keeping last ${keepRounds} rounds)`);
  }
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
// Module-level variables set by loadMission, used by runAgent and report generation
let missionDesignDoc = null;
let missionConfigPath = null;

async function main() {
  ensureDirs();
  const globalStart = Date.now();

  // --- Load mission config if provided as CLI argument ---
  missionConfigPath = process.argv[2] || null;
  if (missionConfigPath) {
    const mission = loadMission(missionConfigPath);
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
  log('  JOUSTING MVP — MULTI-AGENT ORCHESTRATOR v5');
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

  // v6: Cost tracking accumulator — per-agent cost data across rounds
  const costLog = {};  // agentId → { totalCost, inputTokens, outputTokens, rounds, escalations }

  // v5/v6: Classify agent roles for two-phase rounds
  const CODE_AGENT_ROLES = new Set([
    'balance-analyst', 'qa-engineer', 'test-writer', 'engine-dev', 'ui-dev', 'css-artist'
  ]);
  const COORD_AGENT_ROLES = new Set(['producer', 'tech-lead', 'game-designer']);

  // Round-level tracking for the overnight report
  const roundLog = []; // { round, agents: [{id, status, elapsed}], testsPassed, testCount, failCount }

  // v5F: Round-level decision log — tracks WHY each agent was included/skipped/blocked each round
  const roundDecisions = [];

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
    generateTaskBoard(round, lastTestStatus, consecutiveTestFailures);

    // --- Determine which agents run this round (v5: work-gated + min frequency) ---
    // v5F: Track per-agent decisions this round
    const thisRoundDecisions = []; // populated during selection, updated after execution

    const activeAgents = AGENTS.filter(agent => {
      const meta = parseHandoffMeta(agent.id);

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
        const hasBacklogTask = loadBacklog().some(t =>
          t.status === 'pending' && t.role === agent.role
        );
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

      // Check dependencies — "complete" and "all-done" both satisfy
      const depsMet = agent.dependsOn.every(depId => {
        const depMeta = parseHandoffMeta(depId);
        return isDepSatisfied(depMeta.status);
      });
      if (!depsMet) {
        const blockingDeps = agent.dependsOn.filter(depId => {
          const depMeta = parseHandoffMeta(depId);
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
      const allRetired = AGENTS.every(a => parseHandoffMeta(a.id).status === 'all-done');
      if (allRetired) {
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

    // Phase A: Code agents
    if (codeAgents.length) {
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
        const warnings = validateAgentOutput(r.agentId, round);
        for (const w of warnings) log(`  ⚠ ${w}`);
      }
      validateFileOwnership(codeResults, AGENTS);

      // v6: Model escalation check
      handleModelEscalation(codeResults);

      // Run tests after code agents
      testResult = await runTests();

      // v7: Auto-revert on test regression
      if (!testResult.passed && lastTestStatus?.includes('PASSING')) {
        log(`  ⚠ Tests regressed this round! Reverting to round-${round}-start...`);
        await gitRevertToTag(round);
        log(`  Reverted src/ to pre-round state. Agents that caused regression will retry.`);
        // Re-run tests to confirm revert worked
        testResult = await runTests();
      }

      // Refresh task-board so Phase B agents see updated state
      generateTaskBoard(round, testResult.passed ? `PASSING (${testResult.count} tests)` : lastTestStatus, consecutiveTestFailures);
    }

    // Phase B: Coordination agents (see fresh handoffs from Phase A)
    if (coordAgents.length) {
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
      }
      handleModelEscalation(coordResults);
    }

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

    roundLog.push({
      round,
      agents: roundAgents,
      testsPassed: testResult?.passed ?? null,
      testCount: testResult?.count ?? '-',
      failCount: testResult?.failCount || '0',
    });

    // --- Circuit breaker ---
    if (consecutiveTestFailures >= CONFIG.circuitBreakerThreshold) {
      stopReason = `circuit breaker (${consecutiveTestFailures} consecutive test failures)`;
      log(`\n🛑 CIRCUIT BREAKER: Tests failed ${consecutiveTestFailures} rounds in a row. STOPPING.`);
      log(`Check logs at: ${LOG_DIR}`);
      log(`Last test output saved in test-results.log`);
      break;
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

    // --- Check if all agents are retired ---
    const allRetired = AGENTS.every(a => parseHandoffMeta(a.id).status === 'all-done');
    if (allRetired) {
      stopReason = 'all agents exhausted their task lists';
      log('\nAll agents have exhausted their task lists. Orchestration finished.');
      break;
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
  function handleModelEscalation(results) {
    for (const result of results) {
      const meta = parseHandoffMeta(result.agentId);
      const agent = AGENTS.find(a => a.id === result.agentId);
      if (!agent) continue;

      const failed = result.timedOut || result.code !== 0 || meta.status === 'not-started';

      if (failed) {
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
          escalationCounts[result.agentId] = (escalationCounts[result.agentId] || 0) + 1;
          // Track escalations in costLog for reporting
          ensureCostLogEntry(costLog, result.agentId).escalations++;
        }
      } else {
        // Success — de-escalate if agent was previously escalated
        if (agent._originalModel && agent.model !== agent._originalModel) {
          log(`  ${result.agentId}: De-escalating ${agent.model}->${agent._originalModel} (success after escalation)`);
          agent.model = agent._originalModel;
          delete agent._originalModel;
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

  // v6E: Agent efficiency metrics
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
    return { id: a.id, model: a.model || 'default', avgTime, successRate, filesPerRound, roundsActive: a.roundsActive, totalRounds };
  });

  // Build report
  let report = `# Overnight Orchestrator Report
> Generated: ${endTime}
> Orchestrator: v5

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

| Round | Agents | Test Result | Notes |
|-------|--------|-------------|-------|
${roundLog.map(r => {
  if (r.note) return `| ${r.round} | — | — | ${r.note} |`;
  const agents = r.agents.map(a => `${a.id}(${a.status}, ${(a.elapsed/60).toFixed(0)}m)`).join(', ');
  const tests = r.testsPassed ? `PASS (${r.testCount})` : `FAIL (${r.testCount}p, ${r.failCount}f)`;
  return `| ${r.round} | ${agents} | ${tests} | |`;
}).join('\n')}

## All Files Modified
${allFiles.length ? allFiles.map(f => `- ${f}`).join('\n') : '(none)'}

## Test Trajectory
${testTrajectory.length ? testTrajectory.map(t => `- ${t}`).join('\n') : '(no test data)'}

## Agent Efficiency (v5 Metrics)

| Agent | Model | Avg Time (min) | Success Rate | Files/Round | Utilization |
|-------|-------|----------------|-------------|-------------|-------------|
${efficiencyMetrics.map(m =>
  `| ${m.id} | ${m.model} | ${m.avgTime} | ${m.successRate}% | ${m.filesPerRound} | ${m.roundsActive}/${m.totalRounds} rounds |`
).join('\n')}

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
