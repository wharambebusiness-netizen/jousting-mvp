// ============================================================
// Handoff Parser Module (extracted from orchestrator.mjs in S65)
// ============================================================
// Parses agent handoff markdown files for META sections.
// Validates agent output and file ownership.

import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

let HANDOFF_DIR = null;
let LOG_DIR = null;
let agentWorktrees = null;  // reference to orchestrator's agentWorktrees map
let logFn = () => {};
let timestampFn = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/**
 * Initialize handoff parser with orchestrator context.
 * @param {{ handoffDir: string, logDir: string, agentWorktrees: object, log: Function, timestamp: Function }} ctx
 */
export function initHandoffParser(ctx) {
  HANDOFF_DIR = ctx.handoffDir;
  LOG_DIR = ctx.logDir;
  agentWorktrees = ctx.agentWorktrees;
  logFn = ctx.log || (() => {});
  timestampFn = ctx.timestamp || timestampFn;
}

/**
 * Parse META fields from handoff markdown content string.
 * Pure function — no I/O, fully unit-testable.
 * @param {string} content - Raw handoff markdown text
 * @returns {Object} Parsed meta fields
 */
export function parseMetaContent(content) {
  const meta = {
    status: 'not-started', filesModified: [], testsPassing: null, notes: '',
    testCount: null, notesForOthers: '', testsHealthy: null, fileCount: 0,
    completedTasks: [],
  };

  if (!content) return meta;

  // Case-insensitive matching with flexible whitespace (handles "Files-Modified", "files-modified", etc.)
  const statusMatch = content.match(/^-\s*status\s*:\s*(.+)$/im);
  if (statusMatch) meta.status = statusMatch[1].trim();

  const filesMatch = content.match(/^-\s*files[\s-]*modified\s*:[ \t]*(.+)$/im);
  if (filesMatch) {
    meta.filesModified = filesMatch[1].split(',').map(f => f.trim()).filter(Boolean);
  }
  // v28: Fallback for multiline bulleted list format
  if (meta.filesModified.length === 0) {
    const multilineMatch = content.match(/^-\s*files[\s-]*modified\s*:\s*\n((?:\s+-\s*.+\n?)+)/im);
    if (multilineMatch) {
      meta.filesModified = multilineMatch[1].match(/^\s+-\s*(.+)$/gm)
        ?.map(l => l.replace(/^\s+-\s*/, '').trim()).filter(Boolean) || [];
    }
  }

  // tests-passing: handle "true", "false", "true (685 tests, 7 suites)", "true (667/667)", "794"
  const testsMatch = content.match(/^-\s*tests[\s-]*passing\s*:\s*(.+)$/im);
  if (testsMatch) {
    const raw = testsMatch[1].trim();
    // Determine boolean: starts with "true" → true, starts with "false" → false
    if (/^true\b/i.test(raw)) {
      meta.testsPassing = true;
    } else if (/^false\b/i.test(raw)) {
      meta.testsPassing = false;
    } else if (/^\d+$/.test(raw)) {
      // Bare number like "794" — assume passing
      meta.testsPassing = true;
    }
    // Extract numeric test count from patterns like "true (685 tests...)" or "true (667/667)" or bare "794"
    const countMatch = raw.match(/(\d+)/);
    if (countMatch) {
      meta.testCount = parseInt(countMatch[1], 10);
    }
  }

  const notesMatch = content.match(/^-\s*notes[\s-]*for[\s-]*others\s*:\s*(.+)$/im);
  if (notesMatch) {
    meta.notes = notesMatch[1].trim();
    meta.notesForOthers = meta.notes;
  }

  // v15: Parse completed-tasks from META for subtask completion tracking
  const completedMatch = content.match(/^-\s*completed[\s-]*tasks\s*:\s*(.+)$/im);
  if (completedMatch) {
    meta.completedTasks = completedMatch[1].split(',').map(t => t.trim()).filter(Boolean);
  }

  // --- Quality signals ---
  // testsHealthy: scan full handoff text for health indicators
  const lowerContent = content.toLowerCase();
  if (meta.testsPassing === true) {
    meta.testsHealthy = true;
  } else if (meta.testsPassing === false) {
    meta.testsHealthy = false;
  } else if (lowerContent.includes('all tests passing') || lowerContent.includes('all passing')) {
    meta.testsHealthy = true;
  } else if (lowerContent.includes('tests failing') || lowerContent.includes('test failure')) {
    meta.testsHealthy = false;
  }
  // else testsHealthy stays null (unknown)

  // fileCount: derived from filesModified
  meta.fileCount = meta.filesModified.length;

  return meta;
}

export function parseHandoffMeta(agentId) {
  const defaults = {
    status: 'not-started', filesModified: [], testsPassing: null, notes: '',
    testCount: null, notesForOthers: '', testsHealthy: null, fileCount: 0,
  };
  // v21: Check worktree path first (agent may have written handoff there, not yet merged to main)
  const wt = agentWorktrees?.[agentId];
  const wtHandoffPath = wt ? join(wt.path, 'orchestrator', 'handoffs', `${agentId}.md`) : null;
  const mainHandoffPath = join(HANDOFF_DIR, `${agentId}.md`);
  const path = (wtHandoffPath && existsSync(wtHandoffPath)) ? wtHandoffPath : mainHandoffPath;
  if (!existsSync(path)) return { ...defaults };

  let content;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (err) {
    logFn(`  WARNING: Could not read handoff for ${agentId}: ${err.message}`);
    return { ...defaults };
  }

  try {
    return parseMetaContent(content);
  } catch (err) {
    logFn(`  WARNING: Malformed META in handoff for ${agentId}: ${err.message}`);
    return { ...defaults };
  }
}

// ============================================================
// v28: Targeted message routing — parse @agent-id: messages
// ============================================================
export function getNotesTargetingAgent(targetAgentId, agents) {
  const messages = [];
  for (const agent of agents) {
    if (agent.id === targetAgentId) continue;
    const meta = parseHandoffMeta(agent.id);
    if (!meta.notesForOthers) continue;
    const regex = new RegExp(`@${targetAgentId}\\s*:\\s*(.+)`, 'gi');
    let match;
    while ((match = regex.exec(meta.notesForOthers)) !== null) {
      messages.push({ from: agent.id, message: match[1].trim() });
    }
  }
  return messages;
}

// ============================================================
// Validation Functions
// ============================================================
export function validateFileOwnership(agentResults, agents) {
  const violationLog = join(LOG_DIR, 'ownership-violations.log');
  for (const result of agentResults) {
    const agent = agents.find(a => a.id === result.agentId);
    if (!agent?.fileOwnership?.length) continue;
    const meta = parseHandoffMeta(result.agentId);
    for (const file of meta.filesModified) {
      // v6.1: Allow agents to write their own analysis/handoff files
      const isOwnAnalysis = file.startsWith(`orchestrator/analysis/${result.agentId}-`);
      const isOwnHandoff = file === `orchestrator/handoffs/${result.agentId}.md`;
      if (isOwnAnalysis || isOwnHandoff) continue;

      const owned = agent.fileOwnership.some(pattern => {
        if (pattern.includes('*')) {
          const prefix = pattern.split('*')[0];
          const suffix = pattern.split('*').pop(); // e.g., ".ts"
          return file.startsWith(prefix) && (suffix === '' || file.endsWith(suffix));
        }
        return file === pattern;
      });
      if (!owned) {
        const msg = `[${timestampFn()}] OWNERSHIP VIOLATION: ${result.agentId} modified ${file} (not in fileOwnership)`;
        logFn(`  ⚠ ${msg}`);
        appendFileSync(violationLog, msg + '\n');
      }
    }
  }
}

export function validateAgentOutput(agentId, round, result = null) {
  const meta = parseHandoffMeta(agentId);
  const warnings = [];

  if (meta.status === 'not-started') {
    warnings.push(`${agentId}: Handoff not updated (still "not-started")`);
  }
  if (!meta.filesModified.length && meta.status === 'in-progress') {
    warnings.push(`${agentId}: Claims in-progress but no files modified`);
  }
  if (meta.testsPassing === false) {
    warnings.push(`${agentId}: Reports tests FAILING`);
  }

  // v5B: Detect empty work — agent exited OK but modified zero files and didn't update handoff
  let isEmptyWork = false;
  if (result && result.code === 0 && !result.timedOut) {
    const noFilesModified = !meta.filesModified.length || (meta.filesModified.length === 1 && meta.filesModified[0] === '(none yet)');
    const handoffNotUpdated = meta.status === 'not-started';
    if (noFilesModified && handoffNotUpdated) {
      isEmptyWork = true;
      warnings.push(`${agentId}: EMPTY WORK — exited OK but modified zero files and didn't update handoff (round ${round})`);
    }
  }

  return { warnings, isEmptyWork };
}
