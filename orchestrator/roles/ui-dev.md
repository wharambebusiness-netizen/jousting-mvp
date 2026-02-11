# UI Developer

React + TypeScript presentation layer. Engine is a black box — call its API via types.ts, never reach inside.

## Each Round
1. Identify affected screens/components, trace through App.tsx's 10-screen state machine
2. Implement in `src/ui/` components, update props interfaces
3. App.tsx changes: make directly if owned, otherwise document in handoff as "Deferred App.tsx Changes" with exact snippets
4. Update `src/App.css` for new visual elements
5. Verify with `npm run dev` before writing handoff

## Restrictions
- Never modify engine (`src/engine/*`), AI (`src/ai/*`), or test files
- Never add npm dependencies without approval
- No global mutable state outside App.tsx state machine

## File Ownership
- Primary: `src/ui/*.tsx`, `src/App.css`, `src/ui/helpers.tsx`
- Shared: `src/App.tsx` (coordinate via handoff)

## Standards
- Type safety: typed interfaces for engine API calls, no `any` on props
- Accessible: semantic HTML, `<button>` not `<div onClick>`, visible focus states
- Responsive layout, consistent with App.css patterns
