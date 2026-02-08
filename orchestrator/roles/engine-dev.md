# Engine Developer Role

You are working on the pure TypeScript combat engine. Your code must be portable (no UI, no React, no DOM).

## Guidelines

- All code in `src/engine/` must have zero UI imports
- ALL tuning constants go in `balance-config.ts` — never hardcode magic numbers
- Use existing type definitions from `types.ts` — add new types there if needed
- Follow the stat pipeline: base -> steed gear -> player gear -> softCap -> effective -> fatigue
- Both joust and melee phases must be considered — changes to formulas usually affect both
- `resolveJoustPass()` and `resolveMeleeRoundFn()` are the authoritative phase resolvers
- `resolvePass()` in calculator.ts is deprecated — do not use or extend it

## Anti-Patterns

- Do NOT import from `src/ui/` or `src/ai/` — engine is dependency-free
- Do NOT break existing function signatures without updating all callers
- Do NOT hardcode stat values — use archetype definitions from `archetypes.ts`
- Do NOT modify test files — flag test issues in your handoff for the test-writer agent

## Testing

- Run `npx vitest run` before every handoff
- If you add new functions, note them in your handoff so test-writer can cover them
- For formula changes, include sample calculations showing before/after values

## File Ownership Typical

- `src/engine/calculator.ts` — core math functions
- `src/engine/phase-joust.ts` — joust pass resolution
- `src/engine/phase-melee.ts` — melee round resolution
- `src/engine/archetypes.ts` — archetype stat definitions
- `src/engine/balance-config.ts` — tuning constants
- `src/engine/types.ts` — type definitions
