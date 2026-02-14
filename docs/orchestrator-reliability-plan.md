# Orchestrator Reliability & Intelligence Plan

Created: S68 (2026-02-14)
Origin: Analysis of autonomous AI agent operational lessons applied to our orchestrator.

## Context

Our orchestrator (v25, 21 modules, 1803 lines main) is architecturally mature — strong on specialization (15 roles), parallelization (worktree isolation, dynamic concurrency), and test-based verification (smart revert, circuit breaker). However, deep code review revealed gaps in **agent learning from failures**, **output trust verification**, and **cross-session intelligence**.

Core insight: **We log everything but agents never read the logs.** Error tracking is write-only from the agents' perspective. Failure knowledge doesn't flow back into agent prompts.

## Milestones (Priority Order)

### M1: Failure Context Injection
**Effort:** LOW (~23 lines across 2 files)
**Impact:** HIGH — directly reduces repeat failures

When `consecutiveAgentFailures[agent.id] > 0`, inject the exit code, timeout status, and stderr summary from the prior run into the agent's prompt.

**Files to modify:**
- `orchestrator/orchestrator.mjs` — Add `lastFailureDetails = {}` map in `main()`, populate in `processAgentResult()` when agent fails. Store `{ code, timedOut, stderrSummary }` per agent ID.
- `orchestrator/agent-runner.mjs` — Thread `lastFailureDetails` through `initAgentRunner` ctx (follows existing pattern for `agentSessions`, `agentRuntimeHistory`). In `runAgent()` prompt construction (~line 234), inject failure context section when `failureCount > 0`.

**Implementation notes:**
- Cap stderr to 500 chars, strip ANSI escape codes
- Differentiate timeout vs crash in the injected text
- Include the round number of the failure
- Also inject `isEmptyWork` feedback from `consecutiveEmptyRounds` counter
- Must inject into BOTH fresh and resume prompt paths

**Testing:** Manual — run a mission where an agent fails, verify failure context appears in prompt logs at `LOG_DIR/{agent-id}-round-{N}.log`.

---

### M2: Agent Output Cross-Verification
**Effort:** MEDIUM (~55 lines across 1-2 files)
**Impact:** HIGH — closes "never trust self-report" gap

Add `git diff`/`git status` after agent runs and compare against the agent's self-reported `files-modified` list. Currently `files-modified`, `status: all-done`, and `completed-tasks` are all taken at face value.

**Files to modify:**
- `orchestrator/orchestrator.mjs` — In the pool's `onAgentComplete` callback (lines 1270-1283), after `processAgentResult` but before pushing to `codeResults`. Call verification function while worktree still exists.
- `orchestrator/git-ops.mjs` or `orchestrator/handoff-parser.mjs` — New `verifyAgentOutput()` function.

**Implementation notes:**
- Use `git status --porcelain` (not `git diff --stat`) — catches both modified AND untracked/new files
- Normalize Windows path separators (`\\` vs `/`)
- Exclude `orchestrator/**` paths (agents always touch their handoff file)
- Skip verification for coordination agents (intentionally modify zero source files)
- Log discrepancies as warnings, do not block (observability, not enforcement)
- Check BOTH directions: files agent changed but didn't report, AND files agent claimed but didn't actually change

**Testing:** Manual — have an agent not report a file it modified, verify warning in orchestrator log.

---

### M3: File-Existence Pre-Flight
**Effort:** MEDIUM (~20-30 lines)
**Impact:** MEDIUM — prevents wasted agent compute

Before spawning an agent, verify its primary `fileOwnership` files exist on disk. Skip with warning if critical files are missing.

**Files to modify:**
- `orchestrator/orchestrator.mjs` — In the `activeAgents` filter (lines 896-1075), after dependency checking (line 1063) and before the final "ACTIVE" log (line 1066).

**Implementation notes:**
- `fileOwnership` entries can be glob patterns (`src/engine/*.ts`) — cannot call `existsSync()` on globs. Heuristic: if entry contains `*`, `?`, or `{`, skip the existence check.
- Agents tasked with CREATING files would be blocked. Only skip agent if ALL literal files are missing, not just one.
- Check must use `MVP_DIR` as base path (worktrees aren't created yet at this point in the round).

**Testing:** Manual — configure an agent with a nonexistent file in `fileOwnership`, verify skip + warning.

---

### M4: Cross-Session Lessons File
**Effort:** MEDIUM-HIGH (~115 lines across 3-4 files, new module)
**Impact:** HIGH over time — system gets smarter across runs

Create `orchestrator/lessons.json` that persists across orchestrator runs. Auto-append on high-signal events. Load at startup, inject relevant lessons into agent prompts.

**Start with v1 — only record on smart revert** (highest-signal event). Skip empty-rounds and escalation triggers initially.

**Files to modify/create:**
- New: `orchestrator/lessons.mjs` — Load, save, append, query, prune functions
- `orchestrator/orchestrator.mjs` — Call `loadLessons()` at startup (~line 618). Call `recordLesson()` after smart revert (lines 1379-1394).
- `orchestrator/agent-runner.mjs` — Inject relevant lessons into prompt (~line 234). Max 3 lessons per agent, matched by role and files-in-common.

**Schema:**
```json
{
  "lessons": [{
    "id": "uuid",
    "timestamp": "ISO",
    "trigger": "revert",
    "round": 5,
    "agentId": "balance-analyst",
    "role": "balance-analyst",
    "summary": "Modifying archetypes.ts and balance-config.ts in the same round caused test regression",
    "files": ["src/engine/archetypes.ts", "src/engine/balance-config.ts"],
    "relevance": ["balance-analyst", "engine-dev"]
  }]
}
```

**Implementation notes:**
- Cap at 30 lessons, FIFO eviction
- Atomic writes (write to temp, rename) to prevent corruption
- Relevance matching: by role AND by files-in-common
- Inject at most 3 relevant lessons per agent prompt (budget ~500 tokens)
- Graceful handling when file doesn't exist, is empty, or is malformed JSON

---

### M5: Run Completion Notification
**Effort:** LOW-MEDIUM (~40 lines + plugin)
**Impact:** HIGH for overnight runs

Activate the plugin system and create a notification plugin.

**Files to modify:**
- `orchestrator/orchestrator.mjs` — Change `enablePlugins: false` to `true` (line 122). Add `orchestration:complete` event (~3 lines before `process.exit()` at line 1795).
- New: `orchestrator/plugins/notify/plugin.json` + `index.mjs`

**Implementation notes:**
- Use the `post-round` hook via `executeHook()`, NOT raw EventBus (async handlers escape EventBus try/catch)
- Also add `orchestration-complete` hook for "run finished" notification (not just per-round)
- Use Node built-in `fetch()` for webhook POST — no npm dependency
- Make webhook URL configurable via env var or plugin.json config
- Basic retry (1 retry with 5s delay) for transient network failures
- Plugin system has never been enabled — test the `loadAll()` code path on Windows (dynamic `import()` with `pathToFileURL` is Windows-path-sensitive)

---

### M6: Environment Sanitization
**Effort:** MEDIUM (not LOW — Windows complexity)
**Impact:** MEDIUM — security hardening

Replace `env: { ...process.env }` with a whitelist at `agent-runner.mjs:416`.

**Files to modify:**
- `orchestrator/agent-runner.mjs` — Replace line 416's `{ ...process.env }` with `sanitizeEnv()` call.
- Also apply to `orchestrator/orchestrator.mjs` `runTests()` spawn (line 502) which inherits env implicitly.

**Critical Windows vars that MUST be whitelisted:**
- `PATH`, `HOME`, `USERPROFILE`, `NODE_PATH`, `NODE_ENV`
- `SYSTEMROOT`, `COMSPEC` — required for `shell: true` spawn on Windows
- `TEMP`, `TMP` — required for `os.tmpdir()`
- `APPDATA`, `LOCALAPPDATA` — required by npm/node on Windows
- `PROGRAMFILES`, `PROGRAMFILES(X86)`
- `ANTHROPIC_*`, `CLAUDE_*` — prefix-based allow for API auth and CLI config

**Implementation:** Prefix-based allowlist + explicit blocklist pattern, shared utility function.

---

### M7: Self-Review Cycle
**Effort:** LOW (use existing architecture)
**Impact:** MEDIUM — experimental

**Do NOT build a new introspection subsystem.** Instead:
1. Create a `self-reviewer.md` role template in `orchestrator/roles/`
2. Add it as a `continuous` agent with `minFrequencyRounds: 5` in mission configs
3. The agent reads `round-decisions.json`, `session-changelog.md`, and `backlog.json`
4. Writes recommendations to `orchestrator/analysis/self-review-round-N.md`

**Zero new modules needed.** Just a role template file and a mission config entry.

---

### M8: Orchestrator Checkpoint/Resume
**Effort:** HIGH (150-250 lines, new module)
**Impact:** MEDIUM — crash recovery for long overnight runs

Write orchestrator state to `orchestrator/checkpoint.json` at round boundaries. On startup, detect and resume from checkpoint.

**Minimum checkpoint payload (17 fields):**
- `round`, `globalStartTime`, `consecutiveTestFailures`, `lastTestStatus`, `stopReason`
- Per-agent maps: `lastRunRound`, `consecutiveAgentFailures`, `escalationCounts`, `consecutiveEmptyRounds`, `lastFailedRound`, `lastEscalatedRound`, `successesAfterEscalation`
- `costLog`, `roundLog`, `roundDecisions`
- `agentSessions`, `agentRuntimeHistory`, `agentEffectiveness`
- `missionState` (from mission-sequencer)
- `headSha` for git state validation

**Non-serializable state (re-initialize on resume):**
- `missionDAG` — re-create via `createDAGFromConfig()`
- `qualityGateChain` — re-create via `new QualityGateChain()`
- `obs` — re-create via `createObservability()`
- `pluginManager` — re-create via `new PluginManager()` + `loadAll()`
- `agentWorktrees` — clear (orphaned from crash)
- `activeProcs` — clear (all dead)

**Resume-time actions (in order):**
1. Validate checkpoint integrity (JSON parse, version check)
2. Validate git HEAD matches checkpoint's `headSha`
3. Re-run all `init*()` functions (idempotent)
4. `resetStaleAssignments()` + `cleanupAllWorktrees()`
5. Invalidate expired `agentSessions`
6. Restore serializable state
7. Continue from `round = checkpoint.round + 1`

**Implementation notes:**
- Atomic writes (temp + rename) for checkpoint file
- Do NOT checkpoint mid-round (dramatically harder)
- Validate mission config hasn't changed between crash and resume
- Should be done LAST — must account for state added by M1-M7

## Implementation Notes

### Recommended session grouping:
- **Session A:** M1 + M2 together (both modify agent-runner.mjs and handoff-parser.mjs, combined ~78 lines)
- **Session B:** M3 + M4 (pre-flight + lessons, both touch agent selection and prompt building)
- **Session C:** M5 (notification — first-time plugin system activation, needs careful testing)
- **Session D:** M6 + M7 (env sanitization + self-review role template)
- **Session E:** M8 (checkpoint/resume — largest milestone, standalone)

### Known risks:
- **No orchestrator unit tests.** All 908 tests are game engine tests. Every milestone is verified manually only.
- **`initAgentRunner` context bag is already 25+ dependencies.** M1 and M4 each add more. Consider refactoring to a shared context object if it gets unwieldy.
- **Plugin system never enabled in production.** M5 is first-time exercise of that code path on Windows.

## Sub-Agent Delegation Guide

**Constraint:** Sub-agents (Task tool) can only Read/Glob/Grep/explore. They CANNOT Write, Edit, or run Bash. All code changes must happen in the main context window.

### Session A: M1 (Failure Context) + M2 (Cross-Verification)

**Phase 1 — Parallel research (3 sub-agents simultaneously):**

| Agent | Type | Task |
|-------|------|------|
| Agent 1 | Explore | **M1 data threading:** Read `orchestrator/orchestrator.mjs` and `orchestrator/agent-runner.mjs`. Find: (1) exact location of `consecutiveAgentFailures` declaration and all places it's read/written, (2) the `initAgentRunner(ctx)` call and list every key currently in `ctx`, (3) how `processAgentResult()` receives agent exit code/stderr/timeout status, (4) the exact insertion point in `runAgent()` prompt construction for both fresh and resume paths. Report line numbers and surrounding code for each. |
| Agent 2 | Explore | **M2 git verification:** Read `orchestrator/git-ops.mjs` and `orchestrator/handoff-parser.mjs`. Find: (1) `gitExec()` function signature and how it's called, (2) worktree paths — how `agentWorktrees[id].path` is structured, (3) `parseHandoffMeta()` return shape including `filesModified` field, (4) `validateAgentOutput()` current checks, (5) the pool's `onAgentComplete` callback in orchestrator.mjs lines 1270-1283 and whether worktrees are still alive at that point. Report exact code snippets. |
| Agent 3 | Explore | **Existing patterns:** Read `orchestrator/agent-tracking.mjs`. Find: (1) how `agentRuntimeHistory` and `agentSessions` are threaded through init and used, (2) any existing `stripAnsi` or text sanitization utils in the codebase, (3) path normalization patterns used elsewhere (Windows `\\` to `/`). Also check if there's an existing ANSI strip utility in node_modules. |

**Phase 2 — Main context implements (sequential):**
1. Using Agent 1's findings, add `lastFailureDetails` map and populate it in `processAgentResult()`
2. Thread it through `initAgentRunner` ctx
3. Add prompt injection in `runAgent()` (both paths)
4. Using Agent 2's findings, add `verifyAgentOutput()` function
5. Wire it into the `onAgentComplete` callback
6. Run `npm test` to verify no regressions

---

### Session B: M3 (File Pre-Flight) + M4 (Lessons File)

**Phase 1 — Parallel research (2 sub-agents):**

| Agent | Type | Task |
|-------|------|------|
| Agent 1 | Explore | **M3 pre-flight context:** Read `orchestrator/orchestrator.mjs` lines 896-1075 (the `activeAgents` filter). Find: (1) every existing pre-flight check and its pattern, (2) where `agent.fileOwnership` is populated (mission loading), (3) examples of fileOwnership values across all mission configs in `orchestrator/missions/`, (4) which entries are globs vs literal paths. Also read any mission config files to get real `fileOwnership` arrays. |
| Agent 2 | Explore | **M4 lessons architecture:** Read `orchestrator/orchestrator.mjs` smart revert section (lines 1379-1394) and `orchestrator/git-ops.mjs` `smartRevert()`/`smartRevertWorktrees()` return values. Find: (1) what data is available when a revert triggers (round, agent IDs, files, strategy), (2) the startup initialization sequence in `main()` (~lines 571-618) for where `loadLessons()` would go, (3) how `readHandoffContentFn()` works in agent-runner.mjs as a pattern for injecting file content into prompts, (4) existing file I/O patterns (atomic writes, JSON load/save) used elsewhere in the codebase. |

**Phase 2 — Main context implements (sequential):**
1. Add file-existence check in the activeAgents filter using Agent 1's patterns
2. Create `orchestrator/lessons.mjs` module (load, save, append, query, prune)
3. Wire `loadLessons()` into startup, `recordLesson()` into smart revert path
4. Add lesson injection into agent prompts
5. Run `npm test`

---

### Session C: M5 (Notification Plugin)

**Phase 1 — Single research agent:**

| Agent | Type | Task |
|-------|------|------|
| Agent 1 | Explore | **Plugin system deep-dive:** Read `orchestrator/plugin-system.mjs` thoroughly. Find: (1) plugin manifest schema (`plugin.json` format), (2) `PluginManager.loadAll()` code path — especially `pathToFileURL` usage on Windows, (3) `executeHook()` mechanism — is it awaited? how are errors handled?, (4) `PluginContext` constructor — what's available to plugins, (5) the `post-round` hook call site in orchestrator.mjs, (6) check if `orchestrator/plugins/` directory exists. Also check if any example plugins exist anywhere. Report the exact plugin.json schema and the activate/deactivate lifecycle. |

**Phase 2 — Main context implements:**
1. Create `orchestrator/plugins/notify/plugin.json` and `index.mjs`
2. Add `orchestration:complete` event before `process.exit()` in orchestrator.mjs
3. Change `enablePlugins: false` to `true`
4. Run `npm test` + manual test of plugin loading

---

### Session D: M6 (Env Sanitization) + M7 (Self-Review Role)

**Phase 1 — Parallel research (2 sub-agents):**

| Agent | Type | Task |
|-------|------|------|
| Agent 1 | Explore | **M6 env analysis:** Read `orchestrator/agent-runner.mjs` line 416 context and `orchestrator/orchestrator.mjs` `runTests()` spawn. Find: (1) all `spawn()` calls across the codebase and their env handling, (2) what env vars are actually needed by Claude CLI (check if there's docs or --help output), (3) Windows-required env vars by checking Node.js docs or patterns. Also search for any existing env filtering/sanitization in the codebase. |
| Agent 2 | Explore | **M7 role template patterns:** Read 3-4 existing role templates in `orchestrator/roles/` (especially coordination roles like producer, tech-lead, game-designer). Find: (1) role template format and conventions, (2) how `continuous` agents are configured in mission configs, (3) `minFrequencyRounds` usage, (4) what files coordination agents typically read (round-decisions.json, session-changelog.md, etc.), (5) how analysis output files are structured. |

**Phase 2 — Main context implements:**
1. Create `sanitizeEnv()` utility, apply to both spawn sites
2. Create `orchestrator/roles/self-reviewer.md` role template
3. Add self-reviewer agent to mission configs
4. Run `npm test`

---

### Session E: M8 (Checkpoint/Resume)

**Phase 1 — Parallel research (2 sub-agents):**

| Agent | Type | Task |
|-------|------|------|
| Agent 1 | Explore | **State inventory audit:** Read `orchestrator/orchestrator.mjs` `main()` function completely. Catalog EVERY mutable variable, map, array, and counter in scope. For each, note: (1) where declared, (2) where mutated, (3) whether it's JSON-serializable, (4) whether it can be re-derived from disk on restart. Cross-check against the plan's "17 fields" list — find any we missed. |
| Agent 2 | Explore | **Module state audit:** Read `orchestrator/agent-tracking.mjs`, `orchestrator/mission-sequencer.mjs`, `orchestrator/cost-tracker.mjs`, `orchestrator/balance-analyzer.mjs`. For each module, find: (1) all exported mutable state, (2) the `init*()` function and whether it's idempotent, (3) any state that's already persisted to disk (and thus doesn't need checkpointing), (4) state that references class instances or functions (non-serializable). |

**Phase 2 — Main context implements:**
1. Create `orchestrator/checkpoint.mjs` (serialize, deserialize, validate)
2. Add checkpoint write at round boundary in main loop
3. Add checkpoint detection and resume at startup
4. Add resume-time cleanup (stale assignments, orphaned worktrees, expired sessions)
5. Run `npm test` + manual crash/resume test
