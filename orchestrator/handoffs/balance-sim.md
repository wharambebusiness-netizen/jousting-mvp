# Balance & Simulation Agent — Handoff

## META
- status: in-progress
- files-modified: src/tools/simulate.ts, orchestrator/analysis/balance-sim-round-2.md
- tests-passing: true
- notes-for-others: CRITICAL — Bulwark is at 76.4% win rate, Charger at 28.2%. Recommended fixes (Bulwark GRD 75->70, Charger CTL 45->50) blocked because tests hardcode archetype stat values. Need quality-review agent to update test expectations before balance changes can land. See orchestrator/analysis/balance-sim-round-2.md for full analysis.

## What Was Done
1. Created simulation script `src/tools/simulate.ts` — runs 200 AI-vs-AI matches for all 36 archetype matchups (7,200 total matches)
2. Ran initial simulation and captured comprehensive statistics
3. Identified critical balance issues:
   - Bulwark dominant at 76.4% (beats everything including "counter" Breaker at 87%)
   - Charger catastrophically weak at 28.2% (7% vs Bulwark)
   - Breaker's anti-Bulwark identity non-functional
   - Duelist too strong for a generalist (60.5%)
4. Attempted balance changes (Bulwark GRD 75->70, Charger CTL 45->50) but reverted because tests hardcode archetype stat values
5. Wrote full analysis report to orchestrator/analysis/balance-sim-round-2.md

## What's Left
### Primary Milestone (BLOCKED)
- [ ] Apply recommended balance changes (Bulwark GRD 75->70, Charger CTL 45->50)
  - **BLOCKED**: Tests in calculator.test.ts, caparison.test.ts, gigling-gear.test.ts, and playtest.test.ts hardcode specific archetype stat values in worked examples
  - Need quality-review agent to update ~15 test assertions that reference Charger CTL=45 and Bulwark GRD=75
- [ ] Re-run simulations to verify improvement
- [ ] If still imbalanced after first change, propose additional adjustments

### Stretch Goals
- [ ] Add gear/caparison simulation mode (currently base stats only)
- [ ] Add per-difficulty simulation (easy/medium/hard AI)
- [ ] Add speed/attack usage frequency tracking
- [ ] Investigate Breaker's lack of unique mechanic
- [ ] Consider formula-level changes (impact score weights) if stat changes aren't enough

## Issues
1. **Test coupling blocks balance work**: Every archetype stat and most balance-config values have hardcoded test expectations. The balance agent can't modify tests, so balance changes are impossible without coordination with quality-review.
2. **No draws**: Zero draws across 7,200 matches. This may be intentional but worth noting.
3. **Guard is systematically overvalued**: The impact score formula (`MOM*0.5 + ACC*0.4 - OPP_GUARD*0.3`) and unseat threshold formula (`20 + GRD/10 + STA/20`) both heavily reward guard, making defensive archetypes inherently stronger.

## Blocked Test Lines (for quality-review coordination)

### If Charger CTL changes from 45 to 50:
- calculator.test.ts:246 — `expect(stats.control).toBe(20)` (45+(-15)+(-10)=20, becomes 25)
- calculator.test.ts:317-318 — `// CTL: (45+15+15) = 75 * ff` (becomes 80)
- calculator.test.ts:367-368 — `// CTL: (45+15+10) = 70 * ff` (becomes 75)
- caparison.test.ts:280 — Charger shift eligibility test (effCTL changes from 55 to 60, may now pass threshold)

### If Bulwark GRD changes from 75 to 70:
- calculator.test.ts:557-559 — `expect(stats.guard).toBe(95 * 0.5)` / `toBe(47.5)` (95 becomes 90)
- calculator.test.ts:562 — `expect(fullStats.guard).toBe(95)` (becomes 90)
- gigling-gear.test.ts:302-303 — `expect(result.guard).toBe(103)` (103 becomes 98)
- gigling-gear.test.ts:305 — softCap computation based on 103

## Current Balance Reference
```
             MOM  CTL  GRD  INIT  STA  Total  WinRate
charger:      70   45   55    60   60  = 290   28.2%
technician:   50   70   55    60   55  = 290   44.0%
bulwark:      55   55   75    45   65  = 295   76.4%
tactician:    55   65   50    75   55  = 300   54.5%
breaker:      65   60   55    55   60  = 295   36.4%
duelist:      60   60   60    60   60  = 300   60.5%
```

## Previous Work
- Round 2: Created simulation script, ran 7,200 match simulation, identified critical imbalances (Bulwark 76.4%, Charger 28.2%), balance changes blocked by hardcoded test values.
