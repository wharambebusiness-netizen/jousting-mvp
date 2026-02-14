# Session 69 Handoff — Orchestrator Reliability M1-M5

**Date:** 2026-02-14
**Tests:** 908/908 passing
**Orchestrator:** v26 (22 modules, main: 1866 lines)

## What Was Done

Implemented **Milestones M1–M5** of the 8-milestone orchestrator reliability plan (`docs/orchestrator-reliability-plan.md`).

### Session A: M1 (Failure Context Injection) + M2 (Agent Output Cross-Verification)

**M1 — Failure Context Injection:**
- Added `lastFailureDetails = {}` map in orchestrator.mjs main() (~line 781), threaded through initAgentRunner ctx
- In `processAgentResult()` (agent-runner.mjs ~line 543): records `{ code, timedOut, stderrSummary, round, isEmptyWork }` on failure, deletes on success
- In `runAgent()` prompt construction (~line 233): injects failure context into BOTH fresh and resume prompt paths
- Differentiates timeout vs crash vs empty-work in injected text
- Added `stripAnsiCodes()` utility to sanitize stderr (strips `\x1b[...m`)
- Reset in `resetAgentTracking()`

**M2 — Agent Output Cross-Verification:**
- Added `verifyAgentOutput()` (~60 lines) to git-ops.mjs
- Uses `git status --porcelain` in worktree, normalizes Windows backslashes
- Excludes `orchestrator/**` paths
- Checks BOTH directions: unreported changes + phantom claims
- Wired into pre-merge phase in orchestrator.mjs (~line 1322), runs while worktrees still alive

### Session B: M3 (File Pre-Flight) + M4 (Cross-Session Lessons)

**M3 — File-Existence Pre-Flight:**
- Added after dependency checking in activeAgents filter (~line 1068)
- Filters out glob patterns (`*`, `?`, `{`), only checks literal paths
- Skips agent only if ALL literal fileOwnership files are missing
- Records skip decision in roundDecisions

**M4 — Cross-Session Lessons:**
- Created NEW module: `orchestrator/lessons.mjs` (148 lines)
- Functions: initLessons, loadLessons, saveLessons (atomic write), recordLesson, queryLessons, formatLessonsForPrompt
- Schema: `{ lessons: [{ id, timestamp, trigger, round, agentId, role, summary, files, relevance }] }`
- Max 30 lessons, FIFO eviction, relevance scoring by role + files-in-common
- Wired: loadLessons at startup, recordLesson after smart revert, queryLessons+format in agent prompts (fresh only)

### Session C: M5 (Notification Plugin)

- Created `orchestrator/plugins/notify/plugin.json` + `index.mjs`
- Plugin type: `hook`, hooks into `post-round` and `orchestration-complete`
- Sends webhook POST to `NOTIFY_WEBHOOK_URL` env var (disabled if not set)
- Retry logic: 1 retry with 5s delay
- Changed `enablePlugins: false` → `true` in CONFIG (line 123)
- Added `orchestration-complete` hook call before both `process.exit(42)` and `process.exit(1)` in orchestrator.mjs
- Normal exit: properly `await`s the hook; fatal error: fire-and-forget

## What Remains

### Session D: M6 (Env Sanitization) + M7 (Self-Review Role)

**Research is COMPLETE for both milestones.** Implementation details below:

#### M6 — Environment Sanitization

**Two spawn() calls need sanitization:**
1. `agent-runner.mjs:457` — Claude CLI agent execution: `env: { ...process.env }` (CRITICAL)
2. `quality-gates.mjs:199` — Quality gate command runner: `env: { ...process.env }` (HIGH)

All other spawn() calls (git-ops, balance-analyzer, orchestrator test runner, taskkill) either inherit env or don't need sanitization.

**Whitelist for `sanitizeEnv()` function:**
- Shell/Windows: `PATH`, `SYSTEMROOT`, `COMSPEC`, `TEMP`, `TMP`
- User profile: `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`
- Node: `NODE_ENV`, `NODE_PATH`, `NODE_OPTIONS`
- Windows programs: `PROGRAMFILES`, `PROGRAMFILES(X86)`
- API auth (prefix-based): `ANTHROPIC_*`, `CLAUDE_*`
- Orchestrator-specific: `NOTIFY_WEBHOOK_URL`

**Implementation plan:**
1. Create `sanitizeEnv()` utility function (in agent-runner.mjs or a shared util)
2. Replace `{ ...process.env }` at agent-runner.mjs:457
3. Replace `{ ...process.env }` at quality-gates.mjs:199
4. Use prefix-based allowlist pattern

#### M7 — Self-Review Role

**Zero new modules needed.** Just two files:

**File 1:** `orchestrator/roles/self-reviewer.md` — Role template following producer/tech-lead conventions:
- Each round: read round-decisions.json, session-changelog.md, backlog.json, agent handoffs
- Analyze patterns: stuck agents, blocked tasks, role imbalance, failure rates
- Output: `orchestrator/analysis/self-review-round-{N}.md`
- Severity levels: CRITICAL/WARNING/NOTE
- Never modify operational files (read-only analysis)

**File 2:** Add agent config entry to mission files (overnight.json, general-dev.json):
```json
{
  "id": "self-reviewer",
  "name": "Self-Reviewer",
  "type": "continuous",
  "role": "self-reviewer",
  "model": "haiku",
  "maxModel": "sonnet",
  "claudeMdPath": "CLAUDE-lite.md",
  "timeoutMs": 600000,
  "maxTasksPerRound": 0,
  "minFrequencyRounds": 5,
  "maxBudgetUsd": 2,
  "fileOwnership": ["orchestrator/analysis/self-review-round-*.md"],
  "tasks": { "primary": "Analyze orchestrator health..." }
}
```

### Session E: M8 (Checkpoint/Resume)

**Not yet researched.** The plan says:
- Create `orchestrator/checkpoint.mjs` (~150-250 lines)
- Serialize 17+ fields at round boundaries
- Resume on startup: validate HEAD SHA, re-init modules, cleanup stale state
- Should be done LAST since it must account for M1-M7 state

## Files Modified This Session

| File | Change | Lines |
|------|--------|-------|
| `orchestrator/orchestrator.mjs` | M1-M5 wiring, enablePlugins, orchestration-complete hook | 1866 |
| `orchestrator/agent-runner.mjs` | M1 failure context, M4 lesson injection | 618 |
| `orchestrator/git-ops.mjs` | M2 verifyAgentOutput() | 478 |
| `orchestrator/lessons.mjs` | M4 NEW module | 148 |
| `orchestrator/plugins/notify/plugin.json` | M5 NEW plugin manifest | 12 |
| `orchestrator/plugins/notify/index.mjs` | M5 NEW plugin entry | 60 |

## Key Architecture Notes

- Module count: 22 (was 21 before lessons.mjs)
- `initAgentRunner` ctx bag now has ~27 dependencies (M1 added lastFailureDetails+consecutiveEmptyRounds, M4 added queryLessons+formatLessonsForPrompt)
- Plugin system is NOW ENABLED (first time ever) — notify plugin loads from `orchestrator/plugins/notify/`
- `verifyAgentOutput()` runs pre-merge while worktrees are alive (NOT in onAgentComplete callback)
- Lessons file at `orchestrator/lessons.json` (auto-created on first revert)
