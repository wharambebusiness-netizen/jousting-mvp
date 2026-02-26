#!/usr/bin/env node
// Quick script to dispatch task prompts to idle Claude terminal workers via binary WS.
// Usage: node operator/dispatch-tasks.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(__dirname, '.data', 'cli-token.txt'), 'utf8').trim();

const tasks = [
  {
    id: 'worker-1',
    prompt: `Fix stale stopped-terminal accumulation in operator/claude-pool.mjs.

Non-swarm, non-persistent stopped terminals accumulate indefinitely in the terminals Map. Add a cleanup pass inside the activity-check interval (around line 107) that removes non-persistent stopped terminals older than a configurable TTL (default 5 minutes via STALE_TERMINAL_TTL_MS constant). Emit a 'claude-terminal:stale-removed' event with {terminalId, stoppedAt, age}. Also clean up stale context-refresh shared-memory keys when removing terminals.

Steps:
1. Read operator/claude-pool.mjs to understand the activity check interval and terminal lifecycle
2. Add STALE_TERMINAL_TTL_MS constant (default 5 * 60 * 1000)
3. In the activity check interval, iterate terminals, find non-persistent stopped ones older than TTL, call remove() on them
4. Emit claude-terminal:stale-removed event for each
5. Run: npx vitest run operator/__tests__/claude-pool.test.mjs
6. When done, write a brief summary of what you changed`,
  },
  {
    id: 'worker-2',
    prompt: `Fix context-warning dedup flag in operator/claude-terminal.mjs.

The contextWarningEmitted flag (around line 190) is set to true on the first context-warning match and never reset. If a terminal auto-compacts and continues for a second full context window, no second context-warning will fire, so maybeContextRefresh in the pool will never trigger again.

Steps:
1. Read operator/claude-terminal.mjs to find contextWarningEmitted
2. Change the dedup logic: track lastContextWarningAt timestamp instead of a boolean
3. Allow re-emission after a 60-second cooldown (CONTEXT_WARNING_COOLDOWN_MS = 60000)
4. Add a test in operator/__tests__/claude-terminals.test.mjs for the multi-compaction scenario
5. Run: npx vitest run operator/__tests__/claude-terminals.test.mjs
6. When done, write a brief summary of what you changed`,
  },
  {
    id: 'worker-3',
    prompt: `Fix binary WS reconnect after terminal respawn in operator/public/terminals.js.

When a terminal is respawned server-side (e.g., context-refresh), the client receives claude-terminal:spawned/respawned events over the JSON WS but does NOT reconnect the binary PTY WebSocket. This means typed input is silently dropped after a server-side respawn.

Steps:
1. Read operator/public/terminals.js and find the WS event handlers for claude-terminal:spawned and claude-terminal:context-refresh-completed
2. In those handlers, check if the instance type is 'claude' and the terminal is now running
3. If so, close the old binary WS if it exists, then call connectClaudeBinaryWs(inst) to re-establish the PTY link
4. Test manually by reviewing the code logic
5. When done, write a brief summary of what you changed`,
  },
  {
    id: 'worker-4',
    prompt: `Fix binary WS heartbeat timer leak in operator/ws.mjs.

The binaryPingTimer setInterval (around line 265) is never .unref()'d, unlike the JSON WS heartbeat at line ~349 which calls heartbeatInterval.unref(). This prevents Node.js from exiting cleanly.

Steps:
1. Read operator/ws.mjs and find binaryPingTimer
2. Add .unref() after the setInterval call
3. In wss.cleanup() (around line 554), ensure binary WS connections are terminated AND their individual binaryPingTimer intervals are cleared
4. Run: npx vitest run operator/__tests__/ws.test.mjs
5. When done, write a brief summary of what you changed`,
  },
  {
    id: 'worker-5',
    prompt: `Add deletePrefix() and watchPrefix() methods to operator/shared-memory.mjs.

Currently watch() only works for single keys and there is no way to watch or batch-delete a namespace like "context-refresh:worker-1:*".

Steps:
1. Read operator/shared-memory.mjs thoroughly
2. Add watchPrefix(prefix, handler) — registers a handler called for any key matching the prefix on set/delete
3. Add deletePrefix(prefix) — batch-deletes all keys with the given prefix, returns count of deleted keys
4. Call prefix watchers from existing set() and del() methods when key matches any watched prefix
5. Export both methods in the public API return object
6. Add tests in operator/__tests__/shared-memory.test.mjs
7. Run: npx vitest run operator/__tests__/shared-memory.test.mjs
8. When done, write a brief summary of what you changed`,
  },
  {
    id: 'worker-6',
    prompt: `Fix unread count inflation in operator/terminal-messages.mjs.

When the ring buffer evicts the oldest message (around line 128), the unreadCounts map is not updated. If the evicted message was an unread targeted message to a terminal, that terminal's unread count is permanently inflated.

Steps:
1. Read operator/terminal-messages.mjs thoroughly
2. At ring-buffer eviction (around line 128), before deleting the oldest message, check if it was targeted (msg.to !== null) and still unread for the recipient
3. If so, decrement the recipient's unread count
4. Also: in toJSON(), filter out messages with deleted:true so they do not consume ring buffer capacity after load/save cycles
5. Add tests in operator/__tests__/terminal-messages.test.mjs for both fixes
6. Run: npx vitest run operator/__tests__/terminal-messages.test.mjs
7. When done, write a brief summary of what you changed`,
  },
  {
    id: 'worker-7',
    prompt: `Add PATCH /claude-terminals/:id endpoint to operator/routes/claude-terminals.mjs.

Currently each terminal property (autoHandoff, autoDispatch, autoComplete, capabilities) requires a separate POST toggle endpoint. Add a single PATCH endpoint.

Steps:
1. Read operator/routes/claude-terminals.mjs thoroughly
2. Add a PATCH /claude-terminals/:id route accepting { autoHandoff, autoDispatch, autoComplete, capabilities, systemPrompt } fields
3. For each provided field, call the appropriate pool method (setAutoHandoff, setAutoDispatch, setAutoComplete, setCapabilities)
4. Also fix the spawn error handler: return 503 (not 400) when the error message indicates node-pty is unavailable
5. Add tests in operator/__tests__/server.test.mjs (search for existing claude-terminal test patterns)
6. Run: npx vitest run operator/__tests__/server.test.mjs
7. When done, write a brief summary of what you changed`,
  },
];

async function sendToWorker(workerId, prompt) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://localhost:3100/ws/claude-terminal/${workerId}?token=${encodeURIComponent(token)}`
    );

    ws.on('open', () => {
      // Send the prompt text (will be received as pasted text in bracketed paste mode)
      ws.send(prompt);
      // After a brief delay, send Enter to submit the pasted text
      setTimeout(() => {
        ws.send('\r');
        // Give it a moment to ensure delivery
        setTimeout(() => {
          ws.close();
          resolve(true);
        }, 500);
      }, 300);
    });

    ws.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      ws.close();
      reject(new Error('Timeout'));
    }, 5000);
  });
}

console.log(`Dispatching tasks to ${tasks.length} workers...\n`);

for (const task of tasks) {
  try {
    await sendToWorker(task.id, task.prompt);
    console.log(`  [OK] ${task.id}: task sent`);
  } catch (err) {
    console.log(`  [FAIL] ${task.id}: ${err.message}`);
  }
}

console.log('\nAll tasks dispatched. Monitor via: curl -H "Authorization: Bearer TOKEN" http://localhost:3100/api/claude-terminals');
