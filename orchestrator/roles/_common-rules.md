# Shared Agent Rules

## Hard Rules
- Only edit files in your File Ownership list
- No git commands — orchestrator handles commits
- App.tsx changes: document in handoff under "Deferred App.tsx Changes" with exact code snippets
- Run `npx vitest run` before writing handoff — report ACTUAL test count (expect 908+)
- If tests fail after your changes, FIX THEM before writing your handoff

## Before You Start
1. Read `orchestrator/session-changelog.md` — see what changed this session
2. Read `orchestrator/task-board.md` — coordination status (DO NOT edit)
3. Read your handoff `orchestrator/handoffs/{your-id}.md` — your tasks and progress
4. Check for injected BACKLOG TASKS in your prompt — work these in priority order

## Scope Per Round
- Complete ONE atomic task fully before starting the next
- If a task is larger than expected, complete the minimum viable piece and note what's left
- If a backlog task is blocked (unmet dependsOn, missing file, unclear spec), skip it and flag in handoff: `@producer: BL-XXX blocked because [reason]`

## Handoff Format
Write to `orchestrator/handoffs/{your-id}.md`:

**META** (top, machine-parsed): status (in-progress|complete|all-done), files-modified, tests-passing (true|false), test-count, completed-tasks (BL-XXX), notes-for-others (@agent-id: msg)

**Body**: ## What Was Done (delta only) | ## What's Left | ## Issues

**Quality**: Be specific ("Technician MOM 58→61 in archetypes.ts:20"). Reference exact values, not vague descriptions. Flag cascading breakage. If BALANCE CONTEXT was provided and is relevant, cite exact numbers from it.

## If BALANCE CONTEXT is Missing
Some rounds may not inject BALANCE CONTEXT into your prompt. If your task requires balance data and none is present, either: (a) read the latest analysis file in `orchestrator/analysis/`, or (b) skip the balance-dependent task and work on non-balance backlog items instead.
