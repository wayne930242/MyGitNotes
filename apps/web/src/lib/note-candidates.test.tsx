// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fetchNoteCandidates, useNoteCandidates } from './note-completion.js';
import { setNoteQueryScope } from './use-note-queries.js';
import type { WorkingNotes } from './working-notes.js';

const REVISION = 'e'.repeat(40);
let client: QueryClient;
let requests: string[];

const committed = { id: 'notes/life/a.md', path: 'notes/life/a.md', notebookId: 'life', title: 'Committed note', tags: [], metadata: {} };
const staged = { ...committed, id: 'notes/life/new.md', path: 'notes/life/new.md', title: 'Staged note', content: '' };
const drafts: WorkingNotes = { [staged.path]: { note: staged, base: null } };

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(url);
    return new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [committed] }), { headers: { 'Content-Type': 'application/json' } });
  }));
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setNoteQueryScope({ sourceId: '', revision: '', drafts: {} }); });

const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

function Candidates({ query }: { query: string | null }) {
  const notes = useNoteCandidates(query, 'notes/life/source.md');
  return createElement('p', { 'data-testid': 'candidates' }, notes.map(note => note.title).join(','));
}

it('offers a note staged but not committed alongside the answered ones', async () => {
  render(createElement(Candidates, { query: 'note' }), { wrapper });
  await waitFor(() => expect(screen.getByTestId('candidates')).toHaveTextContent('Staged note,Committed note'));
  expect(requests[0]).toContain('match=title');
  expect(requests[0]).toContain('exclude=notes%2Flife%2Fsource.md');
});

it('asks for nothing while no link is being completed', () => {
  render(createElement(Candidates, { query: null }), { wrapper });
  expect(screen.getByTestId('candidates')).toHaveTextContent('');
  expect(requests).toHaveLength(0);
});

it('offers the same staged note to the CodeMirror editor', async () => {
  const notes = await fetchNoteCandidates(client, { sourceId: 'github:me/notes', revision: REVISION, drafts }, 'note', 'notes/life/source.md');
  expect(notes.map(note => note.title)).toEqual(['Staged note', 'Committed note']);
});
