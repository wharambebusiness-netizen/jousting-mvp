# Overnight Orchestrator Report
> Generated: 2026-02-26 06:04:50
> Orchestrator: v28

## Summary
- **Started**: 2026-02-26 06:04:50
- **Ended**: 2026-02-26 06:04:50
- **Total runtime**: 0.0 minutes (0.0 hours)
- **Rounds completed**: 3
- **Stop reason**: max rounds reached
- **Mission**: C:\Users\rvecc\AppData\Local\Temp\dry-run-integ-1772085889037\regression-mission.json
- **Final test status**: FAILING (1123 passed, 3 failed)

## Agent Results

| Agent | Type | Role | Final Status | Rounds Active | Timeouts | Errors | Files Modified |
|-------|------|------|-------------|---------------|----------|--------|----------------|
| dev | feature | engine-dev | all-done | 1 | 0 | 0 | 1 |
| qa | feature | engine-dev | in-progress | 2 | 0 | 2 | 1 |

### Agent Details

#### Dev (dev)
- **Status**: all-done
- **Rounds active**: 1
- **Files modified**: src/engine/types.ts
- **Notes**: [dry-run] Mock output for round 1

#### QA (qa)
- **Status**: in-progress
- **Rounds active**: 2
- **Files modified**: (none)
- **Notes**: [dry-run] Mock output for round 3
- **Errors**: 2
- **Escalations**: 1

## Round-by-Round Timeline

| Round | Agents | Test Result | Agent Pool | Tests | Pre-Sim | Post-Sim | Overhead | Total |
|-------|--------|-------------|------------|-------|---------|----------|----------|-------|
| 1 | qa(ERROR(1), 0m), dev(OK, 0m) | FAIL (1123p, 3f) | 0s | — | — | — | 0s | 0s |
| 2 | — | — | — | — | — | — | — | skipped (all blocked) |
| 3 | qa(ERROR(1), 0m) | PASS (skipped) | 0s | — | — | — | — | 0s |

## All Files Modified
- (none)
- src/engine/types.ts

## Test Trajectory
- Round 1: FAIL (1123 passed, 3 failed)
- Round 3: PASS (skipped passed)

## Round Quality (v14)

| Round | Active | Idle | Util% | Files | OK | Failed |
|-------|--------|------|-------|-------|----|--------|
| 1 | 2 | 0 | 100% | 2 | 1 | 1 |
| 2 | — | — | — | — | — | skipped (all blocked) |
| 3 | 1 | 1 | 50% | 1 | 0 | 1 |

## Agent Effectiveness (v14)

| Agent | Rounds | Tasks Done | Files | Tokens/File | Cost/Task | Avg Time | Prod% |
|-------|--------|------------|-------|-------------|-----------|----------|-------|
| qa | 2 | 2 | 2 | 0 | $0.0000 | 0.0m | 100% |
| dev | 1 | 1 | 1 | 11909 | $0.0916 | 0.0m | 100% |

> **Prod%** = rounds with meaningful file output / total rounds run. **Tokens/File** = total tokens consumed / files modified.


## Session Continuity (v16)

> No session data captured (all agents ran fresh only).


## Agent Efficiency (v6.1 Metrics)

| Agent | Model | Avg Time | Success | Files/Rnd | Active | Skipped | Blocked | Idle% |
|-------|-------|----------|---------|-----------|--------|---------|---------|-------|
| dev | default | 0.0m | 100% | 1.0 | 1/3 | 2 | 0 | 67% |
| qa | opus | 0.0m | 0% | 0.5 | 2/3 | 1 | 0 | 33% |

## Backlog Velocity (v8)

| Round | Pending | Completed | Notes |
|-------|---------|-----------|-------|
| 1 | 3 | 0 | |
| 2 | — | — | skipped (all blocked) |
| 3 | 3 | 0 | |

## Cost Summary

| Agent | Model | Rounds | Input Tokens | Output Tokens | Est. Cost | Avg Cost/Round | Escalations |
|-------|-------|--------|-------------|---------------|-----------|----------------|-------------|
| dev | default | 1 | 9.2k | 2.7k | $0.0916 | $0.0916 | 0 |
| qa | opus | 2 | — | — | — | — | 1 |
| **TOTAL** | | **3** | **9.2k** | **2.7k** | **$0.0916** | **$0.0305** | **1** |

- **Cost per successful agent-round**: $0.0916
- **Pricing basis**: haiku ($0.25/$1.25 per M in/out), sonnet ($3/$15), opus ($15/$75)
- **Note**: Costs are estimates from token counts if CLI did not report direct cost

## Model Escalation Summary

| Agent | Base Model | Max Model | Final Model | Escalations |
|-------|-----------|-----------|-------------|-------------|
| dev | default | none | default | 0 |
| qa | sonnet | none | opus | 1 |

## Decision Log Summary

| Agent | Included | Skipped | Blocked | Success Rate |
|-------|----------|---------|---------|-------------|
| dev | 1 | 2 | 0 | 100% |
| qa | 2 | 1 | 0 | 0% |

> Full decision log: `orchestrator/logs/round-decisions.json`

## Analysis Reports Generated
- reviewer round 47: `C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp\orchestrator\analysis\reviewer-round-47.md`
- reviewer round 49: `C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp\orchestrator\analysis\reviewer-round-49.md`
- designer round 50: `C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp\orchestrator\analysis\designer-round-50.md`

## How to Review
1. Read each agent's handoff for detailed work log: `orchestrator/handoffs/<agent>.md`
2. Read analysis reports: `orchestrator/analysis/`
3. Check git log for per-round commits: `git log --oneline`
4. To revert to before the run: `git log --oneline` and find the pre-orchestrator commit
5. Run tests: `npm test`
