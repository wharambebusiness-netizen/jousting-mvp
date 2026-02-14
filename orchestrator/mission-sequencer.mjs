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
