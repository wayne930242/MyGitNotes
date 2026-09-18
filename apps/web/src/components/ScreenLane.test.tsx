// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import { emptyStudyWorkspace } from '@mygitnotes/core/study';
import type { NotebookConfig } from '../lib/types.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { ScreenLane } from './ScreenLane.js';

const REVISION = 'e'.repeat(40);
let client: QueryClient;

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const row: ScreenRow = {
  id: 'row-1', name: 'Pinned', view: 'thumbnail', notebookId: 'nb1', kind: 'custom',
  items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }],
};
const study: StudyController = {
  study: emptyStudyWorkspace(), save: async () => false, action: async () => false, reload: async () => {},
  loading: false, saving: false, error: '', writable: false,
};

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    revision: REVISION, notes: [{ id: 'notes/nb1/a.md', path: 'notes/nb1/a.md', notebookId: 'nb1', title: 'Note A', tags: [], metadata: {} }],
  }), { headers: { 'Content-Type': 'application/json' } })));
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

const lane = (props: Partial<Parameters<typeof ScreenLane>[0]> = {}) => createElement(ScreenLane, {
  row, reorder: false, disabled: false, study, notebooks, assets: [], onOpen: () => {}, ...props,
});

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

it('shows the add-to-focus button only when provided and not read-only', async () => {
  const onAddToFocus = vi.fn();
  const { rerender } = render(lane(), { wrapper });
  await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());
  expect(screen.queryByLabelText('Add to Focus: Pinned')).not.toBeInTheDocument();
  rerender(lane({ onAddToFocus }));
  const button = screen.getByLabelText('Add to Focus: Pinned');
  fireEvent.click(button);
  expect(onAddToFocus).toHaveBeenCalledTimes(1);
});
