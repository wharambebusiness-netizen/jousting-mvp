# Next Session Instructions (S84)

## Task: Continue M6 — Update UI + Build Features

S83 rewrote the CSS design system. The HTML pages and view renderers still use old class names. Start by wiring up the new design, then build M6 features.

### What's Done
- M1-M5: CLI daemon, session management, continuation, HTTP API, Web UI Dashboard
- S83: Professional CSS design token system (Linear/Vercel-inspired dark theme, 527 lines)
- Design reference: `memory/web-design.md` (29 sections with CSS/HTML/JS patterns)
- 1408 tests across 24 suites, all passing

### Step 1: Update HTML Pages (index, chain, orchestrator)

Replace Pico's default `<nav class="container">` with the new sticky glassmorphism nav:
```html
<nav class="nav">
  <a href="/" class="nav__brand">Operator</a>
  <ul class="nav__links">
    <li><a href="/" class="nav__link nav__link--active">Dashboard</a></li>
    <li><a href="/orchestrator" class="nav__link">Orchestrator</a></li>
  </ul>
</nav>
```

Wrap `<main>` content in `.page` container. Add to each page:
- Toast container: `<div id="toast-container"></div>`
- Progress bar JS (see `memory/web-design.md` section 17)
- `hx-boost="true"` on `<body>` for SPA-like navigation
- Loading skeletons instead of "Loading..." text

Update class names on existing elements:
- `<div class="stats-grid">` → `<div class="metrics-grid">`

### Step 2: Update View Renderers

Class name migration across 4 files:

**chain-row.mjs:**
- `dot dot-${status}` → `status-dot status-dot--${status}`
- `btn-sm btn-kill` → `btn btn--sm btn--danger`
- `empty-msg` → `empty-state`

**session-card.mjs:**
- `dot dot-${status}` → `status-dot status-dot--${status}`
- `badge` → `badge badge--neutral`, `badge-ok` → `badge--success`, `badge-warn` → `badge--warning`, `badge-err` → `badge--error`
- `timeline-block timeline-${status}` → `timeline__segment timeline--${status}`
- `empty-msg` → `empty-state`

**agent-card.mjs:**
- `dot dot-${status}` → `status-dot status-dot--${status}`
- `empty-msg` → `empty-state`

**routes/views.mjs:**
- `stat-card` → `metric-card` with `metric-card__label`/`metric-card__value` inner structure
- `dot dot-${status}` → `status-dot status-dot--${status}`
- `btn-kill` → `btn btn--danger`
- `empty-msg` → `empty-state`

### Step 3: Build M6a — Mission Launcher

The `POST /api/orchestrator/start` endpoint is a **placeholder** — it just emits events but doesn't spawn anything.

1. Add `GET /api/orchestrator/missions` endpoint — list `.json` files from `orchestrator/missions/` (not `archive/`)
2. Wire `POST /api/orchestrator/start` to actually spawn orchestrator via `child_process.fork()`:
   ```js
   const child = fork('orchestrator/orchestrator.mjs', [missionPath, ...(dryRun ? ['--dry-run'] : [])]);
   ```
3. Add mission launcher form to orchestrator.html — dropdown of missions, dry-run checkbox, start button
4. Add HTMX fragment route for mission list

### Step 4: Build M6d — Git Integration

1. Create `operator/routes/git.mjs`:
   - `GET /api/git/status` — run `git status --porcelain` and `git log --oneline -5`
   - `POST /api/git/push` — run `git push origin HEAD`
   - `POST /api/git/pr` — run `gh pr create` with auto-generated title/body from chain summary
2. Add git status panel to dashboard or chain detail page
3. Add push/PR buttons to completed chain cards

### Step 5: Build M6b — Report Viewer (Lower Priority)

Currently reports go to single `orchestrator/overnight-report.md`. Options:
- Render that file via `marked` CDN library
- Add timestamped report archival in future

### Step 6: Tests

Write tests for all new routes and renderers. Run full suite to verify 1408+ tests passing.

---

## Reference

- Handoff: `docs/archive/handoff-s83.md`
- Design reference: `memory/web-design.md` (29 sections)
- UI upgrade plan: `memory/ui-upgrade-plan.md`
- Operator plan: `docs/operator-plan.md` (M6 section)
- Current test count: 1408 tests, 24 suites (all passing)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
