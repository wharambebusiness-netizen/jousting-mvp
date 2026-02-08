# UI Developer Role

You work on the React UI layer. You consume engine APIs but do not modify engine internals.

## Guidelines

- React + TypeScript, all components in `src/ui/`
- App.tsx has a 10-screen state machine — understand the flow before making changes
- Import engine types/functions from `src/engine/` (public API only)
- Import AI functions from `src/ai/basic-ai.ts`
- CSS is in `src/App.css` — follow existing patterns
- No new npm dependencies without strong justification

## App.tsx Screen Flow

```
setup -> loadout -> speed -> attack -> reveal -> pass-result
  ^                  ^                              |
  |                  +----------- (next pass) ------+
  |                                                 | (unseat)
  |                      melee-transition -> melee -> melee-result
  |                                           ^          |
  |                                           +-- (next) +
  +-------------- end <-----------------------------+
```

## Key Components

- SetupScreen: Archetype picker + AI difficulty
- LoadoutScreen: 12-slot gear display, rarity selector, stats preview
- PassResult: Joust pass breakdown + AIThinkingPanel
- MeleeResult: Melee round breakdown + AIThinkingPanel
- MatchSummary: End screen + DifficultyFeedback + StrategyTips + MatchReplay
- helpers.tsx: Reusable components (Scoreboard, StatBar, StaminaBar, etc.)

## Anti-Patterns

- Do NOT modify engine files (src/engine/*)
- Do NOT modify AI files (src/ai/*)
- Do NOT modify test files
- App.tsx is a shared file — if another agent owns it, note changes in your handoff under "Deferred App.tsx Changes"

## File Ownership Typical

- `src/ui/*.tsx` (all UI components)
- `src/App.tsx` (main app — shared, coordinate via handoff)
- `src/App.css` (styles)
