// Phase 15F — Claude Terminal Unit Tests
// Tests for claude-terminal.mjs (buildCliArgs + createClaudeTerminal)
// Mocks node-pty only; uses real claude-terminal module.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock node-pty ──────────────────────────────────────────

function createMockPtyProcess(opts = {}) {
  const listeners = { data: [], exit: [] };
  return {
    pid: opts.pid ?? 12345,
    onData(cb) { listeners.data.push(cb); },
    onExit(cb) { listeners.exit.push(cb); },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _emitData(data) { for (const fn of listeners.data) fn(data); },
    _emitExit(exitCode = 0, signal = null) { for (const fn of listeners.exit) fn({ exitCode, signal }); },
  };
}

let mockPtySpawn;
vi.mock('node-pty', () => {
  mockPtySpawn = vi.fn(() => createMockPtyProcess());
  return { default: { spawn: mockPtySpawn } };
});

// Import after mock
const {
  buildCliArgs,
  createClaudeTerminal,
  isNodePtyAvailable,
  stripAnsi,
  CONTEXT_PATTERNS,
  CONTEXT_WARNING_COOLDOWN_MS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} = await import('../claude-terminal.mjs');

// ============================================================
// buildCliArgs
// ============================================================

describe('buildCliArgs', () => {
  it('returns empty array with no options', () => {
    expect(buildCliArgs({})).toEqual([]);
  });

  it('adds --dangerously-skip-permissions flag', () => {
    const args = buildCliArgs({ dangerouslySkipPermissions: true });
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('adds --model flag', () => {
    const args = buildCliArgs({ model: 'opus' });
    expect(args).toEqual(['--model', 'opus']);
  });

  it('adds --append-system-prompt flag', () => {
    const args = buildCliArgs({ systemPrompt: 'Be concise' });
    expect(args).toEqual(['--append-system-prompt', 'Be concise']);
  });

  it('adds -r flag for resumeSessionId', () => {
    const args = buildCliArgs({ resumeSessionId: 'sess-123' });
    expect(args).toEqual(['-r', 'sess-123']);
  });

  it('adds -c flag for continueSession', () => {
    const args = buildCliArgs({ continueSession: true });
    expect(args).toEqual(['-c']);
  });

  it('prefers resumeSessionId over continueSession', () => {
    const args = buildCliArgs({ resumeSessionId: 'sess-x', continueSession: true });
    expect(args).toEqual(['-r', 'sess-x']);
    expect(args).not.toContain('-c');
  });

  it('combines multiple flags in correct order', () => {
    const args = buildCliArgs({
      dangerouslySkipPermissions: true,
      model: 'sonnet',
      systemPrompt: 'test prompt',
    });
    expect(args).toEqual([
      '--dangerously-skip-permissions',
      '--model', 'sonnet',
      '--append-system-prompt', 'test prompt',
    ]);
  });
});

// ============================================================
// isNodePtyAvailable
// ============================================================

describe('isNodePtyAvailable', () => {
  it('returns true when node-pty is available', async () => {
    expect(await isNodePtyAvailable()).toBe(true);
  });
});

// ============================================================
// createClaudeTerminal
// ============================================================

describe('createClaudeTerminal', () => {
  let mockPty;

  beforeEach(() => {
    mockPtySpawn.mockClear();
    mockPty = createMockPtyProcess({ pid: 42 });
    mockPtySpawn.mockReturnValue(mockPty);
  });

  it('throws when projectDir is missing', async () => {
    await expect(createClaudeTerminal({})).rejects.toThrow('projectDir is required');
  });

  it('spawns PTY with correct defaults', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    expect(term.pid).toBe(42);
    expect(term.id).toMatch(/^claude-/);

    const call = mockPtySpawn.mock.calls[0];
    expect(call[0]).toMatch(/claude/);
    expect(call[1]).toEqual([]);
    expect(call[2].cols).toBe(DEFAULT_COLS);
    expect(call[2].rows).toBe(DEFAULT_ROWS);
    expect(call[2].cwd).toBe('/tmp/test');
    expect(call[2].name).toBe('xterm-256color');
  });

  it('uses custom id, cols, rows', async () => {
    const term = await createClaudeTerminal({
      projectDir: '/tmp/test',
      id: 'my-term',
      cols: 80,
      rows: 24,
    });
    expect(term.id).toBe('my-term');
    const call = mockPtySpawn.mock.calls[0];
    expect(call[2].cols).toBe(80);
    expect(call[2].rows).toBe(24);
  });

  it('passes CLI args through buildCliArgs', async () => {
    await createClaudeTerminal({
      projectDir: '/tmp/test',
      model: 'opus',
      dangerouslySkipPermissions: true,
    });
    const call = mockPtySpawn.mock.calls[0];
    expect(call[1]).toContain('--dangerously-skip-permissions');
    expect(call[1]).toContain('--model');
    expect(call[1]).toContain('opus');
  });

  it('write delegates to PTY', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    term.write('hello');
    expect(mockPty.write).toHaveBeenCalledWith('hello');
  });

  it('write is noop when stopped', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    mockPty._emitExit(0);
    term.write('hello');
    expect(mockPty.write).not.toHaveBeenCalled();
  });

  it('resize delegates to PTY and updates state', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    term.resize(80, 24);
    expect(mockPty.resize).toHaveBeenCalledWith(80, 24);
    expect(term.getStatus().cols).toBe(80);
    expect(term.getStatus().rows).toBe(24);
  });

  it('resize is noop when stopped', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    mockPty._emitExit(0);
    term.resize(80, 24);
    expect(mockPty.resize).not.toHaveBeenCalled();
  });

  it('kill calls pty.kill()', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    term.kill();
    expect(mockPty.kill).toHaveBeenCalled();
  });

  it('kill is noop when already stopped', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    mockPty._emitExit(0);
    mockPty.kill.mockClear();
    term.kill();
    expect(mockPty.kill).not.toHaveBeenCalled();
  });

  it('getStatus returns state snapshot', async () => {
    const term = await createClaudeTerminal({
      projectDir: '/tmp/test',
      id: 'test-1',
      model: 'opus',
      dangerouslySkipPermissions: true,
    });
    const status = term.getStatus();
    expect(status.id).toBe('test-1');
    expect(status.pid).toBe(42);
    expect(status.status).toBe('running');
    expect(status.projectDir).toBe('/tmp/test');
    expect(status.model).toBe('opus');
    expect(status.dangerouslySkipPermissions).toBe(true);
    expect(status.cols).toBe(DEFAULT_COLS);
    expect(status.rows).toBe(DEFAULT_ROWS);
    expect(status.exitCode).toBeNull();
    expect(status.exitSignal).toBeNull();
    expect(status.spawnedAt).toBeTruthy();
  });

  it('getStatus returns shallow copy', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    const s1 = term.getStatus();
    const s2 = term.getStatus();
    expect(s1).not.toBe(s2);
    expect(s1).toEqual(s2);
  });

  it('emits data event from PTY output', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    const received = [];
    term.on('data', (d) => received.push(d));
    mockPty._emitData('hello world');
    expect(received).toEqual(['hello world']);
  });

  it('calls onData callback', async () => {
    const chunks = [];
    await createClaudeTerminal({
      projectDir: '/tmp/test',
      onData: (d) => chunks.push(d),
    });
    mockPty._emitData('chunk1');
    mockPty._emitData('chunk2');
    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });

  it('emits exit event and updates status', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    const exits = [];
    term.on('exit', (code, sig) => exits.push({ code, sig }));
    mockPty._emitExit(1, 'SIGTERM');
    expect(exits).toEqual([{ code: 1, sig: 'SIGTERM' }]);
    expect(term.getStatus().status).toBe('stopped');
    expect(term.getStatus().exitCode).toBe(1);
    expect(term.getStatus().exitSignal).toBe('SIGTERM');
  });

  it('calls onExit callback', async () => {
    const exits = [];
    await createClaudeTerminal({
      projectDir: '/tmp/test',
      onExit: (code, sig) => exits.push({ code, sig }),
    });
    mockPty._emitExit(0, null);
    expect(exits).toEqual([{ code: 0, sig: null }]);
  });

  it('off removes event listener', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    const received = [];
    const handler = (d) => received.push(d);
    term.on('data', handler);
    mockPty._emitData('first');
    term.off('data', handler);
    mockPty._emitData('second');
    expect(received).toEqual(['first']);
  });

  it('sets CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE env var', async () => {
    await createClaudeTerminal({ projectDir: '/tmp/test' });
    const call = mockPtySpawn.mock.calls[0];
    expect(call[2].env.CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE).toBe('50');
  });

  it('sets FORCE_COLOR env var', async () => {
    await createClaudeTerminal({ projectDir: '/tmp/test' });
    const call = mockPtySpawn.mock.calls[0];
    expect(call[2].env.FORCE_COLOR).toBe('1');
  });

  // Phase 15E: context-warning event
  it('emits context-warning when PTY output contains autocompact pattern', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    const warnings = [];
    term.on('context-warning', (info) => warnings.push(info));
    mockPty._emitData('Some text... Auto-compact triggered ...');
    expect(warnings.length).toBe(1);
    expect(warnings[0].pattern).toBeTruthy();
  });

  it('emits context-warning only once (dedup)', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    const warnings = [];
    term.on('context-warning', (info) => warnings.push(info));
    mockPty._emitData('Auto-compact running...');
    mockPty._emitData('Auto-compact again...');
    expect(warnings.length).toBe(1);
  });

  it('does not emit context-warning for normal output', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    const warnings = [];
    term.on('context-warning', (info) => warnings.push(info));
    mockPty._emitData('Hello world, just regular output');
    expect(warnings.length).toBe(0);
  });

  it('detects context-warning through ANSI codes', async () => {
    const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
    const warnings = [];
    term.on('context-warning', (info) => warnings.push(info));
    mockPty._emitData('\x1b[1;33mAuto-compact\x1b[0m running...');
    expect(warnings.length).toBe(1);
  });

  // Multi-compaction scenario: after a terminal auto-compacts and continues into a second
  // context window, the cooldown should expire and allow a second context-warning to fire.
  describe('multi-compaction cooldown', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('re-emits context-warning after CONTEXT_WARNING_COOLDOWN_MS (multi-compaction scenario)', async () => {
      expect(CONTEXT_WARNING_COOLDOWN_MS).toBe(60000);

      const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
      const warnings = [];
      term.on('context-warning', (info) => warnings.push(info));

      // First compaction — should emit
      mockPty._emitData('Auto-compact triggered');
      expect(warnings.length).toBe(1);
      expect(warnings[0].pattern).toBeTruthy();

      // Immediate second match — deduped within cooldown
      mockPty._emitData('Auto-compact triggered');
      expect(warnings.length).toBe(1);

      // Advance time past the cooldown
      vi.advanceTimersByTime(CONTEXT_WARNING_COOLDOWN_MS + 1000);

      // Second compaction cycle — should re-emit now
      mockPty._emitData('Auto-compact triggered');
      expect(warnings.length).toBe(2);
      expect(warnings[1].pattern).toBeTruthy();
    });

    it('does not re-emit before cooldown expires', async () => {
      const term = await createClaudeTerminal({ projectDir: '/tmp/test' });
      const warnings = [];
      term.on('context-warning', (info) => warnings.push(info));

      mockPty._emitData('Auto-compact triggered');
      expect(warnings.length).toBe(1);

      // Advance time to just before the cooldown
      vi.advanceTimersByTime(CONTEXT_WARNING_COOLDOWN_MS - 1);

      mockPty._emitData('Auto-compact triggered');
      expect(warnings.length).toBe(1);
    });
  });
});

// ============================================================
// stripAnsi
// ============================================================

describe('stripAnsi', () => {
  it('removes standard color codes', () => {
    expect(stripAnsi('\x1b[31mhello\x1b[0m')).toBe('hello');
  });

  it('removes bold and reset', () => {
    expect(stripAnsi('\x1b[1;36mfoo\x1b[0m')).toBe('foo');
  });

  it('preserves plain text', () => {
    expect(stripAnsi('just text')).toBe('just text');
  });
});

// ============================================================
// CONTEXT_PATTERNS
// ============================================================

describe('CONTEXT_PATTERNS', () => {
  it('matches "Auto-compact"', () => {
    expect(CONTEXT_PATTERNS.some(p => p.test('Auto-compact triggered'))).toBe(true);
  });

  it('matches "auto compact" (case insensitive)', () => {
    expect(CONTEXT_PATTERNS.some(p => p.test('auto compact started'))).toBe(true);
  });

  it('matches "compressing conversation"', () => {
    expect(CONTEXT_PATTERNS.some(p => p.test('Compressing conversation...'))).toBe(true);
  });

  it('matches "context window is nearly full"', () => {
    expect(CONTEXT_PATTERNS.some(p => p.test('context window is nearly full'))).toBe(true);
  });

  it('matches "summarizing prior conversation"', () => {
    expect(CONTEXT_PATTERNS.some(p => p.test('Summarizing prior conversation...'))).toBe(true);
  });

  it('does not match regular text', () => {
    expect(CONTEXT_PATTERNS.some(p => p.test('Hello world'))).toBe(false);
  });
});
