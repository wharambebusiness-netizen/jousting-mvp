# S130 Handoff → S131: UI Makeover Phase 1

## Context
Session 130 fixed several Claude terminal bugs (spawn path, nested session env, dialog layout, folder drag-to-cd) and began planning a comprehensive UI makeover. The user wants a "vantablack with professional glowing borders" aesthetic overhaul, starting with the terminals page.

## What Was Done in S130
1. **Fixed claudePool not enabled from CLI** — `server.mjs` CLI entry now passes `claudePool: true` by default
2. **Fixed claude.exe spawn** — `claude-terminal.mjs` resolves full path via `where claude` on Windows (node-pty needs absolute path)
3. **Fixed nested session error** — Unset `CLAUDECODE` env var in PTY spawn env
4. **Fixed checkbox overlap** — Added flex layout CSS for checkbox labels in `.term-dialog`
5. **Added folder drag-to-cd** — Drag handle (`⠿`) on folder summaries in sidebar, drops send `cd <path>` to Claude terminals
6. **Committed and pushed** as `ac2bcb3`

## UI Makeover Plan (Approved Direction)

### User Preferences (from interactive Q&A)
- **Terminal Layout**: Flexible layouts — selectable 1/2/3/4 panel configurations (single full, side-by-side, 1+2 split, 2x2 quad)
- **Navigation**: Collapsible sidebar nav (VS Code/Linear style) — thin icon strip ~48px collapsed, ~200px expanded. Replaces current 56px top nav bar
- **Aesthetic**: Vantablack theme with glowing borders — true black backgrounds, luminous colored border glows, professional not gaudy
- **Scope**: Terminals page first (Phase 1), then propagate to other pages (Phase 2)

### Phase 1: Terminals Page Makeover

#### 1A. Design System Overhaul (`style.css` tokens)
- **Backgrounds**: Shift to true black (`#000000` or `#010102`) for `--bg-root`, deeper surface colors
- **Glowing borders**: New tokens for glow effects — `box-shadow` with colored spread, accent-tinted borders
- **Keep accent indigo** `#6366f1` but add glow variants (e.g., `0 0 8px rgba(99,102,241,0.3)`)
- **Refined text hierarchy**: Slightly brighter primary text against vantablack for contrast
- **New tokens needed**: `--glow-accent`, `--glow-success`, `--glow-sm/md/lg` for consistent glow sizing

#### 1B. Sidebar Navigation (replaces top nav)
- **New component**: `<aside class="sidebar-nav">` — vertical icon strip on left edge
- **Icons**: Simple SVG or Unicode for each page (Dashboard, Projects, Analytics, Orchestrator, Terminals, Tasks, Settings)
- **Collapsed**: ~48px wide, icons only, tooltips on hover
- **Expanded**: ~200px, icon + label, toggle via hamburger or hover
- **WS status dot**: Move into sidebar (was in top nav)
- **All 8 HTML pages**: Replace `<nav class="nav">` with new sidebar
- **Saves**: ~56px vertical on terminals page = significantly more terminal space

#### 1C. Flexible Terminal Layout
- **Layout selector**: Button group in terminals header — icons for 1/2/3/4 panel configs
- **Layouts**:
  - `single`: 1fr (full screen, one terminal)
  - `split-h`: 1fr 1fr (two side-by-side)
  - `split-v`: 1fr / 1fr (two stacked)
  - `triple`: 1fr 1fr / 2fr (one big left, two small right — or similar)
  - `quad`: 1fr 1fr / 1fr 1fr (current 2x2)
- **CSS Grid changes**: Dynamic `grid-template-columns` / `grid-template-rows` based on layout choice
- **Persist**: Layout choice in localStorage
- **FitAddon**: Already handles resize; just needs refit on layout change

#### 1D. Terminal Panel Glow Styling
- Panels get subtle glow borders matching their theme color
- Active/focused panel gets brighter glow
- Status bar refinements for vantablack contrast
- Tab bar styling updates

### Phase 2: Global Propagation (Future Session)
- Apply sidebar nav to all pages
- Apply vantablack tokens globally
- Restyle dashboard cards, metrics, tables with glow borders
- Update dialogs, buttons, forms
- Task board glow styling
- Analytics charts on black

### Key Files to Modify
| File | Changes |
|------|---------|
| `operator/public/style.css` | New design tokens, sidebar nav CSS, terminal layout CSS, glow effects |
| `operator/public/terminals.html` | Replace top nav with sidebar, add layout selector buttons |
| `operator/public/terminals.js` | Layout switching logic, sidebar nav toggle, refit terminals |
| `operator/public/app.js` | Sidebar nav shared component (used by all pages) |
| All 8 HTML pages | Replace `<nav class="nav">` with sidebar nav (Phase 2, or at least terminals in Phase 1) |

### Current Architecture Reference
- **CSS**: 3697 lines, single file, Pico CSS v2 base with dark overrides
- **Terminal grid**: Fixed 2x2 via `.term-panels--grid { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr }`
- **Nav**: 56px sticky top, 7 links + project select + WS dot
- **Terminal page height**: `calc(100vh - 56px)` — will become `100vh` with sidebar nav
- **8 color themes**: Indigo, Emerald, Amber, Rose, Violet, Cyan, Pink, Lime — each with full xterm palette
- **FitAddon**: Already handles dynamic resizing, called on view changes with 50ms delay
- **Tab vs Grid**: `viewMode` in localStorage, toggled via `toggleTerminalView()` → `applyViewMode()`

### Test Strategy
- All 2520 existing tests should still pass (no backend changes in Phase 1)
- Manual visual testing: start server (`node operator/server.mjs`), open http://127.0.0.1:3100/terminals
- Verify: layout switching (1/2/3/4), sidebar nav expand/collapse, glow effects, terminal fit, keyboard shortcuts still work
- Check all pages nav works if sidebar applied globally

### Important Gotchas
- `publicDir` in server.mjs resolves from `import.meta.dirname` — static files served from `operator/public/`
- `claudePool: true` now auto-enabled in CLI (fixed this session)
- Claude terminals need `CLAUDECODE=''` in env to avoid nested session error
- `where claude` resolves full path for node-pty on Windows
- Pico CSS is loaded from CDN — any new nav must work alongside or replace Pico's nav styles
- `hx-boost="true"` on body means page nav is SPA-like — sidebar must persist across HTMX swaps
- `onPageCleanup` pattern needed for WS teardown on page transitions
