// ============================================================
// OpenAPI Auto-Documentation Tests (Phase 44)
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import express from 'express';
import http from 'http';
import { createOpenApiGenerator } from '../openapi.mjs';
import { createOpenApiRoutes } from '../routes/openapi.mjs';
import { createApp } from '../server.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_openapi');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

// Helper: create a minimal Express app with some routes for testing
function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/health/ready', (_req, res) => res.json({ ready: true }));
  app.post('/api/coordination/tasks', (_req, res) => res.json({ id: '1' }));
  app.get('/api/coordination/tasks', (_req, res) => res.json({ tasks: [] }));
  app.get('/api/coordination/tasks/:id', (_req, res) => res.json({ id: _req.params.id }));
  app.patch('/api/coordination/tasks/:id', (_req, res) => res.json({ ok: true }));
  app.delete('/api/coordination/tasks/:id', (_req, res) => res.json({ deleted: true }));
  app.get('/api/claude-terminals', (_req, res) => res.json({ terminals: [] }));
  app.post('/api/claude-terminals/spawn', (_req, res) => res.json({ id: 't1' }));
  app.get('/api/shared-memory', (_req, res) => res.json({}));
  app.get('/api/terminal-messages', (_req, res) => res.json([]));
  app.get('/api/audit/events', (_req, res) => res.json([]));
  app.get('/api/export/tasks', (_req, res) => res.json([]));
  app.get('/api/timeline', (_req, res) => res.json([]));
  app.get('/api/webhooks', (_req, res) => res.json([]));
  app.get('/api/notifications', (_req, res) => res.json([]));
  app.get('/api/preferences', (_req, res) => res.json({}));
  app.post('/api/bulk/tasks', (_req, res) => res.json({ ok: true }));
  app.get('/api/system/migrations', (_req, res) => res.json({}));

  // Non-API routes that should be skipped
  app.get('/views/dashboard', (_req, res) => res.send('html'));
  app.get('/settings', (_req, res) => res.send('html'));
  app.get('/terminals', (_req, res) => res.send('html'));

  return app;
}

// Helper: HTTP request
function request(app, method, path) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url = new URL(path, `http://127.0.0.1:${port}`);
      const options = {
        hostname: '127.0.0.1',
        port,
        path: url.pathname + url.search,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, headers: res.headers, body: data });
          }
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.end();
    });
  });
}

// ============================================================
// Unit Tests — createOpenApiGenerator
// ============================================================

describe('OpenAPI Generator — generate()', () => {
  it('returns valid OpenAPI 3.0.3 structure', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
    expect(spec.security).toBeDefined();
    expect(spec.tags).toBeDefined();
    expect(spec.servers).toBeDefined();
  });

  it('spec has info with title, version, description', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({
      app,
      title: 'My API',
      version: '2.0.0',
      description: 'Test API',
    });
    const spec = gen.generate();

    expect(spec.info.title).toBe('My API');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.info.description).toBe('Test API');
  });

  it('spec has default title, version, description when not provided', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    expect(spec.info.title).toBe('Jousting Operator API');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.info.description).toBe('Multi-agent swarm orchestrator API');
  });

  it('spec has securitySchemes', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('spec has security field', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });

  it('spec has servers field', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    expect(spec.servers).toEqual([{ url: '/' }]);
  });

  it('spec has paths for known endpoints', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    expect(spec.paths['/api/health']).toBeDefined();
    expect(spec.paths['/api/coordination/tasks']).toBeDefined();
    expect(spec.paths['/api/claude-terminals']).toBeDefined();
    expect(spec.paths['/api/shared-memory']).toBeDefined();
  });

  it('spec has tags for endpoint groups', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    const tagNames = spec.tags.map(t => t.name);
    expect(tagNames).toContain('health');
    expect(tagNames).toContain('coordination');
    expect(tagNames).toContain('claude-terminals');
    expect(tagNames).toContain('shared-memory');
  });

  it('path entries have operationId', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    const healthGet = spec.paths['/api/health']?.get;
    expect(healthGet).toBeDefined();
    expect(healthGet.operationId).toBeTruthy();
    expect(typeof healthGet.operationId).toBe('string');
  });

  it('path entries have correct HTTP methods', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    // Coordination tasks has both GET and POST
    const coordTasks = spec.paths['/api/coordination/tasks'];
    expect(coordTasks).toBeDefined();
    expect(coordTasks.get).toBeDefined();
    expect(coordTasks.post).toBeDefined();
  });

  it('path parameters extracted from :id patterns', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    const taskById = spec.paths['/api/coordination/tasks/{id}'];
    expect(taskById).toBeDefined();

    // GET should have id parameter
    const getOp = taskById.get;
    expect(getOp.parameters).toBeDefined();
    expect(getOp.parameters.length).toBeGreaterThan(0);
    expect(getOp.parameters[0]).toEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  });

  it('tag grouping: coordination routes grouped under coordination tag', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    const coordTasks = spec.paths['/api/coordination/tasks'];
    expect(coordTasks.get.tags).toEqual(['coordination']);
    expect(coordTasks.post.tags).toEqual(['coordination']);
  });

  it('skip non-API routes (no /views/* or static paths)', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    const paths = Object.keys(spec.paths);
    // No view routes
    expect(paths.some(p => p.startsWith('/views/'))).toBe(false);
    // No page routes
    expect(paths).not.toContain('/settings');
    expect(paths).not.toContain('/terminals');
  });

  it('summary generation from path + method', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    const healthGet = spec.paths['/api/health'].get;
    expect(healthGet.summary).toBeTruthy();
    expect(typeof healthGet.summary).toBe('string');
    // Should contain a verb
    expect(healthGet.summary).toMatch(/^(Get|Create|Update|Delete|Patch)/);
  });

  it('paths include response schemas (200, 400, 401)', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    const spec = gen.generate();

    const healthGet = spec.paths['/api/health'].get;
    expect(healthGet.responses['200']).toBeDefined();
    expect(healthGet.responses['400']).toBeDefined();
    expect(healthGet.responses['401']).toBeDefined();
  });

  it('empty app generates minimal spec (just info/openapi)', () => {
    const emptyApp = express();
    const gen = createOpenApiGenerator({ app: emptyApp });
    const spec = gen.generate();

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Jousting Operator API');
    expect(Object.keys(spec.paths)).toHaveLength(0);
    expect(spec.tags).toHaveLength(0);
  });
});

// ============================================================
// Unit Tests — registerRoute
// ============================================================

describe('OpenAPI Generator — registerRoute()', () => {
  it('registerRoute() adds custom metadata', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });

    gen.registerRoute('/api/health', 'get', {
      summary: 'Custom health check',
      description: 'Returns system health status',
    });

    const spec = gen.generate();
    const healthGet = spec.paths['/api/health'].get;
    expect(healthGet.summary).toBe('Custom health check');
    expect(healthGet.description).toBe('Returns system health status');
  });

  it('registered route metadata appears in generated spec', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });

    gen.registerRoute('/api/coordination/tasks', 'post', {
      summary: 'Add a new task',
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { description: { type: 'string' } } },
          },
        },
      },
      responses: {
        '201': { description: 'Task created' },
        '400': { description: 'Invalid input' },
      },
    });

    const spec = gen.generate();
    const taskPost = spec.paths['/api/coordination/tasks'].post;
    expect(taskPost.summary).toBe('Add a new task');
    expect(taskPost.requestBody).toBeDefined();
    expect(taskPost.requestBody.content['application/json']).toBeDefined();
    expect(taskPost.responses['201']).toBeDefined();
  });

  it('regeneration after new routes registered', () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });

    const spec1 = gen.generate();
    const summary1 = spec1.paths['/api/health'].get.summary;

    // Register custom metadata — should invalidate cache
    gen.registerRoute('/api/health', 'get', {
      summary: 'Updated health check',
    });

    const spec2 = gen.generate();
    expect(spec2.paths['/api/health'].get.summary).toBe('Updated health check');
    expect(spec2.paths['/api/health'].get.summary).not.toBe(summary1);
  });
});

// ============================================================
// Route Tests — /api/openapi.json and /api/docs
// ============================================================

describe('OpenAPI Routes', () => {
  it('GET /api/openapi.json returns valid JSON spec', async () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    app.use('/api', createOpenApiRoutes({ openApiGenerator: gen }));

    const { status, body } = await request(app, 'GET', '/api/openapi.json');
    expect(status).toBe(200);
    expect(body.openapi).toBe('3.0.3');
    expect(body.info).toBeDefined();
    expect(body.paths).toBeDefined();
  });

  it('GET /api/docs returns HTML page', async () => {
    const app = createTestApp();
    const gen = createOpenApiGenerator({ app });
    app.use('/api', createOpenApiRoutes({ openApiGenerator: gen }));

    const res = await new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const req = http.request({
          hostname: '127.0.0.1', port, path: '/api/docs', method: 'GET',
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: data, headers: res.headers }); });
        });
        req.on('error', (err) => { server.close(); reject(err); });
        req.end();
      });
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('swagger-ui');
    expect(res.body).toContain('/api/openapi.json');
    expect(res.body).toContain('<!DOCTYPE html>');
  });
});

// ============================================================
// Integration Tests — Full createApp with OpenAPI
// ============================================================

describe('OpenAPI Integration — createApp', () => {
  let appInstance, baseUrl;

  beforeAll(async () => {
    setup();
    const events = new EventBus();
    appInstance = createApp({ operatorDir: TEST_DIR, events, auth: false });
    await new Promise((resolve) => {
      appInstance.server.listen(0, '127.0.0.1', () => {
        const port = appInstance.server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (appInstance) await appInstance.close();
    teardown();
  });

  it('GET /api/openapi.json from full server returns spec', async () => {
    const res = await fetch(`${baseUrl}/api/openapi.json`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Jousting Operator API');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it('full server spec includes /api/health endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/openapi.json`);
    const spec = await res.json();
    expect(spec.paths['/api/health']).toBeDefined();
    expect(spec.paths['/api/health'].get).toBeDefined();
  });

  it('full server spec does not include /views/* routes', async () => {
    const res = await fetch(`${baseUrl}/api/openapi.json`);
    const spec = await res.json();
    const paths = Object.keys(spec.paths);
    expect(paths.some(p => p.startsWith('/views/'))).toBe(false);
  });

  it('openApiGenerator is exposed on createApp return value', () => {
    expect(appInstance.openApiGenerator).toBeDefined();
    expect(typeof appInstance.openApiGenerator.generate).toBe('function');
    expect(typeof appInstance.openApiGenerator.registerRoute).toBe('function');
  });

  it('GET /api/docs from full server returns HTML', async () => {
    const res = await fetch(`${baseUrl}/api/docs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('swagger-ui');
  });
});
