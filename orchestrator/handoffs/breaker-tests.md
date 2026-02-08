# Breaker Test Agent — Handoff

## META
- status: not-started
- files-modified: (none yet)
- tests-passing: true
- notes-for-others: (none)

## Your Mission

Write comprehensive tests for the guard penetration mechanic: verify Breaker ignores correct % of guard, verify non-Breaker archetypes are unaffected, verify penetration works in both joust and melee phases, verify interaction with softCap and fatigue, test edge cases (0% penetration, 100% penetration, 0 guard).

## File Ownership

- `src/engine/calculator.test.ts`
- `src/engine/playtest.test.ts`
- `src/engine/caparison.test.ts`

## Stretch Goals

1. Property-based tests: Breaker impact always >= non-Breaker impact against same guard
2. Performance regression test with penetration mechanic

## IMPORTANT Rules
- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run tests (`npx vitest run`) before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
