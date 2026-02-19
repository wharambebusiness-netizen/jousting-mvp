// ============================================================
// EventBus — Shared Event System
// ============================================================
// Simple pub/sub event bus used by both operator and orchestrator.
// Extracted from orchestrator/observability.mjs for multi-process
// reuse. IPCEventBus subclass forwards events via process.send()
// for cross-process event propagation (multi-orchestrator).
// ============================================================

/**
 * Simple pub/sub event bus with exact-match event names.
 * Pattern matching (wildcards) is handled by ws.mjs, not here.
 */
export class EventBus {
  constructor() { this._handlers = new Map(); }

  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
  }

  off(event, handler) {
    const set = this._handlers.get(event);
    if (set) { set.delete(handler); if (set.size === 0) this._handlers.delete(event); }
  }

  emit(event, data = {}) {
    const payload = { timestamp: new Date().toISOString(), ...data };
    const set = this._handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try { handler(payload); } catch (_) { /* noop */ }
    }
  }
}

/**
 * EventBus subclass that also forwards events via IPC (process.send).
 * Used by worker processes so events propagate to the parent server.
 * Falls back to base EventBus behavior if process.send is unavailable.
 */
export class IPCEventBus extends EventBus {
  /**
   * @param {object} [options]
   * @param {string} [options.workerId] - Identifier for this worker (added to IPC messages)
   */
  constructor(options = {}) {
    super();
    this._workerId = options.workerId || null;
  }

  emit(event, data = {}) {
    // Emit locally first (base class behavior)
    super.emit(event, data);

    // Forward via IPC if available (worker process forked by parent)
    if (typeof process.send === 'function') {
      try {
        process.send({
          type: 'event',
          event,
          data: { ...data, workerId: this._workerId },
        });
      } catch (_) { /* IPC channel may be closed */ }
    }
  }
}
