# Balance & Simulation Agent — Handoff

## META
- status: all-done
- files-modified: src/engine/balance-config.ts, src/engine/calculator.ts, src/engine/calculator.test.ts, src/engine/match.test.ts, src/engine/caparison.test.ts, orchestrator/analysis/balance-sim-round-4.md
- tests-passing: true
- notes-for-others: Guard coefficients now live in balance-config.ts as `guardImpactCoeff` (0.2, was hardcoded 0.3) and `guardUnseatDivisor` (15, was hardcoded 10). Formula changes reduced Bulwark dominance from 72%→69% and improved Charger from 33%→36%. Strongest-weakest spread narrowed from 48pp to 33pp across 4 rounds. **Charger now wins Pass 1 impact vs Technician** (reversed from before) — this is intentional, glass cannons should hit hard. Further balance requires Breaker guard-penetration mechanic in phase-joust.ts.

## What Was Done

### Round 4: Formula-Level Guard Nerf
1. **Extracted guard coefficients to balance-config.ts:**
   - `guardImpactCoeff: 0.2` (was hardcoded 0.3 in calcImpactScore)
   - `guardUnseatDivisor: 15` (was hardcoded 10 in calcUnseatThreshold)
2. **Updated calculator.ts** to reference `BALANCE.guardImpactCoeff` and `BALANCE.guardUnseatDivisor`
3. **Updated 7 test assertions** across calculator.test.ts (6), match.test.ts (1), caparison.test.ts (1 comment)
4. **Ran simulation**: 7,200 matches confirming balance improvement
5. **Wrote analysis report**: orchestrator/analysis/balance-sim-round-4.md

### Simulation Summary (Round 4)
```
             MOM  CTL  GRD  INIT  STA  Total  WinRate(R3→R4)
charger:      75   50   50    60   60  = 295   33.1%→35.7%
technician:   50   70   55    60   55  = 290   43.2%→41.1%
bulwark:      55   55   65    50   65  = 290   71.9%→69.1%
tactician:    55   65   50    75   55  = 300   54.3%→56.6%
breaker:      65   60   55    55   60  = 295   36.5%→39.0%
duelist:      60   60   60    60   60  = 300   61.0%→58.5%
```

### Round 3: Balance Changes Applied + Test Updates
1. Applied archetype stat changes: Charger CTL 45→50/MOM 70→75/GRD 55→50, Bulwark GRD 75→65/INIT 45→50
2. Updated ~20 test assertions
3. Ran simulation confirming improvement direction

### Round 2: Simulation Tool + Analysis
1. Created simulation script (src/tools/simulate.ts)
2. Ran 7,200 match simulation identifying critical imbalances

## What's Left

### All Primary + Stretch Tasks Exhausted
- [x] Simulation tool created (Round 2)
- [x] Balance analysis + archetype stat changes (Round 3)
- [x] Formula-level guard coefficient fix (Round 4)
- [x] Guard coefficients extracted to balance-config.ts for easy tuning (Round 4)

### Future Work (requires new mechanics or phase-joust.ts changes)
- [ ] **Breaker guard-penetration mechanic** — Breaker ignores X% of opponent guard. Needed for "anti-Bulwark" identity to function.
- [ ] More aggressive tuning (guardImpactCoeff 0.15? guardUnseatDivisor 20?) — diminishing returns without structural changes
- [ ] Per-difficulty AI simulation
- [ ] Gear/caparison simulation mode
- [ ] Speed/attack usage frequency tracking

## Issues
1. **Bulwark still dominant at 69%** — formula changes helped but structural advantages remain (guard-stamina synergy)
2. **Breaker identity broken** — 24% vs Bulwark. Needs unique guard-penetration mechanic, not more stat/formula tweaks
3. **Technician dropped slightly** (43.2%→41.1%) — the guard nerf paradoxically hurts Technician whose high CTL was already its strength, not guard
4. **Balance spread: 33.4pp** (69.1% - 35.7%) — down from 48.2pp baseline but still wide

## Previous Work
- Round 2: Created simulation script, ran 7,200 match simulation, identified critical imbalances (Bulwark 76.4%, Charger 28.2%)
- Round 3: Applied balance changes + test updates. Charger improved 28→33%, Bulwark reduced 76→72%. Identified formula-level root cause.
- Round 4: Formula-level guard nerf (guardImpactCoeff 0.3→0.2, guardUnseatDivisor 10→15). Spread narrowed from 48pp to 33pp.
