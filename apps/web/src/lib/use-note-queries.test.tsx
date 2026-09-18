// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { handleNoteQueryError, invalidateNoteQueries, setNoteQueryScope, useNoteList, useStaleNoteQueries } from './use-note-queries.js';
import { ApiError } from './api.js';

const REVISION = 'a'.repeat(40);

let client: QueryClient;
let requests: string[];

function page(paths: string[], nextCursor: string | null, total = paths.length) {
  return {
    revision: REVISION, total, nextCursor,
    notes: paths.map(path => ({ id: path, path, notebookId: 'life', title: path, tags: [], metadata: {} })),
  };
}

function stubFetch(answer: (url: string) => unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(url);
    const result = answer(url);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  }));
}

const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

function Rows({ notebookId = 'life' }: { notebookId?: string }) {
  const result = useNoteList({ notebookId });
  return createElement('div', {},
    createElement('p', { 'data-testid': 'rows' }, result.notes.map(note => note.path).join(',')),
    createElement('button', { onClick: result.loadMore }, 'more'));
}

beforeEach(() => {
  requests = [];
  client = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => handleNoteQueryError(error, query) }),
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('sends the workspace revision and asks again when it changes', async () => {
  stubFetch(url => page([url.includes(`revision=${'b'.repeat(40)}`) ? 'notes/life/new.md' : 'notes/life/old.md'], null));
  render(createElement(Rows), { wrapper });
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/life/old.md'));
  expect(requests[0]).toContain(`revision=${REVISION}`);

  setNoteQueryScope({ sourceId: 'github:me/notes', revision: 'b'.repeat(40), drafts: {} });
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/life/new.md'));
  expect(requests).toHaveLength(2);
});

it('keeps one answer per notebook and reuses it', async () => {
  stubFetch(url => page([url.includes('notebookId=blog') ? 'notes/blog/a.md' : 'notes/life/a.md'], null));
  const view = render(createElement(Rows, { notebookId: 'life' }), { wrapper });
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/life/a.md'));
  view.rerender(createElement(QueryClientProvider, { client }, createElement(Rows, { notebookId: 'blog' })));
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/blog/a.md'));
  view.rerender(createElement(QueryClientProvider, { client }, createElement(Rows, { notebookId: 'life' })));
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/life/a.md'));
  expect(requests).toHaveLength(2);
});

it('asks again after a local write invalidates the note queries', async () => {
  let answer = 'notes/life/a.md';
  stubFetch(() => page([answer], null));
  render(createElement(Rows), { wrapper });
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/life/a.md'));
  answer = 'notes/life/b.md';
  await invalidateNoteQueries(client);
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/life/b.md'));
  expect(requests).toHaveLength(2);
});

it('continues with the cursor the previous page returned', async () => {
  stubFetch(url => (url.includes('cursor=second') ? page(['notes/life/b.md'], null, 2) : page(['notes/life/a.md'], 'second', 2)));
  render(createElement(Rows), { wrapper });
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/life/a.md'));
  screen.getByText('more').click();
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('notes/life/a.md,notes/life/b.md'));
  expect(requests[1]).toContain('cursor=second');
});

it('reports a rejected revision so the workspace can restart from the first page', async () => {
  stubFetch(() => new Response(JSON.stringify({ error: 'The repository changed. Reload to continue from the latest revision.' }), { status: 409 }));
  const stale = vi.fn();
  function Probe() { useStaleNoteQueries(stale); return createElement(Rows); }
  render(createElement(Probe), { wrapper });
  await waitFor(() => expect(stale).toHaveBeenCalledWith('The repository changed. Reload to continue from the latest revision.'));
});

it('holds no drafts for a view that asked for no notes', async () => {
  stubFetch(() => page(['notes/life/a.md'], null));
  const draft = { id: 'notes/life/new.md', path: 'notes/life/new.md', notebookId: 'life', title: 'New', tags: [], metadata: {}, content: '' };
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: { [draft.path]: { note: draft, base: null } } });
  function Disabled() {
    const result = useNoteList(null);
    return createElement('p', { 'data-testid': 'rows' }, `${result.notes.length}/${result.uncommitted.length}/${result.total}`);
  }
  render(createElement(Disabled), { wrapper });
  expect(screen.getByTestId('rows')).toHaveTextContent('0/0/0');
  expect(requests).toHaveLength(0);
});

it('restarts a rejected cursor and leaves a malformed first page alone', () => {
  // Earlier tests report stale queries on the real clock; start after them so the throttle is clear.
  const start = Date.now() + 60_000;
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(start);
    const stale = vi.fn();
    function Probe() { useStaleNoteQueries(stale); return null; }
    render(createElement(Probe), { wrapper });
    const queryKey = ['notes', 'github:me/notes', REVISION, 'query', {}];
    handleNoteQueryError(new ApiError('Invalid query option.', 400), { queryKey, state: { data: undefined } });
    expect(stale).not.toHaveBeenCalled();
    vi.setSystemTime(start + 10_000);
    handleNoteQueryError(new ApiError('Cursor does not match this query.', 400), { queryKey, state: { data: { pages: [{}] } } });
    expect(stale).toHaveBeenCalledWith('Cursor does not match this query.');
  } finally { vi.useRealTimers(); }
});
