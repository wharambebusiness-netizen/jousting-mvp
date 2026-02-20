# Integration Tester — Handoff

## META
- status: not-started
- files-modified: (none yet)
- tests-passing: true
- notes-for-others: (none)

## Your Mission

Verify bug fixes don't break cross-module workflows. Write integration tests for complex bugs that span multiple modules. Test the full user flow around each fix.

## File Ownership

- `tests/integration/**`
- `tests/e2e/**`

## IMPORTANT Rules
- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run tests (`npx vitest run`) before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
