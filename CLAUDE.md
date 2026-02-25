# Jousting MVP

Jousting minigame web demo. Vite + React + TypeScript. Engine is pure TS, zero UI imports (portable to Unity C#).

Gigaverse integration is tabled — do not work on it unless explicitly asked.

## Commands

```bash
npm test                                           # 2881 tests, 39 suites (all passing)
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
  roles/              23 role templates (15 original + 8 Phase 4 general-purpose)
  missions/           Mission configs

operator/             Auto-continuation system (M2+M4+M5+P3+Phase1+Phase6+Phase15)
  operator.mjs        CLI daemon: SDK query → context monitor → handoff → auto-commit → chain
  server.mjs          HTTP API + Web UI server (Express + WebSocket, M4+M5+Phase15)
  process-pool.mjs    Multi-orchestrator worker process management (fork, IPC, heartbeat, restart)
  orchestrator-worker.mjs  Child process entry point (IPC protocol, IPCEventBus, orchestrator fork)
  claude-terminal.mjs Single PTY process manager: node-pty spawn, resize, kill, dynamic import fallback, context pressure detection (Phase 15A+15E)
  claude-pool.mjs     Multi-terminal pool: spawn, kill, resize, respawn, setAutoHandoff, setAutoDispatch, setAutoComplete, shutdownAll, auto-handoff on exit, auto-dispatch on task completion, auto-complete on idle detection, shared memory snapshots, task assignment, activity tracking, pool status (Phase 15A+15E+17+19+20+21+22)
  shared-memory.mjs   Cross-terminal persistent state: key-value store, terminal snapshots, watchers, atomic disk persistence (Phase 17)
  terminal-messages.mjs  Inter-terminal message bus: broadcast/targeted/threaded messages, ring buffer, unread tracking, disk persistence (Phase 18)
  registry.mjs        Chain persistence (factory pattern, atomic writes, file locking, CRUD, archival)
  settings.mjs        Settings persistence (factory pattern, atomic writes, validation, clamping)
  errors.mjs          Error classification, retry logic, circuit breaker, handoff validation
  ws.mjs              WebSocket event bridge (EventBus → clients, 72 bridged events) + binary WS for Claude terminals (Phase 15B+15E+19+20+22)
  file-watcher.mjs    Real-time fs.watch for project directories (P9)
  routes/
    chains.mjs        Chain CRUD, session detail, cost summary, project listing
    orchestrator.mjs  Multi-instance orchestrator status/control + mission listing + reports (M6a+Phase1)
    coordination.mjs  Coordination REST API: tasks CRUD+PATCH, progress, graph, templates, rate-limit, costs, lifecycle (Phase 6+13+14)
    claude-terminals.mjs  Claude terminal REST API: list, spawn, resize, toggle-permissions, toggle-auto-handoff, toggle-auto-dispatch, toggle-auto-complete, respawn, kill, claim-task, release-task, complete-task, get-task, pool-status (Phase 15C+15E+19+20+21+22)
    git.mjs           Git status, push, commit, PR creation, file-status (M6d+P10)
    settings.mjs      Settings GET/PUT API routes
    files.mjs         File system scanning + content preview API (P9+P10)
    shared-memory.mjs Shared memory REST API: key CRUD, snapshots CRUD, prefix filtering (Phase 17)
    terminal-messages.mjs  Terminal message bus REST API: list, send, get, thread, delete, clear, unread, mark-read (Phase 18)
    views.mjs         HTMX fragment routes for dashboard + git + missions + reports + settings + projects (M5+M6+P3+P9+P10)
  views/              Server-side HTML fragment renderers (M5)
    helpers.mjs       Formatting: escapeHtml, formatCost, formatDuration, relativeTime
    chain-row.mjs     Chain table row renderer
    session-card.mjs  Session card, timeline, cost breakdown
    agent-card.mjs    Agent status card renderer
    terminal.mjs      ANSI-to-HTML terminal viewer renderer
    analytics.mjs     SVG chart renderers (cost timeline, status donut, model bars, top chains)
    projects.mjs      Project card + file tree + git badges + preview renderers (P9+P10)
  public/             Static HTML pages (M5+P3+P9+S133)
    index.html        Dashboard: chains, cost summary, quick-start, orch summary, analytics, reports (S133: merged analytics+reports)
    chain.html        Chain detail: timeline, sessions, handoffs, real-time WS updates
    projects.html     Projects: file explorer with real-time updates (P9)
    terminals.html    Multi-terminal xterm.js interface for orchestrator instances (Phase 2)
    taskboard.html    Kanban task board for coordination tasks (Phase 12+13)
    settings.html     Settings page: model, limits, preferences
    style.css         Pico CSS overrides (dark mode, status dots, timeline, log panel, reports, terminal, task board)
    app.js            Shared client JS: toast, progress, branch auto-gen, project filter, WS updates
    terminals.js      Terminal page JS: dual terminal types (orchestrator output-only + Claude interactive PTY), 8 color themes, binary WS, tab/grid views, search, keyboard shortcuts, auto-handoff, task bridge (Phase 2+7a+15C+15E+19)
    taskboard.js      Task board JS: Kanban + DAG view rendering, drag-and-drop, WS real-time updates, add/cancel/retry, filter/search, keyboard shortcuts, detail/edit dialog, batch operations, task templates (Phase 12-14)
  skills/             Skill pool system (Phase 5)
    registry.mjs     Skill registry — load, validate, index, search, get
    selector.mjs     Two-stage skill selection pipeline (coarse filter + scoring)
    resolver.mjs     Dependency resolution, conflict detection, enhancement suggestions
    tracker.mjs      Usage analytics — assignment/usage tracking, per-turn re-evaluation
    discovery.mjs    Mid-task skill discovery protocol (file-based, like spawn requests)
    assignment.mjs   Role-to-skills mapping, profile detection, reassignment
    schema/          JSON Schema for skill manifests
    manifests/       17 skill manifests in git/, code/, research/, audit/ subdirs
  coordination/       Inter-orchestrator coordination (Phase 6A+6B)
    task-queue.mjs   DAG-based task queue with deps, priorities, worker assignment
    work-assigner.mjs Multi-strategy assignment: round-robin, capability, work-stealing
    rate-limiter.mjs Token bucket shared rate limiter for API calls
    cost-aggregator.mjs Cross-worker cost tracking with per-worker + global budget caps
    coordinator.mjs  Central broker: lifecycle, event routing, subsystem orchestration, rate limiter tick, session cost auto-bridging
    adaptive-limiter.mjs Adaptive rate limiting: 429 detection, exponential backoff, gradual recovery
    worktree-manager.mjs Per-worker git worktree isolation: create, remove, merge, dry-run conflict detection
    persistent-queue.mjs Disk-backed task queue wrapper: atomic writes, crash recovery, in-flight reset (Phase 7b)
  __tests__/          1354 tests (registry, errors, server, views, file-watcher, process-pool, skills, skills-5b, coordination, coordination-integration, claude-terminals, claude-pool, settings, ws, orchestrator-worker, shared-memory, terminal-messages)

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

2881 tests across 39 suites. Engine: calculator (207), phase-resolution (66), gigling-gear (48), player-gear (46), match (100), playtest (128), gear-variants (225), ai (95). Orchestrator: dag-scheduler (59), mission-validator (64), cost-tracker (27), handoff-parser (26), agent-tracking (26), observability (28), mock-runner (26), test-filter (21), backlog-system (18), checkpoint (10), dry-run-integration (6), continuation (37), model-routing (13), role-registry (67). Operator: registry (21), errors (43), server (215), views (171), file-watcher (16), process-pool (65), skills (158), skills-5b (75), coordination (303), coordination-integration (22), claude-terminals (41), claude-pool (150), settings (37), ws (40), orchestrator-worker (23), shared-memory (74), terminal-messages (84). Run `npm test` to verify.

## Orchestrator Rules (for orchestrated agents)

- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Run `npx vitest run` before writing your final handoff
- Write META section at top of handoff with status/files-modified/tests-passing
