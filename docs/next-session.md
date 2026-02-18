# Next Session Instructions (S88)

## Context: S87 — React Frontend Polish Continued

S87 completed the top 3 polish items from S86's audit:
- **Dramatic reveal animation**: RevealScreen now has a 3-phase staged reveal — player attack slides in immediately, opponent card flips via CSS 3D perspective after 0.8s, counters and actions fade in at 1.6s. Respects prefers-reduced-motion.
- **Hardcoded colors fixed**: CounterChart CSS replaced `#2ECC71`/`#E74C3C` with `--counter-win-border`/`--counter-lose-border` design tokens
- **STAT_TIPS consolidated**: Exported shared `STAT_TIPS` from `helpers.tsx`, removed duplicate from `LoadoutScreen.tsx`. `STAT_TIPS_DETAIL` (abbreviated keys) kept for StatBar tooltips.
- 1430 tests across 24 suites, all passing

## React Code Cleanup (High Value)

### 1. Dead CSS Removal (Easy Win)
- `src/App.css` lines ~553-709 contain old triangle/matrix/text chart CSS styles that are **no longer used** — the current `CounterChart.tsx` uses a card-based layout (CSS at lines ~2128-2386)
- Search for class names like `.counter-matrix`, `.chart-triangle` etc. to confirm they're unused, then delete
- Also look for the duplicate `.counter-chart__grid` definition (one at ~line 613, one at ~line 2220) — the line 613 version is dead

### 2. Remaining Hardcoded rgba() Values (Easy)
- `src/App.css` lines ~458, 466, 474: Quick-build card hover shadows use hardcoded `rgba(220, 100, 80, 0.3)` etc. — should use `--glow-*` or `--stance-*` tokens
- `src/App.css` lines ~959, 963, 967: Variant toggle active box-shadows use hardcoded `rgba()` — should use existing `--glow-*` tokens

### 3. Component Duplication Cleanup (Medium)
- **Counter badge pattern**: Identical "Counters!" / "Countered!" badge rendering in `RevealScreen.tsx` (lines 49-66), `MeleeResult.tsx` (lines 71-87). Extract a `CounterBadges` component into `helpers.tsx`
- **Melee wins tracker**: Identical dot display in `AttackSelect.tsx` (MeleeAttackSelect, lines 143-159) and `MeleeResult.tsx` (lines 37-53). Extract a `MeleeWinsTracker` component
- **JoustAttackSelect vs MeleeAttackSelect**: ~80% identical structure in `AttackSelect.tsx`. Could be unified into a single `AttackSelectScreen` with a `phase` prop, where melee adds the wins tracker

## React Feature Polish

### 4. Keyboard Navigation for Attack Grids (Medium)
- Arrow key navigation between attack cards in `AttackSelect.tsx`
- Cards are in a 2-column CSS grid (`attack-grid`), each with `tabIndex={0}` and `role="button"`
- Currently only Tab navigation works — add Left/Right/Up/Down arrow movement
- Focus management when entering/leaving card grids

### 5. Screen Transition Animations (Low-Medium)
- Fade/slide transitions between game states in `App.tsx`
- Currently each screen has `animation: fadeIn 0.25s` but no exit animation — old screens disappear instantly
- `App.tsx` uses `{screen === 'X' && ...}` conditional rendering (10 screens)
- Consider CSS-only approach with transition classes, or a lightweight `useTransition` wrapper

### 6. Mobile Responsiveness (Low)
- Attack grid, speed grid, loadout screen need responsive breakpoints
- `@media (max-width: 480px)` in `index.css` only handles grid collapse to 1-column
- Touch-friendly card sizes, readable text at small screens
- Loadout screen (589 lines) is the most complex — gear lists, variant toggles, quick-build cards

### 7. App.tsx State Consolidation (Low)
- 14 `useState` calls could be consolidated into `useReducer`
- `handleRematch` resets 14 variables individually — a reducer with `RESET` action would be cleaner
- AI choice computation happens inline in handlers — could be extracted

## Operator Dashboard (Optional)

### 8. Multi-Project Dashboard (Medium-Large)
- Project selector in nav or sidebar
- Filter all views by project
- Project-specific cost summaries

### 9. Better Toast Integration (Low)
- Show toasts for chain restart, git push, abort, all API actions

### 10. Report Auto-Refresh (Low)
- Poll for new reports after orchestrator runs

## Reference
- Handoff: `docs/archive/handoff-s87.md`
- Previous handoff: `docs/archive/handoff-s86.md`
- Design reference: `memory/web-design.md` (29 sections)
- Operator plan: `docs/operator-plan.md`
- Current test count: 1430 tests, 24 suites (all passing)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
