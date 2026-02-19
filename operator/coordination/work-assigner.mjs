// ============================================================
// Work Assigner — Multi-Strategy Task Assignment
// ============================================================
// Assigns tasks from the queue to workers in the process pool.
// Three strategies:
//   - round-robin: Simple cyclic distribution
//   - capability: Match task category to worker's agent profile
//   - work-stealing: Idle workers pull from busy workers' queues
//
// Factory pattern: createWorkAssigner(options) returns assigner.
// ============================================================

// ── Strategy Implementations ──────────────────────────────

/**
 * Round-robin: assign to each available worker in turn.
 */
function roundRobinStrategy(state) {
  return {
    name: 'round-robin',

    /**
     * Pick the best worker for a task.
     * @param {object} task - Task from the queue
     * @param {Array<{id: string, status: string}>} workers - Available workers
     * @returns {string|null} workerId or null if none available
     */
    select(task, workers) {
      const available = workers.filter(w => w.status === 'running');
      if (available.length === 0) return null;

      const idx = state.rrIndex % available.length;
      state.rrIndex++;
      return available[idx].id;
    },
  };
}

/**
 * Capability-based: match task category to worker capabilities.
 * Workers with matching capabilities are preferred. Falls back to round-robin.
 */
function capabilityStrategy(state) {
  return {
    name: 'capability',

    select(task, workers) {
      const available = workers.filter(w => w.status === 'running');
      if (available.length === 0) return null;

      // If task has a category, prefer workers with matching capabilities
      if (task.category && state.workerCapabilities.size > 0) {
        const matching = available.filter(w => {
          const caps = state.workerCapabilities.get(w.id);
          return caps && caps.has(task.category);
        });
        if (matching.length > 0) {
          // Among matching, pick the one with fewest active tasks
          const taskCounts = state.workerTaskCounts;
          matching.sort((a, b) => (taskCounts.get(a.id) || 0) - (taskCounts.get(b.id) || 0));
          return matching[0].id;
        }
      }

      // Fallback: least-loaded worker
      const taskCounts = state.workerTaskCounts;
      available.sort((a, b) => (taskCounts.get(a.id) || 0) - (taskCounts.get(b.id) || 0));
      return available[0].id;
    },
  };
}

/**
 * Work-stealing: assign to idle workers first, then least-loaded.
 * Workers with 0 active tasks get priority (they "steal" work).
 */
function workStealingStrategy(state) {
  return {
    name: 'work-stealing',

    select(task, workers) {
      const available = workers.filter(w => w.status === 'running');
      if (available.length === 0) return null;

      const taskCounts = state.workerTaskCounts;

      // Priority: idle workers (0 tasks) first
      const idle = available.filter(w => (taskCounts.get(w.id) || 0) === 0);
      if (idle.length > 0) return idle[0].id;

      // Then least-loaded worker
      available.sort((a, b) => (taskCounts.get(a.id) || 0) - (taskCounts.get(b.id) || 0));
      return available[0].id;
    },
  };
}

const STRATEGIES = {
  'round-robin': roundRobinStrategy,
  'capability': capabilityStrategy,
  'work-stealing': workStealingStrategy,
};

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a work assigner.
 * @param {object} options
 * @param {string} [options.strategy='round-robin'] - Assignment strategy
 * @param {object} options.pool - Process pool (getStatus, sendTo)
 * @param {object} options.taskQueue - Task queue
 * @param {object} [options.events] - EventBus for coord:assigned events
 * @param {Function} [options.log] - Logger
 * @returns {object} Assigner methods
 */
export function createWorkAssigner(options = {}) {
  const { pool, taskQueue, events } = options;
  const log = options.log || (() => {});
  const strategyName = options.strategy || 'round-robin';

  if (!pool) throw new Error('Work assigner requires a process pool');
  if (!taskQueue) throw new Error('Work assigner requires a task queue');

  // Shared state across strategies
  const state = {
    rrIndex: 0,
    workerCapabilities: new Map(),  // workerId -> Set<category>
    workerTaskCounts: new Map(),     // workerId -> number of active tasks
  };

  const strategyFactory = STRATEGIES[strategyName];
  if (!strategyFactory) throw new Error(`Unknown strategy: ${strategyName}`);
  const strategy = strategyFactory(state);

  // ── Worker Tracking ─────────────────────────────────────

  /**
   * Register a worker's capabilities (for capability-based strategy).
   * @param {string} workerId
   * @param {string[]} categories - Task categories this worker can handle
   */
  function registerCapabilities(workerId, categories) {
    state.workerCapabilities.set(workerId, new Set(categories));
  }

  /**
   * Update the count of active tasks for a worker.
   * @param {string} workerId
   * @param {number} count
   */
  function updateTaskCount(workerId, count) {
    state.workerTaskCounts.set(workerId, count);
  }

  /**
   * Recalculate task counts from the task queue.
   */
  function refreshTaskCounts() {
    state.workerTaskCounts.clear();
    const all = taskQueue.getAll();
    for (const task of all) {
      if (task.assignedTo && (task.status === 'assigned' || task.status === 'running')) {
        const count = state.workerTaskCounts.get(task.assignedTo) || 0;
        state.workerTaskCounts.set(task.assignedTo, count + 1);
      }
    }
  }

  // ── Assignment ──────────────────────────────────────────

  /**
   * Assign the next ready task to the best available worker.
   * @returns {{ task: object, workerId: string }|null} Assignment or null if nothing to assign
   */
  function assignNext() {
    const readyTasks = taskQueue.getReady();
    if (readyTasks.length === 0) return null;

    const workers = pool.getStatus();
    if (workers.length === 0) return null;

    refreshTaskCounts();

    for (const task of readyTasks) {
      const workerId = strategy.select(task, workers);
      if (workerId) {
        taskQueue.assign(task.id, workerId);
        const count = state.workerTaskCounts.get(workerId) || 0;
        state.workerTaskCounts.set(workerId, count + 1);

        log(`[assigner] Assigned task ${task.id} to worker ${workerId} (strategy: ${strategy.name})`);

        if (events) {
          events.emit('coord:assigned', {
            taskId: task.id,
            workerId,
            strategy: strategy.name,
            category: task.category,
          });
        }

        return { task: taskQueue.get(task.id), workerId };
      }
    }

    return null;
  }

  /**
   * Assign all ready tasks to available workers.
   * @returns {Array<{ task: object, workerId: string }>}
   */
  function assignAll() {
    const assignments = [];
    let assignment;
    while ((assignment = assignNext()) !== null) {
      assignments.push(assignment);
    }
    return assignments;
  }

  /**
   * Get the current strategy name.
   * @returns {string}
   */
  function getStrategy() {
    return strategy.name;
  }

  /**
   * Get worker capabilities map.
   * @returns {object} workerId -> categories[]
   */
  function getCapabilities() {
    const result = {};
    for (const [id, caps] of state.workerCapabilities) {
      result[id] = [...caps];
    }
    return result;
  }

  return {
    assignNext,
    assignAll,
    registerCapabilities,
    updateTaskCount,
    refreshTaskCounts,
    getStrategy,
    getCapabilities,
  };
}

export { STRATEGIES };
