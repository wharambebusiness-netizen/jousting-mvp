---
name: orchestrator-status
description: Quick health check of orchestrator state, agent sessions, backlog, and balance metrics
allowed-tools: Read, Glob, Grep, Bash
model: haiku
context: fork
agent: Explore
---

Perform a quick health check of the orchestrator system and report status.

## Steps

1. **Tests**: Run `npx vitest run` and report pass/fail count
2. **Backlog**: Read `orchestrator/backlog.json` — count pending/assigned/completed tasks by priority
3. **Agent Handoffs**: Read all files in `orchestrator/handoffs/*.md` — parse META sections, report each agent's last status
4. **Balance State**: Read `orchestrator/balance-state.json` if it exists — report latest spread per tier
5. **Session Changelog**: Read `orchestrator/session-changelog.md` — summarize recent changes
6. **Overnight Report**: Read `orchestrator/overnight-report.md` if it exists — summarize last run stats
7. **Cost**: Report any cost data from the overnight report

## Output Format

```
ORCHESTRATOR STATUS
==================
Tests:     908/908 passing (or X failing)
Backlog:   N pending (P1: X, P2: Y, P3: Z) | N completed
Agents:    [list each agent's last status from handoffs]
Balance:   bare Xpp | epic Ypp | giga Zpp (N flags)
Last Run:  [summary from overnight report]
```

Keep the output concise — this is a dashboard, not a deep dive.
