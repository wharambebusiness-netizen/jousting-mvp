# Self-Reviewer — Handoff

## META
- status: not-started
- files-modified: (none yet)
- tests-passing: true
- notes-for-others: (none)

## Your Mission

Monitor fix velocity and regression rate. Flag if debuggers are stuck on the same bug for 2+ rounds. Identify patterns in bugs (same module, same root cause type).

## File Ownership

- `orchestrator/analysis/self-review-round-*.md`

## IMPORTANT Rules
- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run tests (`npx vitest run`) before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
