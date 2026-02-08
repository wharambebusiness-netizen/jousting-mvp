# Quality Review — Round 1 Analysis (Gear Overhaul Session)

## Summary
Round 1 baseline assessment before gear overhaul begins. Tests pass via vitest but TypeScript compilation has **156 errors** due to types.ts being pre-updated with new gear types while the rest of the codebase still uses old types.

## Test Results
- **vitest**: 327 tests, 5 suites, ALL PASSING
- **tsc --noEmit (tsconfig.app.json)**: 156 errors (see breakdown below)

Note: vitest uses esbuild for TS transpilation, which skips type checking. Tests run fine despite type errors. The `npx tsc --noEmit` (composite) also reports 0 errors due to caching — only the explicit `npx tsc --noEmit -p tsconfig.app.json` reveals the real state.

## Pre-existing Working Tree Changes
The orchestrator's prior session already applied several changes that are uncommitted:

### types.ts (engine-refactor scope)
Already done:
- Removed `CaparisonEffectId`, `CaparisonEffect`, `CaparisonInput` types
- Removed `p1BannerConsumed`/`p2BannerConsumed` from PassResult and MeleeRoundResult
- Removed `p1Caparison`/`p2Caparison`/`p1BannerUsed`/`p2BannerUsed` from MatchState
- Removed old `GearSlot` type (included 'caparison')
- Added `SteedGearSlot` (6 slots), `PlayerGearSlot` (6 slots)
- Added `PlayerGear`, `PlayerLoadout` interfaces
- Updated `GiglingGear.slot` to `SteedGearSlot`
- Updated `GiglingLoadout` to use `chamfron` (not `chanfron`) and added 3 new slots

### balance-config.ts (engine-refactor scope)
- Added shift cost constants (`shiftSameStanceCost`, `shiftCrossStanceCost`, etc.)

### calculator.ts (engine-refactor scope)
- `applyShiftCost()` now uses BALANCE constants instead of hardcoded 5/12

### basic-ai.ts (ui-loadout scope)
- Shift evaluation now uses `BALANCE.shiftSameStanceCost` instead of hardcoded

### PassResult.tsx (ui-loadout scope)
- Fixed bug: counter bonus display now shows actual value instead of hardcoded "+10"/"-10"

### App.tsx (shared)
- Added AI reasoning integration (`aiPickJoustChoiceWithReasoning`, `aiPickMeleeAttackWithReasoning`)
- Added difficulty state, AIThinkingPanel imports
- Still references `aiPickCaparison` (will need removal)

## TypeScript Error Breakdown (156 errors, by file)

| File | Errors | Owner | Notes |
|------|--------|-------|-------|
| caparison.test.ts | 48 | engine-refactor | All caparison test references broken |
| gigling-gear.test.ts | 23 | gear-system | chanfron->chamfron, caparison refs |
| match.ts | 18 | gear-system | CaparisonInput import, capInput(), banner tracking |
| MatchSummary.tsx | 17 | ui-loadout | p1/p2Caparison, chanfron refs |
| PassResult.tsx | 14 | ui-loadout | p1/p2Caparison, p1/p2BannerConsumed |
| MeleeResult.tsx | 14 | ui-loadout | p1/p2Caparison, p1/p2BannerConsumed |
| gigling-gear.ts | 9 | gear-system | CaparisonEffectId import, caparison slot |
| AttackSelect.tsx | 4 | ui-loadout | p1/p2Caparison on MatchState |
| SpeedSelect.tsx | 2 | ui-loadout | p1/p2Caparison on MatchState |
| RevealScreen.tsx | 2 | ui-loadout | p1/p2Caparison on MatchState |
| MeleeTransition.tsx | 2 | ui-loadout | p1/p2Caparison on MatchState |
| LoadoutScreen.tsx | 2 | ui-loadout | chanfron->chamfron |
| helpers.tsx | 1 | ui-loadout | CaparisonBadge type ref |
| playtest.test.ts | 1 | quality-review | CaparisonEffectId import |
| basic-ai.ts | 1 | ui-loadout | CaparisonEffectId import |

## Coordination Risks Identified

### RISK 1: types.ts Already Applied -- Agent Ordering Issue
The engine-refactor agent's primary task (types.ts changes) is **already done** in the working tree. This means:
- engine-refactor needs to focus on phase-joust.ts, phase-melee.ts, balance-config.ts, and caparison.test.ts
- gear-system is listed as blocked on engine-refactor, but types.ts is already ready
- If engine-refactor doesn't clean up ALL its files in round 1, gear-system may be blocked unnecessarily

### RISK 2: gigling-gear.ts Still Has Old Code
`gigling-gear.ts` still uses `'chanfron'` (old spelling) and has caparison-related code (CAPARISON_EFFECTS, createCaparison, getCaparisonEffect). The gear-system agent owns this file and needs to:
- Rename chanfron->chamfron
- Delete CAPARISON_EFFECTS, createCaparison, getCaparisonEffect
- Expand from 3->6 slots
But some of this cleanup overlaps with what engine-refactor is stripping from types.ts.

### RISK 3: playtest.test.ts Imports CaparisonEffectId (MY FILE)
My file `playtest.test.ts` imports `CaparisonEffectId` from types.ts. This type no longer exists. I need to update my test file to remove caparison references once the engine-refactor agent finishes stripping caparison from the engine files. Currently the tests still pass because vitest doesn't type-check, but the import is broken.

### RISK 4: App.tsx Has Multiple Owners' Concerns
App.tsx has been modified with AI reasoning integration but still references `aiPickCaparison`. The ui-loadout agent owns this file but the change touches both AI and loadout concerns. The "Deferred App.tsx Changes" protocol should handle this but worth monitoring.

### RISK 5: simulate.ts Uses Old AI Functions
`src/tools/simulate.ts` imports `aiPickJoustChoice` and `aiPickMeleeAttack` -- these were renamed to `*WithReasoning` variants in the App.tsx diff. The old function names may still exist as exports in basic-ai.ts, but if they're removed, simulate.ts will break.

## My Files -- Current State

### playtest.test.ts (65 tests)
- Uses `CaparisonEffectId` type (BROKEN in tsc, works in vitest)
- Sections 2 and 3 test all caparison effects in full matches -- will need rewriting
- Section 1 (all archetype pairs) works fine without caparison
- 1 TypeScript error: import of removed type

### match.test.ts (59 tests)
- No TypeScript errors currently
- Tests don't reference caparison directly
- Clean baseline -- good candidate for adding new gear integration tests

## Action Items for Next Round

1. **Wait for engine-refactor** to complete phase-joust.ts and phase-melee.ts cleanup
2. **After engine-refactor completes**: Update playtest.test.ts to remove caparison test sections (sections 2, 3) and replace with gear-based tests
3. **After gear-system completes**: Add integration tests for 12-slot gear system in match.test.ts
4. **Monitor** whether the pre-applied types.ts changes cause confusion for other agents

## Baseline Metrics
- Test count: 327 (5 suites)
- TypeScript errors: 156 (expected -- types.ts updated ahead of other files)
- Test files I own: playtest.test.ts (65 tests), match.test.ts (59 tests)
- Vitest duration: ~390ms
