# Balance Analyst — Handoff

## META
- status: complete
- files-modified: src/engine/balance-config.ts, orchestrator/analysis/balance-tuner-round-3.md
- tests-passing: true
- completed-tasks: BL-001, BL-002, BL-003, BL-011
- notes-for-others: [BALANCE CHANGE] breakerGuardPenetration 0.20→0.25 (Round 3). No test failures — this constant is NOT test-locked. Breaker overall win rate improves +2-3pp across most tiers. Full 7-tier baseline data in analysis/balance-tuner-round-3.md. Reviewer note re: match.test.ts:78 flipped assertion — I am not permitted to edit test files, QA should address this.

## What Was Done

### BL-011: Full Tier Sweep (Round 3)

**Task**: Run simulations at all 7 tiers (bare, uncommon, rare, epic, legendary, relic, giga) and document archetype win rates.

**Key findings**:
- Balance quality improves monotonically with rarity tier (18.5pp spread at bare → 4.1pp at giga)
- Bulwark dominance peaks at uncommon (63.6%) — worst single balance problem
- Charger is weakest at bare/uncommon but STRONGEST at epic (56.0%) — "scales with gear" profile
- Legendary/relic/giga are in excellent shape (5.6pp spread or less, no flags)

Full data tables in `orchestrator/analysis/balance-tuner-round-3.md`.

### BL-003: breakerGuardPenetration Assessment (Round 3)

**Change**: `breakerGuardPenetration` 0.20 → 0.25 in `balance-config.ts`

**Hypothesis**: 0.20 may be insufficient for Breaker's anti-tank identity.

**Tested values**: 0.20 (baseline), 0.25, 0.30.

**Result at 0.25**: Breaker overall +2.6pp bare, +2.4pp epic, +3.1pp giga. No new dominant matchups. 605/605 tests pass.

**Why not 0.30**: Risk of Breaker dominance at giga (projected 55-57%). 0.25 keeps Breaker in the 48-55% healthy range.

**Key insight**: Guard penetration helps Breaker against ALL opponents equally, not specifically against Bulwark. The Breaker vs Bulwark matchup at uncommon (~30%) is a Bulwark structural problem, not a Breaker problem.

## Current Archetype Stats (Post Round 3)

```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   58   70   55    60   55  = 298
bulwark:      55   55   65    53   62  = 290
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   60  = 292
duelist:      60   60   60    60   60  = 300
```

Balance constants changed this session:
- breakerGuardPenetration: 0.20 → **0.25** (Round 3)

Stats changed in previous rounds:
- Technician MOM: 55 → 58 (Round 1)
- Charger INIT: 60 → 55, STA: 60 → 65 (Round 2)

## What's Left

### Priority 1: Bulwark Bare/Uncommon Dominance
- Bare: 60.4%, Uncommon: 63.0% — both above 60% target
- Root cause: GRD=65 double-dip (guardImpactCoeff + guardUnseatDivisor)
- Candidate fix: guardImpactCoeff 0.18 → 0.16 (TEST-LOCKED: ~7 assertions need updating)
- Alternative: Bulwark GRD reduction (TEST-LOCKED: GRD=65 in gigling-gear.test.ts)
- Requires QA coordination for test updates before implementation

### Priority 2: Technician Persistent Weakness
- Consistently 43-49% across all tiers
- May partially self-correct once Bulwark dominance is addressed
- Monitor, do not intervene yet

### Priority 3: Charger at Uncommon
- 40.8% — borderline at target (>40%)
- Charger becomes strongest at epic (53.9%) — acceptable tier-dependent profile
- Monitor, do not intervene

### Do NOT Change
- breakerGuardPenetration — needs stabilization data at 0.25
- Charger stats — current values achieve bare target
- Any archetype stats until QA confirms test stability

## Issues

- **Reviewer flagged**: match.test.ts:78 has incorrectly flipped assertion (Charger still wins pass 1 impact after Technician MOM+3). QA should fix line 79 to `expect(p1.player1.impactScore).toBeGreaterThan(p1.player2.impactScore)`.
- Uncommon tier shows highest variance and worst balance — structural issue from GRD dominance before softCap engagement.
- Monte Carlo variance at 200 matches/matchup is ~3pp for individual matchups. Consider increasing to 500 for precision work.

## File Ownership

- `src/engine/balance-config.ts` (shared)
- `src/engine/archetypes.ts` (shared)
- `src/tools/simulate.ts` (primary)
- `orchestrator/analysis/balance-sim-round-*.md` (primary)
- `orchestrator/analysis/balance-tuner-round-*.md` (primary)
