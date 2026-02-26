# Milestone Plan: Phases 58-63

## Overview

Phases 58-63 focus on security hardening, operational visibility, and extensibility. Phase 58 adds **CSRF protection and security headers** to close the last major security gaps. Phase 59 creates an **Activity Stream UI** making the audit log visually explorable. Phase 60 introduces a **Plugin System** for webhook integrations (Slack, Discord). Phase 61 adds a **Template Library** for pre-built workflow patterns. Phase 62 delivers **Multi-Project Dashboard** aggregation. Phase 63 provides an **API Key Management UI** on the settings page.

Each phase is scoped for a single session (~80-150 lines of production code, 20-30 tests), builds incrementally on prior work, and follows existing factory/EventBus/atomic-write patterns.

---

## Phase 58: CSRF Protection + Security Headers

### Rationale
The operator UI makes state-changing POST/PUT/DELETE requests via fetch() and HTMX without any CSRF protection. A malicious page could trick a user's browser into making requests to localhost:3100. Additionally, standard security headers (CSP, X-Frame-Options, X-Content-Type-Options) are missing. The CORS config also omits PUT from allowed methods despite the settings page using PUT.

### Changes

- **`operator/middleware/security-headers.mjs` (new, ~40 lines)**: Factory `createSecurityHeaders()`:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Content-Security-Policy`: script-src self + CDN origins (unpkg, cdn.jsdelivr.net); style-src self + CDN + unsafe-inline (Pico); connect-src self ws: wss:; frame-ancestors none
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

- **`operator/middleware/csrf.mjs` (new, ~80 lines)**: Factory `createCsrfProtection()`:
  - Double-submit cookie pattern (stateless — no sessions needed)
  - On GET requests: generate random token, set `_csrf` cookie (SameSite=Strict, HttpOnly=false so JS can read)
  - On POST/PUT/DELETE/PATCH: validate `X-CSRF-Token` header matches `_csrf` cookie
  - Skip validation for requests with valid `Authorization: Bearer` header (API clients)
  - Skip for WebSocket upgrade requests
  - Skip for `/api/health`, `/api/metrics`, `/api/openapi.json` (public endpoints)
  - Returns `{ middleware, generateToken() }` for testing

- **`operator/server.mjs` (~10 lines changed)**:
  - Register security headers and CSRF middleware early in stack
  - Fix CORS to include PUT in allowed methods
  - `csrf: false` option to disable for testing

- **`operator/public/app.js` (~15 lines changed)**:
  - Helper to read `_csrf` cookie value
  - Inject `X-CSRF-Token` header in all fetch() calls
  - Configure HTMX to send CSRF token via `htmx:configRequest` event

### Test Plan — `operator/__tests__/security.test.mjs` (~30 tests)
- Security headers present on all responses
- CSRF token generated on GET, required on POST/PUT/DELETE
- CSRF bypass with Bearer auth, WebSocket upgrade, public endpoints
- CSRF rejection on missing/mismatched token
- CORS includes PUT method
- Integration: full createApp with CSRF enabled

---

## Phase 59: Activity Stream UI

### Rationale
The audit log (Phase 31) captures all system events as JSONL but is only accessible via API. An Activity Stream page would make this data visually explorable with filtering, search, and auto-refresh.

### Changes
- **`operator/public/activity.html`** — New page with real-time event stream
- **`operator/routes/views.mjs`** — HTMX fragment for activity rows
- **Sidebar nav** — Add Activity link to all 9 pages
- **Tests** — ~20 tests for views and rendering

---

## Phase 60: Plugin System (Webhook Integrations)

### Rationale
Webhooks (Phase 38) dispatch to arbitrary URLs but have no built-in formatters for common services. A plugin system would provide Slack, Discord, and generic template formatters.

### Changes
- **`operator/plugins/`** — Plugin directory with Slack/Discord formatters
- **`operator/webhooks.mjs`** — Plugin hook for message formatting
- **Settings UI** — Plugin configuration section
- **Tests** — ~25 tests

---

## Phase 61: Template Library

### Rationale
Task templates (Phase 48) exist but are manually created. A pre-built template library would offer common workflow patterns (build-test-deploy, code-review, feature-branch).

### Changes
- **`operator/templates/`** — Built-in workflow templates
- **`operator/routes/templates.mjs`** — Template browsing and instantiation API
- **Taskboard UI** — Template picker modal
- **Tests** — ~20 tests

---

## Phase 62: Multi-Project Dashboard

### Rationale
The dashboard shows data for one project at a time. A multi-project view would aggregate health, costs, and task status across all projects.

### Changes
- **`operator/views/multi-project.mjs`** — Aggregation views
- **Dashboard UI** — Multi-project toggle/cards
- **Tests** — ~20 tests

---

## Phase 63: API Key Management UI

### Rationale
Auth tokens (Phase 27) can only be managed via API. A settings page section would let users create, view, and revoke tokens from the UI.

### Changes
- **`operator/public/settings.html`** — Token management section
- **`operator/routes/views.mjs`** — HTMX fragments for token list
- **Tests** — ~15 tests

---

## Summary

| Phase | Title | New Files | Est. Tests |
|-------|-------|-----------|------------|
| 58 | CSRF + Security Headers | `csrf.mjs`, `security-headers.mjs` | 30 |
| 59 | Activity Stream UI | `activity.html` | 20 |
| 60 | Plugin System | `plugins/` directory | 25 |
| 61 | Template Library | `templates/` directory | 20 |
| 62 | Multi-Project Dashboard | `multi-project.mjs` | 20 |
| 63 | API Key Management UI | _(settings changes)_ | 15 |
| **Total** | | **~6 new files** | **~130** |
