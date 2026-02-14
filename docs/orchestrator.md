# Multi-Agent Orchestrator

General-purpose multi-agent orchestrator (v22, 10 modules). Auto-detects language, framework, and test runner. Pluggable quality gates, discoverable role registry, SDK adapter, observability, DAG scheduler, plugin system, project scaffolding.

## Quick Start

```bash
node orchestrator/orchestrator.mjs                              # Default agents
node orchestrator/orchestrator.mjs orchestrator/missions/X.json # With mission config
node orchestrator/project-detect.mjs --emit-config .            # Generate project-config.json
node orchestrator/project-scaffold.mjs --list                   # List project templates
node orchestrator/project-scaffold.mjs --template react-vite-ts --name my-app
powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1
```

## Architecture

```
orchestrator/
  orchestrator.mjs      3,421 lines   Main orchestration engine
  balance-analyzer.mjs    780 lines   Balance sims, experiments, regressions
  git-ops.mjs             310 lines   Git backup, tagging, worktree isolation
  reporter.mjs            280 lines   Overnight report generation
  workflow-engine.mjs     315 lines   Composable workflow patterns
  sdk-adapter.mjs         288 lines   Agent SDK adapter (CLI fallback)
  observability.mjs       294 lines   Structured logging + metrics + events
  dag-scheduler.mjs       418 lines   DAG task scheduler
  project-scaffold.mjs    545 lines   Project templates (7 types)
  plugin-system.mjs       471 lines   Plugin architecture (6 types)
  ─────────────────────────────────
  Total               ~7,122 lines
```

Supporting infrastructure:

```
  project-detect.mjs       Auto-detect language, framework, test runner
  quality-gates.mjs        Pluggable quality gate chain (lint, typecheck, test, security)
  role-registry.mjs        Discoverable role registry from role templates
  project-config.json      Auto-generated project config
  roles/                   15 role templates (agent briefs)
  missions/                Mission configs (agent teams + file ownership)
  backlog.json             Dynamic task queue
  handoffs/                Agent state files
  analysis/                Reports (balance, quality, security, architecture)
  run-overnight.ps1        PowerShell restart loop for long runs
```

## Core Concepts

### Missions

A mission JSON config defines an agent team, their roles, file ownership, and execution strategy.

```json
{
  "name": "Feature Development",
  "config": { "maxRounds": 15, "agentTimeoutMs": 1500000, "maxConcurrency": 3 },
  "agents": [
    {
      "id": "main-dev", "name": "Main Developer", "type": "feature",
      "role": "engine-dev", "fileOwnership": ["src/engine/**"],
      "model": "sonnet", "maxModel": "opus", "maxBudgetUsd": 5.0
    },
    {
      "id": "qa", "name": "QA Validator", "type": "continuous",
      "role": "qa-engineer", "fileOwnership": "auto",
      "model": "haiku", "minFrequencyRounds": 2
    }
  ]
}
```

**Agent types:** `feature` (works until done), `continuous` (never retires), `spawned` (one-shot helper).

### Rounds

```
Round N
 1. Pre-sims (background, optional)
 2. Launch agents (unified pool, up to maxConcurrency)
    ├── Code agents in isolated git worktrees
    └── Coordination agents in main tree
 3. Code agents finish → merge worktree branches
 4. Run tests (incremental or full suite)
    ├── Pass → accept, proceed
    └── Fail → smart revert (per-agent or full)
 5. Post-sims (background, optional)
 6. Process coordination agent results
 7. Update backlog, experiment log, balance state
 8. Check convergence → exit code 42 / next mission / next round
```

### Backlog System

Producer-consumer task queue. Producer agent generates 3-5 tasks/round. Tasks have `{ id, role, priority, status, title, description }`. Sorted by priority (P1 first). Status: `pending` → `assigned` → `completed`. Subtask support for breaking large tasks.

### Agent Roles (15 templates in `orchestrator/roles/`)

| Role | Focus | Type |
|------|-------|------|
| engine-dev | Core engine code | feature |
| ui-dev | React/UI components | feature |
| qa-engineer | Testing & coverage | continuous |
| balance-analyst | Balance tuning | feature |
| game-designer | Archetype concepts | feature |
| producer | Task generation | continuous |
| tech-lead | Architecture decisions | continuous |
| css-artist | UI polish & styling | feature |
| architect | System design | feature |
| security-auditor | Security vulnerabilities | feature |
| performance-analyst | Profiling & optimization | feature |
| research-agent | Deep investigation | feature |
| devops | Deployment & infra | feature |
| test-generator | Generate test cases | feature |
| _common-rules | Shared rules (all agents) | — |

## Key Features

### Git Worktree Isolation
Each code agent runs in its own worktree/branch (`agent-{id}-r{round}`). Prevents file conflicts during parallel execution. Branches merged back before testing. Coord agents stay in main tree. **Config:** `CONFIG.useWorktrees` (default: `true`).

### Smart Revert
On test regression: (1) Worktree revert — reset to pre-merge, selectively re-merge each branch, test after each to find culprit. (2) Per-agent revert — revert only failing agent's files. (3) Full revert — last resort.

### Model Tiering & Escalation
Per-agent `model` + `maxModel`. Escalation chain: haiku → sonnet → opus. Trigger: 2+ consecutive failures. De-escalation after 2 consecutive successes. Budget enforcement via `maxBudgetUsd`.

### Session Continuity
Agents reuse Claude CLI sessions across rounds (`--session-id` / `--resume`). Delta prompts skip role template and CLAUDE.md. Invalidated after: revert, merge conflict, very short failure, mission transition, 5+ empty rounds, 10+ round age.

### Dynamic Agent Spawning
Agents request helpers via `orchestrator/spawns/spawn-{id}-{uuid}.json`. Constraints: max 3/round, 1/parent, $2 budget cap, coordination roles blocked.

### Incremental Testing
After round 1, only affected test suites run (based on files modified → source-to-test mapping). Full suite on: round 1, after revert, changes to `types.ts`/`index.ts`.

### Priority Scheduling
P1 tasks get fast-path. Dynamic concurrency bumps when slowest agent takes 3x longer than fastest.

### Experiment Logging
Auto-detects balance config changes via git diff. Records params, outcomes, and verdict. Injected into balance-analyst prompts to prevent re-trying failed approaches.

## Module Reference

### workflow-engine.mjs — Composable Workflows

5 patterns: `sequential`, `parallel`, `fan-out-in`, `generator-critic`, `pipeline`.

```json
{ "workflow": { "type": "sequential", "agents": ["design", "implement", "test"], "testBoundary": "stage" } }
```

Test boundaries: `stage` (test after each step) or `workflow` (test once at end).

### sdk-adapter.mjs — Agent SDK Adapter

Programmatic execution via `@anthropic-ai/claude-agent-sdk`. CLI fallback when SDK not installed.

```javascript
import { isSDKAvailable, runAgentViaSDK } from './sdk-adapter.mjs'
if (await isSDKAvailable()) {
  const result = await runAgentViaSDK(agent, prompt, options)
  // { output, cost, sessionId, elapsedMs, success }
}
```

**Config:** `CONFIG.useSDK` (default: `false`)

### observability.mjs — Logging & Metrics

- **StructuredLogger** — JSONL logging with channels (agent, test, workflow)
- **MetricsCollector** — Aggregate stats (agent runs, tests, rounds). Auto-exports to `orchestrator/metrics.json`
- **EventBus** — Pub/sub for system events (agent:start/complete/error, round:start/complete, test:complete)

**Config:** `CONFIG.enableObservability` (default: `true`)

### dag-scheduler.mjs — DAG Task Scheduler

Arbitrary dependency graphs. Kahn's algorithm cycle detection, bounded concurrency, critical path analysis.

```javascript
const dag = new DAGScheduler({ maxConcurrency: 3 })
dag.addNode('design', 'architect', 'Design API', [])
dag.addNode('backend', 'engine-dev', 'Build API', ['design'])
dag.addNode('tests', 'qa', 'Test', ['backend'])
await dag.execute(async (node) => runAgent(node.agentId, round))
```

Mission config: define `dag.nodes` array with `{ id, agent, task, dependsOn }`.

**Config:** `CONFIG.enableDAG` (default: `true`). DAG takes precedence over workflow.

### project-scaffold.mjs — Project Templates

7 templates: `react-vite-ts`, `node-api-ts`, `next-ts`, `python-fastapi`, `python-flask`, `static-site`, `monorepo`.

```bash
node orchestrator/project-scaffold.mjs --list
node orchestrator/project-scaffold.mjs --template react-vite-ts --name my-app
```

Generates: source template, CLAUDE.md, mission config, project-config.json, backlog.json, .gitignore.

### plugin-system.mjs — Plugin Architecture

6 types: `tool`, `gate`, `role`, `workflow`, `hook`, `transform`. Manifest-based discovery from `orchestrator/plugins/`. Lifecycle: discover → load → activate → deactivate.

```
orchestrator/plugins/my-plugin/
  plugin.json      # { name, version, type, entry, config }
  index.mjs        # activate(context) / deactivate()
```

**Config:** `CONFIG.enablePlugins` (default: `false`)

## CONFIG Reference

| Flag | Default | Description |
|------|---------|-------------|
| `useSDK` | `false` | Agent SDK for programmatic execution |
| `enableObservability` | `true` | JSONL logging + metrics + event bus |
| `enablePlugins` | `false` | Plugin discovery from orchestrator/plugins/ |
| `enableDAG` | `true` | DAG dependency graphs in mission config |
| `useWorktrees` | `true` | Git worktree isolation for code agents |
| `maxRounds` | `30` | Maximum rounds before stopping |
| `maxConcurrency` | `0` | Max parallel agents (0 = unlimited) |
| `agentTimeoutMs` | `1200000` | Default agent timeout (20 min) |

## Overnight Runner

```powershell
powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1 `
  -MaxHours 10 -Mission "orchestrator\missions\overnight.json"
```

Re-launches on crash with exponential backoff. Exit code 42 = "all done" (stops gracefully).

## Rules for Orchestrated Agents

- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run `npx vitest run` before writing final handoff
- Write META section at top of handoff with status/files-modified/tests-passing/notes
