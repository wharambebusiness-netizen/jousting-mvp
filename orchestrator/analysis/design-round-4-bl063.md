# Design Spec: BL-063 — Impact Breakdown UI for Pass Results
**Round**: Design Round 4 (Continuation)
**Date**: 2026-02-10
**Task**: BL-063 (P2, CRITICAL) — Design expandable Impact Breakdown card for pass result screen
**Status**: Complete — Design specification ready for ui-dev implementation

---

## Executive Summary

**Problem**: Players can't learn why they won or lost each pass. Pass results show only "You won this pass" or "You lost" with no explanation of impact differences, guard contributions, or fatigue effects. This prevents players from iterating on strategy and closes the learning loop identified in BL-041.

**Solution**: Add **expandable Impact Breakdown card** to pass result screen showing:
1. Your Impact Score vs Opponent Impact Score (visual bar graph)
2. Margin of victory (±Z impact points)
3. Attack advantage explanation (if applicable: counter win, guard penetration)
4. Guard contribution breakdown (if your guard absorbed impact)
5. Fatigue effect explanation (if applicable: you or opponent was fatigued)

**Impact**: Closes learning loop for new players. Players understand WHY they won/lost and can adjust strategy. Improves retention and engagement.

**Implementation**: Medium complexity — requires coordinate with engine-dev for calculator refactoring (PassResult structure), ui-dev for component expansion logic, and qa for test coverage. Low risk of regressions if PassResult is extended cleanly.

---

## Context: Current Pass Result Structure

From match.test.ts, PassResult currently contains:
```typescript
{
  passNum: number,
  attacker: 'p1' | 'p2',
  p1Choice: JoustChoice,
  p2Choice: JoustChoice,
  p1Impact: number,
  p2Impact: number,
  p1Accuracy: number,
  p2Accuracy: number,
  p1Guard: number,        // Guard value after calculation
  p2Guard: number,
  p1FatigueFactor: number, // 0.5 - 1.0
  p2FatigueFactor: number,
  outcome: 'p1-wins' | 'p2-wins' | 'tie',
  winMargin: number,      // Impact score difference
}
```

**Available for design**:
- Impact scores (p1Impact, p2Impact)
- Guard values (p1Guard, p2Guard)
- Fatigue factors (p1FatigueFactor, p2FatigueFactor)
- Outcome and win margin

**NOT currently captured** (will need calculator refactoring):
- Counter winner (who won the counter table lookup)
- Guard penetration applied (Breaker mechanic)
- Actual impact absorbed by guard
- Stat adjustments due to fatigue

---

## Design Specification

### 1. Information Architecture

The Impact Breakdown card shows **6 distinct sections**, expandable/collapsible:

#### **Section 1: Result Summary (Always Visible)**
```
┌────────────────────────────────┐
│ ✓ YOU WON THIS PASS  [+8 impact]
│
│ Your Impact: 42  vs  Opponent: 34
│ [████████████░░░░░░░░░░░░░░░░] ← Bar graph
│
│ Tap to expand breakdown ↓
└────────────────────────────────┘
```

**Content**:
- Win/Lose/Tie status with margin (±X impact)
- Raw impact scores (numerical)
- Bar graph comparing your impact vs opponent (visual)
- CTA to expand

**Why this order**: Immediate answer to "who won" + magnitude, then details.

---

#### **Section 2: Attack Advantage (Expandable, If Applicable)**
```
┌────────────────────────────────┐
│ [▼] ATTACK ADVANTAGE
│
│ 🎯 Counter Win
│ Your Coup en Passant beats their Guard Low
│
│ Impact Bonus: +4 (your attack wins)
│ If they had won: -4 (would reduce your impact)
│
│ How to learn: Coup en Passant beats Guard Low
│ (tap ⓘ for counter chart)
└────────────────────────────────┘
```

**Scenarios**:
- **Counter win**: "Your [Attack Name] beats their [Attack Name]" → +4 bonus
- **Counter loss**: "Their [Attack Name] beats your [Attack Name]" → opponent gets +4, you lose -4
- **Counter tie**: "Both attacks are equal" → no bonus, tie resolved by accuracy
- **No counter**: "This attack pairing doesn't counter" → no mention (skip section)

**Why**: Teaches counter system through concrete example. Links to tutorial.

---

#### **Section 3: Guard Breakdown (Expandable, If Your Guard Was Effective)**
```
┌────────────────────────────────┐
│ [▼] YOUR GUARD
│
│ Guard Strength: 65
│ Impact Absorbed: 12 out of 46 (26%)
│
│ Your Impact Without Guard: 58
│ Your Impact After Guard: 42
│ Guard Reduction: -16
│
│ Opponent's Impact: 34 (before guard)
│ Opponent's Impact After Your Guard: 34 (no guard reduction)
│
│ Why: Guard only reduces THEIR impact, not yours
└────────────────────────────────┘
```

**Content**:
- Your guard stat value
- How much impact your guard absorbed (numerical + percentage)
- Visual comparison: impact before vs after guard
- Your effective impact (after your own armor, before guard)
- Opponent's impact (your guard doesn't reduce your own damage)
- Brief explanation: "Guard only reduces THEIR impact"

**When to show**:
- Only if your guard stat > 40 (otherwise too small to matter)
- Only if opponent's attack would have landed (accuracy passed)
- Only if there's a meaningful reduction (> 3 impact)

**Why**: Demystifies guard mechanic. Shows Guard stat isn't wasted even if you lose.

---

#### **Section 4: Fatigue Effect (Expandable, If Applicable)**
```
┌────────────────────────────────┐
│ [▼] FATIGUE EFFECT
│
│ YOU WERE 25% FATIGUED (Stamina: 30/50)
│
│ Your Stat Adjustments:
│ - Momentum: 75 → 60 (-15 due to fatigue)
│ - Control: 55 → 55 (no change)
│ - Guard: 50 → 50 (immune to fatigue)
│
│ Impact if Fresh: 50
│ Impact While Fatigued: 42
│ Fatigue Penalty: -8 impact
│
│ Strategy Tip: When stamina drops below 40,
│ your Momentum and Control suffer. Choose safe moves!
└────────────────────────────────┘
```

**Content for Player**:
- Fatigue level as percentage + raw stamina
- Stat adjustments (Momentum/Control reduced, Guard unaffected)
- Numerical impact penalty due to fatigue
- Strategy tip: when does fatigue kick in, what to do

**Content for Opponent** (if applicable):
- "OPPONENT WAS 50% FATIGUED (Stamina: 10/60)"
- Their stat adjustments
- Their impact penalty
- "They were tired—good time to press!"

**When to show**:
- Only if fatigue factor is significantly different from 1.0 (< 0.95)
- Only if it actually affected the pass outcome (not just FYI)

**Why**: Teaches stamina management. Shows fatigue isn't binary (you're still playing while fatigued).

---

#### **Section 5: Accuracy (Expandable, If Tie or Close Call)**
```
┌────────────────────────────────┐
│ [▼] ACCURACY
│
│ YOUR ATTACK ACCURACY: 42 / 50 (84%)
│ OPPONENT'S ACCURACY: 38 / 50 (76%)
│
│ Impact Calculation:
│ Your Impact: 42 × 84% = 35.28 ≈ 35
│ Opponent Impact: 50 × 76% = 38 ≈ 38
│
│ Result: You lost by 3 impact
│ (Initiative stat + RNG = 1-50 accuracy range)
└────────────────────────────────┘
```

**Content**:
- Your accuracy (Initiative + RNG)
- Opponent's accuracy
- Show accuracy affects impact (multiplicative)
- Numerical breakdown of calculation
- Explain sources of accuracy (Initiative + RNG)

**When to show**:
- Only if accuracy was the deciding factor (impacts close, accuracies different)
- Or if pass was very close (within 5 impact, even with clear winner)
- Hide if outcome was blow-out (>15 impact difference)

**Why**: Shows RNG isn't random (it's Initiative + RNG interaction), builds confidence.

---

#### **Section 6: Breaker Guard Penetration (Expandable, If Breaker Involved)**
```
┌────────────────────────────────┐
│ [▼] GUARD PENETRATION
│
│ OPPONENT IS BREAKER (Guard Penetration: 25%)
│
│ Normal Guard Reduction: -16
│ With Penetration: -12 (75% of normal)
│
│ Their Effective Impact: 46 (higher due to penetration)
│ This is why Breaker counters high-guard opponents
└────────────────────────────────┘
```

**Content**:
- Which opponent is Breaker
- Their guard penetration coefficient (25%)
- Show what guard reduction would have been (without penetration)
- Show actual guard reduction (with penetration)
- Explain: "Breaker's ability reduces guard effectiveness"

**When to show**:
- Only if Breaker is in match
- Only if guard was applied (otherwise irrelevant)
- Can always show (not conditional)

**Why**: Teaches Breaker identity. Explains why they're strong against guards.

---

### 2. Visual Design & Interaction

#### **Desktop (≥1024px): Expanded by Default**

```
┌─────────────────────────────────────────────┐
│ PASS 1: JOUST PHASE                         │
├─────────────────────────────────────────────┤
│                                             │
│ ✓ YOU WON THIS PASS  [+8 impact]            │
│                                             │
│ Your Impact: 42  vs  Opponent: 34           │
│ [████████████░░░░░░░░░░░░░░░░░░░░░░░░]     │
│                                             │
│ ─────────────────────────────────────────   │ ← Separator
│                                             │
│ [▼] ATTACK ADVANTAGE                        │
│ Your Coup en Passant beats their Guard Low  │
│ Impact Bonus: +4                            │
│                                             │
│ [▼] YOUR GUARD                              │
│ Guard Strength: 65                          │
│ Impact Absorbed: 12 (26%)                   │
│ Guard Reduction: -16                        │
│                                             │
│ [▼] FATIGUE EFFECT                          │
│ You were 25% fatigued (Stamina: 30/50)      │
│ Momentum: 75 → 60 (-15)                     │
│ Fatigue Penalty: -8 impact                  │
│                                             │
│ [▼] ACCURACY                                │
│ Your Accuracy: 42 / 50 (84%)                │
│ Opponent Accuracy: 38 / 50 (76%)            │
│ Your Impact: 42 × 84% = 35                  │
│                                             │
└─────────────────────────────────────────────┘

Next Pass →
```

**Layout**:
- Sections stacked vertically
- Each section has [▼] toggle (collapsed by default on mobile, expanded on desktop)
- Bar graph spans full width (with padding)
- Sections separated by light divider line
- Clear visual hierarchy (result > advantage > guard > fatigue > accuracy)

**Interaction**:
- Click [▼] to collapse/expand section
- All sections expanded on desktop by default
- Smooth 0.3s height animation when expanding/collapsing

---

#### **Tablet (768px–1023px): Collapsible Sections**

Same layout as desktop, but:
- Sections **collapsed by default** to save space
- Click [▼] to expand individual sections
- Only one section expanded at a time (optional: can expand multiple)

---

#### **Mobile (<768px): Aggressive Collapse**

```
┌──────────────────────────┐
│ PASS 1: JOUST             │
├──────────────────────────┤
│                          │
│ ✓ YOU WON [+8]           │
│ 42 vs 34                 │
│ [████░░░░░░░░░░░░░░]     │
│                          │
│ [▼] Attack Advantage     │
│ [▼] Your Guard           │
│ [▼] Fatigue Effect       │
│ [▼] Accuracy             │
│ [▼] Breaker Penetration  │
│                          │
│ ← Previous  Next Pass →   │
│                          │
└──────────────────────────┘
```

**Changes**:
- Result summary only (not expanded sections)
- All sections collapsed by default
- Tap [▼] to expand one at a time
- Bar graph shorter (fits 300px width)
- Minimal text (abbreviate descriptions)
- Previous/Next pass navigation at bottom

**Why**: Keeps mobile view clean, reveals details on demand.

---

### 3. Bar Graph Visualization

The bar graph compares your impact vs opponent impact visually:

#### **Design**:
```
Your Impact:   [████████████░░░░░░░░░░░░░░] 42/70
Opponent:      [██████████░░░░░░░░░░░░░░░░] 34/70

Key:
██ = Your impact (green or primary color)
██ = Opponent impact (red or secondary color)
░░ = Unused portion
```

**Implementation**:
- Two horizontal bars
- Each fills based on ratio to max (usually 70 for bare, 80+ for giga)
- Color: Your impact = primary color (green/blue), Opponent = secondary (red/orange)
- Show numerical values to the right: "42/70", "34/70"
- Slightly thick (20px height each) for visibility

**Accessibility**:
- Labels above/to the left ("Your Impact", "Opponent")
- Numerical values always visible (not just in bar)
- High contrast between colors (meet WCAG AA)
- Screen readers read: "Your impact: 42 out of 70" (not visual only)

---

### 4. Accessibility Requirements (WCAG 2.1 AA)

#### **Keyboard Navigation**
- Tab through expandable sections → [▼] toggles focused section
- Enter/Space to expand/collapse
- Arrow keys to navigate between sections (optional enhancement)
- Focused section has clear blue outline

#### **Screen Reader Support**
- Each section labeled: "Attack Advantage section"
- Expanded state announced: "Attack Advantage section, expanded"
- All numerical values read aloud
- Instructions clear: "press Enter to expand"

#### **Mobile Accessibility**
- Tap targets ≥44px (section headers + [▼] toggle)
- Colors not sole differentiator (use icons + text)
- Text remains readable at 200% zoom

#### **Color Contrast**
- Text on background: 17:1 (dark ink + light parchment) ✅
- Bar graph colors: distinct and high contrast (avoid red/green alone)
- Ensure green/red bar colors are colorblind-friendly (add hatching or texture if possible)

---

### 5. Data Requirements (Engine Integration)

To build Impact Breakdown, we need **additional data** from `resolveJoustPass()`:

#### **Currently Available**:
- `p1Impact`, `p2Impact` (raw impact scores)
- `p1Guard`, `p2Guard` (guard values)
- `p1FatigueFactor`, `p2FatigueFactor` (fatigue multipliers)
- `outcome`, `winMargin`

#### **Need to Add to PassResult**:
```typescript
PassResult = {
  // ... existing fields ...

  // Counter information
  p1CounterWon?: boolean,      // Did player 1's attack counter player 2's?
  p2CounterWon?: boolean,      // Did player 2's attack counter player 1's?
  counterWinBonus?: number,    // +4 impact bonus (if counter won)

  // Guard contribution
  p1OriginalImpact?: number,   // Impact before guard was applied
  p2OriginalImpact?: number,   // Impact before guard was applied
  p1GuardReduced?: number,     // How much guard reduced opponent's impact
  p2GuardReduced?: number,     // How much guard reduced opponent's impact
  p1GuardPenetration?: boolean,// Did opponent use Breaker penetration?
  p2GuardPenetration?: boolean,

  // Fatigue stat adjustments (for learning)
  p1StatsBeforeFatigue?: { mom: number, ctl: number, grd: number },
  p2StatsBeforeFatigue?: { mom: number, ctl: number, grd: number },

  // Stamina context
  p1Stamina?: number,          // Current stamina after pass
  p2Stamina?: number,
  p1MaxStamina?: number,       // For fatigue percentage
  p2MaxStamina?: number,
};
```

**Implementation Strategy**:
- Engine-dev extends `resolveJoustPass()` to compute and return these fields
- UI-dev uses fields to conditionally show/hide breakdown sections
- No breaking changes to existing PassResult consumers (add optional fields)
- QA writes tests to validate counter detection, guard reduction calculation

---

### 6. Implementation Details for UI-Dev

#### **Component Structure**

```typescript
// PassResultBreakdown.tsx (new component)
interface PassResultBreakdownProps {
  passResult: PassResult;
  isPlayer1: boolean;  // Are we showing player 1's perspective?
}

export function PassResultBreakdown({ passResult, isPlayer1 }: PassResultBreakdownProps) {
  // Show "YOU WON" vs "YOU LOST" based on isPlayer1
  // Conditionally render sections based on passResult fields
}

// Subcomponents (optional, for cleanliness)
- ImpactSummary          // Result + bar graph
- AttackAdvantageBreakdown
- GuardBreakdown
- FatigueBreakdown
- AccuracyBreakdown
- BreakerPenetrationBreakdown

// Expandable section wrapper
function ExpandableSection({
  title,
  children,
  isOpen,
  onToggle,
}) {
  // [▼] TITLE
  // {children} (shown if isOpen)
}
```

#### **Files to Modify**

1. **`src/engine/calculator.ts`** (engine-dev)
   - Refactor `resolveJoustPass()` to compute counter winner
   - Compute guard reduction before/after
   - Track Breaker penetration flag
   - Return extended PassResult

2. **`src/engine/phase-joust.ts`** (engine-dev)
   - Update `resolveJoustPass()` call to pass new fields
   - Test: verify all new fields are populated

3. **`src/ui/PassResult.tsx`** (ui-dev)
   - Import new `PassResultBreakdown` component
   - Add above match result summary
   - Pass `passResult` + `isPlayer1` props

4. **`src/App.tsx`** (ui-dev)
   - Update MatchScreen to show PassResultBreakdown for each pass
   - Add state for which section is expanded (or keep all expanded on desktop)

5. **`src/index.css`** (ui-dev)
   - Add `.breakdown-section` styles (collapse/expand animation)
   - Add `.bar-graph` styles (horizontal bars)
   - Add `.section-header` styles (toggle button)
   - Mobile breakpoints for space-saving layout

#### **Implementation Priority**

| Task | Effort | Owner | Priority |
|------|--------|-------|----------|
| Extend PassResult in calculator.ts | 2–3h | engine-dev | P1 (blocker) |
| Create PassResultBreakdown component | 2–3h | ui-dev | P1 |
| Add expandable section animation | 1h | ui-dev | P1 |
| Add bar graph visualization | 1h | ui-dev | P1 |
| Mobile collapse logic | 1h | ui-dev | P2 |
| Screen reader testing + fixes | 1h | qa | P2 |
| Cross-browser testing | 0.5h | qa | P2 |

---

### 7. Content Templates

#### **Template: Counter Win**
```
🎯 Counter Win
Your [ATTACK_NAME] beats their [OPPONENT_ATTACK_NAME]
Impact Bonus: +4 (your attack wins)

If they had won: -4 (would reduce your impact)

How to learn: [ATTACK_NAME] beats [OPPONENT_ATTACK_NAME]
(Tap ⓘ for counter chart)
```

**Variables**:
- ATTACK_NAME: e.g., "Coup en Passant"
- OPPONENT_ATTACK_NAME: e.g., "Guard Low"

---

#### **Template: Guard Reduction**
```
Your Guard Strength: [GUARD_STAT]
Impact Absorbed: [GUARD_REDUCTION] out of [OPPONENT_IMPACT] ([PERCENT]%)

Your Impact Without Guard: [IMPACT_BEFORE]
Your Impact After Guard: [IMPACT_AFTER]
Guard Reduction: -[GUARD_REDUCTION]

Guard only reduces THEIR impact, not yours.
```

**Variables**:
- GUARD_STAT: e.g., "65"
- GUARD_REDUCTION: e.g., "12"
- OPPONENT_IMPACT: e.g., "46"
- PERCENT: e.g., "26%"
- IMPACT_BEFORE: e.g., "58"
- IMPACT_AFTER: e.g., "42"

---

#### **Template: Fatigue**
```
YOU WERE [FATIGUE_PERCENT] FATIGUED (Stamina: [CURRENT]/[MAX])

Your Stat Adjustments:
- Momentum: [MOM_BEFORE] → [MOM_AFTER] ([MOM_CHANGE] due to fatigue)
- Control: [CTL_BEFORE] → [CTL_AFTER] ([CTL_CHANGE])
- Guard: [GRD_BEFORE] → [GRD_AFTER] (immune to fatigue)

Impact if Fresh: [IMPACT_IF_FRESH]
Impact While Fatigued: [IMPACT_ACTUAL]
Fatigue Penalty: -[FATIGUE_PENALTY] impact

Strategy Tip: When stamina drops below 40, your Momentum and Control suffer. Choose safe moves!
```

---

### 8. Testing Checklist

- [ ] **Counter Detection**: Pass with counter win shows "Attack Advantage" section
- [ ] **Counter Loss**: Pass with counter loss shows opponent's advantage
- [ ] **Guard Reduction**: Guard >40 shows "Your Guard" section with % absorbed
- [ ] **Fatigue Display**: Fatigued player shows "Fatigue Effect" section with stat changes
- [ ] **Accuracy Calculation**: Close passes show "Accuracy" section with formula breakdown
- [ ] **Breaker Penetration**: Breaker opponent shows penetration section
- [ ] **Section Expansion**: Click [▼] expands/collapses smoothly (0.3s animation)
- [ ] **Mobile Collapse**: All sections collapsed by default on <768px
- [ ] **Bar Graph Rendering**: Visual comparison accurate to numerical values
- [ ] **Color Contrast**: All text meets 4.5:1 ratio
- [ ] **Keyboard Navigation**: Tab to sections, Enter to toggle
- [ ] **Screen Reader**: All text read aloud, no visual-only information
- [ ] **All Browsers**: Chrome, Safari, Firefox, Edge, mobile Safari, Chrome Mobile
- [ ] **No Regressions**: Match screen renders correctly with new component

---

### 9. Expected Outcomes

#### **Player Experience**

**Before**:
```
Pass 1: You won
(No explanation)
Player: "Why did I win? Was my counter good, or just luck?"
```

**After**:
```
Pass 1: You won [+8]
Impact: 42 vs 34

[▼] Attack Advantage → "Your Coup en Passant beats Guard Low" (+4)
[▼] Your Guard → "Absorbed 12 impact" (65 GRD strength)
[▼] Fatigue Effect → "You were 25% fatigued" (penalty -8)

Player: "Ah! I won because:
1. My counter beat their attack (+4)
2. My guard was strong (absorbed 12)
3. I was fatigued but still effective
= +8 win margin makes sense!"
```

#### **Learning Outcomes**

✅ Players understand counter system through concrete examples
✅ Players see guard isn't "wasted" even on losing pass
✅ Players learn stamina management strategy (avoid low stamina)
✅ Players predict outcomes before pass resolves ("if I'm fatigued, I'll lose this")
✅ Players iterate on strategy based on feedback

---

### 10. Definition of Done

✅ **Design spec complete when**:
1. All 6 breakdown sections are specified (with templates)
2. Visual layout is specified for desktop/tablet/mobile
3. Bar graph design is specified (colors, labels, accessibility)
4. Accessibility requirements are documented (keyboard, screen reader)
5. Data requirements are specified (PassResult extensions)
6. Implementation roadmap is provided (files, effort estimates)
7. Testing checklist covers all interaction patterns + accessibility

✅ **Engine-dev ready to implement when**:
1. Designer has specified all PassResult fields needed
2. Calculator refactoring plan is clear (compute counter, guard, fatigue data)
3. Tests planned for new fields

✅ **UI-Dev ready to implement when**:
1. Engine-dev has extended PassResult
2. Designer has approved all section layouts + content
3. Testing checklist reviewed

---

### 11. Optional Enhancements (Post-MVP)

#### **Interactive Counter Chart Modal**
Show full 6×6 counter table when user taps "(Tap ⓘ for counter chart)".

**Effort**: 2–3h

---

#### **Stat Comparison Sidebar**
Show archetype stats before/after fatigue in expandable sidebar.

**Effort**: 1–2h

---

#### **Expected vs Actual Impact**
Show what impact "should" have been if RNG was different (max/min accuracy).

**Effort**: 1–2h

---

#### **Animated Impact Numbers**
Show impact score ticking up/down as calculation happens (visual feedback).

**Effort**: 2–3h

---

### 12. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| PassResult extends too large, hard to maintain | Medium | Low | Use optional fields, plan for versioning |
| Engine-dev refactoring breaks existing tests | Medium | High | Engine-dev writes new tests for extended fields |
| Counter detection logic incomplete | Low | High | Reference attacks.ts counter table exhaustively |
| Mobile layout too cramped | Medium | Medium | Tablet breakpoint at 768px (not 600px), more space |
| Screen reader reads sections redundantly | Low | Low | Add `aria-hidden` to CSS pseudo-elements |
| Bar graph colors not colorblind-friendly | Low | Medium | Use patterns (solid + hatching) if red/green |

---

### 13. Summary Table

| Aspect | Detail | Status |
|--------|--------|--------|
| **Content** | 6 breakdown sections with templates | ✅ Complete |
| **Desktop Layout** | Expanded sections, full width | ✅ Specified |
| **Tablet Layout** | Collapsible sections by default | ✅ Specified |
| **Mobile Layout** | Aggressive collapse, tab nav | ✅ Specified |
| **Bar Graph** | Visual impact comparison + labels | ✅ Specified |
| **Accessibility** | Keyboard, screen reader, color contrast | ✅ Specified |
| **Data Requirements** | PassResult extensions needed | ✅ Specified |
| **Implementation Guide** | Files to modify, effort estimates | ✅ Provided |
| **Testing Checklist** | All interaction patterns | ✅ Provided |
| **Optional Enhancements** | Counter chart, stat sidebar, etc. | ✅ Listed |
| **Definition of Done** | Criteria for complete & ready | ✅ Defined |

---

### 14. Next Steps

1. **Designer** (this round): ✅ Complete — specs written, template ready
2. **Producer**: Convert spec to BL-064 (ui-dev) + BL-063x (engine-dev) implementation tasks
3. **Engine-Dev** (next round): Refactor `resolveJoustPass()` to populate extended PassResult fields
4. **UI-Dev** (next round): Implement PassResultBreakdown component with expandable sections
5. **QA** (next round): Test all sections, counter detection, guard reduction, fatigue calculations
6. **Designer** (next round): Monitor BL-064 progress, approve final layouts

---

## Appendix: Content Tone Guide

All descriptions should be **clear, concrete, and actionable** (not abstract):

### ❌ Avoid:
- "Your attack has a synergy with defensive positioning"
- "The guard system implements a damage mitigation threshold"

### ✅ Use:
- "Your attack beats their attack" (concrete)
- "Your guard absorbed 12 impact" (concrete)
- "You were fatigued, so your Momentum dropped" (cause → effect)

### Tone Examples:

**Counter Win**: "Your Coup en Passant beats Guard Low" (not "your counter was superior")

**Guard**: "Guard only reduces THEIR impact, not yours" (not "guard implements asymmetric damage reduction")

**Fatigue**: "When stamina drops below 40, your Momentum and Control suffer. Choose safe moves!" (not "fatigue implements stat scaling via fatigueRatio")

---

**End of Design Specification — Ready for Engine-Dev & UI-Dev Implementation**
