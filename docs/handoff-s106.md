# Session 106 Handoff — Next Steps

## What S106 Did
- **Phase 2 COMPLETE**: Multi-terminal UI with xterm.js (terminals.html, terminals.js, CSS section 41)
- **Plan updated**: Added Phase 4 (General-Purpose Agent Roster) to multi-orchestrator-plan.md, renumbered Phases 5-7
- **CSS fix**: Fixed Pico CSS blue background on project tree files (role="button" override), reduced file tree font size
- **1657 tests**, 26 suites

## What S107 Should Do

**Phase 3: Handoff Workflow** — the biggest usability gap. Without this, long-running orchestrators hit context limits and die.

### Read First
- `docs/multi-orchestrator-plan.md` — Phase 3 section (lines ~151-175)
- `operator/routes/orchestrator.mjs` — multi-instance API (instances Map, start/stop/delete)
- `operator/public/terminals.js` — terminal UI (tab bar, status bar, WS event routing)
- `orchestrator/handoff-parser.mjs` — existing handoff parsing
- `orchestrator/sdk-adapter.mjs` — `generateSyntheticHandoff()`, `parseChainHandoff()`
- `operator/public/style.css` — CSS section 41 (terminal UI styles)

### Priority 1: Handoff API Endpoint
- `POST /api/orchestrator/:id/handoff` in `operator/routes/orchestrator.mjs`
- Generates handoff doc from worker state (task summary, files modified, remaining work)
- Writes to `operator/handoffs/orch-{id}-{timestamp}.md`
- Leverage existing `parseHandoff()` + `generateSyntheticHandoff()` patterns from orchestrator/

### Priority 2: Handoff Button in Terminal Status Bar
- Add a "Handoff" button to each terminal's `.term-status__actions` in terminals.js
- Multi-step progress indicator:
  1. Generate handoff instructions
  2. Git commit (in worker's worktree)
  3. Git push
  4. Stop current session
  5. Start new session with handoff context loaded
- Show step progress in the terminal output (colored ANSI markers)
- Toast notifications for success/failure

### Priority 3: Context Continuation
- New session auto-loads previous handoff file as system prompt context
- Worker respawns with fresh context window containing handoff instructions
- `POST /api/orchestrator/:id/start` accepts optional `handoffFile` parameter
- Worker's orchestrator fork reads handoff and includes in agent prompts

### Priority 4: Handoff History
- `GET /api/orchestrator/:id/handoffs` — list handoff files for an instance
- Display handoff history in terminal panel or as a dropdown
- Click to view previous handoff content

### Priority 5: Tests
- Handoff generation produces valid markdown with expected sections
- Multi-step workflow completes all steps
- Context injection includes handoff content in new session
- Handoff API returns 404 for unknown instance, 409 for not-running
- Handoff history lists files correctly

### Key Files to Modify
| File | Changes |
|------|---------|
| `operator/routes/orchestrator.mjs` | Add POST /:id/handoff, GET /:id/handoffs endpoints |
| `operator/public/terminals.js` | Add handoff button, progress UI, handoff history |
| `operator/public/style.css` | Handoff progress stepper styles |
| `operator/orchestrator-worker.mjs` | Accept handoff context on init, pass to orchestrator |
| `operator/__tests__/server.test.mjs` | Handoff API tests |

### What NOT to Do
- Don't modify the process pool or existing orchestrator routes (Phase 1 is stable)
- Don't implement cross-orchestrator handoff yet (that's a Phase 3 stretch goal)
- Don't start Phase 4 (agent roster) — that's S108-S109
