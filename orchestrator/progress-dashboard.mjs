// Progress Dashboard Module (extracted from orchestrator.mjs in S66)
// Live real-time agent status display with ANSI cursor control

// ============================================================
// Live Progress Dashboard (v15 — real-time agent status)
// ============================================================
// Shows running/queued/done/failed status for each agent with elapsed time.
// Updates in-place using ANSI cursor control. Falls back to simple logging
// when output is not a TTY (e.g., piped to file).
export class ProgressDashboard {
  constructor(agents, phase) {
    this.agents = agents.map(a => ({
      id: a.id, status: 'queued', elapsed: 0, startTime: null, task: null
    }));
    this.phase = phase || 'Agents';
    this.isTTY = process.stdout.isTTY || false;
    this.lineCount = 0;
    this.interval = null;
    this.stopped = false;
  }

  start() {
    if (!this.isTTY || this.agents.length === 0) return;
    this.render();
    // Refresh elapsed times every 5 seconds
    this.interval = setInterval(() => {
      if (!this.stopped) this.render();
    }, 5000);
  }

  updateAgent(agentId, status, extra) {
    const agent = this.agents.find(a => a.id === agentId);
    if (!agent) return;
    agent.status = status;
    if (status === 'running' && !agent.startTime) {
      agent.startTime = Date.now();
    }
    if (extra?.elapsed) agent.elapsed = extra.elapsed;
    if (extra?.task) agent.task = extra.task;
    if (this.isTTY && !this.stopped) this.render();
  }

  render() {
    // Clear previous output
    if (this.lineCount > 0) {
      process.stdout.write(`\x1b[${this.lineCount}A\x1b[J`);
    }
    const lines = [];
    lines.push(`  ┌─ ${this.phase} Dashboard ─────────────────────────────┐`);
    for (const agent of this.agents) {
      const elapsed = agent.status === 'running' && agent.startTime
        ? ((Date.now() - agent.startTime) / 60000).toFixed(1)
        : agent.elapsed ? (agent.elapsed / 60).toFixed(1) : '0.0';
      const icon = agent.status === 'running' ? '▶' :
                   agent.status === 'done' ? '✓' :
                   agent.status === 'failed' ? '✗' :
                   agent.status === 'timeout' ? '⏱' : '·';
      const statusStr = agent.status.toUpperCase().padEnd(7);
      const taskStr = agent.task ? ` [${agent.task}]` : '';
      lines.push(`  │ ${icon} ${agent.id.padEnd(20)} ${statusStr} ${elapsed}min${taskStr}`);
    }
    lines.push(`  └───────────────────────────────────────────────────┘`);
    process.stdout.write(lines.join('\n') + '\n');
    this.lineCount = lines.length;
  }

  stop() {
    this.stopped = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Final render to show completed state
    if (this.isTTY) this.render();
  }
}
