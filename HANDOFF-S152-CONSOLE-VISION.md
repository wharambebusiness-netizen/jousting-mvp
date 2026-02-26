# HANDOFF — Session 152 → Next Session: Master Console as Primary Interface

## The Vision

The user wants to **stop using PowerShell + Claude Code CLI** and instead work entirely through the **Master Console** web UI at `http://localhost:3100/console`. This means the console page needs to become a complete daily-driver interface — not just a demo page, but the real way the user interacts with the codebase.

Today: User opens PowerShell → runs `claude` → types instructions → Claude works.
Goal: User opens browser → hits `/console` → types instructions to Master Claude → Master breaks work into tasks → Workers execute → Results visible in-page.

## Current State (What Exists)

### Working
- **Master terminal**: xterm.js connected to a Claude Code PTY via binary WebSocket
- **Worker panel**: Cards showing worker status, assigned tasks, 8-line output previews
- **Status bar**: Task progress, cost, worker count
- **System prompt**: `master-context.md` loaded and sent to master on spawn — has full operator API reference
- **Real-time updates**: WS events refresh workers on terminal/task changes
- **Page reconnect**: `init()` checks for existing master on page load and reconnects
- **Backend**: Pool supports `role: 'master'`, `persistent: true`, uniqueness guard, output preview API

### What's Missing for Daily-Driver Use

**Priority 1 — Must Fix (session breaks)**
1. **Terminal scrollback lost on page reload**: When you navigate away and come back, the xterm reconnects to the PTY but previous output is gone. The master terminal should restore scrollback from the output buffer on reconnect.
2. **No initial prompt input**: When you click "Start Master", it spawns Claude but doesn't send any initial message. The user needs a way to type "Build feature X" and have that sent as the first prompt to the master. Add an input field or modal.
3. **Console should be the default page**: Change the root `/` route to redirect to `/console` (or make console the index page).

**Priority 2 — Must Improve (workflow gaps)**
4. **Inline task board**: Show task cards/list directly in the console page (collapsed sidebar or bottom panel), not requiring navigation to `/taskboard`. The user needs to see what's in progress without leaving.
5. **Worker output expansion**: Clicking a worker card should expand it inline with a mini-terminal showing live output (not just 8 lines). Currently it opens `/terminals` in a new tab — keep that as option but add inline expansion.
6. **Initial instruction input**: After clicking "Start Master", show a text area where the user types their goal. This gets sent to the master terminal as the first input. Think of it like a chat prompt.
7. **Quick actions bar**: Buttons for common operations: "Start Swarm", "Stop Swarm", "Create Task", "View Task Board", "System Health" — things the user would otherwise need curl/API for.

**Priority 3 — Polish (better experience)**
8. **Master terminal auto-scroll**: On reconnect with existing output, scroll to bottom.
9. **Split view option**: Let the user split the console to show master + one worker side by side.
10. **Notification integration**: Show notification bell count in the console header (reuse existing notification system).
11. **Cost display in header**: Move cost from status bar to more prominent position.
12. **Keyboard shortcuts**: `Ctrl+Enter` to send input, `Ctrl+W` to spawn worker, etc.

## Architecture Notes

### Key Files
| File | What It Does |
|------|-------------|
| `operator/public/console.html` | Console page layout — master panel + worker panel + status bar |
| `operator/public/console.js` | ~515 lines: master terminal, worker refresh, WS events, spawn/kill |
| `operator/public/style.css` | Console CSS (lines 5151-5343): layout, worker cards, status bar |
| `operator/master-context.md` | System prompt for master Claude — API reference + workflow guidance |
| `operator/claude-pool.mjs` | Pool manager: role, persistent, getMasterTerminal(), getOutputPreview() |
| `operator/routes/claude-terminals.mjs` | REST API: spawn, kill, list, GET /master, GET /:id/output |
| `operator/ws.mjs` | Binary WS for terminal PTY + JSON WS for events |
| `operator/public/app.js` | Shared UI: toast, WS reconnect, CSRF token injection |

### How the Master Terminal Works
1. User clicks "Start Master" → `startMaster()` in console.js
2. Fetches `/master-context.md` for system prompt (truncated to 8000 chars)
3. POST `/api/claude-terminals` with `{ id: 'master', role: 'master', persistent: true, dangerouslySkipPermissions: true, autoHandoff: true, systemPrompt: ... }`
4. Backend spawns a `node-pty` process running `claude` CLI
5. Frontend creates xterm.js Terminal, connects binary WS to `/ws/claude-terminal/master`
6. User types in xterm → WS → PTY → Claude processes → PTY output → WS → xterm
7. Worker panel polls `/api/claude-terminals` every 5s + WS events for real-time updates

### How Workers Work
1. Master Claude (or user via UI) calls operator API to create tasks
2. Workers spawned with `autoDispatch: true, autoComplete: true`
3. Pool auto-assigns tasks to idle workers
4. Workers are full Claude Code instances — they read CLAUDE.md and work autonomously
5. On task completion, auto-complete marks the task done and worker becomes idle for next task

### The System Prompt (`master-context.md`)
This is critical — it teaches the master Claude how to use the operator API via curl commands. It covers:
- Task management (create, list, cancel)
- Worker spawning (with autoDispatch/autoComplete)
- Swarm mode (auto-scale workers)
- Monitoring (health, search, cost, performance)
- Shared memory (cross-terminal state)
- Inter-terminal messaging

**To improve the master's effectiveness, enhance this prompt with:**
- Specific project context (what the codebase is, key files)
- Common workflow patterns ("for a new feature, create tasks like...")
- Error recovery patterns ("if a worker fails...")

## Implementation Suggestions

### 1. Scrollback Restoration
The `getOutputPreview(id, lines)` API already exists. On reconnect (`init()` finds existing master), fetch the full output buffer and write it to xterm before connecting the live WS:
```javascript
// In init(), after detecting existing running master:
var outputResp = await fetch('/api/claude-terminals/master/output?lines=200');
if (outputResp.ok) {
  var outputData = await outputResp.json();
  if (outputData.lines) {
    masterTerminal.write(outputData.lines.join('\r\n') + '\r\n');
  }
}
// Then connect live WS
connectMasterBinaryWs(masterTerminalId);
```

### 2. Initial Prompt Input
Add a modal or inline textarea that appears after spawning master:
```html
<div id="master-prompt-input" style="display:none">
  <textarea id="master-initial-prompt" placeholder="What would you like to build?"></textarea>
  <button onclick="sendInitialPrompt()">Send to Master</button>
</div>
```
Send by writing to the binary WS: `masterBinaryWs.send(text + '\n')`

### 3. Inline Task Panel
Add a collapsible panel below the worker panel that fetches `/api/coordination/tasks` and renders a compact task list. Reuse the existing task board rendering patterns from `taskboard.js` but simplified.

### 4. Console as Default
In `server.mjs`, change:
```javascript
// Dashboard at /dashboard, console at /
app.get('/dashboard', (_req, res) => res.sendFile(join(publicDir, 'index.html')));
// Or redirect:
app.get('/', (_req, res) => res.redirect('/console'));
```

## Testing

**3,951 tests** across **74 suites** — all passing.
- Run: `npm test` or `npx vitest run`
- Console-specific tests: `operator/__tests__/master-console.test.mjs` (21 tests)
- Security tests: `operator/__tests__/security.test.mjs` (40 tests)

## Gotchas

- Only one master terminal allowed — spawning a second throws "Master terminal already exists"
- `persistent: true` and `role: 'master'` terminals are immune to swarm scale-down
- `GET /api/claude-terminals/master` is registered BEFORE `/:id` catch-all to avoid route conflicts
- Console page fetches `/master-context.md` as a static asset — file is in `operator/` dir
- `dangerouslySkipPermissions: true` gives master and workers full tool access (needed for autonomous work)
- Auth middleware skips non-`/api/` paths — page routes don't need tokens
- CSRF auto-disabled when `auth: false` (test mode) unless `csrf: true` explicit
- Worker output preview maxes at 200 lines (`GET /:id/output?lines=200`)
- Binary WS control messages use 0x01 prefix for ping/pong/resize
- `autoHandoff: true` on master means it will try to continue if context gets long

## What to Build First

Start with **Priority 1 items** (scrollback restoration + initial prompt input + console as default), then move to **Priority 2** (inline tasks + worker expansion + quick actions). Each priority level is roughly one session of work.

The goal is: user opens `localhost:3100`, sees the console, clicks Start Master, types "I want to add feature X", and the master breaks it into tasks, spawns workers, and manages the whole flow — all visible in the console page.
