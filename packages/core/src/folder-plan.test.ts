import { expect, it } from 'vitest';
import { planFolderChange, type FolderSnapshot } from './folder-plan.js';

const snapshot = (): FolderSnapshot => ({
  notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }],
  directories: ['notes/a', 'notes/a/one', 'notes/a/one/sub', 'notes/a/two'], protectedPaths: [],
  files: new Map([
    ['notes/a/one/_dir.yml', 'title: One\norder: 0\ncustom: keep\n'],
    ['notes/a/one/note.md', '# Note\n\n[Other](../two/other.md)\n'],
    ['notes/a/one/sub/_dir.yml', 'title: Child\n'],
    ['notes/a/two/_dir.yml', 'title: Two\norder: 1\n'],
    ['notes/a/two/other.md', '# Other\n\n[Note](../one/note.md#part)\n`[Code](../one/note.md)`\n'],
    ['.github-notes-screen.yaml', 'version: 1\nrows:\n  - id: row\n    kind: custom\n    name: Reading\n    view: small\n    items:\n      - id: pin\n        kind: note\n        notebookId: a\n        path: notes/a/one/note.md\n'],
  ]),
});
it('creates folders, preserves metadata and reorders siblings', () => {
  const created = planFolderChange(snapshot(), { kind: 'create', notebookId: 'a', parent: '', name: 'new', title: 'New folder' });
  expect(created.files.get('notes/a/new/_dir.yml')).toContain('title: New folder');
  const reordered = planFolderChange(snapshot(), { kind: 'move', notebookId: 'a', path: 'two', parent: '', before: 'one' });
  expect(reordered.files.get('notes/a/one/_dir.yml')).toContain('custom: keep');
  expect(reordered.folders.filter(folder => !folder.path.includes('/')).map(folder => folder.path)).toEqual(['two', 'one']);
});
it('changes hierarchy and updates relative links and Screen references', () => {
  const result = planFolderChange(snapshot(), { kind: 'move', notebookId: 'a', path: 'one', parent: 'two' });
  expect(result.files.has('notes/a/one/note.md')).toBe(false);
  expect(result.files.get('notes/a/two/one/note.md')).toContain('[Other](../other.md)');
  expect(result.files.get('notes/a/two/other.md')).toContain('[Note](one/note.md#part)');
  expect(result.files.get('notes/a/two/other.md')).toContain('`[Code](../one/note.md)`');
  expect(result.files.get('.github-notes-screen.yaml')).toContain('path: notes/a/two/one/note.md');
});
it('removes only the folder, moves contents to parent or chosen destination and rejects collisions', () => {
  const result = planFolderChange(snapshot(), { kind: 'delete', notebookId: 'a', path: 'one', destination: '' });
  expect(result.files.has('notes/a/one/_dir.yml')).toBe(false);
  expect(result.files.get('notes/a/note.md')).toContain('[Other](two/other.md)');
  expect(result.files.has('notes/a/sub/_dir.yml')).toBe(true);
  const elsewhere = planFolderChange(snapshot(), { kind: 'delete', notebookId: 'a', path: 'one', destination: 'two' });
  expect(elsewhere.files.has('notes/a/two/note.md')).toBe(true);
  const collision = snapshot(); collision.files.set('notes/a/note.md', 'Keep me');
  expect(() => planFolderChange(collision, { kind: 'delete', notebookId: 'a', path: 'one', destination: '' })).toThrow(/exist/i);
  expect(collision.files.get('notes/a/note.md')).toBe('Keep me');
});
it('rejects cycles, traversal, notebook roots and protected descendants', () => {
  for (const parent of ['one','one/sub','../escape']) expect(() => planFolderChange(snapshot(), { kind: 'move', notebookId: 'a', path: 'one', parent })).toThrow();
  expect(() => planFolderChange(snapshot(), { kind: 'delete', notebookId: 'a', path: '', destination: '' })).toThrow();
  const protectedTree = snapshot(); protectedTree.protectedPaths.push('notes/a/one/.private');
  expect(() => planFolderChange(protectedTree, { kind: 'move', notebookId: 'a', path: 'one', parent: 'two' })).toThrow(/protected/i);
  expect(planFolderChange(protectedTree, { kind: 'move', notebookId: 'a', path: 'one', parent: '' }).folders.map(folder => folder.path)).toEqual(['two','one','one/sub']);
});
