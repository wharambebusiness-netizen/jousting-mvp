# Handoff: S138 → S139+

## What was done (S138)

**Phase 16: Test Coverage Foundation** — Closed the most critical test gaps.

1. **settings.test.mjs** (37 tests, new file): Full coverage of settings persistence — defaults, roundtrip save/load, all 12 field validations, value clamping (int/float), corrupt JSON recovery, model/theme validation, coord fields, atomic write, edge cases.

2. **ws.test.mjs** (40 tests, new file): WebSocket event bridge coverage — pattern matching (exact, prefix wildcard, global wildcard), subscription management (subscribe/unsubscribe/accumulate), event bridging (matching, non-matching, multiple clients), output throttling (1/sec session:output), binary terminal WebSocket (PTY data flow, user input forwarding, resize control messages, invalid control handling, PTY exit → WS close, listener cleanup), 503 on unknown paths.

3. **orchestrator-worker.test.mjs** (23 tests, new file): Worker IPC protocol via fork() — init/ready handshake, ping/pong, start errors (no init, missing orchestrator), stop error (not running), unknown message handling, null/non-object message safety, config updates (model/budget/turns + worker:config-applied event), all 5 coordination messages (coord:proceed/wait/rate-grant/rate-wait/budget-stop), coord messages before init safety, graceful shutdown, dry-run start/stop with real orchestrator, handoff file storage.

4. **Coordination route tests** (20 tests, added to server.test.mjs): Full REST API coverage — status endpoint, lifecycle (start/drain/restart/stop/restart-fails), task CRUD (create/list/get/get-404/batch), task operations (PATCH update, cancel, retry), progress summary, rate limiter status, cost aggregation, adaptive rate status, hot-reconfiguration, 503 guard (9 endpoints tested without coordinator).

5. **Bug fix — session:output throttle** (ws.mjs line 268): `outputThrottle.shouldSend(client)` → `outputThrottle(client)`. The `createThrottle()` returns the function directly, not an object with a `.shouldSend()` method. This meant `session:output` throttling was silently broken — every output event threw a TypeError that was swallowed because the EventBus handler catch-all absorbed it.

**Final count: 2646 tests, 37 suites, ALL passing.**

## Architecture notes

- settings.test.mjs uses temp dirs per test, tests all clamping ranges
- ws.test.mjs uses buffered WebSocket client (`ws.nextMsg()`) to avoid race conditions with welcome messages — standard `ws.on('message')` after `connectWs()` loses the welcome on Windows
- orchestrator-worker.test.mjs tests via actual `fork()` of the worker — uses a filtered message buffer that matches waiters by predicate, not FIFO
- Coordination route tests use mock pool injection pattern (same as Phase 9 tests)

## Test verification

```bash
npm test    # 2646 tests, 37 suites — all must pass
```

---

## Milestones for S139+ (Next Sessions)

### Phase 16 Remaining (Optional)

The critical test gaps are closed. Optional remaining items:
- View fragment tests (~19 untested HTMX fragments)
- File route edge cases (large files, symlinks)
- Git merge conflict scenarios
- Chain batch-delete endpoint

### Phase 17: Scalability & Reliability (Priority: HIGH)

See jousting-handoff-s137.md for full details. Key tasks:
1. Task orphan detection & requeue
2. Staggered heartbeat
3. IPC message batching
4. Graduated circuit breaker
5. Cached worker state

### Phases 18-22

See jousting-handoff-s137.md — unchanged priorities.

## Key files changed

| File | Change |
|------|--------|
| `operator/ws.mjs:268` | Bug fix: throttle function call |
| `operator/__tests__/settings.test.mjs` | New (37 tests) |
| `operator/__tests__/ws.test.mjs` | New (40 tests) |
| `operator/__tests__/orchestrator-worker.test.mjs` | New (23 tests) |
| `operator/__tests__/server.test.mjs` | +20 coordination route tests |
| `CLAUDE.md` | Updated test counts |

## Critical gotchas for next Claude

All prior gotchas from S137 handoff still apply, plus:

- **ws.test.mjs uses buffered WS client**: Don't use raw `waitForMessage()` — use `ws.nextMsg()` from `connectWs()`. The welcome message races with listener setup on Windows.
- **orchestrator-worker.test.mjs message buffer**: The `waitFor(filterFn)` scans all waiters on each message, not FIFO. If you get timeouts, check that the filter predicate actually matches the message shape.
- **Coordinator lifecycle**: init → running → draining → stopped. Can restart from draining but NOT from stopped. `start()` throws when state is `stopped`.
- **Rate limiter status fields**: `requestBucket` + `tokenBucket`, not `requestsRemaining`/`tokensRemaining`.
- **Adaptive limiter status fields**: `backoffLevel` + `state`, not `currentLevel`/`backoffMultiplier`.
- **session:output throttle was broken**: Fixed in this session. The fix is `outputThrottle(client)` not `outputThrottle.shouldSend(client)`.
