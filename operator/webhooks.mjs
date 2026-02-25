// ============================================================
// Webhook Manager — Event-Driven HTTP Dispatching (Phase 38)
// ============================================================
// Registers webhook subscriptions that dispatch HTTP POST
// requests when matching EventBus events occur. Supports
// wildcard patterns, HMAC signing, retries with exponential
// backoff, and an in-memory delivery log.
//
// EventBus interception: wraps events.emit() to capture all
// events without requiring explicit subscription to each name.
//
// Factory: createWebhookManager(ctx) returns webhook methods.
// ============================================================

import {
  writeFileSync, readFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHmac, randomUUID } from 'node:crypto';

// ── Pattern Matching ────────────────────────────────────────

/**
 * Check if an event name matches a webhook pattern.
 * Supports exact match and prefix wildcard (e.g. "coord:*").
 */
function matchesPattern(event, pattern) {
  if (pattern === '*') return true;
  if (pattern === event) return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return event.startsWith(prefix);
  }
  return false;
}

function matchesAnyPattern(event, patterns) {
  for (const p of patterns) {
    if (matchesPattern(event, p)) return true;
  }
  return false;
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a webhook manager for event-driven HTTP dispatching.
 * @param {object} ctx
 * @param {object}   ctx.events      - EventBus to intercept
 * @param {string}   [ctx.persistPath] - Path to persist webhooks on disk
 * @param {Function} [ctx.log]       - Logger (optional)
 * @param {number}   [ctx.maxRetries=3]  - Max retry attempts on failure
 * @param {number}   [ctx.timeoutMs=5000] - HTTP request timeout
 * @param {Function} [ctx.fetch]     - Injectable fetch function (for testing)
 * @returns {object} Webhook manager methods
 */
export function createWebhookManager(ctx = {}) {
  const events = ctx.events || null;
  const persistPath = ctx.persistPath || null;
  const log = ctx.log || (() => {});
  const maxRetries = ctx.maxRetries ?? 3;
  const timeoutMs = ctx.timeoutMs ?? 5000;
  const fetchFn = ctx.fetch || globalThis.fetch;

  /** @type {Map<string, object>} id -> webhook registration */
  const webhooks = new Map();

  /** @type {Map<string, Array>} id -> delivery log ring buffer */
  const deliveryLogs = new Map();

  const MAX_DELIVERY_LOG = 50;

  /** @type {Set<number>} pending retry timeouts (for cleanup) */
  const pendingTimers = new Set();

  // Track original emit so we can restore it
  let originalEmit = null;
  let interceptInstalled = false;

  // ── ID generation ─────────────────────────────────────────

  function generateId() {
    return randomBytes(4).toString('hex');
  }

  // ── Atomic Write ──────────────────────────────────────────

  function _save() {
    if (!persistPath) return;
    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const data = {
      webhooks: [...webhooks.values()],
      savedAt: new Date().toISOString(),
      version: 1,
    };

    const tmpFile = persistPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      renameSync(tmpFile, persistPath);
    } catch (_err) {
      writeFileSync(persistPath, JSON.stringify(data, null, 2));
      try { unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }
  }

  // ── Load ──────────────────────────────────────────────────

  function load() {
    if (!persistPath) return { loaded: false, count: 0 };

    let data = null;

    if (existsSync(persistPath)) {
      try {
        const raw = readFileSync(persistPath, 'utf-8');
        data = JSON.parse(raw);
        try { unlinkSync(persistPath + '.tmp'); } catch (_) { /* ignore */ }
      } catch (_err) {
        data = null;
      }
    }

    // Fallback: .tmp recovery
    if (!data) {
      const tmpFile = persistPath + '.tmp';
      if (existsSync(tmpFile)) {
        try {
          const raw = readFileSync(tmpFile, 'utf-8');
          data = JSON.parse(raw);
          try { renameSync(tmpFile, persistPath); } catch (_) { /* ignore */ }
        } catch (_err) {
          data = null;
        }
      }
    }

    if (!data || !Array.isArray(data.webhooks)) {
      return { loaded: false, count: 0 };
    }

    webhooks.clear();
    for (const wh of data.webhooks) {
      webhooks.set(wh.id, wh);
      deliveryLogs.set(wh.id, []);
    }

    // Ensure emit interception is installed
    _installIntercept();

    return { loaded: true, count: webhooks.size };
  }

  // ── EventBus Interception ─────────────────────────────────

  function _installIntercept() {
    if (interceptInstalled || !events) return;
    originalEmit = events.emit.bind(events);

    events.emit = function interceptedEmit(event, data = {}) {
      // Call original emit first
      originalEmit(event, data);
      // Dispatch to webhooks
      _dispatch(event, data);
    };

    interceptInstalled = true;
  }

  function _removeIntercept() {
    if (!interceptInstalled || !events || !originalEmit) return;
    events.emit = originalEmit;
    originalEmit = null;
    interceptInstalled = false;
  }

  // ── Dispatch ──────────────────────────────────────────────

  function _dispatch(eventName, eventData) {
    for (const wh of webhooks.values()) {
      if (!wh.active) continue;
      if (!matchesAnyPattern(eventName, wh.events)) continue;
      _deliver(wh, eventName, eventData, 0);
    }
  }

  async function _deliver(wh, eventName, eventData, attempt) {
    const deliveryId = randomUUID();
    const body = JSON.stringify({
      event: eventName,
      data: eventData,
      timestamp: new Date().toISOString(),
      webhookId: wh.id,
    });

    const headers = {
      'Content-Type': 'application/json',
      'X-Jousting-Event': eventName,
      'X-Jousting-Delivery': deliveryId,
    };

    // HMAC signature if secret is configured
    if (wh.secret) {
      const signature = createHmac('sha256', wh.secret).update(body).digest('hex');
      headers['X-Jousting-Signature'] = `sha256=${signature}`;
    }

    const startMs = Date.now();
    let status = 'success';
    let statusCode = null;
    let error = null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    pendingTimers.add(timer);

    try {
      const res = await fetchFn(wh.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      statusCode = res.status;

      if (statusCode >= 200 && statusCode < 300) {
        status = 'success';
      } else {
        status = 'failed';
        error = `HTTP ${statusCode}`;
      }
    } catch (err) {
      status = 'failed';
      error = err.message || 'Network error';
    } finally {
      clearTimeout(timer);
      pendingTimers.delete(timer);
    }

    const latencyMs = Date.now() - startMs;

    // Record delivery
    _recordDelivery(wh.id, {
      deliveryId,
      event: eventName,
      status,
      statusCode,
      attemptCount: attempt + 1,
      latencyMs,
      error: error || undefined,
      ts: new Date().toISOString(),
    });

    // Emit events for WS bridging
    if (events && originalEmit) {
      if (status === 'success') {
        originalEmit('webhook:delivered', {
          webhookId: wh.id,
          deliveryId,
          event: eventName,
          statusCode,
          latencyMs,
        });
      } else {
        originalEmit('webhook:failed', {
          webhookId: wh.id,
          deliveryId,
          event: eventName,
          error,
          attempt: attempt + 1,
          willRetry: attempt < maxRetries,
        });
      }
    }

    // Retry on failure
    if (status === 'failed' && attempt < maxRetries) {
      const delay = Math.pow(4, attempt) * 1000; // 1s, 4s, 16s
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        _deliver(wh, eventName, eventData, attempt + 1);
      }, delay);
      pendingTimers.add(timer);
    }
  }

  function _recordDelivery(webhookId, entry) {
    let logArr = deliveryLogs.get(webhookId);
    if (!logArr) {
      logArr = [];
      deliveryLogs.set(webhookId, logArr);
    }
    logArr.push(entry);
    // Ring buffer: keep only last MAX_DELIVERY_LOG
    if (logArr.length > MAX_DELIVERY_LOG) {
      logArr.splice(0, logArr.length - MAX_DELIVERY_LOG);
    }
  }

  // ── Public Methods ────────────────────────────────────────

  /**
   * Register a new webhook subscription.
   * @param {object} opts
   * @param {string}   opts.url    - Target URL for POST requests
   * @param {string[]} opts.events - Event patterns to match
   * @param {string}   [opts.label]  - Human-readable label
   * @param {string}   [opts.secret] - HMAC signing secret
   * @returns {object} Created webhook (without secret)
   */
  function register({ url, events: eventPatterns, label, secret }) {
    // Validate URL format
    try {
      new URL(url);
    } catch {
      throw new Error('Invalid URL format');
    }

    if (!Array.isArray(eventPatterns) || eventPatterns.length === 0) {
      throw new Error('events must be a non-empty array');
    }

    const id = generateId();
    const wh = {
      id,
      url,
      events: eventPatterns,
      label: label || '',
      secret: secret || null,
      active: true,
      createdAt: new Date().toISOString(),
    };

    webhooks.set(id, wh);
    deliveryLogs.set(id, []);

    // Ensure emit interception is installed
    _installIntercept();

    _save();

    // Return without secret
    return {
      id: wh.id,
      url: wh.url,
      events: wh.events,
      label: wh.label,
      active: wh.active,
      createdAt: wh.createdAt,
    };
  }

  /**
   * Unregister a webhook by ID.
   * @param {string} id
   * @returns {boolean} True if found and removed
   */
  function unregister(id) {
    const existed = webhooks.delete(id);
    if (existed) {
      deliveryLogs.delete(id);
      _save();
    }
    return existed;
  }

  /**
   * Enable/disable a webhook without deleting it.
   * @param {string}  id
   * @param {boolean} active
   * @returns {boolean} True if found and updated
   */
  function setActive(id, active) {
    const wh = webhooks.get(id);
    if (!wh) return false;
    wh.active = !!active;
    _save();
    return true;
  }

  /**
   * List all webhooks. Secrets are replaced with hasSecret boolean.
   * @returns {Array}
   */
  function list() {
    return [...webhooks.values()].map(wh => ({
      id: wh.id,
      url: wh.url,
      events: wh.events,
      label: wh.label,
      active: wh.active,
      createdAt: wh.createdAt,
      hasSecret: !!wh.secret,
    }));
  }

  /**
   * Get a single webhook by ID. Secret replaced with hasSecret.
   * @param {string} id
   * @returns {object|null}
   */
  function get(id) {
    const wh = webhooks.get(id);
    if (!wh) return null;
    return {
      id: wh.id,
      url: wh.url,
      events: wh.events,
      label: wh.label,
      active: wh.active,
      createdAt: wh.createdAt,
      hasSecret: !!wh.secret,
    };
  }

  /**
   * Get recent delivery attempts for a webhook.
   * @param {string} id
   * @param {number} [limit=50]
   * @returns {Array}
   */
  function getDeliveryLog(id, limit) {
    const logArr = deliveryLogs.get(id);
    if (!logArr) return [];
    const n = limit || MAX_DELIVERY_LOG;
    return logArr.slice(-n);
  }

  /**
   * Update partial fields on a webhook.
   * @param {string} id
   * @param {object} fields - Partial fields: url, events, label, active, secret
   * @returns {object|null} Updated webhook (without secret) or null if not found
   */
  function update(id, fields) {
    const wh = webhooks.get(id);
    if (!wh) return null;

    if (fields.url !== undefined) {
      try { new URL(fields.url); } catch { throw new Error('Invalid URL format'); }
      wh.url = fields.url;
    }
    if (fields.events !== undefined) wh.events = fields.events;
    if (fields.label !== undefined) wh.label = fields.label;
    if (fields.active !== undefined) wh.active = !!fields.active;
    if (fields.secret !== undefined) wh.secret = fields.secret || null;

    _save();

    return {
      id: wh.id,
      url: wh.url,
      events: wh.events,
      label: wh.label,
      active: wh.active,
      createdAt: wh.createdAt,
      hasSecret: !!wh.secret,
    };
  }

  /**
   * Send a test delivery directly to a webhook's URL.
   * @param {string} id
   * @returns {Promise<object>} Delivery result
   */
  async function sendTest(id) {
    const wh = webhooks.get(id);
    if (!wh) return null;

    await _deliver(wh, 'webhook:test', { message: 'Test delivery' }, maxRetries);
    // Return most recent delivery log entry
    const logArr = deliveryLogs.get(id) || [];
    return logArr[logArr.length - 1] || null;
  }

  /**
   * Destroy webhook manager: unwire intercept, clear timers.
   */
  function destroy() {
    _removeIntercept();

    // Clear all pending retry timers
    for (const timer of pendingTimers) {
      clearTimeout(timer);
    }
    pendingTimers.clear();

    webhooks.clear();
    deliveryLogs.clear();
  }

  return {
    register,
    unregister,
    setActive,
    list,
    get,
    getDeliveryLog,
    update,
    sendTest,
    load,
    destroy,
  };
}
