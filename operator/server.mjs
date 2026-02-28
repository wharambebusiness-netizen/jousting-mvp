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
import { readFileSync, writeFileSync } from 'fs';
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
import { createSharedMemory } from './shared-memory.mjs';
import { createSharedMemoryRoutes } from './routes/shared-memory.mjs';
import { createTerminalMessageBus } from './terminal-messages.mjs';
import { createTerminalMessageRoutes } from './routes/terminal-messages.mjs';
import { createAuth } from './auth.mjs';
import { createAuthRoutes } from './routes/auth.mjs';
import { createAuditLog } from './audit-log.mjs';
import { createAuditRoutes } from './routes/audit.mjs';
import { createDeadLetterQueue } from './coordination/dead-letter-queue.mjs';
import { createDeadLetterRoutes } from './routes/dead-letter.mjs';
import { createExportRoutes } from './routes/export.mjs';
import { createTimelineRoutes } from './routes/timeline.mjs';
import { createWebhookManager } from './webhooks.mjs';
import { createWebhookRoutes } from './routes/webhooks.mjs';
import { createPreferences } from './preferences.mjs';
import { createPreferencesRoutes } from './routes/preferences.mjs';
import { createSecretVault } from './secrets.mjs';
import { createSecretRoutes } from './routes/secrets.mjs';
import { createSearchEngine } from './search.mjs';
import { createSearchRoutes } from './routes/search.mjs';
import { createBackupManager } from './backup.mjs';
import { createBackupRoutes } from './routes/backup.mjs';
import { createTerminalSessionStore } from './terminal-sessions.mjs';
import { createTerminalSessionRoutes } from './routes/terminal-sessions.mjs';
import { createBulkRoutes } from './routes/bulk.mjs';
import { createNotifications } from './notifications.mjs';
import { createNotificationRoutes } from './routes/notifications.mjs';
import { createCostForecastRoutes } from './routes/cost-forecast.mjs';
import { createOpenApiGenerator } from './openapi.mjs';
import { createOpenApiRoutes } from './routes/openapi.mjs';
import { createLogger } from './logger.mjs';
import { createRequestIdMiddleware } from './middleware/request-id.mjs';
import { createRateHeadersMiddleware } from './middleware/rate-headers.mjs';
import { createResponseCache } from './middleware/response-cache.mjs';
import { errorHandler, notFoundHandler } from './error-response.mjs';
import { createMigrationRunner } from './migrations.mjs';
import { createRetentionPolicy } from './retention.mjs';
import { createHealthChecker } from './health.mjs';
import { createMetricsCollector } from './metrics.mjs';
import { createRequestTimer } from './middleware/request-timer.mjs';
import { createSecurityHeaders } from './middleware/security-headers.mjs';
import { createCsrfProtection } from './middleware/csrf.mjs';
import { createPerformanceRoutes } from './routes/performance.mjs';
import { createTemplateManager } from './template-manager.mjs';
import { createTemplateRoutes } from './routes/templates.mjs';
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');

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
  const settings = options.settings || createSettings({ operatorDir, events });

  // Auth layer (Phase 27) — opt out with auth: false for backward-compat
  let auth = null;
  if (options.auth && typeof options.auth === 'object') {
    auth = options.auth;
  } else if (options.auth !== false) {
    auth = createAuth({ operatorDir });
  }

  const app = express();

  // Structured logger (Phase 28)
  // Auto-suppress log output in test environments unless an explicit sink is provided
  const defaultSink = options.logSink || (process.env.VITEST ? { write() {} } : undefined);
  const logger = options.logger || createLogger({
    minLevel: options.logLevel || 'info',
    sink: defaultSink,
  });

  // Request timer (Phase 50) — created early so it captures all requests
  const requestTimer = options.requestTimer || createRequestTimer({
    log: logger,
    events,
    slowThresholdMs: options.slowThresholdMs ?? 1000,
  });

  // Middleware
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(corsMiddleware);
  app.use(createSecurityHeaders(options.securityHeaders || {}));
  app.use(createRequestIdMiddleware(logger));
  app.use(requestTimer.middleware);

  // CSRF protection (Phase 58) — double-submit cookie pattern
  // Auto-disabled when auth: false (testing mode) unless explicitly enabled
  let csrf = null;
  const csrfEnabled = options.csrf !== false && (options.csrf === true || options.auth !== false);
  if (csrfEnabled) {
    csrf = createCsrfProtection(options.csrfOptions || {});
    app.use(csrf.middleware);
  }

  // Rate limit headers (Phase 42) — deferred reference since coordinator is created later.
  // The middleware reads rateHeaderCtx.rateLimiter lazily on each request.
  const rateHeaderCtx = { rateLimiter: null };  // set after coordinator creation
  app.use(createRateHeadersMiddleware(rateHeaderCtx));

  // Response cache (Phase 42) — in-memory GET response cache
  const responseCache = options.responseCache || createResponseCache({
    defaultTtl: options.cacheTtl ?? 5000,
    maxEntries: options.cacheMaxEntries ?? 100,
    log: logger.debug?.bind(logger) || (() => {}),
  });

  // Browser session: auto-set _auth cookie so web UI can call /api/ routes
  let browserSessionToken = null;
  if (auth) {
    // Revoke any stale browser-session tokens from previous runs
    for (const t of auth.listTokens()) {
      if (t.label === 'browser-session') auth.revokeToken(t.id);
    }
    const { token: rawToken } = auth.generateToken('browser-session');
    browserSessionToken = rawToken;

    app.use((req, res, next) => {
      // Set cookie on page loads (non-API GET requests)
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.cookie('_auth', browserSessionToken, {
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
        });
      }
      next();
    });

    // CLI token: write a raw token to .data/cli-token.txt for curl/scripts
    for (const t of auth.listTokens()) {
      if (t.label === 'cli-session') auth.revokeToken(t.id);
    }
    const { token: cliToken } = auth.generateToken('cli-session');
    const cliTokenPath = join(operatorDir, '.data', 'cli-token.txt');
    try {
      writeFileSync(cliTokenPath, cliToken, 'utf8');
      logger.info?.('CLI token written to ' + cliTokenPath);
    } catch (e) {
      logger.warn?.('Failed to write CLI token: ' + e.message);
    }
  }

  // Auth middleware (after JSON parsing, before API routes)
  if (auth) {
    app.use(auth.authMiddleware);
  }

  // Auth routes (token management)
  if (auth) {
    app.use('/api', createAuthRoutes({ auth }));
  }

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

  // Null pool stub for coordinator when no real pool exists (swarm-only mode)
  function createNullPool() {
    return {
      activeCount: () => 0,
      sendTo: () => {},
      getStatus: () => [],
      shutdownAll: async () => {},
    };
  }

  // Dead letter queue (Phase 32) — stores permanently-failed tasks
  let deadLetterQueue = null;
  if (options.deadLetterQueue && typeof options.deadLetterQueue === 'object') {
    deadLetterQueue = options.deadLetterQueue;
  }

  // Coordinator for inter-orchestrator coordination (requires pool or swarm mode)
  let coordinator = null;
  const needsCoordinator = ((pool || options.claudePool) && options.coordination !== false) || options.swarm;
  if (needsCoordinator) {
    const coordPool = pool || createNullPool();
    const coordOpts = typeof options.coordination === 'object' ? options.coordination : {};
    if (options.swarm && !coordOpts.persistPath) {
      coordOpts.persistPath = join(operatorDir, '.data', 'task-queue.json');
    }

    // Create DLQ for coordinator if not injected
    if (!deadLetterQueue) {
      deadLetterQueue = createDeadLetterQueue({
        events,
        persistPath: join(operatorDir, '.data', 'dead-letters.json'),
        log: logger,
      });
    }

    coordinator = createCoordinator({
      events,
      pool: coordPool,
      options: coordOpts,
      deadLetterQueue,
      log: () => {},
    });

    // Wire rate limiter into rate-headers middleware (Phase 42)
    rateHeaderCtx.rateLimiter = coordinator.rateLimiter;
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

  // Template library (Phase 61) — workflow template CRUD
  const templatePersist = join(operatorDir, '.data', 'templates.json');
  const templateManager = options.templateManager || createTemplateManager({
    persistPath: templatePersist,
    events,
  });
  app.use('/api', createTemplateRoutes({ templateManager, coordinator }));

  // Cost forecast routes (Phase 43) — burn rate & budget exhaustion
  const costForecaster = coordinator ? coordinator.costForecaster : null;
  app.use('/api', createCostForecastRoutes({ costForecaster }));

  // Dead letter queue routes (Phase 32)
  app.use('/api', createDeadLetterRoutes({ deadLetterQueue, coordinator }));

  // Shared memory (Phase 17) — cross-terminal persistent state
  // Created before Claude pool so it can be passed to terminals
  let sharedMemory = null;
  if (options.sharedMemory && typeof options.sharedMemory === 'object') {
    sharedMemory = options.sharedMemory;
  } else if (options.sharedMemory !== false) {
    const memoryPersistPath = join(operatorDir, '.data', 'shared-memory.json');
    sharedMemory = createSharedMemory({
      events,
      persistPath: memoryPersistPath,
      log: () => {},
    });
    sharedMemory.load();
  }

  // Shared memory routes
  app.use('/api', createSharedMemoryRoutes({ sharedMemory }));

  // Terminal message bus (Phase 18) — inter-terminal communication
  let messageBus = null;
  if (options.messageBus && typeof options.messageBus === 'object') {
    messageBus = options.messageBus;
  } else if (options.messageBus !== false) {
    const msgPersistPath = join(operatorDir, '.data', 'terminal-messages.json');
    messageBus = createTerminalMessageBus({ events, persistPath: msgPersistPath });
    messageBus.load();
  }
  app.use('/api', createTerminalMessageRoutes({ messageBus }));

  // Data migration runner (Phase 30) — versioned schema changes
  const dataDir = join(operatorDir, '.data');
  const migrationRunner = options.migrationRunner || createMigrationRunner({ dataDir, log: logger });
  if (options.migrations !== false) {
    try {
      const migrationResult = migrationRunner.migrate();
      if (migrationResult.applied.length > 0) {
        logger.info?.('Migrations applied', migrationResult);
      }
    } catch (err) {
      logger.error?.('Migration failed', { error: err.message });
    }
  }

  // Retention policy (Phase 30) — age-based data cleanup
  const retentionPolicy = options.retentionPolicy || createRetentionPolicy({
    log: logger,
    maxAgeDays: options.retentionMaxAgeDays,
    maxEntries: options.retentionMaxEntries,
  });

  // System routes (Phase 30): migrations + retention
  app.get('/api/system/migrations', (_req, res) => {
    res.json({
      currentVersion: migrationRunner.getCurrentVersion(),
      migrations: migrationRunner.getMigrations(),
    });
  });

  app.post('/api/system/retention', (_req, res) => {
    try {
      const taskQueue = coordinator?.taskQueue || null;
      const result = retentionPolicy.runAll({ messageBus, sharedMemory, taskQueue });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Audit log (Phase 31) — append-only JSONL event journal
  let auditLog = null;
  if (options.auditLog && typeof options.auditLog === 'object') {
    auditLog = options.auditLog;
  } else if (options.auditLog !== false) {
    const auditPersistPath = join(operatorDir, '.data', 'audit-log.jsonl');
    auditLog = createAuditLog({
      persistPath: auditPersistPath,
      events,
      log: logger,
    });
  }
  app.use('/api', createAuditRoutes({ auditLog }));

  // Data export routes (Phase 36) — CSV, JSON, JSONL export
  app.use('/api', createExportRoutes({ coordinator, auditLog, messageBus, deadLetterQueue }));

  // Timeline routes (Phase 37) — aggregated activity feed from audit log
  app.use('/api', createTimelineRoutes({ auditLog }));

  // Webhook manager (Phase 38) — event-driven HTTP dispatching
  let webhookManager = null;
  if (options.webhookManager && typeof options.webhookManager === 'object') {
    webhookManager = options.webhookManager;
  } else if (options.webhooks !== false) {
    const webhookPersistPath = join(operatorDir, '.data', 'webhooks.json');
    webhookManager = createWebhookManager({
      events,
      persistPath: webhookPersistPath,
      log: logger,
    });
    webhookManager.load();
  }
  app.use('/api', createWebhookRoutes({ webhookManager }));

  // User preferences (Phase 39) — per-user preference persistence
  let preferences = null;
  if (options.preferences && typeof options.preferences === 'object') {
    preferences = options.preferences;
  } else if (options.preferences !== false) {
    const prefsPersistPath = join(operatorDir, '.data', 'preferences.json');
    preferences = createPreferences({
      persistPath: prefsPersistPath,
      log: logger.debug?.bind(logger) || (() => {}),
    });
  }
  app.use('/api', createPreferencesRoutes({ preferences }));

  // Bulk operations routes (Phase 40) — batch task/chain/DLQ operations
  app.use('/api', createBulkRoutes({ coordinator, deadLetterQueue, registry, auditLog }));

  // Notifications (Phase 41) — in-app notification system
  let notifications = null;
  if (options.notifications && typeof options.notifications === 'object') {
    notifications = options.notifications;
  } else if (options.notifications !== false) {
    const notifPersistPath = join(operatorDir, '.data', 'notifications.json');
    notifications = createNotifications({
      events,
      persistPath: notifPersistPath,
      log: logger,
    });
  }
  app.use('/api', createNotificationRoutes({ notifications }));

  // Secrets vault (Phase 45) — encrypted API key / sensitive config storage
  let secretVault = null;
  if (options.secretVault && typeof options.secretVault === 'object') {
    secretVault = options.secretVault;
  } else if (options.secrets !== false) {
    const vaultPersistPath = join(operatorDir, '.data', 'secrets.vault');
    secretVault = createSecretVault({
      persistPath: vaultPersistPath,
      log: logger.debug?.bind(logger) || (() => {}),
    });
    secretVault.load();
  }
  app.use('/api', createSecretRoutes({ secretVault }));

  // Performance routes (Phase 50) — request latency stats
  app.use('/api', createPerformanceRoutes({ requestTimer }));

  // Claude terminal pool (Phase 15) — with shared memory for snapshots + coordinator for auto-dispatch
  let claudePool = null;
  if (options.claudePool === true) {
    claudePool = createClaudePool({ events, projectDir, sharedMemory, coordinator, auth, log: () => {} });
  } else if (options.claudePool && typeof options.claudePool === 'object') {
    claudePool = options.claudePool;
  }

  // Terminal session store (Phase 48) — session recording, resume, templates
  let terminalSessionStore = null;
  if (options.terminalSessionStore && typeof options.terminalSessionStore === 'object') {
    terminalSessionStore = options.terminalSessionStore;
  } else if (options.terminalSessions !== false) {
    const sessionPersistPath = join(operatorDir, '.data', 'terminal-sessions.json');
    const templatePersistPath = join(operatorDir, '.data', 'terminal-templates.json');
    terminalSessionStore = createTerminalSessionStore({
      events,
      persistPath: sessionPersistPath,
      templatePath: templatePersistPath,
      claudePool,
      log: () => {},
    });
    terminalSessionStore.load();
  }
  app.use('/api', createTerminalSessionRoutes({ sessionStore: terminalSessionStore, claudePool }));

  // Global search engine (Phase 46) — unified cross-subsystem search
  const searchEngine = options.searchEngine || createSearchEngine({
    coordinator,
    messageBus,
    auditLog,
    registry,
    claudePool,
    sharedMemory,
    templateManager,
    log: logger.debug?.bind(logger) || (() => {}),
  });
  app.use('/api', createSearchRoutes({ searchEngine }));

  // Backup manager (Phase 51) — full state backup/restore
  let backupManager = null;
  if (options.backupManager && typeof options.backupManager === 'object') {
    backupManager = options.backupManager;
  } else if (options.backup !== false) {
    backupManager = createBackupManager({ operatorDir, log: logger });
  }
  app.use('/api', createBackupRoutes({ backupManager, coordinator }));

  // Health checker & metrics collector (Phase 34) — created after all subsystems
  const healthChecker = options.healthChecker || createHealthChecker({
    coordinator,
    claudePool,
    sharedMemory,
    messageBus,
    auditLog,
    deadLetterQueue,
    templateManager,
    dataDir,
  });

  const metricsCollector = options.metricsCollector || createMetricsCollector({
    coordinator,
    claudePool,
    sharedMemory,
    messageBus,
    auditLog,
    deadLetterQueue,
    requestTimer,
  });

  // Health endpoints (auth middleware skips /api/health and /api/health/*)
  app.get('/api/health', responseCache.middleware({ ttl: 5000 }), (_req, res) => {
    res.json(healthChecker.check());
  });

  app.get('/api/health/ready', (_req, res) => {
    res.json(healthChecker.ready());
  });

  // Prometheus metrics endpoint (auth middleware skips /api/metrics)
  app.get('/api/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metricsCollector.collect());
  });

  // Response cache management endpoints (Phase 42)
  app.get('/api/cache/stats', (_req, res) => {
    res.json(responseCache.getStats());
  });

  app.post('/api/cache/clear', (req, res) => {
    const pattern = req.body?.pattern || undefined;
    responseCache.invalidate(pattern);
    res.json({ ok: true });
  });

  // ── Prompt Enhancement Endpoint ───────────────────────────
  app.post('/api/enhance-prompt', async (req, res) => {
    const raw = req.body?.prompt;
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const enhanceInstruction = `You are a prompt engineer for a Claude Code AI agent working on a software project. The user has written a high-level request. Your job is to rewrite it into a technically precise, actionable instruction that a Claude Code agent can immediately execute.

Rules:
- Return ONLY the improved prompt text, nothing else
- Be specific about what to build, modify, or fix
- Include implementation details, acceptance criteria, and file references when possible
- Keep the scope the same — don't add unrelated work
- Use imperative voice ("Implement...", "Add...", "Fix...")
- If the request is vague, infer reasonable technical requirements
- Keep it concise but thorough (aim for 3-8 sentences)

User's request:
${raw.trim()}`;

    try {
      const { spawn: spawnChild } = await import('child_process');
      // Resolve claude path (Windows needs full path)
      let claudePath = 'claude';
      if (process.platform === 'win32') {
        try {
          const { execSync } = await import('child_process');
          claudePath = execSync('where claude', { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
        } catch { claudePath = 'claude.exe'; }
      }

      logger.info?.(`[enhance-prompt] Invoking: ${claudePath} -p --model haiku (input: ${raw.trim().length} chars)`);

      // Use spawn + stdin pipe — passing long prompts as CLI args fails on Windows
      const child = spawnChild(claudePath, ['-p', '--model', 'haiku'], {
        timeout: 30000,
        env: { ...process.env, CLAUDECODE: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('error', (err) => {
        logger.error?.(`[enhance-prompt] Spawn error: ${err.message}`);
        res.json({ enhanced: raw.trim(), fallback: true, error: err.message });
      });

      child.on('close', (code) => {
        if (code !== 0) {
          logger.error?.(`[enhance-prompt] Exit code ${code}`);
          if (stderr) logger.error?.(`[enhance-prompt] stderr: ${stderr}`);
          return res.json({ enhanced: raw.trim(), fallback: true, error: `Exit code ${code}` });
        }
        const enhanced = stdout.trim();
        logger.info?.(`[enhance-prompt] Success: ${enhanced.length} chars output${!enhanced ? ' (empty — using fallback)' : ''}`);
        res.json({ enhanced: enhanced || raw.trim(), fallback: !enhanced });
      });

      // Write prompt to stdin and close
      child.stdin.write(enhanceInstruction);
      child.stdin.end();
    } catch (err) {
      logger.error?.(`[enhance-prompt] Spawn error: ${err.message}`);
      res.json({ enhanced: raw.trim(), fallback: true });
    }
  });

  // Claude terminal routes (Phase 19: coordinator passed for task bridge)
  app.use('/api', createClaudeTerminalRoutes({ claudePool, events, coordinator }));

  // Resolve missions dir
  const missionsDir = join(projectDir, 'orchestrator', 'missions');

  // View fragment routes (HTMX partial responses)
  // wss is created after this block; we use a lazy accessor so the view route
  // can call ctx.wss.getStats() after the WS handler is wired up.
  const viewCtx = {
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
    auditLog,
    healthChecker,
    claudePool,
    notifications,
    costForecaster,
    auth,
    get wss() { return wss; },
  };
  app.use('/views', createViewRoutes(viewCtx));

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

  // Settings page
  app.get('/settings', (_req, res) => {
    res.sendFile(join(publicDir, 'settings.html'));
  });

  // Projects page
  app.get('/projects', (_req, res) => {
    res.sendFile(join(publicDir, 'projects.html'));
  });

  // Terminals page
  app.get('/terminals', (_req, res) => {
    res.sendFile(join(publicDir, 'terminals.html'));
  });

  // Task board page
  app.get('/taskboard', (_req, res) => {
    res.sendFile(join(publicDir, 'taskboard.html'));
  });

  // Timeline page (Phase 37)
  app.get('/timeline', (_req, res) => {
    res.sendFile(join(publicDir, 'timeline.html'));
  });

  // Console page (Phase 57)
  app.get('/console', (_req, res) => {
    res.sendFile(join(publicDir, 'console.html'));
  });

  // Dashboard page (explicit route for sidebar nav)
  app.get('/dashboard', (_req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });

  // Serve master-context.md from operator/ (not in public/)
  app.get('/master-context.md', (_req, res) => {
    res.sendFile(join(moduleDir, 'master-context.md'));
  });

  // Root redirect to console (daily-driver interface)
  app.get('/', (_req, res) => {
    res.redirect('/console');
  });

  // Static files (CSS, JS, images)
  app.use(express.static(publicDir));

  // OpenAPI spec generator & docs routes (Phase 44) — mounted after all
  // other routes so the router scanner captures everything.
  const openApiGenerator = options.openApiGenerator || createOpenApiGenerator({
    app,
    title: 'Jousting Operator API',
    version: '1.0.0',
    description: 'Multi-agent swarm orchestrator API',
  });
  app.use('/api', createOpenApiRoutes({ openApiGenerator }));

  // Catch-all 404 for unmatched API routes (Phase 29)
  app.use('/api', notFoundHandler);

  // Error-handling middleware — must be last (Phase 29)
  app.use(errorHandler(logger));

  // Create HTTP server (needed for WebSocket upgrade)
  const server = http.createServer(app);

  // WebSocket (JSON bridge + binary terminal WS)
  const wss = createWebSocketHandler({ server, events, claudePool, auth });

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

    // Clean up notifications
    if (notifications) notifications.destroy();

    // Clean up cost forecaster
    if (costForecaster) costForecaster.destroy();

    // Clean up webhook manager
    if (webhookManager) webhookManager.destroy();

    // Stop settings file watcher (Phase 52)
    if (settings.stopWatch) settings.stopWatch();

    // Clean up file watchers
    if (fileWatcher) fileWatcher.unwatchAll();

    // Clean up terminal session store listeners
    if (terminalSessionStore) terminalSessionStore.destroy();

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

  return { app, server, events, wss, pool, coordinator, claudePool, sharedMemory, messageBus, auth, csrf, logger, migrationRunner, retentionPolicy, auditLog, deadLetterQueue, healthChecker, metricsCollector, webhookManager, preferences, notifications, responseCache, costForecaster, openApiGenerator, secretVault, searchEngine, terminalSessionStore, requestTimer, backupManager, settings, close };
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
      swarm:    { type: 'boolean', default: false },
      retention:{ type: 'boolean', default: false },
      'no-auth':   { type: 'boolean', default: false },
      'log-level': { type: 'string', default: 'info' },
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
  --swarm         Enable swarm mode (coordinator + Claude pool for autonomous task draining)
  --retention     Run retention cleanup on startup
  --no-auth       Disable authentication (not recommended)
  --log-level LVL Log level: debug, info, warn, error (default: info)
  -h, --help      Show this help

Subcommands (against running server):
  status       Show system health
  tasks        List/add/cancel tasks
  search       Global search
  backup       Create backup
  restore      Restore from backup
  metrics      Show Prometheus metrics
  perf         Show performance stats
  help         Show subcommand help
`);
    process.exit(0);
  }

  return {
    port: parseInt(values.port, 10),
    host: values.host,
    operator: values.operator,
    pool: values.pool,
    swarm: values.swarm,
    retention: values.retention,
    noAuth: values['no-auth'],
    logLevel: values['log-level'],
  };
}

// Only run as CLI when executed directly
const isMain = process.argv[1] &&
  resolve(process.argv[1]).replace(/\\/g, '/').includes('operator/server');

if (isMain) {
  // CLI subcommand detection (Phase 54)
  const subcommands = ['status', 'tasks', 'search', 'backup', 'restore', 'metrics', 'perf', 'help'];
  const firstArg = process.argv[2];
  if (firstArg && subcommands.includes(firstArg)) {
    const { runCommand } = await import('./cli.mjs');
    const operatorDir = resolve(import.meta.dirname || '.', '.');
    const result = await runCommand(firstArg, process.argv.slice(3), { operatorDir });
    if (result.output) console.log(result.output);
    process.exit(result.exitCode);
  }

  const args = parseCliArgs();
  const operatorDir = resolve(import.meta.dirname || '.', '.');

  const appOptions = { operatorDir, _registerSignalHandlers: true, claudePool: true, logLevel: args.logLevel };

  // Auth: disabled with --no-auth
  if (args.noAuth) {
    appOptions.auth = false;
  }

  // Pool mode: enable process pool + coordinator for task board / multi-orchestrator
  if (args.pool) {
    appOptions.pool = true;
  }

  // Swarm mode: enable coordinator (without process pool) for autonomous task draining
  if (args.swarm) {
    appOptions.swarm = true;
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

  const { server, auth: cliAuth, retentionPolicy: cliRetention, messageBus: cliMsgBus, sharedMemory: cliSharedMem, coordinator: cliCoord } = createApp(appOptions);

  // Run retention cleanup on startup if --retention flag is set
  if (args.retention && cliRetention) {
    const taskQueue = cliCoord?.taskQueue || null;
    const result = cliRetention.runAll({ messageBus: cliMsgBus, sharedMemory: cliSharedMem, taskQueue });
    console.log(`Retention cleanup: ${result.messagesRemoved} messages, ${result.snapshotsRemoved} snapshots, ${result.tasksRemoved} tasks removed`);
  }

  // Auto-generate first token if auth is enabled and no tokens exist
  if (cliAuth) {
    const existing = cliAuth.listTokens();
    if (existing.length === 0) {
      const { token } = cliAuth.generateToken('auto-generated');
      console.log(`\nAuth enabled. First API token generated (save this — shown once):`);
      console.log(`  ${token}\n`);
    }
  }

  server.listen(args.port, args.host, () => {
    console.log(`Operator API server listening on http://${args.host}:${args.port}`);
    console.log(`WebSocket available at ws://${args.host}:${args.port}/ws`);
    if (args.operator) {
      console.log('Combined mode: operator daemon active');
    }
    if (args.pool) {
      console.log('Pool mode: process pool + coordinator active');
    }
    if (args.swarm) {
      console.log('Swarm mode: coordinator active (use /terminals UI to start swarm)');
    }
  });
}
