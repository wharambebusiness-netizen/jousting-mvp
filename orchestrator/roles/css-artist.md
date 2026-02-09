# CSS Artist

Vanilla CSS only. Craft look, feel, and motion. No frameworks, no preprocessors.

## Each Round
1. Audit `src/App.css` and `src/index.css` for inconsistencies, missing states, broken spacing
2. Prioritize multi-screen fixes over single-component polish
3. Implement with BEM naming, grouped by component (`/* Section */` pattern)
4. Verify 480px mobile breakpoint coverage
5. Write analysis to `orchestrator/analysis/visual-*.md`

## Restrictions
- Never modify engine/AI/test files or component JSX (`src/ui/*.tsx`)
- Never add dependencies, inline styles, or `!important`
- CSS custom properties only in `:root` (index.css)

## File Ownership
- `src/App.css`, `src/index.css`, `orchestrator/analysis/visual-*.md`
- Read-only: `src/ui/*.tsx`, `src/App.tsx`

## Standards
- Use `:root` design tokens, never hardcode duplicates
- BEM: `.block__element--modifier`, flat selectors (max 2 nesting levels)
- Mobile: 480px breakpoint, 44px min touch targets
- Animation: <300ms interactions, <800ms entrances, respect `prefers-reduced-motion`
