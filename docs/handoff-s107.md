# Session 107 Handoff — Phase 3 Partial + Model Routing + Project-to-Terminal

## What S107 Did

### Completed (code written & applied)
1. **Context continuation** (Task 2 — DONE): `orchestrator-worker.mjs` + `process-pool.mjs`
   - Worker accepts `handoffFile` in `init` and `start` IPC messages
   - Passes `--handoff-file=<path>` CLI arg to orchestrator fork
   - Pool `spawn()` forwards `config.handoffFile` in init message
   - New `pool.handoff(workerId, handoffFile)` convenience method

2. **Model routing module** (Task 5 — PARTIAL): `orchestrator/model-routing.mjs` created
   - `MODEL_TIERS`: haiku=1, sonnet=2, opus=3
   - `ROLE_MODEL_MAP`: coordination→haiku, code→sonnet, critical→opus
   - `resolveAgentModel(role, userModel)`: user model is ceiling, never exceeds it
   - **STILL NEEDS**: import + usage in `orchestrator/orchestrator.mjs` (see below)

3. **Project-to-Terminal button** (Task 4 — PARTIAL):
   - `projects.mjs`: "⌨ Terminal" button added to project card headers
   - `app.js`: `openProjectInTerminal()` stores project dir in sessionStorage, navigates to /terminals
   - **STILL NEEDS**: `terminals.js` changes to handle `pending-terminal-project` (see below)

### NOT Applied (agent specs ready, need code written)
4. **Handoff API endpoints** (Task 1): Full spec from agent, needs to be applied to `operator/routes/orchestrator.mjs`
5. **Handoff terminal UI** (Task 3): Full spec from agent, needs to be applied to `terminals.js` + `style.css`
6. **Tests** (Task 6): Blocked on Tasks 1-5

## What S108 Should Do

### Priority 1: Apply remaining agent specs (read agent outputs below)

#### A. Handoff API — `operator/routes/orchestrator.mjs`
Add these 3 endpoints + 1 helper after the `DELETE /:id` route:

1. **`generateHandoffDoc(instanceId)`** helper — reads instance state + agent map, writes markdown to `<operatorDir>/handoffs/orch-<id>-<timestamp>.md`, returns `{ handoffFile, summary, timestamp }`
2. **`POST /:id/handoff`** — validates instance exists & running (404/409), calls generateHandoffDoc, emits `handoff:generated`, returns `{ success, handoffFile, summary }`
3. **`GET /:id/handoffs`** — scans handoffs dir for `orch-<id>-*.md` files, returns `[{ file, timestamp, size }]` sorted newest-first
4. **`POST /:id/handoff-restart`** — generates handoff → kills instance → waits 300ms → respawns with handoffFile + optional model/dryRun overrides, emits `handoff:restart`

Add `handoff:generated` and `handoff:restart` to BRIDGED_EVENTS in `ws.mjs`.

#### B. Handoff Terminal UI — `operator/public/terminals.js`
1. Add `openHistoryDropdown` state var
2. Add click-outside handler for dropdown
3. Add Handoff + History buttons to status bar `term-status__actions`
4. Add `handoffInstance(id)` — async function with 5-step ANSI progress, calls POST handoff-restart
5. Add `showHandoffHistory(id, triggerBtn)` — dropdown of previous handoffs
6. Add `handoff:*` to WS subscription patterns
7. Add `handoff:generated` / `handoff:restart` event handlers
8. Update `updateStatusBar()` to show/hide handoff button based on running state
9. Export `window.handoffInstance` and `window.showHandoffHistory`

#### C. Handoff CSS — `operator/public/style.css`
Append section 42 with: `.handoff-progress`, `.handoff-step` variants, `.btn--accent`, `.handoff-history`, `.handoff-history__dropdown`, `.handoff-history__item`

#### D. Project-to-Terminal completion — `operator/public/terminals.js`
1. Add `checkPendingProject()` function — reads sessionStorage, generates instance ID, opens dialog with pre-filled values
2. Call `checkPendingProject()` in `init()` after `connectWS()`
3. Modify `submitNewInstance()` to include `projectDir` from dialog dataset in start payload

#### E. Model routing integration — `orchestrator/orchestrator.mjs`
1. Add import: `import { resolveAgentModel } from './model-routing.mjs';`
2. In `loadMission()`, change agent model assignment from `a.model || null` to `a.model || (a.role ? resolveAgentModel(a.role, CONFIG.model || 'sonnet') : null)`

### Priority 2: Tests
- Handoff API: generation, 404/409 errors, file listing, restart workflow
- Model routing: resolveAgentModel with various role+userModel combos
- Context continuation: handoffFile flows through IPC protocol
- Project-to-Terminal: button renders, sessionStorage flow

### Priority 3: Run full test suite
`npm test` — should still pass 1657 tests (no existing code broken, only additive changes)

## Key Files Modified This Session
| File | Status | Changes |
|------|--------|---------|
| `operator/orchestrator-worker.mjs` | DONE | handoffFile state, IPC protocol, CLI arg passing |
| `operator/process-pool.mjs` | DONE | handoffFile in spawn/init, handoff() method |
| `orchestrator/model-routing.mjs` | NEW | MODEL_TIERS, ROLE_MODEL_MAP, resolveAgentModel() |
| `operator/views/projects.mjs` | DONE | Terminal button on project cards |
| `operator/public/app.js` | DONE | openProjectInTerminal() function |
| `operator/routes/orchestrator.mjs` | TODO | Handoff API endpoints |
| `operator/public/terminals.js` | TODO | Handoff UI + project-to-terminal handling |
| `operator/public/style.css` | TODO | Section 42 handoff CSS |
| `orchestrator/orchestrator.mjs` | TODO | model-routing import + usage |
| `operator/ws.mjs` | TODO | Add handoff events to BRIDGED_EVENTS |

## What NOT to Do
- Don't modify process pool or existing orchestrator routes (Phase 1 stable)
- Don't start Phase 4 (agent roster) until Phase 3 is fully tested
- Don't break the 1657 existing tests
