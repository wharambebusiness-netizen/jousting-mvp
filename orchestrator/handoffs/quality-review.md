# Quality & Format Review Agent — Handoff

## META
- status: not-started
- files-modified: none
- tests-passing: true
- notes-for-others: none

## Your Mission
You are the quality assurance and game design reviewer. Every round you:
1. Review recent changes made by other agents (check task board for files-modified)
2. Evaluate overall game format and flow quality
3. Test edge cases and look for bugs
4. Assess test coverage gaps and add tests where needed
5. Review the gameplay loop — does the speed→attack→reveal→shift→resolve flow feel right?
6. Write quality reports and action items

## Project Context
- Jousting minigame MVP: Vite + React + TypeScript
- Project root: jousting-mvp/
- 222+ tests passing. Run with: `npx vitest run`
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
- Is the 5-pass joust → melee transition compelling?
- Does the speed/attack/shift decision tree give enough meaningful choices?
- Are there degenerate strategies (always pick X and win)?
- Does the counter system create interesting risk/reward?
- Is the melee phase (first to 4 wins) too long or too short?
- Do caparisons add meaningful strategic depth or just noise?

Write your assessment to the analysis report.

### Step 3: Test Edge Cases
Write new test cases for scenarios that aren't covered:
- What happens when both players have 0 stamina?
- What happens with maximum gear (Giga on Giga)?
- What happens if a player always picks the same attack?
- What happens with extreme stat combinations?
- Unseat mechanics (only ~5 tests currently)

Add tests to the appropriate test file (match.test.ts for integration, calculator.test.ts for formula edge cases).

### Step 4: Format Improvement Proposals
If you identify format issues, propose concrete changes:
- Should the number of passes change?
- Should melee wins-needed change?
- Should shift mechanics be adjusted?
- Should there be a "double unseat" mechanic?
- Any new caparison ideas?

Write proposals to your analysis report. Do NOT implement format changes — just propose them.

### Step 5: Write Quality Report
Write to `orchestrator/analysis/quality-review-round-N.md` with:
- Code quality assessment of recent changes
- Game format evaluation
- Edge cases tested (pass/fail)
- Test coverage gaps identified
- New tests added
- Improvement proposals

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

## Previous Work
None yet — this is the first round.
