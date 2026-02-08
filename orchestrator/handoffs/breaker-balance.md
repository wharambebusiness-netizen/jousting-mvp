# Breaker Balance Agent — Handoff

## META
- status: complete
- files-modified: src/engine/balance-config.ts, src/engine/archetypes.ts
- tests-passing: false (1 failure — playtest.test.ts expects Breaker stat total 295, now 292 due to MOM change)
- notes-for-others: Breaker MOM changed 65→62. Test-writer agent needs to update playtest.test.ts line 340: `expect(total).toBe(292)` and update test description to "(292 vs 280)". Balance analysis at orchestrator/analysis/breaker-balance-round-2.md.

## What Was Done

### Tuning Summary
Ran systematic sweep of `breakerGuardPenetration` values (0.20, 0.25, 0.30, 0.35) across bare and giga modes. Found that percentage-based penetration scales too aggressively with gear (higher guard values = more absolute guard removed).

**Final settings:**
- `breakerGuardPenetration`: 0.35 → **0.25**
- Breaker `momentum`: 65 → **62**

### Results (Before → After)

**Bare (no gear):**
- Breaker: 39.0% → **50.9%** (+11.9pp)
- Breaker vs Bulwark: ~23% → **39%** (+16pp)

**Giga (max gear):**
- Breaker: 44.8% → **58.2%** (+13.4pp)
- Breaker vs Bulwark: ~43% → **58%** (+15pp)

### Stretch Goal: Full Rarity Sweep
Ran all 7 rarity levels. Breaker ranges 45-58% across tiers. Epic is best balanced (16.6pp spread). Penetration correctly amplifies anti-tank role at higher gear. Full data in analysis report.

## What's Left

### For Test-Writer Agent
- Update `playtest.test.ts` line 340: change `expect(total).toBe(295)` → `expect(total).toBe(292)`
- Update test description from "(295 vs 280)" to "(292 vs 280)"
- Add tests for `calcImpactScore` with `guardPenetration` parameter (per breaker-mechanic handoff)

### For Future Balance Rounds
- Bulwark still dominant at bare (67.2%) — needs direct nerf or structural change
- Charger (33%) and Technician (39%) still weak at bare — need buffs
- Consider flat penetration instead of percentage to reduce gear-scaling variance
- See full recommendations in orchestrator/analysis/breaker-balance-round-2.md

## Issues

- 1 test failure in playtest.test.ts (Breaker stat total assertion) — expected, caused by intentional MOM reduction. Needs test-writer update.
- Breaker vs Bulwark at bare (39%) is still below 45% target — fundamental Bulwark dominance issue, not solvable by Breaker changes alone.
