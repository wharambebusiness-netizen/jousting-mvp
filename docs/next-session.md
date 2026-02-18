# Next Session Instructions (S90)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S89

S89 completed React polish (design tokens, arrow nav, transition guards, AI extraction). 1430 tests, 24 suites, all passing. Commit `d71db4e` pushed to `origin/master`.

## Operator Architecture Overview

The operator is a **3-page HTMX web app** (~2,980 lines) built on Express + WebSocket + Pico CSS v2 dark theme. Zero npm frontend dependencies — Pico CSS, HTMX 2.0.4, and marked.js are loaded from CDN.

**Pattern**: Static HTML shells load fragments via HTMX polling. Server returns pure HTML strings (no template engine). WebSocket used only for the live orchestrator log.

### File Map

```
operator/
  server.mjs              (243 lines) Express app factory, route mounting, static serving
  ws.mjs                  (211 lines) WebSocket event bridge (14 bridged events, pattern subscriptions)
  registry.mjs            Chain persistence (atomic writes, CRUD, archival)
  errors.mjs              Error classification, retry, circuit breaker
  operator.mjs            (840 lines) CLI daemon — NOT part of web UI

  routes/
    chains.mjs            (367 lines) 8 endpoints: CRUD, sessions, costs, projects
    orchestrator.mjs      (261 lines) 6 endpoints: status, missions, start/stop, reports
    git.mjs               (171 lines) 4 endpoints: status, push, commit, PR
    views.mjs             (355 lines) 8 HTMX fragment routes (the rendering layer)

  views/
    helpers.mjs           (55 lines) escapeHtml, formatCost, formatDuration, relativeTime
    chain-row.mjs         (43 lines) Chain table row renderer
    session-card.mjs      (75 lines) Session card + timeline + cost bar
    agent-card.mjs        (30 lines) Agent status cards (minimal — just ID, status, role)

  public/
    index.html            (122 lines) Dashboard: cost cards, new-chain form, git status, chain table
    orchestrator.html     (187 lines) Mission launcher, status, live log, report viewer
    chain.html            (57 lines)  Chain detail: timeline, sessions, handoffs
    style.css             (801 lines) Full design system: 50+ tokens, 29 sections
```

### Design System (`operator/public/style.css`)

801-line design system layered over Pico CSS v2 dark theme. Linear/Vercel-inspired palette.

Key conventions:
- **Tokens**: 4 bg layers (`--bg-root` through `--bg-overlay`), 3 border shades, 4 text levels, 5 status colors, accent gold
- **Spacing**: 4px scale via `--space-*` tokens
- **Cards**: subtle borders (`rgba(white, 6-10%)`), hover brightens border
- **Status dots**: 8px colored circles, running gets glow + pulse animation
- **Tables**: sticky headers, uppercase muted columns, row hover
- **HTMX patterns**: skeleton shimmer during loads, opacity fade on swaps
- **Toasts**: fixed bottom-right, slide-up, left border for type
- **Nav**: sticky top, backdrop blur, pill-shaped active link

Full reference: `memory/web-design.md`

### Test Suite (159 operator tests across 4 files)

| File | Tests | Pattern |
|------|-------|---------|
| `server.test.mjs` | 55 | Real HTTP server + fetch + ws |
| `views.test.mjs` | 40 | Unit (renderers) + HTTP (routes) |
| `registry.test.mjs` | 21 | File I/O + direct calls |
| `errors.test.mjs` | 43 | Pure unit tests |

No mocking framework used. All tests use real HTTP servers on random ports with temp directories.

### WebSocket Protocol

- Client→Server: `{ "subscribe": ["chain:*"] }`, `{ "unsubscribe": [...] }`, `{ "type": "ping" }`
- Server→Client: `{ "event": "chain:started", "data": {...} }`, `{ "type": "pong" }`
- Pattern matching: exact, `*` (all), prefix wildcard (`chain:*`)
- `session:output` throttled to 1 msg/sec/client

## Operator Improvement Roadmap

### Priority 1: UX Polish (Easy-Medium)

1. **Toast integration for all API actions** — Chain restart, git push, abort, commit, PR creation should all show toasts. Currently only orchestrator start/stop shows toasts. The toast system exists in the HTML pages but isn't wired to most API responses.

2. **Report auto-refresh** — After orchestrator runs, report viewer should poll for new reports. Currently static — requires manual page reload.

3. **Agent cards need more data** — Currently only show ID, status, and role. Should display cost, turn count, duration, files modified. The data is available from EventBus events.

4. **Chain table improvements** — No pagination UI (hardcoded to 50). No sorting. No search/filter beyond project. Add client-side column sorting or server-side sort params.

### Priority 2: Missing M6 Features (Medium)

5. **Model tier override in mission launcher** — The start form only has mission + dry-run. Add model dropdown (sonnet/haiku/opus) to override the mission's default.

6. **Report filtering** — Filter reports by date, mission name, or status. Currently a flat list.

7. **Side-by-side handoff viewer** — Chain detail shows handoffs in expandable `<details>`. A proper viewer would show prev handoff | session output | next handoff side-by-side for easier review.

8. **Auto-push toggle** — Persistent UI toggle for auto-pushing after each chain session completes. Currently push is manual only.

9. **Branch auto-generation** — Generate branch names from task description when starting chains.

10. **PR body auto-generation** — Build PR body from chain summary (sessions, costs, files changed) instead of relying on `--fill`.

### Priority 3: New Pages & Features (Medium-Large)

11. **Multi-project dashboard** — Project selector in nav, filter all views by project, project-specific cost summaries. The API already supports `?project=` filtering.

12. **Settings page** — Configure defaults: model, max turns, max continuations, budget cap, auto-push, project directory.

13. **Session output viewer** — Currently only handoff content is viewable. Add a route to serve full session output text (terminal-style viewer with ANSI color support).

14. **Real-time chain progress** — Use WebSocket to live-update chain status, session progress, and cost as chains run. Currently requires polling.

### Priority 4: Test Coverage Gaps

15. **Git endpoint tests** — `POST /api/git/push` and `POST /api/git/pr` have zero tests. Commit success path untested.
16. **Malformed request body tests** — No tests for invalid JSON, oversized payloads, missing Content-Type.
17. **Agent card renderer** — Very minimal. Add tests for cost/duration display once agent cards are enriched.

## Running the Operator

```bash
node operator/server.mjs                    # API server on http://127.0.0.1:3100
node operator/server.mjs --port 8080        # Custom port
node operator/server.mjs --operator         # Combined mode (API + operator daemon)
```

Dashboard at http://127.0.0.1:3100, Orchestrator at http://127.0.0.1:3100/orchestrator.

## Working Style Reminder

- **Use Task subagents aggressively** for research/exploration (they CANNOT write/edit)
- Do all edits yourself in the main context
- Full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Run `npm test` to verify after changes (1430 tests, 24 suites)

## Reference

- Handoff: `docs/archive/handoff-s89.md`
- Operator plan: `docs/operator-plan.md` (M1-M6 specs, some M6 features still unimplemented)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
