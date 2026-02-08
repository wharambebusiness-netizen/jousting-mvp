# Jousting MVP — Session 16 Handoff (Deploy + Playtest Suite)

## What Was Done

### Session 15 recap (same conversation, pre-compaction)
Full combat logic review — found and fixed 5 significant issues:
1. **Joust counter table**: Port de Lance now beats Coup en Passant (CEP had zero counters)
2. **Precision Thrust**: deltaGuard -5 → 0 (was strictly dominated by Measured Cut)
3. **Charger STA**: 50 → 60 (total 280 → 290, can sustain 3 aggressive passes)
4. **Breaker**: GRD 50→55, STA 50→60 (total 280 → 295)
5. **AI stance triangle**: was completely INVERTED — fixed in both joust and melee

### Session 16: Deploy + Comprehensive Playtest Suite

#### Deployed to GitHub Pages
- Built: 254KB / 75KB gzip
- Deployed via `npm run deploy` → gh-pages
- Base set to `'./'` in vite.config.ts

#### New Playtest Test Suite (65 tests)
**File:** `src/engine/playtest.test.ts`
- 36 archetype matchup tests (full 6×6 grid, all complete to MatchEnd)
- 12 single-caparison tests (6 effects × 2 player positions)
- 4 dual-caparison tests (both players with different caparisons)
- 4 counter table symmetry verification tests (joust + melee)
- 3 archetype stat verification tests (Charger STA, Breaker GRD/STA, totals 290-300)
- 2 Precision Thrust verification tests (deltaGuard=0, higher CTL than MC)
- 1 Charger 3-pass endurance test (Fast+CF × 3, stamina 60→35→10→0)
- 2 Breaker durability tests (stat total 295, survives 5 standard passes)
- 1 geared unseat + melee flow test (Giga gear, force low-STA unseat → melee)

#### Test Totals: 222 passing
- 57 calculator tests (`calculator.test.ts`)
- 13 match tests (`match.test.ts`)
- 41 caparison tests (`caparison.test.ts`)
- 46 gigling gear tests (`gigling-gear.test.ts`)
- 65 playtest tests (`playtest.test.ts`) — NEW

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
│   │   └── playtest.test.ts # Full match simulations (NEW in S16)
│   ├── ai/
│   │   └── basic-ai.ts     # Heuristic AI (70/30 optimal/random)
│   └── ui/                  # 11 React components
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
└── jousting-handoff-s*.md   # Session handoffs (s5 through s16)
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
match: MatchState | null          // Core engine state
screen: Screen                    // UI screen ('setup' | 'loadout' | ... | 'end')
p1Archetype: Archetype | null     // Player 1 chosen archetype
p2Archetype: Archetype | null     // Player 2 / AI archetype
playerSpeed: SpeedType            // Current speed selection
playerAttack: Attack | null       // Current attack selection
aiChoice: PassChoice | null       // AI's full choice (speed + attack + optional shift)
lastPassResult: PassResult | null // Last joust pass result (for display)
lastMeleeResult: MeleeRoundResult | null // Last melee round result
combatLog: string[][]             // Combat log entries grouped by pass/round
p1Loadout: GiglingLoadout | undefined    // Player 1 gear + caparison
p2Loadout: GiglingLoadout | undefined    // Player 2 / AI gear + caparison
```

## Archetype Stats (Post-S15 Rebalance)
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      70   45   55    60   60  = 290
technician:   50   70   55    60   55  = 290
bulwark:      55   55   75    45   65  = 295
tactician:    55   65   50    75   55  = 300
breaker:      65   60   55    55   60  = 295
duelist:      60   60   60    60   60  = 300
```
Spread: 290–300 (3.3%)

## Counter Tables

### Joust (6 attacks)
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
- **Soft cap**: knee=100, `knee + (raw - knee) * 0.1` above knee
- **Guard fatigue floor**: 0.5 (guard drops to 50% at 0 stamina, not 0%)

## Gear System
- **Slot mapping**: barding=GRD/STA, chanfron=MOM/STA, saddle=CTL/INIT
- **Rarity bonuses**: uncommon=1, rare=3, epic=5, legendary=7, relic=10, giga=13
- **Gear ranges** (Giga): primary [10,15], secondary [6,9]
- **Max possible**: Bulwark GRD 75 + 13 + 15 = 103 → softCap effective 100.9

## Caparison Effects (6)
- **pennant_of_haste**: +INIT on pass 1
- **woven_shieldcloth**: +GRD when playing Defensive stance
- **thunderweave**: +MOM when playing Fast speed
- **irongrip_drape**: shift CTL threshold reduced
- **stormcloak**: delays fatigue (adjusts archetype.stamina, not currentStamina)
- **banner_of_the_giga**: bonus damage on first counter win (once per match)

## AI Behavior (`basic-ai.ts`)
- **Speed**: archetype-weighted (high MOM→Fast, high GRD→Slow, low STA→emergency Slow)
- **Attack**: scored by stat affinity + counter potential + stance triangle + stamina cost
- **Stance triangle**: Agg > Def > Bal > Agg (FIXED in S15 — was inverted)
- **Shift**: evaluates post-reveal, shifts only if clearly better (score > 5)
- **Caparison**: archetype-weighted selection (`aiPickCaparison(archetype)`)
- **70/30 mix**: 70% optimal, 30% random for unpredictability

## Gotchas / Pitfalls
- Counter table: Agg > Def > Bal > Agg (NOT the other way around)
- **Port de Lance beats Coup en Passant** (added S15)
- **Precision Thrust deltaGuard = 0** (was -5, fixed S15)
- Guard High beats Measured Cut (not vice versa)
- `fatigueFactor()` requires maxStamina as 2nd arg
- `resolveCounters()` takes effective CTL values
- `resolveJoustPass()` and `resolveMeleeRoundFn()` take optional CaparisonInput params
- **Stormcloak adjusts archetype.stamina** for fatigue, NOT currentStamina
- **Shieldcloth applies based on FINAL attack stance** (after shift)
- **Chanfron secondary is STAMINA** not guard
- `resolvePass()` in calculator.ts is **dead code** — superseded by phase-joust.ts
- Playtest tests use `makeRng(seed)` for deterministic gear generation
- Playtest `simulateMatch()` handles melee transition gracefully (while loop checks phase)

## Files Modified This Session
- `src/engine/attacks.ts` — counter table (PdL beats CEP) + PT guard fix
- `src/engine/archetypes.ts` — Charger/Breaker stat rebalance
- `src/ai/basic-ai.ts` — stance triangle correction
- `src/engine/calculator.test.ts` — updated worked examples for Charger STA 60
- `src/engine/match.test.ts` — updated stamina/direction expectations
- `src/engine/playtest.test.ts` — **NEW** comprehensive playtest suite (65 tests)
- `jousting-handoff-s15.md` — S15 handoff (combat review details)
- `jousting-handoff-s16.md` — this file

## TODO (Next Session)
1. **Visual polish**: caparison trigger animations, icons/emoji per effect type
2. **AI reasoning display**: dedicated "AI Thinking" panel vs just combat log entries
3. **Browser playtest**: manually test full flow with all 6 archetypes × all 6 caparisons
4. Optional: AI difficulty levels (easy/medium/hard — adjust 70/30 ratio)
5. Optional: Breaker unique mechanic (guard-shatter bonus? anti-defensive counter bonus?)
6. Optional: gear durability/repair, Gigaverse economy integration
