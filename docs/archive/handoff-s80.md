# Session 80 Handoff

## Summary
Built Operator M3 (Orchestrator Agent Self-Continuation) — design spike completed, continuation wrapper implemented, wired into agent-runner, tested. When `useSDK: true` in orchestrator config, agents that fill their context window or run out of turns auto-continue transparently.

## What Was Done

### 1. Design Spike — Session Continuity Audit
Launched a focused research agent to audit all 7 design questions. Key findings:
- **No conflict** between operator-level continuation (M1 PreCompact hook) and orchestrator session continuity (`agent-tracking.mjs`) — they operate at different levels (operator chains the orchestrator process, orchestrator chains individual agents)
- **PreCompact hooks are per-process** — no risk of double-firing
- **Session invalidation works as-is** — after continuation, only the final session ID matters
- **Multi-project isolation confirmed** — separate processes, UUID-based, no cross-project state

### 2. `runAgentWithContinuation()` — `orchestrator/sdk-adapter.mjs` (v23)
- New wrapper around `runAgentViaSDK()` with continuation loop
- **PreCompact hook**: injected into each session, fires when context fills → triggers continuation
- **Continuation trigger heuristics**:
  - PreCompact fires → always continue
  - hitMaxTurns + no HANDOFF: COMPLETE → continue
  - HANDOFF: COMPLETE → never continue (done)
  - No handoff + no limits hit → don't continue
- **Cost guardrails**: `maxChainCostUsd` (default $2.00), `MAX_CONTINUATIONS_CAP` (hardcoded 3)
- **parseChainHandoff()**: extracts `## HANDOFF` sections from agent output (same protocol as operator)
- **buildContinuationPrompt()**: constructs handoff-based prompts for continuation sessions
- **runAgentViaSDKWithHooks()**: enhanced SDK runner with hooks, env, permissionMode support
- Returns combined result: total cost/tokens summed, output concatenated, sessionId = final session
- New `createAgentOptions()` fields: `permissionMode`, `env`

### 3. Agent Runner Integration — `orchestrator/agent-runner.mjs`
- Added conditional SDK path: when `SDK_MODE && CONFIG.useSDK`, uses `runAgentWithContinuation()` instead of CLI spawn
- Uses Promise `.then()/.catch()` (not `await`) since `runAgent()` is inside a Promise constructor
- Maps SDK result to CLI-compatible shape: `{ agentId, code, timedOut, elapsed, stdout, stderr, wasResumed }`
- Adds extra fields for continuation-aware callers: `continuations`, `finalSessionId`, `preCompacted`
- Updates `agentSessions[agentId]` with final session ID after continuation chain
- Calls `recordContinuationFn()` when continuations occurred

### 4. Agent Tracking — `orchestrator/agent-tracking.mjs`
- New `recordContinuation(agentId, chainLength)` function
- Tracks `lastContinuations` and `totalContinuations` on agentSessions entries
- Tracks `totalContinuations` in agentEffectiveness metrics (signals agents need more focused tasks)

### 5. Orchestrator Config — `orchestrator/orchestrator.mjs`
- New CONFIG fields:
  - `maxAgentContinuations: 2` — max continuation sessions per agent per round (cap 3)
  - `maxAgentChainCostUsd: 2.0` — max cost across continuation chain per agent
  - `maxAgentTurns: 30` — max turns per individual session within a chain
- Feature logging updated: shows continuation config when SDK enabled
- `recordContinuation` wired through to initAgentRunner

### 6. Tests — `orchestrator/continuation.test.mjs` (NEW, 28 tests)
- `parseChainHandoff`: null handling, complete/incomplete parsing, case-insensitive, edge cases (multiple handoffs, long output, no subsections)
- `recordContinuation`: session tracking, accumulation, no-op for missing sessions, effectiveness metrics
- `createAgentOptions M3`: permissionMode, env, allowDangerouslySkipPermissions
- `continuation trigger heuristics`: COMPLETE stops, incomplete + signal continues, no handoff stops
- `config constants`: MAX_CONTINUATIONS_CAP=3, DEFAULT_CHAIN_COST_CAP=2.0

## Files Modified
- `orchestrator/sdk-adapter.mjs` (ENHANCED — v22→v23, added ~200 lines: continuation wrapper, handoff parsing, SDK runner with hooks)
- `orchestrator/agent-runner.mjs` (ENHANCED — added ~70 lines: SDK continuation path with result mapping)
- `orchestrator/agent-tracking.mjs` (ENHANCED — added ~20 lines: recordContinuation function)
- `orchestrator/orchestrator.mjs` (ENHANCED — added M3 config fields, recordContinuation import+wiring, feature logging)
- `orchestrator/continuation.test.mjs` (NEW — 28 tests)
- `CLAUDE.md` (updated test counts, sdk-adapter description)
- `docs/operator-plan.md` (updated status, changelog)
- `docs/session-history.md` (S80 entry)
- `docs/archive/handoff-s80.md` (NEW — this file)

## Test Status
- **1298 tests ALL PASSING** across 22 suites (21 existing + 1 new continuation suite)

## Architecture Notes

### How Continuation Works
```
Orchestrator round starts
  → agent-runner.mjs builds prompt (same as before)
  → if SDK_MODE && CONFIG.useSDK:
      → runAgentWithContinuation() in sdk-adapter.mjs
        → Session 1: runAgentViaSDKWithHooks() with PreCompact hook
        → PreCompact fires? Parse handoff → build continuation prompt
        → Session 2: fresh session with handoff context
        → ... up to MAX_CONTINUATIONS_CAP (3)
        → Return combined result to agent-runner
      → agent-runner maps to CLI-compatible result shape
  → else:
      → spawn('claude', cliArgs) (existing CLI path, no continuation)
```

### Activation
Continuation is opt-in via `useSDK: true` in CONFIG or mission config. When disabled (default), the CLI path is used and agents run exactly as before — zero behavioral change.

### Multi-Project Safety
- No new cross-project state is introduced
- Continuation is per-agent, per-round, ephemeral
- Agent-tracking state is in-memory per-process
- Registry is unaffected (continuation is orchestrator-internal)

## What's Next

### Immediate: M4 — HTTP API Layer
Read `docs/operator-plan.md` section "M4: HTTP API Layer". Express + WebSocket server exposing operator and orchestrator state. New dependency: `express` + `ws`.

### After M4: M5 — Web UI Dashboard
Server-rendered HTML dashboard (HTMX + Pico CSS, no build pipeline).

### Continuation Enhancement Ideas (post-M6)
- CLI-based continuation (parse handoff from stdout, re-spawn with `--resume`) — would work without SDK
- Per-agent continuation override (`maxContinuations` in agent config)
- Continuation cost reporting in overnight reports
- Smart continuation trigger (predict whether agent needs continuation based on task complexity)
