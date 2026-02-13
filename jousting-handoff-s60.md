# Session 60 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (5038 lines)
node -c orchestrator/workflow-engine.mjs  # Syntax check workflow engine (315 lines)
node -c orchestrator/sdk-adapter.mjs     # Syntax check (NEW in S60)
node -c orchestrator/observability.mjs   # Syntax check (NEW in S60)
node -c orchestrator/dag-scheduler.mjs   # Syntax check (NEW in S60)
```

Read these files first:
1. `CLAUDE.md` — project reference, architecture, API, gotchas
2. This handoff — current state and **interrupted tasks**

## Current State

### Codebase
- **Branch**: master
- **Tests**: 908/908 passing across 8 suites
- **Engine**: Pure TypeScript, zero UI imports, portable to Unity C#
- **Stack**: Vite + React + TypeScript
- **Node**: v24.13.1

### Balance — ALL ZERO FLAGS (unchanged)
All tiers and all gear variants have zero balance flags.

### Current Archetype Stats (unchanged)
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   64   70   55    59   55  = 303
bulwark:      58   52   64    53   62  = 289
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   62  = 294
duelist:      60   60   60    60   60  = 300
```

### Orchestrator — STILL v21, but v22 modules partially created

The orchestrator.mjs itself is **unchanged at 5038 lines (v21)**. Three new standalone modules were created as part of a v22 expansion, but integration was **NOT completed**. Two more modules were planned but **NOT written**.

## What Was Done in S60 (PARTIALLY — session interrupted)

### Phase 4 (Ecosystem) — 3 of 7 tasks completed

S60 was focused on building Phase 4 ecosystem modules as standalone `.mjs` files, then integrating them into orchestrator.mjs. The session was interrupted before completion.

#### COMPLETED — 3 new standalone modules written & syntax-checked:

1. **`orchestrator/sdk-adapter.mjs`** (289 lines) — Agent SDK adapter layer
   - Wraps `@anthropic-ai/claude-agent-sdk` query() for programmatic agent control
   - Graceful fallback to CLI mode when SDK not installed
   - Exports: `isSDKAvailable()`, `runAgentViaSDK()`, `createAgentOptions()`, `extractCostFromMessages()`, `getRunAgent()`, `createHandoffSchema()`, `SDK_MODE`
   - MODEL_MAP: haiku/sonnet/opus → full model IDs
   - Structured handoff output schema (status, filesModified, testsPassing, etc.)
   - Session management (resume/fresh), budget caps, turn limits, timeout with AbortController
   - Cost extraction from SDK message stream with approximate pricing fallback

2. **`orchestrator/observability.mjs`** (295 lines) — Structured logging, metrics, events
   - `StructuredLogger`: leveled (debug/info/warn/error), categorized (agent/test/workflow/spawn/round/revert), dual output (console with ANSI colors + JSONL file), log rotation (max 10 files)
   - `MetricsCollector`: per-agent run tracking, test runs, round stats, workflow stats, `getSummary()`, `exportMetrics()`
   - `EventBus`: on/off/emit with standard events wired to logger (agent:start/complete/error, test:*, round:*, workflow:*, spawn:*, revert:*)
   - Factory: `createObservability({ logDir, logLevel, enableConsole, enableFile, metricsFile })`
   - Dashboard helpers: `formatDashboardData()`, `formatAgentTable()`, `formatDuration()`

3. **`orchestrator/dag-scheduler.mjs`** (419 lines) — DAG task scheduler
   - `DAGNode` class: id, agentId, task, dependencies, status (pending/ready/running/completed/failed/skipped), timing, metadata
   - `DAGScheduler` class: addNode(), addEdge(), validate() (Kahn's algorithm cycle detection), topologicalSort(), getLevels(), getCriticalPath(), getReadyNodes(), execute() (bounded concurrency with Promise scheduling), getProgress(), getExecutionPlan() (ASCII visualization), skip(), reset(), toJSON()/fromJSON()
   - `createDAGFromWorkflow()`: converts all 5 workflow patterns (sequential, parallel, fan-out-in, generator-critic, pipeline) to DAG representation
   - `createDAGFromConfig()`: creates DAG from mission config `{ dag: { nodes: [...], maxConcurrency: N } }`
   - Failed nodes automatically skip all transitive dependents with reason tracking

#### NOT STARTED — 2 modules never written:

4. **`orchestrator/project-scaffold.mjs`** — Project scaffolding/templating
   - Planned: 7 templates (react-vite-ts, node-api-ts, next-ts, python-fastapi, python-flask, static-site, monorepo)
   - Template-based new project creation with auto-configured orchestrator
   - CLI: `node orchestrator/project-scaffold.mjs --template react-vite-ts --name my-app`
   - **File does NOT exist** — needs to be written from scratch

5. **`orchestrator/plugin-system.mjs`** — Plugin architecture
   - Planned: PluginManager class with discover(), load(), loadAll(), unload()
   - 6 plugin types: tool, gate, role, workflow, hook, transform
   - executeHook(), executeGate(), getWorkflow(), getRole(), getTransform()
   - Plugin definition via plugin.json manifest files
   - **File does NOT exist** — needs to be written from scratch

#### NOT STARTED — Integration & docs:

6. **Integrate modules into orchestrator.mjs** — Wire all 5 modules into the main orchestrator
   - Add imports for sdk-adapter, observability, dag-scheduler (and scaffold/plugin when written)
   - Add CONFIG flags: `useSDK`, `observability`, `dagScheduler`, `plugins`
   - Wire SDK adapter into `runAgent()` function (replace CLI spawn when SDK available)
   - Add observability hooks throughout (event emission at agent start/complete/error, round boundaries, test runs)
   - Register DAG scheduler as alternative to workflow engine for complex dependency graphs
   - Add `--scaffold` CLI flag for project creation
   - Load plugins at startup via PluginManager
   - **NOT STARTED** — orchestrator.mjs is still v21, unchanged

7. **Update CLAUDE.md, handoff, memory** — Document v22 changes
   - Update version strings in orchestrator.mjs header (v21 → v22)
   - Add v22 module documentation to CLAUDE.md
   - Update MEMORY.md with new version info
   - **NOT STARTED**

## Important Notes for Next Session

### What EXISTS on disk (new files, syntax-checked, NOT integrated):
```
orchestrator/sdk-adapter.mjs      289 lines  ✓ syntax OK
orchestrator/observability.mjs    295 lines  ✓ syntax OK
orchestrator/dag-scheduler.mjs    419 lines  ✓ syntax OK
```

### What does NOT exist (needs to be written):
```
orchestrator/project-scaffold.mjs   (planned but never created)
orchestrator/plugin-system.mjs      (planned but never created)
```

### What is NOT integrated:
- orchestrator.mjs does NOT import any of the 3 new modules
- orchestrator.mjs is still v21 (5038 lines, unchanged)
- CLAUDE.md does NOT mention these modules
- No CONFIG flags for the new features exist yet

### The 3 written modules are STANDALONE — they work independently:
- `sdk-adapter.mjs` can be imported and used directly (SDK auto-detection + CLI fallback)
- `observability.mjs` can be imported and used directly (logger + metrics + events)
- `dag-scheduler.mjs` can be imported and used directly (DAG validation, execution, visualization)
- None of them modify or depend on orchestrator.mjs

## Recommended Next Steps

### Option A: Complete the v22 expansion (finish what S60 started)
1. Write `project-scaffold.mjs` and `plugin-system.mjs`
2. Integrate all 5 modules into orchestrator.mjs (imports, CONFIG flags, wiring)
3. Update version to v22, update CLAUDE.md and MEMORY.md
4. Syntax-check everything, verify 908 tests still pass

### Option B: Integrate only what exists (ship the 3 completed modules)
1. Skip scaffold and plugin modules for now
2. Integrate sdk-adapter, observability, and dag-scheduler into orchestrator.mjs
3. Update to v22 with just these 3 features
4. Write scaffold and plugin later as Phase 4.2

### Option C: Different direction entirely
- The user may want to focus on something else — ask them

## Backlog (4 pending tasks — unchanged from S59)
```
BL-077 (P2, qa): Manual QA Testing — requires human tester
BL-079 (P1, balance-tuner): Variant-Specific Balance Sweep
BL-080 (P2, qa): Variant Interaction Unit Tests (depends BL-079)
BL-083 (P3, balance-tuner): Legendary/Relic Tier Deep Dive
```

## File Changes Summary (S60)
```
orchestrator/sdk-adapter.mjs      NEW (289 lines) — Agent SDK adapter
orchestrator/observability.mjs    NEW (295 lines) — Structured logging + metrics + events
orchestrator/dag-scheduler.mjs    NEW (419 lines) — DAG task scheduler
jousting-handoff-s60.md           NEW — This handoff
```

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg; Port de Lance beats Coup en Passant; Guard High beats Measured Cut
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg
- `createMatch()` takes 6 args: arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?
- `applyPlayerLoadout` does NOT add rarity bonus (mount-only feature)
- Breaker detection via `archetype.id` in phase-joust.ts and phase-melee.ts
- softCap knee=100, K=55; at Giga rarity only Bulwark GRD crosses knee
- Uncommon rarity bonus = 2 (not 1)
- **v21 worktrees**: Agents write handoffs to their worktree. `parseHandoffMeta` checks worktree first.
- **v21 spawns**: Spawn requests detected from worktrees (pre-merge). Spawned agents get their own worktrees.
- **v21 workflows**: `missionWorkflow` set from `mission.workflow`. When set, skips standard pool entirely.
- **v21 CONFIG.useWorktrees**: Default true. Set false in mission config to disable worktree isolation.
- **S60 new modules are STANDALONE** — not wired into orchestrator.mjs yet. Don't assume they're active.
- Param search noise: at N=200, score noise ~ +/-0.84. Use baselineRuns>=3 and ignore deltas < noiseFloor

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
- **NOTE**: Subagents in Claude Code cannot use Write/Bash tools (permission denied). Write files from main context, not from Task agents. Use agents only for research/exploration.
