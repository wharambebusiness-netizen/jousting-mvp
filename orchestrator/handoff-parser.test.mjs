import { describe, it, expect } from 'vitest';
import { parseMetaContent } from './handoff-parser.mjs';

// ── parseMetaContent — basic fields ─────────────────────────

describe('parseMetaContent', () => {
  it('returns defaults for empty/null content', () => {
    const meta = parseMetaContent('');
    expect(meta.status).toBe('not-started');
    expect(meta.filesModified).toEqual([]);
    expect(meta.testsPassing).toBeNull();
    expect(meta.notes).toBe('');
    expect(meta.notesForOthers).toBe('');
    expect(meta.testsHealthy).toBeNull();
    expect(meta.fileCount).toBe(0);
    expect(meta.completedTasks).toEqual([]);

    expect(parseMetaContent(null).status).toBe('not-started');
  });

  it('parses status field', () => {
    expect(parseMetaContent('- Status: complete').status).toBe('complete');
    expect(parseMetaContent('- status: in-progress').status).toBe('in-progress');
    expect(parseMetaContent('- STATUS: all-done').status).toBe('all-done');
  });

  it('parses comma-separated files-modified', () => {
    const meta = parseMetaContent('- Files-Modified: src/a.ts, src/b.ts, src/c.ts');
    expect(meta.filesModified).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(meta.fileCount).toBe(3);
  });

  it('parses files modified with various casing/spacing', () => {
    expect(parseMetaContent('- files-modified: a.ts').filesModified).toEqual(['a.ts']);
    expect(parseMetaContent('- Files Modified: a.ts').filesModified).toEqual(['a.ts']);
    expect(parseMetaContent('- files modified: a.ts, b.ts').filesModified).toEqual(['a.ts', 'b.ts']);
  });

  it('parses multiline bulleted files-modified (v28)', () => {
    const content = `- Files-Modified:
  - src/engine/calculator.ts
  - src/engine/match.ts
  - src/ai/opponent.ts`;
    const meta = parseMetaContent(content);
    expect(meta.filesModified).toEqual([
      'src/engine/calculator.ts',
      'src/engine/match.ts',
      'src/ai/opponent.ts',
    ]);
    expect(meta.fileCount).toBe(3);
  });

  it('filters empty entries from files-modified', () => {
    const meta = parseMetaContent('- Files-Modified: a.ts, , b.ts, ');
    expect(meta.filesModified).toEqual(['a.ts', 'b.ts']);
  });
});

// ── tests-passing variants ──────────────────────────────────

describe('parseMetaContent — tests-passing', () => {
  it('parses "true"', () => {
    const meta = parseMetaContent('- Tests-Passing: true');
    expect(meta.testsPassing).toBe(true);
    expect(meta.testsHealthy).toBe(true);
  });

  it('parses "false"', () => {
    const meta = parseMetaContent('- Tests-Passing: false');
    expect(meta.testsPassing).toBe(false);
    expect(meta.testsHealthy).toBe(false);
  });

  it('parses "true (685 tests, 7 suites)"', () => {
    const meta = parseMetaContent('- Tests-Passing: true (685 tests, 7 suites)');
    expect(meta.testsPassing).toBe(true);
    expect(meta.testCount).toBe(685);
  });

  it('parses "true (667/667)"', () => {
    const meta = parseMetaContent('- Tests-Passing: true (667/667)');
    expect(meta.testsPassing).toBe(true);
    expect(meta.testCount).toBe(667);
  });

  it('parses bare number "794"', () => {
    const meta = parseMetaContent('- Tests-Passing: 794');
    expect(meta.testsPassing).toBe(true);
    expect(meta.testCount).toBe(794);
  });

  it('parses case-insensitive "TRUE"', () => {
    expect(parseMetaContent('- tests-passing: TRUE').testsPassing).toBe(true);
  });

  it('parses case-insensitive "False"', () => {
    expect(parseMetaContent('- tests-passing: False').testsPassing).toBe(false);
  });

  it('returns null for unrecognized value', () => {
    expect(parseMetaContent('- Tests-Passing: maybe').testsPassing).toBeNull();
  });
});

// ── notes-for-others ────────────────────────────────────────

describe('parseMetaContent — notes-for-others', () => {
  it('parses notes-for-others', () => {
    const meta = parseMetaContent('- Notes-For-Others: @qa: please review calculator.ts');
    expect(meta.notes).toBe('@qa: please review calculator.ts');
    expect(meta.notesForOthers).toBe('@qa: please review calculator.ts');
  });

  it('handles various separators', () => {
    expect(parseMetaContent('- notes for others: hello').notes).toBe('hello');
    expect(parseMetaContent('- Notes-for-Others: hello').notes).toBe('hello');
  });
});

// ── completed-tasks ─────────────────────────────────────────

describe('parseMetaContent — completed-tasks', () => {
  it('parses comma-separated task IDs', () => {
    const meta = parseMetaContent('- Completed-Tasks: BL-042, BL-043, BL-044');
    expect(meta.completedTasks).toEqual(['BL-042', 'BL-043', 'BL-044']);
  });

  it('returns empty array when not present', () => {
    expect(parseMetaContent('- Status: complete').completedTasks).toEqual([]);
  });
});

// ── testsHealthy quality signal ─────────────────────────────

describe('parseMetaContent — testsHealthy', () => {
  it('derives from testsPassing=true', () => {
    expect(parseMetaContent('- Tests-Passing: true').testsHealthy).toBe(true);
  });

  it('derives from testsPassing=false', () => {
    expect(parseMetaContent('- Tests-Passing: false').testsHealthy).toBe(false);
  });

  it('detects "all tests passing" in body text', () => {
    const meta = parseMetaContent('Summary: All tests passing after changes.');
    expect(meta.testsHealthy).toBe(true);
  });

  it('detects "all passing" in body text', () => {
    const meta = parseMetaContent('Ran the suite — all passing.');
    expect(meta.testsHealthy).toBe(true);
  });

  it('detects "tests failing" in body text', () => {
    const meta = parseMetaContent('WARNING: tests failing after rebase.');
    expect(meta.testsHealthy).toBe(false);
  });

  it('detects "test failure" in body text', () => {
    const meta = parseMetaContent('Encountered a test failure in calculator.');
    expect(meta.testsHealthy).toBe(false);
  });

  it('returns null when no health signals', () => {
    expect(parseMetaContent('Did some work on the engine.').testsHealthy).toBeNull();
  });
});

// ── full handoff document ───────────────────────────────────

describe('parseMetaContent — full document', () => {
  it('parses a realistic handoff META block', () => {
    const content = `# Agent Handoff: engine-dev

## META
- Status: complete
- Files-Modified: src/engine/calculator.ts, src/engine/balance-config.ts
- Tests-Passing: true (908 tests, 8 suites)
- Notes-For-Others: @qa: calculator softCap changed, please verify edge cases
- Completed-Tasks: BL-042

## Summary
Updated the soft cap formula for better scaling at giga tier.
All tests passing after changes.
`;
    const meta = parseMetaContent(content);
    expect(meta.status).toBe('complete');
    expect(meta.filesModified).toEqual(['src/engine/calculator.ts', 'src/engine/balance-config.ts']);
    expect(meta.testsPassing).toBe(true);
    expect(meta.testCount).toBe(908);
    expect(meta.notes).toBe('@qa: calculator softCap changed, please verify edge cases');
    expect(meta.completedTasks).toEqual(['BL-042']);
    expect(meta.testsHealthy).toBe(true);
    expect(meta.fileCount).toBe(2);
  });
});
