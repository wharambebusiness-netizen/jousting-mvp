// ============================================================
// Multi-Master Worktree Tests (Phase 66)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorktreeManager } from '../coordination/worktree-manager.mjs';

// Mock git execution for all tests
function createMockGit(overrides = {}) {
  const defaultResult = { ok: true, stdout: '', stderr: '', code: 0 };
  return vi.fn().mockImplementation((args) => {
    const cmd = args.join(' ');
    if (overrides[cmd]) return Promise.resolve(overrides[cmd]);
    // Default: all git commands succeed
    if (args[0] === 'worktree' && args[1] === 'add') {
      return Promise.resolve(defaultResult);
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      return Promise.resolve(defaultResult);
    }
    if (args[0] === 'branch' && args[1] === '-D') {
      return Promise.resolve(defaultResult);
    }
    if (args[0] === 'worktree' && args[1] === 'prune') {
      return Promise.resolve(defaultResult);
    }
    if (args[0] === 'diff') {
      return Promise.resolve({ ...defaultResult, stdout: 'file.txt' }); // has changes
    }
    if (args[0] === 'merge' && args.includes('--no-commit')) {
      return Promise.resolve(defaultResult); // dry-run succeeds (no conflict)
    }
    if (args[0] === 'merge' && args.includes('--abort')) {
      return Promise.resolve(defaultResult);
    }
    if (args[0] === 'merge') {
      return Promise.resolve(defaultResult); // actual merge succeeds
    }
    if (args[0] === 'rev-parse') {
      return Promise.resolve({ ...defaultResult, stdout: 'abc123' });
    }
    return Promise.resolve(defaultResult);
  });
}

function createEvents() {
  const handlers = {};
  return {
    on: vi.fn((e, h) => { (handlers[e] = handlers[e] || []).push(h); }),
    off: vi.fn(),
    emit: vi.fn((e, d) => { (handlers[e] || []).forEach(h => { try { h(d); } catch {} }); }),
  };
}

describe('Multi-Master Worktrees (Phase 66)', () => {
  let wm, events, mockGit;
  const projectDir = '/test/project';

  beforeEach(() => {
    events = createEvents();
    mockGit = createMockGit();
    wm = createWorktreeManager({ projectDir, events, log: () => {}, _gitExec: mockGit });
  });

  describe('createForMaster()', () => {
    it('should create worktree namespaced under master', async () => {
      const result = await wm.createForMaster('master-1', 'worker-1');
      expect(result.ok).toBe(true);
      expect(result.path).toContain('master-1');
      expect(result.path).toContain('worker-1');
      expect(result.branch).toBe('master-master-1-worker-worker-1');
    });

    it('should create worktree with correct git commands', async () => {
      await wm.createForMaster('m1', 'w1');

      // Should have called git worktree add
      const worktreeAddCall = mockGit.mock.calls.find(
        c => c[0][0] === 'worktree' && c[0][1] === 'add'
      );
      expect(worktreeAddCall).toBeTruthy();
      expect(worktreeAddCall[0]).toContain('-b');
      expect(worktreeAddCall[0]).toContain('master-m1-worker-w1');
    });

    it('should reject missing masterId', async () => {
      const result = await wm.createForMaster('', 'worker-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject missing workerId', async () => {
      const result = await wm.createForMaster('master-1', '');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should emit worktree-created event with masterId', async () => {
      await wm.createForMaster('master-1', 'worker-1');

      const emitCall = events.emit.mock.calls.find(c => c[0] === 'coord:worktree-created');
      expect(emitCall).toBeTruthy();
      expect(emitCall[1].masterId).toBe('master-1');
    });

    it('should track worktree with composite key', async () => {
      await wm.createForMaster('master-1', 'worker-1');

      const entry = wm.get('master-1/worker-1');
      expect(entry).toBeTruthy();
      expect(entry.masterId).toBe('master-1');
    });

    it('should handle git failure gracefully', async () => {
      const failGit = createMockGit();
      failGit.mockImplementation((args) => {
        if (args[0] === 'worktree' && args[1] === 'add') {
          return Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: failed', code: 1 });
        }
        return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
      });

      const wm2 = createWorktreeManager({ projectDir, events, log: () => {}, _gitExec: failGit });
      const result = await wm2.createForMaster('master-1', 'worker-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('failed');
    });
  });

  describe('mergeIfClean()', () => {
    it('should merge when no conflicts', async () => {
      await wm.createForMaster('master-1', 'worker-1');

      const result = await wm.mergeIfClean('master-1/worker-1');
      expect(result.merged).toBe(true);
      expect(result.conflicted).toBe(false);
    });

    it('should report conflict when dry-run detects it', async () => {
      const conflictGit = createMockGit();
      conflictGit.mockImplementation((args) => {
        if (args[0] === 'merge' && args.includes('--no-commit')) {
          return Promise.resolve({
            ok: false,
            stdout: 'CONFLICT (content): Merge conflict in file.txt',
            stderr: '',
            code: 1,
          });
        }
        if (args[0] === 'diff') {
          return Promise.resolve({ ok: true, stdout: 'file.txt', stderr: '', code: 0 });
        }
        return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
      });

      const wm2 = createWorktreeManager({ projectDir, events, log: () => {}, _gitExec: conflictGit });
      await wm2.createForMaster('master-1', 'worker-1');

      const result = await wm2.mergeIfClean('master-1/worker-1');
      expect(result.merged).toBe(false);
      expect(result.conflicted).toBe(true);
      expect(result.files).toContain('file.txt');
    });

    it('should return error for unknown worker', async () => {
      const result = await wm.mergeIfClean('nonexistent');
      expect(result.merged).toBe(false);
      expect(result.error).toContain('No worktree');
    });
  });

  describe('Two masters get separate worktree paths', () => {
    it('should create non-overlapping paths for different masters', async () => {
      const r1 = await wm.createForMaster('master-1', 'worker-A');
      const r2 = await wm.createForMaster('master-2', 'worker-A');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r1.path).not.toBe(r2.path);
      expect(r1.branch).not.toBe(r2.branch);
      expect(r1.path).toContain('master-1');
      expect(r2.path).toContain('master-2');
    });
  });

  describe('Cleanup', () => {
    it('should clean up master worktrees', async () => {
      await wm.createForMaster('master-1', 'worker-1');
      await wm.createForMaster('master-1', 'worker-2');

      const status = wm.getStatus();
      expect(status.active).toBe(2);

      const cleanup = await wm.cleanupAll();
      expect(cleanup.removed.length).toBe(2);
    });
  });

  describe('Integration with pool entry', () => {
    it('should be accessible after creation', async () => {
      await wm.createForMaster('master-1', 'worker-1');

      expect(wm.has('master-1/worker-1')).toBe(true);

      const entry = wm.get('master-1/worker-1');
      expect(entry.path).toBeTruthy();
      expect(entry.branch).toBe('master-master-1-worker-worker-1');
    });
  });

  describe('Cleanup on remove', () => {
    it('should remove master-namespaced worktree', async () => {
      await wm.createForMaster('master-1', 'worker-1');
      expect(wm.has('master-1/worker-1')).toBe(true);

      const result = await wm.remove('master-1/worker-1');
      expect(result.ok).toBe(true);
      expect(wm.has('master-1/worker-1')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should clean up existing worktree before creating new one', async () => {
      await wm.createForMaster('master-1', 'worker-1');
      // Create again — should succeed (cleans up old one)
      const result = await wm.createForMaster('master-1', 'worker-1');
      expect(result.ok).toBe(true);
    });

    it('should use composite key in status', async () => {
      await wm.createForMaster('m1', 'w1');
      await wm.createForMaster('m2', 'w1');

      const status = wm.getStatus();
      expect(status.active).toBe(2);
      const ids = status.worktrees.map(w => w.workerId);
      expect(ids).toContain('m1/w1');
      expect(ids).toContain('m2/w1');
    });
  });
});
