# Design Spec: BL-070 — Melee Transition Explainer Screen
**Round**: Design Round 7 (Stretch Goal)
**Date**: 2026-02-10
**Task**: BL-070 (P4, STRETCH) — Design melee transition explainer screen
**Status**: ✅ COMPLETE — Design specification ready for ui-dev implementation

---

## Executive Summary

**Problem**: When transitioning from joust phase to melee phase, the shift is jarring and unexplained. New players suddenly see a different attack set (sword/shield instead of lance/shield) with no context about why the rules changed or what to expect. This creates confusion and makes melee phase feel disconnected from joust.

**Solution**: Add a brief **transition explainer screen** (1–2 seconds, user-dismissible) between joust and melee phases showing:
1. **Visual transition**: Lance/shield → Sword/shield (shows physical weapon change)
2. **Brief explanation**: "New attack set available — learn the new matchups"
3. **Counter chart preview** (optional): Mini version of BL-067 counter chart for melee attacks
4. **"Continue" button**: Advances to melee phase

**Impact**: Reduces jarring phase transition, primes players to expect new attack mechanics, improves learning loop continuity.

**Scope**: Pure UI/UX design (no code changes). Builds on BL-067 Counter Chart work. Can ship immediately after BL-064 (critical learning loop) completes.

---

## Design Specification

### 1. Screen Content & Layout

#### **Title Section**
```
"Transition to Melee Phase"
```
- Font: Heading 2 (same size as phase titles elsewhere in game)
- Color: Primary accent color (matches "Speed Selection" / "Attack Selection" titles)
- Positioning: Top-center of screen
- Animation: Fade in over 0.3s

#### **Visual Transition Diagram**
```
[JOUST PHASE]              [MELEE PHASE]
  Lance + Shield    →    Sword + Shield
```
- Layout: Horizontal, with arrow icon in middle
- Left side (JOUST): Icon showing lance + shield
- Arrow icon:→ (large, 48px, centered)
- Right side (MELEE): Icon showing sword + shield
- Visual continuity: Same character silhouette, only weapon changes
- Animation: Slide from left to right over 0.5s (smooth transition effect)

#### **Explanatory Text Block**
```
"A new attack set is available in melee combat.
Learn the new matchups — Guard High works differently, and new attacks give you fresh tactical options.
Take your time to study the counter chart before engaging."
```
- Font: Body text (same as pass result explanations)
- Size: 14–16px
- Line-height: 1.5 (readable)
- Color: Secondary text color (matches "Pass Results" explanatory text)
- Max-width: 90% on mobile, 70% on desktop
- Positioning: Centered below diagram
- Animation: Fade in over 0.5s (after diagram animation completes)

#### **Counter Chart Preview (Optional)**
If BL-067 Counter Chart design is complete, show a mini version:
- Display: 3 melee attacks (Guard High, Low Cut, Measured Cut) with beats/weak-to relationships
- Layout: Compact 3-row list (not full 6-row chart)
- Positioning: Below explanatory text, in a light gray card (20% opacity background)
- Label: "Melee Counter Preview — Full chart available in Attack Selection"
- Link/CTA: "View full counter chart" (optional button link to attack select)
- Note: This can be deferred to post-MVP if time is tight

### 2. Screen Design

#### **Overall Layout**
- Full-screen modal overlay (z-index: 100, to sit above all game screens)
- Background: Semi-transparent dark overlay (20% opacity, `rgba(0, 0, 0, 0.2)`)
- Content area: Centered box on screen
- Padding: 40px (desktop), 24px (tablet), 16px (mobile)
- Max-width: 500px (desktop), 100% (mobile)
- Border-radius: 12px (matches game card styling)
- Background: Parchment/cream color (same as other card backgrounds)
- Box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) (matches game depth styling)

#### **Color Scheme**
- Title: Primary accent color (#3D5C5C, dark teal — matches "Speed Selection" / "Attack Selection" headers)
- Diagram icons: Stance-colored (lance/shield in joust color, sword/shield in primary)
- Text: Secondary text color (#333 on light background)
- Preview card: Light gray background (20% opacity), same borders as attack cards
- Continue button: Primary action button (full width, 44px height)

#### **Responsive Breakpoints**

**Desktop (≥1024px)**:
- Modal width: 500px (centered on screen)
- Diagram: 80px icons, 40px spacing
- Text: 16px body, 18px heading
- Padding: 40px
- Counter preview: 3-column layout (horizontal card)

**Tablet (768–1023px)**:
- Modal width: 90% with max 450px
- Diagram: 64px icons, 32px spacing
- Text: 15px body, 17px heading
- Padding: 32px
- Counter preview: Single column (scrollable list)

**Mobile (<768px)**:
- Modal width: 95% with 12px margin
- Diagram: 48px icons, 24px spacing
- Text: 14px body, 16px heading
- Padding: 16px
- Counter preview: Hidden by default (show "View full counter chart" button)

### 3. Interaction Patterns

#### **Desktop (Mouse/Keyboard)**
1. Transition screen appears when player defeats opponent in joust or joust ends
2. Player reads content (1–2 seconds auto-display time recommended)
3. Options:
   - Click "Continue" button → advances to melee phase
   - Press Spacebar or Enter → advances to melee phase
   - Press Escape → returns to melee phase (same as Continue)

#### **Tablet (Mouse/Touch)**
1. Same as desktop, but touch targets expanded (44px minimum)
2. "Continue" button: 44px height, full width
3. Counter preview: Tap to expand/collapse sections (mobile interaction)

#### **Mobile (<768px)**
1. Modal fills 95% of screen
2. User can scroll within modal if content exceeds viewport height
3. "Continue" button: Sticky at bottom (position: sticky) if content scrollable
4. Counter preview: "View full counter chart" button links to Attack Selection screen (deferred to post-MVP)

#### **Auto-Dismiss (Optional Feature)**
- Recommendation: Auto-dismiss after 4 seconds if player doesn't interact
- Visual cue: Progress bar at bottom of modal (0–4s fade out)
- Rationale: Prevents screen from blocking playthrough if player briefly ignores it
- Can be disabled via setting or deferred to post-MVP

### 4. Animation & Transitions

#### **Screen Entry**
- Fade-in: Modal background fades in over 0.3s (ease-in)
- Diagram animation: Left weapon → right weapon over 0.5s (slide + fade)
- Text animation: Fade in over 0.5s (starts after diagram completes)
- Staggered timing creates perception of content "entering" the screen
- Total animation time: ~1 second from first appearance to fully visible

#### **Screen Exit (Continue Button)**
- Button fade: Button slightly brightens on hover (0.2s transition)
- Modal exit: Fade out over 0.3s (ease-out)
- Next screen: Melee phase screen fades in simultaneously
- Total transition time: 0.3s (smooth, not jarring)

#### **Accessibility Animation Notes**
- Respect `prefers-reduced-motion` media query (instant if set)
- No flash/strobe effects (animations are smooth fades)
- Text remains readable during animations (sufficient contrast throughout)

### 5. Accessibility (WCAG 2.1 AA)

#### **Keyboard Navigation**
- Tab through: Title → Text → Preview card (if shown) → Continue button
- Focus ring: 3px solid primary color (same as game focus styling)
- Focus trap: Modal traps focus (Tab loops within modal until dismissed)
- Escape key: Closes modal and advances to melee phase (standard pattern)
- Spacebar/Enter: Advances to melee phase (alternate to clicking button)

#### **Screen Reader Support**
- `role="dialog"` on modal wrapper
- `aria-labelledby="transition-title"` (points to title element)
- `aria-modal="true"` (signals modal to AT)
- Title: `id="transition-title"` and semantic `<h2>` tag
- Text: Semantic `<p>` tags (read naturally by screen readers)
- Diagram: Use `<figure>` and `<figcaption>` for alt text:
  ```html
  <figure>
    <figcaption>Weapon transition: Lance and shield in joust phase → Sword and shield in melee phase</figcaption>
    [Visual diagram here]
  </figure>
  ```
- Button: Clear label "Continue to Melee Phase" (not just "Continue")
- Preview: `aria-live="polite"` on preview card (if expandable/collapsible)

#### **Color Contrast**
- Title vs. background: 4.5:1 ✅ (dark teal on cream)
- Body text vs. background: 4.5:1 ✅ (dark gray on cream)
- Button text vs. background: 4.5:1 ✅ (white on primary color)
- Preview card: Same as other game cards (validated in BL-062)

#### **Mobile Accessibility**
- Touch targets: 44px × 44px minimum (button meets this)
- Text size: 14px minimum (readable, meets WCAG AAA on 16px base)
- Spacing: 16px padding (touch-friendly, prevents accidental taps)
- Gesture: Simple tap to dismiss (no swipe/pinch required)

### 6. Integration Plan for UI-Dev

#### **Files to Modify**
- `src/App.tsx` (add MeleeTransitionScreen component to state machine, wire to appear after last joust pass)
- `src/ui/MeleeTransitionScreen.tsx` (new component — or integrated into existing MatchScreen)
- `src/App.css` (modal styling, animations, responsive layout)
- `src/index.css` (optional: add transition animation utilities)

#### **Component Structure**
```typescript
export function MeleeTransitionScreen({ onContinue }: { onContinue: () => void }) {
  // Component shows transition explainer
  // Calls onContinue() when Continue button clicked or Escape pressed
}
```

#### **Integration Points**
1. **State Machine**: Add `phase: 'melee-transition'` state in `matchScreen` logic
2. **Flow**: After last joust pass resolves → `phase = 'melee-transition'` → show MeleeTransitionScreen → onContinue() → `phase = 'melee'` and show MeleeScreen
3. **Logic**: Detect transition via `currentPhase === 'melee' && previousPhase === 'joust'` flag
4. **Animation**: Use CSS `@keyframes` for fade-in, slide, and exit animations

#### **Props & Data**
- `onContinue: () => void` — handler to advance to melee phase
- Optional: `autoDismissMs?: number` — auto-dismiss after N ms (default: disabled)
- Optional: `showCounterPreview?: boolean` — show mini counter chart (default: false, deferred to post-MVP)

#### **Test Checklist**
1. Modal appears after joust phase ends
2. Continue button advances to melee phase
3. Escape key closes and advances to melee phase
4. Spacebar/Enter advances to melee phase
5. Focus trap works (Tab loops within modal)
6. Diagram animation plays (weapon transition visible)
7. Text and button are readable on all viewport sizes (320px, 768px, 1024px+)
8. Touch targets meet 44px minimum (on mobile)
9. Screen reader reads all content in logical order
10. Animations respect `prefers-reduced-motion`

### 7. Content Templates & Final Copy

#### **Title**
```
Transition to Melee Phase
```
(Fixed text, no customization needed)

#### **Explanatory Text** (Multi-line)
```
A new attack set is available in melee combat.
Learn the new matchups — Guard High works differently, and new attacks give you fresh tactical options.
Take your time to study the counter chart before engaging.
```

**Tone**: Friendly, educational, empowering (not intimidating).
- "New attack set is available" — positive (opportunity, not constraint)
- "Learn the new matchups" — encourages study, not blind guessing
- "Take your time" — removes urgency, invites thoughtful play
- "Fresh tactical options" — motivates exploration

#### **Button Text**
```
Continue to Melee Phase
```
(Clear, action-oriented, specific about where transition leads)

#### **Counter Preview Label** (Optional)
```
Melee Counter Preview — Full chart available in Attack Selection
```

### 8. Definition of Done

**For UI-Dev Implementation (BL-068 Follow-up)**:
- ✅ Transition screen appears after joust phase ends
- ✅ All content renders correctly (title, diagram, text, button)
- ✅ Responsive layout matches design (desktop ≥1024px, tablet 768–1023px, mobile <768px)
- ✅ Animations work (fade-in, slide, exit)
- ✅ Keyboard navigation works (Tab, Escape, Spacebar, Enter)
- ✅ Focus trap and focus ring visible
- ✅ Screen reader announces all content correctly
- ✅ Touch targets 44px+ on mobile
- ✅ Cross-browser tested (Chrome, Safari, Firefox, Edge)
- ✅ All 897+ tests still passing (no regressions)

**For Design Validation** (Before implementation):
- ✅ Copy is clear and non-technical
- ✅ Diagram visually communicates joust → melee weapon transition
- ✅ Animation timing feels natural (not too fast, not too slow)
- ✅ Mobile layout passes viewability check on 320px viewport

---

## Design Decisions & Rationale

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Screen Type** | Modal overlay (not new route/screen) | Keeps melee phase immediately accessible; prevents navigation stack issues |
| **Display Time** | 1–2 seconds user-dismissible | Gives new players time to read; doesn't force delay on experienced players |
| **Counter Preview** | Optional mini version (not full chart) | Reduces cognitive load; players can explore full chart in Attack Selection |
| **Animation Style** | Smooth fade + slide (no distraction) | Teaches transition without overwhelming player |
| **Button Label** | "Continue to Melee Phase" (explicit, not "Next") | Clear about navigation target; builds mental model |
| **Accessibility** | Full WCAG 2.1 AA (keyboard, screen reader, color contrast) | Ensures all players can access phase transition education |
| **Priority** | P4 (STRETCH) — after critical learning loop (BL-064) | Essential learning already covered; this improves polish |

---

## Stretch Goals (Post-MVP)

If scope permits after BL-070 ships:

1. **Counter Chart Mini-Version**: Show 3 melee attacks with beats/weak-to relationships (currently deferred)
2. **Auto-Dismiss Progress Bar**: Fade-out progress at bottom (0–4s countdown)
3. **Animated Weapon Icons**: Sword rotates/spins in during animation
4. **Melee Tips**: Contextual tip (e.g., "Guard High counters Low Cut — remember this!") based on player's joust archetype
5. **Replay Value**: "Tips Summary" button linking to counter chart reference after multiple playthroughs
6. **Sound Effect**: Subtle "weapon draw" sound during transition (audio designer task)

---

## Impact & Success Metrics

### **Expected Learning Outcomes**
- New players understand melee phase is intentional, not a bug
- Players expect different attack mechanics and actively study counter relationships
- Reduced confusion on melee phase entry
- Smoother onboarding flow (connects P2 impact breakdown to melee understanding)

### **Success Metrics** (Qualitative)
- User testing: New players report melee transition felt expected (vs. jarring)
- Retention: Fewer players abandon after joust phase
- Engagement: More players engage with counter chart in melee phase

### **Design Quality**
- ✅ Accessible (WCAG 2.1 AA)
- ✅ Responsive (3+ viewport sizes)
- ✅ Readable (14–16px text, 4.5:1 contrast)
- ✅ Non-blocking (user can dismiss or auto-advance)

---

## Timeline & Dependencies

**Depends On**:
- BL-067 (Counter Chart design) — COMPLETE ✅
- BL-062/064 (Learning loop features) — COMPLETE ✅

**Can Run In Parallel With**:
- BL-076 (PassResult extensions)
- BL-071 (Variant tooltips)
- Any other design work

**Ready for UI-Dev Implementation**:
- Immediately (no blockers)
- Estimated 2–4 hours for ui-dev (lower than counter chart due to simpler scope)

---

## Summary & Recommendations

**BL-070 is a high-impact, low-effort polish improvement.**

- **Impact**: Solves jarring melee transition, improves learning loop continuity
- **Effort**: 2–4 hours ui-dev implementation (simpler than BL-068 counter chart)
- **Quality**: Accessible, responsive, animation-enhanced
- **Priority**: P4 (polish) — ship after critical learning loop (BL-064) complete
- **Stretch Goals**: Counter chart preview, auto-dismiss, animations (post-MVP acceptable)

**Recommendation**: Ship BL-070 immediately after BL-064 for complete onboarding experience. Players will understand:
1. What stats do (BL-061/062 — stat tooltips) ✅
2. Why they won/lost (BL-063/064 — impact breakdown) ✅
3. Why the phase changed (BL-070 — transition explainer) ✅ **← NEW**
4. How to counter their opponent (BL-067/068 — counter chart) ✅

**Note**: BL-070 is production-ready for implementation. Counter chart preview can be deferred to post-MVP if needed; core functionality (transition + explanation) is standalone.

---

**End of BL-070 Design Specification — Ready for UI-Dev Implementation**
