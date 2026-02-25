// ============================================================
// Metrics Collector — Prometheus-Compatible Exposition (Phase 34)
// ============================================================
// Collects numeric metrics from all subsystems and formats them
// in Prometheus exposition format (text/plain version 0.0.4).
//
// Each metric block has:
//   # HELP metric_name Description
//   # TYPE metric_name gauge
//   metric_name{labels} VALUE
//
// Gracefully skips metrics for unavailable subsystems.
//
// Factory: createMetricsCollector(ctx) returns metrics API.
// ============================================================

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a metrics collector that outputs Prometheus exposition format.
 *
 * @param {object} ctx
 * @param {object}  [ctx.coordinator]     - Coordinator instance
 * @param {object}  [ctx.claudePool]      - Claude terminal pool
 * @param {object}  [ctx.sharedMemory]    - Shared memory store
 * @param {object}  [ctx.messageBus]      - Terminal message bus
 * @param {object}  [ctx.auditLog]        - Audit log
 * @param {object}  [ctx.deadLetterQueue] - Dead letter queue
 * @returns {object} { collect() }
 */
export function createMetricsCollector(ctx = {}) {
  const {
    coordinator,
    claudePool,
    sharedMemory,
    messageBus,
    auditLog,
    deadLetterQueue,
    requestTimer,
  } = ctx;

  /**
   * Helper: safely call a function and return its result, or null on error.
   */
  function safe(fn) {
    try { return fn(); } catch { return null; }
  }

  /**
   * Helper: format a single metric value, ensuring it is a finite number.
   */
  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Collect all metrics and return Prometheus exposition format string.
   * @returns {string}
   */
  function collect() {
    const lines = [];

    // ── Uptime ───────────────────────────────────────────
    lines.push('# HELP jousting_uptime_seconds Server uptime in seconds');
    lines.push('# TYPE jousting_uptime_seconds gauge');
    lines.push(`jousting_uptime_seconds ${num(process.uptime())}`);

    // ── Tasks (from coordinator) ─────────────────────────
    if (coordinator) {
      const metrics = safe(() => coordinator.getMetrics());
      if (metrics && metrics.outcomes) {
        lines.push('');
        lines.push('# HELP jousting_tasks_total Total tasks by status');
        lines.push('# TYPE jousting_tasks_total gauge');
        lines.push(`jousting_tasks_total{status="pending"} ${num(metrics.outcomes.pending)}`);
        lines.push(`jousting_tasks_total{status="running"} ${num(metrics.outcomes.running)}`);
        lines.push(`jousting_tasks_total{status="complete"} ${num(metrics.outcomes.complete)}`);
        lines.push(`jousting_tasks_total{status="failed"} ${num(metrics.outcomes.failed)}`);
      }
    }

    // ── Terminals (from claude pool) ─────────────────────
    if (claudePool) {
      const ps = safe(() => claudePool.getPoolStatus());
      if (ps) {
        lines.push('');
        lines.push('# HELP jousting_terminals_total Terminal count by state');
        lines.push('# TYPE jousting_terminals_total gauge');
        lines.push(`jousting_terminals_total{state="running"} ${num(ps.running)}`);
        lines.push(`jousting_terminals_total{state="stopped"} ${num(ps.stopped)}`);
      }
    }

    // ── Dead Letter Queue ────────────────────────────────
    if (deadLetterQueue) {
      const stats = safe(() => deadLetterQueue.getStats());
      if (stats) {
        lines.push('');
        lines.push('# HELP jousting_dlq_pending Dead letter queue pending count');
        lines.push('# TYPE jousting_dlq_pending gauge');
        lines.push(`jousting_dlq_pending ${num(stats.byStatus?.pending)}`);
      }
    }

    // ── Messages ─────────────────────────────────────────
    if (messageBus) {
      const cnt = safe(() => messageBus.count());
      if (cnt != null) {
        lines.push('');
        lines.push('# HELP jousting_messages_total Terminal messages count');
        lines.push('# TYPE jousting_messages_total gauge');
        lines.push(`jousting_messages_total ${num(cnt)}`);
      }
    }

    // ── Shared Memory ────────────────────────────────────
    if (sharedMemory) {
      const sz = safe(() => sharedMemory.size());
      if (sz != null) {
        lines.push('');
        lines.push('# HELP jousting_shared_memory_keys Shared memory key count');
        lines.push('# TYPE jousting_shared_memory_keys gauge');
        lines.push(`jousting_shared_memory_keys ${num(sz)}`);
      }
    }

    // ── Audit Log ────────────────────────────────────────
    if (auditLog) {
      const cnt = safe(() => auditLog.count());
      if (cnt != null) {
        lines.push('');
        lines.push('# HELP jousting_audit_entries_total Audit log entry count');
        lines.push('# TYPE jousting_audit_entries_total gauge');
        lines.push(`jousting_audit_entries_total ${num(cnt)}`);
      }
    }

    // ── HTTP Request Performance (Phase 50) ─────────────────
    if (requestTimer) {
      const httpStats = safe(() => requestTimer.getStats());
      if (httpStats && httpStats.length > 0) {
        lines.push('');
        lines.push('# HELP jousting_http_requests_total Total HTTP requests by route');
        lines.push('# TYPE jousting_http_requests_total counter');
        for (const s of httpStats) {
          const routeLabel = s.route.replace(/"/g, '\\"');
          lines.push(`jousting_http_requests_total{route="${routeLabel}"} ${num(s.count)}`);
        }

        lines.push('');
        lines.push('# HELP jousting_http_request_duration_ms HTTP request duration in milliseconds');
        lines.push('# TYPE jousting_http_request_duration_ms summary');
        for (const s of httpStats) {
          const routeLabel = s.route.replace(/"/g, '\\"');
          lines.push(`jousting_http_request_duration_ms{route="${routeLabel}",quantile="0.5"} ${num(s.p50Ms)}`);
          lines.push(`jousting_http_request_duration_ms{route="${routeLabel}",quantile="0.95"} ${num(s.p95Ms)}`);
          lines.push(`jousting_http_request_duration_ms{route="${routeLabel}",quantile="0.99"} ${num(s.p99Ms)}`);
        }

        const slowReqs = safe(() => requestTimer.getSlowRequests(1000));
        if (slowReqs != null) {
          lines.push('');
          lines.push('# HELP jousting_http_slow_requests_total Total slow HTTP requests');
          lines.push('# TYPE jousting_http_slow_requests_total counter');
          lines.push(`jousting_http_slow_requests_total ${num(slowReqs.length)}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  return { collect };
}
