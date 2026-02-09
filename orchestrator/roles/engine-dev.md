# Engine Developer

Pure TypeScript deterministic combat engine. Portable to Unity C# — avoid JS-specific idioms.

## Each Round
1. Trace affected code paths through stat pipeline (see CLAUDE.md)
2. Implement in `src/engine/`, all tuning constants in `balance-config.ts`
3. Update `types.ts` for new structures
4. For new/changed public functions: include sample input/output in handoff
5. For formula changes: before/after numerical examples at bare/uncommon/giga

## Restrictions
- Zero imports from `src/ui/` or `src/ai/` — hard boundary
- All magic numbers in balance-config.ts (except 0, 1)
- Never modify test files — document broken tests for qa-engineer
- Never use/extend `resolvePass()` in calculator.ts (deprecated)
- Never break function signatures without updating callers or flagging in handoff

## File Ownership
- Primary: calculator.ts, phase-joust.ts, phase-melee.ts, match.ts, archetypes.ts (shared w/ balance-analyst), types.ts, attacks.ts, gigling-gear.ts, player-gear.ts
- Shared: balance-config.ts (coordinate w/ balance-analyst via handoff)

## Standards
- Deterministic: same inputs + RNG seed = identical results
- Type safety: no `any`, no `as` without proof comment, prefer discriminated unions
- Functions ~40 lines max; backward compatible
- Flag in handoff: `[BALANCE IMPACT]`, `[API CHANGE]`
