// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { setNoteQueryScope, useNoteList } from '../lib/use-note-queries.js';
import { ListView } from './ListView.js';
import { NoteListSentinel } from './NoteListSentinel.js';

const REVISION = 'c'.repeat(40);
let client: QueryClient;
let observed: (() => void)[];

/** Drives every observed sentinel as if it had scrolled into view. */
function intersect() { for (const notify of observed) notify(); }

beforeEach(() => {
  observed = [];
  class TestObserver {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { observed.push(() => this.callback([{ isIntersecting: true }])); }
    disconnect() { observed = []; }
  }
  vi.stubGlobal('IntersectionObserver', TestObserver);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const second = url.includes('cursor=page-2');
    return new Response(JSON.stringify({
      revision: REVISION, total: 2, nextCursor: second ? null : 'page-2',
      notes: [{ id: second ? 'b' : 'a', path: second ? 'notes/life/b.md' : 'notes/life/a.md', notebookId: 'life', title: second ? 'Second' : 'First', tags: [], metadata: {} }],
    }), { headers: { 'Content-Type': 'application/json' } });
  }));
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

/** The notes page: a list of server-answered rows with the sentinel that loads the next page. */
function NotesList() {
  const result = useNoteList({ notebookId: 'life' }, { limit: 1 });
  return createElement('div', {},
    createElement(ListView, {
      notes: result.notes, uncommitted: result.uncommitted, statuses: ['inbox'],
      onOpenNote: () => {}, onDeleteNote: () => {}, onUpdateNoteStatus: () => {}, onNewNote: () => {},
    }),
    createElement(NoteListSentinel, { hasMore: result.hasMore, loading: result.loadingMore, error: result.error, onLoadMore: result.loadMore }));
}

it('loads the next page when the end of the list scrolls into view', async () => {
  render(createElement(NotesList), { wrapper });
  await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
  expect(screen.queryByText('Second')).not.toBeInTheDocument();

  intersect();
  await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
  expect(screen.getByText('First')).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls[1][0]).toContain('cursor=page-2');
});

it('waits for the retry button after a page fails, instead of asking in a loop', async () => {
  vi.mocked(fetch).mockImplementation(async (url: unknown) => {
    if (String(url).includes('cursor=page-2')) return new Response(JSON.stringify({ error: 'GitHub is unavailable' }), { status: 502 }) as never;
    return new Response(JSON.stringify({
      revision: REVISION, total: 2, nextCursor: 'page-2',
      notes: [{ id: 'a', path: 'notes/life/a.md', notebookId: 'life', title: 'First', tags: [], metadata: {} }],
    }), { headers: { 'Content-Type': 'application/json' } }) as never;
  });
  render(createElement(NotesList), { wrapper });
  await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());

  intersect();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GitHub is unavailable'));
  const afterFailure = vi.mocked(fetch).mock.calls.length;
  intersect();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(afterFailure);

  screen.getByRole('button', { name: 'Retry' }).click();
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(afterFailure + 1));
});

it('stops asking once the last page has been answered', async () => {
  render(createElement(NotesList), { wrapper });
  await waitFor(() => expect(screen.getByText('First')).toBeInTheDocument());
  intersect();
  await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());
  intersect();
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId('note-sentinel')).not.toBeInTheDocument();
});
