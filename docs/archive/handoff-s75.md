# Session 75 Handoff

## Summary
Bumped orchestrator to v29, fixed a critical async bug in the agent pool that prevented proper agent awaiting, added handoff test isolation via env var, and added a coord-agent integration test.

## What Was Done

### 1. Orchestrator Version Bump to v29 — DONE
- Updated version string in `orchestrator/orchestrator.mjs` line 3 and banner at line 821
- Updated all `v28` references in `CLAUDE.md` to `v29`

### 2. Agent Pool Async Bug Fix (CRITICAL) — DONE
- **Root cause**: `runAgentPool()` in `agent-pool.mjs` was marked `async` but called without `await` in the orchestrator. This meant `pool` was a `Promise<{allDone, groupDone}>` rather than the object directly. `pool.groupDone` and `pool.allDone` were `undefined`, so the orchestrator never actually waited for agents to complete.
- **Impact**: In production, agents would be launched but their completion was never awaited between rounds. Agents ran to completion eventually (via background `.then()` handlers), but the orchestrator raced through rounds without waiting. The dry-run integration tests masked this because stale handoff files in the shared `orchestrator/handoffs/` directory had `all-done` status, making agents appear retired.
- **Fix**: Removed `async` keyword from `runAgentPool()` since it doesn't use `await` internally. Now the function returns `{allDone, groupDone, results}` directly instead of wrapping it in a Promise.

### 3. Integration Test Handoff Isolation (MEDIUM) — DONE
- Added `ORCH_HANDOFF_DIR` env var support to `orchestrator.mjs` (line 52): `process.env.ORCH_HANDOFF_DIR || join(ORCH_DIR, 'handoffs')`
- Integration tests now pass `ORCH_HANDOFF_DIR` pointing to a temp directory, preventing stale file pollution
- Cleaned up stale handoff files (`agent-a.md`, `agent-b.md`, `dev.md`, `qa.md`) from the shared directory

### 4. Coord Agent Lifecycle Test — DONE
- Added integration test verifying that feature agents with coord roles (e.g., `tech-lead`) properly retire in dry-run mode
- Confirms exit code 42 and "all agents exhausted" message

## Files Modified
- `orchestrator/orchestrator.mjs` — v29 bump, ORCH_HANDOFF_DIR env var support
- `orchestrator/agent-pool.mjs` — removed spurious `async` from `runAgentPool`
- `orchestrator/dry-run-integration.test.mjs` — handoff isolation via env var, new coord agent test
- `CLAUDE.md` — v29 references, test count 1218→1219

## Test Status
- **1219 tests ALL PASSING** across 19 suites (8 engine + 11 orchestrator)
- New tests: +1 (dry-run-integration: 5→6)

## What's Next
1. **More scenario presets** — Could add `--dry-run=slow` (long delays), `--dry-run=flaky` (intermittent failures)
2. **Feature work** — MVP game features at 100%, balance zeroed out. Good time for new game features, UI polish, or orchestrator ecosystem improvements.
3. **Production validation** — The pool await fix should be tested with a real multi-agent mission to confirm proper round-by-round execution.
