# Session 61 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                                        # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs           # Syntax check orchestrator (5213 lines)
node -c orchestrator/workflow-engine.mjs        # Syntax check workflow engine (315 lines)
node -c orchestrator/sdk-adapter.mjs            # Syntax check SDK adapter (288 lines)
node -c orchestrator/observability.mjs          # Syntax check observability (294 lines)
node -c orchestrator/dag-scheduler.mjs          # Syntax check DAG scheduler (418 lines)
node -c orchestrator/project-scaffold.mjs       # Syntax check project scaffold (545 lines)
node -c orchestrator/plugin-system.mjs          # Syntax check plugin system (471 lines)
```

Read these files first:
1. `CLAUDE.md` — project reference, architecture, API, gotchas
2. This handoff — current state and what was done

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

### Orchestrator v22 — Phase 4 Ecosystem COMPLETE

All 5 ecosystem modules written, syntax-checked, and integrated into orchestrator.mjs.

## What Was Done in S61

### Phase 4 (Ecosystem) — COMPLETED (picked up from S60 interruption)

S61 completed the remaining Phase 4 tasks left from S60:

#### NEW in S61 — 2 modules written:

1. **`orchestrator/project-scaffold.mjs`** (545 lines) — Project scaffolding/templating
   - 7 templates: react-vite-ts, node-api-ts, next-ts, python-fastapi, python-flask, static-site, monorepo
   - CLI: `node orchestrator/project-scaffold.mjs --template react-vite-ts --name my-app`
   - `--list` to show all templates, `--dry-run` for preview, `--no-orchestrator` to skip config
   - Programmatic API: `import { scaffold, listTemplates, getTemplate } from './project-scaffold.mjs'`
   - Auto-generates: CLAUDE.md, mission config, project-config.json, backlog.json, .gitignore
   - Each template has appropriate test runner, directory structure, and orchestrator agent team

2. **`orchestrator/plugin-system.mjs`** (471 lines) — Plugin architecture
   - `PluginManager` class: discover(), load(name), loadAll(), unload(name), unloadAll()
   - 6 plugin types: tool, gate, role, workflow, hook, transform
   - Manifest-based discovery from `orchestrator/plugins/` directory
   - Each plugin: `plugin.json` manifest + `index.mjs` entry with activate(context)/deactivate()
   - `PluginContext`: provides pluginConfig, log, events, config to plugins
   - Type-specific accessors: executeHook(), executeGate(), getWorkflows(), getRoles(), getTransforms(), getTools()
   - Introspection: list(), getSummary()

#### COMPLETED in S61 — Integration into orchestrator.mjs:

3. **Integrated all 5 modules** into orchestrator.mjs (+175 lines, 5038 → 5213)
   - **Imports**: sdk-adapter, observability, dag-scheduler, plugin-system all imported
   - **CONFIG flags**: `useSDK`, `enableObservability`, `enablePlugins`, `enableDAG` — all feature-gated
   - **Initialization in main()**:
     - Observability: creates logger+metrics+events (console output disabled to avoid duplication, JSONL file enabled)
     - SDK: checks availability (non-blocking, falls back to CLI)
     - Plugins: discovers from orchestrator/plugins/, loads all found plugins
   - **Observability events wired** throughout:
     - `agent:start` + `agent:complete`/`agent:error` in runAgent() close handler
     - `round:start` + `round:complete` at round boundaries
     - `test:complete` when tests finish
     - Round metrics recorded via `obs.metrics.recordRound()`
     - Agent metrics recorded via `obs.metrics.recordAgentRun()`
     - Test metrics recorded via `obs.metrics.recordTestRun()`
   - **DAG scheduler**: `missionDAG` variable + DAG execution branch in main loop
     - Mission configs with `dag` section parsed via `createDAGFromConfig()`
     - DAG execution takes precedence over workflow engine when both defined
     - DAG transitions handled in `tryTransitionMission()`
   - **Plugin hooks**: `pre-round` and `post-round` hooks executed at round boundaries
   - **Metrics export**: `obs.metrics.exportMetrics()` called at end of run, writes `orchestrator/metrics.json`
   - **Plugin teardown**: `pluginManager.unloadAll()` called at end of run
   - **Version bump**: All version strings updated (header v22, banner v22, report v22)
   - **Features banner**: New features line in startup banner showing active ecosystem features

4. **Updated CLAUDE.md**: Architecture section, Quick Reference, and Orchestrator section all reflect v22

5. **Updated MEMORY.md**: Status, version summary, session results all updated

## Module Summary (v22 — 7544 total lines)

| Module | Lines | Description |
|--------|-------|-------------|
| orchestrator.mjs | 5213 | Main orchestrator (+175 integration lines) |
| workflow-engine.mjs | 315 | 5 composable workflow patterns |
| sdk-adapter.mjs | 288 | Agent SDK adapter with CLI fallback |
| observability.mjs | 294 | Structured logging + metrics + events |
| dag-scheduler.mjs | 418 | DAG task scheduler with bounded concurrency |
| project-scaffold.mjs | 545 | 7 project templates with auto-config |
| plugin-system.mjs | 471 | 6 plugin types, manifest discovery |
| **Total** | **7544** | |

## CONFIG Flags (v22)

| Flag | Default | Description |
|------|---------|-------------|
| `useSDK` | `false` | Use Agent SDK for programmatic execution |
| `enableObservability` | `true` | Structured logging + metrics + events |
| `enablePlugins` | `false` | Discover/load plugins from orchestrator/plugins/ |
| `enableDAG` | `true` | Allow mission configs to define DAG dependency graphs |
| `useWorktrees` | `true` | Git worktree isolation for code agents (v21) |

## Recommended Next Steps

### Option A: Write tests for ecosystem modules
- Unit tests for project-scaffold.mjs (template validation, file generation, CLI parsing)
- Unit tests for plugin-system.mjs (discover, load, hook execution, gate execution)
- Unit tests for dag-scheduler.mjs (cycle detection, execution, progress)
- Unit tests for sdk-adapter.mjs (option mapping, cost extraction)
- Unit tests for observability.mjs (log levels, metrics, event bus)

### Option B: Create sample plugins
- Example hook plugin (e.g., Slack notification on round complete)
- Example gate plugin (e.g., custom code quality check)
- Example workflow plugin (custom workflow pattern)
- Document the plugin API with examples

### Option C: SDK integration testing
- Test SDK adapter with actual @anthropic-ai/claude-agent-sdk
- Verify cost tracking accuracy
- Test session management (resume, invalidation)

### Option D: Different direction
- Balance tuning, game features, UI polish, or anything else the user wants

## Backlog (4 pending tasks — unchanged from S59)
```
BL-077 (P2, qa): Manual QA Testing — requires human tester
BL-079 (P1, balance-tuner): Variant-Specific Balance Sweep
BL-080 (P2, qa): Variant Interaction Unit Tests (depends BL-079)
BL-083 (P3, balance-tuner): Legendary/Relic Tier Deep Dive
```

## File Changes Summary (S61)
```
orchestrator/project-scaffold.mjs    NEW (545 lines)  — 7 project templates
orchestrator/plugin-system.mjs       NEW (471 lines)  — Plugin architecture
orchestrator/orchestrator.mjs        MODIFIED (+175 lines, 5038 → 5213) — v22 integration
CLAUDE.md                            MODIFIED — v22 docs
jousting-handoff-s61.md              NEW — This handoff
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
- **v22 CONFIG flags**: All new features are gated. `enableObservability=true` and `enableDAG=true` by default. `useSDK=false` and `enablePlugins=false` by default.
- **v22 observability console disabled**: `enableConsole: false` in orchestrator to avoid duplicate console output (orchestrator already logs via `log()`)
- **v22 DAG takes precedence**: When both `mission.dag` and `mission.workflow` are defined, DAG executes and workflow is skipped
- **v22 plugin directory**: `orchestrator/plugins/` (doesn't exist yet — created when first plugin is added)
- **v22 metrics file**: `orchestrator/metrics.json` — auto-exported on process exit when observability enabled
- Param search noise: at N=200, score noise ~ +/-0.84. Use baselineRuns>=3 and ignore deltas < noiseFloor

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
- **NOTE**: Subagents in Claude Code cannot use Write/Bash tools (permission denied). Write files from main context, not from Task agents. Use agents only for research/exploration.
