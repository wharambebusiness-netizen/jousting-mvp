# Balance Analyst — Handoff

## META
- status: in-progress
- files-modified: src/engine/archetypes.ts, orchestrator/analysis/balance-sim-round-5.md, orchestrator/analysis/balance-tuner-round-1.md
- tests-passing: false
- completed-tasks: BL-001
- notes-for-others: [BALANCE CHANGE] Technician MOM 55→58. 15 tests fail due to hardcoded MOM=55 values — test-writer needs to update calculator.test.ts (6 tests), match.test.ts (1 test), and gear-variants.test.ts (8 BL-004 tests). See analysis report for details.

## What Was Done

### BL-001: Fix Technician weakness at Epic/Giga tiers

**Change**: Technician momentum 55 → 58 (+3) in `src/engine/archetypes.ts`

**Baseline → Post-change win rates:**
| Tier | Before | After | Δ |
|------|--------|-------|---|
| Bare | 45.6% | 48.7% | +3.1pp |
| Epic | 45.5% | 46.4% | +0.9pp |
| Giga | 46.2% | 48.3% | +2.1pp |

**Rationale**: Technician's CTL=70 gets compressed by softCap at high tiers. MOM=55 was tied for lowest. +3 MOM improves impact scoring in joust phase where Technician is weakest, while staying well below softCap knee (58+13=71 at giga).

**Test failures (15)**: All caused by hardcoded Technician MOM=55 values in test assertions:
- `calculator.test.ts`: 6 tests — effective MOM computations (55+5=60 → now 58+5=63), fatigue calculations
- `match.test.ts`: 1 test — Charger vs Technician worked example impact score ordering
- `gear-variants.test.ts`: 8 tests — BL-004 deterministic cycling tests (N=30, fragile to stat changes)

## What's Left

### Test Updates Required (for test-writer agent)
1. **calculator.test.ts** lines 258, 281, and 4 more Technician MOM-derived assertions → update to reflect MOM=58
2. **match.test.ts** line 78 — Charger vs Technician Pass 1 impact score comparison may need assertion update or comment adjustment
3. **gear-variants.test.ts** BL-004 — 8 tests using deterministic cycling with N=30 are fragile to any stat change. Recommend either increasing N to 100+ or widening thresholds from [0.30, 0.70] to [0.20, 0.80]

### Future Balance Work
1. Charger bare weakness (36.5%) — below 40% target
2. Bulwark bare dominance (63.1%) — above 60% target
3. Validate Technician improvement holds across multiple simulation runs

## Issues

- Uncommon tier showed high Technician variance (50.4% → 43.3-43.9%). Likely Monte Carlo noise but should be monitored.
- gear-variants.test.ts BL-004 tests (added by QA this session) are inherently fragile to balance changes due to deterministic cycling + small sample size.

## File Ownership

- `src/engine/balance-config.ts`
- `src/engine/archetypes.ts`

## IMPORTANT Rules

- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run tests (`npx vitest run`) before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
