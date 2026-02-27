# Research: Terminals Page Worker Integration

**Date:** 2026-02-27
**Scope:** UI-M2 — Worker Terminals on Terminals Page

---

## 1. Tab System and Terminal Types

### Tab Data Structures

Tabs are tracked in a module-level `instances` Map keyed by terminal ID:

```js
// terminals.js ~line 144
var instances = new Map();   // id → instance object
var activeTabId = null;
var viewMode = 'tabs';       // 'tabs' | 'grid'
var gridLayout = 'quad';
var themeIndex = 0;          // cycles through 8 themes on each new tab
```

Each tab has a corresponding DOM button (`<button class="term-tab" data-instanceId="...">`) and a panel `<div>`.

There is no single `addTab()` function — there are two separate creation functions, one per terminal type:

| Function | Lines | Terminal Type |
|---|---|---|
| `addClaudeTerminalInstance(id, state)` | ~455–677 | Claude PTY (interactive) |
| `addTerminalInstance(id, state)` | ~1065–1290 | Orchestrator (output-only) |

### Instance Object Shape

**Claude PTY instance:**
```js
{
  id: string,
  type: 'claude',
  theme: { accent, bg, glow, xterm: {...colors} },
  terminal: Terminal,           // xterm.js v5.5.0
  fitAddon: FitAddon,
  searchAddon: SearchAddon,
  searchBar: HTMLElement,
  panel: HTMLElement,
  tab: HTMLElement,
  running: boolean,
  model: string,               // 'opus' | 'sonnet' | 'haiku'
  autoHandoff: boolean,
  autoDispatch: boolean,
  autoComplete: boolean,
  handoffCount: number,
  capabilities: string[],
  taskHistory: object[],
  binaryWs: WebSocket | null,  // Binary WS for PTY I/O
  dangerouslySkipPermissions: boolean,
  maximized: boolean,
  coord: { tasks, rateLimitOk, costUsd, budgetUsd, ... }
}
```

**Orchestrator instance:**
```js
{
  id: string,
  type: 'orchestrator',
  theme: { ... },
  terminal: Terminal,          // read-only xterm.js
  fitAddon: FitAddon,
  searchAddon: SearchAddon,
  panel: HTMLElement,
  tab: HTMLElement,
  running: boolean,
  round: number,
  agents: number,
  cost: number,
  mission: string,
  maximized: boolean,
  coord: { ... }
}
```

### Key Behavioral Differences

| Feature | Claude PTY | Orchestrator |
|---|---|---|
| `disableStdin` | `false` — interactive | `true` — read-only |
| `scrollback` | 10,000 lines | 5,000 lines |
| WebSocket | Binary WS `/ws/claude-terminal/{id}` | None (main WS events) |
| User input | `terminal.onData()` → `binaryWs.send(data)` | Disabled |
| Status bar | Permission toggle, auto-handoff/dispatch/complete, kill | Start/stop/handoff/config |
| Data source | PTY binary stream | `worker:log` / `orchestrator:log` WS events |

---

## 2. Auto-Populating Tabs from the Pool API

### Existing Pool API Endpoints

**List all terminals** (`routes/claude-terminals.mjs` ~line 40):
```
GET /api/claude-terminals
→ { terminals: TerminalStatus[], available: boolean }
```

Each `TerminalStatus` object:
```js
{
  id: string,
  status: 'running' | 'idle' | 'stopped',
  model: string,
  dangerouslySkipPermissions: boolean,
  autoHandoff: boolean,
  autoDispatch: boolean,
  autoComplete: boolean,
  handoffCount: number,
  capabilities: string[],
  taskHistory: object[]
}
```

**Pool aggregate stats** (`routes/claude-terminals.mjs` ~line 50):
```
GET /api/claude-terminals/pool-status
→ { available: boolean, running, maxTerminals, active, idle, waiting, withTask, withAutoDispatch, withAutoComplete, total }
```

### Existing Auto-Population Code

`terminals.js` already has `loadClaudeTerminals()` (~line 435) called during `init()`:

```js
function loadClaudeTerminals() {
  fetch('/api/claude-terminals')
    .then(r => r.json())
    .then(data => {
      if (!data || !data.terminals || !data.terminals.length) return;
      data.terminals.forEach(t => {
        addClaudeTerminalInstance(t.id, t);  // creates tab per worker
      });
    })
    .catch(() => { /* Claude terminals not available */ });
}
```

This runs **once at page load**. New workers spawned after page load are added via WS events:

```js
// terminals.js WS handler
case 'claude-terminal:spawned':
  addClaudeTerminalInstance(msg.data.id, msg.data);
  break;
case 'claude-terminal:stopped':
  removeClaudeTerminalInstance(msg.data.id);
  break;
```

### What's Already Working

The tab auto-population from pool API is **fully implemented** for the existing flow. When the page loads, all running Claude workers already get tabs. The gap is navigation **from the console page** and **deep-linking to a specific tab**.

---

## 3. Full-Size xterm vs Mini-Terminal in Console

### Full-Size xterm (terminals.html)

xterm.js v5.5.0 loaded from CDN in `terminals.html`:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-search@0.15.0/lib/addon-search.min.js"></script>
```

Terminal created at `terminals.js` ~line 477:
```js
var term = new Terminal({
  theme: theme.xterm,           // from THEMES[themeIndex % 8]
  fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
  fontSize: 13,
  lineHeight: 1.3,
  cursorBlink: true,
  scrollback: 10000,
  convertEol: true,
  disableStdin: false,          // INTERACTIVE
});
var fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
// ... SearchAddon ...
term.open(panelEl);
fitAddon.fit();
```

The terminal fills its panel container and responds to window resize events. 8 rotating themes (Nebula, Aurora, Solar, ...) cycle on each new tab creation.

### Binary WebSocket (PTY I/O)

The `connectClaudeBinaryWs(id)` function (~line 697) establishes a raw PTY pipe:

```js
var url = (location.protocol === 'https:' ? 'wss:' : 'ws:')
         + '//' + location.host
         + '/ws/claude-terminal/' + encodeURIComponent(id);
var ws = new WebSocket(url);

ws.onopen = () => {
  // Send initial resize
  var dims = inst.fitAddon.proposeDimensions();
  ws.send('\x01' + JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
};

ws.onmessage = evt => {
  var data = evt.data;
  if (typeof data === 'string' && data.charCodeAt(0) === 1) {
    // Control message (ping/pong)
    var ctrl = JSON.parse(data.slice(1));
    if (ctrl.type === 'ping') ws.send('\x01' + JSON.stringify({ type: 'pong' }));
    return;
  }
  inst.terminal.write(data);  // Raw PTY output
};

// User input → PTY stdin
inst._binaryInputDisposable = inst.terminal.onData(data => {
  if (inst.binaryWs?.readyState === 1) inst.binaryWs.send(data);
});

// Resize propagation
inst._binaryResizeDisposable = inst.terminal.onResize(size => {
  ws.send('\x01' + JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
});
```

Reconnection uses exponential backoff (initial → doubling → max 15s).

### Mini-Terminal in Console (index.html)

The console (`index.html`) currently shows worker cards with:
- Status dot (active/idle/waiting/stopped)
- Model badge
- Context health bar
- Cost/task counts
- Quick action buttons (kill, handoff, etc.)

There is **no embedded xterm in the console worker cards**. The console uses a simple scrolling `<div>` log panel (ANSI-to-HTML rendered server-side) for the terminal viewer in session detail, not a live interactive xterm.

The full xterm experience is **exclusively on the terminals page**.

---

## 4. Navigating from Console Worker Card to Terminals Tab

### Current State

No links exist from console worker cards to the terminals page. Users must navigate manually.

### Proposed Implementation

#### Step A: URL Parameter Support in terminals.js

Add tab deep-linking to the `init()` function, **after** `loadClaudeTerminals()` completes:

```js
// terminals.js — modify loadClaudeTerminals() to return a Promise,
// then in init():

function loadClaudeTerminals() {
  return fetch('/api/claude-terminals')
    .then(r => r.json())
    .then(data => {
      if (!data || !data.terminals) return;
      data.terminals.forEach(t => addClaudeTerminalInstance(t.id, t));

      // NEW: check for ?tab=<id> after loading
      var urlParams = new URLSearchParams(window.location.search);
      var targetTab = urlParams.get('tab');
      if (targetTab && instances.has(targetTab)) {
        switchTab(targetTab);
      } else if (targetTab) {
        // Tab not found — show toast
        showToast('Terminal ' + targetTab + ' not found or not running', 'warning');
      }
    })
    .catch(() => {});
}
```

Alternatively, add a **hash-based approach** for simplicity:

```js
// At the end of init(), after all tabs are loaded:
(function checkUrlTarget() {
  var hash = window.location.hash.slice(1);  // e.g. #tab=claude-1
  if (hash.startsWith('tab=')) {
    var targetId = decodeURIComponent(hash.slice(4));
    if (instances.has(targetId)) {
      switchTab(targetId);
    }
  }
})();
```

**Recommendation:** Use `?tab=<id>` query parameter (cleaner, survives hard refresh).

#### Step B: "Open in Terminals" Link on Console Worker Cards

In the console worker card HTML (rendered by `views/agent-card.mjs` or inline in `index.html`), add a link button:

```js
// In the worker card action buttons area:
`<a href="/terminals?tab=${encodeURIComponent(worker.id)}"
   class="outline contrast"
   title="Open full terminal"
   target="_self">
   <svg ...><!-- terminal icon --></svg>
</a>`
```

Or as an HTMX-compatible link that preserves the page:
```html
<a href="/terminals?tab=claude-1" class="secondary" role="button">
  ⬡ Full Terminal
</a>
```

#### Step C: WS-Driven Tab Ready Signal

Since the terminals page may not have loaded the worker's tab yet when the link is clicked (race condition if worker was just spawned), handle the not-found case:

```js
// In terminals.js loadClaudeTerminals callback:
var targetTab = new URLSearchParams(window.location.search).get('tab');
if (targetTab) {
  if (instances.has(targetTab)) {
    switchTab(targetTab);
  } else {
    // Store pending target; apply once WS fires claude-terminal:spawned
    window._pendingTabTarget = targetTab;
  }
}

// In WS message handler for 'claude-terminal:spawned':
case 'claude-terminal:spawned':
  addClaudeTerminalInstance(msg.data.id, msg.data);
  if (window._pendingTabTarget === msg.data.id) {
    switchTab(msg.data.id);
    window._pendingTabTarget = null;
  }
  break;
```

---

## 5. Complete Implementation Plan for UI-M2

### Changes Required

#### `operator/public/terminals.js`

1. **Add URL `?tab=` deep-link support** in `loadClaudeTerminals()` (after tabs are added).
2. **Handle pending tab target** in `claude-terminal:spawned` WS case.
3. **No changes needed** to tab creation — `addClaudeTerminalInstance()` already works correctly.

#### `operator/public/index.html` (or views)

4. **Add "Open in Terminals" link** on each worker card, linking to `/terminals?tab=${worker.id}`.
5. The link should appear next to the existing action buttons (kill, handoff, etc.).

#### `operator/views/agent-card.mjs` (or equivalent renderer)

6. If worker cards are server-rendered, update the renderer to include the terminals link.

### Minimal Code Change for Deep-Linking (~15 lines)

```js
// In terminals.js, modify the loadClaudeTerminals fetch callback:
.then(function(data) {
  if (!data || !data.terminals) return;
  data.terminals.forEach(function(t) {
    addClaudeTerminalInstance(t.id, t);
  });

  // Deep-link: ?tab=<terminalId>
  var targetId = new URLSearchParams(window.location.search).get('tab');
  if (targetId) {
    if (instances.has(targetId)) {
      switchTab(targetId);
    } else {
      window._pendingTabTarget = targetId;  // wait for WS
      showToast('Waiting for terminal ' + targetId + '...', 'info');
    }
  } else if (sidebarOpen && !sidebarRoot && activeTabId) {
    // existing sidebar logic
    var inst = instances.get(activeTabId);
    if (inst && inst.type === 'claude') fetchSidebarRootForTerminal(activeTabId);
  }
})
```

And in the WS handler for `claude-terminal:spawned`:
```js
case 'claude-terminal:spawned':
  addClaudeTerminalInstance(msg.data.id, msg.data);
  if (window._pendingTabTarget === msg.data.id) {
    switchTab(msg.data.id);
    window._pendingTabTarget = null;
  }
  break;
```

### Worker Card Link (in console)

Find where worker cards render action buttons (likely `index.html` or a views file). Add:

```html
<a href="/terminals?tab={{ worker.id }}"
   class="btn-icon secondary"
   title="Open full-size terminal">⬡</a>
```

Or with JS (if cards are rendered client-side):
```js
var termLink = document.createElement('a');
termLink.href = '/terminals?tab=' + encodeURIComponent(worker.id);
termLink.className = 'outline contrast';
termLink.title = 'Open in Terminals page';
termLink.textContent = '⬡';
actionsEl.appendChild(termLink);
```

---

## 6. Summary Table

| Feature | Status | Location | Work Needed |
|---|---|---|---|
| Tab auto-population from pool | ✅ Implemented | `terminals.js:435` `loadClaudeTerminals()` | None |
| WS-driven tab add/remove | ✅ Implemented | `terminals.js` WS handler | None |
| Full xterm PTY for workers | ✅ Implemented | `addClaudeTerminalInstance()` | None |
| 8 color themes cycling | ✅ Implemented | `THEMES` array, `themeIndex` | None |
| Binary WS reconnect | ✅ Implemented | `connectClaudeBinaryWs()` | None |
| URL `?tab=` deep-link | ❌ Not implemented | `loadClaudeTerminals()` | ~15 lines |
| Pending tab target (race) | ❌ Not implemented | WS `claude-terminal:spawned` | ~8 lines |
| Console → terminals link | ❌ Not implemented | Worker card HTML/renderer | ~5 lines per card |
| Mini xterm in console cards | ❌ Not built | `index.html` worker cards | Larger work (skip for M2) |

**Recommended M2 scope:** Items marked ❌ in the top 3 rows above (~28 lines total). Skip mini-xterm in console (that's M1/M3 scope).
