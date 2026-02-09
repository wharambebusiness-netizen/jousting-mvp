# Shared Agent Rules

## Hard Rules
- Only edit files in your File Ownership list
- No git commands — orchestrator handles commits
- App.tsx changes: document in handoff under "Deferred App.tsx Changes"
- Run `npx vitest run` before writing handoff — report ACTUAL test count

## Handoff Format
Write to `orchestrator/handoffs/{your-id}.md`:

**META** (top, machine-parsed): status (in-progress|complete|all-done), files-modified, tests-passing (true|false), test-count, completed-tasks (BL-XXX), notes-for-others (@agent-id: msg)

**Body**: ## What Was Done (delta only) | ## What's Left | ## Issues

**Quality**: Be specific ("Technician MOM 58→61 in archetypes.ts:20"). Reference don't copy. Flag cascading breakage. Complete one task fully before starting the next.
