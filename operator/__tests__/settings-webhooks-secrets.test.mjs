// Webhooks + Secrets Settings UI tests (Phase 64)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createApp } from '../server.mjs';
import { createRegistry } from '../registry.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_wh_sec');
let appInstance, baseUrl;

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return res;
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
  it('contains webhooks section', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    const html = await res.text();
    expect(html).toContain('webhooks-settings');
    expect(html).toContain('Webhooks');
  });

  it('contains secrets section', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    const html = await res.text();
    expect(html).toContain('secrets-settings');
    expect(html).toContain('Secrets Vault');
  });

  it('has webhook JS functions', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    const html = await res.text();
    expect(html).toContain('createWebhook');
    expect(html).toContain('deleteWebhook');
    expect(html).toContain('testWebhook');
    expect(html).toContain('toggleWebhook');
  });

  it('has secrets JS functions', async () => {
    const res = await fetch(`${baseUrl}/settings`);
    const html = await res.text();
    expect(html).toContain('createSecret');
    expect(html).toContain('deleteSecret');
    expect(html).toContain('toggleSecretReveal');
  });
});

// ── Webhooks Settings Fragment ──────────────────────────────

describe('GET /views/settings-webhooks', () => {
  it('returns HTML with webhook table', async () => {
    const res = await api('/views/settings-webhooks');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('wh-section');
    expect(html).toContain('wh-table');
  });

  it('shows empty state when no webhooks', async () => {
    const res = await api('/views/settings-webhooks');
    const html = await res.text();
    expect(html).toContain('No webhooks registered');
  });

  it('shows create form with format select', async () => {
    const res = await api('/views/settings-webhooks');
    const html = await res.text();
    expect(html).toContain('wh-create');
    expect(html).toContain('Generic');
    expect(html).toContain('Slack');
    expect(html).toContain('Discord');
  });

  it('shows registered webhooks', async () => {
    // Create a webhook first
    const createRes = await api('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['*'], format: 'slack', label: 'Test Hook' }),
    });
    expect(createRes.status).toBe(201);

    const res = await api('/views/settings-webhooks');
    const html = await res.text();
    expect(html).toContain('example.com');
    expect(html).toContain('slack');
    expect(html).toContain('Disable');
    expect(html).toContain('Delete');
  });

  it('webhook list shows format column', async () => {
    const res = await api('/views/settings-webhooks');
    const html = await res.text();
    expect(html).toContain('<th>Format</th>');
  });
});

// ── Secrets Settings Fragment ───────────────────────────────

describe('GET /views/settings-secrets', () => {
  it('returns HTML with secrets table', async () => {
    const res = await api('/views/settings-secrets');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('secrets-section');
    expect(html).toContain('secrets-table');
  });

  it('shows empty state when no secrets', async () => {
    const res = await api('/views/settings-secrets');
    const html = await res.text();
    expect(html).toContain('No secrets stored');
  });

  it('shows create form', async () => {
    const res = await api('/views/settings-secrets');
    const html = await res.text();
    expect(html).toContain('secrets-create');
    expect(html).toContain('Secret name');
    expect(html).toContain('Secret value');
    expect(html).toContain('Store Secret');
  });

  it('shows stored secrets with masked values', async () => {
    // Store a secret first
    const putRes = await api('/api/secrets/test_secret', {
      method: 'PUT',
      body: JSON.stringify({ value: 'super-secret-value' }),
    });
    expect(putRes.status).toBe(200);

    const res = await api('/views/settings-secrets');
    const html = await res.text();
    expect(html).toContain('test_secret');
    expect(html).toContain('••••••••');
    expect(html).not.toContain('super-secret-value');
    expect(html).toContain('Reveal');
    expect(html).toContain('Delete');
  });

  it('secret value has reveal toggle after storing', async () => {
    // Previous test stored 'test-secret'
    const res = await api('/views/settings-secrets');
    const html = await res.text();
    expect(html).toContain('toggleSecretReveal');
    expect(html).toContain('data-revealed="false"');
  });
});

// ── Webhook Format Integration ──────────────────────────────

describe('Webhook format in API', () => {
  it('POST /api/webhooks accepts format field', async () => {
    const res = await api('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://discord.com/api/webhooks/test',
        events: ['chain:*'],
        format: 'discord',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.format).toBe('discord');
  });

  it('GET /api/webhooks includes format field', async () => {
    const res = await api('/api/webhooks');
    const body = await res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(body.some(w => w.format === 'discord')).toBe(true);
  });

  it('PATCH /api/webhooks/:id can change format', async () => {
    // Find the discord webhook
    const listRes = await api('/api/webhooks');
    const list = await listRes.json();
    const discordWh = list.find(w => w.format === 'discord');

    const res = await api(`/api/webhooks/${discordWh.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ format: 'slack' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe('slack');
  });
});
