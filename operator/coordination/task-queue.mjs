// ============================================================
// Task Queue — Dependency-Aware Work Queue
// ============================================================
// Central data structure for coordinating work across workers.
// Tasks have dependencies (DAG), priorities, and worker assignments.
// Ready tasks = all deps completed + not yet assigned.
//
// Factory pattern: createTaskQueue() returns queue methods.
// Uses Kahn's algorithm for cycle detection and topological sort.
// ============================================================

// ── Task statuses ───────────────────────────────────────────
const STATUSES = new Set(['pending', 'assigned', 'running', 'complete', 'failed', 'cancelled']);

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a task queue with dependency graph.
 * @param {object} [options]
 * @param {Function} [options.log] - Logger function
 * @returns {object} Queue methods
 */
export function createTaskQueue(options = {}) {
  const log = options.log || (() => {});

  /** @type {Map<string, Task>} */
  const tasks = new Map();

  // ── Core Operations ─────────────────────────────────────

  /**
   * Add a task to the queue.
   * @param {object} taskDef
   * @param {string} taskDef.id - Unique task ID
   * @param {string} taskDef.task - Task description
   * @param {string[]} [taskDef.deps] - IDs of tasks that must complete first
   * @param {number} [taskDef.priority] - Higher = more important (default 0)
   * @param {string} [taskDef.category] - Task category (for capability matching)
   * @param {object} [taskDef.metadata] - Arbitrary metadata
   * @returns {object} The created task
   */
  function add(taskDef) {
    if (!taskDef || !taskDef.id) throw new Error('Task must have an id');
    if (tasks.has(taskDef.id)) throw new Error(`Task "${taskDef.id}" already exists`);

    const deps = taskDef.deps || [];

    // Validate deps exist (if they reference tasks already in the queue)
    // Note: deps can reference tasks not yet added (forward references)
    // Cycle detection happens in validate() and getReady()

    const task = {
      id: taskDef.id,
      task: taskDef.task || '',
      deps: [...deps],
      priority: taskDef.priority || 0,
      category: taskDef.category || null,
      metadata: { ...(taskDef.metadata || {}) },
      status: 'pending',
      assignedTo: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
    };

    // Check for immediate cycle (self-dependency)
    if (deps.includes(taskDef.id)) {
      throw new Error(`Task "${taskDef.id}" cannot depend on itself`);
    }

    // Check for cycle introduction
    if (deps.length > 0 && wouldCreateCycle(taskDef.id, deps)) {
      throw new Error(`Adding task "${taskDef.id}" would create a dependency cycle`);
    }

    tasks.set(taskDef.id, task);
    log(`[queue] Added task ${taskDef.id} (deps: ${deps.join(', ') || 'none'})`);
    return { ...task };
  }

  /**
   * Remove a task from the queue. Only pending/cancelled tasks can be removed.
   * @param {string} taskId
   * @returns {boolean}
   */
  function remove(taskId) {
    const task = tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'running' || task.status === 'assigned') {
      throw new Error(`Cannot remove ${task.status} task "${taskId}"`);
    }

    // Remove from other tasks' deps
    for (const [, t] of tasks) {
      const idx = t.deps.indexOf(taskId);
      if (idx !== -1) t.deps.splice(idx, 1);
    }

    tasks.delete(taskId);
    log(`[queue] Removed task ${taskId}`);
    return true;
  }

  /**
   * Assign a task to a worker.
   * @param {string} taskId
   * @param {string} workerId
   * @returns {object} Updated task
   */
  function assign(taskId, workerId) {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.status !== 'pending') {
      throw new Error(`Cannot assign task "${taskId}" with status "${task.status}"`);
    }
    task.status = 'assigned';
    task.assignedTo = workerId;
    task.assignedAt = new Date().toISOString();
    log(`[queue] Assigned task ${taskId} to worker ${workerId}`);
    return { ...task };
  }

  /**
   * Mark a task as running.
   * @param {string} taskId
   * @returns {object} Updated task
   */
  function start(taskId) {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.status !== 'assigned') {
      throw new Error(`Cannot start task "${taskId}" with status "${task.status}"`);
    }
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    log(`[queue] Started task ${taskId}`);
    return { ...task };
  }

  /**
   * Mark a task as complete.
   * @param {string} taskId
   * @param {*} [result] - Task result
   * @returns {object} Updated task
   */
  function complete(taskId, result = null) {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.status !== 'running' && task.status !== 'assigned') {
      throw new Error(`Cannot complete task "${taskId}" with status "${task.status}"`);
    }
    task.status = 'complete';
    task.completedAt = new Date().toISOString();
    task.result = result;
    log(`[queue] Completed task ${taskId}`);
    return { ...task };
  }

  /**
   * Mark a task as failed.
   * @param {string} taskId
   * @param {string} [error] - Error message
   * @returns {object} Updated task
   */
  function fail(taskId, error = null) {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.status !== 'running' && task.status !== 'assigned') {
      throw new Error(`Cannot fail task "${taskId}" with status "${task.status}"`);
    }
    task.status = 'failed';
    task.completedAt = new Date().toISOString();
    task.error = error;
    log(`[queue] Failed task ${taskId}: ${error || 'unknown'}`);
    return { ...task };
  }

  /**
   * Cancel a pending or assigned task and cascade to dependents.
   * @param {string} taskId
   * @param {string} [reason]
   * @returns {string[]} IDs of all cancelled tasks (including cascaded)
   */
  function cancel(taskId, reason = 'cancelled') {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.status === 'complete' || task.status === 'cancelled') return [];
    if (task.status === 'running') {
      throw new Error(`Cannot cancel running task "${taskId}" — fail it instead`);
    }

    const cancelled = [];
    function cascadeCancel(id, r) {
      const t = tasks.get(id);
      if (!t || t.status === 'complete' || t.status === 'cancelled' || t.status === 'running' || t.status === 'failed') return;
      t.status = 'cancelled';
      t.error = r;
      t.completedAt = new Date().toISOString();
      cancelled.push(id);
      // Cancel dependents
      for (const [, dep] of tasks) {
        if (dep.deps.includes(id)) cascadeCancel(dep.id, `Dependency "${id}" was cancelled`);
      }
    }

    // If the root task is already failed, don't change it — just cascade to dependents
    if (task.status === 'failed') {
      for (const [, dep] of tasks) {
        if (dep.deps.includes(taskId)) cascadeCancel(dep.id, `Dependency "${taskId}" failed`);
      }
    } else {
      cascadeCancel(taskId, reason);
    }

    log(`[queue] Cancelled ${cancelled.length} tasks starting from ${taskId}`);
    return cancelled;
  }

  /**
   * Update mutable fields on a pending or assigned task.
   * @param {string} taskId
   * @param {object} fields - Fields to update (task, priority, category, metadata)
   * @returns {object} Updated task
   */
  function update(taskId, fields = {}) {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.status !== 'pending' && task.status !== 'assigned') {
      throw new Error(`Cannot update task "${taskId}" with status "${task.status}" (must be pending or assigned)`);
    }
    if (fields.task !== undefined) task.task = String(fields.task);
    if (fields.priority !== undefined) task.priority = Number(fields.priority) || 0;
    if (fields.category !== undefined) task.category = fields.category || null;
    if (fields.metadata !== undefined) task.metadata = { ...task.metadata, ...(fields.metadata || {}) };
    log(`[queue] Updated task ${taskId}`);
    return { ...task };
  }

  /**
   * Reset a failed/cancelled task back to pending.
   * @param {string} taskId
   * @returns {object} Updated task
   */
  function retry(taskId) {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" not found`);
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new Error(`Can only retry failed or cancelled tasks, got "${task.status}"`);
    }
    task.status = 'pending';
    task.assignedTo = null;
    task.assignedAt = null;
    task.startedAt = null;
    task.completedAt = null;
    task.result = null;
    task.error = null;
    log(`[queue] Retried task ${taskId}`);
    return { ...task };
  }

  // ── Query Operations ────────────────────────────────────

  /**
   * Get tasks ready for assignment (all deps complete, status pending).
   * Returns sorted by priority (descending), then creation order.
   * @returns {object[]}
   */
  function getReady() {
    const completedIds = new Set();
    for (const [id, t] of tasks) {
      if (t.status === 'complete') completedIds.add(id);
    }

    const ready = [];
    for (const [, t] of tasks) {
      if (t.status !== 'pending') continue;
      const depsComplete = t.deps.every(dep => completedIds.has(dep));
      if (depsComplete) ready.push({ ...t });
    }

    // Sort by priority (desc), then by creation time (asc)
    ready.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.createdAt.localeCompare(b.createdAt);
    });

    return ready;
  }

  /**
   * Get all tasks assigned to or running on a specific worker.
   * @param {string} workerId
   * @returns {object[]}
   */
  function getByWorker(workerId) {
    const result = [];
    for (const [, t] of tasks) {
      if (t.assignedTo === workerId && (t.status === 'assigned' || t.status === 'running')) {
        result.push({ ...t });
      }
    }
    return result;
  }

  /**
   * Get a single task by ID.
   * @param {string} taskId
   * @returns {object|null}
   */
  function get(taskId) {
    const t = tasks.get(taskId);
    return t ? { ...t } : null;
  }

  /**
   * Get all tasks.
   * @returns {object[]}
   */
  function getAll() {
    return [...tasks.values()].map(t => ({ ...t }));
  }

  /**
   * Get the dependency graph as adjacency lists.
   * @returns {{ nodes: string[], edges: Array<{from: string, to: string}>, levels: string[][] }}
   */
  function getDependencyGraph() {
    const nodes = [...tasks.keys()];
    const edges = [];
    for (const [id, t] of tasks) {
      for (const dep of t.deps) {
        if (tasks.has(dep)) edges.push({ from: dep, to: id });
      }
    }
    const levels = getLevels();
    return { nodes, edges, levels };
  }

  /**
   * Get execution progress.
   * @returns {{ total: number, pending: number, assigned: number, running: number, complete: number, failed: number, cancelled: number, percentComplete: number }}
   */
  function getProgress() {
    let pending = 0, assigned = 0, running = 0, complete = 0, failed = 0, cancelled = 0;
    for (const [, t] of tasks) {
      switch (t.status) {
        case 'pending': pending++; break;
        case 'assigned': assigned++; break;
        case 'running': running++; break;
        case 'complete': complete++; break;
        case 'failed': failed++; break;
        case 'cancelled': cancelled++; break;
      }
    }
    const total = tasks.size;
    const done = complete + cancelled;
    return {
      total, pending, assigned, running, complete, failed, cancelled,
      percentComplete: total === 0 ? 100 : Math.round((done / total) * 100),
    };
  }

  /** @returns {number} */
  function size() { return tasks.size; }

  // ── DAG Utilities ───────────────────────────────────────

  /**
   * Topological sort of all tasks.
   * @returns {string[]} Task IDs in dependency order
   */
  function topologicalSort() {
    const inDegree = new Map();
    for (const [id, t] of tasks) {
      inDegree.set(id, t.deps.filter(d => tasks.has(d)).length);
    }

    const queue = [];
    for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }

    const order = [];
    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);
      for (const [id, t] of tasks) {
        if (t.deps.includes(current)) {
          const newDeg = inDegree.get(id) - 1;
          inDegree.set(id, newDeg);
          if (newDeg === 0) queue.push(id);
        }
      }
    }

    if (order.length !== tasks.size) {
      throw new Error('Cannot topologically sort — graph has cycles');
    }
    return order;
  }

  /**
   * Group tasks into parallel execution levels.
   * @returns {string[][]}
   */
  function getLevels() {
    if (tasks.size === 0) return [];
    const order = topologicalSort();
    const levelMap = new Map();

    for (const id of order) {
      const t = tasks.get(id);
      if (t.deps.length === 0 || t.deps.every(d => !tasks.has(d))) {
        levelMap.set(id, 0);
      } else {
        let maxDepLevel = -1;
        for (const dep of t.deps) {
          const depLevel = levelMap.get(dep);
          if (depLevel !== undefined && depLevel > maxDepLevel) maxDepLevel = depLevel;
        }
        levelMap.set(id, maxDepLevel + 1);
      }
    }

    const maxLevel = Math.max(...levelMap.values());
    const levels = [];
    for (let i = 0; i <= maxLevel; i++) {
      const levelTasks = [];
      for (const [id, level] of levelMap) {
        if (level === i) levelTasks.push(id);
      }
      if (levelTasks.length > 0) levels.push(levelTasks);
    }
    return levels;
  }

  /**
   * Validate the queue: check for cycles and missing dependencies.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validate() {
    const errors = [];

    // Check for missing deps
    for (const [id, t] of tasks) {
      for (const dep of t.deps) {
        if (!tasks.has(dep)) errors.push(`Task "${id}" depends on unknown task "${dep}"`);
      }
    }

    if (errors.length > 0) return { valid: false, errors };

    // Kahn's algorithm for cycle detection
    const inDegree = new Map();
    for (const [id, t] of tasks) inDegree.set(id, t.deps.length);

    const queue = [];
    for (const [id, deg] of inDegree) { if (deg === 0) queue.push(id); }

    let visited = 0;
    const sorted = [];
    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);
      visited++;
      for (const [id, t] of tasks) {
        if (t.deps.includes(current)) {
          const newDeg = inDegree.get(id) - 1;
          inDegree.set(id, newDeg);
          if (newDeg === 0) queue.push(id);
        }
      }
    }

    if (visited !== tasks.size) {
      const cycleNodes = [...tasks.keys()].filter(id => !sorted.includes(id));
      errors.push(`Cycle detected involving tasks: ${cycleNodes.join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check if adding a task with given deps would create a cycle.
   * @param {string} newId
   * @param {string[]} deps
   * @returns {boolean}
   */
  function wouldCreateCycle(newId, deps) {
    // BFS from each dep — if we can reach newId (via tasks that depend on newId), it's a cycle
    // This handles the case where existing tasks already depend on newId
    const visited = new Set();
    const queue = [newId];

    // Find all tasks that transitively depend on newId (reverse edges)
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      for (const [id, t] of tasks) {
        if (t.deps.includes(current) && !visited.has(id)) {
          queue.push(id);
        }
      }
    }

    // If any of the new task's deps are reachable from newId, adding would create a cycle
    return deps.some(dep => visited.has(dep));
  }

  /**
   * Serialize queue state for persistence or debugging.
   * @returns {object}
   */
  function toJSON() {
    return {
      tasks: [...tasks.values()].map(t => ({ ...t })),
    };
  }

  /**
   * Restore queue from serialized state.
   * @param {object} json
   */
  function fromJSON(json) {
    tasks.clear();
    for (const t of json.tasks || []) {
      tasks.set(t.id, { ...t });
    }
  }

  /**
   * Clear all tasks.
   */
  function clear() {
    tasks.clear();
  }

  return {
    add,
    remove,
    assign,
    start,
    complete,
    fail,
    cancel,
    update,
    retry,
    get,
    getAll,
    getReady,
    getByWorker,
    getDependencyGraph,
    getProgress,
    topologicalSort,
    getLevels,
    validate,
    size,
    toJSON,
    fromJSON,
    clear,
  };
}
