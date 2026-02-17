# Session 77 Handoff

## Summary
Built **M1: Walking Skeleton** — the auto-continuation CLI daemon using the Agent SDK. The end-to-end loop (spawn session → monitor context → parse handoff → auto-commit → chain fresh session) works and was tested successfully.

## What Was Done

### 1. Agent SDK Installed
- `@anthropic-ai/claude-agent-sdk` v0.2.44 added via npm
- SDK exists, is production-ready, and has comprehensive API (query, hooks, sessions, permissions)

### 2. Operator CLI Daemon — `operator/operator.mjs`
Created the walking skeleton with these capabilities:

**CLI interface:**
- `node operator/operator.mjs "task description"` — run a task with auto-continuation
- `--max-turns N` — turns per session (default: 30)
- `--max-continuations N` — max chain length (default: 5)
- `--model sonnet|opus|haiku` — model selection
- `--dry-run` — print config and exit
- `--permission-mode` — SDK permission mode (default: bypassPermissions)

**Session chain runner:**
- Spawns Claude sessions via SDK `query()` with streaming output
- Monitors `PreCompact` hook (fires when context filling up, injects "wrap up" message)
- Parses `## HANDOFF` section from agent output to determine completion status
- Auto-commits between sessions via git
- Chains fresh sessions with previous handoff as context
- Caps at configurable max continuations (default 5)
- Saves per-session metrics (turns, cost, duration) to `operator/last-chain.json`

**Key implementation details:**
- Strips `CLAUDECODE` env var to allow SDK sessions from within a Claude Code parent session
- Falls back to output tail (last 2000 chars) when agent hits max-turns without writing handoff
- System prompt instructs agent to write `## HANDOFF: COMPLETE` or `## HANDOFF` with remaining work
- `stderr` callback captures SDK diagnostic output for logging

### 3. Testing — End-to-End Chain Verified
- **Simple task (3 turns):** Created file, read it back, wrote HANDOFF: COMPLETE — 1 session, $0.07, 14s
- **Multi-session task (2 turns/session, 3 continuations):** Read archetypes.ts + attacks.ts, created combined output — 3 sessions, $0.23, 49s. Session 1 hit max-turns, session 2 continued, session 3 completed.

## Files Modified
- `operator/operator.mjs` — NEW: 310-line CLI daemon
- `package.json` / `package-lock.json` — Agent SDK dependency added
- `CLAUDE.md` — Added operator/ to architecture and commands sections
- `docs/session-history.md` — Added S77 entry
- `docs/archive/handoff-s77.md` — This file

## Test Status
- **1219 tests ALL PASSING** across 19 suites (unchanged)

## What's Next

### M1 Hardening (optional, before M2)
- Add `--watch` mode for continuous operation (file watcher or stdin loop)
- Better handling of very-low maxTurns where agent can't write handoff in time
- Add a `--system-prompt` option to inject custom CLAUDE.md-like instructions
- Parse cost by model from `resultData.modelUsage` for accurate per-model tracking
- Add `maxBudgetUsd` pass-through for cost capping

### M2: Robust Session Management
- Session registry (persist chain state across operator restarts)
- Error recovery: crash-report handoffs, retry with backoff
- Cost tracking per chain (build on existing cost-tracker.mjs patterns)
- Circuit breaker: abort chain if costs exceed threshold
- Handoff validation: verify handoff structure before continuing
- Audit log: persistent log of all sessions
- Configurable policies (max cost, max time, max turns per chain)

### M3: Orchestrator Agent Self-Continuation
- Integrate session wrapper into `agent-runner.mjs` / `sdk-adapter.mjs`
- Agents detect context limits, generate handoff, respawn transparently
- Cap at 2-3 continuations per agent per round

## Relevant Agent SDK API (from research)

```
query({ prompt, options })          → AsyncGenerator<SDKMessage>
  options.model                     Model ID string
  options.maxTurns                  Turn limit
  options.maxBudgetUsd              Cost cap
  options.cwd                       Working directory
  options.permissionMode            "bypassPermissions" | "default" | "acceptEdits"
  options.allowDangerouslySkipPermissions  Required for bypassPermissions
  options.allowedTools              Array of tool names
  options.hooks                     In-process async callbacks
  options.env                       Custom environment variables
  options.resume                    Session ID to resume
  options.continue                  Continue most recent session
  options.forkSession               Fork session (new branch from resume point)
  options.stderr                    Stderr callback

Message types:
  system:init           → session_id, model, cwd, tools
  assistant             → message.content[].text
  result                → subtype, total_cost_usd, num_turns, usage, modelUsage
  system:compact_boundary → compact_metadata.pre_tokens

Hook events: PreToolUse, PostToolUse, PreCompact, Stop, SessionStart, SessionEnd, Notification
  → Return { systemMessage, hookSpecificOutput, continue: false }
```
