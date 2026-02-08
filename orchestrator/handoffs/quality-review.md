# Quality & Format Review Agent — Handoff

## META
- status: complete
- files-modified: src/engine/calculator.test.ts, src/engine/match.test.ts, orchestrator/analysis/quality-review-round-1.md
- tests-passing: true
- notes-for-others: 295 tests all passing. No bugs found. CounterResult type comment in types.ts:185 says "+10, -10, or 0" but bonus now scales with CTL (range ~4-14) — minor doc issue for ai-engine agent. Breaker has no unique mechanic beyond stats — potential future work.

## What Was Done

### Round 1: Full Codebase Review + Edge Case Tests
1. **Reviewed all engine files**: calculator.ts, match.ts, phase-joust.ts, phase-melee.ts, attacks.ts, archetypes.ts, gigling-gear.ts, types.ts, balance-config.ts
2. **Evaluated game format**: 5-pass joust, counter system, shift mechanics, melee phase, caparisons — all assessed as well-designed with no degenerate strategies
3. **Added 28 new edge case tests** covering:
   - Both players 0 stamina (full pass, unseat impossibility)
   - Shift cost differences (same-stance vs cross-stance)
   - Maximum gear stacking (Giga on Giga formulas)
   - Counter bonus asymmetry (only winner CTL matters)
   - Unseat threshold extremes (min/max)
   - Melee at guard 0 with carryover penalties
   - All 6 joust attacks as degenerate strategy (mirror 5x)
   - All 6 melee attacks mirror matchup (all draw)
   - Melee exhaustion with unequal wins
   - Unseat naming convention (player1 = unseater, not unseated)
   - Varied attack selection across 5 passes
   - Melee stamina drain tracking
4. **Wrote full quality report**: orchestrator/analysis/quality-review-round-1.md

### Test Count
- Before: 222 tests
- After: 295 tests (+73)
- All 295 passing

## What's Left

### Stretch Goals (for future rounds)
1. Add test for non-mirror double unseat (both exceed threshold with different margins, different archetypes)
2. Add shift eligibility boundary test at exact CTL threshold
3. Review changes from other agents as they come in (ai-engine, ui-polish, balance-sim)
4. Assess AI behavior quality once ai-engine agent makes changes
5. Test with gear loadouts more thoroughly (full match with Giga gear + all caparison combinations)

## Issues
- **Minor**: CounterResult type comment in types.ts says "+10, -10, or 0" but the scaled formula produces a range. Not a bug — just stale documentation.
- **No bugs found** in engine, formulas, or state machine.

## Previous Work
- Round 1: Full codebase review, game format evaluation, 28 new tests added.

## Your Mission
You are the quality assurance and game design reviewer. Every round you:
1. Review recent changes made by other agents (check task board for files-modified)
2. Evaluate overall game format and flow quality
3. Test edge cases and look for bugs
4. Assess test coverage gaps and add tests where needed
5. Review the gameplay loop — does the speed->attack->reveal->shift->resolve flow feel right?
6. Write quality reports and action items

## Project Context
- Jousting minigame MVP: Vite + React + TypeScript
- Project root: jousting-mvp/
- 295 tests passing. Run with: `npx vitest run`
- Full architecture reference: jousting-handoff-s17.md
- Test files: src/engine/*.test.ts (calculator, match, caparison, gigling-gear, playtest)

## What to Do Each Round

### Step 1: Review Changes
Read the task board to see what other agents modified. Read those files and assess:
- Code quality (clean, readable, no dead code)
- Consistency with existing patterns
- Type safety (no `any` types, proper interfaces)
- No accidental regressions

### Step 2: Evaluate Game Format
Think critically about the jousting format:
- Is the 5-pass joust -> melee transition compelling?
- Does the speed/attack/shift decision tree give enough meaningful choices?
- Are there degenerate strategies (always pick X and win)?
- Does the counter system create interesting risk/reward?
- Is the melee phase (first to 4 wins) too long or too short?
- Do caparisons add meaningful strategic depth or just noise?

Write your assessment to the analysis report.

### Step 3: Test Edge Cases
Write new test cases for scenarios that aren't covered.
Add tests to the appropriate test file (match.test.ts for integration, calculator.test.ts for formula edge cases).

### Step 4: Format Improvement Proposals
If you identify format issues, propose concrete changes.
Write proposals to your analysis report. Do NOT implement format changes — just propose them.

### Step 5: Write Quality Report
Write to `orchestrator/analysis/quality-review-round-N.md`.

## Files You Own
- src/engine/calculator.test.ts — can ADD new test cases
- src/engine/match.test.ts — can ADD new test cases
- src/engine/caparison.test.ts — can ADD new test cases
- src/engine/playtest.test.ts — can ADD new test cases
- orchestrator/analysis/quality-review-*.md — your reports

## Files You Must NOT Edit
- src/engine/balance-config.ts (owned by balance-sim)
- src/engine/archetypes.ts (owned by balance-sim)
- src/ai/basic-ai.ts (owned by ai-engine)
- src/ui/* (owned by ui-polish / ai-reasoning)
- src/App.tsx (shared)
- src/engine/types.ts (owned by ai-engine)

## IMPORTANT: You May Only ADD Tests, Not Modify Engine Code
Your role is review and testing, not implementation. If you find bugs:
1. Write a failing test that demonstrates the bug
2. Note it in your handoff under "Bugs Found"
3. The relevant agent will fix it in the next round

The only code you should write is NEW TEST CASES in existing test files.

## Safety Rules
- NEVER modify engine code (calculator.ts, phase-joust.ts, phase-melee.ts, match.ts)
- NEVER modify UI code
- ONLY add new test cases (append to existing test files)
- ALWAYS run the full test suite after adding tests
- If your new test reveals a bug, that's GOOD — document it, don't try to fix it
