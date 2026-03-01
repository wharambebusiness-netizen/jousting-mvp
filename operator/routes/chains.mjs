// ============================================================
// Chain Routes (M4)
// ============================================================
// REST endpoints for chain CRUD, session detail, and cost
// summaries. Imports registry.mjs directly for data access.
//
// Multi-project: POST body accepts projectDir, GET accepts
// ?project= query param for filtering.
// ============================================================

import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  createChain, updateChainStatus,
  findChainById, getChainSummary,
} from '../registry.mjs';

/**
 * Create chain routes.
 * @param {object} ctx
 * @param {string}   ctx.operatorDir
 * @param {EventBus} ctx.events
 * @param {Function} [ctx.runChainFn] - For combined mode chain creation
 */
export function createChainRoutes(ctx) {
  const { load: loadRegistry, save: saveRegistry } = ctx.registry;
  const router = Router();

  // ── GET /api/chains ─────────────────────────────────────
  // List chains with optional filtering and pagination.
  // Query params: ?project=, ?status=, ?limit=, ?offset=
  router.get('/chains', (_req, res) => {
    try {
      const registry = loadRegistry();
      let chains = registry.chains;

      // Filter by project
      const projectFilter = _req.query.project;
      if (projectFilter) {
        const normalizedFilter = resolve(projectFilter).replace(/\\/g, '/');
        chains = chains.filter(c => {
          if (!c.projectDir) return false;
          return resolve(c.projectDir).replace(/\\/g, '/') === normalizedFilter;
        });
      }

      // Filter by status
      const statusFilter = _req.query.status;
      if (statusFilter) {
        chains = chains.filter(c => c.status === statusFilter);
      }

      // Text search on task and id
      const q = _req.query.q;
      if (q && typeof q === 'string' && q.trim().length > 0) {
        const needle = q.trim().toLowerCase();
        chains = chains.filter(c =>
          (c.task && c.task.toLowerCase().includes(needle)) ||
          (c.id && c.id.toLowerCase().includes(needle))
        );
      }

      // Sort by updatedAt descending (newest first)
      chains.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

      // Pagination
      const limit = Math.max(1, Math.min(parseInt(_req.query.limit, 10) || 50, 100));
      const offset = Math.max(0, parseInt(_req.query.offset, 10) || 0);
      const total = chains.length;
      const paginated = chains.slice(offset, offset + limit);

      res.json({
        chains: paginated.map(getChainSummary),
        total,
        limit,
        offset,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/chains/:id ─────────────────────────────────
  // Full chain detail with all sessions.
  router.get('/chains/:id', (req, res) => {
    try {
      const registry = loadRegistry();
      const chain = findChainById(registry, req.params.id);
      if (!chain) {
        return res.status(404).json({ error: 'Chain not found' });
      }
      res.json(chain);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/chains/:id ──────────────────────────────
  // Update chain task description and/or metadata.
  router.patch('/chains/:id', (req, res) => {
    try {
      const registry = loadRegistry();
      const chain = findChainById(registry, req.params.id);
      if (!chain) {
        return res.status(404).json({ error: 'Chain not found' });
      }

      const { task, metadata } = req.body || {};
      let changed = false;

      if (task !== undefined) {
        if (typeof task !== 'string' || task.trim().length === 0) {
          return res.status(400).json({ error: 'task must be a non-empty string' });
        }
        chain.task = task.trim();
        changed = true;
      }

      if (metadata !== undefined) {
        if (metadata !== null && typeof metadata !== 'object') {
          return res.status(400).json({ error: 'metadata must be an object or null' });
        }
        chain.metadata = metadata;
        changed = true;
      }

      if (!changed) {
        return res.status(400).json({ error: 'No fields to update (provide task and/or metadata)' });
      }

      chain.updatedAt = new Date().toISOString();
      saveRegistry(registry);

      ctx.events.emit('chain:updated', {
        chainId: chain.id,
        task: chain.task,
        metadata: chain.metadata || null,
      });

      res.json(getChainSummary(chain));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/chains ────────────────────────────────────
  // Start a new chain. Requires combined mode (runChainFn).
  // Body: { task, model?, maxTurns?, maxContinuations?, maxBudgetUsd?, projectDir? }
  router.post('/chains', (req, res) => {
    try {
      const { task, model, maxTurns, maxContinuations, maxBudgetUsd, projectDir, branch } = req.body || {};

      if (!task || typeof task !== 'string' || task.trim().length === 0) {
        return res.status(400).json({ error: 'task is required' });
      }

      // Validate numeric fields
      const validModels = ['haiku', 'sonnet', 'opus'];
      const parsedMaxTurns = Number(maxTurns) || 30;
      const parsedMaxCont = Number(maxContinuations) || 5;
      const parsedBudget = Number(maxBudgetUsd) || 5.0;

      if (model && !validModels.includes(model)) {
        return res.status(400).json({ error: `model must be one of: ${validModels.join(', ')}` });
      }
      if (parsedMaxTurns < 1 || parsedMaxTurns > 200) {
        return res.status(400).json({ error: 'maxTurns must be between 1 and 200' });
      }
      if (parsedBudget < 0) {
        return res.status(400).json({ error: 'maxBudgetUsd must be non-negative' });
      }

      // Validate branch name if provided
      const sanitizedBranch = branch && typeof branch === 'string'
        ? branch.trim().replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 100)
        : null;

      const registry = loadRegistry();
      const chain = createChain(registry, {
        task: task.trim(),
        config: {
          model: model || 'sonnet',
          maxTurns: parsedMaxTurns,
          maxContinuations: Math.max(1, Math.min(parsedMaxCont, 20)),
          maxBudgetUsd: parsedBudget || 5.0,
          branch: sanitizedBranch || undefined,
        },
        projectDir: projectDir || null,
      });
      saveRegistry(registry);

      ctx.events.emit('chain:started', {
        chainId: chain.id,
        task: chain.task,
        projectDir: chain.projectDir,
      });

      // If combined mode, start the chain runner in background
      if (ctx.runChainFn) {
        ctx.runChainFn(chain).catch(err => {
          ctx.events.emit('chain:error', { chainId: chain.id, error: err.message });
        });
      }

      res.status(201).json(getChainSummary(chain));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/chains/:id/abort ──────────────────────────
  // Abort a running chain.
  router.post('/chains/:id/abort', (req, res) => {
    try {
      const registry = loadRegistry();
      const chain = findChainById(registry, req.params.id);
      if (!chain) {
        return res.status(404).json({ error: 'Chain not found' });
      }
      if (chain.status !== 'running') {
        return res.status(409).json({ error: `Chain is not running (status: ${chain.status})` });
      }

      updateChainStatus(chain, 'aborted');
      saveRegistry(registry);

      ctx.events.emit('chain:aborted', { chainId: chain.id });

      res.json(getChainSummary(chain));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/chains/:id/restart ───────────────────────
  // Restart a failed/aborted chain by creating a new chain with the same task + config.
  router.post('/chains/:id/restart', (req, res) => {
    try {
      const registry = loadRegistry();
      const chain = findChainById(registry, req.params.id);
      if (!chain) {
        return res.status(404).json({ error: 'Chain not found' });
      }
      if (chain.status === 'running') {
        return res.status(409).json({ error: 'Chain is still running' });
      }

      const newChain = createChain(registry, {
        task: chain.task,
        config: chain.config || {},
        projectDir: chain.projectDir,
        restartedFrom: chain.id,
      });
      saveRegistry(registry);

      ctx.events.emit('chain:started', {
        chainId: newChain.id,
        task: newChain.task,
        projectDir: newChain.projectDir,
        restartedFrom: chain.id,
      });

      // If combined mode, start the chain runner
      if (ctx.runChainFn) {
        ctx.runChainFn(newChain).catch(err => {
          ctx.events.emit('chain:error', { chainId: newChain.id, error: err.message });
        });
      }

      res.status(201).json(getChainSummary(newChain));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/chains/:id ──────────────────────────────
  // Remove a chain from the registry.
  router.delete('/chains/:id', (req, res) => {
    try {
      const registry = loadRegistry();
      const idx = registry.chains.findIndex(c => c.id === req.params.id);
      if (idx === -1) {
        return res.status(404).json({ error: 'Chain not found' });
      }
      if (registry.chains[idx].status === 'running') {
        return res.status(409).json({ error: 'Cannot delete a running chain — abort it first' });
      }

      const deletedId = registry.chains[idx].id;
      registry.chains.splice(idx, 1);
      saveRegistry(registry);

      if (ctx.events) ctx.events.emit('chain:deleted', { chainId: deletedId });
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/chains/batch-delete ───────────────────────
  // Delete multiple chains at once. Body: { ids: string[] }
  router.post('/batch-delete', (req, res) => {
    try {
      const { ids } = req.body || {};
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids array required' });
      }
      const registry = loadRegistry();
      const idSet = new Set(ids);
      const running = registry.chains.filter(c => idSet.has(c.id) && c.status === 'running');
      if (running.length > 0) {
        return res.status(409).json({ error: `Cannot delete ${running.length} running chain(s) — abort first` });
      }
      const before = registry.chains.length;
      registry.chains = registry.chains.filter(c => !idSet.has(c.id));
      const deleted = before - registry.chains.length;
      saveRegistry(registry);
      for (const id of ids) {
        if (ctx.events) ctx.events.emit('chain:deleted', { chainId: id });
      }
      res.json({ deleted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/chains/:id/sessions/:idx ───────────────────
  // Session detail including handoff file content.
  router.get('/chains/:id/sessions/:idx', (req, res) => {
    try {
      const registry = loadRegistry();
      const chain = findChainById(registry, req.params.id);
      if (!chain) {
        return res.status(404).json({ error: 'Chain not found' });
      }

      const idx = parseInt(req.params.idx, 10);
      if (isNaN(idx) || idx < 0 || idx >= chain.sessions.length) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const session = chain.sessions[idx];

      // Read handoff file if it exists
      let handoffContent = null;
      if (session.handoffFile && existsSync(session.handoffFile)) {
        try {
          handoffContent = readFileSync(session.handoffFile, 'utf-8');
        } catch (_) { /* noop */ }
      }

      res.json({
        ...session,
        handoffContent,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/costs ──────────────────────────────────────
  // Cost summary across all chains, with optional project filter.
  router.get('/costs', (req, res) => {
    try {
      const registry = loadRegistry();
      let chains = registry.chains;

      // Filter by project
      const projectFilter = req.query.project;
      if (projectFilter) {
        const normalizedFilter = resolve(projectFilter).replace(/\\/g, '/');
        chains = chains.filter(c => {
          if (!c.projectDir) return false;
          return resolve(c.projectDir).replace(/\\/g, '/') === normalizedFilter;
        });
      }

      const totalCost = chains.reduce((sum, c) => sum + (c.totalCostUsd || 0), 0);
      const totalSessions = chains.reduce((sum, c) => sum + (c.sessions?.length || 0), 0);
      const totalTurns = chains.reduce((sum, c) => sum + (c.totalTurns || 0), 0);

      // Per-status breakdown
      const byStatus = {};
      for (const chain of chains) {
        if (!byStatus[chain.status]) {
          byStatus[chain.status] = { count: 0, costUsd: 0 };
        }
        byStatus[chain.status].count++;
        byStatus[chain.status].costUsd += chain.totalCostUsd || 0;
      }

      // Per-project breakdown
      const byProject = {};
      for (const chain of chains) {
        const proj = chain.projectDir || '(default)';
        if (!byProject[proj]) {
          byProject[proj] = { chains: 0, costUsd: 0, sessions: 0 };
        }
        byProject[proj].chains++;
        byProject[proj].costUsd += chain.totalCostUsd || 0;
        byProject[proj].sessions += chain.sessions?.length || 0;
      }

      // Per-model breakdown
      const byModel = {};
      for (const chain of chains) {
        const model = chain.config?.model || 'sonnet';
        if (!byModel[model]) {
          byModel[model] = { chains: 0, costUsd: 0, sessions: 0, inputTokens: 0, outputTokens: 0 };
        }
        byModel[model].chains++;
        byModel[model].costUsd += chain.totalCostUsd || 0;
        byModel[model].sessions += chain.sessions?.length || 0;
        for (const s of (chain.sessions || [])) {
          byModel[model].inputTokens += s.inputTokens || 0;
          byModel[model].outputTokens += s.outputTokens || 0;
        }
      }

      res.json({
        totalCostUsd: totalCost,
        totalChains: chains.length,
        totalSessions,
        totalTurns,
        byStatus,
        byProject,
        byModel,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/chains/export ──────────────────────────────
  // Export chain list as JSON or CSV. ?format=csv|json (default json).
  // Supports same ?project= filter as chain list.
  router.get('/export', (req, res) => {
    try {
      const registry = loadRegistry();
      let chains = registry.chains;

      const projectFilter = req.query.project;
      if (projectFilter) {
        const normalizedFilter = resolve(projectFilter).replace(/\\/g, '/');
        chains = chains.filter(c => {
          if (!c.projectDir) return false;
          return resolve(c.projectDir).replace(/\\/g, '/') === normalizedFilter;
        });
      }

      const rows = chains.map(c => ({
        id: c.id,
        task: c.task,
        status: c.status,
        model: c.config?.model || 'sonnet',
        sessions: c.sessions?.length || 0,
        totalCostUsd: c.totalCostUsd || 0,
        totalTurns: c.totalTurns || 0,
        totalDurationMs: c.totalDurationMs || 0,
        startedAt: c.startedAt || '',
        updatedAt: c.updatedAt || '',
        projectDir: c.projectDir || '',
        branch: c.config?.branch || '',
      }));

      const format = (req.query.format || 'json').toLowerCase();
      if (format === 'csv') {
        const headers = ['id', 'task', 'status', 'model', 'sessions', 'totalCostUsd', 'totalTurns', 'totalDurationMs', 'startedAt', 'updatedAt', 'projectDir', 'branch'];
        const csvEscape = (v) => {
          const s = String(v ?? '');
          return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lines = [headers.join(',')];
        for (const row of rows) {
          lines.push(headers.map(h => csvEscape(row[h])).join(','));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="chains.csv"');
        res.send(lines.join('\n'));
      } else {
        res.setHeader('Content-Disposition', 'attachment; filename="chains.json"');
        res.json(rows);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/projects ───────────────────────────────────
  // List distinct projects with summary stats.
  router.get('/projects', (_req, res) => {
    try {
      const registry = loadRegistry();
      const projectMap = {};

      for (const chain of registry.chains) {
        const proj = chain.projectDir || '(default)';
        if (!projectMap[proj]) {
          projectMap[proj] = {
            projectDir: chain.projectDir,
            chains: 0,
            running: 0,
            completed: 0,
            failed: 0,
            totalCostUsd: 0,
            lastActivity: null,
          };
        }
        const entry = projectMap[proj];
        entry.chains++;
        if (chain.status === 'running') entry.running++;
        if (chain.status === 'complete' || chain.status === 'assumed-complete') entry.completed++;
        if (chain.status === 'failed' || chain.status === 'aborted') entry.failed++;
        entry.totalCostUsd += chain.totalCostUsd || 0;

        if (!entry.lastActivity || chain.updatedAt > entry.lastActivity) {
          entry.lastActivity = chain.updatedAt;
        }
      }

      const projects = Object.values(projectMap)
        .sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));

      res.json({ projects });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
