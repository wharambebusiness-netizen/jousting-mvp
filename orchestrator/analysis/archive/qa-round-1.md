# QA Round 1 — BL-077: Manual QA Analysis (4 Shipped Onboarding Features)

**Date**: 2026-02-19
**QA Engineer**: Round 1 (new session, branch agent-qa-r1)
**Baseline**: 813 engine tests passing
**After**: 820 engine tests passing (+7)
**Status**: Code-level audit complete. Manual human testing still required (per task spec).

---

## Executive Summary

BL-077 is a manual QA task for 4 shipped onboarding features that requires human testers
(screen readers, cross-browser, touch devices). This round delivered:

1. **Code-level audit** of all 4 features — no blocking bugs found
2. **7 new unit tests** validating engine data behind the UI:
   - 5 `calcCarryoverPenalties` boundary tests (BL-070, calculator.test.ts:2131–2186)
   - 2 variant affinity ID validation tests (BL-071, gear-variants.test.ts:90–128)
3. **Notable finding**: Worktree at `.worktrees/qa` has no checkout — files are in main project

---

## Feature Audit

### BL-073 — Stat Tooltips (SetupScreen + LoadoutScreen)

**Location**: `src/ui/helpers.tsx:80–104` (StatBar component), `src/ui/LoadoutScreen.tsx`

**Implementation**:
- `StatBar` uses `<abbr>` element with `title` (native tooltip) + `aria-label` for screen readers
- `tabIndex={0}` on abbr allows keyboard users to trigger tooltip
- 5 detailed tooltip texts in `STAT_TIPS_DETAIL` (keyed by type: mom/ctl/grd/init/sta)
- `STAT_ABBR` maps full stat names to abbreviations (used in gear stat display)

**Issues Found**:
- **MINOR**: `StaminaBar` component (helpers.tsx:162) uses `data-tip` attribute for tooltip,
  not `title`. Native `data-tip` is non-standard — relies on CSS/JS tooltip framework.
  Screen readers will NOT announce `data-tip` content. Severity: LOW (stamina bar tooltip
  is supplementary; stamina value is already visible as text).
- **INFO**: `STAT_ABBR` constant is duplicated in `helpers.tsx:18` and `LoadoutScreen.tsx`
  (quality-review round flagged this). Not a bug but a maintainability risk.

**Tests validating this feature**: STAT_ABBR/STAT_TIPS are UI-only constants with no engine
test coverage (by design — they're presentation layer). Engine gear stat names (`momentum`,
`control`, etc.) are validated exhaustively in gear-variants.test.ts lines 51–68.

---

### BL-071 — Variant Tooltips (LoadoutScreen)

**Location**: `src/ui/LoadoutScreen.tsx:256–284` (VariantToggle), `src/ui/LoadoutScreen.tsx:317–397` (quick-build cards)

**Implementation**:
- `VariantToggle` buttons: `title` (native tooltip) + `aria-label` with affinity text
- `QuickSetButtons`: `title` + `aria-label`
- `quick-build-card` buttons: detailed `aria-label` with strategy/risk/impact
- Inline `variant-tooltip` divs inside button elements show strategy/risk/impact rows

**Issues Found**:
- **MINOR**: `variant-tooltip` div is a block element nested inside a `<button>`. While
  technically valid HTML5, some older screen readers (JAWS pre-2022) may not announce
  block child content of button correctly. Human JAWS testing needed.
- **MINOR**: No `aria-describedby` linking the quick-build button to its expanded
  variant-tooltip div. Screen reader users pressing Tab will hear the aria-label but
  may not discover the strategy/risk/impact detail rows.
- **INFO**: Matchup hint win rate estimates (LoadoutScreen.tsx:154–221) are heuristic and
  may not match simulation-derived values. This is informational display, not bug-level.

**New Tests Added** (gear-variants.test.ts:90–128):
- All 18 steed variant affinity values are valid archetype IDs (no typos)
- All 18 player variant affinity values are valid archetype IDs (no typos)

**Engine validation**: `getSteedVariantDef`/`getPlayerVariantDef` already have
spot-check tests (gear-variants.test.ts:281–339). New tests add exhaustive coverage
of the affinity field specifically (tooltip "Favors: <archetype>" correctness).

---

### BL-068 — Counter Chart (AttackSelect, accessible modal)

**Location**: `src/ui/CounterChart.tsx`

**Implementation**:
- Modal with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="counter-chart-title"`
- Close button auto-focused on mount (using `useRef` + `useEffect`)
- Escape key closes modal (document-level keydown listener)
- Overlay click closes modal
- Each `AttackCounterCard` is `<article>` with `aria-label` listing beats/beatenBy
- Emoji stance icons have `aria-hidden="true"`

**Issues Found**:
- **MODERATE**: Overlay div has `aria-hidden="false"` (CounterChart.tsx:161). This is
  redundant and potentially confusing — the default is already `aria-hidden="false"`.
  WCAG best practice for modals is to set `aria-hidden="true"` on ALL background content
  when modal is open (via `inert` attribute or JS). Without this, screen readers can
  navigate to background content while modal is open. Severity: MODERATE for WCAG AAA.
- **MODERATE**: No focus trap implementation. After the close button, Tab key can leave
  the dialog (reaching background elements). WCAG 2.1 SC 2.1.2 requires focus not to
  get trapped AND dialog focus management spec requires trapping within modal during open.
  WCAG AAA compliance would require a proper focus trap. Severity: MODERATE.
- **LOW**: `AttackCounterCard` uses emoji characters (✅ ⚠️) directly in visible content
  (CounterChart.tsx:91, 101). These have `aria-hidden="true"` which is correct, but the
  label text ("BEATS:", "WEAK TO:") doesn't have a semantic role. Minor readability issue.

**Engine data correctness**: Counter data (`beats`/`beatenBy`) is exhaustively validated:
- calculator.test.ts:630–665: symmetry (if A beats B → B.beatenBy contains A)
- calculator.test.ts:990–1035: all 6 joust + 6 melee attacks have at least 1 counter
- playtest.test.ts:233–256: named counter pair validations

---

### BL-070 — Melee Transition Screen

**Location**: `src/ui/MeleeTransitionScreen.tsx`

**Implementation**:
- Modal with `role="dialog"` on outer div (the clickable overlay), `aria-modal="true"`,
  `aria-labelledby="melee-transition-title"`
- Continue button auto-focused on mount
- Escape/Space/Enter all trigger `onContinue`
- Overlay click triggers `onContinue`
- Weapon diagram has descriptive `aria-label`
- Emoji icons have `aria-hidden="true"`
- Unseat details show carryover penalties (MOM/CTL/GRD) from `calcCarryoverPenalties()`

**Issues Found**:
- **LOW**: `role="dialog"` is on the outer overlay div (which also serves as the
  click-to-dismiss backdrop). ARIA best practice places `role="dialog"` on the inner
  modal content element, not the backdrop. Current implementation means the "dialog"
  area extends to the full screen including the dismiss zone. Not a functional bug.
- **INFO**: Continue button label is "Continue to Melee Phase" regardless of whether
  the match is already in MatchEnd phase. The button text correctly reads
  "Continue to Melee Phase" always (not "See Final Result" as in MeleeResult.tsx).
  Consistent but could confuse players on final round transitions.

**New Tests Added** (calculator.test.ts:2131–2186):
- `calcCarryoverPenalties(6)`: first MOM divisor breakpoint (-1, 0, 0)
- `calcCarryoverPenalties(7)`: first CTL divisor breakpoint (-1, -1, 0)
- `calcCarryoverPenalties(9)`: first GRD divisor breakpoint (-1, -1, -1)
- `calcCarryoverPenalties(100)`: large margin (-16, -14, -11)
- Ordering invariant: |MOM| ≥ |CTL| ≥ |GRD| for all margins 6–100

**JavaScript `-0` Bug Found and Documented**:
When `margin < divisor`, `-Math.floor(margin/divisor)` returns `-0`, not `0`. Existing
tests at line 906–913 already handle this using `penalty + 0` normalization. New tests
follow the same pattern. This is a cosmetic issue (display shows `0` either way) but
could cause `toBe(0)` test failures if not handled.

---

## Test Results

**Before**: 813 engine tests (calculator:202, phase-resolution:66, gigling-gear:48,
player-gear:46, match:100, gear-variants:223, playtest:128)

**After**: 820 engine tests (+7)
- calculator.test.ts: 202 → 207 (+5 carryover boundary tests)
- gear-variants.test.ts: 223 → 225 (+2 affinity ID validation tests)

**Duration**: ~628ms (stable, no regression)

---

## Pre-existing Test Failures (NOT from my changes)

The full test suite has 5 failing suites (orchestrator + operator tests):
- `orchestrator/role-registry.test.mjs`: SyntaxError
- `operator/__tests__/process-pool.test.mjs`: SyntaxError
- `operator/__tests__/server.test.mjs`: SyntaxError
- `operator/__tests__/views.test.mjs`: SyntaxError
- `operator/__tests__/coordination-integration.test.mjs`: 3 test failures

These are pre-existing and unrelated to engine changes. Engine tests: all 820 passing.

---

## Manual Testing Still Required (Human QA)

BL-077 acceptance criteria require human testers for:

| Test Area | Status |
|-----------|--------|
| NVDA screen reader (Windows) | ❌ Requires human |
| JAWS screen reader (Windows) | ❌ Requires human |
| VoiceOver (macOS/iOS) | ❌ Requires human |
| Chrome (latest) | ❌ Requires human |
| Safari (macOS/iOS) | ❌ Requires human |
| Firefox (latest) | ❌ Requires human |
| Edge (latest) | ❌ Requires human |
| iOS touch (iPhone) | ❌ Requires human |
| Android touch | ❌ Requires human |
| WCAG AAA audit | ❌ Requires human (or axe-core automated) |
| 320px responsive layout | ❌ Requires human |
| 1920px responsive layout | ❌ Requires human |

**Priority items for human testers**:
1. CounterChart focus trap (Tab cycling within modal)
2. VariantToggle screen reader announcement of affinity tooltip
3. MeleeTransitionScreen auto-focus behavior (continue button)
4. Quick-build card block-element-inside-button screen reader behavior

---

## Summary of Bugs Found

| ID | Severity | Feature | Description |
|----|----------|---------|-------------|
| QA-R1-01 | MODERATE | BL-068 | CounterChart: no focus trap (Tab leaves modal) |
| QA-R1-02 | MODERATE | BL-068 | CounterChart: background content accessible to SR during modal open |
| QA-R1-03 | LOW | BL-071 | VariantToggle: no aria-describedby for variant-tooltip detail rows |
| QA-R1-04 | LOW | BL-070 | MeleeTransitionScreen: role=dialog on backdrop, not inner modal |
| QA-R1-05 | LOW | BL-073 | StaminaBar: uses data-tip (non-standard), not title/aria attributes |

None of these are blockers — all 4 features are functional and usable.
