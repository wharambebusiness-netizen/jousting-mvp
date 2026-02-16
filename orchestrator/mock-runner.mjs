// Mock Runner Module — synthetic agent execution for --dry-run mode
// Generates fake handoff output without spawning real Claude processes.
// Used by orchestrator.mjs when --dry-run flag is set.

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Module-level config (set via init)
let HANDOFF_DIR = '';
let logFn = () => {};

// Configurable mock behavior per agent — set via setMockBehavior()
// Defaults: all agents succeed with 1 file modified
const mockBehaviors = {};  // agentId → { outcome, filesModified, delay }

/**
 * Initialize mock runner with orchestrator context.
 * @param {{ handoffDir: string, log: Function }} ctx
 */
export function initMockRunner(ctx) {
  HANDOFF_DIR = ctx.handoffDir;
  logFn = ctx.log || (() => {});
}

/**
 * Configure mock behavior for a specific agent.
 * @param {string} agentId
 * @param {{ outcome?: 'success'|'failure'|'timeout'|'empty', filesModified?: string[], delay?: number }} behavior
 */
export function setMockBehavior(agentId, behavior) {
  mockBehaviors[agentId] = behavior;
}

/**
 * Configure mock behaviors for all agents from a scenario object.
 * @param {Object<string, { outcome?, filesModified?, delay? }>} scenarios
 */
export function setMockScenario(scenarios) {
  for (const [agentId, behavior] of Object.entries(scenarios)) {
    mockBehaviors[agentId] = behavior;
  }
}

/**
 * Clear all mock behaviors (reset to defaults).
 */
export function clearMockBehaviors() {
  for (const key of Object.keys(mockBehaviors)) delete mockBehaviors[key];
}

/**
 * Mock runAgent — generates synthetic handoff and returns a result
 * matching the shape of the real agent-runner.mjs runAgent().
 * @param {object} agent - Agent config object
 * @param {number} round - Current round number
 * @returns {Promise<object>} Result object
 */
export function mockRunAgent(agent, round) {
  const behavior = mockBehaviors[agent.id] || {};
  const outcome = behavior.outcome || 'success';
  const delay = behavior.delay || 50;  // ms — fast by default
  const filesModified = behavior.filesModified || agent.fileOwnership?.slice(0, 1) || [];

  return new Promise((resolve) => {
    setTimeout(() => {
      const startTime = Date.now();

      if (outcome === 'timeout') {
        logFn(`  [dry-run] ${agent.id}: TIMEOUT (mock)`);
        resolve({
          agentId: agent.id,
          code: 0,
          timedOut: true,
          elapsed: Math.round(delay / 1000) || 1,
          stdout: '',
          stderr: 'Mock timeout',
          wasResumed: false,
        });
        return;
      }

      if (outcome === 'failure') {
        logFn(`  [dry-run] ${agent.id}: FAILURE (mock)`);
        // Write a failed handoff
        writeMockHandoff(agent.id, 'in-progress', [], round);
        resolve({
          agentId: agent.id,
          code: 1,
          timedOut: false,
          elapsed: Math.round(delay / 1000) || 1,
          stdout: 'Mock failure output',
          stderr: 'Error: mock agent failure\n  at mockRunAgent',
          wasResumed: false,
        });
        return;
      }

      if (outcome === 'empty') {
        logFn(`  [dry-run] ${agent.id}: EMPTY WORK (mock)`);
        // Don't update handoff — simulates empty work
        resolve({
          agentId: agent.id,
          code: 0,
          timedOut: false,
          elapsed: Math.round(delay / 1000) || 1,
          stdout: 'Mock empty output',
          stderr: '',
          wasResumed: false,
        });
        return;
      }

      // Default: success
      logFn(`  [dry-run] ${agent.id}: OK (mock, ${filesModified.length} files)`);
      const status = agent.type === 'continuous' ? 'in-progress' : 'complete';
      writeMockHandoff(agent.id, status, filesModified, round);

      // Generate mock cost stderr (matches claude CLI output format)
      const mockTokens = 5000 + Math.floor(Math.random() * 10000);
      const mockCost = (mockTokens * 0.00001).toFixed(4);
      const mockStderr = `Total cost: $${mockCost}\nTotal input tokens: ${mockTokens}\nTotal output tokens: ${Math.floor(mockTokens * 0.3)}`;

      resolve({
        agentId: agent.id,
        code: 0,
        timedOut: false,
        elapsed: Math.round(delay / 1000) || 1,
        stdout: `Mock agent output for ${agent.id} round ${round}`,
        stderr: mockStderr,
        wasResumed: false,
      });
    }, delay);
  });
}

/**
 * Write a mock handoff file for an agent.
 */
function writeMockHandoff(agentId, status, filesModified, round) {
  mkdirSync(HANDOFF_DIR, { recursive: true });
  const handoffPath = join(HANDOFF_DIR, `${agentId}.md`);
  const filesList = filesModified.length ? filesModified.join(', ') : '(none)';
  const content = [
    `# ${agentId} — Handoff`,
    '',
    '## META',
    `- status: ${status}`,
    `- files-modified: ${filesList}`,
    '- tests-passing: true',
    `- notes-for-others: [dry-run] Mock output for round ${round}`,
    '',
    '## What Was Done',
    '',
    `[dry-run] Simulated work in round ${round}.`,
    `Files: ${filesList}`,
    '',
    '## What\'s Left',
    '',
    status === 'complete' || status === 'all-done'
      ? 'Nothing — primary task complete.'
      : 'Continuing work next round.',
    '',
  ].join('\n');
  writeFileSync(handoffPath, content);
}

/**
 * Mock runTests — always returns passing (configurable).
 * @param {string|null} testFilter
 * @returns {Promise<object>}
 */
export function mockRunTests(testFilter = null) {
  if (testFilter === '') {
    return Promise.resolve({
      passed: true, count: 'skipped', failCount: '0',
      output: 'skipped — no source changes (dry-run)', skipped: true,
    });
  }
  return Promise.resolve({
    passed: true, count: '1123', failCount: '0',
    output: 'Tests  1123 passed (dry-run mock)',
  });
}

/**
 * No-op git operations for dry-run mode.
 */
export const dryRunGitOps = {
  tagRoundStart: async () => {},
  gitBackup: async () => {},
  createWorktree: async () => false,
  mergeWorktreeBranch: async () => ({ ok: true }),
  cleanupAllWorktrees: async () => {},
  getHeadSha: async () => 'dry-run-mock-sha-0000000000000000',
  smartRevert: async () => ({ reverted: false, strategy: 'dry-run-noop', revertedAgents: [] }),
  smartRevertWorktrees: async () => ({ reverted: false, strategy: 'dry-run-noop', revertedAgents: [] }),
  invalidateRevertedSessions: () => {},
  verifyAgentOutput: async () => ({ warnings: [] }),
  gitExec: async () => ({ stdout: '', stderr: '', code: 0 }),
};
