# Multi-Orchestrator System — Master Plan

## Vision

Transform the single-orchestrator operator into a **multi-orchestrator command center** with:
- 4+ concurrent orchestrator instances with unique colored terminals
- Shared project directory accessible by any/all orchestrators
- Inter-orchestrator communication and coordination
- Intelligent skill selection from a shared pool
- One-click handoff/continuation per terminal
- Tab navigation + 2x2 shared view
- Scalable architecture (4→N orchestrators)

---

## Architecture: Hybrid Coordinator + Autonomous Workers

```
                    ┌─────────────────────────────┐
                    │     Operator Server          │
                    │  (Express + WS + ProcessPool)│
                    │                              │
                    │  - Task queue + deps graph   │
                    │  - Worker registry            │
                    │  - Rate limiter              │
                    │  - Cost aggregator           │
                    │  - Skill registry            │
                    └──────────┬──────────────────┘
                               │ fork() IPC
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐ ┌──────▼────────┐ ┌─────▼──────────┐
    │ Worker 1       │ │ Worker 2      │ │ Worker N       │
    │ (indigo)       │ │ (emerald)     │ │ (rose)         │
    │                │ │               │ │                │
    │ IPCEventBus    │ │ IPCEventBus   │ │ IPCEventBus    │
    │ git worktree   │ │ git worktree  │ │ git worktree   │
    └────────────────┘ └───────────────┘ └────────────────┘
```

### Key Design Decisions

1. **fork() IPC** for communication (zero deps, Windows-compatible)
2. **IPC-EventBus bridge** preserves existing EventBus API transparently
3. **Git worktrees** for code isolation (each worker gets its own working directory)
4. **CI/tests as merge ratchet** — only passing work gets merged
5. **xterm.js** for terminal rendering (CDN, per-instance color themes)
6. **proper-lockfile** for file locking (only new dependency, ~15KB pure JS)
7. **JSON skill manifests** with two-stage selection (category filter → LLM ranking)
8. **IPC messages for shutdown** (Windows SIGTERM kills immediately, can't be caught)

---

## Current Blockers (Must Fix First)

From the project structure review, these singleton patterns block multi-orchestrator:

| Blocker | File | Issue | Fix |
|---------|------|-------|-----|
| Registry singleton | `registry.mjs` | Module-level `_cache`, `registryPath` | Convert to factory/closure pattern |
| Settings singleton | `settings.mjs` | Module-level `settingsPath` | Convert to factory/closure pattern |
| Single orchestrator tracking | `routes/orchestrator.mjs` | One `orchProcess`, one `orchestratorStatus` | Orchestrators Map keyed by ID |
| No file locking | `registry.mjs` | Concurrent writes corrupt JSON | Add `proper-lockfile` |
| EventBus is process-local | `observability.mjs` | Events don't cross process boundaries | IPC-EventBus bridge |
| History file conflicts | `routes/orchestrator.mjs` | Single `orch-history.json` | Per-instance or locked writes |

### What's Already Good

- Game engine completely decoupled (zero shared deps)
- Route factory pattern (`createXRoutes(ctx)`) supports dependency injection
- Express app factory (`createApp(options)`) is extensible
- Project-aware chain system (`projectDir` on chains)
- `hx-boost` SPA-like navigation pattern
- CSS design token system is extensible
- WS pattern subscriptions already support wildcards

---

## Milestone Plan

### Phase 0: Foundation Cleanup (S102) — ~1 session
**Goal:** Eliminate singleton blockers, prepare codebase for multi-instance

- [ ] Convert `registry.mjs` from module-level state to factory pattern (`createRegistry(ctx)`)
- [ ] Convert `settings.mjs` from module-level state to factory pattern
- [ ] Add `proper-lockfile` around registry read-modify-write cycles
- [ ] Extract `EventBus` from `orchestrator/observability.mjs` to `shared/event-bus.mjs`
- [ ] Update all imports (operator + orchestrator) to use shared EventBus
- [ ] Create `IPCEventBus` subclass that emits locally AND via `process.send()`
- [ ] All existing tests must still pass
- [ ] **Deliverable:** Registry, settings, and EventBus ready for multi-instance use

### Phase 1: Process Pool + Multi-Instance Backend (S103) — ~1 session
**Goal:** Spawn and manage multiple orchestrator worker processes

- [ ] Create `operator/process-pool.mjs` (~100 lines):
  - `spawn(workerId, config)` — fork worker with IPC channel
  - `kill(workerId)` — IPC shutdown message + force-kill timeout
  - `sendTo(workerId, msg)` — route commands to specific worker
  - `getStatus()` — all workers' status
  - `shutdownAll()` — graceful coordinated shutdown
- [ ] Create `operator/orchestrator-worker.mjs` — child process entry point:
  - Accepts commands via `process.on('message')`
  - Uses `IPCEventBus` (events forward to parent)
  - Runs operator chain logic in isolation
- [ ] Refactor `routes/orchestrator.mjs`:
  - `orchestrators` Map (keyed by instance ID) instead of single `orchestratorStatus`
  - `POST /api/orchestrator/:id/start` — start specific instance
  - `POST /api/orchestrator/:id/stop` — stop specific instance
  - `GET /api/orchestrator/instances` — list all instances
  - `DELETE /api/orchestrator/:id` — remove instance
- [ ] IPC bridge: worker IPC events → parent EventBus → ws.mjs (no ws.mjs changes needed)
- [ ] Health check heartbeats (30s interval, 3 missed = restart)
- [ ] Tests: process pool lifecycle, IPC bridge, multi-instance routes
- [ ] **Deliverable:** 4 orchestrator workers can run concurrently, events flow to UI

### Phase 2: Multi-Terminal UI (S104) — ~1 session
**Goal:** Tabbed terminal interface with per-orchestrator colors

- [ ] New page: `operator/public/terminals.html`
- [ ] Add xterm.js + xterm-addon-fit via CDN
- [ ] Tab bar component (vanilla JS):
  - Tab per orchestrator instance with color indicator
  - Add/remove tabs, persist active tab to localStorage
  - Click tab → switch terminal, keyboard shortcuts (Ctrl+1-4)
- [ ] Per-orchestrator color themes:
  - Indigo (#6366f1), Emerald (#10b981), Amber (#f59e0b), Rose (#f43f5e)
  - CSS custom properties `[data-orch="N"]` for each
  - xterm.js theme objects per instance
- [ ] Terminal status bar per instance:
  - Running/stopped indicator, round count, agent count, cost
- [ ] WS integration:
  - Events tagged with `orchId` → route to correct xterm.js instance
  - Single WS connection, client-side filtering by orchId
- [ ] View toggle: Tab view ↔ 2x2 grid view
  - CSS grid: `1fr 1fr / 1fr 1fr` for grid, `1fr / 1fr` for tabs
- [ ] Nav update: "Terminals" link on all HTML pages
- [ ] Tests: terminal page rendering, tab switching, grid layout
- [ ] **Deliverable:** 4 color-coded terminals, tab switching, 2x2 grid view

### Phase 3: Handoff Workflow (S105) — ~1 session
**Goal:** One-click handoff button per terminal

- [ ] Handoff API: `POST /api/orchestrator/:id/handoff`
  - Generate handoff document (summary of work, remaining tasks, context)
  - Based on existing `parseHandoff()` + `generateSyntheticHandoff()` patterns
  - Write to `operator/handoffs/orch-{id}-{timestamp}.md`
- [ ] Handoff button per terminal (visible in both tab and grid views):
  - Multi-step progress indicator:
    1. Generate handoff instructions
    2. Git commit (in worker's worktree)
    3. Git push
    4. Stop current session
    5. Start new session with handoff context loaded
  - Progress stepper UI with checkmarks/spinners/errors
  - Toast notifications for success/failure
- [ ] New session initialization:
  - Load previous handoff file as system prompt context
  - Include instructions to read handoff and continue work
  - Worker respawns with fresh context window
- [ ] Cross-orchestrator handoff (stretch):
  - Reassign a task from one orchestrator to another
  - Task state preserved in handoff document
- [ ] Tests: handoff generation, multi-step workflow, context passing
- [ ] **Deliverable:** One-click handoff per terminal, seamless context continuation

### Phase 4: Skill Pool System (S106-S107) — ~2 sessions
**Goal:** Shared skill registry with intelligent selection

**S106 — Skill Registry + Manifests:**
- [ ] Create `operator/skills/` directory structure:
  ```
  operator/skills/
    registry.mjs      — Load, index, search, get
    selector.mjs      — Two-stage selection pipeline
    resolver.mjs      — Dependency resolution, conflict checking
    schema/
      skill.schema.json
    manifests/
      git/
        git-status.skill.json
        git-commit.skill.json
        git-push.skill.json
      code/
        file-read.skill.json
        test-runner.skill.json
        lint.skill.json
      research/
        web-search.skill.json
        codebase-search.skill.json
  ```
- [ ] Skill manifest format (JSON):
  - id, name, version, description, shortDescription
  - triggerExamples (5-10 phrases), tags, category
  - parameters (JSON Schema), requires, conflicts, enhancedBy
  - sideEffects, idempotent, requiresConfirmation
  - handler module path
- [ ] Skill registry: load from disk at startup, in-memory Map, shared across orchestrators
- [ ] Migrate existing `.claude/skills/` to new manifest format
- [ ] Tests: registry loading, manifest validation, dependency resolution

**S107 — Skill Selection + Agent Profiles:**
- [ ] Two-stage selector:
  - Stage 1: Category-based coarse filter (keyword matching, tag intersection)
  - Stage 2: If >10 candidates, LLM-based fine selection (cheap model call)
- [ ] Agent profiles (specialist presets):
  ```javascript
  'code-writer': coreSkills: ['file-read', 'file-write', 'test-runner']
  'reviewer': coreSkills: ['file-read', 'git-diff', 'lint']
  'deployer': coreSkills: ['git-status', 'build', 'deploy']
  ```
- [ ] `discover_skills` meta-tool: agent can request additional skills mid-task
- [ ] Per-turn skill re-evaluation: remove unused, add discovered
- [ ] Usage analytics: track which skills are actually called per task type
- [ ] Tests: selection pipeline, agent profiles, mid-task discovery
- [ ] **Deliverable:** Skills are selected per-task (3-8 from 50+ pool), not bulk-loaded

### Phase 5: Inter-Orchestrator Coordination (S108) — ~1 session
**Goal:** Orchestrators cooperate on shared projects

- [ ] Task queue with dependency graph:
  - Tasks have `id`, `status`, `deps[]`, `assignedTo`, `priority`
  - Topological sort for execution ordering
  - Ready tasks: all deps completed, not assigned
- [ ] Work assignment strategies:
  - Static: round-robin to available workers
  - Capability-based: match task category to agent profile
  - Work-stealing: idle workers pull from busy workers' queues
- [ ] Shared project coordination:
  - Git worktrees per worker (branch-per-worker isolation)
  - Conflict detection: periodic `git merge --no-commit` dry runs
  - Merge queue: completed tasks validated by tests before merge to main
- [ ] Rate limiter: shared token bucket for API calls across all workers
- [ ] Cost aggregator: sum costs across all workers in real-time
- [ ] Tests: task queue, dependency resolution, conflict detection
- [ ] **Deliverable:** Orchestrators can coordinate on the same project without conflicts

### Phase 6: Polish + Scaling (S109-S110) — ~2 sessions
**Goal:** Production-ready multi-orchestrator system

**S109 — UX Polish:**
- [ ] Keyboard shortcuts: Ctrl+1-4 for tab switching, Ctrl+H for handoff
- [ ] Terminal search (xterm.js search addon)
- [ ] Orchestrator config panel (model, budget, skills per instance)
- [ ] Dashboard integration: multi-orchestrator analytics, combined cost view
- [ ] 2x2 grid: per-terminal handoff button, minimize/maximize
- [ ] Loading states and error recovery in terminal UI

**S110 — Scaling + Robustness:**
- [ ] Auto-scale: spawn workers when queue depth exceeds threshold
- [ ] Auto-kill: idle workers after configurable timeout
- [ ] Circuit breaker per worker (3 consecutive failures → offline)
- [ ] Worker crash recovery: detect missed heartbeats → respawn with same config
- [ ] Per-worker cost budgets with automatic shutdown
- [ ] Stress testing: 4 workers, shared project, concurrent file edits

---

## Project Structure Assessment

### Should We Split the Repo?

**Not yet.** The current monorepo structure works. Recommended evolution:

**Now (keep as-is):**
```
jousting-mvp/
  src/engine/         ← Pure TS game engine (already decoupled)
  src/ui/             ← React UI (already decoupled)
  orchestrator/       ← Multi-agent development automation
  operator/           ← Chain management + web UI + multi-orch
```

**Later (if scaling demands it):**
```
packages/
  engine/             ← npm workspace package
  orchestrator/       ← npm workspace package
  operator/           ← npm workspace package (includes multi-orch)
```

The game engine is already cleanly separated. The orchestrator↔operator coupling is limited to one import (`EventBus`), which Phase 0 fixes by extracting to a shared location. No immediate split needed.

---

## Technology Choices

| Component | Choice | Dependencies | Rationale |
|-----------|--------|-------------|-----------|
| IPC | `child_process.fork()` | None (built-in) | Windows-compatible, bidirectional, JSON messages |
| EventBus bridge | Custom `IPCEventBus` | None (~30 lines) | Preserves existing API, transparent to ws.mjs |
| Process pool | Custom `ProcessPool` | None (~100 lines) | Full control, Windows-safe shutdown via IPC |
| File locking | `proper-lockfile` | 1 pkg, ~15KB | Pure JS, works on Windows NTFS |
| Terminal renderer | xterm.js (CDN) | CDN link only | GPU-accelerated, per-instance themes, battle-tested |
| Terminal fit | @xterm/addon-fit (CDN) | CDN link only | Responsive terminal sizing |
| Skill manifests | JSON files | None | Scannable, validatable, no handler execution needed |
| State persistence | JSON files + lockfile | (same as above) | Minimal change to existing code |
| Shared state (future) | SQLite WAL + better-sqlite3 | 1 pkg (native) | When JSON+lockfile becomes insufficient |

**Total new runtime dependencies: 1 (proper-lockfile)**
**Total new CDN assets: 2 (xterm.js + fit addon, ~270KB)**

---

## Session Planning (Research Phase)

This plan was developed in **S102** (research session). Implementation begins in S103.

| Session | Focus | Estimated Effort |
|---------|-------|-----------------|
| S102 | Research + plan (this document) | Done |
| S103 | Phase 0: Foundation cleanup | ~60k tokens |
| S104 | Phase 1: Process pool + multi-instance backend | ~60k tokens |
| S105 | Phase 2: Multi-terminal UI | ~60k tokens |
| S106 | Phase 3: Handoff workflow | ~60k tokens |
| S107 | Phase 4a: Skill registry + manifests | ~60k tokens |
| S108 | Phase 4b: Skill selection + agent profiles | ~60k tokens |
| S109 | Phase 5: Inter-orchestrator coordination | ~60k tokens |
| S110 | Phase 6a: UX polish | ~60k tokens |
| S111 | Phase 6b: Scaling + robustness | ~60k tokens |

---

## Color Scheme

```css
/* Orchestrator 1: Indigo (matches existing accent) */
--orch-1-accent: #6366f1;
--orch-1-bg: #0d0d14;

/* Orchestrator 2: Emerald */
--orch-2-accent: #10b981;
--orch-2-bg: #0a0f0d;

/* Orchestrator 3: Amber */
--orch-3-accent: #f59e0b;
--orch-3-bg: #0f0e0a;

/* Orchestrator 4: Rose */
--orch-4-accent: #f43f5e;
--orch-4-bg: #0f0a0c;
```

---

## Research Sources

### Multi-Orchestrator Architecture
- [Multiclaude](https://github.com/dlorenc/multiclaude) — Brownian ratchet, CI-as-arbiter
- [Claude Squad](https://github.com/smtg-ai/claude-squad) — tmux + worktree isolation
- [Agent-MCP](https://github.com/rinadelph/Agent-MCP) — MCP-based shared memory
- [ccswarm](https://github.com/nwiizo/ccswarm) — Master-worker with specialist pools
- [Microsoft Multi-Agent Reference Architecture](https://microsoft.github.io/multi-agent-reference-architecture/)
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)

### Skill Systems
- ToolLLM paper — hierarchical API retrieval
- CRAFT paper — task-specific tool subsets (3-8 tools) outperform full sets
- MCP tool discovery patterns
- LangChain Toolkits — grouped tool bundles

### Handoff/Continuation
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: Multi-Agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)
- Existing project: `checkpoint.mjs`, `parseHandoff()`, `generateSyntheticHandoff()`

### IPC/Node.js
- `child_process.fork()` with built-in IPC (Node.js docs)
- Named pipes on Windows (`\\.\pipe\` format)
- SQLite WAL mode for concurrent access
- `proper-lockfile` for cross-process file locking
- Windows SIGTERM limitations (use IPC messages instead)
