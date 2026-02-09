# QA Engineer — Handoff

## META
- status: all-done
- files-modified: src/engine/calculator.test.ts, src/engine/match.test.ts, orchestrator/analysis/qa-round-8.md
- tests-passing: true (685 tests, 7 suites, 0 failures)
- completed-tasks: BL-004, BL-005, BL-006, BL-012, BL-019, BL-021, BL-023, BL-026
- notes-for-others: Round 8 added 18 tests: 13 counter table exhaustive verification (joust+melee) + 5 carryover/unseated worked example. 6-run sim sweep confirms stable balance (all variance <3pp). Exploratory checklist now 100% complete. Reviewer: update CLAUDE.md test count 655→685, calculator.test.ts 171→184, match.test.ts 77→88.

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
- Exact 25% guard removal verified
- Penetration works in melee phase
- Non-breakers get zero penetration (5 archetypes verified)

#### Exploratory Tests (28 new across both files)
- Zero-stamina melee, joust speed combos, mixed variant stress, player gear no rarity bonus
- Unseated mechanics, balance constants, uncommon rarity bonus

### Round 4: No new tests (was all-done)

### Round 5: BL-019 + BL-021 + Stale Comment Fixes (+2 tests)

#### BL-019 — Tactician Mirror P1 Bias (2 new in playtest.test.ts)
- Tactician mirror N=500 with seeded-random attack selection: P1 rate 40-60%
- All 6 archetype mirrors N=500: P1 rate 35-65%
- BUG-002 CLOSED: Confirmed Monte Carlo noise. All mirrors within expected variance at N=500.

#### BL-021 — guardImpactCoeff Test Assertion Mapping (analysis only)
Mapped all guardImpactCoeff-dependent assertions across all test files:
- **6 hardcoded assertions** will break if coefficient changes (lines 561, 563, 1365, 1370, 1406, 1407)
- **1 test name** references "(0.18)" (line 559)
- **7 comments** reference 0.18 (cosmetic)
- **3 dynamic assertions** use BALANCE.guardImpactCoeff (safe)
- Full update recipe in orchestrator/analysis/qa-round-5.md

#### Stale BL-012 Comment Fixes (2 in calculator.test.ts)
- Line 1616: Updated comment from `0.20 * 0.18` to dynamic reference
- Line 1643: Updated test name from `0.20` to `guardPenetration%`

### Round 6: BL-023 + BL-026 + Simulation Check (+6 tests)

#### BL-023 — Multi-Pass Worked Example (6 new in match.test.ts)
Full deterministic trace of Tactician vs Duelist at bare, Standard+CdL every pass:
- **Test 1**: Completes all 5 passes without unseat
- **Test 2**: Pass 1 — no fatigue, exact effective stats, accuracy (101.25 vs 90), impact (58.80 vs 58.60)
- **Test 3**: Pass 2 — still above fatigue threshold, identical to Pass 1, cumulative 117.60 vs 117.20
- **Test 4**: Pass 3 — fatigue kicks in (P1 ff=35/44, P2 ff=40/48), Duelist overtakes
- **Test 5**: Passes 4-5 — deepening fatigue, Duelist (P2) wins on cumulative score, final stamina 5/10
- **Test 6**: Impact monotonically decreasing, passes 1-2 identical, pass 3 strictly lower

#### BL-026 — Stale Comment Fixes + Bulwark Cascade Verification
1. **phase-resolution.test.ts:421-425** — Fixed stale comment referencing hardcoded `0.35` and `0.2` (should reference BALANCE constants)
2. **calculator.test.ts:805** — Updated Giga Bulwark test archetype: `momentum: 68, control: 68` → `momentum: 71, control: 65` (reflects BL-025)
3. **Cascade verification**: BL-025 (Bulwark MOM→58, CTL→52) confirmed ZERO test breakages. MOM/CTL are not test-locked for Bulwark.

### Round 7: Melee Worked Example + Gear Boundary Tests + Sim Sweep (+12 tests)

#### Melee Worked Example (6 new in match.test.ts)
Full deterministic trace of Duelist vs Duelist melee, P1=MC vs P2=OC, 3 rounds:
- **Test 1**: Completes in exactly 3 rounds, P1 wins by Critical (meleeWins=4: 1+1+2)
- **Test 2**: Round 1 — no fatigue, MC beats OC counter (bonus=11), impact 59.0 vs 49.4, Hit, STA 50/42
- **Test 3**: Round 2 — P2 fatigued (ff=0.875), gap widens, impact 60.62 vs 41.9, Hit, STA 40/24
- **Test 4**: Round 3 — deep fatigue (P2 ff=0.5), margin=33.0, Critical, melee ends, STA 30/6
- **Test 5**: Impact escalation — P1 impact rises R1→R2 (opponent guard fatigues), falls R2→R3 (own fatigue)
- **Test 6**: Stamina drain tracking — MC costs 10/round, OC costs 18/round, all values exact

#### Gear Extreme Boundary Tests (6 new in playtest.test.ts)
- Lowest uncommon vs highest giga: match completes, giga player dominates
- All-min gear: stamina never goes negative across 5 Fast+CF passes
- All-max giga gear: stats above softCap knee produce valid positive impact scores
- Min vs max differential: giga gap exceeds uncommon gap
- All 6 rarities: max-roll gear always beats min-roll in impact
- Max giga melee: Breaker vs Bulwark completes within 20 rounds

#### Simulation 5-Tier Sweep (Post BL-025)
| Tier | Top | Rate | Spread | Bottom | Rate | Flags |
|------|-----|------|--------|--------|------|-------|
| bare | Bulwark | 60.4% | 20.1pp | Charger | 40.3% | DOMINANT, WEAK |
| uncommon | Bulwark | 58.3% avg | 15.5pp avg | Charger | 43.5% avg | DOMINANT, WEAK |
| rare | Bulwark | 55.2% | 10.6pp | Tactician | 44.6% | DOMINANT, WEAK |
| epic | Charger | 55.7% | 10.3pp | Technician | 45.4% | DOMINANT |
| giga | Breaker | 53.9% | 6.8pp | Technician | 47.1% | Clean |

#### BUG-006 CLOSED: Tactician Uncommon
Three-run validation: 54.8%, 53.6%, 54.6% (mean 54.3%). Confirmed noise, not dominance.

### Round 8: Counter Table Verification + Carryover Worked Example + Sim Consistency (+18 tests)

#### Counter Table Exhaustive Verification (13 new in calculator.test.ts)
**Joust (5 tests):** All 36 pairs resolve, no mutual counters, beats/beatenBy consistency, mirror=zero, bonus uses winner CTL only.
**Melee (5 tests):** Same 5 verifications for all 36 melee pairs.
**Edge cases (3 tests):** Negative CTL (-10→bonus=3), very large CTL (150→bonus=19), fractional CTL (post-fatigue→correct fraction).

#### Melee Carryover + Unseated Boost Worked Example (5 new in match.test.ts)
Full deterministic trace: Technician (unseated, margin=24, carryover -4/-3/-2) vs Charger. P1 MC vs P2 OC.
- **Test 1**: Carryover penalties correctly set from margin 24
- **Test 2**: Round 1 — counter + boost compensates carryover, P1 wins with margin>30
- **Test 3**: Unseated boost persists across multiple rounds
- **Test 4**: Boost overcompensates vs no-carryover baseline
- **Test 5**: Unboosted impact is exactly 1/1.25 of boosted

#### Simulation Consistency (6 runs: bare×2, uncommon×2, giga×2)
All archetype win rates stable across runs. Max variance: 2.5pp (Duelist uncommon). All under 3pp threshold. Giga clean both runs. Balance rankings identical across runs.

## What's Left

All stretch goals completed. Exploratory checklist 100% done. No remaining test gaps identified.

## Issues

- **BUG-002** (Closed): Tactician mirror P1 bias — confirmed Monte Carlo noise at N=500
- **BUG-004** (Info): Charger STA+5 changed worked example. Balance-tuner confirmed intentional.
- **BUG-005** (Low/Monitor): Breaker 53-54% at giga. Stable across all runs, within tolerance.
- **BUG-006** (Closed): Tactician 54.3% at uncommon — confirmed noise across 3 runs.

## File Ownership

- `src/engine/calculator.test.ts`
- `src/engine/match.test.ts`
- `src/engine/playtest.test.ts`
- `src/engine/gear-variants.test.ts`
- `src/engine/gigling-gear.test.ts`
- `src/engine/player-gear.test.ts`
