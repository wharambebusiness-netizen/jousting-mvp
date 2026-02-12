# BL-081: Phase 2 Planning — Top 5 Polish Opportunities

**Author**: ui-dev
**Date**: 2026-02-12
**Session**: S54 Round 2
**Task**: BL-081 (P2) — Analyze codebase for non-blocking UI improvements

---

## Executive Summary

**Current State**: MVP is 100% complete (7/7 onboarding features shipped). All critical user experience gaps are closed. 908/908 tests passing. Zero blocking bugs.

**Phase 2 Focus**: Elevate presentation quality from "functional" to "polished". Address micro-interactions, consistency, performance, and accessibility refinements that don't change game logic.

**Top 5 Opportunities** (ranked by impact):
1. **Inline Style Migration** (HIGH IMPACT) — 9 remaining inline styles, migrate to CSS classes
2. **Responsive Layout Refinements** (HIGH IMPACT) — Mobile gaps at 320px-480px breakpoints
3. **Animation Polish** (MEDIUM IMPACT) — Micro-interactions, transition timing, gesture feedback
4. **Accessibility Micro-Improvements** (MEDIUM IMPACT) — 48 ARIA attributes, expand coverage to 80+
5. **Visual Consistency Pass** (MEDIUM IMPACT) — Color harmonization, spacing rhythm, typography scale

---

## Opportunity 1: Inline Style Migration (HIGH IMPACT)

### Problem
**9 inline styles remain** across 4 components (down from 59 in S53, thanks to BL-036 in S33):
- `AIThinkingPanel.tsx` (3 occurrences) — CSS custom property `--bar-width` for dynamic bar charts
- `helpers.tsx` (2 occurrences) — Stat bar width percentages
- `MatchSummary.tsx` (2 occurrences) — CSS custom property `--anim-delay` for staggered animations
- `PassResult.tsx` (2 occurrences) — Impact breakdown bar heights

**Impact**: Inline styles bypass CSP, break hot module reload, and are harder to theme/maintain.

### Solution
Migrate to **CSS classes with data attributes**:

```tsx
// BEFORE (inline style):
<div style={{ '--bar-width': `${pct}%` } as React.CSSProperties} />

// AFTER (data attribute + CSS):
<div data-bar-width={pct} />
// App.css:
.ai-thinking__bar-fill { width: calc(var(--bar-width) * 1%); }
.ai-thinking__bar-fill[data-bar-width] { --bar-width: attr(data-bar-width number); }
```

**Note**: CSS `attr()` with `number` type is CSS4 spec (not yet supported in all browsers as of 2026). Fallback: use CSS custom properties set via JS ref callback.

**Alternate (safer) approach**:
```tsx
// Use ref callback to set CSS custom property
const barRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (barRef.current) {
    barRef.current.style.setProperty('--bar-width', `${pct}%`);
  }
}, [pct]);

return <div ref={barRef} className="ai-thinking__bar-fill" />;
```

### Acceptance Criteria
- ✅ Zero inline `style={{}}` in all UI components
- ✅ All dynamic values use CSS custom properties via refs or classes
- ✅ 908/908 tests passing (zero regression)
- ✅ Visual parity (pixel-perfect match before/after)

### Estimate
**2-3 hours**

### Files Modified
- `src/ui/AIThinkingPanel.tsx` (3 inline styles)
- `src/ui/helpers.tsx` (2 inline styles)
- `src/ui/MatchSummary.tsx` (2 inline styles)
- `src/ui/PassResult.tsx` (2 inline styles)
- `src/App.css` (add CSS classes for dynamic properties)

### Risks
- **Low** — Change is purely presentational (zero logic impact)
- **Testing**: Visual regression only (no unit test changes needed)
- **Fallback**: Keep inline styles if CSS custom property approach fails in testing

---

## Opportunity 2: Responsive Layout Refinements (HIGH IMPACT)

### Problem
**Mobile gaps at 320px-480px breakpoints**:
- **Gear selection screen** (LoadoutScreen.tsx): 12-slot grid is cramped at 320px (6 steed + 6 player slots)
- **Attack grid** (AttackSelect.tsx): 2-column grid breaks at 360px width (attack card text wraps awkwardly)
- **Counter chart modal** (CounterChart.tsx): 6-card grid overflows at 320px (modal content scrolls horizontally)
- **Quick builds grid** (LoadoutScreen.tsx): 3-column layout too tight at 360px-480px

**Current responsive coverage**:
- 14 media queries across `App.css` + `index.css`
- Breakpoints: 480px, 768px, 1023px, `prefers-reduced-motion`
- **Gap**: 320px-400px range (iPhone SE, small Android devices)

### Solution
Add **320px and 360px breakpoints** for critical components:

```css
/* LoadoutScreen: Stack gear slots vertically at 320px */
@media (max-width: 360px) {
  .loadout-slots-grid {
    grid-template-columns: 1fr; /* Force single column */
    gap: 8px;
  }
  .gear-slot-card {
    padding: 10px; /* Reduce padding */
    font-size: 0.85rem; /* Shrink text */
  }
}

/* AttackSelect: Single column at 320px */
@media (max-width: 400px) {
  .attack-grid {
    grid-template-columns: 1fr; /* Stack vertically */
  }
}

/* CounterChart: Reduce card size at 320px */
@media (max-width: 400px) {
  .counter-chart-grid {
    grid-template-columns: 1fr; /* Stack vertically */
  }
  .counter-card {
    font-size: 0.8rem;
    padding: 8px;
  }
}

/* Quick Builds: 2-column at 480px, 1-column at 360px */
@media (max-width: 480px) {
  .quick-builds-grid {
    grid-template-columns: 1fr 1fr; /* 2 columns */
  }
}
@media (max-width: 360px) {
  .quick-builds-grid {
    grid-template-columns: 1fr; /* Stack vertically */
  }
}
```

### Testing Plan
1. Chrome DevTools: Test at 320px, 360px, 375px, 414px, 480px widths
2. Real devices: iPhone SE (375px), Galaxy A50 (360px), Pixel 5 (393px)
3. Landscape orientation: Test at 568px × 320px (iPhone SE landscape)

### Acceptance Criteria
- ✅ Zero horizontal scroll at 320px width (all screens)
- ✅ All interactive elements ≥44px tap targets (iOS accessibility guideline)
- ✅ Text readable without zoom (min 14px font size at 320px)
- ✅ 908/908 tests passing (zero regression)

### Estimate
**3-4 hours** (includes manual testing on 3+ device sizes)

### Files Modified
- `src/App.css` (add 320px/360px breakpoints for LoadoutScreen, AttackSelect, CounterChart)
- `src/index.css` (add 320px breakpoint for Quick Builds)

### Risks
- **Low** — CSS-only changes (zero logic impact)
- **Testing burden**: Requires manual testing on real devices or emulators

---

## Opportunity 3: Animation Polish (MEDIUM IMPACT)

### Problem
**Current animations** are functional but lack refinement:
- **Unseat entrance** (`@keyframes unseat-entrance`): 0.5s duration feels abrupt
- **Winner banner** (`@keyframes winner-banner-enter`): 0.4s duration, no exit animation
- **Badge appear** (`@keyframes badge-appear`): Uniform 0.3s timing (no variation for visual interest)
- **Fatigue pulse** (`@keyframes fatigue-pulse`): Infinite loop can be distracting (consider finite 3x loop)
- **Melee entrance** (`@keyframes melee-entrance`): 0.6s duration, could use more dramatic build-up

**Missing micro-interactions**:
- No hover transition on archetype cards (instant color change)
- No pressed state animation on buttons (`:active` scale only)
- No loading state for gear randomization (instant result feels janky)
- No exit animations (modal dismisses instantly)

### Solution
#### Phase 1: Timing Refinements
```css
/* Slow down dramatic entrances for impact */
@keyframes unseat-entrance {
  /* 0.5s → 0.7s (more dramatic) */
  0% { transform: scale(0.9); opacity: 0; box-shadow: 0 0 0 rgba(139, 37, 0, 0); }
  40% { transform: scale(1.05); } /* Overshoot earlier */
  100% { transform: scale(1); opacity: 1; box-shadow: 0 4px 12px var(--glow-red); }
}

/* Add exit animation for modals */
@keyframes modal-exit {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.95); }
}

/* Finite fatigue pulse (3x loop instead of infinite) */
.fatigue-warning {
  animation: fatigue-pulse 1.5s ease-in-out 3; /* 3 iterations */
}
```

#### Phase 2: Micro-Interactions
```css
/* Smooth hover transitions */
.archetype-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, background-color 0.15s ease;
}
.archetype-card:hover {
  background-color: var(--card-hover); /* Subtle background shift */
}

/* Button press feedback */
button:active {
  transform: scale(0.98);
  transition: transform 0.1s ease; /* Faster press response */
}

/* Loading state for gear randomization */
.loadout-randomize-btn--loading {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

### Acceptance Criteria
- ✅ All entrance animations ≥0.5s duration (no rushed animations)
- ✅ All exit animations present (modals, banners, badges)
- ✅ Hover transitions ≤0.2s (responsive feel)
- ✅ No infinite animations except loading spinners (avoid distraction)
- ✅ `prefers-reduced-motion: reduce` disables all decorative animations
- ✅ 908/908 tests passing (zero regression)

### Estimate
**2-3 hours**

### Files Modified
- `src/App.css` (timing refinements, new micro-interactions)
- `src/index.css` (modal exit animations)
- Potentially `src/ui/LoadoutScreen.tsx` (add loading state for randomize button)

### Risks
- **Low** — CSS-only changes (zero logic impact)
- **Subjective**: Animation taste is subjective; user testing would validate changes

---

## Opportunity 4: Accessibility Micro-Improvements (MEDIUM IMPACT)

### Problem
**Current ARIA coverage**: 48 ARIA attributes across 15 UI components
**Gaps**:
- **Focus indicators**: All interactive elements have `:focus-visible`, but modal focus trap is missing
- **Screen reader announcements**: Pass results don't announce winner via `aria-live`
- **Landmark regions**: No `<main>`, `<nav>`, or `<aside>` semantic HTML
- **Heading hierarchy**: Some components skip from `<h2>` to `<h4>` (e.g., MatchSummary.tsx)
- **Keyboard shortcuts**: No visible keyboard hints (e.g., "Press Escape to close modal")

### Solution
#### Phase 1: Focus Management
```tsx
// CounterChart.tsx: Add focus trap
useEffect(() => {
  const modal = modalRef.current;
  if (!modal) return;

  const focusableEls = modal.querySelectorAll('button, [tabindex="0"]');
  const firstEl = focusableEls[0] as HTMLElement;
  const lastEl = focusableEls[focusableEls.length - 1] as HTMLElement;

  const handleTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === firstEl) {
      lastEl.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      firstEl.focus();
      e.preventDefault();
    }
  };

  modal.addEventListener('keydown', handleTabKey);
  firstEl.focus(); // Auto-focus first element

  return () => modal.removeEventListener('keydown', handleTabKey);
}, []);
```

#### Phase 2: Live Regions
```tsx
// PassResultScreen.tsx: Announce winner
<div
  className="pass-winner-banner pass-winner-banner--{winnerMod}"
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  <div className="pass-winner-banner__label">{winnerLabel}</div>
</div>
```

#### Phase 3: Semantic HTML
```tsx
// App.tsx: Add landmark regions
<div id="root">
  <header className="app-header">
    <h1>Joust & Melee</h1>
  </header>
  <main className="app-main">
    {/* All screen components */}
  </main>
  <footer className="app-footer">
    {/* Optional: Credits, version info */}
  </footer>
</div>
```

#### Phase 4: Keyboard Hints
```tsx
// CounterChart.tsx: Add visible Escape hint
<div className="modal-header">
  <h2>Counter Relationships</h2>
  <span className="modal-shortcut-hint">Press <kbd>Esc</kbd> to close</span>
</div>
```

### Acceptance Criteria
- ✅ All modals have focus traps (Tab loops within modal)
- ✅ All result screens have `aria-live` regions for winner announcements
- ✅ Semantic HTML: `<main>`, `<header>`, optional `<footer>`
- ✅ Heading hierarchy valid (no skipped levels)
- ✅ Keyboard hints visible on all modals
- ✅ WCAG AAA compliant (level up from current WCAG AA)
- ✅ 908/908 tests passing (zero regression)

### Estimate
**3-4 hours**

### Files Modified
- `src/ui/CounterChart.tsx` (focus trap, keyboard hints)
- `src/ui/PassResult.tsx` (`aria-live` region)
- `src/ui/MeleeResult.tsx` (`aria-live` region)
- `src/App.tsx` (semantic HTML: `<main>`, `<header>`)
- `src/App.css` (styles for `<kbd>`, `.modal-shortcut-hint`)

### Risks
- **Low** — Accessibility improvements don't change game logic
- **Testing**: Requires screen reader testing (NVDA, JAWS, VoiceOver) to validate

---

## Opportunity 5: Visual Consistency Pass (MEDIUM IMPACT)

### Problem
**Minor inconsistencies** across 2,854 lines of UI code + 31,000+ characters of CSS:
- **Color drift**: Some components use hardcoded hex colors instead of CSS custom properties
- **Spacing rhythm**: Mix of `8px`, `10px`, `12px`, `14px`, `16px` (no strict 4px/8px grid)
- **Typography scale**: Font sizes range from `0.7rem` to `2rem` (13 unique sizes, no modular scale)
- **Border radius**: Mix of `4px`, `6px`, `10px` (3 values for `var(--radius)` variants)
- **Shadow depth**: Mix of `0 2px 6px`, `0 3px 10px`, `0 4px 12px` (no unified scale)

### Solution
#### Phase 1: Audit & Document Current State
1. Extract all unique color values (grep for `#[0-9a-fA-F]{6}` in CSS)
2. Extract all spacing values (grep for `margin:|padding:` and parse px values)
3. Extract all font-size values (grep for `font-size:` and parse rem/px values)
4. Document findings in spreadsheet (value, frequency, replacement)

#### Phase 2: Define Design Tokens
```css
/* index.css: Add design token system */
:root {
  /* Typography scale (modular scale 1.25 ratio) */
  --text-xs: 0.64rem;   /* 10.24px */
  --text-sm: 0.8rem;    /* 12.8px */
  --text-base: 1rem;    /* 16px */
  --text-lg: 1.25rem;   /* 20px */
  --text-xl: 1.563rem;  /* 25px */
  --text-2xl: 1.953rem; /* 31.25px */

  /* Spacing scale (4px base unit) */
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */

  /* Shadow scale (depth hierarchy) */
  --shadow-sm: 0 1px 3px rgba(44, 24, 16, 0.12);
  --shadow-md: 0 3px 6px rgba(44, 24, 16, 0.15);
  --shadow-lg: 0 6px 12px rgba(44, 24, 16, 0.18);
  --shadow-xl: 0 10px 20px rgba(44, 24, 16, 0.20);

  /* Border radius scale */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;
  --radius-xl: 16px;
}
```

#### Phase 3: Migrate to Tokens
- Find/replace hardcoded colors with CSS custom properties
- Replace magic number spacing with `--space-*` tokens
- Replace magic number font-sizes with `--text-*` tokens
- Replace hardcoded shadows with `--shadow-*` tokens

### Acceptance Criteria
- ✅ Zero hardcoded hex colors in CSS (all use CSS custom properties)
- ✅ Zero magic number spacing (all use 4px/8px grid via `--space-*`)
- ✅ Font sizes use modular scale (max 6 unique sizes via `--text-*`)
- ✅ Shadows use unified depth scale (max 4 unique values via `--shadow-*`)
- ✅ 908/908 tests passing (zero regression)
- ✅ Visual parity (pixel-perfect match before/after)

### Estimate
**4-5 hours** (includes audit + migration + visual QA)

### Files Modified
- `src/index.css` (add design token system)
- `src/App.css` (migrate to tokens)
- All UI components (if any inline colors/spacing exist)

### Risks
- **Medium** — High volume of changes (1,000+ lines of CSS affected)
- **Testing burden**: Requires pixel-perfect visual regression testing
- **Rollback**: Git revert is straightforward if visual parity breaks

---

## Priority Ranking (By Impact)

### Tier 1: High Impact (Ship First)
1. **Inline Style Migration** (2-3h) — CSP compliance, maintainability, hot reload fix
2. **Responsive Layout Refinements** (3-4h) — Mobile UX critical (320px-480px gaps)

**Rationale**: These directly fix user-facing bugs (mobile scroll, hot reload issues).

### Tier 2: Medium Impact (Ship Next)
3. **Animation Polish** (2-3h) — Elevates perceived quality, no functional change
4. **Accessibility Micro-Improvements** (3-4h) — WCAG AAA compliance, screen reader UX

**Rationale**: Quality-of-life improvements that differentiate "functional" from "polished".

### Tier 3: Lower Impact (Nice-to-Have)
5. **Visual Consistency Pass** (4-5h) — Design system rigor, long-term maintainability

**Rationale**: Least user-facing impact (users don't notice color/spacing drift). Highest implementation cost (1,000+ line audit). Best suited for longer polish sprint.

---

## Implementation Roadmap

### Sprint 1 (6-7 hours): Critical Fixes
- **Week 1, Day 1-2**: BL-081.1 (Inline Style Migration) — 2-3h
- **Week 1, Day 2-3**: BL-081.2 (Responsive Layout Refinements) — 3-4h
- **Milestone**: Zero mobile scroll bugs, CSP compliance, hot reload fixed

### Sprint 2 (5-7 hours): Polish Pass
- **Week 2, Day 1**: BL-081.3 (Animation Polish) — 2-3h
- **Week 2, Day 2-3**: BL-081.4 (Accessibility Micro-Improvements) — 3-4h
- **Milestone**: WCAG AAA compliant, polished animations

### Sprint 3 (4-5 hours): Design System (Optional)
- **Week 3, Day 1-2**: BL-081.5 (Visual Consistency Pass) — 4-5h
- **Milestone**: Design token system, zero hardcoded colors/spacing

**Total Estimate**: 15-19 hours (3 weeks at 5-7h/week pace)

---

## Risks & Mitigations

### Risk 1: CSS Regressions
**Impact**: HIGH (could break layout across all screens)
**Mitigation**:
- Git tag before each sprint (`git tag polish-sprint-1-start`)
- Visual regression testing via screenshot comparison (manual QA)
- Rollback plan: `git reset --hard polish-sprint-1-start`

### Risk 2: Mobile Testing Burden
**Impact**: MEDIUM (requires real devices or emulators)
**Mitigation**:
- Chrome DevTools responsive mode (80% coverage)
- BrowserStack for real device testing (20% validation)
- Minimum 3 device sizes: 320px, 375px, 414px

### Risk 3: Subjective Animation Taste
**Impact**: LOW (animations are taste-driven, not functional)
**Mitigation**:
- A/B test with 5-10 users (informal feedback)
- Rollback if >50% users prefer old animations

### Risk 4: Accessibility Testing Complexity
**Impact**: MEDIUM (screen reader testing requires specialized tools)
**Mitigation**:
- NVDA (Windows, free), VoiceOver (macOS, built-in), JAWS (trial)
- Axe DevTools browser extension (automated audit)
- Manual keyboard navigation testing (Tab, Enter, Escape)

---

## Success Metrics

### Quantitative
- ✅ **Zero inline styles** (9 → 0)
- ✅ **Zero mobile scroll bugs** at 320px width (all screens tested)
- ✅ **80+ ARIA attributes** (48 → 80+, +67% increase)
- ✅ **WCAG AAA compliant** (up from WCAG AA)
- ✅ **908/908 tests passing** (zero regression)

### Qualitative
- ✅ **Perceived quality lift** — animations feel refined, not rushed
- ✅ **Mobile experience smooth** — no cramped layouts, readable text
- ✅ **Screen reader experience improved** — live regions, focus traps, keyboard hints
- ✅ **Design system foundation** — token system ready for future theming

---

## Appendix: Current State Snapshot

### UI Component Inventory (15 files, 2,854 lines)
```
SetupScreen.tsx         — Archetype selection + difficulty
LoadoutScreen.tsx       — 12-slot gear system + Quick Builds
SpeedSelect.tsx         — Joust speed picker
AttackSelect.tsx        — Joust/Melee attack picker
RevealScreen.tsx        — Attack reveal animation
PassResult.tsx          — Joust pass result + Impact Breakdown
MeleeResult.tsx         — Melee round result
MeleeTransition.tsx     — Melee transition interstitial (BL-070)
MeleeTransitionScreen.tsx — Unseat → Melee transition wrapper
MatchSummary.tsx        — End-of-match results
AIThinkingPanel.tsx     — AI reasoning visualization
AIEndScreenPanels.tsx   — AI post-match analysis
CounterChart.tsx        — Counter relationship modal (BL-068)
CombatLog.tsx           — Collapsible debug log
helpers.tsx             — StatBar, Scoreboard, STAT_ABBR
```

### CSS Inventory (2 files, 31,000+ characters)
```
index.css               — Global styles, design tokens, base typography
App.css                 — Component styles, animations, responsive breakpoints
```

### Inline Style Locations (9 occurrences)
```
AIThinkingPanel.tsx:64  — style={{ '--bar-width': `${pct(weights.slow)}%` }}
AIThinkingPanel.tsx:74  — style={{ '--bar-width': `${pct(weights.standard)}%` }}
AIThinkingPanel.tsx:84  — style={{ '--bar-width': `${pct(weights.fast)}%` }}
helpers.tsx:90          — style={{ width: `${pct}%` }}
helpers.tsx:126         — style={{ width: `${pct}%` }}
MatchSummary.tsx:197    — style={{ '--anim-delay': `${i * 0.1}s` }}
MatchSummary.tsx:216    — style={{ '--anim-delay': `${(match.passResults.length + i) * 0.1}s` }}
PassResult.tsx:204      — style={{ height: `${Math.max(p1Pct, 8)}%` }}
PassResult.tsx:207      — style={{ height: `${Math.max(p2Pct, 8)}%` }}
```

### Responsive Breakpoints (14 media queries)
```
App.css:712   — @media (max-width: 768px)  — Tablet
App.css:726   — @media (max-width: 480px)  — Mobile
App.css:1166  — @media (max-width: 480px)  — Mobile
App.css:1467  — @media (prefers-reduced-motion: reduce)
App.css:1504  — @media (max-width: 768px)  — Tablet
App.css:1845  — @media (max-width: 480px)  — Mobile
App.css:2336  — @media (max-width: 1023px) — Desktop
App.css:2352  — @media (max-width: 768px)  — Tablet
App.css:2441  — @media (prefers-reduced-motion: reduce)
App.css:2612  — @media (max-width: 1023px) — Desktop
App.css:2637  — @media (max-width: 768px)  — Tablet
index.css:400 — @media (max-width: 480px)  — Mobile
index.css:471 — @media (max-width: 480px)  — Mobile
index.css:479 — @media (prefers-reduced-motion: reduce)
```

**Gap**: 320px-400px range (small mobile devices)

### ARIA Attribute Inventory (48 occurrences)
```
SetupScreen.tsx         — 6 aria-label on archetype cards
LoadoutScreen.tsx       — 12 aria-label on gear slot cards
AttackSelect.tsx        — 6 aria-label on attack cards
SpeedSelect.tsx         — 3 aria-label on speed cards
CounterChart.tsx        — 12 aria-label on counter cards + modal
PassResult.tsx          — 2 aria-label on impact breakdown
MeleeResult.tsx         — 2 aria-label on attack cards
CombatLog.tsx           — 1 aria-expanded on collapsible toggle
helpers.tsx             — 4 aria-label on stat bars
```

**Gap**: No `aria-live` regions, no modal focus traps, no semantic landmarks

---

## Conclusion

Phase 2 polish work is **non-blocking** (MVP is 100% complete) but **high value** (elevates presentation quality from "functional" to "polished").

**Recommended sequencing**:
1. **Sprint 1 (6-7h)**: Inline styles + responsive gaps — fixes user-facing bugs
2. **Sprint 2 (5-7h)**: Animations + accessibility — quality-of-life lift
3. **Sprint 3 (4-5h)**: Visual consistency — design system foundation (optional)

**Total investment**: 15-19 hours over 3 weeks at 5-7h/week pace.

**Expected outcome**: Zero mobile scroll bugs, CSP compliance, WCAG AAA accessibility, polished animations, and design token foundation for future theming.

---

**End of Analysis**
