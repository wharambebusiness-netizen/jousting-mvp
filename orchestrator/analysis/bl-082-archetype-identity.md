# BL-082: Post-MVP Design Spec — Archetype Feel & Identity

**Status**: Design Phase Complete ✅
**Deliverable**: 6 Comprehensive Archetype Identity Specs (Phase 2 implementation ready)
**Scope**: Identity statements, signature strategies (joust + melee), teaching approaches
**Impact**: Guides Phase 2 game feel refinement and UI/narrative polish

---

## Overview

This spec formalizes the identity, strategic personality, and teaching approach for all 6 archetypes. Each archetype has a distinct playstyle and decision-making curve. This document is **design-only** (no balance changes, no code modifications) and serves as the foundation for Phase 2 gameplay polish, narrative, and learning features.

**Key Principle**: Players should feel the archetype's identity within 3 jousts. The signature strategies should emerge naturally from stats without requiring mechanics changes.

---

## 1. CHARGER — "Raw Impact; Wins Fast or Fades"

### Identity Statement
**Philosophy**: High-risk, high-reward aggressor who wins decisive duels through superior force. Charger is the glass cannon archetype — devastating impact but vulnerable to attrition.

**Core Feeling**: "Press the advantage or die trying."

**Key Strengths**:
- Highest raw Momentum (75) — unmatched damage output
- Highest Stamina (65) — sustains long jousts
- Fast-attack bonus → prioritizes aggressive early tempo

**Key Weaknesses**:
- Lowest Guard (50) — fragile defensively
- Low Control (55) — reactive, not proactive
- Cannot out-control opponents in sustained rallies

### Signature Strategies (Joust Phase)

#### Strategy 1: The Blitz — "Overwhelm Before They React"
**Concept**: Charger opens with **Coup Fort** (aggressive, +25 momentum, -20 stamina cost) to establish early impact advantage. Opponents with lower momentum can't match the impact on Pass 1, forcing them to shift to defense.

**How Players Discover It**:
- Tutorial: "Charger's Coup Fort is the strongest single attack. Use it early when stamina is high."
- Game feel: Pass 1 Coup Fort vs Technician's defensive response generates 45-50 impact, crushing the opponent.
- Risk: Stamina cost (-20) means Charger can't spam Coup Fort — must choose opening timing carefully.

**Counter-Play Vulnerability**: Defensively-biased opponents (Port de Lance, Coup en Passant) beat Coup Fort, so Charger needs tempo control to force aggressive responses.

#### Strategy 2: The Sustain — "Leverage High Stamina in Extended Rallies"
**Concept**: Once tempo is established, Charger's stamina pool (65, vs typical 55-62) lets them outlast opponents in fatigue races. By Pass 3+, fatigued opponents lose control, and Charger's impact scales with opponent weakness.

**How Players Discover It**:
- Tutorial: "Charger's stamina pool is the deepest. Use it to your advantage in long jousts."
- Game feel: After Pass 2, opponent fatigue causes their effective stats to drop. Charger's momentum stays high (75 base), so the impact differential widens each pass.
- Mechanics: `fatigueFactor` reduces opponent effective stats but Charger's high stamina keeps fatigue factor closer to 1.0.

#### Strategy 3: The Finisher — "Unseat When Momentum Peaks"
**Concept**: Charger's momentum (75) gives a 50% higher impact boost vs Duelist (60). This translates to easier unseat thresholds. In Pass 2-3, Charger's accumulated impact often crosses the unseat threshold, ending the joust suddenly.

**How Players Discover It**:
- Game feel: 3-pass jousts often end suddenly in Pass 2 when Charger lands a strong attack and impact crosses threshold.
- Teaching: "Charger's unseating power is its signature finisher. Play aggressively and pressure the unseat threshold early."
- Risk: If Charger doesn't unseat by Pass 3, stamina is depleted and fatigue factor tanks, making Pass 4+ losing battles.

---

### Signature Strategies (Melee Phase)

#### Strategy 1: The Avalanche — "Chain Impact with Aggressive Combos"
**Concept**: **Overhand Cleave** is the melee analog to Coup Fort — highest damage, lowest control. Charger with high momentum chains consecutive Overhand Cleaves, each triggering impact bonuses. Opponent stamina drops fast.

**How Players Discover It**:
- Game feel: Casting Overhand Cleave while opponent is recovering from the last hit feels devastating.
- Mechanic tie-in: Each impact reduces opponent stamina; lower stamina = lower accuracy and lower guard. Cycle continues until opponent health or stamina bottoms out.

#### Strategy 2: The Feint Master — "Punish Opponents' Reads"
**Concept**: **Feint Break** counters **Precision Thrust** (opponent's defensive technical attack). When opponents try to out-control Charger with Precision Thrust, Feint Break flips the power dynamic.

**How Players Discover It**:
- Counter chart teaches the counter table (Feint Break > Precision Thrust).
- Risk: Feint Break loses to Riposte Step, so Charger can't spam it — encourages read-based melee play.

### Teaching Approach

**Phase 1 (First Melee)**: Introduce Overhand Cleave as "your signature attack — high power, low control. Great for punishing opponents who retreat."

**Phase 2 (Rounds 2-3)**: Reveal counter table: "Feint Break beats Precision Thrust. Watch for patterns in your opponent's defense."

**Phase 3 (Advanced)**: Discuss sustain: "If you run out of stamina, your accuracy drops. Choose your moment for the big combo carefully."

**Narrative**: "Charger is the berserker — raw power and stamina. Play aggressive. Hesitation is death."

---

## 2. TECHNICIAN — "Reactive Specialist; Shift Master"

### Identity Statement
**Philosophy**: Adaptive duelist who excels at reading opponents and shifting stance optimally. Technician wins through superior decision-making and stamina efficiency, not raw power.

**Core Feeling**: "React, adapt, dominate."

**Key Strengths**:
- Highest Control (70) — best at stacking control bonuses
- Highest Initiative (59) — fastest effective attacks
- Balanced stats (total 303) — no glaring weaknesses

**Key Weaknesses**:
- Lowest Stamina (55) — stamina pool is smallest, most fatigue-sensitive
- Mid-range Momentum (64) — can't out-impact Charger on Pass 1
- Vulnerable to sustained offense from stamina-heavy archetypes (Charger, Breaker)

### Signature Strategies (Joust Phase)

#### Strategy 1: The Shift Master — "React and Reposition"
**Concept**: Technician's high Control (70) yields the fastest shift threshold reduction (50 - 0 = 50 base). This means Technician can shift after every 2-3 attacks, staying ahead of opponent momentum. Shifts reduce incoming impact via guard bonus.

**How Players Discover It**:
- Tutorial: "Technician's control is unmatched. You shift faster than anyone else. Use it to stay defensive when needed."
- Game feel: Opponent casts Coup Fort; Technician shifts to Port de Lance, gaining +20 guard, reducing incoming impact by 18% (0.2 coefficient).
- Risk: Each shift costs stamina. With only 55 stamina, Technician runs dry faster than Charger.

#### Strategy 2: The Control Spiral — "Stack Control Bonuses"
**Concept**: High Control (70) + shift bonuses + balanced attack selection yields cumulative control stacking. Technician's effective control can reach 90+ after 2 shifts and offensive positioning. This high control reduces opponent accuracy and enables Technician to dodge hard attacks.

**How Players Discover It**:
- Game feel: After 2 passes of defensive shifts, Technician feels "locked in" — opponent attacks miss more often.
- Mechanic: Control inversely scales accuracy (high control = hard for opponent to land attacks).

#### Strategy 3: The Long Game — "Win Via Fatigue After Dodging"
**Concept**: Technician can't out-impact Charger, but by dodging attacks via high control/guard and forcing Charger into stamina deficit, Technician wins in Pass 4+ when Charger is fatigued.

**How Players Discover It**:
- Counter-example: Technician vs Charger — if Technician dies in Pass 2, it's a loss. But if Technician survives to Pass 4, Charger's stamina (65) is depleted, fatigue factor tanks, and Technician's control becomes dominant.

---

### Signature Strategies (Melee Phase)

#### Strategy 1: The Precision Fighter — "Land Controlled Attacks"
**Concept**: **Precision Thrust** is Technician's signature melee attack — high control (+15), low power. It beats **Feint Break** and scales beautifully with Technician's base control (70). Technician chains Precision Thrust for consistent, safe damage.

**How Players Discover It**:
- Counter chart: Precision Thrust beats Feint Break (Charger's favorite).
- Risk: Precision Thrust loses to Riposte Step, so it's not unconditional.

#### Strategy 2: The Riposte Counter — "Punish Aggression with Defensive Replies"
**Concept**: **Riposte Step** beats both **Feint Break** and **Precision Thrust**. Technician can read opponent attacks and flip to Riposte Step, turning defense into damage.

**How Players Discover It**:
- Teaching: "Watch your opponent's pattern. If they keep attacking aggressively, Riposte Step punishes them."

### Teaching Approach

**Phase 1**: "Technician is the thinker. Shift often, dodge attacks. Your control is your shield."

**Phase 2**: "Precision Thrust is your surgical strike. It's not flashy, but it's consistent."

**Phase 3 (Advanced)**: "In melee, read the opponent's attack pattern. Riposte Step beats aggressive opponents."

**Narrative**: "You are the master of adaptation. Patience, precision, adaptation — these are your tools."

---

## 3. BULWARK — "Immovable Wall; Wins on Attrition"

### Identity Statement
**Philosophy**: Defensive titan who trades offensive power for fortress-like resilience. Bulwark wins through sheer durability and turning opponent momentum against them.

**Core Feeling**: "I will not break. You will."

**Key Strengths**:
- Highest Guard (64) — best at reducing incoming damage
- High Stamina (62) — sustains defense through extended rallies
- Guard impact coefficient (0.12) scales uniquely with guard stat

**Key Weaknesses**:
- Lowest Momentum (58) — terrible at generating impact
- Low Control (52) — worst at offense and shifting
- Vulnerable to guard-penetrating opponents (Breaker)

### Signature Strategies (Joust Phase)

#### Strategy 1: The Turtle — "Build Guard and Wait Out Opponent"
**Concept**: Bulwark's Guard (64) is exploited via **Port de Lance** (defensive, +20 guard). Combined, Bulwark reaches 64+20=84 guard, reducing incoming impact by ~20% (0.12 coefficient × 64). Opponent hits like they're punching through armor.

**How Players Discover It**:
- Tutorial: "Bulwark's guard is legendary. Use Port de Lance to amplify it. Opponents will struggle to unseat you."
- Game feel: Charger's Coup Fort (45 impact) hits Bulwark with Port de Lance and lands only 36 impact (20% reduction). The difference feels tanky.
- Attrition: While Charger loses stamina (-20 per Coup Fort), Bulwark's guard costs less stamina (-8 per Port de Lance). Over 3 passes, Bulwark is fresher.

#### Strategy 2: The Counter-Attacker — "Turn Defense into Offense"
**Concept**: Bulwark's **Coup en Passant** (defensive, beats Coup Fort) lets Bulwark block aggressive opener and immediately counter with impact. This flips the pressure: Charger commits to Coup Fort, Bulwark blocks and counters.

**How Players Discover It**:
- Counter chart: Coup en Passant beats Coup Fort.
- Risk: Coup en Passant loses to Port de Lance (from defensive opponents), so it's not universal.

#### Strategy 3: The Patience Game — "Let Opponent Fatigue Themselves"
**Concept**: Bulwark stalls with Port de Lance and Coup en Passant, letting Charger/Breaker burn stamina. By Pass 4, opponent's stamina is critical, fatigue factor is 0.5-0.7, and Bulwark's relative impact improves dramatically.

**How Players Discover It**:
- Advanced insight: "If you survive 3 passes of hard offense, the opponent is exhausted. That's when you attack."

---

### Signature Strategies (Melee Phase)

#### Strategy 1: The Stonewalling — "Guard High to Block Everything"
**Concept**: **Guard High** (defensive, +20 guard) is Bulwark's anchor melee attack. Against high-power opponents (Overhand Cleave), Guard High blocks and mitigates damage. Bulwark stalls via Guard High chains until opponent tires.

**How Players Discover It**:
- Counter chart: Guard High beats Measured Cut.
- Risk: Guard High loses to Overhand Cleave (Charger's signature), so pure Guard High spam is punishable.

#### Strategy 2: The Reactive Riposte — "Use Riposte Step to Counter-Attack"
**Concept**: **Riposte Step** (defensive, beats Feint Break + Precision Thrust) lets Bulwark read opponent aggression and flip to counter. When opponents try to technical feint, Riposte Step punishes them.

**How Players Discover It**:
- Teaching: "Bulwark can block anything and punish overconfidence. Master Riposte Step."

### Teaching Approach

**Phase 1**: "Bulwark is the wall. Your guard is your life. Stack it high."

**Phase 2**: "Port de Lance in joust, Guard High in melee — these are your anchors. They make you untouchable."

**Phase 3 (Advanced)**: "Patience wins wars. Let your opponent exhaust themselves. Then you will be fresher, stronger."

**Narrative**: "You are the immovable object. No one breaks through Bulwark. Endurance is your victory."

---

## 4. TACTICIAN — "Tempo Control; Shift Priority"

### Identity Statement
**Philosophy**: Momentum master who controls the pace of battle through superior initiative and forcing opponent decisions. Tactician wins by tempo, not power.

**Core Feeling**: "I control the rhythm. Dance to my beat."

**Key Strengths**:
- Highest Initiative (75) — fastest attacks, highest accuracy
- Highest Control (65) — second-best at shifting and evasion
- Balanced momentum (55) and stamina (55) — no critical holes

**Key Weaknesses**:
- Mid-range Guard (50) — no defensive anchor
- No standout stat (highest initiative, but all other stats are 55-65)
- Can lose to pure durability (Bulwark's 3-pass stall)

### Signature Strategies (Joust Phase)

#### Strategy 1: The Blitz Master — "Move First, Move Fast"
**Concept**: Tactician's Initiative (75) is converted to faster attack cycles. In the speed system, Fast attacks (+20 initiative) allow Tactician to act 1 step ahead of opponents. Tactician opens with **Bris de Garde** (balanced-aggressive, +10 momentum, +15 control, -15 stamina), establishing tempo while maintaining control.

**How Players Discover It**:
- Tutorial: "Tactician moves first and fastest. You can dictate attack pace."
- Game feel: Pass 1, Bris de Garde lands, and Tactician feels "ahead" — next turn they're ready before opponent recovers.
- Risk: Speed attacks cost stamina. With 55 stamina, Tactician has fewer speed cycles than Charger (65).

#### Strategy 2: The Tempo Shift — "Shift to Force Opponent Into Bad Spots"
**Concept**: Tactician's control (65) enables shifting at initiative-optimal moments. By shifting at the right time, Tactician forces opponent into a bad matchup (e.g., forcing Bulwark into aggressive stance when Guard is low).

**How Players Discover It**:
- Advanced: "In rounds, you might have 3 chances to shift. Use them when opponent is about to land a big attack. Shift to block, then counterattack."

#### Strategy 3: The Tempo Trap — "Rhythm-Based Victory"
**Concept**: Tactician's high initiative creates a tempo curve: Pass 1 (Tactician faster), Pass 2 (stamina cost), Pass 3 (opponent adapts). Tactician must win by Pass 2-3 before tempo advantage erodes.

**How Players Discover It**:
- Advanced insight: "Your advantage is early. Don't let this drag to Pass 4."

---

### Signature Strategies (Melee Phase)

#### Strategy 1: The Finisher — "Measured Cut for Tempo Offensive"
**Concept**: **Measured Cut** (balanced, beats Overhand Cleave) is Tactician's signature melee attack. It's balanced, safe, and when chained with high initiative (75 effective), creates consistent damage flow.

**How Players Discover It**:
- Counter chart: Measured Cut beats Overhand Cleave (Charger's signature).
- Risk: Measured Cut loses to Guard High (defensive opponents), so tempo is lost against turtle enemies.

#### Strategy 2: The Aggressive Opener — "Feint Break for Deception"
**Concept**: **Feint Break** (aggressive, beats Precision Thrust) lets Tactician fake technical opponents and punish defensive reads. In melee, deception is a tempo tool.

---

### Teaching Approach

**Phase 1**: "Tactician is the pace-setter. You move first. Use this to your advantage."

**Phase 2**: "Your initiative is your tempo. Maintain it. Don't get dragged into long, grindy battles."

**Phase 3 (Advanced)**: "Melee is about rhythm. Shift between Measured Cut and Feint Break to keep opponents guessing."

**Narrative**: "You are the conductor. The tempo is yours. Play your symphony and watch them scramble."

---

## 5. BREAKER — "Guard Shatter; Anti-Bulwark"

### Identity Statement
**Philosophy**: Guard-focused specialist who excels at penetrating defensive opponents and unmaking Bulwark's armor. Breaker is the counter-archetype, especially strong against defensive playstyles.

**Core Feeling**: "No guard is strong enough. I will break you open."

**Key Strengths**:
- Unique Guard Penetration (0.25) — reduces guard effectiveness for all opponents
- Balanced stats (294 total) — no critical weaknesses
- Strong vs Bulwark: Guard penetration erodes Bulwark's core strength

**Key Weaknesses**:
- No standout stat (Momentum 62, Control 60 — average-high)
- Vulnerable to pure momentum (Charger) if guard isn't the primary defense
- Must rely on guard-cutting to create advantage

### Signature Strategies (Joust Phase)

#### Strategy 1: The Penetrator — "Cut Through Defensive Walls"
**Concept**: Breaker's guard penetration (0.25, vs 0.20 default) means Bulwark's guard (84 in Port de Lance stance) is reduced to 65 effective guard. Against Bulwark, Breaker's Coup Fort feels like it lands harder because the guard reduction is baked in.

**How Players Discover It**:
- Tutorial: "Breaker's attacks ignore enemy guard. Defensive opponents can't hide behind shields."
- Counter-example: Breaker vs Bulwark — what would be a clean block becomes a partial hit.
- Matchup feel: Breaker feels like the "tank killer" archetype.

#### Strategy 2: The Relentless — "Stamina for Extended Pressure"
**Concept**: Breaker's stamina (62) is the second-highest, enabling sustained offensive pressure. While Charger is the glass cannon, Breaker is the "bruiser" — high damage + medium durability.

**How Players Discover It**:
- Advanced: "You have the stamina to outlast Charger in melee. Maintain pressure."

#### Strategy 3: The Anti-Bulwark — "Specialize in Hard Counters"
**Concept**: Breaker + Bulwark matchup is Breaker's win condition. Bulwark's 61% win rate vs Breaker is the worst matchup in the game, but it's expected — Breaker's identity is built around this counter.

---

### Signature Strategies (Melee Phase)

#### Strategy 1: The Guard Breaker — "Overhand Cleave Ignores Defense"
**Concept**: **Overhand Cleave** (aggressive, power 5) combined with guard penetration (0.25) means Bulwark's defensive Guard High is weakened. Where Guard High would normally block, Breaker's Overhand Cleave penetrates.

**How Players Discover It**:
- Counter chart: Overhand Cleave beats Guard High.
- Mechanic tie-in: Guard penetration applies here too — Bulwark's guard is less effective.

#### Strategy 2: The Measured Specialist — "Measured Cut for Consistent Offense"
**Concept**: **Measured Cut** (balanced, beats Overhand Cleave) is Breaker's safety valve. Against aggressive opponents, Measured Cut pivots Breaker to a reactive role.

---

### Teaching Approach

**Phase 1**: "Breaker's attacks ignore guard. You are the guard-breaker. Nothing can hide from you."

**Phase 2**: "You are the Bulwark hunter. If your opponent picks Bulwark, you have the advantage."

**Phase 3 (Advanced)**: "Your penetration works in both joust and melee. Stay aggressive, stay powerful."

**Narrative**: "You are the shield-shattering warrior. Defensive opponents? You are their nightmare."

---

## 6. DUELIST — "Balanced Generalist; Adaptable"

### Identity Statement
**Philosophy**: The everyman archetype with no standout strengths but no critical weaknesses. Duelist is the "learn the game" archetype — all stats equal (60), enabling players to focus on decision-making, not stat theory.

**Core Feeling**: "I am adaptable. Any situation, any opponent."

**Key Strengths**:
- Perfectly balanced stats (all 60s) — can flexibly adapt to any strategy
- No weaknesses to exploit — every matchup is fair
- Teaches fundamentals without distraction

**Key Weaknesses**:
- No signature strategy — doesn't excel at any specific role
- Loses to specialized archetypes in their domain (loses to Charger's momentum, Bulwark's guard, Tactician's tempo)
- Best matchup is other Duelists or balanced opponents

### Signature Strategies (Joust Phase)

#### Strategy 1: The Balanced Fighter — "Mix Offense and Defense"
**Concept**: Duelist's balanced stats allow flexible stance cycling. Against Charger, shift more to defense (Port de Lance). Against Bulwark, shift more to offense (Coup Fort). This flexibility is the strategy.

**How Players Discover It**:
- Tutorial: "Duelist is balanced. You can adapt to any opponent. Think about what they're doing and counter."
- Game feel: Duelist can cast any joust attack competently. The decision is *when* and *against whom*, not "this is my signature attack."

#### Strategy 2: The Anti-Specialist — "Punish Over-Commitment"
**Concept**: While specialized archetypes commit to their playstyle (Charger aggressive, Bulwark defensive), Duelist can punish over-commitment by flexing to the opposite stance.

**How Players Discover It**:
- Advanced: "When your opponent overcommits, switch tactics. If they keep going aggressive, defend. If they stall, attack."

#### Strategy 3: The Long Game — "Stay Balanced Until Stamina Runs Out"
**Concept**: Duelist's balanced stamina (60) and moderate fatigue sensitivity mean Duelist can play any game length (2-pass blitz or 4-pass attrition), though not optimally.

---

### Signature Strategies (Melee Phase)

#### Strategy 1: The Flexible Fighter — "Use Any Attack"
**Concept**: Duelist can cast any melee attack without penalty. The strategy is reading the opponent's attack and choosing the appropriate counter.

**How Players Discover It**:
- Counter chart teaches that different attacks beat different ones. Duelist learns the full chart and applies it.

---

### Teaching Approach

**Phase 1**: "Duelist is the balanced choice. You can adapt to anyone. Learn the game here."

**Phase 2**: "Every attack you can cast is good. The secret is knowing when to cast it."

**Phase 3 (Advanced)**: "Master adaptability. When you know all archetypes, you can counter them all."

**Narrative**: "You are the swordmaster. No specialization, no weakness. Pure adaptability. Your skill defines your victory."

---

## Teaching Progression (All Archetypes)

### Level 1: First Joust (Tutorial)
- Introduce archetype identity statement (e.g., "Charger: Raw impact; wins fast or fades")
- Highlight ONE signature strategy (e.g., Charger: "Use Coup Fort to hit hard early")
- Show stat card with emphasis on archetype's strength (Charger's 75 Momentum)

### Level 2: Second Joust (Guided Learning)
- Show archetype weakness (e.g., Charger's Guard 50)
- Introduce counter-strategy (e.g., Technician: "Shift to Port de Lance to block Charger's Coup Fort")
- Hint at stamina management (e.g., "Charger's attacks cost a lot of stamina")

### Level 3: First Melee (Transition)
- Introduce melee signature attack (e.g., Charger's Overhand Cleave)
- Show counter chart (Overhand Cleave beats Guard High, loses to Measured Cut)
- Teach archetype's melee strategy (e.g., "Chain aggressive attacks while opponent is recovering")

### Level 4: Rounds 2-3 (Advanced)
- Discuss matchup-specific strategies (e.g., "Technician's long-game win condition vs Charger")
- Hint at meta (e.g., "Bulwark is hard to unseat; maybe you need a guard-breaker?")
- Introduce deeper counter-reading (e.g., "Watch for patterns; if they keep using Coup Fort, shift to Port de Lance")

### Level 5: Legendary Tier (Mastery)
- Players with high-tier archetypes understand their identity deeply
- Teaching approach shifts to "you know your archetype, now figure out the meta"

---

## Implementation Notes (Phase 2)

### Where to Embed Archetype Identity

1. **Setup Screen**: Show archetype card with:
   - Identity statement ("Raw impact; wins fast or fades")
   - Key stats highlighted (Charger: Momentum 75 in gold)
   - One-line description of playstyle

2. **During Joust**:
   - In-match tooltips: Hover over Coup Fort → "Your signature attack. High power, high cost."
   - Opponent archetype hint: "Facing Bulwark? Its guard is its strength. Can you break through?"

3. **During Melee**:
   - Attack tooltip: "Overhand Cleave — your signature melee attack"
   - Counter hint: "Your opponent just cast Measured Cut. What beats it?" (Teaching players to read the counter chart)

4. **Results Screen**:
   - Highlight archetype's role in victory (e.g., "Charger's momentum proved too strong. You were outnumbered on damage.")
   - Suggest strategy for rematch (e.g., "Next time, try shifting to Port de Lance to defend against Coup Fort")

5. **Narrative/Flavor Text**:
   - Pre-match flavor text reflects identity (Charger: "Time to break some lances", Bulwark: "They can't break what's unmovable")
   - Victory/defeat flavor reflects archetype role (Charger win: "Pure dominance", Bulwark win: "They exhausted themselves against my wall")

### What NOT to Change (Scope Boundary)

- ❌ Balance changes (all stats locked at S52 zero-flags balance)
- ❌ Mechanics changes (no new attacks, counter tables, or phase systems)
- ❌ Code modifications (this is design-only)
- ❌ UI overhauls (suggestions for Phase 2, but not in this spec)

### What IS Open for Phase 2

- ✅ Narrative/flavor text that reinforces identity
- ✅ Tooltip enhancements that teach signature strategies
- ✅ Matchup-specific hints (e.g., "Breaker counters Bulwark")
- ✅ Learning curve adjustments (when/where to introduce counter chart)
- ✅ Cosmetic archetype differentiation (idle animations, color themes)
- ✅ Campaign/story mode that teaches each archetype deeply
- ✅ Optional: New cosmetics/skins that reinforce archetype feel (Charger in red, Bulwark in heavy armor, Tactician in light gear)

---

## Appendix: Quick Reference (Archetype Decision Tree)

**Want to deal maximum damage?** → Charger (Momentum 75)

**Want to last the longest rally?** → Bulwark (Guard 64) or Breaker (Stamina 62)

**Want to move fastest?** → Tactician (Initiative 75)

**Want the best decision-making tools?** → Technician (Control 70, Shift mastery)

**Want to counter guard?** → Breaker (Guard penetration 0.25)

**Want to learn the game?** → Duelist (all 60s, no distractions)

**Want to unseat fastest?** → Charger (Momentum → Impact → Unseat threshold)

**Want the safest, most consistent playstyle?** → Technician (High Control, balanced approach)

---

## Success Criteria (Phase 2 Verification)

✅ Each archetype has 3+ distinct joust strategies players can execute
✅ Each archetype has 2+ distinct melee strategies players can execute
✅ Archetype identity emerges naturally within 3 jousts (no explicit teaching required)
✅ Signature strategies are rewarding when executed (feel powerful, not tedious)
✅ Counter-strategies are learnable (players can discover them via loss + experimentation)
✅ Teaching progression doesn't overwhelm (no more than 1 new concept per joust)
✅ Narrative/flavor reinforces identity (e.g., Charger's victory text feels aggressive)
✅ No balance changes required (all strategies emerge from S52 zero-flags stat distribution)

---

## Conclusion

This spec provides Phase 2 with a comprehensive identity framework for all 6 archetypes. Each archetype has a clear philosophy, signature strategies (joust + melee), and a teaching pathway. No mechanics or balance changes are required — the archetypes are already differentiated by stats and attack patterns. Phase 2 can focus on narrative, UI tooltips, and learning curve optimization to help new players discover and master these archetypes organically.

**Outcome**: MVP gameplay is already compelling and differentiating. Phase 2 can polish the experience and deepen player agency without mechanical disruption.
