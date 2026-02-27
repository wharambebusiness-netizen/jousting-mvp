# Console UX Worker Card Improvements — Research

**Date**: 2026-02-27
**Files analyzed**: `operator/public/console.js` (1522 lines), `operator/public/console.html` (137 lines), `operator/public/style.css` (worker card section ~5174-5622), `operator/claude-pool.mjs` (formatEntry at ~line 1564), `operator/routes/claude-terminals.mjs`

---

## 1. Mini-Terminal Height & Click-to-Expand

### Current State

The mini-terminal is hardcoded at **80px collapsed → 240px expanded**:

```css
/* style.css:5418-5430 */
.worker-card__terminal {
  position: relative;
  margin-top: var(--sp-1);
  height: 80px;
  background: #0d1117;
  border-radius: var(--radius-sm);
  overflow: hidden;
  transition: height 200ms ease-out;
}
.worker-card__terminal--expanded {
  height: 240px;
}
```

The expand button is a tiny 18x18px triangle arrow, **hidden by default** (opacity: 0), only visible on card hover:

```css
/* style.css:5389-5416 */
.worker-card__expand {
  position: absolute;
  top: 4px; right: 4px;
  width: 18px; height: 18px;
  opacity: 0;
  /* ... */
}
.worker-card:hover .worker-card__expand { opacity: 1; }
```

Toggle logic refits xterm after 220ms (matching the 200ms CSS transition):

```js
/* console.js:984-995 */
function toggleWorkerExpand(workerId, termContainer, expandBtn) {
  var expanded = termContainer.classList.toggle('worker-card__terminal--expanded');
  expandBtn.innerHTML = expanded ? '&#9660;' : '&#9650;';
  var entry = workerTerminals[workerId];
  if (entry && entry.fitAddon) {
    setTimeout(function() {
      try { entry.fitAddon.fit(); } catch(_) {}
    }, 220);
  }
}
```

The entire card is also clickable to open `/terminals#workerId` in a new tab:

```js
/* console.js:966-968 */
card.addEventListener('click', function() {
  window.open('/terminals#' + encodeURIComponent(w.id), '_blank');
});
```

### Problems

1. **80px is ~5-6 lines at font-size 9px** — too small to see meaningful Claude output. A single tool call header fills most of it.
2. **240px expanded is still cramped** — only ~16 lines. Users frequently want to monitor full tool outputs.
3. **Expand button is invisible until hover** — discoverability is near-zero. New users don't know they can expand.
4. **Card click → new tab conflicts with expand** — clicking anywhere on the card opens terminals page. The expand button must `e.stopPropagation()` to prevent this, but the terminal area itself has no such protection. Clicking the terminal area opens a new tab instead of expanding.
5. **No intermediate sizes** — only two states (80px / 240px). No way to drag-resize.
6. **xterm at 9px font-size** — extremely small, hard to read even when expanded.

### Improvement Proposals

**P1: Increase default mini-terminal height to 120px, expanded to 360px**
```css
.worker-card__terminal {
  height: 120px;  /* was 80px — fits ~8 lines */
}
.worker-card__terminal--expanded {
  height: 360px;  /* was 240px — fits ~24 lines */
}
```

**P2: Make terminal area click-to-expand (not card-level navigation)**
```js
// Change: clicking the terminal area toggles expand (not opens new tab)
termContainer.addEventListener('click', function(e) {
  e.stopPropagation();
  toggleWorkerExpand(w.id, termContainer, expandBtn);
});
```
Keep the card-level click for navigation only on the header/meta rows, not the terminal.

**P3: Always-visible expand affordance**
Replace the hidden opacity-0 expand button with a visible bottom edge grip:
```css
.worker-card__terminal::after {
  content: '···';
  display: block;
  text-align: center;
  font-size: 0.7rem;
  color: var(--text-muted);
  cursor: ns-resize;
  padding: 2px 0;
  background: linear-gradient(transparent, rgba(13,17,23,0.8));
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
}
```

**P4: "Open Full" button in expanded state**
When expanded, show a link to `/terminals#workerId` instead of the ambiguous card click:
```js
if (expanded) {
  var openLink = document.createElement('a');
  openLink.href = '/terminals#' + w.id;
  openLink.textContent = 'Open Full Terminal →';
  openLink.className = 'worker-card__open-full';
  termContainer.appendChild(openLink);
}
```

**P5: Increase mini-terminal font to 10px** for readability:
```js
var term = new Terminal({
  fontSize: 10,  // was 9
  lineHeight: 1.25,
  // ...
});
```

---

## 2. Worker Card Info Density

### Currently Shown

The worker card displays these fields (from `createWorkerCard()` at console.js:793-978):

| Row | Fields | Source |
|-----|--------|--------|
| Header | status dot, terminal ID, model badge (opus/sonnet/haiku), kill/dismiss button | `w.id`, `w.model`, `w.status` |
| Task | assigned task name + priority badge (P6+) | `w.assignedTask.task`, `.priority` |
| Info | cost, handoff count, context state, tasks completed | `w._costUsd`, `w.handoffCount`, `w.contextRefreshState`, `w.utilization.tasksCompleted` |
| Caps | capability pills | `w.capabilities[]` |
| Meta | status text, relative age | `w.status`, `w.spawnedAt` |
| Terminal | mini xterm (80px) | binary WS stream |

### Available from API but NOT Shown

The `formatEntry()` function in claude-pool.mjs returns **40+ fields**. Key missing ones:

| Field | Value | Why it matters |
|-------|-------|----------------|
| `utilization.tasksFailed` | number | Critical for spotting broken workers |
| `utilization.activeMs` / `idleMs` | number | Efficiency ratio — is worker earning its cost? |
| `utilization.lastTaskCompletedAt` | ISO timestamp | Staleness detection — how long since last productive output? |
| `contextRefreshCount` | number | How many times worker has been refreshed (high = burning context fast) |
| `taskHistory` | string[] (last 5 categories) | Shows worker specialization pattern |
| `exitCode` / `exitSignal` | number/string | For stopped workers: why did it die? |
| `stoppedAt` | ISO timestamp | When exactly did it stop? |
| `assignedTask.category` | string | Task type classification |
| `assignedTask.assignedAt` | ISO timestamp | How long has worker been on this task? |
| `pid` | number | Process ID for debugging |
| `autoHandoff` / `autoDispatch` / `autoComplete` | boolean | Configuration transparency |
| `swarmManaged` | boolean | Is this worker managed by swarm auto-scaling? |
| `cols` / `rows` | number | Terminal dimensions |

### Improvement Proposals

**P1: Add failure count next to tasks-completed**
```js
// In info row construction (console.js:910-915)
if (w.utilization) {
  var statsText = w.utilization.tasksCompleted + ' done';
  if (w.utilization.tasksFailed > 0) {
    statsText += ' / ' + w.utilization.tasksFailed + ' failed';
  }
  utilSpan.textContent = statsText;
}
```

**P2: Add active-time efficiency percentage**
```js
if (w.utilization && (w.utilization.activeMs + w.utilization.idleMs) > 0) {
  var efficiency = Math.round(w.utilization.activeMs / (w.utilization.activeMs + w.utilization.idleMs) * 100);
  var effSpan = document.createElement('span');
  effSpan.textContent = efficiency + '% active';
  effSpan.style.color = efficiency > 70 ? 'var(--status-success)' : efficiency > 40 ? 'var(--status-warning)' : 'var(--status-error)';
  info.appendChild(effSpan);
}
```

**P3: Show context refresh count (not just current state)**
```js
// Change from just "ctx: healthy" to "ctx: healthy (3)"
var ctxLabel = w.contextRefreshState || 'healthy';
if (w.contextRefreshCount > 0) {
  ctxLabel += ' (' + w.contextRefreshCount + ')';
}
```

**P4: Show task duration on assigned-task line**
```js
if (w.assignedTask && w.assignedTask.assignedAt) {
  var taskAge = timeSince(new Date(w.assignedTask.assignedAt));
  taskDiv.textContent = taskLabel + ' (' + taskAge + ')';
}
```

**P5: Show exit reason on stopped workers**
```js
if (isStopped) {
  var exitInfo = '';
  if (w.exitCode != null) exitInfo += 'exit ' + w.exitCode;
  if (w.exitSignal) exitInfo += ' (' + w.exitSignal + ')';
  if (exitInfo) {
    var exitSpan = document.createElement('span');
    exitSpan.className = 'worker-card__exit';
    exitSpan.textContent = exitInfo;
    meta.appendChild(exitSpan);
  }
}
```

**P6: Add behavior flags as tiny icons in header**
```js
// After model badge, add mini-icons for enabled behaviors
var flags = [];
if (w.autoHandoff) flags.push('↻');   // auto-restart
if (w.autoDispatch) flags.push('⇶');  // auto-dispatch
if (w.autoComplete) flags.push('✓');  // auto-complete
if (w.swarmManaged) flags.push('🐝');  // swarm

if (flags.length > 0) {
  var flagSpan = document.createElement('span');
  flagSpan.className = 'worker-card__flags';
  flagSpan.title = [
    w.autoHandoff && 'auto-handoff',
    w.autoDispatch && 'auto-dispatch',
    w.autoComplete && 'auto-complete',
    w.swarmManaged && 'swarm-managed'
  ].filter(Boolean).join(', ');
  flagSpan.textContent = flags.join('');
  header.appendChild(flagSpan);
}
```

**P7: Proposed enhanced card layout**

```
┌─────────────────────────────────────────────┐
│ ● worker-a3f2  [OPUS] ↻⇶✓  [Handoff] [×]  │  ← header: dot, id, model, flags, actions
│ Fix auth validation (2m ago)         P7     │  ← task + duration + priority
│ $0.42  2 handoffs  ctx: healthy (1)  3 done │  ← info row: cost, handoffs, ctx+count, done
│ [code] [test] [debug]                       │  ← capability pills
│ running · 14m ago · 78% active              │  ← meta: status, age, efficiency
│┌───────────────────────────────────────────┐│
││ (mini terminal - 120px)                   ││
││ ···································(grip) ││
│└───────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

---

## 3. Quick Actions on Worker Cards

### Current State

Only **two actions** exist on worker cards:

1. **Kill button** (×) — hover-only, for running workers:
```js
/* console.js:851-860 */
var killBtn = document.createElement('button');
killBtn.className = 'worker-card__kill btn btn--xs btn--ghost';
killBtn.title = 'Kill worker';
killBtn.textContent = '\u00d7';
killBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  killWorker(w.id);
});
```

2. **Handoff button** — hover-only, inside `__actions` span, calls `/respawn`:
```js
/* console.js:822-838 */
if (isRunning && !isStopped) {
  var handoffBtn = document.createElement('button');
  handoffBtn.className = 'btn btn--xs btn--ghost';
  handoffBtn.title = 'Trigger context refresh';
  handoffBtn.textContent = 'Handoff';
  handoffBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    triggerHandoff(w.id);
  });
  actions.appendChild(handoffBtn);
}
```

Both use `opacity: 0 → 1` on card hover. The kill button is positioned separately from the handoff button (kill is a direct child of header, handoff is inside `__actions` span).

### Missing Actions

| Action | API Endpoint | Use Case |
|--------|-------------|----------|
| **Respawn** (stopped workers) | `POST /api/claude-terminals` | Restart a dead worker with same config |
| **Send prompt** | Binary WS `send(text)` | Quick instruction without opening full terminal |
| **Claim task** | `POST /api/claude-terminals/:id/claim-task` | Manually assign a task to an idle worker |
| **Release task** | `POST /api/claude-terminals/:id/release-task` | Unassign a stuck task |
| **Toggle auto-dispatch** | `PUT /api/claude-terminals/:id/auto-dispatch` | Enable/disable auto-dispatch |
| **Toggle auto-complete** | `PUT /api/claude-terminals/:id/auto-complete` | Enable/disable auto-complete |
| **Set capabilities** | `PUT /api/claude-terminals/:id/capabilities` | Change worker specialization |

### Improvement Proposals

**P1: Respawn button for stopped workers**
Currently stopped workers only have a dismiss (×) button. Add a respawn button:
```js
if (isStopped) {
  var respawnBtn = document.createElement('button');
  respawnBtn.className = 'btn btn--xs btn--ghost worker-card__respawn';
  respawnBtn.title = 'Respawn worker';
  respawnBtn.textContent = '↻';
  respawnBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    respawnStoppedWorker(w);
  });
  header.appendChild(respawnBtn);
}

async function respawnStoppedWorker(w) {
  try {
    var resp = await fetch('/api/claude-terminals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: w.id,
        role: w.role || 'worker',
        autoDispatch: w.autoDispatch !== false,
        autoComplete: w.autoComplete !== false,
        dangerouslySkipPermissions: true,
        capabilities: w.capabilities || []
      })
    });
    if (resp.ok) {
      delete seenWorkers[w.id]; // clear stopped state
      showToast('Worker ' + w.id + ' respawned', 'success');
      refreshWorkers();
    }
  } catch(e) { showToast('Respawn failed', 'error'); }
}
```

**P2: Inline send-prompt for running workers**
Add a small text input that appears on click, sending directly to the worker's PTY:
```js
var promptBtn = document.createElement('button');
promptBtn.className = 'btn btn--xs btn--ghost';
promptBtn.textContent = '💬';
promptBtn.title = 'Send prompt to worker';
promptBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  showWorkerPrompt(w.id);
});
actions.appendChild(promptBtn);

function showWorkerPrompt(workerId) {
  var card = document.querySelector('.worker-card[data-id="' + workerId + '"]');
  if (!card || card.querySelector('.worker-card__prompt')) return;

  var promptDiv = document.createElement('div');
  promptDiv.className = 'worker-card__prompt';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Send to worker...';
  input.className = 'worker-card__prompt-input';

  var sendBtn = document.createElement('button');
  sendBtn.className = 'btn btn--xs btn--primary';
  sendBtn.textContent = 'Send';

  function doSend() {
    var text = input.value.trim();
    if (!text) return;
    var entry = workerTerminals[workerId];
    if (entry && entry.binaryWs && entry.binaryWs.readyState === WebSocket.OPEN) {
      entry.binaryWs.send(text + '\n');
      promptDiv.remove();
      showToast('Sent to ' + workerId, 'success');
    } else {
      showToast('Worker terminal not connected', 'error');
    }
  }

  sendBtn.addEventListener('click', function(e) { e.stopPropagation(); doSend(); });
  input.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') doSend();
    if (e.key === 'Escape') promptDiv.remove();
  });

  promptDiv.appendChild(input);
  promptDiv.appendChild(sendBtn);
  card.appendChild(promptDiv);
  input.focus();
}
```

NOTE: Worker terminals are currently `disableStdin: true` (console.js:185). The binary WS is connected but input is disabled on the xterm instance. Sending via `entry.binaryWs.send()` bypasses xterm and writes directly to the PTY, which should work. However, this needs validation.

**P3: Action bar with context-sensitive buttons**
Replace the single handoff button with a small action bar:
```
Running worker:  [Handoff] [Send] [Kill]
Idle worker:     [Handoff] [Send] [Claim Task] [Kill]
Stopped worker:  [Respawn] [Dismiss]
```

**P4: Confirmation for kill action**
Currently `killWorker` calls DELETE immediately with no confirmation:
```js
async function killWorker(workerId) {
  if (!confirm('Kill worker ' + workerId + '?')) return;
  // ... existing DELETE logic
}
```

---

## 4. Stopped Worker Display & Dismiss UX

### Current State

Stopped workers are tracked via the `seenWorkers` object — workers that disappear from the API response get `_stopped = true`:

```js
/* console.js:686-692 */
Object.keys(seenWorkers).forEach(function(id) {
  if (!liveIds[id]) {
    seenWorkers[id]._stopped = true;
    seenWorkers[id].status = 'stopped';
  }
});
```

Stopped cards get reduced opacity:
```css
/* style.css:5272-5274 */
.worker-card--stopped {
  opacity: 0.55;
}
```

The dismiss button is a × that appears on hover:
```js
/* console.js:840-849 */
var dismissBtn = document.createElement('button');
dismissBtn.className = 'worker-card__dismiss btn btn--xs btn--ghost';
dismissBtn.title = 'Dismiss';
dismissBtn.textContent = '\u00d7';
```

Dismiss removes from `seenWorkers` and from DOM:
```js
/* console.js:1157-1169 */
function dismissWorker(workerId) {
  delete seenWorkers[workerId];
  disposeWorkerTerminal(workerId);
  var card = document.querySelector('.worker-card[data-id="' + workerId + '"]');
  if (card) card.remove();
}
```

### Problems

1. **No "Dismiss All" button** — with 3+ stopped workers, dismissing one-by-one is tedious.
2. **Stopped workers mixed with active ones** — they appear at the bottom of the list but there's no visual separator.
3. **No exit reason shown** — worker just shows "stopped" with no explanation (exitCode/exitSignal available from API but unused).
4. **No respawn option** — only dismiss. Can't restart a stopped worker.
5. **No auto-dismiss** — stopped workers persist in `seenWorkers` indefinitely within the session (lost on page reload).
6. **Stopped workers still have mini-terminal taking space** — the xterm instance and its 80px container remain, showing stale output.
7. **The dismiss × button uses the same style as the kill × button** — can be confused (both are × on hover). Kill is destructive, dismiss is cosmetic.

### Improvement Proposals

**P1: Visual separator between running and stopped workers**
```js
function renderWorkerPanel(workerList) {
  // ... existing logic ...

  // After rendering all cards, insert a separator before stopped cards
  var stoppedCards = list.querySelectorAll('.worker-card--stopped');
  if (stoppedCards.length > 0) {
    var firstStopped = stoppedCards[0];
    if (!firstStopped.previousElementSibling ||
        !firstStopped.previousElementSibling.classList.contains('worker-card__stopped-sep')) {
      var sep = document.createElement('div');
      sep.className = 'worker-card__stopped-sep';
      sep.innerHTML = '<span>Stopped</span>' +
        '<button class="btn btn--xs btn--ghost" onclick="dismissAllStopped()">Dismiss All</button>';
      firstStopped.parentNode.insertBefore(sep, firstStopped);
    }
  }
}
```

CSS:
```css
.worker-card__stopped-sep {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-1) var(--sp-2);
  margin: var(--sp-2) 0;
  font-size: 0.7rem;
  color: var(--text-muted);
  border-top: 1px solid var(--border-subtle);
}
```

**P2: Dismiss All Stopped button**
```js
function dismissAllStopped() {
  Object.keys(seenWorkers).forEach(function(id) {
    if (seenWorkers[id]._stopped) {
      dismissWorker(id);
    }
  });
}
```

**P3: Show exit code/signal on stopped cards**
```js
if (isStopped && (w.exitCode != null || w.exitSignal)) {
  var exitDiv = document.createElement('div');
  exitDiv.className = 'worker-card__exit-reason';
  var reason = w.exitSignal ? 'signal: ' + w.exitSignal : 'exit: ' + w.exitCode;
  exitDiv.textContent = reason;
  card.appendChild(exitDiv);
}
```

CSS:
```css
.worker-card__exit-reason {
  font-size: 0.65rem;
  color: var(--status-error);
  margin-top: var(--sp-1);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
```

**P4: Collapse mini-terminal on stopped workers**
Stopped workers don't need the 80px mini-terminal. Show a compact 1-line last-output instead:
```js
if (isStopped) {
  termContainer.style.height = '0px';
  termContainer.style.display = 'none';
  // Don't init xterm for stopped workers — saves memory
}
```

**P5: Auto-dismiss after timeout (optional)**
```js
// Mark stopped-at time for auto-dismiss
if (seenWorkers[id]._stopped && !seenWorkers[id]._stoppedAt) {
  seenWorkers[id]._stoppedAt = Date.now();
}

// In refreshWorkers, auto-dismiss after 5 minutes
var STOPPED_TTL = 5 * 60 * 1000;
Object.keys(seenWorkers).forEach(function(id) {
  if (seenWorkers[id]._stopped && seenWorkers[id]._stoppedAt) {
    if (Date.now() - seenWorkers[id]._stoppedAt > STOPPED_TTL) {
      dismissWorker(id);
    }
  }
});
```

**P6: Distinct dismiss vs kill styling**
```css
.worker-card__dismiss {
  color: var(--text-muted);  /* gray — cosmetic action */
}
.worker-card__kill {
  color: var(--status-error);  /* red — destructive action */
}
```

---

## 5. Implementation Priority

| # | Change | Effort | Impact | Priority |
|---|--------|--------|--------|----------|
| 1 | Increase mini-terminal height (80→120, 240→360) | XS | High | P0 |
| 2 | Click terminal area to expand (not navigate) | S | High | P0 |
| 3 | Show exit code/signal on stopped workers | XS | Med | P1 |
| 4 | Respawn button for stopped workers | S | High | P1 |
| 5 | Dismiss All Stopped button + visual separator | S | High | P1 |
| 6 | Add failure count + efficiency % to info row | S | Med | P1 |
| 7 | Inline send-prompt to worker | M | High | P2 |
| 8 | Show context refresh count | XS | Low | P2 |
| 9 | Show task duration on assigned-task line | XS | Med | P2 |
| 10 | Behavior flag icons (auto-handoff/dispatch/complete) | S | Low | P2 |
| 11 | Collapse mini-terminal on stopped workers | S | Med | P2 |
| 12 | Auto-dismiss stopped workers after timeout | S | Low | P3 |
| 13 | Increase mini-terminal font to 10px | XS | Med | P3 |
| 14 | Kill confirmation dialog | XS | Low | P3 |

**P0** items are quick wins that significantly improve daily usability.
**P1** items fix the biggest gaps in information and control.
**P2** items are nice-to-have improvements.
**P3** items are polish.

---

## 6. Key Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Worker card creation | `console.js` | 793-978 |
| Worker card metadata update | `console.js` | 1018-1152 |
| Mini-terminal init | `console.js` | 174-207 |
| Mini-terminal binary WS | `console.js` | 213-242 |
| Expand/collapse toggle | `console.js` | 984-995 |
| Kill worker | `console.js` | 1197-1203 |
| Dismiss worker | `console.js` | 1157-1169 |
| Handoff/respawn trigger | `console.js` | 1000-1013 |
| Worker refresh + merge logic | `console.js` | 643-707 |
| Activity dot update (WS) | `console.js` | 1322-1355 |
| Worker card CSS | `style.css` | 5174-5603 |
| Terminal CSS | `style.css` | 5418-5452 |
| API serialization (formatEntry) | `claude-pool.mjs` | ~1564-1601 |
| Terminal routes | `routes/claude-terminals.mjs` | full file |
