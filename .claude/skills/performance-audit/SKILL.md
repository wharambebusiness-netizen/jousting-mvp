---
name: performance-audit
description: Analyze operator codebase for performance bottlenecks and optimization opportunities
allowed-tools: Read, Glob, Grep, Bash
model: sonnet
context: fork
agent: general-purpose
---

Perform a performance audit of the operator system in the jousting-mvp project.

## Scan Areas

### 1. Synchronous File I/O in Request Handlers
Search for `readFileSync`, `writeFileSync`, `statSync`, `readdirSync`, `existsSync` usage in request handlers (routes/ directory). These block the event loop and should use async equivalents.
- Check: operator/routes/*.mjs
- Check: operator/registry.mjs (loadRegistry reads full JSON file)
- Check: operator/settings.mjs

### 2. Registry Loading Pattern
- `loadRegistry()` reads the full JSON file on every call
- Evaluate if in-memory caching with invalidation would be better
- Check how many routes call loadRegistry() per request
- Check if multiple calls happen within a single request path

### 3. Subprocess Spawning
- `execSync` / `exec` / `spawn` calls in git.mjs, operator.mjs
- Frequency: how often are git commands spawned per page load?
- The /views/projects route calls getGitFileStatus() per project — N git processes per page load
- Consider caching git status with short TTL

### 4. Asset Size Analysis
- `style.css` — count total lines and sections, evaluate if splitting is warranted
- `app.js` — count total lines and systems, evaluate if code splitting or lazy loading is needed
- Both files are loaded on every page even when features aren't used

### 5. HTML Fragment Size
- Check the size of HTMX fragments returned by views.mjs
- Large fragments on polling endpoints waste bandwidth
- Check if any fragments do unnecessary computation

### 6. WebSocket Efficiency
- Check debounce intervals in ws.mjs
- Verify event bridge doesn't broadcast to unsubscribed clients
- Check for memory leaks in subscription tracking

### 7. File Watcher Resources
- How many fs.watch instances are created?
- Is there cleanup on unwatchProject?
- Are there potential memory leaks from debounce timers?

## Output Format

```
PERFORMANCE AUDIT
=================
Category: CRITICAL / HIGH / MEDIUM / LOW

[HIGH] description — file:line
  Impact: estimated effect on latency/throughput
  Fix: recommended optimization
```

End with summary: N issues by severity, top 3 recommended optimizations.
