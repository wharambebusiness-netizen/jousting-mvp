// Backup & Retention Settings UI tests (Phase 65)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createApp } from '../server.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_bkup');
let appInstance, baseUrl;

async function api(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
}

beforeAll(async () => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });

  const events = new EventBus();
  appInstance = createApp({ operatorDir: TEST_DIR, events, auth: false });
  await new Promise(resolve => {
    appInstance.server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${appInstance.server.address().port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  if (appInstance) await appInstance.close();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// ── Settings Page ───────────────────────────────────────────

describe('Settings page', () => {
  it('contains backup section', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    const html = await res.text();
    expect(html).toContain('backup-settings');
    expect(html).toContain('Backup');
  });

  it('contains retention section', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    const html = await res.text();
    expect(html).toContain('retention-settings');
    expect(html).toContain('Retention Policy');
  });

  it('has backup JS functions', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    const html = await res.text();
    expect(html).toContain('createBackup');
    expect(html).toContain('downloadBackup');
    expect(html).toContain('restoreBackup');
  });

  it('has retention JS function', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    const html = await res.text();
    expect(html).toContain('runRetention');
  });
});

// ── Backup Settings Fragment ────────────────────────────────

describe('GET /views/settings-backup', () => {
  it('returns HTML with backup section', async () => {
    const res = await api('/views/settings-backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('backup-section');
  });

  it('shows action buttons', async () => {
    const res = await api('/views/settings-backup');
    const html = await res.text();
    expect(html).toContain('Auto-Backup Now');
    expect(html).toContain('Download Full Backup');
    expect(html).toContain('Restore from File');
  });

  it('shows backup table', async () => {
    const res = await api('/views/settings-backup');
    const html = await res.text();
    expect(html).toContain('backup-table');
    expect(html).toContain('<th>Backup</th>');
    expect(html).toContain('<th>Size</th>');
  });

  it('shows empty state when no backups', async () => {
    const res = await api('/views/settings-backup');
    const html = await res.text();
    expect(html).toContain('No backups found');
  });

  it('shows backups after auto-backup', async () => {
    // Trigger auto-backup first
    const autoRes = await api('/api/backup/auto', { method: 'POST' });
    expect(autoRes.status).toBe(200);

    const res = await api('/views/settings-backup');
    const html = await res.text();
    expect(html).toContain('.backup-');
    expect(html).toContain('KB');
    expect(html).not.toContain('No backups found');
  });
});

// ── Retention Settings Fragment ─────────────────────────────

describe('GET /views/settings-retention', () => {
  it('returns HTML with retention section', async () => {
    const res = await api('/views/settings-retention');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('retention-section');
  });

  it('shows max age days', async () => {
    const res = await api('/views/settings-retention');
    const html = await res.text();
    expect(html).toContain('30');
    expect(html).toContain('Max Age (days)');
  });

  it('shows max entries', async () => {
    const res = await api('/views/settings-retention');
    const html = await res.text();
    expect(html).toContain('1000');
    expect(html).toContain('Max Entries');
  });

  it('shows cleanup button', async () => {
    const res = await api('/views/settings-retention');
    const html = await res.text();
    expect(html).toContain('Run Cleanup Now');
    expect(html).toContain('runRetention');
  });

  it('shows retention description', async () => {
    const res = await api('/views/settings-retention');
    const html = await res.text();
    expect(html).toContain('Automatically removes');
    expect(html).toContain('30 days');
  });
});

// ── Retention API ───────────────────────────────────────────

describe('POST /api/system/retention', () => {
  it('runs retention cleanup', async () => {
    const res = await api('/api/system/retention', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('messagesRemoved');
    expect(body).toHaveProperty('snapshotsRemoved');
    expect(body).toHaveProperty('tasksRemoved');
  });
});

// ── Backup API ──────────────────────────────────────────────

describe('Backup API', () => {
  it('POST /api/backup creates backup bundle', async () => {
    const res = await api('/api/backup', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.createdAt).toBeDefined();
    expect(body.files).toBeDefined();
  });

  it('GET /api/backup/list returns backup list', async () => {
    const res = await api('/api/backup/list');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
