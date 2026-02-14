====================================================================
JOUST + MELEE COMBAT SYSTEM v4.1 — BALANCE PATCH
====================================================================
Revision notes: Derived from v4.0 Refined Edition. Fixes identified
through mathematical audit of all formulas, counter tables, and
archetype matchups. Key changes: melee counter table rebuilt, melee
resolution switched to differential scoring, joust counter table
paradox fixed, Stamina ambiguity resolved, formula description
corrected. See CHANGELOG at end for full diff from v4.0.

====================================================================
OVERVIEW
====================================================================
Two-phase competitive duel:
  Phase 1 — JOUST (Mounted: 5-pass maximum)
  Phase 2 — MELEE (On foot: first to 3 round wins or 1 critical)

Round Flow (per joust pass):
  1. Each player secretly selects horse Speed (Slow / Standard / Fast).
  2. Each selects Initial Stance & Attack (Aggressive / Balanced / Defensive).
  3. Both reveal → each may choose a Reactive Mid-Run Shift.
  4. System resolves all variables deterministically.

Core Stats (0–100 base range, gear can exceed):
  Momentum   → impact force, unseat potential, evasion (harder to target)
  Control    → precision, accuracy, shift eligibility
  Guard      → protection, damage absorption, unseat resistance
  Initiative → timing, shift priority, accuracy modifier
  Stamina    → endurance pool; fatigue degrades combat stats when low

Stance Triangle:
  Aggressive > Defensive > Balanced > Aggressive
  Enforced mechanically: attacks in the favored direction gain
  +10 Accuracy; attacks in the unfavored direction suffer −10 Accuracy.
  (See COUNTER SYSTEM for details.)

Victory Conditions:
  * Unseat opponent during joust → transition to melee
  * Win melee (first to 3 round wins or 1 critical)
  * Highest cumulative ImpactScore after 5 passes (if no unseat)

====================================================================
SECTION 1 — CORE FORMULAS
====================================================================
All formulas are deterministic. No random rolls anywhere in the system.

--- 1.1 DERIVED STATS ---

  Fatigue_Factor = min(1.0, Current_Stamina / (Max_Stamina × Fatigue_Ratio))
    where Fatigue_Ratio = 0.8 (configurable in balance-config.ts)
    * Stamina >= threshold → no penalty (factor = 1.0)
    * Stamina  < threshold → proportional degradation
    * Stamina = 0          → stats at 0% (incapacitated)
    NOTE: threshold = Max_Stamina × 0.8 (e.g. Charger STA 60 → threshold 48)

  Effective_Momentum  = (Base_MOM + Gear_MOM + Speed_Delta + Attack_Delta) x Fatigue_Factor
  Effective_Control   = (Base_CTL + Gear_CTL + Speed_Delta + Attack_Delta) x Fatigue_Factor
  Effective_Guard     = (Base_GRD + Gear_GRD + Attack_Delta) x Guard_Fatigue_Factor
    where Guard_Fatigue_Factor = 0.5 + 0.5 × Fatigue_Factor  [guard drops to 50% at 0 stamina]
  Effective_Initiative = Base_INIT + Gear_INIT + Speed_Delta − any shift penalties

  v4.1 FIX: Speed modifiers are additive deltas inside the parentheses,
  not multiplicative factors. v4.0 incorrectly described a "Speed_Factor"
  as a multiplier. The worked example in v4.0 already computed them as
  additive; this corrects the formula description to match.

  Design note: Guard does not fatigue because armor doesn't get tired.
  Momentum and Control fatigue because the rider's strength and precision
  degrade with exhaustion.

--- 1.2 ACCURACY ---

  Accuracy = Eff_Control + (Eff_Initiative / 2) − (Opponent_Eff_Momentum / 4) + Counter_Bonus

  * Control: primary precision stat
  * Initiative: timing advantage (half weight)
  * Opponent Momentum: fast-charging opponents are harder to target
  * Counter Bonus: +10 if your attack "beats" opponent's, −10 if "beaten by", 0 otherwise

--- 1.3 IMPACT SCORE ---

  ImpactScore = (Eff_Momentum x 0.5) + (Accuracy x 0.4) − (Opponent_Eff_Guard x 0.3)

  Design note: Compared to v3.4, Momentum weight reduced (0.6 → 0.5),
  Accuracy weight increased (0.3 → 0.4), Guard weight reduced (0.4 → 0.3).
  This brings Control/Initiative value closer to parity with Momentum and
  reduces the Guard-stacking invincibility problem.

--- 1.4 UNSEAT (DETERMINISTIC) ---

  Unseat_Threshold = 20 + (Defender_Eff_Guard / 10) + (Defender_Current_Stamina / 20)

  Unseat triggers when:
    ImpactScore_Attacker − ImpactScore_Defender >= Unseat_Threshold

  * High Guard raises the threshold (armor keeps you mounted)
  * High Stamina raises the threshold (fresh riders recover from impacts)
  * Both players can potentially unseat each other; check both directions
  * If both exceed threshold simultaneously, higher margin wins; tie = no unseat

--- 1.5 STAMINA ---

  Starting Stamina = Archetype STA value (see Section 8)
  Per-pass drain  = Attack.Delta_STA cost (see attack tables)
  Shift drain     = Same-stance −5 / Cross-stance −12
  Speed drain     = Applied before fatigue calculation each pass
  Minimum         = 0 (cannot go negative; rider is exhausted)

  v4.1 FIX: v4.0 stated "Starting Stamina = 60 (base, all archetypes)."
  This contradicted the archetype table where STA ranges from 50 to 65.
  Starting Stamina now correctly uses the archetype's STA value. This
  creates meaningful differentiation: Charger (STA 50) burns out fast,
  Bulwark (STA 65) endures. The fatigue threshold remains 40 for all.

  Stamina is the system's pacing mechanism. Aggressive attacks drain fast
  (Coup Fort: −20/pass). Defensive attacks drain slow (Port de Lance: −8/pass).
  Fatigue_Factor kicks in below 40, making late-match Stamina the difference
  between full-power attacks and weakened strikes.

  Stamina budget over 5 passes (no shifts, no speed STA cost):
    Charger 5x Coup Fort:    50 → 30 → 10 → 0 → 0 → 0   (fatigued pass 1, incapacitated pass 3)
    Charger 5x Course:       50 → 40 → 30 → 20 → 10 → 0  (fatigued by pass 3)
    Bulwark 5x Port de Lance: 65 → 57 → 49 → 41 → 33 → 25 (fatigued by pass 4)
    Duelist 5x Course:       60 → 50 → 40 → 30 → 20 → 10  (fatigued by pass 3)

====================================================================
SECTION 2 — COUNTER SYSTEM
====================================================================

--- 2.1 MECHANIC ---

  If your attack's "Beats" list includes the opponent's attack: +10 Accuracy
  If your attack's "Beaten By" list includes the opponent's attack: −10 Accuracy
  Otherwise: 0

  This modifier is included in the Accuracy formula as Counter_Bonus.
  It makes counters meaningful (10 points is significant) without being
  decisive (raw stats can overcome a bad matchup).

  IMPORTANT: The Beats and Beaten By columns are strict inverses. If
  attack A appears in attack B's "Beats" list, then B MUST appear in
  A's "Beaten By" list, and vice versa. No other relationships exist.

--- 2.2 STANCE TRIANGLE ENFORCEMENT ---

  The counter tables are designed so that, in every stance matchup direction:
    * 2 of 4 cross-stance matchups favor the dominant stance
    * 1 of 4 favors the non-dominant stance (exception)
    * 1 of 4 is neutral

  This "2-1-1 pattern" ensures the triangle is a meaningful tendency
  without being a hard override. Every stance has counter-play options.

--- 2.3 JOUST COUNTER TABLE ---

  v4.1 FIX: v4.0 had a paradox where Course de Lance and Coup en Passant
  each appeared in the other's "Beaten By" list, but neither appeared in
  the other's "Beats" list. This created a mutual −10 situation that was
  mechanically possible but almost certainly unintended. Fixed by making
  them neutral (no relationship). This maintains the 2-1-1 triangle
  pattern for Def vs Bal matchups.

  | Attack          | Stance | Beats                            | Beaten By                        |
  |-----------------|--------|----------------------------------|----------------------------------|
  | Coup Fort       | Agg    | Port de Lance                    | Coup en Passant, Course de Lance |
  | Bris de Garde   | Agg    | Port de Lance, Coup de Pointe    | Course de Lance                  |
  | Course de Lance | Bal    | Coup Fort, Bris de Garde         | Port de Lance                    |
  | Coup de Pointe  | Bal    | Port de Lance                    | Bris de Garde, Coup en Passant   |
  | Port de Lance   | Def    | Course de Lance                  | Coup Fort, Bris de Garde, Coup de Pointe |
  | Coup en Passant | Def    | Coup Fort, Coup de Pointe        | (none)                           |

  Counter summary per attack:
    Coup Fort:        1 win, 2 losses  (high risk, high reward)
    Bris de Garde:    2 wins, 1 loss   (strong counter profile)
    Course de Lance:  2 wins, 1 loss   (balanced, central)
    Coup de Pointe:   1 win, 2 losses  (shift enabler; see note)
    Port de Lance:    1 win, 3 losses  (pure defense; survives on Guard)
    Coup en Passant:  2 wins, 0 losses (best counter profile)

  Total wins: 9. Total losses: 9. Symmetric.

  Stance triangle verification:
    Agg vs Def: CF>PdL, BdG>PdL (2 Agg), CEP>CF (1 Def), BdG/CEP neutral (1). ✓
    Def vs Bal: PdL>CdL (1 Def), CEP>CdP (1 Def), CdP>PdL (1 Bal), CdL/CEP neutral (1). ✓
    Bal vs Agg: CdL>CF, CdL>BdG (2 Bal), BdG>CdP (1 Agg), CdP/CF neutral (1). ✓

  Note on Coup en Passant's 2-0 profile: CEP's undefeated counter record
  is balanced by its higher Stamina cost (−14 vs Port de Lance's −8) and
  weaker defensive stats (+10 GRD vs PdL's +20 GRD). CEP trades raw
  defense for counter-game dominance. PdL trades counter-game power for
  pure tankiness. Both defensive attacks have a clear role. Additionally,
  CEP's 2-0 profile is structurally necessary — changing it to 2-1 would
  break the 2-1-1 triangle pattern in the Agg vs Def direction.

  Note on Coup de Pointe: Its 1-win/2-loss counter profile is intentionally
  weak. Its value is the +20 Control delta, which enables mid-run shift
  eligibility. Intended play: declare Coup de Pointe to boost Control,
  qualify for shift, then react to opponent's revealed attack.

  Note on Port de Lance: 1-win/3-loss looks terrible, but its +20 Guard
  delta means incoming ImpactScore is heavily reduced. Port de Lance doesn't
  win the counter game — it wins the attrition game by absorbing damage
  while the opponent exhausts their Stamina on Aggressive attacks.

--- 2.4 MELEE COUNTER TABLE ---

  v4.1 FIX: Complete rebuild. The v4.0 melee table had four inconsistencies
  between the Beats and Beaten By columns, and Riposte Step had 3 wins /
  0-1 losses (dominant). The new table uses the same 2-1-1 triangle pattern
  as the joust table, with counter profiles inversely correlated to stat
  power (powerful attacks have weaker counter profiles).

  | Attack           | Stance | Beats                      | Beaten By                  |
  |------------------|--------|----------------------------|----------------------------|
  | Overhand Cleave  | Agg    | Guard High, Riposte Step   | Measured Cut, Prec. Thrust |
  | Feint Break      | Agg    | Precision Thrust           | Riposte Step               |
  | Measured Cut     | Bal    | Overhand Cleave, Rip. Step | Guard High                 |
  | Precision Thrust | Bal    | Overhand Cleave            | Feint Break, Riposte Step  |
  | Guard High       | Def    | Measured Cut               | Overhand Cleave            |
  | Riposte Step     | Def    | Feint Break, Prec. Thrust  | Overhand Cleave, Meas. Cut |

  Counter summary per attack:
    Overhand Cleave:  2 wins, 2 losses (high variance — power vs technique)
    Feint Break:      1 win, 1 loss    (low variance — the trickster)
    Measured Cut:     2 wins, 1 loss   (best net profile — rewards technique)
    Precision Thrust: 1 win, 2 losses  (weak counter, strong accuracy stats)
    Guard High:       1 win, 1 loss    (modest counter, massive +20 Guard)
    Riposte Step:     2 wins, 2 losses (high variance — the counter-puncher)

  Total wins: 9. Total losses: 9. Symmetric.

  Stance triangle verification:
    Agg vs Def: OC>GH, OC>RS (2 Agg), RS>FB (1 Def), FB/GH neutral (1). ✓
    Def vs Bal: GH>MC, RS>PT (2 Def), MC>RS (1 Bal), GH/PT neutral (1). ✓
    Bal vs Agg: MC>OC, PT>OC (2 Bal), FB>PT (1 Agg), MC/FB neutral (1). ✓

  Design notes on thematic identity:
    OC "Overhand Cleave": Raw power. Overwhelms passive defense (GH) and
      reactive counters (RS) through sheer force. Defeated by technical
      precision (MC, PT) that exploits its wide-open recovery.
    FB "Feint Break": Deception. Disrupts precise targeting (PT) before
      it can execute. Read by reactive defense (RS) which waits for the
      real attack. Neutral against passive defense (GH) and technique (MC).
    MC "Measured Cut": Controlled technique. Defeats reckless power (OC)
      and reactive counters (RS) through disciplined approach that doesn't
      overcommit. Blocked by pure defense (GH) which absorbs measured strikes.
    PT "Precision Thrust": Accuracy specialist. Exploits power attacks'
      openings (OC). Disrupted by feints (FB) and read by reactive defense (RS).
      Weak counter profile compensated by +15 Control stat delta.
    GH "Guard High": Pure defense. Absorbs technical strikes (MC) through
      impenetrable guard. Overwhelmed by raw power (OC). Modest counter
      profile compensated by +20 Guard making the player extremely hard to
      outscore in differential melee resolution.
    RS "Riposte Step": Counter-puncher. Reads and punishes feints (FB) and
      precise attacks (PT). Overwhelmed by raw power (OC) that can't be
      redirected. Out-maneuvered by measured technique (MC) that doesn't
      give clean riposte openings.

====================================================================
SECTION 3 — STEED GEAR
====================================================================

--- 3.1 GEAR SLOTS ---

  | Slot       | Primary Stat | Secondary Pool (pick 1) | Penalty Stat | Thematic Logic                     |
  |------------|-------------|-------------------------|--------------|-------------------------------------|
  | Chamfron   | Guard       | Initiative, Control     | Initiative   | Head armor protects but limits vision |
  | Barding    | Guard       | Momentum, Stamina       | Stamina      | Body armor protects but weighs down   |
  | Saddle     | Control     | Stamina, Guard          | Momentum     | Seat stability limits forward thrust  |
  | Stirrups   | Control     | Guard, Momentum         | Initiative   | Balance aid but rigid stance          |
  | Reins      | Initiative  | Control, Momentum       | Momentum     | Steering precision but pulls back     |
  | Horseshoes | Momentum    | Initiative, Stamina     | Control      | Speed and traction reduce precision   |

  Cosmetic: Caparison (decorative cloth, no stats — see Section 6 on visibility)

--- 3.2 RARITY TIERS ---

  | Tier      | Primary | Secondary | Penalty | Net (Primary-Penalty) |
  |-----------|---------|-----------|---------|----------------------|
  | Common    | +2      | +1        | −1      | +1                   |
  | Uncommon  | +4      | +2        | −1      | +3                   |
  | Rare      | +6      | +3        | −2      | +4                   |
  | Epic      | +9      | +5        | −3      | +6                   |
  | Legendary | +12     | +7        | −4      | +8                   |
  | Relic     | +14     | +9        | −5      | +9                   |
  | Giga      | +16     | +11       | −6      | +10                  |

  Design notes:
    * Penalties scale slower than bonuses → higher rarity is always better
    * Net value grows with rarity but not explosively (+1 to +10 range)
    * Penalty stat is fixed per slot (thematic, not player-chosen)
    * Secondary stat is player-chosen from pool of 2 (build expression)

--- 3.3 STAT STACKING CEILINGS ---

  Each stat's maximum gear contribution (all 6 horse slots, all Giga):

  | Stat       | Primary Slots | Secondary Slots | Max Bonus                      |
  |------------|--------------|-----------------|-------------------------------|
  | Guard      | Chamfron, Barding (2x16=32) | Saddle, Stirrups (2x11=22) | +54 (minus penalties elsewhere) |
  | Control    | Saddle, Stirrups (2x16=32)  | Chamfron, Reins (2x11=22)  | +54                             |
  | Initiative | Reins (1x16=16)             | Chamfron, Horseshoes (2x11=22) | +38                         |
  | Momentum   | Horseshoes (1x16=16)        | Barding, Stirrups, Reins (3x11=33) | +49                    |
  | Stamina    | None (0)                    | Barding, Saddle, Horseshoes (3x11=33) | +33                  |

====================================================================
SECTION 4 — PLAYER GEAR
====================================================================

--- 4.1 GEAR SLOTS ---

  | Slot              | Primary Stat | Secondary Pool (pick 1) | Penalty Stat | Thematic Logic                        |
  |-------------------|-------------|-------------------------|--------------|----------------------------------------|
  | Helm              | Guard       | Control, Initiative     | Control      | Head protection limits vision/precision |
  | Shield            | Guard       | Control, Momentum       | Initiative   | Absorbs impact but slows reactions      |
  | Lance             | Momentum    | Control, Initiative     | Guard        | Offensive weapon sacrifices protection  |
  | Armor (Cuirass)   | Guard       | Stamina, Momentum       | Initiative   | Heavy torso armor slows reactions       |
  | Gauntlets/Greaves | Control     | Guard, Initiative       | Momentum     | Grip and stability limit raw force      |

  Cosmetic: Pennons / Tabards (heraldic, no stats)

--- 4.2 COMBINED STACKING (HORSE + PLAYER GEAR, 11 SLOTS) ---

  At full Giga across all 11 slots, theoretical maximums:

  | Stat       | Max Primary | Max Secondary | Theoretical Max |
  |------------|------------|---------------|-----------------|
  | Guard      | 5 slots (80) | 4 slots (44)  | +124            |
  | Control    | 3 slots (48) | 4 slots (44)  | +92             |
  | Momentum   | 2 slots (32) | 5 slots (55)  | +87             |
  | Initiative | 1 slot (16)  | 4 slots (44)  | +60             |
  | Stamina    | 0 slots (0)  | 4 slots (44)  | +44             |

  These are unrealistic extremes (requires sacrificing every secondary slot
  to one stat). Practical builds will be ~40-60% of theoretical max.

====================================================================
SECTION 5 — MATCH FLOW (JOUST PHASE)
====================================================================

--- 5.1 SPEED SELECTION (PHASE 1A) ---

  | Speed    | Delta_MOM | Delta_CTL | Delta_INIT | Delta_STA | Shift Threshold |
  |----------|-----------|----------|-------------|----------|-----------------|
  | Slow     | −15       | +15      | 0           | +5       | Control >= 50    |
  | Standard | 0         | 0        | +10         | 0        | Control >= 60    |
  | Fast     | +15       | −15      | +20         | −5       | Control >= 70    |

--- 5.2 INITIAL STANCE & ATTACK (PHASE 1B) ---

  Joust attacks:

  | Attack          | Stance | Pwr | Ctl | Def | Risk | D_MOM | D_CTL | D_GRD | D_STA |
  |-----------------|--------|-----|-----|-----|------|-------|-------|-------|-------|
  | Coup Fort       | Agg    | 5   | 2   | 1   | 5    | +25   | −10   | −5    | −20   |
  | Bris de Garde   | Agg    | 4   | 4   | 2   | 4    | +10   | +15   | −5    | −15   |
  | Course de Lance | Bal    | 3   | 3   | 3   | 2    | +5    | +10   | +5    | −10   |
  | Coup de Pointe  | Bal    | 3   | 5   | 2   | 3    | 0     | +20   | 0     | −12   |
  | Port de Lance   | Def    | 2   | 4   | 5   | 2    | −5    | +10   | +20   | −8    |
  | Coup en Passant | Def    | 3   | 5   | 4   | 4    | +5    | +15   | +10   | −14   |

--- 5.3 REVEAL & BASE RESOLUTION (PHASE 2A) ---

  Both players reveal Speed + Attack simultaneously.
  Compute base Accuracy and ImpactScore using Section 1 formulas.
  Apply Fatigue_Factor based on current Stamina.

--- 5.4 REACTIVE MID-RUN SHIFT (PHASE 2B) ---

  After seeing opponent's revealed choices, each rider may shift attack.

  Eligibility:
    Effective_Control >= Shift_Threshold (by speed) AND Current_Stamina >= 10
    Uses PRE-SHIFT stats for eligibility check.

  Cost:
    Same-stance swap:  Stamina −5,  Initiative −5
    Cross-stance swap: Stamina −12, Initiative −10

  Resolution:
    New attack deltas replace previous deltas. Accuracy and ImpactScore recomputed.
    If BOTH players shift, higher Effective_Initiative resolves SECOND (advantage:
    they see the opponent's shift and their new attack is the final state).
    Tie in Initiative: simultaneous resolution, no advantage to either.

  Fatigue interaction: Shift costs compound with attack Stamina costs. A
  cross-stance shift (−12) plus Coup Fort (−20) in one pass = −32 Stamina.
  From Charger base 50, that puts you at 18 — deep into fatigue territory.

--- 5.5 PASS RESOLUTION ---

  1. Apply speed Stamina delta
  2. Compute Fatigue_Factor from current Stamina
  3. Apply all stat modifiers (speed + attack + gear)
  4. Compute Effective stats (Momentum, Control with fatigue; Guard without)
  5. Compute Accuracy (with Counter_Bonus from Section 2)
  6. Compute ImpactScore for both players
  7. Check unseat condition (Section 1.4) in both directions
  8. Record pass score (ImpactScore)
  9. Deduct attack Stamina cost (and shift cost if applicable)
  10. If unseat: transition to melee (Section 7)
  11. If pass 5 complete: highest cumulative ImpactScore wins; tie = melee

====================================================================
SECTION 6 — PROGRESSIVE GEAR VISIBILITY
====================================================================
Information reveal is tied to the pass structure, creating a three-act
strategic arc within each joust.

--- 6.1 VISIBILITY SCHEDULE ---

  | Timing        | What You See About Opponent                                |
  |---------------|-----------------------------------------------------------|
  | Pre-match     | Archetype only (e.g., "Charger")                          |
  | After Pass 1  | Combat log: opponent's Accuracy and ImpactScore from Pass 1 |
  | Before Pass 2 | (Deduction phase: reverse-engineer stats from Pass 1 data) |
  | After Pass 2  | Gear SLOTS visible (what type of gear, not rarity/stats)  |
  | Before Pass 3 | (Refined deduction: slot types + 2 passes of combat data) |
  | Pass 3 onward | Full gear visibility (rarity tier, primary/secondary stats)|

--- 6.2 STRATEGIC ARC ---

  Act 1 — Pass 1: THE READ
    Minimal information. Players rely on archetype tendencies and instinct.
    Aggressive openers are strong here because the opponent can't counter-build.
    Conservative play (Balanced stance, Standard speed) is safe but uninformative.
    Risk-takers can gain an early lead; cautious players gather data.

  Act 2 — Passes 2-3: THE DEDUCTION
    Combat results reveal approximate stat ranges. Gear slot visibility confirms
    build direction. Skilled players reverse-engineer opponent stats.
    Mid-run shifts double as intelligence probes — shift to test reactions.
    Technician and Tactician archetypes excel here (high Control/Initiative
    enable more shifts = more data points).

  Act 3 — Passes 4-5: THE OPTIMIZATION
    Full gear visibility. Both players have complete information. Final passes
    are pure tactical play: stance selection, counter prediction, shift timing.
    The stance triangle and counter system carry maximum weight because
    decisions are fully informed. Stamina economics dominate — who has
    enough left to shift? Who's fatigued?

--- 6.3 COSMETIC DECEPTION (FUTURE FEATURE) ---

  Caparison and Pennons/Tabards are cosmetic-only gear. In the progressive
  visibility model, cosmetics are visible from Pre-match onward. Elaborate
  cosmetics on low-rarity gear can bluff strength. Plain cosmetics on
  Giga gear can sandbag. Out of scope for MVP.

====================================================================
SECTION 7 — MELEE PHASE
====================================================================

--- 7.1 TRANSITION ---

  Melee begins when:
    a) A rider is unseated during joust, OR
    b) 5 passes complete with a tied cumulative score

  Carryover penalties for unseated rider:
    Momentum penalty: −floor(Unseat_Margin / 3)
    Control penalty:  −floor(Unseat_Margin / 4)
    Guard penalty:    −floor(Unseat_Margin / 5)
    Stamina:          carries over as-is from joust

    Where Unseat_Margin = Winner_ImpactScore − Loser_ImpactScore

  Tied-score transition: both riders enter melee at current stats, no penalties.

--- 7.2 MELEE ATTACKS ---

  | Attack           | Stance | Pwr | Ctl | Def | Risk | D_MOM | D_CTL | D_GRD | D_STA |
  |------------------|--------|-----|-----|-----|------|-------|-------|-------|-------|
  | Overhand Cleave  | Agg    | 5   | 2   | 1   | 5    | +20   | −10   | −5    | −18   |
  | Feint Break      | Agg    | 4   | 4   | 2   | 4    | +10   | +10   | −5    | −15   |
  | Measured Cut     | Bal    | 3   | 3   | 3   | 2    | +5    | +10   | +5    | −10   |
  | Precision Thrust | Bal    | 3   | 5   | 2   | 3    | +5    | +15   | −5    | −12   |
  | Guard High       | Def    | 2   | 3   | 5   | 2    | −5    | +5    | +20   | −8    |
  | Riposte Step     | Def    | 3   | 5   | 4   | 4    | +5    | +15   | +10   | −12   |

--- 7.3 MELEE RESOLUTION ---

  v4.1 CHANGE: Melee now uses DIFFERENTIAL scoring, consistent with the
  joust's unseat mechanic. v4.0 used an absolute threshold (ImpactScore >
  Opponent Guard), which double-counted Guard: once as −0.3 in ImpactScore
  and once as the hit threshold. This made high-Guard builds mathematically
  unhittable — even the strongest offensive archetype couldn't land a hit
  against a mid-Guard opponent in most scenarios.

  Each melee round: both players select attack simultaneously → resolve.

  Formula: Same ImpactScore formula as joust (Section 1.3).
  Both players compute ImpactScore. The difference determines the outcome.

  Margin = ImpactScore_Higher − ImpactScore_Lower

  Round outcomes:
    Margin < 5:   DRAW — neither player scores. Round is inconclusive.
    Margin >= 5:  HIT — the player with higher ImpactScore scores a round win.
    Margin >= 25: CRITICAL — instant match win for the player with higher ImpactScore.

  Win condition: First to 3 round wins, OR 1 critical.

  Design notes:
    * Only one player can win each round (or it's a draw). This replaces
      v4.0's "trading blows" mechanic where both could hit simultaneously.
    * The differential system makes melee a decisive contest per round,
      aligned with the joust's philosophy of comparative advantage.
    * Guard is counted exactly once (in ImpactScore at −0.3 weight). High
      Guard reduces the opponent's ImpactScore, helping you win the differential,
      but it's not an absolute wall.
    * Counter bonuses (+/−10 Accuracy = +/−4 ImpactScore) often determine
      round winners, making attack reads the primary skill in melee.
    * Stat advantages from fatigue differential create larger margins,
      rewarding players who managed Stamina well during the joust.

  Melee does NOT have mid-run shifts (on foot, no horse momentum to
  redirect). Attack selection is final. Counter bonuses still apply.

  Stamina continues to drain per attack. Fatigue_Factor applies.
  A fatigued player's ImpactScore drops, making round wins harder
  and criticals nearly impossible.

--- 7.4 MELEE PACING ---

  Melee rounds are faster than joust passes (no speed/shift phases).
  Typical melee length: 3-5 rounds.

  If both players reach Stamina 0 without a winner: player with more
  round wins wins. If tied on round wins: the player who won the joust
  phase (higher cumulative ImpactScore) wins. If joust was also tied: draw.

====================================================================
SECTION 8 — ARCHETYPES
====================================================================

  | Archetype  | MOM | CTL | GRD | INIT | STA | Total | Identity                        |
  |------------|-----|-----|-----|------|-----|-------|---------------------------------|
  | Charger    | 70  | 45  | 55  | 60   | 50  | 280   | Raw impact; wins fast or fades  |
  | Technician | 50  | 70  | 55  | 60   | 55  | 290   | Reactive specialist; shift master |
  | Bulwark    | 55  | 55  | 75  | 45   | 65  | 295   | Immovable wall; wins on attrition |
  | Tactician  | 55  | 65  | 50  | 75   | 55  | 300   | Tempo control; shift priority   |
  | Breaker    | 65  | 60  | 50  | 55   | 50  | 280   | Guard shatter; anti-Bulwark     |
  | Duelist    | 60  | 60  | 60  | 60   | 60  | 300   | Balanced generalist; adaptable  |

--- 8.1 STAT TOTAL RATIONALE (NEW IN v4.1) ---

  Archetype stat totals are intentionally unequal (280-300 range). This
  compensates for differences in per-point stat efficiency:

  Approximate impact per stat point (offensive contribution):
    Momentum:   ~0.6  (0.5 to own ImpactScore + evasion via Opp_MOM/4 in Accuracy)
    Control:    ~0.4  (1.0 to Accuracy x 0.4 ImpactScore weight)
    Guard:      ~0.4  (0.3 defensive ImpactScore reduction, not fatigued, unseat threshold)
    Initiative: ~0.2  (0.5 to Accuracy x 0.4 weight, plus shift priority utility)
    Stamina:    variable (nonlinear: no value above 40, critical below 40)

  Weighted stat totals (MOM x 0.6 + CTL x 0.4 + GRD x 0.4 + INIT x 0.2):
    Charger:    42 + 18 + 22 + 12 = 94
    Technician: 30 + 28 + 22 + 12 = 92
    Bulwark:    33 + 22 + 30 + 9  = 94
    Tactician:  33 + 26 + 20 + 15 = 94
    Breaker:    39 + 24 + 20 + 11 = 94
    Duelist:    36 + 24 + 24 + 12 = 96

  All archetypes land at ~94 weighted value (Duelist at 96 as a mild
  generalist premium, Technician at 92 compensated by Control's shift
  eligibility value not captured in the weight). The unequal raw totals
  produce near-equal effective power.

  Momentum-heavy archetypes (Charger, Breaker) have fewer total stat points
  because Momentum is the most efficient per-point stat. Initiative-heavy
  archetypes (Tactician) have more total points because Initiative is the
  least efficient per-point stat (but has unique shift-priority utility).

--- 8.2 ARCHETYPE MATCHUP NOTES ---

  Charger vs Bulwark: Charger cannot unseat Bulwark (Guard too high).
    Must win on ImpactScore accumulation or melee. Bulwark outlasts via
    Stamina advantage (65 vs 50 — a full 15-point endurance gap).
  Technician vs Charger: Technician reads and counters Charger's
    aggression via shifts. Charger must vary attacks to avoid predictability.
  Tactician vs Technician: Both want to shift; Tactician's higher Initiative
    means their shift resolves second (advantage). Mirror of adaptability.
  Breaker vs Bulwark: Breaker's high Momentum + Bris de Garde (which beats
    Port de Lance) is the intended Bulwark counter.

====================================================================
SECTION 9 — WORKED EXAMPLE: CHARGER VS TECHNICIAN
====================================================================
(Standardized gear for MVP: all gear bonuses = 0.)
(v4.1: Uses archetype STA values. Charger starts at 50, Technician at 55.)

--- PASS 1 ---

  Charger:    Fast Speed | Coup Fort (Aggressive)
  Technician: Standard Speed | Course de Lance (Balanced)

  Speed Stamina adjustment:
    Charger: 50 − 5 (Fast) = 45. Fatigue = 45/40 = 1.0+ → capped at 1.0.
    Technician: 55. Fatigue = 1.0.

  Pre-shift stats:
    Charger:    MOM = 70+15+25 = 110, CTL = 45−15−10 = 20, GRD = 55−5 = 50, INIT = 60+20 = 80
    Technician: MOM = 50+0+5 = 55, CTL = 70+0+10 = 80, GRD = 55+5 = 60, INIT = 60+10 = 70

  Reveal → Technician sees Coup Fort. Shift check:
    Technician CTL 80 >= 60 (Standard threshold) ✓, Stamina 55 >= 10 ✓
    Shifts: Course de Lance → Coup en Passant (cross-stance, Bal→Def)
    Cost: Stamina −12, Initiative −10
    Technician Stamina: 55 − 12 = 43. Initiative: 70 − 10 = 60.

  Post-shift Technician stats:
    MOM = 50+0+5 = 55, CTL = 70+0+15 = 85, GRD = 55+10 = 65, INIT = 60

  Counter check: Coup en Passant beats Coup Fort → Technician gets +10 Accuracy.

  Accuracy:
    Tech: 85 + (60/2) − (110/4) + 10 = 85 + 30 − 27.5 + 10 = 97.5
    Chgr: 20 + (80/2) − (55/4) + (−10) = 20 + 40 − 13.75 − 10 = 36.25

  ImpactScore:
    Tech: (55x0.5) + (97.5x0.4) − (50x0.3) = 27.5 + 39 − 15 = 51.5
    Chgr: (110x0.5) + (36.25x0.4) − (65x0.3) = 55 + 14.5 − 19.5 = 50.0

  Unseat check:
    Tech margin: 51.5 − 50.0 = 1.5
    Charger threshold: 20 + (50/10) + (45/20) = 20 + 5 + 2.25 = 27.25
    1.5 < 27.25 → No unseat.

  Pass 1 result: Technician wins narrowly on ImpactScore (51.5 vs 50.0).

  End-of-pass Stamina:
    Charger: 45 − 20 (Coup Fort) = 25      ← BELOW 40. Fatigued next pass.
    Technician: 43 − 14 (Coup en Passant) = 29  ← Also below 40.

--- PASS 2 ---

  Both players below Stamina 40. Fatigue is significant.

  Charger:    Slow Speed | Bris de Garde (Aggressive — forced to adapt)
  Technician: Standard Speed | Port de Lance (Defensive, conserve Stamina)

  v4.1 NOTE: With archetype STA 50, the Charger CANNOT sustain Fast + Coup Fort
  for a second pass (would go to 25−5−20 = 0 Stamina, complete incapacitation).
  The Charger must adapt — this is the intended design. "Wins fast or fades."

  Speed Stamina:
    Charger: 25 + 5 (Slow) = 30. Fatigue = 30/40 = 0.75.
    Technician: 29. Fatigue = 29/40 = 0.725.

  Stats:
    Charger:
      MOM = (70 − 15 + 10) x 0.75 = 65 x 0.75 = 48.75
      CTL = (45 + 15 + 15) x 0.75 = 75 x 0.75 = 56.25
      GRD = 55 − 5 = 50
      INIT = 60 + 0 = 60
    Technician:
      MOM = (50 + 0 − 5) x 0.725 = 45 x 0.725 = 32.625
      CTL = (70 + 0 + 10) x 0.725 = 80 x 0.725 = 58
      GRD = 55 + 20 = 75
      INIT = 60 + 10 = 70

  Charger considers shift? CTL 56.25 >= 50 (Slow threshold) ✓, STA 30 >= 10 ✓.
  Could shift but chooses not to (conserving Stamina).

  Counter: Bris de Garde beats Port de Lance → Charger gets +10 Accuracy.

  Accuracy:
    Chgr: 56.25 + (60/2) − (32.625/4) + 10 = 56.25 + 30 − 8.16 + 10 = 88.09
    Tech: 58 + (70/2) − (48.75/4) + (−10) = 58 + 35 − 12.19 − 10 = 70.81

  ImpactScore:
    Chgr: (48.75x0.5) + (88.09x0.4) − (75x0.3) = 24.375 + 35.24 − 22.5 = 37.11
    Tech: (32.625x0.5) + (70.81x0.4) − (50x0.3) = 16.31 + 28.32 − 15 = 29.63

  Charger wins pass 2 (37.11 vs 29.63). The switch to Slow + Bris de Garde
  shows the Charger adapting: lower raw power but better accuracy through
  higher Control, and the counter advantage against Port de Lance pays off.

  Unseat check: Margin 7.48 < threshold. No unseat.

  End-of-pass Stamina:
    Charger: 30 − 15 (Bris de Garde) = 15   ← Critical. Deep fatigue.
    Technician: 29 − 8 (Port de Lance) = 21  ← Low but manageable.

  Cumulative ImpactScore: Charger 87.11, Technician 81.13.

--- PASS 3 (PIVOTAL) ---

  Charger:    Slow Speed | Course de Lance (Balanced — survival mode)
  Technician: Standard Speed | Measured Cut-equivalent... Coup en Passant (counter the expected defensive play)

  v4.1 NOTE: With Charger at STA 15, aggressive play is suicide. Slow + Course
  de Lance is the survival play: +5 STA (Slow), −10 STA (CdL) = net −5.

  Speed Stamina:
    Charger: 15 + 5 = 20. Fatigue = 20/40 = 0.50. Severe.
    Technician: 21. Fatigue = 21/40 = 0.525.

  Stats:
    Charger:
      MOM = (70 − 15 + 5) x 0.50 = 60 x 0.50 = 30
      CTL = (45 + 15 + 10) x 0.50 = 70 x 0.50 = 35
      GRD = 55 + 5 = 60
      INIT = 60
    Technician:
      MOM = (50 + 0 + 5) x 0.525 = 55 x 0.525 = 28.875
      CTL = (70 + 0 + 15) x 0.525 = 85 x 0.525 = 44.625
      GRD = 55 + 10 = 65
      INIT = 60 + 10 = 70

  Counter: CdL vs CEP — NEUTRAL (v4.1 fix; was mutual −10 paradox in v4.0).

  Accuracy:
    Chgr: 35 + (60/2) − (28.875/4) + 0 = 35 + 30 − 7.22 = 57.78
    Tech: 44.625 + (70/2) − (30/4) + 0 = 44.625 + 35 − 7.5 = 72.125

  ImpactScore:
    Chgr: (30x0.5) + (57.78x0.4) − (65x0.3) = 15 + 23.11 − 19.5 = 18.61
    Tech: (28.875x0.5) + (72.125x0.4) − (60x0.3) = 14.44 + 28.85 − 18 = 25.29

  Technician wins pass 3 (25.29 vs 18.61). Fatigue is crushing both players,
  but the Technician's higher Control base keeps their Accuracy competitive.

  Unseat check: Margin 6.68 vs Charger threshold 20 + 6 + 1 = 27. No unseat.

  End-of-pass Stamina:
    Charger: 20 − 10 (CdL) = 10     ← Nearly done.
    Technician: 21 − 14 (CEP) = 7   ← Also nearly done!

  Cumulative ImpactScore: Charger 105.72, Technician 106.42.
  The match is EXTREMELY close. Technician leads by 0.70.

--- NARRATIVE ---

  This is where v4.1's Stamina changes create a fundamentally different arc
  from v4.0. In v4.0, the Charger at STA 60 could afford two passes of
  Fast + Coup Fort and still have STA 10 entering pass 3. In v4.1, the
  Charger at STA 50 is forced to adapt after ONE aggressive pass. This
  creates a richer strategic arc:

  Pass 1: Charger goes all-in. Technician reads and counters. Nearly tied.
  Pass 2: Charger adapts to Slow + BdG. Uses counter knowledge (BdG beats PdL).
          Wins the pass through smart adaptation, not raw power.
  Pass 3: Both players deep in fatigue. The match hinges on remaining passes.

  Passes 4-5 would continue with both players in severe fatigue, making
  every Stamina point precious. The Technician's slight Stamina advantage
  (55 vs 50 base) gives them staying power, but the Charger's pass 2
  adaptation kept the score competitive.

  The match would likely be decided by:
  * Counter reads in passes 4-5 (full gear visibility)
  * Which player manages their remaining Stamina better
  * Whether either player reaches STA 0 (incapacitation)

  If no unseat after 5 passes, the cumulative score determines the winner,
  or melee if still tied.

====================================================================
SECTION 10 — LADDER & MATCHMAKING NOTES
====================================================================

  Recommended ladder structure:
    * Gear Score = sum of all gear primary + secondary bonuses across 11 slots
    * Matchmaking brackets: pair players within +/−15% Gear Score
    * Separate ranking within brackets (Elo or similar)
    * Optional: "Normalized" mode where all gear is standardized (pure skill)

====================================================================
SECTION 11 — FUTURE CONSIDERATIONS
====================================================================

  11.1 SET BONUSES
    Gear structure (locked primary, chosen secondary) supports set bonuses.
    Sets should be defined by slot combination, not stat type.
    Design constraint: set bonuses should not exceed ~10% of a stat's value.

  11.2 GUARD PENETRATION
    If Bulwark builds prove too dominant despite v4.1 melee fixes, add a
    "Guard Penetration" sub-stat to Aggressive attacks:
      Bris de Garde: ignores 15% of opponent Guard (thematic: "break guard")
      Feint Break (melee): ignores 15% of opponent Guard
    This is a surgical fix that only activates against high-Guard builds.

  11.3 DIMINISHING RETURNS (APPROACH B)
    If flat gear stacking proves problematic at Giga tier, add soft caps:
      Effective_Bonus = Bonus x (1 − Bonus / 200)
    Implement only if playtest data shows need.

  11.4 COSMETIC DECEPTION
    See Section 6.3.

====================================================================
CHANGELOG: v4.0 → v4.1
====================================================================

  COUNTER TABLE FIXES

    JOUST:
    * FIXED: Course de Lance / Coup en Passant paradox. Both had each other
      in "Beaten By" but neither had the other in "Beats." Created an
      undocumented mutual −10 situation. Fixed by making them neutral.
    * Course de Lance: Beaten By changed from "Coup en Passant, Port de Lance"
      to "Port de Lance" only.
    * Coup en Passant: Beaten By changed from "Course de Lance" to "(none)."
    * All 9 directed relationships verified for strict Beats/Beaten-By symmetry.
    * Stance triangle verified at 2-1-1 pattern in all three directions.

    MELEE:
    * REBUILT from scratch. v4.0 had four Beats/Beaten-By inconsistencies:
      - OC Beaten-By listed RS, but RS Beats didn't include OC
      - RS Beaten-By listed OC, but OC Beats didn't include RS
      - OC Beaten-By was missing PT (PT Beats includes OC)
      - FB Beaten-By was missing MC (MC Beats includes FB)
    * Riposte Step reduced from 3W/0-1L (dominant) to 2W/2L (balanced).
    * New table uses same 2-1-1 triangle pattern as joust.
    * Counter profiles inversely correlated with stat power.
    * Added thematic identity notes for all melee attacks.

  MELEE RESOLUTION

    * CHANGED from absolute threshold to differential scoring.
    * Old: Hit if ImpactScore > Opponent Guard (double-counted Guard).
    * New: Hit if ImpactScore margin >= 5, Critical if margin >= 25.
    * Removed "trading blows" (mutual hits). Only one player can win
      each round, or the round is a draw.
    * Critical changed from ImpactScore > Guard + 30 (nearly impossible)
      to margin >= 25 (achievable with large fatigue differentials).
    * Win condition updated: first to 3 round wins or 1 critical.

  STAMINA

    * CLARIFIED: Starting Stamina = archetype STA value (not flat 60).
    * Charger starts at 50, Breaker 50, Technician 55, Tactician 55,
      Duelist 60, Bulwark 65.
    * This makes Stamina a meaningful differentiator between archetypes
      and forces aggressive archetypes to adapt earlier.

  FORMULAS

    * FIXED: Section 1.1 formula description. Speed modifiers are additive
      deltas (added inside parentheses), not multiplicative "Speed_Factor."
      Formula text now matches the worked example behavior.

  ARCHETYPES

    * DOCUMENTED: Stat total rationale. Totals range from 280-300 and are
      intentionally unequal. Weighted by per-point stat efficiency, all
      archetypes converge to ~94 effective value (Section 8.1).

  WORKED EXAMPLE

    * UPDATED: Uses archetype STA values (Charger 50, Technician 55).
    * Pass 1: Unchanged in formula but Stamina trajectory differs.
    * Pass 2: Charger forced to adapt (Slow + BdG instead of repeating
      Fast + CF), demonstrating richer strategic decision-making.
    * Pass 3: Both players in severe fatigue. Match extremely close.
    * Demonstrates v4.1's design goal: Charger adapts after 1 aggressive
      pass instead of sustaining brute force for 2 passes.

====================================================================
END — JOUST + MELEE SYSTEM v4.1 (BALANCE PATCH)
====================================================================
