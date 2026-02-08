# UI & Loadout Agent — Handoff

## META
- status: not-started
- files-modified:
- tests-passing: true
- notes-for-others: Will redesign LoadoutScreen for 12-slot gear system (6 steed + 6 player), update AI gear selection, update result screens. Depends on gear-system completing.

## Overview
You are responsible for updating all UI components for the new 12-slot gear system and making caparison cosmetic-only in the UI. You also update the AI gear selection logic.

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
- **WAIT for gear-system** agent to complete (status: complete or all-done)
- You need the final types and gear functions to build UI around

## Primary Tasks

### Task 1: Redesign LoadoutScreen.tsx

The current LoadoutScreen has:
- Rarity tier selector (6 buttons)
- 3 steed gear display (barding, chanfron, saddle)
- Caparison effect selector (6 effects + none)
- Stats preview

Redesign to:
1. **Rarity tier selector** — keep but apply to ALL gear (steed + player)
2. **Steed Gear section** (6 slots): chamfron, barding, saddle, stirrups, reins, horseshoes
   - Show each slot with its primary/secondary stat and rolled values
   - Use descriptive labels (e.g., "Chamfron — Head Armor", "Horseshoes — Traction")
3. **Player Gear section** (6 slots): helm, shield, lance, armor, gauntlets, melee weapon
   - Same display pattern as steed gear
   - Use descriptive labels (e.g., "Helm — Head Protection", "Lance — Primary Weapon")
4. **Caparison section** — COSMETIC ONLY. Just a visual/name selector, no gameplay effect description. Could be a simple dropdown or small grid of options. If you want to keep it interesting, show different caparison names/visuals but clearly label them as "Cosmetic" or "Appearance."
5. **Stats preview** — show base archetype stats, then cumulative bonuses from steed gear + player gear, then final boosted stats
6. **Re-roll button** — re-rolls all 12 gear pieces at once
7. **Confirm button** — passes both steed loadout and player loadout to App.tsx

Update `onConfirm` callback to pass both `GiglingLoadout` and `PlayerLoadout`.

### Task 2: Update App.tsx

1. **Import** `PlayerLoadout` type and `createFullPlayerLoadout` from player-gear.ts
2. **Add state**: `const [p1PlayerLoadout, setP1PlayerLoadout] = useState<PlayerLoadout | null>(null)`
3. **Add state**: `const [p2PlayerLoadout, setP2PlayerLoadout] = useState<PlayerLoadout | null>(null)`
4. **Update handleLoadoutConfirm**: Accept both steed and player loadouts from LoadoutScreen
   - Create AI player loadout: `const aiPlayerLoadout = createFullPlayerLoadout(aiRarity, rng)`
   - Pass both to `createMatch(p1Arch, p2Arch, steedLoadout, aiSteedLoadout, playerLoadout, aiPlayerLoadout)`
5. **Update handleRematch**: Clear player loadout state
6. **Remove** any remaining caparison-related state or references (aiPickCaparison call, AI caparison reasoning)

### Task 3: Update AI Gear Selection (basic-ai.ts)

Replace the caparison selection logic with steed/player gear awareness:
1. **Remove** `CAP_WEIGHTS`, `pickCaparisonForArchetype()`, `aiPickCaparison()`
2. **Remove** caparison references from commentary and reasoning types
3. **Remove** caparison field from AIReasoning interface
4. The AI doesn't need to "choose" gear — it gets random gear at the same rarity tier as the player. Just remove the caparison-specific logic.
5. If `aiPickCaparison` was used in App.tsx, it's no longer needed — the AI just gets `createFullLoadout()` and `createFullPlayerLoadout()` with random rolls.

### Task 4: Update helpers.tsx

1. **Remove** `CaparisonBadge` component
2. **Remove** `joustCapTriggered()` function
3. **Remove** `meleeCapTriggered()` function
4. **Remove** `CAP_ICON` and `CAP_SHORT_NAME` maps
5. **Remove** caparison-related props from `Scoreboard` (p1Cap, p2Cap)
6. **Keep** Scoreboard, StatBar, StaminaBar, StanceTag, PassPips — those are still used

### Task 5: Update PassResult.tsx

1. **Remove** all caparison trigger display code (the `p1Trig`/`p2Trig` section)
2. **Remove** `joustCapTriggered` import
3. **Remove** `CaparisonBadge` import
4. The rest of the pass result display (stats breakdown, counter bonus, etc.) stays as-is

### Task 6: Update MeleeResult.tsx

1. **Remove** all caparison trigger display code
2. **Remove** `meleeCapTriggered` import
3. **Remove** `CaparisonBadge` import

### Task 7: Update MatchSummary.tsx

1. **Remove** any caparison summary/display
2. If it shows loadout info, update to show steed + player gear summary instead

### Task 8: Clean up App.css

1. **Remove** caparison-specific CSS classes (cap-trigger, cap-glow, cap-pulse, etc.)
2. **Add** CSS for new gear grid layout in LoadoutScreen (two 6-slot sections)
3. Keep all AI panel CSS (ai-thinking, ai-feedback, ai-tips, match-replay) — those are still used

### Task 9: Run tests
Run `npx vitest run` and ensure all tests pass.

## Coordination Notes
- The gear-system agent creates `createFullPlayerLoadout()` and `createFullLoadout()` (expanded to 6 slots) — use those
- The engine-refactor agent removes caparison from types — don't try to use CaparisonEffect/CaparisonInput
- App.tsx has AI reasoning/thinking panel integration from S19 — preserve that (aiReasoning, reasoningHistory, AIThinkingPanel, DifficultyFeedback, StrategyTips, MatchReplay)
- The AIReasoning type in basic-ai.ts has a `caparison?` field — remove it since caparison has no gameplay reasoning anymore

## Reference
- Read `gear-overhaul-milestones.md` for design context
- Current LoadoutScreen.tsx shows the existing pattern
- Current App.tsx flow: setup → loadout → speed → attack → reveal → pass-result → ... → end
- AI reasoning types are in basic-ai.ts (SpeedReasoning, AttackReasoning, ShiftReasoning, AIReasoning)

## Stretch Goals
1. Add gear tooltips showing stat descriptions (e.g., "Momentum: increases charge impact")
2. Add visual distinction between steed and player gear sections (different border colors, icons)
3. Show total stat bonus summary at bottom of loadout screen
