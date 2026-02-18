# Next Session Instructions (S101)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S100

S100 added **P10 File Explorer Enhancement** — four cohesive improvements to the P9 file explorer:

### What Was Built

1. **File content preview** (`files.mjs` + `app.js`) — Click any file in the tree to open a side panel with read-only content, line numbers, and syntax-appropriate display. New `GET /api/files/content?root=...&path=...` endpoint with:
   - 100KB file size limit (413 for oversized files)
   - Binary detection via null-byte scan + known text extension whitelist
   - Path-traversal protection
   - Returns `{path, size, content, lines}`
   - Client-side line numbering with `<span class="line-num">` elements
   - Fixed right-side panel (50vw, max 700px) with close button

2. **Git status indicators** (`git.mjs` + `projects.mjs`) — File tree entries now show git status badges (M/A/D/R/?/U) with color-coded styling. Directories with modified files show a yellow dot. New `GET /api/git/file-status?root=...` endpoint + `getGitFileStatus()` exported helper.
   - Badges: Modified (yellow), Added (green), Deleted (red), Renamed (indigo), Untracked (gray), Conflict (red bold)
   - Directory change dot: yellow 6px circle next to dirs containing changes
   - Project card stats show "N changed" count when git changes exist
   - Git status fetched in parallel (non-blocking, fail-safe) during project panel render

3. **File search** (`app.js` + `projects.mjs`) — Search input at top of each project card's file tree. Client-side filtering with 150ms debounce:
   - Filters files by name match (case-insensitive)
   - Auto-opens directories that contain matches
   - Shows/hides directories based on whether they contain visible children
   - Preserved across tree refresh and lazy-load events

4. **Collapsible project cards** (`app.js` + `projects.mjs`) — Toggle button (▾/▸) on each project card to collapse/expand the card body (stats + search + tree). State persisted in localStorage (`proj-collapsed` key). Restored after HTMX swap via `htmx:afterSwap` listener.

**35 new tests. 1588 total, 24 suites, all passing.**

### Files Changed

```
EDIT: operator/routes/files.mjs         + readFileSync import, MAX_FILE_SIZE, TEXT_EXTS, isBinary(), GET /api/files/content endpoint
EDIT: operator/routes/git.mjs           + getGitFileStatus() exported, GET /api/git/file-status endpoint
EDIT: operator/routes/views.mjs         + getGitFileStatus import, async /views/projects route, gitStatusMap passed to renderers
EDIT: operator/views/projects.mjs       + git badges, clickable files, search input, collapse toggle, preview panel, gitStatusMap support
EDIT: operator/public/app.js            + previewFile(), closePreview(), filterTree(), toggleProjectCard(), collapsed state restore
EDIT: operator/public/style.css         + Section 40: git badges, file preview panel, search input, collapse toggle, active file, responsive
EDIT: operator/__tests__/views.test.mjs + 29 tests: isBinary, TEXT_EXTS, content API, git badges, clickable files, card enhancements, panel
EDIT: operator/__tests__/server.test.mjs + 6 tests: content API (success, binary, 404, traversal, directory, missing params)
EDIT: CLAUDE.md                         Updated test counts (1588), architecture notes (P10 additions)
```

## Milestone Status

- **M1-M6**: Core operator system — DONE
- **P1-P7**: Polish & enhancements — DONE (S90-S97)
- **P8**: Analytics dashboard — DONE (S98)
- **P9**: Projects file explorer — DONE (S99)
- **P10**: File explorer enhancement — DONE (S100)

## Recommended Next Steps — Operator Interface Improvements

### Priority 1: UX Polish & Functional Gaps

1. **Analytics enhancements** — Time range picker (7d/14d/30d/90d/all), drill-down from chart elements to filtered chain list, cost forecasting based on recent trends, token efficiency metrics (cost per output token).

2. **File content syntax highlighting** — The preview panel shows plain text with line numbers. Could add lightweight syntax highlighting (e.g., highlight keywords, strings, comments) for common languages (JS/TS/JSON/CSS/HTML) without external dependencies.

3. **File tree git status auto-refresh** — Currently git status is fetched once on page load. Could periodically refresh or trigger on file change events.

4. **Server-side file search** — Current search is client-side (filters loaded entries). A server-side recursive search API (`GET /api/files/search?root=...&q=...`) would find files in collapsed/unloaded directories.

### Priority 2: Performance & Reliability

5. **Virtual scrolling for chain list** — The chain table loads all rows at once. For users with 100+ chains, implement windowed rendering or server-side pagination improvements.

6. **Indexed persistence** — The JSON-file registry works but doesn't scale. Consider SQLite (via `better-sqlite3`) for indexed queries, especially for analytics aggregation across many chains.

7. **File watcher robustness** — `fs.watch({recursive: true})` works on Windows/macOS but is unreliable on Linux. Add a fallback using polling or consider optional `chokidar` dependency for cross-platform support.

### Priority 3: New Capabilities

8. **Alerting system** — Email/Slack webhook notifications on chain failures, budget overruns, or orchestrator errors.

9. **Multi-user support** — Session-based auth, user roles (admin/viewer), shared dashboards.

10. **Mobile/PWA** — Add web app manifest, service worker for offline dashboard viewing, push notifications for chain completion.

11. **Diff viewer** — Compare file states between chain sessions. Useful for reviewing what an agent actually changed.

## Key Architecture Notes

- **File content API** is in `files.mjs` alongside `scanDirectory` — same path-traversal guards, same router.
- **getGitFileStatus** exported from `git.mjs` — runs `git status --porcelain -uall`, returns `{filePath: statusCode}` map.
- **Git status in views** — fetched in parallel via `Promise.all` in the `/views/projects` route, fail-safe (catches errors silently for non-git dirs).
- **renderFileTree** now accepts optional 3rd param `gitStatus` — backward compatible, renders badges when provided.
- **renderProjectCard** now accepts optional 3rd param `gitStatus` — shows "N changed" stat when changes exist.
- **renderProjectsPanel** now accepts optional 3rd param `gitStatusMap` — Map of projectDir → gitStatus.
- **File preview panel** rendered once in `renderProjectsPanel`, hidden by default, toggled by `previewFile()/closePreview()` JS.
- **Tree search** is client-side only (150ms debounce) — filters `.tree-file` and `.tree-dir` display, auto-opens matching dirs.
- **Collapsed cards** state in `localStorage` key `proj-collapsed` — object of `{root: true}` for collapsed projects.
- **CSS section 40** contains all P10 styles (git badges, file preview, search, collapse, active file).

## Codebase Stats

```
Operator: 20 source files, ~5,500 lines code + ~4,100 lines tests
Routes:   31 API endpoints, 15 view fragment routes, 6 page routes, 1 WebSocket
Events:   17 bridged WS events, pattern-based subscriptions
Tests:    305 operator tests (server 106, views 162, errors 43, registry 21)
Total:    1588 tests across 24 suites (8 engine + 12 orchestrator + 4 operator)
```

## Running the Operator

```bash
node operator/server.mjs                    # API server on http://127.0.0.1:3100
node operator/server.mjs --port 8080        # Custom port
node operator/server.mjs --operator         # Combined mode: API + chain execution
```

Dashboard at http://127.0.0.1:3100, Projects at /projects, Analytics at /analytics, Orchestrator at /orchestrator, Settings at /settings.

## Working Style Reminder

- **Use Task subagents aggressively** for research/exploration (they CANNOT write/edit)
- Do all edits yourself in the main context
- Full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Run `npm test` to verify after changes (1588 tests, 24 suites)

## Reference

- Operator plan: `docs/operator-plan.md` (M1-M6 specs)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
