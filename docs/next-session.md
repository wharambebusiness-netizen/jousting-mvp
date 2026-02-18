# Next Session Instructions (S89)

## Context: S88 — React Code Cleanup + Feature Polish

S88 completed all 7 priority tasks:
- Dead CSS removal (189 lines), hardcoded rgba() → design tokens (10 new tokens)
- Component deduplication (CounterBadge, MeleeWinsTracker, unified AttackSelectScreen)
- Keyboard arrow navigation for attack grids
- Screen transition animations (fade-out/fade-in, prefers-reduced-motion)
- 360px ultra-small breakpoint
- App.tsx useReducer consolidation (14 useState → 1 useReducer)
- 1430 tests, 24 suites, all passing

## Remaining React Polish

### 1. Remaining Hardcoded rgba() in App.css (Easy)
- Still ~30 hardcoded `rgba()` values in App.css for various effects
- Most are animation keyframes (`rgba(139, 37, 0, 0)` for box-shadow starts), combat log borders, overlay backgrounds
- Lower priority — many are intentional one-off values for specific animation effects
- Focus on: combat log borders (`rgba(201, 168, 76, ...)` → `--glow-gold-*`), tooltip overlay (`rgba(0,0,0,0.2)`)

### 2. Speed Grid Arrow Navigation (Easy)
- Speed cards in `SpeedSelect.tsx` also use a grid layout (3-column)
- Arrow navigation was only added to attack grids — could extend to speed selection too
- Also consider adding to archetype selection grid

### 3. Reveal Screen Shift Grid Arrow Navigation (Easy)
- The shift attack grid in `RevealScreen.tsx` (line ~100) has 5 cards in a 2-column grid
- Add the same arrow key handler used in `AttackSelectScreen`

### 4. Screen Transition Edge Cases (Low)
- The `transitionTo` approach uses a 150ms setTimeout — if user clicks very fast, state and screen can desync
- Consider adding a `disabled` state during transitions to prevent double-clicks
- The melee-transition screen has its own overlay animation — the screen-exit fade may interfere slightly

### 5. Extract AI Choice Logic from Handlers (Low)
- `handleAttackSelect` and `handleMeleeAttack` compute AI choices inline
- Could extract into pure functions for testability: `computeJoustAIChoice(match, attack, difficulty)` etc.
- Low priority since the logic is simple and well-encapsulated

## Operator Dashboard (Optional)

### 6. Multi-Project Dashboard (Medium-Large)
- Project selector in nav or sidebar
- Filter all views by project
- Project-specific cost summaries

### 7. Better Toast Integration (Low)
- Show toasts for chain restart, git push, abort, all API actions

### 8. Report Auto-Refresh (Low)
- Poll for new reports after orchestrator runs

## Working Style Reminder
- **Use Task subagents aggressively** — spin up agents for parallel research, file exploration, codebase searches, and any work that can run concurrently. Don't do sequentially what agents can do in parallel. Examples: reading multiple files at once, searching for usage patterns across the codebase, investigating dependencies before editing, auditing multiple components simultaneously. Only skip agents for trivial single-file reads or when you already know the exact answer.
- Subagents CANNOT use Write/Bash — they are for research/exploration only. Do all edits yourself in the main context.

## Reference
- Handoff: `docs/archive/handoff-s88.md`
- Previous handoff: `docs/archive/handoff-s87.md`
- Design reference: `memory/web-design.md`
- Current test count: 1430 tests, 24 suites (all passing)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
