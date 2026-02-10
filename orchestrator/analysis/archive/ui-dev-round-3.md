# UI Developer Analysis: Round 3 — Onboarding UX Implementation Readiness

**Date**: 2026-02-10
**Round**: 3
**Agent**: ui-dev (continuous)
**Status**: Blocked on design specs (BL-061, BL-063, BL-067)

---

## Executive Summary

All Round 3 priority tasks (BL-062, BL-064, BL-068) are blocked waiting for design specifications. However, analysis reveals that **BL-062 (Stat Tooltips) infrastructure already exists** and may partially satisfy requirements. This analysis documents:

1. **Current implementation state** for each P1/P2/P4 feature
2. **Gaps between existing UI and design proposals**
3. **Implementation roadmap** for when design specs arrive
4. **Risk assessment** for each feature

---

## Task Status Overview

| Task | Priority | Description | Depends On | Status | Current State |
|------|----------|-------------|------------|--------|---------------|
| BL-062 | P1 (CRITICAL) | Implement stat tooltips UI | BL-061 (design) | ⏸ Blocked | **75% complete** — infrastructure exists, needs validation |
| BL-064 | P1 (CRITICAL) | Implement impact breakdown UI | BL-063 (design) | ⏸ Blocked | **40% complete** — component exists, needs enhancement |
| BL-068 | P3 (POLISH) | Implement counter chart | BL-067 (design) | ⏸ Blocked | **20% complete** — tooltips exist, visual chart missing |

---

## Feature 1: Stat Tooltips (BL-062) — 75% Complete

### Current Implementation

**File**: `src/ui/helpers.tsx` (lines 18-24, 66-83)

```typescript
const STAT_TIPS: Record<string, string> = {
  mom: 'Momentum — raw hitting power. Drives Impact Score.',
  ctl: 'Control — precision. Drives Accuracy and shift eligibility.',
  grd: 'Guard — defense. Reduces opponent Impact Score. Not affected by fatigue.',
  init: 'Initiative — speed advantage. Adds to Accuracy, decides shift priority.',
  sta: 'Stamina — endurance. Below 40, Momentum and Control are reduced.',
};

export function StatBar({ label, value, max, type }: {
  label: string;
  value: number;
  max: number;
  type: 'mom' | 'ctl' | 'grd' | 'init' | 'sta';
}) {
  const pct = Math.min(100, (value / max) * 100);
  const tip = STAT_TIPS[type];
  return (
    <div className={`stat-bar stat-bar--${type}`}>
      <span className="stat-bar__label tip" data-tip={tip}>{label}</span>
      {/* ... rest of component ... */}
    </div>
  );
}
```

**Where Used**: SetupScreen.tsx (lines 73-78, 135-139) — **all archetype cards already show stat tooltips!**

**CSS Styling**: `src/index.css` (lines 359-385)
- Hover-triggered tooltips with CSS `::after` pseudo-element
- Uses `data-tip` attribute for content
- Dark background (`var(--ink)`), light text (`var(--parchment)`)
- Positioned above element with 6px gap
- Opacity transition 0.2s

### Comparison with Design Proposal (BL-041, P1)

**Design Requirements** (from `orchestrator/analysis/design-round-3.md:140-159`):

| Requirement | Current Implementation | Gap |
|-------------|------------------------|-----|
| Full stat name + description | ✅ Implemented | None |
| Hover tooltips | ✅ Implemented | None |
| Keyboard accessible | ⚠️ **PARTIAL** — Hover-only, no focus state | **CRITICAL GAP** |
| Mobile: tap/long-press | ❌ **NOT IMPLEMENTED** — CSS hover doesn't work on mobile | **CRITICAL GAP** |
| Responsive layout | ✅ Tooltips fit viewport | None |
| Playstyle guidance (optional) | ❌ Not implemented | Optional enhancement |
| Design system styling | ✅ Matches existing CSS | None |

### Gaps to Close

1. **Keyboard Accessibility**: `.tip:focus::after` CSS rule needed for keyboard nav
2. **Mobile Touch Support**: JavaScript event handlers for tap/long-press, or CSS `:active` fallback
3. **Screen Reader Support**: Consider `aria-describedby` instead of CSS pseudo-elements (screen readers can't read `::after` content)
4. **Playstyle Guidance** (optional): Add archetype-specific one-liners below archetype names

### Implementation Estimate

- **If design specs match current implementation**: 1-2 hours (add keyboard + mobile support)
- **If design requires major changes**: 4-6 hours (refactor to React tooltips component)

### Risk Assessment

- **Low risk** — infrastructure exists, only accessibility gaps to close
- **High confidence** — CSS tooltip system is production-ready, just needs a11y polish
- **Dependency**: Awaiting BL-061 design specs to confirm requirements

---

## Feature 2: Impact Breakdown (BL-064) — 40% Complete

### Current Implementation

**File**: `src/ui/PassResult.tsx` (lines 1-185)

**Existing Breakdown** (lines 95-131):
- ✅ Momentum, Control, Guard, Initiative (effective stats)
- ✅ Fatigue factor
- ✅ Counter bonus (if applicable)
- ✅ Accuracy
- ✅ Impact Score (highlighted winner)
- ✅ Pass winner with margin

**Visual Layout**:
- Side-by-side stat rows (You vs Opponent)
- Counter badges ("Counters!" / "Countered!")
- Winner banner at top
- Scoreboard showing cumulative scores + stamina

### Comparison with Design Proposal (BL-041, P2)

**Design Requirements** (from `orchestrator/analysis/design-round-3.md:186-220`):

| Requirement | Current Implementation | Gap |
|-------------|------------------------|-----|
| Your Impact vs Opponent Impact | ✅ Shown as Impact Score | None |
| Bar graph comparing impacts | ❌ **NOT IMPLEMENTED** | **MAJOR GAP** |
| Attack Advantage explanation | ⚠️ **PARTIAL** — Shows "Counters!" badge, no text explanation | **MODERATE GAP** |
| Guard Contribution | ❌ **NOT IMPLEMENTED** | **MAJOR GAP** |
| Fatigue Effect | ⚠️ **PARTIAL** — Shows fatigue factor, no explicit stat reduction explanation | **MODERATE GAP** |
| Expandable card (mobile) | ❌ **NOT IMPLEMENTED** | **MODERATE GAP** |
| Clear labels + icons | ⚠️ **PARTIAL** — Labels clear, no icons | **MINOR GAP** |

### Gaps to Close

1. **Bar Graph**: Visual comparison of impact scores (SVG or CSS-based)
2. **Guard Contribution**: Calculate and display how much impact guard absorbed
   - Requires exposing guard calculation from `calculator.ts`
   - Example: "Your guard absorbed 15 impact" or "Guard reduced opponent impact by 12%"
3. **Attack Advantage Text**: Expand counter badge to explain *why* (e.g., "Coup en Passant beats Guard Low")
4. **Fatigue Effect Text**: Show explicit stat reductions (e.g., "You were 20% fatigued (MOM -15)")
5. **Expandable Card**: Mobile-first responsive design (collapsed by default <768px, expanded on desktop)
6. **Icons**: Add visual indicators for each stat type

### Implementation Estimate

- **Medium complexity**: 6-10 hours
- **Depends on**: Whether design requires calculator.ts refactoring to expose impact components
- **Biggest unknowns**:
  - Guard contribution calculation (may need to refactor `calcImpactScore` to return breakdown)
  - Fatigue effect calculation (need to compute pre-fatigue vs post-fatigue stats)

### Risk Assessment

- **Medium risk** — Requires calculator.ts changes (not owned by ui-dev)
- **Coordination needed**: Tech-lead or engine-dev may need to expose impact breakdown API
- **Dependency**: Awaiting BL-063 design specs to confirm scope

---

## Feature 3: Counter Chart (BL-068) — 20% Complete

### Current Implementation

**File**: `src/ui/helpers.tsx` (lines 85-94)

**Existing Counter Tooltips**:
```typescript
export function StanceTag({ stance }: { stance: Stance }) {
  const tip = stance === Stance.Aggressive ? 'Aggressive beats Defensive'
    : stance === Stance.Balanced ? 'Balanced beats Aggressive'
    : 'Defensive beats Balanced';
  return (
    <span className={`stance-tag ${stanceClass(stance)} tip`} data-tip={tip}>
      {stanceAbbr(stance)}
    </span>
  );
}
```

**Where Used**: AttackSelect.tsx (line 37) — stance tags on all attack cards

**Also in AttackCard** (lines 50-59):
- "Beats: X, Y" text (attacks.beats array)
- "Weak to: Z" text (attacks.beatenBy array)

### Comparison with Design Proposal (BL-041, P4)

**Design Requirements** (from `orchestrator/analysis/design-round-3.md:262-299`):

| Requirement | Current Implementation | Gap |
|-------------|------------------------|-----|
| Visual chart (triangle/matrix/text) | ❌ **NOT IMPLEMENTED** | **MAJOR GAP** |
| Show all 6 attack relationships | ⚠️ **PARTIAL** — Text-based on cards, no centralized chart | **MAJOR GAP** |
| Rock-paper-scissors explanation | ⚠️ **PARTIAL** — Stance tooltips explain Agg>Def>Bal>Agg, but not attack-specific | **MODERATE GAP** |
| Modal or expandable section | ❌ **NOT IMPLEMENTED** | **MAJOR GAP** |
| Mobile responsive | N/A — no chart exists | N/A |
| Keyboard accessible | N/A — no chart exists | N/A |

### Gaps to Close

1. **Visual Chart Component**: New component showing all attack relationships
   - Option A: Triangle diagram (3 stances arranged as triangle)
   - Option B: 6×6 matrix grid
   - Option C: Expandable text list with visual icons
2. **Modal/Popup System**: Consider reusable modal component for future features
3. **Integration**: Add "?" help button to AttackSelect screen triggering chart modal
4. **Responsive Design**: Chart must fit 320px mobile viewport

### Implementation Estimate

- **Medium-low complexity**: 4-6 hours
- **Depends on**: Design decision (triangle vs matrix vs text)
- **Biggest unknown**: Whether to build reusable modal system or inline chart

### Risk Assessment

- **Low risk** — Pure UI work, no engine dependencies
- **High flexibility** — Design can choose simplest approach (text-based chart with icons)
- **Dependency**: Awaiting BL-067 design specs to confirm format

---

## Shared Implementation Concerns

### 1. Accessibility (WCAG 2.1 AA Compliance)

**Current Gaps Across All Features**:
- CSS tooltips not screen-reader friendly (pseudo-elements are invisible to assistive tech)
- No keyboard navigation for tooltips (hover-only interaction)
- No mobile touch support (CSS `:hover` doesn't work on touch devices)

**Recommended Approach**:
- Refactor CSS tooltips to React tooltip component with proper ARIA attributes
- Add `aria-describedby` or `aria-label` for screen readers
- Add focus states (`:focus::after`) for keyboard nav
- Add JavaScript touch handlers for mobile (tap to toggle tooltip)

**Effort**: 2-4 hours (create reusable Tooltip component in helpers.tsx)

### 2. Mobile Responsiveness

**Current State**:
- Desktop-first layout (tooltips positioned above elements)
- No touch interaction support
- PassResult breakdown assumes desktop viewport width

**Recommended Approach**:
- Add mobile breakpoints (<768px) for tooltip positioning (may need bottom positioning)
- Add touch event handlers for tooltip toggle
- Impact breakdown: use stacked layout on mobile instead of side-by-side

**Effort**: 1-2 hours per component

### 3. Consistency with Existing Design System

**Strengths**:
- All existing tooltips use consistent `.tip` class + CSS system
- Color palette matches (`var(--ink)`, `var(--parchment)`, `var(--gold-dark)`)
- Typography consistent (`font-size: 0.72rem`, sans-serif)

**Opportunities**:
- Introduce reusable components (Tooltip, Modal, BarGraph)
- Standardize spacing/padding across new features
- Consider design tokens for tooltip styling (currently hardcoded)

---

## Recommended Action Plan

### Immediate (When Design Specs Arrive)

1. **Read BL-061/063/067 design specs** in full
2. **Validate against current implementation** — update gap analysis above
3. **Prioritize BL-062 first** (P1, 75% complete, unblocks setup confusion)
4. **Estimate revised timelines** based on design scope

### Phase 1: BL-062 (Stat Tooltips) — CRITICAL

**Prerequisites**: BL-061 design specs complete

**Implementation Steps**:
1. Read design specs, compare with current STAT_TIPS
2. If current implementation matches:
   - Add keyboard accessibility (`:focus::after` CSS)
   - Add mobile touch support (JavaScript handlers or `:active` CSS)
   - Add `aria-describedby` for screen readers
   - Test on 320px mobile viewport
3. If design requires changes:
   - Update STAT_TIPS text to match specs
   - Add playstyle guidance if required
   - Implement any visual changes

**Estimated Time**: 1-4 hours (depending on scope)
**Files**: `src/ui/helpers.tsx`, `src/App.css` or `src/index.css`
**Tests**: Zero breakage expected (pure CSS + a11y enhancements)

### Phase 2: BL-064 (Impact Breakdown) — CRITICAL

**Prerequisites**: BL-063 design specs complete

**Implementation Steps**:
1. Read design specs, identify required data fields
2. Coordinate with engine-dev or tech-lead if calculator.ts refactoring needed
3. Implement bar graph component (SVG or CSS-based)
4. Add guard contribution calculation/display
5. Add attack advantage text explanation
6. Add fatigue effect text explanation
7. Implement expandable card (mobile-first)
8. Add responsive styling (<768px breakpoint)
9. Test on multiple viewports

**Estimated Time**: 6-12 hours (depending on calculator.ts changes)
**Files**: `src/ui/PassResult.tsx`, `src/App.css`
**Risks**: May require engine changes (coordinate via handoff)

### Phase 3: BL-068 (Counter Chart) — POLISH

**Prerequisites**: BL-067 design specs complete

**Implementation Steps**:
1. Read design specs, identify chart format (triangle/matrix/text)
2. Create chart component (new file: `src/ui/CounterChart.tsx`?)
3. Create modal/popup system (reusable for future features)
4. Integrate with AttackSelect.tsx (add help button)
5. Add responsive styling
6. Add keyboard accessibility (Tab to close, Escape key)
7. Test on multiple viewports

**Estimated Time**: 4-8 hours
**Files**: `src/ui/AttackSelect.tsx`, `src/ui/CounterChart.tsx` (new), `src/App.css`
**Opportunity**: Build reusable modal component for future features

---

## Deferred Opportunities (Post-MVP)

1. **Animated Tooltips**: Fade-in transitions, subtle scale effects
2. **Tooltip Variants**: Success/warning/info color schemes
3. **Interactive Tutorials**: Step-by-step onboarding flow with tooltips
4. **Stat Comparison Tool**: Side-by-side archetype comparison on Setup Screen
5. **Real-Time Win Rate Estimator**: Enhance LoadoutScreen matchup hint with live simulation

---

## Questions for Designer (BL-061/063/067)

### BL-061 (Stat Tooltips Design)

1. Should tooltips match current `STAT_TIPS` text, or do you want different wording?
2. Do you want playstyle guidance below archetype names (e.g., "Charger — Hit first, hit hard")?
3. Mobile interaction: tap-to-toggle or long-press to reveal?
4. Should tooltips be dismissible on mobile (tap outside to close)?

### BL-063 (Impact Breakdown Design)

1. What data fields are required? (Current has: effective stats, fatigue, counter bonus, accuracy, impact)
2. Do you want guard contribution shown as absolute value ("absorbed 15 impact") or percentage ("reduced 12%")?
3. Fatigue effect: show pre/post-fatigue stats or just reduction amount?
4. Bar graph style: horizontal bars, vertical bars, or stacked bars?
5. Expandable by default on desktop, or always collapsed until user clicks?

### BL-067 (Counter Chart Design)

1. Preferred format: triangle diagram, 6×6 matrix, or text-based list?
2. Modal popup or inline expandable section?
3. Should chart show ALL attack counters (6 joust + 6 melee = 12 total) or joust-only?
4. Integration: help button on AttackSelect screen, or always visible?

---

## Summary

**Current State**: All Round 3 tasks blocked on design specs, but substantial infrastructure already exists.

**Biggest Win**: BL-062 (Stat Tooltips) is **75% complete** — just needs a11y polish and design validation.

**Biggest Risk**: BL-064 (Impact Breakdown) may require engine changes to expose guard/fatigue breakdown data.

**Recommended Priority**:
1. BL-062 first (quick win, unblocks 80% of setup confusion)
2. BL-064 second (closes learning loop)
3. BL-068 third (polish, no urgency)

**Next Steps**:
1. Wait for designer to complete BL-061/063/067
2. Validate design specs against current implementation
3. Execute Phase 1 → Phase 2 → Phase 3 in sequence
4. Coordinate with engine-dev if calculator.ts changes needed for BL-064

---

**End of Analysis**
