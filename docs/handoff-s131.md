# S131 Handoff → S132: UI Makeover Phase 2

## Context
Session 131 completed UI Makeover Phase 1 — a comprehensive visual overhaul of the operator web UI. The terminals page got the full treatment: vantablack theme, collapsible sidebar nav, flexible terminal layouts, and glowing border effects. All 8 HTML pages got the new sidebar nav. The next phase is refining and propagating the vantablack aesthetic to the non-terminal pages.

## What Was Done in S131

### 1A. Design System Overhaul (`style.css` tokens)
- **Backgrounds**: Shifted to true vantablack — `--bg-root: #000000`, `--bg-surface: #0a0a0c`, `--bg-raised: #111114`, `--bg-overlay: #1a1a1f`
- **Glow tokens**: Added `--glow-accent/success/warning/error/info` (rgba 0.35) + `--glow-sm/md/lg` (6px/12px/20px)
- **Text**: Brighter for black contrast — `--text-primary: #f0f0f2`, `--text-secondary: #a8a8b3`
- **Sidebar tokens**: `--sidebar-width-collapsed: 48px`, `--sidebar-width-expanded: 200px`
- **Pico overrides**: Updated to match vantablack palette
- **Body**: Removed radial gradient background (pure black now)
- **Shadows**: Slightly stronger for black background contrast

### 1B. Sidebar Navigation (all 8 pages)
- **Structure**: `<aside class="sidebar-nav">` replaces `<nav class="nav">` in all HTML pages
- **Icons**: Custom inline SVGs for 7 nav links (Dashboard/Projects/Analytics/Orchestrator/Terminals/Tasks/Settings)
- **Behavior**: `width: 48px` collapsed (icons only) → `200px` on hover (icons + labels fade in)
- **Active link**: `sidebar-nav__link--active` class with indigo left border + `data-page` attribute
- **Footer**: WS status dot (`#ws-dot`) + project select dropdown (`#project-select`)
- **Layout**: `body.has-sidebar { margin-left: 48px }` offsets content
- **HTMX compat**: `htmx:afterSettle` listener in app.js updates active link after SPA navigation
- **WS dot fix**: `updateDot()` in app.js preserves `sidebar-nav__ws-dot` class when toggling states
- **Old `.nav`**: Hidden via `display: none` in CSS (class still exists for safety)

### 1C. Flexible Terminal Layouts
- **5 layouts**: single, split-h, split-v, triple, quad — controlled by `data-layout` attribute on `.term-panels--grid`
- **CSS grid**: Each layout gets its own `grid-template-columns/rows` definition
- **Triple layout**: First child spans `grid-row: 1 / -1` for 1-big + 2-small split
- **Layout selector**: Button group `.layout-selector` with SVG icons in page-header actions
- **State**: `gridLayout` variable persisted as `term-layout` in localStorage
- **`setLayout()`**: Sets layout, auto-switches to grid mode if in tabs, calls `applyViewMode()`
- **Keyboard**: Keys 1-5 (no modifiers, skips form fields) map to the 5 layouts
- **Exposed**: `window.setLayout` for onclick handlers

### 1D. Terminal Panel Glow Styling
- **Theme glow**: Each of the 8 THEMES now has a `glow` property (e.g., `'rgba(99,102,241,0.25)'`)
- **CSS vars**: `--panel-glow` and `--tab-glow` set per panel/tab alongside `--panel-accent`/`--tab-accent`
- **Panel focus**: `.term-panel--focused` / `:focus-within` gets accent border + `box-shadow` glow
- **Panel hover**: Grid panels get subtle glow on hover
- **Tab active**: Active tab gets bottom glow shadow via `--tab-glow`
- **Grid panels**: Now have `border-radius: var(--radius-sm)` instead of 0
- **Xterm backgrounds**: Near-black per theme (e.g., `#020204` for Indigo, `#010302` for Emerald)
- **Dialogs**: Glow shadow (`rgba(99,102,241,0.10)`) + darker backdrop with blur
- **Buttons**: Primary hover gets `--glow-sm --glow-accent`
- **Cards/articles**: Hover glow `rgba(99,102,241,0.06)`
- **Metric cards**: Hover glow `rgba(99,102,241,0.08)`

### Bug Fix
- **claude-terminals test**: Changed `/^claude/` regex to `/claude/` to match full `where claude` resolved path from S130

## What's Next: Phase 2

### Dashboard Page (`index.html`)
- Metric cards could use per-status glow on hover (success cards get green glow, etc.)
- Quick-start form inputs need vantablack form styling check
- Chain table row hover could use subtle glow
- Git panel card styling

### Analytics Page (`analytics.html`)
- SVG chart colors may need contrast boost against vantablack
- Chart cards glow treatment

### Projects Page (`projects.html`)
- Project cards + file tree against vantablack
- File preview panel contrast

### Orchestrator Page (`orchestrator.html`)
- Agent cards glow styling
- Status dots already have glow, may need tuning

### Task Board Page (`taskboard.html`)
- Kanban columns need vantablack contrast check
- Card glow effects per status (success/fail/running)
- DAG view SVG styling against black

### Settings Page (`settings.html`)
- Form inputs against vantablack
- Toggle switches styling

### Chain Detail Page (`chain.html`)
- Timeline styling
- Session cards
- Terminal viewer (old log viewer, not xterm)

## Key Architecture Notes for Phase 2
- The old `.nav` CSS rule is `display: none` — safe to eventually remove
- All pages now use `<body class="has-sidebar">` with `margin-left: 48px`
- The `terminals-page` class has `height: 100vh` (no longer `calc(100vh - 56px)`)
- Other pages still use `.page { max-width: 1200px; margin: 0 auto }` — this works fine with sidebar offset
- The sidebar is fixed-position, so it doesn't affect content flow beyond the margin

## Files Modified
| File | What Changed |
|------|-------------|
| `operator/public/style.css` | Design tokens, sidebar CSS, layout selector CSS, panel glow CSS, dialog glow |
| `operator/public/terminals.html` | Sidebar nav, layout selector buttons, shortcuts help update |
| `operator/public/terminals.js` | THEMES with glow, gridLayout state, setLayout(), applyViewMode() with data-layout, keyboard 1-5 |
| `operator/public/app.js` | updateSidebarActiveLink(), htmx:afterSettle listener, WS dot class preservation |
| All 8 HTML pages | `<nav class="nav">` → `<aside class="sidebar-nav">`, `body.has-sidebar` |
| `operator/__tests__/claude-terminals.test.mjs` | Fixed regex for full `where claude` path |
| `docs/session-history.md` | S131 entry |

## Test Status
- **2520 tests, 34 suites, ALL PASSING**
- No backend changes in this session — all changes are frontend (HTML/CSS/JS)
- Test fix was for a pre-existing S130 issue (regex too strict for resolved path)
