import { expect, it, vi } from 'vitest';
import { noteStatusChange } from './note-mutations.js';
import type { NoteItem } from './types.js';

const note = (extra: Partial<NoteItem> = {}): NoteItem => ({ id: 'notes/life/a.md', path: 'notes/life/a.md', notebookId: 'life', title: 'A', tags: [], metadata: { title: 'A' }, content: '# A\n\nbody\n', status: 'inbox', ...extra });

it('reads the note in full before writing a status from a list row', async () => {
  const read = vi.fn().mockResolvedValue(note());
  const change = await noteStatusChange(read, { path: 'notes/life/a.md' }, 'done');
  expect(read).toHaveBeenCalledWith('notes/life/a.md');
  expect(change).toEqual({ path: 'notes/life/a.md', notebookId: 'life', content: '# A\n\nbody\n', metadata: { title: 'A', status: 'done' } });
});

it('archives and unarchives through the same metadata rules as the editor', async () => {
  expect((await noteStatusChange(async () => note(), { path: 'notes/life/a.md' }, 'archived')).metadata).toMatchObject({ status: 'archived', hiden: true });
  expect((await noteStatusChange(async () => note({ status: 'archived', metadata: { hiden: true } }), { path: 'notes/life/a.md' }, 'inbox')).metadata).toMatchObject({ status: 'inbox', hiden: false });
});

it('writes nothing when the note cannot be read', async () => {
  const read = vi.fn().mockRejectedValue(new Error('The full note could not be read (notes/life/a.md); nothing was changed.'));
  await expect(noteStatusChange(read, { path: 'notes/life/a.md' }, 'done')).rejects.toThrow('nothing was changed');
});
