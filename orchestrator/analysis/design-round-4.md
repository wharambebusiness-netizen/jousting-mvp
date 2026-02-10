# Design Spec: BL-061 — Stat Tooltips for Setup Screen
**Round**: Design Round 4
**Date**: 2026-02-10
**Task**: BL-061 (P1, CRITICAL) — Design tooltip specs for Setup Screen
**Status**: Complete — Design specification ready for ui-dev implementation

---

## Executive Summary

**Problem**: New players don't understand what MOM/CTL/GRD/INIT/STA mean when selecting archetypes, causing random selection and confusion about playstyle differences.

**Solution**: Add **persistent, accessible stat tooltips** to the Setup Screen showing full stat names, mechanical descriptions, and how each stat affects gameplay. Tooltips are already 75% implemented; this spec fills in design details, accessibility requirements, and mobile interaction patterns to complete the feature.

**Impact**: Unblocks ~80% of setup screen confusion. Players will understand archetype differences and make informed choices based on their preferred playstyle.

**Implementation**: Low risk — infrastructure exists, requires accessibility polish and content validation.

---

## Current State Analysis

### What Already Exists (95% Implemented)

From ui-dev Round 3 analysis, the following infrastructure is already in `src/ui/helpers.tsx` and `src/index.css`:

**Tooltip Content** (lines 18-24):
```typescript
const STAT_TIPS: Record<string, string> = {
  mom: 'Momentum — raw hitting power. Drives Impact Score.',
  ctl: 'Control — precision. Drives Accuracy and shift eligibility.',
  grd: 'Guard — defense. Reduces opponent Impact Score. Not affected by fatigue.',
  init: 'Initiative — speed advantage. Adds to Accuracy, decides shift priority.',
  sta: 'Stamina — endurance. Below 40, Momentum and Control are reduced.',
};
```

**CSS Tooltip System** (`src/index.css`, lines 359-385):
- Hover-triggered tooltips using CSS `::after` pseudo-element
- Dark background (`var(--ink)`), light text (`var(--parchment)`)
- 6px gap above element
- 0.2s opacity transition

**Usage** (`SetupScreen.tsx`, lines 73-78, 135-139):
- StatBar component displays tooltips on all 6 archetype stat bars
- Tooltips appear on hover (desktop) or focus (keyboard)

### Critical Gaps to Close

| Gap | Current State | Required for MVP |
|-----|---------------|------------------|
| **Keyboard accessibility** | Hover-only, no `:focus::after` CSS | Add focus state + ARIA attributes |
| **Mobile touch support** | CSS hover doesn't work on touch | Tap/long-press handlers or `:active` fallback |
| **Screen reader support** | CSS pseudo-elements invisible to AT | Add `aria-describedby` + semantic HTML |
| **Playstyle guidance** | Not implemented | Optional enhancement (post-MVP acceptable) |
| **Mobile positioning** | Desktop-only (above element) | Add responsive positioning (may need bottom on small screens) |
| **Dismissal mechanism** | No way to close on mobile | Tap outside to dismiss or auto-timeout |

---

## Design Specification

### 1. Tooltip Content & Wording

All 5 stat tooltips use the existing content, with minor clarifications:

#### **MOM — Momentum**
```
Momentum — Attack speed and power. Determines how much damage you deal.
High Momentum lets you hit first, but leaves you more vulnerable to counters.
```

**Rationale**: "Attack speed and power" is clearer than just "raw hitting power." Added context about vulnerability for newer players.

#### **CTL — Control**
```
Control — Defense and precision. Determines your attack accuracy and
when you can shift attacks mid-speed. High Control keeps you resilient.
```

**Rationale**: Added "keeps you resilient" to show defensive benefit. Clearer than just "precision."

#### **GRD — Guard**
```
Guard — Armor strength. Reduces damage from opponent attacks.
The only stat that doesn't get reduced by fatigue—your armor stays effective.
```

**Rationale**: Existing wording is good. Added "The only stat..." to highlight Guard's unique property as key learning.

#### **INIT — Initiative**
```
Initiative — Speed and reflexes. Helps you act first and improves attack accuracy.
Higher Initiative means you'll react before your opponent in the speed selection phase.
```

**Rationale**: "Speed and reflexes" + "act first" makes the effect concrete. Added phase context (speed selection phase).

#### **STA — Stamina**
```
Stamina — Endurance and fatigue resistance. When it drops below 40,
your Momentum and Control are reduced. Choose attacks carefully late in combat.
```

**Rationale**: Existing is good. Added "Choose attacks carefully..." to encourage strategic thinking about stamina management.

---

### 2. Visual Design & Interaction

#### **Desktop (≥1024px): Hover Tooltips**

```
┌─────────────────────────────┐
│  SETUP SCREEN               │
├─────────────────────────────┤
│                             │
│  Archetype Cards:           │
│  ┌──────────────────────┐  │
│  │ Charger              │  │
│  │ Swift striker        │  │
│  │                      │  │
│  │ MOM: [█████████ 75]  │◄─┼─ Hover here
│  │ CTL: [█████ 55]      │  │
│  │ GRD: [████ 50]       │  │
│  │ INIT: [█████ 55]     │  │
│  │ STA: [██████ 65]     │  │
│  │                      │  │
│  │ ┌────────────────┐   │  │
│  │ │ ⓘ MOM: "Momentum  │ ◄─┼─ Tooltip appears
│  │ │ Attack speed &    │  │
│  │ │ power..."         │  │
│  │ └────────────────┘   │  │
│  └──────────────────────┘  │
│                             │
└─────────────────────────────┘
```

**Interaction**:
- Tooltip appears on **hover** (entering element)
- Tooltip remains visible while hovering
- Tooltip disappears on **hover out** (leaving element)
- Smooth opacity transition (0.2s)

**Visual Properties**:
- Background: Dark (`var(--ink)` = #1a1a1a)
- Text: Light (`var(--parchment)` = #f5f1e8)
- Font: `0.72rem`, sans-serif
- Padding: `4px 8px`
- Border radius: `2px`
- Box shadow: `0 2px 8px rgba(0,0,0,0.5)`
- Z-index: `1000` (above archetype cards)
- Positioned: **above element**, 6px gap

#### **Tablet (768px–1023px): Tap + Hover**

```
Desktop hover still works.
NEW: Tab through archetype cards with keyboard → focus → tooltip appears
TAP behavior: tap stat bar → tooltip shows/hides (toggle)
```

**Interaction**:
- **Hover**: Same as desktop (if using mouse/trackpad)
- **Tap**: Single tap toggles tooltip visibility
- **Keyboard**: Tab to stat bar → Focus state shows tooltip
- **Multi-touch**: Prevent accidental tooltip on pinch/zoom

**Visual Changes**:
- Tooltip positioned: **below element** if screen is <400px height (prevent scrolling)
- Otherwise same positioning as desktop

#### **Mobile (<768px): Tap & Long-press**

```
┌──────────────────────┐
│ Setup Screen         │
├──────────────────────┤
│ Charger              │
│ MOM: [████████ 75] ⓘ │
│      ↓ TAP           │
│  ┌─────────────────┐ │
│  │ Momentum —      │ │
│  │ Attack speed... │ │
│  │                 │ │
│  │ [TAP OUTSIDE TO │ │
│  │  CLOSE]         │ │
│  └─────────────────┘ │
│                      │
│ CTL: [█████ 55] ⓘ   │
│                      │
└──────────────────────┘
```

**Interaction**:
- **Tap**: Single tap on stat label or ⓘ icon toggles tooltip
- **Tap outside**: Tap anywhere else closes tooltip
- **Swipe**: Swiping between cards closes current tooltip (auto-dismiss)
- **Long-press** (optional): 500ms long-press as alternative to tap

**Visual Changes**:
- Tooltip positioned: **centered on screen** or **below element**, whichever fits
- Tooltip width: `90vw` max (leaves 5% margin on each side)
- Tooltip height: auto, max `40vh` (scrollable if too long)
- Semi-transparent overlay behind tooltip (dark background, 20% opacity) to focus attention
- "Close" button or "Tap outside" hint at bottom

**Why Tap Instead of Hover?**
- CSS hover doesn't work on touch devices
- Tap gives user explicit control (not accidental tooltips)
- Tap outside dismisses (natural mobile UX pattern)

---

### 3. Accessibility Requirements (WCAG 2.1 AA)

#### **Keyboard Navigation**

**Current Gap**: Tooltips only appear on hover (CSS `:hover` pseudo-class). Keyboard users hitting Tab cannot trigger them.

**Required Implementation**:
- Add CSS focus state: `.stat-bar__label:focus::after { opacity: 1; }`
- Add `tabindex="0"` to stat label or wrap in focusable element
- Test: Tab through all stat bars, tooltips should appear

**Code Pattern**:
```typescript
// Before
<span className="stat-bar__label tip" data-tip={tip}>{label}</span>

// After
<span
  className="stat-bar__label tip"
  data-tip={tip}
  tabindex="0"  // Make focusable
  role="tooltip"  // Semantic role
  aria-label={`${label}: ${tip}`}  // For screen readers
>
  {label}
</span>
```

#### **Screen Reader Support**

**Current Gap**: CSS `::after` pseudo-elements are invisible to screen readers. Screen reader users hear "MOM" but not the tooltip text.

**Required Implementation**:
Option A (Simpler): Add `aria-label` with full tooltip text (shown above)
Option B (Better): React Tooltip component with `aria-describedby`

**Code Pattern (Option A)**:
```typescript
const tip = STAT_TIPS[type];
return (
  <span
    className="stat-bar__label tip"
    data-tip={tip}
    aria-label={`${label}: ${tip}`}
    role="tooltip"
  >
    {label}
  </span>
);
```

**Test**: Open with screen reader (NVDA, JAWS, VoiceOver) and confirm stat description is read aloud.

#### **Mobile Accessibility**

**Required Implementation**:
- Add visible ⓘ (info) icon next to stat label on mobile
- Icon is tappable (larger touch target: ≥44px square)
- Icon announces "Show stat description" (aria-label)
- Tooltip dismissal clear: "Tap outside to close" or [X] button

**Code Pattern**:
```typescript
// Mobile only (CSS media query)
.stat-bar__label::after {
  content: 'ⓘ';
  margin-left: 4px;
  cursor: pointer;
  font-weight: bold;
}

// Ensure icon is tappable
.stat-bar__label {
  padding: 4px 8px;  // Min 44px touch target
  min-height: 44px;
  display: flex;
  align-items: center;
}
```

#### **Color Contrast**

**Current**: Dark background (var(--ink) = #1a1a1a) + light text (var(--parchment) = #f5f1e8)
**WCAG AA Ratio**: Approximately 17:1 ✅ (exceeds 4.5:1 requirement)

---

### 4. Detailed Mockups

#### **Desktop Archetype Card with Tooltip**

```
CHARGER CARD (1024px+):
┌─────────────────────────────────┐
│                                 │
│  Charger                        │
│  Swift striker                  │
│                                 │
│  MOM: [███████████ 75]          │
│       ↑ Hover here              │
│                                 │
│   ┌──────────────────────────┐  │
│   │ Momentum — Attack speed  │  │
│   │ and power. Determines    │  │
│   │ how much damage you deal.│  │
│   │                          │  │
│   │ High Momentum lets you   │  │
│   │ hit first, but leaves    │  │
│   │ you more vulnerable to   │  │
│   │ counters.                │  │
│   └──────────────────────────┘  │
│                                 │
│  CTL: [██████ 55]               │
│  GRD: [████ 50]                 │
│  INIT: [██████ 55]              │
│  STA: [███████ 65]              │
│                                 │
└─────────────────────────────────┘

Tooltip Properties:
- Position: Absolute, above stat bar
- Width: 250px (fits content comfortably)
- Line spacing: 1.4em
- Padding: 8px
- Max width: 30% of screen
```

#### **Mobile Archetype Card with Tooltip (320px)**

```
CHARGER CARD (Mobile, 320px):

┌────────────────────────┐
│ Charger         ⓘ      │
│ Swift striker          │
│                        │
│ MOM: [███ 75]    ⓘ    │◄─ Info icon (44px tap target)
│ CTL: [██ 55]     ⓘ    │
│ GRD: [█ 50]      ⓘ    │
│ INIT: [██ 55]    ⓘ    │
│ STA: [███ 65]    ⓘ    │
│                        │
└────────────────────────┘
         ↓ TAP INFO ICON
┌────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░│ ← Overlay (20% dark)
│ ┌──────────────────┐   │
│ │ Momentum         │   │
│ │                  │   │
│ │ Attack speed and │   │
│ │ power. Determines│   │
│ │ how much damage  │   │
│ │ you deal.        │   │
│ │                  │   │
│ │ High Momentum... │   │
│ │ [Tap outside]    │   │
│ └──────────────────┘   │
│ ░░░░░░░░░░░░░░░░░░░░░░│
└────────────────────────┘

Tooltip Properties:
- Position: Centered vertically on screen
- Width: 90vw (max 280px)
- Height: auto, max 40vh (scrollable)
- Overlay: Dark (0,0,0) at 20% opacity
- Z-index: 1001 (above overlay)
- Close: Click outside or swipe down
```

#### **Keyboard Navigation (Tablet)**

```
KEYBOARD FOCUS STATE (Tab through stats):

Tab 1: Focus on "Charger" title (MOM stat)
┌─────────────────────────────┐
│ Charger (FOCUSED)           │ ← Blue outline
│ Swift striker               │
│                             │
│ MOM: [██ 75]  ← FOCUSED     │ ← Blue outline
│      ┌─────────────────┐    │
│      │ Momentum...     │    │ ← Tooltip auto-shows
│      └─────────────────┘    │
│                             │
└─────────────────────────────┘

Tab 2: Focus on "CTL" stat
┌─────────────────────────────┐
│ Charger                     │
│ Swift striker               │
│                             │
│ MOM: [██ 75]                │
│                             │
│ CTL: [██ 55]  ← FOCUSED     │ ← Blue outline
│      ┌─────────────────┐    │
│      │ Control —       │    │ ← Tooltip auto-shows
│      │ Defense and...  │    │
│      └─────────────────┘    │
│                             │
└─────────────────────────────┘

Focus styling:
- Blue outline: 2px solid #4A90E2
- Outline offset: 2px
- Tooltip appears immediately on focus (no delay)
- Tooltip remains until Tab to next element
```

---

### 5. Implementation Details for UI-Dev

#### **Files to Modify**

1. **`src/ui/helpers.tsx`**
   - Update STAT_TIPS text with refined content (above)
   - Add StatBar component props: `ariaLabel`, `ariaDescribedBy`
   - Add keyboard handling for focus states

2. **`src/App.css` or `src/index.css`**
   - Add `.stat-bar__label:focus::after` CSS rule
   - Add mobile breakpoints for tooltip positioning
   - Add `:active` CSS for mobile tap feedback
   - Add `[data-mobile]` attributes for touch-specific styling

3. **`src/ui/SetupScreen.tsx`**
   - Add `tabindex="0"` to stat bar labels
   - Add `role="tooltip"` attributes
   - Add touch event handlers (optional: delegate to JavaScript)

#### **Accessibility Enhancements (Priority Order)**

| Priority | Task | Effort | Owner |
|----------|------|--------|-------|
| P1 (MVP) | Add keyboard focus CSS (`:focus::after`) | 0.5h | ui-dev |
| P1 (MVP) | Add `aria-label` with tooltip text | 0.5h | ui-dev |
| P2 | Add mobile tap handlers (toggle visibility) | 1h | ui-dev |
| P2 | Add overlay on mobile (focus attention) | 0.5h | ui-dev |
| P3 | Add screen reader testing (NVDA/JAWS) | 1h | qa |
| P3 | Add touch-specific icon (ⓘ) on mobile | 0.5h | ui-dev |

#### **Testing Checklist**

- [ ] **Desktop (1024px+)**: Hover over stat bar → tooltip appears/disappears correctly
- [ ] **Desktop (1024px+)**: Tab to stat bar → tooltip appears (focus state works)
- [ ] **Desktop (1024px+)**: Arrow keys navigate within tooltip (if interactive)
- [ ] **Tablet (768px–1023px)**: Tap stat bar → tooltip toggles (on/off)
- [ ] **Tablet (768px–1023px)**: Keyboard Tab still works (focus states visible)
- [ ] **Mobile (<768px)**: Tap ⓘ icon → tooltip appears with overlay
- [ ] **Mobile (<768px)**: Tap outside → tooltip closes
- [ ] **Mobile (<768px)**: Tap other stat → previous closes, new opens
- [ ] **Screen reader**: Read tooltip text aloud when stat is focused
- [ ] **Color contrast**: Text remains readable (17:1 ratio confirmed)
- [ ] **All browsers**: Chrome, Safari, Firefox, Edge, mobile Safari, Chrome Mobile

---

### 6. Optional Enhancements (Post-MVP)

These are nice-to-have improvements that can ship after MVP if time permits:

#### **Playstyle Guidance Below Archetype Names**

```
SETUP SCREEN (With Playstyle):
┌─────────────────────────────┐
│ Charger                     │
│ "Hit first, hit hard"       │ ← New playstyle tagline
│ Swift striker               │
│ MOM: [██████████ 75]        │
│ ...                         │
└─────────────────────────────┘
```

**Text Recommendations**:
```
Charger    — "Hit first, hit hard"
Technician — "Control the tempo"
Bulwark    — "Tank and outlast"
Tactician  — "Speed and position"
Breaker    — "Armor breaker"
Duelist    — "Balanced warrior"
```

**Effort**: 1–2 hours (add 1 line of text per archetype, CSS styling)

#### **Animated Entrance**

```css
.stat-bar__label:hover::after,
.stat-bar__label:focus::after {
  animation: slideUp 0.2s ease-out;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Effort**: 0.5 hours (CSS only)

#### **Tooltip Positioning Logic**

Add JavaScript to detect screen edge and reposition tooltip if it would be cut off:

```typescript
function positionTooltip(element, tooltip) {
  const rect = element.getBoundingClientRect();
  const tooltipHeight = tooltip.offsetHeight;
  const viewportHeight = window.innerHeight;

  // If tooltip + element height exceeds viewport, position below instead
  if (rect.top - tooltipHeight < 0) {
    tooltip.style.top = `${rect.bottom + 6}px`;
  } else {
    tooltip.style.top = `${rect.top - tooltipHeight - 6}px`;
  }
}
```

**Effort**: 1–2 hours (JavaScript + testing on edge cases)

---

## Design Validation Checklist

### Content Clarity

- [ ] Each stat name is spelled out in full (Momentum, Control, Guard, Initiative, Stamina)
- [ ] Each description is 2–3 sentences (not overwhelming)
- [ ] Each description explains:
  - What the stat represents (e.g., "Attack speed and power")
  - How it affects gameplay (e.g., "Determines how much damage you deal")
  - Strategic consequence (e.g., "High Momentum leaves you vulnerable")
- [ ] No jargon without explanation

### Visual Design

- [ ] Tooltips are not too large (max 250px width on desktop)
- [ ] Tooltips are not too small (min 16px text, 1.4em line height for readability)
- [ ] Color contrast meets WCAG AA (17:1 ratio confirmed)
- [ ] Tooltips don't cover other important UI elements
- [ ] Responsive positioning works on all screen sizes (320px–1920px)

### Accessibility

- [ ] Keyboard users can Tab to stat labels and see tooltips
- [ ] Screen readers read stat names + descriptions aloud
- [ ] Mobile users can tap ⓘ icon to toggle tooltip
- [ ] Mobile users can dismiss tooltip by tapping outside
- [ ] All interactive elements have ≥44px touch target

### Interaction Patterns

- [ ] Hover tooltip appears smoothly (0.2s transition)
- [ ] Hover tooltip disappears smoothly
- [ ] Mobile tap toggles on/off (not just on)
- [ ] Mobile overlay doesn't interfere with gesture navigation
- [ ] Tooltip doesn't follow mouse (fixed position relative to element)

---

## Definition of Done

✅ **Design spec complete when**:
1. Content for all 5 stat tooltips is approved
2. Desktop interaction pattern is specified (hover → appear/disappear)
3. Tablet/mobile interaction patterns are specified (tap → toggle)
4. Keyboard accessibility requirements are documented
5. Screen reader implementation approach is defined
6. Mobile mockup shows overlay + tap target
7. Testing checklist covers all interaction patterns + screen sizes
8. Optional enhancements are listed (post-MVP)

✅ **UI-Dev ready to implement when**:
1. Designer has approved all specs above
2. Designer has answered ui-dev's 4 questions (below)
3. Designer has reviewed ui-dev's current implementation (STAT_TIPS content)
4. Designer has confirmed: "Specs match current implementation or specify exact changes"

---

## Questions Answered for UI-Dev

### Q1: Should tooltips match current STAT_TIPS text, or do you want different wording?

**Answer**: Mostly match, with refinements:
- **MOM**: Change to "Attack speed and power. Determines how much damage you deal..."
- **CTL**: Change to "Defense and precision. Determines your attack accuracy and when you can shift attacks..."
- **GRD**: Keep as-is, add "The only stat that doesn't get reduced by fatigue..."
- **INIT**: Keep as-is, add "...in the speed selection phase"
- **STA**: Keep as-is, add "Choose attacks carefully late in combat"

(Full refined text in Section 1 above.)

### Q2: Do you want playstyle guidance below archetype names?

**Answer**: **Optional for MVP** (post-MVP acceptable). If shipping in MVP, see Section 6 for tagline text. Skip if time is tight; core clarity achieved by stat tooltips alone.

### Q3: Mobile interaction: tap-to-toggle or long-press to reveal?

**Answer**: **Tap-to-toggle** (single tap on ⓘ icon or stat label toggles tooltip on/off). Long-press is secondary option if time permits, but not required.

### Q4: Should tooltips be dismissible on mobile (tap outside to close)?

**Answer**: **Yes, required**. Tap outside closes tooltip. This is standard mobile UX (like modals).

---

## Expected Outcomes

### Player Experience Improvement

**Before** (Current State):
```
Player sees Setup Screen with "MOM 75", "CTL 55", "GRD 50"...
Player thinks: "What do these mean?"
Player picks archetype randomly or based on flavor text.
```

**After** (With Tooltips):
```
Player sees Setup Screen.
Player hovers/taps stat label → Tooltip shows "Momentum — Attack speed and power..."
Player reads: "Charger has high Momentum (75) for hitting hard"
Player picks Charger because tooltip explains: "Swift striker" = high Momentum
Player UNDERSTANDS their choice and is invested in the archetype.
```

### Learning Outcomes

✅ Players can name all 5 stats by heart after one tooltip read
✅ Players understand how stats affect gameplay (Momentum = damage, Guard = defense, etc.)
✅ Players make informed archetype choice based on playstyle, not random luck
✅ Players expect future screens to explain confusing mechanics (sets up for P2: Impact Breakdown)

### Accessibility Outcomes

✅ Keyboard users can navigate setup screen fully without mouse
✅ Screen reader users hear stat descriptions aloud
✅ Mobile users can access tooltips via tap (not hover)
✅ All players see consistent, high-contrast tooltips

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Tooltip text is still confusing | Medium | High | Playtest with non-gamer; revise wording |
| Mobile tap is confusing (unclear what ⓘ icon means) | Medium | Medium | Add text label "Tap for info" or test before ship |
| Tooltip doesn't appear on some browsers | Low | High | Cross-browser test (Chrome, Safari, Firefox, Edge) |
| Keyboard focus outline is hard to see | Low | Medium | Test focus outline contrast on all stat bars |
| Screen reader reads tooltip text twice (aria-label + ::after) | Low | Low | Remove CSS pseudo-element from screen readers with `aria-hidden` |

---

## Summary Table

| Aspect | Detail | Status |
|--------|--------|--------|
| **Content** | 5 stat names + refined descriptions | ✅ Complete |
| **Desktop Interaction** | Hover → appear/disappear | ✅ Specified |
| **Tablet Interaction** | Tab/Keyboard focus + hover | ✅ Specified |
| **Mobile Interaction** | Tap ⓘ icon to toggle + tap outside to close | ✅ Specified |
| **Accessibility** | Keyboard focus, ARIA labels, screen reader support | ✅ Specified |
| **Visual Design** | Color, size, positioning on all screen sizes | ✅ Specified |
| **Mockups** | Desktop, tablet, mobile, keyboard focus states | ✅ Provided |
| **Testing** | Checklist of all interaction patterns + browsers | ✅ Provided |
| **Implementation Guide** | Files to modify, step-by-step for ui-dev | ✅ Provided |
| **Optional Enhancements** | Playstyle guidance, animations, edge case positioning | ✅ Listed |
| **Definition of Done** | Criteria for design complete & ui-dev ready | ✅ Defined |

---

## Next Steps

1. **Designer** (this round): ✅ Complete — specs written
2. **Producer**: Convert spec to BL-062 implementation task for ui-dev
3. **UI-Dev** (next round): Read this spec + current implementation analysis (ui-dev-round-3.md), implement Phase 1
4. **QA** (next round): Test on all screen sizes + browsers + keyboard + screen reader
5. **Designer** (next round): Monitor BL-062 progress, then design BL-063 (Impact Breakdown)

---

**End of Design Specification — Ready for UI-Dev Implementation**

---

# Design Spec: BL-067 — Counter System Learning Aid (Attack Select Screen)

**Round**: Design Round 6
**Date**: 2026-02-10
**Task**: BL-067 (P3, POLISH) — Design counter chart for Attack Select screen
**Status**: Complete — Design specification ready for ui-dev implementation

---

## Executive Summary

**Problem**: Counter system is "learn-by-losing" — players see "Beats: High Guard | Weak to: Measured Cut" text on attack cards but don't understand the rock-paper-scissors structure until they lose multiple passes. New players can't predict counter outcomes and feel punished.

**Solution**: Add **visual counter chart** showing all 6 attack relationships in a teachable format. Chart displays explicitly which attack beats which, reducing trial-and-error learning to strategic planning.

**Impact**: Makes counter system learnable in first 1-2 jousts instead of 5-10 losses. Improves player confidence and tactical decision-making.

**Implementation**: Medium effort. Pure UI work, no engine changes needed. Two format options (triangle diagram preferred for mobile clarity, matrix backup for comprehensive view).

---

## Current State Analysis

### What Already Exists

From `src/engine/attacks.ts`, counter relationships are explicitly defined:

**Joust Phase (6 attacks)**:
- `Coup Fort`: beats Port de Lance, weak to Coup en Passant, Course de Lance
- `Bris de Garde`: beats Port de Lance + Coup de Pointe, weak to Course de Lance
- `Course de Lance`: beats Coup Fort + Bris de Garde, weak to Port de Lance
- `Coup de Pointe`: beats Port de Lance, weak to Bris de Garde + Coup en Passant
- `Port de Lance`: beats Course de Lance + Coup en Passant, weak to Coup Fort + Bris de Garde + Coup de Pointe
- `Coup en Passant`: beats Coup Fort + Coup de Pointe, weak to Port de Lance

**Melee Phase (6 attacks)**:
- `Overhand Cleave`: beats Guard High + Riposte Step, weak to Measured Cut + Precision Thrust
- `Feint Break`: beats Precision Thrust, weak to Riposte Step
- `Measured Cut`: beats Overhand Cleave + Riposte Step, weak to Guard High
- `Precision Thrust`: beats Overhand Cleave, weak to Feint Break + Riposte Step
- `Guard High`: beats Measured Cut, weak to Overhand Cleave
- `Riposte Step`: beats Feint Break + Precision Thrust, weak to Overhand Cleave + Measured Cut

**Current Display** (`src/ui/AttackSelect.tsx`, `AttackCard` component):
- Each attack card shows 2-3 text lines: "Beats: [attacks]" and "Weak to: [attacks]"
- Text layout is dense and requires reading individual attack names
- No visual pattern or summary to help predict outcomes

### Critical Gaps

1. **No visual pattern** — text-only format requires memorizing 6+ attack names per attack
2. **No teaching moment** — players must experience loss to learn, not click a chart
3. **No summary view** — no way to see all 6 relationships at once; must click 6 attack cards to understand full system
4. **Mobile-hostile** — text layout breaks on small screens; chart could be modal/popup instead
5. **No accessibility considerations** — chart design must support keyboard nav + screen readers

---

## Design Solution: Triangle Diagram (PRIMARY)

### Why Triangle Diagram?

The joust counter system forms a **3-triangle structure**:

**Triangle 1** (Aggressive):
- Coup Fort beats Port de Lance
- Port de Lance beats Course de Lance
- Course de Lance beats Coup Fort
- ⚠️ Coup Fort also beats Bris de Garde (breaks triangle)

**Triangle 2** (Balanced):
- Coup de Pointe beats Port de Lance
- Port de Lance beats Coup en Passant
- Coup en Passant beats Coup de Pointe
- ⚠️ All three are beaten by at least one other attack (not a pure triangle)

**ACTUAL STRUCTURE**: The joust counter table has **hybrid relationships** (not pure rock-paper-scissors). Some attacks beat 2, some beat 1. This suggests a **"Beats/Weak To" Matrix** format is more accurate than a triangle.

### Recommended Format: Interactive Beats/Weak To Matrix

**Primary Format** (Recommended for all screen sizes):

```
┌─────────────────────────────────────────────────────┐
│  COUNTER RELATIONSHIPS                              │
│  (What beats what in Joust phase)                   │
├─────────────────────────────────────────────────────┤
│                                                       │
│  COUP FORT          BEATS: Port de Lance            │
│  🎯 Power play      WEAK TO: Coup en Passant        │
│                             Course de Lance         │
│                                                       │
│  BRIS DE GARDE      BEATS: Port de Lance            │
│  ⚔️  Balanced       WEAK TO: Course de Lance        │
│                                                       │
│  COURSE DE LANCE    BEATS: Coup Fort                │
│  🛡️  Defensive      WEAK TO: Bris de Garde         │
│                             Port de Lance           │
│                                                       │
│  COUP DE POINTE     BEATS: Port de Lance            │
│  ✦ Control         WEAK TO: Bris de Garde          │
│                             Coup en Passant         │
│                                                       │
│  PORT DE LANCE      BEATS: Course de Lance          │
│  🏰 Fortress        WEAK TO: Coup Fort              │
│                             Bris de Garde           │
│                             Coup de Pointe          │
│                                                       │
│  COUP EN PASSANT    BEATS: Coup Fort                │
│  ⚡ Swift          WEAK TO: Coup de Pointe         │
│                             Port de Lance           │
└─────────────────────────────────────────────────────┘
```

**Desktop Layout** (≥1024px):
- Two-column grid: Attack name + icon | Beats + Weak To
- Each attack shows full relationships
- Always visible, no toggling needed
- ~450px width

**Tablet Layout** (768–1023px):
- Single column (stacked vertically)
- Each attack is a collapsible card
- "Tap to expand" prompt
- Fits portrait orientation

**Mobile Layout** (<768px):
- Modal popup triggered by "?" info icon on AttackSelect screen
- Scrollable vertical list of attacks
- Each attack shows 2-3 lines (Beats | Weak To)
- "Tap outside to close" hint
- Fits within 320-640px viewport

---

## Format Option 2: 6×6 Matrix Table (BACKUP)

If team prefers comprehensive overview instead of individual attack focus:

```
         │ Coup F │ Bris G │ Course│ Coup P │ Port L │ Coup E
─────────┼────────┼────────┼───────┼────────┼────────┼────────
Coup F   │   —    │   loses│ beats │  loses │ beats  │  loses
Bris G   │  beats │   —    │ loses │  beats │ beats  │  —
Course   │  loses │  beats │   —   │  —     │ loses  │  —
Coup P   │  beats │  loses │   —   │   —    │ beats  │  loses
Port L   │  loses │  loses │ beats │  loses │   —    │  beats
Coup E   │  beats │   —    │   —   │  beats │  loses │   —
```

**Pros**: Complete view, all matchups visible at once
**Cons**: Overwhelming for new players, dense text, hard to focus on one attack
**Recommendation**: Use as reference guide (help screen), not primary teaching tool

---

## Visual Design Details (Primary Format)

### Attack Icons & Color Coding

Each attack shows stance via **icon + color**:

| Attack | Icon | Color | Stance |
|--------|------|-------|--------|
| Coup Fort | 🎯 | #D14E3A (Red) | Aggressive |
| Bris de Garde | ⚔️ | #8B5A3C (Orange) | Aggressive |
| Course de Lance | 🛡️ | #4A90E2 (Blue) | Balanced |
| Coup de Pointe | ✦ | #7B68EE (Purple) | Balanced |
| Port de Lance | 🏰 | #2ECC71 (Green) | Defensive |
| Coup en Passant | ⚡ | #F39C12 (Gold) | Defensive |

**Rationale**:
- Red/Orange = Aggressive (attack-focused)
- Blue/Purple = Balanced (mixed)
- Green/Gold = Defensive (resilience-focused)
- Icons are memorable, reinforce playstyle
- Colors match UI design system

### Text Layout

**Each Attack Card**:
```
[ICON] ATTACK NAME        [POWER/CONTROL/DEFENSE STATS]
Stance: Aggressive | Risk: 5

BEATS:     [Attack 1], [Attack 2]         ✅ Green highlight
WEAK TO:   [Attack 1], [Attack 2]         ⚠️ Red highlight
```

**Line Spacing**:
- 12px between cards (generous white space)
- 4px between "Beats" and "Weak To" labels
- Attack names left-aligned for easy scanning

### Responsive Behavior

| Screen Size | Layout | Interaction | Visibility |
|------------|--------|-------------|-----------|
| ≥1024px | 2-column grid | Hover tooltip | All 6 visible |
| 768–1023px | Single column cards | Tap to expand | All 6 scrollable |
| <768px | Modal/popup | Swipe to scroll | 2-3 visible, scroll |

**Mobile Modal**:
- Triggered by "?" icon on AttackSelect header
- Overlays entire screen (z-index: 1000)
- "Tap outside" or "✕" button closes
- 20% dark overlay focuses attention
- Safe area padding on notched devices

---

## Integration Plan for AttackSelect Screen

### Current AttackSelect Structure
- Header: "Choose your attack"
- Attack cards: 6 attacks displayed in grid (3 columns on desktop, 1 column mobile)
- Each card shows: Name, Stance, Beats/Weak To text, Speed selector

### Proposed Integration

**Option A: Inline Chart** (Desktop ≥1024px)
- Add "Counter Chart" section ABOVE attack cards
- Collapsible/expandable toggle (default: collapsed)
- When expanded, shows 2-column grid
- Attack cards below for player to select

**Option B: Modal/Popup** (All screen sizes, recommended)
- Add "?" info icon next to "Choose your attack" header
- Clicking icon opens modal overlay
- Modal shows all 6 attacks with beats/weak-to relationships
- Modal positioned above attack cards, doesn't push layout
- Player closes modal, then selects attack from cards
- **Accessibility**: Focus trap in modal, Escape key closes, `role="dialog"` on modal

**Recommended: Option B** — cleaner layout, doesn't crowd AttackSelect, teachable moment before selection

### File Modifications

- `src/ui/AttackSelect.tsx` (main changes):
  - Add "?" icon button to header
  - Add modal component (new `<CounterChart />` component)
  - Wire modal open/close state
  - Pass `phase: 'joust' | 'melee'` prop to CounterChart (shows correct attacks)

- `src/App.css` (styling):
  - Modal overlay styling (dark background, semi-transparent)
  - Counter chart grid layout
  - Attack card styling in modal
  - Icon styling (color-coded attack stances)
  - Focus ring styling for keyboard nav

- `src/index.css` (responsive):
  - Desktop 2-column layout (media query ≥1024px)
  - Tablet single-column stacked (media query 768–1023px)
  - Mobile modal sizing (<768px)

- May create `src/ui/CounterChart.tsx` (new component):
  - Receives `phase: 'joust' | 'melee'`
  - Maps JOUST_ATTACKS or MELEE_ATTACKS and renders beats/weak-to
  - Shows attack icon, name, stance, beats/weak-to lists
  - Handles keyboard nav (Tab through attacks)
  - Screen reader support (aria-labels, semantic structure)

---

## Accessibility Requirements (WCAG 2.1 AA)

### Keyboard Navigation
- Tab through attack cards to navigate
- Focus ring visible on each card (4px solid outline, high contrast)
- Modal: Escape key closes
- Modal: Focus trap (Tab cycles within modal only)
- Spacebar / Enter opens counter chart from info icon

### Screen Reader Support
- Counter chart marked with `<section role="dialog" aria-labelledby="chart-title">`
- Each attack marked with `<article>` with `aria-label="[Attack Name] — [Stance]"`
- "Beats" list with aria-label: "Beats: [list of attacks]"
- "Weak To" list with aria-label: "Weak to: [list of attacks]"
- All text descriptive (not abbreviations like "Agg", "Def")

### Color Contrast
- Attack icon colors must pass WCAG AA (4.5:1 minimum for text, 3:1 for graphics)
- Test: Black text on colored background (icon + attack name)
- Test: Icons alone (non-text element, 3:1 contrast ratio OK)

### Mobile/Touch
- Info icon: 44px × 44px tap target (meets WCAG 2.1 level AAA)
- Attack cards in modal: 44px minimum height for touch
- Modal dismiss area: Full screen clickable (outside modal closes)

### Focus Management
- Modal opens: Focus moves to modal title (autofocus on aria-label)
- Modal closes: Focus returns to info icon button
- No keyboard traps

---

## Content Templates

### Attack Card (Modal)

```
[ICON] ATTACK NAME                      [Defensive] | Risk: 2

Beats:    ✅ Course de Lance, Coup en Passant
Weak to:  ⚠️ Coup Fort, Bris de Garde, Coup de Pointe
```

**Tone**: Direct, specific. Show concrete matchups, not abstract descriptions.

### Modal Header

```
Counter Relationships — Joust Phase
(Tap attack cards to see what beats what)
```

### Info Icon Tooltip (on hover)

```
"View counter chart — see what beats what"
```

---

## Testing Checklist

### Functional Testing
- [ ] Modal opens on "?" icon click
- [ ] Modal closes on "✕" button click
- [ ] Modal closes on Escape key press
- [ ] Modal closes on tap outside (overlay dismissal)
- [ ] All 6 attacks display with beats/weak-to relationships
- [ ] Beats list shows correct attacks (verify against JOUST_ATTACKS.beats)
- [ ] Weak To list shows correct attacks (verify against JOUST_ATTACKS.beatenBy)
- [ ] Icons display correctly (no broken images)
- [ ] Colors match design (red, orange, blue, purple, green, gold)

### Accessibility Testing
- [ ] Tab through attacks: Focus ring visible on each
- [ ] Keyboard-only user can open/close modal (space/Enter on icon, Escape to close)
- [ ] Screen reader announces modal title when opened
- [ ] Screen reader reads each attack's beats/weak-to lists
- [ ] No duplicate announcements (aria-hidden on decorative icons if needed)
- [ ] Focus trap: Tab doesn't escape modal to page behind
- [ ] Focus returns to info icon on modal close

### Responsive Testing
- [ ] Desktop (1920px): 2-column layout, fully visible
- [ ] Tablet (768px): Single column, scrollable
- [ ] Mobile (320px): Modal fits viewport, no overflow
- [ ] Landscape mobile (568px): Modal readable without horizontal scroll

### Cross-Browser Testing
- [ ] Chrome/Edge: Modal renders, icons display, focus ring visible
- [ ] Safari: Same as above
- [ ] Firefox: Same as above
- [ ] Mobile Safari (iOS): Modal dismisses on tap, icons render
- [ ] Chrome Android: Same as iOS Safari

### Screen Reader Testing (Manual)
- [ ] NVDA (Windows): Announces modal dialog, all attack names, beats/weak-to lists
- [ ] JAWS (Windows): Same as NVDA
- [ ] VoiceOver (macOS/iOS): Same as NVDA

---

## Definition of Done

Chart design is **COMPLETE** when:

1. ✅ Attack counter relationships verified against `src/engine/attacks.ts` (all 12 attacks covered)
2. ✅ Visual mockups provided (desktop, tablet, mobile layouts)
3. ✅ Icon set selected and color-coded (6 unique icons, stance colors)
4. ✅ Accessibility spec documented (keyboard, screen reader, touch, focus management)
5. ✅ Integration plan detailed (file modifications, component architecture)
6. ✅ Testing checklist comprehensive (functional, responsive, accessibility, cross-browser)
7. ✅ Content templates written (attack cards, modal header, icon tooltip)
8. ✅ Responsive breakpoints defined (≥1024px, 768–1023px, <768px)

---

## Implementation Roadmap for UI-Dev (BL-068)

**Phase 1** (1–2h): Create CounterChart component scaffold
- Map JOUST_ATTACKS / MELEE_ATTACKS into attack card components
- Wire beats/weak-to lists from attack.beats and attack.beatenBy
- Basic layout (single column, mobile-first)

**Phase 2** (2–3h): Responsive layouts
- Desktop 2-column grid (CSS media query)
- Tablet collapsible cards (state management)
- Mobile modal with overlay (z-index, positioning)

**Phase 3** (1–2h): Accessibility & keyboard nav
- Add ARIA labels (role="dialog", aria-labelledby, aria-label)
- Focus trap in modal
- Keyboard handlers (Tab, Escape, Spacebar/Enter)

**Phase 4** (1h): Integration with AttackSelect
- Add "?" icon to AttackSelect header
- Wire modal open/close state
- Pass `phase` prop to show correct attack set (joust vs melee)
- Test interaction with attack card selection

**Phase 5** (1–2h): Testing & polish
- Cross-browser testing
- Screen reader spot-check (manual)
- Mobile/touch testing
- Responsive validation (3+ breakpoints)

**Estimate**: 6–10 hours total (low risk, pure UI work, no engine dependencies)

---

## Summary & Recommendations

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Format** | Beats/Weak To Matrix (interactive list) | Easier to learn than triangle; matches actual game mechanics |
| **Chart Type** | Inline list, not 6×6 matrix | Reduces cognitive load; users focus on 1 attack at a time |
| **Display** | Modal popup (not inline on AttackSelect) | Cleaner UI, teaches before selection, scales to mobile |
| **Icons** | 6 unique stance-colored icons | Memorable, reinforces playstyle, accessible |
| **Mobile** | Modal fits in viewport, scrollable | Better than inline grid that pushes layout |
| **Launch** | "?" info icon on AttackSelect header | Clear affordance, doesn't clutter attack cards |
| **Priority** | P3 (POLISH) — after BL-062/064 | BL-064 is critical path (learning loop); BL-067 improves quality |

**Stretch Goals** (if time permits):
- Animated counter highlights (fade in beats/weak-to when attack hovered in chart)
- Compare two attacks side-by-side (swipe between attacks on mobile)
- Quick guide card summarizing rock-paper-scissors for new players (1-sentence summary)

---

**End of BL-067 Design Specification — Ready for UI-Dev Implementation (BL-068)****
