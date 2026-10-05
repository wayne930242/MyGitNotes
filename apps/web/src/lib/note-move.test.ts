import { describe, expect, it } from 'vitest';
import { noteFolder, planNoteMove } from './note-move.js';
import type { WorkingNote } from './working-notes.js';

const note = (path: string) => ({ id: 'a', path, notebookId: 'nb', title: 'A', content: '', metadata: {}, tags: [] });
const draft = (path: string, committed: boolean): WorkingNote => ({ note: note(path), base: committed ? note(path) : null });

describe('noteFolder', () => {
  it('names the folder relative to the notebook root, and null at the root', () => {
    expect(noteFolder('notes/a.md', 'notes')).toBeNull();
    expect(noteFolder('notes/work/plans/a.md', 'notes')).toBe('work/plans');
    expect(noteFolder('notes/work/a.md', 'notes/')).toBe('work');
  });
});

describe('planNoteMove', () => {
  it('moves a never-committed remote draft under its new path, without a file operation', () => {
    expect(planNoteMove('notes/a.md', 'notes', 'work', draft('notes/a.md', false))).toMatchObject({ kind: 'draft', destination: 'notes/work/a.md' });
  });

  it('moves a committed note as a file, even while it has a draft', () => {
    expect(planNoteMove('notes/a.md', 'notes', 'work', draft('notes/a.md', true))).toEqual({ kind: 'file', destination: 'notes/work/a.md' });
    expect(planNoteMove('notes/work/a.md', 'notes', null, undefined)).toEqual({ kind: 'file', destination: 'notes/a.md' });
  });

  it('does nothing when the note already sits in that folder', () => {
    expect(planNoteMove('notes/work/a.md', 'notes', 'work', undefined)).toEqual({ kind: 'none' });
  });
});
