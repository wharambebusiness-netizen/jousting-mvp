// ============================================================
// Git Routes (M6d)
// ============================================================
// Git integration endpoints for the operator dashboard.
// Provides status, push, and PR creation via CLI commands.
// ============================================================

import { Router } from 'express';
import { execFile } from 'child_process';
import { resolve } from 'path';

/**
 * Run a command and return { stdout, stderr, code }.
 */
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 30000 }, (err, stdout, stderr) => {
      resolve({
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim(),
        code: err ? err.code || 1 : 0,
      });
    });
  });
}

/**
 * Create git integration routes.
 * @param {object} ctx
 * @param {string} ctx.projectDir - Project root directory
 */
/**
 * Run git status --porcelain on an arbitrary directory.
 * Returns a Map of relative path → status code (M, A, ?, D, etc.)
 */
async function getGitFileStatus(dir) {
  const result = await run('git', ['status', '--porcelain', '-uall'], dir);
  const statusMap = {};
  if (result.code !== 0 || !result.stdout) return statusMap;

  for (const line of result.stdout.split('\n')) {
    if (!line || line.length < 4) continue;
    // Porcelain format: XY <path> or XY <path> -> <renamed>
    const xy = line.slice(0, 2);
    let filePath = line.slice(3);
    // Handle renames: "R  old -> new"
    const arrowIdx = filePath.indexOf(' -> ');
    if (arrowIdx >= 0) filePath = filePath.slice(arrowIdx + 4);
    filePath = filePath.replace(/\\/g, '/');
    // Pick the most meaningful status char (index then working tree)
    const code = xy[0] !== ' ' && xy[0] !== '?' ? xy[0] : xy[1];
    statusMap[filePath] = code;
  }
  return statusMap;
}

export { getGitFileStatus };

export function createGitRoutes(ctx) {
  const router = Router();
  const projectDir = ctx.projectDir || process.cwd();

  // ── GET /api/git/file-status ────────────────────────────
  // Returns per-file git status for a project directory (used by file tree)
  router.get('/git/file-status', async (req, res) => {
    const root = req.query.root;
    if (!root) {
      return res.status(400).json({ error: 'root parameter is required' });
    }
    try {
      const resolvedRoot = resolve(root);
      const statusMap = await getGitFileStatus(resolvedRoot);
      res.json({ root: resolvedRoot.replace(/\\/g, '/'), files: statusMap });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/git/status ─────────────────────────────────
  // Returns git status + recent log
  router.get('/git/status', async (_req, res) => {
    try {
      const [statusResult, logResult, branchResult] = await Promise.all([
        run('git', ['status', '--porcelain'], projectDir),
        run('git', ['log', '--oneline', '-10'], projectDir),
        run('git', ['branch', '--show-current'], projectDir),
      ]);

      const files = statusResult.stdout
        ? statusResult.stdout.split('\n').map(line => ({
            status: line.slice(0, 2).trim(),
            file: line.slice(3),
          }))
        : [];

      const commits = logResult.stdout
        ? logResult.stdout.split('\n').map(line => {
            const spaceIdx = line.indexOf(' ');
            return {
              hash: line.slice(0, spaceIdx),
              message: line.slice(spaceIdx + 1),
            };
          })
        : [];

      res.json({
        branch: branchResult.stdout || 'unknown',
        clean: files.length === 0,
        files,
        commits,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/git/push ──────────────────────────────────
  // Push current branch to origin
  router.post('/git/push', async (_req, res) => {
    try {
      const result = await run('git', ['push', 'origin', 'HEAD'], projectDir);

      if (result.code !== 0) {
        return res.status(500).json({
          error: 'Push failed',
          stderr: result.stderr,
        });
      }

      res.json({
        message: 'Push successful',
        output: result.stdout || result.stderr,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/git/commit ────────────────────────────────
  // Stage all and commit with provided message
  // Body: { message: string }
  router.post('/git/commit', async (_req, res) => {
    const { message } = _req.body || {};
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Commit message is required' });
    }

    try {
      // Stage all changes
      const addResult = await run('git', ['add', '-A'], projectDir);
      if (addResult.code !== 0) {
        return res.status(500).json({ error: 'git add failed', stderr: addResult.stderr });
      }

      // Check if there are staged changes
      const diffResult = await run('git', ['diff', '--cached', '--quiet'], projectDir);
      if (diffResult.code === 0) {
        return res.json({ message: 'Nothing to commit', committed: false });
      }

      // Commit
      const commitResult = await run('git', ['commit', '-m', message.trim()], projectDir);
      if (commitResult.code !== 0) {
        return res.status(500).json({ error: 'Commit failed', stderr: commitResult.stderr });
      }

      res.json({
        message: 'Committed successfully',
        committed: true,
        output: commitResult.stdout,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/git/pr ────────────────────────────────────
  // Create a GitHub PR using gh CLI
  // Body: { title?: string, body?: string }
  router.post('/git/pr', async (req, res) => {
    const { title, body: prBody } = req.body || {};

    const args = ['pr', 'create', '--fill'];
    if (title) {
      args.length = 2; // reset to just ['pr', 'create']
      args.push('--title', title);
      if (prBody) args.push('--body', prBody);
    }

    try {
      const result = await run('gh', args, projectDir);

      if (result.code !== 0) {
        return res.status(500).json({
          error: 'PR creation failed',
          stderr: result.stderr,
        });
      }

      // gh pr create outputs the PR URL
      const prUrl = result.stdout.split('\n').pop();
      res.json({
        message: 'PR created',
        url: prUrl,
        output: result.stdout,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
