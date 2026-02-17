// ============================================================
// Orchestrator Routes (M4)
// ============================================================
// Endpoints for orchestrator status and control. In M4 these
// provide read-only status and placeholder start/stop. Full
// orchestrator management comes in M6.
// ============================================================

import { Router } from 'express';

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
  };

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
    });
  }

  // ── GET /api/orchestrator/status ────────────────────────
  router.get('/orchestrator/status', (_req, res) => {
    res.json(orchestratorStatus);
  });

  // ── POST /api/orchestrator/start ────────────────────────
  // Start an orchestrator run. Requires combined mode.
  // Body: { mission?, dryRun? }
  router.post('/orchestrator/start', (req, res) => {
    if (orchestratorStatus.running) {
      return res.status(409).json({ error: 'Orchestrator is already running' });
    }

    // Placeholder: in M6, this will actually spawn the orchestrator
    const { mission, dryRun } = req.body || {};

    orchestratorStatus = {
      running: true,
      startedAt: new Date().toISOString(),
      round: 0,
      agents: [],
      mission: mission || null,
      dryRun: dryRun || false,
    };

    ctx.events.emit('orchestrator:started', {
      mission,
      dryRun,
    });

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

    orchestratorStatus.running = false;

    ctx.events.emit('orchestrator:stopped', {});

    res.json({
      message: 'Orchestrator stop requested',
      status: orchestratorStatus,
    });
  });

  return router;
}
