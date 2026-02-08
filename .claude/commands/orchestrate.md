Configure and launch a multi-agent orchestrator run.

Usage: /orchestrate [mission-name]

If a mission name is provided, look for `orchestrator/missions/{name}.json`.

## If mission config exists:
1. Read and display the mission config (agents, dependencies, file ownership)
2. Verify prerequisites:
   - Tests passing (`npx vitest run`)
   - TypeScript clean (`npx tsc --noEmit`)
   - No critical uncommitted changes
3. Show the mission plan and confirm before launching
4. Launch: `node orchestrator/orchestrator.mjs orchestrator/missions/{name}.json`

## If no mission config (or creating a new one):
1. Understand what work needs to be done
2. Design the agent team:
   - Identify distinct work streams that can parallelize
   - Define dependencies (which agents block which)
   - Assign file ownership (prevent merge conflicts)
   - Choose roles from orchestrator/roles/ (engine-dev, test-writer, balance-analyst, ui-dev)
   - Define primary tasks and stretch goals per agent
3. Create mission config at `orchestrator/missions/{name}.json` with format:
   ```json
   {
     "name": "Mission Name",
     "description": "What this mission accomplishes",
     "config": { "maxRounds": 12, "agentTimeoutMs": 1200000 },
     "agents": [
       {
         "id": "agent-id",
         "name": "Human-Readable Agent Name",
         "type": "feature|continuous",
         "dependsOn": [],
         "role": "engine-dev|test-writer|balance-analyst|ui-dev",
         "fileOwnership": ["src/engine/file.ts"],
         "tasks": {
           "primary": "What the agent must accomplish",
           "stretch": ["Optional additional tasks"]
         }
       }
     ]
   }
   ```
4. The orchestrator will auto-generate initial handoff files from this config
5. Verify and launch

## Post-Run:
- Check `orchestrator/overnight-report.md` for summary
- Review `orchestrator/handoffs/*.md` for detailed work logs
- Review `orchestrator/analysis/*.md` for balance/quality reports
- Run tests to confirm final state
