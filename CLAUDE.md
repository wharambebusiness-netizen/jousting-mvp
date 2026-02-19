# Jousting MVP

Jousting minigame web demo. Vite + React + TypeScript. Engine is pure TS, zero UI imports (portable to Unity C#).

Gigaverse integration is tabled — do not work on it unless explicitly asked.

## Commands

```bash
npm test                                           # 1678 tests, 27 suites (all passing)
npm run dev                                        # Dev server
npx tsx src/tools/simulate.ts --summary            # Multi-tier balance summary
npx tsx src/tools/simulate.ts bare --matches 500   # Single-tier high-precision sim
node orchestrator/orchestrator.mjs                 # Launch orchestrator (v29)
node orchestrator/orchestrator.mjs missions/X.json # Launch with mission config
node orchestrator/orchestrator.mjs --dry-run       # Smoke test (mock agents, no API credits)
node orchestrator/orchestrator.mjs --dry-run=chaos # Dry-run with random failures/timeouts
node orchestrator/orchestrator.mjs --dry-run=regression # Dry-run with test regression sim
node operator/operator.mjs "task description"         # Auto-continuation operator (M2)
node operator/operator.mjs --resume                    # Resume last incomplete chain
node operator/operator.mjs --max-budget-usd 2 "task"   # Chain with cost cap
node operator/operator.mjs --project-dir /path "task"   # Target different project
node operator/operator.mjs --dry-run "task"            # Operator dry-run (print config only)
node operator/server.mjs                               # API server (default port 3100)
node operator/server.mjs --port 8080                   # Custom port
node operator/server.mjs --operator                    # Combined mode (API + operator)
```

## Architecture

```
src/engine/           Pure TS combat engine (no UI imports)
  types.ts            Core types (Archetype, MatchState, gear types, PassResult)
  archetypes.ts       6 archetypes with base stats
  attacks.ts          12 attacks (6 joust + 6 melee), 3 speeds, counter tables
  calculator.ts       Core math: softCap, fatigue, impact, accuracy, guard, unseat
  phase-joust.ts      resolveJoustPass() — joust pass resolution
  phase-melee.ts      resolveMeleeRoundFn() — melee round resolution
  match.ts            State machine: createMatch(), submitJoustPass(), submitMeleeRound()
  gigling-gear.ts     6-slot steed gear system
  player-gear.ts      6-slot player gear system
  balance-config.ts   ALL tuning constants (single source of truth)

src/ui/               14 React components, App.tsx 10-screen state machine
src/ai/               AI opponent: difficulty levels, personality, pattern tracking
src/tools/            simulate.ts (balance testing), param-search.ts (parameter optimization)

orchestrator/         Multi-agent system (v27, 22 modules)
  orchestrator.mjs    Main orchestrator (1922 lines)
  agent-runner.mjs    Agent spawner: prompt building, CLI args, process management
  task-board.mjs      Task board markdown generation
  balance-analyzer.mjs Balance sims, experiments, regression detection
  git-ops.mjs         Git backup, tagging, worktree isolation, smart revert
  reporter.mjs        Overnight report generation
  backlog-system.mjs  Task queue, subtasks, priority, archive
  cost-tracker.mjs    API cost parsing & accumulation
  test-filter.mjs     Incremental test mapping & filtering
  handoff-parser.mjs  Handoff META parsing & validation
  spawn-system.mjs    Dynamic agent spawning subsystem
  workflow-engine.mjs Composable workflow patterns
  sdk-adapter.mjs     Agent SDK adapter (CLI fallback), M3 agent continuation
  observability.mjs   Structured logging, metrics, event bus
  dag-scheduler.mjs   DAG task scheduler
  project-scaffold.mjs Project templates (7 types)
  plugin-system.mjs   Plugin architecture (6 types)
  agent-tracking.mjs  Runtime history, effectiveness, session continuity
  mission-sequencer.mjs Multi-mission sequence + hot-reload
  progress-dashboard.mjs Live agent status display
  agent-pool.mjs      Queue-drain concurrent agent pool
  checkpoint.mjs      Checkpoint/resume for crash recovery (M8)
  mock-runner.mjs     Dry-run mock agent/test/git execution
  roles/              16 role templates
  missions/           Mission configs

operator/             Auto-continuation system (M2+M4+M5+P3+Phase1)
  operator.mjs        CLI daemon: SDK query → context monitor → handoff → auto-commit → chain
  server.mjs          HTTP API + Web UI server (Express + WebSocket, M4+M5)
  process-pool.mjs    Multi-orchestrator worker process management (fork, IPC, heartbeat, restart)
  orchestrator-worker.mjs  Child process entry point (IPC protocol, IPCEventBus, orchestrator fork)
  registry.mjs        Chain persistence (factory pattern, atomic writes, file locking, CRUD, archival)
  settings.mjs        Settings persistence (factory pattern, atomic writes, validation, clamping)
  errors.mjs          Error classification, retry logic, circuit breaker, handoff validation
  ws.mjs              WebSocket event bridge (EventBus → clients, 26 bridged events)
  file-watcher.mjs    Real-time fs.watch for project directories (P9)
  routes/
    chains.mjs        Chain CRUD, session detail, cost summary, project listing
    orchestrator.mjs  Multi-instance orchestrator status/control + mission listing + reports (M6a+Phase1)
    git.mjs           Git status, push, commit, PR creation, file-status (M6d+P10)
    settings.mjs      Settings GET/PUT API routes
    files.mjs         File system scanning + content preview API (P9+P10)
    views.mjs         HTMX fragment routes for dashboard + git + missions + reports + settings + projects (M5+M6+P3+P9+P10)
  views/              Server-side HTML fragment renderers (M5)
    helpers.mjs       Formatting: escapeHtml, formatCost, formatDuration, relativeTime
    chain-row.mjs     Chain table row renderer
    session-card.mjs  Session card, timeline, cost breakdown
    agent-card.mjs    Agent status card renderer
    terminal.mjs      ANSI-to-HTML terminal viewer renderer
    analytics.mjs     SVG chart renderers (cost timeline, status donut, model bars, top chains)
    projects.mjs      Project card + file tree + git badges + preview renderers (P9+P10)
  public/             Static HTML pages (M5+P3+P9)
    index.html        Dashboard: chain list, cost summary, quick-start form, project filter
    chain.html        Chain detail: timeline, sessions, handoffs, real-time WS updates
    projects.html     Projects: file explorer with real-time updates (P9)
    analytics.html    Analytics: cost trends, status donut, model usage, top chains
    orchestrator.html Orchestrator status + agent cards
    terminals.html    Multi-terminal xterm.js interface for orchestrator instances (Phase 2)
    settings.html     Settings page: model, limits, preferences
    style.css         Pico CSS overrides (dark mode, status dots, timeline, log panel, reports, terminal)
    app.js            Shared client JS: toast, progress, branch auto-gen, project filter, WS updates
    terminals.js      Terminal page JS: xterm.js instances, tab/grid views, WS event routing (Phase 2)
  __tests__/          379 tests (registry, errors, server, views, file-watcher, process-pool)

shared/               Cross-module shared code
  event-bus.mjs       EventBus + IPCEventBus (extracted from orchestrator/observability.mjs)
```

## Detailed Documentation

Find the right doc: `node docs/find-docs.mjs "<topic>"`

| Topic | File |
|-------|------|
| Orchestrator architecture | `docs/orchestrator.md` |
| Orchestrator reliability plan | `docs/orchestrator-reliability-plan.md` |
| Operator plan (M2-M6) | `docs/operator-plan.md` |
| Game engine & combat | `docs/engine-guide.md` |
| Balance data & win rates | `docs/balance-reference.md` |
| Gear system (12 slots) | `docs/gear-system.md` |
| API signatures & examples | `docs/api-reference.md` |
| Common mistakes & fixes | `docs/troubleshooting.md` |
| Game spec (v4.1) | `docs/joust-melee-v4.1.md` |
| Full doc index | `docs/INDEX.md` |

## Critical Gotchas

- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg (or returns NaN)
- `createMatch()` takes 6 positional args — use `undefined` for empty gear slots
- `applyPlayerLoadout` does NOT add rarity bonus (steed-only feature)
- Breaker detection via `archetype.id === 'breaker'` — don't rename the ID
- Counter table: Agg>Def>Bal>Agg; Guard High beats Measured Cut (not vice versa)
- Uncommon rarity bonus = 2 (not 1)
- `softCap` knee=100; at Giga only Bulwark GRD crosses it
- All tuning constants in `balance-config.ts` — never hardcode combat numbers
- See `docs/troubleshooting.md` for full table with symptoms

## Test Suite

1678 tests across 26 suites. Engine: calculator (202), phase-resolution (66), gigling-gear (48), player-gear (46), match (100), playtest (128), gear-variants (223), ai (95). Orchestrator: dag-scheduler (59), mission-validator (64), cost-tracker (27), handoff-parser (26), agent-tracking (26), observability (28), mock-runner (26), test-filter (21), backlog-system (18), checkpoint (10), dry-run-integration (6), continuation (37). Operator: registry (21), errors (43), server (116), views (162), file-watcher (16), process-pool (43). Run `npm test` to verify.

## Orchestrator Rules (for orchestrated agents)

- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Run `npx vitest run` before writing your final handoff
- Write META section at top of handoff with status/files-modified/tests-passing
