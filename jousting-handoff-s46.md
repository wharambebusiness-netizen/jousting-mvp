# Session 46 Handoff — guardImpactCoeff Tuning + UI Polish

## What to Paste Into New Conversation

Copy everything below the line into your next Claude conversation:

---

Read jousting-handoff-s46.md for full context. Here's the summary:

**Project**: Jousting minigame MVP (Vite + React + TypeScript). Working dir: `C:/Users/rvecc/Documents/Jousting/Jousting/jousting-mvp`

**Current State (Session 46)**:
- **908 tests ALL PASSING** across 8 test suites — `npx vitest run`
- **Balance config tuned**: guardImpactCoeff 0.18→0.12 (S46), plus S45 params
- **Giga tier near-perfect**: 3.2pp spread, zero flags
- **Epic tier good**: 6.2pp spread, zero flags
- **Bare tier improved**: 10.3pp spread (was 13.2pp), 1 flag (bulwark dominant 55.4%)
- **simulate.ts --matches N**: NEW in S46, override matches per matchup from CLI
- **GitHub Pages deploy disabled** (build_type switched to workflow, no workflow defined)
- **3 UI improvements**: difficulty descriptions, fatigue warnings, unseat explanation
- **Gigaverse integration is TABLED** — do not work on it

**What Was Built in S46**:

1. **Disabled GitHub Pages deploy** — switched `build_type` to "workflow" with no Actions workflow, effectively turning off the live site.

2. **Added `--matches N` flag to simulate.ts** — overrides default 200 matches per matchup for CLI sims. Consistent with param-search.ts's existing --matches support.

3. **Comprehensive balance analysis** (all via automated agents):
   - High-precision N=500 baseline sims confirming S45 results
   - Variant sims (aggressive/defensive) across bare and giga tiers
   - Deep analysis of bare-tier bulwark dominance mechanics
   - Systematic sweep of guardImpactCoeff values (0.12, 0.14, 0.15, 0.16, 0.18) at N=500
   - guardUnseatDivisor testing (20, 22) and combined overrides

4. **Applied guardImpactCoeff 0.18→0.12** in balance-config.ts:
   - Bare: 13.2pp → 10.3pp (-22% spread, flags 3→1)
   - Epic: 3.1pp → 6.2pp (widened but still 0 flags, all archetypes 47.6-53.8%)
   - Giga: 4.5pp → 3.2pp (-29% spread, still 0 flags)
   - Trade-off: epic widens slightly, but bare+giga improve significantly

5. **Fixed 8 tests** across calculator.test.ts (3) and match.test.ts (5) for new guardImpactCoeff.

6. **3 UI improvements** (low-effort, high-impact):
   - Difficulty descriptions now show match duration estimates
   - Fatigue warning text + pulsing CSS when stamina drops below threshold
   - Unseat explanation text on melee transition screen

7. **Updated CLAUDE.md** — balance coefficients, win rate validation, variant impact sections.

8. **Color-coded attack counter hints** — "Beats" in green, "Weak to" in red on attack cards (was uniform faint color).

9. **Full matchup matrices** — generated N=500 matrices for bare and giga tiers. Bare has 3 skewed matchups (bulwark-charger 65%, breaker-bulwark 39%). Giga has ZERO skewed matchups.

10. **Breaker penetration investigation** — tested 0.30 and 0.35 (vs current 0.25). No improvement at bare tier (breaker's low total stats dominate over penetration benefit). Works at giga (55.8% vs bulwark at pen=0.30).

**Post-Tuning Win Rates (N=500)**:
```
Bare:  Bulwark 55.4% | Tactician 51.2% | Tech 51.2% | Duelist 50.6% | Charger 46.5% | Breaker 45.1%  [10.3pp, 1 flag]
Epic:  Charger 53.8% | Tech 50.1% | Tact 49.8% | Duelist 49.5% | Bulwark 49.1% | Breaker 47.6%  [6.2pp, 0 flags]
Giga:  Charger 51.4% | Tech 50.6% | Tact 50.6% | Duelist 50.3% | Breaker 48.9% | Bulwark 48.2%  [3.2pp, 0 flags]
```

**Variant Balance (N=300, post-tuning)**:
```
Giga Aggressive:  6.5pp, 0 flags (bulwark 52.8% top)
Giga Defensive:   3.5pp, 0 flags (breaker 51.9% top) — best variant
Bare Aggressive:  9.3pp, 2 flags (boundary: bulwark 55.3%, charger-skew)
Bare Defensive:  11.6pp, 2 flags (bulwark 56.3%, breaker 44.7% weak)
```

11. **Matchup matrix in text output** — simulate.ts text mode now includes a 6x6 P1 win rate matrix at the end.

**Dev QoL improvements**:
- Added `npm test` script to package.json
- Updated quick-sweep.json search config to center on current optimal values
- Added file logging to run-overnight.ps1 (v5→v6, logs to `orchestrator/overnight-*.log`)

**Key files modified in S46**:
- `src/engine/balance-config.ts` — guardImpactCoeff 0.18→0.12
- `src/engine/calculator.test.ts` — 3 test fixes for new coefficient
- `src/engine/match.test.ts` — 5 test fixes (worked examples)
- `src/tools/simulate.ts` — Added --matches N CLI flag
- `src/ui/SetupScreen.tsx` — Difficulty description updates
- `src/ui/PassResult.tsx` — Fatigue warning display
- `src/ui/MeleeTransitionScreen.tsx` — Unseat explanation text
- `src/App.css` — CSS for fatigue warnings, unseat explanation, counter hint colors
- `src/ui/AttackSelect.tsx` — Color-coded counter hints (beats=green, weak=red)
- `CLAUDE.md` — Updated balance data
- `package.json` — Added `npm test` script
- `orchestrator/search-configs/quick-sweep.json` — Updated param ranges to center on current optimals
- `orchestrator/run-overnight.ps1` — v5→v6, added file logging with timestamped log files

**Commands**:
```bash
cd C:/Users/rvecc/Documents/Jousting/Jousting/jousting-mvp
npx vitest run                                                    # 908 tests
npx tsx src/tools/simulate.ts bare balanced                        # Quick sim
npx tsx src/tools/simulate.ts bare balanced --matches 500          # High-precision sim
npx tsx src/tools/simulate.ts bare balanced --json                 # JSON output
npx tsx src/tools/simulate.ts bare --override guardImpactCoeff=0.15  # Test overrides
npx tsx src/tools/param-search.ts orchestrator/search-configs/focused-descent.json --dry-run  # Preview descent
npm run dev                                                        # Dev server
```

**What's next**:
1. **Bare tier bulwark remains structural** — bulwark's GRD=65 advantage at bare tier is a fundamental stat-vs-mechanic issue. Tested breakerGuardPenetration buff (0.30, 0.35) — no improvement at bare (breaker's low total stats dominate), though it helps at giga. Further improvement requires archetype stat adjustments (risky). Current 10.3pp/1 flag is acceptable.
2. **Epic tier charger dominance** — charger at 53.8% after guardImpactCoeff reduction. Could investigate charger-specific tuning if this becomes a concern.
3. **UI improvements backlog** — extensive analysis done (see session log). Top remaining items: attack counter hints during selection, mobile stat tooltips, mid-game match timeline, persistent match history.
4. **Deploy** — Pages is disabled; re-enable when ready with `gh api repos/wharambebusiness-netizen/jousting-mvp/pages -X PUT -f build_type=legacy -f source[branch]=gh-pages -f source[path]=/`
5. **Orchestrator run** — balance tuning infrastructure proven. Could launch a full overnight balance run.

**Matchup Matrices (N=500, post-S46)**:
```
BARE TIER (P1 win %)
             charger  tech     bulwark  tact     breaker  duelist
charger       49.2    45.4     32.4     43.6     53.6     45.8
technician    54.6    46.8     45.0     51.2     59.6     51.8
bulwark       65.4    53.0     50.8     57.8     59.0     56.2
tactician     54.6    47.0     48.0     53.4     52.4     50.0
breaker       50.8    40.6     39.4     43.2     51.4     43.8
duelist       59.2    47.0     48.0     50.4     56.4     48.0

GIGA TIER (P1 win %) — NEAR-PERFECT
             charger  tech     bulwark  tact     breaker  duelist
charger       53.6    50.0     48.4     52.0     57.8     52.0
technician    49.2    49.6     51.0     50.6     48.6     51.4
bulwark       48.0    50.4     49.2     42.0     47.2     47.6
tactician     51.0    49.2     53.2     48.8     50.4     51.6
breaker       51.2    51.0     53.0     48.8     49.4     52.6
duelist       46.4    50.6     50.4     43.2     49.2     49.0

Bare skewed: bulwark-charger (65.4%), breaker-bulwark (39.4%)
Giga skewed: NONE (all matchups 42-58%)
```

**Working style**: Full autonomy, make decisions, don't ask for approval. Full permissions granted.

---

## Session Log

S46 focused on further balance tuning and UI polish:

1. Read S45 handoff, confirmed 908 tests passing
2. Disabled GitHub Pages deploy (API: switched build_type to workflow)
3. **Phase 1 — Validation & Analysis** (4 parallel agents):
   - Verified 908 test baseline
   - High-precision N=500 sims: bare 13.2pp/3flags, epic 3.1pp/0flags, giga 4.5pp/0flags
   - Variant sims (aggressive/defensive at giga+bare): all stable, giga defensive best (3.5pp)
   - Deep bulwark dominance analysis: GRD double-dips on impact penalty + melee thresholds
4. **Phase 2 — Override Testing** (2 parallel agents):
   - guardImpactCoeff sweep (0.12, 0.14, 0.15): 0.12 best for bare, 0.15 counterintuitively worse
   - guardUnseatDivisor testing (20, 22): minimal effect on bare bulwark
   - Combined (coeff=0.15 + div=20): 11.9pp bare, 2.4pp giga — decent but not best
5. Added --matches N flag to simulate.ts (simulate.ts was ignoring it before)
6. **Phase 3 — High-N Validation** (N=500 across all tiers):
   - Tested 0.12, 0.14, 0.15, 0.16 vs 0.18 baseline
   - 0.12: best combined score (19.7) with fewest flags (1)
   - 0.15: best raw combined (19.3) but 3 flags
   - Decision: apply 0.12 (only value that clears bare-tier flags)
7. Applied guardImpactCoeff 0.18→0.12 to balance-config.ts
8. Fixed 8 tests in parallel (calculator.test.ts + match.test.ts agents)
9. Full validation: 908/908 passing, sims confirmed improvements
10. Variant validation (N=300): all stable, giga defensive improved to 3.5pp
11. Updated CLAUDE.md (balance coefficients + win rates + variants)
12. Updated MEMORY.md with S46 status
13. UI improvements: difficulty descriptions, fatigue warnings, unseat explanation + CSS
14. Final state: 908/908 tests, all changes validated

### Balance Sweep Data (N=500, guardImpactCoeff)

| Value | Bare Spread | Bare Flags | Epic Spread | Epic Flags | Giga Spread | Giga Flags | Combined |
|-------|-------------|------------|-------------|------------|-------------|------------|----------|
| 0.12  | 10.3pp      | 1          | 6.2pp       | 0          | 3.2pp       | 0          | 19.7     |
| 0.14  | 12.1pp      | 3          | 5.2pp       | 0          | 2.3pp       | 0          | 19.6     |
| 0.15  | 12.3pp      | 3          | 4.6pp       | 0          | 2.4pp       | 0          | 19.3     |
| 0.16  | 12.3pp      | 3          | 5.6pp       | 0          | 2.3pp       | 0          | 20.2     |
| 0.18  | 13.2pp      | 3          | 3.1pp       | 0          | 4.5pp       | 0          | 20.8     |

Decision rationale: 0.12 is the only value that reduces bare-tier flags from 3→1 (eliminates WEAK charger and bulwark-charger SKEW flags). Combined scores are within noise (19.3-20.8), so flag count is the tiebreaker.
