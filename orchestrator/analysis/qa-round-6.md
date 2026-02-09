# QA Round 6 — Analysis Report

## Test Count: 649 → 655 (+6 tests)

### Changes This Round

#### BL-026: Stale Comment Fixes (3 fixes)
1. **phase-resolution.test.ts:421-425** — Comment referenced hardcoded `0.35` for breakerGuardPenetration and `0.2` for guardImpactCoeff. Updated to reference BALANCE constants generically. These were illustrative comments, not assertion values.
2. **calculator.test.ts:805** — Giga Bulwark test archetype `momentum: 68, control: 68` updated to `momentum: 71, control: 65` to reflect BL-025 change (Bulwark MOM 55→58, CTL 55→52, both +13 giga rarity).
3. **calculator.test.ts:1616, :1643** — Already fixed in Round 5. Confirmed no remaining stale `0.20` references to `breakerGuardPenetration`.

#### BL-023: Multi-Pass Worked Example Test (+6 tests)
Added `describe('Multi-pass Worked Example — Tactician vs Duelist')` to match.test.ts:

- **Test 1**: Completes all 5 passes without unseat
- **Test 2**: Pass 1 — no fatigue, verifies effective stats, accuracy (101.25 vs 90.00), impact (58.80 vs 58.60), stamina (45, 50)
- **Test 3**: Pass 2 — still no fatigue (above threshold), identical impacts, cumulative scores (117.60 vs 117.20)
- **Test 4**: Pass 3 — fatigue begins (P1 ff=35/44=0.795, P2 ff=40/48=0.833), Duelist overtakes in impact
- **Test 5**: Passes 4-5 — deepening fatigue, Duelist (P2) wins on cumulative score, final stamina 5/10
- **Test 6**: Impact decreases monotonically across passes, passes 1-2 identical, pass 3 strictly lower

**Why Tactician vs Duelist?** Best candidate for multi-pass trace:
- Goes all 5 passes at bare (no unseat — margin never exceeds ~4pp vs threshold ~23-27)
- Passes 1-2 are identical (both above fatigue threshold), simplifying validation
- Demonstrates fatigue crossover: Tactician's INIT advantage fades as STA disadvantage compounds
- Duelist's all-60 base makes mental math approachable

#### BL-025 Cascade Verification
BL-025 (Bulwark MOM 55→58, CTL 55→52) is **already applied** in the working directory. Verified:
- **Zero test breakages** — 655/655 passing
- Bulwark MOM/CTL are NOT test-locked (only GRD=65 is locked in gear tests)
- Only cosmetic update needed: Giga Bulwark archetype in calculator.test.ts:805 (fixed this round)
- gear-variants.test.ts: no Bulwark-specific deterministic assertions on MOM/CTL
- playtest.test.ts: stat total still 290 (58+52+65+53+62=290), within 290-300 range

### Simulation Consistency Check (Post BL-025)

| Tier | Bulwark | Charger | Spread | Flags |
|------|---------|---------|--------|-------|
| bare | 61.5% (±1pp) | 41.5% | 20.0pp | Bulwark dominant, Charger weak |
| uncommon | 58.1% | 42.1% | 16.0pp | Bulwark dominant (improved from 63%), Tactician 55.8% (new flag) |
| giga | 51.7% | 46.9% | 7.3pp | No flags |

**BL-025 effectiveness:**
- **Bare: No effect** (61.5% vs 60-62% pre-change — within noise). Confirms balance-tuner's structural analysis.
- **Uncommon: -4-5pp** (58.1% vs 62-63% pre-change). Significant improvement. Spread down from ~23pp to 16pp.
- **Giga: Already good** (51.7% — no flags).

**New concern: Tactician 55.8% at uncommon** — flagged as dominant. This was ~51-53% before BL-025. May be a Monte Carlo artifact at N=200 (±3pp). Should be monitored.

### Bug Status

| Bug | Status | Notes |
|-----|--------|-------|
| BUG-002 | CLOSED | Tactician mirror P1 bias — Monte Carlo noise (confirmed Round 5) |
| BUG-004 | Info | Charger STA+5 changed worked example — intentional |
| BUG-005 | Low | Breaker 54.2% at giga — within tolerance but monitor |
| BUG-006 | Low/New | Tactician 55.8% at uncommon — may be Monte Carlo noise, needs N=1000 confirmation |

### Coverage Gap Analysis

Checklist items completed this round:
- [x] Multi-pass (5-pass) worked example with exact value tracing
- [x] Fatigue progression verification (monotonic decrease)
- [x] Fatigue crossover (Tactician→Duelist advantage swap at Pass 3)

Remaining uncovered (deferred):
- [ ] Test gear min/max stat rolls (lowest uncommon vs highest giga)
- [ ] Automated simulation consistency test in vitest
- [ ] Melee-specific multi-round worked example
