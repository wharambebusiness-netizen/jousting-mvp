// Webhook Plugin / Formatter tests (Phase 63)
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFormatterRegistry,
  genericFormatter,
  slackFormatter,
  discordFormatter,
  eventLabel,
  eventSeverity,
} from '../plugins/formatters.mjs';
import { createWebhookManager } from '../webhooks.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Payload ────────────────────────────────────────────

const PAYLOAD = {
  event: 'chain:completed',
  data: { chainId: 'abc123', cost: 1.25, task: 'Build feature' },
  timestamp: '2026-02-28T12:00:00Z',
  webhookId: 'wh1',
};

const FAIL_PAYLOAD = {
  event: 'chain:failed',
  data: { chainId: 'xyz', error: 'Tests failing' },
  timestamp: '2026-02-28T12:00:00Z',
  webhookId: 'wh2',
};

// ── eventLabel() ────────────────────────────────────────────

describe('eventLabel', () => {
  it('returns human-readable label for known events', () => {
    expect(eventLabel('chain:completed')).toBe('Chain Completed');
    expect(eventLabel('chain:failed')).toBe('Chain Failed');
    expect(eventLabel('coord:task-created')).toBe('Task Created');
    expect(eventLabel('webhook:test')).toBe('Test Delivery');
  });

  it('returns raw event name for unknown events', () => {
    expect(eventLabel('custom:event')).toBe('custom:event');
  });
});

// ── eventSeverity() ─────────────────────────────────────────

describe('eventSeverity', () => {
  it('returns error for failure events', () => {
    expect(eventSeverity('chain:failed')).toBe('error');
    expect(eventSeverity('health:unhealthy')).toBe('error');
    expect(eventSeverity('chain:aborted')).toBe('error');
  });

  it('returns warning for degraded/warning events', () => {
    expect(eventSeverity('health:degraded')).toBe('warning');
    expect(eventSeverity('cost:budget-warning')).toBe('warning');
  });

  it('returns success for completed/created events', () => {
    expect(eventSeverity('chain:completed')).toBe('success');
    expect(eventSeverity('coord:task-created')).toBe('success');
  });

  it('returns info for other events', () => {
    expect(eventSeverity('coord:assigned')).toBe('info');
    expect(eventSeverity('custom:event')).toBe('info');
  });
});

// ── genericFormatter() ──────────────────────────────────────

describe('genericFormatter', () => {
  it('returns raw JSON payload', () => {
    const result = genericFormatter(PAYLOAD);
    expect(result.headers['Content-Type']).toBe('application/json');
    const parsed = JSON.parse(result.body);
    expect(parsed.event).toBe('chain:completed');
    expect(parsed.data.chainId).toBe('abc123');
  });

  it('preserves all payload fields', () => {
    const result = genericFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.timestamp).toBe(PAYLOAD.timestamp);
    expect(parsed.webhookId).toBe(PAYLOAD.webhookId);
  });
});

// ── slackFormatter() ────────────────────────────────────────

describe('slackFormatter', () => {
  it('returns Slack attachment format', () => {
    const result = slackFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.attachments).toBeDefined();
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].color).toBe('#10b981'); // success
  });

  it('includes blocks with event label', () => {
    const result = slackFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    const blocks = parsed.attachments[0].blocks;
    expect(blocks[0].text.text).toContain('Chain Completed');
    expect(blocks[0].text.text).toContain('chain:completed');
  });

  it('includes data fields as section fields', () => {
    const result = slackFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    const blocks = parsed.attachments[0].blocks;
    // Second block should have fields
    const fieldBlock = blocks.find(b => b.fields);
    expect(fieldBlock).toBeDefined();
    expect(fieldBlock.fields.length).toBeGreaterThan(0);
    const fieldTexts = fieldBlock.fields.map(f => f.text);
    expect(fieldTexts.some(t => t.includes('chainId'))).toBe(true);
  });

  it('includes context block with timestamp', () => {
    const result = slackFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    const blocks = parsed.attachments[0].blocks;
    const ctx = blocks.find(b => b.type === 'context');
    expect(ctx).toBeDefined();
    expect(ctx.elements[0].text).toContain('Operator');
  });

  it('uses error color for failure events', () => {
    const result = slackFormatter(FAIL_PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.attachments[0].color).toBe('#ef4444');
  });

  it('skips null/undefined data values', () => {
    const payload = { ...PAYLOAD, data: { key: null, other: 'val' } };
    const result = slackFormatter(payload);
    const parsed = JSON.parse(result.body);
    const blocks = parsed.attachments[0].blocks;
    const fieldBlock = blocks.find(b => b.fields);
    expect(fieldBlock.fields).toHaveLength(1);
    expect(fieldBlock.fields[0].text).toContain('other');
  });
});

// ── discordFormatter() ──────────────────────────────────────

describe('discordFormatter', () => {
  it('returns Discord embed format', () => {
    const result = discordFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.embeds).toBeDefined();
    expect(parsed.embeds).toHaveLength(1);
    expect(parsed.embeds[0].title).toBe('Chain Completed');
  });

  it('includes event name in description', () => {
    const result = discordFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.embeds[0].description).toContain('chain:completed');
  });

  it('uses success color for completed events', () => {
    const result = discordFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.embeds[0].color).toBe(0x10b981);
  });

  it('uses error color for failure events', () => {
    const result = discordFormatter(FAIL_PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.embeds[0].color).toBe(0xef4444);
  });

  it('includes data as embed fields', () => {
    const result = discordFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    const fields = parsed.embeds[0].fields;
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some(f => f.name === 'chainId')).toBe(true);
  });

  it('sets inline for short values', () => {
    const result = discordFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    const chainField = parsed.embeds[0].fields.find(f => f.name === 'chainId');
    expect(chainField.inline).toBe(true);
  });

  it('includes footer and timestamp', () => {
    const result = discordFormatter(PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.embeds[0].footer.text).toBe('Operator');
    expect(parsed.embeds[0].timestamp).toBe(PAYLOAD.timestamp);
  });
});

// ── createFormatterRegistry() ───────────────────────────────

describe('createFormatterRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = createFormatterRegistry();
  });

  it('lists built-in formatters', () => {
    const names = registry.list();
    expect(names).toContain('generic');
    expect(names).toContain('slack');
    expect(names).toContain('discord');
  });

  it('format() applies the correct formatter', () => {
    const slackResult = registry.format('slack', PAYLOAD);
    const parsed = JSON.parse(slackResult.body);
    expect(parsed.attachments).toBeDefined();
  });

  it('format() falls back to generic for unknown', () => {
    const result = registry.format('nonexistent', PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.event).toBe('chain:completed');
  });

  it('format() uses generic for null/empty name', () => {
    const result = registry.format(null, PAYLOAD);
    const parsed = JSON.parse(result.body);
    expect(parsed.event).toBe('chain:completed');
  });

  it('register() adds custom formatter', () => {
    registry.register('custom', (payload) => ({
      headers: { 'Content-Type': 'text/plain' },
      body: `Event: ${payload.event}`,
    }));
    const result = registry.format('custom', PAYLOAD);
    expect(result.body).toBe('Event: chain:completed');
    expect(registry.list()).toContain('custom');
  });

  it('register() rejects non-function', () => {
    expect(() => registry.register('bad', 'not a function'))
      .toThrow('Formatter must be a function');
  });

  it('register() rejects overriding built-in', () => {
    expect(() => registry.register('slack', () => {}))
      .toThrow('Cannot override built-in formatter: slack');
  });
});

// ── Webhook Manager + Format Integration ────────────────────

describe('Webhook Manager format integration', () => {
  it('register accepts format field', () => {
    const events = new EventBus();
    const wm = createWebhookManager({ events, fetch: async () => ({ status: 200 }) });
    const wh = wm.register({
      url: 'https://hooks.slack.com/test',
      events: ['chain:*'],
      format: 'slack',
    });
    expect(wh.format).toBe('slack');
  });

  it('list includes format field', () => {
    const events = new EventBus();
    const wm = createWebhookManager({ events, fetch: async () => ({ status: 200 }) });
    wm.register({ url: 'https://hooks.slack.com/test', events: ['*'], format: 'discord' });
    const items = wm.list();
    expect(items[0].format).toBe('discord');
  });

  it('get includes format field', () => {
    const events = new EventBus();
    const wm = createWebhookManager({ events, fetch: async () => ({ status: 200 }) });
    const wh = wm.register({ url: 'https://hooks.slack.com/test', events: ['*'], format: 'slack' });
    const got = wm.get(wh.id);
    expect(got.format).toBe('slack');
  });

  it('update can change format', () => {
    const events = new EventBus();
    const wm = createWebhookManager({ events, fetch: async () => ({ status: 200 }) });
    const wh = wm.register({ url: 'https://hooks.slack.com/test', events: ['*'], format: 'slack' });
    const updated = wm.update(wh.id, { format: 'discord' });
    expect(updated.format).toBe('discord');
  });

  it('defaults format to generic when not specified', () => {
    const events = new EventBus();
    const wm = createWebhookManager({ events, fetch: async () => ({ status: 200 }) });
    const wh = wm.register({ url: 'https://hooks.slack.com/test', events: ['*'] });
    expect(wh.format).toBe('generic');
  });

  it('delivers with Slack format when configured', async () => {
    const events = new EventBus();
    let sentBody = null;
    const mockFetch = async (_url, opts) => {
      sentBody = opts.body;
      return { status: 200 };
    };
    const wm = createWebhookManager({ events, fetch: mockFetch, maxRetries: 0 });
    wm.register({
      url: 'https://hooks.slack.com/test',
      events: ['chain:completed'],
      format: 'slack',
    });

    // Emit event which triggers dispatch
    events.emit('chain:completed', { chainId: 'abc' });

    // Wait for async delivery
    await new Promise(r => setTimeout(r, 50));

    expect(sentBody).toBeDefined();
    const parsed = JSON.parse(sentBody);
    expect(parsed.attachments).toBeDefined();
    expect(parsed.attachments[0].blocks).toBeDefined();

    wm.destroy();
  });

  it('delivers with Discord format when configured', async () => {
    const events = new EventBus();
    let sentBody = null;
    const mockFetch = async (_url, opts) => {
      sentBody = opts.body;
      return { status: 200 };
    };
    const wm = createWebhookManager({ events, fetch: mockFetch, maxRetries: 0 });
    wm.register({
      url: 'https://discord.com/api/webhooks/test',
      events: ['chain:failed'],
      format: 'discord',
    });

    events.emit('chain:failed', { error: 'test' });
    await new Promise(r => setTimeout(r, 50));

    expect(sentBody).toBeDefined();
    const parsed = JSON.parse(sentBody);
    expect(parsed.embeds).toBeDefined();
    expect(parsed.embeds[0].title).toBe('Chain Failed');
    expect(parsed.embeds[0].color).toBe(0xef4444);

    wm.destroy();
  });

  it('exposes formatters for custom registration', () => {
    const events = new EventBus();
    const wm = createWebhookManager({ events, fetch: async () => ({ status: 200 }) });
    expect(wm.formatters).toBeDefined();
    expect(wm.formatters.list()).toContain('slack');
    expect(wm.formatters.list()).toContain('discord');
    wm.destroy();
  });
});
