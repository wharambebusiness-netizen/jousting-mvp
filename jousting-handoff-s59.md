# Session 59 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (5038 lines)
node -c orchestrator/workflow-engine.mjs  # Syntax check workflow engine (315 lines)
node orchestrator/project-detect.mjs   # Auto-detect project stack
node orchestrator/quality-gates.mjs --run typescript vitest  # Run quality gates
```

Read these files first:
1. `CLAUDE.md` — project reference, architecture, API, gotchas
2. This handoff — current state and next steps

## Current State

### Codebase
- **Branch**: master, all S59 changes ready to commit
- **Tests**: 908/908 passing across 8 suites
- **Engine**: Pure TypeScript, zero UI imports, portable to Unity C#
- **Stack**: Vite + React + TypeScript
- **Node**: v24.13.1 (upgraded from v20.18.1 this session)

### Balance — ALL ZERO FLAGS
All tiers and all gear variants have zero balance flags (unchanged from S58).

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

### Orchestrator v21 (5038 lines, was 4407; + 315 lines workflow-engine.mjs)

**New in v21 (S59) — Phase 3: Scale:**

1. **Git Worktree Isolation**
   - Each code agent runs in its own git worktree + branch (`agent-{id}-r{round}`)
   - Zero cross-agent file conflicts during parallel execution
   - Worktree lifecycle: `createWorktree()` → agents work → `mergeWorktreeBranch()` → test → `cleanupAllWorktrees()`
   - `gitExec()` helper centralizes git command spawning
   - `smartRevertWorktrees()`: merge-based revert — resets to pre-merge checkpoint, selectively re-merges good agents
   - `parseHandoffMeta()` and `readHandoffContent()` check worktree path before main tree
   - `CONFIG.useWorktrees`: feature flag (default: true, set false for legacy behavior)
   - Coord agents stay in main working tree (no worktree needed)
   - `.gitignore` updated: `orchestrator/.worktrees/`

2. **Dynamic Agent Spawning**
   - Agents request helpers by writing JSON to `orchestrator/spawns/spawn-{id}-{uuid}.json`
   - Spawn protocol: `{ parentId, role, name, task, fileOwnership, model, maxBudgetUsd }`
   - Detected after code agents complete, spawned agents run with their own worktrees
   - Spawn constraints: max 3/round, 1/agent, $2 budget cap, coordination roles blocked
   - Spawn notifications: parent agents see child results in next round prompt
   - Spawned agents are one-shot (run once, merge, retire)
   - Spawn instructions injected into all code agent prompts
   - Processed requests archived to `orchestrator/spawns/archive/`

3. **Composable Workflow Engine** (`workflow-engine.mjs`, 315 lines)
   - 5 workflow patterns: sequential, parallel, fan-out-in, generator-critic, pipeline
   - Mission config `workflow` field: `{ "type": "sequential", "agents": ["a", "b"] }`
   - Backward compatible: absent = legacy round-based model
   - Test boundaries: `stage` (per step) or `workflow` (once at end, default)
   - Reuses existing functions: `runAgent`, `runAgentPool`, `runTests`, `smartRevert`
   - Full worktree integration (workflow engine manages its own worktree lifecycle)
   - Generator-critic supports convergence detection via handoff status

### File Changes Summary
```
orchestrator/orchestrator.mjs     4407 → 5038 lines (+631)
orchestrator/workflow-engine.mjs  NEW (315 lines)
CLAUDE.md                         updated (v20→v21 docs)
.gitignore                        updated (+worktrees, +spawns)
```

## What Was Done in S59

### Phase 3 (Scale) — 3 of 4 items completed

1. **Git worktree isolation** ✅
   - Full lifecycle: create → work → merge → test → cleanup
   - Worktree-aware handoff reading (pre-merge reads from worktree)
   - Smart revert for worktrees (reset to checkpoint, selective re-merge)
   - Smoke-tested worktree create/cleanup on this Windows system

2. **Dynamic agent spawning** ✅
   - Spawn request detection (scans worktrees + main tree)
   - Validation + constraints (budget, roles, per-agent limits)
   - Inline execution between code agent completion and merge
   - Notifications in parent agent prompts

3. **Composable workflow engine** ✅
   - 5 patterns implemented in separate module
   - Clean integration via `executeWorkflow()` + context object
   - Workflow branch in round loop with `missionWorkflow` flag
   - Generator-critic convergence via handoff status parsing

4. **Agent SDK migration** — not started (Phase 3.4, requires SDK evaluation)

### Also Done
- Node.js upgraded: v20.18.1 → v24.13.1 (LTS)
- Pushed 232 commits to origin/master (was behind)

## Backlog (4 pending tasks — unchanged from S58)
```
BL-077 (P2, qa): Manual QA Testing — requires human tester
BL-079 (P1, balance-tuner): Variant-Specific Balance Sweep
BL-080 (P2, qa): Variant Interaction Unit Tests (depends BL-079)
BL-083 (P3, balance-tuner): Legendary/Relic Tier Deep Dive
```

## Potential Next Steps

### Phase 3 Remaining
4. **Agent SDK migration**: Evaluate `@anthropic-ai/claude-agent-sdk` for programmatic control instead of CLI spawning

### Phase 4: Ecosystem
5. **MCP server integration**: GitHub (PRs, issues), Playwright (browser testing), database connectors
6. **Agent Teams**: Enable experimental `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` for true parallel coordination
7. **Cross-session skill learning**: Agents build knowledge bases that persist across missions
8. **Observability**: OpenTelemetry traces, cost analytics dashboard

### Also Available
- Run overnight with new team: `powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1 -Mission "orchestrator\missions\general-dev.json"`
- Generate/refresh project config: `node orchestrator/project-detect.mjs --emit-config .`

### Example Workflow Missions (ready to use)
```json
// Sequential: architect designs, then dev implements, then QA validates
{ "workflow": { "type": "sequential", "agents": ["architect", "engine-dev", "qa"], "testBoundary": "stage" } }

// Generator-critic: balance tuner iterates with QA reviewer
{ "workflow": { "type": "generator-critic", "maxIterations": 5, "stages": { "generator": { "agents": ["balance-tuner"] }, "critic": { "agents": ["qa"] } } } }

// Pipeline: design → implement → test → review
{ "workflow": { "type": "pipeline", "pipeline": [ { "stage": "design", "agents": ["architect"] }, { "stage": "impl", "agents": ["engine-dev", "ui-dev"] }, { "stage": "test", "agents": ["qa"] } ] } }
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
- Param search noise: at N=200, score noise ~ +/-0.84. Use baselineRuns>=3 and ignore deltas < noiseFloor

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
