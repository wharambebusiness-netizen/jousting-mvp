# QA Round 3 — Analysis Report

## Test Suite Status
- **Before Round 3**: 605 tests, 7 suites, 0 failures
- **After Round 3**: 647 tests, 7 suites, 0 failures (+42 new tests)
- **Breakdown**:
  - calculator.test.ts: 143 → 171 (+28)
  - playtest.test.ts: 106 → 120 (+14)
  - Other suites: unchanged

## New Test Coverage Added

### BL-006: Stamina/Fatigue Boundary Conditions (10 tests)
- Fatigue factor at exact threshold returns 1.0
- Fatigue 1 below threshold degrades linearly
- Fatigue at 1 stamina is small but positive
- Negative stamina treated as 0
- Threshold is 80% of max for every archetype
- Above-threshold stamina still returns 1.0 (no overcharge)
- Guard fatigue factor interpolates floor↔1.0 monotonically
- Attack stamina cost clamping (CF at 19/20/21, CdL at 9/10/11)
- Speed stamina: Fast at 3 clamps to 0
- Speed stamina: Slow at 0 recovers to 5

### BL-012: Breaker Guard Penetration Across All Defenders (4 tests)
- Breaker always gets positive penetration benefit vs every archetype
- Penetration benefit proportional to defender guard stat
- 20% penetration removes exactly 20% of opponent effective guard (verified: diff = guard * 0.2 * 0.18)
- Breaker penetration applies in melee phase too (verified with manual calc)
- Non-Breaker archetypes get zero guard penetration (5 archetypes verified)

### Zero-Stamina Melee Resolution (4 tests)
- Melee round resolves with both players at 0 stamina (margin=0 → Draw)
- Draw threshold scales with defender guard even at 0 stamina
- All 36 melee attack combinations resolve without error at 0 stamina
- Counter bonus at 0 stamina = base bonus only (CTL=0)

### All Joust Speed Combinations (9 tests)
- All 9 speed pairs (Slow/Standard/Fast x Slow/Standard/Fast) resolve via resolvePass
- Valid impact scores, stamina never negative, unseat values correct

### Mixed Variant Loadout Stress Tests (4 tests)
- Aggressive steed + defensive player gear
- Defensive steed + aggressive player gear
- P1 aggressive vs P2 defensive gear
- All 9 variant combinations (steed x player) for Duelist mirror

### Player Gear No Rarity Bonus Verification (1 test)
- Explicit test: player-only loadout does NOT add rarity bonus
- Both-gear loadout has ≥ 13 more stamina than player-only at giga

### Unseated Mechanics (1 test)
- Unseated player starts melee with ≥ unseatedStaminaRecovery stamina

### Balance Constants Verification (5 tests)
- Carryover divisors: momentum=6, control=7, guard=9
- Unseated impact boost = 1.25
- Unseated stamina recovery = 8

### All Melee Attack Combinations (1 test)
- All 36 melee attack matchups produce valid outcomes at mid-stamina

### Uncommon Rarity Bonus (2 tests)
- Config value is 2 (not 1)
- Uncommon gear adds ≥ +2 to stamina

## Reviewer Finding: match.test.ts:78

The reviewer claimed the assertion at line 78 is "incorrectly flipped" and that Charger still wins Pass 1 impact (61.68 vs 61.12). **Investigation result: the current assertion is CORRECT.**

Manual trace of Pass 1 (Charger Fast+CF vs Technician Standard+CdL→CEP):
- Technician shifts CdL→CEP (cross-stance, -12 STA, -10 INIT)
- CEP counters CF (Technician wins counter, bonus = 12.31)
- P1 (Charger) impact: ~60.12
- P2 (Technician) impact: ~61.68

Technician wins Pass 1 impact. The reviewer's P1 value (61.12) was miscalculated — actual is ~60.12. **No change needed.** The test correctly asserts `p1.player2.impactScore > p1.player1.impactScore`.

## Simulation Analysis (2 runs each)

### Bare Mode
| Archetype | Run 1 | Run 2 | Variance |
|-----------|-------|-------|----------|
| Bulwark | 62.9% | 61.5% | 1.4pp |
| Duelist | 52.3% | 52.7% | 0.4pp |
| Tactician | 50.8% | 51.3% | 0.5pp |
| Technician | 47.3% | 47.6% | 0.3pp |
| Breaker | 46.3% | 45.1% | 1.2pp |
| Charger | 40.5% | 41.9% | 1.4pp |

**Flags**: Bulwark dominant (61-63%), Charger weak (40-42%). Bulwark vs Charger = 80% skew.

### Giga Mode
| Archetype | Run 1 | Run 2 | Variance |
|-----------|-------|-------|----------|
| Breaker | 55.5% | 53.9% | 1.6pp |
| Duelist | 51.6% | 50.5% | 1.1pp |
| Tactician | 50.9% | 50.2% | 0.7pp |
| Bulwark | 50.0% | 50.2% | 0.2pp |
| Charger | 45.8% | 48.3% | 2.5pp |
| Technician | 46.1% | 47.0% | 0.9pp |

**Flags**: Breaker slightly dominant at giga (54-56%). Charger and Technician slightly weak but within tolerance.

### Mixed Mode
| Archetype | Win Rate |
|-----------|----------|
| Bulwark | 54.2% |
| Tactician | 50.4% |
| Breaker | 50.4% |
| Duelist | 50.2% |
| Technician | 47.6% |
| Charger | 47.2% |

**Flags**: No major balance flags. Best balance tier.

### Variance Assessment
All archetype variance ≤ 2.5pp across runs — well within acceptable range for N=200.

## Known Issues

### BUG-002 (Medium) — Tactician Mirror P1 Bias
Tactician mirror: P1 wins 44% across 2 bare runs. This is within normal Monte Carlo noise at N=200 and may not be a real bias. Other archetypes show similar fluctuations (Charger mirror: 46-55%). **Downgrade to Low — needs N=1000+ to confirm.**

### BUG-004 (Info) — Charger STA+5 Changed Worked Example
Still open. Charger now unseats in Pass 2. Balance-tuner should confirm this is intentional.

### BUG-005 (Low) — Breaker Slightly Dominant at Giga
Breaker at 54-56% at giga rarity. Currently within tolerance but worth monitoring. The 20% guard penetration has more impact when all stats are inflated by giga rarity bonus.

### No New Critical Bugs Found
42 new tests all pass. No crashes, no NaN values, no negative stamina, no invalid outcomes.

## Exploratory Testing Checklist (Updated)

- [x] All 36 archetype matchups at bare (no gear)
- [x] All 36 matchups at uncommon, epic, and giga rarity
- [x] All 3 gear variants (aggressive/balanced/defensive) for each slot
- [x] Mixed variant loadouts (different variants per slot)
- [x] SoftCap boundary (stats at 99, 100, 101, 150)
- [x] Zero stamina: joust pass resolution
- [x] Zero stamina: melee round resolution
- [x] Max fatigue: fatigueFactor at 0 currentStamina
- [x] Guard at fatigue floor (guardFatigueFloor = 0.5)
- [x] Breaker's 20% guard penetration across all defenders
- [x] Unseated impact boost (1.25x) verification
- [x] Unseated stamina recovery (8) verification
- [x] Counter resolution with equal CTL values
- [x] All joust attack speed combinations (fast/medium/slow x fast/medium/slow)
- [x] All melee attack speed combinations
- [x] Uncommon rarity bonus = 2 (not 1) for steed gear
- [x] Player gear applies NO rarity bonus
- [x] Carryover divisors match balance-config values
- [x] 100+ match stress test completes in <500ms

All 19 exploratory scenarios now covered.
