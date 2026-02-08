## META
- status: in-progress
- files-modified: orchestrator/analysis/quality-review-round-1.md
- tests-passing: true
- notes-for-others: IMPORTANT: types.ts changes are already applied in working tree (from prior session). tsc reports 156 errors because types.ts removed caparison types but other files still import them. Vitest passes because esbuild skips type checking. Engine-refactor should focus on phase-joust.ts, phase-melee.ts, caparison.test.ts, and balance-config.ts cleanup (types.ts is DONE). Gear-system: gigling-gear.ts still has chanfron (old spelling) and all caparison code. simulate.ts still imports old AI function names (aiPickJoustChoice, aiPickMeleeAttack) -- may break if those exports are removed.

## What Was Done (Round 1)
1. Ran full test suite: **327 tests, ALL PASSING** (5 suites, 390ms)
2. Ran TypeScript check: **156 errors** (expected -- types.ts updated ahead of other files)
3. Reviewed all 3 other agent handoffs for coordination issues
4. Catalogued all caparison references across the codebase (18+ files affected)
5. Identified 5 coordination risks (see analysis report)
6. Documented per-file error counts with responsible agent assignments
7. Wrote detailed analysis: `orchestrator/analysis/quality-review-round-1.md`

## What's Left

### After engine-refactor completes:
- Verify caparison effects fully stripped from phase-joust.ts and phase-melee.ts
- Verify resolveJoustPass/resolveMeleeRoundFn work without caparison params
- Update MY file playtest.test.ts: remove CaparisonEffectId import and caparison test sections (sections 2, 3)
- Replace removed tests with gear-based full match simulations
- Verify caparison.test.ts is properly rewritten

### After gear-system completes:
- Verify 6-slot steed gear creates correct stat bonuses
- Verify player gear creates correct stat bonuses
- Verify combined steed + player gear in match creation
- Add integration tests in match.test.ts:
  - Full match with both steed and player loadouts at various rarities
  - All 12 slots empty (no gear)
  - Mixed rarities across slots
  - Maximum stat stacking (all Giga gear) -- verify softCap keeps things in check
  - Single slot occupied, rest empty

### After ui-loadout completes:
- Verify no caparison references remain in any UI file
- Verify basic-ai.ts no longer references caparison
- Verify no orphaned CSS classes
- Full integration check: compile, test, no warnings

### Balance verification (after all agents complete):
- Run simulation tool: `npx tsx src/tools/simulate.ts`
- Verify win rates reasonable (no archetype > 70% or < 30%)
- Update simulation tool if needed for new gear system

## Issues
1. **156 TypeScript errors**: Expected -- types.ts was updated ahead of other files. Each agent will fix their owned files.
2. **playtest.test.ts**: My file imports removed `CaparisonEffectId` type -- will fix after engine-refactor completes and I know the new API shape.
3. **simulate.ts fragility**: May break when AI function names change. Not my file to fix but worth tracking.

## File Ownership
- `src/engine/playtest.test.ts` (integration/playtest tests)
- `src/engine/match.test.ts` (match-level tests -- test additions only)
- `orchestrator/analysis/quality-review-*.md` (reports)

## Stretch Goals
1. Add performance regression test (ensure match creation + 5 passes runs under X ms)
2. Add property-based tests (random gear at all rarities, verify no crashes)
3. Update simulation tool if needed for new gear system

## Context: What's Changing
The gear system is being overhauled:
- **Old**: 3 steed gear slots (barding, chanfron, saddle) + 6 caparison gameplay effects
- **New**: 6 steed gear slots (chamfron, barding, saddle, stirrups, reins, horseshoes) + 6 player gear slots (helm, shield, lance, armor, gauntlets, melee_weapon) + cosmetic-only caparison
- Read `gear-overhaul-milestones.md` for full design

## IMPORTANT Rules
- NEVER modify engine code (calculator.ts, phase-joust.ts, phase-melee.ts, match.ts)
- NEVER modify UI code
- ONLY add new test cases (append to existing test files) or write quality reports
- ALWAYS run the full test suite after adding tests
- If your new test reveals a bug, document it in handoff, don't try to fix it
