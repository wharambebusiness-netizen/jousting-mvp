# Handoff: S136 → S137

## What was done (S136)

1. **Space theme design tokens**: Backgrounds shifted from neutral zinc to deep space blues (#06061a → #0b0b24 → #12123a → #1a1a4a). Accent changed from blue (#3b82f6) to indigo (#6366f1). Borders use blue-purple tint. Pico CSS overrides updated.
2. **Animated particle canvas**: 80 particles with twinkling, drift, faint nebula gradient. Canvas injected via app.js on all pages. Pauses when tab hidden.
3. **HTML SVG updates**: Favicon + brand SVGs updated to indigo/violet/cyan across all 6 pages.
4. **Terminal themes renamed**: Nebula, Aurora, Solar, Mars, Pulsar, Quasar, Comet, Stellar — all backgrounds deepened.
5. **Bug fix**: Canvas element given inline `position:fixed` to avoid blank space at top of pages.
6. **2522 tests all passing**, commit b3a6071, pushed to origin/master.

## What to do next (S137) — Two tasks

### Task A: Settings Page Revision

The settings page is currently minimal — it has a single "Default Configuration" section with 5 fields (model, maxTurns, maxContinuations, maxBudgetUsd, autoPush). It needs to be redesigned to be more useful for the overall project.

**Current settings system:**
- Persistence: `operator/settings.mjs` — `createSettings(ctx)` factory, atomic writes, validation, clamping
- REST: `operator/routes/settings.mjs` — GET/PUT /api/settings
- View: `operator/routes/views.mjs` lines 564–614 — renders `/views/settings-form` HTMX fragment
- Page: `operator/public/settings.html` — single section with lazy-loaded form
- CSS: `style.css` section 29 (`.settings-grid`)
- Also: `toggleAutoPush()` in app.js duplicates auto-push toggle in git panel

**What to redesign:**
- Break settings into logical sections/cards (not just one flat grid)
- Consider adding sections for:
  - **Agent Configuration**: model, maxTurns, maxContinuations, budget — already exist
  - **Git & Automation**: autoPush, maybe branch naming pattern
  - **Coordination**: pool settings (RPM, TPM, budgets) — currently only configurable via API
  - **UI Preferences**: theme/layout preferences, particle toggle, terminal default theme
  - **About/System Info**: version, uptime, system stats (read-only info section)
- Use card-based layout matching the dashboard aesthetic
- Add section headers, descriptions, and better field grouping
- Consider adding a "Danger Zone" section for destructive operations (clear all chains, reset settings)
- The settings page should feel like a proper control center for the orchestration system
- User should approve the plan before implementation

**Key files:**
- `operator/public/settings.html` — page layout
- `operator/routes/views.mjs` lines 564–614 — form renderer
- `operator/routes/settings.mjs` — REST endpoints
- `operator/settings.mjs` — persistence (add new fields here)
- `operator/public/style.css` — section 29 settings styles

### Task B: Enhanced Space Background

The user wants to make the background "blacker" with more visual elements. Current system is 80 white/blue-tinted dot particles on deep space blue backgrounds.

**Changes requested:**
1. **Blacker backgrounds**: Shift --bg-root even darker (closer to pure black, maybe #030308 or #040410). The current #06061a may still feel too blue.
2. **Richer floating objects**: Add variety beyond dot particles:
   - **Planets**: Occasional larger circles (8-20px) with subtle gradient fills, very low opacity (0.03-0.08), slow drift. Maybe 3-5 total.
   - **Ships/spacecraft**: Small geometric shapes (triangles, chevrons) that move faster than stars, also very low opacity. Maybe 2-3 total.
   - **Treasure/loot**: Tiny diamond/gem shapes that drift and rotate slowly, slightly more visible than stars. Maybe 3-5 total.
   - **Shooting stars**: Very rare (every 10-30 seconds), fast diagonal streak across part of the screen, bright but brief.
3. **Keep performance**: Still use requestAnimationFrame, keep total object count reasonable (~100 max), pause on hidden tab.

**Key files:**
- `operator/public/app.js` — particle system (lines 716–831)
- `operator/public/style.css` — :root[data-theme="dark"] tokens (lines 9–108), `#space-particles` styles

**Implementation approach:**
- Refactor `createParticle()` into a type-based system: `{ type: 'star' | 'planet' | 'ship' | 'treasure' | 'shootingStar' }`
- Each type has its own draw function, size range, speed, opacity, and shape
- Shooting stars are spawned on a timer, not part of the main particle pool
- Draw functions use canvas path operations (no images needed) — diamonds, triangles, circles with gradients, streak lines

## Architecture notes

- Zero npm frontend dependencies — all vanilla JS, Pico CSS + HTMX 2.0
- app.js is loaded on every page — best place for shared animation
- style.css uses CSS custom properties in :root[data-theme="dark"]
- Tests don't reference visual/color values — safe to change freely
- Server runs at `node operator/server.mjs` on port 3100
- All 6 HTML pages: index.html, terminals.html, taskboard.html, projects.html, settings.html, chain.html
- Terminal themes are in terminals.js lines 45-142

## Test verification

```bash
npm test    # 2522 tests, 34 suites — all must pass
```
