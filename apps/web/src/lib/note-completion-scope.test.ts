import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { fetchNoteCandidates } from './note-completion.js';
import type { NoteQueryScope } from './use-note-queries.js';
import type { NoteItem } from './types.js';
const query = vi.hoisted(() => vi.fn());
vi.mock('./notes-api.js', async importOriginal => ({ ...await importOriginal<typeof import('./notes-api.js')>(), fetchNoteQuery: query }));
afterEach(() => vi.clearAllMocks());
it('queries all native kinds in the source notebook with its repository revision and overlays only its drafts', async () => {
  const draft: NoteItem = { id: 'd', notebookId: 'b', path: 'notes/shared/draft.outline.md', title: 'Draft', content: '- Draft', tags: [], metadata: {} };
  const scope: NoteQueryScope = { sourceId: 'workspace', revisions: { 'github:a/repo@main': 'a1', 'github:b/repo@main': 'b1' }, repositories: { a: 'github:a/repo@main', b: 'github:b/repo@main' }, drafts: { 'b:draft': { note: draft, base: null }, 'a:draft': { note: { ...draft, notebookId: 'a' }, base: null } } };
  query.mockResolvedValue({ notes: [], total: 0 });
  const notes = await fetchNoteCandidates(new QueryClient(), scope, '', 'notes/shared/source.outline.md', 'b');
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ notebookId: 'b', kind: 'all', exclude: ['notes/shared/source.outline.md'] }), expect.objectContaining({ revisions: { 'github:b/repo@main': 'b1' } }));
  expect(notes.map(note => [note.notebookId, note.path])).toEqual([['b', draft.path]]);
});
it('retains the existing ordinary-note completion scope when no notebook constraint is supplied', async () => {
  query.mockResolvedValue({ notes: [], total: 0 });
  await fetchNoteCandidates(new QueryClient(), { sourceId: 'workspace', revisions: {}, repositories: {}, drafts: {} }, '', 'notes/shared/source.md');
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ notebookId: 'all', kind: 'note' }), expect.anything());
});
