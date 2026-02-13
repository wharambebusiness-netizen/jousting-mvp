// ============================================================
// Composable Workflow Engine (v21 — Phase 3: Scale)
// ============================================================
// Declarative workflow patterns for multi-agent orchestration.
// Workflows are defined in mission configs and executed by the
// orchestrator instead of the default round-based model.
//
// Supported patterns:
//   sequential:       A → B → C (serial execution)
//   parallel:         A + B + C (concurrent, barrier at end)
//   fan-out-in:       A → [B1, B2, B3] → C (map-reduce)
//   generator-critic: A → B → loop until convergence or max iterations
//   pipeline:         [stage1] → [stage2] → [stage3] (staged groups)
//
// Usage in mission config:
//   { "workflow": { "type": "sequential", "agents": ["a", "b", "c"] } }
//
// When workflow is absent, the orchestrator uses the legacy round-based model.

/**
 * @typedef {Object} WorkflowDefinition
 * @property {'sequential'|'parallel'|'fan-out-in'|'generator-critic'|'pipeline'} type
 * @property {string[]} [agents] - Agent IDs (for sequential/parallel)
 * @property {Object} [stages] - Stage definitions (for fan-out-in, generator-critic)
 * @property {Array} [pipeline] - Pipeline stage array
 * @property {number} [maxIterations] - Generator-critic max loops
 * @property {'stage'|'workflow'|'none'} [testBoundary] - When to test (default: 'workflow')
 * @property {'stage'|'workflow'} [revertScope] - Revert granularity (default: 'workflow')
 */

/**
 * @typedef {Object} WorkflowContext
 * @property {Function} runAgent - (agent, round) => Promise<result>
 * @property {Function} runAgentPool - (agents, round, concurrency, onComplete, dashboard, opts) => pool
 * @property {Function} runTests - (filter?) => Promise<testResult>
 * @property {Function} processResult - (result, round) => processedResult
 * @property {Function} smartRevert - (round, results) => Promise<revertResult>
 * @property {Function} createWorktree - (agentId, round) => Promise<boolean>
 * @property {Function} mergeWorktree - (agentId) => Promise<mergeResult>
 * @property {Function} log - logging function
 * @property {Array} allAgents - Full agent config array
 * @property {number} round
 * @property {number} maxConcurrency
 * @property {boolean} useWorktrees
 */

/**
 * Execute a workflow definition.
 * @param {WorkflowDefinition} workflow
 * @param {WorkflowContext} ctx
 * @returns {Promise<{success: boolean, results: Array, testResult?: Object}>}
 */
export async function executeWorkflow(workflow, ctx) {
  const type = workflow.type;
  ctx.log(`  Workflow: ${type}`);

  let stageResults;
  switch (type) {
    case 'sequential':
      stageResults = await executeSequential(workflow, ctx);
      break;
    case 'parallel':
      stageResults = await executeParallel(workflow, ctx);
      break;
    case 'fan-out-in':
      stageResults = await executeFanOutIn(workflow, ctx);
      break;
    case 'generator-critic':
      stageResults = await executeGeneratorCritic(workflow, ctx);
      break;
    case 'pipeline':
      stageResults = await executePipeline(workflow, ctx);
      break;
    default:
      ctx.log(`  ⚠ Unknown workflow type: ${type} — skipping`);
      return { success: false, results: [] };
  }

  // Workflow-level test boundary (unless stages already tested)
  const testBoundary = workflow.testBoundary || 'workflow';
  let testResult = null;

  if (testBoundary === 'workflow' && stageResults.results.length > 0) {
    testResult = await ctx.runTests();
    if (!testResult.passed) {
      ctx.log(`  Workflow tests FAILED — reverting`);
      await ctx.smartRevert(ctx.round, stageResults.results);
      return { success: false, results: stageResults.results, testResult, reverted: true };
    }
  }

  return { success: stageResults.success, results: stageResults.results, testResult };
}

/**
 * Sequential: A → B → C
 * Each agent waits for the previous to complete.
 */
async function executeSequential(workflow, ctx) {
  const agentIds = workflow.agents || [];
  const testBoundary = workflow.testBoundary || 'workflow';
  const results = [];

  for (const agentId of agentIds) {
    const agent = ctx.allAgents.find(a => a.id === agentId);
    if (!agent) { ctx.log(`    ⚠ Agent ${agentId} not found — skipping`); continue; }

    if (ctx.useWorktrees) await ctx.createWorktree(agent.id, ctx.round);

    const result = await ctx.runAgent(agent, ctx.round);
    results.push(result);
    ctx.processResult(result, ctx.round);

    // Merge worktree before next agent (so it sees previous agent's changes)
    if (ctx.useWorktrees) {
      await commitWorktree(agent.id, ctx);
      await ctx.mergeWorktree(agent.id);
    }

    // Stage-level test
    if (testBoundary === 'stage') {
      const testResult = await ctx.runTests();
      if (!testResult.passed) {
        ctx.log(`    Sequential stage ${agentId} failed tests — stopping`);
        return { success: false, results, failedAt: agentId };
      }
    }
  }

  return { success: true, results };
}

/**
 * Parallel: A + B + C
 * All agents run concurrently with a barrier at the end.
 */
async function executeParallel(workflow, ctx) {
  const agentIds = workflow.agents || [];
  const agents = agentIds.map(id => ctx.allAgents.find(a => a.id === id)).filter(Boolean);
  const results = [];

  // Create worktrees for all parallel agents
  if (ctx.useWorktrees) {
    for (const agent of agents) await ctx.createWorktree(agent.id, ctx.round);
  }

  // Run all in pool
  const pool = ctx.runAgentPool(agents, ctx.round, ctx.maxConcurrency, (result) => {
    results.push(result);
    ctx.processResult(result, ctx.round);
  });
  await pool.allDone;

  // Merge all worktrees
  if (ctx.useWorktrees) {
    for (const result of results) {
      await commitWorktree(result.agentId, ctx);
      await ctx.mergeWorktree(result.agentId);
    }
  }

  return { success: true, results };
}

/**
 * Fan-out-in: A → [B1, B2, B3] → C
 * Single agent produces work, N agents process in parallel, single agent collects.
 */
async function executeFanOutIn(workflow, ctx) {
  const { stages } = workflow;
  const results = [];

  // Stage 1: Fan-out (single agent)
  if (stages?.fanOut?.agents?.length) {
    const agent = ctx.allAgents.find(a => a.id === stages.fanOut.agents[0]);
    if (agent) {
      if (ctx.useWorktrees) await ctx.createWorktree(agent.id, ctx.round);
      const result = await ctx.runAgent(agent, ctx.round);
      results.push(result);
      ctx.processResult(result, ctx.round);
      if (ctx.useWorktrees) {
        await commitWorktree(agent.id, ctx);
        await ctx.mergeWorktree(agent.id);
      }
    }
  }

  // Stage 2: Parallel workers
  if (stages?.parallel?.agents?.length) {
    const parallelResult = await executeParallel({
      agents: stages.parallel.agents,
      testBoundary: 'none', // Test at workflow level
    }, ctx);
    results.push(...parallelResult.results);
  }

  // Stage 3: Fan-in (collector)
  if (stages?.fanIn?.agents?.length) {
    const agent = ctx.allAgents.find(a => a.id === stages.fanIn.agents[0]);
    if (agent) {
      if (ctx.useWorktrees) await ctx.createWorktree(agent.id, ctx.round);
      const result = await ctx.runAgent(agent, ctx.round);
      results.push(result);
      ctx.processResult(result, ctx.round);
      if (ctx.useWorktrees) {
        await commitWorktree(agent.id, ctx);
        await ctx.mergeWorktree(agent.id);
      }
    }
  }

  return { success: true, results };
}

/**
 * Generator-Critic: A generates, B critiques, loop until convergence.
 */
async function executeGeneratorCritic(workflow, ctx) {
  const { stages, maxIterations = 3 } = workflow;
  const generatorId = stages?.generator?.agents?.[0];
  const criticId = stages?.critic?.agents?.[0];
  const generator = ctx.allAgents.find(a => a.id === generatorId);
  const critic = ctx.allAgents.find(a => a.id === criticId);
  const results = [];

  if (!generator || !critic) {
    ctx.log(`  ⚠ Generator-Critic requires generator and critic agents`);
    return { success: false, results };
  }

  for (let i = 1; i <= maxIterations; i++) {
    ctx.log(`  Iteration ${i}/${maxIterations}`);

    // Generator pass
    if (ctx.useWorktrees) await ctx.createWorktree(generator.id, ctx.round);
    const genResult = await ctx.runAgent(generator, ctx.round);
    results.push(genResult);
    ctx.processResult(genResult, ctx.round);
    if (ctx.useWorktrees) {
      await commitWorktree(generator.id, ctx);
      await ctx.mergeWorktree(generator.id);
    }

    // Test after generator
    const testResult = await ctx.runTests();
    if (!testResult.passed) {
      ctx.log(`    Generator broke tests — stopping iteration`);
      return { success: false, results, iterations: i };
    }

    // Critic pass
    if (ctx.useWorktrees) await ctx.createWorktree(critic.id, ctx.round);
    const critResult = await ctx.runAgent(critic, ctx.round);
    results.push(critResult);
    ctx.processResult(critResult, ctx.round);
    if (ctx.useWorktrees) {
      await commitWorktree(critic.id, ctx);
      await ctx.mergeWorktree(critic.id);
    }

    // Check if critic says "converged" or "all-done"
    const criticHandoff = ctx.parseHandoffMeta?.(critic.id);
    if (criticHandoff?.status === 'all-done' || criticHandoff?.status === 'complete') {
      ctx.log(`  Converged after ${i} iteration(s) (critic status: ${criticHandoff.status})`);
      return { success: true, results, iterations: i, converged: true };
    }
  }

  ctx.log(`  Generator-Critic: max iterations (${maxIterations}) reached`);
  return { success: true, results, iterations: maxIterations, converged: false };
}

/**
 * Pipeline: [stage1] → [stage2] → [stage3]
 * Stages run in sequence, each stage runs its agents in parallel.
 */
async function executePipeline(workflow, ctx) {
  const stages = workflow.pipeline || [];
  const results = [];

  for (const stage of stages) {
    ctx.log(`  Pipeline stage: ${stage.stage || 'unnamed'} (${stage.agents.length} agent(s))`);

    const stageResult = await executeParallel({
      agents: stage.agents,
      testBoundary: 'none', // Test at pipeline level
    }, ctx);
    results.push(...stageResult.results);

    // Stage-level test (if configured)
    if (workflow.testBoundary === 'stage') {
      const testResult = await ctx.runTests();
      if (!testResult.passed) {
        ctx.log(`    Pipeline stage ${stage.stage} failed tests — stopping`);
        return { success: false, results, failedAt: stage.stage };
      }
    }
  }

  return { success: true, results };
}

/**
 * Helper: commit worktree changes before merge.
 */
async function commitWorktree(agentId, ctx) {
  if (!ctx.gitExec) return;
  const wt = ctx.getWorktree?.(agentId);
  if (!wt) return;
  await ctx.gitExec('git add -A', wt.path);
  await ctx.gitExec(
    `git commit -m "workflow agent: ${agentId} round ${ctx.round}" --allow-empty`,
    wt.path,
  );
}
