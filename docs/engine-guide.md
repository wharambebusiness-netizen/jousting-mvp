# Jousting Game Engine

Turn-based medieval jousting minigame. Combat engine is **pure TypeScript with zero UI imports** (portable to Unity C#). Frontend is React + Vite.

## Quick Start

```bash
npm install
npm run dev           # Dev server with HMR at http://localhost:5173
npm test              # Run all 908 tests
npm run build         # TypeScript check + Vite build → dist/
npx tsx src/tools/simulate.ts bare          # Quick balance check
npx tsx src/tools/simulate.ts --summary     # Full tier comparison
```

## Learning Path

1. `src/engine/types.ts` — data model
2. `src/engine/archetypes.ts` + `attacks.ts` — game objects
3. `src/engine/balance-config.ts` — all tuning constants
4. `src/engine/calculator.ts` — combat math
5. `src/engine/phase-joust.ts` + `phase-melee.ts` — resolution flow
6. `src/engine/match.ts` — state machine
7. `src/engine/playtest.test.ts` — property-based tests
8. Run `npx tsx src/tools/simulate.ts bare` — see balance output
9. Run `npm run dev` — play the game

## Project Structure

```
src/
  engine/              Pure TS combat engine (no UI imports)
    types.ts           All interfaces and type definitions
    archetypes.ts      6 playable archetypes with base stats
    attacks.ts         12 attacks (6 joust + 6 melee), 3 speeds
    balance-config.ts  ALL tuning constants (single source of truth)
    calculator.ts      Core math: softCap, fatigue, impact, accuracy, guard, unseat
    phase-joust.ts     Joust pass resolution
    phase-melee.ts     Melee round resolution
    match.ts           State machine: createMatch, submitJoustPass, submitMeleeRound
    gigling-gear.ts    6-slot steed gear system
    player-gear.ts     6-slot player gear system
    gear-variants.ts   36 gear variant definitions (3 per slot)
    gear-utils.ts      Shared gear utilities

  ai/basic-ai.ts      AI opponent with difficulty levels, pattern tracking, reasoning
  ui/                  15 React components (App.tsx = 10-screen state machine)
  tools/               simulate.ts (balance testing), param-search.ts (parameter optimization)
```

## Game Flow

```
1. JOUST PHASE (up to 5 passes)
   ├── Both players pick: Speed + Attack (simultaneously)
   ├── Optional: Shift attack if eligible (costs stamina + initiative)
   ├── Resolve: counters → effective stats → accuracy → impact → unseat check
   ├── If unseated → immediate victory
   └── After 5 passes → compare cumulative impact scores

2. MELEE PHASE (first to 4 wins)
   ├── Both players pick: Melee attack (simultaneously)
   ├── Resolve: effective stats → impact comparison → outcome
   ├── Outcomes: Draw (0), Hit (1 win), Critical Hit (2 wins)
   ├── Joust stats carry over with divisors (MOM/6, CTL/7, GRD/9)
   ├── Joust loser gets unseated boost (+35% impact, +12 stamina recovery)
   └── First to 4 wins takes the melee

Winner = joust victor (unseating or higher score) OR melee victor
```

## 6 Archetypes

| Archetype | MOM | CTL | GRD | INIT | STA | Total | Identity |
|-----------|-----|-----|-----|------|-----|-------|----------|
| Charger | 75 | 55 | 50 | 55 | 65 | 300 | Raw impact specialist |
| Technician | 64 | 70 | 55 | 59 | 55 | 303 | Precision and control |
| Bulwark | 58 | 52 | 64 | 53 | 62 | 289 | Defensive wall |
| Tactician | 55 | 65 | 50 | 75 | 55 | 300 | Tempo and initiative |
| Breaker | 62 | 60 | 55 | 55 | 62 | 294 | Guard penetration (25%) |
| Duelist | 60 | 60 | 60 | 60 | 60 | 300 | Balanced generalist |

**Stats:** MOM (striking power), CTL (precision/counters), GRD (defense/unseat threshold), INIT (speed/accuracy), STA (endurance pool).

## Combat System

### Stat Pipeline

```
Base archetype stats (MOM/CTL/GRD/INIT/STA)
  → applyGiglingLoadout()    Steed gear bonuses + flat rarity bonus to ALL stats
  → applyPlayerLoadout()     Player gear bonuses only (NO rarity bonus)
  → softCap(knee=100, K=55)  Diminishing returns on MOM/CTL/GRD/INIT (NOT stamina)
  → computeEffectiveStats()  Apply speed + attack deltas
  → fatigueFactor()          Multiply by stamina ratio (low stamina = weaker)
  → Combat resolution        Impact, accuracy, guard, unseat check
```

### Soft Cap
Stats above 100 get diminishing returns: `knee + excess * K / (K + excess)`. K=55, so raw 120 → ~111.

### Fatigue
`fatigueFactor = currentStamina / maxStamina` (clamped, ratio 0.8). Guard has floor: `guardFF = 0.3 + 0.7 * fatigueFactor` (never below 30%).

### Counters

```
     Aggressive
      ↙      ↘
 Balanced ←── Defensive

 Agg beats Def, Def beats Bal, Bal beats Agg
```

- **Named counters:** Port de Lance beats Coup en Passant; Guard High beats Measured Cut (one-directional)
- **Counter bonus:** `4 + winnerCTL * 0.1`

### Joust Attacks (6)

| Attack | Stance | Key Stat |
|--------|--------|----------|
| Coup Fort | Aggressive | MOM++ |
| Course de Lance | Aggressive | MOM+/CTL+ |
| Coup en Passant | Balanced | CTL+ |
| Bris de Garde | Balanced | CTL+/GRD- |
| Port de Lance | Defensive | GRD+ |
| Precision Thrust | Defensive | CTL+ (deltaGuard=0) |

### Melee Attacks (6)

| Attack | Stance | Key Stat |
|--------|--------|----------|
| Overhand Cleave | Aggressive | MOM++ |
| Sweeping Strike | Aggressive | MOM+/CTL+ |
| Measured Cut | Balanced | CTL+ |
| Shield Bash | Balanced | GRD+/MOM+ |
| Guard High | Defensive | GRD++ |
| Riposte | Defensive | CTL+/GRD+ |

### 3 Speeds (Joust Only)

| Speed | MOM Delta | INIT Delta | STA Cost | Shift Threshold |
|-------|-----------|------------|----------|-----------------|
| Fast | +20 | +40 | -10 | 70 (CTL) |
| Standard | 0 | 0 | -5 | 55 (CTL) |
| Slow | -10 | -20 | 0 | 40 (CTL) |

### Shift Mechanic
After initial attack selection, shift to a different attack if effective CTL meets speed's threshold and stamina allows. Cost: 5 same-stance, 12 cross-stance, plus initiative penalty.

### Unseat Check
```
margin = attackerImpact - defenderImpact
threshold = 20 + (defenderGuard / 18) + (defenderStamina / 20)
unseated = margin >= threshold
```

### Melee Carryover
Stats carry from joust with divisors: MOM/6, CTL/7, GRD/9. Joust loser gets unseated boost: +35% impact, +12 stamina recovery.

### Melee Outcomes
- **Draw:** margin < `3 + GRD * 0.031`
- **Hit:** margin >= hit threshold → 1 win
- **Critical Hit:** margin >= `15 + GRD * 0.154` → 2 wins
- First to 4 wins takes the melee.

## AI System

`src/ai/basic-ai.ts`: Archetype personality (speed preferences, stance biases, shift affinity), pattern tracking (`OpponentHistory`), 3 difficulty levels (Easy 0.4, Medium 0.7, Hard 0.9). `WithReasoning` variants return `{ choice, reasoning }` for UI display.
