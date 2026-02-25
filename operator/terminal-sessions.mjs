// ============================================================
// Terminal Sessions — Session Recording + Resume + Templates
// ============================================================
// Records terminal lifecycle events into a persistent session
// store, provides resume/clone config generation, and manages
// named terminal configuration templates.
//
// Factory: createTerminalSessionStore(ctx) returns session API.
//
// Phase 48: Terminal Session Management.
// ============================================================

import {
  writeFileSync, readFileSync, existsSync,
  mkdirSync, renameSync, unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// ── Constants ───────────────────────────────────────────────

const MAX_SESSIONS_DEFAULT = 100;
const OUTPUT_SUMMARY_CHARS = 500;

// ── Built-in Templates ───────────────────────────────────────

const BUILTIN_TEMPLATES = [
  {
    name: 'default',
    model: 'sonnet',
    projectDir: null,
    systemPrompt: null,
    capabilities: null,
    dangerouslySkipPermissions: true,
    createdAt: null,
    builtin: true,
  },
  {
    name: 'code-review',
    model: 'sonnet',
    projectDir: null,
    systemPrompt: 'Review code changes and suggest improvements',
    capabilities: null,
    dangerouslySkipPermissions: true,
    createdAt: null,
    builtin: true,
  },
  {
    name: 'bug-fix',
    model: 'sonnet',
    projectDir: null,
    systemPrompt: 'Diagnose and fix the following bug',
    capabilities: null,
    dangerouslySkipPermissions: true,
    createdAt: null,
    builtin: true,
  },
];

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a terminal session store.
 *
 * @param {object} ctx
 * @param {string}   [ctx.persistPath]    - Path for session persistence
 * @param {string}   [ctx.templatePath]   - Path for template persistence
 * @param {object}   [ctx.events]         - EventBus for terminal lifecycle events
 * @param {number}   [ctx.maxSessions]    - Max stored sessions (default 100, FIFO eviction)
 * @param {object}   [ctx.claudePool]     - Claude pool for output buffer access on exit
 * @param {Function} [ctx.log]            - Logger function
 * @returns {object} Session store API
 */
export function createTerminalSessionStore(ctx = {}) {
  const persistPath = ctx.persistPath || null;
  const templatePath = ctx.templatePath || null;
  const events = ctx.events || null;
  const maxSessions = ctx.maxSessions ?? MAX_SESSIONS_DEFAULT;
  const claudePool = ctx.claudePool || null;
  const log = ctx.log || (() => {});

  // ── Internal State ──────────────────────────────────────

  /** @type {Map<string, SessionRecord>} */
  const sessions = new Map();

  /** @type {Map<string, TemplateRecord>} */
  const templates = new Map();

  // ── EventBus Subscriptions ──────────────────────────────

  const _handlers = [];

  function _on(event, handler) {
    if (!events) return;
    events.on(event, handler);
    _handlers.push({ event, handler });
  }

  // claude-terminal:spawned → create session record
  _on('claude-terminal:spawned', (data) => {
    const { terminalId, config = {} } = data;
    const now = new Date().toISOString();

    const session = {
      id: terminalId,
      startedAt: now,
      endedAt: null,
      exitCode: null,
      config: {
        model: config.model || null,
        projectDir: config.projectDir || null,
        dangerouslySkipPermissions: !!config.dangerouslySkipPermissions,
        systemPrompt: config.systemPrompt || null,
        capabilities: config.capabilities || null,
      },
      taskHistory: [],
      lastTaskId: null,
      handoffCount: config._handoffCount || 0,
      outputSummary: '',
      duration: 0,
    };

    sessions.set(terminalId, session);
    _evictIfNeeded();
    _save();

    log(`[terminal-sessions] Session created: ${terminalId}`);
  });

  // claude-terminal:exit → update endedAt, exitCode, duration, outputSummary
  _on('claude-terminal:exit', (data) => {
    const { terminalId, exitCode } = data;
    const session = sessions.get(terminalId);
    if (!session) return;

    const now = new Date().toISOString();
    session.endedAt = now;
    session.exitCode = exitCode ?? null;
    session.duration = session.startedAt
      ? Date.now() - new Date(session.startedAt).getTime()
      : 0;

    // Capture output summary from pool entry
    if (claudePool) {
      try {
        const handle = claudePool.getTerminalHandle(terminalId);
        if (handle && typeof handle.getOutputBuffer === 'function') {
          const buf = handle.getOutputBuffer();
          session.outputSummary = buf.slice(-OUTPUT_SUMMARY_CHARS);
        }
      } catch { /* noop */ }
    }

    _save();
    log(`[terminal-sessions] Session ended: ${terminalId} (exitCode=${exitCode})`);
  });

  // claude-terminal:handoff → increment handoffCount
  _on('claude-terminal:handoff', (data) => {
    const { terminalId, handoffCount } = data;
    const session = sessions.get(terminalId);
    if (!session) return;
    session.handoffCount = handoffCount ?? (session.handoffCount + 1);
    _save();
  });

  // claude-terminal:task-completed → append category to taskHistory
  _on('claude-terminal:task-completed', (data) => {
    if (data.status !== 'complete') return;
    const { terminalId, taskId, category } = data;
    const session = sessions.get(terminalId);
    if (!session) return;
    if (taskId) session.lastTaskId = taskId;
    if (category && !session.taskHistory.includes(category)) {
      session.taskHistory.push(category);
    }
    _save();
  });

  // ── FIFO Eviction ──────────────────────────────────────

  function _evictIfNeeded() {
    if (sessions.size <= maxSessions) return;
    // Find oldest by startedAt
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, s] of sessions) {
      const t = s.startedAt ? new Date(s.startedAt).getTime() : 0;
      if (t < oldestTime) {
        oldestTime = t;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      sessions.delete(oldestKey);
      log(`[terminal-sessions] Evicted oldest session: ${oldestKey}`);
    }
  }

  // ── Session API ─────────────────────────────────────────

  /**
   * Get a session by terminal ID.
   * @param {string} id
   * @returns {object|null}
   */
  function getSession(id) {
    return sessions.get(id) || null;
  }

  /**
   * List sessions with optional filtering and pagination.
   * @param {object} [opts]
   * @param {'all'|'running'|'completed'} [opts.status] - Filter by status
   * @param {number} [opts.limit]
   * @param {number} [opts.offset]
   * @param {'startedAt'|'duration'} [opts.sort]
   * @returns {object[]}
   */
  function listSessions(opts = {}) {
    const { status = 'all', limit, offset = 0, sort = 'startedAt' } = opts;

    let result = [...sessions.values()];

    // Status filter
    if (status === 'running') {
      result = result.filter(s => s.endedAt === null);
    } else if (status === 'completed') {
      result = result.filter(s => s.endedAt !== null);
    }

    // Sort
    result.sort((a, b) => {
      if (sort === 'duration') {
        return (b.duration || 0) - (a.duration || 0);
      }
      // default: startedAt descending
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return tb - ta;
    });

    // Pagination
    const sliced = typeof limit === 'number'
      ? result.slice(offset, offset + limit)
      : result.slice(offset);

    return sliced.map(s => ({ ...s }));
  }

  /**
   * Build a resume spawn config from a session.
   * Augments systemPrompt with previous output context.
   * @param {string} id - Session ID to resume
   * @returns {object|null} Spawn config suitable for claudePool.spawn()
   */
  function getResumeConfig(id) {
    const session = sessions.get(id);
    if (!session) return null;

    const base = { ...session.config };

    // Augment system prompt with output summary
    const summary = session.outputSummary
      ? session.outputSummary.trim()
      : '';

    const resumeNote = summary
      ? `Continue from previous session. Last output: ${summary}`
      : 'Continue from previous session.';

    if (base.systemPrompt) {
      base.systemPrompt = `${base.systemPrompt}\n\n${resumeNote}`;
    } else {
      base.systemPrompt = resumeNote;
    }

    return base;
  }

  /**
   * Delete a session.
   * @param {string} id
   * @returns {boolean}
   */
  function deleteSession(id) {
    if (!sessions.has(id)) return false;
    sessions.delete(id);
    _save();
    return true;
  }

  /**
   * Clear all sessions.
   */
  function clear() {
    sessions.clear();
    _save();
  }

  // ── Template API ────────────────────────────────────────

  /**
   * Get all templates (built-ins + custom).
   * @returns {object[]}
   */
  function getTemplates() {
    const custom = [...templates.values()].map(t => ({ ...t }));
    // Merge built-ins (custom with same name overrides built-in)
    const names = new Set(custom.map(t => t.name));
    const builtins = BUILTIN_TEMPLATES.filter(t => !names.has(t.name));
    return [...builtins, ...custom];
  }

  /**
   * Get a template by name.
   * @param {string} name
   * @returns {object|null}
   */
  function getTemplate(name) {
    if (templates.has(name)) return { ...templates.get(name) };
    const builtin = BUILTIN_TEMPLATES.find(t => t.name === name);
    return builtin ? { ...builtin } : null;
  }

  /**
   * Save a named terminal configuration template.
   * @param {string} name
   * @param {object} config - { model, projectDir, systemPrompt, capabilities, dangerouslySkipPermissions }
   * @returns {object} Saved template
   */
  function saveTemplate(name, config = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Template name must be a non-empty string');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error('Template name must match /^[a-zA-Z0-9_-]+$/');
    }

    const template = {
      name,
      model: config.model || null,
      projectDir: config.projectDir || null,
      systemPrompt: config.systemPrompt || null,
      capabilities: Array.isArray(config.capabilities) ? [...config.capabilities] : null,
      dangerouslySkipPermissions: config.dangerouslySkipPermissions !== undefined
        ? !!config.dangerouslySkipPermissions
        : true,
      createdAt: new Date().toISOString(),
      builtin: false,
    };

    templates.set(name, template);
    _saveTemplates();

    return { ...template };
  }

  /**
   * Delete a custom template (cannot delete built-ins).
   * @param {string} name
   * @returns {boolean}
   */
  function deleteTemplate(name) {
    // Cannot delete built-in templates
    if (BUILTIN_TEMPLATES.some(t => t.name === name)) {
      throw new Error(`Cannot delete built-in template "${name}"`);
    }
    if (!templates.has(name)) return false;
    templates.delete(name);
    _saveTemplates();
    return true;
  }

  // ── Persistence ─────────────────────────────────────────

  /**
   * Save sessions to disk (atomic write).
   */
  function _save() {
    if (!persistPath) return;

    const data = {
      sessions: {},
      savedAt: new Date().toISOString(),
      version: 1,
    };

    for (const [id, s] of sessions) {
      data.sessions[id] = s;
    }

    const dir = dirname(persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = persistPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      renameSync(tmpFile, persistPath);
    } catch (err) {
      try {
        writeFileSync(persistPath, JSON.stringify(data, null, 2));
      } catch { /* ignore */ }
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  /**
   * Save templates to disk (atomic write).
   */
  function _saveTemplates() {
    if (!templatePath) return;

    const data = {
      templates: {},
      savedAt: new Date().toISOString(),
      version: 1,
    };

    for (const [name, t] of templates) {
      data.templates[name] = t;
    }

    const dir = dirname(templatePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpFile = templatePath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2));
      renameSync(tmpFile, templatePath);
    } catch (err) {
      try {
        writeFileSync(templatePath, JSON.stringify(data, null, 2));
      } catch { /* ignore */ }
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  /**
   * Load sessions and templates from disk.
   * @returns {{ sessionsLoaded: number, templatesLoaded: number }}
   */
  function load() {
    let sessionsLoaded = 0;
    let templatesLoaded = 0;

    // Load sessions
    if (persistPath) {
      let data = null;
      if (existsSync(persistPath)) {
        try {
          data = JSON.parse(readFileSync(persistPath, 'utf-8'));
          try { unlinkSync(persistPath + '.tmp'); } catch { /* ignore */ }
        } catch { data = null; }
      }
      if (!data) {
        const tmp = persistPath + '.tmp';
        if (existsSync(tmp)) {
          try {
            data = JSON.parse(readFileSync(tmp, 'utf-8'));
            try { renameSync(tmp, persistPath); } catch { /* ignore */ }
          } catch { data = null; }
        }
      }

      if (data && data.sessions && typeof data.sessions === 'object') {
        for (const [id, s] of Object.entries(data.sessions)) {
          sessions.set(id, s);
          sessionsLoaded++;
        }
        log(`[terminal-sessions] Loaded ${sessionsLoaded} sessions`);
      }
    }

    // Load custom templates
    if (templatePath) {
      let tdata = null;
      if (existsSync(templatePath)) {
        try {
          tdata = JSON.parse(readFileSync(templatePath, 'utf-8'));
          try { unlinkSync(templatePath + '.tmp'); } catch { /* ignore */ }
        } catch { tdata = null; }
      }
      if (!tdata) {
        const tmp = templatePath + '.tmp';
        if (existsSync(tmp)) {
          try {
            tdata = JSON.parse(readFileSync(tmp, 'utf-8'));
            try { renameSync(tmp, templatePath); } catch { /* ignore */ }
          } catch { tdata = null; }
        }
      }

      if (tdata && tdata.templates && typeof tdata.templates === 'object') {
        for (const [name, t] of Object.entries(tdata.templates)) {
          templates.set(name, t);
          templatesLoaded++;
        }
        log(`[terminal-sessions] Loaded ${templatesLoaded} templates`);
      }
    }

    return { sessionsLoaded, templatesLoaded };
  }

  /**
   * Unwire EventBus listeners.
   */
  function destroy() {
    for (const { event, handler } of _handlers) {
      try { events.off(event, handler); } catch { /* ignore */ }
    }
    _handlers.length = 0;
  }

  // ── Public API ──────────────────────────────────────────

  return {
    // Sessions
    getSession,
    listSessions,
    getResumeConfig,
    deleteSession,
    clear,

    // Templates
    getTemplates,
    getTemplate,
    saveTemplate,
    deleteTemplate,

    // Persistence
    load,
    destroy,

    get count() { return sessions.size; },
  };
}

export { MAX_SESSIONS_DEFAULT, OUTPUT_SUMMARY_CHARS, BUILTIN_TEMPLATES };
