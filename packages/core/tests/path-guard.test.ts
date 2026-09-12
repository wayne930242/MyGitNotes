import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  resolveSafePath,
  sanitizeFilename,
  PathTraversalError,
  SymlinkEscapeError,
} from '../src/path-guard.js';

describe('Path Guard & Traversal Defense', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-notes-guard-test-'));

  it('resolves safe relative paths inside repo root', () => {
    const safe = resolveSafePath(tmpDir, 'notes/example/note.md');
    expect(safe).toBe(path.join(tmpDir, 'notes/example/note.md'));
  });

  it('rejects path traversal with parent directory attempts (..)', () => {
    expect(() => resolveSafePath(tmpDir, '../outside.txt')).toThrow(PathTraversalError);
    expect(() => resolveSafePath(tmpDir, 'notes/../../outside.txt')).toThrow(PathTraversalError);
    expect(() => resolveSafePath(tmpDir, '....//....//etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects paths containing null bytes', () => {
    expect(() => resolveSafePath(tmpDir, 'note.md\0.txt')).toThrow(PathTraversalError);
  });

  it('rejects symlinks escaping the repository root', () => {
    const outsideTarget = path.join(os.tmpdir(), 'outside-target.txt');
    fs.writeFileSync(outsideTarget, 'secret outside');

    const symlinkPath = path.join(tmpDir, 'escape-link.txt');
    try {
      fs.symlinkSync(outsideTarget, symlinkPath);
      expect(() => resolveSafePath(tmpDir, 'escape-link.txt')).toThrow(SymlinkEscapeError);
    } finally {
      if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
      if (fs.existsSync(outsideTarget)) fs.unlinkSync(outsideTarget);
    }
  });

  it('sanitizes unsafe filenames into clean slugs', () => {
    expect(sanitizeFilename('My Note (Draft 1)?.md')).toBe('My-Note-(Draft-1)-.md');
    expect(sanitizeFilename('../../../evil.png')).toBe('evil.png');
    expect(sanitizeFilename('special characters: * < > | " ?')).toBe('special-characters');
  });
});
