## Milestone Plan: Phases 64-69

### Overview

Phases 64-69 focus on UI completeness, API parity, test isolation, and operational visibility. Multiple backend subsystems (webhooks, secrets, backup, retention) have full REST APIs but no UI management pages. The chain API lacks search and edit capabilities. Coordination sub-modules need standalone test suites. The timeline and performance data need dedicated UIs.

Each phase is scoped for a single session (~80-150 lines of production code, 20-30 tests).

---

### Phase 64: Settings — Webhooks + Secrets UI

**Rationale**: Webhooks and secrets have complete REST APIs but no management UI. Users must use curl/API to register webhooks or store secrets. Adding settings page sections makes these features accessible.

**Changes**:
- **`operator/public/settings.html`** — Webhook section: table of registered webhooks, create form (URL, events, format select: generic/slack/discord, label), delete button, test delivery button. Secrets section: table of stored secrets (masked), add form (key, value), delete button, reveal toggle.
- **`operator/routes/views.mjs`** — `/views/settings-webhooks` and `/views/settings-secrets` HTMX fragments
- **`operator/public/style.css`** — Webhook and secret table/form styles
- **Tests** — ~25 tests

---

### Phase 65: Settings — Backup/Restore + Retention UI

**Rationale**: Backup/restore and retention policies have full APIs but require curl to operate. Settings page sections provide one-click backup, restore from list, and retention TTL configuration.

**Changes**:
- **`operator/public/settings.html`** — Backup section: "Create Backup" button, recent backups list with restore/preview, auto-backup status. Retention section: TTL inputs for messages, snapshots, completed tasks, "Run Now" button.
- **`operator/routes/views.mjs`** — `/views/settings-backup` and `/views/settings-retention` HTMX fragments
- **Tests** — ~20 tests

---

### Phase 66: Chain Edit + API Search Parity

**Rationale**: Chains cannot be renamed/edited after creation. The REST API lacks text search (only the HTMX view has it). Settings has no reset-to-defaults endpoint. These gaps reduce API completeness.

**Changes**:
- **`operator/routes/chains.mjs`** — `PATCH /api/chains/:id` for updating task description and metadata
- **`operator/routes/chains.mjs`** — `q` text search param on `GET /api/chains`
- **`operator/routes/settings.mjs`** — `POST /api/settings/reset` endpoint
- **`operator/routes/bulk.mjs`** — Fix archive race condition (build modified copy before save)
- **Tests** — ~25 tests

---

### Phase 67: Coordination Test Isolation

**Rationale**: Coordination sub-modules (task-queue, coordinator, rate-limiter, cost-aggregator, adaptive-limiter) are tested only through the integration suite. Standalone tests improve isolation and failure diagnosis.

**Changes**:
- **`operator/__tests__/task-queue.test.mjs`** — DAG task queue: add, remove, assign, deps, cycle detection, priority
- **`operator/__tests__/coordinator.test.mjs`** — Coordinator lifecycle, event routing, subsystem orchestration
- **`operator/__tests__/rate-limiter.test.mjs`** — Token bucket, adaptive backoff, recovery
- **Tests** — ~80-100 new focused tests

---

### Phase 68: Timeline Export + Deep-Link Navigation

**Rationale**: The timeline page has no export button despite `/api/export/audit` being fully functional. Timeline entries don't link to related tasks/chains. Terminal tabs lack permalink copy.

**Changes**:
- **`operator/public/timeline.html`** — Export button (JSON/CSV), clickable timeline entries linking to tasks/chains
- **`operator/public/terminals.html`** — Permalink copy button for deep-link URLs
- **`operator/views/timeline.mjs`** — Render clickable links for task/chain targets
- **Tests** — ~15-20 tests

---

### Phase 69: Performance Dashboard Page

**Rationale**: Per-route latency stats from requestTimer exist but are only accessible via API. A dedicated page makes performance data visually explorable.

**Changes**:
- **`operator/public/performance.html`** — New page: route latency table, top-5 slowest routes, p50/p95/p99 breakdown, error rate, SVG charts
- **`operator/routes/views.mjs`** — `/views/performance-summary` HTMX fragment
- **Sidebar nav** — Add Performance link to all pages
- **Tests** — ~20 tests

---

### Summary Table

| Phase | Title | New Files | Est. Tests |
|-------|-------|-----------|------------|
| 64 | Webhooks + Secrets UI | _(settings changes)_ | 25 |
| 65 | Backup/Restore + Retention UI | _(settings changes)_ | 20 |
| 66 | Chain Edit + API Search | _(route changes)_ | 25 |
| 67 | Coordination Test Isolation | 3 test files | 80-100 |
| 68 | Timeline Export + Deep-Links | _(page changes)_ | 15-20 |
| 69 | Performance Dashboard | `performance.html` | 20 |
| **Total** | | **~4-5 new files** | **~185-210** |
