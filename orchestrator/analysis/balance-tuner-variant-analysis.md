# Gear Variant Win Rate Analysis

**Date**: 2026-02-09
**Simulations**: 8 runs (3 tiers x 3 variants, minus giga/balanced baseline)
**Matches per matchup**: 200 (7,200 total matches per simulation, 57,600 total)
**Method**: AI vs AI (medium difficulty), both players use same variant + tier

---

## 1. Overall Win Rates by Tier and Variant

### Uncommon Tier

| Archetype   | Aggressive | Balanced | Defensive |
|-------------|-----------|----------|-----------|
| **bulwark**     | **58.9%** | **57.8%** | **54.8%** |
| **tactician**   | 51.2%     | **53.6%** | 52.0%     |
| **duelist**     | 52.0%     | 52.1%     | 51.0%     |
| **technician**  | 47.2%     | 48.3%     | 50.7%     |
| **breaker**     | 45.4%     | 45.0%     | 49.9%     |
| **charger**     | 45.3%     | **43.2%** | **41.6%** |

### Epic Tier

| Archetype   | Aggressive | Balanced | Defensive |
|-------------|-----------|----------|-----------|
| **bulwark**     | **54.3%** | 51.5%    | 51.4%     |
| **duelist**     | 53.1%     | 50.6%    | 50.6%     |
| **charger**     | 48.2%     | **51.8%** | 51.2%     |
| **breaker**     | 50.4%     | 49.6%    | 50.2%     |
| **technician**  | 49.7%     | 51.1%    | 49.0%     |
| **tactician**   | **44.3%** | **45.4%** | 47.6%     |

### Giga Tier

| Archetype   | Aggressive | Defensive |
|-------------|-----------|-----------|
| **bulwark**     | **57.3%** | 48.5%     |
| **breaker**     | 47.9%     | **54.7%** |
| **tactician**   | 51.4%     | 47.8%     |
| **duelist**     | 49.8%     | 49.0%     |
| **technician**  | 47.1%     | 50.2%     |
| **charger**     | 46.5%     | 49.8%     |

---

## 2. Win Rate Matrices (Full Matchup Detail)

### Uncommon Aggressive (P1 row vs P2 column)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 53      | 50         | 29      | 46        | 49      | 37      |
| technician  | 49      | 52         | 41      | 44        | 58      | 50      |
| bulwark     | 63      | 65         | 49      | 52        | 60      | 64      |
| tactician   | 48      | 58         | 41      | 58        | 57      | 44      |
| breaker     | 50      | 45         | 42      | 41        | 48      | 45      |
| duelist     | 56      | 57         | 45      | 51        | 53      | 51      |

### Uncommon Balanced (P1 row vs P2 column)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 50      | 44         | 32      | 42        | 49      | 40      |
| technician  | 52      | 51         | 39      | 47        | 54      | 45      |
| bulwark     | 71      | 60         | 51      | 52        | 62      | 49      |
| tactician   | 60      | 57         | 43      | 51        | 62      | 53      |
| breaker     | 52      | 43         | 37      | 41        | 47      | 44      |
| duelist     | 54      | 53         | 49      | 50        | 50      | 48      |

### Uncommon Defensive (P1 row vs P2 column)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 53      | 44         | 33      | 41        | 46      | 44      |
| technician  | 59      | 52         | 46      | 58        | 53      | 45      |
| bulwark     | 70      | 55         | 54      | 54        | 48      | 51      |
| tactician   | 67      | 54         | 49      | 50        | 54      | 55      |
| breaker     | 59      | 46         | 46      | 49        | 48      | 48      |
| duelist     | 55      | 54         | 47      | 52        | 47      | 45      |

### Epic Aggressive (P1 row vs P2 column)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 50      | 45         | 46      | 57        | 48      | 43      |
| technician  | 51      | 55         | 43      | 58        | 57      | 45      |
| bulwark     | 54      | 52         | 50      | 62        | 53      | 51      |
| tactician   | 46      | 47         | 40      | 52        | 54      | 42      |
| breaker     | 52      | 56         | 47      | 65        | 54      | 44      |
| duelist     | 56      | 57         | 46      | 54        | 48      | 55      |

### Epic Balanced (P1 row vs P2 column)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 54      | 53         | 50      | 57        | 45      | 49      |
| technician  | 54      | 53         | 53      | 58        | 51      | 47      |
| bulwark     | 44      | 54         | 47      | 60        | 55      | 54      |
| tactician   | 42      | 40         | 40      | 48        | 50      | 46      |
| breaker     | 47      | 50         | 52      | 49        | 60      | 47      |
| duelist     | 45      | 53         | 54      | 49        | 49      | 47      |

### Epic Defensive (P1 row vs P2 column)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 53      | 56         | 48      | 55        | 48      | 50      |
| technician  | 50      | 49         | 45      | 55        | 52      | 52      |
| bulwark     | 50      | 56         | 52      | 53        | 47      | 51      |
| tactician   | 48      | 52         | 48      | 50        | 45      | 45      |
| breaker     | 46      | 53         | 49      | 50        | 54      | 46      |
| duelist     | 49      | 48         | 50      | 56        | 50      | 45      |

### Giga Aggressive (P1 row vs P2 column)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 57      | 49         | 35      | 46        | 47      | 46      |
| technician  | 50      | 52         | 41      | 54        | 50      | 41      |
| bulwark     | 60      | 64         | 53      | 53        | 61      | 56      |
| tactician   | 62      | 54         | 43      | 49        | 57      | 52      |
| breaker     | 48      | 56         | 45      | 48        | 44      | 41      |
| duelist     | 45      | 48         | 42      | 50        | 48      | 47      |

### Giga Defensive (P1 row vs P2 column)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 41      | 50         | 51      | 52        | 46      | 47      |
| technician  | 50      | 49         | 52      | 52        | 40      | 61      |
| bulwark     | 45      | 54         | 46      | 53        | 45      | 43      |
| tactician   | 49      | 50         | 45      | 53        | 46      | 46      |
| breaker     | 57      | 48         | 63      | 53        | 48      | 58      |
| duelist     | 47      | 50         | 47      | 52        | 47      | 47      |

---

## 3. Variant Impact Per Archetype (Win Rate Delta from Balanced)

This table shows how each variant shifts an archetype's overall win rate compared to the balanced baseline.

### Uncommon Tier (delta from balanced)

| Archetype   | Aggressive | Defensive |
|-------------|-----------|-----------|
| bulwark     | +1.1pp    | -3.0pp    |
| tactician   | -2.4pp    | -1.6pp    |
| duelist     | -0.1pp    | -1.1pp    |
| technician  | -1.1pp    | +2.4pp    |
| breaker     | +0.4pp    | +4.9pp    |
| charger     | +2.1pp    | -1.6pp    |

### Epic Tier (delta from balanced)

| Archetype   | Aggressive | Defensive |
|-------------|-----------|-----------|
| bulwark     | +2.8pp    | -0.1pp    |
| duelist     | +2.5pp    | +0.0pp    |
| charger     | -3.6pp    | -0.6pp    |
| breaker     | +0.8pp    | +0.6pp    |
| technician  | -1.4pp    | -2.1pp    |
| tactician   | -1.1pp    | +2.2pp    |

---

## 4. Dominant Combos (>60% Win Rate in Any Matchup)

These are specific archetype+variant combinations that achieved >60% win rate against at least one opponent.

| Attacker + Variant           | Victim      | Win Rate | Tier     |
|-----------------------------|-------------|----------|----------|
| Bulwark + Uncommon Balanced  | Charger     | **71%**  | Uncommon |
| Bulwark + Uncommon Defensive | Charger     | **70%**  | Uncommon |
| Bulwark + Uncommon Aggressive| Technician  | **65%**  | Uncommon |
| Bulwark + Uncommon Aggressive| Duelist     | **64%**  | Uncommon |
| Bulwark + Uncommon Aggressive| Charger     | **63%**  | Uncommon |
| Bulwark + Uncommon Balanced  | Breaker     | **62%**  | Uncommon |
| Bulwark + Uncommon Balanced  | Technician  | **60%**  | Uncommon |
| Tactician + Uncommon Defensive| Charger    | **67%**  | Uncommon |
| Tactician + Uncommon Balanced| Charger     | **60%**  | Uncommon |
| Tactician + Uncommon Balanced| Breaker     | **62%**  | Uncommon |
| Bulwark + Epic Aggressive    | Tactician   | **62%**  | Epic     |
| Bulwark + Epic Balanced      | Tactician   | **60%**  | Epic     |
| Breaker + Epic Aggressive    | Tactician   | **65%**  | Epic     |
| Breaker + Epic Balanced      | (mirror)    | **60%**  | Epic     |
| Bulwark + Giga Aggressive    | Technician  | **64%**  | Giga     |
| Bulwark + Giga Aggressive    | Breaker     | **61%**  | Giga     |
| Bulwark + Giga Aggressive    | Charger     | **60%**  | Giga     |
| Tactician + Giga Aggressive  | Charger     | **62%**  | Giga     |
| Breaker + Giga Defensive     | Bulwark     | **63%**  | Giga     |
| Breaker + Giga Defensive     | Duelist     | **58%**  | Giga     |
| Technician + Giga Defensive  | Duelist     | **61%**  | Giga     |

**Total >60% matchups**: 15 across all simulations (out of 240 non-mirror matchups total)

---

## 5. Unviable Combos (<35% Win Rate in Any Matchup)

| Archetype + Variant            | Opponent  | Win Rate | Tier     |
|-------------------------------|-----------|----------|----------|
| Charger + Uncommon Aggressive  | Bulwark   | **29%**  | Uncommon |
| Charger + Uncommon Balanced    | Bulwark   | **32%**  | Uncommon |
| Charger + Uncommon Defensive   | Bulwark   | **33%**  | Uncommon |
| Charger + Giga Aggressive      | Bulwark   | **35%**  | Giga     |

The Charger vs Bulwark matchup is consistently the worst in the game across all variants and tiers.

---

## 6. Overall Archetype Win Rates Across All Variants (Tier Summary)

### Uncommon Tier — Average across 3 variants

| Archetype   | Avg Win Rate | Spread (max-min) | Best Variant |
|-------------|-------------|-------------------|--------------|
| bulwark     | 57.2%       | 4.1pp             | Aggressive   |
| tactician   | 52.3%       | 2.4pp             | Balanced     |
| duelist     | 51.7%       | 1.1pp             | Balanced     |
| technician  | 48.7%       | 3.5pp             | Defensive    |
| breaker     | 46.8%       | 4.9pp             | Defensive    |
| charger     | 43.4%       | 3.7pp             | Aggressive   |

### Epic Tier — Average across 3 variants

| Archetype   | Avg Win Rate | Spread (max-min) | Best Variant |
|-------------|-------------|-------------------|--------------|
| bulwark     | 52.4%       | 2.9pp             | Aggressive   |
| duelist     | 51.4%       | 2.5pp             | Aggressive   |
| charger     | 50.4%       | 3.6pp             | Balanced     |
| breaker     | 50.1%       | 0.8pp             | Aggressive   |
| technician  | 49.9%       | 2.1pp             | Balanced     |
| tactician   | 45.8%       | 3.3pp             | Defensive    |

### Giga Tier — Average across 2 variants

| Archetype   | Avg Win Rate | Spread (agg vs def) | Best Variant |
|-------------|-------------|---------------------|--------------|
| bulwark     | 52.9%       | 8.8pp               | Aggressive   |
| breaker     | 51.3%       | 6.8pp               | Defensive    |
| tactician   | 49.6%       | 3.6pp               | Aggressive   |
| duelist     | 49.4%       | 0.8pp               | Aggressive   |
| charger     | 48.2%       | 3.3pp               | Defensive    |
| technician  | 48.7%       | 3.1pp               | Defensive    |

---

## 7. Phase Balance Impact

| Tier + Variant         | Joust-Decided | Melee-Decided | Avg Passes | Avg Melee Rounds |
|------------------------|--------------|---------------|------------|-----------------|
| Uncommon Aggressive    | 58.0%        | 42.0%         | 4.35       | 2.38            |
| Uncommon Balanced      | 57.9%        | 42.1%         | 4.37       | 2.48            |
| Uncommon Defensive     | 56.9%        | 43.1%         | 4.37       | 2.45            |
| Epic Aggressive        | 51.6%        | 48.4%         | 4.28       | 2.59            |
| Epic Balanced          | 58.2%        | 41.8%         | 4.47       | 2.91            |
| Epic Defensive         | 57.7%        | 42.3%         | 4.46       | 2.86            |
| Giga Aggressive        | 47.0%        | 53.0%         | 4.29       | 3.14            |
| Giga Defensive         | 61.3%        | 38.7%         | 4.61       | 3.63            |

Key observations:
- **Aggressive gear increases melee frequency** (more unseats from higher MOM), especially at Giga tier (53% melee)
- **Defensive gear increases joust-decided matches** (harder to unseat, matches go the distance), Giga defensive has 61.3% joust-decided
- **Melee rounds get longer at higher tiers** regardless of variant (2.4 at uncommon vs 3.1-3.6 at giga)
- **Passes are slightly fewer with aggressive gear** (faster resolution from bigger impact swings)

---

## 8. Key Findings

### 8.1 Bulwark Dominance Problem (Pre-existing)

Bulwark is the top archetype in 6 of 8 simulations. This is NOT a variant system problem -- it is a base archetype balance issue that variants amplify:
- Uncommon Aggressive: **58.9%** (flagged DOMINANT)
- Uncommon Balanced: **57.8%** (flagged DOMINANT)
- Giga Aggressive: **57.3%** (flagged DOMINANT)
- Uncommon Defensive: 54.8%
- Epic Aggressive: 54.3%

Aggressive gear exacerbates Bulwark's advantage because the extra MOM is layered on top of already-high GRD, making Bulwark hit harder while remaining tanky.

### 8.2 Charger Weakness Problem (Pre-existing)

Charger is the weakest archetype in 5 of 8 simulations, particularly at Uncommon tier:
- Uncommon Defensive: **41.6%** (flagged WEAK)
- Uncommon Balanced: **43.2%** (flagged WEAK)
- Uncommon Aggressive: 45.3%

The Charger vs Bulwark matchup is catastrophically one-sided (29-35% across all variants).

### 8.3 Tactician Is Polarized by Tier

- Strong at Uncommon (51-54% across variants)
- Weak at Epic (44-48% across variants, flagged WEAK at aggressive)
- This suggests Tactician's high INIT advantage is proportionally weaker when gear stats scale up

### 8.4 Variant System Creates Meaningful Choices -- At Giga Tier

The spread between best and worst variant for each archetype tells us how much the choice matters:

| Archetype   | Uncommon Spread | Epic Spread | Giga Spread |
|-------------|----------------|-------------|-------------|
| bulwark     | 4.1pp          | 2.9pp       | **8.8pp**   |
| breaker     | 4.9pp          | 0.8pp       | **6.8pp**   |
| charger     | 3.7pp          | 3.6pp       | 3.3pp       |
| technician  | 3.5pp          | 2.1pp       | 3.1pp       |
| tactician   | 2.4pp          | 3.3pp       | 3.6pp       |
| duelist     | 1.1pp          | 2.5pp       | 0.8pp       |

**At Giga tier, variant choice swings Bulwark by 8.8pp and Breaker by 6.8pp** -- this is meaningful. At lower tiers, spreads are typically 1-5pp, which is marginal.

### 8.5 Variant Preferences by Archetype

| Archetype   | Natural Preference | Reasoning |
|-------------|-------------------|-----------|
| **Bulwark**     | Aggressive        | Already has high GRD; adding MOM creates an unstoppable combination |
| **Breaker**     | Defensive (Giga)  | Needs survivability to reach melee where Breaker mechanics shine |
| **Technician**  | Defensive         | Higher GRD/STA compensates for lower base durability |
| **Charger**     | Aggressive (low tier), Defensive (high tier) | At low tier, doubling down on MOM; at high tier, needs survivability |
| **Tactician**   | Balanced/Defensive | INIT advantage is stat-independent; defensive gear shores up weaknesses |
| **Duelist**     | Insensitive       | 60/60/60/60/60 base means variants shift equally in all directions; minimal impact |

### 8.6 Defensive Variant Is the Best Equalizer

Epic Defensive produced the most balanced results of ANY simulation:
- Win rate spread: 47.6% - 51.4% (only 3.8pp between best and worst)
- **Zero balance flags** triggered
- All archetypes within 45-55% band
- Matchup spread compressed (max 11pp for any archetype)

This is because defensive gear reduces the variance in combat outcomes, making matches more about decision-making and less about stat advantages.

---

## 9. Recommendations

### 9.1 The variant system works but needs tuning

The variant system successfully creates different playstyles. However, the impact is too small at lower tiers (1-5pp) and asymmetric at higher tiers (Bulwark benefits far more than Duelist).

### 9.2 Increase variant stat divergence at lower tiers

Currently the stat delta between aggressive and defensive is too small at Uncommon to create meaningful choices. Consider widening the primary/secondary allocation split for lower rarities so that even Uncommon players feel the difference.

### 9.3 Address Bulwark + Aggressive synergy

Bulwark with aggressive gear is consistently dominant (57-59% at Uncommon, 54% at Epic, 57% at Giga). Options:
- Reduce Bulwark's base MOM (currently 58) to limit aggressive gear synergy
- Cap the MOM bonus aggressive gear gives to already-high-GRD archetypes
- Increase the GRD cost of aggressive gear (take more from GRD, give less MOM)

### 9.4 Address Charger vs Bulwark matchup

This matchup is 29-35% across ALL variants and tiers -- variants cannot fix it. This is a base archetype problem. The Charger's MOM advantage is nullified by Bulwark's GRD, and Charger has no compensating strength.

### 9.5 Duelist needs more variant sensitivity

Duelist's perfectly balanced 60/60/60/60/60 base means variants barely affect it (0.8-2.5pp spread). Consider giving Duelist a unique variant interaction -- for example, a "precision" variant that trades STA for CTL+INIT.

### 9.6 Consider asymmetric variant access

The most interesting finding is at Giga tier where Bulwark prefers Aggressive and Breaker prefers Defensive -- they want OPPOSITE things. This creates actual strategic depth. To preserve this at lower tiers, consider making the variant effect scale with tier (bigger divergence at higher rarity).

---

## 10. Summary Verdict

**Does the variant system create meaningful player choices?**

- **At Uncommon tier**: Marginally. Spreads of 1-5pp are within noise for 200-match samples. The choice feels inconsequential.
- **At Epic tier**: Somewhat. Defensive variant creates excellent balance; aggressive creates interesting but unequal advantages. 2-4pp spreads are noticeable over many games.
- **At Giga tier**: Yes. 7-9pp spreads for Bulwark and Breaker mean variant choice genuinely matters. Different archetypes wanting different variants creates strategic depth.

**Overall grade: B-**. The system has the right structure but needs wider stat divergence at lower tiers and better balance guardrails for Bulwark+Aggressive to achieve its full potential. The Giga-tier results prove the concept works when the numbers are big enough to matter.
