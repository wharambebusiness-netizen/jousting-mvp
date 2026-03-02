# Session Handoff: Phase 69 — Per-Master Worker Allocation & Swarm Unification

## What Was Done This Session

### Phase 68 (Committed & Pushed — `8a4dd3d`)

"Phase 68: Multi-Master Operator UI + Observer Agent"

- **Master Command Strip**: Replaced tabbed UI with persistent 4-cell grid showing all masters (status dots, focus text, worker counts, cost, heartbeat age)
- **Worker Grouping**: Worker cards grouped by owning master in collapsible sections
- **Alert Banner**: Persistent warning banner for stale heartbeats, stuck workers, budget warnings
- **Observer Agent**: Rule-based backend watchdog (`operator/observer.mjs`) — stuck worker respawn, circuit breaker, budget halt, orphaned task recovery on 15s interval
- **Tests**: 4518 total passing across 89 suites (was 4465)

### UX Audit Findings

A first-time-user walkthrough revealed that **Swarm and Multi-Master are completely disconnected systems**. The target workflow (4 masters, 7 workers each = 28 workers) cannot be done through the UI:

1. Console "+" worker button spawns workers with **no `_masterId`** — they're unowned
2. Console Swarm button hardcodes `{ minTerminals: 3, maxTerminals: 3 }` — no config, workers unowned
3. `workerIds` Set in master registry is **declared but never populated**
4. `MAX_TERMINALS = 8` caps the entire pool — 4+28=32 is way over
5. Task routing ignores master ownership — any worker can claim any task
6. Terminals page has a full swarm config dialog; Console has nothing

## What Needs To Be Done (Phase 69)

### P1: Fix Worker Spawn to Assign Active Master (Quick Win)
**File**: `operator/public/console.js` (~line 1399)
- In `spawnWorker()`: add `_masterId: activeMasterId` to the POST body when `activeMasterId` is set
- Manually spawned workers will belong to the active master and show grouped under it

### P2: Populate Master Registry `workerIds` (Quick Win)
**File**: `operator/claude-pool.mjs`
- In `spawn()` (~line 470): when `opts._masterId` is set and master exists in registry, add terminal ID to `_masterRegistry.get(opts._masterId).workerIds`
- In terminal exit handler: remove worker ID from its master's `workerIds`
- Enables accurate worker counts in the master strip

### P3: Console Swarm Config Dialog (Medium)
**Files**: `operator/public/console.html`, `operator/public/console.js`, `operator/public/style.css`
- Add a `<dialog>` for swarm config (mirror `terminals.html`'s `#swarm-config-dialog`)
- Fields: minTerminals, maxTerminals, model, per-master toggle
- When per-master ON: swarm workers get `_masterId: activeMasterId`
- Replace hardcoded `toggleSwarm()` to open dialog
- Show swarm state indicator in Console header

### P4: Configurable Pool Cap (Medium)
**Files**: `operator/claude-pool.mjs`, `operator/settings.mjs`, `operator/public/settings.html`
- Make `MAX_TERMINALS` configurable via settings (default 8, up to 64)
- Add to Settings page under "Coordination" section
- Swarm `maxTerminals` already raises `_effectiveMaxTerminals` (line 2335) — just needs UI exposure

### P5: Per-Master Swarm Mode (Larger)
**Files**: `operator/claude-pool.mjs`, `operator/routes/claude-terminals.mjs`
- New API: `POST /api/claude-terminals/masters/:id/swarm` — swarm scoped to a master
- Each master gets own `{ minTerminals, maxTerminals }` in registry
- `_swarmScaleCheck()` iterates per-master instead of globally
- Workers spawned for a master get `_masterId` automatically
- Scale-down only kills workers belonging to their master

### P6: Master-Affinity Task Routing (Larger)
**File**: `operator/claude-pool.mjs`
- In `findNextClaimableTask()` (~line 1276): boost tasks created by the worker's master
- Add `createdBy` field on tasks when master creates via coordinator
- Workers strongly prefer own master's tasks, fallback to cross-master claims

### Sequencing
P1 + P2 are independent quick wins. P3 depends on P1. P4 is independent. P5 depends on P2+P3. P6 depends on P5.

## Key Code Locations

| What | File | Line | Notes |
|------|------|------|-------|
| Console spawnWorker | `operator/public/console.js` | ~1399 | Missing `_masterId` |
| Console toggleSwarm | `operator/public/console.js` | ~686 | Hardcoded 3/3 |
| Pool MAX_TERMINALS | `operator/claude-pool.mjs` | 20 | Default 8 |
| Master registry | `operator/claude-pool.mjs` | 70 | `_masterRegistry` Map |
| Master spawn registration | `operator/claude-pool.mjs` | 525 | `workerIds` Set declared empty |
| Worker spawn with masterId | `operator/claude-pool.mjs` | 470 | Sets worktree not registry |
| Swarm scale check | `operator/claude-pool.mjs` | 2187 | `_swarmScaleCheck()` |
| findNextClaimableTask | `operator/claude-pool.mjs` | 1276 | Affinity scoring |
| Terminals swarm dialog | `operator/public/terminals.html` | ~460 | Reference dialog to copy |
| Swarm API routes | `operator/routes/claude-terminals.mjs` | 528 | start/stop/status/metrics |

## Current State

- Branch: `master`, pushed to remote
- 4518/4518 tests passing, 89 suites
- No uncommitted code (only `.data/` runtime files and this handoff)

## Key Gotchas

- `auth: false` required in test `createApp()` calls
- BRIDGED_EVENTS count is now 115 (was 108)
- MAX_MASTERS=4 in claude-pool.mjs
- MCP server has 15 tools
- server.mjs has NO shebang — intentionally removed for Vitest compat
- Don't add box-drawing or other non-ASCII chars to operator/*.mjs files (Vitest transform breaks)
- Observer module auto-starts on server boot — tests may need to account for this
