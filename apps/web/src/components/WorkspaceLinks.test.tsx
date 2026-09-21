// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkspaceLinks } from './WorkspaceLinks.js';

const navigate = vi.fn();
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

let client: QueryClient;
let windowOpen: ReturnType<typeof vi.fn>;
beforeEach(() => {
  navigate.mockClear();
  windowOpen = vi.fn();
  vi.stubGlobal('open', windowOpen);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

const link = (href: string) => createElement('span', { tabIndex: 0, 'data-testid': 'link', 'data-workspace-link': href, 'data-source-path': 'notes/a.md' }, 'Link');

/* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
const workspace = (href: string) => createElement(WorkspaceLinks, { notebooks: [], folders: [], onOpenNote: () => {}, children: link(href) });
/* eslint-enable react/no-children-prop */

it('routes a same-origin absolute URL through the router instead of opening a new window', async () => {
  const { getByTestId } = render(workspace(`${window.location.origin}/notebooks/nb1/notes/a.md`), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'));
  });
  expect(navigate).toHaveBeenCalledWith('/notebooks/nb1/notes/a.md');
  expect(windowOpen).not.toHaveBeenCalled();
});

it('still opens a cross-origin absolute URL in a new window', async () => {
  const { getByTestId } = render(workspace('https://elsewhere.example/notebooks/nb1/notes/a.md'), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'));
  });
  expect(windowOpen).toHaveBeenCalledWith('https://elsewhere.example/notebooks/nb1/notes/a.md', '_blank', 'noopener,noreferrer');
  expect(navigate).not.toHaveBeenCalled();
});

it('opens a same-origin absolute URL in a new tab on a modifier click', async () => {
  const { getByTestId } = render(workspace(`${window.location.origin}/notebooks/nb1/notes/a.md`), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'), { ctrlKey: true });
  });
  expect(windowOpen).toHaveBeenCalledWith('/notebooks/nb1/notes/a.md', '_blank', 'noopener,noreferrer');
  expect(navigate).not.toHaveBeenCalled();
});

/* eslint-disable react/no-children-prop -- Required children are explicit in createElement component props. */
it('keeps the source in place until a cold note body arrives, then reuses that body cache', async () => {
  const { setNoteQueryScope, noteLookupOptions } = await import('../lib/use-note-queries.js');
  const scope = { sourceId: 'test:links', revision: '', drafts: {} };
  setNoteQueryScope(scope);
  let release!: () => void;
  const fetcher = vi.fn((_url: string, _init: RequestInit) =>
    new Promise(resolve => {
      release = () => resolve({ ok: true, json: async () => ({ revision: '', notes: [{ path: 'notes/b.md', notebookId: 'n', title: 'Target', content: '# Body' }] }) });
    })
  );
  vi.stubGlobal('fetch', fetcher);
  const onOpenNote = vi.fn();
  const { getByTestId } = render(createElement(WorkspaceLinks, { notebooks: [{ id: 'n', title: 'Notes', root: 'notes' }], folders: [], onOpenNote, children: link('b.md#heading') }), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'));
  });
  expect(onOpenNote).not.toHaveBeenCalled();
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toMatchObject({ paths: ['notes/b.md'], content: true });
  await act(async () => release());
  expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/b.md', content: undefined }), 'heading', getByTestId('link'));
  expect(client.getQueryData(noteLookupOptions(scope, ['notes/b.md'], true).queryKey)).toMatchObject({ notes: [{ content: '# Body' }] });
});

it('opens a preloaded link without another read and leaves draft selection to the destination', async () => {
  const { setNoteQueryScope, noteLookupOptions } = await import('../lib/use-note-queries.js');
  const scope = { sourceId: 'test:cached', revision: '', drafts: {} };
  setNoteQueryScope(scope);
  client.setDefaultOptions({ queries: { staleTime: Infinity, retry: false } });
  client.setQueryData(noteLookupOptions(scope, ['notes/b.md'], true).queryKey, { revision: '', notes: [{ path: 'notes/b.md', content: '# Committed' }] });
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const onOpenNote = vi.fn();
  const { getByTestId } = render(createElement(WorkspaceLinks, { notebooks: [{ id: 'n', title: 'Notes', root: 'notes' }], folders: [], onOpenNote, children: link('b.md') }), { wrapper });
  await act(async () => {
    fireEvent.click(getByTestId('link'));
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/b.md', content: undefined }), '', getByTestId('link'));
});

/* eslint-enable react/no-children-prop */
