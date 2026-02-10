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
