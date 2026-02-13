---
name: agent-report
description: Generate a detailed report on all orchestrator agents, their skills, effectiveness, and recommendations
allowed-tools: Read, Glob, Grep, Bash
model: sonnet
context: fork
agent: general-purpose
---

Generate a comprehensive agent capability and effectiveness report.

## Data Collection

1. **Mission Config**: Read all `orchestrator/missions/*.json` — extract agent definitions
2. **Role Templates**: Read all `orchestrator/roles/*.md` — extract role capabilities
3. **Handoffs**: Read all `orchestrator/handoffs/*.md` — extract last status and work history
4. **Overnight Report**: Read `orchestrator/overnight-report.md` — extract per-agent stats
5. **Cost Logs**: Extract cost data from overnight report
6. **Backlog**: Read `orchestrator/backlog.json` — tasks per role

## Report Sections

### Agent Inventory
For each agent:
- ID, role, model tier, budget
- File ownership scope
- Tools available (from allowedTools config)
- MCP servers (if any)
- Custom skills (if any)
- Last round status and effectiveness metrics

### Capability Matrix
| Agent | Code | Test | Review | Design | Research | Deploy | Security |
Show which agents can perform which capabilities based on their role and tools.

### Skill Gaps
Identify capabilities that NO current agent covers:
- Security auditing
- Performance profiling
- Dependency management
- Documentation generation
- CI/CD pipeline management
- Browser/E2E testing
- API design review

### Recommendations
- Which new agent types would fill the biggest gaps?
- Which existing agents are underequipped (need more tools/skills)?
- Which agents are overloaded (too many responsibilities)?
- Model tier recommendations (are any agents on wrong tier?)

### Cost Efficiency
- Cost per task completed (by agent)
- Token usage per file modified (by agent)
- Idle time (rounds where agent did nothing)
- Budget utilization (spent vs allocated)

## Output
Produce a structured markdown report suitable for decision-making about orchestrator expansion.
