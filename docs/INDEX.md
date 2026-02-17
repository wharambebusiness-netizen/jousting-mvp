# Doc Index

Quick reference for finding the right documentation. Use `node docs/find-docs.mjs "<topic>"` to search.

| Topic | File | Lines | When to read |
|-------|------|-------|--------------|
| Orchestrator architecture | [docs/orchestrator.md](orchestrator.md) | ~220 | Working on orchestrator, missions, agents |
| Game engine & combat | [docs/engine-guide.md](engine-guide.md) | ~170 | Working on game engine, combat system |
| Balance data & win rates | [docs/balance-reference.md](balance-reference.md) | ~110 | Balance tuning, sim analysis |
| Gear system | [docs/gear-system.md](gear-system.md) | ~80 | Gear-related changes, loadouts |
| API signatures | [docs/api-reference.md](api-reference.md) | ~90 | Need function signatures, usage examples |
| Troubleshooting | [docs/troubleshooting.md](troubleshooting.md) | ~15 | Debugging unexpected behavior |
| Operator plan (M2-M6) | [docs/operator-plan.md](operator-plan.md) | ~370 | Working on operator system, auto-continuation |
| Session history | [docs/session-history.md](session-history.md) | ~70 | Understanding past work, decisions |
| Game spec (v4.1) | [docs/joust-melee-v4.1.md](joust-melee-v4.1.md) | ~865 | Canonical game design spec |

## Source Files Quick Reference

| File | Purpose |
|------|---------|
| `src/engine/types.ts` | Core type definitions |
| `src/engine/archetypes.ts` | 6 archetypes with base stats |
| `src/engine/attacks.ts` | 12 attacks, 3 speeds, counter tables |
| `src/engine/balance-config.ts` | ALL tuning constants (single source of truth) |
| `src/engine/calculator.ts` | Core math (softCap, fatigue, impact, accuracy) |
| `src/engine/phase-joust.ts` | Joust pass resolution |
| `src/engine/phase-melee.ts` | Melee round resolution |
| `src/engine/match.ts` | State machine (createMatch, submit*) |
| `src/engine/gigling-gear.ts` | 6-slot steed gear |
| `src/engine/player-gear.ts` | 6-slot player gear |
| `src/engine/gear-variants.ts` | 36 gear variant definitions |
| `src/ai/basic-ai.ts` | AI opponent |
| `src/tools/simulate.ts` | Balance simulation CLI |
| `src/tools/param-search.ts` | Parameter search framework |
