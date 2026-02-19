---
name: test-coverage-audit
description: Analyze test gaps, untested modules, edge cases, and error path coverage
allowed-tools: Read, Glob, Grep, Bash
model: sonnet
context: fork
agent: general-purpose
---

Perform a test coverage audit of the operator system in the jousting-mvp project.

## Steps

### 1. Map Tested vs Untested Modules
For each operator source file, check if it has corresponding test coverage:

Source files:
- operator/operator.mjs — has tests? where?
- operator/server.mjs — tested in server.test.mjs
- operator/registry.mjs — tested in registry.test.mjs
- operator/settings.mjs — tested where?
- operator/errors.mjs — tested in errors.test.mjs
- operator/ws.mjs — tested where? (likely NO dedicated tests)
- operator/file-watcher.mjs — tested where? (likely NO dedicated tests)
- operator/routes/chains.mjs — tested via server.test.mjs?
- operator/routes/orchestrator.mjs — tested via server.test.mjs?
- operator/routes/git.mjs — tested via server.test.mjs?
- operator/routes/settings.mjs — tested via server.test.mjs?
- operator/routes/files.mjs — tested via server.test.mjs?
- operator/routes/views.mjs — tested via views.test.mjs?
- operator/views/helpers.mjs — tested where?
- operator/views/chain-row.mjs — tested via views.test.mjs?
- operator/views/session-card.mjs — tested via views.test.mjs?
- operator/views/agent-card.mjs — tested via views.test.mjs?
- operator/views/terminal.mjs — tested via views.test.mjs?
- operator/views/analytics.mjs — tested via views.test.mjs?
- operator/views/projects.mjs — tested via views.test.mjs?

### 2. Check Test Quality for P10 Features
Read operator/__tests__/views.test.mjs and operator/__tests__/server.test.mjs.
For P10 features specifically, check:
- File content preview: happy path, binary detection, size limit, path traversal, missing params
- Git status indicators: badge rendering, dir change detection, status code mapping
- File search: search input rendered, filter behavior
- Collapsible cards: collapse toggle rendered, state persistence

### 3. Identify Missing Edge Cases
For each tested feature, consider:
- Error paths: network failures, file not found, permission denied
- Boundary conditions: empty arrays, null values, very large inputs
- Concurrency: simultaneous requests, race conditions
- Input validation: malformed inputs, special characters, unicode

### 4. WebSocket Coverage (ws.mjs)
- Are EventBus subscriptions tested?
- Are client message handlers tested?
- Is reconnection logic tested?
- Are pattern-based subscriptions tested?

### 5. File Watcher Coverage (file-watcher.mjs)
- Is debounce behavior tested?
- Is cleanup on unwatchProject tested?
- Is error handling for invalid directories tested?
- Is the project:files-changed event emission tested?

### 6. Error Path Analysis
For each route handler:
- What happens with malformed JSON body?
- What happens when registry file is corrupted?
- What happens when git is not installed?
- What happens when file system permissions are denied?

## Output Format

```
TEST COVERAGE AUDIT
===================
Category: CRITICAL (untested critical path) / HIGH (untested error path) / MEDIUM (missing edge case) / LOW (nice to have)

Module Coverage Map:
  [module] — N tests | GAPS: [list of untested areas]

[CRITICAL] description
  Impact: what could break silently
  Test: suggested test case

[HIGH] ...
```

End with summary: N modules fully tested, N partially tested, N untested. Top 5 recommended tests to add.
