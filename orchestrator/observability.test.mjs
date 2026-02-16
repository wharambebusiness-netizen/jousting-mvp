import { describe, it, expect, beforeEach } from 'vitest';
import {
  MetricsCollector,
  EventBus,
  formatDuration,
  formatDashboardData,
  formatAgentTable,
} from './observability.mjs';

// ── formatDuration ──────────────────────────────────────────

describe('formatDuration', () => {
  it('formats sub-second as milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds (no minutes)', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 00s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });

  it('pads seconds with leading zero', () => {
    expect(formatDuration(61000)).toBe('1m 01s');
    expect(formatDuration(65000)).toBe('1m 05s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3600000)).toBe('1h 00m');
    expect(formatDuration(5400000)).toBe('1h 30m');
    expect(formatDuration(7200000)).toBe('2h 00m');
  });

  it('pads minutes with leading zero in hours format', () => {
    expect(formatDuration(3660000)).toBe('1h 01m');
    expect(formatDuration(3900000)).toBe('1h 05m');
  });

  it('drops seconds in hours format', () => {
    // 1h 0m 30s → just shows 1h 00m
    expect(formatDuration(3630000)).toBe('1h 00m');
  });
});

// ── MetricsCollector ────────────────────────────────────────

describe('MetricsCollector', () => {
  let metrics;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe('getAgentStats', () => {
    it('returns zeros for unknown agent', () => {
      const stats = metrics.getAgentStats('unknown');
      expect(stats).toEqual({
        avgTimeMs: 0, totalCost: 0, successRate: 0,
        totalRuns: 0, totalTokens: 0, totalFilesModified: 0,
      });
    });

    it('computes stats for a single run', () => {
      metrics.recordAgentRun('dev', { elapsedMs: 5000, cost: 1.50, tokens: 10000, success: true, filesModified: 3 });
      const stats = metrics.getAgentStats('dev');
      expect(stats.totalRuns).toBe(1);
      expect(stats.avgTimeMs).toBe(5000);
      expect(stats.totalCost).toBe(1.50);
      expect(stats.totalTokens).toBe(10000);
      expect(stats.totalFilesModified).toBe(3);
      expect(stats.successRate).toBe(1);
    });

    it('averages across multiple runs', () => {
      metrics.recordAgentRun('dev', { elapsedMs: 4000, cost: 1.00, tokens: 5000, success: true, filesModified: 2 });
      metrics.recordAgentRun('dev', { elapsedMs: 6000, cost: 2.00, tokens: 15000, success: false, filesModified: 1 });
      const stats = metrics.getAgentStats('dev');
      expect(stats.totalRuns).toBe(2);
      expect(stats.avgTimeMs).toBe(5000);
      expect(stats.totalCost).toBe(3.00);
      expect(stats.totalTokens).toBe(20000);
      expect(stats.totalFilesModified).toBe(3);
      expect(stats.successRate).toBe(0.5);
    });

    it('rounds avgTimeMs to integer', () => {
      metrics.recordAgentRun('dev', { elapsedMs: 3333 });
      metrics.recordAgentRun('dev', { elapsedMs: 3334 });
      // Average is 3333.5 → rounded to 3334
      expect(metrics.getAgentStats('dev').avgTimeMs).toBe(3334);
    });
  });

  describe('getSummary', () => {
    it('returns zeros when empty', () => {
      const summary = metrics.getSummary();
      expect(summary.totalCost).toBe(0);
      expect(summary.totalAgentRuns).toBe(0);
      expect(summary.totalTestRuns).toBe(0);
      expect(summary.agentSuccessRate).toBe(0);
      expect(summary.roundCount).toBe(0);
      expect(summary.workflowCount).toBe(0);
    });

    it('aggregates across multiple agents', () => {
      metrics.recordAgentRun('dev', { cost: 1.00, success: true });
      metrics.recordAgentRun('qa', { cost: 0.50, success: true });
      metrics.recordAgentRun('qa', { cost: 0.25, success: false });
      const summary = metrics.getSummary();
      expect(summary.totalCost).toBe(1.75);
      expect(summary.totalAgentRuns).toBe(3);
      expect(summary.agentSuccessRate).toBeCloseTo(2 / 3, 5);
    });

    it('counts test runs', () => {
      metrics.recordTestRun({ passed: true, testsRun: 908 });
      metrics.recordTestRun({ passed: false, testsFailed: 3 });
      expect(metrics.getSummary().totalTestRuns).toBe(2);
    });

    it('counts rounds and workflows', () => {
      metrics.recordRound({ round: 1 });
      metrics.recordRound({ round: 2 });
      metrics.recordWorkflow({ type: 'sequential' });
      const summary = metrics.getSummary();
      expect(summary.roundCount).toBe(2);
      expect(summary.workflowCount).toBe(1);
    });

    it('tracks totalTimeMs as positive number', () => {
      expect(metrics.getSummary().totalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getRoundStats', () => {
    it('returns empty array when no rounds recorded', () => {
      expect(metrics.getRoundStats()).toEqual([]);
    });

    it('returns round data in order', () => {
      metrics.recordRound({ round: 1, agentsRun: 3, testsPassed: true, cost: 1.50 });
      metrics.recordRound({ round: 2, agentsRun: 2, agentsFailed: 1, testsPassed: false, cost: 0.75 });
      const rounds = metrics.getRoundStats();
      expect(rounds).toHaveLength(2);
      expect(rounds[0].round).toBe(1);
      expect(rounds[0].agentsRun).toBe(3);
      expect(rounds[1].agentsFailed).toBe(1);
      expect(rounds[1].testsPassed).toBe(false);
    });
  });

  describe('recordAgentRun defaults', () => {
    it('uses zero defaults for missing fields', () => {
      metrics.recordAgentRun('dev');
      const stats = metrics.getAgentStats('dev');
      expect(stats.avgTimeMs).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalFilesModified).toBe(0);
      expect(stats.successRate).toBe(1); // success defaults to true
    });
  });
});

// ── EventBus ────────────────────────────────────────────────

describe('EventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('calls handler when event is emitted', () => {
    const calls = [];
    bus.on('test', (data) => calls.push(data));
    bus.emit('test', { value: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0].value).toBe(42);
    expect(calls[0].timestamp).toBeDefined();
  });

  it('supports multiple handlers per event', () => {
    let a = 0, b = 0;
    bus.on('x', () => a++);
    bus.on('x', () => b++);
    bus.emit('x');
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('does not call handlers for other events', () => {
    let called = false;
    bus.on('a', () => { called = true; });
    bus.emit('b');
    expect(called).toBe(false);
  });

  it('removes handler with off()', () => {
    let count = 0;
    const handler = () => count++;
    bus.on('x', handler);
    bus.emit('x');
    expect(count).toBe(1);
    bus.off('x', handler);
    bus.emit('x');
    expect(count).toBe(1);
  });

  it('survives handler throwing', () => {
    bus.on('x', () => { throw new Error('boom'); });
    let called = false;
    bus.on('x', () => { called = true; });
    bus.emit('x');
    expect(called).toBe(true);
  });

  it('emitting unregistered event is a no-op', () => {
    expect(() => bus.emit('nothing')).not.toThrow();
  });
});

// ── formatDashboardData ─────────────────────────────────────

describe('formatDashboardData', () => {
  it('formats metrics into dashboard structure', () => {
    const metrics = new MetricsCollector();
    metrics.recordAgentRun('dev', { cost: 1.50, success: true, elapsedMs: 5000, tokens: 1000, filesModified: 2 });
    metrics.recordRound({ round: 1, agentsRun: 1, testsPassed: true, elapsedMs: 8000, cost: 1.50 });

    const data = formatDashboardData(metrics);
    expect(data.summary.totalCost).toBe('$1.50');
    expect(data.summary.agentRuns).toBe(1);
    expect(data.summary.rounds).toBe(1);
    expect(data.summary.successRate).toBe('100.0%');
    expect(data.rounds).toHaveLength(1);
    expect(data.rounds[0].tests).toBe('PASS');
    expect(data.agents.dev).toBeDefined();
    expect(data.agents.dev.totalRuns).toBe(1);
  });
});

// ── formatAgentTable ────────────────────────────────────────

describe('formatAgentTable', () => {
  it('returns sorted agent rows', () => {
    const metrics = new MetricsCollector();
    metrics.recordAgentRun('qa', { cost: 0.25, success: true, elapsedMs: 3000, filesModified: 1 });
    metrics.recordAgentRun('dev', { cost: 1.00, success: true, elapsedMs: 8000, filesModified: 4 });

    const table = formatAgentTable(metrics);
    expect(table).toHaveLength(2);
    // Sorted alphabetically
    expect(table[0].agentId).toBe('dev');
    expect(table[1].agentId).toBe('qa');
    expect(table[0].totalCost).toBe('$1.00');
    expect(table[0].successRate).toBe('100.0%');
    expect(table[0].filesModified).toBe(4);
  });

  it('returns empty array when no agents', () => {
    expect(formatAgentTable(new MetricsCollector())).toEqual([]);
  });
});
