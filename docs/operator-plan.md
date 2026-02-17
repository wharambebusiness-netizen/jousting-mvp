# Operator System — Architecture & Milestone Plan

Created: S78 (2026-02-17)
Status: M1 COMPLETE (S77), M2-M6 planned

## Context

The **Operator** is a meta-layer that runs Claude sessions autonomously, monitors context limits, and chains fresh sessions with handoff context when work is incomplete. It enables long-running tasks that exceed a single session's context window and will eventually provide a web UI for monitoring and controlling orchestrator runs.

M1 (Walking Skeleton) is done: `operator/operator.mjs` (472 lines) runs an end-to-end auto-continuation loop via the Agent SDK. Tested with simple and multi-session tasks.

### Existing Infrastructure to Build On

The orchestrator already has mature modules that the operator will reuse rather than reinvent:

| Module | What it provides | Operator usage |
|--------|-----------------|----------------|
| `cost-tracker.mjs` | API cost parsing, model pricing | M2: per-chain cost tracking |
| `checkpoint.mjs` | Atomic JSON write, checkpoint/resume | M2: session registry persistence |
| `observability.mjs` | StructuredLogger, MetricsCollector, EventBus | M4: pipe EventBus to WebSocket |
| `git-ops.mjs` | Git backup, tagging, worktree management | M2: auto-push; M6: PR creation |
| `agent-runner.mjs` | Agent spawning, prompt building | M3: integrate self-continuation |
| `sdk-adapter.mjs` | Agent SDK wrapper, handoff schema | M3: continuation support |
| `agent-tracking.mjs` | Session continuity, runtime history | M3: session invalidation rules |
| `handoff-parser.mjs` | Handoff META parsing, validation | M2: handoff validation |
| `plugin-system.mjs` | Plugin architecture (6 types) | M4: API as plugin (optional) |

### Current M1 Architecture

```
operator/
  operator.mjs        CLI daemon (472 lines)
  handoffs/            Per-session handoff files (chain-0.md, chain-1.md, ...)
  last-chain.json      Most recent chain metrics
```

Core loop: `parseCliArgs() → runChain() → [runSession() × N] → save chain log`

Each `runSession()`:
1. Builds system prompt (initial task or continuation with previous handoff)
2. Calls Agent SDK `query()` with streaming + `PreCompact` hook
3. Collects output text, extracts cost from result message
4. Parses `## HANDOFF` section from output
5. Returns `{ output, handoff, cost, sessionId, turns, durationMs }`

Between sessions: auto-commit via git, build next prompt from handoff.

---

## Milestones

### M2: Robust Session Management

**Effort:** MEDIUM-HIGH (~300-400 lines across 2-3 files)
**Impact:** HIGH — makes overnight runs reliable
**Depends on:** M1 (done)

The operator currently has no persistence, no error recovery, no cost limits, and no way to resume after a crash. This milestone makes it production-grade for unattended operation.

#### 2a. Session Registry & Chain Persistence

Persist chain state to `operator/registry.json` after every session completes. On startup, check for incomplete chains and offer to resume.

**Schema:**
```json
{
  "version": 1,
  "chains": [{
    "id": "uuid",
    "task": "original task description",
    "status": "running|complete|failed|max-continuations|aborted",
    "startedAt": "ISO",
    "updatedAt": "ISO",
    "config": { "model": "...", "maxTurns": 30, "maxContinuations": 5 },
    "sessions": [{
      "index": 0,
      "sessionId": "sdk-session-id",
      "status": "complete|error|timeout",
      "turns": 3,
      "costUsd": 0.07,
      "durationMs": 14000,
      "hitMaxTurns": false,
      "preCompacted": false,
      "handoffComplete": false,
      "handoffFile": "operator/handoffs/chain-0.md",
      "error": null
    }],
    "totalCostUsd": 0.23,
    "totalTurns": 10,
    "totalDurationMs": 49000
  }]
}
```

**Files to modify:**
- `operator/operator.mjs` — Extract registry logic to new module, update `runChain()` to persist after each session
- New: `operator/registry.mjs` — Load, save, create chain, update session, find incomplete chains

**Implementation notes:**
- Atomic writes (temp + rename) following `checkpoint.mjs` pattern
- On startup with `--resume` flag, find latest incomplete chain and continue from last session
- Without `--resume`, starting a new chain while one is incomplete → warn but allow (don't block)
- Registry doubles as the audit log (no separate audit file needed)
- Cap registry at 50 chains, archive older ones to `operator/registry-archive.json`

#### 2b. Error Recovery

When a session crashes (SDK throws, process dies, network error), generate a crash-report handoff and retry with backoff.

**Current behavior:** Session error is caught (line 304-309), appended to outputText as `[SESSION ERROR: ...]`, then chain continues with no handoff context — next session is blind.

**New behavior:**
1. Catch error, classify it: `transient` (network, timeout, rate limit) vs `fatal` (auth, invalid model, SDK bug)
2. For transient errors: retry with exponential backoff (1s, 4s, 16s), max 3 retries per session
3. For fatal errors: abort chain, log error, update registry
4. For any error: generate a synthetic handoff from available output (`output.slice(-3000)` + error message)
5. After 3 consecutive session failures: abort chain (circuit breaker)

**Error classification heuristics:**
- Contains "rate limit", "429", "overloaded", "timeout" → transient
- Contains "authentication", "401", "403", "invalid model" → fatal
- SDK throws with `.code` property → check code
- Default: treat as transient (retry is safer than abort)

#### 2c. Cost Tracking & Circuit Breaker

Track cumulative cost per chain. Abort if cost exceeds configurable budget.

**New CLI flags:**
- `--max-budget-usd N` — Chain-level cost cap (default: 5.00)
- `--max-session-cost-usd N` — Per-session cost cap (passed to SDK's `maxBudgetUsd`)

**Implementation:**
- After each session, check `chainLog.totalCostUsd > config.maxBudgetUsd`
- If exceeded: abort chain, commit current state, log reason
- Also pass `maxBudgetUsd` through to SDK `query()` options for per-session enforcement
- Use `MODEL_PRICING` from `cost-tracker.mjs` for consistent pricing

#### 2d. Handoff Validation

Before continuing a chain, validate the handoff structure. Currently `parseHandoff()` does regex matching but doesn't validate content quality.

**Validation rules:**
1. Handoff must exist (non-null) — if missing after a non-error session, retry that session once with explicit "write your HANDOFF now" prompt
2. `summary` field must be non-empty (at least 20 chars)
3. If not complete, `remaining` field must be non-empty
4. Total handoff text must be under 10,000 chars (prevent context pollution)
5. If validation fails after retry: continue with synthetic handoff (output tail + warning)

#### 2e. Auto-Push & Notifications

After a chain completes (or aborts), optionally push to remote and send a notification.

**New CLI flags:**
- `--auto-push` — Push to remote after chain completion
- `--notify-webhook URL` — POST chain summary to webhook URL

**Implementation:**
- Auto-push: call `git push` via `gitExec()` (only if remote exists, only on success/max-continuations, never on error)
- Webhook: `fetch(url, { method: 'POST', body: JSON.stringify(chainSummary) })` with 1 retry
- Also support env vars: `OPERATOR_AUTO_PUSH=1`, `OPERATOR_NOTIFY_WEBHOOK=https://...`

**Files to modify/create:**
- `operator/operator.mjs` — Integrate registry, error recovery, cost checks, validation, auto-push
- New: `operator/registry.mjs` — Chain persistence and querying
- New: `operator/errors.mjs` — Error classification, retry logic, circuit breaker (optional — could inline)

**Testing:**
- Unit tests for registry CRUD, error classification, handoff validation, cost circuit breaker
- Integration test: start a chain, kill mid-session, resume and verify continuation
- Manual: run overnight task with `--max-budget-usd 1.00` and verify it stops

---

### M3: Orchestrator Agent Self-Continuation

**Effort:** HIGH (~200-300 lines across 3-4 files)
**Impact:** HIGH — orchestrator agents can handle larger tasks without context death
**Depends on:** M2 (error recovery and cost tracking must exist first)

Currently, orchestrator agents that fill their context window simply stop (or compact and lose context). M3 makes agents auto-continue transparently — the orchestrator doesn't know its agents are chaining internally.

#### Design Spike (Do First)

Before building, resolve the interaction between two existing continuation mechanisms:

**Operator-level continuation** (M1):
- Triggered by `PreCompact` hook
- Generates `## HANDOFF` section
- Spawns fresh session with handoff as context
- Used for top-level operator chains

**Orchestrator-level session continuity** (`agent-tracking.mjs`):
- Uses `--resume SESSION_ID` / `--session-id` CLI flags
- Persists `agentSessions[agentId]` across rounds
- Has invalidation rules: revert, merge conflict, empty rounds, age (5 rounds), fresh count
- Purpose: agents retain context of the project across orchestrator rounds

**Key questions to resolve:**
1. Can both mechanisms coexist? (Yes — they operate at different levels: operator chains across the top-level task, orchestrator sessions persist agent memory across rounds)
2. When an orchestrator agent chains via M3, does it get a new session ID? (Yes — the continuation is a fresh session. The orchestrator should update `agentSessions[agentId]` with the final session ID.)
3. What happens to session invalidation? (Agent session should be invalidated if any continuation in the chain triggered a revert. The final session ID is what matters for the next round.)
4. Should M3 use the same `## HANDOFF` protocol as M1? (Yes — same parsing, same format. Reuse `parseHandoff()` from `operator.mjs`.)

#### Implementation

**Approach:** Wrap the existing `sdk-adapter.mjs` `runAgentSDK()` function with a continuation layer. When an agent's `PreCompact` hook fires, capture the handoff, spawn a fresh session, and return the combined result to the orchestrator as if it were a single session.

**Files to modify:**
- `orchestrator/sdk-adapter.mjs` — Add `runAgentWithContinuation()` wrapper around existing `runAgentSDK()`
  - Accept `maxContinuations` option (default: 2, cap: 3)
  - `PreCompact` hook: inject "wrap up" message (same as operator M1)
  - After session ends: parse handoff, check if continuation needed
  - If continuing: build continuation prompt, spawn fresh session, accumulate cost/turns
  - Return combined result: total cost = sum of all sessions, output = concatenated, session ID = last one
- `orchestrator/agent-runner.mjs` — In `runAgent()`, call `runAgentWithContinuation()` instead of `runAgentSDK()` when agent's estimated work exceeds single-session capacity
  - Thread `maxAgentContinuations` from config (or per-agent override)
  - Update `agentSessions[agentId]` with the final session ID from the chain
- `orchestrator/agent-tracking.mjs` — Add `recordContinuation(agentId, chainLength)` for tracking which agents frequently chain (signal they need more focused tasks)

**Continuation trigger heuristics:**
- `PreCompact` fires → always continue (context genuinely full)
- `hitMaxTurns` + no `HANDOFF: COMPLETE` → continue (ran out of turns but not done)
- `HANDOFF: COMPLETE` → never continue (done)
- No handoff + no limits hit → don't continue (probably finished or errored)

**Cost guardrails:**
- Per-agent continuation cost cap: `config.maxAgentChainCostUsd` (default: $2.00)
- Per-agent continuation count cap: 3 (hardcoded — agents shouldn't need more)
- If both agents in a round are chaining, total round cost can spike — log a warning

**What the orchestrator sees:**
- Agent took `N` turns and `$X.XX` (combined across continuations)
- Agent modified files (combined across continuations)
- Agent session ID = final session (for next-round resume)
- Agent `preCompacted = true` flag (so orchestrator knows it was a large task)

---

### M4: HTTP API Layer

**Effort:** MEDIUM (~400-500 lines, new file)
**Impact:** MEDIUM — foundation for M5 web UI
**Depends on:** M2 (registry, cost tracking)

REST + WebSocket server that exposes operator and orchestrator state. Imports existing modules directly — no separate backend process.

#### Architecture

```
operator/
  server.mjs          HTTP server (Express or Fastify)
  routes/
    chains.mjs        GET /api/chains, GET /api/chains/:id, POST /api/chains/:id/abort
    sessions.mjs      GET /api/chains/:id/sessions/:idx
    orchestrator.mjs   GET /api/orchestrator/status, POST /api/orchestrator/start
    costs.mjs         GET /api/costs/summary
  ws.mjs              WebSocket handler (pipe EventBus)
```

**Decision: Express vs Fastify**

Use **Express** (v4). Reasons:
- Zero-config, already widely known
- No build step, no TypeScript required
- Fastify's perf advantages irrelevant for single-user tool
- Express v4 is stable and will not break

**Dependency:** `express` + `ws` (WebSocket library). No other dependencies.

#### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/chains` | List all chains from registry (paginated) |
| GET | `/api/chains/:id` | Chain detail with all sessions |
| POST | `/api/chains` | Start new chain `{ task, model, maxTurns, maxContinuations }` |
| POST | `/api/chains/:id/abort` | Abort running chain (graceful — waits for current session) |
| DELETE | `/api/chains/:id` | Remove chain from registry |
| GET | `/api/chains/:id/sessions/:idx` | Session detail including handoff file content |
| GET | `/api/chains/:id/sessions/:idx/output` | Raw session output text |
| GET | `/api/costs` | Cost summary across all chains |
| GET | `/api/orchestrator/status` | Current orchestrator state (if running) |
| POST | `/api/orchestrator/start` | Start orchestrator run `{ mission, dryRun }` |
| POST | `/api/orchestrator/stop` | Graceful stop of orchestrator |
| GET | `/api/health` | Server health check |

#### WebSocket

Single WebSocket endpoint at `/ws`. Clients subscribe to event streams:

```json
{ "subscribe": ["chain:*", "session:*", "orchestrator:*"] }
```

Events piped from operator's internal state changes:
- `chain:started`, `chain:session-complete`, `chain:complete`, `chain:error`, `chain:aborted`
- `session:output` (live streaming — throttled to 1 msg/sec)
- `orchestrator:round-start`, `orchestrator:agent-complete`, `orchestrator:round-complete`

**Implementation:** Operator maintains an internal EventEmitter. `runSession()` emits events as it processes SDK messages. WebSocket handler bridges EventEmitter → connected clients.

#### Running the Server

```bash
node operator/server.mjs                    # Start API server (default port 3100)
node operator/server.mjs --port 8080        # Custom port
node operator/server.mjs --operator         # Also start operator daemon (combined mode)
```

The server can run standalone (monitoring only) or combined with the operator (monitoring + execution). In combined mode, starting a chain via API is equivalent to running `operator.mjs` with those args.

**Files to create:**
- `operator/server.mjs` — Express app, route registration, WebSocket setup
- `operator/routes/chains.mjs` — Chain CRUD endpoints
- `operator/routes/orchestrator.mjs` — Orchestrator control endpoints
- `operator/ws.mjs` — WebSocket event bridge

**Implementation notes:**
- Import `registry.mjs` directly for chain data (no database)
- Import `observability.mjs` EventBus for orchestrator events
- CORS enabled for local development (`localhost` only)
- No authentication (single-user tool on localhost)
- Graceful shutdown: close WebSocket connections, wait for running sessions, save registry

---

### M5: Web UI Dashboard (Read-Only MVP)

**Effort:** MEDIUM (~500-600 lines HTML/JS/CSS)
**Impact:** HIGH for usability — visual monitoring beats log tailing
**Depends on:** M4 (API endpoints)

Server-rendered HTML dashboard. No build pipeline, no React, no npm frontend dependencies. Uses HTMX for dynamic updates and a minimal CSS framework (Pico CSS or similar CDN-loaded).

#### Pages

**1. Dashboard (`/`)**
- Active chains with live status indicators (running/complete/failed)
- Current session progress (turns used, cost so far)
- Total cost across all chains (today / all time)
- Kill button for running chains (POST to abort endpoint)
- Quick-start form: task input + model select + go

**2. Chain Detail (`/chains/:id`)**
- Timeline visualization: sessions as blocks on a horizontal timeline
- Per-session: turns, cost, duration, status, handoff status
- Expandable handoff content (click to view)
- Session output viewer (scrollable, monospace)
- Cost breakdown chart (simple bar — no charting library, use CSS widths)

**3. Orchestrator View (`/orchestrator`)**
- Only visible when orchestrator is running or has recent history
- Current round number, active agents, test status
- Per-agent status cards (running/complete/failed/reverted)
- Live output stream (WebSocket → HTMX swap)
- Round history with expandable details

#### Technology Stack

- **Server:** Express (from M4) + `express.static` for HTML files
- **Templating:** HTML files with HTMX attributes for dynamic content. Server returns HTML fragments for HTMX requests, full pages for direct navigation.
- **Styling:** Pico CSS (classless, loaded from CDN) + `<style>` overrides in HTML
- **Interactivity:** HTMX (loaded from CDN) for AJAX + Alpine.js (CDN) for client-side state
- **Live updates:** HTMX SSE extension or WebSocket extension for real-time data

**No npm frontend dependencies.** Everything loaded from CDN or inline.

#### File Structure

```
operator/
  public/
    index.html         Dashboard page
    chain.html         Chain detail page
    orchestrator.html  Orchestrator view
    style.css          Custom styles (minimal — Pico does most of it)
  server.mjs           Serves static files + API (from M4)
  views/               Server-side HTML fragment templates (for HTMX partial responses)
    chain-row.mjs      Render a single chain row as HTML string
    session-card.mjs   Render session detail card
    agent-card.mjs     Render agent status card
```

**Implementation notes:**
- HTML templates are JS functions that return HTML strings (no template engine dependency)
- HTMX polls `/api/chains` every 5s for dashboard updates (or WebSocket push)
- Chain detail page loads once, then receives WebSocket pushes for live session
- Orchestrator view only appears in nav when orchestrator data exists
- Responsive layout (works on phone for checking overnight runs)
- Dark mode default (developer tool — light backgrounds are hostile at 2 AM)

#### What is NOT in M5 (deferred to M6)

- No editing handoffs from UI
- No launching missions from UI
- No git operations from UI
- No configuration changes from UI

M5 is **read-only + kill switch**. You watch, you stop if needed, that's it.

---

### M6: Orchestrator Management from UI

**Effort:** MEDIUM (~300-400 lines)
**Impact:** MEDIUM — convenience, not capability (everything M6 does is already possible via CLI)
**Depends on:** M5 (dashboard exists)

Adds write operations to the dashboard: launching tasks, managing orchestrator runs, viewing reports.

#### Features

**6a. Mission Launcher**
- Form on dashboard: select mission config from `orchestrator/missions/` dropdown
- Options: dry-run mode, model tier override, custom agent count
- Start button → POST to `/api/orchestrator/start`
- Live redirect to orchestrator view

**6b. Report Viewer**
- List of past orchestrator reports from `orchestrator/reports/`
- Rendered markdown → HTML (use `marked` library, CDN-loaded)
- Filter by date, mission, status

**6c. Handoff Viewer**
- Browse handoff files from any chain
- Side-by-side view: previous handoff → session output → next handoff
- Read-only in M6 (editing adds complexity with no clear value yet)

**6d. Git Integration**
- Auto-push toggle in UI (sets `OPERATOR_AUTO_PUSH` for current server session)
- PR creation button: after chain completion, click to create PR via `gh pr create`
- Branch name auto-generated from task description
- PR body auto-generated from chain summary (sessions, costs, handoff history)

**Files to create/modify:**
- `operator/routes/orchestrator.mjs` — Add start/stop endpoints (extend from M4)
- `operator/routes/reports.mjs` — Report listing and rendering
- `operator/routes/git.mjs` — Push and PR creation endpoints
- `operator/public/mission-launcher.html` — Mission launch form
- `operator/public/reports.html` — Report browser
- `operator/views/report-card.mjs` — Report listing HTML fragment

---

## Cross-Cutting Concerns

### Process Supervision

The operator process itself can crash. For overnight reliability:

**M2 provides:** Chain state persistence (registry.json). On restart, `--resume` continues the last incomplete chain.

**Beyond M2 (optional):** Wrap operator in a process manager:
- Windows: `node --watch operator/server.mjs` (Node 18+ watch mode restarts on crash)
- Or: npm `pm2` package for production process management
- Or: simple `while true; do node operator/server.mjs; sleep 5; done` bash wrapper

This is deliberately NOT built into the operator itself. External process supervision is a solved problem — don't reinvent it.

### Logging Strategy

| Layer | Mechanism | Location |
|-------|-----------|----------|
| Operator chain logs | `last-chain.json` + `registry.json` | `operator/` |
| Per-session handoffs | Markdown files | `operator/handoffs/` |
| HTTP server access | Express request logging (morgan) | stdout |
| Orchestrator runs | `StructuredLogger` from `observability.mjs` | `orchestrator/logs/` |
| Live streaming | WebSocket events | In-memory only |

### Security

This is a **localhost-only single-user tool**. Security model:
- Server binds to `127.0.0.1` (not `0.0.0.0`)
- No authentication (no cookies, no tokens, no sessions)
- No HTTPS (localhost only)
- CORS restricted to `http://localhost:*`
- `--auto-push` requires explicit opt-in (don't accidentally push to remote)
- `bypassPermissions` mode only available via CLI flag, not via API

If this ever needs to be exposed to a network, add authentication as a prerequisite. Do not expose the current design to the internet.

### Testing Strategy

| Milestone | Test approach |
|-----------|---------------|
| M2 | Unit tests for registry, error classification, handoff validation, circuit breaker. Integration test for crash-resume. |
| M3 | Unit tests for continuation logic. Integration test with low `maxTurns` to force continuation. |
| M4 | Supertest for REST endpoints. Manual WebSocket testing. |
| M5 | Manual browser testing. Screenshot comparison for layout regressions (optional). |
| M6 | Manual testing. E2E test: launch mission from UI → verify orchestrator starts. |

Test files go in `operator/__tests__/` to keep them separate from engine and orchestrator tests.

---

## Delegation Guide

Each milestone can be delegated to the orchestrator or run as operator chains. Follow the research-then-implement pattern from the orchestrator reliability plan.

### M2 Delegation

**Phase 1 — Research (2-3 sub-agents in parallel):**

| Agent | Task |
|-------|------|
| Registry patterns | Read `orchestrator/checkpoint.mjs` (atomic write pattern), `operator/operator.mjs` `runChain()` and `last-chain.json` structure. Map every state mutation in `runChain()` that needs to be persisted. Report exact insertion points for registry saves. |
| Error analysis | Read `operator/operator.mjs` lines 265-309 (session runner error handling). Catalog all error types the SDK can throw. Read Agent SDK types/docs for error shape. Research Node.js `fetch()` error types for webhook delivery. |
| Cost integration | Read `orchestrator/cost-tracker.mjs` for `MODEL_PRICING` and `parseCostFromStderr()`. Read operator.mjs lines 314-322 for current cost extraction. Map how to integrate orchestrator's cost utilities into operator. |

**Phase 2 — Implement (main context, sequential):**
1. Create `operator/registry.mjs` with load/save/create/update/query
2. Refactor `runChain()` to persist state after each session
3. Add error classification and retry logic
4. Add `--max-budget-usd` flag and circuit breaker
5. Add handoff validation with retry
6. Add `--auto-push` and `--notify-webhook`
7. Add `--resume` flag for crash recovery
8. Write tests in `operator/__tests__/registry.test.mjs` and `operator/__tests__/errors.test.mjs`

### M3 Delegation

**Phase 1 — Design spike (1 focused sub-agent):**

| Agent | Task |
|-------|------|
| Session continuity audit | Read `orchestrator/agent-tracking.mjs` (session invalidation rules, lines 27-43 and all `invalidateAgentSession` call sites), `orchestrator/sdk-adapter.mjs` (full file), `orchestrator/agent-runner.mjs` (runAgent function and session resume logic). Map: (1) How does orchestrator decide to resume vs fresh-start an agent? (2) What session data flows through `agentSessions`? (3) Where does `sdk-adapter.mjs` pass session ID to SDK? (4) What happens to session state after a smart revert? Document the full lifecycle of an agent session across rounds, and identify exactly where continuation would be inserted. |

**Phase 2 — Implement (main context, sequential):**
1. Add `runAgentWithContinuation()` to `sdk-adapter.mjs`
2. Wire it into `agent-runner.mjs` `runAgent()` function
3. Update session tracking to record final session ID from chains
4. Add `maxAgentContinuations` to config
5. Test with low `maxTurns` forcing a continuation

### M4 Delegation

**Phase 1 — Research (1 sub-agent):**

| Agent | Task |
|-------|------|
| API design | Read `operator/registry.mjs` (from M2) for available chain data. Read `orchestrator/observability.mjs` EventBus API. Research Express 4 + ws WebSocket integration patterns. Propose route structure and WebSocket event format. |

**Phase 2 — Implement:**
1. `npm install express ws`
2. Create `operator/server.mjs` with Express app
3. Create route files for chains, orchestrator, costs
4. Create WebSocket handler bridging operator events
5. Manual test with curl + wscat

### M5 Delegation

**Phase 1 — Research (1 sub-agent):**

| Agent | Task |
|-------|------|
| UI patterns | Research HTMX + Pico CSS integration patterns. Find examples of HTMX + WebSocket for live updates. Propose page structure and HTMX attribute usage. Check Pico CSS dark mode API. |

**Phase 2 — Implement:**
1. Create `operator/public/` directory with HTML files
2. Create `operator/views/` with HTML fragment renderers
3. Wire server to serve static files and return HTML fragments for HTMX
4. Manual browser testing

### M6 Delegation

Straightforward CRUD extensions. No research phase needed — just build on M4/M5 patterns.

---

## Recommended Session Grouping

| Session | Milestone | Estimated effort | Key risk |
|---------|-----------|-----------------|----------|
| A | M2a-M2c | Registry + error recovery + cost | Largest code change to operator.mjs |
| B | M2d-M2e | Handoff validation + auto-push | Depends on session A's registry |
| C | M3 | Agent self-continuation | Most architecturally complex — design spike first |
| D | M4 | HTTP API | New dependency (Express) — first server code |
| E | M5 | Web UI | Frontend code — different skill than backend |
| F | M6 | Orchestrator management | Builds on everything above |

Sessions A and B can be combined if context allows. Sessions D and E can be combined if the implementor is comfortable with full-stack work in a single session.

---

## Changelog

- S78: Initial plan created (reviewed and revised from S76 planning session)
