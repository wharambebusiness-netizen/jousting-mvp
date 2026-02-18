# Next Session Instructions (S82)

## Task: Review & Harden M1-M3, then Build M5 Web UI Dashboard

### Phase 1: Review & Bug-Fix M1, M2, M3

Before starting M5, launch parallel review/test agents to audit the operator M1-M3 code. These milestones were built across S77-S80 and haven't had the same thorough review treatment that M4 received in S81.

**Files to review:**

| Milestone | Files | Tests |
|-----------|-------|-------|
| M1 (Walking Skeleton) | `operator/operator.mjs` (~520 lines) | Manual testing only (no dedicated test suite) |
| M2 (Session Management) | `operator/registry.mjs`, `operator/errors.mjs` | `operator/__tests__/registry.test.mjs` (15 tests), `operator/__tests__/errors.test.mjs` (36 tests) |
| M3 (Agent Self-Continuation) | `orchestrator/sdk-adapter.mjs` (v23), `orchestrator/agent-runner.mjs`, `orchestrator/agent-tracking.mjs` | `orchestrator/continuation.test.mjs` (28 tests) |

**What to look for:**
- Memory leaks, unclosed resources, dangling promises
- Edge cases in error recovery (errors.mjs circuit breaker, retry logic)
- Race conditions in operator.mjs chain loop (SDK streaming + PreCompact hook timing)
- Registry corruption scenarios (concurrent writes, crash during atomic save)
- Handoff parsing edge cases (malformed output, empty handoffs, very long output)
- Cost tracking accuracy (accumulated costs, budget enforcement)
- Multi-project isolation (projectDir filtering, path normalization on Windows)
- SDK adapter continuation logic (cost caps, continuation count limits, PreCompact hook behavior)
- Missing test coverage (operator.mjs has NO unit tests — consider adding)

**Approach:** Launch 3 agents in parallel:
1. **M1 reviewer** — deep review of `operator/operator.mjs` (the main daemon). Focus on the chain loop, session runner, handoff parsing, git commit integration, and CLI argument handling. Look for bugs, missing error handling, and edge cases. Suggest tests if operator.mjs lacks coverage.
2. **M2 reviewer** — review `registry.mjs` and `errors.mjs` + their test suites. Focus on persistence reliability (atomic writes, crash recovery, archival), error classification accuracy, retry/circuit-breaker correctness, and handoff validation edge cases.
3. **M3 reviewer** — review `sdk-adapter.mjs` continuation wrapper, `agent-runner.mjs` SDK path, and `agent-tracking.mjs` continuation tracking. Focus on cost accumulation, continuation trigger heuristics, PreCompact hook behavior, session ID handoff, and interaction with operator-level continuation.

Fix all bugs found. Add tests where coverage is weak. Run full test suite after fixes. Commit the review round before moving to Phase 2.

---

### Phase 2: Build M5 — Web UI Dashboard

Read `docs/operator-plan.md` section "M5: Web UI Dashboard" for the full spec. Key points:

**Stack:**
- Server-rendered HTML (no React, no build pipeline)
- HTMX (CDN) for dynamic updates
- Pico CSS (CDN) for styling — dark mode default
- Alpine.js (CDN) for minimal client-side state
- Express static serving from `operator/public/`
- HTML fragment templates as JS functions in `operator/views/`

**Pages to build:**
1. **Dashboard (`/`)** — Active chains, live status, total costs, kill button, quick-start form
2. **Chain Detail (`/chains/:id`)** — Session timeline, per-session stats, expandable handoffs, cost breakdown
3. **Orchestrator View (`/orchestrator`)** — Round status, agent cards, live output (only when orchestrator is running)

**Key design decisions:**
- M5 is **read-only + kill switch** — no editing, no launching missions, no config changes (that's M6)
- The quick-start form on dashboard IS included (POST to create chain)
- WebSocket for live updates (connect to existing `/ws` endpoint from M4)
- Dark mode default (developer tool)
- Responsive (check overnight runs from phone)
- Multi-project aware: project selector/filter in nav, per-project views

**File structure:**
```
operator/
  public/
    index.html         Dashboard page
    chain.html         Chain detail page
    orchestrator.html  Orchestrator view
    style.css          Custom styles
  views/
    chain-row.mjs      Chain row HTML fragment
    session-card.mjs   Session detail card
    agent-card.mjs     Agent status card
  server.mjs           Add static file serving + view routes
```

**Modify `server.mjs`** to serve static files and add HTML page routes. The M4 API endpoints remain unchanged.

**Testing:** Add tests for view fragment rendering (pure functions → easy to test). Integration test: fetch HTML pages, verify they load with correct structure. WebSocket live update: verify events flow through to UI.

---

## Reference

- Handoff: `docs/archive/handoff-s81.md`
- Operator plan: `docs/operator-plan.md` (M5 section)
- Current test count: 1348 tests, 23 suites (all passing)
- Dependencies already installed: `express`, `ws`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
