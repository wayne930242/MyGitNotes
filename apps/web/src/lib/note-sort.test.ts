import { describe, it, expect } from 'vitest';
import { sortNotes } from './note-sort.js';
import { NoteItem } from './types.js';

describe('note-sort', () => {
  const notes: NoteItem[] = [
    {
      id: '1',
      path: 'notes/b.md',
      notebookId: 'nb1',
      title: 'Beta Note',
      status: 'working',
      tags: [],
      metadata: { created: '2026-01-01T10:00:00Z', updated: '2026-01-05T10:00:00Z' },
      content: '',
      mtime: 1000,
    },
    {
      id: '2',
      path: 'notes/a.md',
      notebookId: 'nb1',
      title: 'Alpha Note',
      status: 'inbox',
      tags: [],
      metadata: { created: '2026-01-02T10:00:00Z', updated: '2026-01-02T10:00:00Z' },
      content: '',
      mtime: 500,
    },
    {
      id: '3',
      path: 'notes/c.md',
      notebookId: 'nb1',
      title: 'Gamma Note',
      status: 'done',
      tags: [],
      metadata: { created: '2026-01-03T10:00:00Z', updated: '2026-01-08T10:00:00Z' },
      content: '',
      mtime: 2000,
    },
  ];

  const statuses = ['inbox', 'working', 'done'];

  it('sorts by title ascending and descending', () => {
    const asc = sortNotes(notes, 'title', 'asc');
    expect(asc.map((n) => n.title)).toEqual(['Alpha Note', 'Beta Note', 'Gamma Note']);

    const desc = sortNotes(notes, 'title', 'desc');
    expect(desc.map((n) => n.title)).toEqual(['Gamma Note', 'Beta Note', 'Alpha Note']);
  });

  it('sorts by status according to defined status workflow', () => {
    const asc = sortNotes(notes, 'status', 'asc', statuses);
    expect(asc.map((n) => n.status)).toEqual(['inbox', 'working', 'done']);

    const desc = sortNotes(notes, 'status', 'desc', statuses);
    expect(desc.map((n) => n.status)).toEqual(['done', 'working', 'inbox']);
  });

  it('sorts by updated timestamp (metadata or mtime)', () => {
    const desc = sortNotes(notes, 'updated', 'desc');
    expect(desc.map((n) => n.title)).toEqual(['Gamma Note', 'Beta Note', 'Alpha Note']);

    const asc = sortNotes(notes, 'updated', 'asc');
    expect(asc.map((n) => n.title)).toEqual(['Alpha Note', 'Beta Note', 'Gamma Note']);
  });

  it('sorts by created timestamp', () => {
    const asc = sortNotes(notes, 'created', 'asc');
    expect(asc.map((n) => n.title)).toEqual(['Beta Note', 'Alpha Note', 'Gamma Note']);
  });
});
