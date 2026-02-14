# Session 58 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (4407 lines)
node orchestrator/project-detect.mjs   # Auto-detect project stack
node orchestrator/project-detect.mjs --emit-config .  # Generate project-config.json
node orchestrator/quality-gates.mjs --run typescript vitest  # Run quality gates
```

Read these files first:
1. `CLAUDE.md` — project reference, architecture, API, gotchas
2. This handoff — current state and next steps

## Current State

### Codebase
- **Branch**: master, all S58 changes committed
- **Tests**: 908/908 passing across 8 suites
- **Engine**: Pure TypeScript, zero UI imports, portable to Unity C#
- **Stack**: Vite + React + TypeScript

### Balance — ALL ZERO FLAGS
All tiers and all gear variants have zero balance flags (unchanged from S57).

### Current Archetype Stats (unchanged from S57)
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   64   70   55    59   55  = 303
bulwark:      58   52   64    53   62  = 289
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   62  = 294
duelist:      60   60   60    60   60  = 300
```

### Orchestrator v20 (4407 lines, was 4282)

**New in v20 (S58) — Phase 2: Generalize:**

1. **Project Config Generation** (`project-detect.mjs`, now 800 lines, was 631)
   - `--emit-config` CLI flag generates `orchestrator/project-config.json`
   - Auto-detects: test mapping (source→test files), file ownership patterns, quality gates
   - `generateProjectConfig(detection, dir)` exported for programmatic use
   - `suggestTestMapping()`: scans for colocated tests, matches by name convention
   - `suggestFileOwnership()`: maps 11 roles to file glob patterns
   - Filter flags per test runner: vitest/jest (`--testPathPattern`), pytest (`-k`), cargo (`--test`), go (`-run`)

2. **Config-Driven Test Pipeline** (orchestrator.mjs)
   - `loadProjectConfig()`: loads `project-config.json` at startup, falls back to auto-detection
   - `getTestCommand()`: returns configured test command (fallback: `npx vitest run`)
   - `getSourceToTests()`, `getAiSourcePattern()`, `getFullSuiteTriggers()`: config-driven with legacy jousting fallbacks
   - `getTestFilterFlag()`: returns configured filter flag (default: `--testPathPattern`)
   - All hardcoded `npx vitest run` strings replaced with `getTestCommand()`

3. **Quality Gate Integration in Test Pipeline**
   - `runTests()` now `async` — uses `qualityGateChain.runTests(filterArg)` when available
   - Falls back to direct process spawn when no chain configured
   - Quality gates auto-populated from project detection if not specified in mission config
   - `qualityGateChain` moved to module scope for access from `runTests()`

4. **Dynamic File Ownership**
   - Mission configs can set `"fileOwnership": "auto"` on agents
   - Resolved at load time from `projectConfig.ownershipPatterns[agent.role]`
   - 11 role patterns auto-detected: engine-dev, ui-dev, qa-engineer, architect, security-auditor, producer, tech-lead, test-generator, css-artist, research-agent, devops

5. **Generated Project Config** (`project-config.json`)
   - Auto-generated for this project with: 5 source-to-test mappings, 4 quality gates, 11 ownership roles
   - Includes: language, ecosystem, framework, test runner, filter flag, timeout
   - Can be manually edited for precise control (e.g., adding cross-reference test mappings)

### File Changes Summary
```
orchestrator/orchestrator.mjs    4282 → 4407 lines (+125)
orchestrator/project-detect.mjs   631 →  800 lines (+169)
orchestrator/project-config.json  NEW (128 lines, auto-generated)
CLAUDE.md                         updated (v19→v20 docs)
```

## What Was Done in S58

### Phase 2 (Generalize) — 3 of 4 items completed

1. **Abstract test commands → quality gate chain** ✅
   - Replaced hardcoded `npx vitest run` with `getTestCommand()`
   - Replaced hardcoded `SOURCE_TO_TESTS`, `AI_SOURCE_PATTERN`, `FULL_SUITE_TRIGGERS` with config-driven functions
   - `runTests()` uses quality gate chain when available, legacy spawn as fallback
   - Quality gates auto-populated from project detection at startup

2. **Project config file generation** ✅
   - `--emit-config` flag on project-detect.mjs
   - `generateProjectConfig()` exported for programmatic use
   - Orchestrator loads at startup, falls back to auto-detect + generate

3. **Dynamic file ownership** ✅
   - `"fileOwnership": "auto"` support in mission configs
   - 11 role patterns auto-detected from project structure
   - `suggestFileOwnership()` infers patterns from directory layout

4. **Multi-language testing** — not started (Phase 2.4, deferred)
   - Would need a Python or Rust project to test against

## Backlog (4 pending tasks)
```
BL-077 (P2, qa): Manual QA Testing — requires human tester, not AI-actionable
BL-079 (P1, balance-tuner): Variant-Specific Balance Sweep — run sims for aggressive/defensive variants
BL-080 (P2, qa): Variant Interaction Unit Tests — depends on BL-079
BL-083 (P3, balance-tuner): Legendary/Relic Tier Deep Dive — N=500 ultra-high tier analysis
```

## Potential Next Steps

### Phase 2 Remaining
4. **Multi-language testing**: Test orchestrator on a Python or Rust project to validate generalization

### Phase 3: Scale (Dynamic Agents + Isolation)
5. **Git worktree isolation**: Each code agent in its own branch — biggest scaling win for parallel work
6. **Dynamic agent spawning**: Agents request helpers when tasks are complex (AgentSpawn pattern)
7. **Composable workflow patterns**: Replace fixed round structure with sequential/parallel/fan-out/generator-critic
8. **Agent SDK migration**: Programmatic control via `@anthropic-ai/claude-agent-sdk` instead of CLI spawning

### Phase 4: Ecosystem
9. **MCP server integration**: GitHub (PRs, issues), Playwright (browser testing), database connectors
10. **Agent Teams**: Enable experimental `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` for true parallel coordination
11. **Cross-session skill learning**: Agents build knowledge bases that persist across missions
12. **Observability**: OpenTelemetry traces, cost analytics dashboard

### Also Available
- Run overnight with new team: `powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1 -Mission "orchestrator\missions\general-dev.json"`
- Generate/refresh project config: `node orchestrator/project-detect.mjs --emit-config .`

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg; Port de Lance beats Coup en Passant; Guard High beats Measured Cut
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg
- `createMatch()` takes 6 args: arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?
- `applyPlayerLoadout` does NOT add rarity bonus (mount-only feature)
- Breaker detection via `archetype.id` in phase-joust.ts and phase-melee.ts
- Balanced gear variant must match legacy GEAR_SLOT_STATS exactly
- softCap knee=100, K=55; at Giga rarity only Bulwark GRD crosses knee
- Uncommon rarity bonus = 2 (not 1)
- **v20 project config**: Auto-detected sourceToTests has 5 mappings (1:1 by name). Legacy fallback has 9 entries with cross-references. The legacy fallback is used when project-config.json is absent.
- **v20 quality gates**: Auto-populated from detection if not in mission config. Chain runs tests → returns metrics → orchestrator maps to existing result shape.
- **v20 dynamic ownership**: `"fileOwnership": "auto"` resolves at mission load time. If role has no pattern, agent gets empty ownership (can edit nothing).
- **v20 getTestCommand()**: Returns `npm test` (from project detection) not `npx vitest run`. Both work for this project.
- Param search noise: at N=200, score noise ~ +/-0.84. Use baselineRuns>=3 and ignore deltas < noiseFloor

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
