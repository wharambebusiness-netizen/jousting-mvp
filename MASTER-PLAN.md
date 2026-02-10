# Jousting MVP — Master Plan

> Generated: 2026-02-09 (S32)
> Primary goal: **Perfect the multi-agent orchestrator**
> The jousting game is the testbed — a feature-complete codebase with 794 tests,
> 6 archetypes, 12-slot gear, 3 AI difficulties, and known balance issues that
> give agents real work to do.

---

## Phase Overview

```
Phase 1: Instrument & Harden     [~4h]   ← Cost tracking, model escalation, fix stale data
Phase 2: Seed Agent Work          [~4h]   ← Undefer balance fix, give agents real tasks to chew on
Phase 3: Overnight Run #2         [~10h]  ← First run with v5 + cost visibility + 3-tier models
Phase 4: Analyze & Tune           [~4h]   ← Review cost data, agent effectiveness, failure modes
Phase 5: Orchestrator Iteration   [~8h]   ← Fix issues found in Run #2, improve agent prompts/roles
Phase 6: Overnight Run #3         [~10h]  ← Validate improvements, compare metrics to Run #2
Phase 7: Advanced Orchestration   [~12h]  ← Budget-based routing, agent learning, prompt optimization
Phase 8: Stress Test & Harden     [~10h]  ← Edge cases, long runs, failure injection, recovery testing
```

**Philosophy**: Each overnight run is an experiment. Build → measure → learn → iterate.
**The game gets better as a side effect** of agents doing real work each run.

---

## Phase 1: Instrument & Harden (~4 hours)

The orchestrator can't be perfected without measurement. This phase adds the telemetry
and escalation infrastructure needed before Run #2.

### Action 1.1: Fix stale test count in test.md (5 min)

- **File**: `.claude/commands/test.md` line 7
- **Change**: Replace `calculator (116), caparison (11), gigling-gear (48), player-gear (46), match (69), playtest (80) = 370 total` with `calculator (194), phase-resolution (38), gigling-gear (48), player-gear (46), match (89), playtest (128), gear-variants (156) = 699 total (verify by running tests)`
- **Why**: Agents that read this command get wrong baseline expectations

### Action 1.2: Remove hardcoded test count from consistency check (30 min)

- **File**: `orchestrator/consistency-check.mjs` lines 43-52
- **Change**: Remove the hardcoded `699` check. The QA agent's job is to ADD tests — a hardcoded count fires false alarms every time it succeeds. Keep archetype stats + balance constant checks (lines 54-69).
- **Why**: False alarms erode trust in the consistency system

### Action 1.3: Add cost tracking to overnight report (1-2 hours)

- **File**: `orchestrator/orchestrator.mjs`
- **Locations**:
  - `runAgent()` line 643 (`proc.on('close')`): Parse stderr for Claude CLI cost/token output
  - Near line 893: Add `costLog` accumulator `{ agentId → { totalCost, inputTokens, outputTokens, rounds } }`
  - `generateOvernightReport()` line 1155: Add `## Cost Summary` section:
    ```
    | Agent | Model | Rounds | Est. Cost | Avg Cost/Round | Escalations |
    ```
  - Add total cost row + cost-per-successful-task metric
- **Fallback**: If stderr doesn't expose cost data, estimate from model pricing x elapsed time
- **Why**: This is THE prerequisite for all future orchestrator optimization. Can't tune what you can't measure.

### Action 1.4: Extend model escalation with guardrails (1-2 hours)

- **File**: `orchestrator/orchestrator.mjs` → `handleModelEscalation()` line 1104
  - **(a)** sonnet→opus escalation after 2 consecutive failures (mirror existing haiku→sonnet)
  - **(b)** `maxModel` field per agent — cap how far an agent can escalate
  - **(c)** De-escalation on success — save `_originalModel`, restore after successful round
  - **(d)** Log all escalation/de-escalation events for the overnight report
- **File**: `orchestrator/missions/overnight.json`
  - producer: `"maxModel": "haiku"` (never escalate)
  - designer: `"maxModel": "haiku"` (never escalate)
  - polish: `"maxModel": "sonnet"` (cap at sonnet)
  - reviewer: `"maxModel": "sonnet"` (stay at sonnet)
  - balance-tuner, qa, ui-dev: `"maxModel": "opus"` (allow full escalation chain)
- **Why**: The 3-tier escalation chain is the core model-switching feature. Guardrails prevent cost runaway.

**Exit criteria**: All changes committed. 699/699 tests passing. Orchestrator has cost visibility + 3-tier escalation.

---

## Phase 2: Seed Agent Work (~4 hours)

Agents need real, meaty tasks to exercise the orchestrator properly. The current backlog
has work but BL-031 (Technician balance fix) is deferred. Undefer it to create a
realistic multi-agent dependency chain.

### Action 2.1: Undefer BL-031 and apply Technician MOM change — 1 hour

- **File**: `src/engine/archetypes.ts` — Technician momentum 61→64
- **File**: `orchestrator/backlog.json` — Change BL-031 status from `deferred` to `pending`
- **Validate**: Run simulations at bare + giga to confirm +2-3pp improvement
- **Why**: This creates a cascading dependency chain (BL-031→BL-033→BL-034→BL-035) that exercises the orchestrator's `dependsOn` enforcement, multi-agent coordination, and handoff system

### Action 2.2: Fix test cascade (BL-033) — 2-3 hours

- ~5-8 assertions break in calculator.test.ts and match.test.ts
- Recalculate correct values, update assertions
- **Exit criteria**: All 699+ tests passing

### Action 2.3: Verify backlog is rich enough — 30 min

Review the 11 backlog tasks. Ensure there's work for every agent role:
- balance-analyst: BL-031 (undeferred), BL-034
- qa-engineer: BL-033
- tech-lead: BL-030, BL-035
- ui-dev: BL-036, BL-037, BL-038
- game-designer: BL-039, BL-040, BL-041
- producer: generates new tasks each round (self-sustaining)
- css-artist: picks up from polish backlog

If any role has <2 tasks, add more to ensure agents aren't idle.

**Exit criteria**: All tests passing. Every agent role has pending work. Dependency chains exercised.

---

## Phase 3: Overnight Run #2 (~10 hours, automated)

**The first real test of the v5 orchestrator with full instrumentation.**

### Pre-launch checklist

- [ ] Phase 1 committed (cost tracking, model escalation, stale fixes)
- [ ] Phase 2 committed (Technician fix, tests passing, backlog seeded)
- [ ] `npx vitest run` all passing
- [ ] `overnight.json` has `maxModel` fields
- [ ] Git working tree clean

### Launch

```powershell
powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1
```

### What we're measuring (orchestrator metrics)

| Metric | Where to find it | What it tells us |
|--------|-----------------|------------------|
| Per-agent cost | Overnight report → Cost Summary | Which agents are expensive vs cheap |
| Cost per successful task | Overnight report → Cost Summary | ROI of each model tier |
| Escalation events | Orchestrator log + report | How often haiku→sonnet→opus triggers |
| De-escalation events | Orchestrator log | Does de-escalation work correctly |
| Wasted rounds | Agent Efficiency table | Rounds where agent ran but produced nothing |
| Work-gating skips | Orchestrator log | How often idle agents are correctly skipped |
| Test count trajectory | Test Trajectory section | QA agent adding tests consistently? |
| Two-phase coordination | Handoffs | Are Phase B agents seeing Phase A work? |
| Dependency chain flow | Backlog.json history | Did BL-031→033→034→035 chain execute in order? |
| Auto-revert triggers | Orchestrator log | Did test regression recovery fire? |
| Crash recovery | run-overnight.ps1 log | Did exponential backoff work if crashes? |

### Morning review protocol

1. **Cost**: Read Cost Summary — what did this run actually cost? Per agent?
2. **Escalation**: Did any agent escalate? Was it justified? Did de-escalation fire?
3. **Failures**: Which agents failed? Why? Timeout? Bad output? Budget cap?
4. **Work-gating**: Were idle agents correctly skipped? Or did they waste rounds?
5. **Dependencies**: Did the BL-031 chain execute in proper order?
6. **Output quality**: Read agent handoffs — did sonnet agents produce better work than haiku?
7. **Test growth**: How many tests did QA add? Any regressions?

---

## Phase 4: Analyze & Tune (~4 hours)

**Data-driven orchestrator improvement based on Run #2 results.**

### Analysis 4.1: Cost efficiency audit — 1 hour

- Compare actual cost vs estimated cost from the S32 research
- Calculate cost-per-useful-file-change for each agent
- Identify the most and least cost-efficient agents
- Decision: Should any agent's base model change? (e.g., if haiku producer never fails, confirmed cheap; if sonnet balance-tuner always succeeds, no need for opus escalation)

### Analysis 4.2: Agent effectiveness review — 1 hour

- For each agent: rounds active, files modified, success rate, avg time
- Which agents consistently produce useful output?
- Which agents waste rounds (run but produce nothing)?
- Are `minFrequencyRounds` settings correct? (e.g., designer every 5 rounds — too often? too rare?)
- Are `maxTasksPerRound` settings correct? (e.g., can QA handle 3 tasks instead of 2?)

### Analysis 4.3: Escalation pattern review — 30 min

- Did escalation fire? How many times?
- Was the escalated model actually better? (compare output quality pre/post escalation)
- Did de-escalation fire correctly after success?
- Any zombie loops? (escalate → fail → stuck on expensive model)

### Analysis 4.4: Role template quality — 1 hour

- Read agent outputs and compare to role template instructions
- Are agents following their file ownership rules?
- Are handoff META sections properly structured?
- Are there common failure patterns? (e.g., agent tries to edit wrong file, agent doesn't run tests)
- Draft specific improvements to role templates for Run #3

### Analysis 4.5: Tune overnight.json — 30 min

Based on findings, update the mission config:
- Adjust `model` assignments if data supports
- Adjust `timeoutMs` (some agents may need more/less)
- Adjust `maxBudgetUsd` (set tighter if run was cheap, looser if agents hit caps)
- Adjust `minFrequencyRounds` (skip idle agents more aggressively or less)
- Adjust `maxTasksPerRound` (batch more if agent handles it)

**Exit criteria**: Overnight report fully analyzed. overnight.json tuned for Run #3.

---

## Phase 5: Orchestrator Iteration (~8 hours)

**Fix problems and add capabilities identified in Phase 4.**

### Potential improvements (prioritize based on Run #2 findings)

#### 5A: Prompt optimization — 2 hours
- Reduce prompt token count per agent (currently ~40 lines + common rules + role template)
- Identify which prompt sections agents actually use vs ignore
- Test shorter prompts on haiku agents — does output quality drop?
- Measure: tokens-in vs output-quality for each prompt variant

#### 5B: Agent output validation improvements — 2 hours
- Current validation at line 422-436 checks basic structure
- Add: validate that agent actually modified files in its ownership list
- Add: validate that handoff META has correct format
- Add: detect "empty work" (agent ran but changed nothing and didn't update handoff)
- Flag agents that consistently produce no output for model upgrade consideration

#### 5C: Smarter work-gating — 1 hour
- Current: skip if no pending backlog tasks AND not due for periodic run
- Improve: also check if agent's owned files were modified by another agent (coordination signal)
- Improve: if agent failed last round, give it a cooldown before retrying (instead of immediate retry)

#### 5D: Better handoff parsing — 1 hour
- Current `parseHandoffMeta()` uses regex on META sections
- Improve: handle malformed META gracefully (agents sometimes write non-standard format)
- Add: parse structured data from META (e.g., `cost-this-round: $0.15`)
- Add: extract agent-reported quality signals from handoff text

#### 5E: Mission config hot-reload — 1 hour
- Currently: overnight.json is read once at startup
- Improve: re-read overnight.json each round so the human can live-tune during a run
- Use case: You notice an agent is struggling → change its model from sonnet to opus mid-run without restarting

#### 5F: Round-level decision logging — 1 hour
- Log WHY each agent was included/skipped each round (work-gated, dependency blocked, frequency throttled)
- Log model selection rationale (base model, escalated because X, de-escalated because Y)
- Write to a structured JSON log (not just text) for post-run analysis

**Exit criteria**: Orchestrator improved based on Run #2 data. Committed and tested.

---

## Phase 6: Overnight Run #3 (~10 hours, automated)

**Validation run. Compare metrics against Run #2.**

### Key comparisons

| Metric | Run #2 (baseline) | Run #3 (improved) | Delta |
|--------|-------------------|-------------------|-------|
| Total cost | $ | $ | % change |
| Cost per task | $ | $ | % change |
| Agent success rate | % | % | pp change |
| Wasted rounds | N | N | % change |
| Escalation events | N | N | fewer = better |
| Tests added | N | N | more = better |
| Files modified | N | N | quality check |
| Round time (avg) | min | min | faster = better |

### Success criteria for orchestrator

- Cost per successful task completion is lower than Run #2
- Fewer wasted rounds (work-gating improvements working)
- Escalation fires less often (base model assignments are better)
- When escalation fires, it actually helps (output improves)
- No zombie loops or stuck agents
- Agent handoffs are consistently well-structured

---

## Phase 7: Advanced Orchestration (~12 hours)

**Build on the data from Runs #2 and #3.** Only implement what the data supports.

### 7A: Budget-based routing — 3 hours

Instead of failure-count escalation, let budget consumption rate drive model selection:
- If an agent is burning budget fast with no output → escalate
- If an agent is cheap and productive → keep it cheap
- Track `budgetUsedThisRound / outputQuality` as an efficiency ratio
- Requires: Phase 1 cost tracking data from 2+ runs

### 7B: Agent learning / history — 3 hours

Track per-agent performance across sessions (not just within a single run):
- Persistent file: `orchestrator/agent-history.json`
- Per agent: success rate, avg cost, preferred model, common failure modes
- Use history to set initial model for next run (instead of hardcoded in overnight.json)
- "This agent succeeded 95% on haiku last 3 runs → keep on haiku"

### 7C: Prompt A/B testing — 3 hours

- Run the same agent with two different prompt variants in alternating rounds
- Compare output quality, cost, and success rate
- Identify which prompt instructions actually matter vs are ignored
- Systematically shorten prompts while preserving output quality

### 7D: Dynamic agent team composition — 3 hours

- If the backlog has no balance tasks, don't launch the balance-tuner at all
- If there are 10 UI tasks, launch 2 ui-dev instances
- Scale the team based on the work available, not a fixed roster
- Requires: task-count-per-role analysis at round start

---

## Phase 8: Stress Test & Harden (~10 hours)

**Push the orchestrator to its limits.**

### 8A: Long-run stability — 3 hours

- Run for 50+ rounds (current max) with all 7 agents
- Monitor memory usage, log file growth, git repo bloat
- Verify analysis rotation (keeps last 5 rounds, archives older)
- Verify crash recovery across multiple restarts

### 8B: Failure injection — 3 hours

- Manually corrupt an agent's handoff mid-run — does the orchestrator recover?
- Set an agent's budget to $0.01 — does it handle budget exhaustion gracefully?
- Kill an agent process mid-execution — does timeout + reassignment work?
- Introduce a test regression (bad code in src/) — does auto-revert fire?

### 8C: Concurrency stress — 2 hours

- Set `maxConcurrency` to 7 (all agents simultaneous)
- Monitor for file ownership conflicts
- Check for git lock contention during concurrent operations
- Verify two-phase rounds still coordinate correctly under load

### 8D: Edge case hardening — 2 hours

- Empty backlog (all tasks completed) — do continuous agents handle it?
- All agents fail simultaneously — does the orchestrator continue or abort?
- Circular dependency in backlog — does `dependsOn` enforcement catch it?
- Agent produces output that fails validation — is the task correctly reassigned?

**Exit criteria**: Orchestrator survives all stress tests. Failure modes documented and handled.

---

## Game Work (runs as a side effect of agent work)

The game improves each overnight run as agents do real work. This is not the focus
but tracking it ensures the testbed stays healthy.

### Balance (via overnight agents)
- Technician MOM fix (Phase 2, seeded manually)
- Ongoing tuning by balance-tuner agent each run
- Target: no archetype <44% or >58% at any tier

### UI Polish (via overnight agents)
- CSS migration: 41 inline styles → CSS classes (BL-036)
- Combat readability improvements (BL-037)
- Rarity-colored gear borders (BL-038)

### Design (via overnight agents)
- Archetype fun factor audit (BL-039)
- Gear variant impact analysis (BL-040)
- New player experience audit (BL-041)

### Deployment (when orchestrator is proven)
- Deploy to GitHub Pages: `npm run deploy`
- Manual smoke test
- Tag release

### Gigaverse Integration (future)
- Memory files with research already exist (6 files in memory/)
- ~20h effort, separate initiative after orchestrator is solid

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `orchestrator/orchestrator.mjs` | Main orchestrator (1753 lines) — THE file |
| `orchestrator/missions/overnight.json` | 7-agent mission config (model/timeout/budget per agent) |
| `orchestrator/run-overnight.ps1` | Overnight restart loop (crash recovery) |
| `orchestrator/consistency-check.mjs` | Pre-round validation |
| `orchestrator/roles/_common-rules.md` | Shared agent rules (37 lines) |
| `orchestrator/roles/*.md` | 9 role templates (231 lines total) |
| `orchestrator/backlog.json` | 16 tasks (10 completed, 5 pending + 1 active chain) |
| `orchestrator/backlog-archive.json` | 28 completed tasks (reference) |
| `orchestrator/PLAN-model-switching-and-skills.md` | S32 model switching plan |
| `orchestrator/handoffs/*.md` | Agent state files (META sections) |
| `orchestrator/analysis/*.md` | Balance/design reports (rotated) |
| `.claude/commands/test.md` | Test runner command |
| `CLAUDE.md` | Project reference |

---

## Success Metrics (Overall Orchestrator Quality)

| Metric | Current (Run #1) | Target (Run #5+) |
|--------|------------------|-------------------|
| Cost per successful task | Unknown | <$0.50 |
| Agent success rate | ~80% (estimated) | >95% |
| Wasted rounds | ~32% | <10% |
| Model escalation rate | N/A (only haiku→sonnet) | <5% of rounds |
| Test regression recovery | Untested | 100% auto-revert |
| Crash recovery | Basic | Full exponential backoff + validation |
| Prompt efficiency | ~8-12K tokens/agent | <6K tokens/agent |
| Round completion time | ~12 min avg | <8 min avg |
| Human intervention needed | Frequent | Rare (self-healing) |
