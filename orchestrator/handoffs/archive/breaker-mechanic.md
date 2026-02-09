# Breaker Mechanic Agent — Handoff

## META
- status: all-done
- files-modified: src/engine/balance-config.ts, src/engine/calculator.ts, src/engine/phase-joust.ts, src/engine/phase-melee.ts
- tests-passing: true
- notes-for-others: Breaker guard penetration is live with combat log output. `calcImpactScore()` has optional 4th param `guardPenetration` (default 0). Combat logs now explicitly show when guard penetration is active (e.g. "Breaker P1: guard penetration 35% — opponent effective guard 65.00 → 42.25"). Test-writer: 11 new tests already added and passing (381 total). Balance agent: run simulation to see updated Breaker win rates.

## What Was Done

### Round 1: Primary Milestone — Breaker Guard Penetration Mechanic

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

**phase-melee.ts** — Applied penetration in `resolveMeleeRoundFn()`
- Same pattern as joust: detects Breaker by `archetype.id`, passes penetration to `calcImpactScore()`.

### Round 2: Stretch Goal — Combat Log Guard Penetration Output

Added explicit guard penetration log entries to all three resolution functions:
- `resolveJoustPass()` in phase-joust.ts
- `resolveMeleeRoundFn()` in phase-melee.ts
- Deprecated `resolvePass()` in calculator.ts

When a Breaker is attacking, the log now shows:
```
Breaker P1: guard penetration 35% — opponent effective guard 65.00 → 42.25
```

This makes the mechanic visible in combat logs for debugging, testing, and future UI display.

### Design Decisions

1. **Detection via `id` field**: Used `archetype.id === 'breaker'` rather than string-matching on `identity`. The `id` field is the canonical unique identifier.

2. **Penetration applies to impact only, not unseat threshold**: Guard still provides full unseat protection (`checkUnseat` uses raw `stats.guard`). Penetration only reduces guard's subtraction from impact score. Breaker hits harder but doesn't bypass unseat resistance.

3. **Optional parameter with default 0**: The `calcImpactScore()` function signature is backward-compatible. No existing call site needed changes.

4. **Both phases covered**: Penetration works in joust and melee.

5. **Log output is conditional**: Only appears when `pen > 0`, so non-Breaker matchups have clean logs.

### Sample Calculations

**Breaker vs Bulwark, Bulwark effective guard = 65:**
- Old: `guardReduction = 65 * 0.2 = 13.0`
- New: `effectiveGuard = 65 * 0.65 = 42.25`, `guardReduction = 42.25 * 0.2 = 8.45`
- **Breaker gains +4.55 impact score per pass/round vs Bulwark**

**Breaker vs Charger, Charger effective guard = 50:**
- Old: `guardReduction = 50 * 0.2 = 10.0`
- New: `effectiveGuard = 50 * 0.65 = 32.5`, `guardReduction = 32.5 * 0.2 = 6.5`
- **Breaker gains +3.5 impact score vs Charger**

The mechanic is proportional to opponent guard — stronger against tanky archetypes, weaker against glass cannons. This correctly positions Breaker as the anti-Bulwark counter.

## What's Left

Nothing. All primary and stretch goals are complete.

### For Test-Writer Agent
The breaker-tests agent already added 11 tests in calculator.test.ts covering:
- `calcImpactScore` with various `guardPenetration` values
- Breaker vs non-Breaker impact differential in `resolvePass`
- Both-Breaker matchup
- Guard level scaling

Additional tests that could be added (optional):
- Verify combat log contains "guard penetration" string when Breaker is involved in `resolveJoustPass`
- Verify combat log does NOT contain "guard penetration" for non-Breaker matchups in `resolveJoustPass`
- Same for `resolveMeleeRoundFn`

### For Balance Agent
- Run simulation (`npx tsx src/tools/simulate.ts bare`) to see updated Breaker win rates
- May need to tune `breakerGuardPenetration` up or down from 0.35 based on results
- Check that Breaker doesn't become dominant (should be anti-tank, not best-at-everything)

## Issues

None. All 381 tests pass. No existing signatures broken. Implementation is minimal and surgical.
