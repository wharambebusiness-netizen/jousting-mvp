// Chain Edit + API Search Parity tests (Phase 66)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createApp } from '../server.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_p66');
let appInstance, baseUrl;

async function api(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
}

async function createTestChain(task = 'Test task', extra = {}) {
  const res = await api('/api/chains', {
    method: 'POST',
    body: JSON.stringify({ task, ...extra }),
  });
  return res.json();
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

// ── PATCH /api/chains/:id ───────────────────────────────────

describe('PATCH /api/chains/:id', () => {
  it('updates task description', async () => {
    const chain = await createTestChain('Original task');
    const res = await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ task: 'Updated task' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBe('Updated task');
    expect(body.id).toBe(chain.id);
  });

  it('updates metadata', async () => {
    const chain = await createTestChain('Meta test');
    const res = await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { priority: 'high', tags: ['urgent'] } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metadata).toEqual({ priority: 'high', tags: ['urgent'] });
  });

  it('updates both task and metadata', async () => {
    const chain = await createTestChain('Both test');
    const res = await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ task: 'New task', metadata: { note: 'edited' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task).toBe('New task');
    expect(body.metadata).toEqual({ note: 'edited' });
  });

  it('clears metadata with null', async () => {
    const chain = await createTestChain('Clear meta');
    await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { some: 'data' } }),
    });
    const res = await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: null }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metadata).toBeNull();
  });

  it('rejects empty task', async () => {
    const chain = await createTestChain('Reject empty');
    const res = await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ task: '   ' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('non-empty');
  });

  it('rejects non-object metadata', async () => {
    const chain = await createTestChain('Reject meta');
    const res = await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: 'not-an-object' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('object');
  });

  it('rejects empty body (no fields)', async () => {
    const chain = await createTestChain('No fields');
    const res = await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('No fields');
  });

  it('returns 404 for unknown chain', async () => {
    const res = await api('/api/chains/nonexistent-id', {
      method: 'PATCH',
      body: JSON.stringify({ task: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('updates updatedAt timestamp', async () => {
    const chain = await createTestChain('Timestamp test');
    const before = chain.updatedAt;
    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 10));
    const res = await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ task: 'Timestamp updated' }),
    });
    const body = await res.json();
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('persists changes across GET', async () => {
    const chain = await createTestChain('Persist test');
    await api(`/api/chains/${chain.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ task: 'Persisted task', metadata: { x: 1 } }),
    });
    const res = await api(`/api/chains/${chain.id}`);
    const body = await res.json();
    expect(body.task).toBe('Persisted task');
    expect(body.metadata).toEqual({ x: 1 });
  });
});

// ── GET /api/chains?q= (Text Search) ───────────────────────

describe('GET /api/chains?q=', () => {
  it('searches by task substring (case-insensitive)', async () => {
    await createTestChain('Deploy the WIDGET service');
    const res = await api('/api/chains?q=widget');
    const body = await res.json();
    expect(body.chains.some(c => c.task.includes('WIDGET'))).toBe(true);
  });

  it('searches by chain ID', async () => {
    const chain = await createTestChain('ID search test');
    const partial = chain.id.slice(0, 8);
    const res = await api(`/api/chains?q=${partial}`);
    const body = await res.json();
    expect(body.chains.some(c => c.id === chain.id)).toBe(true);
  });

  it('returns empty for no match', async () => {
    const res = await api('/api/chains?q=zzz_no_match_zzz');
    const body = await res.json();
    expect(body.chains).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('combines q with status filter', async () => {
    await createTestChain('Filter combo test');
    const res = await api('/api/chains?q=combo&status=running');
    const body = await res.json();
    for (const c of body.chains) {
      expect(c.status).toBe('running');
      expect(c.task.toLowerCase()).toContain('combo');
    }
  });

  it('ignores blank q param', async () => {
    const all = await api('/api/chains');
    const withBlank = await api('/api/chains?q=');
    const allBody = await all.json();
    const blankBody = await withBlank.json();
    expect(blankBody.total).toBe(allBody.total);
  });

  it('applies pagination after search', async () => {
    await createTestChain('Paginate search A');
    await createTestChain('Paginate search B');
    const res = await api('/api/chains?q=Paginate+search&limit=1&offset=0');
    const body = await res.json();
    expect(body.chains.length).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(2);
  });
});

// ── POST /api/settings/reset ────────────────────────────────

describe('POST /api/settings/reset', () => {
  it('resets settings to defaults', async () => {
    // First change a setting
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ model: 'opus', maxTurns: 100 }),
    });
    // Verify change took
    const changed = await (await api('/api/settings')).json();
    expect(changed.model).toBe('opus');

    // Reset
    const res = await api('/api/settings/reset', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe('sonnet');
    expect(body.maxTurns).toBe(30);
  });

  it('persists reset across GET', async () => {
    await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ maxBudgetUsd: 99 }),
    });
    await api('/api/settings/reset', { method: 'POST' });
    const res = await api('/api/settings');
    const body = await res.json();
    expect(body.maxBudgetUsd).toBe(5.0);
    expect(body.maxContinuations).toBe(5);
  });

  it('returns all default fields', async () => {
    const res = await api('/api/settings/reset', { method: 'POST' });
    const body = await res.json();
    expect(body).toHaveProperty('model', 'sonnet');
    expect(body).toHaveProperty('maxTurns', 30);
    expect(body).toHaveProperty('maxContinuations', 5);
    expect(body).toHaveProperty('maxBudgetUsd', 5.0);
    expect(body).toHaveProperty('autoPush', false);
    expect(body).toHaveProperty('particlesEnabled', true);
    expect(body).toHaveProperty('defaultTerminalTheme', 'nebula');
  });
});

// ── Bulk Archive Race Fix ───────────────────────────────────

describe('POST /api/bulk/chains/archive', () => {
  it('archives multiple chains', async () => {
    const c1 = await createTestChain('Archive test 1');
    const c2 = await createTestChain('Archive test 2');
    // Abort them first (can't archive running)
    await api(`/api/chains/${c1.id}/abort`, { method: 'POST' });
    await api(`/api/chains/${c2.id}/abort`, { method: 'POST' });

    const res = await api('/api/bulk/chains/archive', {
      method: 'POST',
      body: JSON.stringify({ ids: [c1.id, c2.id] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBe(2);
    expect(body.failed).toBe(0);

    // Verify status persisted
    const detail1 = await (await api(`/api/chains/${c1.id}`)).json();
    expect(detail1.status).toBe('archived');
  });

  it('reports missing chains', async () => {
    const res = await api('/api/bulk/chains/archive', {
      method: 'POST',
      body: JSON.stringify({ ids: ['fake-id-1', 'fake-id-2'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failed).toBe(2);
    expect(body.results.every(r => !r.success)).toBe(true);
  });

  it('does not mutate unrelated chains', async () => {
    const keep = await createTestChain('Keep this one');
    const archive = await createTestChain('Archive this');
    await api(`/api/chains/${archive.id}/abort`, { method: 'POST' });

    await api('/api/bulk/chains/archive', {
      method: 'POST',
      body: JSON.stringify({ ids: [archive.id] }),
    });

    const kept = await (await api(`/api/chains/${keep.id}`)).json();
    expect(kept.status).toBe('running');
  });
});
