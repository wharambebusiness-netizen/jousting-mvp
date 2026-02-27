// ============================================================
// Claude Terminal Routes (Phase 15C)
// ============================================================
// REST API for managing interactive Claude Code terminal sessions.
// CRUD operations + resize + permission toggle.
//
// Endpoints:
//   GET    /claude-terminals              List all terminals
//   GET    /claude-terminals/:id          Get terminal status
//   POST   /claude-terminals              Spawn a new terminal
//   PATCH  /claude-terminals/:id          Update terminal properties (autoHandoff, autoDispatch, autoComplete, capabilities, systemPrompt)
//   POST   /claude-terminals/:id/input    Write input to terminal PTY
//   POST   /claude-terminals/:id/resize   Resize terminal
//   POST   /claude-terminals/:id/toggle-permissions  Toggle --dangerously-skip-permissions
//   POST   /claude-terminals/:id/toggle-auto-handoff Toggle auto-handoff (Phase 15E)
//   POST   /claude-terminals/:id/toggle-auto-dispatch Toggle auto-dispatch (Phase 20)
//   POST   /claude-terminals/:id/toggle-auto-complete Toggle auto-complete (Phase 22)
//   DELETE /claude-terminals/:id          Kill + remove terminal
//   POST   /claude-terminals/:id/respawn  Kill + respawn with new config
//
// ============================================================

import { Router } from 'express';
import { isNodePtyAvailable } from '../claude-terminal.mjs';
import { validateBody } from '../validation.mjs';

/**
 * Create Claude terminal API routes.
 * @param {object} ctx
 * @param {object} ctx.claudePool - Claude terminal pool instance
 * @param {EventBus} ctx.events - EventBus for real-time events
 * @returns {Router}
 */
export function createClaudeTerminalRoutes(ctx) {
  const { claudePool, events } = ctx;
  const router = Router();

  // ── GET /claude-terminals ─────────────────────────────

  router.get('/claude-terminals', (_req, res) => {
    if (!claudePool) {
      return res.json({ terminals: [], available: false });
    }
    res.json({
      terminals: claudePool.getStatus(),
      available: true,
    });
  });

  // ── GET /claude-terminals/pool-status ────────────────

  router.get('/claude-terminals/pool-status', (_req, res) => {
    if (!claudePool) {
      return res.json({ available: false });
    }
    res.json({ available: true, ...claudePool.getPoolStatus() });
  });

  // ── GET /claude-terminals/available ───────────────────

  router.get('/claude-terminals/available', async (_req, res) => {
    const available = await isNodePtyAvailable();
    res.json({ available, hasPool: !!claudePool });
  });

  // ── GET /claude-terminals/master (Phase 57) ────────
  // Must be before /:id to avoid "master" being interpreted as a terminal ID

  router.get('/claude-terminals/master', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude pool not active' });
    const master = claudePool.getMasterTerminal();
    if (!master) return res.status(404).json({ error: 'No master terminal' });
    res.json(master);
  });

  // ── GET /claude-terminals/:id ─────────────────────────

  router.get('/claude-terminals/:id', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    res.json(terminal);
  });

  // ── GET /claude-terminals/:id/output (Phase 57) ───────

  router.get('/claude-terminals/:id/output', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude pool not active' });
    const lines = parseInt(req.query.lines) || 20;
    const raw = req.query.raw === '1';
    const preview = raw
      ? claudePool.getRawOutputPreview(req.params.id, Math.min(lines, 500))
      : claudePool.getOutputPreview(req.params.id, Math.min(lines, 500));
    if (preview === null) return res.status(404).json({ error: 'Terminal not found' });
    res.json({ id: req.params.id, lines: preview });
  });

  // ── POST /claude-terminals ────────────────────────────

  router.post('/claude-terminals', validateBody({
    id: { type: 'string', required: true, pattern: /^[a-zA-Z0-9_-]+$/ },
    model: { type: 'string' },
    cols: { type: 'number', min: 1 },
    rows: { type: 'number', min: 1 },
  }), async (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const {
      id,
      projectDir,
      model,
      dangerouslySkipPermissions,
      autoHandoff,
      autoDispatch,
      autoComplete,
      capabilities,
      systemPrompt,
      resumeSessionId,
      continueSession,
      cols,
      rows,
      role,
      persistent,
    } = req.body;

    try {
      const result = await claudePool.spawn(id, {
        projectDir,
        model,
        dangerouslySkipPermissions: !!dangerouslySkipPermissions,
        autoHandoff: !!autoHandoff,
        autoDispatch: !!autoDispatch,
        autoComplete: autoComplete !== undefined ? !!autoComplete : undefined,
        capabilities: Array.isArray(capabilities) ? capabilities : undefined,
        systemPrompt,
        resumeSessionId,
        continueSession: !!continueSession,
        cols: cols ? parseInt(cols, 10) : undefined,
        rows: rows ? parseInt(rows, 10) : undefined,
        role: role || null,
        persistent: !!persistent,
      });

      res.status(201).json(result);
    } catch (err) {
      const status = /node-pty is not available/i.test(err.message) ? 503 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  // ── PATCH /claude-terminals/:id ───────────────────────────
  // Update multiple terminal properties in a single request.
  // Accepted fields: autoHandoff, autoDispatch, autoComplete, capabilities, systemPrompt

  router.patch('/claude-terminals/:id', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const { autoHandoff, autoDispatch, autoComplete, capabilities, systemPrompt } = req.body || {};
    const updated = {};

    if (autoHandoff !== undefined) {
      claudePool.setAutoHandoff(req.params.id, !!autoHandoff);
      updated.autoHandoff = !!autoHandoff;
      events.emit('claude-terminal:auto-handoff-changed', {
        terminalId: req.params.id,
        autoHandoff: !!autoHandoff,
      });
    }

    if (autoDispatch !== undefined) {
      claudePool.setAutoDispatch(req.params.id, !!autoDispatch);
      updated.autoDispatch = !!autoDispatch;
      events.emit('claude-terminal:auto-dispatch-changed', {
        terminalId: req.params.id,
        autoDispatch: !!autoDispatch,
      });
    }

    if (autoComplete !== undefined) {
      claudePool.setAutoComplete(req.params.id, !!autoComplete);
      updated.autoComplete = !!autoComplete;
      events.emit('claude-terminal:auto-complete-changed', {
        terminalId: req.params.id,
        autoComplete: !!autoComplete,
      });
    }

    if (capabilities !== undefined) {
      if (capabilities !== null && !Array.isArray(capabilities)) {
        return res.status(400).json({ error: 'capabilities must be an array of strings or null' });
      }
      claudePool.setCapabilities(req.params.id, capabilities);
      updated.capabilities = capabilities || null;
      events.emit('claude-terminal:capabilities-changed', {
        terminalId: req.params.id,
        capabilities: capabilities || null,
      });
    }

    if (systemPrompt !== undefined) {
      claudePool.setSystemPrompt(req.params.id, systemPrompt);
      updated.systemPrompt = systemPrompt;
    }

    res.json({ ok: true, terminalId: req.params.id, updated });
  });

  // ── POST /claude-terminals/:id/input ──────────────────

  router.post('/claude-terminals/:id/input', validateBody({
    data: { type: 'string', required: true },
  }), (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const { data } = req.body;
    const ok = claudePool.write(req.params.id, data);
    if (!ok) return res.status(404).json({ error: 'Terminal not found or not running' });

    res.json({ ok: true });
  });

  // ── POST /claude-terminals/:id/resize ─────────────────

  router.post('/claude-terminals/:id/resize', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const { cols, rows } = req.body;
    if (!cols || !rows || cols < 1 || rows < 1) {
      return res.status(400).json({ error: 'cols and rows must be positive integers' });
    }

    const ok = claudePool.resize(req.params.id, parseInt(cols, 10), parseInt(rows, 10));
    if (!ok) return res.status(404).json({ error: 'Terminal not found or not running' });

    res.json({ ok: true });
  });

  // ── POST /claude-terminals/:id/toggle-permissions ─────

  router.post('/claude-terminals/:id/toggle-permissions', async (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const newSkip = !terminal.dangerouslySkipPermissions;

    try {
      const result = await claudePool.respawn(req.params.id, {
        dangerouslySkipPermissions: newSkip,
      });

      events.emit('claude-terminal:permission-changed', {
        terminalId: req.params.id,
        dangerouslySkipPermissions: newSkip,
      });

      res.json({ ...result, dangerouslySkipPermissions: newSkip });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /claude-terminals/:id/toggle-auto-handoff ───

  router.post('/claude-terminals/:id/toggle-auto-handoff', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const newState = !terminal.autoHandoff;
    const ok = claudePool.setAutoHandoff(req.params.id, newState);
    if (!ok) return res.status(404).json({ error: 'Terminal not found' });

    events.emit('claude-terminal:auto-handoff-changed', {
      terminalId: req.params.id,
      autoHandoff: newState,
    });

    res.json({ ok: true, terminalId: req.params.id, autoHandoff: newState });
  });

  // ── POST /claude-terminals/:id/toggle-auto-dispatch ──

  router.post('/claude-terminals/:id/toggle-auto-dispatch', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const newState = !terminal.autoDispatch;
    const ok = claudePool.setAutoDispatch(req.params.id, newState);
    if (!ok) return res.status(404).json({ error: 'Terminal not found' });

    events.emit('claude-terminal:auto-dispatch-changed', {
      terminalId: req.params.id,
      autoDispatch: newState,
    });

    res.json({ ok: true, terminalId: req.params.id, autoDispatch: newState });
  });

  // ── POST /claude-terminals/:id/toggle-auto-complete ──

  router.post('/claude-terminals/:id/toggle-auto-complete', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const newState = !terminal.autoComplete;
    const ok = claudePool.setAutoComplete(req.params.id, newState);
    if (!ok) return res.status(404).json({ error: 'Terminal not found' });

    events.emit('claude-terminal:auto-complete-changed', {
      terminalId: req.params.id,
      autoComplete: newState,
    });

    res.json({ ok: true, terminalId: req.params.id, autoComplete: newState });
  });

  // ── POST /claude-terminals/:id/capabilities ──────────
  // Phase 26: Set task category capabilities for routing

  router.post('/claude-terminals/:id/capabilities', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const { capabilities } = req.body;
    if (capabilities !== null && !Array.isArray(capabilities)) {
      return res.status(400).json({ error: 'capabilities must be an array of strings or null' });
    }

    const ok = claudePool.setCapabilities(req.params.id, capabilities);
    if (!ok) return res.status(404).json({ error: 'Terminal not found' });

    events.emit('claude-terminal:capabilities-changed', {
      terminalId: req.params.id,
      capabilities: capabilities || null,
    });

    res.json({ ok: true, terminalId: req.params.id, capabilities: capabilities || null });
  });

  // ── POST /claude-terminals/:id/respawn ────────────────

  router.post('/claude-terminals/:id/respawn', async (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    try {
      const result = await claudePool.respawn(req.params.id, req.body);

      events.emit('claude-terminal:respawned', {
        terminalId: req.params.id,
        config: req.body,
      });

      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── POST /claude-terminals/:id/claim-task ───────────
  // Phase 19: Claim the next pending task from the coordinator

  router.post('/claude-terminals/:id/claim-task', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    // Check if already has a task
    const current = claudePool.getAssignedTask(req.params.id);
    if (current) {
      return res.status(409).json({ error: 'Terminal already has an assigned task', task: current });
    }

    // Need coordinator for task queue access
    const coordinator = ctx.coordinator;
    if (!coordinator) {
      return res.status(503).json({ error: 'Coordinator not available — start with --pool flag' });
    }

    const taskQueue = coordinator.taskQueue;
    if (!taskQueue) {
      return res.status(503).json({ error: 'Task queue not available' });
    }

    // Use shared utility (priority-sorted, dep-aware, affinity-scored)
    const claimable = claudePool.findNextClaimableTask(req.params.id);
    if (!claimable) {
      return res.json({ claimed: false, message: 'No pending tasks available' });
    }

    try {
      // Assign in task queue
      taskQueue.assign(claimable.id, req.params.id);
      taskQueue.start(claimable.id);

      // Track in pool
      claudePool.assignTask(req.params.id, claimable);

      res.json({ claimed: true, task: claimable });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── POST /claude-terminals/:id/release-task ─────────
  // Phase 19: Release assigned task without completing

  router.post('/claude-terminals/:id/release-task', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const current = claudePool.getAssignedTask(req.params.id);
    if (!current) {
      return res.status(404).json({ error: 'Terminal has no assigned task' });
    }

    // Release from pool
    const released = claudePool.releaseTask(req.params.id);

    // Try to reset task status back to pending in the queue
    const coordinator = ctx.coordinator;
    if (coordinator) {
      try {
        const tq = coordinator.taskQueue;
        if (tq) {
          // Fail then retry puts it back to pending
          tq.fail(released.taskId, 'Released by terminal');
          tq.retry(released.taskId);
        }
      } catch { /* task may already be in a terminal state */ }
    }

    res.json({ released: true, taskId: released.taskId });
  });

  // ── POST /claude-terminals/:id/complete-task ────────
  // Phase 19: Mark assigned task as complete or failed

  router.post('/claude-terminals/:id/complete-task', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const current = claudePool.getAssignedTask(req.params.id);
    if (!current) {
      return res.status(404).json({ error: 'Terminal has no assigned task' });
    }

    const { status, result, error } = req.body || {};

    if (status !== 'complete' && status !== 'failed') {
      return res.status(400).json({ error: 'status must be "complete" or "failed"' });
    }

    const coordinator = ctx.coordinator;
    if (coordinator) {
      try {
        const tq = coordinator.taskQueue;
        if (tq) {
          if (status === 'complete') {
            tq.complete(current.taskId, result || null);
          } else {
            tq.fail(current.taskId, error || 'Failed by terminal');
          }
        }
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // Clear from pool
    claudePool.releaseTask(req.params.id);

    events.emit('claude-terminal:task-completed', {
      terminalId: req.params.id,
      taskId: current.taskId,
      category: current.category || null,
      status,
    });

    res.json({ completed: true, taskId: current.taskId, status });
  });

  // ── GET /claude-terminals/:id/task ──────────────────
  // Phase 19: Get currently assigned task

  router.get('/claude-terminals/:id/task', (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    const task = claudePool.getAssignedTask(req.params.id);
    res.json({ terminalId: req.params.id, task: task || null });
  });

  // ── Swarm Mode (Phase 24) ───────────────────────────

  // GET /claude-terminals/swarm/status
  router.get('/claude-terminals/swarm/status', (_req, res) => {
    if (!claudePool) {
      return res.json({ available: false, enabled: false });
    }
    const coordinator = ctx.coordinator;
    const swarm = claudePool.getSwarmState();
    res.json({
      available: !!coordinator,
      ...swarm,
      poolStatus: claudePool.getPoolStatus(),
    });
  });

  // POST /claude-terminals/swarm/start
  router.post('/claude-terminals/swarm/start', async (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const coordinator = ctx.coordinator;
    if (!coordinator) {
      return res.status(503).json({ error: 'Coordinator not available — start with --swarm or --pool flag' });
    }

    const {
      minTerminals = 2,
      maxTerminals = 8,
      projectDir: swarmProjectDir,
      model = 'sonnet',
      systemPrompt,
      scaleUpThreshold = 2,
      dangerouslySkipPermissions = true,
    } = req.body || {};

    // Enable swarm mode on the pool
    claudePool.setSwarmMode({
      enabled: true,
      minTerminals: Math.max(1, Math.min(8, parseInt(minTerminals) || 2)),
      maxTerminals: Math.max(1, Math.min(32, parseInt(maxTerminals) || 8)),
      projectDir: swarmProjectDir || undefined,
      model,
      systemPrompt: systemPrompt || null,
      scaleUpThreshold: Math.max(1, Math.min(10, parseInt(scaleUpThreshold) || 2)),
      dangerouslySkipPermissions: !!dangerouslySkipPermissions,
    });

    // Start coordinator if in init state
    if (coordinator.getState() === 'init') {
      coordinator.start();
    }

    // Seed minTerminals immediately
    const min = Math.max(1, Math.min(8, parseInt(minTerminals) || 2));
    let seeded = 0;
    for (let i = 0; i < min; i++) {
      const swarmId = 'swarm-seed-' + i;
      try {
        await claudePool.spawn(swarmId, {
          projectDir: swarmProjectDir || undefined,
          model,
          dangerouslySkipPermissions: !!dangerouslySkipPermissions,
          systemPrompt: systemPrompt || undefined,
          autoHandoff: true,
          autoDispatch: true,
          autoComplete: true,
          _swarmManaged: true,
        });
        seeded++;
      } catch (err) {
        // May fail if max reached or node-pty unavailable
        break;
      }
    }

    res.json({
      ok: true,
      swarm: claudePool.getSwarmState(),
      seeded,
    });
  });

  // GET /claude-terminals/swarm/metrics
  router.get('/claude-terminals/swarm/metrics', (_req, res) => {
    if (!claudePool) {
      return res.json({ available: false });
    }
    res.json({ available: true, ...claudePool.getSwarmMetrics() });
  });

  // POST /claude-terminals/swarm/stop
  router.post('/claude-terminals/swarm/stop', (_req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    claudePool.setSwarmMode({ enabled: false });

    res.json({
      ok: true,
      swarm: claudePool.getSwarmState(),
    });
  });

  // ── DELETE /claude-terminals/:id ──────────────────────

  router.delete('/claude-terminals/:id', async (req, res) => {
    if (!claudePool) return res.status(503).json({ error: 'Claude terminals not available' });

    const terminal = claudePool.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });

    // Kill if running and wait for exit
    if (terminal.status === 'running') {
      claudePool.kill(req.params.id);
      // Wait for status to change (up to 3s)
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        const check = setInterval(() => {
          const t = claudePool.getTerminal(req.params.id);
          if (!t || t.status !== 'running') {
            clearInterval(check);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });
    }

    // Remove from pool
    try {
      claudePool.remove(req.params.id);
    } catch { /* may have already been removed */ }

    res.json({ ok: true, terminalId: req.params.id });
  });

  return router;
}
