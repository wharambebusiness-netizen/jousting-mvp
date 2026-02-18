# Next Session Instructions (S100)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S99

S99 added the **P9 Projects File Explorer** — a new `/projects` page with real-time file structure viewing for all managed projects:

1. **File scanning** (`operator/routes/files.mjs`) — `scanDirectory(root, subPath)` scans directories returning sorted entries (dirs first, then files, alphabetical). Ignores node_modules, .git, dist, build, etc. Path-traversal protection. `GET /api/files?root=<path>&path=<subpath>` API endpoint.

2. **Project view renderers** (`operator/views/projects.mjs`) — 3 exported functions:
   - `renderProjectsPanel(projects, rootEntriesMap)` — full panel with all project cards
   - `renderProjectCard(project, rootEntries)` — single project card with stats + file tree
   - `renderFileTree(entries, root)` — collapsible file tree using `<details>/<summary>` HTML elements

3. **File watcher** (`operator/file-watcher.mjs`) — `createFileWatcher(events)` watches project directories via `fs.watch({recursive: true})`, 1s debounce per project, emits `project:files-changed` on EventBus. Auto-watches existing projects on server startup, new projects on `chain:started`.

4. **Real-time updates** — `project:files-changed` bridged to WebSocket (now 17 bridged events). Client JS listens for changes, auto-refreshes open directory trees with 3s debounce.

5. **Projects page** (`operator/public/projects.html`) — New page with project cards showing chain stats (running/done/failed counts, cost, last activity), collapsible file trees with lazy-loading subdirectories, refresh button per project.

6. **Navigation** — "Projects" link added between Dashboard and Analytics on all 6 HTML pages.

7. **CSS** — Section 39 in style.css: `.projects-panel`, `.project-card`, `.project-tree`, `.tree-dir`, `.tree-file`, `.tree-summary`, refresh spinner animation, responsive breakpoints.

8. **Client JS** — `loadTreeNode()` for lazy-loading via vanilla JS fetch, `refreshProjectTree()` for manual refresh, WS file-change listener with per-project debounce. app.js now has 12 systems (was 10).

**Zero new dependencies** — uses Node.js built-in `fs.watch` for real-time file watching.

**1553 tests, 24 suites, all passing.**

## What Changed (Files Modified)

```
NEW:  operator/routes/files.mjs              File scanning API (scanDirectory + GET /api/files)
NEW:  operator/views/projects.mjs            Project card + file tree renderers (3 functions)
NEW:  operator/public/projects.html          Projects page with HTMX skeleton loading
NEW:  operator/file-watcher.mjs              Real-time fs.watch for project directories
EDIT: operator/routes/views.mjs              Import projects/files, add /views/projects + /views/file-tree fragments
EDIT: operator/server.mjs                    Import file routes + watcher, mount /api/files, add /projects page, init watcher
EDIT: operator/ws.mjs                        Add project:files-changed to BRIDGED_EVENTS (now 17)
EDIT: operator/public/style.css              Section 39: projects + file tree CSS
EDIT: operator/public/app.js                 loadTreeNode, refreshProjectTree, WS file-change listener (12 systems now)
EDIT: operator/public/index.html             Add Projects nav link
EDIT: operator/public/chain.html             Add Projects nav link
EDIT: operator/public/analytics.html         Add Projects nav link
EDIT: operator/public/orchestrator.html      Add Projects nav link
EDIT: operator/public/settings.html          Add Projects nav link
EDIT: operator/__tests__/views.test.mjs      +21 tests: scanDirectory, renderFileTree, renderProjectCard, renderProjectsPanel, route tests
EDIT: operator/__tests__/server.test.mjs     +6 tests: projects page, file API, path traversal
EDIT: CLAUDE.md                              Updated test counts (1553), architecture (files.mjs, projects.mjs, file-watcher.mjs, projects.html)
```

## Milestone Status

- **M1-M6**: Core operator system — DONE
- **P1-P7**: Polish & enhancements — DONE (S90-S97)
- **P8**: Analytics dashboard — DONE (S98)
- **P9**: Projects file explorer — DONE (S99)

## Future Directions

Potential next work:
- **Analytics enhancements** — time range picker, drill-down charts, cost forecasting, token efficiency metrics
- **Performance optimization** — virtual scrolling for large chain lists, indexed persistence
- **Multi-user support** — auth, user roles, shared dashboards
- **Alerting** — email/slack notifications on chain failures or budget overruns
- **Mobile/PWA** — manifest, push notifications, responsive refinements
- **File explorer enhancements** — file content preview, file search, git status indicators on files, diff viewer

## Key Architecture Notes

- **File scanner** is a pure function (`scanDirectory`) separated from the route handler — can be reused by view renderers.
- **File watcher** uses Node.js `fs.watch` with `recursive: true` — works on Windows and macOS. Linux may need `chokidar` for recursive watching.
- **Tree lazy-loading** uses vanilla JS `fetch()` (not HTMX) for full control over expand/collapse state. `<details>` elements handle open/close natively.
- **Real-time flow**: `fs.watch` → debounce → EventBus `project:files-changed` → WS bridge → client JS → re-fetch open tree nodes.
- **Path-traversal protection** on both `/api/files` and `/views/file-tree` routes — `resolve()` + startsWith check prevents directory escape.
- **IGNORED set** shared pattern between `scanDirectory` and `file-watcher.mjs` — both skip the same directories (node_modules, .git, dist, etc.).

## Codebase Stats

```
Operator: 20 source files, ~5,000 lines code + ~3,700 lines tests
Routes:   29 API endpoints, 15 view fragment routes, 5 page routes, 1 WebSocket
Events:   17 bridged WS events, pattern-based subscriptions
Tests:    297 operator tests (server 100, views 133, errors 43, registry 21)
Total:    1553 tests across 24 suites (8 engine + 12 orchestrator + 4 operator)
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
- Run `npm test` to verify after changes (1553 tests, 24 suites)

## Reference

- Operator plan: `docs/operator-plan.md` (M1-M6 specs)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
