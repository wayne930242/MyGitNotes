import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BOOKMARKS_FILE } from '@mygitnotes/core';
import { assertNoteResource } from '../src/guards.js';

it('protects bookmark metadata through normalized paths and internal symlink aliases, even before creation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-mcp-'));
  try {
    fs.mkdirSync(path.join(root, 'notes'));
    fs.symlinkSync(root, path.join(root, 'notes/alias'));
    for (const file of [BOOKMARKS_FILE, `./${BOOKMARKS_FILE}`, `.\\${BOOKMARKS_FILE}`, path.join(root, BOOKMARKS_FILE), `notes/alias/${BOOKMARKS_FILE}`]) expect(() => assertNoteResource(root, file)).toThrow('Workspace metadata is protected');
    fs.writeFileSync(path.join(root, BOOKMARKS_FILE), 'version: 1\nnotebooks: []\n');
    fs.symlinkSync(path.join(root, BOOKMARKS_FILE), path.join(root, 'notes/note.md'));
    expect(() => assertNoteResource(root, 'notes/note.md')).toThrow('Workspace metadata is protected');
    expect(assertNoteResource(root, 'notes/ordinary.md')).toBe(path.join(root, 'notes/ordinary.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
