# Research: Worker Prompt/Instruction System

## 1. Existing Input API — How PTY Write Works

### Chain of Execution

1. **REST API** (`routes/claude-terminals.mjs:215-225`):
   ```
   POST /api/claude-terminals/:id/input
   Body: { data: "some text" }
   ```
   Validates `data` is a string, then calls `claudePool.write(id, data)`.

2. **Pool write** (`claude-pool.mjs:1244-1249`):
   ```js
   function write(terminalId, data) {
     const entry = terminals.get(terminalId);
     if (!entry || entry.status !== 'running') return false;
     entry.terminal.write(data);
     return true;
   }
   ```
   Looks up the terminal entry in the Map, forwards to `entry.terminal.write()`.

3. **Terminal write** (`claude-terminal.mjs:247-250`):
   ```js
   function write(data) {
     if (state.status !== 'running') return;
     ptyProcess.write(data);
   }
   ```
   Writes directly to the `node-pty` process stdin.

### How Auto-Dispatch Uses It

The auto-dispatch system (`claude-pool.mjs:1028-1030`) already sends task instructions via PTY write:
```js
const prompt = `[AUTO-DISPATCH] Task ${claimable.id}: ${claimable.task}`;
write(terminalId, prompt + '\r');
```

Context-resume after respawn also uses PTY write (`claude-pool.mjs:488`):
```js
write(entry.id, `[CONTEXT-RESUMED] Continuing task ${savedTask.taskId}: ${savedTask.task}\r`);
```

### Binary WS Path (How Master Console Sends Input)

The master terminal uses a **binary WebSocket** for real-time bidirectional PTY I/O:
- `console.js:153-157`: `masterTerminal.onData()` → `masterBinaryWs.send(data)`
- The WS bridge in `ws.mjs` pipes this directly to `ptyProcess.write()`
- Worker mini-terminals are **read-only** (`disableStdin: true` at `console.js:185`)

### Key Finding
**Workers currently have NO input path from the console UI.** Their mini-terminals are output-only viewers. The only way to send input to a worker is:
1. Via REST API `POST /api/claude-terminals/:id/input`
2. Via binary WS (if connected with write capability — currently only master uses this)
3. Internally via `claudePool.write()` (auto-dispatch, context-resume)

---

## 2. Terminal Message Bus — Inter-Terminal Communication

### Architecture (`terminal-messages.mjs`)

A structured, ordered message bus with:
- **Broadcast messages** (to=null) — visible to all terminals
- **Targeted messages** (to=terminalId) — visible only to sender + recipient
- **Threaded replies** (replyTo=messageId) — up to 50 depth
- **Categories** — arbitrary string tags (e.g., 'general', 'task', 'instruction')
- **Unread tracking** — per-terminal unread counts
- **Ring buffer** — max 5000 messages, oldest evicted first
- **Disk persistence** — atomic writes to JSON file
- **EventBus integration** — emits `terminal-message:sent`, `terminal-message:broadcast`, etc.

### REST API (`routes/terminal-messages.mjs`)

```
GET    /api/terminal-messages                  — List (filter by terminalId, category)
POST   /api/terminal-messages                  — Send { from, to, content, category, replyTo }
GET    /api/terminal-messages/:id              — Get single
GET    /api/terminal-messages/:id/thread       — Get thread
GET    /api/terminal-messages/unread/:id       — Unread count
POST   /api/terminal-messages/mark-read/:id    — Mark read
DELETE /api/terminal-messages/:id              — Soft-delete
DELETE /api/terminal-messages                  — Clear all
```

### WS Bridge (`ws.mjs:504-505`)

Terminal message events are bridged to WebSocket clients:
- `terminal-message:sent` — real-time notification when any message is sent
- `terminal-message:broadcast` — broadcast-specific event
- `terminal-message:deleted`, `terminal-message:cleared`

### Key Finding
The message bus is a **metadata/coordination** channel — it does NOT write to any terminal's PTY. A terminal (Claude agent) would need to **poll** its inbox or have a watcher that reads messages and injects them as PTY input. Currently **no such bridge exists**.

---

## 3. How to Add Prompt Input UI Per Worker Card

### Current Worker Card Structure (`console.js:793-970`)

Each worker card contains:
- Header: dot + id + model badge + actions (handoff/kill)
- Task line: assigned task label or "Idle"
- Info row: cost, handoffs, context health, utilization
- Capabilities pills
- Meta row: status + age
- Mini-terminal container (expandable, read-only)

### Proposed UI: Inline Prompt Input Per Worker

Add a prompt input area between the task line and the mini-terminal:

```html
<!-- Inside each worker card, after task div, before terminal -->
<div class="worker-card__prompt" data-worker-id="worker-1">
  <textarea class="worker-card__prompt-input" rows="1"
    placeholder="Send instruction to worker..."></textarea>
  <div class="worker-card__prompt-actions">
    <button class="btn btn--xs btn--primary worker-card__prompt-send">Send</button>
    <span class="worker-card__prompt-hint">Ctrl+Enter</span>
  </div>
</div>
```

### Implementation in `createWorkerCard()` (~line 862)

Insert after `card.appendChild(taskDiv)`:

```js
// ── Prompt input ────────────────────────────────────────
if (isRunning && !isStopped) {
  var promptDiv = document.createElement('div');
  promptDiv.className = 'worker-card__prompt';

  var promptInput = document.createElement('textarea');
  promptInput.className = 'worker-card__prompt-input';
  promptInput.rows = 1;
  promptInput.placeholder = 'Send instruction to worker...';
  promptDiv.appendChild(promptInput);

  var promptActions = document.createElement('div');
  promptActions.className = 'worker-card__prompt-actions';

  var sendBtn = document.createElement('button');
  sendBtn.className = 'btn btn--xs btn--primary worker-card__prompt-send';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', function() {
    sendWorkerPrompt(w.id, promptInput);
  });
  promptActions.appendChild(sendBtn);

  var hint = document.createElement('span');
  hint.className = 'worker-card__prompt-hint';
  hint.textContent = 'Ctrl+Enter';
  promptActions.appendChild(hint);

  promptDiv.appendChild(promptActions);
  card.appendChild(promptDiv);

  // Ctrl+Enter handler
  promptInput.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      sendWorkerPrompt(w.id, promptInput);
    }
  });

  // Auto-resize textarea
  promptInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });
}
```

### Send Function

```js
function sendWorkerPrompt(workerId, textarea) {
  var text = textarea.value.trim();
  if (!text) return;

  // Option A: PTY input (immediate, appears in terminal)
  fetch('/api/claude-terminals/' + encodeURIComponent(workerId) + '/input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: text + '\n' })
  }).then(function(resp) {
    if (resp.ok) {
      textarea.value = '';
      textarea.style.height = 'auto';
      if (window.showToast) window.showToast('Sent to ' + workerId, 'success');
    } else {
      resp.json().then(function(err) {
        if (window.showToast) window.showToast(err.error || 'Send failed', 'error');
      });
    }
  }).catch(function(err) {
    if (window.showToast) window.showToast('Network error: ' + err.message, 'error');
  });
}
```

### CSS Additions (style.css)

```css
.worker-card__prompt {
  padding: 4px 8px;
  border-top: 1px solid rgba(99, 102, 241, 0.15);
}
.worker-card__prompt-input {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 4px;
  color: #e6edf3;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 4px 6px;
  resize: none;
  min-height: 24px;
  max-height: 100px;
}
.worker-card__prompt-input:focus {
  border-color: rgba(99, 102, 241, 0.5);
  outline: none;
}
.worker-card__prompt-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}
.worker-card__prompt-hint {
  font-size: 10px;
  color: #484f58;
}
```

---

## 4. PTY Input vs Message Bus — Recommendation

### Option A: PTY Input (Direct Write to Terminal)

**Pros:**
- Already works — `POST /api/claude-terminals/:id/input` exists and is tested
- Immediate effect — text appears in Claude's stdin, processed as user input
- Matches how auto-dispatch already sends tasks (`write(id, prompt + '\r')`)
- Visible in the worker's mini-terminal output (the prompt echo)
- No polling or bridge code needed
- Claude Code processes it as a normal user message

**Cons:**
- Raw text injection — no metadata (category, threading, sender identity)
- No audit trail beyond terminal scrollback
- If Claude is mid-response, the input may be buffered or cause issues
- No concept of "read/unread" or delivery confirmation

### Option B: Message Bus (Structured Communication)

**Pros:**
- Rich metadata: from, to, category, threading, timestamps
- Unread tracking and delivery confirmation
- Persistent history (disk-backed)
- Could build complex workflows (threaded conversations, priority messages)
- EventBus integration for real-time UI updates

**Cons:**
- **No PTY bridge exists** — messages sit in the bus, Claude agents can't see them
- Would need a polling/watcher mechanism to read messages and inject into PTY
- Adds latency and complexity for a simple "send instruction" use case
- Over-engineered for one-shot instructions
- Worker Claude agents have no built-in awareness of the message bus

### Option C: Hybrid (Recommended)

**Use PTY input for immediate instructions + log to message bus for audit trail.**

```js
async function sendWorkerPrompt(workerId, textarea) {
  var text = textarea.value.trim();
  if (!text) return;

  // 1. Send to PTY (immediate effect)
  var resp = await fetch('/api/claude-terminals/' + encodeURIComponent(workerId) + '/input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: text + '\n' })
  });

  if (!resp.ok) {
    var err = await resp.json().catch(function() { return {}; });
    if (window.showToast) window.showToast(err.error || 'Send failed', 'error');
    return;
  }

  // 2. Log to message bus (audit trail, could be surfaced in UI later)
  fetch('/api/terminal-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'master',
      to: workerId,
      content: text,
      category: 'instruction'
    })
  }).catch(function() { /* non-critical */ });

  textarea.value = '';
  textarea.style.height = 'auto';
  if (window.showToast) window.showToast('Sent to ' + workerId, 'success');
}
```

### Why Hybrid is Best

1. **PTY input is the only way to actually instruct the worker.** Claude Code agents read from stdin — the message bus has no path into the agent.
2. **Message bus provides audit trail.** The `instruction` category gives us a searchable history of all human-to-worker instructions.
3. **Message bus enables future features.** Once the audit trail exists, we can add:
   - Instruction history panel per worker card
   - "Re-send last instruction" button
   - Cross-session instruction replay
   - Worker-to-master replies via message bus (already supported)
4. **Auto-dispatch already uses PTY write.** This is the established pattern — extending it to human instructions is consistent.

---

## 5. Implementation Plan

### Phase 1: Basic Prompt Input (Minimal)
1. Add `worker-card__prompt` section to `createWorkerCard()` in console.js
2. Add `sendWorkerPrompt()` function using PTY input API
3. Add CSS styles for the prompt input
4. Wire up Ctrl+Enter and click handlers

### Phase 2: Audit Trail
1. Log instructions to message bus with `category: 'instruction'`
2. Add instruction count to worker card info row
3. Add instruction history popover (click to see past instructions)

### Phase 3: Rich Interaction (Future)
1. Worker-to-master replies via message bus
2. Instruction templates/presets dropdown
3. Broadcast instructions to all workers
4. Two-way message panel in worker expanded view

### Files to Modify
- `operator/public/console.js` — worker card prompt UI + send function
- `operator/public/console.html` — no changes needed (cards are dynamic)
- `operator/public/style.css` — prompt input styles
- `operator/routes/claude-terminals.mjs` — no changes needed (input API exists)

### Estimated Effort
- Phase 1: ~30 lines JS + ~20 lines CSS = small change
- Phase 2: ~50 more lines JS
- Phase 3: larger scope, can be scoped separately
