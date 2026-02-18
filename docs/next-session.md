# Next Session Instructions (S86)

## Context: M1-M6 Complete + S85 Additions

All 6 operator milestones are done, plus S85 added:
- Report viewer rendering markdown reports via marked CDN (M6b)
- Live log streaming via WebSocket on orchestrator page
- Chain restart/retry for failed/aborted chains
- 1430 tests across 24 suites, all passing

## What's Left / Possible Next Steps

### 1. Multi-Project Dashboard (Medium-Large)
- Project selector in nav or sidebar
- Filter all views by project
- Project-specific cost summaries

### 2. Better Toast Integration (Low)
- Show toasts for chain restart, git push, abort, all API actions
- Consistent feedback for every user action

### 3. Report Auto-Refresh (Low)
- Poll `/api/orchestrator/reports` for new reports after orchestrator runs
- Show notification when new report available

### 4. Game Engine Work
- The game engine is feature-complete and balanced
- Could work on UI polish, new content, or the React frontend
- `docs/joust-melee-v4.1.md` is the canonical spec

## Reference
- Handoff: `docs/archive/handoff-s85.md`
- Design reference: `memory/web-design.md` (29 sections)
- Operator plan: `docs/operator-plan.md`
- Current test count: 1430 tests, 24 suites (all passing)
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas
