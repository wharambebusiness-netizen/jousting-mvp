// ============================================================
// Dynamic Agent Spawning Module (extracted from orchestrator.mjs in S65)
// ============================================================
// Agents can request helper sub-agents by writing spawn request files.
// Spawn requests are detected after the code agent pool completes,
// spawned agents run (with worktrees), then all get merged before testing.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

let SPAWNS_DIR = null;
let CONFIG = null;
let agentWorktrees = null;
let logFn = () => {};
let runAgentFn = null;       // reference to orchestrator's runAgent()
let createWorktreeFn = null; // reference to git-ops createWorktree()

export const SPAWN_CONSTRAINTS = {
  maxSpawnsPerRound: 3,
  maxSpawnsPerAgent: 1,
  maxConcurrentSpawns: 2,
  maxBudgetPerSpawn: 2.0,
  defaultModel: 'haiku',
  defaultTimeoutMs: 10 * 60 * 1000, // 10 min
  blockedRoles: new Set(['producer', 'tech-lead', 'game-designer']),
};

/**
 * Initialize spawn system with orchestrator context.
 * @param {{ spawnsDir: string, config: object, agentWorktrees: object, log: Function, runAgent: Function, createWorktree: Function }} ctx
 */
export function initSpawnSystem(ctx) {
  SPAWNS_DIR = ctx.spawnsDir;
  CONFIG = ctx.config;
  agentWorktrees = ctx.agentWorktrees;
  logFn = ctx.log || (() => {});
  runAgentFn = ctx.runAgent;
  createWorktreeFn = ctx.createWorktree;
}

/**
 * Scan for spawn requests — checks worktrees first (agents write there),
 * then the main spawns directory.
 * @returns {Array} Array of parsed spawn request objects
 */
export function detectSpawnRequests() {
  if (!SPAWNS_DIR) return [];
  const requests = [];
  const seen = new Set();

  // Check agent worktrees for spawn requests (pre-merge)
  for (const [agentId, wt] of Object.entries(agentWorktrees || {})) {
    const wtSpawns = join(wt.path, 'orchestrator', 'spawns');
    if (!existsSync(wtSpawns)) continue;
    for (const file of readdirSync(wtSpawns)) {
      if (!file.startsWith('spawn-') || !file.endsWith('.json') || seen.has(file)) continue;
      try {
        const content = readFileSync(join(wtSpawns, file), 'utf-8');
        const req = JSON.parse(content);
        req._filename = file;
        req._sourcePath = join(wtSpawns, file);
        requests.push(req);
        seen.add(file);
      } catch (err) {
        logFn(`  ⚠ Invalid spawn request ${file} in ${agentId} worktree: ${err.message}`);
      }
    }
  }

  // Check main spawns dir (fallback for non-worktree agents)
  if (existsSync(SPAWNS_DIR)) {
    for (const file of readdirSync(SPAWNS_DIR)) {
      if (!file.startsWith('spawn-') || !file.endsWith('.json') || seen.has(file)) continue;
      // Skip archive directory
      if (file === 'archive') continue;
      try {
        const content = readFileSync(join(SPAWNS_DIR, file), 'utf-8');
        const req = JSON.parse(content);
        req._filename = file;
        req._sourcePath = join(SPAWNS_DIR, file);
        requests.push(req);
        seen.add(file);
      } catch (err) {
        logFn(`  ⚠ Invalid spawn request ${file}: ${err.message}`);
      }
    }
  }

  return requests;
}

/**
 * Validate a spawn request against constraints.
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateSpawnRequest(request, spawnCountThisRound, parentSpawnCount) {
  if (spawnCountThisRound >= SPAWN_CONSTRAINTS.maxSpawnsPerRound) {
    return { valid: false, reason: `round limit (${SPAWN_CONSTRAINTS.maxSpawnsPerRound})` };
  }
  if (parentSpawnCount >= SPAWN_CONSTRAINTS.maxSpawnsPerAgent) {
    return { valid: false, reason: `per-agent limit (${SPAWN_CONSTRAINTS.maxSpawnsPerAgent})` };
  }
  if (SPAWN_CONSTRAINTS.blockedRoles.has(request.role)) {
    return { valid: false, reason: `role '${request.role}' blocked` };
  }
  if (!request.parentId || !request.role || !request.task) {
    return { valid: false, reason: 'missing required fields (parentId, role, task)' };
  }
  if ((request.maxBudgetUsd || 0) > SPAWN_CONSTRAINTS.maxBudgetPerSpawn) {
    return { valid: false, reason: `budget $${request.maxBudgetUsd} > max $${SPAWN_CONSTRAINTS.maxBudgetPerSpawn}` };
  }
  return { valid: true };
}

/**
 * Archive a processed spawn request (move to spawns/archive/).
 */
export function archiveSpawnRequest(sourcePath, filename) {
  const archiveDir = join(SPAWNS_DIR, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  try {
    // Copy to archive (source may be in worktree that gets cleaned up)
    const content = readFileSync(sourcePath, 'utf-8');
    writeFileSync(join(archiveDir, filename), content);
    // Remove original if in main tree
    if (sourcePath.startsWith(SPAWNS_DIR)) {
      try { rmSync(sourcePath); } catch (_) { /* ok */ }
    }
  } catch (_) { /* best-effort */ }
}

/**
 * Detect spawn requests and execute spawned agents.
 * Called after code agents complete, before worktree merge.
 * Spawned agents get their own worktrees and run inline.
 *
 * @param {number} round
 * @param {Array} codeResults - Parent agent results
 * @param {Object} costLog - Cost tracking
 * @param {Object} trackingCtx - Tracking context
 * @returns {Promise<Array>} Results from spawned agents
 */
export async function detectAndSpawnAgents(round, codeResults, costLog, trackingCtx) {
  const requests = detectSpawnRequests();
  if (!requests.length) return [];

  logFn(`\n  Spawn requests: ${requests.length} detected`);

  // Validate and filter
  const validRequests = [];
  const parentCounts = {};

  for (const req of requests) {
    parentCounts[req.parentId] = (parentCounts[req.parentId] || 0);
    const validation = validateSpawnRequest(req, validRequests.length, parentCounts[req.parentId]);
    if (!validation.valid) {
      logFn(`    ✗ ${req.parentId} → ${req.name || req.role}: ${validation.reason}`);
      archiveSpawnRequest(req._sourcePath, req._filename);
      continue;
    }
    parentCounts[req.parentId]++;
    validRequests.push(req);
  }

  if (!validRequests.length) return [];

  // Build and run spawned agents
  const spawnedResults = [];
  const limit = SPAWN_CONSTRAINTS.maxConcurrentSpawns;

  for (let i = 0; i < validRequests.length; i += limit) {
    const batch = validRequests.slice(i, i + limit);
    const names = batch.map(r => `${r.name || r.role}(by:${r.parentId})`);
    logFn(`  Spawning ${batch.length} agent(s): [${names.join(', ')}]`);

    const promises = batch.map(async (req) => {
      const spawnId = `spawn-${randomUUID().slice(0, 8)}`;
      const agent = {
        id: spawnId,
        name: req.name || `${req.role} helper`,
        role: req.role,
        type: 'spawned',
        model: req.model || SPAWN_CONSTRAINTS.defaultModel,
        timeoutMs: Math.min(req.timeoutMs || SPAWN_CONSTRAINTS.defaultTimeoutMs, SPAWN_CONSTRAINTS.defaultTimeoutMs),
        maxBudgetUsd: Math.min(req.maxBudgetUsd || SPAWN_CONSTRAINTS.maxBudgetPerSpawn, SPAWN_CONSTRAINTS.maxBudgetPerSpawn),
        fileOwnership: req.fileOwnership || [],
        dependsOn: [],
        _spawnedBy: req.parentId,
        _spawnedRound: round,
        // Override the task prompt
        _spawnTask: req.task,
        _spawnContext: req.context,
      };

      // Create worktree for spawned agent
      if (CONFIG?.useWorktrees) {
        await createWorktreeFn(agent.id, round);
      }

      const result = await runAgentFn(agent, round);
      // v28: Stamp round and spawnId on request before archiving (for notifications)
      req.round = round;
      req._spawnId = spawnId;
      try { writeFileSync(req._sourcePath, JSON.stringify(req, null, 2)); } catch (_) {}
      archiveSpawnRequest(req._sourcePath, req._filename);
      return { agent, result };
    });

    const results = await Promise.all(promises);
    for (const { agent, result } of results) {
      const status = result.timedOut ? 'TIMEOUT' : result.code === 0 ? 'OK' : `ERROR(${result.code})`;
      logFn(`    ${agent.id} (${agent.name}): ${status} in ${(result.elapsed / 60).toFixed(1)}min`);
      spawnedResults.push(result);
    }
  }

  return spawnedResults;
}

/**
 * Get spawn result notifications for a parent agent (injected into next round prompt).
 * @param {string} parentId - Parent agent ID
 * @param {number} prevRound - Previous round number
 * @returns {string|null}
 */
export function getSpawnNotifications(parentId, prevRound) {
  const archiveDir = join(SPAWNS_DIR, 'archive');
  if (!existsSync(archiveDir)) return null;

  const notifications = [];
  for (const file of readdirSync(archiveDir)) {
    if (!file.startsWith('spawn-') || !file.endsWith('.json')) continue;
    try {
      const req = JSON.parse(readFileSync(join(archiveDir, file), 'utf-8'));
      if (req.parentId !== parentId) continue;
      // Check if from recent round (within 2 rounds)
      if (req.round && req.round < prevRound - 1) continue;

      notifications.push(
        `Your spawned agent "${req.name || req.role}" completed (round ${req.round || '?'}).`,
        `Task: ${(req.task || '').slice(0, 120)}`,
      );
    } catch (_) { /* skip */ }
  }

  return notifications.length ? notifications.join('\n') : null;
}
