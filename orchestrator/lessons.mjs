// ============================================================
// Cross-Session Lessons Module (v26/M4)
// Records high-signal events (smart reverts) as lessons that persist
// across orchestrator runs. Relevant lessons are injected into agent
// prompts to prevent repeat mistakes.
// ============================================================

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const MAX_LESSONS = 30;
let LESSONS_FILE = '';
let logFn = () => {};

/**
 * Initialize the lessons module.
 * @param {{ orchDir: string, log: Function }} ctx
 */
export function initLessons(ctx) {
  LESSONS_FILE = join(ctx.orchDir, 'lessons.json');
  logFn = ctx.log || (() => {});
}

/**
 * Load lessons from disk. Returns empty array on missing/malformed file.
 * @returns {{ lessons: object[] }}
 */
export function loadLessons() {
  if (!existsSync(LESSONS_FILE)) return { lessons: [] };
  try {
    const data = JSON.parse(readFileSync(LESSONS_FILE, 'utf-8'));
    if (!Array.isArray(data.lessons)) return { lessons: [] };
    return data;
  } catch (_) {
    return { lessons: [] };
  }
}

/**
 * Save lessons to disk with atomic write (temp + rename).
 * @param {{ lessons: object[] }} data
 */
function saveLessons(data) {
  const tmpFile = LESSONS_FILE + '.tmp';
  try {
    writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    // v28: On Windows, renameSync cannot overwrite — delete target first
    if (existsSync(LESSONS_FILE)) {
      try { unlinkSync(LESSONS_FILE); } catch (_) { /* best-effort */ }
    }
    renameSync(tmpFile, LESSONS_FILE);
  } catch (err) {
    logFn(`  WARNING: Could not save lessons: ${err.message}`);
    // Try direct write as fallback
    try { writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2)); }
    catch (_) { /* give up */ }
  }
}

/**
 * Record a lesson from a smart revert event.
 * @param {{ round: number, revertedAgents: string[], strategy: string, agents: object[], codeResults: object[], parseHandoffMeta: Function }} ctx
 */
export function recordLesson(ctx) {
  const data = loadLessons();

  for (const agentId of ctx.revertedAgents) {
    const agent = ctx.agents.find(a => a.id === agentId);
    if (!agent) continue;

    const meta = ctx.parseHandoffMeta(agentId);
    const files = meta.filesModified || [];

    const lesson = {
      id: randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      trigger: 'revert',
      round: ctx.round,
      agentId,
      role: agent.role || agentId,
      summary: `Agent "${agentId}" (${agent.role}) was reverted in round ${ctx.round} (strategy: ${ctx.strategy}). Files: ${files.join(', ') || 'none reported'}.`,
      files,
      relevance: [agent.role],
    };

    // Add roles that share files with this agent for cross-relevance
    for (const otherAgent of ctx.agents) {
      if (otherAgent.id === agentId) continue;
      const sharedFiles = (otherAgent.fileOwnership || []).some(f =>
        files.some(modified => modified === f || modified.startsWith(f.replace(/\*.*$/, '')))
      );
      if (sharedFiles && !lesson.relevance.includes(otherAgent.role)) {
        lesson.relevance.push(otherAgent.role);
      }
    }

    data.lessons.push(lesson);
    logFn(`  Lesson recorded: ${lesson.summary}`);
  }

  // FIFO eviction — cap at MAX_LESSONS
  while (data.lessons.length > MAX_LESSONS) {
    data.lessons.shift();
  }

  saveLessons(data);
}

/**
 * Query relevant lessons for an agent (by role and files-in-common).
 * Returns at most 3 lessons, most recent first.
 * @param {string} role — agent's role
 * @param {string[]} fileOwnership — agent's file ownership list
 * @returns {object[]} — array of lesson objects (max 3)
 */
export function queryLessons(role, fileOwnership = []) {
  const data = loadLessons();
  if (!data.lessons.length) return [];

  // Score each lesson by relevance
  const scored = data.lessons.map(lesson => {
    let score = 0;
    // Role match
    if (lesson.relevance.includes(role)) score += 2;
    // Files-in-common match (literal + glob prefix)
    const literalFiles = fileOwnership.filter(f => !/[*?{]/.test(f));
    const globPrefixes = fileOwnership.filter(f => /[*?{]/.test(f)).map(f => f.split('*')[0]);
    const filesInCommon = lesson.files.filter(f =>
      literalFiles.includes(f) || globPrefixes.some(p => f.startsWith(p))
    );
    score += filesInCommon.length;
    return { lesson, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.lesson.timestamp) - new Date(a.lesson.timestamp))
    .slice(0, 3)
    .map(s => s.lesson);
}

/**
 * Format lessons for prompt injection.
 * @param {object[]} lessons — from queryLessons()
 * @returns {string|null} — formatted text for prompt, or null if no lessons
 */
export function formatLessonsForPrompt(lessons) {
  if (!lessons.length) return null;
  const lines = ['--- LESSONS FROM PREVIOUS RUNS (avoid repeating these mistakes) ---'];
  for (const lesson of lessons) {
    lines.push(`- [Round ${lesson.round}] ${lesson.summary}`);
  }
  return lines.join('\n');
}
