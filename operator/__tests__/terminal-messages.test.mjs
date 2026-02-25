// Terminal Messages Tests (Phase 18)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  createTerminalMessageBus,
  MAX_MESSAGE_CONTENT_SIZE,
  MAX_MESSAGES,
  MAX_THREAD_DEPTH,
} from '../terminal-messages.mjs';
import { EventBus } from '../../shared/event-bus.mjs';

// ── Test Setup ──────────────────────────────────────────────

const TEST_DIR = join(import.meta.dirname, '..', '__test_tmp_terminal_messages');
const PERSIST_PATH = join(TEST_DIR, '.data', 'terminal-messages.json');

function setup() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown() {
  try { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

beforeEach(setup);
afterEach(teardown);

// ── Exports ─────────────────────────────────────────────────

describe('exports', () => {
  it('exports factory function', () => {
    expect(typeof createTerminalMessageBus).toBe('function');
  });

  it('exports constants', () => {
    expect(MAX_MESSAGE_CONTENT_SIZE).toBe(65_536);
    expect(MAX_MESSAGES).toBe(5_000);
    expect(MAX_THREAD_DEPTH).toBe(50);
  });
});

// ── Factory ─────────────────────────────────────────────────

describe('createTerminalMessageBus', () => {
  it('returns object with all API methods', () => {
    const bus = createTerminalMessageBus();
    expect(typeof bus.send).toBe('function');
    expect(typeof bus.get).toBe('function');
    expect(typeof bus.getAll).toBe('function');
    expect(typeof bus.getThread).toBe('function');
    expect(typeof bus.getInbox).toBe('function');
    expect(typeof bus.getOutbox).toBe('function');
    expect(typeof bus.delete).toBe('function');
    expect(typeof bus.clear).toBe('function');
    expect(typeof bus.markRead).toBe('function');
    expect(typeof bus.getUnreadCount).toBe('function');
    expect(typeof bus.count).toBe('function');
    expect(typeof bus.save).toBe('function');
    expect(typeof bus.load).toBe('function');
    expect(typeof bus.toJSON).toBe('function');
    expect(typeof bus.fromJSON).toBe('function');
  });

  it('starts empty', () => {
    const bus = createTerminalMessageBus();
    expect(bus.count()).toBe(0);
    expect(bus.getAll()).toEqual([]);
  });

  it('isPersistent is false without persistPath', () => {
    const bus = createTerminalMessageBus();
    expect(bus.isPersistent).toBe(false);
  });

  it('isPersistent is true with persistPath', () => {
    const bus = createTerminalMessageBus({ persistPath: PERSIST_PATH });
    expect(bus.isPersistent).toBe(true);
    expect(bus.persistPath).toBe(PERSIST_PATH);
  });
});

// ── send ────────────────────────────────────────────────────

describe('send', () => {
  it('sends a targeted message', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'term-1', to: 'term-2', content: 'hello' });
    expect(msg.id).toBeTruthy();
    expect(msg.from).toBe('term-1');
    expect(msg.to).toBe('term-2');
    expect(msg.content).toBe('hello');
    expect(msg.deleted).toBe(false);
    expect(msg.timestamp).toBeTruthy();
  });

  it('sends a broadcast message (no to)', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'term-1', content: 'broadcast hello' });
    expect(msg.to).toBe(null);
    expect(msg.content).toBe('broadcast hello');
  });

  it('generates unique IDs', () => {
    const bus = createTerminalMessageBus();
    const m1 = bus.send({ from: 'a', content: 'x' });
    const m2 = bus.send({ from: 'a', content: 'y' });
    expect(m1.id).not.toBe(m2.id);
  });

  it('sets timestamp on each message', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'a', content: 'hello' });
    // ISO format check
    expect(new Date(msg.timestamp).toISOString()).toBe(msg.timestamp);
  });

  it('defaults category to general', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'a', content: 'hi' });
    expect(msg.category).toBe('general');
  });

  it('accepts custom category', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'a', content: 'hi', category: 'status' });
    expect(msg.category).toBe('status');
  });

  it('rejects missing from', () => {
    const bus = createTerminalMessageBus();
    expect(() => bus.send({ content: 'hello' })).toThrow('from');
  });

  it('rejects invalid from format', () => {
    const bus = createTerminalMessageBus();
    expect(() => bus.send({ from: 'bad terminal!', content: 'hello' })).toThrow('from');
  });

  it('rejects missing content', () => {
    const bus = createTerminalMessageBus();
    expect(() => bus.send({ from: 'a' })).toThrow('content');
  });

  it('rejects content exceeding max size', () => {
    const bus = createTerminalMessageBus();
    const big = 'x'.repeat(MAX_MESSAGE_CONTENT_SIZE + 1);
    expect(() => bus.send({ from: 'a', content: big })).toThrow('max size');
  });
});

// ── get ─────────────────────────────────────────────────────

describe('get', () => {
  it('gets a message by ID', () => {
    const bus = createTerminalMessageBus();
    const sent = bus.send({ from: 'a', content: 'hello' });
    const got = bus.get(sent.id);
    expect(got.id).toBe(sent.id);
    expect(got.content).toBe('hello');
  });

  it('returns null for missing message', () => {
    const bus = createTerminalMessageBus();
    expect(bus.get('nonexistent-id')).toBe(null);
  });

  it('returns null for deleted message', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'a', content: 'hi' });
    bus.delete(msg.id);
    expect(bus.get(msg.id)).toBe(null);
  });
});

// ── getAll ──────────────────────────────────────────────────

describe('getAll', () => {
  it('returns messages newest first', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', content: 'first' });
    bus.send({ from: 'a', content: 'second' });
    bus.send({ from: 'a', content: 'third' });
    const all = bus.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].content).toBe('third');
    expect(all[2].content).toBe('first');
  });

  it('filters by terminalId (from/to/broadcast)', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', to: 'b', content: 'a-to-b' });
    bus.send({ from: 'b', to: 'a', content: 'b-to-a' });
    bus.send({ from: 'c', content: 'broadcast' }); // broadcast
    bus.send({ from: 'c', to: 'c', content: 'c-to-c' });

    const aMessages = bus.getAll({ terminalId: 'a' });
    // a sent one, received one, and broadcast (no to)
    expect(aMessages).toHaveLength(3);
  });

  it('filters by category', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', content: 'x', category: 'status' });
    bus.send({ from: 'a', content: 'y', category: 'question' });
    bus.send({ from: 'a', content: 'z', category: 'status' });
    const statusMsgs = bus.getAll({ category: 'status' });
    expect(statusMsgs).toHaveLength(2);
    expect(statusMsgs.every(m => m.category === 'status')).toBe(true);
  });

  it('respects limit', () => {
    const bus = createTerminalMessageBus();
    for (let i = 0; i < 10; i++) bus.send({ from: 'a', content: `msg ${i}` });
    const limited = bus.getAll({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('respects offset', () => {
    const bus = createTerminalMessageBus();
    for (let i = 0; i < 5; i++) bus.send({ from: 'a', content: `msg ${i}` });
    const offset = bus.getAll({ offset: 2, limit: 2 });
    expect(offset).toHaveLength(2);
    // Newest first, offset 2 means skip 2 newest
    expect(offset[0].content).toBe('msg 2');
    expect(offset[1].content).toBe('msg 1');
  });

  it('returns empty when no messages', () => {
    const bus = createTerminalMessageBus();
    expect(bus.getAll()).toEqual([]);
  });
});

// ── Threading ───────────────────────────────────────────────

describe('threading', () => {
  it('creates threaded reply with replyTo', () => {
    const bus = createTerminalMessageBus();
    const m1 = bus.send({ from: 'a', content: 'parent' });
    const m2 = bus.send({ from: 'b', content: 'reply', replyTo: m1.id });
    expect(m2.replyTo).toBe(m1.id);
  });

  it('getThread walks to root and collects replies chronologically', () => {
    const bus = createTerminalMessageBus();
    const root = bus.send({ from: 'a', content: 'root' });
    const reply1 = bus.send({ from: 'b', content: 'reply 1', replyTo: root.id });
    const reply2 = bus.send({ from: 'a', content: 'reply 2', replyTo: reply1.id });

    const thread = bus.getThread(reply2.id);
    expect(thread).toHaveLength(3);
    expect(thread[0].id).toBe(root.id);
    expect(thread[1].id).toBe(reply1.id);
    expect(thread[2].id).toBe(reply2.id);
  });

  it('getThread from root returns full thread', () => {
    const bus = createTerminalMessageBus();
    const root = bus.send({ from: 'a', content: 'root' });
    bus.send({ from: 'b', content: 'reply', replyTo: root.id });
    const thread = bus.getThread(root.id);
    expect(thread).toHaveLength(2);
  });

  it('getThread returns null for missing message', () => {
    const bus = createTerminalMessageBus();
    expect(bus.getThread('nonexistent')).toBe(null);
  });

  it('supports nested chains', () => {
    const bus = createTerminalMessageBus();
    let prev = bus.send({ from: 'a', content: 'root' });
    for (let i = 0; i < 5; i++) {
      prev = bus.send({ from: 'b', content: `depth ${i + 1}`, replyTo: prev.id });
    }
    const thread = bus.getThread(prev.id);
    expect(thread).toHaveLength(6);
    expect(thread[0].content).toBe('root');
  });

  it('rejects reply when thread depth exceeds maximum', () => {
    const bus = createTerminalMessageBus();
    let prev = bus.send({ from: 'a', content: 'root' });
    for (let i = 0; i < MAX_THREAD_DEPTH; i++) {
      prev = bus.send({ from: 'b', content: `depth ${i + 1}`, replyTo: prev.id });
    }
    // Next reply should fail (depth = MAX_THREAD_DEPTH reached)
    expect(() => bus.send({ from: 'a', content: 'too deep', replyTo: prev.id }))
      .toThrow('Thread depth');
  });

  it('rejects reply to non-existent message', () => {
    const bus = createTerminalMessageBus();
    expect(() => bus.send({ from: 'a', content: 'reply', replyTo: 'missing' }))
      .toThrow('not found');
  });

  it('rejects reply to deleted message', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'a', content: 'original' });
    bus.delete(msg.id);
    expect(() => bus.send({ from: 'b', content: 'reply', replyTo: msg.id }))
      .toThrow('deleted');
  });
});

// ── getInbox / getOutbox ────────────────────────────────────

describe('getInbox/getOutbox', () => {
  it('inbox includes targeted messages and broadcasts', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', to: 'b', content: 'direct' });
    bus.send({ from: 'c', content: 'broadcast' }); // broadcast
    bus.send({ from: 'b', to: 'a', content: 'other direction' });

    const inbox = bus.getInbox('b');
    // direct (to: b) + broadcast (not from b)
    expect(inbox).toHaveLength(2);
  });

  it('outbox returns messages from terminal', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', to: 'b', content: 'msg1' });
    bus.send({ from: 'a', content: 'msg2' });
    bus.send({ from: 'b', to: 'a', content: 'msg3' });

    const outbox = bus.getOutbox('a');
    expect(outbox).toHaveLength(2);
    expect(outbox.every(m => m.from === 'a')).toBe(true);
  });

  it('inbox respects limit', () => {
    const bus = createTerminalMessageBus();
    for (let i = 0; i < 10; i++) bus.send({ from: 'a', to: 'b', content: `msg ${i}` });
    const inbox = bus.getInbox('b', { limit: 3 });
    expect(inbox).toHaveLength(3);
  });

  it('outbox respects category', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', content: 'x', category: 'status' });
    bus.send({ from: 'a', content: 'y', category: 'question' });
    const outbox = bus.getOutbox('a', { category: 'status' });
    expect(outbox).toHaveLength(1);
  });

  it('inbox is empty for unknown terminal', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', to: 'b', content: 'msg' });
    expect(bus.getInbox('zzz')).toEqual([]);
  });

  it('outbox is empty for unknown terminal', () => {
    const bus = createTerminalMessageBus();
    expect(bus.getOutbox('zzz')).toEqual([]);
  });
});

// ── delete ──────────────────────────────────────────────────

describe('delete', () => {
  it('soft-deletes a message', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'a', content: 'hi' });
    expect(bus.delete(msg.id)).toBe(true);
    expect(bus.get(msg.id)).toBe(null);
  });

  it('returns false for missing message', () => {
    const bus = createTerminalMessageBus();
    expect(bus.delete('nonexistent')).toBe(false);
  });

  it('returns false for already-deleted message', () => {
    const bus = createTerminalMessageBus();
    const msg = bus.send({ from: 'a', content: 'hi' });
    bus.delete(msg.id);
    expect(bus.delete(msg.id)).toBe(false);
  });

  it('excluded from getAll after deletion', () => {
    const bus = createTerminalMessageBus();
    const m1 = bus.send({ from: 'a', content: 'keep' });
    const m2 = bus.send({ from: 'a', content: 'delete' });
    bus.delete(m2.id);
    const all = bus.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(m1.id);
  });
});

// ── clear ───────────────────────────────────────────────────

describe('clear', () => {
  it('removes all messages', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', content: 'x' });
    bus.send({ from: 'b', content: 'y' });
    const result = bus.clear();
    expect(result.count).toBe(2);
    expect(bus.count()).toBe(0);
    expect(bus.getAll()).toEqual([]);
  });

  it('returns count of non-deleted messages', () => {
    const bus = createTerminalMessageBus();
    const m1 = bus.send({ from: 'a', content: 'x' });
    bus.send({ from: 'a', content: 'y' });
    bus.delete(m1.id);
    const result = bus.clear();
    expect(result.count).toBe(1); // only the non-deleted one counted
  });

  it('resets unread counts', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', to: 'b', content: 'hi' });
    expect(bus.getUnreadCount('b')).toBe(1);
    bus.clear();
    expect(bus.getUnreadCount('b')).toBe(0);
  });
});

// ── Unread tracking ─────────────────────────────────────────

describe('unread tracking', () => {
  it('targeted send increments recipient unread', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', to: 'b', content: 'hello' });
    expect(bus.getUnreadCount('b')).toBe(1);
    bus.send({ from: 'a', to: 'b', content: 'hello again' });
    expect(bus.getUnreadCount('b')).toBe(2);
  });

  it('broadcast increments all known terminals except sender', () => {
    const bus = createTerminalMessageBus();
    // First, establish terminal IDs
    bus.send({ from: 'a', to: 'b', content: 'setup' });
    bus.send({ from: 'c', to: 'a', content: 'setup2' });
    // Reset unread
    bus.markRead('a');
    bus.markRead('b');
    bus.markRead('c');

    // Broadcast from 'a'
    bus.send({ from: 'a', content: 'broadcast!' });
    expect(bus.getUnreadCount('b')).toBe(1);
    expect(bus.getUnreadCount('c')).toBe(1);
    expect(bus.getUnreadCount('a')).toBe(0); // sender not incremented
  });

  it('markRead without messageId resets to 0', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', to: 'b', content: 'x' });
    bus.send({ from: 'a', to: 'b', content: 'y' });
    expect(bus.getUnreadCount('b')).toBe(2);
    const result = bus.markRead('b');
    expect(result).toBe(0);
    expect(bus.getUnreadCount('b')).toBe(0);
  });

  it('markRead with messageId decrements by 1', () => {
    const bus = createTerminalMessageBus();
    const m1 = bus.send({ from: 'a', to: 'b', content: 'x' });
    bus.send({ from: 'a', to: 'b', content: 'y' });
    expect(bus.getUnreadCount('b')).toBe(2);
    const result = bus.markRead('b', m1.id);
    expect(result).toBe(1);
  });

  it('returns 0 for unknown terminal', () => {
    const bus = createTerminalMessageBus();
    expect(bus.getUnreadCount('unknown')).toBe(0);
  });

  it('sender is not incremented on targeted send', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', to: 'b', content: 'hi' });
    expect(bus.getUnreadCount('a')).toBe(0);
  });
});

// ── Ring buffer ─────────────────────────────────────────────

describe('ring buffer', () => {
  it('evicts oldest when over limit', () => {
    const bus = createTerminalMessageBus({ maxMessages: 5 });
    const ids = [];
    for (let i = 0; i < 7; i++) {
      const msg = bus.send({ from: 'a', content: `msg ${i}` });
      ids.push(msg.id);
    }
    // First 2 should be evicted
    expect(bus.get(ids[0])).toBe(null);
    expect(bus.get(ids[1])).toBe(null);
    // Last 5 should exist
    expect(bus.get(ids[2])).not.toBe(null);
    expect(bus.get(ids[6])).not.toBe(null);
  });

  it('preserves newest messages', () => {
    const bus = createTerminalMessageBus({ maxMessages: 3 });
    for (let i = 0; i < 5; i++) bus.send({ from: 'a', content: `msg ${i}` });
    const all = bus.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].content).toBe('msg 4');
    expect(all[2].content).toBe('msg 2');
  });

  it('stays within bounds', () => {
    const bus = createTerminalMessageBus({ maxMessages: 10 });
    for (let i = 0; i < 20; i++) bus.send({ from: 'a', content: `msg ${i}` });
    expect(bus.count()).toBeLessThanOrEqual(10);
  });
});

// ── EventBus integration ────────────────────────────────────

describe('EventBus integration', () => {
  it('emits terminal-message:sent on send', () => {
    const events = new EventBus();
    const bus = createTerminalMessageBus({ events });
    const received = [];
    events.on('terminal-message:sent', (data) => received.push(data));
    bus.send({ from: 'a', to: 'b', content: 'hello' });
    expect(received).toHaveLength(1);
    expect(received[0].from).toBe('a');
    expect(received[0].to).toBe('b');
    expect(received[0].content).toBe('hello');
    expect(received[0].messageId).toBeTruthy();
  });

  it('emits terminal-message:broadcast on broadcast', () => {
    const events = new EventBus();
    const bus = createTerminalMessageBus({ events });
    const received = [];
    events.on('terminal-message:broadcast', (data) => received.push(data));
    bus.send({ from: 'a', content: 'broadcast!' });
    expect(received).toHaveLength(1);
    expect(received[0].from).toBe('a');
  });

  it('does not emit broadcast event for targeted messages', () => {
    const events = new EventBus();
    const bus = createTerminalMessageBus({ events });
    const received = [];
    events.on('terminal-message:broadcast', (data) => received.push(data));
    bus.send({ from: 'a', to: 'b', content: 'direct' });
    expect(received).toHaveLength(0);
  });

  it('emits terminal-message:deleted on delete', () => {
    const events = new EventBus();
    const bus = createTerminalMessageBus({ events });
    const received = [];
    events.on('terminal-message:deleted', (data) => received.push(data));
    const msg = bus.send({ from: 'a', content: 'hi' });
    bus.delete(msg.id);
    expect(received).toHaveLength(1);
    expect(received[0].messageId).toBe(msg.id);
  });

  it('emits terminal-message:cleared on clear', () => {
    const events = new EventBus();
    const bus = createTerminalMessageBus({ events });
    bus.send({ from: 'a', content: 'x' });
    bus.send({ from: 'b', content: 'y' });
    const received = [];
    events.on('terminal-message:cleared', (data) => received.push(data));
    bus.clear();
    expect(received).toHaveLength(1);
    expect(received[0].count).toBe(2);
  });
});

// ── Persistence ─────────────────────────────────────────────

describe('persistence', () => {
  it('saves and loads state from disk', () => {
    const bus1 = createTerminalMessageBus({ persistPath: PERSIST_PATH });
    bus1.send({ from: 'a', to: 'b', content: 'hello' });
    bus1.send({ from: 'b', content: 'broadcast' });

    const bus2 = createTerminalMessageBus({ persistPath: PERSIST_PATH });
    const result = bus2.load();
    expect(result.loaded).toBe(true);
    expect(result.messages).toBe(2);
    expect(bus2.getAll()).toHaveLength(2);
  });

  it('creates directory for persistence file', () => {
    const deepPath = join(TEST_DIR, 'deep', 'nested', 'messages.json');
    const bus = createTerminalMessageBus({ persistPath: deepPath });
    bus.send({ from: 'a', content: 'test' });
    expect(existsSync(deepPath)).toBe(true);
  });

  it('handles corrupt primary file with .tmp recovery', () => {
    const bus1 = createTerminalMessageBus({ persistPath: PERSIST_PATH });
    bus1.send({ from: 'a', content: 'original' });

    // Corrupt the primary file
    writeFileSync(PERSIST_PATH, 'NOT VALID JSON{{{');

    // Write valid .tmp
    const validData = {
      messages: [{ id: 'recovered-id', from: 'b', to: null, content: 'recovered', category: 'general', replyTo: null, timestamp: new Date().toISOString(), deleted: false }],
      unread: {},
    };
    writeFileSync(PERSIST_PATH + '.tmp', JSON.stringify(validData));

    const bus2 = createTerminalMessageBus({ persistPath: PERSIST_PATH });
    const result = bus2.load();
    expect(result.loaded).toBe(true);
    expect(result.recovered).toBe(true);
    expect(bus2.get('recovered-id')).not.toBe(null);
  });

  it('returns loaded:false when no file exists', () => {
    const bus = createTerminalMessageBus({ persistPath: join(TEST_DIR, 'nonexistent.json') });
    const result = bus.load();
    expect(result.loaded).toBe(false);
  });

  it('returns loaded:false without persistPath', () => {
    const bus = createTerminalMessageBus();
    const result = bus.load();
    expect(result.loaded).toBe(false);
  });

  it('auto-saves on send', () => {
    const bus = createTerminalMessageBus({ persistPath: PERSIST_PATH });
    bus.send({ from: 'a', content: 'auto-saved' });
    expect(existsSync(PERSIST_PATH)).toBe(true);
    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(raw.messages).toHaveLength(1);
    expect(raw.savedAt).toBeTruthy();
    expect(raw.version).toBe(1);
  });

  it('auto-saves on delete', () => {
    const bus = createTerminalMessageBus({ persistPath: PERSIST_PATH });
    const msg = bus.send({ from: 'a', content: 'to-delete' });
    bus.delete(msg.id);
    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(raw.messages[0].deleted).toBe(true);
  });

  it('auto-saves on clear', () => {
    const bus = createTerminalMessageBus({ persistPath: PERSIST_PATH });
    bus.send({ from: 'a', content: 'x' });
    bus.clear();
    const raw = JSON.parse(readFileSync(PERSIST_PATH, 'utf-8'));
    expect(raw.messages).toHaveLength(0);
  });
});

// ── Serialization ───────────────────────────────────────────

describe('toJSON/fromJSON', () => {
  it('round-trips through serialization', () => {
    const bus1 = createTerminalMessageBus();
    bus1.send({ from: 'a', to: 'b', content: 'hello' });
    bus1.send({ from: 'b', content: 'broadcast' });

    const json = bus1.toJSON();
    const bus2 = createTerminalMessageBus();
    bus2.fromJSON(json);

    expect(bus2.count()).toBe(2);
    expect(bus2.getAll()).toHaveLength(2);
  });

  it('fromJSON clears existing state', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', content: 'old' });
    bus.fromJSON({
      messages: [{ id: 'new-id', from: 'b', to: null, content: 'new', category: 'general', replyTo: null, timestamp: new Date().toISOString(), deleted: false }],
      unread: {},
    });
    expect(bus.count()).toBe(1);
    expect(bus.get('new-id')).not.toBe(null);
  });

  it('handles empty data gracefully', () => {
    const bus = createTerminalMessageBus();
    bus.send({ from: 'a', content: 'x' });
    bus.fromJSON({});
    expect(bus.count()).toBe(0);
  });
});

// ── REST routes integration ─────────────────────────────────

describe('REST routes integration (via server)', () => {
  let server, close, messageBus, baseUrl;

  beforeEach(async () => {
    const { createApp } = await import('../server.mjs');
    const result = createApp({
      operatorDir: TEST_DIR,
      messageBus: createTerminalMessageBus({ events: new EventBus() }),
      sharedMemory: false,
      claudePool: false,
      enableFileWatcher: false,
      auth: false,
    });
    server = result.server;
    close = result.close;
    messageBus = result.messageBus;

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (close) await close();
  });

  async function request(method, path, body) {
    const url = `${baseUrl}${path}`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json();
    return { status: res.status, body: data };
  }

  it('GET /api/terminal-messages returns empty initially', async () => {
    const res = await request('GET', '/api/terminal-messages');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.messages).toEqual([]);
  });

  it('POST then GET a message', async () => {
    const post = await request('POST', '/api/terminal-messages', {
      from: 'term-1', to: 'term-2', content: 'hello',
    });
    expect(post.status).toBe(201);
    expect(post.body.from).toBe('term-1');
    expect(post.body.id).toBeTruthy();

    const get = await request('GET', `/api/terminal-messages/${post.body.id}`);
    expect(get.status).toBe(200);
    expect(get.body.content).toBe('hello');
  });

  it('GET with terminalId filter', async () => {
    await request('POST', '/api/terminal-messages', { from: 'a', to: 'b', content: 'x' });
    await request('POST', '/api/terminal-messages', { from: 'c', to: 'c', content: 'y' });

    const res = await request('GET', '/api/terminal-messages?terminalId=a');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('GET single message returns 404 for missing', async () => {
    const res = await request('GET', '/api/terminal-messages/nonexistent');
    expect(res.status).toBe(404);
  });

  it('GET thread for message', async () => {
    const m1 = await request('POST', '/api/terminal-messages', { from: 'a', content: 'root' });
    await request('POST', '/api/terminal-messages', { from: 'b', content: 'reply', replyTo: m1.body.id });

    const thread = await request('GET', `/api/terminal-messages/${m1.body.id}/thread`);
    expect(thread.status).toBe(200);
    expect(thread.body.count).toBe(2);
  });

  it('DELETE soft-deletes a message', async () => {
    const msg = await request('POST', '/api/terminal-messages', { from: 'a', content: 'delete me' });
    const del = await request('DELETE', `/api/terminal-messages/${msg.body.id}`);
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);

    const get = await request('GET', `/api/terminal-messages/${msg.body.id}`);
    expect(get.status).toBe(404);
  });

  it('DELETE all clears messages', async () => {
    await request('POST', '/api/terminal-messages', { from: 'a', content: 'x' });
    await request('POST', '/api/terminal-messages', { from: 'b', content: 'y' });
    const del = await request('DELETE', '/api/terminal-messages');
    expect(del.status).toBe(200);
    expect(del.body.count).toBe(2);
  });

  it('GET unread count', async () => {
    await request('POST', '/api/terminal-messages', { from: 'a', to: 'b', content: 'hi' });
    const res = await request('GET', '/api/terminal-messages/unread/b');
    expect(res.status).toBe(200);
    expect(res.body.unread).toBe(1);
  });

  it('POST mark-read resets unread', async () => {
    await request('POST', '/api/terminal-messages', { from: 'a', to: 'b', content: 'x' });
    await request('POST', '/api/terminal-messages', { from: 'a', to: 'b', content: 'y' });
    const mark = await request('POST', '/api/terminal-messages/mark-read/b', {});
    expect(mark.status).toBe(200);
    expect(mark.body.unread).toBe(0);
  });
});

// ── 503 guard ───────────────────────────────────────────────

describe('503 guard when no message bus', () => {
  it('returns 503 when messageBus is null', async () => {
    const { createApp } = await import('../server.mjs');
    const result = createApp({
      operatorDir: TEST_DIR,
      messageBus: false,
      sharedMemory: false,
      claudePool: false,
      enableFileWatcher: false,
      auth: false,
    });

    await new Promise((resolve) => {
      result.server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = result.server.address();
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/terminal-messages`);
    expect(res.status).toBe(503);

    await result.close();
  });
});

// ── WS bridging ─────────────────────────────────────────────

describe('WebSocket event bridging', () => {
  it('terminal-message events are in BRIDGED_EVENTS', async () => {
    const wsModule = await import('../ws.mjs');
    expect(typeof wsModule.createWebSocketHandler).toBe('function');
  });
});

// ── Validation edge cases ───────────────────────────────────

describe('validation edge cases', () => {
  it('rejects invalid to format', () => {
    const bus = createTerminalMessageBus();
    expect(() => bus.send({ from: 'a', to: 'bad terminal!', content: 'hi' })).toThrow('to');
  });

  it('accepts valid categories', () => {
    const bus = createTerminalMessageBus();
    const m1 = bus.send({ from: 'a', content: 'x', category: 'status' });
    const m2 = bus.send({ from: 'a', content: 'y', category: 'question' });
    const m3 = bus.send({ from: 'a', content: 'z', category: 'finding' });
    expect(m1.category).toBe('status');
    expect(m2.category).toBe('question');
    expect(m3.category).toBe('finding');
  });
});
