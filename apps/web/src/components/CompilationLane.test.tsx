// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { emptyStudyWorkspace } from '@mygitnotes/core/study';
import type { NotebookConfig } from '../lib/types.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { CompilationLane } from './CompilationLane.js';

const REVISION = 'e'.repeat(40);
let client: QueryClient;

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const row: CompilationRow = { id: 'row-1', path: 'notes/nb1/pinned.compilation.yml', name: 'Pinned', view: 'thumbnail', notebookId: 'nb1', kind: 'custom', items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }] };
const study: StudyController = { study: emptyStudyWorkspace(), save: async () => false, action: async () => false, reload: async () => {}, loading: false, saving: false, error: '', writable: false };

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, notes: [{ id: 'notes/nb1/a.md', path: 'notes/nb1/a.md', notebookId: 'nb1', title: 'Note A', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

const lane = (props: Partial<Parameters<typeof CompilationLane>[0]> = {}) => createElement(CompilationLane, { row, reorder: false, disabled: false, study, notebooks, assets: [], onOpen: () => {}, ...props });

it('read-only: renders cards and scroll buttons but no editing controls', async () => {
  render(lane({ readOnly: true }), { wrapper });
  await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());
  expect(screen.getByLabelText('Scroll left: Pinned')).toBeInTheDocument();
  expect(screen.getByLabelText('Scroll right: Pinned')).toBeInTheDocument();
  expect(screen.queryByLabelText('Filters and sorting: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('View size: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Start studying: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Add item: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Move item: Note A')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Unpin: Note A')).not.toBeInTheDocument();
});

it('read-only: clicking a card calls onOpen', async () => {
  const onOpen = vi.fn();
  render(lane({ readOnly: true, onOpen }), { wrapper });
  const title = await waitFor(() => screen.getByText('Note A'));
  fireEvent.click(title);
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen.mock.calls[0][0]).toMatchObject({ path: 'notes/nb1/a.md', notebookId: 'nb1' });
});

it('offers the order editor on a writable dynamic compilation only', async () => {
  const onEditOrder = vi.fn();
  const dynamic: CompilationRow = { id: 'row-2', path: 'notes/nb1/live.compilation.yml', name: 'Live', view: 'small', notebookId: 'nb1', kind: 'dynamic', source: { kind: 'folder', path: 'notes/nb1', recursive: true, notebookId: 'nb1' } };
  const { rerender } = render(lane({ row: dynamic, onEditOrder }), { wrapper });
  fireEvent.click(await screen.findByLabelText('Edit order: Live'));
  expect(onEditOrder).toHaveBeenCalledTimes(1);
  rerender(lane({ row: dynamic, onEditOrder, readOnly: true }));
  expect(screen.queryByLabelText('Edit order: Live')).not.toBeInTheDocument();
  rerender(lane({ onEditOrder }));
  expect(screen.queryByLabelText(/Edit order/)).not.toBeInTheDocument();
});
