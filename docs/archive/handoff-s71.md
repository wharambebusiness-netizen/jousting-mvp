# Session 71 Handoff

## Summary
Audit/investigation session. Previous session (between S70 and S71) had agents run out of context investigating orchestrator infrastructure, causing conversation collapse. This session verified no code damage, ran 4 focused research agents to complete the original investigation, and documented findings.

## What Was Done

### 1. Damage Assessment
- Ran full test suite: **908 tests, 8 suites — ALL PASSING**
- No uncommitted or partial code changes from the crashed session
- Codebase is clean and matches S70 state

### 2. Orchestrator Infrastructure Audit (4 parallel research agents)

**Agent Communication Mechanisms** — Documented 6 communication channels:
- Handoff files (agent→orchestrator, META section parsed)
- Task board (orchestrator→agents, read-only markdown, regenerated each round)
- @mentions (agent→agent async, `@agent-id: message` in notes-for-others)
- Spawn requests (agent→spawned agent, JSON in `orchestrator/spawns/`)
- Backlog (producer→consumers, JSON task queue)
- Failure context (orchestrator→agent, M1 reliability feature)
- Key limitation: all communication is async, one-round delay

**Core Loop Health** — No critical issues found:
- Clean control flow with proper stop conditions
- Thorough timeout handling (Windows `taskkill /T /F` for process trees)
- v28 pool `.catch()` prevents deadlock on `runAgent()` throw
- Smart revert works in two modes (worktree-based and tag-based)
- Minor: plugin pre-round hook errors swallowed silently (acceptable)

**Module Ecosystem** — 22 modules, all healthy:
- 1 dormant module: `sdk-adapter.mjs` (288 lines, `useSDK=false`, never called)
- 1 standalone CLI: `project-scaffold.mjs` (not imported, intentional)
- All other modules actively used in production
- No dead code, no orphaned imports

**Reliability Milestones** — ALL 8 VERIFIED as properly implemented:
- M1: `lastFailureDetails` declared, populated, injected into both prompt paths
- M2: `verifyAgentOutput()` in git-ops.mjs, wired into `onAgentComplete`
- M3: File-existence check in activeAgents filter, glob patterns excluded
- M4: `lessons.mjs` module exists, wired into startup + smart revert + prompt injection
- M5: `plugins/notify/` exists, `enablePlugins=true`, hooks registered
- M6: `sanitizeEnv()` applied to all 3 spawn sites
- M7: `roles/self-reviewer.md` template exists
- M8: `checkpoint.mjs` exists, load at startup, write at round boundary

### 3. Context Exhaustion Prevention Guidelines
Documented best practices for research tasks:
- Use Task subagents directly (not the orchestrator) for investigation work
- Keep agents focused on 1-2 specific files/questions
- Set `max_turns: 15-20` to prevent runaway exploration
- Ask for line numbers and summaries, not full code dumps
- Run 3-4 small agents in parallel rather than 1 giant one

## Files Modified
- `docs/archive/handoff-s71.md` — This handoff (created)
- `docs/session-history.md` — S71 entry added

## Files Created
None (investigation-only session)

## Test Status
908 tests, 8 suites — ALL PASSING (unchanged from S70)

## Orchestrator Version
**v27** — 22 modules, 1922 lines main, 16 role templates, plugins enabled, checkpoint/resume enabled (unchanged)

## Key Findings for Future Sessions

### The Orchestrator Is NOT for Research Tasks
The orchestrator's round loop (launch agents → merge code → run tests → repeat) is designed for code-development automation. For pure investigation/research tasks, use Task subagents directly from conversation. No file ownership, git worktrees, or test runs needed.

### Only Maintenance Item Found
`sdk-adapter.mjs` (288 lines) is permanently dormant (`useSDK=false`). Could be removed if SDK support is permanently tabled. Low priority — it's well-isolated and causes no issues.

## What's Next
Same as S70 — reliability plan complete. Possible directions:
- Run orchestrator overnight with all reliability features enabled
- Add orchestrator unit tests (currently 0)
- Further game features or UI polish
- Deploy/packaging improvements
- Remove sdk-adapter.mjs if SDK support is permanently tabled
