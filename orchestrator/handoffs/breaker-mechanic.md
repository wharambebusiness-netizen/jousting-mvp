# Breaker Mechanic Agent — Handoff

## META
- status: complete
- files-modified: src/engine/balance-config.ts, src/engine/calculator.ts, src/engine/phase-joust.ts, src/engine/phase-melee.ts
- tests-passing: true
- notes-for-others: Breaker guard penetration is live. `calcImpactScore()` has a new optional 4th param `guardPenetration` (default 0) — all existing call sites unchanged. Test-writer: new tests needed for `calcImpactScore` with `guardPenetration > 0`, and for Breaker-vs-Bulwark impact differential in both joust and melee phases. Balance agent: run simulation to see updated Breaker win rates — expect significant improvement vs Bulwark.

## What Was Done

### Primary Milestone: Breaker Guard Penetration Mechanic

Implemented a guard penetration mechanic that lets the Breaker archetype ignore 35% of the opponent's effective guard during impact calculation, in both joust and melee phases.

#### Changes by File

**balance-config.ts** — Added `breakerGuardPenetration: 0.35`
- Configurable constant (0-1 range). 0.35 = Breaker ignores 35% of opponent guard.
- Placed in the guard coefficients section alongside `guardImpactCoeff` and `guardUnseatDivisor`.

**calculator.ts** — Modified `calcImpactScore()` signature
- Added optional 4th parameter: `guardPenetration: number = 0`
- Formula: `effectiveGuard = opponentEffGuard * (1 - guardPenetration)`
- Default of 0 preserves all existing behavior — no call sites need updating.
- Also applied penetration in deprecated `resolvePass()` using `archetype.id === 'breaker'`.

**phase-joust.ts** — Applied penetration in `resolveJoustPass()`
- Detects Breaker via `p1State.archetype.id === 'breaker'` (and same for P2).
- Passes `BALANCE.breakerGuardPenetration` to `calcImpactScore()` when attacker is Breaker.
- Added `BALANCE` import from `balance-config.ts`.

**phase-melee.ts** — Applied penetration in `resolveMeleeRoundFn()`
- Same pattern as joust: detects Breaker by `archetype.id`, passes penetration to `calcImpactScore()`.
- Added `BALANCE` import from `balance-config.ts`.

### Design Decisions

1. **Detection via `id` field**: Used `archetype.id === 'breaker'` rather than string-matching on `identity`. The `id` field is the canonical unique identifier and won't change with flavor text updates.

2. **Penetration applies to impact only, not unseat threshold**: Guard still provides full unseat protection (`checkUnseat` uses raw `stats.guard`). Penetration only reduces the guard subtraction from impact score. This means Breaker hits harder but doesn't bypass the defender's unseat resistance.

3. **Optional parameter with default 0**: The `calcImpactScore()` function signature is backward-compatible. No existing call site (tests or production code) needed changes.

4. **Both phases covered**: Penetration works in joust (via `resolveJoustPass`) and melee (via `resolveMeleeRoundFn`), fulfilling the stretch goal.

### Sample Calculations (Before/After)

**Breaker vs Bulwark, Bulwark effective guard = 65:**
- Old: `guardReduction = 65 * 0.2 = 13.0`
- New: `effectiveGuard = 65 * 0.65 = 42.25`, `guardReduction = 42.25 * 0.2 = 8.45`
- **Breaker gains +4.55 impact score per pass/round vs Bulwark**

**Breaker vs Charger, Charger effective guard = 50:**
- Old: `guardReduction = 50 * 0.2 = 10.0`
- New: `effectiveGuard = 50 * 0.65 = 32.5`, `guardReduction = 32.5 * 0.2 = 6.5`
- **Breaker gains +3.5 impact score vs Charger** (smaller boost against low-guard targets)

The mechanic is proportional to opponent guard — stronger against tanky archetypes, weaker against glass cannons. This correctly positions Breaker as the anti-Bulwark counter.

## What's Left

### For Test-Writer Agent
New tests needed:
1. `calcImpactScore` with `guardPenetration > 0` — verify the formula math
2. `calcImpactScore` with `guardPenetration = 0` — verify backward compat (existing tests likely cover this)
3. Breaker vs non-Breaker impact differential in `resolveJoustPass` — verify Breaker gets higher impact against same opponent guard
4. Breaker vs non-Breaker impact differential in `resolveMeleeRoundFn` — same for melee
5. Non-Breaker archetype gets NO penetration bonus — verify penetration = 0 for other archetypes
6. `breakerGuardPenetration` constant exists in `BALANCE` config

### For Balance Agent
- Run simulation (`npx tsx src/tools/simulate.ts bare`) to see updated Breaker win rates
- Expect Breaker win rate to rise significantly, especially vs Bulwark
- May need to tune `breakerGuardPenetration` up or down from 0.35 based on results
- Check that Breaker doesn't become dominant (should be anti-tank, not best-at-everything)

### Stretch Goals Status
1. **Archetype identity field** — Already exists in types.ts (`identity: string`). No changes needed. Detection uses `id` field which is more reliable.
2. **Penetration scaling with MOM** — Not implemented. Current flat penetration is simpler and sufficient. Could be added later if balance needs more nuance.
3. **Melee phase penetration** — Done (primary milestone, not stretch).

## Issues

None. All 370 tests pass. No existing signatures broken. Implementation is minimal and surgical.
