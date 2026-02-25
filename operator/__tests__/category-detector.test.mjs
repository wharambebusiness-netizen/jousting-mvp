// ============================================================
// Category Detector Tests — Phase 33 Auto-Detection
// ============================================================
// Tests for keyword-based category detection, custom rules,
// coordinator integration, and REST endpoints.
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { createCategoryDetector } from '../coordination/category-detector.mjs';
import { createCoordinator } from '../coordination/coordinator.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Helpers ────────────────────────────────────────────

function mockPool(workers = []) {
  const sent = [];
  return {
    getStatus: () => workers.map(w => ({ id: w.id || w, status: w.status || 'running' })),
    sendTo: (id, msg) => { sent.push({ id, msg }); return true; },
    activeCount: () => workers.filter(w => (w.status || 'running') === 'running').length,
    getSent: () => sent,
    clearSent: () => { sent.length = 0; },
  };
}

// ============================================================
// 1. Category Detector — Core Detection
// ============================================================

describe('CategoryDetector', () => {
  let detector;

  beforeEach(() => {
    detector = createCategoryDetector();
  });

  // ── Single keyword detection ──────────────────────────────

  it('should detect "development" for "implement the login page"', () => {
    expect(detector.detect('implement the login page')).toBe('development');
  });

  it('should detect "testing" for "run the test suite and validate results"', () => {
    expect(detector.detect('run the test suite and validate results')).toBe('testing');
  });

  it('should detect "debugging" for "fix the crash on startup"', () => {
    expect(detector.detect('fix the crash on startup')).toBe('debugging');
  });

  it('should detect "planning" for "design the new API"', () => {
    expect(detector.detect('design the new API')).toBe('planning');
  });

  it('should detect "review" for "review the pull request"', () => {
    expect(detector.detect('review the pull request')).toBe('review');
  });

  it('should detect "deployment" for "deploy to production"', () => {
    expect(detector.detect('deploy to production')).toBe('deployment');
  });

  it('should detect "documentation" for "document the API endpoints"', () => {
    expect(detector.detect('document the API endpoints')).toBe('documentation');
  });

  // ── Multi-keyword scoring ─────────────────────────────────

  it('should detect "debugging" for "debug and fix the crash" (2 hits vs 1)', () => {
    expect(detector.detect('debug and fix the crash')).toBe('debugging');
  });

  it('should score highest keyword count wins', () => {
    // "test" and "validate" and "check" → 3 testing hits
    // "implement" → 1 development hit
    expect(detector.detect('test validate and check the implementation')).toBe('testing');
  });

  // ── Null/empty handling ───────────────────────────────────

  it('should return null for unrecognizable text', () => {
    expect(detector.detect('do the thing')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(detector.detect('')).toBeNull();
  });

  it('should return null for null input', () => {
    expect(detector.detect(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(detector.detect(undefined)).toBeNull();
  });

  it('should return null for whitespace-only input', () => {
    expect(detector.detect('   ')).toBeNull();
  });

  // ── Tie-breaking ──────────────────────────────────────────

  it('should break ties by declaration order (first category wins)', () => {
    // "spec" appears in both planning and testing
    // planning is declared first, so it wins on a tie
    expect(detector.detect('write a spec')).toBe('planning');
  });

  // ── Case-insensitive matching ─────────────────────────────

  it('should match case-insensitively', () => {
    expect(detector.detect('IMPLEMENT the feature')).toBe('development');
  });

  it('should match mixed case', () => {
    expect(detector.detect('Deploy the Release')).toBe('deployment');
  });

  // ── Word boundary matching ────────────────────────────────

  it('should match word boundaries: "testing" matches "test"', () => {
    expect(detector.detect('testing the system')).toBe('testing');
  });

  it('should NOT match non-word-boundary: "contest" should not match "test"', () => {
    expect(detector.detect('enter the contest')).toBeNull();
  });

  it('should match "debugging" via "debug" keyword at word boundary', () => {
    expect(detector.detect('debugging session started')).toBe('debugging');
  });
});

// ============================================================
// 2. Category Detector — getCategories
// ============================================================

describe('CategoryDetector.getCategories', () => {
  it('should return all 7 built-in category names', () => {
    const detector = createCategoryDetector();
    const categories = detector.getCategories();
    expect(categories).toHaveLength(7);
    expect(categories).toContain('planning');
    expect(categories).toContain('development');
    expect(categories).toContain('testing');
    expect(categories).toContain('debugging');
    expect(categories).toContain('review');
    expect(categories).toContain('deployment');
    expect(categories).toContain('documentation');
  });

  it('should include custom categories', () => {
    const detector = createCategoryDetector({
      customRules: [{ pattern: /infra/i, category: 'infrastructure' }],
    });
    const categories = detector.getCategories();
    expect(categories).toContain('infrastructure');
    expect(categories.length).toBe(8);
  });
});

// ============================================================
// 3. Category Detector — Custom Rules
// ============================================================

describe('CategoryDetector.addRule', () => {
  let detector;

  beforeEach(() => {
    detector = createCategoryDetector();
  });

  it('should add custom rule that takes priority over built-in', () => {
    detector.addRule({ pattern: /deploy.*fast/i, category: 'urgent-deploy' });
    expect(detector.detect('deploy this fast')).toBe('urgent-deploy');
  });

  it('should fall back to built-in when custom rule does not match', () => {
    detector.addRule({ pattern: /xyz-pattern/i, category: 'custom' });
    expect(detector.detect('implement the feature')).toBe('development');
  });

  it('should support multiple custom rules (first match wins)', () => {
    detector.addRule({ pattern: /alpha/i, category: 'cat-a' });
    detector.addRule({ pattern: /alpha/i, category: 'cat-b' });
    expect(detector.detect('alpha task')).toBe('cat-a');
  });

  it('should work with regex patterns', () => {
    detector.addRule({ pattern: /^SEC-\d+/i, category: 'security' });
    expect(detector.detect('SEC-123 fix vulnerability')).toBe('security');
  });

  it('should throw on invalid rule', () => {
    expect(() => detector.addRule({})).toThrow('Rule must have pattern and category');
    expect(() => detector.addRule(null)).toThrow();
  });

  it('should include custom category in getCategories after addRule', () => {
    detector.addRule({ pattern: /perf/i, category: 'performance' });
    expect(detector.getCategories()).toContain('performance');
  });
});

// ============================================================
// 4. Category Detector — Constructor Custom Rules
// ============================================================

describe('CategoryDetector constructor customRules', () => {
  it('should accept custom rules at creation time', () => {
    const detector = createCategoryDetector({
      customRules: [{ pattern: /infra/i, category: 'infrastructure' }],
    });
    expect(detector.detect('setup infra')).toBe('infrastructure');
  });

  it('custom rules at creation take priority over built-in', () => {
    const detector = createCategoryDetector({
      customRules: [{ pattern: /implement/i, category: 'custom-dev' }],
    });
    // "implement" would normally match "development", but custom rule wins
    expect(detector.detect('implement something')).toBe('custom-dev');
  });
});

// ============================================================
// 5. Coordinator Integration — Auto-Detection
// ============================================================

describe('Coordinator category auto-detection', () => {
  let coordinator;
  let events;

  beforeEach(() => {
    events = new EventBus();
    coordinator = createCoordinator({
      events,
      pool: mockPool(['w1']),
    });
  });

  it('addTask auto-detects category when not specified', () => {
    const task = coordinator.addTask({ id: 't1', task: 'implement the login page' });
    expect(task.category).toBe('development');
  });

  it('addTask preserves explicit category (no override)', () => {
    const task = coordinator.addTask({ id: 't1', task: 'implement the login page', category: 'custom' });
    expect(task.category).toBe('custom');
  });

  it('addTask sets null when detection finds no match', () => {
    const task = coordinator.addTask({ id: 't1', task: 'do the thing' });
    expect(task.category).toBeNull();
  });

  it('addTasks batch auto-detects categories', () => {
    const tasks = coordinator.addTasks([
      { id: 't1', task: 'implement the feature' },
      { id: 't2', task: 'fix the bug' },
      { id: 't3', task: 'deploy to staging' },
    ]);
    expect(tasks[0].category).toBe('development');
    expect(tasks[1].category).toBe('debugging');
    expect(tasks[2].category).toBe('deployment');
  });

  it('addTasks preserves explicit categories in batch', () => {
    const tasks = coordinator.addTasks([
      { id: 't1', task: 'implement the feature', category: 'special' },
      { id: 't2', task: 'fix the bug' },
    ]);
    expect(tasks[0].category).toBe('special');
    expect(tasks[1].category).toBe('debugging');
  });

  it('exposes categoryDetector on coordinator', () => {
    expect(coordinator.categoryDetector).toBeDefined();
    expect(typeof coordinator.categoryDetector.detect).toBe('function');
    expect(typeof coordinator.categoryDetector.getCategories).toBe('function');
  });
});
