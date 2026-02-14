// Agent Runner Module (extracted from orchestrator.mjs in S67)
// Core agent spawner: prompt building, CLI args, process spawn, result collection
// Also includes processAgentResult for status logging and cost/effectiveness tracking

import { spawn } from 'child_process';
import { readFileSync, existsSync, appendFileSync, mkdtempSync, rmSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// Module-level dependencies (set via init)
let logFn = () => {};
let LOG_DIR = '';
let MVP_DIR = '';
let ROLES_DIR = '';
let CONFIG = null;
let getAgents = () => [];
let activeProcs = null;
let agentWorktrees = {};
let agentSessions = {};
let agentRuntimeHistory = {};
let lastFailureDetails = {};
let consecutiveEmptyRounds = {};
let getObs = () => null;
let getMissionDesignDoc = () => null;
let killProcessTreeFn = () => {};
// From agent-tracking
let getChangelogSinceRoundFn = () => null;
let readHandoffContentFn = () => null;
let getAdaptiveTimeoutFn = () => 0;
let invalidateAgentSessionFn = () => {};
let recordAgentRuntimeFn = () => {};
let recordAgentEffectivenessFn = () => {};
// From backlog-system
let getNextTasksFn = () => [];
let getNextSubtaskFn = () => null;
let loadBacklogFn = () => [];
// From balance-analyzer
let buildBalanceContextFn = () => null;
let getParamSearchResultsFn = () => null;
let buildParamSearchContextFn = () => null;
let buildExperimentContextFn = () => null;
// From spawn-system
let getSpawnNotificationsFn = () => null;
// From cost-tracker
let accumulateAgentCostFn = () => {};
// From handoff-parser
let validateAgentOutputFn = () => ({});
let parseHandoffMetaFn = () => ({});
// From lessons
let queryLessonsFn = () => [];
let formatLessonsForPromptFn = () => null;

// v26/M1: Strip ANSI escape codes for clean failure context injection
function stripAnsiCodes(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Role template loading (only used by runAgent — moved from orchestrator)
let commonRulesContent = '';
const roleTemplateCache = {};

/**
 * Initialize agent runner with orchestrator context.
 * @param {object} ctx
 */
export function initAgentRunner(ctx) {
  logFn = ctx.log;
  LOG_DIR = ctx.logDir;
  MVP_DIR = ctx.mvpDir;
  ROLES_DIR = ctx.rolesDir;
  CONFIG = ctx.config;
  getAgents = ctx.getAgents;
  activeProcs = ctx.activeProcs;
  agentWorktrees = ctx.agentWorktrees;
  agentSessions = ctx.agentSessions;
  agentRuntimeHistory = ctx.agentRuntimeHistory;
  lastFailureDetails = ctx.lastFailureDetails || {};
  consecutiveEmptyRounds = ctx.consecutiveEmptyRounds || {};
  getObs = ctx.getObs;
  getMissionDesignDoc = ctx.getMissionDesignDoc;
  killProcessTreeFn = ctx.killProcessTree;
  // From agent-tracking
  getChangelogSinceRoundFn = ctx.getChangelogSinceRound;
  readHandoffContentFn = ctx.readHandoffContent;
  getAdaptiveTimeoutFn = ctx.getAdaptiveTimeout;
  invalidateAgentSessionFn = ctx.invalidateAgentSession;
  recordAgentRuntimeFn = ctx.recordAgentRuntime;
  recordAgentEffectivenessFn = ctx.recordAgentEffectiveness;
  // From backlog-system
  getNextTasksFn = ctx.getNextTasks;
  getNextSubtaskFn = ctx.getNextSubtask;
  loadBacklogFn = ctx.loadBacklog;
  // From balance-analyzer
  buildBalanceContextFn = ctx.buildBalanceContext;
  getParamSearchResultsFn = ctx.getParamSearchResults;
  buildParamSearchContextFn = ctx.buildParamSearchContext;
  buildExperimentContextFn = ctx.buildExperimentContext;
  // From spawn-system
  getSpawnNotificationsFn = ctx.getSpawnNotifications;
  // From cost-tracker
  accumulateAgentCostFn = ctx.accumulateAgentCost;
  // From handoff-parser
  validateAgentOutputFn = ctx.validateAgentOutput;
  parseHandoffMetaFn = ctx.parseHandoffMeta;
  // From lessons
  queryLessonsFn = ctx.queryLessons || (() => []);
  formatLessonsForPromptFn = ctx.formatLessonsForPrompt || (() => null);
}

/**
 * Load shared rules file (called once at startup).
 */
export function loadCommonRules() {
  const rulesPath = join(ROLES_DIR, '_common-rules.md');
  if (existsSync(rulesPath)) {
    commonRulesContent = readFileSync(rulesPath, 'utf-8');
    logFn(`Loaded shared rules: ${commonRulesContent.split('\n').length} lines`);
  }
}

// v11: Role template cache — avoids re-reading the same template from disk every agent spawn
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
// Run a Single Agent
// ============================================================
export function runAgent(agent, round) {
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
    const missionDesignDoc = getMissionDesignDoc();

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
      const changesSince = getChangelogSinceRoundFn(existingSession.lastRound);
      if (changesSince) {
        promptParts.push(`--- CHANGES SINCE ROUND ${existingSession.lastRound} ---`, changesSince, ``);
      } else {
        promptParts.push(`No other agents made changes since your last round.`, ``);
      }

      // Inline current handoff (may have been updated by orchestrator since agent's last write)
      const handoffContent = readHandoffContentFn(agent.id);
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
      const handoffContent = readHandoffContentFn(agent.id);
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

    // v26/M1: Inject failure context from previous run (both fresh and resume paths)
    const failDetail = lastFailureDetails[agent.id];
    if (failDetail) {
      promptParts.push(``, `--- PREVIOUS RUN FAILURE (round ${failDetail.round}) ---`);
      if (failDetail.timedOut) {
        promptParts.push(`Your previous run TIMED OUT. You must work faster and more focused this round.`);
      } else if (failDetail.isEmptyWork) {
        promptParts.push(`Your previous run produced EMPTY WORK — you exited OK but modified zero files and didn't update your handoff. You must make meaningful progress this round.`);
      } else {
        promptParts.push(`Your previous run CRASHED with exit code ${failDetail.code}. Avoid repeating the same approach that caused this failure.`);
      }
      if (failDetail.stderrSummary) {
        promptParts.push(`Stderr (last 500 chars): ${failDetail.stderrSummary}`);
      }
      promptParts.push(`Consecutive failures: ${(consecutiveEmptyRounds[agent.id] || 0) + 1}. Adapt your approach.`);
    }

    // v26/M4: Inject cross-session lessons (max 3, matched by role + files-in-common)
    if (!isResuming) {
      const lessons = queryLessonsFn(agent.role, agent.fileOwnership || []);
      const lessonsText = formatLessonsForPromptFn(lessons);
      if (lessonsText) {
        promptParts.push(``, lessonsText);
      }
    }

    // v12: Inject runtime stats for continuous agents (helps agents self-regulate pacing)
    if (agent.type === 'continuous') {
      const history = agentRuntimeHistory[agent.id];
      if (history?.length) {
        const avgSec = history.reduce((a, b) => a + b, 0) / history.length;
        const timeoutMs = getAdaptiveTimeoutFn(agent);
        promptParts.push(
          `Your recent performance: avg ${(avgSec / 60).toFixed(1)}min over ${history.length} run(s), timeout ${(timeoutMs / 60000).toFixed(1)}min. Stay focused to finish within budget.`,
        );
      }
    }

    // v5/v6: Inject batch backlog tasks if available
    // v12: Truncate descriptions to first sentence to reduce prompt bloat
    // v15: Subtask support — when a task has subtasks, assign only the next incomplete one
    const backlogTasks = getNextTasksFn(agent.role, agent.maxTasksPerRound || 1, agent.id);
    if (backlogTasks.length) {
      promptParts.push(``, `--- BACKLOG TASKS (from producer) ---`);
      for (let i = 0; i < backlogTasks.length; i++) {
        const bt = backlogTasks[i];
        // v15: Check for subtasks — assign only the next incomplete subtask
        const nextSub = getNextSubtaskFn(bt.id);
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
      const balanceCtx = buildBalanceContextFn();
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
    if (getParamSearchResultsFn() && agent.role === 'balance-analyst') {
      const searchCtx = buildParamSearchContextFn();
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
      const experimentCtx = buildExperimentContextFn();
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
      const spawnNotif = getSpawnNotificationsFn(agent.id, round - 1);
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
    logFn(`  Starting ${agent.id}... (~${estimatedTokens} prompt tokens, model=${agent.model || 'default'}, session=${sessionMode})`);
    // v22: Emit agent start event
    const obs = getObs();
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
        logFn(`    using ${agent.claudeMdPath} (temp dir: ${tempDir})`);
      }
    }

    if (worktree) {
      logFn(`    worktree: ${worktree.branch} → ${worktree.path}`);
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
    const timeout = getAdaptiveTimeoutFn(agent);
    const configTimeout = agent.timeoutMs || CONFIG.agentTimeoutMs;
    const isAdapted = timeout < configTimeout;
    if (isAdapted) {
      const history = agentRuntimeHistory[agent.id] || [];
      const avgMin = history.length ? ((history.reduce((a, b) => a + b, 0) / history.length) / 60).toFixed(1) : '?';
      logFn(`    adaptive timeout: ${(timeout / 60000).toFixed(1)}min (avg ${avgMin}min, max ${(configTimeout / 60000).toFixed(0)}min)`);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      logFn(`  ${agent.id} TIMED OUT after ${(timeout / 60000).toFixed(1)} minutes — killing process tree (PID ${proc.pid})`);
      killProcessTreeFn(proc.pid);
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
      logFn(`  ${agent.id} finished: ${status} (${elapsedMin} min, session=${sessionMode})`);
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
        invalidateAgentSessionFn(agent.id, `resume failure (${elapsed}s, code=${code})`);
      }

      resolvePromise({ agentId: agent.id, code, timedOut, elapsed, stdout, stderr, wasResumed: isResuming });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      activeProcs.delete(proc.pid);
      cleanupTempDir();
      logFn(`  ${agent.id} SPAWN ERROR: ${err.message}`);
      resolvePromise({ agentId: agent.id, code: -1, timedOut: false, elapsed: 0, stdout: '', stderr: err.message });
    });

    // Pipe prompt via stdin (bypasses Windows command line length limit)
    proc.stdin.write(prompt, 'utf-8');
    proc.stdin.end();
  });
}

// ============================================================
// Process Agent Result (v9 — extracted from Phase A/B duplicated blocks)
// ============================================================
// ctx = { lastRunRound, consecutiveEmptyRounds, consecutiveAgentFailures, lastFailureDetails }
// These are main()-scoped tracking objects passed by reference.
export function processAgentResult(result, round, roundAgents, costLog, ctx) {
  const AGENTS = getAgents();
  const status = result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'OK' : `ERROR(${result.code})`;
  logFn(`  ${result.agentId}: ${status} in ${(result.elapsed / 60).toFixed(1)}min`);
  roundAgents.push({ id: result.agentId, status, elapsed: result.elapsed });
  ctx.lastRunRound[result.agentId] = round;
  accumulateAgentCostFn(costLog, result, AGENTS);

  // v10: Record runtime for adaptive timeout (only successful non-timeout runs)
  if (!result.timedOut && result.elapsed > 0) {
    recordAgentRuntimeFn(result.agentId, result.elapsed);
  }

  const { warnings, isEmptyWork } = validateAgentOutputFn(result.agentId, round, result);
  for (const w of warnings) logFn(`  ⚠ ${w}`);

  if (isEmptyWork) {
    ctx.consecutiveEmptyRounds[result.agentId] = (ctx.consecutiveEmptyRounds[result.agentId] || 0) + 1;
    if (ctx.consecutiveEmptyRounds[result.agentId] >= 3) {
      // v11: Smarter escalation guard — don't escalate if agent has no backlog tasks.
      // Empty work from "nothing to do" shouldn't burn cost on a bigger model.
      const agent = AGENTS.find(a => a.id === result.agentId);
      const backlog = loadBacklogFn();
      const hasBacklogTask = agent && backlog.some(t => t.status === 'pending' && t.role === agent.role);
      if (!hasBacklogTask) {
        logFn(`  ${result.agentId}: ${ctx.consecutiveEmptyRounds[result.agentId]} consecutive empty rounds but no pending tasks — skipping escalation`);
      } else {
        logFn(`  ⚠ ${result.agentId}: ${ctx.consecutiveEmptyRounds[result.agentId]} consecutive empty rounds — auto-escalating model`);
        if (agent) ctx.consecutiveAgentFailures[result.agentId] = 2;
      }
    }
  } else if (result.code === 0 && !result.timedOut) {
    ctx.consecutiveEmptyRounds[result.agentId] = 0;
  }

  // v26/M1: Record failure details for context injection into next run's prompt
  if (ctx.lastFailureDetails) {
    const failed = result.timedOut || result.code !== 0;
    if (failed || isEmptyWork) {
      const rawStderr = (result.stderr || '').slice(-500);
      ctx.lastFailureDetails[result.agentId] = {
        code: result.code,
        timedOut: result.timedOut,
        stderrSummary: stripAnsiCodes(rawStderr),
        round,
        isEmptyWork,
      };
    } else {
      // Success — clear failure details
      delete ctx.lastFailureDetails[result.agentId];
    }
  }

  // v10: Collect modified files from handoff for incremental testing
  const meta = parseHandoffMetaFn(result.agentId);
  // v13: Flag if balance-config.ts was modified (for experiment logging)
  const filesModified = meta.filesModified || [];
  const balanceConfigChanged = filesModified.some(f =>
    f.includes('balance-config') || f.includes('archetypes')
  );

  // v14: Record agent effectiveness metrics
  const costEntry = costLog[result.agentId];
  recordAgentEffectivenessFn(result.agentId, {
    filesModified,
    costEntry,
    elapsedSeconds: result.elapsed,
    isEmptyWork,
  });

  return { status, isEmptyWork, filesModified, balanceConfigChanged };
}
