// ============================================================
// Worktree Manager — Per-Worker Git Worktree Isolation
// ============================================================
// Manages git worktrees for each worker process, providing
// branch isolation so concurrent orchestrators don't conflict.
//
// Each worker gets its own worktree at:
//   {projectDir}/.worktrees/{workerId}/
//
// with a dedicated branch:
//   worker-{workerId}
//
// Provides conflict detection via dry-run merges and a merge
// queue for validated changes.
//
// Factory: createWorktreeManager(ctx) returns manager methods.
// ============================================================

import { execFile } from 'child_process';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';

// ── Constants ───────────────────────────────────────────────

const WORKTREE_DIR_NAME = '.worktrees';
const BRANCH_PREFIX = 'worker-';
const MERGE_DRY_RUN_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 30_000;

// ── Git Helpers ─────────────────────────────────────────────

/**
 * Execute a git command in the specified directory.
 * @param {string[]} args - Git command arguments
 * @param {string} cwd - Working directory
 * @param {number} [timeout] - Command timeout in ms
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, code: number}>}
 */
function gitExec(args, cwd, timeout = GIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        code: error?.code ?? 0,
      });
    });
  });
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a worktree manager for per-worker git isolation.
 * @param {object} ctx
 * @param {string} ctx.projectDir - Project root directory (must be a git repo)
 * @param {object} [ctx.events] - EventBus for worktree events
 * @param {Function} [ctx.log] - Logger function
 * @param {Function} [ctx._gitExec] - Injectable git executor (for testing)
 * @returns {object} Worktree manager methods
 */
export function createWorktreeManager(ctx) {
  if (!ctx || !ctx.projectDir) {
    throw new Error('WorktreeManager requires a projectDir');
  }

  const projectDir = resolve(ctx.projectDir);
  const events = ctx.events || null;
  const log = ctx.log || (() => {});
  const git = ctx._gitExec || gitExec;

  const worktreeDir = join(projectDir, WORKTREE_DIR_NAME);

  /** @type {Map<string, {path: string, branch: string, createdAt: string}>} */
  const worktrees = new Map();

  // ── Worktree Lifecycle ──────────────────────────────────

  /**
   * Create a worktree for a worker.
   * @param {string} workerId
   * @returns {Promise<{ok: boolean, path: string, branch: string, error?: string}>}
   */
  async function create(workerId) {
    if (!workerId) {
      return { ok: false, path: '', branch: '', error: 'workerId is required' };
    }

    const branch = `${BRANCH_PREFIX}${workerId}`;
    const wtPath = join(worktreeDir, workerId);

    // Clean up any stale worktree first
    if (worktrees.has(workerId)) {
      await remove(workerId);
    }

    // Ensure worktree parent directory exists
    if (!existsSync(worktreeDir)) {
      mkdirSync(worktreeDir, { recursive: true });
    }

    // Remove stale directory if it exists (crash recovery)
    if (existsSync(wtPath)) {
      try {
        rmSync(wtPath, { recursive: true, force: true });
      } catch {
        return { ok: false, path: wtPath, branch, error: 'Failed to remove stale worktree directory' };
      }
    }

    // Delete any leftover branch with the same name
    await git(['branch', '-D', branch], projectDir);

    // Create the worktree with a new branch from HEAD
    const result = await git(['worktree', 'add', wtPath, '-b', branch], projectDir);

    if (!result.ok) {
      return { ok: false, path: wtPath, branch, error: result.stderr || 'git worktree add failed' };
    }

    const entry = { path: wtPath, branch, createdAt: new Date().toISOString() };
    worktrees.set(workerId, entry);

    log(`[worktree] Created worktree for ${workerId}: ${wtPath} (branch: ${branch})`);
    if (events) {
      events.emit('coord:worktree-created', { workerId, path: wtPath, branch });
    }

    return { ok: true, path: wtPath, branch };
  }

  /**
   * Remove a worker's worktree.
   * @param {string} workerId
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async function remove(workerId) {
    const entry = worktrees.get(workerId);
    if (!entry) {
      return { ok: false, error: `No worktree for worker ${workerId}` };
    }

    // Remove the worktree
    const removeResult = await git(['worktree', 'remove', entry.path, '--force'], projectDir);

    // Fallback: manual rm if git worktree remove fails
    if (!removeResult.ok && existsSync(entry.path)) {
      try {
        rmSync(entry.path, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }

    // Delete the branch
    await git(['branch', '-D', entry.branch], projectDir);

    worktrees.delete(workerId);

    log(`[worktree] Removed worktree for ${workerId}`);
    if (events) {
      events.emit('coord:worktree-removed', { workerId });
    }

    return { ok: true };
  }

  // ── Merge Operations ──────────────────────────────────────

  /**
   * Dry-run merge to detect conflicts without actually merging.
   * Uses git merge --no-commit --no-ff then git merge --abort.
   * @param {string} workerId
   * @returns {Promise<{ok: boolean, conflicted: boolean, files?: string[], error?: string}>}
   */
  async function dryRunMerge(workerId) {
    const entry = worktrees.get(workerId);
    if (!entry) {
      return { ok: false, conflicted: false, error: `No worktree for worker ${workerId}` };
    }

    // Check if branch has any changes compared to main
    const diffResult = await git(
      ['diff', '--name-only', `HEAD...${entry.branch}`],
      projectDir,
      MERGE_DRY_RUN_TIMEOUT_MS
    );

    if (diffResult.ok && !diffResult.stdout) {
      // No changes to merge
      return { ok: true, conflicted: false, files: [] };
    }

    // Attempt a dry-run merge
    const mergeResult = await git(
      ['merge', '--no-commit', '--no-ff', entry.branch],
      projectDir,
      MERGE_DRY_RUN_TIMEOUT_MS
    );

    // Always abort the merge (whether it conflicted or not)
    await git(['merge', '--abort'], projectDir);

    const conflicted = !mergeResult.ok && (
      mergeResult.stderr.includes('CONFLICT') ||
      mergeResult.stderr.includes('Merge conflict') ||
      mergeResult.stdout.includes('CONFLICT')
    );

    // Extract conflicted file names
    const conflictFiles = [];
    if (conflicted) {
      const lines = (mergeResult.stdout + '\n' + mergeResult.stderr).split('\n');
      for (const line of lines) {
        const match = line.match(/CONFLICT \([^)]+\): Merge conflict in (.+)/);
        if (match) conflictFiles.push(match[1].trim());
      }
    }

    return {
      ok: true,
      conflicted,
      files: conflictFiles,
    };
  }

  /**
   * Merge a worker's branch into the main branch.
   * @param {string} workerId
   * @param {object} [opts]
   * @param {string} [opts.message] - Custom merge commit message
   * @returns {Promise<{ok: boolean, conflicted: boolean, mergeCommit?: string, error?: string}>}
   */
  async function merge(workerId, opts = {}) {
    const entry = worktrees.get(workerId);
    if (!entry) {
      return { ok: false, conflicted: false, error: `No worktree for worker ${workerId}` };
    }

    const message = opts.message || `merge: worker ${workerId} (branch ${entry.branch})`;

    const mergeResult = await git(
      ['merge', entry.branch, '--no-edit', '-m', message],
      projectDir
    );

    if (!mergeResult.ok) {
      const conflicted = mergeResult.stderr.includes('CONFLICT') ||
        mergeResult.stderr.includes('Merge conflict') ||
        mergeResult.stdout.includes('CONFLICT');

      if (conflicted) {
        // Abort the failed merge
        await git(['merge', '--abort'], projectDir);
        return { ok: false, conflicted: true, error: 'Merge conflict detected' };
      }

      return { ok: false, conflicted: false, error: mergeResult.stderr || 'Merge failed' };
    }

    // Extract merge commit SHA
    const headResult = await git(['rev-parse', 'HEAD'], projectDir);
    const mergeCommit = headResult.ok ? headResult.stdout : undefined;

    log(`[worktree] Merged ${workerId} branch ${entry.branch}: ${mergeCommit}`);
    if (events) {
      events.emit('coord:worktree-merged', { workerId, branch: entry.branch, mergeCommit });
    }

    return { ok: true, conflicted: false, mergeCommit };
  }

  // ── Conflict Detection ──────────────────────────────────────

  /**
   * Check all active worktrees for potential conflicts with main.
   * @returns {Promise<{results: Array<{workerId: string, conflicted: boolean, files: string[]}>}>}
   */
  async function detectConflicts() {
    const results = [];

    for (const [workerId] of worktrees) {
      const result = await dryRunMerge(workerId);
      results.push({
        workerId,
        conflicted: result.conflicted,
        files: result.files || [],
      });
    }

    const conflictedWorkers = results.filter(r => r.conflicted);
    if (conflictedWorkers.length > 0 && events) {
      events.emit('coord:conflicts-detected', {
        conflicted: conflictedWorkers.map(w => w.workerId),
        details: conflictedWorkers,
      });
    }

    return { results };
  }

  // ── Cleanup ─────────────────────────────────────────────────

  /**
   * Remove all active worktrees.
   * @returns {Promise<{removed: string[], errors: string[]}>}
   */
  async function cleanupAll() {
    const removed = [];
    const errors = [];

    for (const [workerId] of worktrees) {
      const result = await remove(workerId);
      if (result.ok) {
        removed.push(workerId);
      } else {
        errors.push(`${workerId}: ${result.error}`);
      }
    }

    // Prune orphaned worktrees
    await git(['worktree', 'prune'], projectDir);

    log(`[worktree] Cleanup complete: ${removed.length} removed, ${errors.length} errors`);
    return { removed, errors };
  }

  // ── Status ────────────────────────────────────────────────

  /**
   * Get current worktree status.
   * @returns {object}
   */
  function getStatus() {
    const entries = [];
    for (const [workerId, entry] of worktrees) {
      entries.push({
        workerId,
        path: entry.path,
        branch: entry.branch,
        createdAt: entry.createdAt,
        exists: existsSync(entry.path),
      });
    }

    return {
      worktreeDir,
      active: worktrees.size,
      worktrees: entries,
    };
  }

  /**
   * Get a specific worker's worktree info.
   * @param {string} workerId
   * @returns {object|null}
   */
  function get(workerId) {
    const entry = worktrees.get(workerId);
    if (!entry) return null;
    return { ...entry, workerId, exists: existsSync(entry.path) };
  }

  /**
   * Check if a worker has an active worktree.
   * @param {string} workerId
   * @returns {boolean}
   */
  function has(workerId) {
    return worktrees.has(workerId);
  }

  return {
    create,
    remove,
    merge,
    dryRunMerge,
    detectConflicts,
    cleanupAll,
    getStatus,
    get,
    has,
  };
}

export { WORKTREE_DIR_NAME, BRANCH_PREFIX, GIT_TIMEOUT_MS, MERGE_DRY_RUN_TIMEOUT_MS };
