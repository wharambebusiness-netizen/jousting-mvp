# Session 76 Handoff

## Summary
Planning session for a new **Operator UI** system — a web-based control surface for managing Claude Code sessions with auto-continuation, orchestrator management, and handoff automation. Three review agents analyzed the initial plan from technical feasibility, UX/workflow, and Claude Code capabilities perspectives. The result is a revised 6-milestone plan.

## What Was Done

### 1. Operator UI Milestone Plan — DESIGNED
Designed an 8-milestone plan, then had 3 specialized agents review it:

- **Technical Feasibility Agent**: Found that ~60-70% of M1-M3 already exists in orchestrator modules. Identified that "inject mid-session" doesn't work with `-p` mode. Recommended Agent SDK over CLI spawning.
- **UX/Workflow Agent**: Reordered milestones to front-load automation loop over UI. Recommended cutting multi-orchestrator milestone. Suggested server-rendered HTML over React SPA.
- **Claude Code Capabilities Agent**: Documented all relevant CLI flags, hooks (`PreCompact`, `Stop`, statusline `context_window.used_percentage`), Agent SDK (`@anthropic-ai/claude-agent-sdk`), and session resume mechanisms.

### 2. Revised 6-Milestone Plan — FINALIZED

**M1: Walking Skeleton** — CLI daemon: Agent SDK query → context monitoring via token counts + `PreCompact` hook → handoff generation via `Stop` hook → auto-commit → fresh session with handoff. One command: `node operator/operator.mjs --watch --auto-handoff`. Cap continuations at 5.

**M2: Robust Session Management** — Session registry, error recovery (crash-report handoffs, retry with backoff), cost tracking per chain, circuit breaker, handoff validation, audit log, configurable policies.

**M3: Orchestrator Agent Self-Continuation** — Integrate session wrapper into `agent-runner.mjs`/`sdk-adapter.mjs`. Agents detect context limits, generate handoff, respawn. Transparent to orchestrator. Cap at 2-3 continuations per agent per round.

**M4: HTTP API Layer** — Express/Fastify importing existing orchestrator modules directly. Pipe EventBus to WebSocket. REST for sessions/missions/reports/costs.

**M5: Web UI Dashboard** — Server-rendered HTML (HTMX/Alpine.js). Dashboard, session view with live output, chain timeline, orchestrator view, handoff viewer/editor.

**M6: Orchestrator Management & Git Integration** — Mission launcher from UI, overnight report viewer, auto-push, PR creation via `gh`.

### Key Architecture Decisions
- **Agent SDK** (`@anthropic-ai/claude-agent-sdk`) is the execution layer, not CLI subprocess spawning
- **Build on existing modules** — `agent-runner`, `agent-pool`, `observability`, `checkpoint`, `cost-tracker`, `handoff-parser`, `git-ops` become the backend library
- **Context monitoring** via SDK token counts + `PreCompact` hook + statusline `used_percentage` — NOT output volume proxy
- **Session continuation** via `Stop` hook (block stop, request handoff) + `--max-turns` for deterministic length
- **Server-rendered HTML** for UI, not React SPA — no build pipeline, upgrade later if needed
- **Multi-orchestrator (original M8) was CUT** — speculative, causes over-engineering

## Files Modified
- None (planning session only)

## Test Status
- **1219 tests ALL PASSING** across 19 suites (unchanged from S75)

## What's Next
1. **Start M1: Walking Skeleton** — Build the end-to-end auto-continuation loop as a CLI daemon using the Agent SDK. This is the foundation everything else builds on.
2. Key first steps for M1:
   - Install `@anthropic-ai/claude-agent-sdk`
   - Create `operator/` directory structure
   - Build session wrapper with SDK `query()` + streaming
   - Implement context monitoring (token tracking from SDK messages)
   - Implement `Stop` hook to trigger handoff generation
   - Parse handoff, auto-commit, spawn fresh session with handoff
   - Test with a simple task that exceeds a low `--max-turns` limit
3. Reference the Agent SDK docs and existing `sdk-adapter.mjs` for integration patterns.

## Relevant Claude Code Mechanisms (from research)
```
CLI flags:
  -p / --print          Non-interactive mode
  --resume SESSION_ID   Resume specific session
  --output-format stream-json   Structured streaming
  --max-turns N         Deterministic session length
  --max-budget-usd N    Cost cap per session
  --dangerously-skip-permissions   Autonomous mode

Hooks:
  PreCompact     Fires when auto-compaction triggers (context full)
  Stop           Can block stop and force continuation with reason
  SessionStart   Inject additional context
  PostToolUse    Monitor tool execution

Statusline data:
  context_window.used_percentage   Real-time context usage
  context_window.remaining_percentage

Env vars:
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE   Control compaction trigger %
  CLAUDE_CODE_MAX_OUTPUT_TOKENS     Max output tokens (default 32k)

Agent SDK:
  query()         Async generator yielding structured messages
  resume option   Session continuation
  forkSession     Fork without modifying original
  Hooks as in-process callbacks (not shell scripts)
```
