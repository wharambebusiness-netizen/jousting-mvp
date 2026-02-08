# Balance & Simulation Agent — Handoff

## META
- status: complete
- files-modified: src/engine/archetypes.ts, src/engine/balance-config.ts, src/engine/calculator.test.ts, src/engine/caparison.test.ts, src/engine/gigling-gear.test.ts, orchestrator/analysis/balance-sim-round-3.md
- tests-passing: true
- notes-for-others: Balance changes landed — Charger CTL 45→50/MOM 70→75/GRD 55→50, Bulwark GRD 75→65/INIT 45→50. Bulwark still dominant at 72% (was 76%) and Charger still weakest at 33% (was 28%). Root cause is formula-level: guard coefficient in impact score (0.3) and unseat threshold (guard/10) double-dip on defense. Stat-only changes show diminishing returns. **NEED calculator.ts formula changes to fully fix balance** — see analysis report for Options A-D.

## What Was Done

### Round 3: Balance Changes Applied + Test Updates
1. **Applied archetype stat changes:**
   - Charger: CTL 45→50, MOM 70→75, GRD 55→50 (glass-cannon identity)
   - Bulwark: GRD 75→65, INIT 45→50 (defense nerf + compensation)
2. **Updated ~20 test assertions** across calculator.test.ts, caparison.test.ts, gigling-gear.test.ts
   - Fixed Charger MOM/CTL/GRD calculations in all worked examples
   - Fixed Bulwark GRD calculations including Giga gear soft-cap tests
   - Rewrote Irongrip Drape test to use Tactician at Fast+CEP (old Charger scenario broke due to CTL increase making shift succeed without irongrip)
   - Fixed stale comments (Charger STA was listed as 50 in balance-config comment, actually 60)
3. **Ran simulation**: 7,200 matches confirming improvement direction but insufficient magnitude
4. **Identified root cause**: Guard's double-dip in impact score formula AND unseat threshold makes defensive archetypes systematically overpowered regardless of stat tuning
5. **Wrote analysis report**: orchestrator/analysis/balance-sim-round-3.md

### Simulation Summary (Round 3)
```
             MOM  CTL  GRD  INIT  STA  Total  WinRate(R2→R3)
charger:      75   50   50    60   60  = 295   28.2%→33.1%
technician:   50   70   55    60   55  = 290   44.0%→43.2%
bulwark:      55   55   65    50   65  = 290   76.4%→71.9%
tactician:    55   65   50    75   55  = 300   54.5%→54.3%
breaker:      65   60   55    55   60  = 295   36.4%→36.5%
duelist:      60   60   60    60   60  = 300   60.5%→61.0%
```

## What's Left

### Primary Milestone: COMPLETE
Balance changes applied, tests passing, simulation confirms improvement.

### Stretch Goals (for future rounds)
- [ ] **Formula-level balance fix** (requires calculator.ts ownership or coordination):
  - Option A: Reduce guard coefficient 0.3→0.2 in impact score
  - Option B: Reduce guard/10→guard/15 in unseat threshold
  - Option C: Add guard-penetration passive for Breaker archetype
- [ ] Add gear/caparison simulation mode
- [ ] Add per-difficulty simulation (easy/medium/hard AI)
- [ ] Add speed/attack usage frequency tracking
- [ ] Investigate Breaker's non-functional anti-Bulwark identity

## Issues
1. **Guard is systematically overvalued** (formula-level, not stat-level): Guard contributes -0.3 to opponent's impact score AND +guard/10 to unseat threshold, giving it ~4.0 defensive units per 10 points vs momentum's 5.0 offensive units per 10 points. But since guard reduces the *opponent's* score, its effective differential impact is much stronger.
2. **Stat-only changes have diminishing returns**: GRD 75→70 reduced Bulwark by 3.5pp, GRD 70→65 only reduced by 1pp more.
3. **Breaker's identity is broken**: "Guard shatter; anti-Bulwark" wins only 16% vs Bulwark. Needs a unique mechanic, not just stat tweaks.
4. **Duelist is overperforming**: At 61% win rate, the "balanced generalist" is second-strongest. Even stats (60/60/60/60/60) benefit from guard's disproportionate value.

## Previous Work
- Round 2: Created simulation script, ran 7,200 match simulation, identified critical imbalances (Bulwark 76.4%, Charger 28.2%), balance changes blocked by hardcoded test values.
- Round 3: Applied balance changes + test updates. Charger improved 28→33%, Bulwark reduced 76→72%. Identified formula-level root cause.
