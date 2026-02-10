# QA Engineer — Handoff

## META
- status: complete
- files-modified: src/engine/calculator.test.ts, orchestrator/analysis/qa-round-2.md
- tests-passing: true
- test-count: 830
- completed-tasks: none (self-directed softCap testing)
- notes-for-others: Added 8 softCap boundary tests (822→830). All passing. No bugs found. Giga tier balance excellent (5.5pp spread). Bare tier Bulwark dominance confirmed (60.7%).

## What Was Done

### Self-Directed: SoftCap Combat Boundary Tests (Complete)
Added **8 new tests** to `calculator.test.ts` (lines 2018-2135) covering softCap behavior in real combat scenarios:

1. **Exact boundary (99/100/101)**: Verifies knee transition precision
2. **Multiple stats over knee**: Both MOM and GRD > 100 simultaneously
3. **Asymmetric softCap**: Giga player vs bare player ratio compression (1.53 → 1.49)
4. **Attack deltas crossing knee**: Base 97 + attack +5 → 102 crosses knee mid-combat
5. **SoftCap + fatigue (over knee)**: Stat at 110 fatigued to 21.4 (below knee)
6. **SoftCap + fatigue (below knee)**: Stat at 85 fatigued to 34.6 (stays below)
7. **Guard crossing knee with PdL**: Port de Lance +20 pushes guard 85→105
8. **Extreme values (150+)**: Heavy compression, monotonic property preserved

**Calculator test count**: 194 → 202 (+8)
**Total test count**: 822 → 830 (+8)

### Balance Simulations Run

Ran baseline simulations to verify current balance state:

- **Bare tier**: Bulwark 60.7% (dominant, flagged), 20.9pp spread
- **Giga tier**: 5.5pp spread, excellent balance, softCap working correctly
- **Mixed tier**: Bulwark 53.8% (elevated but not flagged), 7.0pp spread

All simulations stable (±2pp variance). No softCap-related bugs detected.

### QA Analysis Report

Wrote comprehensive analysis to `orchestrator/analysis/qa-round-2.md`:
- Test coverage breakdown
- Key findings (softCap+fatigue ordering, asymmetric scenarios, extreme values)
- Simulation results and balance assessment
- Coverage gaps for future rounds
- Zero bugs found

## What's Left

**Nothing**. Round 2 self-directed work complete. Ready for next assignment.

## Issues

**None**. All 830 tests passing. No engine defects discovered. No regressions.

### Test Development Notes

**Challenges**:
1. JOUST_ATTACKS/MELEE_ATTACKS are objects, not arrays — used direct property access
2. Edit tool silently failed — switched to Bash heredoc append
3. Expected value miscalculation — verified softCap formula manually

**Key Learnings**:
- SoftCap applies BEFORE fatigue (ordering matters for correctness)
- Attack deltas can push stats over knee mid-combat (PdL +20 guard)
- Asymmetric gear creates ~2-3% ratio compression (working as intended)
- Extreme values (150+) handled gracefully, no overflow

### Coverage Gaps Identified

For future rounds:
1. Melee carryover + softCap interactions (partially covered)
2. All 36 archetype matchups at giga (currently N=30 in gear-variants)
3. SoftCap + counter bonus scaling edge cases
4. SoftCap + breaker penetration order-of-operations
5. INIT not softCapped — verify no giga dominance from uncapped INIT

## Your Mission

Each round: pick ONE untested area and write 5-10 new tests for it. Focus areas in order: 1) gear variant interactions, 2) archetype matchup edge cases, 3) stamina/fatigue boundary conditions, 4) softCap behavior near knee=100, 5) melee phase resolution edge cases. Run full suite to verify no regressions. Also fix any test assertions broken by balance changes from other agents.

## File Ownership

- `src/engine/calculator.test.ts`
- `src/engine/match.test.ts`
- `src/engine/playtest.test.ts`
- `src/engine/gear-variants.test.ts`
- `src/engine/phase-resolution.test.ts`

## IMPORTANT Rules
- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run tests (`npx vitest run`) before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
