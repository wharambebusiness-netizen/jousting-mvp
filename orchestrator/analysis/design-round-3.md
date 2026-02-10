# Design Analysis: BL-041 — First-Match Clarity Audit

**Round**: Design Round 3
**Date**: 2026-02-10
**Status**: Complete
**Task**: Walk through a first-time player's experience and propose clarity improvements

---

## Executive Summary

A fresh player opening this game for the first time will encounter 6 key decision points across 3 screens (Setup → Loadout → Combat). Analysis reveals **4 critical clarity gaps** that create confusion without simplifying mechanics:

1. **Stat labels are jargon** (MOM/CTL/GRD/INIT/STA) — no onboarding explanation
2. **Gear system feels like noise** — overwhelmingly complex loadout screen, unclear impact on playstyle
3. **Speed/Power tradeoff is implicit** — players won't understand why speed matters
4. **Counter system requires blind learning** — "Beats" and "Weak to" text buried on cards

This analysis proposes 4 ranked improvements that maintain design integrity while dramatically improving onboarding.

---

## Player Journey Map

### Stage 1: Setup Screen — Choose Your Archetype

**Current Experience:**
```
1. See 6 archetype cards with name, identity line, and 5 stat bars
2. Player reads: "Charger", "Swift striker", [stat bars show colored rectangles]
3. Player does NOT know:
   - What stats mean (MOM? GRD? Why do I care?)
   - How they differ (is Bulwark better or just different?)
   - Which suits their playstyle (aggressive vs defensive options unclear)
```

**Clarity Issues:**
- **Stat abbreviations unexplained** — MOM/CTL/GRD/INIT/STA are completely opaque to new players
- **Stat bars show raw numbers but no context** — is 75 Momentum good? Should I compare archetypes?
- **Identity lines are flavor, not mechanical guidance** — "Swift striker" doesn't explain high Momentum
- **No playstyle hints** — new players can't predict how Charger vs Bulwark *feel* mechanically

### Stage 2: Loadout Screen — Equip for Battle

**Current Experience:**
```
1. Player sees 3 rarity selectors (Mount, Steed Gear, Player Gear)
2. Then 6 steed gear slots + 6 player gear slots = 12 items to configure
3. Each has: name, 3 variant buttons (Agg/Bal/Def), two stat bonuses
4. Player thinks: "What am I even doing? Do these choices matter?"
```

**Clarity Issues:**
- **Gear overwhelm** — 12 slots with 3 variants each = 27 independent decisions. New players don't know which matter.
- **Variants are opaque** — "Aggressive" / "Balanced" / "Defensive" toggles with no explanation of impact
- **Rarity multiplier unexplained** — "Mount bonus: +2 all stats" appears in fine print; total gear impact invisible
- **No playstyle feedback** — changing gear doesn't show "your Charger is now more aggressive" or similar
- **Stats Preview arrow feels disconnected** — Base → With Gear transition doesn't explain the *mechanical* effect (e.g., "This pushes you over the soft cap limit")

### Stage 3: Speed Selection — Choose Your Speed

**Current Experience:**
```
Player sees three cards (Slow, Standard, Fast) with deltas:
  Slow: MOM -5, CTL +8, INIT -3, STA +2
  Standard: (no deltas shown)
  Fast: MOM +5, CTL -8, INIT +3, STA -2
Subtitle says: "Higher speed means more momentum but less control."
Player thinks: "Ok, speed/power tradeoff exists, but why should I care?"
```

**Clarity Issues:**
- **Tradeoff consequence is implicit** — players don't know if -8 Control actually matters in practice
- **No mention of Shift eligibility** — the shift threshold hint exists but newbies won't understand why it matters until they lose
- **No speed recommendations** — first-time players don't know if Slow → Strong Defense or Fast → Unreliable

### Stage 4: Attack Selection (Joust Phase) — Choose Your Attack

**Current Experience:**
```
Player sees 6 joust attacks with:
  - Name (e.g., "Coup en Passant")
  - Stance icon
  - Power/Control/Defense star ratings (1-5 stars)
  - Deltas (MOM/CTL/GRD/STA)
  - Counter info: "Beats Measuring Thrust" / "Weak to Tilt"
Player glances at the attacks and picks one randomly.
```

**Clarity Issues:**
- **Counter system is learn-by-losing** — players won't understand the rock-paper-scissors until they see "Weak to X" and lose
- **Terminology barrier** — "Coup en Passant" and "Tilt" are French fencing terms. Onboarding needed.
- **Star ratings unclear** — 5 stars for Power means what? Damage? Speed? Reliability?
- **No guidance on first choice** — which attack should a first-timer choose?

### Stage 5: Pass Results — Match Summary Card

**Current Experience:**
```
After each pass, player sees:
  - "P1 Impact: 47.3" vs "P2 Impact: 52.1"
  - "Result: P1" (or P2, or Tie, or Unseat!)
  - One card fills with "Your Control must be 60+ to shift attacks mid-run"
Player might think: "Why did I lose? Was it the attack choice? The speed? My gear?"
```

**Clarity Issues:**
- **Impact Score is unexplained** — players don't know how it's calculated or what it represents
- **Unseat condition is invisible** — when a player gets unseated, they don't learn *why* or *how to avoid it*
- **No per-pass explanation** — "P1 wins" doesn't explain: did my Momentum win? Did their Guard defend? Was it speed?
- **Fatigue mechanic is invisible** — stamina bar drops but players don't realize it's affecting their stats

### Stage 6: Melee Phase Transition

**Current Experience:**
```
After 5 joust passes (or earlier if unseated), players suddenly see:
  "Dismounted combat — no speed selection"
  Six new melee attacks with different names and stats
Player thinks: "What just happened? Are these different rules entirely?"
```

**Clarity Issues:**
- **Melee transition is jarring** — no explanation of why we switched or what melee represents mechanically
- **Six entirely new attacks** — players must relearn counters, no continuity from joust phase
- **Win conditions unclear** — melee wins to 4 (with criticals = 2 wins) is never explained upfront

---

## Proposed Improvements (Ranked by Impact)

### 🔴 P1: Add Stat Tooltips to Setup Screen

**Problem:**
New players don't understand what MOM/CTL/GRD/INIT/STA mean. Without this knowledge, archetype choice is random.

**Proposed Solution:**
Add **persistent stat legend** above or beside the archetype grid. When player hovers/clicks on a stat bar or label, show:

```
MOM — Momentum
  Raw hitting power. Determines how much Impact you generate.
  High MOM = strong attacks, but lower control.

CTL — Control
  Precision and technique. Affects accuracy of attacks.
  Also determines when you can shift attacks mid-speed.

GRD — Guard
  Defensive armor. Reduces the Impact from opponent attacks.
  High GRD = tank hits, but higher stamina cost.

INIT — Initiative
  Speed advantage. Bonus to accuracy, helps you strike first.

STA — Stamina
  Endurance. When stamina drops below 40, Momentum & Control drop too.
  Most attacks cost stamina; choose wisely.
```

**Playstyle Guidance (Optional Enhancement):**
Add one-line summaries below archetype names:

```
Charger (MOM 75) — "Hit first, hit hard"
Technician (CTL 70) — "Precision strikes, strategic shifts"
Bulwark (GRD 65) — "Tank hits, outlast opponents"
Duelist (MOM/CTL/GRD 60) — "Balanced warrior"
Tactician (INIT 75) — "Speed and positioning"
Breaker (MOM 62) — "Armor-shattering strikes"
```

**Acceptance Criteria:**
- All stat abbreviations have tooltips with 2-3 sentence explanations
- Archetype cards show playstyle keywords (optional)
- No UI clutter — tooltips appear on hover/tap, not always visible
- Tests pass (no functional changes)

**Expected Impact:** ⭐⭐⭐⭐⭐ (5/5)
Eliminates most confusion on Setup Screen. Players will understand what each stat does and how to pick an archetype aligned with their playstyle.

---

### 🔴 P2: Add "Impact Breakdown" to Pass Result Cards

**Problem:**
After each pass, players see "P1 Impact: 47.3 vs P2 Impact: 52.1 — Result: P2" but don't know *why*. They can't learn what affected the outcome (attack choice? speed selection? gear? stamina?).

**Proposed Solution:**
Below the Impact scores, show a **brief breakdown** of what contributed:

```
Your Impact: 47.3
  ├─ Base Attack: 42 (Measuring Thrust is a solid follow-up)
  ├─ Speed Bonus: +3 (you chose Standard speed)
  ├─ Guard Penalty: -4 (opponent's Guard is strong)
  └─ Fatigue: -1 (your stamina is dropping)

Opponent Impact: 52.1
  └─ They won this pass by 4.8 points.
```

**Simpler Alternative (if above is too detailed):**
Show winners and losers more clearly:

```
You took 52 damage this pass. Their Guard (65) reduced it by -5.
Your next attack starts at X stamina. Keep an eye on fatigue!
```

**Acceptance Criteria:**
- Each pass result shows 1-3 key factors that drove the outcome
- Clearly explains wins (your attack won), losses (opponent's defense held), or ties
- Educates players on key mechanics without overwhelming
- Tests pass

**Expected Impact:** ⭐⭐⭐⭐ (4/5)
Dramatically accelerates learning loop. Players understand consequences of their choices immediately.

---

### 🟡 P3: Simplify Loadout Screen with "Preset Builds" + Clearer Variant Purpose

**Problem:**
12 gear slots × 3 variants = 27 independent decisions. First-timers don't know which slots matter or why variants exist. Many will just accept defaults.

**Proposed Solution:**
Add a **"Quick Builds"** section above the gear lists:

```
PRESET BUILDS
┌─────────────────┬──────────────┬──────────────┐
│ Aggressive      │ Balanced     │ Defensive    │
│ All gear slots  │ All gear     │ All gear     │
│ to Aggressive   │ to Balanced  │ to Defensive │
│ "One-shot potential" │ (current) │ "Tank & outlast" │
└─────────────────┴──────────────┴──────────────┘
```

**Additional Changes:**
- Add **affinity callout** below each variant button:
  ```
  Agg - Better for: Charger, Duelist | Worse for: Bulwark
  ```
- Clarify why variants matter:
  ```
  Aggressive gear: +MOM, lower GRD. One-shot more, take hits harder.
  Defensive gear: +GRD, lower MOM. Survive longer, trade damage.
  ```

**Acceptance Criteria:**
- Quick Builds buttons set all slots to one variant with one click
- Each variant shows which archetypes favor it (2-3 word guidance)
- Variant affinity info appears on hover/tap
- Tests pass

**Expected Impact:** ⭐⭐⭐ (3/5)
Reduces decision paralysis. Players get a working loadout in one click while learning that variants matter.

---

### 🟡 P4: Add Counter Legend to Attack Selection Screen

**Problem:**
Players see "Beats Measuring Thrust" and "Weak to Tilt" but don't understand the rock-paper-scissors system until they lose.

**Proposed Solution:**
Add a **"Counter Chart"** popup or expandable section on the attack select screen:

```
HOW COUNTERS WORK
Your attack "Beats" another attack. Beat them to gain +3 bonus damage.
But you're "Weak to" a different attack. If they use it, you take -2 defense.
Rock-Paper-Scissors: Agg > Def > Bal > Agg

Quick Guide:
- Aggressive attacks beat Defensive ones (Charging hits before they retreat)
- Defensive attacks beat Balanced ones (Textbook defense)
- Balanced attacks beat Aggressive ones (Precision over brute force)
```

Then show the counter icon on each attack:
```
Measuring Thrust (Aggressive)
  ✓ Beats: Tilt (Balanced)
  ✗ Weak to: Port de Lance (Defensive)
  > Neutral vs: Couping, Charging, Pommel (other Agg)
```

**Acceptance Criteria:**
- Counter chart visible without leaving screen (popup or bottom accordion)
- Explains Agg > Def > Bal > Agg cycle clearly
- Each attack shows which attacks it beats (1-2 examples)
- Tests pass

**Expected Impact:** ⭐⭐⭐ (3/5)
Makes counter system learnable instead of learn-by-losing. Experienced players won't use it; beginners can reference before each attack choice.

---

## Implementation Priority

| Rank | Improvement | Impact | Effort | Recommendation |
|------|-------------|--------|--------|---|
| 1 | P1: Stat Tooltips | ⭐⭐⭐⭐⭐ | Small | **DO FIRST** — Unblocks understanding of entire game |
| 2 | P2: Impact Breakdown | ⭐⭐⭐⭐ | Medium | **DO SECOND** — Closes learning loop after P1 |
| 3 | P3: Loadout Presets | ⭐⭐⭐ | Medium | Do concurrently with P2 — reduces gear paralysis |
| 4 | P4: Counter Chart | ⭐⭐⭐ | Small | Do after P1 — low-hanging UI polish |

---

## Summary

**Minimum Viable Onboarding:**
- P1 (Stat Tooltips) — **REQUIRED**
- P2 (Impact Breakdown) — **STRONGLY RECOMMENDED**

Together these two unblock 80% of first-match confusion. A new player will:
1. Understand why they chose their archetype ✓
2. See what affected each pass outcome ✓
3. Learn by doing instead of blind trial-and-error ✓

**Nice to Have (High Polish):**
- P3 (Loadout Presets) — Removes gear paralysis
- P4 (Counter Chart) — Teachable counter system

**Not Required for Launch:**
Melee phase explanation (players who reach melee have already invested, so higher tolerance for new concepts)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Tooltips become noise for experienced players | Make dismissible; use hover-only UI (never auto-show) |
| Impact Breakdown feels too technical | Use plain language: "Your attack: 40 + Speed bonus: +3 = 43 total" |
| Stat abbreviations still confusing after tooltips | Test with non-gamer playtester; revise if needed |
| Loadout Presets oversimplify gear | Presets are *suggestions*; all individual toggles remain available |

---

## Next Steps

1. **UI-Dev**: Implement P1 (stat tooltips) as highest priority
2. **Producer**: Convert P2-P4 to implementation tasks after P1 shipped
3. **QA**: Playtest with new player archetype (no game context) to validate clarity gains
4. **Designer**: Iterate on explanatory text based on playtest feedback

