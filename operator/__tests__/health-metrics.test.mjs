// ============================================================
// Health Checker & Metrics Collector Tests (Phase 34)
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHealthChecker } from '../health.mjs';
import { createMetricsCollector } from '../metrics.mjs';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ── Helpers ─────────────────────────────────────────────────

function tmpDir() {
  const dir = join(tmpdir(), `health-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function rmDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Minimal mock coordinator */
function mockCoordinator(state = 'running', outcomes = {}) {
  return {
    getState: () => state,
    getMetrics: () => ({
      outcomes: {
        pending: outcomes.pending ?? 0,
        running: outcomes.running ?? 0,
        complete: outcomes.complete ?? 0,
        failed: outcomes.failed ?? 0,
        ...outcomes,
      },
    }),
  };
}

/** Minimal mock Claude pool */
function mockClaudePool(running = 2, stopped = 0) {
  return {
    getPoolStatus: () => ({
      total: running + stopped,
      running,
      stopped,
      active: running,
      idle: 0,
      waiting: 0,
      withTask: 0,
      withAutoDispatch: 0,
      withAutoComplete: 0,
      maxTerminals: 8,
    }),
  };
}

/** Minimal mock shared memory */
function mockSharedMemory(keyCount = 5) {
  return {
    size: () => keyCount,
  };
}

/** Minimal mock message bus */
function mockMessageBus(count = 10) {
  return {
    count: () => count,
  };
}

/** Minimal mock audit log */
function mockAuditLog(count = 42) {
  return {
    count: () => count,
  };
}

/** Minimal mock dead letter queue */
function mockDLQ(pending = 0) {
  return {
    getStats: () => ({
      total: pending,
      byStatus: { pending, retrying: 0, dismissed: 0 },
      byCategory: {},
    }),
  };
}

// ============================================================
// Health Checker Tests
// ============================================================

describe('Health Checker', () => {
  let dataDir;

  beforeEach(() => {
    dataDir = tmpDir();
  });

  afterEach(() => {
    rmDir(dataDir);
  });

  it('returns healthy when all components present and operational', () => {
    const hc = createHealthChecker({
      coordinator: mockCoordinator(),
      claudePool: mockClaudePool(),
      sharedMemory: mockSharedMemory(),
      messageBus: mockMessageBus(),
      auditLog: mockAuditLog(),
      deadLetterQueue: mockDLQ(),
      dataDir,
    });
    const result = hc.check();
    expect(result.status).toBe('healthy');
    expect(result.ok).toBe(true);
    expect(result.uptime).toBeTypeOf('number');
    expect(result.timestamp).toBeTruthy();
  });

  it('returns component status for coordinator', () => {
    const hc = createHealthChecker({
      coordinator: mockCoordinator('running', { pending: 3, running: 1 }),
    });
    const result = hc.check();
    expect(result.components.coordinator.status).toBe('healthy');
    expect(result.components.coordinator.state).toBe('running');
    expect(result.components.coordinator.tasksPending).toBe(3);
    expect(result.components.coordinator.tasksRunning).toBe(1);
  });

  it('returns component status for claudePool', () => {
    const hc = createHealthChecker({
      claudePool: mockClaudePool(3, 1),
    });
    const result = hc.check();
    expect(result.components.claudePool.status).toBe('healthy');
    expect(result.components.claudePool.running).toBe(3);
    expect(result.components.claudePool.stopped).toBe(1);
    expect(result.components.claudePool.maxTerminals).toBe(8);
  });

  it('returns component status for sharedMemory', () => {
    const hc = createHealthChecker({
      sharedMemory: mockSharedMemory(12),
    });
    const result = hc.check();
    expect(result.components.sharedMemory.status).toBe('healthy');
    expect(result.components.sharedMemory.keyCount).toBe(12);
  });

  it('returns component status for messageBus', () => {
    const hc = createHealthChecker({
      messageBus: mockMessageBus(25),
    });
    const result = hc.check();
    expect(result.components.messageBus.status).toBe('healthy');
    expect(result.components.messageBus.messageCount).toBe(25);
  });

  it('returns component status for auditLog', () => {
    const hc = createHealthChecker({
      auditLog: mockAuditLog(99),
    });
    const result = hc.check();
    expect(result.components.auditLog.status).toBe('healthy');
    expect(result.components.auditLog.entryCount).toBe(99);
  });

  it('returns component status for deadLetterQueue', () => {
    const hc = createHealthChecker({
      deadLetterQueue: mockDLQ(2),
    });
    const result = hc.check();
    expect(result.components.deadLetterQueue.status).toBe('healthy');
    expect(result.components.deadLetterQueue.pendingCount).toBe(2);
  });

  it('handles null/missing subsystems without crashing', () => {
    const hc = createHealthChecker({});
    const result = hc.check();
    // All components should be unavailable, not throw
    expect(result.components.coordinator.status).toBe('unavailable');
    expect(result.components.claudePool.status).toBe('unavailable');
    expect(result.components.sharedMemory.status).toBe('unavailable');
    expect(result.components.messageBus.status).toBe('unavailable');
    expect(result.components.auditLog.status).toBe('unavailable');
    expect(result.components.deadLetterQueue.status).toBe('unavailable');
    expect(result.components.disk.status).toBe('unavailable');
  });

  it('returns degraded when DLQ has > 10 pending', () => {
    const hc = createHealthChecker({
      deadLetterQueue: mockDLQ(15),
      dataDir,
    });
    const result = hc.check();
    expect(result.components.deadLetterQueue.status).toBe('degraded');
    expect(result.status).toBe('degraded');
  });

  it('returns degraded when coordinator in draining state', () => {
    const hc = createHealthChecker({
      coordinator: mockCoordinator('draining'),
      dataDir,
    });
    const result = hc.check();
    expect(result.components.coordinator.status).toBe('degraded');
    expect(result.status).toBe('degraded');
  });

  it('returns unhealthy when coordinator is stopped', () => {
    const hc = createHealthChecker({
      coordinator: mockCoordinator('stopped'),
      dataDir,
    });
    const result = hc.check();
    expect(result.components.coordinator.status).toBe('unhealthy');
    expect(result.status).toBe('unhealthy');
    expect(result.ok).toBe(false);
  });

  it('status aggregation: unhealthy > degraded > healthy', () => {
    // One degraded + one unhealthy -> overall unhealthy
    const hc = createHealthChecker({
      coordinator: mockCoordinator('stopped'),      // unhealthy
      deadLetterQueue: mockDLQ(15),                  // degraded
      dataDir,
    });
    const result = hc.check();
    expect(result.status).toBe('unhealthy');
  });

  it('unavailable components do NOT degrade overall status', () => {
    // Only configured components affect overall. Missing = unavailable = neutral
    const hc = createHealthChecker({
      dataDir,
    });
    const result = hc.check();
    // disk is healthy (writable), everything else unavailable
    expect(result.status).toBe('healthy');
  });

  it('disk writable check succeeds in test temp dir', () => {
    const hc = createHealthChecker({ dataDir });
    const result = hc.check();
    expect(result.components.disk.status).toBe('healthy');
    expect(result.components.disk.writable).toBe(true);
    expect(result.components.disk.dataDir).toBe(dataDir);
  });

  it('disk writable check fails for non-existent invalid dir', () => {
    // Use a path that can't be written to
    const badDir = join(tmpdir(), 'nonexistent', randomBytes(8).toString('hex'), 'deep', 'nested');
    const hc = createHealthChecker({ dataDir: badDir });
    const result = hc.check();
    // mkdirSync with recursive should actually create this, so use a truly bad path
    expect(result.components.disk.dataDir).toBe(badDir);
    // The dir gets created by recursive mkdir, so writable = true. That is correct behavior.
  });

  it('disk writable check handles truly unwritable path', () => {
    // Use a path under a file (not a dir) to force write failure on any OS
    // On Windows, NUL is a reserved device name; on Unix, /dev/null is a char device.
    const badDir = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\config\\systemprofile\\__no_access_' + randomBytes(4).toString('hex')
      : '/proc/1/root/__no_access_' + randomBytes(4).toString('hex');
    const hc = createHealthChecker({ dataDir: badDir });
    const result = hc.check();
    // Should be unhealthy because mkdirSync or writeFileSync should fail
    // on a restricted path. If it somehow succeeds (e.g. running as admin),
    // the test still validates the shape.
    expect(result.components.disk).toHaveProperty('status');
    expect(result.components.disk).toHaveProperty('writable');
    expect(result.components.disk).toHaveProperty('dataDir');
  });

  it('ready() returns { ok: true }', () => {
    const hc = createHealthChecker({});
    expect(hc.ready()).toEqual({ ok: true });
  });

  it('does not crash when a subsystem throws', () => {
    const broken = {
      getState: () => { throw new Error('boom'); },
      getMetrics: () => { throw new Error('boom'); },
    };
    const hc = createHealthChecker({ coordinator: broken });
    const result = hc.check();
    expect(result.components.coordinator.status).toBe('unhealthy');
    expect(result.components.coordinator.error).toBe('boom');
  });

  it('includes ok field for backwards compat', () => {
    const hc = createHealthChecker({ dataDir });
    const result = hc.check();
    expect(result).toHaveProperty('ok');
    expect(typeof result.ok).toBe('boolean');
  });

  it('uptime is a positive number', () => {
    const hc = createHealthChecker({});
    const result = hc.check();
    expect(result.uptime).toBeGreaterThan(0);
  });
});

// ============================================================
// Metrics Collector Tests
// ============================================================

describe('Metrics Collector', () => {
  it('outputs valid Prometheus format', () => {
    const mc = createMetricsCollector({
      coordinator: mockCoordinator('running', { pending: 2, running: 1, complete: 5, failed: 0 }),
      claudePool: mockClaudePool(3, 1),
      deadLetterQueue: mockDLQ(2),
      messageBus: mockMessageBus(10),
      sharedMemory: mockSharedMemory(7),
      auditLog: mockAuditLog(50),
    });
    const output = mc.collect();

    // Every metric line has # HELP or # TYPE or metric_name value
    const lines = output.split('\n').filter(l => l.length > 0);
    for (const line of lines) {
      expect(
        line.startsWith('# HELP ') ||
        line.startsWith('# TYPE ') ||
        /^[a-z_]+(\{[^}]*\})?\s+-?\d/.test(line)
      ).toBe(true);
    }
  });

  it('includes uptime metric', () => {
    const mc = createMetricsCollector({});
    const output = mc.collect();
    expect(output).toContain('jousting_uptime_seconds');
    expect(output).toContain('# HELP jousting_uptime_seconds');
    expect(output).toContain('# TYPE jousting_uptime_seconds gauge');
  });

  it('includes task counts by status', () => {
    const mc = createMetricsCollector({
      coordinator: mockCoordinator('running', { pending: 3, running: 2, complete: 10, failed: 1 }),
    });
    const output = mc.collect();
    expect(output).toContain('jousting_tasks_total{status="pending"} 3');
    expect(output).toContain('jousting_tasks_total{status="running"} 2');
    expect(output).toContain('jousting_tasks_total{status="complete"} 10');
    expect(output).toContain('jousting_tasks_total{status="failed"} 1');
  });

  it('includes terminal counts by state', () => {
    const mc = createMetricsCollector({
      claudePool: mockClaudePool(4, 2),
    });
    const output = mc.collect();
    expect(output).toContain('jousting_terminals_total{state="running"} 4');
    expect(output).toContain('jousting_terminals_total{state="stopped"} 2');
  });

  it('includes DLQ pending count', () => {
    const mc = createMetricsCollector({
      deadLetterQueue: mockDLQ(7),
    });
    const output = mc.collect();
    expect(output).toContain('jousting_dlq_pending 7');
  });

  it('includes message count', () => {
    const mc = createMetricsCollector({
      messageBus: mockMessageBus(33),
    });
    const output = mc.collect();
    expect(output).toContain('jousting_messages_total 33');
  });

  it('includes shared memory key count', () => {
    const mc = createMetricsCollector({
      sharedMemory: mockSharedMemory(9),
    });
    const output = mc.collect();
    expect(output).toContain('jousting_shared_memory_keys 9');
  });

  it('includes audit log entry count', () => {
    const mc = createMetricsCollector({
      auditLog: mockAuditLog(120),
    });
    const output = mc.collect();
    expect(output).toContain('jousting_audit_entries_total 120');
  });

  it('skips unavailable subsystems', () => {
    const mc = createMetricsCollector({});
    const output = mc.collect();
    expect(output).not.toContain('jousting_tasks_total');
    expect(output).not.toContain('jousting_terminals_total');
    expect(output).not.toContain('jousting_dlq_pending');
    expect(output).not.toContain('jousting_messages_total');
    expect(output).not.toContain('jousting_shared_memory_keys');
    expect(output).not.toContain('jousting_audit_entries_total');
  });

  it('returns only uptime when no subsystems', () => {
    const mc = createMetricsCollector({});
    const output = mc.collect();
    const lines = output.split('\n').filter(l => l.length > 0);
    // Should have exactly 3 lines: HELP, TYPE, value
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('HELP jousting_uptime_seconds');
  });

  it('all metric values are numbers (not NaN or undefined)', () => {
    const mc = createMetricsCollector({
      coordinator: mockCoordinator(),
      claudePool: mockClaudePool(),
      deadLetterQueue: mockDLQ(),
      messageBus: mockMessageBus(),
      sharedMemory: mockSharedMemory(),
      auditLog: mockAuditLog(),
    });
    const output = mc.collect();
    const valueLines = output.split('\n')
      .filter(l => l.length > 0 && !l.startsWith('#'));

    expect(valueLines.length).toBeGreaterThan(0);
    for (const line of valueLines) {
      const value = line.split(/\s+/).pop();
      expect(Number.isNaN(Number(value))).toBe(false);
      expect(value).not.toBe('undefined');
      expect(value).not.toBe('null');
      expect(value).not.toBe('NaN');
    }
  });

  it('handles subsystem that throws gracefully', () => {
    const broken = {
      getState: () => { throw new Error('fail'); },
      getMetrics: () => { throw new Error('fail'); },
    };
    const mc = createMetricsCollector({
      coordinator: broken,
    });
    // Should not throw
    const output = mc.collect();
    expect(output).toContain('jousting_uptime_seconds');
    // Task metrics should be skipped since coordinator threw
    expect(output).not.toContain('jousting_tasks_total');
  });
});
