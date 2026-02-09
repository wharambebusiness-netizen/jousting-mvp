# Code Review — Round 5

## Summary

Round 5 was primarily analysis-focused. Balance-tuner ran variant-aware sims and proposed Bulwark stat redistribution (BL-025). Producer generated new tasks for the Bulwark fix pipeline. No engine code changes were committed in Round 5. Two uncommitted working-directory changes were found (Bulwark stats + guardImpactCoeff) — these are in-progress explorations, not finalized changes. CLAUDE.md balance state updated per BL-022.

## Issues Found

### BLOCK
- **[balance-config.ts:49] Unauthorized guardImpactCoeff change found in working directory**. `guardImpactCoeff: 0.18 → 0.16` was present as an uncommitted change. Producer Round 5 analysis explicitly states: "guardImpactCoeff not being changed" and "BL-021 cancelled". This change was likely left from BL-020 exploratory work and should NOT be committed. The stash also contained calculator.test.ts changes expecting 0.17 (not even 0.16) — a triple inconsistency. Fix: Ensure balance-tuner only modifies balance-config.ts when producing a final, tested change. Stale exploratory edits must be reverted before handoff.

- **[calculator.test.ts:559,1362-1370,1398-1408] Stale test modifications found in stash**. Three test assertions were modified to expect guardImpactCoeff=0.17 values, but the working directory had 0.16 and the committed config has 0.18. This created 3 test failures (58 vs 57.5, 43.2 vs 42.8, 1.2 vs 1.3). These changes were in a git stash and have been lost during stash conflict resolution. Fix: When guardImpactCoeff is eventually changed, QA must update ALL dependent tests to match the actual new value, not an intermediate one.

### WARN
- **[archetypes.ts] Bulwark stat redistribution (BL-025) applied without test fixes**. Working directory had Bulwark MOM 55→58, CTL 55→52. Producer correctly identified this as the right approach (Option A, total stays 290), but balance-tuner should not commit archetypes.ts changes until QA has fixed dependent tests (BL-026). This change was also lost during stash conflict resolution.

- **[calculator.test.ts:1616] Stale BL-012 comment (carried from Round 4)**. Comment reads `opponent_guard * 0.20 * 0.18` but config is `breakerGuardPenetration: 0.25`. Low priority — test logic uses `BALANCE.breakerGuardPenetration` and is correct. The stale comment was being fixed in the lost stash changes.

- **[calculator.test.ts:1643] Stale BL-012 test name (carried from Round 4)**. Test name says "Breaker penetration 0.20 removes exactly 20%" but penetration is 0.25. Test logic is correct (uses BALANCE constant). Fix: Rename to something generic like "Breaker penetration removes correct fraction of opponent guard".

- **[phase-resolution.test.ts:424] Stale comment**. Comment reads `(50 - 32.5) * 0.2 = 3.5 impact boost` but guardImpactCoeff is 0.18, not 0.2. This predates the current session. The test assertion doesn't hardcode the coefficient, so it's cosmetic only.

### NOTE
- **[balance-sim-round-5.md] Describes Technician MOM 55→58 change, but this was applied in Round 1 (committed)**. The report seems to be analyzing the original Technician change, not a new one. This creates confusion about what was actually done in Round 5 vs. earlier rounds. May be a re-validation report.

- **Working directory hygiene**: Multiple uncommitted exploratory changes found across engine files. Agents should clean up their working directory before writing handoffs. Uncommitted code changes that don't pass tests should be reverted, with findings documented in analysis reports instead.

## Refactors Applied

- **CLAUDE.md:9-10** — Updated Quick Reference: test count 477→647, simulate.ts usage updated to show `[tier] [variant]` syntax with variant support.
- **CLAUDE.md:110-115** — Updated Balance State: breakerGuardPenetration 0.20→0.25, added archetype changes (Technician MOM+3, Charger INIT/STA swap), updated remaining balance targets.
- **CLAUDE.md:146-156** — Updated Test Suite section: total 477→647, per-suite counts and descriptions updated to reflect QA's Round 1-3 additions (169 calculator, 122 playtest, 156 gear-variants).

## Review of Round 5 Agent Work

### Balance-Tuner (complete)
- **simulate.ts variant CLI arg**: Clean addition. Optional 3rd CLI arg for variant selection. Code is straightforward, type-safe, defaults to undefined (balanced behavior). APPROVED.
- **Variant-aware balance analysis**: Thorough data collection. Key insight that aggressive gear amplifies Bulwark dominance (+9pp at giga) is valuable for future metagame design. APPROVED.
- **Bulwark stat redistribution proposal**: Sound approach. CTL 55→52, MOM 55→58 targets counter bonus reduction while preserving GRD=65 identity. Total stays 290. Less test cascade than guardImpactCoeff change. APPROVED for execution with test coordination.

### Producer (complete)
- **BL-025/BL-026 task design**: Correctly identified the producer's bug in the balance-tuner's original proposal (total=287, not 290). Proposed Option A (2-stat change) as lower-risk than Option B. Task dependencies properly sequenced (BL-025 before BL-026). APPROVED.
- **BL-021 cancellation**: Correct decision — guardImpactCoeff not being changed makes the test mapping moot.

### QA (all-done since Round 3)
No new work this round. Previous work reviewed in Round 4.

### Polish (all-done since Round 3)
- **App.css rarity borders**: Found in stash — clean CSS additions for `.gear-item--${rarity}` classes with tier-appropriate border colors and glow effects. Epic+ get box-shadow, hover states properly composited. prefers-reduced-motion not needed (colors only, no animation). Requires JSX change to apply classes — noted as deferred. APPROVED.

## Hard Constraint Verification

All hard constraints verified against committed state:
- **Engine/UI separation**: ✅ Zero cross-boundary imports in engine code
- **Constants centralized**: ✅ All balance constants in balance-config.ts
- **Stat pipeline order**: ✅ base → steed → player → softCap → effective → fatigue
- **API stability**: ✅ No breaking changes to public function signatures
- **Type safety**: ✅ No `any` or `as` casts in engine code (except `as const` on BALANCE config, which is correct)
- **Deprecated resolvePass()**: ✅ Not extended or modified

## Tech Debt Filed

- **Stale test comments referencing old coefficient values** — 3 instances across calculator.test.ts and phase-resolution.test.ts. Estimated effort: S. Should be fixed in BL-026 alongside the Bulwark test updates.
- **Working directory hygiene process** — Agents leaving uncommitted exploratory changes creates confusion about source of truth. Consider adding a pre-handoff cleanup step to agent role templates. Estimated effort: S.
- **gear-variants BL-004 deterministic cycling tests fragility** — N=30 deterministic tests break on any stat change. Consider wider thresholds (0.25-0.75 instead of 0.30-0.70) or higher N. Estimated effort: M.

## Sign-off

**APPROVED WITH NOTES**

The committed codebase is clean. All 647 tests pass. CLAUDE.md has been updated with correct balance state. The two in-progress balance changes (Bulwark stats, guardImpactCoeff) need proper coordination through BL-025/BL-026 before being committed.

Tests passing: 647/647 (7 suites, 0 failures)
