# Session 49 Handoff — Orchestrator v10: Adaptive Timeouts, Lookahead, Incremental Tests

## Summary
Implemented three efficiency improvements to the orchestrator: adaptive per-agent timeouts, multi-round lookahead to skip empty rounds, and incremental testing to only run affected test suites. All changes are in `orchestrator/orchestrator.mjs` (3134 → 3311 lines, +177 net). 908 game tests still passing.

## What Changed

### `orchestrator/orchestrator.mjs` (3134 → 3311 lines)

**1. Adaptive Timeouts (Phase 1.3 — saves stuck-agent waste)**
- Added `agentRuntimeHistory` (module-scope, persists across rounds/missions) — tracks last 5 runtimes per agent in seconds
- `recordAgentRuntime(agentId, elapsedSeconds)` — called from `processAgentResult()` on successful non-timeout runs
- `getAdaptiveTimeout(agent)` — computes `Math.min(Math.max(2 * avgMs, configTimeout * 0.25, 120000), configTimeout)`
  - First run: uses configured timeout (no history yet)
  - After history: 2x average runtime, floored at 25% of configured max or 2 minutes, capped at configured max
- `runAgent()` updated to call `getAdaptiveTimeout()` instead of using flat `agent.timeoutMs || CONFIG.agentTimeoutMs`
- Logs adapted timeout when it's lower than configured: `adaptive timeout: 4.2min (avg 2.1min, max 20min)`

**2. Multi-Round Lookahead (Phase 3.9 — saves empty-round overhead)**
- At the "No agents can run this round" check (~line 2538), instead of just `continue`:
  - Scans all agents with `minFrequencyRounds` set
  - Computes the next round where any agent would be due: `lastRan + minFrequencyRounds`
  - If `nextActivation > round + 1`, jumps `round` forward (loop increment handles +1)
  - Records skipped rounds in `roundLog` for visibility: `note: "skipped (lookahead → N)"`
  - Logs: `No agents can run. Skipping X empty round(s) → jumping to round Y.`
- Falls back to original single-round `continue` if lookahead is only 1 round ahead
- Safety: never jumps backwards (`nextActivation <= round` → clamp to `round + 1`)

**3. Incremental Testing (Phase 2.6 — saves ~10s/round)**
- `SOURCE_TO_TESTS` mapping — maps 9 source files to their test suites:
  - `calculator.ts` → calculator.test.ts, gear-variants.test.ts
  - `balance-config.ts` → calculator.test.ts, playtest.test.ts, gear-variants.test.ts
  - `phase-joust.ts`, `phase-melee.ts` → phase-resolution.test.ts, match.test.ts
  - `match.ts` → match.test.ts
  - `gigling-gear.ts` → gigling-gear.test.ts, gear-variants.test.ts
  - `player-gear.ts` → player-gear.test.ts, gear-variants.test.ts
  - `archetypes.ts` → playtest.test.ts, match.test.ts, gear-variants.test.ts
  - `attacks.ts` → calculator.test.ts, phase-resolution.test.ts, match.test.ts
  - `src/ai/*` → ai.test.ts
- `FULL_SUITE_TRIGGERS` — `types.ts`, `index.ts` always trigger full suite
- Unknown `src/engine/` or `src/ui/` files trigger full suite (conservative)
- Non-src files (CSS, MD, orchestrator) don't trigger any tests
- `getTestFilter(modifiedFiles)` returns: `null` (full), `''` (skip), or regex string for `--testPathPattern`
- `runTests(testFilter)` — accepts optional filter parameter:
  - `null` → full suite (default, backwards compatible)
  - `''` → skip tests entirely (resolves with `passed: true, skipped: true`)
  - `string` → vitest `--testPathPattern <filter>`
- `processAgentResult()` now returns `{ status, isEmptyWork, filesModified }` — files collected from handoff META
- `roundModifiedFiles` array accumulated during Phase A agent pool callbacks
- Round 1: always full suite (baseline)
- After revert: always full suite (existing `runTests()` calls have no filter)
- Final tests at end of run: always full suite

**4. Housekeeping**
- Version bumped to v10 in header comment, startup banner, and report template
- Added v9 additions block to header (was missing — v9 changes documented in v10 header)

## Verification

### Syntax check
```
node -c orchestrator/orchestrator.mjs → OK
```

### Game tests
```
npx vitest run → 908 passed (8 suites)
```

### Smoke test (overnight mission, 7 agents)
- Orchestrator starts cleanly with v10 banner
- Agent filtering works correctly (producer + reviewer active, 5 idle)
- Phase B launches coordination agents as expected
- No startup errors

## What's NOT Yet Tested
- Adaptive timeout kicking in (requires 2+ rounds with same agent to build history)
- Multi-round lookahead jumping forward (requires agents with `minFrequencyRounds` set + empty rounds)
- Incremental test filter actually selecting suites (requires code agent to modify specific source files)
- Skip-tests-entirely path (requires round where only non-src files modified)
- All paths are structurally correct but need a multi-round overnight run to exercise

## Impact Estimates
- **Adaptive timeouts**: 0-15 min saved per stuck agent (prevents 20-min timeout waste when avg is 3 min → timeout at 6 min)
- **Multi-round lookahead**: 5-30 seconds per skipped empty round (git tag, handoff parsing, logging). Could skip 5-10 rounds per overnight run
- **Incremental testing**: ~5-8 seconds per round when only 1-2 suites affected (saves running all 8). Biggest win is for CSS-only or orchestrator-only changes that skip tests entirely

## Commits
- Not yet committed (ready for commit)

## Next Steps (from Efficiency Roadmap)
1. **Priority-based scheduling** (Phase 1.2) — fast-track P1 regressions/test fixes
2. **Context-aware prompt trimming** (Phase 2.4) — only inject sections an agent needs
3. **Task decomposition** (Phase 2.5) — break large tasks into focused 5-min subtasks
4. **Unified agent pool** (Phase 3 item 5) — eliminate Phase A/B barrier

## Files Modified
- `orchestrator/orchestrator.mjs` — adaptive timeouts, multi-round lookahead, incremental testing, v10 version bump
