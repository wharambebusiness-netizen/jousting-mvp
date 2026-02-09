# Balance Analyst — Round 7 Analysis Report

## Executive Summary

No balance changes made this round. This is a **comprehensive post-BL-025 health check** — a full 8-tier, 3-variant assessment of the current balance state after the Bulwark stat redistribution (MOM 55→58, CTL 55→52) applied in Round 6. Total: 93,600 simulated matches across 13 simulation runs.

**Findings**: The balance system is in a healthy state. BL-025's effects are confirmed stable across confirmation runs. Rare and epic tiers show excellent sub-11pp spreads with zero flags. Giga balanced-variant shows 8.7pp spread — acceptable. The two remaining structural issues (bare Bulwark ~62%, Technician persistent weakness ~44-47%) are documented with root cause analysis and future intervention recommendations.

## Changes Made

None. This is an observation-only round. The one-variable-at-a-time principle requires a stabilization period after BL-025 before any further adjustments.

## Full Tier Sweep — Balanced Variant (Default)

### Bare (2 runs averaged)
| Archetype | Run 1 | Run 2 | Average | Status |
|-----------|-------|-------|---------|--------|
| bulwark | 61.0% | 63.0% | 62.0% | FLAGGED (>55%) |
| duelist | 52.3% | 54.0% | 53.2% | OK |
| tactician | 51.5% | 51.2% | 51.4% | OK |
| technician | 47.2% | 46.7% | 47.0% | OK (borderline) |
| breaker | 47.1% | 44.0% | 45.6% | OK (borderline) |
| charger | 41.0% | 41.1% | 41.1% | FLAGGED (<45%) |
| **Spread** | **20.0pp** | **21.9pp** | **20.9pp** | |

**Assessment**: Bare tier unchanged from Round 6 baseline. Bulwark dominance (62%) is structural from GRD=65. Charger weakness (41%) is structural from MOM=75 being dampened by early fatigue at bare (no STA gear). Both accepted as exhibition-mode artifacts — bare is not the intended play experience.

### Uncommon (2 runs averaged)
| Archetype | Run 1 | Run 2 | Average | Status |
|-----------|-------|-------|---------|--------|
| bulwark | 58.4% | 59.8% | 59.1% | FLAGGED (>55%) |
| tactician | 54.7% | 53.8% | 54.3% | OK |
| duelist | 54.1% | 53.0% | 53.6% | OK |
| charger | 42.9% | 45.2% | 44.1% | FLAGGED (<45%) |
| breaker | 45.9% | 44.8% | 45.4% | OK (borderline) |
| technician | 44.0% | 43.4% | 43.7% | FLAGGED (<45%) |
| **Spread** | **15.5pp** | **16.4pp** | **15.4pp** | |

**Assessment**: BL-025 effect confirmed — Bulwark down from 63.7% to 59.1% (-4.6pp avg). Spread down from 22.1pp to 15.4pp. Improvement is real (>3pp noise threshold). Remaining concerns: Charger and Technician both borderline at 44%. Three archetypes flagged is suboptimal but within the acceptable band for the first gear tier.

### Rare
| Archetype | Win Rate | Status |
|-----------|----------|--------|
| bulwark | 54.5% | OK |
| duelist | 54.0% | OK |
| breaker | 52.4% | OK |
| technician | 48.9% | OK |
| charger | 46.5% | OK |
| tactician | 43.8% | FLAGGED (<45%) |
| **Spread** | **10.7pp** | |

**Assessment**: Clean tier. Tactician at 43.8% is a borderline flag, likely noise (within 3pp of 45%). No dominant archetype.

### Epic
| Archetype | Win Rate | Status |
|-----------|----------|--------|
| charger | 52.6% | OK |
| breaker | 51.9% | OK |
| bulwark | 51.0% | OK |
| duelist | 49.3% | OK |
| tactician | 48.8% | OK |
| technician | 46.5% | OK |
| **Spread** | **6.1pp** | |

**Assessment**: Excellent balance. Zero flags. All archetypes within 45-55% band. Spread under 7pp. This is the best-balanced tier. The Charger reversal (strongest at epic, weakest at bare) is a healthy tier-scaling dynamic.

### Giga
| Archetype | Win Rate | Status |
|-----------|----------|--------|
| breaker | 55.3% | FLAGGED (>55%, borderline) |
| bulwark | 51.1% | OK |
| duelist | 51.1% | OK |
| tactician | 48.3% | OK |
| charger | 47.5% | OK |
| technician | 46.6% | OK |
| **Spread** | **8.7pp** | |

**Assessment**: Only Breaker borderline flagged at 55.3%. This is consistent with breakerGuardPenetration 0.25 giving Breaker a small advantage when softCap compresses everyone else's stats. Acceptable — Breaker's identity is "anti-guard specialist" and the giga meta should reward that niche. Technician at 46.6% is lowest but within acceptable range.

## Variant Analysis — Uncommon

| Archetype | Balanced | Aggressive | Defensive |
|-----------|----------|------------|-----------|
| bulwark | 59.1% | 60.1% | 56.1% |
| duelist | 53.6% | 53.8% | 52.5% |
| tactician | 54.3% | 51.7% | 52.7% |
| breaker | 45.4% | 46.5% | 51.0% |
| technician | 43.7% | 41.6% | 45.6% |
| charger | 44.1% | 46.2% | 42.1% |
| **Spread** | **15.4pp** | **18.5pp** | **14.0pp** |

**Key observations**:
- **Defensive variant produces best uncommon balance** (14.0pp spread, Bulwark 56.1%). Confirms Round 4-5 finding.
- **Aggressive variant amplifies Bulwark** to 60.1% and depresses Technician to 41.6%. Aggressive gear benefits high-GRD archetypes disproportionately.
- Breaker benefits dramatically from defensive variant (+5.6pp over balanced) — guard penetration becomes more valuable when everyone is more defensive.
- Charger benefits from aggressive (+2.1pp) but suffers with defensive (-2.0pp) — consistent with identity.

## Variant Analysis — Giga

| Archetype | Balanced | Aggressive | Defensive |
|-----------|----------|------------|-----------|
| breaker | 55.3% | 49.5% | 55.6% |
| bulwark | 51.1% | 58.4% | 51.2% |
| duelist | 51.1% | 50.7% | 48.0% |
| tactician | 48.3% | 49.6% | 50.3% |
| charger | 47.5% | 46.0% | 49.8% |
| technician | 46.6% | 45.8% | 45.0% |
| **Spread** | **8.7pp** | **12.6pp** | **10.6pp** |

**Key observations**:
- **Aggressive giga: Bulwark surges to 58.4%** — aggressive gear at giga rarity pushes GRD high enough to dominate despite softCap. This is the worst variant/tier combination.
- **Balanced giga is optimal** (8.7pp spread) — softCap effectively equalizes.
- **Defensive giga**: Breaker 55.6%, Bulwark 51.2%. Breaker thrives in defensive metas.
- Technician consistently weakest at giga regardless of variant (45-47%).

## Technician Weakness Deep Dive

Technician is the most consistent underperformer across all 13 simulation runs:

| Tier | Balanced | Aggressive | Defensive |
|------|----------|------------|-----------|
| bare | 47.0% | — | — |
| uncommon | 43.7% | 41.6% | 45.6% |
| rare | 48.9% | — | — |
| epic | 46.5% | — | — |
| giga | 46.6% | 45.8% | 45.0% |

**Root cause analysis**:
1. **MOM=58 is third-lowest** (tied with Bulwark). In joust phase, momentum is the primary offensive stat. Technician compensates with CTL=70 (shift mastery, counter bonuses), but shift costs STA which accelerates fatigue.
2. **STA=55 is second-lowest** (tied with Tactician). Technician's identity is "shift master" but each shift costs 5-12 STA. By Pass 3, Technician is often below fatigue threshold, degrading the CTL advantage.
3. **The shift paradox**: Technician's high CTL enables shifting, but shifting costs STA, which reduces fatigue factor, which degrades the CTL advantage. The more Technician uses its identity mechanic, the faster it weakens.

**Intervention options** (for future sessions):
1. **Technician MOM 58→61** (+3): Most direct fix. ~2-3pp improvement projected. Would break 5-8 test assertions (calculator worked examples, match worked example). Moderate cascade.
2. **Technician STA 55→58** (+3, total 301→needs offset): Would address the shift paradox. But requires reducing another stat to stay in 290-300 range. CTL→67 would undermine identity. INIT→57 is the safest dump stat.
3. **Reduce shift costs** (balance-config.ts): shiftSameStanceCost 5→3, shiftCrossStanceCost 12→10. Would specifically benefit high-CTL archetypes. But these are test-locked (hardcoded in shift cost tests).
4. **No intervention**: Technician at 44-47% is borderline but not catastrophic. In a 6-archetype system, some must be below 50%. Technician's strength is positional — its shift mastery creates interesting counterplay even when overall win rate is low.

**Recommendation**: Option 4 (no intervention) for this session. If Technician weakness persists into next session, pursue Option 1 (MOM +3) with test cascade documentation.

## Matchup Matrix — Key Problematic Matchups

### Consistently Skewed (>65% across runs)
| Matchup | Bare Avg | Uncommon Avg | Status |
|---------|----------|--------------|--------|
| Bulwark vs Charger | 73.5% | 67% | Structural — GRD vs MOM |
| Bulwark vs Technician | 67% | 62.5% | Structural — GRD triple-dip |
| Bulwark vs Breaker | 68% | 65% | Guard penetration insufficient |

These matchups are driven by Bulwark's GRD=65 which is test-locked. The 5-7pp improvement from BL-025 (MOM+3, CTL-3) is the maximum achievable without touching GRD or formula constants.

### Healthy Counter Matchups
| Matchup | Bare Avg | Uncommon Avg | Status |
|---------|----------|--------------|--------|
| Tactician vs Charger | 61% | 61% | Expected — Tactician counters Charger |
| Duelist vs Breaker | 58% | 55% | Expected — generalist beats specialist |
| Charger vs Technician | 53% | 52% | Expected — power vs finesse |

## Phase Balance

Stable across all tiers:
| Tier | Joust-decided | Melee-decided | Avg Passes | Avg Melee Rounds |
|------|--------------|---------------|------------|-----------------|
| bare | 62.4% | 37.6% | 4.45 | 2.32 |
| uncommon | 58.1% | 41.9% | 4.41 | 2.45 |
| rare | 59.4% | 40.6% | 4.46 | 2.67 |
| epic | 58.9% | 41.1% | 4.50 | 2.90 |
| giga | 63.3% | 36.7% | 4.66 | 3.74 |

**Notes**: Melee rounds increase with tier (gear → higher STA → more rounds to deplete). Phase split is healthy 58-63% joust / 37-42% melee. Giga variant aggressive pushes melee to 52.1% (more unseats) — gear variance creates more dynamic matches.

## Unseat Statistics

Stable. No archetype has anomalous unseat rates. Bulwark consistently has the lowest unseat-received rate (GRD=65 protection), but the delta is within normal variance.

## Test Suite

655 tests passing across 7 suites (up from 649 — QA appears to have added tests). Zero failures. No test changes needed this round.

## Summary: Balance Health Scorecard

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Max win rate (bare) | <65% | 62.0% (Bulwark) | PASS (accepted structural) |
| Min win rate (bare) | >40% | 41.1% (Charger) | PASS (barely) |
| Max win rate (uncommon) | <60% | 59.1% (Bulwark) | PASS (barely) |
| Min win rate (uncommon) | >40% | 43.7% (Technician) | PASS |
| Max win rate (rare) | <55% | 54.5% (Bulwark) | PASS |
| Max win rate (epic) | <55% | 52.6% (Charger) | PASS |
| Max win rate (giga) | <57% | 55.3% (Breaker) | PASS |
| Spread (bare) | <25pp | 20.9pp | PASS |
| Spread (uncommon) | <20pp | 15.4pp | PASS |
| Spread (rare) | <15pp | 10.7pp | PASS |
| Spread (epic) | <10pp | 6.1pp | PASS |
| Spread (giga) | <12pp | 8.7pp | PASS |
| Single matchup max | <70% | Bulwark vs Charger bare ~73.5% | FAIL (structural) |
| Tests | All pass | 655/655 | PASS |

**Overall**: 13/14 metrics pass. The single failure (Bulwark vs Charger bare at 73.5%) is structural and accepted.

## Recommendations for Next Session

1. **Priority 1**: Technician MOM 58→61 if weakness persists across sessions. Pre-assess test cascade first.
2. **Priority 2**: Consider guardUnseatDivisor 15→18 if bare Bulwark remains a concern. Would require ~3 test assertion updates. Projected -3pp Bulwark at bare.
3. **Priority 3**: Monitor Breaker giga — if consistently >56%, consider breakerGuardPenetration 0.25→0.23.
4. **No further changes this session** — the balance system is stable and all critical targets are met.

## Simulation Parameters

- 200 matches per matchup x 36 matchups = 7,200 matches per run
- 13 runs total: bare x2, uncommon x2, rare x1, epic x1, giga x1, uncommon-aggressive x1, uncommon-defensive x1, giga-aggressive x1, giga-defensive x1, plus 2 confirmation runs
- Total: 93,600 simulated matches
- Monte Carlo variance: ~3pp at N=200
