// ============================================================
// MCP Server — Model Context Protocol Tool Server (Phase 66)
// ============================================================
// Exposes operator functionality as an MCP tool server so external
// Claude sessions can add tasks, check status, and coordinate.
//
// Transport: JSON-RPC 2.0 over stdin/stdout
// Protocol: MCP (Model Context Protocol)
//
// Tools: add_task, list_tasks, get_task, cancel_task, get_status,
//        read_shared_memory, write_shared_memory, list_workers,
//        get_metrics, search
//
// Resources: task-queue://progress, master://status
// ============================================================

import { createInterface } from 'readline';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'jousting-operator';
export const SERVER_VERSION = '1.0.0';

/**
 * Create an MCP server that communicates over stdin/stdout.
 * @param {object} ctx
 * @param {object} ctx.coordinator - Task coordinator
 * @param {object} ctx.sharedMemory - Shared memory instance
 * @param {object} ctx.claudePool - Claude pool instance
 * @param {object} [ctx.metricsCollector] - Metrics collector
 * @param {object} [ctx.searchEngine] - Search engine
 * @param {object} [ctx.masterCoordinator] - Master coordinator
 * @param {Function} [ctx.log] - Logger (writes to stderr to avoid stdout corruption)
 * @param {object} [ctx.input] - Input stream (default: process.stdin)
 * @param {object} [ctx.output] - Output stream (default: process.stdout)
 * @returns {object} MCP server methods
 */
export function createMcpServer(ctx) {
  const { coordinator, sharedMemory, claudePool } = ctx;
  const metricsCollector = ctx.metricsCollector || null;
  const searchEngine = ctx.searchEngine || null;
  const masterCoordinator = ctx.masterCoordinator || null;
  const log = ctx.log || ((msg) => process.stderr.write(msg + '\n'));
  const input = ctx.input || process.stdin;
  const output = ctx.output || process.stdout;

  let initialized = false;

  // ── Tool Definitions ──────────────────────────────────

  const TOOLS = [
    {
      name: 'add_task',
      description: 'Add a new task to the coordinator task queue',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique task ID' },
          task: { type: 'string', description: 'Task description' },
          priority: { type: 'number', description: 'Priority (0-10, higher = more urgent)', default: 5 },
          category: { type: 'string', description: 'Task category (e.g., testing, features, bugs)' },
          deps: { type: 'array', items: { type: 'string' }, description: 'Task IDs this task depends on' },
        },
        required: ['id', 'task'],
      },
    },
    {
      name: 'list_tasks',
      description: 'List all tasks in the task queue with their status',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (pending, assigned, running, complete, failed)' },
        },
      },
    },
    {
      name: 'get_task',
      description: 'Get details of a specific task by ID',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID' },
        },
        required: ['id'],
      },
    },
    {
      name: 'cancel_task',
      description: 'Cancel a pending or running task',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task ID to cancel' },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_status',
      description: 'Get overall system status including pool, coordinator, and health info',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'read_shared_memory',
      description: 'Read a value from shared memory',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Shared memory key' },
        },
        required: ['key'],
      },
    },
    {
      name: 'write_shared_memory',
      description: 'Write a value to shared memory',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Shared memory key' },
          value: { description: 'Value to store (must be JSON-serializable)' },
        },
        required: ['key', 'value'],
      },
    },
    {
      name: 'list_workers',
      description: 'List all active Claude terminal workers and masters',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_metrics',
      description: 'Get system metrics in Prometheus exposition format',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'search',
      description: 'Search across all subsystems (tasks, messages, audit log, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Maximum results', default: 20 },
        },
        required: ['query'],
      },
    },
  ];

  // ── Resource Definitions ──────────────────────────────

  const RESOURCES = [
    {
      uri: 'task-queue://progress',
      name: 'Task Queue Progress',
      description: 'Current task queue progress summary',
      mimeType: 'application/json',
    },
    {
      uri: 'master://status',
      name: 'Master Terminal Status',
      description: 'Status of all master terminals and coordination',
      mimeType: 'application/json',
    },
  ];

  // ── Tool Handlers ─────────────────────────────────────

  function handleToolCall(name, args) {
    switch (name) {
      case 'add_task':
        return handleAddTask(args);
      case 'list_tasks':
        return handleListTasks(args);
      case 'get_task':
        return handleGetTask(args);
      case 'cancel_task':
        return handleCancelTask(args);
      case 'get_status':
        return handleGetStatus();
      case 'read_shared_memory':
        return handleReadSharedMemory(args);
      case 'write_shared_memory':
        return handleWriteSharedMemory(args);
      case 'list_workers':
        return handleListWorkers();
      case 'get_metrics':
        return handleGetMetrics();
      case 'search':
        return handleSearch(args);
      default:
        throw { code: -32601, message: `Unknown tool: ${name}` };
    }
  }

  function handleAddTask(args) {
    if (!coordinator || !coordinator.taskQueue) {
      return { content: [{ type: 'text', text: 'Error: Coordinator not available' }], isError: true };
    }
    try {
      coordinator.taskQueue.add({
        id: args.id,
        task: args.task,
        priority: args.priority ?? 5,
        category: args.category || null,
        deps: args.deps || [],
      });
      return { content: [{ type: 'text', text: `Task "${args.id}" added successfully` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }

  function handleListTasks(args) {
    if (!coordinator || !coordinator.taskQueue) {
      return { content: [{ type: 'text', text: 'Error: Coordinator not available' }], isError: true };
    }
    let tasks = coordinator.taskQueue.getAll();
    if (args && args.status) {
      tasks = tasks.filter(t => t.status === args.status);
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(tasks.map(t => ({
          id: t.id,
          task: t.task,
          status: t.status,
          priority: t.priority,
          category: t.category || null,
          assignedTo: t.assignedTo || null,
        })), null, 2),
      }],
    };
  }

  function handleGetTask(args) {
    if (!coordinator || !coordinator.taskQueue) {
      return { content: [{ type: 'text', text: 'Error: Coordinator not available' }], isError: true };
    }
    const tasks = coordinator.taskQueue.getAll();
    const task = tasks.find(t => t.id === args.id);
    if (!task) {
      return { content: [{ type: 'text', text: `Task "${args.id}" not found` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }

  function handleCancelTask(args) {
    if (!coordinator || !coordinator.taskQueue) {
      return { content: [{ type: 'text', text: 'Error: Coordinator not available' }], isError: true };
    }
    try {
      coordinator.taskQueue.cancel(args.id);
      return { content: [{ type: 'text', text: `Task "${args.id}" cancelled` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }

  function handleGetStatus() {
    const status = {};
    if (coordinator) {
      status.coordinator = {
        state: coordinator.getState(),
        taskCount: coordinator.taskQueue ? coordinator.taskQueue.getAll().length : 0,
      };
    }
    if (claudePool) {
      status.pool = claudePool.getPoolStatus();
      status.masters = claudePool.getMasterTerminals().map(m => ({ id: m.id, status: m.status }));
    }
    if (masterCoordinator) {
      status.masterCoordination = masterCoordinator.getMultiMasterStatus();
    }
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }

  function handleReadSharedMemory(args) {
    if (!sharedMemory) {
      return { content: [{ type: 'text', text: 'Error: Shared memory not available' }], isError: true };
    }
    const value = sharedMemory.get(args.key);
    if (value === undefined) {
      return { content: [{ type: 'text', text: `Key "${args.key}" not found` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
  }

  function handleWriteSharedMemory(args) {
    if (!sharedMemory) {
      return { content: [{ type: 'text', text: 'Error: Shared memory not available' }], isError: true };
    }
    try {
      sharedMemory.set(args.key, args.value, 'mcp');
      return { content: [{ type: 'text', text: `Key "${args.key}" set successfully` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  }

  function handleListWorkers() {
    if (!claudePool) {
      return { content: [{ type: 'text', text: 'Error: Pool not available' }], isError: true };
    }
    const terminals = claudePool.getStatus();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(terminals.map(t => ({
          id: t.id,
          status: t.status,
          role: t.role || 'worker',
          assignedTask: t.assignedTask ? t.assignedTask.taskId : null,
          activityState: t.activityState,
        })), null, 2),
      }],
    };
  }

  function handleGetMetrics() {
    if (!metricsCollector) {
      return { content: [{ type: 'text', text: 'Error: Metrics collector not available' }], isError: true };
    }
    return { content: [{ type: 'text', text: metricsCollector.collect() }] };
  }

  function handleSearch(args) {
    if (!searchEngine) {
      return { content: [{ type: 'text', text: 'Error: Search engine not available' }], isError: true };
    }
    const results = searchEngine.search(args.query, { limit: args.limit || 20 });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(results, null, 2),
      }],
    };
  }

  // ── Resource Handlers ─────────────────────────────────

  function handleResourceRead(uri) {
    switch (uri) {
      case 'task-queue://progress': {
        if (!coordinator || !coordinator.taskQueue) {
          return { contents: [{ uri, mimeType: 'application/json', text: '{"error":"Coordinator not available"}' }] };
        }
        const all = coordinator.taskQueue.getAll();
        const progress = {
          total: all.length,
          pending: all.filter(t => t.status === 'pending').length,
          assigned: all.filter(t => t.status === 'assigned').length,
          running: all.filter(t => t.status === 'running').length,
          complete: all.filter(t => t.status === 'complete').length,
          failed: all.filter(t => t.status === 'failed').length,
        };
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(progress, null, 2) }] };
      }
      case 'master://status': {
        let status = { masters: [], totalMasters: 0 };
        if (masterCoordinator) {
          status = masterCoordinator.getMultiMasterStatus();
        } else if (claudePool) {
          const masters = claudePool.getMasterTerminals();
          status = { masters: masters.map(m => ({ id: m.id, status: m.status })), totalMasters: masters.length };
        }
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(status, null, 2) }] };
      }
      default:
        throw { code: -32602, message: `Unknown resource: ${uri}` };
    }
  }

  // ── JSON-RPC Dispatcher ─────────────────────────────

  function dispatch(message) {
    const { id, method, params } = message;

    try {
      switch (method) {
        case 'initialize':
          initialized = true;
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: {
                tools: {},
                resources: {},
              },
              serverInfo: {
                name: SERVER_NAME,
                version: SERVER_VERSION,
              },
            },
          };

        case 'notifications/initialized':
          // Client acknowledgment — no response needed
          return null;

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { tools: TOOLS },
          };

        case 'tools/call': {
          const { name, arguments: toolArgs } = params || {};
          if (!name) {
            return makeError(id, -32602, 'Missing tool name');
          }
          const result = handleToolCall(name, toolArgs || {});
          return {
            jsonrpc: '2.0',
            id,
            result,
          };
        }

        case 'resources/list':
          return {
            jsonrpc: '2.0',
            id,
            result: { resources: RESOURCES },
          };

        case 'resources/read': {
          const { uri } = params || {};
          if (!uri) {
            return makeError(id, -32602, 'Missing resource URI');
          }
          const result = handleResourceRead(uri);
          return {
            jsonrpc: '2.0',
            id,
            result,
          };
        }

        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };

        default:
          return makeError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      if (err.code) {
        return makeError(id, err.code, err.message);
      }
      return makeError(id, -32603, err.message || 'Internal error');
    }
  }

  function makeError(id, code, message) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
  }

  // ── Transport ─────────────────────────────────────────

  function send(message) {
    if (!message) return;
    const json = JSON.stringify(message);
    output.write(json + '\n');
  }

  /**
   * Start the MCP server (stdin/stdout transport).
   * Reads JSON-RPC messages line by line from stdin.
   */
  function start() {
    const rl = createInterface({ input, terminal: false });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const message = JSON.parse(trimmed);
        const response = dispatch(message);
        if (response) send(response);
      } catch (err) {
        send(makeError(null, -32700, 'Parse error: ' + err.message));
      }
    });

    rl.on('close', () => {
      log('[mcp] stdin closed, shutting down');
    });

    log('[mcp] MCP server started (stdin/stdout transport)');
  }

  /**
   * Process a single JSON-RPC message (for HTTP proxy or testing).
   * @param {object} message - JSON-RPC message object
   * @returns {object|null} Response message or null for notifications
   */
  function processMessage(message) {
    return dispatch(message);
  }

  return {
    start,
    processMessage,
    getTools: () => TOOLS,
    getResources: () => RESOURCES,
  };
}
