# Next Session Instructions (S87)

## Context: S86 — React Frontend Polish Started

S86 fixed 3 UI bugs and removed dead code in the React game frontend:
- Melee win dots: 3 → 4 (matching engine's `meleeWinsNeeded: 4`)
- Player labels: P1/P2/Opp → You/Opponent (consistency across all screens)
- Unseat check: excluded `'none'` value in MeleeTransitionScreen
- Deleted dead `MeleeTransition.tsx` (superseded by `MeleeTransitionScreen.tsx`)
- 1430 tests across 24 suites, all passing

## React Frontend Polish (Partially Done)

S86 performed a comprehensive audit of all 15 React UI components. Bugs are fixed; polish items remain:

### 1. Dramatic Reveal Animation (Medium)
- `RevealScreen.tsx` shows both attacks immediately — no suspense
- Add card-flip or fade-in animation with brief delay
- Could add a "3-2-1" countdown or dramatic pause before showing opponent's choice

### 2. Hardcoded Colors in CounterChart (Low)
- `CounterChart.tsx` uses stance color classes that may have hardcoded values
- Should use CSS custom properties from the design token system in `index.css`

### 3. Code Duplication Cleanup (Low)
- `LoadoutScreen.tsx` has `STAT_TIPS` that may duplicate tooltip content
- Minor cleanup opportunity

### 4. Additional Polish
- Keyboard navigation for attack card grids (arrow keys)
- Screen transition animations (fade/slide between game states)
- Mobile responsiveness for smaller screens
- Sound effect hooks for future audio integration

## Operator Dashboard (Complete — Optional Improvements)

### 5. Multi-Project Dashboard (Medium-Large)
- Project selector in nav or sidebar
- Filter all views by project
- Project-specific cost summaries

### 6. Better Toast Integration (Low)
- Show toasts for chain restart, git push, abort, all API actions

### 7. Report Auto-Refresh (Low)
- Poll for new reports after orchestrator runs

## Reference
- Handoff: `docs/archive/handoff-s86.md`
- Previous handoff: `docs/archive/handoff-s85.md`
- Design reference: `memory/web-design.md` (29 sections)
- Operator plan: `docs/operator-plan.md`
- Current test count: 1430 tests, 24 suites (all passing)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
