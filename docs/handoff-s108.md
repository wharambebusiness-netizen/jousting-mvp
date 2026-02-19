# Session 108 Handoff — Finish Phase 3: Handoff Workflow

## What S108 Did

### Bug Review & Fixes (from S107 compaction review)
Fixed 5 bugs in S107's Phase 3 code:
1. **model-routing.mjs**: `resolveAgentModel()` returned `undefined`/`null` when `userModel` was invalid — now normalizes to `'sonnet'` fallback
2. **projects.mjs**: Terminal button had XSS via single-quote injection in inline `onclick` — switched to `data-dir` attribute + `this.dataset.dir`
3. **process-pool.mjs**: `handoff()` could send `start` to non-running workers — added `entry.status === 'running'` guard
4. **orchestrator-worker.mjs**: Removed unused `resolve` import, added `!projectDir` guard in `start` handler

All 1657 tests still passing. Committed as `ba35be7`.

## What S109 Should Do

### Priority 1: Finish Phase 3 — Handoff API + UI + CSS

All specs below come from `docs/handoff-s107.md` (read it for full context). The S107 agent specs are detailed and ready to apply.

#### A. Handoff API — `operator/routes/orchestrator.mjs`

Add 3 endpoints + 1 helper **after the `DELETE /:id` route** (currently line ~410):

1. **`generateHandoffDoc(instanceId)`** helper function:
   - Read instance state from `instances` Map + agent map from `instanceAgentMaps`
   - Write markdown handoff to `<operatorDir>/handoffs/orch-<id>-<timestamp>.md`
   - Return `{ handoffFile, summary, timestamp }`
   - Create handoffs dir if not exists (`mkdirSync({recursive:true})`)

2. **`POST /:id/handoff`** — Generate handoff without restart:
   - 404 if instance not found, 409 if not running
   - Call `generateHandoffDoc(id)`, emit `handoff:generated` event
   - Return `{ success, handoffFile, summary }`

3. **`GET /:id/handoffs`** — List previous handoffs:
   - Scan `<operatorDir>/handoffs/` for `orch-<id>-*.md` files
   - Return `[{ file, timestamp, size }]` sorted newest-first

4. **`POST /:id/handoff-restart`** — Generate handoff → kill → respawn:
   - Generate handoff doc
   - Kill instance (pool.kill or SIGTERM direct)
   - Wait 300ms for exit
   - Respawn with `handoffFile` + optional `model`/`dryRun` overrides from `req.body`
   - Emit `handoff:restart` event
   - Return `{ success, handoffFile, newInstanceStatus }`

#### B. Add Handoff Events to WS Bridge — `operator/ws.mjs`

Add to BRIDGED_EVENTS array (currently 24 events, will become 26):
- `handoff:generated`
- `handoff:restart`

#### C. CLI Arg Parsing in orchestrator.mjs

The orchestrator-worker.mjs passes `--handoff-file=<path>` and `--model <value>` CLI args to the forked orchestrator process, but **orchestrator.mjs doesn't parse them**. Add:

1. **`--model` parsing** (near line 158, alongside `--dry-run`):
   ```javascript
   const modelArg = process.argv.find(a => a === '--model');
   const MODEL_OVERRIDE = modelArg ? process.argv[process.argv.indexOf(modelArg) + 1] : null;
   ```
   Then use `MODEL_OVERRIDE` in CONFIG initialization or in `loadMission()` to override agent models.

2. **`--handoff-file` parsing** (near line 158):
   ```javascript
   const handoffArg = process.argv.find(a => a.startsWith('--handoff-file='));
   const HANDOFF_FILE = handoffArg ? handoffArg.split('=')[1] : null;
   ```
   Use `HANDOFF_FILE` to inject context at orchestrator startup (e.g., prepend to agent system prompts or include in task board).

Note: The existing `MODEL_TIER` in orchestrator.mjs (line 220) uses `{ haiku: 0, sonnet: 1, opus: 2 }` (0-indexed) while `model-routing.mjs` uses `{ haiku: 1, sonnet: 2, opus: 3 }` (1-indexed). They don't interact directly, but be aware.

#### D. Model Routing Integration — `orchestrator/orchestrator.mjs`

In `loadMission()` (line ~313), change the agent model assignment:
```javascript
// Before:
model: a.model || null,

// After:
model: a.model || (a.role ? resolveAgentModel(a.role, CONFIG.model || 'sonnet') : null),
```

Add import at top of file:
```javascript
import { resolveAgentModel } from './model-routing.mjs';
```

#### E. Handoff Terminal UI — `operator/public/terminals.js`

Add to the existing terminals.js (~704 lines):

1. **Handoff + History buttons** in status bar actions (inside `addTerminalInstance()`, after start/stop buttons)
2. **`handoffInstance(id)`** function — async, shows 5-step ANSI progress in terminal:
   - Step 1: "Generating handoff..."
   - Step 2: POST to `/:id/handoff-restart`
   - Step 3: "Stopping instance..."
   - Step 4: "Restarting with context..."
   - Step 5: "Complete!" or error
3. **`showHandoffHistory(id, triggerBtn)`** — dropdown showing previous handoffs from `GET /:id/handoffs`
4. **Click-outside handler** to close history dropdown
5. **WS subscriptions** for `handoff:*` pattern
6. **Event handlers** for `handoff:generated` and `handoff:restart`
7. **`updateStatusBar()`** shows/hides handoff button based on running state
8. Export `window.handoffInstance` and `window.showHandoffHistory`

#### F. Project-to-Terminal Completion — `operator/public/terminals.js`

The button and `openProjectInTerminal()` in app.js are done. Still need:

1. **`checkPendingProject()`** function in terminals.js:
   - Read `sessionStorage.getItem('pending-terminal-project')`
   - If set, clear it, generate instance ID, open new-instance dialog pre-filled with project dir
2. Call `checkPendingProject()` in init IIFE after `connectWS()`
3. Modify `submitNewInstance()` to include `projectDir` from dialog `dataset` in start payload

#### G. Handoff CSS — `operator/public/style.css`

Append **section 42** with classes for:
- `.handoff-progress` — progress container in terminal
- `.handoff-step`, `.handoff-step--done`, `.handoff-step--active`, `.handoff-step--error` — step states
- `.btn--accent` — accent-colored button for handoff action
- `.handoff-history` — dropdown container
- `.handoff-history__dropdown` — positioned dropdown list
- `.handoff-history__item` — individual history entry

### Priority 2: Tests

Write tests for:
- **Handoff API**: generation writes file, 404/409 error cases, file listing, restart workflow
- **Model routing**: `resolveAgentModel` with various role + userModel combos (already verified to work after S108 fix)
- **Context continuation**: `handoffFile` flows through IPC protocol correctly
- **Project-to-Terminal**: button renders with `data-dir` attribute

### Priority 3: Verify Full Suite
`npm test` — should still pass 1657+ tests after all additions.

## Key Files to Modify

| File | What to Do |
|------|-----------|
| `operator/routes/orchestrator.mjs` | Add handoff API endpoints (3 routes + 1 helper) |
| `operator/ws.mjs` | Add `handoff:generated` + `handoff:restart` to BRIDGED_EVENTS |
| `orchestrator/orchestrator.mjs` | Add `--model` + `--handoff-file` CLI parsing, import `resolveAgentModel`, wire into `loadMission()` |
| `operator/public/terminals.js` | Handoff UI (buttons, progress, history dropdown) + project-to-terminal |
| `operator/public/style.css` | Section 42 handoff CSS |
| `operator/__tests__/server.test.mjs` | Handoff endpoint tests |
| `orchestrator/model-routing.test.mjs` | (NEW) resolveAgentModel tests |

## Current Architecture State

- **1657 tests** across 26 suites — ALL PASSING
- **Phase 0**: Factory patterns, EventBus, lockfile — DONE
- **Phase 1**: Process pool, multi-instance routes, worker IPC — DONE
- **Phase 2**: Multi-terminal UI with xterm.js — DONE
- **Phase 3**: Context continuation done, handoff API/UI/CSS + model routing — IN PROGRESS
- **Phase 4** (next): General-purpose agent roster (see `docs/multi-orchestrator-plan.md`)

## What NOT to Do
- Don't modify process pool internals or existing orchestrator routes structure (Phase 1 stable)
- Don't start Phase 4 until Phase 3 is fully tested
- Don't break the 1657 existing tests
- Don't touch the game engine or React frontend
