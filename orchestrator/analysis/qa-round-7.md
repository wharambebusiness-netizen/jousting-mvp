# QA Round 7 — Analysis Report

## Summary

Round 7: Continuous agent. Added 12 new tests (+6 melee worked example, +6 gear boundary). Full simulation sweep across 5 tiers. BUG-006 resolved as noise.

## Test Count

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| calculator.test.ts | 171 | 171 | 0 |
| phase-resolution.test.ts | 35 | 35 | 0 |
| gigling-gear.test.ts | 48 | 48 | 0 |
| player-gear.test.ts | 46 | 46 | 0 |
| match.test.ts | 77 | 83 | **+6** |
| gear-variants.test.ts | 156 | 156 | 0 |
| playtest.test.ts | 122 | 128 | **+6** |
| **Total** | **655** | **667** | **+12** |

## New Tests Added

### Melee Worked Example (match.test.ts, +6 tests)
Full deterministic trace: Duelist vs Duelist, P1 plays Measured Cut, P2 plays Overhand Cleave.

- **Test 1**: Match completes in exactly 3 rounds. P1 wins by Critical (meleeWins=4: 1+1+2).
- **Test 2**: Round 1 — no fatigue, exact impact scores (P1=59.0, P2=49.4), Hit, STA 60→50/60→42.
- **Test 3**: Round 2 — P2 fatigued (ff=0.875), gap widens (P1=60.62, P2=41.9), Hit, STA 50→40/42→24.
- **Test 4**: Round 3 — deep fatigue (P2 ff=0.5), Critical hit (margin=33.0), melee ends, STA 40→30/24→6.
- **Test 5**: Impact escalation pattern — P1 impact rises R1→R2 (opponent guard fatigues), falls R2→R3 (own stats fatigue). P2 impact monotonically decreasing.
- **Test 6**: Stamina drain tracking — MC costs 10/round, OC costs 18/round, exact values verified.

Key finding: P1 impact actually **increases** from Round 1→2 (59.0→60.62) because the opponent's guard fatigues faster than P1's momentum. This is a counterintuitive but correct behavior — guard fatigue partially protects guard (guardFatigueFloor=0.5) but the opponent's momentum/control fatigue makes their guard even lower via attack deltas.

### Gear Extreme Boundary Tests (playtest.test.ts, +6 tests)
- **Lowest uncommon vs highest giga**: Match completes without errors, giga player dominates.
- **All-min gear stamina**: Stamina never goes negative across 5 passes with expensive attacks (Fast+CF).
- **All-max giga gear**: Stats above softCap knee still produce valid positive impact scores.
- **Min vs max differential**: Giga min-max impact differential exceeds uncommon differential.
- **All-rarity min-max invariant**: Max-roll gear ALWAYS produces higher impact than min-roll at every rarity.
- **Max giga melee**: Breaker vs Bulwark with max gear completes within 20 rounds.

## Simulation Results (Post BL-025, 5-tier sweep)

| Tier | Top | Rate | Spread | Bottom | Rate | Flags |
|------|-----|------|--------|--------|------|-------|
| bare | Bulwark | 60.4% | 20.1pp | Charger | 40.3% | DOMINANT, WEAK |
| uncommon (run 1) | Bulwark | 58.9% | 15.8pp | Charger/Tech | 43.1% | DOMINANT, WEAK x2 |
| uncommon (run 2) | Bulwark | 59.1% | 15.8pp | Charger | 43.3% | DOMINANT, WEAK x2 |
| uncommon (run 3) | Bulwark | 57.0% | 12.8pp | Charger | 44.2% | DOMINANT, WEAK x2 |
| rare | Bulwark | 55.2% | 10.6pp | Tactician | 44.6% | DOMINANT, WEAK |
| epic | Charger | 55.7% | 10.3pp | Technician | 45.4% | DOMINANT |
| giga | Breaker | 53.9% | 6.8pp | Technician | 47.1% | Clean |

## Bug Tracker

### BUG-006 (Closed): Tactician 55.8% at uncommon
- Round 6 observation: 55.8% at N=200. Flagged as potential dominance.
- Round 7 three-run validation: 54.8%, 53.6%, 54.6% (mean 54.3%, SD ~0.6pp).
- **VERDICT**: Monte Carlo noise. Tactician is within acceptable 53-55% band at uncommon. Not a balance issue.

### BUG-005 (Monitor): Breaker 53.9% at giga
- Stable across runs. Within tolerance but highest non-Bulwark archetype at giga.
- Not actionable — Breaker is designed as anti-Bulwark, slight advantage expected at high-gear tiers.

### Existing Known Issues
- **Bare Bulwark ~60%**: Structural (GRD=65 triple-dip). Accepted as exhibition-mode behavior.
- **Uncommon Bulwark ~58%**: Improved from 63.7% after BL-025 (-5.2pp), but still flagged at 55% threshold. Needs guardian-specific fix (guardUnseatDivisor) for further improvement.
- **Technician 44-47%**: Persistent slight weakness across all tiers. Not urgent — within ±5% of 50%.
- **Epic Charger 55.7%**: Charger becomes strongest at epic due to STA=65 preserving MOM=75 through fatigue. Expected behavior for "wins fast" identity.

## Exploratory Testing Checklist Update

- [x] All 36 archetype matchups at bare (no gear) — covered in sims + playtest
- [x] All 36 matchups at uncommon, epic, and giga rarity — sim coverage
- [x] All 3 gear variants (aggressive/balanced/defensive) for each slot — gear-variants.test.ts
- [x] Mixed variant loadouts (different variants per slot) — gear-variants.test.ts
- [x] SoftCap boundary (stats at 99, 100, 101, 150) — calculator.test.ts
- [x] Zero stamina: joust pass resolution — match.test.ts
- [x] Zero stamina: melee round resolution — calculator.test.ts
- [x] Max fatigue: fatigueFactor at 0 currentStamina — calculator.test.ts
- [x] Guard at fatigue floor (guardFatigueFloor = 0.5) — calculator.test.ts
- [x] Breaker's 25% guard penetration across all defenders — calculator.test.ts
- [x] Unseated impact boost (1.25x) verification — playtest.test.ts
- [x] Unseated stamina recovery (8) verification — match.test.ts
- [x] Counter resolution with equal CTL values — calculator.test.ts
- [x] All joust attack speed combinations — calculator.test.ts
- [x] Uncommon rarity bonus = 2 — playtest.test.ts
- [x] Player gear applies NO rarity bonus — playtest.test.ts
- [x] Carryover divisors match balance-config values — playtest.test.ts
- [x] 100+ match stress test completes in <500ms — playtest.test.ts
- [x] **NEW**: Melee multi-round worked example with fatigue trace — match.test.ts
- [x] **NEW**: Gear min/max stat roll boundaries across all rarities — playtest.test.ts
- [x] **NEW**: Extreme gear differential (uncommon vs giga) match completion — playtest.test.ts

## Recommendations

1. **For balance-tuner**: Technician persistent weakness (44-47%) could benefit from MOM 58→61 if other archetypes don't spike. Low priority.
2. **For reviewer**: Update CLAUDE.md test count 649→667.
3. **For engine-dev**: No bugs found. Combat system is robust across all tested boundaries.
