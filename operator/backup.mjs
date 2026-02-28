// ============================================================
// Backup Manager — Full State Backup/Restore (Phase 51)
// ============================================================
// Creates complete backups of all operator persistence files as
// a single JSON bundle with base64-encoded file contents. Supports
// restore with dry-run preview, atomic writes, and auto-backup to
// timestamped files.
//
// Factory: createBackupManager(ctx) returns backup API.
// ============================================================

import {
  readFileSync, writeFileSync, existsSync,
  readdirSync, statSync, renameSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

// ── Known persistence files ─────────────────────────────────

const KNOWN_FILES = [
  'registry.json',
  'settings.json',
  '.data/task-queue.json',
  '.data/shared-memory.json',
  '.data/terminal-messages.json',
  '.data/dead-letters.json',
  '.data/audit-log.jsonl',
  '.data/webhooks.json',
  '.data/preferences.json',
  '.data/notifications.json',
  '.data/terminal-sessions.json',
  '.data/terminal-templates.json',
  '.data/templates.json',
  '.data/secrets.vault',
  '.data/auth-tokens.json',
  '.data/.migration-version',
];

const SECRET_FILES = ['.data/secrets.vault', '.data/auth-tokens.json'];
const AUDIT_FILES = ['.data/audit-log.jsonl'];

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a backup manager.
 *
 * @param {object} ctx
 * @param {string} ctx.operatorDir - Base directory for operator persistence
 * @param {object} [ctx.log]       - Logger (optional, default no-op)
 * @returns {object} Backup manager API
 */
export function createBackupManager(ctx = {}) {
  const operatorDir = ctx.operatorDir;
  const log = ctx.log || { info() {}, warn() {}, error() {}, debug() {} };

  if (!operatorDir) {
    throw new Error('operatorDir is required');
  }

  /**
   * Create a backup bundle containing all known persistence files.
   * @param {object} [options]
   * @param {boolean} [options.excludeSecrets] - Omit secrets.vault and auth-tokens.json
   * @param {boolean} [options.excludeAudit]   - Omit audit-log.jsonl
   * @returns {{ version: number, createdAt: string, files: object, manifest: { fileCount: number, totalBytes: number } }}
   */
  function createBackup(options = {}) {
    const files = {};
    let totalBytes = 0;

    for (const relPath of KNOWN_FILES) {
      // Skip excluded files
      if (options.excludeSecrets && SECRET_FILES.includes(relPath)) continue;
      if (options.excludeAudit && AUDIT_FILES.includes(relPath)) continue;

      const absPath = join(operatorDir, relPath);
      if (!existsSync(absPath)) continue;

      try {
        const content = readFileSync(absPath);
        const b64 = content.toString('base64');
        files[relPath] = b64;
        totalBytes += content.length;
      } catch (err) {
        log.warn?.(`Backup: failed to read ${relPath}: ${err.message}`);
      }
    }

    const fileCount = Object.keys(files).length;

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      files,
      manifest: { fileCount, totalBytes },
    };
  }

  /**
   * Restore files from a backup bundle.
   * @param {object} bundle - Backup bundle from createBackup()
   * @param {object} [options]
   * @param {boolean} [options.dryRun] - Preview without writing
   * @returns {{ restored: string[], skipped: string[], errors: string[] }}
   */
  function restoreBackup(bundle, options = {}) {
    const restored = [];
    const skipped = [];
    const errors = [];

    // Validate bundle
    if (!bundle || typeof bundle !== 'object') {
      errors.push('Invalid bundle: not an object');
      return { restored, skipped, errors };
    }
    if (bundle.version !== 1) {
      errors.push(`Unsupported bundle version: ${bundle.version}`);
      return { restored, skipped, errors };
    }
    if (!bundle.files || typeof bundle.files !== 'object') {
      errors.push('Invalid bundle: missing files object');
      return { restored, skipped, errors };
    }

    for (const [relPath, b64Content] of Object.entries(bundle.files)) {
      // Validate path is one of the known files (security: prevent path traversal)
      if (!KNOWN_FILES.includes(relPath)) {
        skipped.push(relPath);
        continue;
      }

      if (options.dryRun) {
        restored.push(relPath);
        continue;
      }

      try {
        const absPath = join(operatorDir, relPath);
        const dir = dirname(absPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        const content = Buffer.from(b64Content, 'base64');
        const tmpPath = absPath + '.tmp';

        // Atomic write: write to .tmp, then rename
        try {
          writeFileSync(tmpPath, content);
          renameSync(tmpPath, absPath);
        } catch (_renameErr) {
          // Fallback: direct write
          writeFileSync(absPath, content);
          try { if (existsSync(tmpPath)) writeFileSync(tmpPath, ''); } catch { /* ignore */ }
        }

        restored.push(relPath);
      } catch (err) {
        errors.push(`${relPath}: ${err.message}`);
      }
    }

    log.info?.(`Restore complete: ${restored.length} restored, ${skipped.length} skipped, ${errors.length} errors`);
    return { restored, skipped, errors };
  }

  /**
   * List auto-backup files in .data/ directory.
   * @returns {Array<{ name: string, size: number, createdAt: string }>}
   */
  function listBackups() {
    const dataDir = join(operatorDir, '.data');
    if (!existsSync(dataDir)) return [];

    try {
      const files = readdirSync(dataDir);
      const backups = [];

      for (const name of files) {
        if (!name.startsWith('.backup-') || !name.endsWith('.json')) continue;
        const fullPath = join(dataDir, name);
        try {
          const stat = statSync(fullPath);
          backups.push({
            name,
            size: stat.size,
            createdAt: stat.mtime.toISOString(),
          });
        } catch { /* skip unreadable files */ }
      }

      // Sort newest first
      backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return backups;
    } catch {
      return [];
    }
  }

  /**
   * Create a timestamped auto-backup file.
   * @returns {{ path: string, size: number }}
   */
  function autoBackup() {
    const bundle = createBackup();
    const now = new Date();
    const ts = now.toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .replace(/\.\d{3}Z$/, '');
    // Format: .backup-YYYYMMDD-HHmmss.json
    const fileName = `.backup-${ts}.json`;
    const dataDir = join(operatorDir, '.data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    const filePath = join(dataDir, fileName);
    const json = JSON.stringify(bundle);
    writeFileSync(filePath, json);

    log.info?.(`Auto-backup created: ${fileName} (${json.length} bytes)`);
    return { path: filePath, size: json.length };
  }

  /**
   * Get information about a backup bundle without restoring.
   * @param {object} bundle - Backup bundle
   * @returns {{ fileCount: number, totalBytes: number, createdAt: string, files: string[] }}
   */
  function getBackupInfo(bundle) {
    if (!bundle || typeof bundle !== 'object' || bundle.version !== 1) {
      return { fileCount: 0, totalBytes: 0, createdAt: null, files: [] };
    }

    const files = bundle.files ? Object.keys(bundle.files) : [];
    const totalBytes = bundle.manifest?.totalBytes ?? 0;
    const fileCount = bundle.manifest?.fileCount ?? files.length;

    return {
      fileCount,
      totalBytes,
      createdAt: bundle.createdAt || null,
      files,
    };
  }

  // ── Public API ──────────────────────────────────────────

  return {
    createBackup,
    restoreBackup,
    listBackups,
    autoBackup,
    getBackupInfo,
  };
}
