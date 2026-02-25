// ============================================================
// Data Migration Framework (Phase 30)
// ============================================================
// Versioned schema migrations for persisted JSON files in the
// operator .data/ directory. Tracks applied version in a plain
// text file (.migration-version). Supports up/down migrations.
//
// Factory: createMigrationRunner(ctx) returns migration API.
// ============================================================

import {
  readFileSync, writeFileSync, existsSync,
  mkdirSync, renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Read and parse a JSON file. Returns null if missing or corrupt.
 * @param {string} filePath
 * @returns {object|null}
 */
export function loadJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Atomic write of JSON data (write to .tmp then rename).
 * @param {string} filePath
 * @param {object} data
 */
export function saveJson(filePath, data) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmpFile = filePath + '.tmp';
  try {
    writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    renameSync(tmpFile, filePath);
  } catch {
    // Fallback: direct write
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}

// ── Built-in Migrations ─────────────────────────────────────

const migrations = [
  {
    version: 1,
    name: 'add-version-fields',
    up(dataDir) {
      const files = ['shared-memory.json', 'terminal-messages.json', 'persistent-queue.json'];
      for (const file of files) {
        const filePath = join(dataDir, file);
        const data = loadJson(filePath);
        if (data && data._schemaVersion === undefined) {
          data._schemaVersion = 1;
          saveJson(filePath, data);
        }
      }
    },
    down(dataDir) {
      const files = ['shared-memory.json', 'terminal-messages.json', 'persistent-queue.json'];
      for (const file of files) {
        const filePath = join(dataDir, file);
        const data = loadJson(filePath);
        if (data && data._schemaVersion !== undefined) {
          delete data._schemaVersion;
          saveJson(filePath, data);
        }
      }
    },
  },
  {
    version: 2,
    name: 'backfill-created-at',
    up(dataDir) {
      const filePath = join(dataDir, '..', 'registry.json');
      const data = loadJson(filePath);
      if (!data || !Array.isArray(data.chains)) return;
      let changed = false;
      for (const chain of data.chains) {
        if (!chain.createdAt) {
          chain.createdAt = chain.startedAt || new Date().toISOString();
          changed = true;
        }
      }
      if (changed) {
        saveJson(filePath, data);
      }
    },
    down(_dataDir) {
      // No-op — safe, doesn't remove data
    },
  },
];

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a migration runner for versioned schema changes.
 *
 * @param {object} ctx
 * @param {string} ctx.dataDir - The .data/ directory path
 * @param {object} [ctx.log]   - Logger with .info() (optional)
 * @returns {object} Migration runner API
 */
export function createMigrationRunner(ctx = {}) {
  const dataDir = ctx.dataDir;
  if (!dataDir) throw new Error('dataDir is required');
  const log = ctx.log || null;

  const versionFile = join(dataDir, '.migration-version');

  /**
   * Get the current applied migration version.
   * @returns {number}
   */
  function getCurrentVersion() {
    if (!existsSync(versionFile)) return 0;
    try {
      const raw = readFileSync(versionFile, 'utf-8').trim();
      const n = parseInt(raw, 10);
      return isNaN(n) ? 0 : n;
    } catch {
      return 0;
    }
  }

  /**
   * Set the migration version (atomic write).
   * @param {number} n
   */
  function setVersion(n) {
    const dir = dirname(versionFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = versionFile + '.tmp';
    try {
      writeFileSync(tmpFile, String(n));
      renameSync(tmpFile, versionFile);
    } catch {
      writeFileSync(versionFile, String(n));
    }
  }

  /**
   * Run all pending up() migrations.
   * @returns {{ from: number, to: number, applied: string[] }}
   */
  function migrate() {
    const from = getCurrentVersion();
    const pending = migrations
      .filter(m => m.version > from)
      .sort((a, b) => a.version - b.version);

    const applied = [];
    let current = from;

    for (const m of pending) {
      try {
        m.up(dataDir);
        current = m.version;
        setVersion(current);
        applied.push(m.name);
        if (log) log.info?.(`Migration ${m.version} (${m.name}) applied`);
      } catch (err) {
        if (log) log.error?.(`Migration ${m.version} (${m.name}) failed: ${err.message}`);
        break;
      }
    }

    return { from, to: current, applied };
  }

  /**
   * Roll back to a target version by running down() in reverse.
   * @param {number} targetVersion
   * @returns {{ from: number, to: number, applied: string[] }}
   */
  function rollback(targetVersion = 0) {
    const from = getCurrentVersion();
    if (targetVersion >= from) {
      return { from, to: from, applied: [] };
    }

    const toRollback = migrations
      .filter(m => m.version > targetVersion && m.version <= from)
      .sort((a, b) => b.version - a.version); // Reverse order

    const applied = [];
    let current = from;

    for (const m of toRollback) {
      try {
        m.down(dataDir);
        current = m.version - 1;
        setVersion(current);
        applied.push(m.name);
        if (log) log.info?.(`Rollback ${m.version} (${m.name}) applied`);
      } catch (err) {
        if (log) log.error?.(`Rollback ${m.version} (${m.name}) failed: ${err.message}`);
        break;
      }
    }

    return { from, to: current, applied };
  }

  /**
   * Get list of all registered migrations.
   * @returns {Array<{ version: number, name: string }>}
   */
  function getMigrations() {
    return migrations.map(m => ({ version: m.version, name: m.name }));
  }

  return {
    getCurrentVersion,
    setVersion,
    migrate,
    rollback,
    getMigrations,
  };
}
