# Session 62 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                                        # 908 tests, 8 suites, all passing
npm run dev                                     # Dev server at http://localhost:5173
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
2. `DEVELOPER-GUIDE.md` — comprehensive developer documentation (NEW in S62)
3. This handoff — current state and what was done

## Current State

### Codebase
- **Branch**: master
- **Tests**: 908/908 passing across 8 suites
- **Engine**: Pure TypeScript, zero UI imports, portable to Unity C#
- **Stack**: Vite + React + TypeScript

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

### Orchestrator v22 — Phase 4 Ecosystem COMPLETE (from S61)
All 5 ecosystem modules written, syntax-checked, and integrated into orchestrator.mjs.

## What Was Done in S62

### DEVELOPER-GUIDE.md — Comprehensive Developer Documentation (NEW)

Created `DEVELOPER-GUIDE.md` (1090 lines) covering both major systems for a developer audience. Initial draft written, then reviewed by an analysis agent, then revised with all high/medium priority improvements applied.

**Part 1: Multi-Agent Orchestrator** (~615 lines)
- "Why Use the Orchestrator?" introduction (when you need it vs. don't)
- Quick Start commands
- Architecture overview (7 modules, 7,544 lines)
- Core concepts: missions, rounds (with convergence behavior), backlog system
- Agent roles table (15 roles with typical agent type)
- Key features: worktree isolation, smart revert, model escalation, session continuity, dynamic spawning, incremental testing, priority scheduling, experiment logging
- Module reference for all 6 satellite modules with APIs and code examples
- CONFIG reference with cross-reference to mission JSON
- Overnight runner
- Integration guide (scaffold → detect → mission → launch → monitor)

**Part 2: Jousting Game Engine** (~475 lines)
- Quick Start + Learning Path placed first (most important for new devs)
- Tech stack, project structure
- Game concepts: flow diagram, 6 archetypes with stats
- Combat system: stat pipeline, soft cap, fatigue, counters (with ASCII triangle diagram), 12 attacks, 3 speeds, shift mechanic, unseat check, melee carryover/outcomes
- Equipment: 12-slot gear system, variants, rarities
- AI system overview
- Development section: categorized balance config params, simulation tools, test suite, API signatures
- Programmatic usage example (full match from creation to result)
- Troubleshooting table (Mistake / Symptom / Fix format)

**Structure improvements applied from review:**
1. Full clickable Table of Contents at top
2. Navigation headers between parts ("Jump to Part 1/2")
3. Quick Start + Learning Path moved to top of Part 2
4. Part 2 sections grouped under logical parents (Game Concepts, Combat System, Equipment, Development)
5. Version numbers removed from feature headings
6. Counter triangle ASCII diagram added
7. Gotchas expanded into Troubleshooting table with symptoms
8. Programmatic usage example added
9. Balance config parameters categorized by type
10. Balance state regeneration command added
11. Role table enriched with typical agent type
12. CONFIG table cross-references mission example
13. Round lifecycle shows convergence behavior (exit 42, mission transition)
14. Priority scheduling + dynamic concurrency merged to reduce section flatness

## File Changes Summary (S62)
```
DEVELOPER-GUIDE.md              NEW (1090 lines) — Comprehensive developer documentation
jousting-handoff-s62.md         NEW — This handoff
```

No engine, orchestrator, or test changes in S62. Pure documentation session.

## Module Summary (v22 — unchanged from S61)

| Module | Lines | Description |
|--------|-------|-------------|
| orchestrator.mjs | 5213 | Main orchestrator |
| workflow-engine.mjs | 315 | 5 composable workflow patterns |
| sdk-adapter.mjs | 288 | Agent SDK adapter with CLI fallback |
| observability.mjs | 294 | Structured logging + metrics + events |
| dag-scheduler.mjs | 418 | DAG task scheduler with bounded concurrency |
| project-scaffold.mjs | 545 | 7 project templates with auto-config |
| plugin-system.mjs | 471 | 6 plugin types, manifest discovery |
| **Total** | **7544** | |

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

### Option D: Game features / UI polish / balance tuning
- Whatever the user wants

## Backlog (4 pending tasks — unchanged from S59)
```
BL-077 (P2, qa): Manual QA Testing — requires human tester
BL-079 (P1, balance-tuner): Variant-Specific Balance Sweep
BL-080 (P2, qa): Variant Interaction Unit Tests (depends BL-079)
BL-083 (P3, balance-tuner): Legendary/Relic Tier Deep Dive
```

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg; Port de Lance beats Coup en Passant; Guard High beats Measured Cut
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg
- `createMatch()` takes 6 args: arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?
- `applyPlayerLoadout` does NOT add rarity bonus (mount-only feature)
- Breaker detection via `archetype.id === 'breaker'` in phase-joust.ts and phase-melee.ts
- softCap knee=100, K=55; at Giga rarity only Bulwark GRD crosses knee
- Uncommon rarity bonus = 2 (not 1)

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
- **NOTE**: Subagents in Claude Code cannot use Write/Bash tools (permission denied). Write files from main context, not from Task agents. Use agents only for research/exploration.
