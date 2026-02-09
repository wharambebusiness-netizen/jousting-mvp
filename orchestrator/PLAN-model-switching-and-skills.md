# Final Plan: Model Switching & Skills Integration

> Synthesized from 3 independent reviews (Architect, Cost/Ops, DevEx)
> Date: 2026-02-09
> Status: ACTIONABLE -- execute in order

---

## Executive Summary

All three reviewers converge on the same core message: **the highest-value work is running the orchestrator on the game, not optimizing the orchestrator itself.** The proposed plan contained 4 phases of model switching plus a full skills migration. After synthesis, this reduces to **3 small, concrete changes** totaling approximately 4-5 hours of effort, followed by an immediate overnight run.

Everything else is either premature (no data to justify it), redundant (overnight.json already does it), or scope creep (skills migration solves a non-problem).

---

## 1. Consensus (All 3 Reviewers Agree)

| Item | Verdict | Confidence |
|------|---------|------------|
| Phase 3 (cost tracking) is highest value | BUILD FIRST | Unanimous |
| Phase 1 (sonnet->opus escalation) is low-risk, small | BUILD | Unanimous |
| Phase 2 (complexity field on backlog tasks) | SKIP | Unanimous |
| Phase 4 (task-type->model mapping table) | SKIP | Unanimous |
| 5 new skills are scope creep | SKIP | Unanimous |
| Existing 5 commands work fine (123 lines total) | KEEP AS-IS | Unanimous |
| test.md has stale count (370 instead of 699) | FIX | Unanimous |
| Next priority is launching overnight run #2 | AGREE | Unanimous |

## 2. Disagreements Resolved

### 2a. Should sonnet->opus escalation be built?

- **Agent A**: Yes, 5-line change, low risk.
- **Agent B**: Only after cost data exists. Warns about zombie feedback loop.
- **Agent C**: Yes, harmless 5-line change.

**Decision: BUILD, but with Agent B's safeguard.** Add the escalation AND a `maxModel` field per agent in the mission config, so agents like `producer` and `designer` can be capped at `haiku` or `sonnet` and never escalate to opus. This addresses the zombie loop concern and the cost runaway concern in one field. The `maxBudgetUsd` field already exists (line 267 of orchestrator.mjs) as a secondary guard rail.

### 2b. Should de-escalation be built?

- **Agent A**: Did not raise it.
- **Agent B**: Yes, escalated agents should de-escalate after success.
- **Agent C**: Did not raise it.

**Decision: BUILD.** Agent B is correct. If an agent escalates haiku->sonnet and then succeeds, it should return to haiku for the next round. This is ~3 lines in `handleModelEscalation()` and prevents cost creep. Without it, a single failure permanently upgrades an agent's model for the rest of the run.

### 2c. Skills migration -- do it?

- **Agent A**: Spike first to verify `-p` mode compatibility.
- **Agent B**: Moderate value if it reduces prompt boilerplate, but skip the 5 new skills.
- **Agent C**: Commands are not broken; migration solves a problem that does not exist.

**Decision: SKIP entirely.** Agent C has the strongest argument:
1. The `.claude/skills/` directory does not exist yet. The agents use `-p` (pipe) mode where skills/commands are not loaded -- the orchestrator injects prompts directly via stdin.
2. The 5 existing commands total 123 lines and work correctly for interactive (human) use.
3. Migrating commands to skills gains nothing for orchestrated agents and risks breaking the `-p` pipeline.
4. The 5 proposed new skills (balance-check, review, monitor, etc.) duplicate existing tools.

There is no spike needed because the architecture makes the answer clear: agents receive their instructions via stdin, not through the skills/commands system. Skills are irrelevant to the autonomous pipeline.

### 2d. Consistency check hardcoded test count

- **Agent A**: Flagged as a risk (false alarms when QA adds tests).
- **Agent B, C**: Did not raise specifically.

**Decision: FIX as part of cost tracking work.** The consistency check at line 48 of `consistency-check.mjs` hardcodes `699`. Change this to a dynamic approach: run `npx vitest run` and parse the actual count, or simply remove the stale test count check (it is already flagged as "verify against source" in CLAUDE.md). Low effort, prevents false alarms on every future overnight run.

---

## 3. Action List (Priority Order)

### DO NOW (before next overnight run)

#### Action 1: Fix stale test count in test.md
- **Effort**: 5 minutes
- **File**: `C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp\.claude\commands\test.md` (line 7)
- **Change**: Replace the hardcoded suite breakdown `calculator (116), caparison (11), gigling-gear (48), player-gear (46), match (69), playtest (80) = 370 total` with `calculator (194), phase-resolution (38), gigling-gear (48), player-gear (46), match (89), playtest (128), gear-variants (156) = 699 total (verify by running tests)`
- **Why**: Stale data misleads both human users and any agent that reads the command.

#### Action 2: Add cost tracking to overnight report
- **Effort**: 1-2 hours
- **File**: `C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp\orchestrator\orchestrator.mjs`
- **What**: Track per-agent token/cost data and add it to the overnight report.
- **Implementation**:
  1. In `runAgent()` (line 530), after the agent process closes (line 643), parse stderr for Claude CLI cost/token output. The Claude CLI prints usage stats to stderr in the format `Total cost: $X.XX` and `Total tokens: input=N, output=N`. Capture these from the `stderr` buffer.
  2. Add a `costLog` accumulator at the round-tracking level (near line 893): `const costLog = {}; // agentId -> { totalCost, totalInputTokens, totalOutputTokens, rounds }`
  3. After each agent run, extract and accumulate cost data from stderr.
  4. In `generateOvernightReport()` (line 1155), add a new "## Cost Summary" section between "Agent Efficiency" and "Analysis Reports Generated":
     ```
     ## Cost Summary
     | Agent | Model | Rounds | Est. Cost | Avg Cost/Round |
     ```
  5. Add a total cost row at the bottom.
- **Fallback**: If stderr parsing is unreliable, use `--output-format json` on the CLI args (line 605) and parse the JSON response for cost metadata. However, this changes stdout handling, so test carefully.
- **Why**: Agent B is emphatic: "you can't optimize what you can't measure." Zero visibility into actual costs today. This is the single prerequisite for every future model-switching decision.

#### Action 3: Extend model escalation chain (sonnet->opus) with guardrails
- **Effort**: 1-2 hours
- **File**: `C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp\orchestrator\orchestrator.mjs`, function `handleModelEscalation()` at line 1104
- **What**: Three changes to `handleModelEscalation()`:

  **(a) Add sonnet->opus escalation (5 lines)**
  After line 1113, add an `else if` for sonnet->opus:
  ```javascript
  else if (agent.model === 'sonnet' && consecutiveAgentFailures[result.agentId] >= 2) {
    const maxModel = agent.maxModel || 'opus';
    if (maxModel === 'opus') {
      log(`  ${result.agentId}: Escalating sonnet->opus (2 consecutive failures)`);
      agent.model = 'opus';
      consecutiveAgentFailures[result.agentId] = 0;
    } else {
      log(`  ${result.agentId}: At max model (${agent.model}), cannot escalate further`);
    }
  }
  ```

  **(b) Add maxModel guard (in mission config schema)**
  In `loadMission()` at line 255, add `maxModel` to the agent mapping:
  ```javascript
  maxModel: a.maxModel || null,  // v5: ceiling for model escalation (e.g., 'sonnet' prevents opus)
  ```
  Then reference `agent.maxModel` in the escalation logic to prevent exceeding the cap.

  **(c) Add de-escalation on success**
  In the `else` branch of `handleModelEscalation()` (line 1115, the success case), add:
  ```javascript
  // De-escalate if agent was previously escalated
  if (agent._originalModel && agent.model !== agent._originalModel) {
    log(`  ${result.agentId}: De-escalating ${agent.model} -> ${agent._originalModel} (success)`);
    agent.model = agent._originalModel;
  }
  ```
  And when escalating, save the original: `agent._originalModel = agent._originalModel || agent.model;`

- **File**: `C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp\orchestrator\missions\overnight.json`
- **What**: Add `maxModel` to agent configs:
  - `producer`: add `"maxModel": "haiku"` (never escalate)
  - `designer`: add `"maxModel": "haiku"` (never escalate)
  - `polish`: add `"maxModel": "sonnet"` (escalate from haiku to sonnet max)
  - `balance-tuner`, `qa`, `ui-dev`: add `"maxModel": "opus"` (allow full chain)
  - `reviewer`: add `"maxModel": "sonnet"` (already sonnet, stay there)

- **Why**: Agent A and C agree it is a trivial extension. Agent B's concerns about cost runaway and zombie loops are addressed by `maxModel` cap and de-escalation. The `maxBudgetUsd` field already in the config provides a hard dollar ceiling per agent.

#### Action 4: Make consistency check test count dynamic
- **Effort**: 30 minutes
- **File**: `C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp\orchestrator\consistency-check.mjs` (line 48)
- **Change**: Remove or relax the hardcoded `699` check. Replace with either:
  - (Simple) Remove the test count validation entirely -- CLAUDE.md already says "verify against source."
  - (Better) Change the check to warn only if the count in CLAUDE.md is MORE THAN 50 below the actual count (stale), rather than checking for an exact number. This requires running tests at startup, which is expensive, so the simple approach is preferred.
- **Recommended**: Just remove lines 43-52 (the test count check). The consistency check should focus on archetype stats and balance constants, which are the things that actually drift silently. Test counts are verified by actually running tests every round.

---

### DO LATER (after overnight run #2 produces cost data)

#### Action 5: Review cost data and tune model assignments
- **When**: After the next overnight run completes
- **What**: Read the new "Cost Summary" section of the overnight report. Determine:
  1. Which agents actually benefit from sonnet vs. haiku (success rate vs. cost)
  2. Whether any agent triggered opus escalation and whether it helped
  3. Total run cost and cost per useful round of work
- **Why**: Agent B's key insight -- "the optimization target should be agent effectiveness, not model cost." Cost data enables evidence-based tuning instead of guesswork.

#### Action 6: Consider budget-based routing
- **When**: After 2-3 overnight runs with cost data
- **What**: Agent A suggested letting budget exhaustion be the signal to upgrade model tier. This inverts the escalation logic: start cheap, and only upgrade when the agent is burning budget without progress. This may be a better heuristic than consecutive failure count.
- **Prerequisites**: Action 2 (cost tracking) must be working and producing reliable data.

---

### DON'T DO

| Item | Reason |
|------|--------|
| Phase 2: Complexity field on backlog tasks | Premature metadata. The haiku producer is not suited to classify task complexity. No data shows this would improve model selection. Revisit only if cost data reveals a clear pattern. |
| Phase 4: Task-type->model mapping table | Redundant with per-agent model in overnight.json. Adds a rigid lookup table that will rot. The existing system (per-agent model + escalation) is sufficient. |
| Commands->Skills migration | Skills are irrelevant to the `-p` pipeline. The 5 commands (123 lines total) work correctly for interactive use. No problem to solve. |
| 5 new skills (balance-check, review, monitor, etc.) | Duplicate existing tools. `/simulate` already does balance checks. Tech-lead agent already does reviews. `overnight-report.md` already provides monitoring. |
| Agent skill preloading via mission config | Architecturally unclear. Agents receive instructions via stdin. Skills are not loaded in `-p` mode. |
| Per-skill model selection | Three configuration layers for model selection is two too many. Keep it simple: overnight.json + escalation. |
| Dynamic context injection based on skills | Prompt inflation risk with no clear benefit. Agents already get role templates + common rules + backlog tasks. |

---

## 4. The Skills Question -- Final Recommendation

**Do not migrate commands to skills. Do not create new skills.**

The reasoning is straightforward:

1. **Orchestrated agents do not use commands or skills.** They receive prompts via stdin in `-p` mode. The entire skills proposal is architecturally irrelevant to the autonomous pipeline, which is where 95% of development work happens overnight.

2. **Interactive commands work.** The 5 existing commands (`/test`, `/simulate`, `/orchestrate`, `/handoff`, `/deploy`) total 123 lines, are correct (except the stale test count), and cover the human developer's workflow. There is no usability complaint to address.

3. **Proposed new skills duplicate existing functionality.** The balance-check skill would duplicate `/simulate`. The review skill would duplicate the tech-lead agent. The monitor skill would duplicate reading `overnight-report.md`.

4. **Risk outweighs reward.** Any change to the agent spawn pipeline (`runAgent()` at line 530) that touches how prompts or tools are delivered risks breaking overnight runs. The current pipeline is tested and working.

The one action item from this area: **fix the stale test count in test.md** (Action 1 above).

---

## 5. The Model Switching Question -- Final Recommendation

**Keep the existing architecture. Extend it minimally.**

The current system is well-designed:
- `overnight.json` assigns per-agent models (`haiku`, `sonnet`)
- `handleModelEscalation()` at line 1104 promotes `haiku->sonnet` after 2 failures
- `maxBudgetUsd` per agent caps spending

The only gap is:
1. No visibility into actual costs (Action 2 fixes this)
2. No sonnet->opus path for truly stuck agents (Action 3a fixes this)
3. Escalation is one-way -- once promoted, an agent stays expensive forever (Action 3c fixes this)
4. No ceiling on escalation per agent (Action 3b fixes this with `maxModel`)

After these 3 changes, the model switching system is complete for the current scale. Further optimization (budget-based routing, complexity-aware assignment) should wait for cost data from at least 2-3 overnight runs.

---

## 6. Implementation Order

```
Step 1 (5 min)   Fix test.md stale count              -> Action 1
Step 2 (30 min)  Remove hardcoded 699 from consistency -> Action 4
Step 3 (1-2 hr)  Add cost tracking to overnight report -> Action 2
Step 4 (1-2 hr)  Extend escalation with guardrails     -> Action 3
Step 5 (0 min)   Commit all changes
Step 6 (0 min)   Launch overnight run #2
Step 7 (next day) Review cost data                     -> Action 5
```

**Total estimated effort: 3-5 hours.**
**Total estimated value: 90% of the original 15-hour proposal.**

---

## 7. Key Files Modified

| File | Changes |
|------|---------|
| `jousting-mvp/.claude/commands/test.md` | Fix stale test count (line 7) |
| `jousting-mvp/orchestrator/consistency-check.mjs` | Remove hardcoded 699 check (lines 43-52) |
| `jousting-mvp/orchestrator/orchestrator.mjs` | Cost tracking in `runAgent()` (line 643), cost accumulator (line 893), `handleModelEscalation()` extension (line 1104), `generateOvernightReport()` cost section (line 1155), `loadMission()` maxModel field (line 255) |
| `jousting-mvp/orchestrator/missions/overnight.json` | Add `maxModel` per agent |

No new files created. No files deleted. No architectural changes.
