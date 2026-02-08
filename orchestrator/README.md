# Jousting MVP — Multi-Agent Orchestrator v3

## Quick Start

```bash
# From jousting-mvp/ directory
cd C:\Users\rvecc\Documents\Jousting\Jousting\jousting-mvp

# Default agents (from orchestrator.mjs AGENTS array)
node orchestrator\orchestrator.mjs

# With mission config (recommended)
node orchestrator\orchestrator.mjs orchestrator\missions\breaker-mechanic.json

# Or double-click:
orchestrator\run.bat

# Or run in background (close terminal safely):
start /b node orchestrator\orchestrator.mjs > orchestrator\logs\console.log 2>&1
```

## What It Does

Runs Claude Code agents in parallel to develop the Jousting MVP. Agents are defined either in the default AGENTS array or loaded from a **mission config** JSON file.

**Feature agents** complete their task and stop. **Continuous agents** run every round.

## v3 Features

- **Mission configs** (`missions/*.json`) — Define agent teams without editing orchestrator.mjs
- **Role templates** (`roles/*.md`) — Standardized behavior guidelines per agent type
- **CLAUDE.md-aware** — Project context auto-loaded, shorter prompts, less token waste
- **Auto-generated handoffs** — Mission tasks populate initial handoff files automatically

## Mission Config Format

```json
{
  "name": "Mission Name",
  "description": "What this mission accomplishes",
  "config": { "maxRounds": 10, "agentTimeoutMs": 1200000 },
  "designDoc": "some-reference-doc.md",
  "agents": [
    {
      "id": "agent-id",
      "name": "Human-Readable Name",
      "type": "feature",
      "dependsOn": [],
      "role": "engine-dev",
      "fileOwnership": ["src/engine/file.ts"],
      "tasks": {
        "primary": "What the agent must accomplish",
        "stretch": ["Optional additional tasks"]
      }
    }
  ]
}
```

## Available Roles

| Role | File | For |
|------|------|-----|
| engine-dev | `roles/engine-dev.md` | Pure TS engine work (calculator, phases, gear) |
| test-writer | `roles/test-writer.md` | Adding tests only (never modifies engine) |
| balance-analyst | `roles/balance-analyst.md` | Balance simulation + tuning (limited changes) |
| ui-dev | `roles/ui-dev.md` | React UI components and App.tsx |

## How It Works

Each round:
1. Orchestrator generates task board from agent handoff files
2. Launches non-blocked agents in parallel via `claude -p` (headless)
3. Each agent gets **fresh context** — reads CLAUDE.md (auto) + handoff + task board
4. Role template appended to prompt for domain-specific guidelines
5. Agents do work, write updated handoffs
6. Orchestrator runs test suite
7. Orchestrator commits git backup
8. Repeat until done or safety limits hit

## Safety Limits

- **20 min** timeout per agent (configurable, kills process tree if exceeded)
- **10 hours** max total runtime (configurable)
- **3 consecutive test failures** → circuit breaker stops everything
- **30 rounds** maximum (configurable)
- **Git backup** after every round (easy to revert)
- Agents cannot run git commands (orchestrator-only)
- File ownership prevents merge conflicts

## Monitoring

```bash
# Watch orchestrator progress
type orchestrator\logs\orchestrator.log

# Watch a specific agent (e.g., round 2)
type orchestrator\logs\breaker-mechanic-round-2.log

# Check test results
type orchestrator\logs\test-results.log

# Read analysis reports
type orchestrator\analysis\breaker-balance-round-1.md

# Check current agent statuses (task board is auto-generated)
type orchestrator\task-board.md
```

## Resuming After Interruption

Just run it again — it reads handoff META sections to determine where each agent left off:
```bash
node orchestrator\orchestrator.mjs orchestrator\missions\breaker-mechanic.json
```
Agents marked `all-done` won't re-run. `complete` agents work on stretch goals.

## Reverting a Bad Round

Every round creates a git commit. To undo the last round:
```bash
git log --oneline -5        # find the commit to revert to
git reset --hard HEAD~1     # undo last round
```

## File Structure

```
orchestrator/
├── orchestrator.mjs          # Main orchestration script (v3)
├── run.bat                   # Windows launcher
├── run-overnight.bat         # Overnight launcher
├── launch.bat                # Background launcher
├── README.md                 # This file
├── task-board.md             # Auto-generated (agents read only)
├── overnight-report.md       # Generated after each run
├── missions/
│   └── breaker-mechanic.json # Example mission config
├── roles/
│   ├── engine-dev.md         # Engine developer guidelines
│   ├── test-writer.md        # Test writer guidelines
│   ├── balance-analyst.md    # Balance analyst guidelines
│   └── ui-dev.md             # UI developer guidelines
├── handoffs/
│   └── *.md                  # Agent state files (auto-generated from mission)
├── analysis/
│   └── *-round-N.md          # Balance/quality reports
└── logs/
    ├── orchestrator.log      # Main orchestrator log
    ├── test-results.log      # Test suite results per round
    └── [agent]-round-N.log   # Per-agent, per-round output
```

## Customizing

For one-off config changes, edit the CONFIG section in `orchestrator.mjs`.
For mission-specific overrides, use the `config` field in your mission JSON.

```javascript
// Default config (in orchestrator.mjs)
const CONFIG = {
  maxRounds: 30,
  agentTimeoutMs: 20 * 60 * 1000,     // 20 min per agent
  maxRuntimeMs: 10 * 60 * 60 * 1000,  // 10 hours total
  circuitBreakerThreshold: 3,
};
```

## Creating a New Mission

1. Create `missions/my-mission.json` (see format above)
2. Define agents with appropriate roles, dependencies, and file ownership
3. Run: `node orchestrator\orchestrator.mjs orchestrator\missions\my-mission.json`
4. Orchestrator auto-generates initial handoff files from mission tasks
5. Monitor via logs and task board
6. Review overnight report when done
