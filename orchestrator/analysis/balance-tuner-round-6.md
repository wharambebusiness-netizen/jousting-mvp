# Balance Analyst — Round 6 Analysis Report

## Executive Summary

Applied Bulwark stat redistribution (BL-025): MOM 55→58, CTL 55→52 (total stays 290). This is the change validated in Round 5's analysis phase, now applied to code.

**Result**: Uncommon Bulwark drops from 63.7% to 58.5% (-5.2pp), reducing the worst-tier spread from 22.1pp to 15.5pp. Rare and epic tiers show no balance flags. Giga is unchanged. Bare tier remains structural at ~62.5% — consistent with Round 5 finding that bare Bulwark dominance is GRD=65-driven and immune to stat redistribution.

**Test impact**: Zero test failures. 649/649 passing. Bulwark MOM/CTL are confirmed not test-locked.

## Changes Made

```
[BALANCE CHANGE] Bulwark MOM 55 → 58, CTL 55 → 52 (in archetypes.ts)
Total: 58+52+65+53+62 = 290 (unchanged)
GRD=65, INIT=53, STA=62 all preserved (test-safe)
```

**Rationale**: Shifting 3 points from Control to Momentum slightly weakens Bulwark's counter-play reliability while increasing its offensive variance. At uncommon tier, where gear begins amplifying base stat differences, this reduces the defensive consistency that made Bulwark oppressive. At bare tier, the MOM gain partially offsets the CTL loss, maintaining Bulwark's structural advantage from GRD=65.

## Win-Rate Comparison: Before vs After

### Bare Tier
| Archetype | Before | After (Run 1) | After (Run 2) | Avg After | Delta |
|-----------|--------|---------------|---------------|-----------|-------|
| bulwark | 60.1% | 62.9% | 62.4% | 62.6% | +2.5pp |
| duelist | 52.8% | 53.4% | 53.6% | 53.5% | +0.7pp |
| tactician | 51.0% | 50.3% | 50.5% | 50.4% | -0.6pp |
| technician | 49.4% | 48.9% | 45.1% | 47.0% | -2.4pp |
| breaker | 47.0% | 43.8% | 46.5% | 45.2% | -1.8pp |
| charger | 39.7% | 40.7% | 42.0% | 41.3% | +1.6pp |
| **Spread** | **20.4pp** | **22.2pp** | **20.4pp** | **21.3pp** | **+0.9pp** |

**Assessment**: Bare tier Bulwark is 2.5pp higher on average. This is borderline — partially noise (~3pp variance), partially real from the MOM gain adding offensive power. The GRD=65 structural advantage dominates at bare regardless. Bare is an exhibition mode; in production, players always have gear.

### Uncommon Tier
| Archetype | Before | After (Run 1) | After (Run 2) | Avg After | Delta |
|-----------|--------|---------------|---------------|-----------|-------|
| bulwark | 63.7% | 58.4% | 58.7% | 58.5% | **-5.2pp** |
| duelist | 52.9% | 55.1% | 55.1% | 55.1% | +2.2pp |
| tactician | 54.8% | 53.4% | 54.0% | 53.7% | -1.1pp |
| breaker | 44.3% | 45.8% | 44.6% | 45.2% | +0.9pp |
| technician | 42.8% | 44.3% | 44.5% | 44.4% | +1.6pp |
| charger | 41.6% | 43.0% | 43.1% | 43.0% | +1.4pp |
| **Spread** | **22.1pp** | **15.4pp** | **15.6pp** | **15.5pp** | **-6.6pp** |

**Assessment**: Strong improvement. Bulwark drops to 58.5% (still flagged but much closer to 55% target). Spread drops by 6.6pp. All previously weak archetypes gain 1-2pp. Duelist rises to 55.1% (borderline flag). Two consistent runs confirm this is signal, not noise.

### Rare Tier (Post-Change Only)
| Archetype | Win Rate |
|-----------|----------|
| bulwark | 54.6% |
| breaker | 53.5% |
| duelist | 53.3% |
| technician | 47.2% |
| charger | 46.2% |
| tactician | 45.2% |
| **Spread** | **9.4pp** |

**Assessment**: No balance flags. Excellent tier balance.

### Epic Tier (Post-Change Only)
| Archetype | Win Rate |
|-----------|----------|
| breaker | 52.3% |
| bulwark | 51.6% |
| charger | 51.0% |
| duelist | 50.0% |
| tactician | 48.8% |
| technician | 46.4% |
| **Spread** | **5.9pp** |

**Assessment**: No balance flags. Near-perfect balance. Technician at 46.4% is lowest but within acceptable range.

### Giga Tier
| Archetype | Before | After | Delta |
|-----------|--------|-------|-------|
| breaker | 55.0% | 56.1% | +1.1pp |
| bulwark | 51.2% | 50.9% | -0.3pp |
| duelist | 50.5% | 49.2% | -1.3pp |
| tactician | 49.9% | 49.9% | 0.0pp |
| charger | 47.0% | 48.2% | +1.2pp |
| technician | 46.3% | 45.6% | -0.7pp |
| **Spread** | **8.7pp** | **10.5pp** | **+1.8pp** |

**Assessment**: Breaker flagged at 56.1% (was 55.0%), borderline. Bulwark neutral. Giga softCap compression makes base stat changes relatively minor here. All within noise.

## Matchup Matrix Highlights (Uncommon Post-Change)

Key matchups that improved:
- Bulwark vs Charger: 76.5% → 68.2% avg (-8.3pp) — significant decompression
- Bulwark vs Technician: 71.5% → 61.5% avg (-10.0pp) — major improvement
- Bulwark vs Breaker: 67.0% → 62.5% avg (-4.5pp) — moderate improvement

Remaining concern:
- Bulwark vs Charger still at ~68% uncommon (was 77%, now better but still skewed)

## Phase Balance

Unchanged. Joust-to-melee ratio stable at ~58-63% joust-decided / 37-42% melee across all tiers. Average passes stable at 4.4-4.7. No structural phase shift from this change.

## Unseat Statistics

Stable. Bulwark unseat rates unchanged — GRD=65 still provides strong unseat resistance (controlled by guardUnseatDivisor, not by MOM/CTL).

## Test Results

```
649 tests passing across 7 test suites
Zero failures from Bulwark MOM/CTL change
Confirmed: Bulwark MOM and CTL are NOT test-locked
```

## Remaining Concerns

1. **Bare Bulwark 62.5%**: Structural, GRD=65-driven. Options: accept as exhibition-mode quirk, or pursue guardUnseatDivisor 15→18 (would require ~3 test updates). Recommend acceptance — bare is not the production experience.

2. **Uncommon Bulwark 58.5%**: Above 55% target but within acceptable range. Further reduction would require GRD reduction (test-locked at 65) or formula changes.

3. **Technician persistent weakness**: 44-47% across all tiers. Most consistent underperformer. Could benefit from MOM 58→61 in a future round, but risk of creating new imbalances. Monitor.

4. **Duelist uncommon 55.1%**: New borderline flag from Bulwark nerf redistributing wins. Within noise but worth monitoring.

5. **Breaker giga 56.1%**: Borderline flag, consistent with pre-change trend. Guard penetration at 0.25 + softCap compression gives Breaker a small giga advantage. Acceptable.

## Recommendations

1. **Accept current state for this session**. The uncommon fix (-5.2pp Bulwark, -6.6pp spread) is the highest-value change available within test-safe constraints.

2. **Future session priority**: Technician MOM 58→61 if weakness persists. Would need test-impact assessment first.

3. **Bare tier**: Accept ~62% Bulwark as structural. Document for game designers that bare is a testing mode, not the intended player experience.

4. **No further changes this round**. One-variable-at-a-time principle: we changed Bulwark stats, now we observe and document before any additional adjustments.

## Simulation Parameters

- 200 matches per matchup × 36 matchups = 7,200 matches per tier
- 5 tiers tested (bare, uncommon, rare, epic, giga) = 36,000 post-change matches
- 2 confirmation runs at bare and uncommon for noise assessment
- Total: ~50,400 simulated matches this round
- Monte Carlo variance: ~3pp at N=200
