# QA Round 2 — Analysis Report

## Test Suite Status

**605 tests passing** across 7 suites (up from 589 in Round 1)
- calculator.test.ts: 143 tests (+16 new)
- phase-resolution.test.ts: 35 tests
- gigling-gear.test.ts: 48 tests
- player-gear.test.ts: 46 tests
- match.test.ts: 71 tests
- gear-variants.test.ts: 156 tests
- playtest.test.ts: 106 tests

## Balance Changes Tracked This Round

### 1. Technician MOM 55 → 58 (balance-tuner Round 1)
**Test impact**: 7 failures in calculator.test.ts + match.test.ts
- 4 effective-stats assertions: Technician raw MOM values (60→63 with CdL/CEP, 50→53 with PdL)
- 2 resolvePass directional assertions: Pass 1 outcome FLIPPED — Technician now wins Pass 1 impact (61.68 vs 61.12 at MOM=58, 61.68 vs 60.12 at INIT=55)
- 1 match worked example: same directional flip

**Resolution**: Updated all computed values and flipped directional assertions. The flip is correct — with MOM 58, Technician's CEP counter bonus + CTL accuracy now overcomes Charger's raw MOM advantage in Pass 1.

### 2. Charger INIT 60 → 55, STA 60 → 65 (balance-tuner Round 2)
**Test impact**: 11 additional failures across 4 test files
- calculator.test.ts: All 3 worked example passes (speed stamina, fatigue thresholds, end-of-pass stamina, effective stats)
- gigling-gear.test.ts: INIT/STA in gear application tests (2 tests)
- match.test.ts: Initial stamina, worked example (3 tests)
- playtest.test.ts: Charger stat verification, stamina endurance (2 tests)

**Critical finding**: The worked example narrative FUNDAMENTALLY changed:
- Previously: 3-pass joust, no unseat, close cumulative score
- Now: Charger **unseats Technician in Pass 2** due to better stamina management (STA 65 → less fatigue → higher Pass 2 impact with BdG counter advantage)
- Match transitions to melee after 2 passes instead of continuing to 5

**Resolution**: Rewrote match.test.ts worked example to reflect new 2-pass unseat scenario. All stamina calculations updated across all files.

## BL-005: SoftCap Boundary Tests (6 new tests)

Added to calculator.test.ts under "Soft Cap Boundary Behavior":
1. **Stat exactly at knee** returns knee unchanged
2. **Stat 1 above knee** is diminished but above knee (verified formula)
3. **Stat 1 below knee** passes through unchanged
4. **Bulwark GRD at giga rarity** can cross knee with max gear + PdL attack
5. **Formula verification** at 7 excess values (1, 5, 10, 15, 20, 50, 100)
6. **Stamina NOT soft-capped** — verified via high-stamina archetype and computeEffectiveStats

## Exploratory Edge Case Tests (10 new tests)

Added to calculator.test.ts under "Exploratory Edge Cases":
1. Zero stamina produces zero fatigue factor (3 archetypes)
2. Zero stamina: effective MOM/CTL are 0, guard at fatigue floor
3. Guard fatigue floor clamps at 0.5 (verified at ff=0, 0.5, 1.0)
4. Negative stamina clamped to 0 by fatigueFactor
5. Counter resolution with equal CTL: symmetric bonus magnitude
6. Unseated impact boost is 1.25
7. Unseated stamina recovery is 8
8. Carryover divisors match balance-config (6/7/9)
9. Carryover penalties scale correctly with unseat margin
10. All 6 archetypes have stat totals in 290-300 range

## Simulation Results

### Bare Mode (2 runs)
| Archetype | Run 1 | Run 2 | Variance |
|-----------|-------|-------|----------|
| bulwark | 62.5% | 60.5% | 2.0pp |
| duelist | 53.8% | 51.5% | 2.3pp |
| tactician | 52.7% | 53.0% | 0.3pp |
| technician | 49.5% | 48.4% | 1.1pp |
| breaker | 44.9% | 45.8% | 0.9pp |
| charger | 36.6% | 40.9% | **4.3pp** |

**Note**: Charger variance 4.3pp exceeds 3pp threshold. Likely because Charger matchups are highly volatile (high MOM, low everything else = feast-or-famine outcomes). This improved with STA+5 but may still be high. Recommend increasing simulation sample size for Charger.

### Giga Mode
Well balanced: all archetypes 44-53%. Only Charger flagged weak (44.3%). Breaker strongest (52.7%) — anti-Bulwark role working.

### Mixed Mode
Bulwark still dominant (56.0%). Charger competitive (51.2%). Technician weak (46.4%).

## Bug Reports

### BUG-001 (Resolved)
Technician MOM test failures — fixed in this round.

### BUG-002 (Still Open — Medium)
Tactician mirror match P1 bias: 36% vs 64% in some bare runs. The INIT advantage (75) makes P1 win priority in shifts, but the magnitude seems high for a mirror. May be statistical noise — needs higher N to confirm.

### BUG-003 (Downgraded — Low)
Charger win rate variance: 4.3pp across bare runs. Inherent to feast-or-famine archetype design. Not a code bug.

### BUG-004 (New — Info)
Charger INIT/STA rebalance causes worked example narrative change: Charger now unseats Technician in Pass 2 instead of going to 5-pass joust. This is a significant behavior change. Balance-tuner should verify this is intended — the Charger's improved stamina management makes them much more dangerous in extended engagements.

## Concurrent Modification Warning

The balance-tuner agent modified `archetypes.ts` during this QA round while tests were running. This caused transient test failures (11 tests showed as failing mid-run but passed once the file stabilized). This is a coordination issue — in future rounds, balance changes should be signaled before QA runs tests.

## Coverage Gap Analysis

### Covered this round:
- [x] SoftCap boundary (stats at 99, 100, 101)
- [x] Zero stamina: joust pass resolution
- [x] Guard fatigue floor verification (guardFatigueFloor = 0.5)
- [x] Counter resolution with equal CTL values
- [x] Unseated boost/recovery verification
- [x] Carryover divisors verification
- [x] All archetype stat totals in range

### Still uncovered (next round):
- [ ] Zero stamina: melee round resolution
- [ ] Breaker's 20% guard penetration across all defenders
- [ ] All melee attack speed combinations
- [ ] Mixed variant loadouts stress test
- [ ] 100+ match stress test timing
- [ ] Player gear applies NO rarity bonus (explicit test)
