# Session 73 Handoff

## Summary
Three orchestrator improvements: dry-run smoke test mode (HIGH), mission config validation (MEDIUM), and getDynamicConcurrency edge case fix (LOW). Added 63 new tests across 2 new test suites + 1 updated test. Orchestrator bumped to v28.

## What Was Done

### 1. Dry-Run / Smoke Test Mode (HIGH)
Added `--dry-run` flag to orchestrator that exercises the full core loop with mock agent results. No API credits needed, no git operations performed.

**Architecture:**
- Created `orchestrator/mock-runner.mjs` — mock `runAgent()`, `mockRunTests()`, and `dryRunGitOps` no-ops
- Configurable per-agent behavior via `setMockBehavior()` / `setMockScenario()` (success, failure, timeout, empty work)
- Mock runner writes synthetic handoff files matching real META format
- Generates mock cost stderr matching claude CLI output format
- In `orchestrator.mjs`: `DRY_RUN` const from `--dry-run` argv, dispatches to mock/real for runAgent, runTests, and 11 git operations
- CLI arg parsing updated: `process.argv.slice(2).find(a => !a.startsWith('--'))` for mission path (skips flags)
- Auto-caps maxRounds to 3 in dry-run (unless mission config sets it)
- Banner shows `[DRY-RUN MODE]` in startup output

**Usage:**
```bash
node orchestrator/orchestrator.mjs --dry-run                    # Default agents, 3 rounds
node orchestrator/orchestrator.mjs missions/overnight.json --dry-run  # Mission config, 50 rounds
```

### 2. Mission Config Validation (MEDIUM)
Added `validateMissionConfig()` pure function to `mission-sequencer.mjs`. Validates mission configs with clear error messages on bad input.

**Coverage:**
- Required fields: `name`, `agents` array (non-empty)
- Config overrides: `maxRounds` (positive), `maxConcurrency` (non-negative), `agentTimeoutMs`/`maxRuntimeMs` (>= 1000)
- Agent shape: `id` + `name` required, valid `type` (feature/continuous/spawned), valid `model`/`maxModel` (haiku/sonnet/opus)
- Agent constraints: `timeoutMs` >= 1000, `maxBudgetUsd` > 0, `maxTasksPerRound` >= 0, `minFrequencyRounds` >= 0
- `dependsOn` must be array, references must exist, no self-references
- `fileOwnership` must be array or `"auto"`
- Duplicate agent IDs detected
- Sequence missions: `name`, `missions` array, entry `path` required, `maxRounds` positive
- Validation runs at both entry points: `loadMissionOrSequence()` and `loadMission()`

### 3. Fix getDynamicConcurrency Edge Case (LOW)
One-line fix in `agent-tracking.mjs:96`. When `agentCount < configured` and speed ratio > 3x, `Math.min(configured + 1, agentCount)` could return less than `configured`. Fixed with `Math.max(Math.min(configured + 1, agentCount), configured)` — bump never reduces below configured.

## Files Modified
- `orchestrator/orchestrator.mjs` — v28: dry-run integration, mission validation, version bump
- `orchestrator/agent-tracking.mjs` — getDynamicConcurrency fix (line 96)
- `orchestrator/mission-sequencer.mjs` — validateMissionConfig() + validateSequenceConfig() + validation call
- `orchestrator/agent-tracking.test.mjs` — updated edge case test expectation
- `CLAUDE.md` — updated test counts (1123→1186, 16→18 suites), added dry-run command, mock-runner module

## Files Created
- `orchestrator/mock-runner.mjs` — dry-run mock runner module
- `orchestrator/mock-runner.test.mjs` (20 tests) — mock agent, tests, git ops, scenarios
- `orchestrator/mission-validator.test.mjs` (43 tests) — valid configs, required fields, config overrides, agent validation, cross-agent, sequences, multi-error
- `docs/archive/handoff-s73.md` — this handoff

## Test Status
1186 tests, 18 suites — ALL PASSING (908 engine + 278 orchestrator)

## Orchestrator Version
**v28** (up from v27). Changes: dry-run mode, mission validation, getDynamicConcurrency fix.

## What's Next

### 1. End-to-End Dry-Run Integration Test (HIGH)
The dry-run infrastructure is in place but hasn't been exercised end-to-end (we'd need to spawn a subprocess). Consider adding an integration test that actually runs `node orchestrator.mjs --dry-run` with a tiny mission config and verifies it completes successfully.

### 2. Cycle Detection in Mission Config Dependencies (MEDIUM)
The validator checks for self-references and missing dependsOn targets, but doesn't detect multi-hop cycles (A→B→C→A). Could reuse the DAG scheduler's Kahn's algorithm for cycle detection.

### 3. Balance Config Validation (LOW)
The mission validator doesn't yet validate `balanceConfig` shape (sim configs, convergence criteria). Could add schema validation for those nested structures.

### 4. Dry-Run Scenario Presets (LOW)
Add CLI flags like `--dry-run=chaos` (random failures/timeouts) or `--dry-run=regression` (agent causes test regression) to exercise error recovery paths.
