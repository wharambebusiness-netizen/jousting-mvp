// ============================================================
// Session Registry — Chain Persistence (M2a)
// ============================================================
// Persists chain state to operator/registry.json after every
// session. Supports load/save/create/update/query with atomic
// writes (temp + rename) following checkpoint.mjs pattern.
//
// Schema: see docs/operator-plan.md §2a
// ============================================================

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

const REGISTRY_VERSION = 1;
const MAX_CHAINS = 50;

// ── Defaults ─────────────────────────────────────────────────

let registryPath = '';
let archivePath = '';
let logFn = (msg) => console.log(msg);

// ── Init ─────────────────────────────────────────────────────

/**
 * Initialize registry with paths and optional logger.
 * @param {{ operatorDir: string, log?: Function }} ctx
 */
export function initRegistry(ctx) {
  registryPath = join(ctx.operatorDir, 'registry.json');
  archivePath = join(ctx.operatorDir, 'registry-archive.json');
  if (ctx.log) logFn = ctx.log;
}

// ── Atomic Write ─────────────────────────────────────────────

function atomicWrite(filePath, data) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmpFile = filePath + '.tmp';
  try {
    writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    renameSync(tmpFile, filePath);
  } catch (err) {
    // Fallback: direct write if rename fails (cross-device, etc.)
    logFn(`  Registry atomic write failed, trying direct: ${err.message}`);
    try {
      writeFileSync(filePath, JSON.stringify(data, null, 2));
      // Clean up orphaned tmp file from failed rename
      try { unlinkSync(tmpFile); } catch (_) {}
    } catch (err2) {
      logFn(`  WARNING: Registry write failed: ${err2.message}`);
      throw err2;
    }
  }
}

// ── Load / Save ──────────────────────────────────────────────

/**
 * Load registry from disk. Returns empty registry if none exists or corrupt.
 */
export function loadRegistry() {
  const tmpFile = registryPath + '.tmp';

  // Try primary file
  if (existsSync(registryPath)) {
    try {
      const data = JSON.parse(readFileSync(registryPath, 'utf-8'));
      if (data && data.version === REGISTRY_VERSION) {
        // Clean up stale tmp
        if (existsSync(tmpFile)) try { unlinkSync(tmpFile); } catch (_) {}
        return data;
      }
      logFn(`  Registry version mismatch (expected ${REGISTRY_VERSION}, got ${data?.version})`);
    } catch (err) {
      logFn(`  WARNING: Registry parse failed: ${err.message}`);
    }
  }

  // Fallback: recover from incomplete atomic write
  if (existsSync(tmpFile)) {
    try {
      const data = JSON.parse(readFileSync(tmpFile, 'utf-8'));
      if (data && data.version === REGISTRY_VERSION) {
        logFn('  Recovered registry from .tmp file');
        try { renameSync(tmpFile, registryPath); } catch (_) {}
        return data;
      }
    } catch (err) {
      logFn(`  WARNING: Tmp registry also corrupt: ${err.message}`);
    }
    try { unlinkSync(tmpFile); } catch (_) {}
  }

  return createEmptyRegistry();
}

/**
 * Save registry to disk (atomic write).
 */
export function saveRegistry(registry) {
  registry.updatedAt = new Date().toISOString();

  // Archive overflow chains before saving
  if (registry.chains.length > MAX_CHAINS) {
    archiveOldChains(registry);
  }

  atomicWrite(registryPath, registry);
}

// ── Create / Query ───────────────────────────────────────────

function createEmptyRegistry() {
  return {
    version: REGISTRY_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chains: [],
  };
}

/**
 * Create a new chain entry in the registry.
 * @param {object} registry - The loaded registry
 * @param {{ task: string, config: object, projectDir?: string }} opts
 * @returns {object} The new chain object (already pushed to registry.chains)
 */
export function createChain(registry, { task, config, projectDir }) {
  const chain = {
    id: randomUUID(),
    task,
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projectDir: projectDir || null,
    config: {
      model: config.model || 'sonnet',
      maxTurns: config.maxTurns || 30,
      maxContinuations: config.maxContinuations || 5,
      maxBudgetUsd: config.maxBudgetUsd ?? 5.0,
      ...(config.branch ? { branch: config.branch } : {}),
    },
    sessions: [],
    totalCostUsd: 0,
    totalTurns: 0,
    totalDurationMs: 0,
    consecutiveErrors: 0,
  };

  registry.chains.push(chain);
  return chain;
}

/**
 * Record a completed session on a chain.
 * @param {object} chain - The chain to update
 * @param {object} sessionData - Session result data
 */
export function recordSession(chain, sessionData) {
  const session = {
    index: chain.sessions.length,
    sessionId: sessionData.sessionId || null,
    status: sessionData.error ? 'error' : 'complete',
    turns: sessionData.turns || 0,
    costUsd: sessionData.costUsd || 0,
    durationMs: sessionData.durationMs || 0,
    hitMaxTurns: sessionData.hitMaxTurns || false,
    preCompacted: sessionData.preCompacted || false,
    handoffComplete: sessionData.handoffComplete || false,
    handoffFile: sessionData.handoffFile || null,
    error: sessionData.error || null,
  };

  chain.sessions.push(session);
  chain.totalCostUsd += session.costUsd;
  chain.totalTurns += session.turns;
  chain.totalDurationMs += session.durationMs;
  chain.updatedAt = new Date().toISOString();

  // Track consecutive errors for circuit breaker
  if (session.status === 'error') {
    chain.consecutiveErrors = (chain.consecutiveErrors || 0) + 1;
  } else {
    chain.consecutiveErrors = 0;
  }

  return session;
}

/**
 * Update chain status.
 */
export function updateChainStatus(chain, status) {
  chain.status = status;
  chain.updatedAt = new Date().toISOString();
}

/**
 * Find incomplete chains (status === 'running').
 * Returns most recent first.
 */
export function findIncompleteChains(registry) {
  return registry.chains
    .filter(c => c.status === 'running')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/**
 * Find a chain by ID.
 */
export function findChainById(registry, id) {
  return registry.chains.find(c => c.id === id) || null;
}

/**
 * Get chain summary suitable for webhook/logging.
 */
export function getChainSummary(chain) {
  return {
    id: chain.id,
    task: chain.task,
    status: chain.status,
    sessions: chain.sessions.length,
    totalCostUsd: chain.totalCostUsd,
    totalTurns: chain.totalTurns,
    totalDurationMs: chain.totalDurationMs,
    startedAt: chain.startedAt,
    updatedAt: chain.updatedAt,
    projectDir: chain.projectDir,
    config: chain.config,
  };
}

// ── Archival ─────────────────────────────────────────────────

function archiveOldChains(registry) {
  // Keep newest MAX_CHAINS, archive the rest
  const sorted = [...registry.chains].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
  const keep = sorted.slice(0, MAX_CHAINS);
  const archive = sorted.slice(MAX_CHAINS);

  if (archive.length === 0) return;

  // Load existing archive and append
  let existing = { version: REGISTRY_VERSION, chains: [] };
  if (existsSync(archivePath)) {
    try {
      existing = JSON.parse(readFileSync(archivePath, 'utf-8'));
    } catch (_) { /* start fresh */ }
  }
  existing.chains.push(...archive);
  atomicWrite(archivePath, existing);

  registry.chains = keep;
  logFn(`  Archived ${archive.length} old chains`);
}

// ── Exports for testing ──────────────────────────────────────

export { REGISTRY_VERSION, MAX_CHAINS, registryPath };
export { createEmptyRegistry as _createEmptyRegistry };
