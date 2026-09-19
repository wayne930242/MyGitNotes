import { describe, expect, it } from 'vitest';
import { createUnifiedDiff } from './unified-diff.js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('createUnifiedDiff', () => {
  it('returns empty string when content is identical', () => {
    expect(createUnifiedDiff('a.txt', 'a.txt', 'hello\nworld', 'hello\nworld')).toBe('');
    expect(createUnifiedDiff('a.txt', 'a.txt', '', '')).toBe('');
  });

  it('generates full added hunk for new files without baseline', () => {
    const diff = createUnifiedDiff('/dev/null', 'notes/new.md', null, 'first line\nsecond line\n');
    expect(diff).toBe(['--- /dev/null', '+++ notes/new.md', '@@ -0,0 +1,2 @@', '+first line', '+second line', ''].join('\n'));
  });

  it('formats single line modification with context lines', () => {
    const oldText = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n');
    const newText = ['line 1', 'line 2', 'line 3 modified', 'line 4', 'line 5'].join('\n');

    const diff = createUnifiedDiff('doc.md', 'doc.md', oldText, newText, { context: 1 });
    expect(diff).toBe(['--- doc.md', '+++ doc.md', '@@ -2,3 +2,3 @@', ' line 2', '-line 3', '+line 3 modified', ' line 4', ''].join('\n'));
  });

  it('formats pure insertion and pure deletion correctly', () => {
    const base = 'alpha\nbeta\ngamma';
    const withInsertion = 'alpha\ninserted\nbeta\ngamma';
    const insDiff = createUnifiedDiff('file.txt', 'file.txt', base, withInsertion, { context: 1 });
    expect(insDiff).toContain('+inserted');
    expect(insDiff).toContain(' alpha');
    expect(insDiff).toContain(' beta');

    const withDeletion = 'alpha\ngamma';
    const delDiff = createUnifiedDiff('file.txt', 'file.txt', base, withDeletion, { context: 1 });
    expect(delDiff).toContain('-beta');
    expect(delDiff).toContain(' alpha');
    expect(delDiff).toContain(' gamma');
  });

  it('separates distant hunks and merges nearby hunks', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const modified = [...lines];
    modified[2] = 'line 3 changed';
    modified[17] = 'line 18 changed';

    const diff = createUnifiedDiff('file.txt', 'file.txt', lines.join('\n'), modified.join('\n'), { context: 1 });
    const hunkHeaders = diff.split('\n').filter(line => line.startsWith('@@'));
    expect(hunkHeaders.length).toBe(2);

    // If modifications are close, they merge into one hunk
    const closeModified = [...lines];
    closeModified[2] = 'line 3 changed';
    closeModified[4] = 'line 5 changed';
    const mergedDiff = createUnifiedDiff('file.txt', 'file.txt', lines.join('\n'), closeModified.join('\n'), { context: 1 });
    const mergedHeaders = mergedDiff.split('\n').filter(line => line.startsWith('@@'));
    expect(mergedHeaders.length).toBe(1);
  });

  it('handles clearing an existing file completely', () => {
    const diff = createUnifiedDiff('file.txt', 'file.txt', 'line 1\nline 2', '', { context: 1 });
    expect(diff).toContain('-line 1');
    expect(diff).toContain('-line 2');
  });

  it('uses the insertion position for a zero-context empty range', () => {
    expect(createUnifiedDiff('file.txt', 'file.txt', 'a\nb\n', 'a\nnew\nb\n', { context: 0 })).toContain('@@ -1,0 +2,1 @@\n+new\n');
    expect(createUnifiedDiff('file.txt', 'file.txt', 'a\nold\nb\n', 'a\nb\n', { context: 0 })).toContain('@@ -2,1 +1,0 @@\n-old\n');
  });

  it('treats empty text as zero lines', () => {
    expect(createUnifiedDiff('file.txt', 'file.txt', '', 'a\n')).toBe('--- file.txt\n+++ file.txt\n@@ -0,0 +1,1 @@\n+a\n');
    expect(createUnifiedDiff('file.txt', 'file.txt', 'a\n', '')).toBe('--- file.txt\n+++ file.txt\n@@ -1,1 +0,0 @@\n-a\n');
  });

  it('marks a missing final newline without inventing a blank line', () => {
    expect(createUnifiedDiff('file.txt', 'file.txt', 'a\n', 'a')).toBe('--- file.txt\n+++ file.txt\n@@ -1,1 +1,1 @@\n-a\n+a\n\\ No newline at end of file\n');
  });

  it.each([['a\nb\nc\n', 'a\nB\nc\n'], ['', 'first\n'], ['last\n', ''], ['a\n', 'a'], ['a', 'a\n'], ['a\nb', 'A\nb'], ['a\r\nb\r\n', 'a\r\nB\r\n'], ['甲\n乙\n', '甲\n丙\n'], [null, 'created\n'], ['deleted\n', null], [null, 'created without newline'], ['deleted without newline', null]])('produces a Git-applicable patch: %j → %j', (before, after) => {
    const dir = mkdtempSync(join(tmpdir(), 'unified-diff-'));
    try {
      const file = join(dir, 'file.txt');
      if (before !== null) writeFileSync(file, before);
      const patch = createUnifiedDiff('file.txt', 'file.txt', before, after);
      execFileSync('git', ['apply', '--no-index', '-p0', '--whitespace=nowarn', '-'], { cwd: dir, input: patch, stdio: ['pipe', 'pipe', 'pipe'] });
      if (after === null) expect(existsSync(file)).toBe(false);
      else expect(readFileSync(file, 'utf8')).toBe(after);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([0, 1, 3])('applies separated insertions and deletions with %i context lines', context => {
    const before = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}\n`);
    const after = [...before];
    after.splice(35, 2);
    after.splice(20, 1, 'Replacement\n');
    after.splice(2, 0, 'Inserted first\n', 'Inserted second\n');
    const dir = mkdtempSync(join(tmpdir(), 'unified-diff-'));
    try {
      const file = join(dir, 'file.txt');
      writeFileSync(file, before.join(''));
      const patch = createUnifiedDiff('file.txt', 'file.txt', before.join(''), after.join(''), { context });
      expect(patch.split('\n').filter(line => line.startsWith('@@'))).toHaveLength(3);
      execFileSync('git', ['apply', '--no-index', '-p0', '--unidiff-zero', '-'], { cwd: dir, input: patch, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(readFileSync(file, 'utf8')).toBe(after.join(''));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
