// Agent Pool Module (extracted from orchestrator.mjs in S66)
// Queue-drain pool for concurrent agent execution

// Module-level dependencies (set via init)
let runAgentFn = null;

/**
 * Initialize agent pool with orchestrator context.
 * @param {{ runAgent: Function }} ctx
 */
export function initAgentPool(ctx) {
  runAgentFn = ctx.runAgent;
}

// ============================================================
// Agent Pool (v9 — streaming pipeline, replaces batch concurrency)
// ============================================================
// Queue-drain pool: launches up to maxConcurrency agents. As each finishes,
// fires onAgentComplete callback immediately and launches the next queued agent.
// Results are in completion order (not submission order).
// v15: accepts optional dashboard for live progress updates.
export async function runAgentPool(agents, round, maxConcurrency, onAgentComplete, dashboard, opts = {}) {
  if (!agents.length) return { allDone: Promise.resolve(), groupDone: Promise.resolve(), results: Promise.resolve([]) };
  const limit = (!maxConcurrency || maxConcurrency >= agents.length)
    ? agents.length : maxConcurrency;

  // v18: Group completion tracking — fires when all agents in groupIds have finished
  const groupIds = opts.groupIds;  // Set<string> of agent IDs
  let groupRemaining = groupIds ? agents.filter(a => groupIds.has(a.id)).length : 0;
  let resolveGroup;
  const groupDone = groupIds && groupRemaining > 0
    ? new Promise(r => { resolveGroup = r; })
    : Promise.resolve();

  const results = [];
  const queue = [...agents];
  let active = 0;
  let resolveAll;
  const allDone = new Promise(r => { resolveAll = r; });

  function tryLaunch() {
    while (active < limit && queue.length > 0) {
      const agent = queue.shift();
      active++;
      // v15: Notify dashboard of agent launch
      if (dashboard) dashboard.updateAgent(agent.id, 'running');
      runAgentFn(agent, round).then(result => {
        active--;
        results.push(result);
        // v15: Notify dashboard of agent completion
        if (dashboard) {
          const dStatus = result.timedOut ? 'timeout' : result.code === 0 ? 'done' : 'failed';
          dashboard.updateAgent(result.agentId, dStatus, { elapsed: result.elapsed });
        }
        if (onAgentComplete) onAgentComplete(result);
        // v18: Check group completion
        if (groupIds && groupIds.has(result.agentId)) {
          groupRemaining--;
          if (groupRemaining === 0 && resolveGroup) resolveGroup();
        }
        if (active === 0 && queue.length === 0) resolveAll();
        else tryLaunch();
      }).catch(error => {
        // v28: Prevent unhandled rejection deadlock — synthesize error result
        active--;
        const errorResult = {
          agentId: agent.id,
          code: -1,
          timedOut: false,
          elapsed: 0,
          error: error.message || String(error),
        };
        results.push(errorResult);
        if (dashboard) dashboard.updateAgent(agent.id, 'failed', {});
        if (onAgentComplete) onAgentComplete(errorResult);
        if (groupIds && groupIds.has(agent.id)) {
          groupRemaining--;
          if (groupRemaining === 0 && resolveGroup) resolveGroup();
        }
        if (active === 0 && queue.length === 0) resolveAll();
        else tryLaunch();
      });
    }
    if (active === 0 && queue.length === 0) resolveAll();
  }

  tryLaunch();
  return { allDone, groupDone, results: allDone.then(() => results) };
}
