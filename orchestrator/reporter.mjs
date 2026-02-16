// ============================================================
// Overnight Report Generator — extracted from orchestrator.mjs v22
// Single function: generateOvernightReport()
// ============================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// Module-level dependencies (set via init)
let log, ANALYSIS_DIR, CONFIG, parseHandoffMeta, getTestCommand;
let agentEffectiveness, agentSessions;

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Initialize reporter with orchestrator context.
 * Must be called before generateOvernightReport().
 * Note: AGENTS and missionConfigPath are passed per-call since they can change.
 */
export function initReporter(ctx) {
  log = ctx.log;
  ANALYSIS_DIR = ctx.ANALYSIS_DIR;
  CONFIG = ctx.CONFIG;
  parseHandoffMeta = ctx.parseHandoffMeta;
  getTestCommand = ctx.getTestCommand;
  agentEffectiveness = ctx.agentEffectiveness;
  agentSessions = ctx.agentSessions;
}

/**
 * Generate the overnight orchestrator report.
 * @param {Array} AGENTS - Current agent list (passed per-call, may change between missions)
 * @param {string|null} missionConfigPath - Current mission path (passed per-call)
 * @param {number} globalStart - Start timestamp (Date.now())
 * @param {Array} roundLog - Per-round data
 * @param {string} stopReason - Why the orchestrator stopped
 * @param {Object} finalTests - { passed, count, failCount }
 * @param {Object} escalationCounts - agentId → count
 * @param {Object} costLog - agentId → cost data
 * @param {Array} roundDecisions - Decision log entries
 */
export function generateOvernightReport(AGENTS, missionConfigPath, globalStart, roundLog, stopReason, finalTests, escalationCounts = {}, costLog = {}, roundDecisions = []) {
  const totalMinNum = (Date.now() - globalStart) / 60000;
  const totalMin = totalMinNum.toFixed(1);
  const totalHrs = (totalMinNum / 60).toFixed(1);
  const totalRounds = roundLog.length;
  const startTime = new Date(globalStart).toISOString().replace('T', ' ').slice(0, 19);
  const endTime = timestamp();

  // Collect final agent states
  const agentSummaries = AGENTS.map(agent => {
    const meta = parseHandoffMeta(agent.id);
    const roundsActive = roundLog.filter(r => r.agents.some(a => a.id === agent.id)).length;
    const timeouts = roundLog.flatMap(r => r.agents).filter(a => a.id === agent.id && a.status === 'TIMEOUT').length;
    const errors = roundLog.flatMap(r => r.agents).filter(a => a.id === agent.id && a.status.startsWith('ERROR')).length;
    return { ...agent, meta, roundsActive, timeouts, errors, role: agent.role || 'none' };
  });

  // Collect all files modified across all agents
  const allFiles = [...new Set(agentSummaries.flatMap(a => a.meta.filesModified))].sort();

  // Test trajectory
  const testTrajectory = roundLog
    .filter(r => r.testsPassed !== null)
    .map(r => `Round ${r.round}: ${r.testsPassed ? 'PASS' : 'FAIL'} (${r.testCount} passed${r.testsPassed ? '' : `, ${r.failCount} failed`})`);

  // Read analysis reports if they exist
  const analysisFiles = [];
  try {
    for (const f of readdirSync(ANALYSIS_DIR)) {
      if (f.endsWith('.md') && f.includes('-round-')) {
        const match = f.match(/^(.+)-round-(\d+)\.md$/);
        if (match) {
          analysisFiles.push({ agent: match[1], round: parseInt(match[2]), path: join(ANALYSIS_DIR, f) });
        }
      }
    }
    analysisFiles.sort((a, b) => a.round - b.round);
  } catch (_) {}

  // v6E: Agent efficiency metrics (v6.1: enriched with idle/skipped data from decisions)
  const efficiencyMetrics = agentSummaries.map(a => {
    const totalTime = roundLog.flatMap(r => r.agents)
      .filter(ra => ra.id === a.id)
      .reduce((sum, ra) => sum + ra.elapsed, 0);
    const avgTime = a.roundsActive > 0 ? (totalTime / a.roundsActive / 60).toFixed(1) : '0';
    const successRate = a.roundsActive > 0
      ? Math.round(((a.roundsActive - a.timeouts - a.errors) / a.roundsActive) * 100)
      : 0;
    const filesPerRound = a.roundsActive > 0
      ? (a.meta.filesModified.length / a.roundsActive).toFixed(1)
      : '0';

    // v6.1: Calculate idle/skipped/blocked from decision log
    const agentDecisions = roundDecisions.filter(d => d.agentId === a.id);
    const roundsSkipped = agentDecisions.filter(d => d.decision === 'skipped').length;
    const roundsBlocked = agentDecisions.filter(d => d.decision === 'blocked').length;
    const roundsIdle = roundsSkipped + roundsBlocked;
    const idlePct = totalRounds > 0 ? Math.round((roundsIdle / totalRounds) * 100) : 0;

    return { id: a.id, model: a.model || 'default', avgTime, successRate, filesPerRound, roundsActive: a.roundsActive, totalRounds, roundsSkipped, roundsBlocked, idlePct };
  });

  // Build report
  let report = `# Overnight Orchestrator Report
> Generated: ${endTime}
> Orchestrator: v28

## Summary
- **Started**: ${startTime}
- **Ended**: ${endTime}
- **Total runtime**: ${totalMin} minutes (${totalHrs} hours)
- **Rounds completed**: ${totalRounds}
- **Stop reason**: ${stopReason}
${missionConfigPath ? `- **Mission**: ${missionConfigPath}` : '- **Mission**: default agents'}
- **Final test status**: ${finalTests.passed ? `ALL PASSING (${finalTests.count} tests)` : `FAILING (${finalTests.count} passed, ${finalTests.failCount} failed)`}

## Agent Results

| Agent | Type | Role | Final Status | Rounds Active | Timeouts | Errors | Files Modified |
|-------|------|------|-------------|---------------|----------|--------|----------------|
${agentSummaries.map(a =>
  `| ${a.id} | ${a.type} | ${a.role} | ${a.meta.status} | ${a.roundsActive} | ${a.timeouts} | ${a.errors} | ${a.meta.filesModified.length || 0} |`
).join('\n')}

### Agent Details
${agentSummaries.map(a => {
  let s = `\n#### ${a.name} (${a.id})\n- **Status**: ${a.meta.status}\n- **Rounds active**: ${a.roundsActive}`;
  if (a.meta.filesModified.length) s += `\n- **Files modified**: ${a.meta.filesModified.join(', ')}`;
  if (a.meta.notes) s += `\n- **Notes**: ${a.meta.notes}`;
  if (a.timeouts) s += `\n- **Timeouts**: ${a.timeouts}`;
  if (a.errors) s += `\n- **Errors**: ${a.errors}`;
  if (escalationCounts[a.id]) s += `\n- **Escalations**: ${escalationCounts[a.id]}`;
  if (a.maxModel) s += `\n- **Max model**: ${a.maxModel}`;
  return s;
}).join('\n')}

## Round-by-Round Timeline

| Round | Agents | Test Result | Agent Pool | Tests | Pre-Sim | Post-Sim | Overhead | Total |
|-------|--------|-------------|------------|-------|---------|----------|----------|-------|
${roundLog.map(r => {
  if (r.note) return `| ${r.round} | — | — | — | — | — | — | — | ${r.note} |`;
  const agents = r.agents.map(a => `${a.id}(${a.status}, ${(a.elapsed/60).toFixed(0)}m)`).join(', ');
  const tests = r.testsPassed ? `PASS (${r.testCount})` : `FAIL (${r.testCount}p, ${r.failCount}f)`;
  const t = r.timing || {};
  const fmt = (ms) => ms ? `${(ms/1000).toFixed(0)}s` : '—';
  // v17: "agents" field (unified pool) or legacy "phaseA"+"phaseB" for old round data
  const preSim = t.preSim || 0;
  const postSim = t.postSim || 0;
  const simsCompat = t.sims || 0;
  const agentPoolMs = t.agents || ((t.phaseA || 0) + (t.phaseB || 0)); // v17 or legacy sum
  const total = agentPoolMs + (t.tests || 0) + simsCompat + (t.overhead || 0);
  return `| ${r.round} | ${agents} | ${tests} | ${fmt(agentPoolMs)} | ${fmt(t.tests)} | ${fmt(preSim || simsCompat)} | ${fmt(postSim)} | ${fmt(t.overhead)} | ${fmt(total)} |`;
}).join('\n')}

## All Files Modified
${allFiles.length ? allFiles.map(f => `- ${f}`).join('\n') : '(none)'}

## Test Trajectory
${testTrajectory.length ? testTrajectory.map(t => `- ${t}`).join('\n') : '(no test data)'}

## Round Quality (v14)

| Round | Active | Idle | Util% | Files | OK | Failed |
|-------|--------|------|-------|-------|----|--------|
${roundLog.map(r => {
  if (r.note) return `| ${r.round} | — | — | — | — | — | ${r.note} |`;
  const q = r.quality || {};
  return `| ${r.round} | ${q.agentsActive ?? '—'} | ${q.agentsIdle ?? '—'} | ${q.utilization ?? '—'}% | ${q.filesModified ?? '—'} | ${q.successful ?? '—'} | ${q.failed ?? '—'} |`;
}).join('\n')}

## Agent Effectiveness (v14)

${(() => {
  const ids = Object.keys(agentEffectiveness);
  if (!ids.length) return '> No effectiveness data captured yet.\n';

  const rows = ids.map(id => {
    const e = agentEffectiveness[id];
    const tokensPerFile = e.totalFiles > 0 ? Math.round(e.totalTokens / e.totalFiles) : '—';
    const costPerTask = e.tasksCompleted > 0 ? '$' + (e.totalCost / e.tasksCompleted).toFixed(4) : '—';
    const avgMin = e.rounds > 0 ? (e.totalSeconds / e.rounds / 60).toFixed(1) : '0';
    const successRate = e.rounds > 0 ? Math.round((e.tasksCompleted / e.rounds) * 100) : 0;
    return `| ${id} | ${e.rounds} | ${e.tasksCompleted} | ${e.totalFiles} | ${tokensPerFile} | ${costPerTask} | ${avgMin}m | ${successRate}% |`;
  });

  return `| Agent | Rounds | Tasks Done | Files | Tokens/File | Cost/Task | Avg Time | Prod% |
|-------|--------|------------|-------|-------------|-----------|----------|-------|
${rows.join('\n')}

> **Prod%** = rounds with meaningful file output / total rounds run. **Tokens/File** = total tokens consumed / files modified.
`;
})()}

## Session Continuity (v16)

${(() => {
  const sessionIds = Object.keys(agentSessions);
  if (!sessionIds.length) return '> No session data captured (all agents ran fresh only).\n';

  const totalResumes = sessionIds.reduce((sum, id) => sum + (agentSessions[id]?.resumeCount || 0), 0);
  const totalFresh = sessionIds.reduce((sum, id) => sum + (agentSessions[id]?.freshCount || 0), 0);
  const totalInvalidations = sessionIds.reduce((sum, id) => sum + (agentSessions[id]?.invalidations || 0), 0);
  const resumePct = (totalResumes + totalFresh) > 0
    ? Math.round((totalResumes / (totalResumes + totalFresh)) * 100) : 0;

  const rows = sessionIds.map(id => {
    const s = agentSessions[id];
    return `| ${id} | ${s.freshCount || 1} | ${s.resumeCount || 0} | ${s.invalidations || 0} | ${s.sessionId?.slice(0, 8) ?? '—'}... |`;
  });

  return `- **Resumed sessions**: ${totalResumes} (${resumePct}% of agent-rounds used session continuity)
- **Fresh sessions**: ${totalFresh}
- **Session invalidations**: ${totalInvalidations}

| Agent | Fresh | Resumes | Invalidations | Session ID |
|-------|-------|---------|---------------|------------|
${rows.join('\n')}

> Resumed agents skip role template + shared rules loading and receive a compact delta prompt.
`;
})()}

## Agent Efficiency (v6.1 Metrics)

| Agent | Model | Avg Time | Success | Files/Rnd | Active | Skipped | Blocked | Idle% |
|-------|-------|----------|---------|-----------|--------|---------|---------|-------|
${efficiencyMetrics.map(m =>
  `| ${m.id} | ${m.model} | ${m.avgTime}m | ${m.successRate}% | ${m.filesPerRound} | ${m.roundsActive}/${m.totalRounds} | ${m.roundsSkipped} | ${m.roundsBlocked} | ${m.idlePct}% |`
).join('\n')}

## Backlog Velocity (v8)

| Round | Pending | Completed | Notes |
|-------|---------|-----------|-------|
${roundLog.map(r => {
  if (r.note) return `| ${r.round} | — | — | ${r.note} |`;
  const bl = r.backlog || {};
  return `| ${r.round} | ${bl.pending ?? '—'} | ${bl.completed ?? '—'} | |`;
}).join('\n')}

## Cost Summary

${(() => {
  const agentIds = Object.keys(costLog);
  if (!agentIds.length) return '> No cost data captured. Claude CLI may not have emitted token/cost info to stderr.\n> Once cost data is available, this section will populate automatically.\n';

  // Build per-agent cost rows
  const rows = agentSummaries.map(a => {
    const c = costLog[a.id] || { totalCost: 0, inputTokens: 0, outputTokens: 0, rounds: 0, escalations: 0 };
    const model = a.model || 'default';
    const estCost = c.totalCost > 0 ? `$${c.totalCost.toFixed(4)}` : '—';
    const avgCost = c.rounds > 0 && c.totalCost > 0 ? `$${(c.totalCost / c.rounds).toFixed(4)}` : '—';
    const inputK = c.inputTokens > 0 ? `${(c.inputTokens / 1000).toFixed(1)}k` : '—';
    const outputK = c.outputTokens > 0 ? `${(c.outputTokens / 1000).toFixed(1)}k` : '—';
    return `| ${a.id} | ${model} | ${c.rounds} | ${inputK} | ${outputK} | ${estCost} | ${avgCost} | ${c.escalations} |`;
  });

  // Totals
  const totals = agentSummaries.reduce((acc, a) => {
    const c = costLog[a.id] || { totalCost: 0, inputTokens: 0, outputTokens: 0, rounds: 0, escalations: 0 };
    acc.cost += c.totalCost;
    acc.input += c.inputTokens;
    acc.output += c.outputTokens;
    acc.rounds += c.rounds;
    acc.escalations += c.escalations;
    return acc;
  }, { cost: 0, input: 0, output: 0, rounds: 0, escalations: 0 });

  const totalInputK = totals.input > 0 ? `${(totals.input / 1000).toFixed(1)}k` : '—';
  const totalOutputK = totals.output > 0 ? `${(totals.output / 1000).toFixed(1)}k` : '—';
  const totalCostStr = totals.cost > 0 ? `$${totals.cost.toFixed(4)}` : '—';
  const avgCostStr = totals.rounds > 0 && totals.cost > 0 ? `$${(totals.cost / totals.rounds).toFixed(4)}` : '—';

  // Successful task count for cost-per-task metric
  const successfulRounds = agentSummaries.reduce((sum, a) => sum + a.roundsActive - a.timeouts - a.errors, 0);
  const costPerSuccess = successfulRounds > 0 && totals.cost > 0 ? `$${(totals.cost / successfulRounds).toFixed(4)}` : '—';

  return `| Agent | Model | Rounds | Input Tokens | Output Tokens | Est. Cost | Avg Cost/Round | Escalations |
|-------|-------|--------|-------------|---------------|-----------|----------------|-------------|
${rows.join('\n')}
| **TOTAL** | | **${totals.rounds}** | **${totalInputK}** | **${totalOutputK}** | **${totalCostStr}** | **${avgCostStr}** | **${totals.escalations}** |

- **Cost per successful agent-round**: ${costPerSuccess}
- **Pricing basis**: haiku ($0.25/$1.25 per M in/out), sonnet ($3/$15), opus ($15/$75)
- **Note**: Costs are estimates from token counts if CLI did not report direct cost`;
})()}

## Model Escalation Summary

| Agent | Base Model | Max Model | Final Model | Escalations |
|-------|-----------|-----------|-------------|-------------|
${agentSummaries.map(a => {
  const baseModel = a._originalModel || a.model || 'default';
  const maxModel = a.maxModel || 'none';
  const finalModel = a.model || 'default';
  const escCount = escalationCounts[a.id] || 0;
  return `| ${a.id} | ${baseModel} | ${maxModel} | ${finalModel} | ${escCount} |`;
}).join('\n')}

## Decision Log Summary

${(() => {
  if (!roundDecisions.length) return '(no decisions recorded)\n';

  // Aggregate per-agent stats from decision log
  const agentDecisionStats = {};
  for (const d of roundDecisions) {
    if (!agentDecisionStats[d.agentId]) {
      agentDecisionStats[d.agentId] = { included: 0, skipped: 0, blocked: 0, succeeded: 0, failed: 0 };
    }
    const s = agentDecisionStats[d.agentId];
    if (d.decision === 'included') {
      s.included++;
      if (d.succeeded === true) s.succeeded++;
      else if (d.succeeded === false) s.failed++;
    } else if (d.decision === 'skipped') {
      s.skipped++;
    } else if (d.decision === 'blocked') {
      s.blocked++;
    }
  }

  const rows = Object.entries(agentDecisionStats).map(([id, s]) => {
    const successRate = s.included > 0 ? Math.round((s.succeeded / s.included) * 100) + '%' : '—';
    return `| ${id} | ${s.included} | ${s.skipped} | ${s.blocked} | ${successRate} |`;
  });

  return `| Agent | Included | Skipped | Blocked | Success Rate |
|-------|----------|---------|---------|-------------|
${rows.join('\n')}

> Full decision log: \`orchestrator/logs/round-decisions.json\`
`;
})()}
## Analysis Reports Generated
${analysisFiles.length
  ? analysisFiles.map(a => `- ${a.agent} round ${a.round}: \`${a.path}\``).join('\n')
  : '(none)'}

## How to Review
1. Read each agent's handoff for detailed work log: \`orchestrator/handoffs/<agent>.md\`
2. Read analysis reports: \`orchestrator/analysis/\`
3. Check git log for per-round commits: \`git log --oneline\`
4. To revert to before the run: \`git log --oneline\` and find the pre-orchestrator commit
5. Run tests: \`${getTestCommand()}\`
`;

  writeFileSync(CONFIG.reportFile, report);
  log(`\nOvernight report written to: ${CONFIG.reportFile}`);
}
