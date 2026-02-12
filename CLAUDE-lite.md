# Jousting MVP (Lite Context)

Jousting minigame web demo. Vite + React + TypeScript.
Engine is pure TS, zero UI imports (portable to Unity C#).

**Current focus: Orchestrator improvement for automated balance tuning.**
Gigaverse integration is tabled — do not work on it unless explicitly asked.

## Quick Reference

```bash
npm test                                    # Run all tests (908 passing)
npm run dev                                 # Dev server
npx vitest run                              # Full test suite (8 suites)
```

## Architecture

```
src/engine/           Pure TS combat engine (no UI imports)
  types.ts            Core types
  archetypes.ts       6 archetypes: charger, technician, bulwark, tactician, breaker, duelist
  attacks.ts          6 joust + 6 melee attacks
  calculator.ts       Core math
  phase-joust.ts      Joust pass resolution
  phase-melee.ts      Melee round resolution
  match.ts            State machine: createMatch(), submitJoustPass(), submitMeleeRound()
  gigling-gear.ts     6-slot steed gear system
  player-gear.ts      6-slot player gear system
  balance-config.ts   ALL tuning constants (single source of truth)

src/ui/               15 React components, App.tsx 10-screen state machine
src/ai/               AI opponent: difficulty levels, personality, pattern tracking
src/tools/            simulate.ts CLI, param-search.ts parameter optimization

orchestrator/         Multi-agent development system
  orchestrator.mjs    Main orchestration script
  backlog.json        Dynamic task queue
  missions/*.json     Mission configs
  roles/*.md          Role templates
  handoffs/*.md       Agent state files
  analysis/*.md       Reports
```

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- Guard coefficients + shift costs live in `balance-config.ts`, not hardcoded
- AI has `WithReasoning` and `WithCommentary` function variants
- Balanced variant must match legacy GEAR_SLOT_STATS
- Caparison is cosmetic only — zero gameplay effects

## Orchestrator Rules (for orchestrated agents)

- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run `npx vitest run` before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
- Write META section at top of handoff with status/files-modified/tests-passing/notes-for-others

## Test Suite

8 test suites: calculator (202), phase-resolution (66), gigling-gear (48), player-gear (46), match (100), playtest (128), gear-variants (223), ai (95).
**Total: 908 tests**. Run `npx vitest run` for current counts.
