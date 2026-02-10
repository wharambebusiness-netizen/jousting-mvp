# UI Developer — Round 7 Analysis

**Round**: 7
**Date**: 2026-02-10
**Agent**: ui-dev
**Status**: Active — implementing BL-068 (Counter Chart UI)

---

## Executive Summary

**Work Selected**: BL-068 (Counter Chart UI, P3 polish)

**Rationale**:
- BL-064 (Impact Breakdown, P1) remains BLOCKED on BL-076 (engine-dev PassResult extensions)
- BL-067 (Counter Chart design spec) was COMPLETED in Round 6 by designer
- BL-068 is now fully unblocked and ready for implementation
- 6-10h estimated effort, pure UI work, zero engine dependencies

**Deliverable**: CounterChart modal component showing rock-paper-scissors attack relationships for new player onboarding

---

## Task Selection Analysis

### Available Tasks

| Task | Priority | Status | Blocker | Readiness | Effort |
|------|----------|--------|---------|-----------|--------|
| BL-064 | P1 (CRITICAL) | pending | BL-076 (engine-dev) | 100% design ready | 6-8h |
| BL-068 | P3 (POLISH) | pending | BL-067 (design) ✅ COMPLETE | 100% design ready | 6-10h |

### Decision Matrix

**BL-064 Status**:
- ❌ **BLOCKED** — Engine-dev must extend PassResult interface with 9 optional fields
- BL-076 task exists in backlog but no engine-dev agent assigned yet
- Cannot proceed without data from engine

**BL-068 Status**:
- ✅ **UNBLOCKED** — BL-067 design spec completed Round 6 (435 lines, comprehensive)
- ✅ **READY** — All specs, mockups, accessibility requirements, testing checklists provided
- ✅ **PURE UI** — Zero engine dependencies, can implement independently
- ✅ **P3 PRIORITY** — Improves new player onboarding (closes "learn-by-losing" gap)

**Conclusion**: Implement BL-068 in Round 7 to maintain momentum while BL-064 waits for engine-dev.

---

## BL-068 Implementation Plan

### Design Spec Summary (from design-round-4.md lines 711-1145)

**Format**: Interactive Beats/Weak To matrix (modal popup)

**Key Components**:
1. **Modal overlay** triggered by "?" icon on AttackSelect header
2. **Attack cards** showing beats/weak-to relationships for all 6 attacks (joust or melee)
3. **Icon system** with stance colors (aggressive=red/orange, balanced=blue/purple, defensive=green/gold)
4. **Responsive layouts**:
   - Desktop (≥1024px): 2-column grid, all 6 visible
   - Tablet (768-1023px): Single column, scrollable
   - Mobile (<768px): Modal fits viewport, swipe to scroll
5. **Accessibility**: Focus trap, ARIA labels, keyboard nav (Tab/Escape), screen reader support

**Attack Relationships** (from attacks.ts):

**Joust Phase**:
- Coup Fort: beats Port de Lance, weak to Coup en Passant + Course de Lance
- Bris de Garde: beats Port de Lance + Coup de Pointe, weak to Course de Lance
- Course de Lance: beats Coup Fort + Bris de Garde, weak to Port de Lance
- Coup de Pointe: beats Port de Lance, weak to Bris de Garde + Coup en Passant
- Port de Lance: beats Course de Lance + Coup en Passant, weak to Coup Fort + Bris de Garde + Coup de Pointe
- Coup en Passant: beats Coup Fort + Coup de Pointe, weak to Port de Lance

**Melee Phase**:
- Overhand Cleave: beats Guard High + Riposte Step, weak to Measured Cut + Precision Thrust
- Feint Break: beats Precision Thrust, weak to Riposte Step
- Measured Cut: beats Overhand Cleave + Riposte Step, weak to Guard High
- Precision Thrust: beats Overhand Cleave, weak to Feint Break + Riposte Step
- Guard High: beats Measured Cut, weak to Overhand Cleave
- Riposte Step: beats Feint Break + Precision Thrust, weak to Overhand Cleave + Measured Cut

---

## Implementation Phases

### Phase 1: Component Scaffolding (1-2h)

**Goal**: Create CounterChart.tsx component with basic structure

**Tasks**:
1. Create `src/ui/CounterChart.tsx` component
2. Define props interface: `{ phase: 'joust' | 'melee', onClose: () => void }`
3. Map JOUST_ATTACKS / MELEE_ATTACKS into attack card data structure
4. Render basic attack cards with name, beats, weak-to lists
5. Wire beats/weak-to from `attack.beats` and `attack.beatenBy` arrays

**Deliverable**: CounterChart component renders all 6 attacks with correct relationships

**Files Modified**:
- `src/ui/CounterChart.tsx` (NEW)

**Testing**:
- Verify all 6 joust attacks render with correct beats/weak-to lists
- Verify all 6 melee attacks render with correct beats/weak-to lists
- Check attack names match attacks.ts
- Run `npx vitest run` — expect 897 passing (no breakage)

---

### Phase 2: Responsive Layouts (2-3h)

**Goal**: Implement desktop 2-column, tablet single-column, mobile modal layouts

**Tasks**:
1. Add modal overlay wrapper (dark background, z-index: 1000)
2. Desktop layout (≥1024px): 2-column grid with CSS Grid
3. Tablet layout (768-1023px): Single column stacked, scrollable
4. Mobile layout (<768px): Modal fits viewport, safe area padding
5. Add "✕" close button in modal header
6. Implement overlay dismiss (click outside closes modal)

**Deliverable**: CounterChart renders correctly on all screen sizes

**Files Modified**:
- `src/ui/CounterChart.tsx` (modal overlay, responsive container)
- `src/App.css` (modal styling, grid layouts, close button)
- `src/index.css` (responsive breakpoints)

**Testing**:
- Desktop 1920px: 2-column grid visible, no scroll needed
- Tablet 768px: Single column, vertical scroll works
- Mobile 320px: Modal fits, no horizontal overflow
- Landscape 568px: Readable without scroll
- Run `npx vitest run` — expect 897 passing

---

### Phase 3: Accessibility & Keyboard Nav (1-2h)

**Goal**: Add ARIA labels, focus trap, keyboard handlers

**Tasks**:
1. Add `role="dialog"` to modal wrapper
2. Add `aria-labelledby` pointing to modal title
3. Add `aria-label` to each attack card with full description
4. Implement focus trap (Tab cycles within modal only)
5. Add Escape key handler (closes modal)
6. Add Spacebar/Enter handler on info icon (opens modal)
7. Focus management: modal opens → focus title, modal closes → focus returns to icon
8. Add visible focus ring (4px solid outline) on all interactive elements

**Deliverable**: CounterChart fully keyboard-accessible and screen reader friendly

**Files Modified**:
- `src/ui/CounterChart.tsx` (ARIA attributes, keyboard handlers, focus management)
- `src/index.css` (focus ring styling)

**Testing**:
- Tab through attack cards: focus ring visible on each
- Keyboard-only: Escape closes modal, no focus traps
- Screen reader: Announces modal dialog, attack names, beats/weak-to lists
- Run `npx vitest run` — expect 897 passing

---

### Phase 4: Integration with AttackSelect (1h)

**Goal**: Wire CounterChart modal to AttackSelect screen with "?" icon trigger

**Tasks**:
1. Add "?" info icon to AttackSelect header
2. Add state: `const [showCounterChart, setShowCounterChart] = useState(false)`
3. Wire icon onClick → `setShowCounterChart(true)`
4. Render CounterChart conditionally: `{showCounterChart && <CounterChart phase={phase} onClose={() => setShowCounterChart(false)} />}`
5. Pass correct `phase` prop ('joust' or 'melee') based on match state
6. Add icon tooltip: "View counter chart — see what beats what"

**Deliverable**: CounterChart modal opens/closes from AttackSelect screen

**Files Modified**:
- `src/ui/AttackSelect.tsx` (add icon, state, wire modal)
- `src/App.css` (info icon styling)

**App.tsx Changes** (deferred to coordination):
- AttackSelect already receives correct phase from App.tsx (no changes needed)
- If AttackSelect doesn't have phase prop, document in handoff for orchestrator

**Testing**:
- Click "?" icon → modal opens
- Click "✕" or Escape → modal closes
- Focus returns to "?" icon after close
- Modal shows correct attack set (joust vs melee)
- Run `npx vitest run` — expect 897 passing

---

### Phase 5: Testing & Polish (1-2h)

**Goal**: Cross-browser testing, responsive validation, accessibility spot-check

**Tasks**:
1. Cross-browser test: Chrome, Edge, Firefox, Safari (desktop)
2. Mobile browser test: iOS Safari, Chrome Android
3. Screen reader spot-check: NVDA (if available, otherwise document manual QA needed)
4. Responsive validation: 320px, 768px, 1024px, 1920px breakpoints
5. Attack icon colors: verify stance colors match design (red/orange, blue/purple, green/gold)
6. Content review: verify all beats/weak-to lists match attacks.ts
7. Polish: smooth transitions (0.3s fade-in), focus states, hover effects

**Deliverable**: Production-ready CounterChart component

**Files Modified**:
- `src/App.css` (polish: transitions, hover effects)
- `src/index.css` (final responsive tweaks)

**Testing**:
- All functional tests pass (14 items from design checklist)
- All accessibility tests pass (8 items from design checklist)
- All responsive tests pass (4 breakpoints from design checklist)
- Cross-browser validation (5 browsers from design checklist)
- Run `npx vitest run` — expect 897 passing
- Document manual QA needs (screen reader testing) for BL-073 follow-up

---

## Risk Assessment

### Low-Risk Implementation

**Why Low Risk**:
- ✅ Pure UI work, zero engine dependencies
- ✅ Comprehensive design spec (435 lines, all edge cases covered)
- ✅ Read-only data (beats/weak-to from attacks.ts, no mutations)
- ✅ Modal pattern (well-established, no novel architecture)
- ✅ No test assertion updates needed (UI-only changes)

**Potential Issues**:
1. **Attack data mismatch** — beats/weak-to lists don't match attacks.ts
   - **Mitigation**: Verify against attacks.ts in Phase 1, add data validation
2. **Focus trap breaks keyboard nav** — Tab escapes modal to page behind
   - **Mitigation**: Test keyboard-only workflow in Phase 3, use proven focus trap pattern
3. **Mobile tap targets too small** — <44px fails WCAG
   - **Mitigation**: Design spec requires 44px minimum, validate in Phase 5
4. **Screen reader announces duplicate content** — attack name read twice
   - **Mitigation**: Add `aria-hidden` to decorative elements in Phase 3

**Overall Risk**: 🟢 **LOW** — straightforward UI work with comprehensive design spec

---

## Expected Outcomes

### Player Experience Improvement

**Before** (Current State):
```
Player sees AttackSelect with "Beats: High Guard | Weak to: Measured Cut" text.
Player thinks: "What does High Guard look like? Which attacks should I avoid?"
Player picks attack randomly or based on speed.
Player loses pass → "Oh, they countered me."
Player learns by trial-and-error over 5-10 jousts.
```

**After** (With Counter Chart):
```
Player sees AttackSelect with "?" icon.
Player clicks "?" → Modal shows all 6 attacks with beats/weak-to relationships.
Player reads: "Coup Fort beats Port de Lance, weak to Coup en Passant"
Player thinks: "If opponent used Port de Lance last time, Coup Fort is safe."
Player picks Coup Fort → wins counter → "I predicted that!"
Player UNDERSTANDS counter system after 1-2 jousts.
```

### Learning Outcomes

✅ Players learn counter system in 1-2 jousts (not 5-10 losses)
✅ Players make informed attack choices based on counter relationships
✅ Players feel confident and strategic (not punished by hidden mechanics)
✅ Counter system becomes learnable and teachable (not trial-and-error)

---

## Quality Metrics

### Testing Coverage

**Automated Tests**: 897/897 passing (zero breakage expected)

**Manual Testing Required** (document in handoff for QA):
- Screen reader testing (NVDA, JAWS, VoiceOver) — 6 test cases
- Cross-browser testing (Chrome, Safari, Firefox, Edge, mobile) — 5 browsers
- Responsive testing (320px, 768px, 1024px, 1920px) — 4 breakpoints
- Keyboard navigation (Tab, Escape, Spacebar, Enter) — 8 test cases
- Touch interaction (mobile tap, swipe, dismiss) — 5 test cases

**Total Manual QA**: ~2-3 hours (deferred to BL-073 or new task)

---

## Coordination Points

### Dependencies

**Upstream** (already resolved):
- ✅ BL-067 design spec complete (design-round-4.md lines 711-1145)
- ✅ attacks.ts counter relationships defined
- ✅ AttackSelect.tsx component exists and renders attack cards

**Downstream** (no blockers):
- ❌ No engine changes needed
- ❌ No balance tuning needed
- ❌ No test writer support needed

### File Ownership

**Primary** (ui-dev):
- `src/ui/CounterChart.tsx` (NEW, full ownership)
- `src/ui/AttackSelect.tsx` (modify to add icon + modal trigger)
- `src/App.css` (add modal styling)
- `src/index.css` (add responsive breakpoints)

**Shared** (coordinate via handoff):
- `src/App.tsx` — if AttackSelect phase prop missing, document change needed

---

## Effort Estimate

| Phase | Tasks | Estimated Time |
|-------|-------|---------------|
| Phase 1: Component Scaffolding | Create CounterChart, map attack data, render cards | 1-2h |
| Phase 2: Responsive Layouts | Modal overlay, 2-column grid, mobile fit | 2-3h |
| Phase 3: Accessibility & Keyboard | ARIA labels, focus trap, keyboard handlers | 1-2h |
| Phase 4: Integration | Wire to AttackSelect, add icon, state management | 1h |
| Phase 5: Testing & Polish | Cross-browser, responsive, accessibility spot-check | 1-2h |

**Total Estimate**: 6-10 hours (median 8 hours)

**Confidence**: High — comprehensive design spec reduces unknowns

---

## Success Criteria

**BL-068 COMPLETE** when:

1. ✅ CounterChart component created with all 6 attack relationships
2. ✅ Modal opens on "?" icon click from AttackSelect
3. ✅ Modal closes on "✕" button, Escape key, or tap outside
4. ✅ Responsive layouts work on desktop, tablet, mobile (3 breakpoints)
5. ✅ Keyboard accessible (Tab, Escape, Spacebar/Enter, focus trap)
6. ✅ Screen reader friendly (role="dialog", aria-labels, semantic structure)
7. ✅ All 897 tests passing (zero breakage)
8. ✅ Cross-browser validation complete (Chrome, Safari, Firefox, Edge)
9. ✅ Attack beats/weak-to lists match attacks.ts (data validation)
10. ✅ Touch targets meet WCAG (≥44px)

**Manual QA Deferred**:
- Screen reader testing (NVDA, JAWS, VoiceOver) — document in handoff
- Mobile touch testing (iOS Safari, Chrome Android) — document in handoff

---

## Next Round Preview (Round 8)

**If BL-076 completes in Round 7**:
- Implement BL-064 (Impact Breakdown UI, P1) — 6-8 hours
- Critical learning loop feature (unblocks 80% of new player confusion)

**If BL-076 still blocked**:
- Continue polish work (animations, hover effects, edge case handling)
- Stretch goal: Reusable modal component for future features
- Monitor backlog for new ui-dev tasks

---

## Summary

**Round 7 Work**: BL-068 (Counter Chart UI, P3 polish)

**Impact**: Closes "learn-by-losing" gap for counter system. New players learn rock-paper-scissors in 1-2 jousts instead of 5-10 losses. Improves player confidence and tactical decision-making.

**Risk**: 🟢 LOW — Pure UI work, comprehensive design spec, zero engine dependencies

**Estimate**: 6-10 hours (median 8 hours)

**Quality**: Production-ready with automated tests + manual QA checklist for follow-up

**Status**: Starting Phase 1 (Component Scaffolding)

---

**End of Analysis — Implementation Starting**
