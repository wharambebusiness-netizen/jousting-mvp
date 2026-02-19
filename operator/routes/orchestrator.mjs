// ============================================================
// Orchestrator Routes (M4 + M6a + Phase 1 Multi-Instance)
// ============================================================
// Endpoints for orchestrator status, control, and mission
// management. Supports multiple concurrent orchestrator
// instances via process pool, with backward-compatible
// single-instance endpoints.
//
// Multi-instance endpoints:
//   GET  /api/orchestrator/instances       - List all instances
//   POST /api/orchestrator/:id/start       - Start specific instance
//   POST /api/orchestrator/:id/stop        - Stop specific instance
//   DELETE /api/orchestrator/:id           - Remove stopped instance
//
// Legacy single-instance endpoints (use 'default' instance):
//   GET  /api/orchestrator/status          - Status of default/first
//   POST /api/orchestrator/start           - Start default instance
//   POST /api/orchestrator/stop            - Stop default instance
// ============================================================

import { Router } from 'express';
import { fork } from 'child_process';
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { randomUUID } from 'crypto';

/**
 * Create orchestrator routes with multi-instance support.
 * @param {object} ctx
 * @param {EventBus} ctx.events
 * @param {string}   [ctx.operatorDir] - Path to operator/ directory (for history persistence)
 * @param {object}   [ctx.pool] - Process pool instance (for multi-instance mode)
 * @param {object}   [ctx.orchestratorCtx] - Live orchestrator context (if running)
 */
export function createOrchestratorRoutes(ctx) {
  const router = Router();
  const pool = ctx.pool || null;

  // ── Per-Instance State ──────────────────────────────────

  /** @type {Map<string, InstanceState>} */
  const instances = new Map();

  /** @type {Map<string, Map<string, object>>} per-instance agent maps */
  const instanceAgentMaps = new Map();

  /**
   * Get or create instance state.
   * @param {string} id
   * @returns {object}
   */
  function getInstanceState(id) {
    if (!instances.has(id)) {
      instances.set(id, {
        id,
        running: false,
        startedAt: null,
        round: 0,
        agents: [],
        mission: null,
        model: null,
        dryRun: false,
        pid: null,
      });
      instanceAgentMaps.set(id, new Map());
    }
    return instances.get(id);
  }

  function getAgentMap(id) {
    if (!instanceAgentMaps.has(id)) {
      instanceAgentMaps.set(id, new Map());
    }
    return instanceAgentMaps.get(id);
  }

  // Track direct child processes (non-pool mode, backward compat)
  const directProcesses = new Map();

  // ── Run History Persistence ──────────────────────────────
  const MAX_HISTORY = 50;
  const operatorDir = ctx.operatorDir || null;
  const historyPath = operatorDir ? join(operatorDir, 'orch-history.json') : null;
  /** @type {Map<string, string>} instanceId → runId */
  const currentRunIds = new Map();

  function loadHistory() {
    if (!historyPath) return [];
    try {
      if (existsSync(historyPath)) {
        const data = JSON.parse(readFileSync(historyPath, 'utf-8'));
        return Array.isArray(data) ? data : [];
      }
    } catch (_) {}
    return [];
  }

  function saveHistory(runs) {
    if (!historyPath) return;
    const dir = dirname(historyPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmpFile = historyPath + '.tmp';
    try {
      writeFileSync(tmpFile, JSON.stringify(runs, null, 2));
      renameSync(tmpFile, historyPath);
    } catch (_) {
      try { writeFileSync(historyPath, JSON.stringify(runs, null, 2)); } catch (__) {}
    }
  }

  function recordRunStart(instanceId, data) {
    const run = {
      id: randomUUID(),
      instanceId,
      mission: data.mission || null,
      model: data.model || null,
      dryRun: data.dryRun || false,
      startedAt: data.timestamp || new Date().toISOString(),
      stoppedAt: null,
      durationMs: 0,
      outcome: 'running',
      rounds: 0,
      agents: 0,
    };
    currentRunIds.set(instanceId, run.id);
    const history = loadHistory();
    history.unshift(run);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    saveHistory(history);
    return run;
  }

  function recordRunStop(instanceId, data) {
    const runId = currentRunIds.get(instanceId);
    if (!runId) return;
    const history = loadHistory();
    const run = history.find(r => r.id === runId);
    if (run) {
      const state = instances.get(instanceId);
      const agentMap = instanceAgentMaps.get(instanceId);
      run.stoppedAt = new Date().toISOString();
      run.durationMs = new Date(run.stoppedAt) - new Date(run.startedAt);
      run.outcome = data?.error ? 'error' : (data?.code != null && data.code !== 0) ? 'error' : 'stopped';
      run.rounds = state?.round || 0;
      run.agents = agentMap?.size || 0;
      saveHistory(history);
    }
    currentRunIds.delete(instanceId);
  }

  // ── Event Wiring ────────────────────────────────────────
  // Events from workers include workerId field for routing.
  // Legacy events (no workerId) default to 'default' instance.

  if (ctx.events) {
    ctx.events.on('orchestrator:started', (data) => {
      const id = data.workerId || 'default';
      const agentMap = getAgentMap(id);
      agentMap.clear();
      const state = getInstanceState(id);
      Object.assign(state, {
        running: true,
        startedAt: data.timestamp || new Date().toISOString(),
        round: 0,
        agents: [],
        mission: data.mission || null,
        model: data.model || null,
        dryRun: data.dryRun || false,
        pid: data.pid || null,
      });
      recordRunStart(id, data);
    });

    ctx.events.on('round:start', (data) => {
      const id = data.workerId || 'default';
      const state = instances.get(id);
      if (state) {
        state.round = data.round || state.round + 1;
      }
    });

    ctx.events.on('agent:start', (data) => {
      if (!data.agentId) return;
      const id = data.workerId || 'default';
      const state = instances.get(id);
      const agentMap = getAgentMap(id);
      const agent = {
        id: data.agentId,
        status: 'running',
        model: data.model || 'default',
        round: data.round || (state?.round || 0),
        startedAt: new Date().toISOString(),
        elapsedMs: null,
        cost: null,
        continuations: 0,
      };
      agentMap.set(data.agentId, agent);
      if (state) state.agents = [...agentMap.values()];
    });

    ctx.events.on('agent:complete', (data) => {
      if (!data.agentId) return;
      const id = data.workerId || 'default';
      const state = instances.get(id);
      const agentMap = getAgentMap(id);
      const agent = agentMap.get(data.agentId);
      if (agent) {
        agent.status = 'complete';
        agent.elapsedMs = data.elapsedMs || null;
        if (data.continuations != null) agent.continuations = data.continuations;
        if (state) state.agents = [...agentMap.values()];
      }
    });

    ctx.events.on('agent:error', (data) => {
      if (!data.agentId) return;
      const id = data.workerId || 'default';
      const state = instances.get(id);
      const agentMap = getAgentMap(id);
      const agent = agentMap.get(data.agentId);
      if (agent) {
        agent.status = 'failed';
        agent.statusDetail = data.status || 'ERROR';
        agent.elapsedMs = data.elapsedMs || null;
        if (data.continuations != null) agent.continuations = data.continuations;
        if (state) state.agents = [...agentMap.values()];
      }
    });

    ctx.events.on('agent:continuation', (data) => {
      if (!data.agentId) return;
      const id = data.workerId || 'default';
      const state = instances.get(id);
      const agentMap = getAgentMap(id);
      const agent = agentMap.get(data.agentId);
      if (agent) {
        agent.continuations = data.index || (agent.continuations + 1);
        if (data.cost != null) agent.cost = data.cost;
        if (state) state.agents = [...agentMap.values()];
      }
    });

    ctx.events.on('orchestrator:stopped', (data) => {
      const id = data.workerId || 'default';
      recordRunStop(id, data);
      const state = instances.get(id);
      if (state) {
        state.running = false;
        state.pid = null;
      }
      directProcesses.delete(id);
    });
  }

  // ── Resolve missions directory ──────────────────────────
  const projectDir = ctx.projectDir || resolve(import.meta.dirname || '.', '..', '..');
  const missionsDir = ctx.missionsDir || join(projectDir, 'orchestrator', 'missions');

  // ── Helper: Start orchestrator (direct fork, no pool) ───

  function directForkOrchestrator(instanceId, { mission, dryRun, model }) {
    const orchPath = join(projectDir, 'orchestrator', 'orchestrator.mjs');
    const args = [];

    if (mission) {
      const missionPath = mission.includes('/')
        ? mission
        : join('orchestrator', 'missions', mission);
      args.push(missionPath);
    }
    if (dryRun) args.push('--dry-run');
    if (model) args.push('--model', model);

    // Emit started event (updates instance state via listener)
    ctx.events.emit('orchestrator:started', {
      workerId: instanceId,
      mission: mission || null,
      model: model || null,
      dryRun: dryRun || false,
    });

    if (existsSync(orchPath)) {
      try {
        const child = fork(orchPath, args, {
          cwd: projectDir,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          detached: false,
        });

        directProcesses.set(instanceId, child);
        const state = instances.get(instanceId);
        if (state) state.pid = child.pid;

        child.on('exit', (code) => {
          ctx.events.emit('orchestrator:stopped', { workerId: instanceId, code });
        });

        child.on('error', (err) => {
          ctx.events.emit('orchestrator:stopped', { workerId: instanceId, error: err.message });
        });

        if (child.stdout) {
          child.stdout.on('data', (data) => {
            ctx.events.emit('orchestrator:log', {
              workerId: instanceId,
              stream: 'stdout',
              text: data.toString(),
            });
          });
        }
        if (child.stderr) {
          child.stderr.on('data', (data) => {
            ctx.events.emit('orchestrator:log', {
              workerId: instanceId,
              stream: 'stderr',
              text: data.toString(),
            });
          });
        }
      } catch (err) {
        ctx.events.emit('orchestrator:log', {
          workerId: instanceId,
          stream: 'stderr',
          text: `Fork failed: ${err.message}`,
        });
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // Multi-Instance Endpoints
  // ══════════════════════════════════════════════════════════

  // ── GET /api/orchestrator/instances ────────────────────
  router.get('/orchestrator/instances', (_req, res) => {
    const result = [...instances.values()].map(s => ({
      ...s,
      // Include pool worker status if available
      poolStatus: pool ? pool.getWorker(s.id) : null,
    }));
    res.json(result);
  });

  // ── POST /api/orchestrator/:id/start ──────────────────
  router.post('/orchestrator/:id/start', (req, res) => {
    const instanceId = req.params.id;
    const existing = instances.get(instanceId);
    if (existing?.running) {
      return res.status(409).json({ error: `Instance ${instanceId} is already running` });
    }

    const { mission, dryRun, model } = req.body || {};

    if (pool) {
      // Multi-instance mode: use process pool
      try {
        pool.spawn(instanceId, { mission, dryRun, model });
        pool.sendTo(instanceId, {
          type: 'start',
          mission: mission || null,
          dryRun: dryRun || false,
          model: model || null,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    } else {
      // Direct fork mode (backward compat)
      directForkOrchestrator(instanceId, { mission, dryRun, model });
    }

    res.status(202).json({
      message: `Instance ${instanceId} start requested`,
      status: getInstanceState(instanceId),
    });
  });

  // ── POST /api/orchestrator/:id/stop ───────────────────
  router.post('/orchestrator/:id/stop', (req, res) => {
    const instanceId = req.params.id;
    const state = instances.get(instanceId);
    if (!state?.running) {
      return res.status(409).json({ error: `Instance ${instanceId} is not running` });
    }

    if (pool) {
      pool.kill(instanceId);
    } else {
      // Direct process kill
      const proc = directProcesses.get(instanceId);
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
      }
    }

    ctx.events.emit('orchestrator:stopped', { workerId: instanceId });

    res.json({
      message: `Instance ${instanceId} stop requested`,
      status: state,
    });
  });

  // ── DELETE /api/orchestrator/:id ──────────────────────
  router.delete('/orchestrator/:id', (req, res) => {
    const instanceId = req.params.id;
    const state = instances.get(instanceId);
    if (!state) {
      return res.status(404).json({ error: `Instance ${instanceId} not found` });
    }
    if (state.running) {
      return res.status(409).json({ error: `Instance ${instanceId} is still running` });
    }

    instances.delete(instanceId);
    instanceAgentMaps.delete(instanceId);
    currentRunIds.delete(instanceId);

    if (pool) {
      try { pool.remove(instanceId); } catch { /* not in pool */ }
    }

    res.json({ message: `Instance ${instanceId} removed` });
  });

  // ══════════════════════════════════════════════════════════
  // Legacy Single-Instance Endpoints (backward compatible)
  // ══════════════════════════════════════════════════════════

  // ── GET /api/orchestrator/status ────────────────────────
  // Returns the 'default' instance status, or first running instance
  router.get('/orchestrator/status', (_req, res) => {
    const state = instances.get('default') || getFirstRunningOrDefault();
    res.json(state);
  });

  function getFirstRunningOrDefault() {
    for (const s of instances.values()) {
      if (s.running) return s;
    }
    return getInstanceState('default');
  }

  // ── POST /api/orchestrator/start ────────────────────────
  // Starts the 'default' instance (backward compatible)
  router.post('/orchestrator/start', (req, res) => {
    const state = getInstanceState('default');
    if (state.running) {
      return res.status(409).json({ error: 'Orchestrator is already running' });
    }

    const { mission, dryRun, model } = req.body || {};

    if (pool) {
      try {
        pool.spawn('default', { mission, dryRun, model });
        pool.sendTo('default', {
          type: 'start',
          mission: mission || null,
          dryRun: dryRun || false,
          model: model || null,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    } else {
      directForkOrchestrator('default', { mission, dryRun, model });
    }

    res.status(202).json({
      message: 'Orchestrator start requested',
      status: state,
    });
  });

  // ── POST /api/orchestrator/stop ─────────────────────────
  router.post('/orchestrator/stop', (_req, res) => {
    const state = instances.get('default');
    if (!state?.running) {
      return res.status(409).json({ error: 'Orchestrator is not running' });
    }

    if (pool) {
      pool.kill('default');
    } else {
      const proc = directProcesses.get('default');
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
      }
    }

    ctx.events.emit('orchestrator:stopped', { workerId: 'default' });

    res.json({
      message: 'Orchestrator stop requested',
      status: state,
    });
  });

  // ══════════════════════════════════════════════════════════
  // Shared Endpoints (missions, reports, history)
  // ══════════════════════════════════════════════════════════

  // ── GET /api/orchestrator/missions ──────────────────────
  router.get('/orchestrator/missions', (_req, res) => {
    try {
      const files = readdirSync(missionsDir)
        .filter(f => f.endsWith('.json') && !f.startsWith('.'));

      const missions = files.map(f => {
        try {
          const raw = readFileSync(join(missionsDir, f), 'utf-8');
          const data = JSON.parse(raw);
          return {
            file: f,
            name: data.name || f.replace('.json', ''),
            description: data.description || '',
            type: data.type || 'standard',
            agentCount: data.agents?.length || (data.missions?.length || 0),
          };
        } catch (_) {
          return { file: f, name: f.replace('.json', ''), description: 'Parse error', type: 'unknown', agentCount: 0 };
        }
      });

      res.json(missions);
    } catch (err) {
      res.json([]);
    }
  });

  // ── GET /api/orchestrator/reports ──────────────────────────
  router.get('/orchestrator/reports', (_req, res) => {
    try {
      const orchDir = join(projectDir, 'orchestrator');
      if (!existsSync(orchDir)) return res.json([]);

      const files = readdirSync(orchDir)
        .filter(f => f.endsWith('.md') && f.includes('report'));

      const reports = files.map(f => {
        const fullPath = join(orchDir, f);
        const stat = statSync(fullPath);
        return {
          file: f,
          name: f.replace('.md', '').replace(/-/g, ' '),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      }).sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

      res.json(reports);
    } catch (err) {
      res.json([]);
    }
  });

  // ── GET /api/orchestrator/reports/:file ───────────────────
  router.get('/orchestrator/reports/:file', (req, res) => {
    const file = req.params.file.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!file.endsWith('.md')) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    const fullPath = join(projectDir, 'orchestrator', file);
    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    try {
      const content = readFileSync(fullPath, 'utf-8');
      res.json({ file, content });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/orchestrator/history ─────────────────────────
  router.get('/orchestrator/history', (_req, res) => {
    const limit = Math.max(1, Math.min(50, parseInt(_req.query.limit, 10) || 20));
    const history = loadHistory().slice(0, limit);
    res.json(history);
  });

  // ── Exposed Getters ─────────────────────────────────────

  // Legacy getter: returns default instance status
  router.getStatus = () => instances.get('default') || getInstanceState('default');

  // Multi-instance getter: returns all instances
  router.getInstances = () => [...instances.values()];

  router.getHistory = loadHistory;

  return router;
}
