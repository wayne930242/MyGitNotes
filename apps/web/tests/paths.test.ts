import { afterEach, expect, it, vi } from 'vitest';
import { inFolder, relativeAsset } from '../src/lib/note-paths.js';
import { getLocalDraft, saveLocalDraft } from '../src/lib/storage.js';

afterEach(() => vi.unstubAllGlobals());
it('matches a selected folder and its descendants without matching sibling prefixes', () => {
  expect(inFolder('notes/ex/projects/deep/note.md', 'notes/ex', 'projects')).toBe(true);
  expect(inFolder('notes/ex/projects-old/note.md', 'notes/ex', 'projects')).toBe(false);
  expect(inFolder('notes/ex/root.md', 'notes/ex', null)).toBe(true);
});
it('creates portable encoded asset references from nested notes', () => {
  expect(relativeAsset('notes/ex/projects/deep/note.md', 'notes/ex/assets/di agram.png')).toBe('../../assets/di%20agram.png');
});
it('isolates drafts with the same branch and path in different source repositories', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) || null });
  saveLocalDraft('local:/repos/first:main', 'notes/ex/note.md', 'first draft', {});
  saveLocalDraft('local:/repos/second:main', 'notes/ex/note.md', 'second draft', {});
  expect(getLocalDraft('local:/repos/first:main', 'notes/ex/note.md')?.content).toBe('first draft');
  expect(getLocalDraft('local:/repos/second:main', 'notes/ex/note.md')?.content).toBe('second draft');
});
