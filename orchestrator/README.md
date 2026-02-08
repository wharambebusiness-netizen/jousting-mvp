# Jousting MVP — Multi-Agent Orchestrator

## Quick Start

```bash
# From jousting-mvp/ directory
cd C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp
node orchestrator\orchestrator.mjs

# Or double-click:
jousting-mvp\orchestrator\run.bat

# Or run in background (close terminal safely):
cd jousting-mvp
start /b node orchestrator\orchestrator.mjs > orchestrator\logs\console.log 2>&1
```

## What It Does

Runs 5 Claude Code agents in parallel to develop the Jousting MVP:

| Agent | Type | What It Does |
|-------|------|-------------|
| ui-polish | feature | Caparison trigger animations, icons, visual effects |
| ai-engine | feature | % stamina thresholds, speed-attack synergy, difficulty levels |
| ai-reasoning | feature | AI Thinking panel showing decision weights |
| balance-sim | continuous | Runs match simulations, analyzes data, tunes balance |
| quality-review | continuous | Tests edge cases, reviews format, finds bugs |

**Feature agents** complete and stop. **Continuous agents** run every round.

## How It Works

Each round:
1. Orchestrator generates task board from agent handoff files
2. Launches non-blocked agents in parallel via `claude -p` (headless)
3. Each agent gets **fresh context** — reads its handoff file for continuity
4. Agents do work, write updated handoffs
5. Orchestrator runs test suite
6. Orchestrator commits git backup
7. Repeat until done or safety limits hit

## Safety Limits

- **20 min** timeout per agent (kills if exceeded)
- **6 hours** max total runtime
- **3 consecutive test failures** → circuit breaker stops everything
- **12 rounds** maximum
- **Git backup** after every round (easy to revert)
- Balance agent limited to ±5 stat changes, 2 constants per round
- Quality agent can only ADD tests, not modify engine code

## Monitoring

```bash
# Watch orchestrator progress
type orchestrator\logs\orchestrator.log

# Watch a specific agent (e.g., round 2)
type orchestrator\logs\ai-engine-round-2.log

# Check test results
type orchestrator\logs\test-results.log

# Read balance analysis
type orchestrator\analysis\balance-sim-round-1.md

# Read quality report
type orchestrator\analysis\quality-review-round-1.md

# Check current agent statuses (task board is auto-generated)
type orchestrator\task-board.md
```

## Resuming After Interruption

If the orchestrator stops (Ctrl+C, crash, power loss), just run it again:
```bash
node orchestrator\orchestrator.mjs
```
It reads handoff files to determine where each agent left off. Agents that marked themselves "complete" won't re-run. Continuous agents always run.

## Reverting a Bad Round

Every round creates a git commit. To undo the last round:
```bash
git log --oneline -5        # find the commit to revert to
git reset --hard HEAD~1     # undo last round
```

## Customizing

Edit `orchestrator/orchestrator.mjs` CONFIG section:
```javascript
const CONFIG = {
  maxRounds: 12,                       // increase for longer runs
  agentTimeoutMs: 20 * 60 * 1000,     // per-agent timeout
  maxRuntimeMs: 6 * 60 * 60 * 1000,   // total runtime cap
  circuitBreakerThreshold: 3,           // test failures before stopping
};
```

## File Structure

```
orchestrator/
├── orchestrator.mjs          # Main script
├── run.bat                   # Windows launcher
├── README.md                 # This file
├── task-board.md             # Auto-generated (agents read only)
├── handoffs/
│   ├── ui-polish.md          # UI agent context + status
│   ├── ai-engine.md          # AI engine agent context + status
│   ├── ai-reasoning.md       # AI reasoning agent context + status
│   ├── balance-sim.md        # Balance agent context + status
│   └── quality-review.md     # Quality agent context + status
├── analysis/
│   ├── balance-sim-round-N.md    # Balance simulation reports
│   └── quality-review-round-N.md # Quality review reports
└── logs/
    ├── orchestrator.log      # Main orchestrator log
    ├── test-results.log      # Test suite results per round
    └── [agent]-round-N.log   # Per-agent, per-round output
```
