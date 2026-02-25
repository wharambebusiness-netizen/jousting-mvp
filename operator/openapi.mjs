// ============================================================
// OpenAPI Auto-Documentation Generator (Phase 44)
// ============================================================
// Scans Express router stack and produces an OpenAPI 3.0.3 spec.
// Supports custom route metadata via registerRoute().
//
// Factory: createOpenApiGenerator(ctx) -> { generate, registerRoute }
// ============================================================

// ── Constants ───────────────────────────────────────────────

const KNOWN_TAGS = [
  { name: 'auth', description: 'Authentication & token management' },
  { name: 'chains', description: 'Chain lifecycle management' },
  { name: 'orchestrator', description: 'Orchestrator instance control' },
  { name: 'coordination', description: 'Task coordination & scheduling' },
  { name: 'claude-terminals', description: 'Interactive Claude terminal pool' },
  { name: 'shared-memory', description: 'Cross-terminal persistent state' },
  { name: 'terminal-messages', description: 'Inter-terminal message bus' },
  { name: 'audit', description: 'Audit log & event journal' },
  { name: 'export', description: 'Data export (CSV, JSON, JSONL)' },
  { name: 'timeline', description: 'Activity timeline feed' },
  { name: 'webhooks', description: 'Webhook event dispatching' },
  { name: 'notifications', description: 'In-app notification system' },
  { name: 'preferences', description: 'User preferences' },
  { name: 'bulk', description: 'Bulk batch operations' },
  { name: 'system', description: 'System administration' },
  { name: 'git', description: 'Git operations' },
  { name: 'settings', description: 'Application settings' },
  { name: 'files', description: 'File system access' },
  { name: 'health', description: 'Health & readiness checks' },
  { name: 'metrics', description: 'Prometheus metrics' },
  { name: 'cache', description: 'Response cache management' },
  { name: 'dead-letter', description: 'Dead letter queue' },
  { name: 'cost-forecast', description: 'Cost forecasting & burn rate' },
  { name: 'openapi', description: 'API documentation' },
];

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

// Paths to skip (non-API routes: views, static, page routes)
const SKIP_PREFIXES = ['/views/', '/views'];
const SKIP_PATHS = new Set(['/', '/chains/:id', '/settings', '/projects', '/terminals', '/taskboard', '/timeline']);

/**
 * Create an OpenAPI spec generator.
 * @param {object} ctx
 * @param {object}  ctx.app         - Express app instance
 * @param {string}  [ctx.title]     - API title
 * @param {string}  [ctx.version]   - API version
 * @param {string}  [ctx.description] - API description
 * @returns {{ generate: Function, registerRoute: Function }}
 */
export function createOpenApiGenerator(ctx) {
  const app = ctx.app;
  const title = ctx.title || 'Jousting Operator API';
  const version = ctx.version || '1.0.0';
  const description = ctx.description || 'Multi-agent swarm orchestrator API';

  // Custom metadata registry: Map<"METHOD /path", metadata>
  const registry = new Map();

  // Cached spec (lazy, invalidated on registerRoute)
  let cachedSpec = null;

  /**
   * Register custom metadata for a route.
   * @param {string} path     - Route path (e.g., '/api/health')
   * @param {string} method   - HTTP method (e.g., 'get')
   * @param {object} metadata - { summary, description, requestBody, responses }
   */
  function registerRoute(path, method, metadata) {
    const key = `${method.toUpperCase()} ${path}`;
    registry.set(key, metadata);
    cachedSpec = null; // invalidate cache
  }

  /**
   * Derive tag from a path's first meaningful segment.
   * /api/coordination/tasks -> coordination
   * /api/claude-terminals/spawn -> claude-terminals
   */
  function deriveTag(path) {
    // Strip /api/ prefix
    const stripped = path.startsWith('/api/') ? path.slice(5) : path.slice(1);
    // First segment (before next / or end)
    const seg = stripped.split('/')[0] || 'other';

    // Map some segment names to canonical tags
    const tagMap = {
      'auth': 'auth',
      'chains': 'chains',
      'orchestrator': 'orchestrator',
      'orchestrators': 'orchestrator',
      'coordination': 'coordination',
      'claude-terminals': 'claude-terminals',
      'shared-memory': 'shared-memory',
      'shared-memory-snapshots': 'shared-memory',
      'terminal-messages': 'terminal-messages',
      'audit': 'audit',
      'export': 'export',
      'timeline': 'timeline',
      'webhooks': 'webhooks',
      'notifications': 'notifications',
      'preferences': 'preferences',
      'bulk': 'bulk',
      'system': 'system',
      'git': 'git',
      'settings': 'settings',
      'files': 'files',
      'health': 'health',
      'metrics': 'metrics',
      'cache': 'cache',
      'dead-letters': 'dead-letter',
      'cost-forecast': 'cost-forecast',
      'openapi.json': 'openapi',
      'docs': 'openapi',
    };
    return tagMap[seg] || seg;
  }

  /**
   * Generate a human-readable summary from method + path.
   * GET /api/health -> "Get health"
   * POST /api/coordination/tasks -> "Create coordination task"
   */
  function generateSummary(method, path) {
    const verbMap = { get: 'Get', post: 'Create', put: 'Update', patch: 'Patch', delete: 'Delete' };
    const verb = verbMap[method] || method.toUpperCase();

    // Strip /api/ prefix and convert segments to words
    const stripped = path.startsWith('/api/') ? path.slice(5) : path.slice(1);
    const words = stripped
      .split('/')
      .filter(s => s && !s.startsWith(':'))
      .map(s => s.replace(/-/g, ' '))
      .join(' ');

    return `${verb} ${words || 'root'}`;
  }

  /**
   * Generate operationId from method + path.
   * GET /api/health -> getApiHealth
   * POST /api/coordination/tasks -> postApiCoordinationTasks
   */
  function generateOperationId(method, path) {
    const parts = path.split('/').filter(Boolean).map((seg, i) => {
      const clean = seg.replace(/^:/, '').replace(/-/g, '_');
      return i === 0 ? clean : clean.charAt(0).toUpperCase() + clean.slice(1);
    });
    return method + parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  }

  /**
   * Extract path parameters from Express route pattern.
   * /api/chains/:id -> [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]
   */
  function extractPathParams(path) {
    const params = [];
    const matches = path.match(/:([^/]+)/g);
    if (matches) {
      for (const m of matches) {
        params.push({
          name: m.slice(1),
          in: 'path',
          required: true,
          schema: { type: 'string' },
        });
      }
    }
    return params;
  }

  /**
   * Convert Express path to OpenAPI path format.
   * /api/chains/:id -> /api/chains/{id}
   */
  function toOpenApiPath(path) {
    return path.replace(/:([^/]+)/g, '{$1}');
  }

  /**
   * Should this route be included in the spec?
   */
  function shouldInclude(path) {
    if (!path) return false;
    if (SKIP_PATHS.has(path)) return false;
    for (const prefix of SKIP_PREFIXES) {
      if (path.startsWith(prefix)) return false;
    }
    // Must start with /api
    if (!path.startsWith('/api')) return false;
    return true;
  }

  // Common mount prefixes to probe when extracting sub-router paths
  const PROBE_PREFIXES = ['/api', '/views', '/ws', ''];

  /**
   * Get the router stack from an Express app.
   * Supports both Express 4 (app._router.stack) and Express 5 (app.router.stack).
   */
  function getRouterStack() {
    // Express 5: app.router is a getter that returns the router
    if (app.router && typeof app.router === 'function' && app.router.stack) {
      return app.router.stack;
    }
    // Express 4: app._router.stack
    if (app._router && app._router.stack) {
      return app._router.stack;
    }
    return null;
  }

  /**
   * Walk Express router stack and extract route definitions.
   * Returns array of { method, path }.
   */
  function extractRoutes() {
    const routes = [];
    const stack = getRouterStack();
    if (!stack) return routes;

    for (const layer of stack) {
      // Direct route on app
      if (layer.route) {
        const routePath = layer.route.path;
        for (const method of Object.keys(layer.route.methods)) {
          if (HTTP_METHODS.has(method)) {
            routes.push({ method, path: routePath });
          }
        }
        continue;
      }

      // Sub-router mounted via app.use('/prefix', router)
      if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        const prefix = extractPrefix(layer);
        for (const subLayer of layer.handle.stack) {
          if (subLayer.route) {
            const routePath = prefix + subLayer.route.path;
            for (const method of Object.keys(subLayer.route.methods)) {
              if (HTTP_METHODS.has(method)) {
                routes.push({ method, path: routePath });
              }
            }
          }
        }
      }
    }

    return routes;
  }

  /**
   * Extract the mount prefix from a router layer.
   * Supports Express 4 (layer.regexp) and Express 5 (layer.matchers).
   */
  function extractPrefix(layer) {
    // Express 5: matchers array with callable functions
    // Call the matcher with probe paths to discover the mount prefix
    if (layer.matchers && Array.isArray(layer.matchers)) {
      const matcher = layer.matchers[0];
      if (typeof matcher === 'function') {
        // Find a sub-route to use as probe
        let probeSuffix = '/probe';
        for (const sub of (layer.handle?.stack || [])) {
          if (sub.route) {
            probeSuffix = sub.route.path;
            break;
          }
        }
        for (const prefix of PROBE_PREFIXES) {
          const testPath = prefix + probeSuffix;
          try {
            const result = matcher(testPath);
            if (result && result.path) {
              return result.path;
            }
          } catch { /* skip */ }
        }
      }
    }

    // Express 4: layer.regexp contains the mount path regex
    if (layer.regexp) {
      const src = layer.regexp.source;
      const match = src.match(/^\^\\?\/?(.+?)\\?\/?(?:\(\?[=:]|$)/);
      if (match) {
        let prefix = '/' + match[1]
          .replace(/\\\//g, '/')
          .replace(/\\/g, '');
        prefix = prefix.replace(/\/\?$/, '');
        return prefix;
      }
    }

    return '';
  }

  /**
   * Generate the full OpenAPI 3.0.3 spec object.
   * Cached — regenerated only when registry changes.
   */
  function generate() {
    if (cachedSpec) return cachedSpec;

    const routes = extractRoutes();
    const paths = {};
    const usedTags = new Set();

    for (const { method, path } of routes) {
      if (!shouldInclude(path)) continue;

      const openApiPath = toOpenApiPath(path);
      const tag = deriveTag(path);
      usedTags.add(tag);

      const registryKey = `${method.toUpperCase()} ${path}`;
      const meta = registry.get(registryKey) || {};

      const parameters = extractPathParams(path);
      const operationId = generateOperationId(method, path);
      const summary = meta.summary || generateSummary(method, path);

      const operation = {
        operationId,
        tags: [tag],
        summary,
        parameters: parameters.length > 0 ? parameters : undefined,
        responses: meta.responses || {
          '200': { description: 'Success' },
          '400': { description: 'Bad request' },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Not found' },
          '500': { description: 'Internal server error' },
        },
      };

      if (meta.description) {
        operation.description = meta.description;
      }

      if (meta.requestBody) {
        operation.requestBody = meta.requestBody;
      }

      if (!paths[openApiPath]) paths[openApiPath] = {};
      paths[openApiPath][method] = operation;
    }

    // Build tags list — only include tags that were actually used
    const tags = KNOWN_TAGS.filter(t => usedTags.has(t.name));
    // Add any unknown tags that were used
    for (const t of usedTags) {
      if (!tags.find(kt => kt.name === t)) {
        tags.push({ name: t, description: t });
      }
    }

    cachedSpec = {
      openapi: '3.0.3',
      info: { title, version, description },
      servers: [{ url: '/' }],
      paths,
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
      tags,
    };

    return cachedSpec;
  }

  return { generate, registerRoute };
}
