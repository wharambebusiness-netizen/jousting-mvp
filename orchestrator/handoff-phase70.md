# Phase 70 Handoff: UI Milestones M1-M3

## META
- **Status**: COMPLETE
- **Files Modified**: operator/public/app.js, operator/public/console.js, operator/public/style.css, operator/public/terminals.js
- **Tests Passing**: 4518/4518 (zero server-side impact — all changes client-side JS/CSS)
- **Commit**: f92770d (pushed to origin/master)

## What Was Done

### M3: SPA Page Navigation Fix (~30 lines)
- **app.js:271-284**: Save `scrollTop` into page cache on `htmx:beforeSwap` detach
- **app.js:319-327**: Restore scroll via `requestAnimationFrame`, add `page--restored` class for 200ms fade-in
- **console.js:2252-2284**: Enhanced `terminal-page-restored` handler — iterates all masters and workers, checks `binaryWs.readyState`, closes stale refs and calls `connectMasterBinaryWs(id)` / `connectWorkerBinaryWs(id)` for reconnection
- **terminals.js:201-215**: Enhanced `terminal-page-restored` handler — reconnects Claude binary WS via `connectClaudeBinaryWs(inst)` and JSON WS via `connectWS()` if closed
- **style.css**: `@keyframes page-fade-in` + `.page--restored` animation

### M1: Rich Worker Detail Cards (~200 lines)
- **console.js:1086-1102**: Context health bar — green (0-1 refreshes), yellow (2-3 or refreshing), red (4+), with animated pulse for critical
- **console.js:1144-1155**: Worktree badge showing last path segment
- **console.js:1158-1193**: Detail section with utilization breakdown (active %, task success rate, idle time) and task history breadcrumb pills (last 5 categories as truncated pills)
- **console.js:1288-1327**: Enhanced `toggleWorkerExpand` — 3-state cycle: collapsed → expanded → fullwidth overlay. Escape key closes fullwidth
- **console.js:1663-1668**: New `formatDurationShort(ms)` helper
- **console.js:1479-1546**: Enhanced `updateWorkerCardMeta` to refresh health bar, worktree badge, detail section without recreating cards
- **style.css**: Health bar with gradient + pulse animation, worktree badge (purple), detail section, history pills, fullwidth terminal overlay (fixed position, z-index 50)

### M2: Worker Terminals on Terminals Page (~145 lines)
- **terminals.js:517-579**: Role badges on tabs — "M" badge (purple) for masters, "W" badge (cyan) for workers with master ID sub-badge. Tab insertion grouped: masters first, then workers grouped by owning master
- **terminals.js:589-636**: Status bar badges — role label, activity state pill (active/idle/waiting/stopped with color coding), task assignment indicator
- **terminals.js:720-723**: Instance state extended with `role`, `masterId`, `activityState`, `assignedTask`
- **terminals.js:1940-1943**: Enhanced `claude-terminal:spawned` event handler to pass `role`, `config`, `activityState` to `addClaudeTerminalInstance`
- **terminals.js:2209-2216**: New `claude-terminal:activity-changed` event handler
- **terminals.js:2480-2517**: New `updateTerminalBadges(id)` function for live activity/task updates
- **style.css**: Tab role badges, master-badge, status bar role/activity/task badges with state-colored variants

## What To Verify (Browser Testing)

These are all client-side changes — no backend modifications were needed since `GET /api/claude-terminals` already serves all required data fields (`contextRefreshCount`, `contextRefreshState`, `utilization`, `taskHistory`, `worktreePath`, `activityState`, `role`, `config._masterId`).

1. **M3 — SPA Navigation**: Navigate Console → Dashboard → Console. Master terminal should show live output. Scroll position should be preserved. Same for Terminals page.
2. **M1 — Worker Cards**: Spawn a worker on Console page. Verify health bar (green), worktree badge (if worktree active), utilization section. Expand terminal: click expand button cycles collapsed → expanded → fullwidth. Press Escape to close fullwidth.
3. **M2 — Terminal Tabs**: Load Terminals page with masters/workers running. Verify "M"/"W" badges on tabs. Verify activity state and task badges in status bar. Spawn a new worker via Console — tab should auto-appear on Terminals page with correct badges.

## Architecture Notes

- All data already served by backend — Phase 69 `getTerminalState()` in `claude-pool.mjs:2120-2137` returns all fields used
- WS events already bridged: `claude-terminal:activity-changed`, `claude-terminal:task-assigned`, `claude-terminal:task-completed`, `claude-terminal:task-released` — M2 just wired up the UI handlers
- Page cache system in `app.js` was already functional — M3 just added scroll persistence and WS reconnection on restore
- `connectMasterBinaryWs` in console.js lacks auto-reconnect (unlike `connectClaudeBinaryWs` in terminals.js which has exponential backoff). The M3 fix handles this by explicitly reconnecting on page restore, but a future improvement could add auto-reconnect to master binary WS

## Next Session Suggestions

1. **Manual browser QA** — verify all 3 milestones work visually with real workers running
2. **UI-M1 follow-up**: The "Open in Terminals" link (card → terminals page navigation with `?tab=workerId`) and toggle auto-dispatch button were planned but deferred — the card click already navigates to terminals
3. **Consider**: Adding auto-reconnect with exponential backoff to `connectMasterBinaryWs` in console.js (currently relies on M3's page-restore reconnect only)
4. **Reference**: `memory/ui-milestones.md` has the original milestone specs if further UI enhancements are planned
