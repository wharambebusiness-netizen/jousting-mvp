# Balance Analyst — Handoff

## META
- status: complete
- files-modified: src/tools/simulate.ts, orchestrator/analysis/balance-tuner-round-4.md
- tests-passing: true
- completed-tasks: BL-001, BL-002, BL-003, BL-011, Round 4 analysis
- notes-for-others: Round 4 is analysis-only — no balance constant changes. Added variant CLI arg to simulate.ts (`npx tsx src/tools/simulate.ts [tier] [aggressive|balanced|defensive]`). Key finding: aggressive gear amplifies Bulwark dominance at giga from 49% to 59% — variant system creates meaningful but asymmetric metagame shifts. Breaker flagged at giga 55.8% — likely noise, monitor. Bulwark stat redistribution proposed for Round 5.

## What Was Done

### Round 4: Comprehensive Analysis + Variant Balance Study

**1. Fresh 7-Tier Baseline (Confirmatory)**

Re-ran simulations at all 7 tiers to confirm Round 3 numbers with breakerGuardPenetration=0.25. Results are consistent — all deltas within Monte Carlo variance (~3pp). Key numbers:
- Bulwark: 61.6% bare, 62.3% uncommon — still dominant at low tiers
- Breaker: 55.8% giga — new flag (borderline, may be noise)
- Technician: 44-48% across all tiers — persistent mild weakness
- Balance quality: bare/uncommon poor, rare+ good-to-excellent

**2. Variant-Aware Balance Analysis (NEW)**

First-ever analysis of how gear variants affect archetype balance:

| Giga | Balanced | Aggressive | Defensive |
|------|----------|------------|-----------|
| Bulwark | 48.8% | **58.8%** | 49.8% |
| Spread | 8.7pp | **14.7pp** | 8.0pp |

- **Aggressive gear massively benefits Bulwark** (+9pp at giga) — when everyone's guard drops, Bulwark's intrinsic GRD=65 dominates
- **Defensive gear creates the best giga balance** (8.0pp spread, no flags)
- **Bulwark is variant-immune at uncommon** (61-63% regardless) — confirms base stat dominance
- Unseat rate: 37.4% balanced → 53.4% aggressive at giga

**3. Simulate Tool Enhancement**

Added optional variant parameter to `simulate.ts`:
```bash
npx tsx src/tools/simulate.ts giga aggressive   # all aggressive gear
npx tsx src/tools/simulate.ts uncommon defensive # all defensive gear
npx tsx src/tools/simulate.ts epic               # balanced (default)
```

**4. Bulwark Lever Analysis**

Documented all available balance levers for addressing Bulwark dominance, ranked by feasibility:
- Most feasible: Bulwark stat redistribution (CTL/INIT → MOM, keep GRD=65, total≥290)
- Most impactful but test-locked: guardImpactCoeff 0.18→0.16
- Riskiest: Bulwark GRD reduction (identity change)

Full analysis in `orchestrator/analysis/balance-tuner-round-4.md`.

## Current Archetype Stats (Unchanged from Round 3)

```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   58   70   55    60   55  = 298
bulwark:      55   55   65    53   62  = 290
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   60  = 292
duelist:      60   60   60    60   60  = 300
```

Balance constants changed this session (prior rounds):
- breakerGuardPenetration: 0.20 → **0.25** (Round 3)

Stats changed in previous rounds:
- Technician MOM: 55 → 58 (Round 1)
- Charger INIT: 60 → 55, STA: 60 → 65 (Round 2)

## What's Left

### Priority 1: Bulwark Bare/Uncommon Dominance (Critical)
- Bare: 61.6%, Uncommon: 62.3% — both above 60% target
- **Proposed Round 5 change**: Bulwark CTL 55→52, INIT 53→50, MOM 55→58 (total stays 290)
- Hypothesis: reduces counter bonus + accuracy contribution, -2-3pp at bare
- These stats are NOT directly test-locked for Bulwark (safe to change)
- Need to verify no Bulwark-specific computed values in tests before changing

### Priority 2: Breaker at Giga (Monitor)
- 55.8% — first time flagged as dominant
- Likely Monte Carlo noise (within 3pp of 55% threshold)
- Need higher-N confirmation before intervening
- If confirmed, consider breakerGuardPenetration 0.25→0.22

### Priority 3: Technician Persistent Weakness
- 44-48% across all tiers
- May partially self-correct once Bulwark dominance is addressed
- Monitor, do not intervene yet

### Do NOT Change
- breakerGuardPenetration — needs stabilization data at 0.25
- guardImpactCoeff — test-locked, diffuse effects
- Any archetype GRD values — test-locked
- Charger stats — current values achieve bare target

## Issues

- Variant metagame asymmetry: aggressive loadouts distort giga balance (14.7pp spread). Document for game designer — may need variant-specific balancing guidance in player-facing docs.
- Monte Carlo variance at N=200 per matchup is ~3pp for individual matchups. Breaker giga flag (55.8%) is within noise range of acceptable (53%). Need higher N for conclusive assessment.

## File Ownership

- `src/engine/balance-config.ts` (shared)
- `src/engine/archetypes.ts` (shared)
- `src/tools/simulate.ts` (primary)
- `orchestrator/analysis/balance-sim-round-*.md` (primary)
- `orchestrator/analysis/balance-tuner-round-*.md` (primary)
