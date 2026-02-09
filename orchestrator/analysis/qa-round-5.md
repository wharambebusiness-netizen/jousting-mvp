# QA Round 5 — Analysis Report

## Summary
- Tests: 649 passing (647 → 649, +2 new)
- New tests: BL-019 Tactician mirror P1 bias (2 tests)
- Stale comments fixed: 2 (BL-012 reviewer finding)
- BL-021 guardImpactCoeff mapping complete
- No engine changes detected in final state (balance-tuner reverted exploratory changes)

## BL-019: Tactician Mirror P1 Bias — CLOSED (Monte Carlo Noise)

### Investigation
Added 2 targeted tests to `playtest.test.ts`:
1. **Tactician mirror N=500**: P1 win rate must be 40-60%
2. **All 6 archetype mirrors N=500**: P1 win rate must be 35-65%

### Results
All mirrors pass within expected bands. Simulation results confirm:

| Archetype | Bare P1% | Uncommon P1% | Giga P1% |
|-----------|----------|-------------|----------|
| charger | 50.5% | 50.5% | 50.0% |
| technician | 47.0% | 50.0% | 48.5% |
| bulwark | 45.5% | 43.5% | 43.5% |
| tactician | 55.5% | 46.5% | 55.5% |
| breaker | 47.0% | 52.0% | 46.0% |
| duelist | 52.5% | 47.5% | 48.0% |

**Verdict**: BUG-002 was Monte Carlo noise at N=200. All P1 rates within expected variance. The deterministic seeded test at N=500 passes consistently. No engine fix needed.

### Note on Bulwark Mirror Bias
Bulwark shows the most consistent P1 bias toward P2 (43.5-45.5% P1 across tiers). This is a minor structural asymmetry from the attack cycling pattern interacting with Bulwark's high GRD. Not actionable at current levels but worth monitoring if GRD changes.

## BL-021: guardImpactCoeff Test Assertion Mapping — COMPLETE

### Hardcoded Assertions (WILL BREAK if guardImpactCoeff changes)

| Line | File | Assertion | Current Value | Formula |
|------|------|-----------|---------------|---------|
| 561 | calculator.test.ts | `toBe(57.5)` | 57.5 | 55*0.5 + 97.5*0.4 - 50*0.18 |
| 563 | calculator.test.ts | `toBe(57.8)` | 57.8 | 110*0.5 + 36.25*0.4 - 65*0.18 |
| 1365 | calculator.test.ts | `toBe(42.8)` | 42.8 | 60*0.5 + 50*0.4 - 40*0.18 |
| 1370 | calculator.test.ts | `toBeCloseTo(45.32)` | 45.32 | 60*0.5 + 50*0.4 - 26*0.18 |
| 1406 | calculator.test.ts | `toBe(1.3)` | 1.3 | r(20*0.35*0.18, 1) |
| 1407 | calculator.test.ts | `toBe(5.0)` | 5.0 | r(80*0.35*0.18, 1) |

### Test Name to Update
| Line | Current | Change To |
|------|---------|-----------|
| 559 | `'ImpactScore uses guardImpactCoeff (0.18)'` | Update version number |

### Stale Comments (cosmetic only, no test failure)
Lines: 560, 562, 1363, 1368, 1400, 1402

### Dynamic Assertions (SAFE — won't break)
Lines: 1618, 1655, 1673 — all use `BALANCE.guardImpactCoeff` at runtime

### Update Recipe
When guardImpactCoeff changes from 0.18 to X:
1. Line 559: Update test name to `(X)`
2. Line 561: `toBe(55*0.5 + 97.5*0.4 - 50*X)`
3. Line 563: `toBe(110*0.5 + 36.25*0.4 - 65*X)`
4. Line 1365: `toBe(60*0.5 + 50*0.4 - 40*X)`
5. Line 1370: `toBeCloseTo(60*0.5 + 50*0.4 - 26*X)`
6. Line 1406: `toBe(r(20*0.35*X, 1))`
7. Line 1407: `toBe(r(80*0.35*X, 1))`
8. Update 6 comment lines with new coefficient

**Total: 6 assertion changes + 1 test name + 7 comment updates. All in calculator.test.ts.**

## Stale Comment Fixes (Reviewer Finding)

Fixed 2 stale BL-012 comments in calculator.test.ts:
1. **Line 1616**: Changed `opponent_guard * 0.20 * 0.18` → dynamic reference `breakerGuardPenetration * guardImpactCoeff`
2. **Line 1643**: Changed test name from `Breaker penetration 0.20 removes exactly 20%...` to `Breaker penetration removes guardPenetration%...`

These comments referenced outdated values (guardPenetration was 0.20, now 0.25; guardImpactCoeff was 0.18, could change).

## Simulation Consistency Check

| Metric | Bare | Uncommon | Giga |
|--------|------|----------|------|
| Spread | 19.4pp | 21.4pp | 7.5pp |
| Dominant | Bulwark 60.7% | Bulwark 62.4% | None |
| Weak | Charger 41.3% | Charger 41.0% | None |
| Flags | 2 matchup skews | 4 matchup skews | 0 |

**Consistent with Round 3-4 findings**: Bulwark dominance at bare/uncommon, good balance at giga. No regressions.

## Balance-Tuner Observation

During this round, the balance-tuner was exploring changes to `guardImpactCoeff` (0.18→0.16) and Bulwark stats (MOM 55→58, CTL 55→52). These changes were applied temporarily and then reverted. This caused transient test failures during the initial test run but all changes were reverted before handoff. No permanent engine changes in this round.

## Bugs Tracked

| Bug | Severity | Status | Owner |
|-----|----------|--------|-------|
| BUG-002 | Low→Closed | Monte Carlo noise confirmed at N=500 | QA |
| BUG-004 | Info | Open | balance-tuner |
| BUG-005 | Low | Monitoring | balance-tuner |
