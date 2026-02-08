# Jousting MVP — Session 17 Handoff (Full System Review + Doc Fixes)

## What Was Done

### Full System Review
Comprehensive audit of the entire codebase — engine, balance, AI, gear, caparisons, UI, and tests. All 6 agents reviewed in parallel. **No critical bugs found.** System is production-ready.

### Doc Drift & Dead Code Fixes

1. **`calculator.ts`** — Marked `resolvePass()` with proper JSDoc `@deprecated` tag pointing to `resolveJoustPass()` in phase-joust.ts. Was just an informal comment before.

2. **`joust-melee-v4.1.md`** — Fixed two stale formulas:
   - Fatigue formula: changed flat `/40` to `/(Max_Stamina x Fatigue_Ratio)` with note that threshold = maxSTA x 0.8
   - Guard formula: changed "Guard is NOT fatigued" to actual `Guard_Fatigue_Factor = 0.5 + 0.5 x FF`

3. **`jousting-handoff-s11.md`** — Fixed 4 stale values from pre-S13 rebalance:
   - Chanfron secondary: Guard → Stamina
   - Rarity bonuses: 0/2/5/8/12/15 → 1/3/5/7/10/13
   - Gear stat ranges: old wide ranges → compressed S13 ranges
   - Guard double-sourcing note → Stamina double-sourcing note

### Review Findings Summary

**Engine (15 files):** Clean, modular, all formulas correct. Counter tables symmetric. Stance triangle correct (Agg>Def>Bal>Agg). Soft cap, fatigue, guard fatigue all working as designed.

**Balance:** 6 archetypes (290-300 stat totals), S15 rebalance correctly applied. No dominated attacks, no uncounterable attacks.

**Gear:** 3 stat slots + 1 effect slot. 6 rarity tiers with compressed ranges. Soft cap only triggers at Giga extremes (Bulwark GRD 103→100.9).

**Caparisons (6):** All trigger conditions correct. Banner consumption tracked properly. Shieldcloth correctly uses final attack stance. Stormcloak correctly adjusts archetype.stamina not currentStamina.

**AI:** 70/30 optimal/random split. Archetype-weighted decisions for speed, attack, shift, caparison. Stance triangle correct.

**Tests:** 222 passing (57 calculator + 13 match + 41 caparison + 46 gear + 65 playtest).

**AI Improvement Opportunities (non-blocking):**
- Stamina thresholds are absolute (STA < 30) not percentage-based
- Speed and attack selection are independent (no synergy awareness)
- Shift evaluation only considers counters, not stat improvements
- No multi-move pattern prediction

**Testing Gaps (non-blocking):**
- No AI unit tests (validated indirectly through playtests)
- No React component tests
- Unseat mechanics under-tested (only ~5 tests)

## Project Architecture

### Directory Structure
```
jousting-mvp/
├── src/
│   ├── App.tsx              # 10-screen state machine, 12 state variables
│   ├── App.css
│   ├── engine/              # Pure TS, zero UI imports (portable to Unity C#)
│   │   ├── types.ts         # All interfaces/enums
│   │   ├── archetypes.ts    # 6 archetypes with 5 stats each
│   │   ├── attacks.ts       # 6 joust + 6 melee attacks with counter tables
│   │   ├── balance-config.ts # All tuning constants (BALANCE object)
│   │   ├── calculator.ts    # Core formulas (fatigue, softCap, impact, counters, shifts)
│   │   ├── phase-joust.ts   # resolveJoustPass() — the real joust resolver
│   │   ├── phase-melee.ts   # resolveMeleeRound()
│   │   ├── match.ts         # Match state machine (createMatch, submitJoustPass, submitMeleeRound)
│   │   ├── gigling-gear.ts  # Gear generation (createStatGear, createFullLoadout)
│   │   ├── calculator.test.ts
│   │   ├── match.test.ts
│   │   ├── caparison.test.ts
│   │   ├── gigling-gear.test.ts
│   │   └── playtest.test.ts # Full match simulations
│   ├── ai/
│   │   └── basic-ai.ts     # Heuristic AI (70/30 optimal/random)
│   └── ui/                  # 12 React components
│       ├── helpers.tsx      # CaparisonBadge, shared UI helpers
│       ├── SetupScreen.tsx
│       ├── LoadoutScreen.tsx
│       ├── SpeedSelect.tsx
│       ├── AttackSelect.tsx
│       ├── RevealScreen.tsx
│       ├── PassResult.tsx
│       ├── MeleeTransition.tsx
│       ├── MeleeResult.tsx
│       ├── MatchSummary.tsx
│       └── CombatLog.tsx
├── vite.config.ts           # base: './' for gh-pages
├── package.json
└── jousting-handoff-s*.md   # Session handoffs (s7 through s17)
```

### UI Flow (10 screens)
```
setup → loadout → speed → attack → reveal → pass-result
                    ↑                            │
                    └────────────────────────────-┘ (next pass)
                                                 │
                                                 ↓ (after 5 passes or unseat)
                                          melee-transition → melee → melee-result → end
                                                               ↑          │
                                                               └──────────┘ (next round)
```

### App.tsx State Variables (12)
```typescript
match: MatchState | null
screen: Screen
p1Archetype: Archetype | null
p2Archetype: Archetype | null
playerSpeed: SpeedType
playerAttack: Attack | null
aiChoice: PassChoice | null
lastPassResult: PassResult | null
lastMeleeResult: MeleeRoundResult | null
combatLog: string[][]
p1Loadout: GiglingLoadout | undefined
p2Loadout: GiglingLoadout | undefined
```

## Archetype Stats
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      70   45   55    60   60  = 290
technician:   50   70   55    60   55  = 290
bulwark:      55   55   75    45   65  = 295
tactician:    55   65   50    75   55  = 300
breaker:      65   60   55    55   60  = 295
duelist:      60   60   60    60   60  = 300
```

## Counter Tables

### Joust (6 attacks, triangle: Agg > Def > Bal > Agg)
```
coupFort (Agg):       beats [PdL]           beatenBy [CEP, CdL]        (1/2)
brisDeGarde (Agg):    beats [PdL, CdP]      beatenBy [CdL]             (2/1)
courseDeLance (Bal):  beats [CF, BdG]        beatenBy [PdL]             (2/1)
coupDePointe (Bal):   beats [PdL]            beatenBy [BdG, CEP]        (1/2)
portDeLance (Def):    beats [CdL, CEP]       beatenBy [CF, BdG, CdP]   (2/3)
coupEnPassant (Def):  beats [CF, CdP]        beatenBy [PdL]             (2/1)
```

### Melee (6 attacks)
```
overhandCleave (Agg):   beats [GH, RS]       beatenBy [MC, PT]          (2/2)
feintBreak (Agg):       beats [PT]           beatenBy [RS]              (1/1)
measuredCut (Bal):      beats [OC, RS]       beatenBy [GH]              (2/1)
precisionThrust (Bal):  beats [OC]           beatenBy [FB, RS]          (1/2) [GRD=0]
guardHigh (Def):        beats [MC]           beatenBy [OC]              (1/1)
riposteStep (Def):      beats [FB, PT]       beatenBy [OC, MC]          (2/2)
```

## Key Formulas
- **Impact**: `effMOM * 0.5 + accuracy * 0.4 - oppEffGRD * 0.3`
- **Accuracy**: `effCTL + effINIT/2 - oppEffMOM/4 + counterBonus`
- **Counter bonus**: `4 + winnerEffCTL * 0.1` (=10 at CTL 60)
- **Unseat threshold**: `20 + defEffGRD/10 + defEffSTA/20`
- **Fatigue**: `currentSTA / (maxSTA * 0.8)`, clamped [0,1]
- **Soft cap**: knee=100, K=50; `knee + excess * K / (excess + K)` above knee
- **Guard fatigue**: `0.5 + 0.5 * fatigueFactor` (floor at 50%)
- **Melee hit**: `3 + defGRD * 0.031`, crit: `15 + defGRD * 0.154`

## Gear System
- **Slot mapping**: barding=GRD/STA, chanfron=MOM/STA, saddle=CTL/INIT
- **Rarity bonuses (flat per stat)**: uncommon=1, rare=3, epic=5, legendary=7, relic=10, giga=13
- **Gear ranges (Giga)**: primary [10,15], secondary [6,9]
- **Max possible**: Bulwark GRD 75 + 13 + 15 = 103 → softCap 100.9

## Caparison Effects (6)
| Effect | Rarity | Value | Phase | Trigger |
|--------|--------|-------|-------|---------|
| Pennant of Haste | Uncommon | +2 INIT | Joust | Pass 1 only |
| Woven Shieldcloth | Rare | +3 GRD | Both | Final attack = Defensive |
| Thunderweave | Epic | +4 MOM | Joust | Speed = Fast |
| Irongrip Drape | Legendary | -5 threshold | Joust | Passive (easier shifts) |
| Stormcloak | Relic | -0.05 fatigue ratio | Both | Passive (delayed fatigue) |
| Banner of the Giga | Giga | x1.5 counter | Both | First counter win only |

## AI Behavior
- **Speed**: archetype-weighted (MOM>=65→Fast, GRD>=65→Slow, STA<=15→emergency Slow)
- **Attack**: scored by affinity + counter prediction + stance triangle + stamina cost
- **Shift**: evaluates post-reveal, shifts only if score > 5
- **Caparison**: archetype-weighted (`aiPickCaparison(archetype)`), 20% chance no caparison
- **70/30 mix**: 70% optimal, 30% random

## Gotchas / Pitfalls
- Counter triangle: Agg > Def > Bal > Agg (NOT Agg > Bal > Def)
- Port de Lance beats Coup en Passant (S15 fix)
- Precision Thrust deltaGuard = 0 (was -5, S15 fix)
- Guard High beats Measured Cut (not vice versa)
- `fatigueFactor()` requires maxStamina as 2nd arg
- `resolveCounters()` takes effective CTL values
- `resolveJoustPass()` and `resolveMeleeRoundFn()` take optional CaparisonInput params
- Stormcloak adjusts archetype.stamina for fatigue, NOT currentStamina
- Shieldcloth applies based on FINAL attack stance (after shift)
- Chanfron secondary is STAMINA not guard
- `resolvePass()` in calculator.ts is **@deprecated** — use phase-joust.ts
- `aiPickCaparison()` in basic-ai.ts, takes Archetype arg, returns `{ id, reason }`

## Files Modified This Session
- `src/engine/calculator.ts` — Added @deprecated JSDoc to resolvePass()
- `joust-melee-v4.1.md` — Fixed fatigue formula (flat 40 → percentage-based) + guard fatigue
- `jousting-handoff-s11.md` — Fixed rarity bonuses, gear ranges, chanfron secondary, guard note
- `jousting-handoff-s17.md` — This file

## TODO (Next Session)
1. **Visual polish**: caparison trigger animations, icons/emoji per effect type
2. **AI reasoning display**: dedicated "AI Thinking" panel vs just combat log entries
3. **Browser playtest**: manually test full flow with all 6 archetypes x all 6 caparisons
4. **AI improvements**: percentage-based stamina thresholds, speed-attack synergy awareness
5. Optional: AI difficulty levels (easy/medium/hard — adjust 70/30 ratio)
6. Optional: Breaker unique mechanic (guard-shatter bonus? anti-defensive counter bonus?)
7. Optional: AI unit tests, React component tests, more unseat coverage
8. Optional: gear durability/repair, Gigaverse economy integration
