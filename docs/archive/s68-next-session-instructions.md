# Next Session Instructions (paste to new Claude)

## For Session A (M1 + M2):

```
I'm working on the Jousting project orchestrator. Read `docs/orchestrator-reliability-plan.md` — it has the full 8-milestone plan including a Sub-Agent Delegation Guide.

Start with **Session A: M1 (Failure Context Injection) + M2 (Agent Output Cross-Verification)**.

Follow the delegation guide in the plan:

**Phase 1 — Launch 3 research sub-agents in parallel:**

Agent 1 (Explore): M1 data threading — Read orchestrator/orchestrator.mjs and orchestrator/agent-runner.mjs. Find: (1) exact location of consecutiveAgentFailures and all read/write sites, (2) the initAgentRunner(ctx) call and every key in ctx, (3) how processAgentResult() receives exit code/stderr/timeout, (4) exact insertion point in runAgent() prompt construction for fresh AND resume paths. Report line numbers and surrounding code.

Agent 2 (Explore): M2 git verification — Read orchestrator/git-ops.mjs and orchestrator/handoff-parser.mjs. Find: (1) gitExec() signature and usage, (2) worktree path structure from agentWorktrees, (3) parseHandoffMeta() return shape including filesModified, (4) validateAgentOutput() current checks, (5) pool's onAgentComplete callback in orchestrator.mjs ~lines 1270-1283 and whether worktrees are still alive. Report exact snippets.

Agent 3 (Explore): Existing patterns — Read orchestrator/agent-tracking.mjs. Find: (1) how agentRuntimeHistory and agentSessions are threaded through init, (2) any stripAnsi or text sanitization utils, (3) path normalization patterns (Windows backslash to forward slash). Check node_modules for ANSI strip utils.

**Phase 2 — Implement in main context using agent findings:**
1. Add lastFailureDetails map in orchestrator.mjs main(), populate in processAgentResult()
2. Thread through initAgentRunner ctx
3. Add prompt injection in runAgent() — both fresh and resume paths
4. Add verifyAgentOutput() using git status --porcelain
5. Wire into onAgentComplete callback
6. Run npm test to verify 908 tests still pass

Key constraints:
- Sub-agents can only Read/Glob/Grep — all edits happen in main context
- Cap stderr injection to 500 chars, strip ANSI codes
- Use git status --porcelain (not git diff) to catch untracked files too
- Exclude orchestrator/** from cross-verification (agents always touch handoff files)
- Log discrepancies as warnings, don't block
```

---

## For Session B (M3 + M4):

```
I'm continuing the orchestrator reliability plan. Read `docs/orchestrator-reliability-plan.md` for full context.

This is **Session B: M3 (File-Existence Pre-Flight) + M4 (Cross-Session Lessons File)**.

Follow the delegation guide:

**Phase 1 — Launch 2 research sub-agents in parallel:**

Agent 1 (Explore): M3 pre-flight context — Read orchestrator/orchestrator.mjs lines 896-1075 (activeAgents filter). Find: (1) every existing pre-flight check pattern, (2) where agent.fileOwnership is populated, (3) actual fileOwnership values from all mission configs in orchestrator/missions/, (4) which are globs vs literal paths.

Agent 2 (Explore): M4 lessons architecture — Read orchestrator/orchestrator.mjs smart revert section (~lines 1379-1394) and orchestrator/git-ops.mjs smartRevert()/smartRevertWorktrees() returns. Find: (1) data available when revert triggers, (2) startup init sequence for where loadLessons() goes, (3) how readHandoffContentFn() works as a pattern for file injection, (4) existing atomic write / JSON patterns in codebase.

**Phase 2 — Implement:**
1. Add file-existence check in activeAgents filter (skip globs containing * ? {)
2. Only skip agent if ALL literal files missing, not just one
3. Create orchestrator/lessons.mjs (load, save, append, query, prune — 30 cap FIFO)
4. Wire loadLessons() into startup, recordLesson() into smart revert
5. Inject max 3 relevant lessons per agent prompt, matched by role + files
6. Run npm test
```

---

## For Session C (M5):

```
I'm continuing the orchestrator reliability plan. Read `docs/orchestrator-reliability-plan.md`.

This is **Session C: M5 (Run Completion Notification)**.

**Phase 1 — Launch 1 research agent:**

Agent 1 (Explore): Plugin system deep-dive — Read orchestrator/plugin-system.mjs thoroughly. Find: (1) plugin.json manifest schema, (2) loadAll() code path + pathToFileURL Windows concerns, (3) executeHook() — is it awaited? error handling?, (4) PluginContext constructor — what's available, (5) post-round hook call site in orchestrator.mjs, (6) does orchestrator/plugins/ directory exist?

**Phase 2 — Implement:**
1. Create orchestrator/plugins/notify/plugin.json and index.mjs
2. Use post-round hook via executeHook (NOT raw EventBus — async errors escape try/catch)
3. Add orchestration:complete event + hook before process.exit() in orchestrator.mjs
4. Change enablePlugins: false to true (line 122)
5. Use Node built-in fetch() for webhook POST, configurable URL via env var
6. Run npm test + manually verify plugin loads
```

---

## For Session D (M6 + M7):

```
I'm continuing the orchestrator reliability plan. Read `docs/orchestrator-reliability-plan.md`.

This is **Session D: M6 (Environment Sanitization) + M7 (Self-Review Role)**.

**Phase 1 — Launch 2 research sub-agents in parallel:**

Agent 1 (Explore): M6 env analysis — Read orchestrator/agent-runner.mjs line 416 and orchestrator/orchestrator.mjs runTests() spawn. Find: (1) all spawn() calls and their env handling, (2) Windows-required env vars (SYSTEMROOT, COMSPEC, TEMP, APPDATA etc.), (3) any existing env filtering in codebase.

Agent 2 (Explore): M7 role patterns — Read 3-4 role templates in orchestrator/roles/ (especially coordination roles). Find: (1) template format, (2) how continuous agents with minFrequencyRounds work in mission configs, (3) what files coordination agents read, (4) analysis output conventions.

**Phase 2 — Implement:**
1. Create sanitizeEnv() with prefix-based allowlist (ANTHROPIC_*, CLAUDE_*) + Windows essentials + explicit blocklist
2. Apply to agent-runner.mjs spawn AND orchestrator.mjs runTests() spawn
3. Create orchestrator/roles/self-reviewer.md template
4. Add self-reviewer as continuous agent with minFrequencyRounds: 5 in mission configs
5. Run npm test
```

---

## For Session E (M8):

```
I'm continuing the orchestrator reliability plan. Read `docs/orchestrator-reliability-plan.md`.

This is **Session E: M8 (Orchestrator Checkpoint/Resume)** — the largest milestone.

**Phase 1 — Launch 2 research sub-agents in parallel:**

Agent 1 (Explore): State inventory — Read orchestrator/orchestrator.mjs main() completely. Catalog EVERY mutable variable, map, array, counter. For each: where declared, where mutated, JSON-serializable?, re-derivable from disk? Cross-check against plan's 17-field list.

Agent 2 (Explore): Module state — Read agent-tracking.mjs, mission-sequencer.mjs, cost-tracker.mjs, balance-analyzer.mjs. For each: exported mutable state, init() idempotency, state already on disk, non-serializable references.

**Phase 2 — Implement:**
1. Create orchestrator/checkpoint.mjs (serialize, deserialize, validate)
2. Atomic writes (temp file + rename)
3. Checkpoint write at round boundary in main loop
4. Checkpoint detection + resume at startup
5. Resume cleanup: resetStaleAssignments(), cleanupAllWorktrees(), invalidate expired sessions
6. Validate headSha matches and mission config unchanged
7. Run npm test + manual crash/resume test
```
