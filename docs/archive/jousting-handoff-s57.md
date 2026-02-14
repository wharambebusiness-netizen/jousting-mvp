# Session 57 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (4282 lines)
node orchestrator/project-detect.mjs   # Auto-detect project stack
node orchestrator/role-registry.mjs    # List all 15 agent roles
node orchestrator/quality-gates.mjs --run typescript vitest  # Run quality gates
```

Read these files first:
1. `CLAUDE.md` — project reference, architecture, API, gotchas
2. This handoff — current state and next steps

## Current State

### Codebase
- **Branch**: master, all S57 changes committed
- **Tests**: 908/908 passing across 8 suites
- **Engine**: Pure TypeScript, zero UI imports, portable to Unity C#
- **Stack**: Vite + React + TypeScript

### Balance — ALL ZERO FLAGS
All tiers and all gear variants have zero balance flags.

**High-precision validation (N=500, balanced variant):**
| Tier | Spread | Flags | Top | Bottom |
|------|--------|-------|-----|--------|
| Bare | 5.8pp | 0 | technician 53.0% | breaker 47.2% |
| Epic | 4.5pp | 0 | charger 53.0% | tactician 48.5% |
| Giga | 3.8pp | 0 | duelist 51.6% | bulwark 47.8% |

### Current Archetype Stats
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   64   70   55    59   55  = 303
bulwark:      58   52   64    53   62  = 289
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   62  = 294
duelist:      60   60   60    60   60  = 300
```

### Orchestrator v19 (4282 lines)
Fully featured, **general-purpose** multi-agent development system. No longer jousting-specific.

**New in v19 (S57):**
- **Project auto-detection** (`project-detect.mjs`, 631 lines): Scans for language, framework, test runner, build tool. Auto-suggests quality gates and agent team composition. Supports Node/Python/Rust/Go/Java/Ruby.
- **Role registry** (`role-registry.mjs`, 373 lines): Discoverable roles from `roles/*.md`. Capability matrix, category grouping, team suggestions, mission config generation.
- **Quality gate chain** (`quality-gates.mjs`, 497 lines): Pluggable pipeline with 9 presets (vitest, jest, pytest, cargo-test, typescript, eslint, prettier, build, npm-audit). ANSI-aware output parsing. Configurable severity (blocking/warning/info).
- **Per-agent allowedTools**: Mission config `allowedTools` field overrides default tool restrictions per agent.
- **6 new role templates**: architect, security-auditor, performance-analyst, research-agent, devops, test-generator (336 lines total)
- **5 custom skills**: orchestrator-status, code-review, security-scan, project-detect, agent-report (285 lines total)
- **General-purpose mission** (`general-dev.json`): 8-agent team for any project

**Cumulative features (v8-v18):**
- Unified agent pool with early test start (~1-2min/round savings)
- Session continuity (--session-id / --resume), delta prompts
- Streaming agent pool with adaptive timeouts, priority scheduling (P1 fast-path)
- Task decomposition with subtask support, live progress dashboard
- Pipelined sims, incremental testing, smart per-agent revert
- Model escalation, experiment logging, dynamic concurrency, agent effectiveness tracking
- Cost budget enforcement, stale session invalidation
- All-done exit code (42) for graceful overnight shutdown

### New Infrastructure Files
```
orchestrator/
  project-detect.mjs  (631 lines) — Auto-detect project stack
  quality-gates.mjs   (497 lines) — Pluggable quality pipeline
  role-registry.mjs   (373 lines) — Discoverable role registry
  roles/architect.md           (47 lines)
  roles/security-auditor.md    (60 lines)
  roles/performance-analyst.md (53 lines)
  roles/research-agent.md      (59 lines)
  roles/devops.md              (47 lines)
  roles/test-generator.md      (70 lines)
  missions/general-dev.json    (145 lines)

.claude/skills/
  orchestrator-status/SKILL.md (34 lines) — Quick health check
  code-review/SKILL.md         (53 lines) — AI code review
  security-scan/SKILL.md       (56 lines) — Security vulnerability scan
  project-detect/SKILL.md      (83 lines) — Project type detection
  agent-report/SKILL.md        (59 lines) — Agent capability report
```

### Role Registry (15 roles, 7 categories)
```
DESIGN:          architect, game-designer
ANALYSIS:        balance-analyst, performance-analyst, research-agent
FRONTEND:        css-artist, ui-dev
BACKEND:         engine-dev
QUALITY:         qa-engineer, security-auditor, test-generator
COORDINATION:    producer, tech-lead
INFRASTRUCTURE:  devops
```

## What Was Done in S57

### 1. Research Phase (4 parallel agents)
- **Orchestrator structure analysis**: Full structural report of all agents, missions, roles, execution mechanics
- **Claude Code capabilities research**: Skills, MCP, Agent SDK, Agent Teams, subagents — comprehensive report
- **State-of-the-art research**: CrewAI, AutoGen, MetaGPT, OpenHands, AgentSpawn, ccswarm, Google ADK — competitive analysis
- **Execution mechanics deep dive**: CLI invocation, session management, handoff system, cost tracking

### 2. Infrastructure Modules (1,501 lines)
- `project-detect.mjs`: Language/framework/test runner auto-detection with team suggestions
- `quality-gates.mjs`: Pluggable quality pipeline with preset parsers and ANSI stripping
- `role-registry.mjs`: Role scanning, capability matrix, mission config generation

### 3. Role Templates (336 lines)
- architect.md: System design, boundaries, ADRs
- security-auditor.md: OWASP scanning, secret detection, dependency audit
- performance-analyst.md: Bottleneck identification, benchmarking
- research-agent.md: Technology evaluation, documentation lookup
- devops.md: CI/CD, deployment, build optimization
- test-generator.md: Systematic test coverage expansion

### 4. Custom Skills (285 lines)
- orchestrator-status: Dashboard view of orchestrator health
- code-review: AI-powered review with BLOCK/WARN/INFO severity
- security-scan: OWASP Top 10 scanning with remediation
- project-detect: Project stack identification
- agent-report: Agent capability and effectiveness analysis

### 5. Orchestrator v19 Integration (+56 lines)
- Import new modules (project-detect, quality-gates, role-registry)
- Startup: project detection, role validation, quality gate chain setup
- Per-agent `allowedTools` override in CLI args
- Mission config `qualityGates` field support with hot-reload
- Version strings updated to v19

### 6. General-Purpose Mission Template
- `general-dev.json`: 8 agents (producer, architect, engine-dev, qa, ui-dev, reviewer, security, test-gen)
- Quality gates configured (typescript + vitest presets)
- Works with any TypeScript/React project out of the box

## Backlog (4 pending tasks)
```
BL-077 (P2, qa): Manual QA Testing — requires human tester, not AI-actionable
BL-079 (P1, balance-tuner): Variant-Specific Balance Sweep — run sims for aggressive/defensive variants
BL-080 (P2, qa): Variant Interaction Unit Tests — depends on BL-079
BL-083 (P3, balance-tuner): Legendary/Relic Tier Deep Dive — N=500 ultra-high tier analysis
```

## Potential Next Steps

### Phase 2: Generalize (Project-Agnostic)
1. **Abstract test commands**: Replace hardcoded `npx vitest run` in orchestrator with quality gate chain calls
2. **Project config file**: Generate `orchestrator/project-config.json` from auto-detection, used by agents
3. **Dynamic file ownership**: Infer from project structure instead of hardcoding in missions
4. **Multi-language support**: Test orchestrator on a Python or Rust project

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
- Run archetype-tuning search: `npx tsx src/tools/param-search.ts orchestrator/search-configs/archetype-tuning.json`

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg; Port de Lance beats Coup en Passant
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg
- `createMatch()` takes 6 args: arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?
- `applyPlayerLoadout` does NOT add rarity bonus (mount-only feature)
- Breaker detection via `archetype.id` in phase-joust.ts and phase-melee.ts
- Balanced gear variant must match legacy GEAR_SLOT_STATS exactly
- softCap knee=100, K=55; at Giga only Bulwark GRD crosses knee
- Uncommon rarity bonus = 2 (not 1)
- **v19 quality gates**: vitest parser uses ANSI stripping for accurate test count parsing
- **v19 per-agent tools**: `agent.allowedTools` in mission JSON overrides `CONFIG.allowedTools`
- **v19 role registry**: roles auto-detected from `roles/*.md` — drop a file to add a role
- Param search noise: at N=200, score noise ~ +/-0.84. Use baselineRuns>=3 and ignore deltas < noiseFloor

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
