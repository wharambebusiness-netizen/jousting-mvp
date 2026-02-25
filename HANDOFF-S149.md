# HANDOFF — Session 149

## What Happened This Session

**Full code review of Phases 20-50**, followed by bug fixes. Six parallel review agents scanned all implementation files, tests, and routes for bugs, security issues, missing functionality, and performance problems. Five fix agents generated exact diffs, which were then applied.

**Commit `79bf7c6`**: 26 bug fixes across 24 files. Pushed to origin/master.
**All 3,728 tests passing** across 66 suites.

### Key Fixes Applied

| Severity | Fix |
|----------|-----|
| CRITICAL | XSS in search palette — escaped all innerHTML user data in `app.js` |
| HIGH | Vault `_fromJSON()` validates entry fields before loading |
| HIGH | EventBus listener leak in claude-pool — added `destroy()` method |
| HIGH | Audit log uses in-memory counter (was reading full file on every write) |
| HIGH | Health `ready()` reflects actual system state (was always returning true) |
| HIGH | Cost forecaster uses aggregator's `globalTotalUsd` for budget calcs |
| HIGH | Timeline query no longer silently truncated to 50 results |
| HIGH | Bulk archive: 1 load + 1 save instead of N each |
| HIGH | Session list `total` reports pre-pagination count |
| HIGH | Percentile sampling fixed: circular buffer by time, not biased eviction |
| MEDIUM | 15 additional fixes: decrypt error masking, cache skips error responses, error handler hides 500 internals, addTask clones input, DLQ nullish coalescing, notifications cleanup on shutdown, completion timers cleared, swarm config whitelist, crash count lineage, webhook timer cleanup, bulk retry random IDs, JSONL content-type, monotonic Prometheus counter, route limit cap, WS replay subscription filter |

---

## The Operator System — Complete Feature Reference

The Jousting Operator is a full-stack multi-agent orchestration platform built on Express + WebSocket. It manages chains of Claude sessions, coordinates multi-agent task execution, and provides a real-time web UI for monitoring and control.

**Stack**: Node.js, Express, WebSocket, Pico CSS v2 dark theme, HTMX 2.0, xterm.js, vanilla JS. Zero npm frontend dependencies.

### Architecture Overview

```
operator/
├── server.mjs              — Main server: Express + WS, 50+ subsystem init
├── operator.mjs            — CLI auto-continuation daemon
├── Core Modules (24)       — Auth, logging, validation, search, vault, etc.
├── coordination/ (11)      — Task queue, rate limiting, cost tracking, etc.
├── routes/ (25)            — REST API endpoints
├── middleware/ (4)          — Request ID, caching, rate headers, perf tracking
├── views/ (9)              — Server-side HTMX fragment renderers
├── public/ (7 pages)       — Dashboard, terminals, taskboard, timeline, etc.
└── __tests__/ (44 suites)  — 1,434+ operator tests
```

### Web UI — 7 Pages

| Page | URL | Purpose |
|------|-----|---------|
| **Dashboard** | `/` | Chain list, cost summary, quick-start, orchestrator status, analytics charts (cost timeline, status donut, model bars), health/terminals/tasks/notifications/cost widgets |
| **Chain Detail** | `/chains/:id` | Session timeline, handoff history, cost breakdown, real-time WS updates |
| **Terminals** | `/terminals` | Multi-terminal xterm.js interface — dual types (orchestrator output + Claude interactive PTY), 8 color themes, tab/grid layouts (single/split-h/split-v/triple/quad), binary WS, keyboard shortcuts, auto-handoff toggles, task bridge, message panel, session history, shared memory viewer |
| **Task Board** | `/taskboard` | Kanban board + DAG visualization, drag-and-drop, real-time WS updates, add/cancel/retry, filter/search, detail/edit dialog, batch operations, 5 task templates |
| **Settings** | `/settings` | Model, max-turns, max-continuations, max-budget, permission-mode, auto-push, webhooks, per-user preferences |
| **Projects** | `/projects` | File tree explorer, git status badges, file preview, project cards |
| **Timeline** | `/timeline` | Activity feed from audit log, 7 categories (planning, development, testing, debugging, review, deployment, documentation), counts per category |

Design: Deep-space dark theme (accent=#6366f1, success=#10b981, warning=#f59e0b, error=#ef4444, info=#22d3ee), animated space particles, sidebar navigation. Full design system reference: `memory/web-design.md`.

### REST API — 100+ Endpoints Across 25 Route Files

**Chain Management** — CRUD, session detail, cost summary, project listing
**Orchestrator Control** — Multi-instance start/stop/status, mission listing
**Coordination** — Task CRUD+PATCH, progress, DAG graph, templates, lifecycle (start/drain/stop), rate-limit status, cost status, metrics, adaptive rate status, hot-reconfigure, category detection
**Claude Terminals** — List, spawn, resize, kill, respawn, toggle permissions/auto-handoff/auto-dispatch/auto-complete, claim/release/complete tasks, pool status
**Terminal Sessions** — List, detail, resume, clone, templates (save/load/delete/spawn)
**Shared Memory** — Key-value CRUD with prefix filtering, terminal snapshot CRUD
**Terminal Messages** — List, send (broadcast/targeted/threaded), unread tracking, mark-read
**Audit Log** — Query with filters (action, actor, target, since/until), pagination, stats
**Dead Letter Queue** — List, detail, retry (re-queues to task queue), dismiss, stats
**Cost Forecast** — Full forecast (burn rate, budget exhaustion alerts), burn rate only, reset alerts
**Export** — Tasks, audit, messages, dead-letters in CSV/JSON/JSONL formats
**Timeline** — Enriched activity feed with category filtering, summary counts
**Webhooks** — Register, list, update, delete, delivery log, test delivery, HMAC-SHA256 signing
**Preferences** — Per-user get/put/patch, 7 fields (theme, terminal-theme, layout, columns, auto-refresh, refresh-interval, notifications)
**Notifications** — List, unread count, mark read, dismiss, clear all; 7 event types, ring buffer
**Secrets Vault** — AES-256-GCM encrypted store: list, get (requires `?reveal=true`), set, delete, exists, export
**Search** — Unified cross-subsystem search across 6 sources (tasks, chains, messages, audit, shared-memory, terminals), relevance scoring, Ctrl+K palette in UI
**Bulk Operations** — Batch cancel/retry/update tasks, archive chains, retry/dismiss DLQ entries (max 100 per request)
**Performance** — Per-route latency stats (avg/min/max/p50/p95/p99), summary, reset
**Health** — 7 subsystem probes (coordinator, claude-pool, shared-memory, message-bus, audit-log, dead-letter, disk), readiness probe
**Metrics** — Prometheus exposition format: uptime, tasks, terminals, memory, messages, DLQ, HTTP latency histograms
**OpenAPI** — Auto-generated OpenAPI 3.0.3 spec, Swagger UI at `/api/docs`
**Auth** — Token-based (`jst_` prefix), generate/list/revoke, SHA-256 hashing; skips health/metrics/docs paths

### WebSocket Bridge

- **JSON Bridge** (`/ws`): 88 bridged EventBus event types streamed to clients
- **Binary Terminal WS** (`/ws/claude-terminal/:id`): Raw PTY I/O for interactive terminals
- **Replay Buffer**: Last 100 events with monotonic sequence numbers, reconnect recovery via `{ type: 'replay', afterSeq: N }`
- **Heartbeat**: 30s ping/pong interval, 10s timeout, latency tracking
- **Pattern Matching**: Wildcard subscriptions (e.g., `chain:*`)
- **Output Throttling**: `session:output` throttled to 1 msg/sec per client

### Coordination Engine

- **DAG Task Queue**: Dependencies, priorities, worker assignment, status tracking
- **Work Assigner**: Round-robin, capability-based, and work-stealing strategies
- **Rate Limiter**: Token bucket (requests/min + tokens/min), adaptive 429 backoff
- **Cost Aggregator**: Per-worker + global budget caps, session cost auto-bridging
- **Cost Forecaster**: Burn rate, budget exhaustion prediction, configurable alerts
- **Category Detector**: 7 categories via keyword scoring, custom rules support
- **Dead Letter Queue**: Permanently-failed task storage with retry/dismiss
- **Worktree Manager**: Per-worker git worktree isolation
- **Persistent Queue**: Disk-backed crash recovery

### Claude Terminal Pool

- Multi-terminal management: spawn/kill/resize/respawn
- **Auto-Handoff**: Terminal exits trigger next chain continuation
- **Auto-Dispatch**: Task completion triggers next task assignment
- **Auto-Complete**: Idle detection marks tasks complete after inactivity
- **Swarm Mode**: Auto-scaling pool (min/max terminals, scale-up threshold, crash recovery with lineage tracking)
- **Affinity Routing**: Category-based task routing, capability filtering
- **Shared Memory**: Cross-terminal persistent key-value store with watchers
- **Inter-Terminal Messaging**: Broadcast/targeted/threaded messages with unread tracking

### Server Startup & CLI

```bash
node operator/server.mjs                    # Default: port 3100, auth enabled
node operator/server.mjs --port 8080        # Custom port
node operator/server.mjs --operator         # Combined mode (API + operator daemon)
node operator/server.mjs --pool             # Enable process pool + coordinator
node operator/server.mjs --swarm            # Enable swarm mode (autonomous task draining)
node operator/server.mjs --no-auth          # Disable authentication
node operator/server.mjs --retention        # Run retention cleanup on startup
```

Init order: registry → settings → auth → logger → middleware → routes → views → pages → static files → OpenAPI → error handlers → HTTP server → WebSocket → file watcher → shutdown handlers.

---

## Test Suite

**3,728 tests** across **66 suites** — all passing.
- 8 engine suites, 14 orchestrator suites, 44 operator suites
- Run: `npm test` or `npx vitest run`

## Key Files

| Purpose | Path |
|---------|------|
| Game spec (canonical) | `docs/joust-melee-v4.1.md` |
| Server entry | `operator/server.mjs` |
| Coordinator | `operator/coordination/coordinator.mjs` |
| Claude pool | `operator/claude-pool.mjs` |
| WS bridge | `operator/ws.mjs` |
| Memory notes | `memory/MEMORY.md`, `memory/session-details.md`, `memory/web-design.md` |
| Milestone plans | `docs/milestone-plan-{27-32,33-38,39-44,45-50}.md` |

## Gotchas

- `auth: false` required in test `createApp()` calls for backward compat
- Auth middleware skips `/api/health*`, `/api/metrics`, `/api/openapi.json`, `/api/docs`, non-`/api/` paths
- Coordinator auto-creates `categoryDetector` and `costForecaster`
- Pagination envelope: `{ items, total, limit, offset, hasMore }`
- `listSessions()` now returns `{ items, total }` (not a plain array)
- Secrets vault `?reveal=true` required to GET secret values
- WS replay: client sends `{ type: 'replay', afterSeq }` on reconnect
- Request timer normalizes paths (`:id` replacement) for aggregation
- Webhook manager wraps `EventBus.emit()` — `destroy()` restores original
- Error handler returns generic "Internal server error" for 500s (no leak of internals)
- Response cache only stores 2xx responses
