# Jousting MVP — Session 139 Handoff

## Session Summary

### Context-Refresh: Replace Compaction with Fresh Restart + Handoff
- **Problem**: When Claude terminals hit context pressure (~70%), Claude auto-compacts — summarizing and discarding prior conversation, losing information quality
- **Solution**: Intercept context pressure at 50% threshold, generate structured handoff, git commit+push, kill terminal, spawn fresh with handoff injected via `--append-system-prompt`

#### Changes by file:

**`operator/claude-terminal.mjs`** (2 changes)
- `CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE`: `'70'` → `'50'` (detect context pressure earlier)
- `OUTPUT_BUFFER_SIZE`: `8192` → `32768` (4x larger ring buffer for handoff capture)

**`operator/claude-pool.mjs`** (~300 lines new, ~100 lines modified)
- 4 new constants: `CONTEXT_REFRESH_HANDOFF_TIMEOUT_MS` (60s), `CONTEXT_REFRESH_GIT_TIMEOUT_MS` (15s), `CONTEXT_REFRESH_SPAWN_DELAY_MS` (3s), `MAX_CONTEXT_REFRESHES` (10)
- 4 new entry fields: `contextRefreshCount`, `_contextRefreshState`, `_contextRefreshOutputCapture`, `_contextRefreshTimer`
- 6 new functions:
  - `parseHandoffFromOutput()` — finds `## HANDOFF` section in terminal output
  - `generateSyntheticContextHandoff()` — fallback when Claude doesn't produce proper handoff
  - `buildContextRefreshPrompt()` — builds system prompt with handoff for fresh terminal
  - `gitCommitForRefresh()` — `git add -A` + `git commit` + `git push` with timeouts
  - `maybeContextRefresh()` — orchestrates the full refresh flow (guards, handoff request, parsing, timeout)
  - `_finishContextRefresh()` — kills terminal, writes shared memory, spawns fresh with handoff
- Context-refresh trigger added in `context-warning` handler (fires when `autoHandoff` enabled)
- `maybeAutoHandoff` converted to fresh restart (no `-c` flag), injects handoff via `--append-system-prompt`
- `formatEntry` updated with `contextRefreshCount` and `contextRefreshState`
- `shutdownAll` clears context-refresh timers
- Swarm scale-down skips terminals mid-context-refresh
- Double-call guard in `_finishContextRefresh` prevents race conditions

**`operator/ws.mjs`** (3 new bridged events)
- `claude-terminal:context-refresh-started`
- `claude-terminal:context-refresh-completed`
- `claude-terminal:context-refresh-failed`

**`operator/__tests__/claude-pool.test.mjs`** (13 new tests)
- Constants export, trigger on context-warning, no-trigger when disabled, re-entry guard, max refreshes limit, handoff parsing + full refresh cycle, timeout with synthetic handoff, task carry-forward, lifecycle event emission, exit during handoff, formatEntry fields, fresh restart auto-handoff, freshRestart flag on handoff event

**`operator/__tests__/claude-terminals.test.mjs`** (1 test updated)
- Updated autocompact threshold assertion `'70'` → `'50'`

## Current State

- **Tests**: 3965 passing across 74 suites (was 3952 before session — +13 new)
- **TypeScript**: Not checked (operator is pure .mjs)
- **Deploy**: Not applicable (operator system, not game UI)
- **Git**: master branch, up to date with origin, 10 uncommitted files (pre-existing orchestrator/operator state files, not related to this work)

## Architecture Changes

### Context-Refresh Flow (New)
```
context-warning detected (50% threshold)
  → maybeContextRefresh() guards check
  → Write handoff prompt to PTY
  → Listen for "## HANDOFF" in output (60s timeout)
  → Parse handoff OR generate synthetic fallback
  → git add -A + commit + push (non-blocking)
  → Write to shared memory
  → Kill terminal (disable autoHandoff to prevent old handler)
  → Wait for exit
  → Spawn fresh terminal after 3s delay:
    - continueSession: false (NO -c flag)
    - systemPrompt: handoff via --append-system-prompt
    - Restore carried task if any
  → Emit context-refresh-completed
```

### Auto-Handoff Change (Modified)
Previously: terminal exits cleanly → respawn with `-c` (continue session)
Now: terminal exits cleanly → parse handoff from output buffer → respawn fresh with handoff in system prompt (no `-c`)

## Files Modified

| File | Lines Changed | Category |
|------|--------------|----------|
| `operator/claude-terminal.mjs` | +3/-3 | Config (threshold + buffer) |
| `operator/claude-pool.mjs` | +405/-6 | Core logic (context-refresh) |
| `operator/ws.mjs` | +3/-0 | Event bridging |
| `operator/__tests__/claude-pool.test.mjs` | +252/-2 | Tests |
| `operator/__tests__/claude-terminals.test.mjs` | +1/-1 | Test fix |

## Known Issues / TODO

1. **UI integration**: The `terminals.html` / `terminals.js` frontend doesn't yet show context-refresh status or events. The WebSocket events are bridged but no UI consumes them.
2. **Git commit in tests**: `gitCommitForRefresh()` silently fails in tests (no git repo at `/tmp/pool-test`). This is correct behavior but means git integration is only tested manually.
3. **Handoff prompt quality**: The handoff-generation prompt sent to Claude is generic. Could be improved with task-specific context or structured templates.
4. **Pre-existing uncommitted files**: 10 files modified outside this session (operator/auth.mjs, operator/server.mjs, orchestrator state files). These appear to be from a prior orchestrator run.

## Git State

- **Branch**: master
- **Last commit**: `3d68269 Context-refresh: replace compaction with fresh restart + handoff`
- **Remote**: up to date with origin/master
- **Uncommitted**: 10 modified files + 14 untracked files (all pre-existing, not from this session)

## Edge Cases Handled

- **Handoff timeout**: Synthetic handoff from output buffer after 60s
- **Terminal exits during handoff**: Captured output used as handoff
- **Parse failure**: Synthetic handoff with raw output tail
- **Git failure**: Logged, doesn't block refresh
- **Rapid context warnings**: `_contextRefreshState` guard prevents re-entry
- **Max refreshes**: Falls back to natural compaction after 10 refreshes
- **Respawn failure**: Task released back to pending queue
- **Double-call race**: State guard in `_finishContextRefresh` prevents duplicate spawns
