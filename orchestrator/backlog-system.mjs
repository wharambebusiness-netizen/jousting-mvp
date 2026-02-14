// ============================================================
// Backlog System Module (extracted from orchestrator.mjs in S65)
// ============================================================
// Producer-consumer task queue with persistence, subtask support,
// priority sorting, and archive management.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

let BACKLOG_FILE = null;
let BACKLOG_ARCHIVE_FILE = null;
let logFn = () => {};

/**
 * Initialize backlog system with orchestrator context.
 * @param {{ orchDir: string, log: Function }} ctx
 */
export function initBacklogSystem(ctx) {
  BACKLOG_FILE = join(ctx.orchDir, 'backlog.json');
  BACKLOG_ARCHIVE_FILE = join(ctx.orchDir, 'backlog-archive.json');
  logFn = ctx.log || (() => {});
}

export function loadBacklog() {
  if (!BACKLOG_FILE || !existsSync(BACKLOG_FILE)) return [];
  try { return JSON.parse(readFileSync(BACKLOG_FILE, 'utf-8')); }
  catch (_) { return []; }
}

export function saveBacklog(tasks) {
  writeFileSync(BACKLOG_FILE, JSON.stringify(tasks, null, 2));
}

export function getNextTask(role, agentId = null) {
  return getNextTasks(role, 1, agentId)[0] || null;
}

// v17: Match backlog task role against agent role OR agent id.
// Producer agents sometimes write agent IDs (e.g., "balance-tuner") instead of role names
// (e.g., "balance-analyst"). Matching both prevents tasks from stalling.
export function taskMatchesAgent(task, role, agentId) {
  return task.role === role || (agentId && task.role === agentId);
}

export function getNextTasks(role, maxTasks = 1, agentId = null) {
  const backlog = loadBacklog();
  const tasks = backlog
    .filter(t =>
      t.status === 'pending' && taskMatchesAgent(t, role, agentId) &&
      (!t.dependsOn?.length || t.dependsOn.every(depId => {
        const dep = backlog.find(d => d.id === depId);
        // If dep not found in active backlog, treat as satisfied (already archived)
        return !dep || dep.status === 'completed' || dep.status === 'done';
      }))
    )
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .slice(0, maxTasks);

  for (const task of tasks) { task.status = 'assigned'; }
  if (tasks.length) saveBacklog(backlog);
  return tasks;
}

export function completeBacklogTask(taskId) {
  const backlog = loadBacklog();
  const task = backlog.find(t => t.id === taskId);
  if (task) {
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    saveBacklog(backlog);
  }
}

// v15: Subtask support — break large tasks into focused units of work.
// Tasks with a `subtasks` array get assigned one subtask at a time.
// Format: { id: "BL-077-1", title: "...", status: "pending"|"completed" }
export function getNextSubtask(taskId) {
  const backlog = loadBacklog();
  const task = backlog.find(t => t.id === taskId);
  if (!task?.subtasks?.length) return null;
  return task.subtasks.find(st => st.status === 'pending') || null;
}

export function completeSubtask(taskId, subtaskId) {
  const backlog = loadBacklog();
  const task = backlog.find(t => t.id === taskId);
  if (!task?.subtasks) return;
  const sub = task.subtasks.find(st => st.id === subtaskId);
  if (sub) {
    sub.status = 'completed';
    sub.completedAt = new Date().toISOString();
    // Auto-complete parent when all subtasks done
    const allDone = task.subtasks.every(st => st.status === 'completed');
    if (allDone) {
      task.status = 'completed';
      task.completedAt = new Date().toISOString();
      logFn(`  Backlog: ${taskId} auto-completed (all ${task.subtasks.length} subtasks done)`);
    }
    saveBacklog(backlog);
  }
}

// v15: Get highest-priority pending task priority for an agent's role (from cache).
// Returns numeric priority (1=P1, 2=P2, ... 99=none). Used to sort agents for pool launch order.
export function getAgentTaskPriority(role, backlogCache, agentId = null) {
  const pending = backlogCache.filter(t => t.status === 'pending' && taskMatchesAgent(t, role, agentId));
  if (!pending.length) return 99;
  return Math.min(...pending.map(t => t.priority ?? 99));
}

// v15: Check if agent has a critical (P1) task waiting
export function agentHasCriticalTask(role, backlogCache, agentId = null) {
  return backlogCache.some(t => t.status === 'pending' && taskMatchesAgent(t, role, agentId) && (t.priority ?? 99) <= 1);
}

export function resetStaleAssignments() {
  const backlog = loadBacklog();
  let resetCount = 0;
  for (const task of backlog) {
    if (task.status === 'assigned') {
      task.status = 'pending';
      resetCount++;
    }
  }
  if (resetCount > 0) {
    saveBacklog(backlog);
    logFn(`Backlog: reset ${resetCount} stale "assigned" task(s) to "pending"`);
  }
}

export function archiveCompletedTasks() {
  const backlog = loadBacklog();
  const completed = backlog.filter(t => t.status === 'completed' || t.status === 'done');
  if (!completed.length) return;

  // Load existing archive or create new
  let archive = [];
  if (existsSync(BACKLOG_ARCHIVE_FILE)) {
    try { archive = JSON.parse(readFileSync(BACKLOG_ARCHIVE_FILE, 'utf-8')); }
    catch (_) { archive = []; }
  }

  // Move completed tasks to archive
  archive.push(...completed);
  writeFileSync(BACKLOG_ARCHIVE_FILE, JSON.stringify(archive, null, 2));

  // Remove from active backlog
  const active = backlog.filter(t => t.status !== 'completed' && t.status !== 'done');
  saveBacklog(active);
  logFn(`Backlog: archived ${completed.length} completed task(s) (${active.length} remaining)`);
}
