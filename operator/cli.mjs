// ============================================================
// CLI Subcommand Dispatcher (Phase 54)
// ============================================================
// Handles CLI subcommands by making HTTP requests to a running
// operator server. Returns { exitCode, output } for testability.
//
// Usage:
//   node operator/server.mjs status
//   node operator/server.mjs tasks
//   node operator/server.mjs search "query"
//   node operator/server.mjs backup
//   node operator/server.mjs restore <file>
//   node operator/server.mjs metrics
//   node operator/server.mjs perf
//   node operator/server.mjs help
// ============================================================

import { request as httpRequest } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const HELP_TEXT = `
Operator CLI — subcommands (run against a live server)

  status                      Show system health
  tasks                       List all tasks
  tasks add "desc" [options]  Add a new task
    --deps id1,id2              Task dependencies
    --priority N                Priority (0-10)
    --category CAT              Task category
    --id TASK-ID                Custom task ID
  tasks cancel <id>           Cancel a task
  search <query>              Global search
  backup                      Create backup (saves to file)
  restore <file>              Restore from backup file
  metrics                     Show Prometheus metrics
  perf                        Show performance stats
  help                        Show this help

Options:
  --json                      Output raw JSON
  --url URL                   Server URL (default: http://127.0.0.1:3100)
  --token TOKEN               Auth token

Environment:
  OPERATOR_URL                Server base URL
  OPERATOR_TOKEN              Auth token
`.trim();

/**
 * Run a CLI subcommand against a running operator server.
 * @param {string} command - The subcommand name
 * @param {string[]} args - Additional arguments
 * @param {object} options - { baseUrl, token, json, operatorDir }
 * @returns {Promise<{ exitCode: number, output: string }>}
 */
export async function runCommand(command, args = [], options = {}) {
  // Resolve configuration
  const baseUrl = options.baseUrl
    || process.env.OPERATOR_URL
    || 'http://127.0.0.1:3100';

  let token = options.token || process.env.OPERATOR_TOKEN || null;
  if (!token) {
    const opDir = options.operatorDir || '.';
    const tokenPath = join(opDir, '.operator-token');
    if (existsSync(tokenPath)) {
      try { token = readFileSync(tokenPath, 'utf-8').trim(); } catch { /* ignore */ }
    }
  }

  // Parse --json flag from args
  let jsonMode = options.json || false;
  const filteredArgs = [];
  for (const arg of args) {
    if (arg === '--json') { jsonMode = true; continue; }
    filteredArgs.push(arg);
  }

  // Internal HTTP helper
  function apiCall(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (token) opts.headers['Authorization'] = `Bearer ${token}`;

      const req = httpRequest(opts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // Error handling wrapper
  async function safeCall(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'ECONNREFUSED') {
        return { exitCode: 1, output: `Cannot connect to server at ${baseUrl}. Is it running?` };
      }
      return { exitCode: 1, output: `Error: ${err.message}` };
    }
  }

  // Response error checker
  function checkError(res) {
    if (res.status === 401) {
      return { exitCode: 1, output: 'Authentication required. Set OPERATOR_TOKEN or create .operator-token file.' };
    }
    if (res.status >= 400) {
      const msg = (res.data && typeof res.data === 'object' && res.data.error)
        ? res.data.error
        : `HTTP ${res.status}`;
      return { exitCode: 1, output: `Error: ${msg}` };
    }
    return null;
  }

  // ── Subcommand handlers ────────────────────────────────────

  if (command === 'help') {
    return { exitCode: 0, output: HELP_TEXT };
  }

  if (command === 'status') {
    return safeCall(async () => {
      const res = await apiCall('GET', '/api/health');
      const err = checkError(res);
      if (err) return err;

      if (jsonMode) return { exitCode: 0, output: JSON.stringify(res.data, null, 2) };

      const d = res.data;
      const lines = [`System Health: ${d.status || 'unknown'}`];
      if (d.components) {
        for (const [name, info] of Object.entries(d.components)) {
          const st = typeof info === 'object' ? (info.status || 'unknown') : info;
          lines.push(`  ${name}: ${st}`);
        }
      }
      if (d.uptime) lines.push(`Uptime: ${d.uptime}s`);
      return { exitCode: 0, output: lines.join('\n') };
    });
  }

  if (command === 'tasks') {
    return safeCall(async () => {
      const sub = filteredArgs[0];

      // tasks add "description" [--deps x,y] [--priority N] [--category CAT] [--id ID]
      if (sub === 'add') {
        const description = filteredArgs[1];
        if (!description) return { exitCode: 1, output: 'Error: task description required. Usage: tasks add "description"' };

        const body = { task: description, id: `cli-${randomBytes(6).toString('hex')}` };
        for (let i = 2; i < filteredArgs.length; i++) {
          const a = filteredArgs[i];
          if (a === '--deps' && filteredArgs[i + 1]) {
            body.deps = filteredArgs[++i].split(',').map(s => s.trim()).filter(Boolean);
          } else if (a === '--priority' && filteredArgs[i + 1]) {
            body.priority = parseInt(filteredArgs[++i], 10);
          } else if (a === '--category' && filteredArgs[i + 1]) {
            body.category = filteredArgs[++i];
          } else if (a === '--id' && filteredArgs[i + 1]) {
            body.id = filteredArgs[++i];
          }
        }

        const res = await apiCall('POST', '/api/coordination/tasks', body);
        const err = checkError(res);
        if (err) return err;

        if (jsonMode) return { exitCode: 0, output: JSON.stringify(res.data, null, 2) };
        const t = res.data;
        return { exitCode: 0, output: `Task created: ${t.id || 'unknown'} — ${t.task || description}` };
      }

      // tasks cancel <id>
      if (sub === 'cancel') {
        const id = filteredArgs[1];
        if (!id) return { exitCode: 1, output: 'Error: task ID required. Usage: tasks cancel <id>' };
        const res = await apiCall('POST', `/api/coordination/tasks/${encodeURIComponent(id)}/cancel`);
        const err = checkError(res);
        if (err) return err;

        if (jsonMode) return { exitCode: 0, output: JSON.stringify(res.data, null, 2) };
        return { exitCode: 0, output: `Task ${id} cancelled.` };
      }

      // tasks (list)
      const res = await apiCall('GET', '/api/coordination/tasks');
      const err = checkError(res);
      if (err) return err;

      if (jsonMode) return { exitCode: 0, output: JSON.stringify(res.data, null, 2) };

      // Accept both { items: [...] } (paginated) and raw array
      const tasks = Array.isArray(res.data) ? res.data
        : (res.data.items || res.data.tasks || []);

      if (tasks.length === 0) return { exitCode: 0, output: 'No tasks found.' };

      const lines = ['ID                   Status      Pri  Category     Worker'];
      lines.push('─'.repeat(70));
      for (const t of tasks) {
        const id = (t.id || '').slice(0, 20).padEnd(20);
        const status = (t.status || '').padEnd(11);
        const pri = String(t.priority ?? '-').padEnd(4);
        const cat = (t.category || '-').padEnd(12);
        const worker = t.assignedTo || t.worker || '-';
        lines.push(`${id} ${status} ${pri} ${cat} ${worker}`);
      }
      return { exitCode: 0, output: lines.join('\n') };
    });
  }

  if (command === 'search') {
    return safeCall(async () => {
      const query = filteredArgs[0];
      if (!query) return { exitCode: 1, output: 'Error: search query required. Usage: search <query>' };

      const res = await apiCall('GET', `/api/search?q=${encodeURIComponent(query)}`);
      const err = checkError(res);
      if (err) return err;

      if (jsonMode) return { exitCode: 0, output: JSON.stringify(res.data, null, 2) };

      const results = res.data.results || [];
      if (results.length === 0) return { exitCode: 0, output: `No results for "${query}".` };

      // Group by source
      const groups = {};
      for (const r of results) {
        const src = r.source || 'unknown';
        if (!groups[src]) groups[src] = [];
        groups[src].push(r);
      }

      const lines = [`Search results for "${query}" (${results.length} found):`];
      for (const [source, items] of Object.entries(groups)) {
        lines.push(`\n  [${source}]`);
        for (const item of items) {
          const title = item.title || item.id || item.text || '(untitled)';
          const score = item.score != null ? ` (score: ${item.score})` : '';
          lines.push(`    - ${title}${score}`);
        }
      }
      return { exitCode: 0, output: lines.join('\n') };
    });
  }

  if (command === 'backup') {
    return safeCall(async () => {
      const res = await apiCall('POST', '/api/backup');
      const err = checkError(res);
      if (err) return err;

      if (jsonMode) return { exitCode: 0, output: JSON.stringify(res.data, null, 2) };

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const filename = `operator-backup-${stamp}.json`;
      const content = JSON.stringify(res.data, null, 2);

      // Write to current working directory
      const { writeFileSync: writeFs } = await import('node:fs');
      writeFs(filename, content, 'utf-8');

      const sizeKb = Math.round(content.length / 1024 * 10) / 10;
      return { exitCode: 0, output: `Backup saved: ${filename} (${sizeKb} KB)` };
    });
  }

  if (command === 'restore') {
    return safeCall(async () => {
      const file = filteredArgs[0];
      if (!file) return { exitCode: 1, output: 'Error: backup file required. Usage: restore <file>' };

      if (!existsSync(file)) {
        return { exitCode: 1, output: `Error: file not found: ${file}` };
      }

      let bundle;
      try {
        bundle = JSON.parse(readFileSync(file, 'utf-8'));
      } catch (e) {
        return { exitCode: 1, output: `Error: invalid JSON in ${file}: ${e.message}` };
      }

      const res = await apiCall('POST', '/api/backup/restore', bundle);
      const err = checkError(res);
      if (err) return err;

      if (jsonMode) return { exitCode: 0, output: JSON.stringify(res.data, null, 2) };

      const d = res.data;
      const restored = (d.restored || []).length;
      const skipped = (d.skipped || []).length;
      const errors = (d.errors || []).length;
      return { exitCode: 0, output: `Restore complete: ${restored} restored, ${skipped} skipped, ${errors} errors` };
    });
  }

  if (command === 'metrics') {
    return safeCall(async () => {
      const res = await apiCall('GET', '/api/metrics');
      const err = checkError(res);
      if (err) return err;

      // Metrics endpoint returns plain text
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
      return { exitCode: 0, output: text };
    });
  }

  if (command === 'perf') {
    return safeCall(async () => {
      const res = await apiCall('GET', '/api/performance/summary');
      const err = checkError(res);
      if (err) return err;

      if (jsonMode) return { exitCode: 0, output: JSON.stringify(res.data, null, 2) };

      const d = res.data;
      const lines = [
        `Performance Summary`,
        `  Total Requests: ${d.totalRequests || 0}`,
        `  Total Errors:   ${d.totalErrors || 0}`,
        `  Avg Latency:    ${d.avgLatencyMs || 0}ms`,
        `  Error Rate:     ${((d.errorRate || 0) * 100).toFixed(2)}%`,
        `  Routes Tracked: ${d.routeCount || 0}`,
      ];

      if (d.top5Slowest && d.top5Slowest.length > 0) {
        lines.push('');
        lines.push('Route                              Avg     p50     p95     p99     Count');
        lines.push('─'.repeat(78));
        for (const s of d.top5Slowest) {
          const route = (s.route || s.key || '').slice(0, 34).padEnd(34);
          const avg = String(Math.round(s.avgMs || 0) + 'ms').padEnd(7);
          const p50 = String(Math.round(s.p50 || 0) + 'ms').padEnd(7);
          const p95 = String(Math.round(s.p95 || 0) + 'ms').padEnd(7);
          const p99 = String(Math.round(s.p99 || 0) + 'ms').padEnd(7);
          const count = String(s.count || 0);
          lines.push(`${route} ${avg} ${p50} ${p95} ${p99} ${count}`);
        }
      }

      return { exitCode: 0, output: lines.join('\n') };
    });
  }

  // Unknown subcommand
  return { exitCode: 1, output: `Unknown command: ${command}\n\nRun "help" to see available commands.` };
}
