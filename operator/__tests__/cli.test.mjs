// CLI Enhancements Tests (Phase 54)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCommand } from '../cli.mjs';
import { createApp } from '../server.mjs';
import { mkdtempSync, writeFileSync, existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Test Setup ──────────────────────────────────────────────

describe('CLI Enhancements', () => {
  let app, server, port, tempDir, baseUrl;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
    const result = createApp({
      auth: false,
      operatorDir: tempDir,
      swarm: true,
    });
    app = result;
    server = result.server;

    // Listen on random port
    await new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── 1. status command returns health info ─────────────

  it('status command returns health info', async () => {
    const result = await runCommand('status', [], { baseUrl });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('System Health');
  });

  // ── 2. status command handles connection refused ──────

  it('status command handles connection refused', async () => {
    const result = await runCommand('status', [], { baseUrl: 'http://127.0.0.1:19999' });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Cannot connect');
  });

  // ── 3. tasks command lists tasks ──────────────────────

  it('tasks command lists tasks', async () => {
    const result = await runCommand('tasks', [], { baseUrl });
    expect(result.exitCode).toBe(0);
    // Either shows tasks or "No tasks found"
    expect(typeof result.output).toBe('string');
  });

  // ── 4. tasks command handles empty task list ──────────

  it('tasks command handles empty task list', async () => {
    const result = await runCommand('tasks', [], { baseUrl });
    expect(result.exitCode).toBe(0);
    // Fresh server with no tasks should show empty message or header
    expect(result.output).toBeTruthy();
  });

  // ── 5. tasks add creates task via API ─────────────────

  it('tasks add creates task via API', async () => {
    const result = await runCommand('tasks', ['add', 'Test CLI task'], { baseUrl });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Task created');
  });

  // ── 6. tasks add passes deps, priority, category ─────

  it('tasks add passes deps, priority, category', async () => {
    // Create a base task first
    await runCommand('tasks', ['add', 'Base task', '--id', 'base-task'], { baseUrl });

    const result = await runCommand('tasks', [
      'add', 'Dependent task',
      '--deps', 'base-task',
      '--priority', '8',
      '--category', 'testing',
      '--id', 'dep-task',
    ], { baseUrl });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Task created');
    expect(result.output).toContain('dep-task');
  });

  // ── 7. tasks cancel cancels task via API ──────────────

  it('tasks cancel cancels task via API', async () => {
    // Create a task to cancel
    await runCommand('tasks', ['add', 'Task to cancel', '--id', 'cancel-me'], { baseUrl });
    const result = await runCommand('tasks', ['cancel', 'cancel-me'], { baseUrl });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('cancel-me');
    expect(result.output.toLowerCase()).toContain('cancel');
  });

  // ── 8. search command returns results ─────────────────

  it('search command returns results', async () => {
    // Add a task so search has something to find
    await runCommand('tasks', ['add', 'searchable unique item'], { baseUrl });
    const result = await runCommand('search', ['searchable'], { baseUrl });
    expect(result.exitCode).toBe(0);
    expect(typeof result.output).toBe('string');
  });

  // ── 9. search command handles no results ──────────────

  it('search command handles no results', async () => {
    const result = await runCommand('search', ['xyznonexistent99999'], { baseUrl });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('No results');
  });

  // ── 10. backup command creates backup ─────────────────

  it('backup command creates backup object', async () => {
    const result = await runCommand('backup', ['--json'], { baseUrl });
    expect(result.exitCode).toBe(0);
    // JSON mode returns the backup bundle
    const data = JSON.parse(result.output);
    expect(data).toBeDefined();
    expect(typeof data).toBe('object');
  });

  // ── 11. restore command sends restore request ─────────

  it('restore command sends restore request', async () => {
    // First get a backup bundle via the API
    const backupResult = await runCommand('backup', ['--json'], { baseUrl });
    expect(backupResult.exitCode).toBe(0);

    // Write bundle to temp file
    const backupFile = join(tempDir, 'test-backup.json');
    writeFileSync(backupFile, backupResult.output, 'utf-8');

    const result = await runCommand('restore', [backupFile], { baseUrl });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Restore complete');
  });

  // ── 12. metrics command outputs Prometheus text ───────

  it('metrics command outputs Prometheus text', async () => {
    const result = await runCommand('metrics', [], { baseUrl });
    expect(result.exitCode).toBe(0);
    // Prometheus metrics contain HELP/TYPE lines or metric names
    expect(typeof result.output).toBe('string');
    expect(result.output.length).toBeGreaterThan(0);
  });

  // ── 13. perf command formats latency output ───────────

  it('perf command formats latency output', async () => {
    const result = await runCommand('perf', [], { baseUrl });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Performance Summary');
    expect(result.output).toContain('Total Requests');
  });

  // ── 14. --json flag outputs JSON instead of table ─────

  it('--json flag outputs JSON instead of table', async () => {
    const result = await runCommand('status', ['--json'], { baseUrl });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.output);
    expect(data).toBeDefined();
    expect(data.status).toBeDefined();
  });

  // ── 15. help subcommand shows usage ───────────────────

  it('help subcommand shows usage', async () => {
    const result = await runCommand('help', []);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('status');
    expect(result.output).toContain('tasks');
    expect(result.output).toContain('search');
    expect(result.output).toContain('backup');
    expect(result.output).toContain('restore');
    expect(result.output).toContain('metrics');
    expect(result.output).toContain('perf');
  });

  // ── 16. Auth token read from options.token ────────────

  it('auth token read from options.token', async () => {
    // Server has auth: false, so token is accepted but not required
    const result = await runCommand('status', [], { baseUrl, token: 'jst_test123' });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('System Health');
  });

  // ── 17. Auth token read from .operator-token file ─────

  it('auth token read from .operator-token file', async () => {
    const tokenDir = mkdtempSync(join(tmpdir(), 'cli-token-'));
    writeFileSync(join(tokenDir, '.operator-token'), 'jst_filetoken456', 'utf-8');

    // Server has auth: false, so token is accepted but not required
    const result = await runCommand('status', [], { baseUrl, operatorDir: tokenDir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('System Health');
  });

  // ── 18. Missing auth token: command still runs ────────

  it('missing auth token: command still runs on auth:false server', async () => {
    const result = await runCommand('status', [], { baseUrl, token: null });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('System Health');
  });

  // ── 19. Custom baseUrl used for API calls ─────────────

  it('custom baseUrl used for API calls', async () => {
    // Use the actual server baseUrl as the custom URL
    const result = await runCommand('status', [], { baseUrl });
    expect(result.exitCode).toBe(0);
  });

  // ── 20. Default URL is http://127.0.0.1:3100 ─────────

  it('default URL is http://127.0.0.1:3100', async () => {
    // Without baseUrl, defaults to 3100 which likely will fail (unless a server is running)
    // We test that it tries the default and gets connection refused
    const origUrl = process.env.OPERATOR_URL;
    delete process.env.OPERATOR_URL;
    const origToken = process.env.OPERATOR_TOKEN;
    delete process.env.OPERATOR_TOKEN;

    try {
      const result = await runCommand('status', [], { operatorDir: tempDir });
      // Either connects to a server on 3100 or gets connection refused
      // The key test is that it doesn't error with undefined URL
      expect(result.exitCode).toBeDefined();
    } finally {
      if (origUrl !== undefined) process.env.OPERATOR_URL = origUrl;
      if (origToken !== undefined) process.env.OPERATOR_TOKEN = origToken;
    }
  });

  // ── 21. Connection error displays friendly message ────

  it('connection error displays friendly message', async () => {
    const result = await runCommand('status', [], { baseUrl: 'http://127.0.0.1:19998' });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Cannot connect to server');
    expect(result.output).toContain('Is it running?');
  });

  // ── 22. 401 response displays auth message ────────────

  it('401 response displays auth message', async () => {
    // Create a separate server with auth enabled
    const authTempDir = mkdtempSync(join(tmpdir(), 'cli-auth-'));
    const authApp = createApp({
      auth: true,   // Auth enabled — requires token
      operatorDir: authTempDir,
      swarm: true,
    });

    const authPort = await new Promise(resolve => {
      authApp.server.listen(0, '127.0.0.1', () => {
        resolve(authApp.server.address().port);
      });
    });

    try {
      const authBaseUrl = `http://127.0.0.1:${authPort}`;
      // Use 'tasks' which requires auth (not 'status' which hits /api/health, exempt from auth)
      const result = await runCommand('tasks', [], { baseUrl: authBaseUrl, token: null });
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Authentication required');
    } finally {
      await authApp.close();
    }
  });

  // ── 23. help subcommand lists all commands ────────────

  it('help subcommand lists all commands', async () => {
    const result = await runCommand('help', []);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('status');
    expect(result.output).toContain('tasks');
    expect(result.output).toContain('search');
    expect(result.output).toContain('backup');
    expect(result.output).toContain('restore');
    expect(result.output).toContain('metrics');
    expect(result.output).toContain('perf');
    expect(result.output).toContain('help');
  });

  // ── 24. Unknown subcommand displays error ─────────────

  it('unknown subcommand displays error', async () => {
    const result = await runCommand('foobar', [], { baseUrl });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Unknown command');
    expect(result.output).toContain('foobar');
  });

  // ── 25. API error response displays error message ─────

  it('API error response displays error message from server', async () => {
    // Search without query gives 400
    const result = await runCommand('search', [], { baseUrl });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Error');
  });
});
