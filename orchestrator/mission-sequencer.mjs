// Mission Sequencer Module (extracted from orchestrator.mjs in S66)
// Multi-mission sequence support: load, transition, reset between sub-missions

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Module-level dependencies (set via init)
let logFn = () => {};
let CONFIG = null;
let CONFIG_DEFAULTS = null;
let ORCH_DIR = null;
let loadMissionFn = null;

// ============================================================
// Mission Config Validation (v28)
// ============================================================
const VALID_AGENT_TYPES = new Set(['feature', 'continuous', 'spawned']);
const VALID_MODELS = new Set(['haiku', 'sonnet', 'opus']);

/**
 * Validate a mission config object. Returns { valid, errors }.
 * Pure function — no side effects, easily testable.
 * @param {object} config - Parsed mission config JSON
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMissionConfig(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Mission config must be a non-null object'] };
  }

  // Sequence missions have different validation
  if (config.type === 'sequence') {
    return validateSequenceConfig(config);
  }

  // --- Required fields ---
  if (!config.name || typeof config.name !== 'string') {
    errors.push('Missing or invalid "name" field (must be a non-empty string)');
  }

  if (!Array.isArray(config.agents) || config.agents.length === 0) {
    errors.push('Missing or empty "agents" array (must have at least one agent)');
  }

  // --- Config overrides validation ---
  if (config.config !== undefined) {
    if (typeof config.config !== 'object' || config.config === null || Array.isArray(config.config)) {
      errors.push('"config" must be a plain object');
    } else {
      if (config.config.maxRounds !== undefined && (typeof config.config.maxRounds !== 'number' || config.config.maxRounds < 1)) {
        errors.push('"config.maxRounds" must be a positive number');
      }
      if (config.config.maxConcurrency !== undefined && (typeof config.config.maxConcurrency !== 'number' || config.config.maxConcurrency < 0)) {
        errors.push('"config.maxConcurrency" must be a non-negative number');
      }
      if (config.config.agentTimeoutMs !== undefined && (typeof config.config.agentTimeoutMs !== 'number' || config.config.agentTimeoutMs < 1000)) {
        errors.push('"config.agentTimeoutMs" must be a number >= 1000');
      }
      if (config.config.maxRuntimeMs !== undefined && (typeof config.config.maxRuntimeMs !== 'number' || config.config.maxRuntimeMs < 1000)) {
        errors.push('"config.maxRuntimeMs" must be a number >= 1000');
      }
    }
  }

  // --- Agent validation ---
  if (Array.isArray(config.agents)) {
    const agentIds = new Set();

    for (let i = 0; i < config.agents.length; i++) {
      const agent = config.agents[i];
      const prefix = `agents[${i}]`;

      if (!agent || typeof agent !== 'object') {
        errors.push(`${prefix}: must be a non-null object`);
        continue;
      }

      // Required agent fields
      if (!agent.id || typeof agent.id !== 'string') {
        errors.push(`${prefix}: missing or invalid "id" (must be a non-empty string)`);
      } else if (agentIds.has(agent.id)) {
        errors.push(`${prefix}: duplicate agent id "${agent.id}"`);
      } else {
        agentIds.add(agent.id);
      }

      if (!agent.name || typeof agent.name !== 'string') {
        errors.push(`${prefix} (${agent.id || '?'}): missing or invalid "name"`);
      }

      // Optional but validated fields
      if (agent.type !== undefined && !VALID_AGENT_TYPES.has(agent.type)) {
        errors.push(`${prefix} (${agent.id || '?'}): invalid "type" "${agent.type}" (must be one of: ${[...VALID_AGENT_TYPES].join(', ')})`);
      }

      if (agent.model !== undefined && agent.model !== null && !VALID_MODELS.has(agent.model)) {
        errors.push(`${prefix} (${agent.id || '?'}): invalid "model" "${agent.model}" (must be one of: ${[...VALID_MODELS].join(', ')})`);
      }

      if (agent.maxModel !== undefined && agent.maxModel !== null && !VALID_MODELS.has(agent.maxModel)) {
        errors.push(`${prefix} (${agent.id || '?'}): invalid "maxModel" "${agent.maxModel}" (must be one of: ${[...VALID_MODELS].join(', ')})`);
      }

      if (agent.dependsOn !== undefined && !Array.isArray(agent.dependsOn)) {
        errors.push(`${prefix} (${agent.id || '?'}): "dependsOn" must be an array`);
      }

      if (agent.fileOwnership !== undefined && !Array.isArray(agent.fileOwnership) && agent.fileOwnership !== 'auto') {
        errors.push(`${prefix} (${agent.id || '?'}): "fileOwnership" must be an array or "auto"`);
      }

      if (agent.timeoutMs !== undefined && agent.timeoutMs !== null && (typeof agent.timeoutMs !== 'number' || agent.timeoutMs < 1000)) {
        errors.push(`${prefix} (${agent.id || '?'}): "timeoutMs" must be a number >= 1000`);
      }

      if (agent.maxBudgetUsd !== undefined && agent.maxBudgetUsd !== null && (typeof agent.maxBudgetUsd !== 'number' || agent.maxBudgetUsd <= 0)) {
        errors.push(`${prefix} (${agent.id || '?'}): "maxBudgetUsd" must be a positive number`);
      }

      if (agent.maxTasksPerRound !== undefined && (typeof agent.maxTasksPerRound !== 'number' || agent.maxTasksPerRound < 0)) {
        errors.push(`${prefix} (${agent.id || '?'}): "maxTasksPerRound" must be a non-negative number`);
      }

      if (agent.minFrequencyRounds !== undefined && (typeof agent.minFrequencyRounds !== 'number' || agent.minFrequencyRounds < 0)) {
        errors.push(`${prefix} (${agent.id || '?'}): "minFrequencyRounds" must be a non-negative number`);
      }
    }

    // --- Cross-agent validation: dependsOn references ---
    for (const agent of config.agents) {
      if (!agent || !Array.isArray(agent.dependsOn)) continue;
      for (const dep of agent.dependsOn) {
        if (!agentIds.has(dep)) {
          errors.push(`${agent.id}: dependsOn "${dep}" references non-existent agent`);
        }
        if (dep === agent.id) {
          errors.push(`${agent.id}: dependsOn references self (circular dependency)`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a sequence mission config.
 */
function validateSequenceConfig(config) {
  const errors = [];

  if (!config.name || typeof config.name !== 'string') {
    errors.push('Missing or invalid "name" field');
  }

  if (!Array.isArray(config.missions) || config.missions.length === 0) {
    errors.push('Missing or empty "missions" array (must have at least one sub-mission)');
  } else {
    for (let i = 0; i < config.missions.length; i++) {
      const entry = config.missions[i];
      if (!entry || typeof entry !== 'object') {
        errors.push(`missions[${i}]: must be a non-null object`);
        continue;
      }
      if (!entry.path || typeof entry.path !== 'string') {
        errors.push(`missions[${i}]: missing or invalid "path"`);
      }
      if (entry.maxRounds !== undefined && (typeof entry.maxRounds !== 'number' || entry.maxRounds < 1)) {
        errors.push(`missions[${i}]: "maxRounds" must be a positive number`);
      }
    }
  }

  if (config.config !== undefined) {
    if (typeof config.config !== 'object' || config.config === null || Array.isArray(config.config)) {
      errors.push('"config" must be a plain object');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// Mission Sequence State
// ============================================================
export const missionState = {
  sequence: null,       // Array of { path, maxRounds } or null
  currentIndex: 0,      // Index into sequence
  roundsUsed: 0,        // Rounds consumed by current sub-mission
  maxRounds: Infinity,  // Round budget for current sub-mission
  configPath: null,     // Path to current mission config (for hot-reload)
};

/**
 * Initialize mission sequencer with orchestrator context.
 * @param {{ config: object, configDefaults: object, orchDir: string, log: Function, loadMission: Function }} ctx
 */
export function initMissionSequencer(ctx) {
  logFn = ctx.log || (() => {});
  CONFIG = ctx.config;
  CONFIG_DEFAULTS = ctx.configDefaults;
  ORCH_DIR = ctx.orchDir;
  loadMissionFn = ctx.loadMission;
}

/**
 * Reset CONFIG to defaults, then apply overrides.
 * Used when transitioning between sub-missions in a sequence.
 */
function resetConfigToDefaults() {
  for (const key of Object.keys(CONFIG)) {
    CONFIG[key] = CONFIG_DEFAULTS[key];
  }
}

/**
 * Load a mission, detecting sequence missions and expanding them.
 * Returns the first (or only) mission's data.
 */
export function loadMissionOrSequence(missionPath) {
  const absPath = resolve(missionPath);
  if (!existsSync(absPath)) {
    console.error(`Mission file not found: ${absPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(absPath, 'utf-8'));

  // v28: Validate mission config before loading
  const validation = validateMissionConfig(raw);
  if (!validation.valid) {
    console.error(`\nMission config validation failed: ${absPath}`);
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  if (raw.type === 'sequence') {
    logFn(`Detected mission sequence: ${raw.name} (${raw.missions.length} sub-missions)`);

    // Apply top-level config (global overrides like maxRuntimeMs)
    if (raw.config) {
      Object.assign(CONFIG, raw.config);
      logFn(`  Sequence config: ${JSON.stringify(raw.config)}`);
    }

    missionState.sequence = raw.missions;
    missionState.currentIndex = 0;

    // Load the first sub-mission
    return loadSubMission(0);
  }

  // Regular mission — no sequence
  missionState.sequence = null;
  return loadMissionFn(missionPath);
}

/**
 * Load a sub-mission from the sequence by index.
 * Resets agent-specific state but preserves global state (tests, costs, round log).
 */
function loadSubMission(index) {
  const entry = missionState.sequence[index];
  const subPath = resolve(ORCH_DIR, '..', entry.path);
  missionState.maxRounds = entry.maxRounds || Infinity;
  missionState.roundsUsed = 0;

  logFn(`\n${'═'.repeat(50)}`);
  logFn(`  MISSION ${index + 1}/${missionState.sequence.length}: ${entry.path} (max ${missionState.maxRounds} rounds)`);
  logFn(`${'═'.repeat(50)}`);

  // v8 bugfix: Reset CONFIG to defaults before loading sub-mission.
  // Without this, mission 1's config properties leak into mission 2.
  resetConfigToDefaults();

  // v8 bugfix: Update configPath so hot-reload reads the correct sub-mission file.
  missionState.configPath = subPath;

  const mission = loadMissionFn(subPath);

  return mission;
}

/**
 * Check if current sub-mission is done and transition to next if available.
 * Returns { transitioned: true, mission } if transitioned, or { transitioned: false } if no more missions.
 * Caller is responsible for updating AGENTS, missionDesignDoc, etc. from the returned mission.
 * @param {string} reason - Why the current mission ended
 */
export function tryTransitionMission(reason) {
  if (!missionState.sequence) return { transitioned: false };

  logFn(`  Mission ${missionState.currentIndex + 1} complete: ${reason}`);

  missionState.currentIndex++;
  if (missionState.currentIndex >= missionState.sequence.length) {
    logFn(`  All ${missionState.sequence.length} missions in sequence completed.`);
    return { transitioned: false };
  }

  const mission = loadSubMission(missionState.currentIndex);
  return { transitioned: true, mission };
}

/**
 * Hot-reload tunable fields from mission config each round.
 * Modifies agent objects and CONFIG in place. Safe to call every round.
 * @param {string} configPath - Path to mission config file
 * @param {Array} agents - Current AGENTS array (elements modified in place)
 */
export function hotReloadMissionConfig(configPath, agents) {
  try {
    const absPath = resolve(configPath);
    const freshMission = JSON.parse(readFileSync(absPath, 'utf-8'));
    for (const freshAgent of (freshMission.agents || [])) {
      const existing = agents.find(a => a.id === freshAgent.id);
      if (!existing) continue;
      // Only update live-tunable fields; preserve runtime state (_originalModel, etc.)
      const TUNABLE_FIELDS = ['model', 'timeoutMs', 'maxBudgetUsd', 'maxModel', 'minFrequencyRounds', 'maxTasksPerRound'];
      for (const field of TUNABLE_FIELDS) {
        const newVal = freshAgent[field] ?? (field === 'maxTasksPerRound' ? 1 : field === 'minFrequencyRounds' ? 0 : null);
        const oldVal = existing[field];
        if (newVal !== oldVal) {
          logFn(`Hot-reload: ${existing.id} ${field} changed ${oldVal}->${newVal}`);
          existing[field] = newVal;
        }
      }
    }
    // v7 Phase 2: Hot-reload balanceConfig (convergence criteria, thresholds)
    if (freshMission.balanceConfig) {
      const oldCC = JSON.stringify(CONFIG.balanceConfig?.convergenceCriteria || null);
      const newCC = JSON.stringify(freshMission.balanceConfig.convergenceCriteria || null);
      if (oldCC !== newCC) {
        logFn(`Hot-reload: convergenceCriteria changed`);
      }
      const oldThreshold = CONFIG.balanceConfig?.regressionThresholdPp;
      const newThreshold = freshMission.balanceConfig.regressionThresholdPp;
      if (oldThreshold !== newThreshold && newThreshold !== undefined) {
        logFn(`Hot-reload: regressionThresholdPp changed ${oldThreshold}->${newThreshold}`);
      }
      CONFIG.balanceConfig = freshMission.balanceConfig;
    }
    // v19: Hot-reload quality gates
    if (freshMission.qualityGates) {
      CONFIG.qualityGates = freshMission.qualityGates;
    }
  } catch (err) {
    logFn(`Hot-reload WARNING: Could not re-read mission config (${err.message}). Keeping existing config.`);
  }
}
