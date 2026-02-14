// ============================================================
// Git Operations Module — extracted from orchestrator.mjs v22
// Handles: git backup, tagging, revert (smart + worktree-based),
// worktree lifecycle (create, merge, remove, cleanup).
// ============================================================

import { spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// Module-level dependencies (set via init)
let log, MVP_DIR, WORKTREE_DIR, agentWorktrees;
let parseHandoffMeta, invalidateAgentSession, runTests;

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Initialize git-ops with orchestrator context.
 * Must be called before any other function.
 */
export function initGitOps(ctx) {
  log = ctx.log;
  MVP_DIR = ctx.MVP_DIR;
  WORKTREE_DIR = ctx.WORKTREE_DIR;
  agentWorktrees = ctx.agentWorktrees;
  parseHandoffMeta = ctx.parseHandoffMeta;
  invalidateAgentSession = ctx.invalidateAgentSession;
  runTests = ctx.runTests;
}

// ============================================================
// Git Backup (orchestrator-only — agents never commit)
// ============================================================
export function gitBackup(round) {
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
export function tagRoundStart(round) {
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

export function gitRevertToTag(round) {
  return gitRevertFiles(round, ['src/']);
}

/**
 * Revert specific files to a round's start tag.
 * @param {number} round - Round number (used to find the git tag)
 * @param {string[]} files - File paths or directories to revert
 * @returns {Promise<boolean>} Whether the revert succeeded
 */
export function gitRevertFiles(round, files) {
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
export async function smartRevert(round, codeResults) {
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
export function invalidateRevertedSessions(revertedAgents) {
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
export function gitExec(cmd, cwd = MVP_DIR) {
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
export async function createWorktree(agentId, round) {
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
export async function mergeWorktreeBranch(agentId) {
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
export async function removeWorktree(agentId) {
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
export async function cleanupAllWorktrees() {
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
export async function getHeadSha() {
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
export async function smartRevertWorktrees(round, codeResults, preMergeHead, mergeResults) {
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
// v26/M2: Agent Output Cross-Verification
// ============================================================
// Compare git status --porcelain against self-reported filesModified.
// Log discrepancies as warnings — observability, not enforcement.

/**
 * Verify an agent's self-reported file modifications against actual git status.
 * Must be called while the agent's worktree is still alive.
 * @param {string} agentId
 * @param {string[]} reportedFiles — from parseHandoffMeta().filesModified
 * @param {string} worktreePath — agent's worktree directory
 * @returns {Promise<{ warnings: string[] }>}
 */
export async function verifyAgentOutput(agentId, reportedFiles, worktreePath) {
  const warnings = [];

  // Run git status --porcelain in the worktree to get actual changed files
  const result = await gitExec('git status --porcelain', worktreePath);
  if (!result.ok) {
    warnings.push(`${agentId}: cross-verify skipped — git status failed: ${result.stderr.slice(0, 100)}`);
    return { warnings };
  }

  // Parse porcelain output: each line is "XY filename" or "XY old -> new" for renames
  const actualFiles = new Set();
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    // Porcelain format: 2-char status + space + path (or path -> path for renames)
    let filePath = line.slice(3).trim();
    // Handle renames: "R  old -> new"
    const arrowIdx = filePath.indexOf(' -> ');
    if (arrowIdx !== -1) filePath = filePath.slice(arrowIdx + 4);
    // Normalize Windows backslashes
    filePath = filePath.replace(/\\/g, '/');
    // Exclude orchestrator/** paths (agents always touch handoff files)
    if (filePath.startsWith('orchestrator/')) continue;
    actualFiles.add(filePath);
  }

  // Normalize reported files for comparison
  const reportedSet = new Set(
    reportedFiles
      .map(f => f.replace(/\\/g, '/').trim())
      .filter(f => !f.startsWith('orchestrator/') && f !== '(none yet)')
  );

  // Check BOTH directions:
  // 1. Files agent changed but didn't report
  for (const actual of actualFiles) {
    if (!reportedSet.has(actual)) {
      warnings.push(`${agentId}: UNREPORTED file change: ${actual} (modified but not in files-modified)`);
    }
  }

  // 2. Files agent claimed but didn't actually change
  for (const reported of reportedSet) {
    if (!actualFiles.has(reported)) {
      warnings.push(`${agentId}: PHANTOM file claim: ${reported} (in files-modified but not actually changed)`);
    }
  }

  return { warnings };
}
