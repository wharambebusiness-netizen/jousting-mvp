// ============================================================
// Orchestrator Routes (M4 + M6a)
// ============================================================
// Endpoints for orchestrator status, control, and mission
// management. M6a adds real child_process spawning and mission
// listing.
// ============================================================

import { Router } from 'express';
import { fork } from 'child_process';
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { randomUUID } from 'crypto';

/**
 * Create orchestrator routes.
 * @param {object} ctx
 * @param {EventBus} ctx.events
 * @param {string}   [ctx.operatorDir] - Path to operator/ directory (for history persistence)
 * @param {object}   [ctx.orchestratorCtx] - Live orchestrator context (if running)
 */
export function createOrchestratorRoutes(ctx) {
  const router = Router();

  // Mutable state for orchestrator tracking
  let orchestratorStatus = {
    running: false,
    startedAt: null,
    round: 0,
    agents: [],
    mission: null,
    model: null,
    dryRun: false,
    pid: null,
  };

  // Per-agent tracking (keyed by agentId)
  const agentMap = new Map();

  // Track the child process
  let orchProcess = null;

  // ── Run History Persistence ──────────────────────────────
  const MAX_HISTORY = 50;
  const operatorDir = ctx.operatorDir || null;
  const historyPath = operatorDir ? join(operatorDir, 'orch-history.json') : null;
  let currentRunId = null;

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

  function recordRunStart(data) {
    const run = {
      id: randomUUID(),
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
    currentRunId = run.id;
    const history = loadHistory();
    history.unshift(run);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    saveHistory(history);
    return run;
  }

  function recordRunStop(data) {
    if (!currentRunId) return;
    const history = loadHistory();
    const run = history.find(r => r.id === currentRunId);
    if (run) {
      run.stoppedAt = new Date().toISOString();
      run.durationMs = new Date(run.stoppedAt) - new Date(run.startedAt);
      run.outcome = data?.error ? 'error' : (data?.code != null && data.code !== 0) ? 'error' : 'stopped';
      run.rounds = orchestratorStatus.round || 0;
      run.agents = agentMap.size;
      saveHistory(history);
    }
    currentRunId = null;
  }

  // Wire up events to track orchestrator state
  if (ctx.events) {
    ctx.events.on('orchestrator:started', (data) => {
      agentMap.clear();
      orchestratorStatus = {
        running: true,
        startedAt: data.timestamp || new Date().toISOString(),
        round: 0,
        agents: [],
        mission: data.mission || null,
        model: data.model || null,
        dryRun: data.dryRun || false,
        pid: data.pid || null,
      };
      recordRunStart(data);
    });

    ctx.events.on('round:start', (data) => {
      orchestratorStatus.round = data.round || orchestratorStatus.round + 1;
    });

    ctx.events.on('agent:start', (data) => {
      if (!data.agentId) return;
      const agent = {
        id: data.agentId,
        status: 'running',
        model: data.model || 'default',
        round: data.round || orchestratorStatus.round,
        startedAt: new Date().toISOString(),
        elapsedMs: null,
        cost: null,
        continuations: 0,
      };
      agentMap.set(data.agentId, agent);
      orchestratorStatus.agents = [...agentMap.values()];
    });

    ctx.events.on('agent:complete', (data) => {
      if (!data.agentId) return;
      const agent = agentMap.get(data.agentId);
      if (agent) {
        agent.status = 'complete';
        agent.elapsedMs = data.elapsedMs || null;
        if (data.continuations != null) agent.continuations = data.continuations;
        orchestratorStatus.agents = [...agentMap.values()];
      }
    });

    ctx.events.on('agent:error', (data) => {
      if (!data.agentId) return;
      const agent = agentMap.get(data.agentId);
      if (agent) {
        agent.status = 'failed';
        agent.statusDetail = data.status || 'ERROR';
        agent.elapsedMs = data.elapsedMs || null;
        if (data.continuations != null) agent.continuations = data.continuations;
        orchestratorStatus.agents = [...agentMap.values()];
      }
    });

    ctx.events.on('agent:continuation', (data) => {
      if (!data.agentId) return;
      const agent = agentMap.get(data.agentId);
      if (agent) {
        agent.continuations = data.index || (agent.continuations + 1);
        if (data.cost != null) agent.cost = data.cost;
        orchestratorStatus.agents = [...agentMap.values()];
      }
    });

    ctx.events.on('orchestrator:stopped', (data) => {
      recordRunStop(data);
      orchestratorStatus.running = false;
      orchestratorStatus.pid = null;
      orchProcess = null;
    });
  }

  // ── Resolve missions directory ──────────────────────────
  // projectDir can be overridden for tests
  const projectDir = ctx.projectDir || resolve(import.meta.dirname || '.', '..', '..');
  const missionsDir = ctx.missionsDir || join(projectDir, 'orchestrator', 'missions');

  // ── GET /api/orchestrator/status ────────────────────────
  router.get('/orchestrator/status', (_req, res) => {
    res.json(orchestratorStatus);
  });

  // ── GET /api/orchestrator/missions ──────────────────────
  // List available mission configs from orchestrator/missions/
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
      // missions dir may not exist in test environments
      res.json([]);
    }
  });

  // ── POST /api/orchestrator/start ────────────────────────
  // Start an orchestrator run by forking the orchestrator process.
  // Body: { mission?: string, dryRun?: boolean }
  router.post('/orchestrator/start', (req, res) => {
    if (orchestratorStatus.running) {
      return res.status(409).json({ error: 'Orchestrator is already running' });
    }

    const { mission, dryRun, model } = req.body || {};

    // Build args for the orchestrator process
    const orchPath = join(projectDir, 'orchestrator', 'orchestrator.mjs');
    const args = [];

    if (mission) {
      // mission can be filename (e.g. "general-dev.json") or relative path
      const missionPath = mission.includes('/')
        ? mission
        : join('orchestrator', 'missions', mission);
      args.push(missionPath);
    }

    if (dryRun) {
      args.push('--dry-run');
    }

    if (model) {
      args.push('--model', model);
    }

    // Emit started event first (updates status)
    ctx.events.emit('orchestrator:started', {
      mission: mission || null,
      model: model || null,
      dryRun: dryRun || false,
    });

    // Fork orchestrator if it exists (won't exist in test environments)
    if (existsSync(orchPath)) {
      try {
        const child = fork(orchPath, args, {
          cwd: projectDir,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          detached: false,
        });

        orchProcess = child;
        orchestratorStatus.pid = child.pid;

        // Handle child exit
        child.on('exit', (code) => {
          ctx.events.emit('orchestrator:stopped', { code });
          orchProcess = null;
        });

        child.on('error', (err) => {
          ctx.events.emit('orchestrator:stopped', { error: err.message });
          orchProcess = null;
        });

        // Forward stdout/stderr as events for logging
        if (child.stdout) {
          child.stdout.on('data', (data) => {
            ctx.events.emit('orchestrator:log', { stream: 'stdout', text: data.toString() });
          });
        }
        if (child.stderr) {
          child.stderr.on('data', (data) => {
            ctx.events.emit('orchestrator:log', { stream: 'stderr', text: data.toString() });
          });
        }
      } catch (err) {
        // If fork fails, still return success since events were emitted
        ctx.events.emit('orchestrator:log', {
          stream: 'stderr', text: `Fork failed: ${err.message}`,
        });
      }
    }

    res.status(202).json({
      message: 'Orchestrator start requested',
      status: orchestratorStatus,
    });
  });

  // ── POST /api/orchestrator/stop ─────────────────────────
  // Graceful stop of orchestrator.
  router.post('/orchestrator/stop', (_req, res) => {
    if (!orchestratorStatus.running) {
      return res.status(409).json({ error: 'Orchestrator is not running' });
    }

    // Kill the child process if we have one
    if (orchProcess && !orchProcess.killed) {
      orchProcess.kill('SIGTERM');
    }

    // Emit event — the event listener handles state update
    ctx.events.emit('orchestrator:stopped', {});

    res.json({
      message: 'Orchestrator stop requested',
      status: orchestratorStatus,
    });
  });

  // ── GET /api/orchestrator/reports ──────────────────────────
  // List available report files from orchestrator/
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
  // Return raw markdown content of a report file
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
  // List past orchestrator runs from persisted history.
  router.get('/orchestrator/history', (_req, res) => {
    const limit = Math.max(1, Math.min(50, parseInt(_req.query.limit, 10) || 20));
    const history = loadHistory().slice(0, limit);
    res.json(history);
  });

  // Expose router + status/history getters for M5 views
  router.getStatus = () => orchestratorStatus;
  router.getHistory = loadHistory;
  return router;
}
