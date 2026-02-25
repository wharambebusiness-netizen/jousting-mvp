# Milestone Plan: Phases 45-50

## Overview

Phases 45-50 close the final feature gaps identified after Phase 44. Phase 45 adds **secrets management** so API keys and sensitive configuration are encrypted at rest rather than stored as plaintext in settings.json. Phase 46 delivers **global search** providing a single unified query across tasks, messages, audit log, terminals, and chains. Phase 47 enhances the **dashboard with real-time widgets** surfacing system-wide metrics, active terminals, recent tasks, and cost breakdown without navigating to subpages. Phase 48 improves **terminal session management** with resume, clone, templates, and session history. Phase 49 hardens **WebSocket reliability** with heartbeats, buffered replay, connection quality indicators, and graceful degradation. Phase 50 adds **request performance tracking** with per-endpoint latency histograms, slow request detection, and a performance dashboard.

Each phase is scoped for a single session (~80-150 lines of production code, 20-30 tests), builds incrementally on prior work, and follows existing factory/EventBus/atomic-write patterns.

---

## Phase 45: Secrets Management

### Rationale
API keys and sensitive values (e.g., webhook URLs with tokens, cost budget thresholds that reveal spending, potential future integration keys) are stored as plaintext in `settings.json` and various `.data/*.json` files. The auth system (Phase 27) already hashes tokens at rest, but other sensitive configuration has no protection. A secrets vault encrypts values at rest using a machine-derived key, provides a clean API for storing/retrieving secrets, and replaces plaintext sensitive fields in settings with vault references.

### Changes

- **`operator/secrets.mjs` (new, ~120 lines)**: Factory `createSecretVault(ctx)`:
  - `ctx.operatorDir` — base directory for persistence
  - `ctx.log` — logger (optional)
  - `ctx.masterKey` — optional explicit master key (for testing); if omitted, derives from machine identity
  - Persistence at `operatorDir/.data/secrets.vault` (encrypted JSON blob)
  - Encryption: AES-256-GCM via Node.js `node:crypto`
    - Key derivation: `pbkdf2Sync` with machine-derived salt (hostname + operatorDir hash) when no explicit masterKey provided
    - Each save generates a fresh random IV (12 bytes), stores as `{ iv, tag, data }` base64-encoded
  - `set(name, value)` — stores an encrypted secret; `name` must match `/^[a-zA-Z0-9_.-]+$/`, max 64 chars; `value` is a string, max 4096 chars
  - `get(name)` — retrieves and decrypts a secret; returns `null` if not found
  - `has(name)` — returns boolean indicating if secret exists (without decrypting)
  - `delete(name)` — removes a secret
  - `list()` — returns array of secret names (no values)
  - `count()` — returns number of stored secrets
  - `load()` — reads and decrypts vault from disk; called on startup
  - `_save()` — encrypts and writes vault to disk (atomic temp+rename)
  - Internal: decrypted state held in a `Map` in memory; only encrypted form touches disk
  - Graceful fallback: if vault file is corrupt or key mismatch, logs warning and starts with empty vault (does not crash server)

- **`operator/routes/secrets.mjs` (new, ~60 lines)**: Factory `createSecretRoutes(ctx)`:
  - `ctx.secretVault` — vault instance
  - All routes require auth (no skip list — secrets are always protected)
  - `GET /api/secrets` — returns `{ secrets: vault.list() }` (names only, never values)
  - `GET /api/secrets/:name` — returns `{ name, exists: true }` (confirmation only, never exposes value via API)
  - `PUT /api/secrets/:name` — stores a secret: `{ value: "..." }` body; validates name format and value length; returns `{ ok: true, name }`
  - `DELETE /api/secrets/:name` — deletes a secret; returns `{ ok: true, deleted: boolean }`
  - `GET /api/secrets/:name/value` — retrieves the actual decrypted value; requires explicit `?confirm=true` query parameter as a safety gate; returns `{ name, value }`
  - No bulk export endpoint (by design — secrets should not be easily mass-extracted)

- **`operator/server.mjs` (~12 lines changed)**:
  - Import `createSecretVault` and `createSecretRoutes`
  - Create `secretVault = createSecretVault({ operatorDir, log: logger })` after auth creation
  - Call `secretVault.load()` on startup
  - Wire `createSecretRoutes({ secretVault })` to `app.use('/api', ...)`
  - Return `secretVault` in the app return object
  - Opt out with `secrets: false`, inject with object

- **`operator/health.mjs` (~5 lines changed)**:
  - Add `secretVault` component probe: `{ status: 'healthy', count: vault.count() }` or `{ status: 'unavailable' }`

- **`operator/public/settings.html` (~15 lines changed)**:
  - New "Secrets" section below existing settings form
  - List of secret names with masked values ("********")
  - Add/edit form: name input + value textarea + Save button
  - Delete button per secret
  - No reveal button (forces use of API with `?confirm=true` for programmatic access)

### Test Plan
- `operator/__tests__/secrets.test.mjs` (~28 tests):
  - `set()` stores a secret that `get()` retrieves
  - `set()` validates name format (rejects special chars)
  - `set()` rejects names exceeding 64 chars
  - `set()` rejects values exceeding 4096 chars
  - `get()` returns null for non-existent secret
  - `has()` returns true for existing, false for missing
  - `delete()` removes a secret
  - `delete()` returns false for non-existent
  - `list()` returns all secret names
  - `count()` tracks secret count accurately
  - Persistence: save+load cycle preserves secrets
  - Encryption: vault file on disk is not plaintext readable
  - Encryption: different master keys cannot decrypt vault
  - Corrupt vault file: load() starts with empty vault, logs warning
  - Missing vault file: load() starts with empty vault (no error)
  - Atomic write: temp file used during save
  - Multiple secrets: independent storage and retrieval
  - Overwrite: set() with existing name updates value
  - Route: GET /api/secrets returns name list (supertest)
  - Route: PUT /api/secrets/:name stores secret (supertest)
  - Route: DELETE /api/secrets/:name removes secret (supertest)
  - Route: GET /api/secrets/:name/value without confirm returns 400
  - Route: GET /api/secrets/:name/value with confirm=true returns value (supertest)
  - Route: GET /api/secrets/:name returns exists status (supertest)
  - Health checker includes secretVault component
  - Validation: empty name rejected
  - Validation: empty value allowed (for clearing)
  - Fresh IV per save: two consecutive saves produce different ciphertext

### Dependencies
- Phase 27 (auth middleware protects all secret routes)
- Phase 29 (validation patterns for input sanitization)
- Phase 34 (health checker extension)

---

## Phase 46: Global Search

### Rationale
The operator system stores data across 6+ subsystems (task queue, message bus, audit log, chains, terminals, shared memory) but there is no unified search. Users must navigate to each page individually and use per-page search. A global search endpoint aggregates results from all subsystems, returning ranked results with source attribution. The UI provides a command-palette-style search accessible from any page.

### Changes

- **`operator/search.mjs` (new, ~130 lines)**: Factory `createSearchEngine(ctx)`:
  - `ctx.coordinator` — coordinator for task queue search
  - `ctx.messageBus` — message bus for message search
  - `ctx.auditLog` — audit log for event search
  - `ctx.registry` — chain registry for chain search
  - `ctx.claudePool` — terminal pool for terminal search
  - `ctx.sharedMemory` — shared memory for key-value search
  - `search(query, options)` — main search method:
    - `query` — string, min 2 chars, max 200 chars
    - `options.sources` — array of sources to search (default: all), e.g. `['tasks', 'messages', 'audit', 'chains', 'terminals', 'memory']`
    - `options.limit` — max results per source (default 10)
    - `options.dateFrom` / `options.dateTo` — date range filter (ISO strings)
    - Returns `{ results: [...], totalHits, duration, query }` where each result is:
      ```
      {
        source: 'tasks' | 'messages' | 'audit' | 'chains' | 'terminals' | 'memory',
        id: string,
        title: string,       // primary display text
        subtitle: string,    // secondary context
        matchField: string,  // which field matched
        timestamp: string,   // ISO date
        url: string,         // link to detail page
        score: number,       // relevance score
      }
      ```
  - Source search implementations (each wrapped in try/catch, skips unavailable):
    - **Tasks**: searches `taskQueue.getAll()` matching `description`, `category`, `metadata` fields; score boosted for exact match in description
    - **Messages**: searches `messageBus.getAll()` matching `content`, `from`, `to` fields; score boosted for content match
    - **Audit**: searches `auditLog.query({ search: query })` using existing audit search; maps audit entries to result shape
    - **Chains**: searches `registry.load().chains` matching `task`, `branch`, `projectDir` fields
    - **Terminals**: searches `claudePool.listAll()` matching `id`, `model`, `assignedTask.description` fields
    - **Memory**: searches `sharedMemory.keys()` + values matching key names and string values
  - `_scoreResult(query, text)` — simple relevance scoring: exact match = 10, starts-with = 7, contains = 5, word boundary match = 3
  - Results sorted by score descending across all sources, then sliced to overall limit
  - Performance: each source search has a 500ms timeout (returns partial results on timeout)

- **`operator/routes/search.mjs` (new, ~40 lines)**: Factory `createSearchRoutes(ctx)`:
  - `ctx.searchEngine` — search engine instance
  - `GET /api/search?q=&sources=&limit=&dateFrom=&dateTo=` — returns search results
    - `q` required, min 2 chars
    - `sources` optional, comma-separated
    - `limit` optional, default 50, max 100
    - Returns paginated response envelope with results
  - `GET /api/search/sources` — returns list of available search sources (for UI)

- **`operator/server.mjs` (~10 lines changed)**:
  - Import `createSearchEngine` and `createSearchRoutes`
  - Create search engine after all subsystems are initialized
  - Wire routes to `app.use('/api', ...)`
  - Return `searchEngine` in app return object

- **`operator/public/app.js` (~40 lines changed)**:
  - Command palette: `Ctrl+K` / `Cmd+K` opens search overlay from any page
  - Search overlay: full-width input at top, results grouped by source below
  - Debounced input (300ms) triggers `GET /api/search?q=...`
  - Result groups: collapsible sections per source with count badges
  - Click result navigates to detail page (chain detail, taskboard, timeline, etc.)
  - `Escape` closes overlay
  - Recent searches: last 5 queries stored in `localStorage` for quick access

- **`operator/public/style.css` (~20 lines added)**:
  - `.search-overlay` — fixed overlay with backdrop blur
  - `.search-input` — large input with search icon
  - `.search-results` — grouped result list with source headers
  - `.search-result` — clickable result item with title, subtitle, source badge
  - `.search-empty` — "No results" state

### Test Plan
- `operator/__tests__/search.test.mjs` (~26 tests):
  - `search()` returns results from all sources
  - `search()` respects `sources` filter (single source)
  - `search()` respects `sources` filter (multiple sources)
  - `search()` respects `limit` parameter
  - `search()` returns empty results for no-match query
  - `search()` rejects queries under 2 chars
  - Task search: matches task description
  - Task search: matches task category
  - Message search: matches message content
  - Message search: matches sender/recipient
  - Audit search: matches audit action field
  - Chain search: matches chain task description
  - Chain search: matches branch name
  - Terminal search: matches terminal ID
  - Memory search: matches key name
  - Memory search: matches string value
  - Scoring: exact match scores higher than partial
  - Scoring: results sorted by score descending
  - Date range: filters results by timestamp
  - Unavailable source: skips gracefully (no error)
  - Performance: `duration` field is populated
  - Route: GET /api/search?q=test returns results (supertest)
  - Route: GET /api/search without q returns 400 (supertest)
  - Route: GET /api/search/sources returns source list (supertest)
  - Source timeout: partial results returned on slow source
  - `totalHits` reflects cross-source total

### Dependencies
- Phase 6 (task queue `getAll()` for task search)
- Phase 18 (message bus `getAll()` for message search)
- Phase 31 (audit log `query()` for audit search)
- Phase 35 (pagination response envelope)

---

## Phase 47: Dashboard Real-Time Widgets

### Rationale
The dashboard (`index.html`) shows chains, cost summary, git status, and collapsible analytics/reports sections but lacks real-time operational widgets. Operators must navigate to `/terminals`, `/taskboard`, and other pages to see active system state. Adding live widgets for terminal status, active tasks, recent notifications, and system health provides a single-pane-of-glass overview.

### Changes

- **`operator/views/dashboard-widgets.mjs` (new, ~120 lines)**: Factory functions for HTMX fragment widgets:
  - `renderSystemHealthWidget(healthData)` — compact health status card:
    - Overall status indicator (green/yellow/red dot)
    - Component status grid: coordinator, pool, memory, messages, disk (5 mini-indicators)
    - Uptime display formatted as "Xd Xh Xm"
    - Links to `/api/health` for full detail
  - `renderActiveTerminalsWidget(poolStatus, terminals)` — terminal overview:
    - Running/stopped/active/idle counts in a 4-cell mini grid
    - Up to 4 most recent terminal names with status dots and activity state
    - "View All" link to `/terminals`
    - Swarm status badge if swarm is active (running/stopped with metrics summary)
  - `renderTaskSummaryWidget(metrics)` — task queue overview:
    - Donut chart (SVG) with pending/running/complete/failed segments
    - Numeric counters for each status
    - "View Board" link to `/taskboard`
    - Active task rate (tasks/hour from swarm metrics if available)
  - `renderRecentNotificationsWidget(notifications)` — last 5 notifications:
    - Severity-colored left border per notification
    - Title + relative time
    - Unread count badge
    - "View All" link (opens notification dropdown from app.js)
  - `renderCostWidget(forecast)` — cost burn rate and forecast:
    - Current burn rate ($/hr) with trend arrow (up/down/flat)
    - Time to budget exhaustion with color coding
    - Budget progress bar (spent / total)
    - "View Details" link to `/taskboard` (which shows cost detail)

- **`operator/routes/views.mjs` (~25 lines changed)**:
  - Add 5 new HTMX fragment routes:
    - `GET /views/widget-health` — renders `renderSystemHealthWidget(healthChecker.check())`
    - `GET /views/widget-terminals` — renders `renderActiveTerminalsWidget(claudePool.getPoolStatus(), claudePool.listAll())`
    - `GET /views/widget-tasks` — renders `renderTaskSummaryWidget(coordinator.getMetrics())`
    - `GET /views/widget-notifications` — renders `renderRecentNotificationsWidget(notifications.getAll({limit:5}))`
    - `GET /views/widget-cost` — renders `renderCostWidget(costForecaster?.getForecast())`
  - Pass new subsystem references: `healthChecker`, `claudePool`, `notifications`, `costForecaster` to view routes

- **`operator/server.mjs` (~5 lines changed)**:
  - Pass additional context to `createViewRoutes`: `healthChecker`, `claudePool`, `notifications`, `costForecaster`

- **`operator/public/index.html` (~30 lines changed)**:
  - New "System Overview" section above cost summary with 2x3 widget grid:
    - Row 1: Health widget + Terminal widget + Task widget
    - Row 2: Cost widget + Notifications widget + (empty/placeholder)
  - Each widget uses `hx-get="/views/widget-*"` with `hx-trigger="load, every 10s"`
  - Skeleton placeholders during load
  - Responsive: 3-col on desktop, 2-col on tablet, 1-col on mobile

- **`operator/public/style.css` (~25 lines added)**:
  - `.widget-grid` — CSS grid with responsive breakpoints
  - `.widget-card` — compact card with header, body, footer link
  - `.widget-health-grid` — 5-cell component status grid
  - `.widget-donut` — SVG donut chart container
  - `.widget-metric` — large number with label below

### Test Plan
- `operator/__tests__/dashboard-widgets.test.mjs` (~24 tests):
  - `renderSystemHealthWidget()` renders status dot with correct class for healthy
  - `renderSystemHealthWidget()` renders degraded state correctly
  - `renderSystemHealthWidget()` renders unhealthy state correctly
  - `renderSystemHealthWidget()` includes all component indicators
  - `renderSystemHealthWidget()` formats uptime correctly
  - `renderActiveTerminalsWidget()` shows running/stopped counts
  - `renderActiveTerminalsWidget()` limits terminal list to 4 items
  - `renderActiveTerminalsWidget()` shows swarm badge when active
  - `renderActiveTerminalsWidget()` handles empty pool gracefully
  - `renderTaskSummaryWidget()` renders SVG donut with segments
  - `renderTaskSummaryWidget()` shows all status counters
  - `renderTaskSummaryWidget()` handles zero tasks
  - `renderRecentNotificationsWidget()` renders up to 5 items
  - `renderRecentNotificationsWidget()` shows unread badge count
  - `renderRecentNotificationsWidget()` handles empty notifications
  - `renderCostWidget()` shows burn rate
  - `renderCostWidget()` shows time to exhaustion
  - `renderCostWidget()` renders budget progress bar
  - `renderCostWidget()` handles null forecast (no coordinator)
  - Route: GET /views/widget-health returns HTML (supertest)
  - Route: GET /views/widget-terminals returns HTML (supertest)
  - Route: GET /views/widget-tasks returns HTML (supertest)
  - Route: GET /views/widget-notifications returns HTML (supertest)
  - Route: GET /views/widget-cost returns HTML (supertest)

### Dependencies
- Phase 34 (health checker for system health widget)
- Phase 41 (notifications for recent notifications widget)
- Phase 43 (cost forecaster for cost widget)
- Phase 15 (claude pool for terminal widget)
- Phase 6 (coordinator metrics for task widget)

---

## Phase 48: Terminal Session Management

### Rationale
Claude terminals currently lack session persistence and management. Once a terminal exits, there is no way to recall what happened in it, resume the context, or start new terminals from saved configurations. Operators must manually remember terminal IDs and settings. This phase adds session history recording, resume (re-spawn with same config + context injection), clone (copy a terminal's configuration), and session templates (named configurations for common tasks).

### Changes

- **`operator/terminal-sessions.mjs` (new, ~130 lines)**: Factory `createTerminalSessionStore(ctx)`:
  - `ctx.persistPath` — path to `operatorDir/.data/terminal-sessions.json`
  - `ctx.events` — EventBus for terminal lifecycle events
  - `ctx.maxSessions` — max stored sessions (default 100, FIFO eviction)
  - `ctx.log` — logger (optional)
  - Session shape:
    ```
    {
      id: string,               // matches terminal ID
      startedAt: string,        // ISO timestamp
      endedAt: string | null,   // ISO timestamp (null if running)
      exitCode: number | null,  // null if running
      config: {                 // spawn options used
        model: string,
        projectDir: string,
        dangerouslySkipPermissions: boolean,
        systemPrompt: string | null,
        capabilities: string[] | null,
      },
      taskHistory: string[],    // categories of tasks worked on
      lastTaskId: string | null,
      handoffCount: number,     // times this session was handed off
      outputSummary: string,    // last 500 chars of terminal output (ANSI stripped)
      duration: number,         // ms from start to end
    }
    ```
  - Event wiring (auto-subscribes on creation):
    - `claude-terminal:spawned` -> creates session record from spawn data
    - `claude-terminal:exit` -> updates `endedAt`, `exitCode`, `duration`, captures `outputSummary` from pool entry's `getOutputBuffer()`
    - `claude-terminal:handoff` -> increments `handoffCount`
    - `claude-terminal:task-completed` -> appends to `taskHistory`
  - `getSession(id)` — returns session by ID
  - `listSessions(options)` — returns sessions; `options.status` filters running/completed/all; `options.limit`/`options.offset` for pagination; `options.sort` by `startedAt` or `duration`
  - `getResumeConfig(id)` — returns a spawn config derived from the session: same model, projectDir, permissions, systemPrompt augmented with `"Continue from previous session. Last output: {outputSummary}"`
  - `deleteSession(id)` — removes a session
  - `clear()` — removes all sessions
  - `load()` / `_save()` — disk persistence (atomic write, same pattern)
  - `destroy()` — unwires EventBus listeners

- **Session templates** — stored in `operatorDir/.data/terminal-templates.json`:
  - `getTemplates()` — returns all templates
  - `getTemplate(name)` — returns a template by name
  - `saveTemplate(name, config)` — saves a named terminal configuration template:
    ```
    { name, model, projectDir, systemPrompt, capabilities, dangerouslySkipPermissions, createdAt }
    ```
  - `deleteTemplate(name)` — removes a template
  - 3 built-in templates (not persisted, always available):
    - `"default"` — sonnet model, skip permissions, no system prompt
    - `"code-review"` — sonnet, system prompt "Review code changes and suggest improvements"
    - `"bug-fix"` — sonnet, system prompt "Diagnose and fix the following bug"

- **`operator/routes/claude-terminals.mjs` (~30 lines changed)**:
  - `GET /api/claude-terminals/sessions` — list sessions (pagination + status filter)
  - `GET /api/claude-terminals/sessions/:id` — get session detail
  - `POST /api/claude-terminals/sessions/:id/resume` — resume a session:
    - Gets resume config from session store
    - Calls `claudePool.spawn()` with resume config
    - Returns new terminal ID
  - `POST /api/claude-terminals/sessions/:id/clone` — clone a session (spawn with same config, no context injection)
  - `GET /api/claude-terminals/templates` — list templates
  - `POST /api/claude-terminals/templates` — save a template
  - `DELETE /api/claude-terminals/templates/:name` — delete a template
  - `POST /api/claude-terminals/spawn-template/:name` — spawn from template

- **`operator/server.mjs` (~10 lines changed)**:
  - Import `createTerminalSessionStore`
  - Create session store with EventBus wiring, pass to claude-terminal routes
  - Load on startup, return in app return object

- **`operator/public/terminals.js` (~25 lines changed)**:
  - Session history panel: button in terminal header opens overlay listing past sessions
  - Resume button per session: spawns new terminal with resume config
  - Clone button: spawns new terminal with same config
  - Template dropdown in spawn dialog: pre-fills model and system prompt from template
  - Save-as-template button: saves current terminal's config as a named template

### Test Plan
- `operator/__tests__/terminal-sessions.test.mjs` (~27 tests):
  - Spawned terminal creates session record
  - Exited terminal updates session with endedAt, exitCode, duration
  - Handoff increments handoffCount
  - Task completed appends to taskHistory
  - `getSession()` returns correct session
  - `getSession()` returns null for unknown ID
  - `listSessions()` returns all sessions
  - `listSessions({ status: 'completed' })` filters to ended sessions
  - `listSessions({ status: 'running' })` filters to active sessions
  - `listSessions()` paginates with limit/offset
  - `getResumeConfig()` returns config with augmented system prompt
  - `getResumeConfig()` includes outputSummary in system prompt
  - `deleteSession()` removes a session
  - `clear()` removes all sessions
  - Persistence: save+load cycle preserves sessions
  - FIFO eviction: oldest session removed when exceeding maxSessions
  - `outputSummary` captures last 500 chars
  - Built-in templates: 3 default templates always available
  - `saveTemplate()` persists custom template
  - `getTemplate()` returns template by name
  - `deleteTemplate()` removes custom template
  - `deleteTemplate()` cannot remove built-in templates
  - Route: GET /api/claude-terminals/sessions returns list (supertest)
  - Route: POST /api/claude-terminals/sessions/:id/resume spawns terminal (supertest)
  - Route: POST /api/claude-terminals/sessions/:id/clone spawns terminal (supertest)
  - Route: GET /api/claude-terminals/templates returns templates (supertest)
  - Route: POST /api/claude-terminals/spawn-template/:name spawns from template (supertest)

### Dependencies
- Phase 15 (claude-pool spawn/listAll/getTerminalHandle methods)
- Phase 17 (shared memory for output buffer access pattern)
- Phase 22 (task completion events for history tracking)

---

## Phase 49: WebSocket Reliability

### Rationale
The current WebSocket implementation (`createWS` in app.js) uses exponential backoff (1s-30s) for reconnection but has several gaps: no heartbeat to detect silent disconnections, no event replay after reconnection (missed events are lost), no visible reconnection indicator beyond the small dot in the nav footer, and binary terminal WS (15s max backoff) has no recovery indicator. This phase adds server-side heartbeats, a short event replay buffer, client-side connection quality tracking, and improved reconnection UX.

### Changes

- **`operator/ws.mjs` (~50 lines changed)**:
  - **Heartbeat**: server sends `{ type: 'ping', ts }` every 30s to each JSON WS client; client responds with `{ type: 'pong' }`. If no pong received within 10s, server terminates the connection (allows client to reconnect cleanly)
  - **Event replay buffer**: ring buffer of last 100 bridged events with timestamps, stored in closure:
    - Shape: `{ event, data, ts, seq }` where `seq` is a monotonically increasing sequence number
    - On client reconnect: client sends `{ type: 'replay', afterSeq: N }` with the last received sequence number
    - Server responds with all buffered events where `seq > N`, wrapped in `{ type: 'replay', events: [...] }`
    - If `afterSeq` is older than buffer, sends `{ type: 'replay-gap', missed: N }` to inform client of data loss
  - **Connection tracking**: track connected client count, expose via `wss.getStats()`:
    - `{ connectedClients, binaryClients, totalMessagesReceived, totalMessagesSent, replayRequests }`
  - **Binary WS heartbeat**: same ping/pong for terminal binary WS but using the `\x01` control prefix: `\x01{"type":"ping"}`

- **`operator/public/app.js` (~40 lines changed)**:
  - **Enhanced `createWS()`**:
    - Track last received sequence number (`_lastSeq`) from event messages
    - On reconnect: send `{ type: 'replay', afterSeq: _lastSeq }` after subscribe
    - Handle `{ type: 'replay', events }` — process replayed events through `onMessage` callback
    - Handle `{ type: 'replay-gap' }` — show toast "Missed N events during disconnection"
    - Handle `{ type: 'ping' }` — respond with `{ type: 'pong' }`
    - Track connection quality: `_latency` (ping-pong round trip), `_reconnectCount`
    - New option: `opts.onReplay` callback for replay events
    - New option: `opts.onQuality` callback with `{ latency, reconnects, connected }` on each pong
  - **Connection quality indicator**: replace simple dot with a mini status panel:
    - Green dot + "Connected" when healthy
    - Yellow dot + "Reconnecting... (attempt N)" during backoff
    - Red dot + "Disconnected" after max attempts
    - Latency badge: shows ping-pong RTT in ms (hidden when connected and <100ms)
    - "N events replayed" toast after successful replay
  - **Reconnection banner**: dismissible banner at top of page during extended disconnection (>5s):
    - "Connection lost. Reconnecting in Ns..." with countdown
    - Manual "Reconnect Now" button that resets backoff and reconnects immediately

- **`operator/public/terminals.js` (~15 lines changed)**:
  - Binary WS `connectClaudeBinaryWs`: handle `\x01{"type":"ping"}` control messages, respond with `\x01{"type":"pong"}`
  - Show reconnection overlay on binary WS disconnect (already partially exists, enhance with attempt counter)
  - Track reconnect attempts in terminal status bar

- **`operator/public/style.css` (~15 lines added)**:
  - `.ws-reconnect-banner` — top-of-page yellow warning banner with countdown
  - `.ws-quality` — latency badge styling
  - `.ws-dot--reconnecting` — animated pulsing yellow dot

- **`operator/routes/views.mjs` (~5 lines changed)**:
  - New fragment: `GET /views/ws-stats` — renders WS connection stats for dashboard health widget

### Test Plan
- `operator/__tests__/ws-reliability.test.mjs` (~25 tests):
  - Server sends ping to connected client at interval
  - Client pong resets server-side timeout
  - Missing pong causes server to terminate connection
  - Event replay buffer stores events with sequence numbers
  - Replay buffer is a ring buffer (oldest evicted at capacity)
  - Client replay request returns events after given seq
  - Client replay request with stale seq returns replay-gap
  - Client replay request with current seq returns empty replay
  - Sequence numbers are monotonically increasing
  - `getStats()` returns accurate client count
  - `getStats()` tracks message counts
  - `getStats()` tracks replay request count
  - Binary WS heartbeat sends ping with control prefix
  - Binary WS pong response is handled correctly
  - Binary WS timeout terminates on missing pong
  - Replay events are processed in order
  - Multiple concurrent clients get independent replay state
  - Client subscribes then replays: only matching events replayed
  - New connection receives no replay without afterSeq
  - Heartbeat interval is configurable (for testing)
  - Pong timeout is configurable (for testing)
  - Buffer size is configurable (for testing)
  - Stats reset on cleanup
  - Cleanup unwires heartbeat intervals
  - Reconnected client receives missed events correctly

### Dependencies
- Phase 15B (binary WebSocket protocol for terminal heartbeats)
- Phase 16 (existing WS test infrastructure)

---

## Phase 50: Request Performance Tracking

### Rationale
The operator API serves 60+ endpoints but has no visibility into request latency, error rates, or slow queries. The Prometheus metrics endpoint (Phase 34) reports subsystem gauges but no HTTP-level timing. Operators cannot identify bottlenecks or performance regressions. This phase adds per-endpoint latency tracking, slow request logging, and a performance summary endpoint.

### Changes

- **`operator/middleware/request-timer.mjs` (new, ~90 lines)**: Factory `createRequestTimer(ctx)`:
  - `ctx.log` — logger (for slow request logging)
  - `ctx.slowThresholdMs` — threshold for slow request logging (default 1000ms)
  - `ctx.maxEntries` — max stored per-route timing entries (default 200)
  - Returns Express middleware + performance API
  - Middleware: records `startTime = process.hrtime.bigint()` on request, calculates duration on response `finish` event
  - Per-route timing aggregation — keyed by `method + path` (with params normalized, e.g. `/api/chains/:id`):
    ```
    {
      route: 'GET /api/chains/:id',
      count: number,
      totalMs: number,
      avgMs: number,
      minMs: number,
      maxMs: number,
      p50Ms: number,        // median
      p95Ms: number,        // 95th percentile
      p99Ms: number,        // 99th percentile
      errorCount: number,   // responses with 4xx or 5xx
      lastCalledAt: string, // ISO timestamp
    }
    ```
  - **Path normalization**: converts `/api/chains/abc-123` to `/api/chains/:id` using Express route layer inspection (falls back to regex replacement for UUIDs and numeric IDs)
  - **Slow request logging**: if duration > `slowThresholdMs`, calls `log.warn('Slow request', { route, durationMs, method, path })` and emits `perf:slow-request` event
  - **Percentile calculation**: uses a fixed-size sorted sample buffer per route (last 100 timings), calculates percentiles on demand
  - `getStats()` — returns array of all route timing summaries, sorted by avgMs descending
  - `getRouteStats(route)` — returns stats for a specific route
  - `getSlowRequests(limit)` — returns the N most recent slow requests `[{ route, durationMs, timestamp, method, path, statusCode }]`
  - `reset()` — clears all timing data

- **`operator/routes/performance.mjs` (new, ~40 lines)**: Factory `createPerformanceRoutes(ctx)`:
  - `ctx.requestTimer` — request timer instance
  - `GET /api/performance` — returns `requestTimer.getStats()` (all route timings)
  - `GET /api/performance/slow` — returns recent slow requests, `?limit=20` (default 20)
  - `GET /api/performance/:route` — returns stats for specific route (URL-encoded)
  - `POST /api/performance/reset` — resets all timing data
  - `GET /api/performance/summary` — compact summary: total requests, avg latency, error rate, top 5 slowest routes

- **`operator/metrics.mjs` (~15 lines changed)**:
  - Extend Prometheus metrics with HTTP timing data from request timer:
    - `jousting_http_requests_total{method,route,status}` — counter
    - `jousting_http_request_duration_ms{route,quantile}` — histogram (p50, p95, p99)
    - `jousting_http_slow_requests_total` — counter of slow requests

- **`operator/server.mjs` (~12 lines changed)**:
  - Import `createRequestTimer` and `createPerformanceRoutes`
  - Create request timer: `requestTimer = createRequestTimer({ log: logger, slowThresholdMs: 1000 })`
  - Mount timer middleware early (after JSON parser, before routes): `app.use(requestTimer.middleware)`
  - Wire performance routes: `app.use('/api', createPerformanceRoutes({ requestTimer }))`
  - Pass `requestTimer` to metrics collector for Prometheus exposition
  - Return `requestTimer` in app return object
  - Emit `perf:slow-request` on EventBus for notification integration

- **`operator/ws.mjs` (~1 line changed)**:
  - Add `perf:slow-request` to BRIDGED_EVENTS

- **`operator/public/index.html` (~5 lines changed)**:
  - Dashboard health widget enhanced: add "Avg latency: Xms" and "Slow requests: N" to system health widget (from Phase 47)

### Test Plan
- `operator/__tests__/request-timer.test.mjs` (~28 tests):
  - Middleware records request duration
  - Duration is accurate (within 50ms tolerance)
  - Path normalization: UUID segments replaced with `:id`
  - Path normalization: numeric segments replaced with `:id`
  - Path normalization: preserves non-parameterized paths
  - `getStats()` returns per-route aggregates
  - `getStats()` sorts by avgMs descending
  - Count increments per request
  - Min/max tracked correctly
  - Average calculated correctly
  - P50 percentile calculated correctly
  - P95 percentile calculated correctly on varied data
  - P99 percentile calculated correctly
  - Error count tracks 4xx responses
  - Error count tracks 5xx responses
  - Error count ignores 2xx responses
  - Slow request logged when above threshold
  - Slow request not logged when below threshold
  - `getSlowRequests()` returns recent slow requests
  - `getSlowRequests()` respects limit parameter
  - `getRouteStats()` returns stats for specific route
  - `getRouteStats()` returns null for unknown route
  - `reset()` clears all data
  - `perf:slow-request` event emitted for slow requests
  - Route: GET /api/performance returns stats (supertest)
  - Route: GET /api/performance/slow returns slow list (supertest)
  - Route: GET /api/performance/summary returns compact summary (supertest)
  - Prometheus metrics include HTTP timing lines

### Dependencies
- Phase 28 (logger for slow request warnings)
- Phase 34 (metrics collector for Prometheus extension)
- Phase 47 (dashboard widget integration for latency display)

---

## Summary Table

| Phase | Title | Priority Area | New Files | Changed Files | Est. Tests |
|-------|-------|--------------|-----------|---------------|------------|
| 45 | Secrets Management | Security | `secrets.mjs`, `routes/secrets.mjs` | `server.mjs`, `health.mjs`, `settings.html` | 28 |
| 46 | Global Search | UX | `search.mjs`, `routes/search.mjs` | `server.mjs`, `app.js`, `style.css` | 26 |
| 47 | Dashboard Real-Time Widgets | UX | `views/dashboard-widgets.mjs` | `server.mjs`, `routes/views.mjs`, `index.html`, `style.css` | 24 |
| 48 | Terminal Session Management | UX | `terminal-sessions.mjs` | `routes/claude-terminals.mjs`, `server.mjs`, `terminals.js` | 27 |
| 49 | WebSocket Reliability | Reliability | _(none)_ | `ws.mjs`, `app.js`, `terminals.js`, `style.css`, `routes/views.mjs` | 25 |
| 50 | Request Performance Tracking | Observability | `middleware/request-timer.mjs`, `routes/performance.mjs` | `server.mjs`, `metrics.mjs`, `ws.mjs`, `index.html` | 28 |

**Total estimated: ~158 new tests across 6 new test files, ~870 lines of new production code, ~190 lines changed in existing files.**

---

## Execution Order Rationale

1. **Phase 45 (Secrets)** first because it is a security gap — plaintext sensitive data should be addressed before adding more features.
2. **Phase 46 (Search)** second because it is a pure additive feature with no dependencies on other new phases.
3. **Phase 47 (Dashboard Widgets)** third because it depends on existing subsystems and improves the first thing operators see.
4. **Phase 48 (Terminal Sessions)** fourth because it builds on the terminal pool and benefits from the widgets being in place for visibility.
5. **Phase 49 (WebSocket Reliability)** fifth because it is infrastructure hardening that improves all real-time features built in prior phases.
6. **Phase 50 (Performance Tracking)** last because it is observability on top of everything else and gives the most value when all endpoints are in place.
