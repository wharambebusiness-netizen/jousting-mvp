# Jousting MVP — Session 20 Handoff

> Generated: 2026-02-08
> Context: Continued from S19. This session ran the S20 gear overhaul orchestrator + manual cleanup.

---

## Session Summary

Three phases of work in this session:

### Phase 1: App.tsx Integration + Bug Fixes (manual, pre-orchestrator)
1. **Wired all S19 components into App.tsx**: AIDifficulty state, AIThinkingPanel on pass-result/melee-result screens, DifficultyFeedback/StrategyTips/MatchReplay on end screen, WithReasoning AI function variants
2. **Fixed counter bonus display bug** (PassResult.tsx): Hardcoded "+10"/"-10" replaced with actual scaled values (`counters.player1Bonus.toFixed(1)`)
3. **Fixed shift cost sync bug**: Added `shiftSameStanceCost`, `shiftCrossStanceCost`, `shiftSameStanceInitPenalty`, `shiftCrossStanceInitPenalty` to balance-config.ts; updated calculator.ts and basic-ai.ts to reference them
4. Deployed to gh-pages

### Phase 2: S20 Gear System Overhaul (orchestrator, 20.7 min)
Replaced old 3-slot steed gear + 6 caparison gameplay effects with new 12-slot system:
- **6 steed gear slots**: Chamfron, Barding, Saddle, Stirrups, Reins, Horseshoes
- **6 player gear slots**: Helm, Shield, Lance, Armor, Gauntlets, Melee Weapon
- **Caparison**: Cosmetic only, all 6 gameplay effects (Pennant, Shieldcloth, Thunderweave, Irongrip, Stormcloak, Banner of the Giga) removed

4 agents ran across 2 rounds:
| Agent | Time | Work Done |
|-------|------|-----------|
| engine-refactor | (prior run) | Stripped caparison from types.ts, phase-joust.ts, phase-melee.ts; added SteedGearSlot/PlayerGearSlot/PlayerGear/PlayerLoadout types |
| gear-system | 6.5 min | 6-slot steed gear (gigling-gear.ts), 6-slot player gear (player-gear.ts NEW), match.ts integration, validate/describe utilities, 3 stretch goals |
| ui-loadout | 13.3 min | Stripped caparison from all UI+AI, redesigned LoadoutScreen (12 slots), App.tsx integration, 4 stretch goals (tooltips, visual distinction, bonus summary, hover animations) |
| quality-review | 13.7 min | Property-based tests, simulation tool updated for 12-slot gear, balance analysis |

### Phase 3: Manual Cleanup (post-orchestrator)
1. Cleaned 5 files the ui-loadout agent flagged but didn't own:
   - SpeedSelect.tsx, AttackSelect.tsx, MeleeTransition.tsx, RevealScreen.tsx: Removed stale `p1Cap`/`p2Cap` Scoreboard props
   - AIThinkingPanel.tsx: Removed `reasoning.caparison` block
2. Fixed tsconfig.app.json: Excluded `src/tools/` from build (simulate.ts uses `process.argv`, Node-only)
3. Deployed updated app to gh-pages
4. Updated MEMORY.md

---

## Current State

### Test Suite: 370 passing (6 suites)
```
calculator.test.ts    116 tests
caparison.test.ts      11 tests (now phase-resolution validation tests)
gigling-gear.test.ts   48 tests
player-gear.test.ts    46 tests
match.test.ts          69 tests
playtest.test.ts       80 tests
```

### TypeScript: 0 errors (`tsc --noEmit` clean, `tsc -b` builds clean)

### Deployed: gh-pages up to date

---

## Architecture Overview

### Engine (pure TS, no UI imports)
```
src/engine/
  types.ts          — Core types: Archetype, MatchState, SteedGearSlot, PlayerGearSlot, etc.
  archetypes.ts     — 6 archetypes: charger, technician, bulwark, tactician, breaker, duelist
  attacks.ts        — Joust attacks (6) + melee attacks (6), speed types, counter tables
  calculator.ts     — Core math: effectiveStats, impactScore, guard, fatigue, counters, softCap
  phase-joust.ts    — resolveJoustPass() — joust pass resolution (no caparison params)
  phase-melee.ts    — resolveMeleeRoundFn() — melee round resolution (no caparison params)
  match.ts          — createMatch(arch1, arch2, steed1?, steed2?, player1?, player2?), submitJoustPass, submitMeleeRound
  gigling-gear.ts   — 6-slot steed gear system: GEAR_SLOT_STATS, createFullLoadout, applyGiglingLoadout, validate, describe
  player-gear.ts    — 6-slot player gear system: PLAYER_GEAR_SLOT_STATS, createFullPlayerLoadout, applyPlayerLoadout, validate, describe, getGearSummary
  balance-config.ts — All tuning constants (guard coeffs, gear ranges, AI difficulty, shift costs)
```

### Stat Pipeline
```
Base archetype stats (MOM/CTL/GRD/INIT/STA)
  → applyGiglingLoadout (adds rarity bonus + steed gear stat bonuses)
  → applyPlayerLoadout (adds player gear stat bonuses, NO rarity bonus)
  → softCap(knee=100, K=50) on MOM/CTL/GRD/INIT (NOT stamina)
  → computeEffectiveStats (speed + attack deltas)
  → fatigueFactor(currentStamina, maxStamina)
  → Final effective stats used in combat resolution
```

### Gear Slot → Stat Mappings
```
STEED GEAR:
  chamfron:   MOM (primary) / GRD (secondary)
  barding:    GRD (primary) / STA (secondary)
  saddle:     CTL (primary) / INIT (secondary)
  stirrups:   INIT (primary) / MOM (secondary)
  reins:      CTL (primary) / STA (secondary)
  horseshoes: MOM (primary) / INIT (secondary)

PLAYER GEAR:
  helm:         GRD (primary) / INIT (secondary)
  shield:       GRD (primary) / STA (secondary)
  lance:        MOM (primary) / CTL (secondary)
  armor:        STA (primary) / GRD (secondary)
  gauntlets:    CTL (primary) / INIT (secondary)
  melee_weapon: MOM (primary) / STA (secondary)
```

### Gear Rarity Stat Ranges (from balance-config.ts)
```
              primary    secondary
uncommon:     1-3        0-1
rare:         3-6        1-3
epic:         5-10       2-5
legendary:    8-15       4-8
relic:        12-20      6-12
giga:         18-30      10-18
```
Steed loadout also gets a flat `rarityBonus` added to all stats (uncommon=1, rare=2, epic=3, legendary=5, relic=7, giga=10).
Player gear does NOT add rarity bonus.

### UI Components (src/ui/)
```
SetupScreen.tsx       — Archetype picker + AI difficulty selector
LoadoutScreen.tsx     — 12-slot gear display (6 steed + 6 player), rarity selector, stats preview, re-roll
SpeedSelect.tsx       — Speed picker (Slow/Standard/Fast)
AttackSelect.tsx      — Joust attack picker (6 attacks) + melee attack picker (6 attacks)
RevealScreen.tsx      — Attack reveal + shift opportunity
PassResult.tsx        — Joust pass result breakdown
MeleeResult.tsx       — Melee round result breakdown
MeleeTransition.tsx   — Unseat → melee transition screen
MatchSummary.tsx      — End screen with gear summary, scores
CombatLog.tsx         — Expandable combat log
helpers.tsx           — Scoreboard, StatBar, StaminaBar, StanceTag, DeltaVal, PassPips
AIThinkingPanel.tsx   — Expandable AI reasoning panel (speed weights, attack scores, shift logic)
AIEndScreenPanels.tsx — DifficultyFeedback, StrategyTips, MatchReplay for end screen
```

### App.tsx Flow (10-screen state machine)
```
setup → loadout → speed → attack → reveal → pass-result
  ↑                  ↑                          ↓
  |                  └──────────────── (next pass)
  |                                             ↓ (unseat)
  |                          melee-transition → melee → melee-result
  |                                              ↑          ↓
  |                                              └── (next round)
  └──────────────────────────── end ←────────────────────┘
```

### AI System (src/ai/basic-ai.ts)
- 3 difficulty levels: easy, medium, hard
- Archetype-specific personality (ARCHETYPE_PERSONALITY)
- Pattern tracking (OpponentHistory)
- Speed-attack synergy evaluation
- WithReasoning variants: `aiPickJoustChoiceWithReasoning`, `aiPickMeleeAttackWithReasoning`
- WithCommentary variants for richer output
- No caparison logic (fully stripped in S20)

### Simulation Tool (src/tools/simulate.ts)
```
npx tsx src/tools/simulate.ts [bare|uncommon|rare|epic|legendary|relic|giga|mixed]
```
Runs AI vs AI across all archetype matchups, 200 matches each.

---

## Balance State

### Bare (no gear)
```
             WinRate   Spread
bulwark:     67.8%     ← dominant
duelist:     58.5%
tactician:   56.6%
technician:  41.1%
breaker:     39.0%
charger:     35.7%
```
Spread: 32.7 percentage points

### With Giga Gear
```
bulwark:     57.0%     ← still top but compressed
duelist:     54.2%
tactician:   53.1%
technician:  48.3%
breaker:     44.8%
charger:     42.6%
```
Spread: 14.4 percentage points (softCap working as intended)

### Key Balance Constants
- guardImpactCoeff: 0.2 (guard's influence on impact score)
- guardUnseatDivisor: 15 (guard's protection vs unseat)
- guardFatigueFloor: 0.5 (guard still works when fatigued, but reduced)
- softCap knee: 100, K: 50 (diminishing returns curve)
- shiftSameStanceCost: 5 STA, shiftCrossStanceCost: 12 STA

---

## Files Modified This Session

### By me (manual):
- `src/App.tsx` — AI reasoning integration, 12-slot gear integration
- `src/ui/PassResult.tsx` — Counter bonus bug fix
- `src/engine/balance-config.ts` — Shift cost constants
- `src/engine/calculator.ts` — Shift cost references
- `src/ai/basic-ai.ts` — Shift cost reference
- `src/ui/SpeedSelect.tsx` — Removed stale caparison props
- `src/ui/AttackSelect.tsx` — Removed stale caparison props
- `src/ui/MeleeTransition.tsx` — Removed stale caparison props
- `src/ui/RevealScreen.tsx` — Removed stale caparison props
- `src/ui/AIThinkingPanel.tsx` — Removed caparison reasoning block
- `tsconfig.app.json` — Excluded src/tools from build
- `gear-overhaul-milestones.md` — Gear overhaul design doc
- `orchestrator/orchestrator.mjs` — New agent definitions for S20
- `orchestrator/handoffs/*.md` — All 4 agent handoff files

### By orchestrator agents:
- `src/engine/types.ts` — Caparison stripped, new gear types added
- `src/engine/phase-joust.ts` — Caparison stripped
- `src/engine/phase-melee.ts` — Caparison stripped
- `src/engine/caparison.test.ts` — Rewritten as phase-resolution tests
- `src/engine/gigling-gear.ts` — Expanded to 6 slots, caparison stripped
- `src/engine/gigling-gear.test.ts` — Rewritten for 6 slots
- `src/engine/player-gear.ts` — NEW: 6 player gear slots
- `src/engine/player-gear.test.ts` — NEW: 46 tests
- `src/engine/match.ts` — Both gear systems integrated, caparison stripped
- `src/engine/match.test.ts` — 12-slot integration tests added
- `src/engine/playtest.test.ts` — Property-based tests, gear integration tests
- `src/tools/simulate.ts` — Updated for 12-slot gear with CLI modes
- `src/ui/helpers.tsx` — Caparison stripped (CaparisonBadge, trigger functions)
- `src/ui/PassResult.tsx` — Caparison triggers removed
- `src/ui/MeleeResult.tsx` — Caparison triggers removed
- `src/ui/MatchSummary.tsx` — Rewritten with 12-slot gear display
- `src/ui/LoadoutScreen.tsx` — Full redesign for 12 slots
- `src/App.tsx` — 12-slot gear integration (steed + player loadouts)
- `src/App.css` — Caparison CSS removed, gear item styles added
- `src/ai/basic-ai.ts` — Caparison AI logic removed

---

## Known Issues / TODO

### Priority 1: Breaker Guard-Penetration Mechanic
- Bulwark is still dominant (~67% bare, ~57% giga)
- Breaker archetype needs a unique mechanic to counter high-guard builds
- Proposal: Breaker ignores X% of opponent's guard during impact calculation
- Implementation location: `phase-joust.ts` resolveJoustPass() and possibly `phase-melee.ts`
- This is a formula-level change, not a stat tweak

### Priority 2: Future Features
- Gear durability/repair system
- Gigaverse economy integration (gear as NFTs/tradeable items)
- Further balance tuning if needed after Breaker mechanic

### No Known Bugs
- Counter bonus display: FIXED (uses actual scaled values)
- Shift cost sync: FIXED (references balance-config.ts constants)
- Caparison remnants: ALL CLEANED (only test assertions for non-existence remain)

---

## Git State
- Branch: master
- 3 commits ahead of origin/master (orchestrator auto-backup commits)
- 7 uncommitted files: cleanup edits from this session (SpeedSelect, AttackSelect, MeleeTransition, RevealScreen, AIThinkingPanel, tsconfig.app.json, overnight-report)
- gh-pages: deployed and up to date

---

## Orchestrator Reference
- Location: `jousting-mvp/orchestrator/`
- Run: `node orchestrator/orchestrator.mjs` from jousting-mvp/
- Handoff files: `orchestrator/handoffs/*.md` (4 agents, all all-done)
- Analysis reports: `orchestrator/analysis/quality-review-round-*.md`
- Overnight report: `orchestrator/overnight-report.md`
- Task board: `orchestrator/task-board.md`
- S20 config: 4 agents, 30 rounds max, 20min/agent timeout, 3-failure circuit breaker

---

## Key API Signatures (for future work)

```typescript
// Match creation (6 args)
createMatch(arch1: Archetype, arch2: Archetype, steedLoadout1?: GiglingLoadout, steedLoadout2?: GiglingLoadout, playerLoadout1?: PlayerLoadout, playerLoadout2?: PlayerLoadout): MatchState

// Gear creation
createFullLoadout(giglingRarity: GiglingRarity, gearRarity: GiglingRarity, rng?: () => number): GiglingLoadout
createFullPlayerLoadout(gearRarity: GiglingRarity, rng?: () => number): PlayerLoadout

// Gear application (returns new Archetype with boosted stats)
applyGiglingLoadout(archetype: Archetype, loadout?: GiglingLoadout): Archetype
applyPlayerLoadout(archetype: Archetype, loadout?: PlayerLoadout): Archetype

// AI (with reasoning)
aiPickJoustChoiceWithReasoning(player: PlayerState, lastAttack?: Attack, opponentAttack?: Attack, difficulty?: AIDifficulty): { choice: PassChoice; reasoning: AIReasoning }
aiPickMeleeAttackWithReasoning(player: PlayerState, lastAttack?: Attack, difficulty?: AIDifficulty): { attack: Attack; reasoning: AIReasoning }

// Phase resolution (NO caparison params)
resolveJoustPass(p1: Archetype, p2: Archetype, p1Choice: PassChoice, p2Choice: PassChoice, passNumber: number, p1Stamina: number, p2Stamina: number, cumulativeScore1: number, cumulativeScore2: number): PassResult
resolveMeleeRoundFn(p1: Archetype, p2: Archetype, p1Attack: Attack, p2Attack: Attack, roundNumber: number, p1Stamina: number, p2Stamina: number): MeleeRoundResult
```
