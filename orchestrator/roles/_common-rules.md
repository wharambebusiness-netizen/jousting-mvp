# Shared Agent Rules

## File Discipline
- Only edit files in your File Ownership list
- For App.tsx changes: document in handoff under "Deferred App.tsx Changes"
- No git commands — orchestrator handles commits
- No editing orchestrator/task-board.md — auto-generated

## Handoff Protocol
Write to `orchestrator/handoffs/{your-id}.md`. Required format:

### META section (top of file, machine-parsed):
- status: in-progress | complete | all-done
- files-modified: comma-separated file paths
- tests-passing: true | false
- test-count: [number] (run `npx vitest run` and report actual count)
- completed-tasks: BL-XXX, BL-YYY (if backlog tasks completed)
- notes-for-others: @agent-id: message

### Body sections:
- ## What Was Done — delta only (what YOU changed THIS ROUND)
- ## What's Left — remaining work items
- ## Issues — blockers, bugs found, coordination needs

### Handoff Quality Rules:
1. **Delta-only**: Document what you did this round, not project history
2. **Reference, don't copy**: "See analysis/balance-tuner-round-6.md" not [paste 50 lines]
3. **Verify before reporting**: Run `npx vitest run` and report the ACTUAL count
4. **Be specific**: "Changed Technician MOM 58→61 in archetypes.ts:20" not "updated stats"
5. **Flag cascades**: If your change may break other agents' work, say so explicitly
6. **One task at a time**: Complete one task fully before starting the next. Do not leave half-implemented features.

## Self-Verification Checklist (before writing handoff)
1. Run `npx vitest run` — all tests pass?
2. Files modified match your ownership list?
3. Handoff META matches actual file state?
4. Any values in CLAUDE.md invalidated by your changes? Flag in notes-for-others.
