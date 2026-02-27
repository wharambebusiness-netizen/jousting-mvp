# HANDOFF — Session 155

## What Happened This Session

**Implemented all 5 priority steps from S154 worker research review + started prompt enhancement feature.**

**4,005 tests passing** across 74 suites (unchanged).

### Commit 1: S154 Worker Research Implementation (`f26e708`)

All 5 steps from the S154 handoff's "Next Steps" section:

**Step 1 — Trivial Fixes:**
- `taskboard.js:1557`: Fixed `'in-progress'` → `'assigned'` (valid task-queue status)
- `app.js`: Added `updateSidebarActiveLink()` on initial page load
- `console.js`: fitAddon.fit() wrapped in rAF+setTimeout(50) for cache restore timing

**Step 2 — Task Board Integration:**
- `server.mjs:288`: `needsCoordinator` includes `options.claudePool` (respects `coordination: false`)
- `routes/claude-terminals.mjs`: Emits `coord:assigned` on POST claim-task
- `claude-pool.mjs`: Emits `coord:assigned` on auto-dispatch

**Step 3 — Console UX:**
- Mini-terminals: 80→120px collapsed, 240→360px expanded
- Respawn button for stopped workers (new ID, copies original config)
- "Dismiss stopped" button in worker panel header
- Exit code/signal on stopped worker cards
- Inline prompt textarea per running worker (Ctrl+Enter to send)

**Step 4 — Swarm Hardening:**
- Batch scale-up: up to 4 terminals per tick (was 1)
- Circuit breaker: halts swarm after 5 consecutive spawn failures
- Exponential backoff: `5s × 2^crashes` delay before respawn
- Task recovery: logging + `task-recovery-failed` event

**Step 5 — Dashboard & Navigation:**
- Dashboard widgets auto-refresh via WS events (debounced 500ms)
- Terminals page: `?tab=<id>` deep-linking with URL state
- Console worker cards link to `/terminals?tab=<id>`

### Commit 2: Prompt Enhancement + Execution Fix (uncommitted)

**Bug fix:** `sendInitialPrompt()` sent `\n` (newline) but PTY needs `\r` (carriage return) to execute. Auto-dispatch already used `\r`. Fixed in both master prompt and worker prompt paths.

**Prompt enhancement endpoint:** Added `POST /api/enhance-prompt` in `server.mjs`:
- Spawns `claude -p --model haiku` with enhancement instruction
- Returns `{ enhanced: string, fallback: bool }`
- 30s timeout, falls back to original prompt on error

**UI flow in `sendInitialPrompt()`:**
1. User types prompt, clicks Send
2. Button shows "Enhancing..."
3. Calls `/api/enhance-prompt` with raw text
4. Sends enhanced text + `\r` to master terminal via binary WS

---

## KNOWN ISSUE — Prompt Enhancement Not Working As Expected

**User reported:** "The prompt doesn't get edited or reviewed."

**Likely causes to investigate:**
1. **The `claude -p` command may not be returning output correctly** — the `execFile` callback may have encoding or buffering issues on Windows. Debug by testing: `node -e "require('child_process').execFile('claude', ['-p', '--model', 'haiku', 'Say hello'], {env:{...process.env, CLAUDECODE:''}}, (e,o,s)=>console.log({e,o,s}))"`
2. **The enhanced prompt is sent but looks the same** — the user may want to SEE the enhanced version before it's sent. Currently it goes straight to the terminal with no preview step.
3. **Auth issue** — `claude -p` may require auth that isn't available in the server's process env (CLAUDECODE is cleared to prevent nested-session guard).
4. **Timeout** — 30s may not be enough if the API is slow; check if the fallback fires.

**Recommended fix approach for next session:**
- Add a **preview step** in the UI: after enhancement, show the improved prompt in the textarea so the user can review/edit before confirming
- Add a **"Send as-is"** button alongside "Enhance & Send" for users who want to skip enhancement
- Debug the `claude -p` execution by adding response logging
- Consider showing a diff or highlight of what changed

---

## Files Modified

| File | Changes |
|------|---------|
| `operator/server.mjs` | `needsCoordinator` fix + `POST /api/enhance-prompt` endpoint |
| `operator/public/console.js` | `\n`→`\r` fix, enhancement flow, worker prompt `\r` fix |
| `operator/public/console.html` | "Dismiss stopped" button |
| `operator/public/style.css` | Heights, prompt/respawn/exit/dismiss CSS |
| `operator/public/index.html` | WS widget refresh script |
| `operator/public/terminals.js` | `?tab=` deep-linking |
| `operator/public/taskboard.js` | Status fix |
| `operator/public/app.js` | Sidebar init |
| `operator/routes/claude-terminals.mjs` | `coord:assigned` event |
| `operator/claude-pool.mjs` | Swarm hardening + `coord:assigned` |
| `operator/ws.mjs` | New bridged events |

## Test Suite

**4,005 tests** across **74 suites** — all passing.

## Gotchas

- `needsCoordinator` respects `coordination: false` even with claudePool — tests depend on this
- Task status on claim is `'assigned'` not `'running'` — matches task-queue semantics
- Circuit breaker halts entire `_swarmScaleCheck` — reset only via `setSwarmMode` re-enable
- BRIDGED_EVENTS is now 103 (was 101)
- `\r` not `\n` for PTY execution in binary WS sends
- `POST /api/enhance-prompt` uses `execFile('claude', ['-p', '--model', 'haiku', ...])` — needs CLAUDECODE='' env to avoid nested guard
- Enhancement falls back silently to original prompt on any error

## Next Steps — PRIORITY

1. **Fix prompt enhancement** — debug `claude -p` execution, add preview step so user sees enhanced prompt before sending
2. **Phase 61: Template Library** — Pre-built task workflow patterns
3. **Remaining research items**: utilization chart, popstate handler, message bus PTY bridge
