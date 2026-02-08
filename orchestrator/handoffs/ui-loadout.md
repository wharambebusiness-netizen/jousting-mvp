# UI & Loadout Agent — Handoff

## META
- status: all-done
- files-modified: src/ui/helpers.tsx, src/ui/PassResult.tsx, src/ui/MeleeResult.tsx, src/ui/MatchSummary.tsx, src/ai/basic-ai.ts, src/App.css, src/ui/LoadoutScreen.tsx, src/App.tsx
- tests-passing: true
- notes-for-others: All work DONE — primary milestone (3 passes) + all 4 stretch goals complete. 370 tests pass. **IMPORTANT for quality-review**: Several UI files NOT owned by this agent still reference removed caparison props — see "What's Left" section below. These need cleanup.

## What Was Done

### Pass 1: Strip Caparison from UI + AI (COMPLETE)
1. **helpers.tsx**: Removed `CaparisonBadge` component, `joustCapTriggered()`, `meleeCapTriggered()`, `CAP_SHORT`, `CAP_ICON` maps, and `CaparisonEffect` import. Removed `p1Cap`/`p2Cap` props from `Scoreboard` component.
2. **PassResult.tsx**: Removed all caparison trigger display (p1Trig/p2Trig, CaparisonBadge usage), removed caparison imports, removed p1Cap/p2Cap from Scoreboard calls.
3. **MeleeResult.tsx**: Same — removed caparison trigger display, badge imports, caparison props from Scoreboard.
4. **MatchSummary.tsx**: Complete rewrite — removed CaparisonBadge import, removed "Caparison Triggers" section, rewrote `LoadoutMini` to show all 12 gear slots (6 steed + 6 player) with proper labels. Added `p1PlayerLoadout`/`p2PlayerLoadout` props.
5. **basic-ai.ts**: Removed `CaparisonEffectId` import, `CAP_WEIGHTS` record, `CAP_REASONS` record, `pickCaparisonForArchetype()`, `aiPickCaparison()` export, `caparison` field from `AIReasoning` interface.
6. **App.css**: Removed all caparison CSS: `.cap-badge` (all variants), `.cap-triggers`, `.cap-trigger` (all rarity/player variants), `cap-pulse`/`cap-glow`/`cap-trigger-slide` keyframes, `.cap-summary` (all variants), `.caparison-label`, `.caparison-grid`, `.caparison-card` (all variants). Also removed caparison references from mobile media query.

### Pass 2: Redesign LoadoutScreen + App.tsx Integration (COMPLETE)
1. **LoadoutScreen.tsx**: Full redesign for 12-slot system:
   - Rarity selector kept (6 tiers), applies to all gear
   - **Steed Gear** section: 6 slots (Chamfron, Barding, Saddle, Stirrups, Reins, Horseshoes) with name, description, primary+secondary stat values
   - **Player Gear** section: 6 slots (Helm, Shield, Lance, Armor, Gauntlets, Melee Wpn) with same display pattern
   - No caparison selector (stripped)
   - Stats preview shows Base → With Gear (both steed + player gear applied, max 160)
   - Re-roll button re-rolls all 12 gear pieces
   - `onConfirm` signature updated to `(steedLoadout: GiglingLoadout, playerLoadout: PlayerLoadout) => void`
   - Uses `createFullLoadout()` and `createFullPlayerLoadout()` from gear modules
   - Separate deterministic RNG seeds for steed and player gear

2. **App.tsx**: Full integration:
   - Added `p1PlayerLoadout`/`p2PlayerLoadout` state
   - Updated `handleLoadoutConfirm` to accept both steed and player loadouts
   - AI creates both: `createFullLoadout(rarity, rarity)` and `createFullPlayerLoadout(rarity)`
   - Passes all 6 args to `createMatch(arch1, arch2, steedLoadout, aiSteedLoadout, playerLoadout, aiPlayerLoadout)`
   - Removed `aiPickCaparison` import/call
   - Clear all loadout state in `handleRematch`
   - Passes both player loadouts to `MatchSummary`
   - Preserved: difficulty state, AI reasoning state, AIThinkingPanel, DifficultyFeedback, StrategyTips, MatchReplay

3. **App.css**: Added `.gear-item__desc` styling for gear slot descriptions.

### Pass 3: Polish (COMPLETE - minimal pass)
- MatchSummary updated with 12-slot gear display in LoadoutMini (steed + knight sections)
- Stats preview max raised to 160 to accommodate 12-slot gear bonuses
- Slot descriptions displayed inline in gear items

### Stretch Goals (ALL COMPLETE)
1. **Gear tooltips**: Each stat badge (MOM, CTL, GRD, INIT, STA) on gear items and the bonus summary now shows a tooltip describing what the stat does (e.g., "Momentum — raw hitting power. Drives Impact Score."). Uses native `title` attribute.
2. **Visual distinction between steed and player gear**: Steed gear items have a left border in P1 color (`var(--p1)`), player gear items have a left border in P2 color (`var(--p2)`). CSS classes: `.gear-item--steed`, `.gear-item--player`.
3. **Total stat bonus summary**: Added `.gear-bonus-summary` bar below the stats preview showing the total gear bonus across all 12 slots broken down by stat (e.g., "MOM +14  CTL +10  GRD +12  INIT +8  STA +6"). Uses `useMemo` for efficient calculation.
4. **Gear card hover animations**: Gear items slide right (4px) and gain a shadow on hover via CSS `transition` on `.gear-item`. Smooth 150ms ease transition.

## What's Left

### Files NOT owned by this agent that need cleanup
These files still pass `p1Cap`/`p2Cap` to `Scoreboard` (props that no longer exist):
- **SpeedSelect.tsx** (lines 23-24): Remove `p1Cap={match.p1Caparison}` and `p2Cap={match.p2Caparison}`
- **AttackSelect.tsx** (lines 61-62, 97-98): Same — remove p1Cap/p2Cap from both Scoreboard calls
- **MeleeTransition.tsx** (lines 33-34): Same
- **RevealScreen.tsx** (lines 39-40): Same
- **AIThinkingPanel.tsx** (lines 25-33): Remove the `{reasoning.caparison && ...}` block (the `caparison` field was removed from `AIReasoning` interface)

These are all TypeScript-only errors (the files were already failing TS before due to missing `CaparisonEffect` type). The runtime tests all pass.

## Issues
None blocking. All 370 tests pass.

## Deferred App.tsx Changes
None — App.tsx changes were applied directly since this agent owns the file.
