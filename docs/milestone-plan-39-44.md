# Milestone Plan: Phases 39-44

## Overview

Phases 39-44 close the remaining feature gaps identified in the post-Phase 38 audit. Phase 39 adds **user preferences persistence** extending the settings system with per-user layout, theme, and notification prefs. Phase 40 delivers **bulk operations** for batch task retry, archive, and DLQ management. Phase 41 builds an **in-app notification system** powered by the audit log, webhooks, and the WS bridge. Phase 42 adds **rate limit response headers and response caching** for API hardening. Phase 43 introduces **cost forecasting and budget alerts** that project future spend based on current burn rate. Phase 44 generates an **OpenAPI specification** from the existing validation schemas and route definitions.

Each phase is scoped for a single session (~80-150 lines of production code, 20-30 tests), builds incrementally on prior work, and follows existing factory/EventBus/atomic-write patterns.

---

## Phase 39: User Preferences Persistence

### Rationale
The current `settings.mjs` stores global operator defaults (model, turns, budget, coordination config) but there is no mechanism for per-user preferences like UI layout (grid vs tab terminal view), notification settings, terminal theme override, sidebar visibility, or auto-refresh intervals. Users lose their UI state on page reload. This phase extends the settings system with a separate preferences store that persists per-token-ID preferences to disk.

### Changes

- **`operator/preferences.mjs` (new, ~100 lines)**: Factory `createPreferences(ctx)`:
  - `ctx.operatorDir` — base directory for persistence
  - `ctx.log` — logger (optional)
  - Persistence at `operatorDir/.data/preferences.json`, atomic write via temp+rename (same pattern as `settings.mjs`)
  - `PREF_DEFAULTS` constant:
    ```
    {
      terminalLayout: 'grid',          // 'grid' | 'tabs'
      terminalTheme: null,             // null = use global default from settings
      sidebarVisible: true,            // file sidebar collapsed state
      notificationsEnabled: true,      // in-app notifications
      notificationSound: false,        // audible alerts
      autoRefreshIntervalMs: 5000,     // pool status bar refresh
      taskboardView: 'kanban',         // 'kanban' | 'dag'
      timelineCategory: 'all',         // default timeline filter
      particlesEnabled: null,          // null = use global, true/false = override
    }
    ```
  - `load(userId)` — returns merged `PREF_DEFAULTS + stored prefs` for the given user ID; returns defaults if no stored prefs
  - `save(userId, prefs)` — validates, clamps, and persists preferences; validation rules:
    - `terminalLayout`: must be `'grid'` or `'tabs'`
    - `terminalTheme`: must be in `VALID_THEMES` (from settings.mjs) or `null`
    - `sidebarVisible`, `notificationsEnabled`, `notificationSound`: booleans
    - `autoRefreshIntervalMs`: clamped to 1000-60000
    - `taskboardView`: must be `'kanban'` or `'dag'`
    - `timelineCategory`: must be `'all'` or one of the timeline categories
    - `particlesEnabled`: `null`, `true`, or `false`
  - `patch(userId, partial)` — merge partial updates into existing prefs (load + merge + save)
  - `reset(userId)` — removes stored prefs for user, reverting to defaults
  - `listUsers()` — returns array of user IDs that have stored preferences
  - Internal: stores as `{ [userId]: { ...prefs, updatedAt } }` in a single JSON file

- **`operator/routes/preferences.mjs` (new, ~50 lines)**: Factory `createPreferencesRoutes(ctx)`:
  - `ctx.preferences` — preferences instance
  - User ID derived from `req.auth.id` (set by auth middleware); falls back to `'default'` when auth is disabled
  - `GET /api/preferences` — returns `preferences.load(userId)` for current user
  - `PUT /api/preferences` — full replacement: `preferences.save(userId, req.body)`; validates with `validateBody()`:
    - `terminalLayout: { type: 'string', enum: ['grid', 'tabs'] }`
    - `notificationsEnabled: { type: 'boolean' }`
    - `notificationSound: { type: 'boolean' }`
    - `autoRefreshIntervalMs: { type: 'number', min: 1000, max: 60000 }`
    - All fields optional (missing fields use defaults)
  - `PATCH /api/preferences` — partial update: `preferences.patch(userId, req.body)`; body is a partial preferences object, only specified fields are changed
  - `DELETE /api/preferences` — resets to defaults: `preferences.reset(userId)`

- **`operator/server.mjs` (~10 lines changed)**:
  - Import `createPreferences` and `createPreferencesRoutes`
  - Create `preferences = createPreferences({ operatorDir })` alongside settings
  - Wire `createPreferencesRoutes({ preferences })` to `app.use('/api', ...)`
  - Return `preferences` in the app return object

- **`operator/public/app.js` (~20 lines changed)**:
  - On page load: `fetch('/api/preferences')` and apply stored layout preferences:
    - `particlesEnabled` override (if non-null, overrides global setting)
    - `autoRefreshIntervalMs` applied to any polling intervals
  - `savePreference(key, value)` helper: PATCHes a single pref to `/api/preferences`
  - Integrate with existing terminal layout toggle (`terminals.js`) and taskboard view toggle (`taskboard.js`)

### Test Plan
- `operator/__tests__/preferences.test.mjs` (~25 tests):
  - `load()` returns defaults for unknown user
  - `save()` persists preferences to disk
  - `save()` validates and clamps `autoRefreshIntervalMs` to range
  - `save()` rejects invalid `terminalLayout` value
  - `save()` rejects invalid `terminalTheme` value
  - `load()` after `save()` returns saved values merged with defaults
  - `patch()` merges partial update into existing prefs
  - `patch()` does not overwrite unmentioned fields
  - `reset()` clears stored preferences
  - `reset()` on non-existent user is a no-op
  - `listUsers()` returns users with stored prefs
  - Atomic write: file survives crash (temp file recovery)
  - Multiple users: preferences are isolated per userId
  - `GET /api/preferences` returns defaults for new user (supertest)
  - `PUT /api/preferences` saves and returns validated prefs (supertest)
  - `PATCH /api/preferences` partial update works (supertest)
  - `DELETE /api/preferences` resets to defaults (supertest)
  - Auth-derived userId: uses `req.auth.id` when present
  - Fallback userId: uses `'default'` when auth disabled
  - `PREF_DEFAULTS` has correct structure and types
  - Invalid boolean fields coerced correctly
  - `particlesEnabled` accepts null/true/false
  - Persistence format: JSON file has expected shape
  - `taskboardView` validates against allowed values
  - `timelineCategory` validates against allowed values

### Dependencies
- Phase 27 (auth middleware for user ID extraction)
- Existing `settings.mjs` pattern (same atomic write approach)

---

## Phase 40: Bulk Operations

### Rationale
The coordination system supports single-task operations (cancel, retry, update) but there is no way to perform batch operations on multiple tasks at once. Operators managing large task queues need to bulk-retry failed tasks, bulk-cancel pending tasks, bulk-archive completed chains, and bulk-requeue DLQ entries. The taskboard UI (Phase 13) already has checkbox selection infrastructure for batch operations but the backend endpoints are missing.

### Changes

- **`operator/routes/bulk.mjs` (new, ~100 lines)**: Factory `createBulkRoutes(ctx)`:
  - `ctx.coordinator` — coordinator instance (for task queue access)
  - `ctx.registry` — chain registry (for chain archival)
  - `ctx.deadLetterQueue` — DLQ instance (for bulk DLQ operations)
  - All endpoints validate with `validateBody()` and return `{ ok: true, results: [...] }` with per-item success/failure
  - `POST /api/bulk/tasks/cancel` — cancel multiple tasks:
    - Body: `{ taskIds: string[], reason?: string }`
    - Validates `taskIds` is a non-empty array, max 100 items
    - Iterates `taskQueue.cancel(id, reason)` for each, collecting results
    - Returns `{ ok: true, results: [{ taskId, cancelled: boolean, error?: string }] }`
  - `POST /api/bulk/tasks/retry` — retry multiple failed tasks:
    - Body: `{ taskIds: string[] }`
    - Validates array, max 100
    - Iterates `taskQueue.retry(id)` for each
    - Returns `{ ok: true, results: [{ taskId, retried: boolean, error?: string }] }`
  - `POST /api/bulk/tasks/update` — bulk-update fields on multiple tasks:
    - Body: `{ taskIds: string[], fields: { priority?, category?, metadata? } }`
    - Validates array, max 100; `fields` must be an object
    - Iterates `taskQueue.update(id, fields)` for each
    - Returns `{ ok: true, results: [{ taskId, updated: boolean, error?: string }] }`
  - `POST /api/bulk/chains/archive` — archive multiple completed chains:
    - Body: `{ chainIds: string[] }`
    - Validates array, max 50
    - Iterates `registry.archive(id)` for each (existing registry method)
    - Returns `{ ok: true, results: [{ chainId, archived: boolean, error?: string }] }`
  - `POST /api/bulk/dead-letters/requeue` — requeue multiple DLQ entries:
    - Body: `{ entryIds: string[] }`
    - Validates array, max 100
    - For each entry: calls `deadLetterQueue.get(id)`, then `coordinator.addTask()` with original task definition, then `deadLetterQueue.resolve(id, 'requeued')`
    - Returns `{ ok: true, results: [{ entryId, requeued: boolean, error?: string }] }`
  - `POST /api/bulk/dead-letters/discard` — permanently discard multiple DLQ entries:
    - Body: `{ entryIds: string[] }`
    - Validates array, max 100
    - Iterates `deadLetterQueue.resolve(id, 'discarded')` for each
    - Returns `{ ok: true, results: [{ entryId, discarded: boolean, error?: string }] }`

- **`operator/server.mjs` (~5 lines changed)**:
  - Import and wire `createBulkRoutes({ coordinator, registry, deadLetterQueue })`
  - Mount at `app.use('/api', bulkRoutes)`

- **`operator/public/taskboard.js` (~20 lines changed)**:
  - Wire existing batch selection checkboxes to new bulk endpoints:
    - "Cancel Selected" button calls `POST /api/bulk/tasks/cancel` with selected task IDs
    - "Retry Selected" button calls `POST /api/bulk/tasks/retry` with selected failed task IDs
  - Show result toast: "Cancelled 5/7 tasks" or "Retried 3/3 tasks"
  - Refresh board after bulk operation completes

### Test Plan
- `operator/__tests__/bulk.test.mjs` (~28 tests):
  - Bulk cancel: cancels multiple tasks, returns per-item results
  - Bulk cancel: partial failure (some tasks already cancelled)
  - Bulk cancel: empty array returns 400
  - Bulk cancel: array exceeding 100 items returns 400
  - Bulk cancel: includes optional reason in cancellation
  - Bulk retry: retries multiple failed tasks
  - Bulk retry: skips non-failed tasks with error in result
  - Bulk retry: empty results when no tasks match
  - Bulk update: updates priority on multiple tasks
  - Bulk update: updates category on multiple tasks
  - Bulk update: partial failure for non-existent task IDs
  - Bulk archive: archives multiple completed chains
  - Bulk archive: skips chains that are still running
  - Bulk archive: returns per-chain results
  - Bulk DLQ requeue: requeues entries back to coordinator task queue
  - Bulk DLQ requeue: preserves original task definition (category, priority, metadata)
  - Bulk DLQ requeue: resolves DLQ entry after requeue
  - Bulk DLQ discard: permanently removes entries
  - Bulk DLQ discard: partial failure for non-existent entries
  - Validation: rejects non-array taskIds
  - Validation: rejects missing required body fields
  - Route returns 503 when coordinator not available
  - Route returns 503 when deadLetterQueue not available (for DLQ routes)
  - Route returns 503 when registry not available (for chain archive)
  - Results array matches input array length
  - Error messages in results are human-readable
  - Bulk update with empty fields object is a no-op (returns success for each)
  - Concurrent bulk operations do not interfere with each other

### Dependencies
- Phase 6 (task queue cancel/retry/update methods)
- Phase 32 (DLQ get/resolve methods)
- Phase 13 (taskboard batch selection UI infrastructure)

---

## Phase 41: In-App Notification System

### Rationale
The operator system emits numerous events (task completions, terminal crashes, budget warnings, swarm scale events, DLQ additions) but there is no unified notification mechanism for the web UI. Users must watch multiple dashboards or rely on external webhooks. An in-app notification system aggregates important events into a notification feed with read/unread tracking, toast popups, and a notification bell in the nav bar.

### Changes

- **`operator/notifications.mjs` (new, ~120 lines)**: Factory `createNotificationManager(ctx)`:
  - `ctx.events` — EventBus for event subscription
  - `ctx.persistPath` — path to `operatorDir/.data/notifications.json`
  - `ctx.log` — logger (optional)
  - `ctx.maxNotifications` — ring buffer size (default 200)
  - Notification shape: `{ id, type, severity, title, body, ts, read, source, data }`
    - `type`: `'task'` | `'terminal'` | `'budget'` | `'swarm'` | `'system'` | `'dlq'`
    - `severity`: `'info'` | `'warning'` | `'error'` | `'success'`
  - Event subscriptions (auto-wired on creation):
    - `coord:task-complete` -> `{ type:'task', severity:'success', title:'Task completed', body:'{taskId} completed by {workerId}' }`
    - `coord:task-failed` -> `{ type:'task', severity:'error', title:'Task failed', body:'{taskId} failed: {error}' }`
    - `coord:budget-warning` -> `{ type:'budget', severity:'warning', title:'Budget warning', body:'{scope} at {ratio}% of budget' }`
    - `coord:budget-exceeded` -> `{ type:'budget', severity:'error', title:'Budget exceeded', body:'{scope} budget exceeded' }`
    - `claude-terminal:task-recovered` -> `{ type:'terminal', severity:'warning', title:'Task recovered', body:'Terminal crashed, task {taskId} requeued' }`
    - `claude-terminal:swarm-started` -> `{ type:'swarm', severity:'info', title:'Swarm started' }`
    - `claude-terminal:swarm-stopped` -> `{ type:'swarm', severity:'info', title:'Swarm stopped' }`
    - `coord:all-complete` -> `{ type:'task', severity:'success', title:'All tasks complete', body:'{complete} done, {failed} failed' }`
    - `dead-letter:added` -> `{ type:'dlq', severity:'warning', title:'Task moved to DLQ', body:'Task {taskId} failed permanently' }`
  - `getAll(options)` — returns notifications array; `options.unreadOnly` filters to unread; `options.type` filters by type; `options.limit`/`options.offset` for pagination
  - `getUnreadCount()` — returns number of unread notifications
  - `markRead(notificationId)` — marks single notification as read
  - `markAllRead()` — marks all notifications as read
  - `dismiss(notificationId)` — removes a notification
  - `clear()` — removes all notifications
  - Persistence: atomic write to disk on each new notification (debounced 1s to avoid thrashing)
  - `load()` — loads persisted notifications from disk
  - `destroy()` — unwires EventBus listeners, clears debounce timer
  - Emits `notification:new` on EventBus when a notification is created (for WS bridging to UI)

- **`operator/routes/notifications.mjs` (new, ~50 lines)**: Factory `createNotificationRoutes(ctx)`:
  - `ctx.notifications` — notification manager instance
  - `GET /api/notifications` — list notifications; query params: `?unreadOnly=true`, `?type=task`, `?limit=50`, `?offset=0`; returns `paginatedResponse()` envelope
  - `GET /api/notifications/count` — returns `{ unread: N, total: N }`
  - `POST /api/notifications/:id/read` — mark single notification as read
  - `POST /api/notifications/read-all` — mark all as read
  - `DELETE /api/notifications/:id` — dismiss single notification
  - `DELETE /api/notifications` — clear all notifications

- **`operator/server.mjs` (~10 lines changed)**:
  - Create `notificationManager = createNotificationManager({ events, persistPath, log })`
  - Wire `createNotificationRoutes({ notifications: notificationManager })` to `app.use('/api', ...)`
  - Load on startup: `notificationManager.load()`
  - Destroy on shutdown
  - Return `notificationManager` in app return object

- **`operator/ws.mjs` (~2 lines changed)**:
  - Add `notification:new` to `BRIDGED_EVENTS`

- **`operator/public/app.js` (~30 lines changed)**:
  - Notification bell icon in nav bar (all pages): badge showing unread count
  - Poll `GET /api/notifications/count` on page load and on `notification:new` WS event
  - Click bell opens dropdown overlay listing last 10 notifications (title + relative time + severity color)
  - "Mark all read" button in dropdown header
  - Click individual notification marks it as read
  - Toast popup for new high-severity notifications (warning/error) if `notificationsEnabled` preference is true

- **`operator/public/style.css` (~15 lines added)**:
  - `.notification-bell` — positioned in nav bar, badge counter
  - `.notification-dropdown` — overlay dropdown list
  - `.notification-item` — severity-colored left border, unread bold text
  - `.notification-badge` — circular red counter badge

### Test Plan
- `operator/__tests__/notifications.test.mjs` (~27 tests):
  - Event subscription: `coord:task-complete` creates success notification
  - Event subscription: `coord:task-failed` creates error notification
  - Event subscription: `coord:budget-warning` creates warning notification
  - Event subscription: `coord:budget-exceeded` creates error notification
  - Event subscription: `claude-terminal:task-recovered` creates warning notification
  - Event subscription: `coord:all-complete` creates success notification
  - Event subscription: `dead-letter:added` creates warning notification
  - `getAll()` returns all notifications in reverse chronological order
  - `getAll({ unreadOnly: true })` filters to unread only
  - `getAll({ type: 'task' })` filters by type
  - `getAll()` paginates with limit/offset
  - `getUnreadCount()` returns correct count
  - `markRead()` marks notification as read
  - `markAllRead()` marks all as read
  - `dismiss()` removes a notification
  - `clear()` removes all notifications
  - Ring buffer: oldest notifications evicted after maxNotifications
  - Persistence: save and load cycle preserves notifications
  - `notification:new` event emitted on EventBus
  - `destroy()` unwires listeners
  - Route: GET /api/notifications returns paginated list (supertest)
  - Route: GET /api/notifications/count returns counts (supertest)
  - Route: POST /api/notifications/:id/read marks as read (supertest)
  - Route: POST /api/notifications/read-all marks all (supertest)
  - Route: DELETE /api/notifications/:id removes notification (supertest)
  - Route: DELETE /api/notifications clears all (supertest)
  - Notification body templates are filled correctly from event data

### Dependencies
- Phase 31 (audit log events as notification sources)
- Phase 32 (DLQ events for `dead-letter:added`)
- Phase 38 (webhook events pattern, EventBus interception)
- Phase 39 (user preferences for `notificationsEnabled`)

---

## Phase 42: Rate Limit Headers & Response Caching

### Rationale
API consumers have no visibility into rate limit state from HTTP responses. They must poll the `/api/coordination/rate-limit` endpoint separately. Standard `X-RateLimit-*` headers on all API responses let clients self-throttle proactively. Additionally, several read-heavy endpoints (health, metrics, coordination status, pool status) are called frequently but change slowly. A lightweight response cache with short TTLs reduces redundant computation without adding npm dependencies.

### Changes

- **`operator/middleware/rate-headers.mjs` (new, ~50 lines)**: Factory `createRateLimitHeadersMiddleware(ctx)`:
  - `ctx.rateLimiter` — rate limiter instance (may be null)
  - Returns Express middleware that sets headers on every response:
    - `X-RateLimit-Limit`: `maxRequestsPerMinute` value
    - `X-RateLimit-Remaining`: current `requestBucket` floor
    - `X-RateLimit-Reset`: seconds until next full refill (estimated)
    - If rate limiter is null, sets `X-RateLimit-Limit: unlimited`
  - Reads from `rateLimiter.getStatus()` — the method already calls `refill()` internally so values are fresh
  - Lightweight: no async, no blocking, runs in O(1)

- **`operator/middleware/response-cache.mjs` (new, ~80 lines)**: Factory `createResponseCache(ctx)`:
  - `ctx.ttlMs` — default TTL (default 2000ms / 2 seconds)
  - `ctx.maxEntries` — max cache entries (default 50)
  - `ctx.routes` — Map of route patterns to TTL overrides, e.g.:
    ```
    {
      '/api/health': 5000,
      '/api/metrics': 5000,
      '/api/coordination/status': 3000,
      '/api/claude-terminals/pool-status': 3000,
      '/api/coordination/progress': 2000,
    }
    ```
  - Returns Express middleware:
    - Only caches GET requests
    - Cache key: `req.path + '?' + req.query` (sorted query string for consistency)
    - If cache hit and not expired: sets `X-Cache: HIT`, returns cached body and status
    - If cache miss or expired: monkey-patches `res.json()` to capture response, stores `{ status, body, createdAt }`, sets `X-Cache: MISS`
    - `purge(pattern?)` — clears cache entries matching a path pattern (or all)
    - POST/PUT/DELETE/PATCH requests auto-purge related cache entries (same path prefix)
  - Invalidation: emits `events.on('cache:purge', pattern)` for programmatic invalidation
  - `getStats()` — returns `{ entries, hits, misses, hitRate }`

- **`operator/server.mjs` (~15 lines changed)**:
  - Import `createRateLimitHeadersMiddleware` and `createResponseCache`
  - After coordinator creation (so rateLimiter reference is available):
    ```
    const rateLimiterRef = coordinator?.rateLimiter || null;
    app.use(createRateLimitHeadersMiddleware({ rateLimiter: rateLimiterRef }));
    ```
  - Create response cache and mount before API routes:
    ```
    const responseCache = createResponseCache({
      routes: { '/api/health': 5000, '/api/metrics': 5000, ... },
      events,
    });
    app.use(responseCache.middleware);
    ```
  - Add cache stats endpoint: `GET /api/cache/stats` -> `responseCache.getStats()`
  - Add cache purge endpoint: `POST /api/cache/purge` -> `responseCache.purge(req.body.pattern)`
  - Return `responseCache` in app return object

### Test Plan
- `operator/__tests__/rate-headers-cache.test.mjs` (~28 tests):
  - Rate limit headers present on API response
  - `X-RateLimit-Limit` matches `maxRequestsPerMinute`
  - `X-RateLimit-Remaining` decreases after requests
  - `X-RateLimit-Reset` is a positive number
  - Rate limit headers show `unlimited` when no coordinator
  - Rate limit headers work alongside auth and request-id headers
  - Response cache: first GET returns `X-Cache: MISS`
  - Response cache: second GET within TTL returns `X-Cache: HIT`
  - Response cache: second GET after TTL expiry returns `X-Cache: MISS`
  - Response cache: cached response has same status code and body
  - Response cache: POST request bypasses cache
  - Response cache: POST request purges related GET cache
  - Response cache: query string variations are cached separately
  - Response cache: custom TTL per route is respected
  - Response cache: `purge()` clears matching entries
  - Response cache: `purge()` without pattern clears all
  - Response cache: max entries eviction (LRU or oldest)
  - Response cache: `getStats()` tracks hits and misses
  - Response cache: hit rate calculation is correct
  - Cache stats endpoint returns stats (supertest)
  - Cache purge endpoint clears cache (supertest)
  - Health endpoint cached for 5s
  - Metrics endpoint cached for 5s
  - Coordination status cached for 3s
  - Pool status cached for 3s
  - Non-cached routes return `X-Cache: BYPASS`
  - Middleware order: rate headers appear even on cached responses
  - Mutation events (EventBus cache:purge) invalidate cache

### Dependencies
- Phase 6 (rate limiter `getStatus()` method)
- Phase 28 (request-id middleware pattern for middleware factory)

---

## Phase 43: Cost Forecasting & Budget Alerts

### Rationale
The cost aggregator (Phase 6A) tracks cumulative spend but provides no forward-looking projections. Operators cannot answer "at this rate, when will I hit my budget?" or "what will this swarm run cost me?". A cost forecaster analyzes recent spend rate and projects time-to-budget-exhaustion, estimated session cost, and hourly burn rate. Budget alerts provide proactive warnings at configurable thresholds (not just the fixed 80% warning in cost-aggregator).

### Changes

- **`operator/coordination/cost-forecaster.mjs` (new, ~100 lines)**: Factory `createCostForecaster(ctx)`:
  - `ctx.costAggregator` — cost aggregator instance
  - `ctx.events` — EventBus for real-time cost events
  - `ctx.alertThresholds` — array of alert percentages (default `[50, 75, 90, 95]`)
  - `ctx.windowMs` — sliding window for rate calculation (default 30 minutes)
  - Internal state:
    - `_costEvents[]` — ring buffer of `{ ts, usd }` entries from `coord:cost` and `session:complete` events, max 500
    - `_alertsFired` — Set of threshold percentages already fired (to avoid duplicate alerts)
  - `getBurnRate()` — returns `{ usdPerHour, usdPerMinute, eventsInWindow, windowMs }`:
    - Calculates total spend within window, divides by window duration
    - Returns 0 if no events in window
  - `getForecast()` — returns:
    ```
    {
      burnRate: { usdPerHour, usdPerMinute },
      globalBudgetUsd,
      globalSpentUsd,
      globalRemainingUsd,
      timeToExhaustionMs,       // null if burn rate is 0
      timeToExhaustionFormatted, // "2h 15m" or "N/A"
      estimatedSessionCostUsd,  // avg cost per session in window
      estimatedHourlyCostUsd,
      projectedDailyCostUsd,
    }
    ```
  - `checkAlerts()` — evaluates current spend against `alertThresholds`:
    - For each threshold: if `spentRatio >= threshold/100` and not already fired, emits `cost:alert` event with `{ threshold, spent, budget, ratio }`
    - Returns array of newly-fired alerts
  - Event wiring: subscribes to `coord:cost` and `session:complete` to record spend events; calls `checkAlerts()` after each recording
  - `reset()` — clears event buffer and fired alerts (for testing or budget change)
  - `destroy()` — unwires EventBus listeners

- **`operator/routes/coordination.mjs` (~15 lines changed)**:
  - `GET /api/coordination/forecast` — returns `costForecaster.getForecast()` (requires coordinator)
  - `GET /api/coordination/burn-rate` — returns `costForecaster.getBurnRate()` (lightweight, no forecast math)
  - `POST /api/coordination/forecast/reset` — resets forecaster (e.g., after budget change)

- **`operator/coordination/coordinator.mjs` (~10 lines changed)**:
  - Create `costForecaster` internally (or accept injected `ctx.costForecaster`)
  - Accept `ctx.options.alertThresholds` for configurable alert levels
  - Expose `costForecaster` on returned object
  - On `updateOptions()`: if `globalBudgetUsd` changes, call `costForecaster.reset()` to recalibrate alerts

- **`operator/public/app.js` or `operator/public/taskboard.js` (~15 lines changed)**:
  - Cost forecast widget in taskboard header (next to existing cost display):
    - Shows burn rate ($/hr) and time-to-exhaustion
    - Color-coded: green (<50%), yellow (50-75%), orange (75-90%), red (>90%)
  - Refreshes on `coord:cost` WS event or every 30s

- **`operator/ws.mjs` (~1 line changed)**:
  - Add `cost:alert` to `BRIDGED_EVENTS`

### Test Plan
- `operator/__tests__/cost-forecaster.test.mjs` (~26 tests):
  - `getBurnRate()` returns 0 with no events
  - `getBurnRate()` calculates correct rate from event buffer
  - `getBurnRate()` respects sliding window (old events excluded)
  - `getForecast()` returns all fields
  - `getForecast()` calculates `timeToExhaustionMs` correctly
  - `getForecast()` formats time as "Xh Ym"
  - `getForecast()` returns null exhaustion when burn rate is 0
  - `getForecast()` tracks remaining budget correctly
  - `estimatedSessionCostUsd` averages cost per session
  - `projectedDailyCostUsd` is 24x hourly rate
  - Alert: fires at 50% threshold
  - Alert: fires at 75% threshold
  - Alert: does not re-fire same threshold
  - Alert: fires multiple thresholds if spend jumps past several
  - Alert: emits `cost:alert` event on EventBus
  - `reset()` clears fired alerts and event buffer
  - `reset()` allows alerts to fire again
  - Event wiring: `coord:cost` events are recorded
  - Event wiring: `session:complete` events are recorded
  - `destroy()` unwires listeners
  - Route: GET /api/coordination/forecast returns forecast (supertest)
  - Route: GET /api/coordination/burn-rate returns rate (supertest)
  - Route: POST /api/coordination/forecast/reset resets (supertest)
  - Custom alert thresholds are respected
  - Ring buffer evicts oldest events past max size
  - Coordinator exposes `costForecaster` on return object

### Dependencies
- Phase 6A (cost aggregator `getStatus()` method for budget/spend data)
- Phase 6A (coordinator `updateOptions()` for budget change handling)

---

## Phase 44: OpenAPI Auto-Documentation

### Rationale
The operator REST API has grown to 50+ endpoints across 14 route files but has no machine-readable specification. Consumers rely on reading source code or the hand-maintained `docs/api-reference.md` (which is perpetually outdated). An auto-generated OpenAPI 3.0 specification derived from route definitions and `validateBody()` schemas provides always-current documentation, enables client code generation, and supports Swagger UI browsing.

### Changes

- **`operator/openapi.mjs` (new, ~130 lines)**: Factory `createOpenApiSpec(ctx)`:
  - `ctx.version` — API version (default '1.0.0')
  - `ctx.title` — API title (default 'Jousting Operator API')
  - `ctx.host` — server URL (default 'http://localhost:3100')
  - Builds an OpenAPI 3.0.3 JSON spec by scanning the registered Express routes:
  - `buildSpec(app)` — traverses Express router stack to extract:
    - Route method (GET, POST, PUT, PATCH, DELETE)
    - Route path (converted from Express `:param` to OpenAPI `{param}`)
    - Groups routes by path prefix into tags: `coordination`, `claude-terminals`, `shared-memory`, `terminal-messages`, `chains`, `orchestrator`, `git`, `settings`, `files`, `export`, `timeline`, `webhooks`, `audit`, `dead-letters`, `bulk`, `notifications`, `preferences`, `system`, `health`
  - Schema extraction from `validateBody()` usage:
    - `extractSchemaFromValidation(schema)` — converts the `{ field: { type, required, min, max, enum, maxLength } }` format to OpenAPI schema objects:
      - `type: 'string'` -> `{ type: 'string' }`
      - `type: 'number', min, max` -> `{ type: 'number', minimum, maximum }`
      - `type: 'boolean'` -> `{ type: 'boolean' }`
      - `type: 'array'` -> `{ type: 'array', items: {} }`
      - `required: true` -> added to `required` array
      - `enum: [...]` -> `{ enum: [...] }`
    - This is a static analysis of the schema objects passed to `validateBody()`, not runtime introspection
  - Route metadata registry: `registerRoute(method, path, options)` allows route files to declare:
    - `summary` — short description
    - `description` — detailed description
    - `tags` — OpenAPI tags
    - `requestSchema` — the validateBody schema object (auto-converted)
    - `responseSchema` — example response shape
    - `params` — path parameter descriptions
    - `query` — query parameter descriptions
  - Fallback: routes without explicit metadata get auto-generated summaries from method+path
  - Common response schemas: `ErrorResponse`, `PaginatedResponse`, `OkResponse`
  - Security scheme: Bearer token (`jst_*` format)
  - `getSpec()` — returns the full OpenAPI JSON object
  - `getYaml()` — returns YAML string (simple JSON-to-YAML conversion, no npm dep)

- **`operator/routes/*.mjs` (~5 lines each, ~60 lines total across 12 route files)**:
  - Each route factory optionally calls `registerRoute()` for its endpoints with summary, tags, and schema references
  - This is additive and non-breaking: route files that do not call `registerRoute()` still appear in the spec with auto-generated descriptions

- **`operator/server.mjs` (~10 lines changed)**:
  - Import `createOpenApiSpec`
  - Create spec builder, call `buildSpec(app)` after all routes are mounted
  - `GET /api/openapi.json` — returns `openApiSpec.getSpec()` (JSON)
  - `GET /api/docs` — serves a minimal Swagger UI HTML page (inline, no npm dep):
    - Embeds `swagger-ui-dist` from CDN (`https://unpkg.com/swagger-ui-dist/`)
    - Points at `/api/openapi.json`
    - ~20 lines of HTML
  - Both endpoints skip auth (public documentation)

- **`operator/public/style.css` (~5 lines added)**:
  - Link to "API Docs" in nav bar (all pages)

### Test Plan
- `operator/__tests__/openapi.test.mjs` (~25 tests):
  - `buildSpec()` returns valid OpenAPI 3.0.3 structure
  - Spec has correct `info.title` and `info.version`
  - Spec has `servers` array with correct host
  - All major route groups appear as tags
  - `extractSchemaFromValidation()` converts string type correctly
  - `extractSchemaFromValidation()` converts number with min/max
  - `extractSchemaFromValidation()` converts boolean type
  - `extractSchemaFromValidation()` converts array type
  - `extractSchemaFromValidation()` marks required fields
  - `extractSchemaFromValidation()` handles enum values
  - `registerRoute()` adds custom summary and description
  - Registered routes have correct request body schema
  - Registered routes have correct response schema
  - Auto-generated routes have fallback summaries
  - Security scheme is defined as Bearer
  - Health and metrics endpoints are public (no security)
  - Path parameters use OpenAPI `{param}` format
  - Query parameters are documented on GET routes
  - Common schemas (ErrorResponse, PaginatedResponse) are defined
  - `getSpec()` returns parseable JSON
  - `getYaml()` returns valid YAML-like output
  - Route: `GET /api/openapi.json` returns spec (supertest)
  - Route: `GET /api/docs` returns HTML page (supertest)
  - Docs page references `/api/openapi.json` in HTML
  - Spec includes Bearer auth requirement on protected routes

### Dependencies
- Phase 29 (validation.mjs `validateBody` schemas as source of truth)
- Phase 27 (auth scheme for security definition)
- All prior phases (routes are scanned for spec generation)

---

## Summary Table

| Phase | Title | Priority Area | New Files | Changed Files | Est. Tests |
|-------|-------|--------------|-----------|---------------|------------|
| 39 | User Preferences Persistence | UX | `preferences.mjs`, `routes/preferences.mjs` | `server.mjs`, `app.js` | 25 |
| 40 | Bulk Operations | API Completeness | `routes/bulk.mjs` | `server.mjs`, `taskboard.js` | 28 |
| 41 | In-App Notification System | UX | `notifications.mjs`, `routes/notifications.mjs` | `server.mjs`, `ws.mjs`, `app.js`, `style.css` | 27 |
| 42 | Rate Limit Headers & Response Caching | API Hardening | `middleware/rate-headers.mjs`, `middleware/response-cache.mjs` | `server.mjs` | 28 |
| 43 | Cost Forecasting & Budget Alerts | Observability | `coordination/cost-forecaster.mjs` | `coordinator.mjs`, `routes/coordination.mjs`, `ws.mjs`, `taskboard.js` | 26 |
| 44 | OpenAPI Auto-Documentation | API Completeness | `openapi.mjs` | `server.mjs`, `routes/*.mjs` (12 files), `style.css` | 25 |

**Total estimated: ~159 new tests across 6 new test files, ~830 lines of new production code, ~160 lines changed in existing files.**
