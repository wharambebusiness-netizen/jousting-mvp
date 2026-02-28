// ============================================================
// Template Manager — Workflow Template Persistence (Phase 61)
// ============================================================
// Manages workflow templates (task DAGs) for the coordination
// system. Provides 8 built-in templates and supports custom
// template CRUD with atomic disk persistence. Custom templates
// can override built-in IDs.
//
// Factory: createTemplateManager(ctx) returns template API.
// ============================================================

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Built-in Templates ──────────────────────────────────────

export const BUILTIN_TEMPLATES = [
  {
    id: 'sequential-pipeline',
    name: 'Sequential Pipeline',
    description: 'Three-stage linear pipeline: analyze, implement, verify.',
    builtin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    tasks: [
      { id: 'analyze', task: 'Analyze requirements and plan approach', priority: 5, category: 'planning' },
      { id: 'implement', task: 'Implement the planned changes', priority: 5, deps: ['analyze'], category: 'development' },
      { id: 'verify', task: 'Verify implementation and run tests', priority: 5, deps: ['implement'], category: 'testing' },
    ],
  },
  {
    id: 'parallel-workers',
    name: 'Parallel Workers',
    description: 'Three independent tasks that merge into a final review.',
    builtin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    tasks: [
      { id: 'worker-a', task: 'Worker A: process first batch', priority: 1, category: 'development' },
      { id: 'worker-b', task: 'Worker B: process second batch', priority: 1, category: 'development' },
      { id: 'worker-c', task: 'Worker C: process third batch', priority: 1, category: 'development' },
      { id: 'merge', task: 'Merge and review all worker outputs', priority: 5, deps: ['worker-a', 'worker-b', 'worker-c'], category: 'review' },
    ],
  },
  {
    id: 'feature-dev',
    name: 'Feature Development',
    description: 'Plan, then parallel code + tests, then review and deploy.',
    builtin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    tasks: [
      { id: 'plan', task: 'Plan feature design and architecture', priority: 10, category: 'planning' },
      { id: 'code', task: 'Implement feature code', priority: 5, deps: ['plan'], category: 'development' },
      { id: 'tests', task: 'Write tests for the feature', priority: 5, deps: ['plan'], category: 'testing' },
      { id: 'review', task: 'Code review and integration', priority: 5, deps: ['code', 'tests'], category: 'review' },
      { id: 'deploy', task: 'Deploy to production', priority: 1, deps: ['review'], category: 'deployment' },
    ],
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    description: 'Investigate, fix, test, and verify a bug.',
    builtin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    tasks: [
      { id: 'investigate', task: 'Investigate root cause of the bug', priority: 10, category: 'debugging' },
      { id: 'fix', task: 'Implement the bug fix', priority: 5, deps: ['investigate'], category: 'development' },
      { id: 'test', task: 'Write regression tests', priority: 5, deps: ['fix'], category: 'testing' },
      { id: 'verify', task: 'Verify fix in staging environment', priority: 1, deps: ['test'], category: 'testing' },
    ],
  },
  {
    id: 'full-cycle',
    name: 'Full Development Cycle',
    description: 'Complete cycle: plan, parallel frontend + backend, integrate, test, deploy.',
    builtin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    tasks: [
      { id: 'plan', task: 'Requirements analysis and architecture', priority: 10, category: 'planning' },
      { id: 'frontend', task: 'Frontend implementation', priority: 5, deps: ['plan'], category: 'development' },
      { id: 'backend', task: 'Backend implementation', priority: 5, deps: ['plan'], category: 'development' },
      { id: 'integrate', task: 'Integration and API wiring', priority: 5, deps: ['frontend', 'backend'], category: 'development' },
      { id: 'test', task: 'End-to-end testing', priority: 5, deps: ['integrate'], category: 'testing' },
      { id: 'deploy', task: 'Deploy and monitor', priority: 1, deps: ['test'], category: 'deployment' },
    ],
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Linear code review pipeline: review, comment, revise, approve.',
    builtin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    tasks: [
      { id: 'review', task: 'Review code changes and identify issues', priority: 10, category: 'review' },
      { id: 'comments', task: 'Write detailed review comments', priority: 5, deps: ['review'], category: 'review' },
      { id: 'revise', task: 'Revise code based on review feedback', priority: 5, deps: ['comments'], category: 'development' },
      { id: 'approve', task: 'Final approval and merge', priority: 1, deps: ['revise'], category: 'review' },
    ],
  },
  {
    id: 'refactor',
    name: 'Refactor',
    description: 'Systematic refactoring: analyze, extract, rewrite, test, verify.',
    builtin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    tasks: [
      { id: 'analyze', task: 'Analyze code structure and identify refactoring targets', priority: 10, category: 'planning' },
      { id: 'extract', task: 'Extract shared logic and define interfaces', priority: 5, deps: ['analyze'], category: 'development' },
      { id: 'rewrite', task: 'Rewrite components using new structure', priority: 5, deps: ['extract'], category: 'development' },
      { id: 'test', task: 'Run tests and fix regressions', priority: 5, deps: ['rewrite'], category: 'testing' },
      { id: 'verify', task: 'Verify behavior parity with original', priority: 1, deps: ['test'], category: 'testing' },
    ],
  },
  {
    id: 'spike-research',
    name: 'Spike Research',
    description: 'Time-boxed research spike: research, prototype, evaluate, document.',
    builtin: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    tasks: [
      { id: 'research', task: 'Research options and gather information', priority: 10, category: 'research' },
      { id: 'prototype', task: 'Build a quick prototype or proof of concept', priority: 5, deps: ['research'], category: 'development' },
      { id: 'evaluate', task: 'Evaluate prototype against requirements', priority: 5, deps: ['prototype'], category: 'review' },
      { id: 'document', task: 'Document findings and recommendations', priority: 1, deps: ['evaluate'], category: 'documentation' },
    ],
  },
];

// ── Validation Helpers ──────────────────────────────────────

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validate a template object. Returns { valid, errors }.
 * @param {object} template
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateTemplate(template) {
  const errors = [];

  if (!template || typeof template !== 'object') {
    return { valid: false, errors: ['Template must be an object'] };
  }

  // id: required, kebab-case alphanumeric
  if (!template.id || typeof template.id !== 'string') {
    errors.push('id is required and must be a string');
  } else if (!KEBAB_CASE_RE.test(template.id)) {
    errors.push('id must be kebab-case alphanumeric (e.g. "my-template")');
  }

  // name: required, non-empty string
  if (!template.name || typeof template.name !== 'string' || !template.name.trim()) {
    errors.push('name is required and must be a non-empty string');
  }

  // tasks: required array with at least 1 element
  if (!Array.isArray(template.tasks)) {
    errors.push('tasks is required and must be an array');
  } else if (template.tasks.length === 0) {
    errors.push('tasks must contain at least 1 task');
  } else {
    // Validate each task entry
    const taskIds = new Set();
    for (let i = 0; i < template.tasks.length; i++) {
      const t = template.tasks[i];
      if (!t || typeof t !== 'object') {
        errors.push(`tasks[${i}]: must be an object`);
        continue;
      }
      if (!t.id || typeof t.id !== 'string') {
        errors.push(`tasks[${i}]: id is required`);
      } else {
        if (taskIds.has(t.id)) {
          errors.push(`tasks[${i}]: duplicate task id "${t.id}"`);
        }
        taskIds.add(t.id);
      }
      if (!t.task || typeof t.task !== 'string') {
        errors.push(`tasks[${i}]: task description is required`);
      }
      // deps validation: must reference known task ids
      if (t.deps !== undefined) {
        if (!Array.isArray(t.deps)) {
          errors.push(`tasks[${i}]: deps must be an array`);
        }
      }
    }

    // Second pass: validate dep references
    if (taskIds.size > 0) {
      for (let i = 0; i < template.tasks.length; i++) {
        const t = template.tasks[i];
        if (Array.isArray(t.deps)) {
          for (const dep of t.deps) {
            if (!taskIds.has(dep)) {
              errors.push(`tasks[${i}]: dep "${dep}" references unknown task id`);
            }
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a template manager for workflow templates.
 *
 * @param {object}  ctx
 * @param {string}  [ctx.persistPath] - Path to custom templates JSON file
 * @param {object}  [ctx.events]      - EventBus for template:saved / template:deleted events
 * @returns {object} Template manager API
 */
export function createTemplateManager(ctx = {}) {
  const persistPath = ctx.persistPath || null;
  const events = ctx.events || null;

  // Ensure parent directory exists
  if (persistPath) {
    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // In-memory store for custom templates: { [id]: template }
  let customStore = {};

  // Build built-in index for fast lookup
  const builtinIndex = new Map();
  for (const tmpl of BUILTIN_TEMPLATES) {
    builtinIndex.set(tmpl.id, tmpl);
  }

  // ── Persistence ─────────────────────────────────────────

  function load() {
    if (!persistPath || !existsSync(persistPath)) return;
    try {
      const raw = readFileSync(persistPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        customStore = data;
      }
    } catch {
      // Corrupt or unreadable — start fresh
    }
  }

  function _persist() {
    if (!persistPath) return;
    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = persistPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(customStore, null, 2), 'utf-8');
      renameSync(tmpFile, persistPath);
    } catch {
      // Fallback: direct write
      try {
        writeFileSync(persistPath, JSON.stringify(customStore, null, 2), 'utf-8');
      } catch { /* swallow */ }
    }
  }

  // Auto-load on creation
  load();

  // ── Public API ────────────────────────────────────────────

  /**
   * List all templates (built-in + custom). Custom overrides built-in with same id.
   * @returns {object[]} Array of template objects
   */
  function list() {
    const merged = new Map();

    // Add built-ins first
    for (const tmpl of BUILTIN_TEMPLATES) {
      merged.set(tmpl.id, tmpl);
    }

    // Custom templates override built-in by id
    for (const [id, tmpl] of Object.entries(customStore)) {
      merged.set(id, tmpl);
    }

    return Array.from(merged.values());
  }

  /**
   * Get a single template by id. Custom overrides built-in.
   * @param {string} id
   * @returns {object|null}
   */
  function get(id) {
    if (customStore[id]) return customStore[id];
    return builtinIndex.get(id) || null;
  }

  /**
   * Save (create or update) a custom template.
   * Cannot save with builtin: true.
   * @param {object} template
   * @returns {{ ok: boolean, template?: object, errors?: string[] }}
   */
  function save(template) {
    if (!template || typeof template !== 'object') {
      return { ok: false, errors: ['Template must be an object'] };
    }

    // Reject builtin: true on custom saves
    if (template.builtin === true) {
      return { ok: false, errors: ['Cannot save a template with builtin: true'] };
    }

    const validation = validateTemplate(template);
    if (!validation.valid) {
      return { ok: false, errors: validation.errors };
    }

    // Build the stored template
    const stored = {
      id: template.id,
      name: template.name.trim(),
      description: template.description || '',
      tasks: template.tasks.map(t => {
        const entry = { id: t.id, task: t.task };
        if (t.priority !== undefined) entry.priority = t.priority;
        if (Array.isArray(t.deps) && t.deps.length > 0) entry.deps = [...t.deps];
        if (t.category) entry.category = t.category;
        return entry;
      }),
      builtin: false,
      createdAt: customStore[template.id]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    customStore[stored.id] = stored;
    _persist();

    if (events) {
      events.emit('template:saved', { template: stored });
    }

    return { ok: true, template: stored };
  }

  /**
   * Delete a custom template by id. Cannot delete built-in templates.
   * @param {string} id
   * @returns {{ ok: boolean, error?: string }}
   */
  function remove(id) {
    // Check if it's a built-in (and not overridden by custom)
    if (builtinIndex.has(id) && !customStore[id]) {
      return { ok: false, error: 'Cannot delete a built-in template' };
    }

    if (!customStore[id]) {
      return { ok: false, error: `Template "${id}" not found` };
    }

    const deleted = customStore[id];
    delete customStore[id];
    _persist();

    if (events) {
      events.emit('template:deleted', { id, template: deleted });
    }

    return { ok: true };
  }

  return { list, get, save, remove, load, validateTemplate };
}

export { validateTemplate };
