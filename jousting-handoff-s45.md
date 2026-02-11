# Session 45 Handoff — Balance Tuning via Coordinate Descent

## What to Paste Into New Conversation

Copy everything below the line into your next Claude conversation:

---

Read jousting-handoff-s45.md for full context. Here's the summary:

**Project**: Jousting minigame MVP (Vite + React + TypeScript). Working dir: `C:/Users/rvecc/Documents/Jousting/Jousting/jousting-mvp`

**Current State (Session 45)**:
- **908 tests ALL PASSING** across 8 test suites — `npx vitest run`
- **Balance config tuned**: 5 params optimized via coordinate descent
- **Giga tier near-perfect**: 3.1pp spread, zero flags (was 7.2pp)
- **Epic tier tight**: 4.5pp spread, zero flags (was 4.4pp)
- **Bare tier improved**: 12.6pp spread (was ~20.7pp), 1 flag (bulwark dominant)
- **Orchestrator v7**: 2759 lines, noise-aware param search context
- **Gigaverse integration is TABLED** — do not work on it
- **All 4 phases of balance tuning roadmap COMPLETE + first real tuning applied**

**What Was Built in S45 (Balance Tuning — Coordinate Descent)**:

1. **Full sensitivity sweep** — 8 params × 5 values × 3 tiers = 129 sims. Identified:
   - 3 confirmed-optimal params (guardImpactCoeff=0.18, fatigueRatio=0.8, breakerGuardPenetration=0.25)
   - 5 actionable params with improvements above noise floor

2. **Focused coordinate descent config** — `orchestrator/search-configs/focused-descent.json`. 3 rounds of descent across 5 params, 234 sims, ~12 min.

3. **Applied 5 balance config changes** (coordinate descent result):
   - `softCapK`: 50 → **55** (more lenient soft cap, less compression)
   - `guardUnseatDivisor`: 15 → **18** (guard contributes less to unseat defense)
   - `unseatedImpactBoost`: 1.25 → **1.35** (stronger comeback for unseated)
   - `unseatedStaminaRecovery`: 8 → **12** (more stamina recovery for unseated)
   - `guardFatigueFloor`: 0.5 → **0.3** (guard degrades more at low stamina)

4. **Updated 35 tests** across 6 test files to match new balance config values.

5. **Validated balance improvements** across all tiers:
   - bare: ~20.7pp → 12.6pp (-39% spread reduction)
   - epic: ~4.4pp → 4.5pp (essentially same, was already tight)
   - giga: 7.2pp → 3.1pp (-58% spread reduction)

**Post-Tuning Win Rates (N=200)**:
```
Bare:  Bulwark 58.1% | Tech 51.0% | Duelist 50.3% | Tact 49.0% | Charger 46.0% | Breaker 45.5%  [12.6pp, 1 flag]
Epic:  Charger 52.2% | Breaker 50.8% | Bulwark 50.5% | Duelist 49.5% | Tech 49.3% | Tact 47.7%  [4.5pp, 0 flags]
Giga:  Breaker 51.9% | Bulwark 50.6% | Charger 50.1% | Duelist 49.5% | Tech 49.1% | Tact 48.8%  [3.1pp, 0 flags]
```

**Key files modified in S45**:
- `src/engine/balance-config.ts` — 5 param changes (softCapK, guardUnseatDivisor, unseatedImpactBoost, unseatedStaminaRecovery, guardFatigueFloor)
- `src/engine/calculator.test.ts` — Updated ~20 expected values for new balance config
- `src/engine/match.test.ts` — Updated worked examples for new guard fatigue + unseat thresholds
- `src/engine/phase-resolution.test.ts` — Updated unseated boost multiplier
- `src/engine/playtest.test.ts` — Updated config assertions
- `src/engine/gigling-gear.test.ts` — Updated softCap expected value
- `src/engine/player-gear.test.ts` — Updated softCap expected value
- `orchestrator/search-configs/focused-descent.json` — NEW: coordinate descent config
- `CLAUDE.md` — Updated balance coefficients + win rate validation section

**Commands**:
```bash
cd C:/Users/rvecc/Documents/Jousting/Jousting/jousting-mvp
npx vitest run                                                    # 908 tests
npx tsx src/tools/simulate.ts bare balanced                        # Quick sim
npx tsx src/tools/simulate.ts bare balanced --json                 # JSON sim
npx tsx src/tools/param-search.ts orchestrator/search-configs/focused-descent.json --dry-run  # Preview descent
npx tsx src/tools/param-search.ts orchestrator/search-configs/sensitivity-sweep.json          # Full sensitivity sweep
node orchestrator/orchestrator.mjs orchestrator/missions/balance-tuning.json                  # Full balance pipeline
```

**What's next**:
- Balance tuning applied and validated. Infrastructure is proven end-to-end (sensitivity sweep → coordinate descent → config update → test fix → validation).
- Options:
  1. **Address bare tier bulwark dominance** — bulwark still 58.1% at bare (1 flag). Could investigate archetype stat adjustments or bare-tier-specific tuning.
  2. **Run variant sims** to verify aggressive/defensive variants are still balanced after tuning
  3. **Launch a full balance-tuning run** with the orchestrator to find further improvements
  4. **Higher precision validation** — `--matches 500` or `--matches 1000` to confirm improvements
  5. **New feature work** — balance infrastructure is complete and the game is well-balanced
  6. **Deploy** — push tuned balance to gh-pages

**Working style**: Full autonomy, make decisions, don't ask for approval. Full permissions granted.

---

## Session Log

S45 focused on using the param search infrastructure to actually tune balance:

1. Read S44 handoff — confirmed all 4 roadmap phases complete, 908 tests passing
2. Verified 908 tests passing (baseline check)
3. Ran full sensitivity sweep (8 params × 5 values × 3 tiers = 129 sims, ~6.5 min)
   - Noise floor: ±0.84 (much tighter than quick-sweep's ±2.66)
   - 5 actionable improvements: softCapK, guardUnseatDivisor, unseatedStaminaRecovery, guardFatigueFloor, unseatedImpactBoost
   - 3 confirmed/within-noise: guardImpactCoeff (confirmed), fatigueRatio (confirmed), breakerGuardPenetration (within noise)
4. Tested all 5 improvements combined — mixed results (bare better, epic worse, giga better). Individual optimums are antagonistic when combined.
5. Created focused-descent.json config (5 actionable params, 3 rounds of coordinate descent)
6. Ran coordinate descent (234 sims, ~12 min). Best result: score 6.08 vs baseline 11.29 (-5.21 improvement, ~7 SDs above noise)
7. Applied 5 balance config changes to balance-config.ts
8. 35 test failures — launched 2 parallel agents to fix calculator.test.ts and match.test.ts
9. Fixed remaining test files manually (playtest, phase-resolution, gigling-gear, player-gear)
10. All 908 tests passing after fixes
11. Ran validation sims: bare 12.6pp (-39%), epic 4.5pp, giga 3.1pp (-58%)
12. Updated CLAUDE.md balance coefficients + win rate validation section
13. Updated MEMORY.md with S45 status
