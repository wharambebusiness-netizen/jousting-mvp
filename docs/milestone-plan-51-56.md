# Milestone Plan: Phases 51-56

## Overview

Phases 51-56 address the highest-impact remaining gaps in the Jousting operator system. Phase 51 adds **backup/restore** for full system state export and import — an operational necessity for disaster recovery and migration. Phase 52 delivers **configuration hot-reload** so settings changes take effect without restarting the server. Phase 53 makes the **DAG dependency graph interactive** with drag-to-connect and click-to-remove editing. Phase 54 adds **CLI enhancements** bringing status, task, and health commands to the operator CLI beyond the current server-start-only interface. Phase 55 introduces **E2E integration tests** with real HTTP requests and WebSocket connections for full-stack coverage. Phase 56 improves **mobile-responsive layout** so the operator UI is usable on tablets and phones.

Each phase is scoped for a single session (~80-150 lines of production code, 20-30 tests), builds incrementally on prior work, and follows existing factory/EventBus/atomic-write patterns.

---

## Phase 51: Backup/Restore

### Rationale
The operator system persists state across 10+ JSON/JSONL files in `.data/` plus `registry.json` and `settings.json`. There is no way to snapshot the full system state for disaster recovery, migration between machines, or rollback after a bad configuration change. The export module (Phase 36) handles data export in CSV/JSON but does not cover full state including secrets vault, preferences, webhooks, notifications, terminal sessions, and templates. A backup/restore system creates a single JSON bundle containing all state files and can restore from it.

### Changes

- **`operator/backup.mjs` (new, ~130 lines)**: Factory `createBackupManager(ctx)`:
  - `ctx.operatorDir` — base directory containing `registry.json`, `settings.json`, `.data/`
  - `ctx.log` — logger
  - `createBackup(options)` — creates a backup bundle:
    - Scans all known persistence files: `registry.json`, `settings.json`, `.data/task-queue.json`, `.data/shared-memory.json`, `.data/terminal-messages.json`, `.data/dead-letters.json`, `.data/audit-log.jsonl`, `.data/webhooks.json`, `.data/preferences.json`, `.data/notifications.json`, `.data/terminal-sessions.json`, `.data/terminal-templates.json`, `.data/secrets.vault`, `.data/auth-tokens.json`, `.data/.migration-version`
    - Returns JSON object `{ version: 1, createdAt: ISO, files: { [relativePath]: base64content }, manifest: { fileCount, totalBytes, operatorVersion } }`
    - `options.excludeSecrets` — omit secrets.vault and auth-tokens.json (default false)
    - `options.excludeAudit` — omit audit-log.jsonl (can be large, default false)
    - Each file encoded as base64 to handle binary vault data and JSONL safely
  - `restoreBackup(bundle, options)` — restores from a backup bundle:
    - `options.dryRun` — returns what would be restored without writing (default false)
    - Validates bundle `version` field
    - Writes each file from `bundle.files` back to the corresponding path using atomic write (temp+rename)
    - Returns `{ restored: string[], skipped: string[], errors: string[] }`
  - `listBackups()` — lists `.backup-*.json` files in operatorDir/.data
  - `autoBackup()` — creates a timestamped backup file `.data/.backup-YYYYMMDD-HHmmss.json`
  - `getBackupInfo(bundle)` — parses manifest without restoring: file count, size, age, contents list

- **`operator/routes/backup.mjs` (new, ~50 lines)**: Factory `createBackupRoutes(ctx)`:
  - `POST /api/backup` — create backup bundle; body `{ excludeSecrets?, excludeAudit? }`; returns the full bundle JSON as download
  - `POST /api/backup/restore` — restore from uploaded bundle; body is the backup JSON; returns `{ restored, skipped, errors }`
  - `GET /api/backup/list` — list auto-backups with timestamps and sizes
  - `POST /api/backup/auto` — trigger auto-backup; returns `{ path, size }`
  - `POST /api/backup/restore/preview` — dry-run restore; returns what would happen without writing

- **`operator/server.mjs` (~12 lines changed)**:
  - Import and create `backupManager`, wire routes
  - Opt out with `backup: false`

- **`operator/public/settings.html` (~20 lines changed)**:
  - New "Backup & Restore" section on settings page

### Test Plan — `operator/__tests__/backup.test.mjs` (~28 tests)
- createBackup/restoreBackup round-trip, excludeSecrets, excludeAudit, validation, atomic writes
- autoBackup, listBackups, getBackupInfo
- Route tests via supertest: POST backup, restore, preview, list, auto

---

## Phase 52: Configuration Hot-Reload

### Rationale
Currently subsystems like the coordinator, rate limiter, and cost aggregator only read their config at creation time. Changing `coordMaxRequestsPerMinute` via the settings API requires a full server restart. This phase adds event-driven settings change propagation so subsystems react to changes without restart.

### Changes

- **`operator/settings.mjs` (~40 lines changed)**:
  - Add `ctx.events` parameter (EventBus, optional)
  - `save()` compares old vs new values, emits `settings:changed` with `{ changes: { field: { from, to } }, settings }`
  - `watch()` method: polls file mtime every 5s (configurable), triggers `settings:changed` if external edit detected
  - `get(key)`, `onChange(callback)`, `stopWatch()` convenience methods
  - Backward compat: works without EventBus

- **`operator/coordination/coordinator.mjs` (~20 lines changed)**:
  - Subscribe to `settings:changed`, dynamically reconfigure rateLimiter and costAggregator
  - Emit `coordinator:reconfigured` with applied changes

- **`operator/coordination/rate-limiter.mjs` (~10 lines changed)**:
  - Add `reconfigure({ maxRequestsPerMinute, maxTokensPerMinute })` method

- **`operator/coordination/cost-aggregator.mjs` (~10 lines changed)**:
  - Add `reconfigure({ globalBudgetUsd, perWorkerBudgetUsd })` method

- **`operator/server.mjs` (~8 lines changed)**:
  - Pass `events` to `createSettings()`, start/stop watcher

- **`operator/ws.mjs` (~2 lines changed)**:
  - Add `settings:changed` and `coordinator:reconfigured` to BRIDGED_EVENTS

- **`operator/public/settings.html` (~10 lines changed)**:
  - "Changes applied live" indicator, WS-driven toast on change

### Test Plan — `operator/__tests__/hot-reload.test.mjs` (~25 tests)
- save() emits/doesn't emit, change detection, watch/stopWatch, coordinator reconfigure integration
- Rate limiter and cost aggregator reconfigure methods
- Backward compat without EventBus, WS bridging

---

## Phase 53: Interactive DAG Editing

### Rationale
The DAG visualization (Phase 14) is read-only. Users can see dependencies but cannot add or remove them without using the API directly. This phase makes the DAG interactive: click-to-connect for adding deps, click-on-edge to remove deps, and a dependency editor within the task detail dialog.

### Changes

- **`operator/coordination/task-queue.mjs` (~25 lines changed)**:
  - `addDep(taskId, depId)` — adds dependency; validates no cycle; returns updated task
  - `removeDep(taskId, depId)` — removes dependency; returns updated task
  - Both reject for non-pending/non-assigned tasks

- **`operator/routes/coordination.mjs` (~20 lines changed)**:
  - `POST /api/coordination/tasks/:id/deps` — body `{ depId }`
  - `DELETE /api/coordination/tasks/:id/deps/:depId`

- **`operator/public/taskboard.js` (~120 lines changed)**:
  - DAG edit mode toggle, click-to-connect, edge removal, dep chips in detail dialog
  - Keyboard shortcut: `e` toggles edit mode

- **`operator/public/style.css` (~30 lines added)**:
  - DAG edit mode styles, edge animations, dep chip styling

- **`operator/coordination/coordinator.mjs` (~10 lines changed)**:
  - `addDep`/`removeDep` wrappers that emit `coord:dep-added`/`coord:dep-removed`

- **`operator/ws.mjs` (~2 lines changed)**:
  - Add `coord:dep-added` and `coord:dep-removed` to BRIDGED_EVENTS

### Test Plan — `operator/__tests__/dag-editing.test.mjs` (~27 tests)
- addDep/removeDep core logic, cycle detection, status restrictions
- Graph consistency after dynamic changes, coordinator events
- Route tests via supertest

---

## Phase 54: CLI Enhancements

### Rationale
The operator CLI only supports starting the server or running a chain. There are no commands for inspecting state, managing tasks, checking health, or performing backup/restore from the command line.

### Changes

- **`operator/cli.mjs` (new, ~140 lines)**: CLI subcommand dispatcher:
  - `status` — health summary
  - `tasks` — list/add/cancel tasks
  - `search <query>` — global search results
  - `backup` / `restore <file>` — backup/restore operations
  - `metrics` — Prometheus metrics
  - `perf` — latency summary
  - Auth via `OPERATOR_TOKEN` env var or `.operator-token` file
  - `--json` flag for machine-readable output
  - Uses only `node:http` (no external deps)

- **`operator/server.mjs` (~15 lines changed)**:
  - Detect subcommands in argv, delegate to `cli.mjs`

### Test Plan — `operator/__tests__/cli.test.mjs` (~25 tests)
- Subcommand formatting, connection error handling, auth token discovery
- JSON flag, help output, unknown command handling

---

## Phase 55: E2E Integration Tests

### Rationale
The test suite is comprehensive at the unit and route-handler level, but there are no full-stack tests that start a real server, connect WebSocket clients, and exercise the complete request lifecycle. E2E tests catch integration bugs that unit tests miss.

### Changes

- **`operator/__tests__/e2e-integration.test.mjs` (new, ~200 lines)**:
  - Real HTTP server + WS client tests
  - Categories: HTTP lifecycle, task lifecycle, search integration, WS reliability, settings propagation, backup round-trip, health checks, concurrent operations, error handling

- **`operator/__tests__/e2e-ws.test.mjs` (new, ~100 lines)**:
  - Focused WS tests: subscribe, heartbeat, replay, pattern matching, multiple clients

### Test Plan — ~55 new tests across 2 files

---

## ~~Phase 56: Mobile-Responsive UI~~ (DROPPED — desktop-only use case)

---

## Summary

| Phase | Title | New Files | Est. Tests |
|-------|-------|-----------|------------|
| 51 | Backup/Restore | `backup.mjs`, `routes/backup.mjs` | 30 |
| 52 | Configuration Hot-Reload | _(none)_ | 25 |
| 53 | Interactive DAG Editing | _(none)_ | 27 |
| 54 | CLI Enhancements | `cli.mjs` | 25 |
| 55 | E2E Integration Tests | 2 test files | 55 |
| **Total** | | **~5 new files** | **~162** |
