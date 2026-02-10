# Archetype Fun Factor Audit -- Design Round 1

**Date**: 2026-02-09
**Scope**: Analysis only -- no source code modifications
**Data Sources**: archetypes.ts, attacks.ts, balance-config.ts, calculator.ts, phase-joust.ts, phase-melee.ts, basic-ai.ts, balance-tuner-round-8.md (144,000 match dataset)

---

## 1. CHARGER

**Stats**: MOM=75, CTL=55, GRD=50, INIT=55, STA=65 (300 total)
**Identity tag**: "Raw impact; wins fast or fades"

### 1.1 Identity Clarity: STRONG

Charger's identity is the clearest of all six archetypes. The stat profile screams "glass cannon on horseback": MOM 75 is the highest single stat in the game, GRD 50 is tied for the lowest, and the 65 STA gives a short but not trivial runway. A player picking Charger immediately understands the deal: hit hard early, before fatigue and guard exposure catch up.

The stat-to-identity mapping is tight. With Fast speed (+15 MOM, -15 CTL, -5 STA), Charger reaches raw MOM of 90+ before attack deltas, and Coup Fort (+25 MOM, -10 CTL, -5 GRD, -20 STA) pushes raw momentum to 115 -- right at the softCap knee of 100, yielding effective MOM around 107.5 before fatigue. This is by far the highest impact number any archetype can produce.

The tradeoff is visceral: -20 STA per Coup Fort means Charger's 65 STA runway burns in roughly 2-3 aggressive passes. A Charger who goes Fast+Coup Fort on pass 1 spends 25 stamina (5 from Fast, 20 from Coup Fort) and is already at 40/65, below the fatigue threshold of 52 (65 * 0.8). By pass 2, fatigue is degrading their MOM/CTL. By pass 3, they are a spent force.

**Verdict**: The fantasy of the charging knight who must commit or die is successfully delivered by the math.

### 1.2 Decision Quality: MODERATE

The problem: Charger's optimal line is almost always Fast + Coup Fort (or Fast + Bris de Garde as a slightly safer alternative). The AI personality confirms this -- speedMods [-1, 0, 3] and stancePrefs [3, 0, -1] heavily weight toward Fast + Aggressive.

Decision space narrows to:
- **Pass 1**: Fast + Coup Fort (best case: unseat). This is almost always correct.
- **Pass 2**: If no unseat, do you go again (gambling on unseat) or back off to Standard + Course de Lance (accepting you have lost your window)?
- **Pass 3+**: Stamina is likely below threshold. Charger is now a worse Duelist.

The interesting decision is pass 2 -- "double down or conserve" -- but it only exists if pass 1 fails, and the answer is often math-deterministic: if opponent is Bulwark (GRD 65), you probably cannot unseat them, so backing off is forced. Against another Charger, you double down because both are racing. The counter table offers some wrinkles (Coup Fort is beaten by Coup en Passant and Course de Lance), but a player who just picks Coup Fort every time is not making a large strategic error.

**Rating**: 6/10. One interesting pivot point per match, but the "open" is scripted.

### 1.3 Power Fantasy: STRONG

Landing a Fast + Coup Fort unseat on pass 1-2 is the most satisfying single event in the game. The impact numbers are dramatic (effective MOM ~107.5 * 0.5 = 53.75 base impact contribution alone), and when you cross the unseat threshold against a low-guard opponent, the margin is enormous.

The data supports this: at bare tier, Charger's unseat rate is high against non-Bulwark opponents (Charger vs Technician sees frequent early unseats based on the 67% Bulwark-vs-Charger matchup implying Charger frequently loses to tanky opponents but wrecks squishy ones).

**Moment**: "I chose all-out aggression and it worked -- they never had a chance."

### 1.4 Fun Weakness

Charger in late passes (4-5) or in melee after being unseated is deeply unfun. With GRD 50, CTL 55, and depleted stamina, Charger becomes the worst possible melee combatant. The carryover penalties from being unseated compound with already-low defensive stats. The "fades" part of the identity is accurately modeled but feels punishing rather than tense. There is no "Charger comeback" mechanic.

---

## 2. TECHNICIAN

**Stats**: MOM=64, CTL=70, GRD=55, INIT=59, STA=55 (303 total -- note: actually 303 but displayed as having MOM=64 not 61 as in MEMORY.md; the source file shows 64)
**Identity tag**: "Reactive specialist; shift master"

### 2.1 Identity Clarity: WEAK-TO-MODERATE

Technician's identity is "shift master," but the shift mechanic is the hardest system in the game to understand and leverage. The shift system requires:

1. Pre-shift effective Control >= shift threshold (50/60/70 for Slow/Standard/Fast)
2. Current stamina >= 10
3. Paying 5 STA + 5 INIT penalty (same-stance) or 12 STA + 10 INIT penalty (cross-stance)
4. The shift must be tactically worth the cost

Technician's CTL 70 is indeed the best for shifting. At Standard speed (deltaCTL +0), raw CTL is 70, easily clearing the 60 threshold. At Fast speed (deltaCTL -15), raw CTL is 55 -- barely above the 50 Slow threshold and below the 60 Standard threshold, so even Technician cannot shift at Fast speed in many scenarios.

The problem is that shifts are a reaction to the opponent's reveal. The player must:
- Pick an initial attack blind
- See opponent's attack
- Evaluate whether a shift improves their counter position
- Pay the cost

This is a sophisticated play pattern, but in the current MVP with simultaneous selection, the "see opponent's attack" step requires a separate ShiftDecision phase. The AI personality gives Technician shiftAffinity=3 (highest), confirming the design intent, but the actual shift evaluation code shows shifts only trigger when the score improvement exceeds 5 points. Given the counter bonus is only ~11 points at CTL 70 (4 + 70*0.1), the delta from shifting is modest.

**Verdict**: The identity exists mechanically but is hard to FEEL. A new player picking Technician will not intuitively understand what makes them special. They see "high Control" and think "accurate" -- not "I can change my attack mid-charge."

### 2.2 Decision Quality: HIGH (in theory), MODERATE (in practice)

In theory, Technician has the richest decision tree: pick initial attack considering what you expect the opponent to do, then adjust after the reveal. This is a poker-like read-and-react pattern that rewards prediction.

In practice, the shift threshold system limits when shifts are available, and the cost/benefit often favors just picking the right attack initially. The shift is a "Plan B" that costs real resources (stamina, initiative). The AI data shows Technician's actual shift usage is modest because the evaluation threshold (score > 5) is hard to clear.

The other issue: Technician's stats are middle-of-the-road for everything except CTL. MOM 64 is uninspiring for impact. GRD 55 is below average for defense. INIT 59 is average. STA 55 is tied for lowest. This means Technician's "non-shift" passes feel generic. When you are NOT shifting, you are playing a slightly worse Duelist who happens to have good accuracy.

**Rating**: 7/10 for design ceiling, 5/10 for experienced fun. The decision complexity is there but the payoff is muted.

### 2.3 Power Fantasy: WEAK

There is no "big moment" for Technician. The fantasy should be "I read you perfectly and shifted to counter your attack" -- but the impact of a successful shift is a ~11 point counter bonus, which is significant but invisible to the player. It does not produce an unseat. It does not produce a dramatic number. It produces a modest accuracy/impact advantage that accumulates over 5 passes.

The balance data confirms: Technician has the lowest or second-lowest win rate at every tier (44.8% uncommon, 46.85% giga per balance-tuner-round-8.md). This is the weakest archetype in the game. Even when Technician's shift mechanic works, the outcome is underwhelming.

**Moment**: "I shifted to Course de Lance and gained a counter bonus." This is technically correct but emotionally flat.

### 2.4 Fun Weakness

Technician is the least rewarding archetype to play correctly. High skill expression, low reward. The shift mechanic demands system mastery but delivers incremental advantages. Combined with the lowest STA (55, tied with Tactician) meaning fatigue hits earliest (threshold at 44), Technician often enters passes 3-5 already degraded.

---

## 3. BULWARK

**Stats**: MOM=58, CTL=52, GRD=65, INIT=53, STA=62 (290 total)
**Identity tag**: "Immovable wall; wins on attrition"

### 3.1 Identity Clarity: STRONG

Bulwark is the tankiest archetype and it shows. GRD 65 is the highest in the game and is the only base stat that crosses the softCap knee of 100 at Giga rarity. STA 62 gives a fatigue threshold of 49.6, meaning Bulwark can absorb punishment longer than anyone except Charger (threshold 52).

The defensive attacks reward this: Port de Lance gives +20 deltaGuard, pushing Bulwark's effective guard to 85+ (raw) -- enormous for reducing incoming impact via the guardImpactCoeff (0.18) and raising the unseat threshold (20 + effGuard/15 + STA/20).

A Bulwark at full health using Slow + Port de Lance has:
- Raw GRD: 65 + 20 = 85
- Effective GRD after softCap: 85 (below knee, so linear)
- Guard fatigue factor at full STA: 1.0
- Unseat threshold: 20 + 85/15 + 62/20 = 20 + 5.67 + 3.1 = 28.77

This is a very high bar. The opponent needs an impact margin of ~29 to unseat Bulwark, while Charger's unseat threshold (with Coup Fort's -5 GRD, so GRD 45) is only about 20 + 45/15 + 65/20 = 20 + 3 + 3.25 = 26.25. The difference is meaningful.

**Verdict**: "Immovable wall" is accurately delivered. You feel sturdy.

### 3.2 Decision Quality: LOW

This is Bulwark's fundamental problem. The optimal Bulwark strategy is: Slow + Port de Lance, every single pass. Occasionally Course de Lance if the opponent is being very defensive.

Why? Because Bulwark's win condition is "survive to cumulative score victory or melee exhaust." Every pass where Bulwark is not unseated is a pass Bulwark is winning the attrition game. Slow speed gives +15 CTL, +5 STA. Port de Lance gives +10 CTL, +20 GRD, -8 STA. The net stamina cost is only -3 per pass (Slow +5, PdL -8). Bulwark can sustain this for all 5 passes comfortably.

The AI personality confirms: speedMods [2, 1, -2] (strongly prefer Slow), stancePrefs [-1, 1, 3] (strongly prefer Defensive). The Bulwark AI is essentially a script: pick Slow, pick Defensive, wait for the opponent to run out of gas.

For the player, this means:
- Passes 1-2: Pick Slow + Port de Lance. Wait.
- Passes 3-4: Opponent is fatigued. Maybe switch to Course de Lance for some impact.
- Pass 5: You win on cumulative score because you still have stamina.

There is almost no reason to deviate. Shifting is irrelevant (Bulwark's CTL 52 barely clears the Slow threshold of 50, and cannot shift at Standard or Fast). Aggressive attacks sacrifice Bulwark's primary advantage for negligible gain.

**Rating**: 3/10. The "decision" is made at archetype select, not during the match.

### 3.3 Power Fantasy: MODERATE

The power fantasy is "nothing can touch me" -- and it works. Bulwark's 58.4% uncommon win rate and dominant matchup against Charger (67-68%) delivers on the fantasy of the impenetrable knight. The satisfaction comes from watching the opponent exhaust themselves against your shield.

But it is a passive satisfaction. There is no "Bulwark moment" -- no dramatic event, no decisive blow, no climactic turn. You grind. You win by default. Some players enjoy this (the "control player" archetype in card games), but it is inherently less exciting than landing a devastating charge.

**Moment**: "My opponent spent all their stamina and I am still standing." Satisfying, but slow.

### 3.4 Fun Weakness

Bulwark mirrors are the worst matchup in the game. Two Bulwarks picking Slow + Port de Lance for 5 passes produces minimal impact differential and a near-coinflip cumulative score. The match is decided by tiny accuracy deltas, not by any player decision. This is essentially watching paint dry.

The 290 total stat points (10 below the 300 standard) reflect a balance tax for Bulwark's defensive strength, but it means Bulwark is also mediocre at everything except not dying. When forced into melee (which is less likely because Bulwark is hard to unseat), Bulwark has no offensive tools. MOM 58 and CTL 52 produce uninspiring melee impact.

---

## 4. TACTICIAN

**Stats**: MOM=55, CTL=65, GRD=50, INIT=75, STA=55 (300 total)
**Identity tag**: "Tempo control; shift priority"

### 4.1 Identity Clarity: MODERATE-TO-STRONG

Tactician's identity is built around INIT 75, the highest in the game. Initiative matters in two places:
1. **Accuracy formula**: ACC = effCTL + (effINIT/2) - (oppMOM/4) + counterBonus. At Standard speed (+10 INIT), Tactician has raw INIT 85, contributing +42.5 to accuracy. This is a significant edge.
2. **Shift priority**: When both players shift, higher INIT goes second (advantage -- you see the opponent's shift first). Tactician with INIT 75 wins shift priority against every other archetype in the game.

Combined with CTL 65 (second highest, tied with Technician for accuracy), Tactician is the most precise attacker. The identity of "I hit what I aim at and I move first" is mechanically supported.

The weakness is clear too: MOM 55 is the lowest, GRD 50 is tied for lowest, STA 55 is tied for lowest. Tactician is a precision fighter who cannot take or deliver big hits.

**Verdict**: The identity is clear if you understand the accuracy formula. The "tempo control" flavor is less obvious -- it manifests as shift priority and initiative-based speed advantages, which require system knowledge to appreciate.

### 4.2 Decision Quality: MODERATE-TO-HIGH

Tactician has interesting speed choices because Initiative interacts differently with each:
- **Standard** (+10 INIT): Total INIT 85. Shift threshold 60, and CTL 65 clears it. This is the "default safe" option.
- **Fast** (+20 INIT): Total INIT 95, but CTL drops to 50, barely meeting the Fast shift threshold of 70... wait, raw CTL is 65-15=50, which does NOT clear the 70 Fast threshold. So Tactician cannot shift at Fast speed. But the +20 INIT contributes +10 more accuracy.
- **Slow** (+0 INIT, +15 CTL): Total INIT 75, CTL 80. This makes Tactician a control monster who can shift freely but sacrifices MOM (-15).

The attack selection has more variance than Charger or Bulwark because Tactician's moderate stats do not overwhelmingly favor one stance. The AI stancePrefs are [0, 2, 0] -- balanced-leaning, but without a strong pull. Tactician benefits from counter-reading more than from raw stat exploitation.

The shift priority mechanic adds a real decision layer: Tactician can afford to pick an "okay" initial attack knowing they will likely shift after seeing the opponent. At Standard speed with CTL 65 (effective CTL ~65 * fatigue), Tactician clears the 60 threshold comfortably, enabling reliable shifts.

**Rating**: 7/10. Multiple meaningful speed/attack combinations, and the shift priority is a genuine strategic asset.

### 4.3 Power Fantasy: MODERATE

The power fantasy is "I am always one step ahead." When Tactician shifts after the opponent and lands a counter, it feels like a tactical read. The accuracy advantage means Tactician's hits land more consistently, which is satisfying in a subtle way.

But the moments are undramatic. Tactician does not produce big numbers. Tactician's best impact scenario (Standard + Bris de Garde: MOM 55+10=65, CTL 65+15=80) is respectable but not exciting. Unseats are rare because MOM 55 cannot generate the impact differential needed against healthy opponents.

The 54.5% uncommon win rate (balance-tuner-round-8.md) shows Tactician is slightly advantaged in the early game, which is correct for an INIT-dominant archetype, but the advantage is incremental, not dramatic.

**Moment**: "I shifted to the perfect counter and won on accuracy." Cerebral but not visceral.

### 4.4 Fun Weakness

Tactician's identity collapses against opponents who do not shift. If the opponent is a Charger who just rams Fast + Coup Fort every pass, Tactician's shift priority is irrelevant (the opponent never shifts). Tactician's INIT advantage in the accuracy formula is real but the MOM 55 means the impact differential is rarely enough to unseat the Charger before the Charger's raw MOM unseats Tactician. The matchup becomes "can I outscore them over 5 passes with accuracy alone?" -- which is viable but passive.

---

## 5. BREAKER

**Stats**: MOM=62, CTL=60, GRD=55, INIT=55, STA=60 (292 total)
**Identity tag**: "Guard shatter; anti-Bulwark"

### 5.1 Identity Clarity: STRONG

Breaker has the cleanest unique mechanic: 25% guard penetration (`breakerGuardPenetration: 0.25`). This is hardcoded in both phase-joust.ts and phase-melee.ts. When Breaker attacks, the opponent's effective guard is multiplied by 0.75 for the impact calculation.

Against Bulwark (GRD 65 + Port de Lance +20 = 85 raw guard), this means Breaker sees effective guard of 63.75 instead of 85. The guardImpactCoeff is 0.18, so the impact benefit is (85 - 63.75) * 0.18 = 3.83 points per pass. Over 5 passes, that is ~19 impact points of advantage -- significant for cumulative scoring.

The identity of "anti-tank specialist" is clear and unique. No other archetype has a passive combat mechanic. Breaker's stats are deliberately generalist (close to Duelist's all-60s) because the guard penetration IS the identity.

**Verdict**: Simple, clear, effective. You pick Breaker when you see Bulwark across the field.

### 5.2 Decision Quality: MODERATE

Breaker's decision space is similar to Duelist (generalist stats, no extreme pull toward any stance) but with a meta-game twist: Breaker wants to maximize the number of high-impact passes to exploit guard penetration. This means:

- Against Bulwark: Aggressive attacks are more valuable because guard penetration amplifies their effectiveness. Fast + Bris de Garde (MOM 62+15+10=87, CTL 60-15+15=60) is a strong line.
- Against non-Bulwark: Guard penetration matters less (opponent GRD is 50-60, so 25% penetration saves only 2-3 impact points). Breaker plays like a slightly worse Duelist.

The AI personality confirms: stancePrefs [2, 0, 0] and meleeAggression=3, the highest in the game. Breaker is coded to be aggressive, which mechanically synergizes with guard penetration.

The decision tree is: "Am I fighting a high-guard opponent? If yes, go aggressive. If no, play generalist." This is a real decision but it is made at matchup selection, not moment-to-moment.

**Rating**: 5/10. The meta-game decision is interesting. The in-match decisions are generic.

### 5.3 Power Fantasy: MODERATE-TO-STRONG

The Breaker fantasy is "I crack the uncrackable." Against Bulwark, this is delivered: Breaker has a 60-63% win rate against Bulwark at uncommon (balance-tuner-round-8.md matrix shows Bulwark vs Breaker at 60%, meaning Breaker wins 40% -- wait, that is Bulwark as P1 winning 60%. Looking at Breaker as P1 vs Bulwark: 38%. Hmm, that is actually poor.)

Let me re-read the matrix. Uncommon Run 1 (N=1000):
```
              charge techni bulwar tactic breake duelis
breaker          50     50     38     42     52     41
```

Breaker as P1 vs Bulwark: 38%. That means Bulwark still beats Breaker at uncommon, even with guard penetration. The anti-Bulwark identity is not being delivered at uncommon.

At giga:
```
breaker          56     58     52     53     51     58
```

Breaker as P1 vs Bulwark: 52%. Better, but barely above coinflip. Breaker's guard penetration is more impactful at high gear tiers where Bulwark's GRD exceeds the softCap knee.

**Moment**: At giga, "I punched through their guard" works. At base/uncommon, the anti-Bulwark fantasy underdelivers.

### 5.4 Fun Weakness

Breaker's 292 total stat points (8 below standard) and generalist spread mean that against non-Bulwark opponents, Breaker is just a weaker Duelist. The guard penetration saves ~2-3 impact points per pass against GRD 50-55 opponents, which is nearly unnoticeable. Breaker's win rate against non-Bulwark opponents at uncommon ranges from 41-50% -- strictly mediocre to weak.

The identity is "anti-Bulwark" but Bulwark is only one of six opponents. In 5 out of 6 matchups, Breaker has no distinguishing trait.

---

## 6. DUELIST

**Stats**: MOM=60, CTL=60, GRD=60, INIT=60, STA=60 (300 total)
**Identity tag**: "Balanced generalist; adaptable"

### 6.1 Identity Clarity: WEAK

This is the fundamental problem with Duelist: "balanced generalist" is the absence of identity. Duelist has no spike stat, no unique mechanic, no situation where a player thinks "this is a Duelist moment." Every stat is exactly 60, making Duelist the median of every calculation.

The AI personality reflects this: speedMods [0, 1, 0], stancePrefs [1, 1, 1], shiftAffinity=1, meleeAggression=0. Duelist is the default, the blank slate, the control group.

In fighting games, the "all-rounder" archetype works when they have a unique tool or a distinctive rhythm. Ryu in Street Fighter has the fireball-uppercut pattern. Duelist in this system has... being average at everything.

**Verdict**: Functional as a learning archetype. Non-existent as a fantasy.

### 6.2 Decision Quality: MODERATE

Ironically, Duelist might have the most "pure" decision quality because no stat extreme pushes toward a default strategy. Every speed and attack is roughly equally viable, so the decision is entirely about reading the opponent. This creates genuine rock-paper-scissors engagement.

However, "no dominant strategy" also means "no strategic anchor." A player who does not understand the counter tables will pick randomly and perform about as well as someone who plays optimally, because the optimal play for Duelist is always "just slightly better than the median" rather than "exploiting an asymmetric advantage."

**Rating**: 6/10. Pure decision quality exists but lacks payoff differentiation.

### 6.3 Power Fantasy: VERY WEAK

There is no Duelist power fantasy. The best Duelist moment is "I outplayed them with pure skill despite having no advantages" -- which is a valid fantasy in competitive games but requires the player to feel that their decisions mattered. In a system with 30% random variance (medium AI) and simultaneous blind selection, individual decisions rarely feel pivotal.

The balance data shows Duelist at 53.5% uncommon and 50.15% giga -- the most perfectly balanced archetype. This is a design success for balance but a failure for fun. Perfectly balanced = perfectly forgettable.

**Moment**: None. "I played an average game and won slightly more than I lost."

### 6.4 Fun Weakness

Duelist is the archetype you pick when you do not know what to pick. It serves an important onboarding function (no complexity, no trap decisions), but it has zero replay value. Once a player understands the system, there is never a reason to choose Duelist over a specialist archetype -- the specialists are more interesting in every dimension.

---

## 7. OVERALL ASSESSMENT

### Least Fun Archetype: BULWARK

Despite being the most competitively successful archetype (58.4% win rate at uncommon, dominant in multiple matchups), Bulwark is the least fun to play. The reasons:

1. **Decision space is near-zero.** The optimal line (Slow + Port de Lance, every pass) is so dominant that deviating is a mistake. There is one correct play pattern and it never changes.

2. **Passive win condition.** Bulwark wins by not losing. There is no climactic moment, no decisive blow, no "I did it!" event. The match ends and Bulwark has more cumulative impact because the opponent ran out of stamina first.

3. **Mirror matchups are dreadful.** Bulwark vs Bulwark is a 5-pass slog with near-zero player agency.

4. **Punishes the OPPONENT's fun.** Playing against Bulwark is also unfun. Charger's big moment (the devastating charge) is neutralized by Bulwark's guard wall. Technician's shifts matter less against someone who just turtles. Breaker is specifically designed to counter Bulwark but fails to do so at lower tiers.

5. **Low stat total (290) makes off-plan play terrible.** If Bulwark tries to be aggressive, their MOM 58 and CTL 52 produce anemic results. There is no viable "aggressive Bulwark" line.

**Runner-up for least fun: Duelist** (no identity, no moments, no replay value).

### Fun Tier List

| Tier | Archetype | Fun Score | Notes |
|------|-----------|-----------|-------|
| A | Charger | 8/10 | Clear fantasy, dramatic moments, real risk/reward |
| B+ | Tactician | 7/10 | Rich decision tree, shift priority mechanic, cerebral |
| B | Technician | 6/10 | High-skill ceiling but reward is muted; lowest win rate |
| B- | Breaker | 5.5/10 | Anti-Bulwark fantasy only works at high gear tiers |
| C+ | Duelist | 4/10 | Good for learning, no replay value |
| C | Bulwark | 3/10 | Wins by autopilot; zero drama |

---

## 8. IMPROVEMENT PROPOSALS

These proposals target **fun and feel**, not balance. They should not meaningfully alter win rates but should increase player engagement, decision frequency, and satisfaction.

### Proposal 1: Bulwark "Counter-Charge" Mechanic (Passive)

**Problem**: Bulwark has no offensive moment and no reason to deviate from Slow + Defensive.

**Concept**: After Bulwark successfully defends (absorbs an impact that would have exceeded the unseat threshold against a lower-GRD archetype), their NEXT pass gains a temporary Momentum bonus representing the kinetic energy of deflecting the charge.

**Implementation sketch**: Track "absorbed impact" per pass. If the impact differential against Bulwark exceeds some threshold (say 15 points) but does not unseat, Bulwark gains +10 MOM on the next pass. This is a "stored energy" mechanic.

**Why this helps fun**:
- Creates a DECISION: "Do I stay defensive to absorb the charge, then go aggressive next pass to exploit the bonus?"
- Gives Bulwark an offensive MOMENT: the counter-charge.
- Punishes opponents who recklessly attack Bulwark (currently, attacking Bulwark is already bad, but this adds a thematic consequence).
- Does NOT change Bulwark's defensive strength -- it adds an offensive option that requires setup.

**Risk**: Could make Bulwark even stronger (already 58.4% at uncommon). The MOM bonus would need to be small enough that it creates a new option without being clearly better than continued defense. The bonus should decay if not used (one-pass window).

### Proposal 2: Technician "Precision Bonus" on Successful Shifts

**Problem**: Technician's shifts cost stamina and initiative but provide only the standard counter bonus. The reward does not match the skill expression.

**Concept**: When Technician (specifically, archetype.id === 'technician') successfully shifts to an attack that counters the opponent, the counter bonus is amplified by 50% (e.g., from ~11 to ~16.5).

**Implementation sketch**: In the counter resolution, if the counter-winning player is a Technician AND the winning attack was reached via shift (shifted === true), multiply the counter bonus by 1.5.

**Why this helps fun**:
- Makes Technician's shifts FEEL impactful. The current ~11 point swing becomes ~16.5 -- enough to noticeably change impact scores.
- Rewards the high-skill play pattern that defines Technician's identity.
- Creates a visible "Technician moment" when they shift and the enhanced counter bonus produces a dramatic impact differential.
- Incentivizes risk-taking: cross-stance shifts (12 STA, 10 INIT penalty) become worthwhile because the enhanced counter bonus more than compensates.

**Risk**: Could make Technician too strong in matchups where shifting is easy (e.g., vs predictable opponents). Balance-tuner-round-8 shows Technician at 44-47% across all tiers, so a moderate buff to their core mechanic is justified on both fun AND balance grounds.

### Proposal 3: Duelist "Adaptive Mastery" Mechanic (Passive)

**Problem**: Duelist has no identity, no unique mechanic, and no replay value.

**Concept**: Duelist gains a small bonus (+3-5 to a relevant stat) when they use an attack from a DIFFERENT stance than their previous pass. This rewards "stance dancing" -- cycling through Aggressive, Balanced, and Defensive -- and gives Duelist a unique rhythm that no other archetype has.

**Implementation sketch**: Track Duelist's previous attack stance. If the current attack is in a different stance, add +3 to the primary stat of that stance (MOM for Aggressive, CTL for Balanced, GRD for Defensive). This is applied as a delta in the effective stats calculation, similar to how speed deltas work.

**Why this helps fun**:
- Creates a DECISION every pass: "Do I switch stances to get the bonus, or stay in my current stance for the counter advantage?"
- Gives Duelist a RHYTHM and IDENTITY: "the knight who is always changing style."
- Rewards system mastery: a player who understands all three stances and their interactions is rewarded for fluidity.
- The bonus is small enough (+3 to one stat) that it does not create a dominant strategy -- it is an incentive to vary play, not a guarantee of victory.

**Risk**: Low. +3 to one stat is about half the delta from a speed choice. It makes Duelist slightly better at everything when played optimally (which fits the generalist identity) without creating a broken line.

### Proposal 4: Breaker "Guard Crack" Visual/Mechanical Escalation

**Problem**: Breaker's guard penetration is invisible. The player sees impact numbers change but does not perceive the guard reduction.

**Concept**: Make Breaker's guard penetration escalate over consecutive passes against the same opponent. Pass 1: 25% penetration (current). Pass 2: 30%. Pass 3: 35%. Pass 4: 40%. Pass 5: 45%. Each pass, the "crack" widens. This is a purely additive escalation on the existing `breakerGuardPenetration` value.

**Why this helps fun**:
- Creates a NARRATIVE: "I am slowly breaking through their armor." This is the Breaker fantasy.
- Creates a DECISION for the opponent: "Do I keep using defensive attacks (which are being increasingly negated) or switch to aggressive to try to KO Breaker before the penetration becomes overwhelming?"
- Makes Breaker games escalate toward a climax. Currently, Breaker games feel flat because the 25% penetration is constant. With escalation, pass 5 is the "will the wall crack?" moment.
- Specifically fixes the Breaker vs Bulwark underperformance at lower tiers, where the flat 25% is insufficient to overcome Bulwark's raw GRD advantage.

**Risk**: Moderate. This could make Breaker very strong in 5-pass games. The escalation values would need tuning. A simpler alternative: instead of per-pass escalation, grant +5% penetration per pass only against opponents using Defensive stance attacks. This ties the mechanic to the opponent's choices and creates counterplay (stop being defensive to stop the crack).

### Proposal 5: Charger "Second Wind" Recovery Event

**Problem**: Charger in late passes or melee is a spent force with no comeback mechanic. The "fades" part of the identity is accurate but punishing.

**Concept**: If Charger's stamina drops below 25% (fatigue threshold * 0.5) AND Charger is losing on cumulative impact, grant a one-time stamina recovery of 10 and a one-pass MOM boost of +10. This is the "desperate charge" -- one last attempt to turn the tide.

**Why this helps fun**:
- Creates a DRAMATIC MOMENT: "I was fading but I found one last burst!"
- Creates tension for both players: the opponent knows the desperate charge is coming and must decide whether to play safe or try to exploit Charger's weakness.
- Fits the Charger identity perfectly -- "wins fast or fades" becomes "wins fast, fades, but has one last gasp."
- The condition (below 25% STA AND losing) ensures this only triggers in the "desperation" scenario, not as a reliable strategy.

**Risk**: Could create a formulaic pattern (burn fast, trigger second wind, charge again). The conditions need to be specific enough that it is a lifeline, not a strategy. One-time-per-match limit is essential.

---

## 9. ATTACK-LEVEL OBSERVATIONS

### Joust Counter Table Asymmetries

| Attack | Beats | Beaten By | Win/Loss Count |
|--------|-------|-----------|---------------|
| Coup Fort | 1 (PdL) | 2 (CeP, CdL) | 1/2 |
| Bris de Garde | 2 (PdL, CdP) | 1 (CdL) | 2/1 |
| Course de Lance | 2 (CF, BdG) | 1 (PdL) | 2/1 |
| Coup de Pointe | 1 (PdL) | 2 (BdG, CeP) | 1/2 |
| Port de Lance | 2 (CdL, CeP) | 3 (CF, BdG, CdP) | 2/3 |
| Coup en Passant | 2 (CF, CdP) | 1 (PdL) | 2/1 |

**Observations**:
- **Bris de Garde and Course de Lance** are structurally favored (2 wins, 1 loss each). These are the "safe" picks.
- **Coup Fort and Coup de Pointe** are structurally disadvantaged (1 win, 2 losses each). These are "risky" picks.
- **Port de Lance** is the most countered attack in the game (3 losses), but its defensive deltas (+20 GRD) partially compensate by making the impact differential smaller even when countered.
- **Coup en Passant** is the sleeper pick: 2 wins, 1 loss, Defensive stance (counter-triangle advantage vs Aggressive), and decent deltas (+5 MOM, +15 CTL, +10 GRD, -14 STA). This is arguably the best risk-adjusted attack in the joust.

**Fun implication**: Charger's signature move (Coup Fort) is one of the riskiest attacks in the game. This is thematically correct (high risk, high reward) but means the Charger player is fighting against the counter table. Bris de Garde (same Aggressive stance, 2/1 counter ratio) is often the better choice mechanically, but it is less thematically satisfying because its deltas are less extreme (+10 MOM vs +25 MOM).

### Melee Counter Table

| Attack | Beats | Beaten By | Win/Loss Count |
|--------|-------|-----------|---------------|
| Overhand Cleave | 2 (GH, RS) | 2 (MC, PT) | 2/2 |
| Feint Break | 1 (PT) | 1 (RS) | 1/1 |
| Measured Cut | 2 (OC, RS) | 1 (GH) | 2/1 |
| Precision Thrust | 1 (OC) | 2 (FB, RS) | 1/2 |
| Guard High | 1 (MC) | 1 (OC) | 1/1 |
| Riposte Step | 2 (FB, PT) | 2 (OC, MC) | 2/2 |

The melee table is more symmetric than the joust table, which is good -- melee should feel like a fair duel. **Measured Cut** is the melee equivalent of Course de Lance: 2 wins, 1 loss, Balanced stance, efficient deltas. It is the safe default.

---

## 10. STRUCTURAL OBSERVATIONS

### The Stamina Economy is the Real Game

Across all archetypes, the most impactful player decisions are about stamina management:
- **Speed choice** is primarily a stamina decision: Fast costs -5, Standard is neutral, Slow gains +5.
- **Attack choice** is heavily constrained by stamina cost: Coup Fort (-20) vs Port de Lance (-8) is a 12-point stamina swing.
- **Shift cost** (5-12 STA) is a real decision factor.
- **Fatigue** (stamina * 0.8 threshold) determines when stats start degrading.

This is well-designed -- stamina creates tension and consequences. But it means archetypes with higher STA (Charger 65, Bulwark 62) have a structural advantage because they can make more decisions before fatigue constrains them. Technician and Tactician (both STA 55) feel this most acutely.

### The Shift Mechanic is Underutilized

The shift system is the highest-skill mechanic in the game, but only Technician and Tactician can use it reliably. The thresholds are:
- Slow: CTL >= 50 (every archetype can shift)
- Standard: CTL >= 60 (Technician 70, Tactician 65, Duelist 60 -- three archetypes)
- Fast: CTL >= 70 (only Technician at base CTL 70, and only barely)

At Fast speed, almost no one shifts. At Slow speed, everyone can shift but Slow + Defensive is the conservative line where shifting is rarely needed (you are already in the safe stance). The sweet spot is Standard speed, where the shift decision is genuinely interesting but only available to 3/6 archetypes.

This means the most interesting mechanic in the game is inaccessible to half the roster. Charger (CTL 55), Bulwark (CTL 52), and Breaker (CTL 60) at Standard speed have effective CTL of 55, 52, and 60 respectively. Only Breaker barely clears the 60 threshold, and only at full stamina before fatigue degrades their CTL.

### Melee Phase Identity Crisis

The melee phase has no speed selection and no shifts. This strips out the two most interesting decision dimensions. Melee is a pure rock-paper-scissors game with stat-weighted outcomes. For archetypes whose identity is built on speed/shift mechanics (Tactician, Technician), melee is a phase where their identity disappears.

Breaker is the exception: guard penetration works in both phases, maintaining Breaker's identity through the transition. This is good design for Breaker but highlights the problem for others.

---

## 11. SUMMARY OF RECOMMENDATIONS

| Priority | Proposal | Target Archetype | Fun Impact |
|----------|----------|-----------------|------------|
| HIGH | Enhanced counter bonus on shift | Technician | High -- makes core mechanic satisfying |
| HIGH | Stance-dance adaptive mastery | Duelist | High -- creates identity from scratch |
| MEDIUM | Counter-charge stored energy | Bulwark | Medium -- adds offensive option without reducing defense |
| MEDIUM | Guard crack escalation | Breaker | Medium -- creates narrative arc and fixes low-tier underperformance |
| LOW | Second wind recovery | Charger | Low -- Charger is already fun; this adds a safety net |

The overall goal: every archetype should have at least one moment per match where the player thinks "THIS is why I picked this archetype." Currently, only Charger consistently delivers that moment. The proposals aim to close that gap.
