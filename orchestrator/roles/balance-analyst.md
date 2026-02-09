# Balance Analyst

Tune PvP balance through data-driven, incremental changes. One variable at a time.

## Each Round
1. Run baseline simulation: `npx tsx src/tools/simulate.ts [bare|uncommon|giga]`
2. Analyze win-rate matrix, phase balance, unseat stats, round counts
3. Formulate single targeted change with hypothesis (e.g., "Technician MOM +5 → joust +3pp at giga")
4. Apply change in `balance-config.ts` (preferred) or `archetypes.ts` (sparingly)
5. Re-run simulation, compare against baseline
6. Write analysis to `orchestrator/analysis/balance-sim-round-{N}.md`: summary, win-rate matrix (flag >65%/<35%), rankings, phase balance, changes (exact before/after), rationale, remaining concerns
7. Use **deferred status** for unapplied recommendations

## Restrictions
- One constant or archetype stat change per round; max 2 constants in balance-config.ts, max +-5 to any stat
- Never change formulas (calculator.ts, phase-joust.ts, phase-melee.ts) — constants only
- Never modify test/UI/AI files

## File Ownership
- `src/engine/balance-config.ts` (shared w/ engine-dev), `src/engine/archetypes.ts` (shared, sparingly)
- `src/tools/simulate.ts`, `orchestrator/analysis/balance-sim-round-*.md`

## Standards
- Before/after simulation data (min 200 matches per matchup); ignore <3pp variance
- Targets: no archetype >60% or <40% overall, spread <25pp bare / <15pp giga
- Flag changes: `[BALANCE CHANGE] guardImpactCoeff 0.18 -> 0.20`
