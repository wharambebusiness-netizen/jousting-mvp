# S101 Project Review — Consolidated Audit Report

**Date:** 2026-02-18
**Audits Run:** 7 (code-review, security-scan, orchestrator-status, performance, accessibility, dependency, test-coverage)
**Baseline:** 1588 tests, 24 suites, all passing

---

## Executive Summary

The operator codebase is well-structured with strong foundations (good HTML escaping, correct execFile usage in git routes, thorough registry/error tests). However, the review exposed significant gaps in **accessibility** (6 critical WCAG violations), **performance** (synchronous I/O blocking the event loop), **security** (unrestricted filesystem root parameter), and **test coverage** (2 modules with zero tests, 3 untested API endpoints).

| Audit | Critical | High | Medium | Low |
|-------|----------|------|--------|-----|
| Code Review | 0 | 0 | 0 | 10 warn |
| Security | 0 | 3 | 6 | 5 |
| Performance | 0 | 4 | 6 | 5 |
| Accessibility | 6 | 18 | 11 | 5 |
| Dependency | 0 | 1 | 2 | 2 |
| Test Coverage | 2 | 5 | 7 | 7 |
| **Total** | **8** | **31** | **32** | **34** |

**Orchestrator Status:** Healthy, idle. 1588/1588 tests passing. All 11 agents retired. 4 backlog items (1 P1). Last dry-run clean.

---

## Tier 1: Critical Fixes (Do First)

### T1-1: Restrict /api/files/content root parameter [SECURITY HIGH]
The `root` query parameter accepts any absolute path. An attacker on localhost can read any file up to 100KB.
- **Fix:** Validate `root` against known project directories from the registry
- **Files:** `operator/routes/files.mjs:143-200`, also applies to `/api/files` and `/api/git/file-status`
- **Effort:** ~20 lines

### T1-2: Fix undefined CSS custom properties [CODE REVIEW WARN]
9 custom properties used in sections 39-40 are never defined: `--bg-card`, `--bg-elevated`, `--border-hover`, `--font-mono`, `--font-sans`, `--accent-primary`, `--status-running`, `--status-complete`, `--status-failed`. These resolve to browser defaults, causing broken backgrounds, fonts, colors on project cards, file preview, tree search.
- **Fix:** Add definitions to `:root[data-theme="dark"]` or map to existing tokens
- **Files:** `operator/public/style.css` (sections 39-40)
- **Effort:** ~15 lines

### T1-3: Add registry cache with write-through invalidation [PERFORMANCE HIGH]
`loadRegistry()` does `readFileSync + JSON.parse` on every request. Dashboard page loads trigger 3+ reads of the same file. Polling adds another every 15 seconds per client.
- **Fix:** In-memory cache keyed on file mtime, invalidated on `saveRegistry()`
- **Files:** `operator/registry.mjs`
- **Effort:** ~20 lines

### T1-4: Add file-watcher.test.mjs [TEST COVERAGE CRITICAL]
124-line module with zero tests. Used in production for real-time UI updates.
- **Fix:** New test file covering `shouldIgnore()`, `watchProject()`, `unwatchProject()`, `unwatchAll()`, debounce, event emission (~12 tests)
- **Files:** New `operator/__tests__/file-watcher.test.mjs`
- **Effort:** ~150 lines

### T1-5: Make file tree keyboard-accessible [ACCESSIBILITY CRITICAL]
Clickable files use `<div onclick="previewFile(this)">` — not focusable or activatable via keyboard. Keyboard users cannot browse files.
- **Fix:** Add `tabindex="0" role="button"` + keydown handler for Enter/Space
- **Files:** `operator/views/projects.mjs:93`, `operator/public/app.js`
- **Effort:** ~10 lines

### T1-6: Add accessible text to status indicators [ACCESSIBILITY CRITICAL]
Status dots (chain/session/agent), WS dot, git dir-change dot have no aria-label or sr-only text. Screen readers cannot convey status.
- **Fix:** Add `aria-hidden="true"` to dots where adjacent text exists, add `<span class="sr-only">` where no text exists
- **Files:** All view renderers with status dots, 6 HTML pages (ws-dot)
- **Effort:** ~30 lines across 8 files

---

## Tier 2: High Priority (Next Session)

### T2-1: Add WebSocket origin validation [SECURITY MEDIUM]
WS upgrade handler accepts connections from any origin, bypassing CORS.
- **Fix:** Validate `Origin` header against localhost pattern
- **Files:** `operator/ws.mjs:82-92`

### T2-2: Convert scanDirectory() to async [PERFORMANCE HIGH]
200+ synchronous `readdirSync` + `statSync` calls per project per page load.
- **Fix:** Use `fs.promises.readdir` + `Promise.all(entries.map(stat))`
- **Files:** `operator/routes/files.mjs:53-107`

### T2-3: Cache git status per project [PERFORMANCE HIGH]
N git subprocesses spawned per /views/projects load. Invalidate on `project:files-changed` events.
- **Fix:** TTL cache (10s) in `getGitFileStatus()`, invalidated by file watcher events
- **Files:** `operator/routes/git.mjs`

### T2-4: Add batch-delete + export tests [TEST COVERAGE HIGH]
Two entire API endpoints with zero tests. Batch delete is destructive; export has CSV escaping implications.
- **Fix:** ~10 tests in `server.test.mjs`

### T2-5: Add getGitFileStatus() tests [TEST COVERAGE HIGH]
Function imported in views.test.mjs but never invoked. HTTP endpoint also untested.
- **Fix:** ~5 tests for porcelain parsing + endpoint responses

### T2-6: Add 413 file size limit test [TEST COVERAGE HIGH]
Security guard against memory exhaustion with zero tests.
- **Fix:** 1 test creating file > 100KB

### T2-7: Fix heading hierarchy [ACCESSIBILITY CRITICAL]
Section titles use `<p>` instead of headings. chain.html has no `<h1>`.
- **Fix:** Replace `<p class="section__title">` with `<h2>`, add `<h1>` to chain.html
- **Files:** `index.html`, `orchestrator.html`, `chain.html`

### T2-8: Add form labels and button labels [ACCESSIBILITY HIGH]
Search inputs use placeholder-only. Refresh/close/toggle buttons have no aria-label.
- **Fix:** Add `aria-label` to inputs and icon-only buttons
- **Files:** Multiple HTML pages and view renderers

### T2-9: Fix color contrast [ACCESSIBILITY HIGH]
`--text-muted` (#636370) fails 4.5:1 contrast. Line numbers with opacity:0.5 are ~1.8:1.
- **Fix:** Lighten `--text-muted` to #8a8a96, remove line-num opacity
- **Files:** `style.css:23,1736-1737`

### T2-10: Add CSP headers [SECURITY MEDIUM]
No Content-Security-Policy headers. If XSS is found, arbitrary script loading is possible.
- **Fix:** Add CSP middleware in `server.mjs`

### T2-11: Refactor gitExec() to use array args [SECURITY HIGH]
`spawn('cmd', ['/c', cmd], { shell: true })` is a latent command injection surface.
- **Fix:** Refactor to `execFile('git', [...args])` array form
- **Files:** `operator/operator.mjs:169-183`

---

## Tier 3: Medium Priority (Future Sessions)

### T3-1: Add aria-live regions for HTMX swaps [ACCESSIBILITY HIGH]
Dynamic content changes not announced to screen readers.

### T3-2: Add file preview focus trap + Escape handler [ACCESSIBILITY HIGH]
Preview panel doesn't trap focus or close on Escape.

### T3-3: Add settings.mjs unit tests [TEST COVERAGE HIGH]
Corrupt file handling, atomic write fallback, clamping untested.

### T3-4: Add toast aria-live [ACCESSIBILITY MEDIUM]
Toast notifications not announced to screen readers.

### T3-5: Cache settings in memory [PERFORMANCE MEDIUM]
`loadSettings()` reads file synchronously, called on every 10s git poll.

### T3-6: Cache chain.html template [PERFORMANCE MEDIUM]
`readFileSync` on every chain page load for a file that never changes at runtime.

### T3-7: Add skip-to-content link [ACCESSIBILITY LOW]
Standard a11y practice for keyboard users.

### T3-8: Convert orchestrator route sync I/O to async [PERFORMANCE MEDIUM]
`readFileSync`/`writeFileSync` for history, reports, missions.

### T3-9: Add `aria-expanded` to project card toggle [ACCESSIBILITY HIGH]
Screen readers can't determine collapse state.

### T3-10: Escape/validate status values in class attributes [SECURITY MEDIUM]
Corrupted registry could inject HTML via status field in class names.

---

## Tier 4: Low Priority / Won't-Fix Considerations

- **No authentication on API endpoints** — Expected for localhost dev tool. Document assumption.
- **No rate limiting** — Acceptable for localhost. Could add for mutation endpoints.
- **verbose error messages** — Acceptable for dev tool. Log-only in production mode.
- **packageManager field mismatch** — Remove or update (pnpm declared, npm used).
- **npm audit HIGH** — Dev-only ReDoS in eslint deps. No runtime exposure.
- **operator.mjs zero tests** — 840-line CLI daemon is hard to unit test (SDK deps). Consider extracting testable pure functions.
- **Client-side JS untested** — Would require browser testing framework. Low ROI.
- **Git badges lazy-load gap** — `/views/file-tree` doesn't pass gitStatus to subdirs.

---

## Dependency Actions

1. `npm update @anthropic-ai/claude-agent-sdk` — Pick up 0.2.47 (3 patches behind)
2. Remove/update `packageManager` field in package.json (says pnpm, uses npm)
3. Monitor eslint 10.x ecosystem — upgrade when typescript-eslint supports it
4. Frontend constraint: **PASS** — Zero npm frontend deps, all CDN

---

## Positive Findings

- `escapeHtml()` comprehensive and consistently used across all 35+ call sites
- `execFile()` with array args used correctly in git routes (no shell injection)
- Path-traversal guards on file endpoints (within root)
- Settings validation thorough with whitelist + clamping
- No hardcoded secrets or committed .env files
- Branch names sanitized against injection
- Server binds to 127.0.0.1 only
- Chain IDs use cryptographic UUIDs
- Registry CRUD, errors, and 8 view modules fully covered by tests
- Lock file clean: v3, 332 packages, 0 duplicates
- P10 test coverage strong: 28/35 tests cover happy paths well

---

## Metrics

- **Total issues found:** 105 across 7 audits
- **Tier 1 actions:** 6 (do now)
- **Tier 2 actions:** 11 (next session)
- **Tier 3 actions:** 10 (future)
- **Tier 4 items:** 8 (low/won't-fix)
- **Estimated new tests:** ~32 (file-watcher 12 + batch/export 10 + git-status 5 + 413 limit 1 + ws throttle 4)
