# Jousting MVP — System Overview

> Deterministic two-phase tactical combat game.
> Vite + React 19 + TypeScript. Engine is pure TS with zero UI deps.
> 65 tests passing. Deployed to GitHub Pages.

---

## Game in 30 Seconds

Two knights duel in two phases:

1. **Joust** (mounted, up to 5 passes) — each pass both players secretly pick a speed + attack, reveal simultaneously, optionally shift to a different attack, then the system resolves impact scores deterministically. If one knight is unseated, go to melee. After 5 passes, highest cumulative score wins (or melee on tie).

2. **Melee** (on foot) — simultaneous attack selection each round. First to 4 round wins or 1 critical hit wins the match. No speed, no shifts.

There are no dice. Every outcome is computed from stats, choices, and counter matchups.

---

## Architecture

```
src/engine/          ← Pure TS, no React, no side effects
├── types.ts         ← All enums, interfaces, type definitions
├── balance-config.ts← Single object with every tuning constant
├── attacks.ts       ← 6 joust attacks, 6 melee attacks, 3 speeds (static data)
├── archetypes.ts    ← 6 knight archetypes (static data)
├── calculator.ts    ← All math: stats, fatigue, accuracy, impact, unseat, counters
├── phase-joust.ts   ← Resolves one joust pass (calls calculator functions)
├── phase-melee.ts   ← Resolves one melee round (calls calculator functions)
└── match.ts         ← State machine: phase transitions, win conditions

src/ai/
└── basic-ai.ts      ← Heuristic AI (70% weighted-optimal, 30% random)

src/ui/              ← React components, one per screen
├── helpers.tsx       ← Shared components (StatBar, StaminaBar, Scoreboard, etc.)
├── SetupScreen.tsx   ← Archetype picker
├── SpeedSelect.tsx   ← Speed card selection
├── AttackSelect.tsx  ← Attack card selection (joust + melee variants)
├── RevealScreen.tsx  ← Simultaneous reveal + optional shift
├── PassResult.tsx    ← Joust pass breakdown
├── MeleeTransition.tsx ← Unseat narrative + carryover penalties
├── MeleeResult.tsx   ← Melee round outcome
├── MatchSummary.tsx  ← Final results + full match recap
└── CombatLog.tsx     ← Collapsible running log

src/App.tsx          ← Root component, screen router, glues engine + AI + UI
```

**Dependency flow:** `types` → `attacks/archetypes/balance-config` → `calculator` → `phase-joust/phase-melee` → `match` → `App.tsx`

---

## Core Stats (per knight)

| Stat | Range | Role | Fatigues? |
|------|-------|------|-----------|
| Momentum (MOM) | 45–70 | Impact force, evasion (harder to target) | Yes |
| Control (CTL) | 45–70 | Precision, accuracy, shift eligibility | Yes |
| Guard (GRD) | 50–75 | Damage absorption, unseat resistance | Partially (floor 50%) |
| Initiative (INIT) | 45–75 | Timing, shift priority, accuracy boost | No |
| Stamina (STA) | 50–65 | Endurance pool, everything degrades when low | N/A (it IS the resource) |

---

## The 6 Archetypes

| Name | MOM | CTL | GRD | INIT | STA | Identity |
|------|-----|-----|-----|------|-----|----------|
| Charger | 70 | 45 | 55 | 60 | 50 | Glass cannon — wins fast or fades |
| Technician | 50 | 70 | 55 | 60 | 55 | Shift master — reads and reacts |
| Bulwark | 55 | 55 | 75 | 45 | 65 | Tank — outlasts on attrition |
| Tactician | 55 | 65 | 50 | 75 | 55 | Tempo control — shift priority |
| Breaker | 65 | 60 | 50 | 55 | 50 | Anti-tank — counters Bulwark |
| Duelist | 60 | 60 | 60 | 60 | 60 | Generalist — adaptable |

Raw totals are intentionally unequal (280–300) because stats have different per-point efficiency. Weighted totals converge to ~94.

---

## Key Formulas (all in `calculator.ts`)

### Effective Stats
```
rawMOM = archetype.MOM + speed.deltaMOM + attack.deltaMOM + carryover
effMOM = softCap(rawMOM) × fatigueFactor

rawCTL = archetype.CTL + speed.deltaCTL + attack.deltaCTL + carryover
effCTL = softCap(rawCTL) × fatigueFactor

rawGRD = archetype.GRD + attack.deltaGRD + carryover
effGRD = softCap(rawGRD) × guardFatigueFactor    // guard partially fatigues

effINIT = archetype.INIT + speed.deltaINIT − shiftPenalty   // no cap, no fatigue
```

### Soft Cap
```
softCap(v) = v                                     if v ≤ 100
           = 100 + (v − 100) × 50 / (v − 100 + 50)  if v > 100
```
Currently only affects Charger at Fast+CoupFort (MOM 110 → 108.33). Ready for gear inflation.

### Fatigue
```
fatigueFactor(stamina, maxStamina) = min(1.0, stamina / (maxStamina × 0.8))
guardFatigueFactor(ff) = 0.5 + 0.5 × ff     // guard drops to 50% at 0 stamina, not 0%
```

### Accuracy
```
accuracy = effCTL + (effINIT / 2) − (opponent.effMOM / 4) + counterBonus
```

### Impact Score
```
impactScore = (effMOM × 0.5) + (accuracy × 0.4) − (opponent.effGRD × 0.3)
```

### Counter Bonus
```
If your attack beats theirs:  bonus = +(4 + winnerEffCTL × 0.1)
If yours is beaten by theirs: bonus = −(4 + winnerEffCTL × 0.1)
Otherwise:                    bonus = 0
```
At average CTL 60 → ±10 (matches the v4.1 spec flat value).

### Unseat (Joust only)
```
margin = attacker.impactScore − defender.impactScore
threshold = 20 + (defender.effGRD / 10) + (defender.stamina / 20)
unseated if margin ≥ threshold
```

### Melee Round Outcome
```
margin = abs(impact1 − impact2)
hitThreshold  = 3 + defenderEffGRD × 0.031    // ~5 at GRD 65
critThreshold = 15 + defenderEffGRD × 0.154   // ~25 at GRD 65

margin < hitThreshold  → Draw
margin ≥ critThreshold → Critical (counts as 2 round wins)
otherwise              → Hit (1 round win for higher scorer)
```

---

## Attacks at a Glance

### Joust (6 attacks)
| Attack | Stance | MOM | CTL | GRD | STA Cost | Counter Profile |
|--------|--------|-----|-----|-----|----------|-----------------|
| Coup Fort | Agg | +25 | −10 | −5 | −20 | 1W / 2L (high risk) |
| Bris de Garde | Agg | +10 | +15 | −5 | −15 | 2W / 1L (strong) |
| Course de Lance | Bal | +5 | +10 | +5 | −10 | 2W / 1L (central) |
| Coup de Pointe | Bal | 0 | +20 | 0 | −12 | 1W / 2L (shift enabler) |
| Port de Lance | Def | −5 | +10 | +20 | −8 | 1W / 3L (pure tank) |
| Coup en Passant | Def | +5 | +15 | +10 | −14 | 2W / 0L (safest) |

### Melee (6 attacks)
| Attack | Stance | MOM | CTL | GRD | STA Cost | Counter Profile |
|--------|--------|-----|-----|-----|----------|-----------------|
| Overhand Cleave | Agg | +20 | −10 | −5 | −18 | 2W / 2L |
| Feint Break | Agg | +10 | +10 | −5 | −15 | 1W / 1L |
| Measured Cut | Bal | +5 | +10 | +5 | −10 | 2W / 1L |
| Precision Thrust | Bal | +5 | +15 | −5 | −12 | 1W / 2L |
| Guard High | Def | −5 | +5 | +20 | −8 | 1W / 1L |
| Riposte Step | Def | +5 | +15 | +10 | −12 | 2W / 2L |

### Stance Triangle
```
Aggressive > Defensive > Balanced > Aggressive
```
Enforced via counter tables (2-1-1 pattern per direction: 2 favored, 1 exception, 1 neutral).

### Speeds (Joust only)
| Speed | MOM | CTL | INIT | STA | Shift Threshold |
|-------|-----|-----|------|-----|-----------------|
| Slow | −15 | +15 | 0 | +5 | CTL ≥ 50 |
| Standard | 0 | 0 | +10 | 0 | CTL ≥ 60 |
| Fast | +15 | −15 | +20 | −5 | CTL ≥ 70 |

---

## Match Flow

```
┌─────────┐
│  Setup   │  Pick archetype → AI gets random different one
└────┬─────┘
     ▼
┌─────────────────────────────────────────────┐
│  JOUST LOOP (up to 5 passes)                │
│                                             │
│  1. Both pick Speed (Slow/Standard/Fast)    │
│  2. Both pick Attack (from 6 joust attacks) │
│  3. Reveal — see opponent's choices         │
│  4. Optional mid-run Shift to new attack    │
│     (needs CTL ≥ threshold + STA ≥ 10)     │
│     (if both shift, higher INIT goes last   │
│      = advantage, sees opponent's shift)    │
│  5. Resolve: stats → accuracy → impact      │
│  6. Check unseat (both directions)          │
│  7. Deduct stamina                          │
│                                             │
│  Exit: unseat → melee                       │
│        pass 5 done → score winner or melee  │
└────┬────────────────────────────────────────┘
     ▼
┌─────────────────────────────────────────────┐
│  MELEE (if unseat or tied after 5 passes)   │
│                                             │
│  1. Both pick Attack (from 6 melee attacks) │
│  2. Resolve: same formulas, no speed/shift  │
│  3. Margin determines Draw / Hit / Critical │
│  4. Deduct stamina                          │
│                                             │
│  Win: first to 4 round wins (crits = 2 wins)│
│  Exhaustion: both at 0 STA → tiebreaker     │
│    (more melee wins > higher joust score)   │
└────┬────────────────────────────────────────┘
     ▼
┌──────────┐
│ Match End │  Winner + reason displayed
└──────────┘
```

### Melee Transition
When unseated, the fallen knight takes carryover penalties:
```
momentumPenalty = −floor(unseatMargin / 3)
controlPenalty  = −floor(unseatMargin / 4)
guardPenalty    = −floor(unseatMargin / 5)
```
Stamina carries over as-is. Tied joust → melee with no penalties.

---

## Balance Scaling System (`balance-config.ts`)

All tuning constants in one place:

| Constant | Value | What It Does |
|----------|-------|--------------|
| `softCapKnee` | 100 | Stats below this are unmodified |
| `softCapK` | 50 | Diminishing returns intensity above knee |
| `fatigueRatio` | 0.8 | Fatigue kicks in below 80% of max stamina |
| `guardFatigueFloor` | 0.5 | Guard never drops below 50% effectiveness |
| `counterBaseBonus` | 4 | Base counter bonus before CTL scaling |
| `counterCtlScaling` | 0.1 | Bonus = 4 + CTL × 0.1 |
| `meleeHitBase` | 3 | Base hit threshold |
| `meleeHitGrdScale` | 0.031 | Hit threshold += GRD × 0.031 |
| `meleeCritBase` | 15 | Base crit threshold |
| `meleeCritGrdScale` | 0.154 | Crit threshold += GRD × 0.154 |
| `meleeWinsNeeded` | 4 | Round wins required to take the melee |
| `criticalWinsValue` | 2 | How many wins a critical counts for |

The system is calibrated so current (no-gear) gameplay is nearly unchanged. Scaling activates when gear pushes stats above 100.

---

## AI (`basic-ai.ts`)

Heuristic opponent — no lookahead, no learning.

- **Speed:** Weighted by archetype (high MOM → prefers Fast, high GRD → Slow, high CTL/INIT → Standard). Emergency: STA ≤ 15 forces Slow.
- **Attack:** Scored by stat affinity + stamina cost + counter matchup vs opponent's last attack + stance triangle. 70% picks best score, 30% picks random (for variety).
- **Shift:** Only if current attack loses the counter matchup AND a candidate scores > 5 points better. 30% chance to skip even then.

---

## State Machine (`match.ts`)

```typescript
createMatch(archetype1, archetype2): MatchState
submitJoustPass(state, p1Choice, p2Choice): MatchState
submitMeleeRound(state, p1Attack, p2Attack): MatchState
```

`MatchState` is the single source of truth:
- `phase` — current game phase (enum of 9 states)
- `passNumber` — current joust pass (1–5)
- `player1/player2` — `PlayerState` (archetype + stamina + carryover penalties)
- `passResults[]` — log of all resolved joust passes
- `cumulativeScore1/2` — running joust impact totals
- `meleeRoundResults[]` — log of all resolved melee rounds
- `meleeWins1/2` — melee round win counts
- `winner` — `'none' | 'player1' | 'player2' | 'draw'`
- `winReason` — human-readable string

---

## UI (`App.tsx` + `src/ui/`)

React 19, no state library. `App.tsx` holds all state in `useState` hooks and acts as a screen router.

**Screen flow:** `setup → speed → attack → reveal → pass-result → [loop or melee-transition] → melee → melee-result → [loop] → end`

Each screen is a standalone component that receives props and calls back to `App.tsx` handlers. No component talks to the engine directly except through `App.tsx` (with minor exceptions: `RevealScreen` calls `canShift`/`computeEffectiveStats` for display).

---

## Running It

```bash
pnpm install          # install deps
pnpm dev              # dev server (Vite)
pnpm test             # 65 tests (Vitest)
pnpm build            # tsc + vite build (238KB JS / 71KB gzip)
pnpm run deploy       # build + push to gh-pages
```

---

## Key Gotchas

- `unseat === 'player1'` means player 1 **performed** the unseat (player 2 fell). The naming is from the attacker's perspective.
- `fatigueFactor()` takes two args now: `(currentStamina, maxStamina)`. The old single-arg version is gone.
- `resolveCounters()` takes effective CTL values to scale the bonus. It's not a flat ±10 anymore.
- `resolveMeleeRound()` takes defender guard to scale thresholds. Not flat 5/25.
- Guard partially fatigues via `guardFatigueFactor` (floor 0.5). The v4.1 spec says guard doesn't fatigue — the engine intentionally diverges here to prevent turtle stacking.
- `calculator.ts` has its own `resolvePass()` convenience function, but the game uses `phase-joust.ts:resolveJoustPass()` which handles initiative-ordered dual shifts. The calculator version doesn't.
- Counter tables are strict inverses: if A beats B, then B's beatenBy includes A. No other relationships exist.
- Node v20.18.1 triggers Vite warnings but works fine.
