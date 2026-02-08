# Jousting MVP — Session 14 Handoff

## What Was Done

### System Logic Audit (COMPLETED — from S13 handoff priority)
- Verified ALL counter tables, attack stats, speed data, archetypes against v4.1 spec — 100% correct
- Traced full data flow: archetype → gear boost → caparison adjust → combat resolution → result
- Checked edge cases: no negative stats, no division by zero, no infinite loops
- Found and fixed: stale comment in balance-config.ts, marked resolvePass() as dead code in calculator.ts
- Documented 6 intentional spec divergences (proportional fatigue, guard fatigue, softCap, CTL-scaled counters, guard-relative melee thresholds, 4 wins needed)
- Added 8 new tests: 5-pass score victory, melee exhaustion tiebreaker (3 tests), critical=2 wins, shieldcloth+shift interaction, double shift priority

### Caparison UI Display (Task #5 — COMPLETED)
- **CaparisonBadge component** in helpers.tsx: rarity-colored badges with tooltip showing full name + description
- **Scoreboard** now accepts optional `p1Cap`/`p2Cap` props — badges appear under player names on ALL match screens
- **Trigger detection helpers**: `joustCapTriggered()` and `meleeCapTriggered()` determine when effects fire each pass/round
- **Trigger notifications**: PassResult and MeleeResult show highlighted caparison triggers when effects activate
- All 8 Scoreboard instances across the app now pass caparison data

### Match Summary Improvements (Task #6 — COMPLETED)
- **Loadout display**: Shows both player and AI loadouts at match end (rarity badge, gear stats, caparison)
- **Caparison trigger summary**: Shows which effects were equipped and whether Banner was consumed
- **App.tsx stores loadouts**: `p1Loadout`/`p2Loadout` state preserved across match for summary display
- `LoadoutMini` component renders compact gear overview per player

### AI Opponent Enhancement (Task #7 — COMPLETED)
- **Archetype-weighted caparison selection**: Moved from random to heuristic selection based on archetype identity
  - Charger → Thunderweave (Fast+MOM synergy)
  - Technician → Irongrip Drape (high CTL → shift synergy)
  - Bulwark → Woven Shieldcloth (Defensive+GRD synergy)
  - Tactician → Pennant of Haste (high INIT → early advantage)
  - Breaker → Stormcloak (endurance fighter)
  - Duelist → balanced weights across all effects
- **AI reasoning logged**: Caparison choice reason appears in combat log ("AI Loadout: Charger prefers Fast speed — more Momentum")
- 20% chance of no caparison (was 30%), 80% archetype-weighted pick

## Current State
- **157 tests passing** (57 calculator + 13 match + 41 caparison + 46 gigling gear)
- Build: 254KB / 75KB gzip
- **13 UI components** in `src/ui/` (helpers.tsx has CaparisonBadge, joustCapTriggered, meleeCapTriggered)
- **AI**: basic-ai.ts now exports `aiPickCaparison(archetype)` returning `{ id, reason }`
- **App.tsx** has 12 state variables (added p1Loadout, p2Loadout), 10-screen state machine

## Files Modified This Session
| File | Change |
|------|--------|
| `src/ui/helpers.tsx` | +CaparisonBadge, +joustCapTriggered, +meleeCapTriggered, +CAP_SHORT lookup, Scoreboard accepts p1Cap/p2Cap |
| `src/ui/PassResult.tsx` | Scoreboard gets caparison props, trigger notifications section |
| `src/ui/MeleeResult.tsx` | Scoreboard gets caparison props, trigger notifications section |
| `src/ui/SpeedSelect.tsx` | Scoreboard gets caparison props |
| `src/ui/AttackSelect.tsx` | Both Scoreboards get caparison props |
| `src/ui/RevealScreen.tsx` | Scoreboard gets caparison props |
| `src/ui/MeleeTransition.tsx` | Scoreboard gets caparison props |
| `src/ui/MatchSummary.tsx` | +loadout display, +caparison summary, +LoadoutMini component |
| `src/App.tsx` | +p1Loadout/p2Loadout state, uses aiPickCaparison from basic-ai, AI reasoning in combat log |
| `src/App.css` | +cap-badge styles (6 rarities + triggered animation), +cap-triggers, +cap-summary |
| `src/ai/basic-ai.ts` | +CAP_WEIGHTS per archetype, +CAP_REASONS, +aiPickCaparison export, +pickCaparisonForArchetype |
| `src/engine/calculator.ts` | Marked resolvePass as legacy dead code (from audit) |
| `src/engine/balance-config.ts` | Updated stale comment (from audit) |
| `src/engine/match.test.ts` | +5 new test cases (from audit) |
| `src/engine/caparison.test.ts` | +3 new test cases (from audit) |

## Architecture Notes
- **Trigger detection is UI-side**: `joustCapTriggered()` and `meleeCapTriggered()` use contextual inference (speed, stance, pass number) rather than engine flags. This avoids engine changes while staying accurate.
- **Passive effects** (Irongrip, Stormcloak) always show as "triggered" since they're always active. Consider adding an "active" vs "triggered" distinction if this feels noisy.
- **Banner consumed flags** on PassResult/MeleeRoundResult are the only engine-provided trigger info. Everything else is inferred.
- **AI caparison weights** are in `basic-ai.ts:CAP_WEIGHTS` — easy to tune per archetype.

## Gotchas
- All existing gotchas from S13 still apply
- `aiPickCaparison` moved from App.tsx to basic-ai.ts — takes `Archetype` arg now
- `CaparisonEffectId` import removed from App.tsx (no longer needed there)
- `CAPARISON_EFFECTS` import removed from App.tsx (no longer needed there)
- `LoadoutMini` component in MatchSummary.tsx truncates stat names to 3-char uppercase

## TODO (Next Session)
1. **Visual polish**: caparison trigger animations could be more prominent, add icon/emoji for each effect type
2. **AI reasoning display**: Consider a dedicated "AI Thinking" panel rather than just combat log entries
3. **Deploy + playtest**: `npm run deploy` to gh-pages, test full flow with all 6 archetypes
4. Optional: gear durability/repair, Gigaverse economy integration
5. Optional: Bearer token auth for /api/game/* probing
6. Optional: AI difficulty levels (easy/medium/hard) adjusting the 70/30 optimal/random ratio
