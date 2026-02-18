// ============================================================
// File System Scanning API (P9)
// ============================================================
// Provides directory listing for project file explorers.
// Path-traversal protection ensures reads stay within root.
// ============================================================

import { Router } from 'express';
import { readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

// ── Ignore List ─────────────────────────────────────────────

const IGNORED = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.cache', '.vscode', '.idea', 'coverage', '.nyc_output',
  '.DS_Store', 'Thumbs.db', '.turbo', '.parcel-cache',
]);

const MAX_ENTRIES = 500;

// ── Directory Scanner ───────────────────────────────────────

/**
 * Scan a directory and return sorted entries.
 * Directories first, then files, alphabetical within each group.
 *
 * @param {string} root     Absolute path to project root
 * @param {string} subPath  Relative path within root ('' for root)
 * @returns {Array<{name:string, type:'dir'|'file', path:string, children?:number, size?:number}>}
 */
export function scanDirectory(root, subPath = '') {
  const fullPath = subPath ? join(root, subPath) : root;

  let dirents;
  try {
    dirents = readdirSync(fullPath, { withFileTypes: true });
  } catch {
    return [];
  }

  // Sort: dirs first, then files, alphabetical
  dirents.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });

  const result = [];
  for (const entry of dirents) {
    if (IGNORED.has(entry.name)) continue;
    if (result.length >= MAX_ENTRIES) break;

    const entryPath = subPath ? `${subPath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      let childCount = 0;
      try {
        childCount = readdirSync(join(root, entryPath))
          .filter(c => !IGNORED.has(c)).length;
      } catch { /* unreadable */ }

      result.push({
        name: entry.name,
        type: 'dir',
        path: entryPath.replace(/\\/g, '/'),
        children: childCount,
      });
    } else if (entry.isFile()) {
      let size = 0;
      try {
        size = statSync(join(root, entryPath)).size;
      } catch { /* unreadable */ }

      result.push({
        name: entry.name,
        type: 'file',
        path: entryPath.replace(/\\/g, '/'),
        size,
      });
    }
  }

  return result;
}

// ── Route Factory ───────────────────────────────────────────

/**
 * Create file system routes.
 * @returns {Router}
 */
export function createFileRoutes() {
  const router = Router();

  // GET /api/files?root=<abs-path>&path=<sub-path>
  router.get('/files', (req, res) => {
    const root = req.query.root;
    const subPath = req.query.path || '';

    if (!root) {
      return res.status(400).json({ error: 'root parameter is required' });
    }

    const resolvedRoot = resolve(root);
    const resolvedFull = resolve(resolvedRoot, subPath);

    // Path-traversal guard
    if (!resolvedFull.replace(/\\/g, '/').startsWith(resolvedRoot.replace(/\\/g, '/'))) {
      return res.status(403).json({ error: 'Path traversal denied' });
    }

    const entries = scanDirectory(resolvedRoot, subPath);
    res.json({
      root: resolvedRoot.replace(/\\/g, '/'),
      path: (subPath || '').replace(/\\/g, '/'),
      entries,
    });
  });

  return router;
}
