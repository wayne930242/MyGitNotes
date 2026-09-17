import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_QUERY, noteMatchesQuery, noteQuerySearch, noteQueryStatuses, type NoteListItem } from '../src/note-query.js';
import { filterNotes } from '../src/note-filters.js';
import type { NoteItem, NotebookConfig } from '../src/types.js';

const note = (overrides: Partial<NoteItem> = {}): NoteItem => ({
  id: 'notes/work/alpha.md', path: 'notes/work/alpha.md', notebookId: 'work', title: 'Alpha', tags: ['a'], metadata: {}, content: 'body text', ...overrides,
});
const query = (overrides: Partial<typeof DEFAULT_NOTE_QUERY> = {}) => ({ ...DEFAULT_NOTE_QUERY, ...overrides });

describe('note query matching', () => {
  it('agrees with filterNotes on the shared filters', () => {
    const notes = [
      note(),
      note({ path: 'notes/work/deep/beta.md', title: 'Beta', tags: ['b'], status: 'done', content: 'other' }),
      note({ path: 'notes/work/hidden.md', title: 'Hidden', metadata: { hiden: true } }),
      note({ path: 'notes/life/gamma.md', notebookId: 'life', title: 'Gamma', tags: [], content: 'body text' }),
    ];
    for (const filters of [
      query(),
      query({ notebookId: 'work' }),
      query({ notebookId: 'work', folders: ['notes/work'], descendants: false }),
      query({ tags: ['a', 'b'], tagMode: 'any' }),
      query({ status: 'done' }),
      query({ showHidden: true }),
      query({ q: 'body' }),
    ]) {
      expect(notes.filter(item => noteMatchesQuery(item, filters)).map(item => item.path))
        .toEqual(filterNotes(notes, filters).map(item => item.path));
    }
  });

  it('matches notes without a status when asked', () => {
    expect(noteMatchesQuery(note({ status: undefined }), query({ withoutStatus: true }))).toBe(true);
    expect(noteMatchesQuery(note({ status: 'done' }), query({ withoutStatus: true }))).toBe(false);
    expect(noteQuerySearch({ notebookId: 'work', withoutStatus: true }).get('noStatus')).toBe('1');
  });

  it('excludes paths and can match titles without content', () => {
    expect(noteMatchesQuery(note(), query({ exclude: ['notes/work/alpha.md'] }))).toBe(false);
    const withoutContent: NoteListItem = { ...note(), content: undefined };
    expect(noteMatchesQuery(withoutContent, query({ q: 'alpha', match: 'title' }))).toBe(true);
    expect(noteMatchesQuery(withoutContent, query({ q: 'body', match: 'title' }))).toBe(false);
    expect(noteMatchesQuery(withoutContent, query({ q: 'body' }))).toBe(false);
  });
});

describe('note query serialization', () => {
  it('omits defaults and repeats list filters', () => {
    expect(noteQuerySearch({ notebookId: 'work' }).toString()).toBe('notebookId=work');
    const params = noteQuerySearch(
      { notebookId: 'work', folders: ['notes/work', 'notes/work/deep'], descendants: false, tags: ['a', 'b'], tagMode: 'all', status: 'inbox', showHidden: true, q: 'text', match: 'title', exclude: ['notes/work/index.md'], sort: 'title', order: 'asc' },
      { revision: 'c'.repeat(40), cursor: 'abc', limit: 20, content: true, select: 'paths' },
    );
    expect(params.getAll('folder')).toEqual(['notes/work', 'notes/work/deep']);
    expect(params.getAll('tag')).toEqual(['a', 'b']);
    expect(Object.fromEntries(params)).toMatchObject({ descendants: '0', tagMode: 'all', status: 'inbox', showHidden: '1', q: 'text', match: 'title', exclude: 'notes/work/index.md', sort: 'title', order: 'asc', limit: '20', content: '1', select: 'paths', cursor: 'abc' });
  });

  it('resolves the status order used for sorting', () => {
    const notebooks = [{ id: 'work', title: 'Work', root: 'notes/work', statuses: ['inbox', 'done'] }] as NotebookConfig[];
    expect(noteQueryStatuses(notebooks, 'work', ['done', 'blocked'])).toEqual(['inbox', 'done', 'blocked']);
    expect(noteQueryStatuses(notebooks, 'all', [])).toEqual(['inbox', 'working', 'done', 'archived']);
  });
});
