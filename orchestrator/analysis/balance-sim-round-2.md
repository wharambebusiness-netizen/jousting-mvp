# Balance Simulation Report — Round 2

## Simulation Setup
- **Matches per matchup**: 200
- **Total matches**: 7,200 (36 matchups x 200)
- **AI difficulty**: Medium (70% optimal)
- **Gear/Caparisons**: None (base archetype stats only)

## Overall Archetype Win Rates

| Archetype   | Win Rate | W    | L    | D | Status |
|-------------|----------|------|------|---|--------|
| Bulwark     | 76.4%    | 1833 | 567  | 0 | DOMINANT |
| Duelist     | 60.5%    | 1451 | 949  | 0 | STRONG |
| Tactician   | 54.5%    | 1309 | 1091 | 0 | OK |
| Technician  | 44.0%    | 1057 | 1343 | 0 | WEAK |
| Breaker     | 36.4%    | 873  | 1527 | 0 | WEAK |
| Charger     | 28.2%    | 677  | 1723 | 0 | CRITICAL |

## Win Rate Matrix (P1 vs P2, P1 win %)

|             | charger | technician | bulwark | tactician | breaker | duelist |
|-------------|---------|------------|---------|-----------|---------|---------|
| charger     | 55      | 34         | 7       | 22        | 42      | 17      |
| technician  | 68      | 49         | 19      | 41        | 59      | 35      |
| bulwark     | 95      | 87         | 49      | 75        | 87      | 73      |
| tactician   | 78      | 64         | 25      | 50        | 69      | 46      |
| breaker     | 62      | 38         | 14      | 32        | 44      | 28      |
| duelist     | 81      | 70         | 34      | 59        | 80      | 50      |

## Phase Balance
- Joust-decided matches: 61.9% (no unseat, won on cumulative score)
- Melee-decided matches: 38.1% (unseat or tied joust)
- Average passes per match: 4.43
- Average melee rounds (when melee occurs): 1.97

## Critical Findings

### 1. Bulwark is Massively Overpowered (76.4% overall)
- Beats EVERY archetype including its intended counter (Breaker: 87% win rate)
- 95% win rate vs Charger, 87% vs Technician, 87% vs Breaker
- Only "close" matchup is mirror (49%)

**Root Cause**: Guard (75) is the highest single stat in the game, and guard is the most valuable stat due to:
- Impact Score formula: `MOM*0.5 + ACC*0.4 - OPP_GUARD*0.3`
- Guard subtracts from opponent's impact while also raising unseat threshold
- Guard also factors into melee thresholds
- Bulwark's high stamina (65) means guard doesn't degrade much from fatigue
- Port de Lance (+20 GRD) pushes Bulwark to 95 effective guard, near soft cap

### 2. Charger is Severely Underpowered (28.2% overall)
- Loses to everything except mirror (55%)
- Only 7% win rate vs Bulwark — nearly auto-loss
- 17% vs Duelist, 22% vs Tactician

**Root Cause**: High Momentum (70) is less valuable than Control because:
- Accuracy formula weights CTL much more: `CTL + INIT/2 - OPP_MOM/4 + counter`
- CTL contributes at 1.0x to accuracy, MOM only counters at -0.25x
- Charger's low CTL (45) means terrible accuracy
- "Wins fast or fades" identity fails because even early passes don't hit hard enough

### 3. Breaker's Anti-Bulwark Identity is Broken
- Breaker loses 87% to Bulwark instead of countering it
- Breaker has no unique mechanic — it's just a weaker Duelist
- Quality review agent also flagged this: "Breaker has no unique mechanic beyond stats"

### 4. Duelist is Too Strong for a "Generalist" (60.5%)
- All-60 stats means good at everything with no weakness
- Beats every non-Bulwark archetype
- Generalist shouldn't be 2nd-best overall

## Unseat Statistics

| Archetype   | Unseats Caused | Unseats Received |
|-------------|---------------|-----------------|
| Bulwark     | 556           | 557             |
| Breaker     | 479           | 440             |
| Charger     | 447           | 464             |
| Duelist     | 439           | 425             |
| Tactician   | 426           | 438             |
| Technician  | 395           | 418             |

Unseat rates are surprisingly even. Bulwark wins through cumulative score advantage, not unseating.

## Mirror Match Balance (should be ~50%)
All mirrors are within expected variance:
- Charger: 55/45, Technician: 49/51, Bulwark: 49/51
- Tactician: 50/50, Breaker: 44/56, Duelist: 50/50

## Recommended Balance Changes

### Priority 1: Nerf Bulwark Guard (75 -> 70)
- Reduces the defensive stat advantage by 5 points
- GRD 70 is still the highest guard in the game (tied with Bulwark's new total)
- Total stat budget drops from 295 to 290 (matches Charger/Technician)

### Priority 2: Buff Charger Control (45 -> 50)
- Improves accuracy without changing offensive identity
- Total stat budget increases from 290 to 295
- Charger still has the highest MOM:CTL ratio for "raw impact" identity

### BLOCKER: Test Coupling
Both changes break hardcoded test values in calculator.test.ts, caparison.test.ts, gigling-gear.test.ts, and playtest.test.ts. Tests use literal archetype stat values in worked examples (e.g., `// CTL: (45+15+15) = 75 * ff`). The balance agent is instructed "NEVER modify test files" and "if tests break, REVERT immediately."

**Action needed**: The orchestrator should coordinate a round where:
1. Balance-sim proposes specific stat changes
2. Quality-review agent updates affected test expectations
3. Balance-sim re-runs simulations to verify improvement

## Simulation Script
Created `src/tools/simulate.ts` — runs all 36 archetype matchups at 200 matches each. Run via `npx tsx src/tools/simulate.ts`. Reports overall win rates, win rate matrix, unseat stats, phase balance, mirror match analysis, and balance flags.
