# Breaker Balance Agent — Handoff

## META
- status: all-done
- files-modified: src/engine/balance-config.ts, src/engine/archetypes.ts
- tests-passing: true
- notes-for-others: Bulwark STA 65→62, INIT 50→53 (total still 290). breakerGuardPenetration 0.25→0.20. Bulwark bare dominance (66%) is structurally GRD-driven — cannot be fixed via stat redistribution or available constants. Most balance levers are test-locked. See analysis for details.

## What Was Done

### Round 3 Changes
1. **Bulwark stat redistribution**: STA 65→62, INIT 50→53 (total stays 290)
   - Reduces attrition advantage; INIT has minimal combat impact
   - Bulwark bare dropped ~1.5pp (65.5%→64%, within simulation variance)
2. **breakerGuardPenetration**: 0.25→0.20
   - Reduces Breaker giga dominance (59.6%→~56%)
   - Eliminates extreme Breaker vs Technician giga skew (75%→~66%)
   - Trade-off: Breaker vs Bulwark bare drops from 36%→32%

### Key Finding: Bulwark Dominance is GRD-Locked
Exhaustive testing showed Bulwark's 66% bare win rate is driven by GRD=65, not STA. Even at STA=60 (max allowed reduction), Bulwark only dropped to 64%. The guard stat directly reduces opponent impact scores via `guardImpactCoeff`, and this constant is hardcoded in ~7 test assertions.

### Test Constraint Analysis
Identified which balance levers are test-locked:
- **Locked**: All Charger stats, Bulwark GRD, guardImpactCoeff, guardUnseatDivisor, guardFatigueFloor, fatigueRatio, counterCtlScaling, shift costs
- **Available**: Bulwark MOM/CTL/INIT/STA, breakerGuardPenetration, melee constants, softCap constants

### Full Rarity Sweep Results
- Epic tier best balanced: 14.5pp spread
- Bare/uncommon dominated by Bulwark (66-67%)
- Breaker scales 50%→59% bare→giga (anti-tank preserved)
- Technician consistently weak (38-51%)
- Full data in orchestrator/analysis/breaker-balance-round-3.md

### Cumulative Changes (Rounds 2-3)
```
archetypes.ts:
  Breaker MOM: 65 → 62 (round 2)
  Bulwark STA: 65 → 62 (round 3)
  Bulwark INIT: 50 → 53 (round 3)

balance-config.ts:
  breakerGuardPenetration: 0.35 → 0.25 → 0.20 (rounds 2-3)
```

## What's Left

### Structural Balance Issues (Cannot Fix with Current Constraints)
- Bulwark bare dominance (66%) — requires changing guardImpactCoeff or adding new mechanic
- Charger weakness (34% bare) — all stats test-locked
- Technician weakness (39% bare) — all stats test-locked
- Win rate spread >25pp at bare — structural, not tunable

### Recommendations for Future Work
1. **Test modernization**: Replace hardcoded values with `BALANCE.*` / `ARCHETYPES.*` refs
2. **guardImpactCoeff reduction**: 0.2→0.15 would directly nerf Bulwark (needs test updates)
3. **Guard degradation mechanic**: Guard effectiveness decreases per consecutive pass
4. **Charger momentum scaling**: New mechanic where MOM advantage increases over passes

## Issues

- No test failures (431 passing)
- Simulation variance is ±2pp at 200 matches — some round-to-round differences are noise
- Bulwark bare 66% is the #1 structural balance issue, blocked by test constraints
