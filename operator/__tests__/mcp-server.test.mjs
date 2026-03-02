// ============================================================
// MCP Server Tests (Phase 66)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'stream';
import { createMcpServer, MCP_PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION } from '../mcp-server.mjs';

function createMockCoordinator() {
  const tasks = new Map();
  return {
    getState: () => 'running',
    taskQueue: {
      add: vi.fn((task) => tasks.set(task.id, { ...task, status: 'pending' })),
      getAll: vi.fn(() => [...tasks.values()]),
      cancel: vi.fn((id) => {
        const t = tasks.get(id);
        if (!t) throw new Error(`Task ${id} not found`);
        t.status = 'cancelled';
      }),
      assign: vi.fn(),
      start: vi.fn(),
      fail: vi.fn(),
      retry: vi.fn(),
    },
    _tasks: tasks,
  };
}

function createMockSharedMemory() {
  const store = new Map();
  return {
    get: vi.fn((key) => store.get(key)),
    set: vi.fn((key, value, source) => { store.set(key, value); return true; }),
    delete: vi.fn((key) => store.delete(key)),
    has: vi.fn((key) => store.has(key)),
    keys: vi.fn(() => [...store.keys()]),
    _store: store,
  };
}

function createMockClaudePool() {
  return {
    getStatus: vi.fn(() => [
      { id: 'master-1', status: 'running', role: 'master', assignedTask: null, activityState: 'active' },
      { id: 'worker-1', status: 'running', role: null, assignedTask: { taskId: 't1' }, activityState: 'active' },
    ]),
    getPoolStatus: vi.fn(() => ({ total: 2, running: 2, stopped: 0 })),
    getMasterTerminals: vi.fn(() => [
      { id: 'master-1', status: 'running' },
    ]),
    getMasterRegistry: vi.fn(() => []),
    shutdownAll: vi.fn().mockResolvedValue(),
    destroy: vi.fn(),
  };
}

function createMockMetrics() {
  return {
    collect: vi.fn(() => '# HELP tasks_total Total tasks\ntasks_total 42\n'),
  };
}

function createMockSearch() {
  return {
    search: vi.fn((q) => ({ results: [{ type: 'task', id: 't1', text: q }], total: 1 })),
  };
}

function createMockMasterCoordinator() {
  return {
    getMultiMasterStatus: vi.fn(() => ({
      masters: [{ id: 'master-1', alive: true }],
      totalMasters: 1,
      activeMasters: 1,
      staleMasters: 0,
    })),
  };
}

describe('MCP Server (Phase 66)', () => {
  let mcp, coordinator, sharedMemory, claudePool, metrics, search, masterCoord;

  beforeEach(() => {
    coordinator = createMockCoordinator();
    sharedMemory = createMockSharedMemory();
    claudePool = createMockClaudePool();
    metrics = createMockMetrics();
    search = createMockSearch();
    masterCoord = createMockMasterCoordinator();
    mcp = createMcpServer({
      coordinator,
      sharedMemory,
      claudePool,
      metricsCollector: metrics,
      searchEngine: search,
      masterCoordinator: masterCoord,
      log: () => {},
    });
  });

  describe('Constants', () => {
    it('should export protocol version', () => {
      expect(MCP_PROTOCOL_VERSION).toBe('2024-11-05');
    });

    it('should export server info', () => {
      expect(SERVER_NAME).toBe('jousting-operator');
      expect(SERVER_VERSION).toBe('1.0.0');
    });
  });

  describe('initialize', () => {
    it('should return protocol version and capabilities', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      });

      expect(res.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
      expect(res.result.capabilities.tools).toBeDefined();
      expect(res.result.capabilities.resources).toBeDefined();
      expect(res.result.serverInfo.name).toBe(SERVER_NAME);
    });
  });

  describe('tools/list', () => {
    it('should return all 10 tools with schemas', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      expect(res.result.tools).toHaveLength(15);
      const names = res.result.tools.map(t => t.name);
      expect(names).toContain('add_task');
      expect(names).toContain('list_tasks');
      expect(names).toContain('get_task');
      expect(names).toContain('cancel_task');
      expect(names).toContain('get_status');
      expect(names).toContain('read_shared_memory');
      expect(names).toContain('write_shared_memory');
      expect(names).toContain('list_workers');
      expect(names).toContain('get_metrics');
      expect(names).toContain('search');
    });

    it('should include input schemas for all tools', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      res.result.tools.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      });
    });
  });

  describe('tools/call — add_task', () => {
    it('should add a task', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'add_task', arguments: { id: 't1', task: 'Test task', priority: 7 } },
      });

      expect(res.result.content[0].text).toContain('added successfully');
      expect(coordinator.taskQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({ id: 't1', task: 'Test task', priority: 7 })
      );
    });
  });

  describe('tools/call — list_tasks', () => {
    it('should list all tasks', () => {
      coordinator._tasks.set('t1', { id: 't1', task: 'Task 1', status: 'pending', priority: 5 });
      coordinator._tasks.set('t2', { id: 't2', task: 'Task 2', status: 'running', priority: 3 });

      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: {} },
      });

      const tasks = JSON.parse(res.result.content[0].text);
      expect(tasks).toHaveLength(2);
    });

    it('should filter tasks by status', () => {
      coordinator._tasks.set('t1', { id: 't1', task: 'Task 1', status: 'pending', priority: 5 });
      coordinator._tasks.set('t2', { id: 't2', task: 'Task 2', status: 'running', priority: 3 });

      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: { status: 'pending' } },
      });

      const tasks = JSON.parse(res.result.content[0].text);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('t1');
    });
  });

  describe('tools/call — get_task', () => {
    it('should get a specific task', () => {
      coordinator._tasks.set('t1', { id: 't1', task: 'Task 1', status: 'pending' });

      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'get_task', arguments: { id: 't1' } },
      });

      const task = JSON.parse(res.result.content[0].text);
      expect(task.id).toBe('t1');
    });

    it('should return error for non-existent task', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'get_task', arguments: { id: 'nonexistent' } },
      });

      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toContain('not found');
    });
  });

  describe('tools/call — cancel_task', () => {
    it('should cancel a task', () => {
      coordinator._tasks.set('t1', { id: 't1', status: 'pending' });

      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'cancel_task', arguments: { id: 't1' } },
      });

      expect(res.result.content[0].text).toContain('cancelled');
      expect(coordinator.taskQueue.cancel).toHaveBeenCalledWith('t1');
    });
  });

  describe('tools/call — get_status', () => {
    it('should return system status', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'get_status', arguments: {} },
      });

      const status = JSON.parse(res.result.content[0].text);
      expect(status.coordinator).toBeDefined();
      expect(status.pool).toBeDefined();
      expect(status.masters).toBeDefined();
    });
  });

  describe('tools/call — shared memory', () => {
    it('should write shared memory', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'write_shared_memory', arguments: { key: 'test-key', value: { data: 42 } } },
      });

      expect(res.result.content[0].text).toContain('set successfully');
      expect(sharedMemory.set).toHaveBeenCalledWith('test-key', { data: 42 }, 'mcp');
    });

    it('should read shared memory', () => {
      sharedMemory._store.set('test-key', { data: 42 });

      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'read_shared_memory', arguments: { key: 'test-key' } },
      });

      const value = JSON.parse(res.result.content[0].text);
      expect(value.data).toBe(42);
    });

    it('should return error for missing key', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'read_shared_memory', arguments: { key: 'missing' } },
      });

      expect(res.result.isError).toBe(true);
    });
  });

  describe('tools/call — list_workers', () => {
    it('should list workers', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'list_workers', arguments: {} },
      });

      const workers = JSON.parse(res.result.content[0].text);
      expect(workers).toHaveLength(2);
      expect(workers[0].id).toBe('master-1');
    });
  });

  describe('tools/call — get_metrics', () => {
    it('should return Prometheus metrics', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'get_metrics', arguments: {} },
      });

      expect(res.result.content[0].text).toContain('tasks_total');
    });
  });

  describe('tools/call — search', () => {
    it('should search across subsystems', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'test' } },
      });

      expect(search.search).toHaveBeenCalledWith('test', { limit: 20 });
      const results = JSON.parse(res.result.content[0].text);
      expect(results.total).toBe(1);
    });
  });

  describe('resources/list', () => {
    it('should list resources', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 13,
        method: 'resources/list',
        params: {},
      });

      expect(res.result.resources).toHaveLength(2);
      const uris = res.result.resources.map(r => r.uri);
      expect(uris).toContain('task-queue://progress');
      expect(uris).toContain('master://status');
    });
  });

  describe('resources/read', () => {
    it('should read task-queue://progress', () => {
      coordinator._tasks.set('t1', { id: 't1', status: 'pending' });
      coordinator._tasks.set('t2', { id: 't2', status: 'complete' });

      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 14,
        method: 'resources/read',
        params: { uri: 'task-queue://progress' },
      });

      const progress = JSON.parse(res.result.contents[0].text);
      expect(progress.total).toBe(2);
      expect(progress.pending).toBe(1);
      expect(progress.complete).toBe(1);
    });

    it('should read master://status', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 15,
        method: 'resources/read',
        params: { uri: 'master://status' },
      });

      const status = JSON.parse(res.result.contents[0].text);
      expect(status.totalMasters).toBe(1);
    });

    it('should return error for unknown resource', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 16,
        method: 'resources/read',
        params: { uri: 'unknown://resource' },
      });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32602);
    });
  });

  describe('JSON-RPC protocol compliance', () => {
    it('should include jsonrpc version in responses', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 17,
        method: 'ping',
        params: {},
      });

      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(17);
    });

    it('should return method not found for unknown methods', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 18,
        method: 'unknown/method',
        params: {},
      });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32601);
    });

    it('should return null for notifications', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      });

      expect(res).toBeNull();
    });

    it('should handle missing tool name', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 19,
        method: 'tools/call',
        params: {},
      });

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32602);
    });

    it('should handle unknown tool name', () => {
      const res = mcp.processMessage({
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} },
      });

      expect(res.error).toBeDefined();
    });
  });

  describe('Validation error handling', () => {
    it('should handle missing coordinator gracefully', () => {
      const mcpNoCoord = createMcpServer({
        coordinator: null,
        sharedMemory,
        claudePool,
        log: () => {},
      });

      const res = mcpNoCoord.processMessage({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: { name: 'add_task', arguments: { id: 't1', task: 'test' } },
      });

      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toContain('not available');
    });

    it('should handle missing shared memory gracefully', () => {
      const mcpNoMem = createMcpServer({
        coordinator,
        sharedMemory: null,
        claudePool,
        log: () => {},
      });

      const res = mcpNoMem.processMessage({
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: { name: 'read_shared_memory', arguments: { key: 'test' } },
      });

      expect(res.result.isError).toBe(true);
    });

    it('should handle missing pool gracefully', () => {
      const mcpNoPool = createMcpServer({
        coordinator,
        sharedMemory,
        claudePool: null,
        log: () => {},
      });

      const res = mcpNoPool.processMessage({
        jsonrpc: '2.0',
        id: 23,
        method: 'tools/call',
        params: { name: 'list_workers', arguments: {} },
      });

      expect(res.result.isError).toBe(true);
    });
  });

  describe('getTools / getResources helpers', () => {
    it('should expose tool definitions via getTools()', () => {
      const tools = mcp.getTools();
      expect(tools).toHaveLength(15);
      expect(tools[0].name).toBe('add_task');
    });

    it('should expose resource definitions via getResources()', () => {
      const resources = mcp.getResources();
      expect(resources).toHaveLength(2);
      expect(resources[0].uri).toBe('task-queue://progress');
    });
  });

  describe('stdin/stdout transport', () => {
    it('should process lines from input stream and write to output', () => {
      const inputStream = new PassThrough();
      const outputStream = new PassThrough();

      const mcpStdio = createMcpServer({
        coordinator,
        sharedMemory,
        claudePool,
        log: () => {},
        input: inputStream,
        output: outputStream,
      });

      mcpStdio.start();

      let received = '';
      outputStream.on('data', (chunk) => { received += chunk.toString(); });

      // Send a ping
      inputStream.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }) + '\n');

      // Give it a tick to process
      return new Promise((resolve) => {
        setTimeout(() => {
          const lines = received.trim().split('\n').filter(Boolean);
          expect(lines.length).toBeGreaterThanOrEqual(1);
          const parsed = JSON.parse(lines[0]);
          expect(parsed.jsonrpc).toBe('2.0');
          expect(parsed.id).toBe(1);
          expect(parsed.result).toBeDefined();
          inputStream.end();
          resolve();
        }, 50);
      });
    });
  });
});
