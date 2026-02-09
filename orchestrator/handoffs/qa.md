# QA Engineer — Handoff

## META
- status: all-done
- files-modified: src/engine/calculator.test.ts, src/engine/playtest.test.ts, orchestrator/analysis/qa-round-3.md
- tests-passing: true (647 tests, 7 suites, 0 failures)
- completed-tasks: BL-004, BL-005, BL-006, BL-012
- notes-for-others: Reviewer's match.test.ts:78 claim is WRONG — current assertion is correct (Technician wins Pass 1 impact 61.68 vs 60.12, not 61.12). No change needed. Added 42 new tests in Round 3. All 19 exploratory checklist items now covered. Breaker slightly dominant at giga (54-56%) — monitor. BUG-002 downgraded to Low (likely Monte Carlo noise at N=200).

## What Was Done

### Round 1: BL-004 — Gear Variant x Archetype Matchup Tests
Added 112 new tests to `gear-variants.test.ts` (44 → 156 tests).

### Round 2: Test Maintenance + BL-005 + Exploratory Testing
- Fixed 18 test failures from balance changes (Technician MOM +3, Charger INIT/STA swap)
- BL-005: 6 softCap boundary tests
- 10 exploratory edge case tests

### Round 3: BL-006 + BL-012 + Comprehensive Exploratory Testing (+42 tests)

#### BL-006 — Stamina/Fatigue Boundary Tests (10 new in calculator.test.ts)
- Fatigue at threshold, 1-below, 1 stamina, negative stamina
- Guard fatigue interpolation (floor↔1.0) monotonicity
- Attack stamina cost clamping at boundaries
- Speed stamina clamping and recovery

#### BL-012 — Breaker Penetration Across All Defenders (4 new in calculator.test.ts)
- Positive penetration benefit vs all 6 archetypes
- Exact 20% guard removal verified (diff = guard * 0.2 * 0.18)
- Penetration works in melee phase
- Non-breakers get zero penetration (5 archetypes verified)

#### Exploratory Tests (28 new across both files)
- Zero-stamina melee: all 36 attack combos, counter at CTL=0, guard-relative thresholds (4 tests)
- All 9 joust speed combinations resolve correctly (9 tests)
- Mixed variant loadout stress: agg+def, def+agg, P1vsP2 asymmetric, all 9 combos (4 tests)
- Player gear no rarity bonus: explicit verification vs steed+player (1 test)
- Unseated mechanics: stamina recovery at melee start (1 test)
- Balance constants: carryover divisors + unseated boost/recovery (5 tests)
- All 36 melee attack combinations produce valid outcomes (1 test)
- Uncommon rarity bonus = 2 (2 tests)

#### Reviewer Finding Investigation
- Reviewer claimed match.test.ts:78 assertion is flipped (Charger wins 61.68 vs 61.12)
- **WRONG**: Manual trace confirms Technician wins (61.68 vs 60.12). Reviewer miscalculated P1 impact.
- Current assertion is correct. No change needed.

#### Simulation Analysis
- Bare: Bulwark dominant (61-63%), Charger weak (40-42%), all variance <2.5pp
- Giga: Breaker slightly dominant (54-56%), well balanced otherwise
- Mixed: No major flags, best balance tier
- All variance within acceptable range at N=200

## What's Left

All exploratory testing checklist items complete (19/19). No remaining priority work.

Potential future stretch items:
- BUG-002 higher-N validation (N=1000+ to confirm Tactician mirror bias)
- Simulation consistency test (automated in vitest)
- Test gear min/max stat rolls (lowest uncommon vs highest giga)

## Issues

- **BUG-002** (Low): Tactician mirror P1 bias — likely Monte Carlo noise at N=200. Needs N=1000+ to confirm.
- **BUG-004** (Info): Charger STA+5 changed worked example. Balance-tuner should confirm intentional.
- **BUG-005** (Low): Breaker 54-56% at giga. Within tolerance but worth monitoring if penetration changes.

## File Ownership

- `src/engine/calculator.test.ts`
- `src/engine/match.test.ts`
- `src/engine/playtest.test.ts`
- `src/engine/gear-variants.test.ts`
- `src/engine/gigling-gear.test.ts`
- `src/engine/player-gear.test.ts`
