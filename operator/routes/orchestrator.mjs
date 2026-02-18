// ============================================================
// Orchestrator Routes (M4 + M6a)
// ============================================================
// Endpoints for orchestrator status, control, and mission
// management. M6a adds real child_process spawning and mission
// listing.
// ============================================================

import { Router } from 'express';
import { fork } from 'child_process';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Create orchestrator routes.
 * @param {object} ctx
 * @param {EventBus} ctx.events
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
    dryRun: false,
    pid: null,
  };

  // Track the child process
  let orchProcess = null;

  // Wire up events to track orchestrator state
  if (ctx.events) {
    ctx.events.on('orchestrator:started', (data) => {
      orchestratorStatus = {
        running: true,
        startedAt: data.timestamp || new Date().toISOString(),
        round: 0,
        agents: [],
        mission: data.mission || null,
        dryRun: data.dryRun || false,
        pid: data.pid || null,
      };
    });

    ctx.events.on('round:start', (data) => {
      orchestratorStatus.round = data.round || orchestratorStatus.round + 1;
    });

    ctx.events.on('agent:start', (data) => {
      if (data.agentId && !orchestratorStatus.agents.includes(data.agentId)) {
        orchestratorStatus.agents.push(data.agentId);
      }
    });

    ctx.events.on('orchestrator:stopped', () => {
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

    const { mission, dryRun } = req.body || {};

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

    // Emit started event first (updates status)
    ctx.events.emit('orchestrator:started', {
      mission: mission || null,
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

  // Expose router + status getter for M5 views
  router.getStatus = () => orchestratorStatus;
  return router;
}
