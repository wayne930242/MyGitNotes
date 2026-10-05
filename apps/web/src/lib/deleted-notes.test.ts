import { describe, expect, it } from 'vitest';
import { pendingDeletedNotes } from './deleted-notes.js';
import type { FileChange, NoteItem } from './types.js';

describe('Deleted notes awaiting a commit', () => {
  const note = (notebookId: string, path: string) => ({ notebookId, path, title: path }) as NoteItem;
  const change = (repository: string, path: string, kind: FileChange['kind']) => ({ repository, path, kind, staged: false, unstaged: true, tracked: true, revision: '' }) as FileChange;
  const repositoryOf = (notebookId: string) => ({ life: 'home', trpg: 'trpg' })[notebookId];

  it('keeps only notes whose deletion is still a change in their own repository', () => {
    const notes = [note('life', 'notes/a.md'), note('trpg', 'notes/a.md'), note('life', 'notes/b.md'), note('life', 'notes/c.md')];
    const changes = [change('home', 'notes/a.md', 'deleted'), change('home', 'notes/b.md', 'modified')];
    expect(pendingDeletedNotes(notes, changes, repositoryOf)).toEqual([notes[0]]);
  });
});
