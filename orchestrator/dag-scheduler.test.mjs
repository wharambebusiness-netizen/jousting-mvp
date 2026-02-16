import { describe, it, expect } from 'vitest';
import { DAGNode, DAGScheduler, createDAGFromWorkflow, createDAGFromConfig } from './dag-scheduler.mjs';

// ── DAGNode ─────────────────────────────────────────────────

describe('DAGNode', () => {
  it('starts in pending status with no times', () => {
    const node = new DAGNode('a', 'agent-a', 'Do stuff');
    expect(node.id).toBe('a');
    expect(node.agentId).toBe('agent-a');
    expect(node.task).toBe('Do stuff');
    expect(node.status).toBe('pending');
    expect(node.dependencies).toEqual([]);
    expect(node.startTime).toBeNull();
    expect(node.endTime).toBeNull();
    expect(node.result).toBeNull();
    expect(node.skipReason).toBeNull();
  });

  it('copies dependencies array (no shared reference)', () => {
    const deps = ['x', 'y'];
    const node = new DAGNode('a', 'agent', 'task', deps);
    deps.push('z');
    expect(node.dependencies).toEqual(['x', 'y']);
  });

  it('copies metadata object (no shared reference)', () => {
    const meta = { foo: 1 };
    const node = new DAGNode('a', 'agent', 'task', [], meta);
    meta.foo = 999;
    expect(node.metadata.foo).toBe(1);
  });

  describe('isReady', () => {
    it('returns true when all dependencies are completed', () => {
      const node = new DAGNode('c', 'agent', 'task', ['a', 'b']);
      expect(node.isReady(new Set(['a', 'b']))).toBe(true);
    });

    it('returns false when some dependencies are not completed', () => {
      const node = new DAGNode('c', 'agent', 'task', ['a', 'b']);
      expect(node.isReady(new Set(['a']))).toBe(false);
    });

    it('returns true for node with no dependencies', () => {
      const node = new DAGNode('a', 'agent', 'task');
      expect(node.isReady(new Set())).toBe(true);
    });

    it('returns false if node is not pending', () => {
      const node = new DAGNode('a', 'agent', 'task');
      node.status = 'running';
      expect(node.isReady(new Set())).toBe(false);
    });
  });

  describe('duration', () => {
    it('returns null when times are not set', () => {
      const node = new DAGNode('a', 'agent', 'task');
      expect(node.duration).toBeNull();
    });

    it('returns elapsed ms when both times are set', () => {
      const node = new DAGNode('a', 'agent', 'task');
      node.startTime = 1000;
      node.endTime = 5000;
      expect(node.duration).toBe(4000);
    });

    it('returns null when only startTime is set', () => {
      const node = new DAGNode('a', 'agent', 'task');
      node.startTime = 1000;
      expect(node.duration).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('serializes all fields', () => {
      const node = new DAGNode('a', 'agent-a', 'Build API', ['dep1'], { tag: 'v1' });
      node.status = 'completed';
      node.result = { ok: true };
      node.startTime = 100;
      node.endTime = 200;
      const json = node.toJSON();
      expect(json).toEqual({
        id: 'a', agentId: 'agent-a', task: 'Build API',
        dependencies: ['dep1'], status: 'completed',
        result: { ok: true }, startTime: 100, endTime: 200,
        metadata: { tag: 'v1' }, skipReason: null,
      });
    });
  });
});

// ── DAGScheduler — structure ────────────────────────────────

describe('DAGScheduler', () => {
  function buildDiamond() {
    // A → B, A → C, B → D, C → D
    const dag = new DAGScheduler();
    dag.addNode('A', 'a1', 'Design', []);
    dag.addNode('B', 'a2', 'Backend', ['A']);
    dag.addNode('C', 'a3', 'Frontend', ['A']);
    dag.addNode('D', 'a4', 'Integration', ['B', 'C']);
    return dag;
  }

  describe('addNode', () => {
    it('adds a node and returns it', () => {
      const dag = new DAGScheduler();
      const node = dag.addNode('x', 'agent', 'task');
      expect(node).toBeInstanceOf(DAGNode);
      expect(dag.nodes.size).toBe(1);
    });

    it('throws on duplicate ID', () => {
      const dag = new DAGScheduler();
      dag.addNode('x', 'agent', 'task');
      expect(() => dag.addNode('x', 'agent', 'task2')).toThrow('already exists');
    });
  });

  describe('addEdge', () => {
    it('adds a dependency from source to target', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task');
      dag.addNode('b', 'a2', 'task');
      dag.addEdge('a', 'b');
      expect(dag.nodes.get('b').dependencies).toContain('a');
    });

    it('does not duplicate edges', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task');
      dag.addNode('b', 'a2', 'task');
      dag.addEdge('a', 'b');
      dag.addEdge('a', 'b');
      expect(dag.nodes.get('b').dependencies.filter(d => d === 'a')).toHaveLength(1);
    });

    it('throws if source node missing', () => {
      const dag = new DAGScheduler();
      dag.addNode('b', 'a2', 'task');
      expect(() => dag.addEdge('nope', 'b')).toThrow('not found');
    });

    it('throws if target node missing', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task');
      expect(() => dag.addEdge('a', 'nope')).toThrow('not found');
    });
  });

  describe('validate', () => {
    it('valid on empty DAG', () => {
      expect(new DAGScheduler().validate()).toEqual({ valid: true, errors: [] });
    });

    it('valid for acyclic graph', () => {
      const { valid, errors } = buildDiamond().validate();
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('detects missing dependency', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task', ['ghost']);
      const { valid, errors } = dag.validate();
      expect(valid).toBe(false);
      expect(errors[0]).toContain('unknown node');
    });

    it('detects cycle (A→B→A)', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task', ['b']);
      dag.addNode('b', 'a2', 'task', ['a']);
      const { valid, errors } = dag.validate();
      expect(valid).toBe(false);
      expect(errors[0]).toContain('Cycle');
    });

    it('detects longer cycle (A→B→C→A)', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task', ['c']);
      dag.addNode('b', 'a2', 'task', ['a']);
      dag.addNode('c', 'a3', 'task', ['b']);
      const { valid, errors } = dag.validate();
      expect(valid).toBe(false);
      expect(errors[0]).toContain('Cycle');
    });
  });

  describe('topologicalSort', () => {
    it('returns valid ordering for diamond', () => {
      const order = buildDiamond().topologicalSort();
      expect(order).toHaveLength(4);
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
      expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
    });

    it('returns single node for single-node graph', () => {
      const dag = new DAGScheduler();
      dag.addNode('solo', 'a1', 'task');
      expect(dag.topologicalSort()).toEqual(['solo']);
    });

    it('throws on cyclic graph', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task', ['b']);
      dag.addNode('b', 'a2', 'task', ['a']);
      expect(() => dag.topologicalSort()).toThrow('cycles');
    });
  });

  describe('getLevels', () => {
    it('returns empty for empty DAG', () => {
      expect(new DAGScheduler().getLevels()).toEqual([]);
    });

    it('groups diamond into 3 levels', () => {
      const levels = buildDiamond().getLevels();
      expect(levels).toHaveLength(3);
      expect(levels[0]).toEqual(['A']);
      expect(levels[1].sort()).toEqual(['B', 'C']);
      expect(levels[2]).toEqual(['D']);
    });

    it('all independent nodes are level 0', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task');
      dag.addNode('b', 'a2', 'task');
      dag.addNode('c', 'a3', 'task');
      const levels = dag.getLevels();
      expect(levels).toHaveLength(1);
      expect(levels[0].sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('getCriticalPath', () => {
    it('returns empty for empty DAG', () => {
      expect(new DAGScheduler().getCriticalPath()).toEqual({ path: [], length: 0 });
    });

    it('finds longest path through diamond (A→B→D or A→C→D)', () => {
      const { path, length } = buildDiamond().getCriticalPath();
      expect(length).toBe(3);
      expect(path[0]).toBe('A');
      expect(path[2]).toBe('D');
      // Middle should be B or C
      expect(['B', 'C']).toContain(path[1]);
    });

    it('finds the linear chain as critical path', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task');
      dag.addNode('b', 'a2', 'task', ['a']);
      dag.addNode('c', 'a3', 'task', ['b']);
      dag.addNode('d', 'a4', 'task', ['c']);
      const { path, length } = dag.getCriticalPath();
      expect(path).toEqual(['a', 'b', 'c', 'd']);
      expect(length).toBe(4);
    });
  });

  describe('getReadyNodes', () => {
    it('returns root nodes initially', () => {
      const dag = buildDiamond();
      const ready = dag.getReadyNodes();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('A');
    });

    it('returns B and C after A completes', () => {
      const dag = buildDiamond();
      dag.nodes.get('A').status = 'completed';
      const ready = dag.getReadyNodes();
      expect(ready.map(n => n.id).sort()).toEqual(['B', 'C']);
    });

    it('returns D only after both B and C complete', () => {
      const dag = buildDiamond();
      dag.nodes.get('A').status = 'completed';
      dag.nodes.get('B').status = 'completed';
      // C still pending — D should not be ready
      expect(dag.getReadyNodes().map(n => n.id)).toEqual(['C']);
      dag.nodes.get('C').status = 'completed';
      expect(dag.getReadyNodes().map(n => n.id)).toEqual(['D']);
    });
  });

  describe('getProgress', () => {
    it('all pending initially', () => {
      const p = buildDiamond().getProgress();
      expect(p.total).toBe(4);
      expect(p.pending).toBe(4);
      expect(p.completed).toBe(0);
      expect(p.percentComplete).toBe(0);
    });

    it('tracks mixed statuses', () => {
      const dag = buildDiamond();
      dag.nodes.get('A').status = 'completed';
      dag.nodes.get('B').status = 'running';
      dag.nodes.get('C').status = 'failed';
      const p = dag.getProgress();
      expect(p.completed).toBe(1);
      expect(p.running).toBe(1);
      expect(p.failed).toBe(1);
      expect(p.pending).toBe(1);
      expect(p.percentComplete).toBe(25); // 1 completed / 4 total
    });

    it('100% when all completed', () => {
      const dag = buildDiamond();
      for (const [, node] of dag.nodes) node.status = 'completed';
      expect(dag.getProgress().percentComplete).toBe(100);
    });

    it('counts skipped toward completion', () => {
      const dag = buildDiamond();
      dag.nodes.get('A').status = 'completed';
      dag.nodes.get('B').status = 'skipped';
      dag.nodes.get('C').status = 'skipped';
      dag.nodes.get('D').status = 'skipped';
      expect(dag.getProgress().percentComplete).toBe(100);
    });
  });

  describe('skip', () => {
    it('skips node and cascades to dependents', () => {
      const dag = buildDiamond();
      dag.skip('A', 'test skip');
      expect(dag.nodes.get('A').status).toBe('skipped');
      expect(dag.nodes.get('B').status).toBe('skipped');
      expect(dag.nodes.get('C').status).toBe('skipped');
      expect(dag.nodes.get('D').status).toBe('skipped');
    });

    it('throws on unknown node', () => {
      expect(() => new DAGScheduler().skip('nope')).toThrow('not found');
    });

    it('throws on running node', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task');
      dag.nodes.get('a').status = 'running';
      expect(() => dag.skip('a')).toThrow('Cannot skip running');
    });

    it('no-ops on already completed node', () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task');
      dag.nodes.get('a').status = 'completed';
      dag.skip('a');
      expect(dag.nodes.get('a').status).toBe('completed');
    });
  });

  describe('reset', () => {
    it('resets all nodes to pending', () => {
      const dag = buildDiamond();
      dag.nodes.get('A').status = 'completed';
      dag.nodes.get('A').result = { ok: true };
      dag.nodes.get('A').startTime = 100;
      dag.nodes.get('A').endTime = 200;
      dag.nodes.get('B').status = 'failed';
      dag.nodes.get('C').status = 'skipped';
      dag.nodes.get('C').skipReason = 'test';
      dag.reset();
      for (const [, node] of dag.nodes) {
        expect(node.status).toBe('pending');
        expect(node.result).toBeNull();
        expect(node.startTime).toBeNull();
        expect(node.endTime).toBeNull();
        expect(node.skipReason).toBeNull();
      }
    });
  });

  describe('toJSON / fromJSON round-trip', () => {
    it('serializes and deserializes correctly', () => {
      const dag = buildDiamond();
      dag.nodes.get('A').status = 'completed';
      dag.nodes.get('A').result = { files: 2 };
      const json = dag.toJSON();
      const restored = DAGScheduler.fromJSON(json);
      expect(restored.nodes.size).toBe(4);
      expect(restored.maxConcurrency).toBe(dag.maxConcurrency);
      expect(restored.nodes.get('A').status).toBe('completed');
      expect(restored.nodes.get('A').result).toEqual({ files: 2 });
      expect(restored.nodes.get('D').dependencies).toEqual(['B', 'C']);
    });
  });

  describe('execute', () => {
    it('executes all nodes in valid order', async () => {
      const dag = buildDiamond();
      const order = [];
      const result = await dag.execute(async (node) => {
        order.push(node.id);
        return { done: true };
      });
      expect(result.success).toBe(true);
      expect(result.failed).toHaveLength(0);
      expect(result.results.size).toBe(4);
      // A must come before B, C; B and C before D
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
      expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
    });

    it('respects maxConcurrency', async () => {
      const dag = new DAGScheduler({ maxConcurrency: 1 });
      dag.addNode('a', 'a1', 'task');
      dag.addNode('b', 'a2', 'task');
      dag.addNode('c', 'a3', 'task');
      let maxRunning = 0, currentRunning = 0;
      const result = await dag.execute(async () => {
        currentRunning++;
        maxRunning = Math.max(maxRunning, currentRunning);
        await new Promise(r => setTimeout(r, 10));
        currentRunning--;
      });
      expect(result.success).toBe(true);
      expect(maxRunning).toBe(1);
    });

    it('skips dependents on failure', async () => {
      const dag = buildDiamond();
      const result = await dag.execute(async (node) => {
        if (node.id === 'B') throw new Error('B failed');
        return { ok: true };
      });
      expect(result.success).toBe(false);
      expect(result.failed).toContain('B');
      expect(dag.nodes.get('D').status).toBe('skipped');
    });

    it('throws on invalid DAG', async () => {
      const dag = new DAGScheduler();
      dag.addNode('a', 'a1', 'task', ['b']);
      dag.addNode('b', 'a2', 'task', ['a']);
      await expect(dag.execute(async () => {})).rejects.toThrow('Invalid DAG');
    });

    it('succeeds on empty DAG', async () => {
      const result = await new DAGScheduler().execute(async () => {});
      expect(result.success).toBe(true);
      expect(result.results.size).toBe(0);
    });
  });

  describe('getExecutionPlan', () => {
    it('returns "(empty DAG)" for empty scheduler', () => {
      expect(new DAGScheduler().getExecutionPlan()).toBe('(empty DAG)');
    });

    it('includes critical path and level info', () => {
      const plan = buildDiamond().getExecutionPlan();
      expect(plan).toContain('4 tasks');
      expect(plan).toContain('3 levels');
      expect(plan).toContain('Critical path');
      expect(plan).toContain('Level 0');
      expect(plan).toContain('Level 1');
      expect(plan).toContain('* = critical path');
    });
  });
});

// ── createDAGFromWorkflow ───────────────────────────────────

describe('createDAGFromWorkflow', () => {
  it('sequential: creates chain A→B→C', () => {
    const dag = createDAGFromWorkflow({ type: 'sequential', agents: ['a', 'b', 'c'] }, []);
    expect(dag.nodes.size).toBe(3);
    expect(dag.nodes.get('b').dependencies).toEqual(['a']);
    expect(dag.nodes.get('c').dependencies).toEqual(['b']);
    expect(dag.validate().valid).toBe(true);
  });

  it('parallel: all independent', () => {
    const dag = createDAGFromWorkflow({ type: 'parallel', agents: ['a', 'b', 'c'] }, []);
    expect(dag.nodes.size).toBe(3);
    for (const [, node] of dag.nodes) expect(node.dependencies).toEqual([]);
  });

  it('fan-out-in: three stages with correct dependencies', () => {
    const dag = createDAGFromWorkflow({
      type: 'fan-out-in',
      stages: {
        fanOut: { agents: ['setup'] },
        parallel: { agents: ['w1', 'w2'] },
        fanIn: { agents: ['merge'] },
      },
    }, []);
    expect(dag.validate().valid).toBe(true);
    expect(dag.nodes.get('parallel-w1').dependencies).toEqual(['fanout-setup']);
    expect(dag.nodes.get('fanin-merge').dependencies.sort()).toEqual(['parallel-w1', 'parallel-w2']);
  });

  it('generator-critic: alternating gen/crit pairs', () => {
    const dag = createDAGFromWorkflow({
      type: 'generator-critic',
      maxIterations: 2,
      stages: {
        generator: { agents: ['gen'] },
        critic: { agents: ['crit'] },
      },
    }, []);
    expect(dag.nodes.size).toBe(4); // gen-1, crit-1, gen-2, crit-2
    expect(dag.nodes.get('crit-1').dependencies).toEqual(['gen-1']);
    expect(dag.nodes.get('gen-2').dependencies).toEqual(['crit-1']);
    expect(dag.validate().valid).toBe(true);
  });

  it('pipeline: stages depend on previous stage', () => {
    const dag = createDAGFromWorkflow({
      type: 'pipeline',
      pipeline: [
        { stage: 'build', agents: ['builder'] },
        { stage: 'test', agents: ['tester1', 'tester2'] },
        { stage: 'deploy', agents: ['deployer'] },
      ],
    }, []);
    expect(dag.nodes.get('stage1-tester1').dependencies).toEqual(['stage0-builder']);
    expect(dag.nodes.get('stage2-deployer').dependencies.sort()).toEqual(['stage1-tester1', 'stage1-tester2']);
    expect(dag.validate().valid).toBe(true);
  });

  it('throws on unknown workflow type', () => {
    expect(() => createDAGFromWorkflow({ type: 'banana' }, [])).toThrow('Unknown workflow type');
  });
});

// ── createDAGFromConfig ─────────────────────────────────────

describe('createDAGFromConfig', () => {
  it('creates DAG from config nodes', () => {
    const dag = createDAGFromConfig({
      dag: {
        maxConcurrency: 2,
        nodes: [
          { id: 'design', agent: 'architect', task: 'Design API', dependsOn: [] },
          { id: 'impl', agent: 'dev', task: 'Implement', dependsOn: ['design'] },
        ],
      },
    });
    expect(dag.nodes.size).toBe(2);
    expect(dag.maxConcurrency).toBe(2);
    expect(dag.nodes.get('impl').dependencies).toEqual(['design']);
  });

  it('throws on invalid config (missing dependency)', () => {
    expect(() => createDAGFromConfig({
      dag: {
        nodes: [
          { id: 'a', agent: 'x', task: 't', dependsOn: ['ghost'] },
        ],
      },
    })).toThrow('Invalid DAG config');
  });
});
