// ============================================================
// DAG Task Scheduler (v22 — Phase 4: Ecosystem)
// ============================================================
// Directed Acyclic Graph scheduler for multi-agent orchestration.
// Extends beyond the 5 fixed workflow patterns in workflow-engine.mjs
// to support arbitrary dependency graphs between tasks.
//
// Usage:
//   const dag = new DAGScheduler({ maxConcurrency: 3 });
//   dag.addNode('design', 'architect', 'Design API schema', []);
//   dag.addNode('backend', 'engine-dev', 'Implement API', ['design']);
//   dag.addNode('frontend', 'ui-dev', 'Build UI', ['design']);
//   dag.addNode('tests', 'qa', 'Integration tests', ['backend', 'frontend']);
//   dag.addNode('docs', 'tech-lead', 'Write docs', ['backend']);
//   const { valid } = dag.validate();
//   await dag.execute(async (node) => ctx.runAgent(node.agentId, round));

class DAGNode {
  constructor(id, agentId, task, dependencies = [], metadata = {}) {
    this.id = id;
    this.agentId = agentId;
    this.task = task;
    this.dependencies = [...dependencies];
    this.status = 'pending'; // pending | ready | running | completed | failed | skipped
    this.result = null;
    this.startTime = null;
    this.endTime = null;
    this.metadata = { ...metadata };
    this.skipReason = null;
  }

  isReady(completedNodes) {
    if (this.status !== 'pending') return false;
    return this.dependencies.every(dep => completedNodes.has(dep));
  }

  get duration() {
    if (!this.startTime || !this.endTime) return null;
    return this.endTime - this.startTime;
  }

  toJSON() {
    return {
      id: this.id, agentId: this.agentId, task: this.task,
      dependencies: this.dependencies, status: this.status,
      result: this.result, startTime: this.startTime, endTime: this.endTime,
      metadata: this.metadata, skipReason: this.skipReason,
    };
  }
}

class DAGScheduler {
  constructor(options = {}) {
    this.maxConcurrency = options.maxConcurrency || 4;
    this.onNodeStart = options.onNodeStart || null;
    this.onNodeComplete = options.onNodeComplete || null;
    this.onNodeError = options.onNodeError || null;
    /** @type {Map<string, DAGNode>} */
    this.nodes = new Map();
  }

  addNode(id, agentId, task, dependencies = [], metadata = {}) {
    if (this.nodes.has(id)) throw new Error(`Node "${id}" already exists`);
    const node = new DAGNode(id, agentId, task, dependencies, metadata);
    this.nodes.set(id, node);
    return node;
  }

  addEdge(fromId, toId) {
    const toNode = this.nodes.get(toId);
    if (!toNode) throw new Error(`Target node "${toId}" not found`);
    if (!this.nodes.has(fromId)) throw new Error(`Source node "${fromId}" not found`);
    if (!toNode.dependencies.includes(fromId)) toNode.dependencies.push(fromId);
  }

  /** Validate: check for cycles and missing dependencies. */
  validate() {
    const errors = [];
    if (this.nodes.size === 0) return { valid: true, errors };

    for (const [id, node] of this.nodes) {
      for (const dep of node.dependencies) {
        if (!this.nodes.has(dep)) errors.push(`Node "${id}" depends on unknown node "${dep}"`);
      }
    }
    if (errors.length > 0) return { valid: false, errors };

    // Kahn's algorithm for cycle detection
    const inDegree = new Map();
    for (const [id, node] of this.nodes) inDegree.set(id, node.dependencies.length);

    const queue = [];
    for (const [id, degree] of inDegree) { if (degree === 0) queue.push(id); }

    let visited = 0;
    const sorted = [];
    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);
      visited++;
      for (const [id, node] of this.nodes) {
        if (node.dependencies.includes(current)) {
          const newDeg = inDegree.get(id) - 1;
          inDegree.set(id, newDeg);
          if (newDeg === 0) queue.push(id);
        }
      }
    }

    if (visited !== this.nodes.size) {
      const cycleNodes = [...this.nodes.keys()].filter(id => !sorted.includes(id));
      errors.push(`Cycle detected involving nodes: ${cycleNodes.join(', ')}`);
    }

    return { valid: errors.length === 0, errors };
  }

  topologicalSort() {
    const inDegree = new Map();
    for (const [id, node] of this.nodes) inDegree.set(id, node.dependencies.filter(d => this.nodes.has(d)).length);

    const queue = [];
    for (const [id, degree] of inDegree) { if (degree === 0) queue.push(id); }

    const order = [];
    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);
      for (const [id, node] of this.nodes) {
        if (node.dependencies.includes(current)) {
          const newDeg = inDegree.get(id) - 1;
          inDegree.set(id, newDeg);
          if (newDeg === 0) queue.push(id);
        }
      }
    }

    if (order.length !== this.nodes.size) throw new Error('Cannot topologically sort a graph with cycles');
    return order;
  }

  /** Group nodes into execution levels for visualization. */
  getLevels() {
    if (this.nodes.size === 0) return [];
    const levelMap = new Map();
    const order = this.topologicalSort();

    for (const id of order) {
      const node = this.nodes.get(id);
      if (node.dependencies.length === 0) {
        levelMap.set(id, 0);
      } else {
        let maxDepLevel = -1;
        for (const dep of node.dependencies) {
          const depLevel = levelMap.get(dep);
          if (depLevel !== undefined && depLevel > maxDepLevel) maxDepLevel = depLevel;
        }
        levelMap.set(id, maxDepLevel + 1);
      }
    }

    const maxLevel = Math.max(...levelMap.values());
    const grouped = [];
    for (let i = 0; i <= maxLevel; i++) {
      const levelNodes = [...levelMap.entries()].filter(([, l]) => l === i).map(([id]) => id);
      if (levelNodes.length > 0) grouped.push(levelNodes);
    }
    return grouped;
  }

  /** Compute the critical path (longest dependency chain). */
  getCriticalPath() {
    if (this.nodes.size === 0) return { path: [], length: 0 };
    const order = this.topologicalSort();
    const dist = new Map();
    const parent = new Map();

    for (const id of order) { dist.set(id, 1); parent.set(id, null); }

    for (const id of order) {
      const node = this.nodes.get(id);
      for (const dep of node.dependencies) {
        const candidate = dist.get(dep) + 1;
        if (candidate > dist.get(id)) { dist.set(id, candidate); parent.set(id, dep); }
      }
    }

    let maxNode = order[0], maxDist = dist.get(order[0]);
    for (const id of order) { if (dist.get(id) > maxDist) { maxDist = dist.get(id); maxNode = id; } }

    const path = [];
    let current = maxNode;
    while (current !== null) { path.unshift(current); current = parent.get(current); }
    return { path, length: path.length };
  }

  getReadyNodes() {
    const completedIds = new Set();
    for (const [id, node] of this.nodes) { if (node.status === 'completed') completedIds.add(id); }
    return [...this.nodes.values()].filter(n => n.isReady(completedIds));
  }

  /** Execute the DAG with bounded concurrency. */
  async execute(runNodeFn) {
    const validation = this.validate();
    if (!validation.valid) throw new Error(`Invalid DAG: ${validation.errors.join('; ')}`);
    if (this.nodes.size === 0) return { success: true, results: new Map(), failed: [] };

    const results = new Map();
    const failed = [];
    let running = 0;

    return new Promise((resolve) => {
      const trySchedule = () => {
        if (this._allTerminal()) { resolve({ success: failed.length === 0, results, failed }); return; }

        const readyNodes = this.getReadyNodes();
        while (readyNodes.length > 0 && running < this.maxConcurrency) {
          const node = readyNodes.shift();
          node.status = 'running';
          node.startTime = Date.now();
          running++;
          if (this.onNodeStart) this.onNodeStart(node);

          runNodeFn(node)
            .then(result => {
              node.status = 'completed'; node.endTime = Date.now(); node.result = result;
              results.set(node.id, result); running--;
              if (this.onNodeComplete) this.onNodeComplete(node);
              trySchedule();
            })
            .catch(error => {
              node.status = 'failed'; node.endTime = Date.now();
              node.result = { error: error.message || String(error) };
              failed.push(node.id); running--;
              if (this.onNodeError) this.onNodeError(node, error);
              this._skipDependents(node.id, `Dependency "${node.id}" failed`);
              trySchedule();
            });
        }

        if (running === 0 && readyNodes.length === 0 && this._allTerminal()) {
          resolve({ success: failed.length === 0, results, failed });
        }
      };
      trySchedule();
    });
  }

  _allTerminal() {
    for (const [, node] of this.nodes) {
      if (node.status !== 'completed' && node.status !== 'failed' && node.status !== 'skipped') return false;
    }
    return true;
  }

  _skipDependents(nodeId, reason) {
    for (const [, node] of this.nodes) {
      if (node.dependencies.includes(nodeId) && node.status === 'pending') {
        node.status = 'skipped'; node.skipReason = reason;
        this._skipDependents(node.id, reason);
      }
    }
  }

  getProgress() {
    let completed = 0, running = 0, pending = 0, failed = 0, skipped = 0;
    for (const [, node] of this.nodes) {
      switch (node.status) {
        case 'completed': completed++; break;
        case 'running': running++; break;
        case 'failed': failed++; break;
        case 'skipped': skipped++; break;
        default: pending++; break;
      }
    }
    const total = this.nodes.size;
    return { total, completed, running, pending, failed, skipped, percentComplete: total === 0 ? 100 : Math.round(((completed + skipped) / total) * 100) };
  }

  getExecutionPlan() {
    if (this.nodes.size === 0) return '(empty DAG)';
    const levels = this.getLevels();
    const cp = this.getCriticalPath();
    const cpSet = new Set(cp.path);
    const lines = [`DAG Execution Plan (${this.nodes.size} tasks, ${levels.length} levels, max concurrency: ${this.maxConcurrency})`, `Critical path: ${cp.path.join(' -> ')} (length: ${cp.length})`, ''];

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      lines.push(`Level ${i}${level.length > 1 ? ` [parallel x${level.length}]` : ''}:`);
      for (const id of level) {
        const node = this.nodes.get(id);
        const deps = node.dependencies.length > 0 ? ` (after: ${node.dependencies.join(', ')})` : '';
        lines.push(`  ${id} [${node.agentId}]: ${node.task}${deps}${cpSet.has(id) ? ' *' : ''}`);
      }
    }
    lines.push('', '* = critical path');
    return lines.join('\n');
  }

  skip(nodeId, reason = 'Manually skipped') {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node "${nodeId}" not found`);
    if (node.status === 'running') throw new Error(`Cannot skip running node "${nodeId}"`);
    if (node.status === 'completed') return;
    node.status = 'skipped'; node.skipReason = reason;
    this._skipDependents(nodeId, `Dependency "${nodeId}" was skipped: ${reason}`);
  }

  reset() {
    for (const [, node] of this.nodes) {
      node.status = 'pending'; node.result = null;
      node.startTime = null; node.endTime = null; node.skipReason = null;
    }
  }

  toJSON() {
    return { maxConcurrency: this.maxConcurrency, nodes: [...this.nodes.values()].map(n => n.toJSON()) };
  }

  static fromJSON(json) {
    const dag = new DAGScheduler({ maxConcurrency: json.maxConcurrency || 4 });
    for (const n of json.nodes || []) {
      const node = dag.addNode(n.id, n.agentId, n.task, n.dependencies || [], n.metadata || {});
      node.status = n.status || 'pending';
      node.result = n.result || null;
      node.startTime = n.startTime || null;
      node.endTime = n.endTime || null;
      node.skipReason = n.skipReason || null;
    }
    return dag;
  }
}

// ── Workflow Conversion ─────────────────────────────────────

/**
 * Convert an existing workflow definition to a DAGScheduler.
 * Bridges the 5 fixed patterns to the DAG representation.
 */
export function createDAGFromWorkflow(workflow, allAgents) {
  const dag = new DAGScheduler({ maxConcurrency: workflow.maxConcurrency || 4 });
  const type = workflow.type;

  switch (type) {
    case 'sequential': {
      const agents = workflow.agents || [];
      let prevId = null;
      for (const agentId of agents) {
        dag.addNode(agentId, agentId, `Sequential: ${agentId}`, prevId ? [prevId] : []);
        prevId = agentId;
      }
      break;
    }
    case 'parallel': {
      for (const agentId of (workflow.agents || [])) dag.addNode(agentId, agentId, `Parallel: ${agentId}`, []);
      break;
    }
    case 'fan-out-in': {
      const { stages } = workflow;
      const foAgents = stages?.fanOut?.agents || [];
      for (const a of foAgents) dag.addNode(`fanout-${a}`, a, `Fan-out: ${a}`, []);
      const pAgents = stages?.parallel?.agents || [];
      const foDeps = foAgents.map(a => `fanout-${a}`);
      for (const a of pAgents) dag.addNode(`parallel-${a}`, a, `Worker: ${a}`, foDeps);
      const fiAgents = stages?.fanIn?.agents || [];
      const pDeps = pAgents.map(a => `parallel-${a}`);
      for (const a of fiAgents) dag.addNode(`fanin-${a}`, a, `Fan-in: ${a}`, pDeps);
      break;
    }
    case 'generator-critic': {
      const { stages, maxIterations = 3 } = workflow;
      const genId = stages?.generator?.agents?.[0];
      const critId = stages?.critic?.agents?.[0];
      if (genId && critId) {
        let prevId = null;
        for (let i = 1; i <= maxIterations; i++) {
          dag.addNode(`gen-${i}`, genId, `Generate iteration ${i}`, prevId ? [prevId] : []);
          dag.addNode(`crit-${i}`, critId, `Critique iteration ${i}`, [`gen-${i}`]);
          prevId = `crit-${i}`;
        }
      }
      break;
    }
    case 'pipeline': {
      let prevStageIds = [];
      for (let si = 0; si < (workflow.pipeline || []).length; si++) {
        const stage = workflow.pipeline[si];
        const currentIds = [];
        for (const a of (stage.agents || [])) {
          const nid = `stage${si}-${a}`;
          dag.addNode(nid, a, `Pipeline stage ${si} (${stage.stage || ''}): ${a}`, prevStageIds);
          currentIds.push(nid);
        }
        prevStageIds = currentIds;
      }
      break;
    }
    default: throw new Error(`Unknown workflow type: ${type}`);
  }
  return dag;
}

/** Create a DAGScheduler from a mission config with a `dag` section. */
export function createDAGFromConfig(config) {
  const dagConfig = config.dag || config;
  const dag = new DAGScheduler({ maxConcurrency: dagConfig.maxConcurrency || 4 });
  for (const n of dagConfig.nodes || []) {
    dag.addNode(n.id, n.agent || n.agentId, n.task || '', n.dependsOn || n.dependencies || [], n.metadata || {});
  }
  const v = dag.validate();
  if (!v.valid) throw new Error(`Invalid DAG config: ${v.errors.join('; ')}`);
  return dag;
}

export { DAGNode, DAGScheduler };

export const __test__ = { DAGNode, DAGScheduler, createDAGFromWorkflow, createDAGFromConfig };
