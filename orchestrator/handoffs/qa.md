# QA Engineer — Handoff

## META
- status: complete
- files-modified: src/engine/calculator.test.ts, src/engine/match.test.ts, src/engine/gigling-gear.test.ts, src/engine/playtest.test.ts, orchestrator/analysis/qa-round-2.md
- tests-passing: true (605 tests, 7 suites, 0 failures)
- completed-tasks: BL-004, BL-005
- notes-for-others: Fixed 18 test failures from two balance changes: (1) Technician MOM 55→58, (2) Charger INIT 60→55 / STA 60→65. Added 16 new tests (6 softCap boundary + 10 exploratory). Charger STA+5 causes worked example to end in unseat at Pass 2 instead of 5-pass joust — verify this is intentional. BUG-002 (Tactician P1 bias) still open.

## What Was Done

### Round 1: BL-004 — Gear Variant x Archetype Matchup Tests
Added 112 new tests to `gear-variants.test.ts` (44 → 156 tests).

### Round 2: Test Maintenance + BL-005 + Exploratory Testing

#### 1. Fixed 18 test failures from balance changes
- **7 from Technician MOM 55→58**: Updated MOM-derived values in calculator.test.ts worked examples (4 tests), flipped Pass 1 directional assertions in resolvePass integration (2 tests) and match worked example (1 test)
- **11 from Charger INIT 60→55 / STA 60→65**: Updated fatigue thresholds, stamina flow, INIT values across calculator.test.ts (5 tests), gigling-gear.test.ts (2 tests), match.test.ts (3 tests), playtest.test.ts (2 tests). Rewrote match worked example — now a 2-pass unseat scenario instead of 3-pass joust.

#### 2. BL-005 — SoftCap Boundary Tests (6 new tests)
- Stat at knee, 1 above, 1 below
- Bulwark GRD at giga crossing knee
- Formula verification at 7 excess values
- Stamina NOT soft-capped verification

#### 3. Exploratory Edge Cases (10 new tests)
- Zero stamina: fatigue=0, guard at floor, negative stamina clamping
- Counter symmetry with equal CTL
- Balance constant verification (unseated boost, recovery, carryover divisors)
- All archetype stat totals in 290-300

#### 4. Simulation Analysis
- Bare mode: Bulwark dominant (60-63%), Charger weak (37-41%), Charger has 4.3pp variance
- Giga mode: Well balanced (44-53%), only Charger weak
- Mixed mode: Bulwark dominant (56%), Technician weak (46%)

## What's Left

### Next focus areas (in priority order):
1. Zero-stamina melee round resolution
2. Breaker 20% guard penetration across all defenders
3. Mixed variant loadout stress tests
4. All melee attack speed combinations
5. 100+ match stress test timing
6. Player gear rarity bonus verification (explicit test)

## Issues

- **BUG-002** (Medium): Tactician mirror match P1 bias (~36% vs 64%) — needs higher sample to confirm if real or Monte Carlo noise
- **BUG-004** (Info): Charger's STA+5 fundamentally changed the worked example narrative (Charger now unseats in Pass 2). Balance-tuner should verify this is the intended behavior.
- **Concurrent modification**: Balance-tuner modified archetypes.ts during QA test runs, causing transient failures. Coordination improvement needed.

## File Ownership

- `src/engine/calculator.test.ts`
- `src/engine/match.test.ts`
- `src/engine/playtest.test.ts`
- `src/engine/gear-variants.test.ts`
- `src/engine/gigling-gear.test.ts`
- `src/engine/player-gear.test.ts`
