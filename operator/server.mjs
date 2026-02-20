#!/usr/bin/env node
// ============================================================
// Operator HTTP Server (M4 + M5)
// ============================================================
// Express + WebSocket server exposing operator and orchestrator
// state via REST API, real-time events, and a web UI dashboard.
// Binds to 127.0.0.1 only (localhost single-user tool).
//
// Usage:
//   node operator/server.mjs                    # Server (port 3100)
//   node operator/server.mjs --port 8080        # Custom port
//   node operator/server.mjs --operator         # Combined mode (API + operator)
//
// ============================================================

import express from 'express';
import http from 'http';
import { resolve, join } from 'path';
import { readFileSync } from 'fs';
import { parseArgs } from 'util';

import { createRegistry } from './registry.mjs';
import { createChainRoutes } from './routes/chains.mjs';
import { createOrchestratorRoutes } from './routes/orchestrator.mjs';
import { createGitRoutes } from './routes/git.mjs';
import { createCoordinationRoutes } from './routes/coordination.mjs';
import { createViewRoutes } from './routes/views.mjs';
import { createWebSocketHandler } from './ws.mjs';
import { createSettingsRoutes } from './routes/settings.mjs';
import { createFileRoutes } from './routes/files.mjs';
import { createSettings } from './settings.mjs';
import { createFileWatcher } from './file-watcher.mjs';
import { createProcessPool } from './process-pool.mjs';
import { createCoordinator } from './coordination/coordinator.mjs';
import { createClaudePool } from './claude-pool.mjs';
import { createClaudeTerminalRoutes } from './routes/claude-terminals.mjs';
import { EventBus } from '../shared/event-bus.mjs';

// ── Constants ───────────────────────────────────────────────

const DEFAULT_PORT = 3100;
const DEFAULT_HOST = '127.0.0.1';

// ── CORS Middleware ─────────────────────────────────────────

function corsMiddleware(req, res, next) {
  const origin = req.headers.origin || '';
  // Allow localhost on any port
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin) ||
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

// ── App Factory ─────────────────────────────────────────────

/**
 * Create the Express app and HTTP server.
 * @param {object} options
 * @param {string}   options.operatorDir  - Path to operator/ directory
 * @param {EventBus} [options.events]     - EventBus for real-time events
 * @param {object}   [options.runChainFn] - Function to start a chain (combined mode)
 * @param {object}   [options.pool] - Process pool for multi-orchestrator (or true to auto-create)
 * @param {object}   [options.orchestratorCtx] - Orchestrator context (combined mode)
 * @returns {{ app: Express, server: http.Server, events: EventBus, wss: WebSocketServer, pool: object }}
 */
export function createApp(options = {}) {
  const operatorDir = options.operatorDir || resolve(import.meta.dirname || '.', '.');
  const events = options.events || new EventBus();

  // Create registry and settings instances (factory pattern, multi-instance safe)
  const registry = options.registry || createRegistry({ operatorDir, log: () => {} });
  const settings = options.settings || createSettings({ operatorDir });

  const app = express();

  // Middleware
  app.use(express.json());
  app.use(corsMiddleware);

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Resolve paths ──────────────────────────────────────
  // moduleDir resolves from this module's location (not operatorDir,
  // which may be a test temp directory for registry isolation).
  const moduleDir = import.meta.dirname || operatorDir;
  const publicDir = options.publicDir || join(moduleDir, 'public');
  const projectDir = options.projectDir || resolve(moduleDir, '..');

  // API routes
  app.use('/api', createChainRoutes({
    operatorDir,
    events,
    registry,
    runChainFn: options.runChainFn || null,
  }));

  // Build allowed-roots callback from registry project directories
  function getAllowedRoots() {
    try {
      const regData = registry.load();
      const roots = new Set();
      for (const chain of regData.chains || []) {
        if (chain.projectDir) roots.add(resolve(chain.projectDir));
      }
      return roots;
    } catch { return new Set(); }
  }

  // Git routes
  app.use('/api', createGitRoutes({ projectDir, getAllowedRoots }));

  // Settings routes
  app.use('/api', createSettingsRoutes({ settings }));

  // File system routes
  app.use('/api', createFileRoutes({ getAllowedRoots }));

  // Process pool for multi-orchestrator mode
  let pool = null;
  if (options.pool === true) {
    pool = createProcessPool({ events, projectDir, log: () => {} });
  } else if (options.pool && typeof options.pool === 'object') {
    pool = options.pool;
  }

  // Coordinator for inter-orchestrator coordination (requires pool)
  let coordinator = null;
  if (pool && options.coordination !== false) {
    const coordOpts = typeof options.coordination === 'object' ? options.coordination : {};
    coordinator = createCoordinator({
      events,
      pool,
      options: coordOpts,
      log: () => {},
    });
  }

  const orchRouter = createOrchestratorRoutes({
    events,
    operatorDir,
    pool,
    coordinator,
    orchestratorCtx: options.orchestratorCtx || null,
  });
  app.use('/api', orchRouter);

  // Coordination routes (task queue, rate limiter, costs)
  app.use('/api', createCoordinationRoutes({ coordinator }));

  // Claude terminal pool (Phase 15)
  let claudePool = null;
  if (options.claudePool === true) {
    claudePool = createClaudePool({ events, projectDir, log: () => {} });
  } else if (options.claudePool && typeof options.claudePool === 'object') {
    claudePool = options.claudePool;
  }

  // Claude terminal routes
  app.use('/api', createClaudeTerminalRoutes({ claudePool, events }));

  // Resolve missions dir
  const missionsDir = join(projectDir, 'orchestrator', 'missions');

  // View fragment routes (HTMX partial responses)
  app.use('/views', createViewRoutes({
    operatorDir,
    events,
    registry,
    settings,
    getOrchStatus: orchRouter.getStatus || null,
    getOrchHistory: orchRouter.getHistory || null,
    getOrchInstances: orchRouter.getInstances || null,
    pool,
    coordinator,
    missionsDir,
    projectDir,
  }));

  // Page routes (serve HTML files)
  // Chain detail: inject chain ID into template
  app.get('/chains/:id', (req, res) => {
    try {
      const htmlPath = join(publicDir, 'chain.html');
      let html = readFileSync(htmlPath, 'utf-8');
      html = html.replace(/\{\{CHAIN_ID\}\}/g, req.params.id.replace(/[^a-f0-9-]/g, ''));
      res.type('text/html').send(html);
    } catch (err) {
      res.status(500).send('Error loading page');
    }
  });

  // Orchestrator page
  app.get('/orchestrator', (_req, res) => {
    res.sendFile(join(publicDir, 'orchestrator.html'));
  });

  // Settings page
  app.get('/settings', (_req, res) => {
    res.sendFile(join(publicDir, 'settings.html'));
  });

  // Projects page
  app.get('/projects', (_req, res) => {
    res.sendFile(join(publicDir, 'projects.html'));
  });

  // Analytics page
  app.get('/analytics', (_req, res) => {
    res.sendFile(join(publicDir, 'analytics.html'));
  });

  // Terminals page
  app.get('/terminals', (_req, res) => {
    res.sendFile(join(publicDir, 'terminals.html'));
  });

  // Task board page
  app.get('/taskboard', (_req, res) => {
    res.sendFile(join(publicDir, 'taskboard.html'));
  });

  // Static files (CSS, index.html for /)
  app.use(express.static(publicDir));

  // Create HTTP server (needed for WebSocket upgrade)
  const server = http.createServer(app);

  // WebSocket (JSON bridge + binary terminal WS)
  const wss = createWebSocketHandler({ server, events, claudePool });

  // File watcher for real-time project file updates
  const fileWatcher = options.enableFileWatcher !== false
    ? createFileWatcher(events) : null;

  // Watch existing project directories from registry
  if (fileWatcher) {
    try {
      const regData = registry.load();
      const seen = new Set();
      for (const chain of regData.chains || []) {
        if (chain.projectDir && !seen.has(chain.projectDir)) {
          seen.add(chain.projectDir);
          fileWatcher.watchProject(chain.projectDir);
        }
      }
    } catch { /* registry not ready yet */ }

    // Watch new projects as chains are created
    events.on('chain:started', (data) => {
      if (data?.projectDir) fileWatcher.watchProject(data.projectDir);
    });
  }

  // Graceful shutdown
  let shutdownCalled = false;
  function shutdown() {
    if (shutdownCalled) return;
    shutdownCalled = true;

    // Stop coordinator before pool shutdown
    if (coordinator && coordinator.getState() !== 'stopped') {
      coordinator.stop();
    }

    // Shut down process pool (graceful worker termination)
    if (pool) pool.shutdownAll().catch(() => {});

    // Shut down Claude terminal pool
    if (claudePool) claudePool.shutdownAll().catch(() => {});

    // Clean up file watchers
    if (fileWatcher) fileWatcher.unwatchAll();

    // Clean up EventBus listeners
    if (wss.cleanup) wss.cleanup();

    // Close WebSocket connections
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down');
    }

    // Close HTTP server
    server.close();
  }

  // Only register signal handlers when running as CLI (not in tests)
  if (options._registerSignalHandlers) {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Clean teardown for tests — closes server, WS, removes listeners.
   */
  function close() {
    return new Promise((resolve) => {
      // shutdown() handles WS cleanup + client close + server.close()
      shutdown();
      // Wait for server 'close' event or force after 2s
      server.on('close', resolve);
      setTimeout(resolve, 2000).unref();
    });
  }

  return { app, server, events, wss, pool, coordinator, claudePool, close };
}

// ── CLI Entry Point ─────────────────────────────────────────

function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port:     { type: 'string', default: String(DEFAULT_PORT) },
      host:     { type: 'string', default: DEFAULT_HOST },
      operator: { type: 'boolean', default: false },
      pool:     { type: 'boolean', default: false },
      help:     { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Operator HTTP Server (M4)

Usage:
  node operator/server.mjs [options]

Options:
  --port N        Port to listen on (default: ${DEFAULT_PORT})
  --host HOST     Host to bind to (default: ${DEFAULT_HOST})
  --operator      Combined mode: also run operator daemon
  --pool          Enable process pool + coordinator (task board, multi-orchestrator)
  -h, --help      Show this help
`);
    process.exit(0);
  }

  return {
    port: parseInt(values.port, 10),
    host: values.host,
    operator: values.operator,
    pool: values.pool,
  };
}

// Only run as CLI when executed directly
const isMain = process.argv[1] &&
  resolve(process.argv[1]).replace(/\\/g, '/').includes('operator/server');

if (isMain) {
  const args = parseCliArgs();
  const operatorDir = resolve(import.meta.dirname || '.', '.');

  const appOptions = { operatorDir, _registerSignalHandlers: true, claudePool: true };

  // Pool mode: enable process pool + coordinator for task board / multi-orchestrator
  if (args.pool) {
    appOptions.pool = true;
  }

  // Combined mode: wire up chain execution via operator's runChain
  if (args.operator) {
    const { runChain, MODEL_MAP } = await import('./operator.mjs');
    const { createRegistry: createReg } = await import('./registry.mjs');
    const reg = createReg({ operatorDir });
    appOptions.registry = reg;

    appOptions.runChainFn = async (chain) => {
      const regData = reg.load();
      const modelShort = chain.config?.model || 'sonnet';
      const config = {
        task: chain.task,
        model: MODEL_MAP[modelShort] || modelShort,
        modelShort,
        maxTurns: chain.config?.maxTurns || 30,
        maxContinuations: chain.config?.maxContinuations || 5,
        maxBudgetUsd: chain.config?.maxBudgetUsd || 5.0,
        projectDir: chain.projectDir || resolve(operatorDir, '..'),
        permissionMode: 'bypassPermissions',
        autoPush: false,
        notifyWebhook: '',
        dryRun: false,
      };
      return runChain(config, regData, chain, reg);
    };
  }

  const { server } = createApp(appOptions);

  server.listen(args.port, args.host, () => {
    console.log(`Operator API server listening on http://${args.host}:${args.port}`);
    console.log(`WebSocket available at ws://${args.host}:${args.port}/ws`);
    if (args.operator) {
      console.log('Combined mode: operator daemon active');
    }
    if (args.pool) {
      console.log('Pool mode: process pool + coordinator active');
    }
  });
}
