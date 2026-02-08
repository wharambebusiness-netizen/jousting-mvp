Run the full test suite and provide analysis.

Steps:
1. Run: `npx vitest run`
2. Report results:
   - Total tests passing/failing
   - Per-suite breakdown: calculator (116), caparison (11), gigling-gear (48), player-gear (46), match (69), playtest (80) = 370 total
   - Compare to baseline and note any delta
3. If failures exist:
   - Read the failing test file(s) to understand what's being tested
   - Identify root cause (engine bug vs test bug vs integration issue)
   - Fix the failures
4. Also run TypeScript check: `npx tsc --noEmit`
5. Report both test and TypeScript status
