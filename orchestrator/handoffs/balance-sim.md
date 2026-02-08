# Balance & Simulation Agent — Handoff

## META
- status: not-started
- files-modified: none
- tests-passing: true
- notes-for-others: none

## Your Mission
You are the balance guardian. Every round you:
1. Run match simulations and gather statistical data
2. Analyze archetype win rates, caparison effectiveness, and phase balance
3. Identify imbalances or dominated strategies
4. Propose and implement **small, incremental** balance changes (one constant at a time)
5. Re-run simulations to verify the change improved balance
6. Write analysis reports to orchestrator/analysis/

## Project Context
- Jousting minigame MVP: Vite + React + TypeScript
- Project root: jousting-mvp/
- 222+ tests passing. Run with: `npx vitest run`
- Balance constants: src/engine/balance-config.ts (the BALANCE object)
- Archetypes: src/engine/archetypes.ts
- Attacks + counters: src/engine/attacks.ts
- Playtest simulations: src/engine/playtest.test.ts (65 tests)
- Full architecture reference: jousting-handoff-s17.md

## What to Do Each Round

### Step 1: Create or Update Simulation Script
If `src/tools/simulate.ts` doesn't exist, create it. It should:
- Import the match engine (createMatch, submitJoustPass, submitMeleeRound)
- Import all archetypes and the AI
- Run N matches (e.g., 100) for each archetype pair (6x6 = 36 matchups)
- Track: win rate per archetype, average score differential, unseat rate, melee win rate
- Track: caparison trigger frequency, caparison impact on outcomes
- Output a structured report (JSON or readable text)
- Run via: `npx tsx src/tools/simulate.ts`

### Step 2: Run Simulations
Run the simulation script and capture the output.

### Step 3: Analyze Results
Look for:
- **Dominant archetypes**: win rate > 60% across all matchups
- **Weak archetypes**: win rate < 40% across all matchups
- **Broken caparisons**: one effect dramatically outperforming others
- **Phase imbalance**: jousting vs melee — does one phase decide too many matches?
- **Stale strategies**: is one speed/attack combo always optimal?

### Step 4: Propose Balance Changes (if needed)
If imbalances found, change AT MOST 2 values in balance-config.ts per round.
Example changes:
- Adjust an archetype stat by ±5
- Adjust a caparison effect value
- Adjust fatigue ratio or soft cap
- Adjust melee thresholds

NEVER make drastic changes. ±5 to a stat is the maximum per round.

### Step 5: Re-run Tests
After any balance change, run `npx vitest run` to verify nothing breaks.

### Step 6: Write Analysis Report
Write to `orchestrator/analysis/balance-sim-round-N.md` with:
- Simulation results (archetype win rates table)
- Issues identified
- Changes made (if any)
- Before/after comparison (if changes made)
- Recommendations for next round

## Files You Own
- src/engine/balance-config.ts — balance constants (CAREFUL: small changes only)
- src/engine/archetypes.ts — archetype stats (CAREFUL: ±5 per stat max)
- src/tools/simulate.ts — simulation script (create if doesn't exist)
- orchestrator/analysis/balance-sim-*.md — your analysis reports

## Files You Must NOT Edit
- src/ai/basic-ai.ts (owned by ai-engine)
- src/ui/* (owned by ui-polish / ai-reasoning)
- src/engine/types.ts (owned by ai-engine)
- src/App.tsx (shared — note changes in handoff)

## Safety Rules
- MAX 2 balance constant changes per round
- MAX ±5 to any single stat value per round
- NEVER delete or modify test files
- ALWAYS run tests after changes
- If tests break after your change, REVERT IT immediately
- Write the analysis report even if you made no changes

## Current Balance Reference
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      70   45   55    60   60  = 290
technician:   50   70   55    60   55  = 290
bulwark:      55   55   75    45   65  = 295
tactician:    55   65   50    75   55  = 300
breaker:      65   60   55    55   60  = 295
duelist:      60   60   60    60   60  = 300
```

## Previous Work
None yet — this is the first round.
