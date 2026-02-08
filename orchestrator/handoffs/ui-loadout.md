# UI & Loadout Agent — Handoff

## META
- status: not-started
- files-modified:
- tests-passing: true
- notes-for-others: Multi-pass agent. Will run 3+ iterations building the new UI incrementally. Each pass reads this handoff for context from previous passes. Depends on gear-system completing ALL passes first.

## Overview
You are responsible for updating all UI components for the new 12-slot gear system (6 steed + 6 player) and making caparison cosmetic-only. You also update the AI gear selection logic and App.tsx integration.

**CRITICAL**: This is a multi-pass agent. You will be launched multiple times, each with a fresh conversation context. On each launch:
1. Read this handoff CAREFULLY to see what was done in previous passes
2. Read the "Current Pass" section to know what to do NOW
3. Do your work, run tests, then UPDATE this handoff
4. Set status to "in-progress" until ALL passes are complete, then set "all-done"

## File Ownership
You own these files (only you should edit them):
- `src/ui/LoadoutScreen.tsx`
- `src/ui/helpers.tsx`
- `src/ui/PassResult.tsx`
- `src/ui/MeleeResult.tsx`
- `src/ui/MatchSummary.tsx`
- `src/ai/basic-ai.ts`
- `src/App.tsx`
- `src/App.css`

## Dependencies
- **gear-system** must be all-done (all 4 passes complete)
- Read their handoff for the final API: createFullLoadout, createFullPlayerLoadout, applyPlayerLoadout

## MANDATORY READING (before doing ANY work)
Before writing any code, read these files:

**Architecture & Design**:
- `gear-overhaul-milestones.md` — overall design
- `orchestrator/handoffs/engine-refactor.md` — what was removed from types/engine
- `orchestrator/handoffs/gear-system.md` — new gear API (createFullLoadout, createFullPlayerLoadout, GEAR_SLOT_STATS, PLAYER_GEAR_SLOT_STATS)
- `orchestrator/task-board.md` — coordination status

**Files you're changing**:
- `src/App.tsx` — current flow (setup→loadout→speed→attack→reveal→result→end), AI reasoning integration, difficulty state
- `src/ui/LoadoutScreen.tsx` — current 3-slot gear + caparison selector
- `src/ui/helpers.tsx` — CaparisonBadge, joustCapTriggered, meleeCapTriggered, Scoreboard, StatBar
- `src/ui/PassResult.tsx` — has caparison trigger display
- `src/ui/MeleeResult.tsx` — has caparison trigger display
- `src/ui/MatchSummary.tsx` — may have caparison summary
- `src/ai/basic-ai.ts` — CAP_WEIGHTS, pickCaparisonForArchetype, aiPickCaparison, caparison field in AIReasoning
- `src/App.css` — caparison animation classes

**Files you must understand but NOT modify**:
- `src/engine/types.ts` — GiglingLoadout (6 steed slots), PlayerLoadout, SteedGearSlot, PlayerGearSlot
- `src/engine/gigling-gear.ts` — GEAR_SLOT_STATS (6 slots), createFullLoadout, sumGearStats
- `src/engine/player-gear.ts` — PLAYER_GEAR_SLOT_STATS, createFullPlayerLoadout, sumPlayerGearStats
- `src/engine/match.ts` — createMatch(arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?)
- `src/engine/balance-config.ts` — gearStatRanges, playerGearStatRanges

**Preserve these (from S19 integration)**:
- AI difficulty selector in SetupScreen.tsx (already working)
- AI reasoning panels: AIThinkingPanel, DifficultyFeedback, StrategyTips, MatchReplay
- AI reasoning state in App.tsx: aiReasoning, reasoningHistory, difficulty
- CombatLog component

---

## PASS SCHEDULE

### Pass 1: Strip Caparison from UI + AI
**Goal**: Remove all caparison gameplay references from UI and AI code
**Status when done**: in-progress

Tasks:
1. Read ALL mandatory files
2. **helpers.tsx**:
   - Remove `CaparisonBadge` component
   - Remove `joustCapTriggered()` function
   - Remove `meleeCapTriggered()` function
   - Remove `CAP_ICON` and `CAP_SHORT_NAME` maps (if they exist)
   - Remove caparison-related props from `Scoreboard` (p1Cap, p2Cap)
   - Keep: Scoreboard, StatBar, StaminaBar, StanceTag, PassPips
3. **PassResult.tsx**:
   - Remove caparison trigger display section (p1Trig/p2Trig, CaparisonBadge usage)
   - Remove joustCapTriggered/CaparisonBadge imports
   - Keep: all stats breakdown, counter bonus (uses actual values now)
4. **MeleeResult.tsx**:
   - Remove caparison trigger display
   - Remove meleeCapTriggered/CaparisonBadge imports
5. **MatchSummary.tsx**:
   - Remove any caparison summary/display
6. **basic-ai.ts**:
   - Remove `CAP_WEIGHTS` record
   - Remove `pickCaparisonForArchetype()` function
   - Remove `aiPickCaparison()` export
   - Remove `caparison` field from `AIReasoning` interface
   - Remove caparison from commentary text if referenced
   - Keep ALL other AI logic: difficulty, personality, pattern tracking, reasoning, commentary
7. **App.css**:
   - Remove caparison CSS classes (cap-trigger, cap-glow, cap-pulse, cap-trigger-slide, etc.)
   - Keep: AI panel CSS, gear grid CSS, animation CSS for victory/defeat
8. Run `npx vitest run` — verify tests still pass
9. Write updated handoff

### Pass 2: Redesign LoadoutScreen + App.tsx Integration
**Goal**: Build new 12-slot loadout screen and wire it into App.tsx
**Status when done**: in-progress

Tasks:
1. Read handoff for Pass 1 results
2. **LoadoutScreen.tsx** — Full redesign:
   - **Rarity selector**: Keep 6-tier buttons (uncommon→giga), applies to ALL gear
   - **Steed Gear section** (labeled "Steed Gear"):
     - Display all 6 slots: Chamfron, Barding, Saddle, Stirrups, Reins, Horseshoes
     - Each slot shows: slot name, description (e.g., "Head Armor"), primary stat + value, secondary stat + value
     - Import GEAR_SLOT_STATS from gigling-gear.ts for slot→stat mapping display
   - **Player Gear section** (labeled "Player Gear"):
     - Display all 6 slots: Helm, Shield, Lance, Armor, Gauntlets, Melee Weapon
     - Same display pattern as steed gear
     - Import PLAYER_GEAR_SLOT_STATS from player-gear.ts
   - **Caparison section** — COSMETIC ONLY:
     - Simple text or small visual indicator (e.g., "Caparison: Royal Blue" or just a color/pattern selector)
     - No gameplay effect description — purely visual
     - This is optional/minimal — don't over-engineer it
   - **Stats preview**: Show base archetype → steed gear bonus → player gear bonus → final stats
   - **Re-roll button**: Re-rolls all 12 gear pieces
   - **Confirm button**: Passes GiglingLoadout + PlayerLoadout to parent
   - Update `onConfirm` signature: `(steedLoadout: GiglingLoadout, playerLoadout: PlayerLoadout) => void`
   - Use `createFullLoadout(rarity, rng)` and `createFullPlayerLoadout(rarity, rng)` from gear modules
3. **App.tsx** — Integration:
   - Add `playerLoadout1` and `playerLoadout2` state (PlayerLoadout | null)
   - Update `handleLoadoutConfirm` to accept both steed and player loadouts
   - Create AI gear: both `createFullLoadout(rarity)` and `createFullPlayerLoadout(rarity)`
   - Pass both to `createMatch(arch1, arch2, steedLoadout, aiSteedLoadout, playerLoadout, aiPlayerLoadout)`
   - Remove `aiPickCaparison` call (no longer exists)
   - Remove caparison reasoning from combat log
   - Clear player loadout state in `handleRematch`
   - PRESERVE: difficulty state, AI reasoning state, AIThinkingPanel, DifficultyFeedback, StrategyTips, MatchReplay
4. Run tests + TypeScript check
5. Write updated handoff

### Pass 3: Polish + Final Review
**Goal**: Clean up, add gear display CSS, verify everything
**Status when done**: all-done

Tasks:
1. Read handoff for Pass 2 results
2. **App.css** — Add new styles:
   - Gear grid layout (2 sections side by side or stacked)
   - Slot cards with stat displays
   - Visual distinction between steed and player gear
   - Stats preview styling
   - Mobile responsive layout for 12 slots
3. **MatchSummary.tsx** — Update to show gear summary:
   - Show steed gear + player gear slot summary if loadouts exist
   - Use GEAR_SLOT_STATS and PLAYER_GEAR_SLOT_STATS for labels
4. **Scoreboard** — Remove any remaining caparison badge display
5. **Final review**:
   - Grep entire codebase for "caparison" — only cosmetic references should remain
   - Grep for "CaparisonEffect", "CaparisonInput", "CaparisonEffectId" — should be ZERO
   - Grep for "getCaparisonEffect", "createCaparison", "CAPARISON_EFFECTS" — should be ZERO
   - Run `npx vitest run` — all tests pass
   - Run `npx tsc --noEmit` — clean compile
6. Write FINAL handoff

---

## Coordination Notes
- gear-system agent creates the new gear APIs — read their handoff for exact function signatures
- engine-refactor removed all caparison types from types.ts — don't try to use them
- App.tsx currently has AI reasoning integration from S19 — PRESERVE this carefully
- SetupScreen.tsx already has difficulty selector — don't touch it
- AIThinkingPanel.tsx and AIEndScreenPanels.tsx should be untouched (they're wired in App.tsx already)
- The quality-review agent will verify no caparison references remain — be thorough

## Stretch Goals (after Pass 3)
1. Add gear tooltips showing stat descriptions (e.g., "Momentum: increases charge impact")
2. Add visual distinction between steed and player gear (different border colors, icons)
3. Add total stat bonus summary at bottom of loadout screen
4. Animate gear slot cards on hover
