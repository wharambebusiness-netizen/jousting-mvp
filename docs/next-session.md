# Next Session Instructions (S90)

## Context: S89 — React Polish (Design Tokens + Arrow Nav + Transitions)

S89 completed all 5 priority tasks:
- 26 hardcoded rgba() replaced with 19 new design tokens (zero remaining in App.css)
- Arrow key navigation added to speed grid (3-col) and reveal shift grid (2-col)
- Transition double-click guards on all 8+ event handlers
- AI choice logic extracted to pure computeJoustAI / computeMeleeAI helpers
- 1430 tests, 24 suites, all passing

## Remaining React Polish

### 1. Archetype Selection Arrow Navigation (Easy)
- Setup screen has a grid of archetype cards
- Add the same arrow key navigation pattern (useRef + handleGridKeyDown)
- File: `src/ui/SetupScreen.tsx`

### 2. Loadout Screen Arrow Navigation (Easy)
- Gear selection grids in `src/ui/LoadoutScreen.tsx`
- Add arrow key handling for navigating between gear slot options

### 3. Visual Transition Feedback (Low)
- During the 150ms fade-out, clicks are silently ignored
- Consider adding disabled styling (opacity, cursor change) to interactive elements during transitions
- Could pass `transitioning` prop down to child screens, or use a context

### 4. Keyboard Shortcut Hints (Low)
- Small muted text below grids: "Use arrow keys to navigate"
- Only show after first keyboard interaction (detect with a flag)

## Operator Dashboard (Optional)

### 5. Multi-Project Dashboard (Medium-Large)
- Project selector in nav or sidebar
- Filter all views by project
- Project-specific cost summaries

### 6. Better Toast Integration (Low)
- Show toasts for chain restart, git push, abort, all API actions

### 7. Report Auto-Refresh (Low)
- Poll for new reports after orchestrator runs

## Reference
- Handoff: `docs/archive/handoff-s89.md`
- Previous handoff: `docs/archive/handoff-s88.md`
- Design reference: `memory/web-design.md`
- Current test count: 1430 tests, 24 suites (all passing)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
