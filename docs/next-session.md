# Next Session Instructions (S88)

## Context: S87 — React Frontend Polish Continued

S87 completed the top 3 polish items from S86's audit:
- **Dramatic reveal animation**: RevealScreen now has a 3-phase staged reveal — player attack slides in immediately, opponent card flips via CSS 3D perspective after 0.8s, counters and actions fade in at 1.6s. Respects prefers-reduced-motion.
- **Hardcoded colors fixed**: CounterChart CSS replaced `#2ECC71`/`#E74C3C` with `--counter-win-border`/`--counter-lose-border` design tokens
- **STAT_TIPS consolidated**: Exported shared `STAT_TIPS` from `helpers.tsx`, removed duplicate from `LoadoutScreen.tsx`. `STAT_TIPS_DETAIL` (abbreviated keys) kept for StatBar tooltips.
- 1430 tests across 24 suites, all passing

## Remaining React Polish

### 1. Keyboard Navigation for Attack Grids (Medium)
- Arrow key navigation between attack cards in `AttackSelect.tsx`
- Focus management when entering/leaving card grids
- Enter/Space already works (handled by `handleKeyDown`)

### 2. Screen Transition Animations (Low-Medium)
- Fade/slide transitions between game states in `App.tsx`
- Currently each screen has `animation: fadeIn 0.25s` but no exit animation
- Consider `AnimatePresence`-style approach or CSS-only transitions

### 3. Mobile Responsiveness (Low)
- Attack grid, speed grid, loadout screen need responsive breakpoints
- `@media (max-width: 480px)` exists but only handles grid collapse
- Touch-friendly card sizes, readable text at small screens

### 4. Sound Effect Hooks (Low)
- Placeholder hook system for future audio integration
- `useSound()` hook that returns no-op functions until audio assets are ready

## Operator Dashboard (Optional Improvements)

### 5. Multi-Project Dashboard (Medium-Large)
- Project selector in nav or sidebar
- Filter all views by project
- Project-specific cost summaries

### 6. Better Toast Integration (Low)
- Show toasts for chain restart, git push, abort, all API actions

### 7. Report Auto-Refresh (Low)
- Poll for new reports after orchestrator runs

## Reference
- Handoff: `docs/archive/handoff-s87.md`
- Previous handoff: `docs/archive/handoff-s86.md`
- Design reference: `memory/web-design.md` (29 sections)
- Operator plan: `docs/operator-plan.md`
- Current test count: 1430 tests, 24 suites (all passing)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
