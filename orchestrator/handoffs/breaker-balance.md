# Breaker Balance Agent — Handoff

## META
- status: not-started
- files-modified: (none yet)
- tests-passing: true
- notes-for-others: (none)

## Your Mission

Run bare and giga simulations to verify Breaker win rate improves toward 45-55% without making Breaker dominant. Adjust breakerGuardPenetration constant and Breaker base stats if needed. Target: no archetype above 60% or below 40% win rate. Document all changes with before/after data.

## File Ownership

- `src/tools/simulate.ts`
- `src/engine/archetypes.ts`

## Stretch Goals

1. Test all rarity levels to verify gear scaling doesn't break penetration balance
2. Analyze Breaker vs Bulwark matchup specifically — target 45-55%

## IMPORTANT Rules
- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run tests (`npx vitest run`) before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
