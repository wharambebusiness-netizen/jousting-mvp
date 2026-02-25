// Export Utilities + Routes Tests (Phase 36)
import { describe, it, expect } from 'vitest';
import {
  toCSV, toJSON, toJSONLines, flattenObject, setExportHeaders, fileTimestamp,
} from '../export.mjs';
import { createExportRoutes } from '../routes/export.mjs';

// ── toCSV ────────────────────────────────────────────────────

describe('toCSV', () => {
  it('produces valid CSV with headers from first row keys', () => {
    const rows = [
      { id: '1', name: 'Alice', status: 'active' },
      { id: '2', name: 'Bob', status: 'idle' },
    ];
    const csv = toCSV(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('id,name,status');
    expect(lines[1]).toBe('1,Alice,active');
    expect(lines[2]).toBe('2,Bob,idle');
  });

  it('with custom columns uses those column labels as headers', () => {
    const rows = [{ id: '1', name: 'Alice' }];
    const columns = [
      { key: 'id', label: 'Task ID' },
      { key: 'name', label: 'Full Name' },
    ];
    const csv = toCSV(rows, columns);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Task ID,Full Name');
    expect(lines[1]).toBe('1,Alice');
  });

  it('escapes commas in values', () => {
    const rows = [{ desc: 'one, two, three' }];
    const csv = toCSV(rows);
    expect(csv).toContain('"one, two, three"');
  });

  it('escapes quotes in values by doubling them', () => {
    const rows = [{ desc: 'say "hello"' }];
    const csv = toCSV(rows);
    expect(csv).toContain('"say ""hello"""');
  });

  it('handles newlines in values by wrapping in quotes', () => {
    const rows = [{ desc: 'line1\nline2' }];
    const csv = toCSV(rows);
    expect(csv).toContain('"line1\nline2"');
  });

  it('with empty rows returns empty string', () => {
    expect(toCSV([])).toBe('');
  });

  it('with empty rows but columns returns headers only', () => {
    const columns = [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }];
    const csv = toCSV([], columns);
    expect(csv).toBe('ID,Name');
  });

  it('handles null and undefined values', () => {
    const rows = [{ a: null, b: undefined, c: 'ok' }];
    const csv = toCSV(rows);
    const lines = csv.split('\n');
    expect(lines[1]).toBe(',,ok');
  });

  it('handles object values by JSON stringifying', () => {
    const rows = [{ data: { x: 1 } }];
    const csv = toCSV(rows);
    // Object value should be stringified and the braces/quotes escaped
    expect(csv).toContain('data');
    const lines = csv.split('\n');
    expect(lines[1]).toContain('{');
  });
});

// ── toJSON ───────────────────────────────────────────────────

describe('toJSON', () => {
  it('returns formatted JSON array', () => {
    const rows = [{ id: 1, name: 'test' }];
    const json = toJSON(rows);
    expect(json).toBe(JSON.stringify(rows, null, 2));
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(rows);
  });

  it('with empty array returns []', () => {
    expect(toJSON([])).toBe('[]');
  });
});

// ── toJSONLines ──────────────────────────────────────────────

describe('toJSONLines', () => {
  it('returns one JSON object per line', () => {
    const rows = [{ a: 1 }, { b: 2 }];
    const jsonl = toJSONLines(rows);
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ b: 2 });
  });

  it('with empty array returns empty string', () => {
    expect(toJSONLines([])).toBe('');
  });
});

// ── flattenObject ────────────────────────────────────────────

describe('flattenObject', () => {
  it('flattens nested objects with underscore', () => {
    const obj = { a: { b: 1, c: { d: 2 } } };
    const flat = flattenObject(obj);
    expect(flat).toEqual({ a_b: 1, a_c_d: 2 });
  });

  it('handles null/undefined values', () => {
    const obj = { a: null, b: undefined, c: 'ok' };
    const flat = flattenObject(obj);
    expect(flat).toEqual({ a: '', b: '', c: 'ok' });
  });

  it('handles arrays by stringify', () => {
    const obj = { tags: ['a', 'b'], count: 3 };
    const flat = flattenObject(obj);
    expect(flat.tags).toBe('["a","b"]');
    expect(flat.count).toBe(3);
  });

  it('handles flat object with no change', () => {
    const obj = { x: 1, y: 'hello', z: true };
    const flat = flattenObject(obj);
    expect(flat).toEqual({ x: 1, y: 'hello', z: true });
  });

  it('supports custom separator', () => {
    const obj = { a: { b: 1 } };
    const flat = flattenObject(obj, '', '.');
    expect(flat).toEqual({ 'a.b': 1 });
  });
});

// ── setExportHeaders ─────────────────────────────────────────

describe('setExportHeaders', () => {
  function mockRes() {
    const headers = {};
    return {
      set(key, val) { headers[key] = val; },
      _headers: headers,
    };
  }

  it('sets Content-Disposition for csv', () => {
    const res = mockRes();
    setExportHeaders(res, 'tasks-20260225', 'csv');
    expect(res._headers['Content-Disposition']).toBe('attachment; filename="tasks-20260225.csv"');
  });

  it('sets Content-Type text/csv for csv format', () => {
    const res = mockRes();
    setExportHeaders(res, 'data', 'csv');
    expect(res._headers['Content-Type']).toBe('text/csv');
  });

  it('sets Content-Type application/json for json format', () => {
    const res = mockRes();
    setExportHeaders(res, 'data', 'json');
    expect(res._headers['Content-Type']).toBe('application/json');
  });

  it('sets Content-Type application/x-ndjson for jsonl format', () => {
    const res = mockRes();
    setExportHeaders(res, 'data', 'jsonl');
    expect(res._headers['Content-Type']).toBe('application/x-ndjson');
  });

  it('sets correct extension for jsonl', () => {
    const res = mockRes();
    setExportHeaders(res, 'audit-export', 'jsonl');
    expect(res._headers['Content-Disposition']).toBe('attachment; filename="audit-export.jsonl"');
  });
});

// ── fileTimestamp ─────────────────────────────────────────────

describe('fileTimestamp', () => {
  it('returns a filename-safe timestamp string', () => {
    const ts = fileTimestamp();
    // Format: YYYYMMDD-HHmmss
    expect(ts).toMatch(/^\d{8}-\d{6}$/);
  });
});

// ── Export Routes ────────────────────────────────────────────

describe('createExportRoutes', () => {
  // Helper: simulate Express req/res
  function mockReq(query = {}) {
    return { query };
  }

  function mockRes() {
    const data = { status: 200, headers: {}, body: null };
    const res = {
      status(code) { data.status = code; return res; },
      json(obj) { data.body = obj; data.headers['Content-Type'] = 'application/json'; },
      send(body) { data.body = body; },
      set(key, val) { data.headers[key] = val; },
      _data: data,
    };
    return res;
  }

  // Extract route handler from router
  function getHandler(router, method, path) {
    for (const layer of router.stack) {
      if (layer.route && layer.route.path === path) {
        const handlers = layer.route.stack.filter(s => s.method === method);
        if (handlers.length > 0) return handlers[0].handle;
      }
    }
    return null;
  }

  // ── Tasks ────────────────────────────────────────────────

  it('tasks export returns CSV with correct headers', () => {
    const taskQueue = {
      getAll: () => [
        { id: 't1', task: 'Do stuff', status: 'pending', priority: 5, category: 'dev' },
        { id: 't2', task: 'Test it', status: 'complete', priority: 1, category: 'test' },
      ],
    };
    const router = createExportRoutes({ coordinator: { taskQueue } });
    const handler = getHandler(router, 'get', '/export/tasks');

    const req = mockReq({ format: 'csv' });
    const res = mockRes();
    handler(req, res);

    expect(res._data.headers['Content-Type']).toBe('text/csv');
    expect(res._data.headers['Content-Disposition']).toContain('tasks-');
    expect(res._data.headers['Content-Disposition']).toContain('.csv');
    expect(res._data.body).toContain('id,task,status,priority,category');
    expect(res._data.body).toContain('t1,Do stuff,pending,5,dev');
  });

  it('tasks export returns JSON format', () => {
    const taskQueue = {
      getAll: () => [{ id: 't1', task: 'X', status: 'pending' }],
    };
    const router = createExportRoutes({ coordinator: { taskQueue } });
    const handler = getHandler(router, 'get', '/export/tasks');

    const req = mockReq({ format: 'json' });
    const res = mockRes();
    handler(req, res);

    expect(res._data.headers['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(res._data.body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('t1');
  });

  it('tasks export returns JSONL format', () => {
    const taskQueue = {
      getAll: () => [
        { id: 't1', task: 'A' },
        { id: 't2', task: 'B' },
      ],
    };
    const router = createExportRoutes({ coordinator: { taskQueue } });
    const handler = getHandler(router, 'get', '/export/tasks');

    const req = mockReq({ format: 'jsonl' });
    const res = mockRes();
    handler(req, res);

    const lines = res._data.body.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('t1');
    expect(JSON.parse(lines[1]).id).toBe('t2');
  });

  it('tasks export filters by status', () => {
    const taskQueue = {
      getAll: () => [
        { id: 't1', status: 'pending' },
        { id: 't2', status: 'complete' },
        { id: 't3', status: 'pending' },
      ],
    };
    const router = createExportRoutes({ coordinator: { taskQueue } });
    const handler = getHandler(router, 'get', '/export/tasks');

    const req = mockReq({ format: 'json', status: 'pending' });
    const res = mockRes();
    handler(req, res);

    const parsed = JSON.parse(res._data.body);
    expect(parsed).toHaveLength(2);
    expect(parsed.every(t => t.status === 'pending')).toBe(true);
  });

  // ── Audit ────────────────────────────────────────────────

  it('audit export returns entries in chosen format', () => {
    const auditLog = {
      query: () => ({
        entries: [
          { ts: '2026-01-01T00:00:00Z', action: 'task.complete', actor: null, target: 't1' },
        ],
        total: 1,
      }),
    };
    const router = createExportRoutes({ auditLog });
    const handler = getHandler(router, 'get', '/export/audit');

    const req = mockReq({ format: 'csv' });
    const res = mockRes();
    handler(req, res);

    expect(res._data.headers['Content-Type']).toBe('text/csv');
    expect(res._data.body).toContain('ts,action,actor,target');
  });

  // ── Messages ─────────────────────────────────────────────

  it('messages export works', () => {
    const messageBus = {
      getAll: () => [
        { id: 'm1', from: 'term-1', to: null, content: 'hello', category: 'general', timestamp: '2026-01-01T00:00:00Z' },
      ],
    };
    const router = createExportRoutes({ messageBus });
    const handler = getHandler(router, 'get', '/export/messages');

    const req = mockReq({ format: 'json' });
    const res = mockRes();
    handler(req, res);

    const parsed = JSON.parse(res._data.body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('m1');
  });

  // ── Dead Letters ─────────────────────────────────────────

  it('dead letters export works', () => {
    const deadLetterQueue = {
      getAll: () => ({
        entries: [
          { id: 'd1', taskId: 't1', status: 'pending', error: 'timeout' },
        ],
        total: 1,
      }),
    };
    const router = createExportRoutes({ deadLetterQueue });
    const handler = getHandler(router, 'get', '/export/dead-letters');

    const req = mockReq({ format: 'json' });
    const res = mockRes();
    handler(req, res);

    const parsed = JSON.parse(res._data.body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('d1');
  });

  // ── 503 when subsystem not available ─────────────────────

  it('returns 503 when coordinator not available', () => {
    const router = createExportRoutes({});
    const handler = getHandler(router, 'get', '/export/tasks');

    const req = mockReq({});
    const res = mockRes();
    handler(req, res);

    expect(res._data.status).toBe(503);
    expect(res._data.body.error).toContain('not available');
  });

  it('returns 503 when audit log not available', () => {
    const router = createExportRoutes({});
    const handler = getHandler(router, 'get', '/export/audit');

    const req = mockReq({});
    const res = mockRes();
    handler(req, res);

    expect(res._data.status).toBe(503);
  });

  it('returns 503 when message bus not available', () => {
    const router = createExportRoutes({});
    const handler = getHandler(router, 'get', '/export/messages');

    const req = mockReq({});
    const res = mockRes();
    handler(req, res);

    expect(res._data.status).toBe(503);
  });

  it('returns 503 when DLQ not available', () => {
    const router = createExportRoutes({});
    const handler = getHandler(router, 'get', '/export/dead-letters');

    const req = mockReq({});
    const res = mockRes();
    handler(req, res);

    expect(res._data.status).toBe(503);
  });

  // ── Default format ───────────────────────────────────────

  it('default format is json when not specified', () => {
    const taskQueue = {
      getAll: () => [{ id: 't1' }],
    };
    const router = createExportRoutes({ coordinator: { taskQueue } });
    const handler = getHandler(router, 'get', '/export/tasks');

    const req = mockReq({}); // no format param
    const res = mockRes();
    handler(req, res);

    expect(res._data.headers['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(res._data.body);
    expect(parsed).toHaveLength(1);
  });
});
