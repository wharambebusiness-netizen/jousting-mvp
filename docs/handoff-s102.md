# Session 102 Handoff — Multi-Orchestrator Research & Planning

## What S102 Did

**Research phase** for the multi-orchestrator system. Sent 6 parallel research agents to investigate:

1. **Multi-orchestrator architectures** — Surveyed Multiclaude, Claude Squad, Agent-MCP, ccswarm, Microsoft Multi-Agent Reference Architecture, Claude Code Agent Teams. Recommended **hybrid coordinator + autonomous workers** pattern.

2. **Skill pools & selection** — Researched skill overload problem (3-8 tools optimal per task), two-stage selection (category filter → LLM ranking), JSON skill manifests, agent profiles. Comprehensive implementation plan.

3. **Current project structure review** — Identified 6 critical singleton blockers (registry, settings, orchestrator routes, EventBus, file locking, history). Confirmed game engine is cleanly decoupled. Route factory pattern already supports DI.

4. **UI architecture for terminals** — Recommended xterm.js (CDN), 4 color themes (indigo/emerald/amber/rose), tab + 2x2 grid views, WS multiplexing via event tagging (orchId field).

5. **Handoff & continuation systems** — Pulled Anthropic engineering blog insights on compaction, context engineering, two-agent pattern (initializer + coding), feature_list.json checkpoint format.

6. **IPC & Node.js patterns** — Recommended `child_process.fork()` IPC (zero deps, Windows-compatible), custom IPC-EventBus bridge (~30 lines), `proper-lockfile` for file locking, ProcessPool class.

### Deliverables
- **`docs/multi-orchestrator-plan.md`** — Complete master plan with 7 phases (0-6), 10 sessions estimated
- **`docs/handoff-s102.md`** — This handoff document

## Master Plan Summary

**10 milestones across ~9 implementation sessions:**

| Phase | Session | Focus |
|-------|---------|-------|
| 0 | S103 | Foundation cleanup — eliminate singletons, extract EventBus, add lockfile |
| 1 | S104 | Process pool + multi-instance backend — fork workers, IPC bridge |
| 2 | S105 | Multi-terminal UI — xterm.js, tabs, 2x2 grid, color themes |
| 3 | S106 | Handoff workflow — one-click handoff per terminal |
| 4a | S107 | Skill registry + manifests — JSON manifests, category system |
| 4b | S108 | Skill selection + agent profiles — two-stage selector |
| 5 | S109 | Inter-orchestrator coordination — task queue, deps graph, work assignment |
| 6a | S110 | UX polish — shortcuts, search, config panels |
| 6b | S111 | Scaling + robustness — auto-scale, circuit breakers, stress testing |

## What S103 Should Do

**Phase 0: Foundation Cleanup** — The critical path starts here:

### Priority 1: Convert registry.mjs to factory pattern
```javascript
// Before (singleton):
let registryPath = ''; let _cache = null;
export function initRegistry(ctx) { registryPath = ...; }
export function loadRegistry() { /* uses registryPath */ }

// After (factory):
export function createRegistry(ctx) {
  const registryPath = join(ctx.operatorDir, 'registry.json');
  let _cache = null, _cacheMtimeMs = 0;
  return {
    load() { /* uses registryPath from closure */ },
    save(registry) { ... },
    createChain(...) { ... },
    // ... all other functions
  };
}
```

### Priority 2: Convert settings.mjs to factory pattern
Same treatment as registry — replace module-level `settingsPath` with closure.

### Priority 3: Add proper-lockfile
```bash
npm install proper-lockfile
```
Wrap registry `load()` and `save()` in lock/unlock cycle.

### Priority 4: Extract EventBus to shared location
Move `EventBus` class from `orchestrator/observability.mjs` to `shared/event-bus.mjs`.
Create `IPCEventBus` subclass that also forwards via `process.send()`.
Update all imports in operator and orchestrator.

### Priority 5: Update orchestrator routes for multi-instance
Change `let orchestratorStatus = {...}` → `const orchestrators = new Map()`.
Add orchestrator instance ID to all route paths.

### All 1604 existing tests must still pass after these changes.

## Key Files to Read

- **`docs/multi-orchestrator-plan.md`** — Full plan with architecture, milestones, technology choices
- **`operator/registry.mjs`** — Module-level state to convert (lines 19-26)
- **`operator/settings.mjs`** — Module-level state to convert (line 21)
- **`operator/routes/orchestrator.mjs`** — Single-instance tracking (lines 26-41)
- **`orchestrator/observability.mjs`** — EventBus class to extract (lines 186-209)
- **`operator/server.mjs`** — EventBus import to update (line 32)
- **`operator/ws.mjs`** — WS bridge (no changes needed yet)

## Current State

- **1604 tests ALL PASSING** across 25 test suites
- **Commit 2236bd1** — S101 complete (project review + Tier 1 fixes)
- **Balance ALL ZERO FLAGS**
- **No unstaged changes** (orchestrator state files are auto-generated)

## Architecture Notes

- **Only 1 new dependency**: `proper-lockfile` (~15KB, pure JS, no native compilation)
- **Zero changes to game engine** — it's completely decoupled
- **Zero changes to ws.mjs** — IPC bridge feeds into existing EventBus → WS pipeline
- **Windows SIGTERM limitation**: Must use IPC messages for graceful shutdown, NOT signals
- **Git worktrees needed in Phase 1+**: each worker gets isolated working directory
- **xterm.js loaded via CDN** (consistent with existing Pico CSS + HTMX pattern)
