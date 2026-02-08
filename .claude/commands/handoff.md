Generate a session handoff document summarizing work done in this session.

Steps:
1. Run `git status` and `git diff --stat` to inventory all changes
2. Run `npx vitest run` to confirm test state
3. Run `npx tsc --noEmit` to confirm TypeScript state
4. Read the most recent handoff file (jousting-handoff-s*.md) to determine session number
5. Write a new handoff at `jousting-handoff-s{N+1}.md` with these sections:
   - **Session Summary**: What was done (bullet points, grouped by phase)
   - **Current State**: Test count, TS errors, deploy status
   - **Architecture Overview**: Only if architecture changed this session
   - **Files Modified**: Categorized by who/what modified them
   - **Balance State**: Current win rates if balance work was done
   - **Known Issues / TODO**: Prioritized list
   - **Key API Signatures**: Only if signatures changed
   - **Git State**: Branch, commits ahead, uncommitted files
   - **Orchestrator Reference**: If orchestrator was used
6. Update MEMORY.md with:
   - New status (test count, any gotchas discovered)
   - Updated TODO list
   - Any new patterns or gotchas learned this session
