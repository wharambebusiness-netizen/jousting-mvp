# Troubleshooting

Common mistakes and their fixes when working with the jousting engine.

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Calling `resolvePass()` from calculator.ts | Outdated results, missing breaker/shift logic | Use `resolveJoustPass()` from phase-joust.ts |
| Forgetting `maxStamina` arg in `fatigueFactor()` | Returns `NaN`, all effective stats become `NaN` | Always pass both args: `fatigueFactor(current, max)` |
| Passing player loadout without steed loadout in `createMatch()` | Player loadout interpreted as steed (positional args) | Pass all 6 args, use `undefined` for empty slots |
| Expecting `applyPlayerLoadout()` to add rarity bonus | Stats lower than expected for player gear tier | Rarity bonus is steed-only; player gear adds slot bonuses only |
| Renaming breaker archetype ID | Guard penetration stops working silently | Detection is via `archetype.id === 'breaker'` in phase-joust.ts/phase-melee.ts |
| Assuming Measured Cut beats Guard High | Counter doesn't trigger | One-directional: Guard High beats Measured Cut, not vice versa |
| Expecting uncommon rarity bonus = 1 | Off-by-one in stat calculations | Uncommon bonus is 2 (changed in S25) |
| Soft-capping stamina | Unexpected fatigue behavior | Soft cap applies to MOM/CTL/GRD/INIT only, NOT stamina |
| Expecting Precision Thrust to modify guard | Guard unchanged | Precision Thrust has `deltaGuard = 0` (unique among attacks) |
| Sim numbers don't match docs | Balance data may be stale | Regenerate: `npx tsx src/tools/simulate.ts --summary balanced --matches 1000` |
