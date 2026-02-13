# Developer Guide

This document covers two independent systems in this repository. If you're working on the game, start with [Part 2](#part-2-jousting-game-engine). If you're setting up automated multi-agent development, start with [Part 1](#part-1-multi-agent-orchestrator).

## Table of Contents

### Part 1: Multi-Agent Orchestrator
- [Why Use the Orchestrator?](#why-use-the-orchestrator)
- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Core Concepts](#core-concepts)
  - [Missions](#missions)
  - [Rounds](#rounds)
  - [Backlog System](#backlog-system)
  - [Agent Roles](#agent-roles)
- [Key Features](#key-features)
  - [Git Worktree Isolation](#git-worktree-isolation)
  - [Smart Revert](#smart-revert)
  - [Model Tiering & Escalation](#model-tiering--escalation)
  - [Session Continuity](#session-continuity)
  - [Dynamic Agent Spawning](#dynamic-agent-spawning)
  - [Incremental Testing](#incremental-testing)
  - [Priority Scheduling & Dynamic Concurrency](#priority-scheduling--dynamic-concurrency)
  - [Experiment Logging](#experiment-logging)
- [Module Reference](#module-reference)
  - [workflow-engine.mjs](#workflow-enginemjs--composable-workflows)
  - [sdk-adapter.mjs](#sdk-adaptermjs--agent-sdk-adapter)
  - [observability.mjs](#observabilitymjs--logging--metrics)
  - [dag-scheduler.mjs](#dag-schedulermjs--dag-task-scheduler)
  - [project-scaffold.mjs](#project-scaffoldmjs--project-templates)
  - [plugin-system.mjs](#plugin-systemmjs--plugin-architecture)
- [CONFIG Reference](#config-reference)
- [Overnight Runner](#overnight-runner)
- [Integration Guide](#integration-guide)

### Part 2: Jousting Game Engine
- [Quick Start (Game)](#quick-start-game)
- [Learning Path](#learning-path)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Game Concepts](#game-concepts)
  - [Game Flow](#game-flow)
  - [6 Archetypes](#6-archetypes)
- [Combat System](#combat-system)
  - [Stat Pipeline](#stat-pipeline)
  - [Soft Cap](#soft-cap)
  - [Fatigue](#fatigue)
  - [Counters](#counters)
  - [Joust Attacks](#joust-attacks-6)
  - [Melee Attacks](#melee-attacks-6)
  - [Speeds](#3-speeds-joust-only)
  - [Shift Mechanic](#shift-mechanic)
  - [Unseat Check](#unseat-check)
  - [Melee Carryover & Outcomes](#melee-carryover)
- [Equipment](#equipment)
  - [12-Slot Gear System](#12-slot-gear-system)
  - [Gear Variants](#gear-variants)
  - [Rarities](#rarities)
- [AI System](#ai-system)
- [Development](#development)
  - [Balance Configuration](#balance-configuration)
  - [Simulation Tools](#simulation-tools)
  - [Test Suite](#test-suite)
  - [Key API Signatures](#key-api-signatures)
  - [Programmatic Usage Example](#programmatic-usage-example)
- [Troubleshooting](#troubleshooting)

---

# Part 1: Multi-Agent Orchestrator

> [Jump to Part 2: Jousting Game Engine](#part-2-jousting-game-engine)

## Why Use the Orchestrator?

The orchestrator coordinates teams of AI agents (Claude) to work on software projects in parallel. You **don't need it** if you're just editing the game code, running tests, or tweaking balance. You **do need it** when you want to run multiple AI agents simultaneously to develop features, tune balance, and validate quality across a codebase — especially overnight unattended runs.

It auto-detects project language/framework, assigns tasks via a dynamic backlog, runs agents in isolated git worktrees, validates results with automated testing, and self-corrects on regressions.

## Quick Start

```bash
# Launch orchestrator with default agents
node orchestrator/orchestrator.mjs

# Launch with a mission config
node orchestrator/orchestrator.mjs orchestrator/missions/general-dev.json

# Auto-detect project and generate config
node orchestrator/project-detect.mjs --emit-config .

# Scaffold a new project with orchestrator pre-configured
node orchestrator/project-scaffold.mjs --template react-vite-ts --name my-app

# List available project templates
node orchestrator/project-scaffold.mjs --list

# Overnight runner (PowerShell restart loop with crash recovery)
powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1
```

## Architecture Overview

```
orchestrator/
  orchestrator.mjs      5,213 lines   Main orchestration engine
  workflow-engine.mjs      315 lines   Composable workflow patterns
  sdk-adapter.mjs          288 lines   Agent SDK adapter (CLI fallback)
  observability.mjs        294 lines   Structured logging + metrics + events
  dag-scheduler.mjs        418 lines   DAG task scheduler
  project-scaffold.mjs     545 lines   Project templates (7 types)
  plugin-system.mjs        471 lines   Plugin architecture (6 types)
  ─────────────────────────────────
  Total                  7,544 lines
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

A mission is a JSON config that defines an agent team, their roles, file ownership, and execution strategy. The orchestrator reads the mission, sets up agents, and runs them in rounds.

```json
{
  "name": "Feature Development",
  "description": "Build a new feature with testing",
  "config": {
    "maxRounds": 15,
    "agentTimeoutMs": 1500000,
    "maxConcurrency": 3
  },
  "agents": [
    {
      "id": "main-dev",
      "name": "Main Developer",
      "type": "feature",
      "role": "engine-dev",
      "fileOwnership": ["src/engine/**"],
      "model": "sonnet",
      "maxModel": "opus",
      "maxBudgetUsd": 5.0
    },
    {
      "id": "qa",
      "name": "QA Validator",
      "type": "continuous",
      "role": "qa-engineer",
      "fileOwnership": "auto",
      "model": "haiku",
      "minFrequencyRounds": 2
    }
  ]
}
```

**Agent types:**
- `feature` — Works until task is done, then retires
- `continuous` — Never retires; runs periodically (e.g. QA, producer)
- `spawned` — One-shot helper, created dynamically by another agent

### Rounds

Each round follows this lifecycle:

```
Round N
 1. Pre-sims (background, optional — balance simulation baseline)
 2. Launch agents (unified pool, up to maxConcurrency)
    ├── Code agents run in isolated git worktrees
    └── Coordination agents run in main tree
 3. Code agents finish → merge worktree branches
 4. Run tests (incremental or full suite)
    ├── Pass → accept results, proceed
    └── Fail → smart revert (per-agent or full)
 5. Post-sims (background, optional — compare to pre-sim)
 6. Process coordination agent results
 7. Update backlog, experiment log, balance state
 8. Check convergence / all-done condition
    ├── Converged → exit code 42 (overnight runner stops gracefully)
    ├── Mission sequence → transition to next mission
    └── Otherwise → next round
```

### Backlog System

The orchestrator uses a producer-consumer task queue:

- A **producer** agent generates 3-5 tasks per round based on project state
- Tasks have `{ id, role, priority, status, title, description }`
- Other agents pull tasks matching their role
- Tasks sorted by priority (P1 first)
- Status flow: `pending` → `assigned` → `completed`
- Subtask support: large tasks break into focused sub-units

```json
{
  "id": "BL-077",
  "role": "qa-engineer",
  "priority": 2,
  "status": "pending",
  "title": "Add edge case tests for softCap",
  "description": "...",
  "subtasks": [
    { "id": "BL-077-1", "title": "Design test cases", "status": "pending" },
    { "id": "BL-077-2", "title": "Implement tests", "status": "pending" }
  ]
}
```

### Agent Roles

15 role templates live in `orchestrator/roles/*.md`. Each is a structured brief injected into the agent's prompt.

| Role | Focus | Typical Type |
|------|-------|-------------|
| engine-dev | Core engine code changes | feature |
| ui-dev | React/UI components | feature |
| qa-engineer | Testing strategy and coverage | continuous |
| balance-analyst | Balance tuning and parameter search | feature |
| game-designer | Archetype concepts, fun factor | feature |
| producer | Scheduling, planning, task generation | continuous |
| tech-lead | Architecture decisions | continuous |
| css-artist | UI polish and styling | feature |
| architect | System design and scalability | feature |
| security-auditor | Security vulnerabilities | feature |
| performance-analyst | Profiling and optimization | feature |
| research-agent | Deep investigation and experiments | feature |
| devops | Deployment and infrastructure | feature |
| test-generator | Generate new test cases | feature |
| _common-rules | Shared rules injected into all agents | — |

## Key Features

### Git Worktree Isolation

Each code agent runs in its own git worktree on a dedicated branch (`agent-{id}-r{round}`). This prevents file conflicts when agents work in parallel. After agents complete, branches are merged back to main before testing.

```
Per code agent:
  git worktree add .worktrees/{id} -b agent-{id}-r{round}
  → agent works in isolation
  → git merge agent-{id}-r{round} --no-edit
  → cleanup worktree + branch
```

Coordination agents (producer, tech-lead, etc.) stay in the main tree since they don't modify code files.

**Config flag:** `CONFIG.useWorktrees` (default: `true`)

### Smart Revert

When tests regress after agent work, the orchestrator doesn't blindly revert everything. It identifies the culprit:

**Worktree revert (preferred):** Reset to pre-merge checkpoint, then selectively re-merge each agent's branch. Test after each merge to find which agent broke things. Keep all non-breaking work.

**Per-agent revert (fallback):** Revert only the specific files modified by the failing agent, identified from handoff metadata.

**Full revert (last resort):** Revert all `src/` files to round start tag.

### Model Tiering & Escalation

Agents have configurable AI models with automatic escalation:

- Each agent has a `model` (starting tier) and `maxModel` (ceiling)
- **Escalation chain:** haiku → sonnet → opus
- **Trigger:** 2+ consecutive failed rounds
- **De-escalation:** After 2 consecutive successes on escalated model, drop back down
- **Budget enforcement:** Agents exceeding `maxBudgetUsd` are skipped

### Session Continuity

Agents reuse Claude CLI sessions across rounds to avoid re-reading the entire project context:

- Round 1: Generate session ID, launch with `--session-id {id}`
- Round 2+: Launch with `--resume {id}`, provide compact **delta prompt** (only changes since last round)
- Delta prompts skip the role template and CLAUDE.md (agent already has them)

**Session invalidation triggers:**
- After revert (code changed unexpectedly)
- After merge conflict
- Very short failure (< 30s, likely corruption)
- Mission transition
- 5+ empty rounds (context drift)
- 10+ round session age

### Dynamic Agent Spawning

Agents can request specialized helpers at runtime by writing spawn request files:

```json
{
  "parentId": "engine-dev",
  "role": "test-generator",
  "name": "Edge Case Test Writer",
  "task": "Generate tests for new softCap logic",
  "fileOwnership": ["tests/calculator.test.ts"],
  "model": "haiku",
  "maxBudgetUsd": 0.5
}
```

**Constraints:** Max 3 spawns/round, 1 per parent agent, $2 budget cap, coordination roles blocked.

### Incremental Testing

After round 1, the orchestrator only runs affected test suites based on which files agents modified:

```
files_modified (from handoffs) → source-to-test mapping → run only affected suites
```

Full suite triggers: round 1, after revert, changes to `types.ts` or `index.ts`.

### Priority Scheduling & Dynamic Concurrency

- Tasks are prioritized (P1-P3). P1 tasks get a fast-path: the orchestrator can interrupt lower-priority work to assign P1 tasks immediately.
- If the slowest agent takes 3x longer than the fastest, the orchestrator bumps concurrency to keep the pipeline saturated.

### Experiment Logging

When agents modify balance config values, the orchestrator auto-detects parameter changes via git diff and records them with outcomes:

```json
{
  "round": 5,
  "agentId": "balance-analyst",
  "params": [{ "key": "softCapK", "from": 50, "to": 55 }],
  "outcome": {
    "tierSpreads": { "bare": 7.2, "epic": 4.1, "giga": 3.6 },
    "verdict": "IMPROVED"
  }
}
```

Past experiments are injected into balance-analyst prompts to prevent re-trying failed approaches.

## Module Reference

### workflow-engine.mjs — Composable Workflows

Replaces fixed round-based execution with declarative workflow patterns. Defined in the mission config's `workflow` field.

**5 Patterns:**

| Pattern | Description |
|---------|-------------|
| `sequential` | Run agents one after another |
| `parallel` | Run all agents concurrently |
| `fan-out-in` | Fan out to N workers, collect results |
| `generator-critic` | Agent generates work, critic reviews, iterate |
| `pipeline` | Chain agents, output of one feeds next |

```json
{
  "workflow": {
    "type": "sequential",
    "agents": ["design", "implement", "test"],
    "testBoundary": "stage"
  }
}
```

**Test boundaries:** `stage` (test after each step) or `workflow` (test once at end).

### sdk-adapter.mjs — Agent SDK Adapter

Enables programmatic agent execution via `@anthropic-ai/claude-agent-sdk` instead of spawning CLI processes. Falls back to CLI if SDK isn't installed.

```javascript
import { isSDKAvailable, runAgentViaSDK, createAgentOptions } from './sdk-adapter.mjs'

if (await isSDKAvailable()) {
  const result = await runAgentViaSDK(agent, prompt, options)
  // result: { output, cost, sessionId, elapsedMs, success }
}
```

**Config flag:** `CONFIG.useSDK` (default: `false`)

### observability.mjs — Logging & Metrics

Three components for production-grade observability:

**StructuredLogger** — JSONL file logging with named channels:
```javascript
logger.agent('Engine dev started', { agentId: 'engine-dev', round: 5 })
logger.test('Tests passed', { passed: 908, elapsed: 12000 })
logger.workflow('Sequential step complete', { step: 2 })
```

**MetricsCollector** — Aggregate statistics:
```javascript
metrics.recordAgentRun(agentId, { elapsedMs, cost, tokens, success })
metrics.recordTestRun({ elapsedMs, passed, testsRun, testsFailed })
metrics.recordRound({ round, agentsRun, agentsFailed, testsPassed })
metrics.getSummary()           // Overall stats
metrics.exportMetrics(path)    // Write to JSON
```

**EventBus** — Publish/subscribe for system events:
```javascript
events.on('agent:start', (data) => { /* ... */ })
events.on('agent:complete', (data) => { /* ... */ })
events.on('round:start', (data) => { /* ... */ })
events.on('test:complete', (data) => { /* ... */ })
```

**Config flag:** `CONFIG.enableObservability` (default: `true`)

**Outputs:**
- `orchestrator/logs/run-TIMESTAMP.jsonl` — Structured log entries
- `orchestrator/metrics.json` — Exported metrics at process exit

### dag-scheduler.mjs — DAG Task Scheduler

For complex dependency graphs beyond the 5 workflow patterns. Uses Kahn's algorithm for cycle detection and bounded concurrency for execution.

```javascript
const dag = new DAGScheduler({ maxConcurrency: 3 })

dag.addNode('design', 'architect', 'Design API', [])
dag.addNode('backend', 'engine-dev', 'Build API', ['design'])
dag.addNode('frontend', 'ui-dev', 'Build UI', ['design'])
dag.addNode('tests', 'qa-engineer', 'Integration tests', ['backend', 'frontend'])

const { valid, errors } = dag.validate()       // Cycle detection
const levels = dag.getLevels()                  // [[design], [backend, frontend], [tests]]
const { path, length } = dag.getCriticalPath()  // Longest dependency chain
const plan = dag.getExecutionPlan()             // ASCII visualization

const { success, results, failed } = await dag.execute(async (node) => {
  return runAgent(node.agentId, round)
})
```

**Mission config:**
```json
{
  "dag": {
    "maxConcurrency": 3,
    "nodes": [
      { "id": "design", "agent": "architect", "task": "Design API", "dependsOn": [] },
      { "id": "backend", "agent": "engine-dev", "task": "Build API", "dependsOn": ["design"] },
      { "id": "tests", "agent": "qa", "task": "Test everything", "dependsOn": ["backend"] }
    ]
  }
}
```

**Config flag:** `CONFIG.enableDAG` (default: `true`). DAG takes precedence over workflow when both are defined.

### project-scaffold.mjs — Project Templates

Scaffolds new projects with orchestrator pre-configured.

**7 Templates:**

| Template | Stack |
|----------|-------|
| `react-vite-ts` | React + Vite + TypeScript SPA |
| `node-api-ts` | Express REST API + TypeScript |
| `next-ts` | Full-stack Next.js + TypeScript |
| `python-fastapi` | Async FastAPI service |
| `python-flask` | Flask web application |
| `static-site` | HTML/CSS/JS static website |
| `monorepo` | TypeScript workspace (pnpm) |

```bash
# CLI usage
node orchestrator/project-scaffold.mjs --list
node orchestrator/project-scaffold.mjs --template react-vite-ts --name my-app
node orchestrator/project-scaffold.mjs --template next-ts --name web --dir /projects
node orchestrator/project-scaffold.mjs --template monorepo --name ws --dry-run
```

```javascript
// Programmatic usage
import { scaffold, listTemplates, getTemplate } from './project-scaffold.mjs'

const result = scaffold({
  template: 'react-vite-ts',
  name: 'my-app',
  dir: '.',
  withOrchestrator: true,
  dryRun: false,
})
// result: { projectDir, filesCreated, dirsCreated, template, name }
```

**Generated files:** Source template, `CLAUDE.md`, mission config, `project-config.json`, `backlog.json`, `.gitignore`.

### plugin-system.mjs — Plugin Architecture

Extend orchestrator behavior via plugins discovered from `orchestrator/plugins/`.

**6 Plugin Types:**

| Type | Purpose |
|------|---------|
| `tool` | Custom agent tools |
| `gate` | Quality gates (lint, typecheck, security) |
| `role` | Agent role templates |
| `workflow` | Custom workflow patterns |
| `hook` | Lifecycle hooks (pre-round, post-round, pre-agent, post-agent) |
| `transform` | Input/output transformers |

**Plugin structure on disk:**
```
orchestrator/plugins/my-plugin/
  plugin.json      # Manifest (name, version, type, entry, config)
  index.mjs        # Entry point with activate(context) / deactivate()
```

**Example hook plugin:**
```javascript
// index.mjs
export async function activate(context) {
  return {
    'pre-round': async ({ round }) => {
      context.log(`Starting round ${round}`)
    },
    'post-round': async ({ round, testsPassed }) => {
      context.log(`Round ${round} done, tests: ${testsPassed}`)
    },
  }
}

export async function deactivate() { /* cleanup */ }
```

**PluginManager API:**
```javascript
const pm = new PluginManager({ pluginDir, orchestratorCtx, log })
await pm.discover()              // Scan for plugin.json manifests
await pm.loadAll()               // Import + activate all
await pm.executeHook('pre-round', { round })
await pm.executeGate(context)    // Run all gate plugins
pm.list()                        // All plugins with status
pm.getSummary()                  // Count by type
```

**Config flag:** `CONFIG.enablePlugins` (default: `false`)

## CONFIG Reference

All feature flags with defaults. Override per-mission via the `config` field in mission JSON (see the [Missions](#missions) example above).

| Flag | Default | Description |
|------|---------|-------------|
| `useSDK` | `false` | Use Agent SDK for programmatic execution |
| `enableObservability` | `true` | Structured JSONL logging + metrics + event bus |
| `enablePlugins` | `false` | Discover/load plugins from orchestrator/plugins/ |
| `enableDAG` | `true` | Allow mission configs to define DAG dependency graphs |
| `useWorktrees` | `true` | Git worktree isolation for code agents |
| `maxRounds` | `30` | Maximum rounds before stopping |
| `maxConcurrency` | `0` | Max parallel agents (0 = unlimited) |
| `agentTimeoutMs` | `1200000` | Default agent timeout (20 min) |

## Overnight Runner

`run-overnight.ps1` is a PowerShell script that wraps the orchestrator in a restart loop:

```powershell
powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1 `
  -MaxHours 10 `
  -Mission "orchestrator\missions\overnight.json"
```

- Re-launches orchestrator on crash with exponential backoff
- Detects exit code 42 ("all done") and stops gracefully
- Crash counter prevents infinite restart loops

## Integration Guide

### Using the orchestrator on a new project

1. Scaffold or set up manually:
   ```bash
   node orchestrator/project-scaffold.mjs --template react-vite-ts --name my-project
   ```

2. Or auto-detect an existing project:
   ```bash
   node orchestrator/project-detect.mjs --emit-config .
   ```

3. Write a mission config (`orchestrator/missions/my-mission.json`)

4. Launch:
   ```bash
   node orchestrator/orchestrator.mjs orchestrator/missions/my-mission.json
   ```

5. Monitor:
   - `orchestrator/overnight-report.md` — Final summary report
   - `orchestrator/logs/` — Detailed structured logs
   - `orchestrator/handoffs/` — Agent outputs and state
   - `orchestrator/analysis/` — Per-agent analysis reports
   - `orchestrator/metrics.json` — Aggregate metrics

---

# Part 2: Jousting Game Engine

> [Jump to Part 1: Multi-Agent Orchestrator](#part-1-multi-agent-orchestrator)

A turn-based medieval jousting minigame built as a web demo. The combat engine is **pure TypeScript with zero UI imports**, making it portable to any platform (Unity C#, etc.). The frontend is React + Vite.

## Quick Start (Game)

```bash
# Install and run
npm install
npm run dev           # Dev server with HMR at http://localhost:5173
npm test              # Run all 908 tests

# Build
npm run build         # TypeScript check + Vite build → dist/

# Balance testing
npx tsx src/tools/simulate.ts bare          # Quick balance check
npx tsx src/tools/simulate.ts --summary     # Full tier comparison (bare+epic+giga)
```

## Learning Path

New to the codebase? Read these files in order:

1. `src/engine/types.ts` — understand the data model
2. `src/engine/archetypes.ts` + `attacks.ts` — understand game objects
3. `src/engine/balance-config.ts` — understand all tuning constants
4. `src/engine/calculator.ts` — understand combat math
5. `src/engine/phase-joust.ts` + `phase-melee.ts` — understand resolution flow
6. `src/engine/match.ts` — understand the state machine
7. `src/engine/playtest.test.ts` — see property-based tests in action
8. Run `npx tsx src/tools/simulate.ts bare` — see balance output
9. Run `npm run dev` — play the game
10. Tweak a balance constant, re-run sim, see the impact

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.9 |
| Framework | React 19 |
| Build | Vite 7 |
| Testing | Vitest 4 |
| Package Manager | pnpm 9 |
| Linting | ESLint 9 |

## Project Structure

```
src/
  engine/              Pure TS combat engine (no UI imports)
    types.ts           All interfaces and type definitions
    archetypes.ts      6 playable archetypes with base stats
    attacks.ts         12 attacks (6 joust + 6 melee), 3 speeds
    balance-config.ts  ALL tuning constants (single source of truth)
    calculator.ts      Core math: softCap, fatigue, impact, accuracy, guard, unseat
    phase-joust.ts     Joust pass resolution
    phase-melee.ts     Melee round resolution
    match.ts           State machine: createMatch, submitJoustPass, submitMeleeRound
    gigling-gear.ts    6-slot steed gear system
    player-gear.ts     6-slot player gear system
    gear-variants.ts   36 gear variant definitions (3 per slot)
    gear-utils.ts      Shared gear utilities

  ai/
    basic-ai.ts        AI opponent with difficulty levels, pattern tracking, reasoning

  ui/                  15 React components
    App.tsx            Main app — 10-screen state machine
    SetupScreen.tsx    Archetype selection
    LoadoutScreen.tsx  Gear customization (rarity, variant, stat rolls)
    SpeedSelect.tsx    Joust speed selection
    AttackSelect.tsx   Attack selection (joust + melee)
    RevealScreen.tsx   Simultaneous reveal
    PassResult.tsx     Joust pass result display
    MeleeResult.tsx    Melee round result display
    MatchSummary.tsx   Match winner + statistics
    AIThinkingPanel.tsx  AI reasoning display
    AIEndScreenPanels.tsx  End-game analysis
    CombatLog.tsx      Attack history log
    CounterChart.tsx   Counter table visualization
    helpers.tsx        StatBar and shared UI components
    MeleeTransitionScreen.tsx  Phase transition

  tools/
    simulate.ts        CLI balance simulation tool
    param-search.ts    Automated parameter search framework
```

## Game Concepts

### Game Flow

A match consists of two phases:

```
1. JOUST PHASE (up to 5 passes)
   ├── Both players simultaneously pick: Speed + Attack
   ├── Optional: Shift attack if eligible (costs stamina + initiative)
   ├── Resolve pass: counters → effective stats → accuracy → impact → unseat check
   ├── If unseated → immediate victory (rare, dramatic finish)
   └── After 5 passes → compare cumulative impact scores

2. MELEE PHASE (first to 4 wins)
   ├── Both players simultaneously pick: Melee attack
   ├── Resolve round: effective stats → impact comparison → outcome
   ├── Outcomes: Draw (0 wins), Hit (1 win), Critical Hit (2 wins)
   ├── Joust stats carry over with divisors (momentum/6, control/7, guard/9)
   ├── Joust loser gets unseated boost (+35% impact, +12 stamina recovery)
   └── First to 4 wins takes the melee

Winner = joust victor (unseating or higher score) OR melee victor
```

### 6 Archetypes

Each archetype has 5 base stats that sum to ~290-303 points:

| Archetype | MOM | CTL | GRD | INIT | STA | Total | Identity |
|-----------|-----|-----|-----|------|-----|-------|----------|
| Charger | 75 | 55 | 50 | 55 | 65 | 300 | Raw impact specialist |
| Technician | 64 | 70 | 55 | 59 | 55 | 303 | Precision and control |
| Bulwark | 58 | 52 | 64 | 53 | 62 | 289 | Defensive wall |
| Tactician | 55 | 65 | 50 | 75 | 55 | 300 | Tempo and initiative |
| Breaker | 62 | 60 | 55 | 55 | 62 | 294 | Guard penetration (25%) |
| Duelist | 60 | 60 | 60 | 60 | 60 | 300 | Balanced generalist |

**Stat meanings:**
- **Momentum (MOM)** — Raw striking power. Drives impact score.
- **Control (CTL)** — Precision and technique. Drives accuracy and counter bonuses.
- **Guard (GRD)** — Defensive absorption. Reduces incoming impact, raises unseat threshold.
- **Initiative (INIT)** — Speed and reaction. Determines who acts first, affects accuracy.
- **Stamina (STA)** — Endurance pool. Depleted by speed choices, attacks, and shifts. Low stamina = fatigue penalty.

## Combat System

### Stat Pipeline

Stats flow through this pipeline before combat resolution:

```
Base archetype stats (MOM/CTL/GRD/INIT/STA)
  → applyGiglingLoadout()    Steed gear bonuses + flat rarity bonus to ALL stats
  → applyPlayerLoadout()     Player gear bonuses only (NO rarity bonus)
  → softCap(knee=100, K=55)  Diminishing returns on MOM/CTL/GRD/INIT (NOT stamina)
  → computeEffectiveStats()  Apply speed deltas + attack deltas
  → fatigueFactor()          Multiply by stamina ratio (low stamina = weaker)
  → Combat resolution        Impact, accuracy, guard, unseat check
```

### Soft Cap

Stats above 100 get diminishing returns: `result = knee + excess * K / (K + excess)`. With K=55, a raw stat of 120 becomes ~111. This prevents any single stat from dominating at high gear tiers.

### Fatigue

`fatigueFactor = currentStamina / maxStamina` (clamped 0-1, with ratio 0.8). All effective stats are multiplied by this factor. Guard has a special floor: `guardFF = 0.3 + 0.7 * fatigueFactor`, so guard never drops below 30% even at 0 stamina.

### Counters

Attacks have a rock-paper-scissors counter relationship:

```
     Aggressive
      ↙      ↘
 Balanced ←── Defensive

 Agg beats Def, Def beats Bal, Bal beats Agg
```

- **Named counters:** Port de Lance beats Coup en Passant; Guard High beats Measured Cut (both one-directional — the reverse does NOT apply)
- **Counter bonus:** `4 + winnerCTL * 0.1` — added to winner's accuracy, subtracted from loser's

### Joust Attacks (6)

| Attack | Stance | Key Stat | Description |
|--------|--------|----------|-------------|
| Coup Fort | Aggressive | MOM++ | Maximum force strike |
| Course de Lance | Aggressive | MOM+/CTL+ | Balanced aggression |
| Coup en Passant | Balanced | CTL+ | Finesse strike |
| Bris de Garde | Balanced | CTL+/GRD- | Guard-breaking technique |
| Port de Lance | Defensive | GRD+ | Shield-forward defense |
| Precision Thrust | Defensive | CTL+ | Precise defensive (deltaGuard=0) |

### Melee Attacks (6)

| Attack | Stance | Key Stat | Description |
|--------|--------|----------|-------------|
| Overhand Cleave | Aggressive | MOM++ | Power blow |
| Sweeping Strike | Aggressive | MOM+/CTL+ | Wide arc |
| Measured Cut | Balanced | CTL+ | Controlled strike |
| Shield Bash | Balanced | GRD+/MOM+ | Defensive offense |
| Guard High | Defensive | GRD++ | Full defense |
| Riposte | Defensive | CTL+/GRD+ | Counter-attack |

### 3 Speeds (Joust Only)

| Speed | MOM Delta | INIT Delta | STA Cost | Shift Threshold |
|-------|-----------|------------|----------|-----------------|
| Fast | +20 | +40 | -10 | 70 (CTL) |
| Standard | 0 | 0 | -5 | 55 (CTL) |
| Slow | -10 | -20 | 0 | 40 (CTL) |

### Shift Mechanic

After initial attack selection, a player may **shift** to a different attack if their effective Control meets the speed's shift threshold and they have enough stamina. Shifting costs stamina (5 same-stance, 12 cross-stance) plus an initiative penalty.

### Unseat Check

An unseating ends the joust immediately. The formula:
```
margin = attackerImpact - defenderImpact
threshold = 20 + (defenderGuard / 18) + (defenderStamina / 20)
unseated = margin >= threshold
```

### Melee Carryover

Stats carry from joust to melee with divisors to prevent snowballing:
- Momentum: `/6`, Control: `/7`, Guard: `/9`
- The joust **loser** gets an unseated boost: +35% impact, +12 stamina recovery

### Melee Outcomes

Each melee round compares impact scores:
- **Draw:** Margin < `hitBase + GRD * hitScale` (3 + GRD*0.031)
- **Hit:** Margin >= hit threshold → 1 win
- **Critical Hit:** Margin >= `critBase + GRD * critScale` (15 + GRD*0.154) → 2 wins

First to 4 wins takes the melee.

## Equipment

### 12-Slot Gear System

**Steed Gear (6 Slots):**

| Slot | Primary Stat | Secondary Stat |
|------|-------------|----------------|
| Chamfron | GRD | MOM |
| Barding | GRD | STA |
| Saddle | CTL | INIT |
| Stirrups | INIT | STA |
| Reins | CTL | MOM |
| Horseshoes | MOM | INIT |

**Player Gear (6 Slots):**

| Slot | Primary Stat | Secondary Stat |
|------|-------------|----------------|
| Helm | GRD | INIT |
| Shield | GRD | STA |
| Lance | MOM | CTL |
| Armor | STA | GRD |
| Gauntlets | CTL | INIT |
| Melee Weapon | MOM | STA |

### Gear Variants

Each slot has 3 variants: **aggressive**, **balanced**, **defensive**. Same total stat budget (horizontal power) but different primary/secondary allocation. The balanced variant matches legacy defaults.

### Rarities

6 rarity tiers with increasing flat bonuses to ALL stats (steed gear only):

| Rarity | Bonus | Stat Range |
|--------|-------|------------|
| Uncommon | +2 | Low rolls |
| Rare | +3 | Medium rolls |
| Epic | +5 | Medium-high rolls |
| Legendary | +7 | High rolls |
| Relic | +10 | Very high rolls |
| Giga | +13 | Maximum rolls |

Player gear adds stat bonuses from rolls but does NOT add a flat rarity bonus.

## AI System

The AI opponent (`src/ai/basic-ai.ts`) uses:

- **Archetype personality:** Each archetype has speed preferences, stance biases, shift affinity, and melee aggression modifiers
- **Pattern tracking:** `OpponentHistory` tracks the human player's past choices to predict tendencies
- **3 difficulty levels:** Easy (0.4), Medium (0.7), Hard (0.9) — controls how optimal the AI plays
- **Reasoning output:** `WithReasoning` variants return `{ choice, reasoning }` for UI display

The AI selects speed and attack simultaneously (blind — it doesn't see the player's current choice, only historical patterns).

## Development

### Balance Configuration

All tuning constants live in `src/engine/balance-config.ts` (single source of truth).

**Combat formula parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `softCapKnee` | 100 | Diminishing returns threshold |
| `softCapK` | 55 | Compression rate above knee |
| `guardImpactCoeff` | 0.12 | Guard's effect on reducing impact |
| `guardUnseatDivisor` | 18 | Guard's effect on unseat threshold |
| `guardFatigueFloor` | 0.3 | Minimum guard effectiveness at 0 stamina |
| `counterBaseBonus` | 4 | Base counter advantage |
| `counterCtlScaling` | 0.1 | CTL scaling on counter bonus |

**Archetype-specific parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `breakerGuardPenetration` | 0.25 | Breaker ignores 25% of opponent guard |

**Melee phase parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `unseatedImpactBoost` | 1.35 | Melee boost for joust loser (+35%) |
| `unseatedStaminaRecovery` | 12 | Stamina recovery for joust loser |
| `meleeWinsNeeded` | 4 | Wins required to take melee |
| `criticalWinsValue` | 2 | Wins awarded for critical hit |

#### Current Balance State

All tiers and all gear variants have **zero balance flags**:

| Tier | Spread | Top | Bottom |
|------|--------|-----|--------|
| Bare | 7.0pp | Technician (52.9%) | Charger (45.9%) |
| Epic | 4.1pp | Charger (53.0%) | Duelist (48.9%) |
| Giga | 3.6pp | Breaker (51.6%) | Bulwark (48.0%) |

Balance improves with gear tier — the gear system is working as intended.

To regenerate: `npx tsx src/tools/simulate.ts --summary balanced --matches 1000`

### Simulation Tools

#### simulate.ts — Balance Testing

```bash
npx tsx src/tools/simulate.ts bare                          # Bare tier, balanced variant
npx tsx src/tools/simulate.ts epic aggressive               # Epic tier, aggressive variant
npx tsx src/tools/simulate.ts giga --matches 500            # High-precision run
npx tsx src/tools/simulate.ts --summary balanced            # Multi-tier summary (bare+epic+giga)
npx tsx src/tools/simulate.ts bare --json                   # Structured JSON output
npx tsx src/tools/simulate.ts bare --override softCapK=60   # Test config changes
npx tsx src/tools/simulate.ts bare --override archetype.breaker.stamina=65  # Test stat changes
```

Runs all 36 archetype matchups (6x6), reports win rates, balance flags (dominant >58%, weak <42%), and phase balance.

#### param-search.ts — Automated Parameter Optimization

```bash
npx tsx src/tools/param-search.ts config.json              # Run search
npx tsx src/tools/param-search.ts config.json --dry-run    # Preview plan
npx tsx src/tools/param-search.ts config.json --with-summary  # Multi-tier summary after search
```

**Search strategies:**
- **sweep** — Test all parameter values independently
- **descent** — Iterative: keep best value, move to next parameter

### Test Suite

908 tests across 8 suites. Run with `npm test` or `npx vitest run`.

| Suite | Tests | Coverage |
|-------|-------|----------|
| calculator.test.ts | 202 | Soft cap, fatigue, accuracy, impact, counters, unseat, carryover |
| phase-resolution.test.ts | 66 | Phase transitions, joust/melee edge cases |
| gigling-gear.test.ts | 48 | Steed gear creation, loadout application |
| player-gear.test.ts | 46 | Player gear creation, loadout stacking |
| match.test.ts | 100 | State machine, integration, worked examples |
| playtest.test.ts | 128 | Property-based, stress tests, config validation |
| gear-variants.test.ts | 223 | All 36 variants, archetype x variant matchups, softCap interactions |
| ai.test.ts | 95 | AI validity, reasoning, pattern detection |

### Key API Signatures

```typescript
// Match creation and flow
createMatch(arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?): MatchState
submitJoustPass(state, p1Choice, p2Choice): MatchState
submitMeleeRound(state, p1Attack, p2Attack): MatchState

// Gear creation
createFullLoadout(gigRarity, gearRarity, rng?, variant?): GiglingLoadout
createFullPlayerLoadout(gearRarity, rng?, variant?): PlayerLoadout

// Gear application
applyGiglingLoadout(archetype, loadout?): Archetype    // Adds rarity bonus
applyPlayerLoadout(archetype, loadout?): Archetype      // NO rarity bonus

// Phase resolution
resolveJoustPass(passNum, p1State, p2State, p1Choice, p2Choice): PassResult
resolveMeleeRoundFn(roundNum, p1State, p2State, p1Attack, p2Attack): MeleeRoundResult

// AI
aiPickJoustChoiceWithReasoning(player, lastAtk?, oppAtk?, difficulty?): { choice, reasoning }
aiPickMeleeAttackWithReasoning(player, lastAtk?, difficulty?): { attack, reasoning }

// Combat math
softCap(value): number
fatigueFactor(currentStamina, maxStamina): number
computeEffectiveStats(archetype, speed, attack, currentStamina, ...): EffectiveStats
resolveCounters(attack1, attack2, eff1Ctl?, eff2Ctl?): CounterResult
calcAccuracy(effControl, effInitiative, oppMomentum, counterBonus): number
calcImpactScore(effMomentum, accuracy, oppGuard, guardPenetration?): number
checkUnseat(atkImpact, defImpact, defGuard, defStamina): { unseated, margin, threshold }
```

### Programmatic Usage Example

```typescript
import { ARCHETYPES } from './engine/archetypes';
import { createMatch, submitJoustPass, submitMeleeRound } from './engine/match';
import { createFullLoadout } from './engine/gigling-gear';
import { createFullPlayerLoadout } from './engine/player-gear';
import { JOUST_ATTACKS, MELEE_ATTACKS, SPEEDS } from './engine/attacks';

// 1. Create gear loadouts
const steedP1 = createFullLoadout('epic', 'epic');       // rarity, gear rarity
const steedP2 = createFullLoadout('epic', 'epic');
const playerP1 = createFullPlayerLoadout('epic');
const playerP2 = createFullPlayerLoadout('epic');

// 2. Create match (6 args: arch1, arch2, steed1?, steed2?, player1?, player2?)
let state = createMatch(
  ARCHETYPES.charger, ARCHETYPES.bulwark,
  steedP1, steedP2, playerP1, playerP2
);

// 3. Play joust passes (up to 5)
while (state.phase === 'SpeedSelect' || state.phase === 'AttackSelect') {
  state = submitJoustPass(state, {
    speed: SPEEDS.fast,
    attack: JOUST_ATTACKS.coupFort,
  }, {
    speed: SPEEDS.standard,
    attack: JOUST_ATTACKS.portDeLance,
  });
}

// 4. If match goes to melee, play melee rounds
while (state.phase === 'MeleeSelect') {
  state = submitMeleeRound(state,
    MELEE_ATTACKS.overhandCleave,
    MELEE_ATTACKS.guardHigh,
  );
}

// 5. Read result
console.log(`Winner: Player ${state.winner}`);
console.log(`Reason: ${state.winReason}`);
```

## Troubleshooting

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Calling `resolvePass()` from calculator.ts | Outdated results, may not include breaker/shift logic | Use `resolveJoustPass()` from phase-joust.ts |
| Forgetting `maxStamina` arg in `fatigueFactor()` | Returns `NaN`, all effective stats become `NaN` | Always pass both args: `fatigueFactor(current, max)` |
| Passing player loadout without steed loadout in `createMatch()` | Player loadout silently interpreted as steed loadout (positional args) | Always pass all 6 args, use `undefined` for empty slots |
| Expecting `applyPlayerLoadout()` to add rarity bonus | Stats lower than expected for player gear tier | Rarity bonus is steed-only; player gear adds slot bonuses only |
| Renaming breaker archetype ID | Guard penetration stops working silently | Detection is via `archetype.id === 'breaker'` in phase-joust.ts and phase-melee.ts |
| Assuming Measured Cut beats Guard High | Counter doesn't trigger — Guard High wins that matchup | Counter table is one-directional: Guard High beats Measured Cut, not vice versa |
| Expecting uncommon rarity bonus = 1 | Off-by-one in all stat calculations | Uncommon bonus is 2 (changed in S25) |
| Soft-capping stamina | Unexpected fatigue behavior | Soft cap applies to MOM/CTL/GRD/INIT only, NOT stamina |
| Expecting Precision Thrust to modify guard | Guard unchanged after using it | Precision Thrust has `deltaGuard = 0` (unique among all attacks) |
| Sim numbers don't match docs | Balance data in docs may be stale | Regenerate: `npx tsx src/tools/simulate.ts --summary balanced --matches 1000` |
