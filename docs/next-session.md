# Next Session Instructions (S83)

## Task: Build M6 — Orchestrator Management + Git Integration from UI

Read `docs/operator-plan.md` section "M6: Orchestrator Management from UI" for the full spec.

### What's Done (M1-M5)
- M1-M4: CLI daemon, session management, continuation, HTTP API
- M5 (S82): Web UI Dashboard — 3 pages (dashboard, chain detail, orchestrator) with Pico CSS dark mode + HTMX polling, kill buttons, quick-start form, session timelines, cost breakdowns
- 1408 tests across 24 suites, all passing

### M6 Features to Build

**6a. Mission Launcher**
- Form on dashboard: select mission config from `orchestrator/missions/` dropdown
- Options: dry-run mode, model tier override, custom agent count
- Start button → POST to `/api/orchestrator/start`
- Live redirect to orchestrator view

**6b. Report Viewer**
- List of past orchestrator reports from `orchestrator/reports/`
- Rendered markdown → HTML (use `marked` library, CDN-loaded)
- Filter by date, mission, status

**6c. Handoff Viewer**
- Browse handoff files from any chain
- Side-by-side view: previous handoff → session output → next handoff
- Read-only in M6

**6d. Git Integration**
- Auto-push toggle in UI (sets `OPERATOR_AUTO_PUSH` for current server session)
- PR creation button: after chain completion, click to create PR via `gh pr create`
- Branch name auto-generated from task description
- PR body auto-generated from chain summary

### Files to Create/Modify
- `operator/routes/orchestrator.mjs` — Add start/stop endpoints (extend from M4)
- `operator/routes/reports.mjs` — Report listing and rendering
- `operator/routes/git.mjs` — Push and PR creation endpoints
- `operator/public/mission-launcher.html` — Mission launch form
- `operator/public/reports.html` — Report browser
- `operator/views/report-card.mjs` — Report listing HTML fragment

### Alternative: Polish M5 First
If M6 feels like too much for one session, an alternative is to polish M5:
- Add WebSocket live updates to dashboard (currently polling only)
- Add project filter/selector to nav
- Add responsive improvements for mobile
- Manual browser testing and UX polish

---

## Reference

- Handoff: `docs/archive/handoff-s82.md`
- Operator plan: `docs/operator-plan.md` (M6 section)
- Current test count: 1408 tests, 24 suites (all passing)
- Dependencies: `express`, `ws` (already installed)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
