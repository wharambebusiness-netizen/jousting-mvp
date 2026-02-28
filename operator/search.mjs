// ============================================================
// Global Search Engine (Phase 46)
// ============================================================
// Unified search across all operator subsystems: tasks, messages,
// audit log, chains, terminals, and shared memory.
//
// Factory: createSearchEngine(ctx) returns search API.
// ============================================================

// ── Constants ───────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_SNIPPET_LENGTH = 120;

// ── Scoring ─────────────────────────────────────────────────

const SCORE_EXACT_PRIMARY   = 1.0;
const SCORE_PARTIAL_PRIMARY = 0.7;
const SCORE_SECONDARY       = 0.5;

/**
 * Score a field against the query (case-insensitive).
 * @param {string|null} field - Field value to check
 * @param {string} queryLower - Lowercased query
 * @param {'primary'|'secondary'} tier - Scoring tier
 * @returns {number} Score (0 if no match)
 */
function scoreField(field, queryLower, tier) {
  if (field == null) return 0;
  const lower = String(field).toLowerCase();
  if (lower === queryLower) {
    return tier === 'primary' ? SCORE_EXACT_PRIMARY : SCORE_SECONDARY;
  }
  if (lower.includes(queryLower)) {
    return tier === 'primary' ? SCORE_PARTIAL_PRIMARY : SCORE_SECONDARY;
  }
  return 0;
}

/**
 * Generate a snippet around the first match of query in text.
 * @param {string} text
 * @param {string} queryLower
 * @returns {string}
 */
function makeSnippet(text, queryLower) {
  if (!text) return '';
  const str = String(text);
  const lower = str.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx === -1) return str.slice(0, MAX_SNIPPET_LENGTH);
  const start = Math.max(0, idx - 40);
  const end = Math.min(str.length, idx + queryLower.length + 80);
  let snippet = str.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < str.length) snippet = snippet + '...';
  return snippet;
}

// ── Factory ─────────────────────────────────────────────────

/**
 * Create a global search engine for unified cross-subsystem search.
 *
 * @param {object} ctx
 * @param {object}   [ctx.coordinator]  - Coordinator (has .taskQueue)
 * @param {object}   [ctx.messageBus]   - Terminal message bus
 * @param {object}   [ctx.auditLog]     - Audit log
 * @param {object}   [ctx.registry]     - Chain registry
 * @param {object}   [ctx.claudePool]   - Claude terminal pool
 * @param {object}   [ctx.sharedMemory] - Shared memory store
 * @param {object}   [ctx.templateManager] - Template manager
 * @param {Function} [ctx.log]          - Logger
 * @returns {object} Search engine API
 */
export function createSearchEngine(ctx = {}) {
  const { coordinator, messageBus, auditLog, registry, claudePool, sharedMemory, templateManager } = ctx;
  const log = ctx.log || (() => {});

  /**
   * Get list of available search sources based on non-null subsystems.
   * @returns {string[]}
   */
  function getSources() {
    const sources = [];
    if (coordinator && coordinator.taskQueue) sources.push('tasks');
    if (messageBus) sources.push('messages');
    if (auditLog) sources.push('audit');
    if (registry) sources.push('chains');
    if (claudePool) sources.push('terminals');
    if (sharedMemory) sources.push('memory');
    if (templateManager) sources.push('templates');
    return sources;
  }

  /**
   * Search across all (or selected) subsystems.
   * @param {string} query - Search query
   * @param {object} [options]
   * @param {string[]} [options.sources] - Limit to these sources
   * @param {number}   [options.limit]   - Max results (default 20)
   * @param {string}   [options.since]   - ISO date lower bound
   * @param {string}   [options.until]   - ISO date upper bound
   * @returns {{ results: object[], total: number, sources: string[] }}
   */
  function search(query, options = {}) {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return { results: [], total: 0, sources: getSources() };
    }

    const q = query.trim();
    const qLower = q.toLowerCase();
    const limit = options.limit || DEFAULT_LIMIT;
    const since = options.since || null;
    const until = options.until || null;
    const availableSources = getSources();
    const requestedSources = options.sources
      ? options.sources.filter(s => availableSources.includes(s))
      : availableSources;

    let allResults = [];

    // ── Search tasks ──────────────────────────────────────
    if (requestedSources.includes('tasks') && coordinator && coordinator.taskQueue) {
      try {
        const tasks = coordinator.taskQueue.getAll();
        for (const t of tasks) {
          const s1 = scoreField(t.task, qLower, 'primary');
          const s2 = scoreField(t.category, qLower, 'secondary');
          const s3 = scoreField(t.id, qLower, 'secondary');
          const score = Math.max(s1, s2, s3);
          if (score > 0) {
            allResults.push({
              source: 'tasks',
              id: t.id,
              title: t.task || t.id,
              snippet: makeSnippet(t.task || '', qLower),
              score,
              ts: t.createdAt || null,
            });
          }
        }
      } catch (err) {
        log(`[search] tasks error: ${err.message}`);
      }
    }

    // ── Search messages ───────────────────────────────────
    if (requestedSources.includes('messages') && messageBus) {
      try {
        const msgs = messageBus.getAll({ limit: 200 });
        for (const m of msgs) {
          const s1 = scoreField(m.content, qLower, 'primary');
          const s2 = scoreField(m.from, qLower, 'secondary');
          const s3 = scoreField(m.to, qLower, 'secondary');
          const score = Math.max(s1, s2, s3);
          if (score > 0) {
            allResults.push({
              source: 'messages',
              id: m.id,
              title: `${m.from}${m.to ? ' -> ' + m.to : ' (broadcast)'}`,
              snippet: makeSnippet(m.content, qLower),
              score,
              ts: m.timestamp || null,
            });
          }
        }
      } catch (err) {
        log(`[search] messages error: ${err.message}`);
      }
    }

    // ── Search audit log ──────────────────────────────────
    if (requestedSources.includes('audit') && auditLog) {
      try {
        const { entries } = auditLog.query({ limit: 200 });
        for (const e of entries) {
          const s1 = scoreField(e.action, qLower, 'primary');
          const s2 = scoreField(e.actor, qLower, 'secondary');
          const s3 = scoreField(e.target, qLower, 'secondary');
          const s4 = scoreField(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail), qLower, 'secondary');
          const score = Math.max(s1, s2, s3, s4);
          if (score > 0) {
            allResults.push({
              source: 'audit',
              id: e.ts,
              title: e.action || 'unknown',
              snippet: makeSnippet(
                [e.action, e.actor, e.target].filter(Boolean).join(' | '),
                qLower,
              ),
              score,
              ts: e.ts || null,
            });
          }
        }
      } catch (err) {
        log(`[search] audit error: ${err.message}`);
      }
    }

    // ── Search chains ─────────────────────────────────────
    if (requestedSources.includes('chains') && registry) {
      try {
        const regData = registry.load();
        for (const c of regData.chains || []) {
          const s1 = scoreField(c.task, qLower, 'primary');
          const s2 = scoreField(c.status, qLower, 'secondary');
          const s3 = scoreField(c.id, qLower, 'secondary');
          const score = Math.max(s1, s2, s3);
          if (score > 0) {
            allResults.push({
              source: 'chains',
              id: c.id,
              title: c.task || c.id,
              snippet: makeSnippet(c.task || '', qLower),
              score,
              ts: c.updatedAt || c.startedAt || null,
            });
          }
        }
      } catch (err) {
        log(`[search] chains error: ${err.message}`);
      }
    }

    // ── Search terminals ──────────────────────────────────
    if (requestedSources.includes('terminals') && claudePool) {
      try {
        const status = claudePool.getStatus();
        for (const t of status) {
          const s1 = scoreField(t.id, qLower, 'primary');
          const s2 = scoreField(t.model, qLower, 'secondary');
          const s3 = scoreField(
            Array.isArray(t.capabilities) ? t.capabilities.join(', ') : null,
            qLower,
            'secondary',
          );
          const score = Math.max(s1, s2, s3);
          if (score > 0) {
            allResults.push({
              source: 'terminals',
              id: t.id,
              title: `Terminal ${t.id}`,
              snippet: `${t.status}${t.model ? ' | ' + t.model : ''}${t.assignedTask ? ' | task: ' + t.assignedTask.taskId : ''}`,
              score,
              ts: t.spawnedAt || null,
            });
          }
        }
      } catch (err) {
        log(`[search] terminals error: ${err.message}`);
      }
    }

    // ── Search shared memory ──────────────────────────────
    if (requestedSources.includes('memory') && sharedMemory) {
      try {
        const allEntries = sharedMemory.entries();
        for (const [key, entry] of Object.entries(allEntries)) {
          const valStr = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
          const s1 = scoreField(key, qLower, 'primary');
          const s2 = scoreField(valStr, qLower, 'secondary');
          const score = Math.max(s1, s2);
          if (score > 0) {
            allResults.push({
              source: 'memory',
              id: key,
              title: key,
              snippet: makeSnippet(valStr, qLower),
              score,
              ts: entry.updatedAt || null,
            });
          }
        }
      } catch (err) {
        log(`[search] memory error: ${err.message}`);
      }
    }

    // ── Search templates ────────────────────────────────
    if (requestedSources.includes('templates') && templateManager) {
      try {
        const templates = templateManager.list();
        for (const tmpl of templates) {
          const s1 = scoreField(tmpl.name, qLower, 'primary');
          const s2 = scoreField(tmpl.description, qLower, 'primary');
          const s3 = scoreField(tmpl.id, qLower, 'secondary');
          // Also search task descriptions within the template
          let s4 = 0;
          for (const t of tmpl.tasks || []) {
            s4 = Math.max(s4, scoreField(t.task, qLower, 'secondary'));
            s4 = Math.max(s4, scoreField(t.id, qLower, 'secondary'));
          }
          const score = Math.max(s1, s2, s3, s4);
          if (score > 0) {
            allResults.push({
              source: 'templates',
              id: tmpl.id,
              title: tmpl.name,
              snippet: makeSnippet(tmpl.description || tmpl.name, qLower),
              score,
              ts: tmpl.createdAt || null,
              meta: { builtin: tmpl.builtin, taskCount: tmpl.tasks.length },
            });
          }
        }
      } catch (err) {
        log(`[search] templates error: ${err.message}`);
      }
    }

    // ── Date range filter ─────────────────────────────────
    if (since) {
      allResults = allResults.filter(r => r.ts && r.ts >= since);
    }
    if (until) {
      allResults = allResults.filter(r => r.ts && r.ts <= until);
    }

    // ── Sort: score desc, then timestamp desc ─────────────
    allResults.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Newer first for tiebreaker
      const tsA = a.ts || '';
      const tsB = b.ts || '';
      return tsB.localeCompare(tsA);
    });

    const total = allResults.length;
    const results = allResults.slice(0, limit);

    return { results, total, sources: availableSources };
  }

  return { search, getSources };
}
