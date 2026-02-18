# Next Session Instructions (S85)

## Context: M1-M6 Complete

All 6 operator milestones are done. The system now has:
- CLI daemon with auto-continuation (M1-M2)
- Orchestrator self-continuation (M3)
- Full HTTP API (M4)
- Professional web dashboard with design token system (M5, upgraded S83-S84)
- Mission launcher that forks orchestrator as child process (M6a)
- Git integration: status, push, commit, PR endpoints (M6d)
- 1415 tests across 24 suites, all passing

## What's Left / Possible Next Steps

### 1. M6b: Report Viewer (Low Effort)
Reports currently go to `orchestrator/overnight-report.md`. Could add:
- `GET /api/reports` endpoint listing report files
- `/views/report` fragment that renders markdown via `marked` CDN library
- Report tab/section on orchestrator page

### 2. Log Streaming (Medium)
The orchestrator child process stdout/stderr are forwarded as events (`orchestrator:log`), but there's no UI to display them. Could add:
- WebSocket-based live log panel on orchestrator page
- Auto-scroll, filter by stream (stdout/stderr), clear button
- Use existing `ws.mjs` event bridge — just subscribe to `orchestrator:log`

### 3. Chain Restart/Retry (Medium)
- Add "Restart" button on failed/aborted chain cards
- `POST /api/chains/:id/restart` endpoint
- Could reuse the chain's original task + config

### 4. Multi-Project Dashboard (Larger)
- Project selector in nav or sidebar
- Filter all views by project
- Project-specific cost summaries

### 5. Game Engine Work
- The game engine is feature-complete and balanced
- Could work on UI polish, new content, or the React frontend
- `docs/joust-melee-v4.1.md` is the canonical spec

## Reference
- Handoff: `docs/archive/handoff-s84.md`
- Design reference: `memory/web-design.md` (29 sections)
- Operator plan: `docs/operator-plan.md`
- Current test count: 1415 tests, 24 suites (all passing)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
