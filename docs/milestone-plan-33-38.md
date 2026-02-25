# Milestone Plan: Phases 33-38

## Overview

Phases 33-38 close the remaining feature gaps in the Jousting operator system. The first phase adds **category auto-detection** for tasks (Phase 33), a quick win that improves the existing affinity-based routing. Phase 34 delivers **enhanced health checks and a metrics endpoint** in Prometheus exposition format, filling the observability gap. Phase 35 adds **cursor-based pagination** to all list endpoints. Phase 36 introduces **data export** in CSV and JSON formats. Phase 37 builds an **activity timeline** UI on top of the audit log. Phase 38 adds **webhook/event subscriptions** so external systems can react to operator events.

Each phase is scoped for a single session (~80-150 lines of production code, 20-30 tests), builds incrementally on prior work, and follows existing factory/EventBus/atomic-write patterns.

---

## Phase 33: Task Category Auto-Detection

### Rationale
Tasks added via the REST API or task templates include a `category` field, but users frequently leave it empty. The swarm routing system (Phase 26) uses categories for affinity scoring and capability filtering — without categories, tasks are randomly distributed. A keyword-based auto-detector assigns categories at task creation time, improving routing quality with zero user effort.

### Changes

- **`operator/coordination/category-detector.mjs` (new, ~80 lines)**: Factory `createCategoryDetector(ctx)`:
  - `ctx.customRules` — optional array of `{ pattern: RegExp, category: string }` for user-defined rules
  - Built-in keyword-to-category mapping (scanned against `task.task` text):
    - `planning`: plan, design, architect, requirements, spec, analyze, research
    - `development`: implement, code, build, create, add, develop, refactor, write
    - `testing`: test, verify, validate, check, assert, spec, coverage, regression
    - `debugging`: debug, fix, bug, issue, error, crash, investigate, diagnose
    - `review`: review, audit, inspect, examine, approve, feedback
    - `deployment`: deploy, release, publish, ship, rollout, migrate
    - `documentation`: document, readme, docs, comment, explain, describe
  - `detect(taskText)` — returns best-match category string or `null` if no keywords match
  - Scoring: count keyword hits per category, highest wins; ties broken by declaration order
  - `getCategories()` — returns list of all known category names
  - `addRule({ pattern, category })` — adds a custom detection rule at runtime

- **`operator/coordination/coordinator.mjs` (~15 lines changed)**:
  - Accept optional `ctx.categoryDetector` (or create one internally)
  - In `addTask()`: if `taskDef.category` is falsy, call `categoryDetector.detect(taskDef.task)` and set `task.category` to result
  - In `addTasks()`: same auto-detection for each task in batch
  - Expose `categoryDetector` on returned object for route access

- **`operator/routes/coordination.mjs` (~15 lines changed)**:
  - `GET /api/coordination/categories` — returns list of known categories from `coordinator.categoryDetector.getCategories()`
  - `POST /api/coordination/categories/detect` — body `{ text }`, returns `{ category }` (preview endpoint for testing detection without creating a task)

- **Taskboard UI** (~10 lines in `public/taskboard.js`):
  - When adding a task via the dialog, if category field is empty, call `POST /api/coordination/categories/detect` with the task text and auto-fill the category dropdown
  - Visual indicator: auto-detected categories shown with a dashed border on the badge (vs solid for user-specified)

### Test Plan
- `operator/__tests__/category-detector.test.mjs` (~25 tests):
  - `detect()` returns correct category for single-keyword input ("implement the login page" -> "development")
  - `detect()` returns correct category for multi-keyword input ("debug and fix the crash" -> "debugging")
  - `detect()` returns `null` for unrecognizable text
  - `detect()` handles empty/null/undefined input gracefully
  - Scoring: highest keyword count wins ("write tests for the new feature" -> "testing" not "development")
  - Tie-breaking: declaration order wins
  - Case-insensitive matching
  - `getCategories()` returns all built-in category names
  - `addRule()` adds custom rule that takes priority
  - Custom rules with regex patterns
  - Coordinator integration: `addTask()` auto-detects when category is null
  - Coordinator integration: `addTask()` preserves explicit category
  - Coordinator integration: `addTasks()` batch auto-detection
  - Categories endpoint returns list
  - Detect preview endpoint returns correct category
  - Empty task text returns null category

### Dependencies
- None (builds on existing coordinator and task queue)

---

## Phase 34: Enhanced Health Checks & Metrics Endpoint

### Rationale
The current `/api/health` endpoint only returns `{ ok, uptime, timestamp }`. There is no component-level health (is the coordinator running? are terminals alive? is disk persistence healthy?), and the coordinator's `getMetrics()` is only available in a custom JSON format. A detailed health endpoint and a Prometheus-compatible metrics endpoint close the observability gap for monitoring tools.

### Changes

- **`operator/health.mjs` (new, ~100 lines)**: Factory `createHealthChecker(ctx)`:
  - `ctx.coordinator`, `ctx.claudePool`, `ctx.sharedMemory`, `ctx.messageBus`, `ctx.auditLog`, `ctx.deadLetterQueue` — all optional subsystem references
  - `check()` — returns detailed health object:
    ```
    {
      status: 'healthy' | 'degraded' | 'unhealthy',
      uptime: process.uptime(),
      timestamp: ISO string,
      components: {
        coordinator: { status, state, tasksPending, tasksRunning },
        claudePool: { status, running, stopped, maxTerminals },
        sharedMemory: { status, keyCount },
        messageBus: { status, messageCount },
        auditLog: { status, entryCount },
        deadLetterQueue: { status, pendingCount },
        disk: { status, dataDir, writable },
      }
    }
    ```
  - Component status logic: `healthy` if operational, `degraded` if available but has warnings (e.g., DLQ > 10 items), `unhealthy` if subsystem missing or erroring
  - Overall status: `unhealthy` if any component is unhealthy, `degraded` if any is degraded, `healthy` otherwise
  - `checkDiskWritable(dataDir)` — tries writing a temp file to `.data/`, returns boolean

- **`operator/metrics.mjs` (new, ~90 lines)**: Factory `createMetricsCollector(ctx)`:
  - Same subsystem references as health checker
  - `collect()` — returns Prometheus exposition format string:
    ```
    # HELP jousting_uptime_seconds Server uptime in seconds
    # TYPE jousting_uptime_seconds gauge
    jousting_uptime_seconds <value>

    # HELP jousting_tasks_total Total tasks by status
    # TYPE jousting_tasks_total gauge
    jousting_tasks_total{status="pending"} <N>
    jousting_tasks_total{status="running"} <N>
    jousting_tasks_total{status="complete"} <N>
    jousting_tasks_total{status="failed"} <N>
    jousting_tasks_total{status="cancelled"} <N>

    # HELP jousting_terminals_total Terminal count by state
    # TYPE jousting_terminals_total gauge
    jousting_terminals_total{state="running"} <N>
    jousting_terminals_total{state="stopped"} <N>

    # HELP jousting_task_throughput_per_minute Tasks completed per minute (5m window)
    # TYPE jousting_task_throughput_per_minute gauge
    jousting_task_throughput_per_minute <value>

    # HELP jousting_worker_utilization Worker utilization ratio
    # TYPE jousting_worker_utilization gauge
    jousting_worker_utilization <value>

    # HELP jousting_dlq_pending Dead letter queue pending count
    # TYPE jousting_dlq_pending gauge
    jousting_dlq_pending <N>

    # HELP jousting_cost_total_usd Total cost in USD
    # TYPE jousting_cost_total_usd counter
    jousting_cost_total_usd <value>

    # HELP jousting_messages_total Terminal messages count
    # TYPE jousting_messages_total gauge
    jousting_messages_total <N>

    # HELP jousting_shared_memory_keys Shared memory key count
    # TYPE jousting_shared_memory_keys gauge
    jousting_shared_memory_keys <N>
    ```
  - Gracefully skips metrics for unavailable subsystems (outputs nothing for that metric)

- **`operator/server.mjs` (~20 lines changed)**:
  - Create health checker and metrics collector, passing all subsystem refs
  - Replace existing `/api/health` with expanded version:
    - `GET /api/health` — returns `createHealthChecker.check()` (detailed component health)
    - `GET /api/health/ready` — lightweight readiness probe: `{ ok: true }` if server is listening (for load balancers)
  - `GET /api/metrics` — returns `createMetricsCollector.collect()` with `Content-Type: text/plain; version=0.0.4; charset=utf-8` (Prometheus format)
  - Both health and metrics endpoints skip auth (like current `/api/health`)

### Test Plan
- `operator/__tests__/health-metrics.test.mjs` (~25 tests):
  - Health check returns `healthy` when all components present
  - Health check returns `degraded` when DLQ has > 10 pending items
  - Health check returns component status for each subsystem
  - Health check handles null/missing subsystems gracefully
  - Disk writable check succeeds in test temp directory
  - Disk writable check fails for non-existent directory
  - Readiness endpoint returns `{ ok: true }`
  - Metrics collector outputs valid Prometheus exposition format
  - Metrics include task counts by status
  - Metrics include terminal counts by state
  - Metrics include throughput and utilization
  - Metrics skip unavailable subsystems gracefully
  - Metrics content-type header is correct
  - Integration: health endpoint via supertest
  - Integration: metrics endpoint via supertest
  - Health status aggregation logic (unhealthy > degraded > healthy)

### Dependencies
- Phase 32 (DLQ reference for health/metrics)

---

## Phase 35: Pagination & List Improvements

### Rationale
List endpoints (`GET /api/coordination/tasks`, `GET /api/shared-memory`, `GET /api/terminal-messages`, `GET /api/audit`) return all items in a single response. For systems with hundreds of tasks or thousands of messages, this causes slow responses and high memory usage. Phase 29 added `paginationParams()` but it is only used by the audit log query. This phase systematically adds pagination to all list endpoints and standardizes the response envelope.

### Changes

- **`operator/validation.mjs` (~15 lines added)**:
  - `paginatedResponse({ items, total, limit, offset })` — helper that returns standardized envelope:
    ```
    {
      items: [...],
      total: N,
      limit: N,
      offset: N,
      hasMore: boolean,
    }
    ```
  - Export for use across all route files

- **`operator/routes/coordination.mjs` (~25 lines changed)**:
  - `GET /api/coordination/tasks` — add `?limit=`, `?offset=`, `?status=`, `?category=` query params; use `paginationParams()` + `paginatedResponse()`; filter before paginating
  - `GET /api/coordination/dead-letters` — already has limit/offset in `dead-letter.mjs`, standardize to use `paginatedResponse()` envelope

- **`operator/routes/shared-memory.mjs` (~15 lines changed)**:
  - `GET /api/shared-memory` — add `?limit=`, `?offset=` query params; use `paginationParams()` + `paginatedResponse()`; maintain backward compat by defaulting limit to 100

- **`operator/routes/terminal-messages.mjs` (~10 lines changed)**:
  - `GET /api/terminal-messages` — standardize to `paginatedResponse()` envelope; add `total` field to response

- **`operator/routes/audit.mjs` (~10 lines changed)**:
  - `GET /api/audit` — already paginated; wrap in `paginatedResponse()` for consistency

- **`operator/routes/dead-letter.mjs` (~10 lines changed)**:
  - `GET /api/coordination/dead-letters` — standardize to `paginatedResponse()` envelope

- **Response envelope standardization**: All list endpoints return `{ items, total, limit, offset, hasMore }` where previously they returned `{ count, entries }` or `{ count, messages }` or bare arrays. Old field names are preserved as aliases for one release cycle (non-breaking).

### Test Plan
- `operator/__tests__/pagination.test.mjs` (~25 tests):
  - `paginatedResponse()` computes `hasMore` correctly at boundary
  - `paginatedResponse()` handles empty items
  - Tasks endpoint: returns paginated results with limit/offset
  - Tasks endpoint: filters by status
  - Tasks endpoint: filters by category
  - Tasks endpoint: returns total count independent of pagination
  - Shared memory endpoint: paginates key listing
  - Messages endpoint: returns standardized envelope
  - Audit endpoint: wraps existing pagination in standard envelope
  - DLQ endpoint: returns standardized envelope
  - Default limit applied when not specified
  - Limit clamped to max 100
  - Offset defaults to 0
  - `hasMore: true` when more items exist beyond current page
  - `hasMore: false` on last page
  - Backward compat: old field names still present

### Dependencies
- Phase 29 (uses existing `paginationParams()` from validation.mjs)

---

## Phase 36: Data Export

### Rationale
Operators need to extract data for reporting, analysis, and backup. There is no way to export tasks, audit logs, terminal messages, or metrics in a portable format. This phase adds CSV and JSON export endpoints for the most commonly needed data sets.

### Changes

- **`operator/export.mjs` (new, ~100 lines)**: Factory `createExporter()`:
  - `toCSV(rows, columns)` — converts array of objects to CSV string with headers; handles escaping (quotes, commas, newlines); `columns` is an array of `{ key, label }` (or auto-detected from first row)
  - `toJSON(rows)` — returns pretty-printed JSON array string
  - `toJSONLines(rows)` — returns JSONL format (one JSON object per line, streaming-friendly)
  - Utility: `flattenObject(obj, prefix)` — flattens nested objects for CSV (e.g., `metadata.priority` becomes `metadata_priority`)

- **`operator/routes/export.mjs` (new, ~80 lines)**: Factory `createExportRoutes(ctx)`:
  - `ctx.coordinator`, `ctx.auditLog`, `ctx.messageBus`, `ctx.claudePool`, `ctx.deadLetterQueue`
  - `GET /api/export/tasks` — export coordination tasks; query params: `?format=csv|json|jsonl` (default json), `?status=`, `?category=`
    - CSV columns: id, task, status, category, priority, assignedTo, createdAt, completedAt, error
    - Sets `Content-Disposition: attachment; filename="tasks-{timestamp}.{ext}"`
    - Sets appropriate `Content-Type` header
  - `GET /api/export/audit` — export audit log entries; params: `?format=`, `?action=`, `?since=`, `?until=`
    - CSV columns: ts, action, actor, target, detail (JSON-stringified)
  - `GET /api/export/messages` — export terminal messages; params: `?format=`, `?terminalId=`
    - CSV columns: id, from, to, content, category, ts, replyTo
  - `GET /api/export/dead-letters` — export DLQ entries; params: `?format=`, `?status=`
    - CSV columns: id, taskId, category, error, workerId, failedAt, retryCount, status

- **`operator/server.mjs` (~5 lines changed)**:
  - Wire `createExportRoutes({ coordinator, auditLog, messageBus, claudePool, deadLetterQueue })` to `app.use('/api', ...)`

- **Taskboard UI** (~15 lines in `public/taskboard.js`):
  - "Export" dropdown button in the task board header with options: "CSV", "JSON", "JSONL"
  - Clicking triggers `window.location = /api/export/tasks?format=csv` (browser download)
  - Respects current filter state (passes status/category as query params)

### Test Plan
- `operator/__tests__/export.test.mjs` (~25 tests):
  - `toCSV()` produces valid CSV with headers
  - `toCSV()` escapes commas and quotes in values
  - `toCSV()` handles newlines in values (wraps in quotes)
  - `toCSV()` with custom column definitions
  - `toCSV()` with empty input returns headers only
  - `toJSON()` returns formatted JSON array
  - `toJSONLines()` returns one line per object
  - `flattenObject()` flattens nested objects with underscore separator
  - `flattenObject()` handles null/undefined values
  - Tasks export: CSV format with correct headers and data
  - Tasks export: JSON format returns array
  - Tasks export: respects status filter
  - Tasks export: respects category filter
  - Audit export: CSV format with correct headers
  - Audit export: respects time range filters
  - Messages export: filters by terminalId
  - DLQ export: includes all DLQ fields
  - Content-Disposition header set correctly
  - Content-Type matches format (text/csv, application/json)
  - Route returns 503 when subsystem not available
  - Export with no data returns empty result (not error)

### Dependencies
- Phase 31 (audit log for audit export)
- Phase 32 (DLQ for dead letter export)

---

## Phase 37: Activity Timeline

### Rationale
The audit log (Phase 31) records events but only exposes them via a raw query API. Operators need a human-readable timeline view showing system activity — terminal spawns/exits, task completions/failures, swarm events, and configuration changes — in chronological order with filtering and search. This is the "what happened while I was away" dashboard.

### Changes

- **`operator/routes/timeline.mjs` (new, ~60 lines)**: Factory `createTimelineRoutes(ctx)`:
  - `ctx.auditLog`, `ctx.coordinator`, `ctx.claudePool`
  - `GET /api/timeline` — aggregated activity feed combining:
    - Audit log entries (primary source)
    - Enrichment: for `task.complete` entries, includes task description from coordinator queue
    - Enrichment: for `terminal.spawn`/`terminal.exit`, includes terminal model and project
    - Query params: `?since=` (ISO timestamp, default last 24h), `?until=`, `?limit=` (default 50), `?offset=`, `?category=` (filter by action category: terminal, task, swarm, system, memory)
    - Action categories (derived from audit action prefix):
      - `terminal`: terminal.spawn, terminal.exit
      - `task`: task.complete, task.fail
      - `swarm`: swarm.start, swarm.stop
      - `system`: coordinator.start, coordinator.stop
      - `memory`: memory.write
    - Response: `{ items: [{ ts, action, category, summary, detail, target }], total, hasMore }`
    - `summary` field: human-readable one-liner (e.g., "Terminal t1 spawned (model: sonnet)", "Task fix-bug completed by t2")
  - `GET /api/timeline/summary` — returns activity counts per category for the last 24h: `{ terminal: N, task: N, swarm: N, system: N, memory: N, total: N }`

- **`operator/public/timeline.html` (new, ~40 lines)**: Activity timeline page:
  - Linked from main nav bar (new "Timeline" link)
  - HTMX-powered: loads `/views/timeline` fragment on page load
  - Filter bar: category dropdown, date range picker (since/until), search text

- **`operator/views/timeline.mjs` (new, ~60 lines)**: Server-side HTML fragment renderer:
  - `renderTimeline(entries)` — renders a vertical timeline with:
    - Time column (relative time + ISO tooltip)
    - Icon column (category-specific icon: terminal=monitor, task=check/x, swarm=grid, system=gear, memory=database)
    - Summary text (one line)
    - Expandable detail (click to show full audit entry)
  - `renderTimelineSummary(counts)` — renders category count badges at top

- **`operator/routes/views.mjs` (~10 lines changed)**: Add `/views/timeline` route that calls `renderTimeline()`

- **`operator/server.mjs` (~5 lines changed)**:
  - Wire `createTimelineRoutes({ auditLog, coordinator, claudePool })` to `app.use('/api', ...)`
  - Add page route: `app.get('/timeline', ...)` serving `timeline.html`

- **`operator/public/style.css` (~20 lines added)**: Timeline-specific styles:
  - `.timeline-entry` with left border color by category
  - `.timeline-time` muted text
  - `.timeline-summary` main text
  - `.timeline-detail` collapsible detail section

- **Nav bar update** (~2 lines in `index.html`, `style.css`): Add "Timeline" link to main navigation

### Test Plan
- `operator/__tests__/timeline.test.mjs` (~25 tests):
  - Timeline endpoint returns audit entries in reverse chronological order
  - Timeline filters by category
  - Timeline filters by time range (since/until)
  - Timeline paginates with limit/offset
  - Timeline enriches task entries with task description
  - Timeline enriches terminal entries with model info
  - Timeline summary returns correct counts per category
  - Human-readable summary generation for each action type
  - Action-to-category mapping is correct
  - Default `since` is last 24 hours
  - Empty audit log returns empty timeline
  - Summary with no activity returns all zeros
  - Response has standardized `hasMore` pagination field
  - Unknown action types map to `system` category
  - Route returns 503 when audit log not available

### Dependencies
- Phase 31 (audit log as primary data source)
- Phase 35 (pagination envelope for consistent response format)

---

## Phase 38: Webhook & Event Subscriptions

### Rationale
External tools (Slack, CI/CD, monitoring dashboards) cannot currently react to operator events without polling. The WebSocket bridge is real-time but requires a persistent connection and custom client code. Webhooks provide a standard push mechanism: the operator POSTs a JSON payload to a registered URL when matching events occur. This is the final API completeness feature.

### Changes

- **`operator/webhooks.mjs` (new, ~120 lines)**: Factory `createWebhookManager(ctx)`:
  - `ctx.events` — EventBus to subscribe to
  - `ctx.persistPath` — path to `operatorDir/.data/webhooks.json`
  - `ctx.log` — logger
  - `ctx.maxRetries` (default 3) — retry count for failed deliveries
  - `ctx.timeoutMs` (default 5000) — HTTP request timeout
  - Webhook registration:
    - `register({ url, events, label, secret })` — creates webhook subscription; returns `{ id, url, events, label, active, createdAt }`
    - `url`: HTTPS or HTTP URL to POST to
    - `events`: array of event patterns (same wildcard syntax as WS bridge, e.g., `["coord:*", "claude-terminal:task-completed"]`)
    - `label`: human-readable name
    - `secret`: optional shared secret for HMAC-SHA256 signature (header `X-Jousting-Signature`)
  - `unregister(id)` — removes webhook
  - `setActive(id, active)` — enable/disable without deleting
  - `list()` — returns all registered webhooks (no secrets)
  - `get(id)` — returns single webhook detail
  - `getDeliveryLog(id, limit?)` — returns recent delivery attempts for a webhook
  - Event dispatch:
    - On EventBus event matching any registered webhook's patterns, queue an HTTP POST
    - POST body: `{ event, data, timestamp, webhookId }`
    - Header `X-Jousting-Event: <eventName>`
    - Header `X-Jousting-Signature: sha256=<hmac>` if secret is configured
    - Header `X-Jousting-Delivery: <uuid>` unique delivery ID
  - Retry: exponential backoff (1s, 4s, 16s) up to `maxRetries`; non-2xx responses trigger retry
  - Delivery log: ring buffer of last 50 deliveries per webhook `{ deliveryId, event, status, statusCode, attemptCount, latencyMs, error?, ts }`
  - Persistence: atomic write of registrations to disk (same pattern as DLQ); delivery log is in-memory only (ephemeral)
  - `destroy()` — unwires all EventBus listeners, clears pending retries

- **`operator/routes/webhooks.mjs` (new, ~50 lines)**: Factory `createWebhookRoutes(ctx)`:
  - `POST /api/webhooks` — register new webhook (body: `{ url, events, label, secret? }`)
  - `GET /api/webhooks` — list all webhooks (no secrets in response)
  - `GET /api/webhooks/:id` — get single webhook detail
  - `DELETE /api/webhooks/:id` — unregister webhook
  - `PATCH /api/webhooks/:id` — update webhook (toggle active, change events/url)
  - `GET /api/webhooks/:id/deliveries` — recent delivery log
  - `POST /api/webhooks/:id/test` — send a test event (`{ event: "webhook:test", data: { message: "Test delivery" } }`)

- **`operator/server.mjs` (~10 lines changed)**:
  - Create `webhookManager = createWebhookManager({ events, persistPath, log })` after EventBus
  - Wire `createWebhookRoutes({ webhookManager })` to `app.use('/api', ...)`
  - Pass `webhookManager` in return object
  - Load persisted webhooks on startup: `webhookManager.load()`

- **WS bridge** (~2 lines in `ws.mjs`): Add `webhook:delivered`, `webhook:failed` to BRIDGED_EVENTS for UI monitoring

### Test Plan
- `operator/__tests__/webhooks.test.mjs` (~25 tests):
  - `register()` creates webhook with correct fields and generated ID
  - `register()` persists to disk
  - `unregister()` removes webhook and persists
  - `setActive()` toggles active flag
  - `list()` returns all webhooks without secrets
  - `get()` returns single webhook
  - Event dispatch: matching event triggers HTTP POST to registered URL
  - Event dispatch: non-matching event does not trigger POST
  - Event dispatch: wildcard patterns work (e.g., `coord:*` matches `coord:started`)
  - Event dispatch: inactive webhooks skipped
  - HMAC signature: correct `X-Jousting-Signature` header when secret configured
  - HMAC signature: no header when no secret
  - Delivery headers: `X-Jousting-Event` and `X-Jousting-Delivery` present
  - Retry: non-2xx response triggers retry with backoff
  - Retry: gives up after maxRetries
  - Delivery log: records success with status code and latency
  - Delivery log: records failure with error message
  - `getDeliveryLog()` returns recent entries (ring buffer)
  - Test endpoint: sends test event to webhook URL
  - Persistence: load() restores registrations from disk
  - `destroy()` unwires all listeners
  - Route CRUD operations return correct responses
  - URL validation: rejects invalid URLs

### Dependencies
- Phase 28 (logger for delivery error logging)
- Phase 27 (auth — webhook routes require valid token)

---

## Summary Table

| Phase | Title | Priority Area | New Files | Changed Files | Est. Tests |
|-------|-------|--------------|-----------|---------------|------------|
| 33 | Task Category Auto-Detection | Routing | `coordination/category-detector.mjs` | `coordinator.mjs`, `coordination.mjs`, `taskboard.js` | 25 |
| 34 | Enhanced Health Checks & Metrics | Observability | `health.mjs`, `metrics.mjs` | `server.mjs` | 25 |
| 35 | Pagination & List Improvements | API Completeness | — | `validation.mjs`, `coordination.mjs`, `shared-memory.mjs`, `terminal-messages.mjs`, `audit.mjs`, `dead-letter.mjs` | 25 |
| 36 | Data Export | UX | `export.mjs`, `routes/export.mjs` | `server.mjs`, `taskboard.js` | 25 |
| 37 | Activity Timeline | UX | `routes/timeline.mjs`, `views/timeline.mjs`, `public/timeline.html` | `server.mjs`, `routes/views.mjs`, `style.css`, `index.html` | 25 |
| 38 | Webhook & Event Subscriptions | API Completeness | `webhooks.mjs`, `routes/webhooks.mjs` | `server.mjs`, `ws.mjs` | 25 |

**Total estimated: ~150 new tests across 6 new test files, ~780 lines of new production code, ~100 lines changed in existing files.**
