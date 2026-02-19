// ============================================================
// Observability Module — Structured Logging, Metrics, Events (v22)
// ============================================================
// Provides structured, queryable logging and metrics collection
// for multi-agent orchestrator runs. Replaces ad-hoc console.log
// with leveled, categorized log entries and machine-readable
// JSON log files. Includes an event bus for decoupled monitoring.
//
// Usage:
//   import { createObservability } from './observability.mjs';
//   const { logger, metrics, events } = createObservability({ logDir: 'orchestrator/logs' });
//   logger.agent('Agent started', { agentId: 'engine-dev', round: 1 });
//   metrics.recordAgentRun('engine-dev', { elapsedMs: 12000, cost: 0.05 });
//   events.on('agent:complete', (data) => console.log(data));
// ============================================================

import { writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { EOL } from 'os';
import { EventBus } from '../shared/event-bus.mjs';

// ── Log Levels ──────────────────────────────────────────────

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_LABELS = { debug: 'DEBUG', info: ' INFO', warn: ' WARN', error: 'ERROR' };

const LEVEL_COLORS = {
  debug: '\x1b[90m',  // gray
  info: '\x1b[36m',   // cyan
  warn: '\x1b[33m',   // yellow
  error: '\x1b[31m',  // red
};
const RESET = '\x1b[0m';

// ── StructuredLogger ────────────────────────────────────────

class StructuredLogger {
  /**
   * @param {Object} options
   * @param {string} options.logDir
   * @param {'debug'|'info'|'warn'|'error'} [options.logLevel='info']
   * @param {boolean} [options.enableConsole=true]
   * @param {boolean} [options.enableFile=true]
   * @param {number} [options.maxLogFiles=10]
   */
  constructor({ logDir, logLevel = 'info', enableConsole = true, enableFile = true, maxLogFiles = 10 }) {
    this._logDir = resolve(logDir);
    this._minLevel = LOG_LEVELS[logLevel] ?? LOG_LEVELS.info;
    this._enableConsole = enableConsole;
    this._enableFile = enableFile;
    this._maxLogFiles = maxLogFiles;
    this._logFile = null;

    if (this._enableFile) {
      this._ensureLogDir();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      this._logFile = join(this._logDir, `run-${ts}.jsonl`);
      this._rotateLogFiles();
    }
  }

  /**
   * Write a structured log entry.
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} category - agent/test/merge/revert/workflow/spawn/cost/round
   * @param {string} message
   * @param {Object} [data={}]
   */
  log(level, category, message, data = {}) {
    if ((LOG_LEVELS[level] ?? LOG_LEVELS.info) < this._minLevel) return;

    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, category, message, ...data };

    if (this._enableConsole) {
      const color = LEVEL_COLORS[level] || '';
      const label = LEVEL_LABELS[level] || level.toUpperCase().padStart(5);
      const ts = timestamp.replace('T', ' ').slice(0, 19);
      const cat = category.toUpperCase().padEnd(8);
      const dataStr = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
      console.log(`${color}[${ts}] ${label} [${cat}]${RESET} ${message}${dataStr}`);
    }

    if (this._enableFile && this._logFile) {
      try { appendFileSync(this._logFile, JSON.stringify(entry) + EOL); } catch (_) { /* noop */ }
    }
  }

  agent(message, data = {}) { this.log('info', 'agent', message, data); }
  test(message, data = {}) { this.log('info', 'test', message, data); }
  workflow(message, data = {}) { this.log('info', 'workflow', message, data); }
  spawn(message, data = {}) { this.log('info', 'spawn', message, data); }

  _ensureLogDir() {
    try { if (!existsSync(this._logDir)) mkdirSync(this._logDir, { recursive: true }); }
    catch (_) { this._enableFile = false; }
  }

  _rotateLogFiles() {
    try {
      const files = readdirSync(this._logDir)
        .filter(f => f.startsWith('run-') && f.endsWith('.jsonl'))
        .map(f => ({ name: f, time: statSync(join(this._logDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);
      for (const f of files.slice(this._maxLogFiles)) {
        try { unlinkSync(join(this._logDir, f.name)); } catch (_) { /* noop */ }
      }
    } catch (_) { /* noop */ }
  }
}

// ── MetricsCollector ────────────────────────────────────────

class MetricsCollector {
  constructor() {
    this._agentRuns = new Map();
    this._testRuns = [];
    this._rounds = [];
    this._workflows = [];
    this._startTime = Date.now();
  }

  recordAgentRun(agentId, { elapsedMs = 0, cost = 0, tokens = 0, model = '', success = true, filesModified = 0, round = 0 } = {}) {
    if (!this._agentRuns.has(agentId)) this._agentRuns.set(agentId, []);
    this._agentRuns.get(agentId).push({ timestamp: Date.now(), elapsedMs, cost, tokens, model, success, filesModified, round });
  }

  recordTestRun({ elapsedMs = 0, passed = true, testsRun = 0, testsFailed = 0, round = 0 } = {}) {
    this._testRuns.push({ timestamp: Date.now(), elapsedMs, passed, testsRun, testsFailed, round });
  }

  recordRound({ round, agentsRun = 0, agentsFailed = 0, testsPassed = true, elapsedMs = 0, cost = 0 }) {
    this._rounds.push({ timestamp: Date.now(), round, agentsRun, agentsFailed, testsPassed, elapsedMs, cost });
  }

  recordWorkflow({ type, stages = 0, elapsedMs = 0, success = true, iterations = 0 }) {
    this._workflows.push({ timestamp: Date.now(), type, stages, elapsedMs, success, iterations });
  }

  getAgentStats(agentId) {
    const runs = this._agentRuns.get(agentId);
    if (!runs || runs.length === 0) return { avgTimeMs: 0, totalCost: 0, successRate: 0, totalRuns: 0, totalTokens: 0, totalFilesModified: 0 };
    const n = runs.length;
    return {
      avgTimeMs: Math.round(runs.reduce((s, r) => s + r.elapsedMs, 0) / n),
      totalCost: runs.reduce((s, r) => s + r.cost, 0),
      successRate: runs.filter(r => r.success).length / n,
      totalRuns: n,
      totalTokens: runs.reduce((s, r) => s + r.tokens, 0),
      totalFilesModified: runs.reduce((s, r) => s + r.filesModified, 0),
    };
  }

  getRoundStats() {
    return this._rounds.map(r => ({ round: r.round, agentsRun: r.agentsRun, agentsFailed: r.agentsFailed, testsPassed: r.testsPassed, elapsedMs: r.elapsedMs, cost: r.cost }));
  }

  getSummary() {
    const allRuns = [...this._agentRuns.values()].flat();
    const n = allRuns.length;
    return {
      totalCost: allRuns.reduce((s, r) => s + r.cost, 0),
      totalTimeMs: Date.now() - this._startTime,
      totalAgentRuns: n,
      totalTestRuns: this._testRuns.length,
      agentSuccessRate: n > 0 ? allRuns.filter(r => r.success).length / n : 0,
      roundCount: this._rounds.length,
      workflowCount: this._workflows.length,
    };
  }

  exportMetrics(filePath) {
    const data = {
      exported: new Date().toISOString(),
      summary: this.getSummary(),
      rounds: this.getRoundStats(),
      agentStats: Object.fromEntries([...this._agentRuns.keys()].map(id => [id, this.getAgentStats(id)])),
      agentRuns: Object.fromEntries(this._agentRuns),
      testRuns: this._testRuns,
      workflows: this._workflows,
    };
    try { writeFileSync(resolve(filePath), JSON.stringify(data, null, 2)); } catch (_) { /* noop */ }
  }
}

// ── EventBus ────────────────────────────────────────────────
// EventBus is now imported from shared/event-bus.mjs.
// Re-exported below for backward compatibility.

// ── Dashboard Helpers ───────────────────────────────────────

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function formatDashboardData(metrics) {
  const summary = metrics.getSummary();
  const agentIds = [...metrics._agentRuns.keys()];
  const agents = {};
  for (const id of agentIds) agents[id] = metrics.getAgentStats(id);
  return {
    summary: {
      totalCost: `$${summary.totalCost.toFixed(2)}`,
      uptime: formatDuration(summary.totalTimeMs),
      agentRuns: summary.totalAgentRuns,
      testRuns: summary.totalTestRuns,
      successRate: `${(summary.agentSuccessRate * 100).toFixed(1)}%`,
      rounds: summary.roundCount,
    },
    rounds: metrics.getRoundStats().map(r => ({
      round: r.round, agents: r.agentsRun, failed: r.agentsFailed,
      tests: r.testsPassed ? 'PASS' : 'FAIL', time: formatDuration(r.elapsedMs), cost: `$${r.cost.toFixed(2)}`,
    })),
    agents,
  };
}

function formatAgentTable(metrics) {
  return [...metrics._agentRuns.keys()].sort().map(id => {
    const s = metrics.getAgentStats(id);
    return { agentId: id, runs: s.totalRuns, avgTime: formatDuration(s.avgTimeMs), totalCost: `$${s.totalCost.toFixed(2)}`, successRate: `${(s.successRate * 100).toFixed(1)}%`, filesModified: s.totalFilesModified };
  });
}

// ── Factory ─────────────────────────────────────────────────

function createObservability(options = {}) {
  const { logDir = join('orchestrator', 'logs'), logLevel = 'info', enableConsole = true, enableFile = true, metricsFile } = options;

  const logger = new StructuredLogger({ logDir, logLevel, enableConsole, enableFile });
  const metrics = new MetricsCollector();
  const events = new EventBus();

  // Wire standard events to logger
  events.on('agent:start', d => logger.agent(`Agent started: ${d.agentId || 'unknown'}`, d));
  events.on('agent:complete', d => logger.agent(`Agent completed: ${d.agentId || 'unknown'}`, d));
  events.on('agent:error', d => logger.log('error', 'agent', `Agent error: ${d.agentId || 'unknown'}`, d));
  events.on('test:start', d => logger.test('Test run started', d));
  events.on('test:complete', d => logger.test(`Tests ${d.passed ? 'passed' : 'FAILED'}`, d));
  events.on('round:start', d => logger.log('info', 'round', `Round ${d.round} started`, d));
  events.on('round:complete', d => logger.log('info', 'round', `Round ${d.round} completed`, d));
  events.on('workflow:start', d => logger.workflow(`Workflow started: ${d.type || 'unknown'}`, d));
  events.on('workflow:complete', d => logger.workflow(`Workflow completed: ${d.type || 'unknown'}`, d));
  events.on('spawn:request', d => logger.spawn(`Spawn requested by ${d.parentId || 'unknown'}`, d));
  events.on('spawn:complete', d => logger.spawn(`Spawn completed: ${d.agentId || 'unknown'}`, d));
  events.on('revert:start', d => logger.log('warn', 'revert', 'Revert started', d));
  events.on('revert:complete', d => logger.log('warn', 'revert', 'Revert completed', d));

  if (metricsFile) {
    process.on('exit', () => metrics.exportMetrics(metricsFile));
  }

  return { logger, metrics, events };
}

// ── Exports ─────────────────────────────────────────────────

export {
  StructuredLogger,
  MetricsCollector,
  EventBus,
  createObservability,
  formatDashboardData,
  formatAgentTable,
  formatDuration,
};
